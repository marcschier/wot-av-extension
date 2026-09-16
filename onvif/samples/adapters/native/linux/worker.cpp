#include "../common/capture.hpp"

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <cstring>

namespace {
using namespace capture;
std::uint64_t write_deadline = 0;
void write_all(const void* data, std::size_t size) {
    const auto* at = static_cast<const std::uint8_t*>(data);
    while (size) {
        if (monotonic_ns() >= write_deadline) throw Fault("Timeout");
        const auto n = ::write(STDOUT_FILENO, at, size);
        if (n > 0) { at += n; size -= static_cast<std::size_t>(n); continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            pollfd p{STDOUT_FILENO, POLLOUT, 0};
            const auto now = monotonic_ns();
            if (now >= write_deadline) throw Fault("Timeout");
            const auto rc = poll(&p, 1, static_cast<int>((write_deadline-now+999999)/1000000));
            if (rc < 0 && errno == EINTR) continue;
            if (rc <= 0 || (p.revents & (POLLERR | POLLHUP | POLLNVAL))) throw Fault("ProtocolError");
            continue;
        }
        throw Fault("ProtocolError");
    }
}
void packet(const std::string& json, const std::vector<std::uint8_t>& payload = {}) {
    if (json.size() < 2 || json.size() > 65536 || payload.size() > 16777216) throw Fault("ResourceLimit");
    std::uint8_t header[8]{};
    for (unsigned i = 0; i < 4; ++i) {
        header[i] = static_cast<std::uint8_t>(json.size() >> (8*i));
        header[4+i] = static_cast<std::uint8_t>(payload.size() >> (8*i));
    }
    write_all(header, sizeof(header)); write_all(json.data(), json.size()); write_all(payload.data(), payload.size());
}
bool line(std::string& out, std::uint64_t deadline) {
    out.clear();
    while (true) {
        const auto now = monotonic_ns();
        if (now >= deadline) {
            if (!out.empty()) throw Fault("Timeout");
            return false;
        }
        pollfd p{STDIN_FILENO, POLLIN, 0};
        const auto rc = poll(&p, 1, static_cast<int>((deadline-now+999999)/1000000));
        if (rc < 0) { if (errno == EINTR) continue; system_fault(errno); }
        if (!rc) continue;
        if (p.revents & (POLLNVAL | POLLERR)) throw Fault("ProtocolError");
        char c = 0;
        const auto n = ::read(STDIN_FILENO, &c, 1);
        if (!n) {
            if (!out.empty()) throw Fault("ProtocolError");
            return false;
        }
        if (n < 0) { if (errno == EINTR || errno == EAGAIN) continue; system_fault(errno); }
        if (c == '\n') return true;
        if ((static_cast<unsigned char>(c) < 32 && c != '\t') || c > 126 || out.size() == 32768)
            throw Fault("ProtocolError");
        out += c;
    }
}
std::unique_ptr<Source> source_for(const std::string& backend) {
    if (backend == "linux-v4l2") return make_v4l2();
    if (backend == "aravis-gige" || backend == "aravis-usb3" || backend == "aravis-fake") {
#if CAPTURE_ARAVIS
        return make_aravis(backend);
#else
        throw Fault("MissingDependency");
#endif
    }
    throw Fault("InvalidSelection");
}
Access permission(const std::string& backend, const std::string& token) {
    if (token == "permit-native-read") return Access::native_read;
    if (token == "permit-control-probe" && backend != "linux-v4l2") return Access::control_probe;
    throw Fault("PolicyDenied");
}
int run() {
    signal(SIGPIPE, SIG_IGN);
    if (unsetenv("ARV_DEBUG") != 0) system_fault(errno);
    const int flags = fcntl(STDOUT_FILENO, F_GETFL);
    if (flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) system_fault(errno);
    std::unique_ptr<Source> source;
    CloseResult completed;
    std::uint64_t deadline = monotonic_ns() + 30000000000ULL, sequence = 0;
    write_deadline = monotonic_ns() + 5000000000ULL;
    std::string operation = "open";
    const auto finish = [&]() {
        if (source) { completed = source->close(); source.reset(); }
        write_deadline = monotonic_ns() + 2000000000ULL;
        packet(completed.json());
        return completed.error_count ? 1 : 0;
    };
    std::string backends = "\"linux-v4l2\"";
#if CAPTURE_ARAVIS
    backends += ",\"aravis-gige\",\"aravis-fake\"";
#if CAPTURE_ARAVIS_USB
    backends += ",\"aravis-usb3\"";
#endif
#endif
    packet("{\"kind\":\"hello\",\"protocol\":\"capture-v1\",\"outputs\":[\"JPEG\",\"I420\"],"
           "\"nativeBackends\":[" + backends + "],\"automaticDiscovery\":false}");
    try {
        std::string input;
        while (line(input, deadline)) {
            const auto args = fields(input);
            const auto& command = args[0];
            operation = command == "describe" || command == "identify" ? "describe" :
                command == "next" ? "next" : command == "close" ? "close" : "open";
            write_deadline = monotonic_ns() + 5000000000ULL;
            if (command == "close" && args.size() == 1) return finish();
            if ((command == "describe" || command == "identify") && !source &&
                args.size() == (command == "describe" ? 5U : 4U)) {
                const bool identify = command == "identify";
                const auto access = permission(args[1], args[identify ? 3 : 4]);
                if (identify && args[1] != "linux-v4l2" && access != Access::control_probe) throw Fault("PolicyDenied");
                if (!identify && !is_sha256(args[3])) throw Fault("InvalidSelection");
                const auto selector = unhex(args[2]);
                source = source_for(args[1]);
                source->connect(selector, identify ? "" : args[3], identify ? Access::identify : access);
                const auto evidence = source->describe();
                completed = source->close(); source.reset();
                packet(evidence.json());
                if (completed.error_count) { packet(completed.json()); return 1; }
            } else if (command == "open" && args.size() == 14 && !source) {
                if (args[13] != "permit-acquisition") throw Fault("PolicyDenied");
                if (!is_sha256(args[3]) || !is_sha256(args[4])) throw Fault("InvalidSelection");
                Limits limits;
                limits.width = number(args[7], 4096); limits.height = number(args[8], 4096);
                limits.native_bytes = number(args[9], 33554432); limits.frame_bytes = number(args[10], 16777216);
                limits.read_ms = number(args[11], 2000); limits.validate();
                deadline = monotonic_ns() + number(args[12], 30000)*1000000ULL;
                const auto selector = unhex(args[2]);
                source = source_for(args[1]);
                source->connect(selector, args[3], Access::acquisition);
                source->open(args[4], args[5], args[6], limits);
                if (monotonic_ns() >= deadline) throw Fault("Timeout");
                packet("{\"kind\":\"opened\",\"generation\":\"1\",\"modeId\":" + quote(source->mode().id()) + "}");
            } else if (command == "next" && args.size() == 1 && source) {
                const auto frame = source->next(deadline);
                if (sequence == UINT64_MAX) throw Fault("ResourceLimit");
                const auto& m = source->mode();
                write_deadline = std::min<std::uint64_t>(deadline, monotonic_ns() + 2000000000ULL);
                packet("{\"kind\":\"frame\",\"generation\":\"1\",\"sequence\":" + quote(std::to_string(++sequence)) +
                    ",\"modeId\":" + quote(m.id()) + ",\"format\":" + quote(source->output()) +
                    ",\"width\":" + std::to_string(frame.width) + ",\"height\":" + std::to_string(frame.height) +
                    ",\"payloadBytes\":" + std::to_string(frame.data.size()) +
                    ",\"timing\":{\"hostReceiptMonotonicNs\":" + quote(std::to_string(frame.host_ns)) +
                    ",\"pipelinePtsNs\":null,\"source\":null" + frame.timing_fields + "}}", frame.data);
            } else throw Fault("ProtocolError");
        }
        return finish();
    } catch (const Fault& f) {
        write_deadline = monotonic_ns() + 2000000000ULL; packet(fault_json(f, operation)); finish(); return 1;
    } catch (const std::bad_alloc&) {
        write_deadline = monotonic_ns() + 2000000000ULL;
        packet(fault_json(Fault("ResourceLimit"), operation)); finish(); return 1;
    } catch (const std::exception&) {
        write_deadline = monotonic_ns() + 2000000000ULL;
        packet(fault_json(Fault("SourceFailure"), operation)); finish(); return 1;
    }
}
}
int main(int argc, char** argv) {
    if (argc != 2 || std::strcmp(argv[1], "--stdio")) return 2;
    try { return run(); } catch (...) { return 2; }
}
