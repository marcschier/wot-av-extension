#include "capture.hpp"

#include <charconv>
#include <cstring>
#include <limits>

namespace {

void write_all(const void* data, std::size_t length) {
    const BYTE* cursor = static_cast<const BYTE*>(data);
    while (length) {
        DWORD written = 0;
        if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), cursor, static_cast<DWORD>(length), &written, nullptr)
            || !written) throw capture::Fault("ProtocolError");
        cursor += written;
        length -= written;
    }
}

void packet(const std::string& json, const std::vector<BYTE>& bytes = {}) {
    if (json.size() > 65536 || bytes.size() > 16777216) throw capture::Fault("ResourceLimit");
    const std::uint32_t header[2]{static_cast<std::uint32_t>(json.size()), static_cast<std::uint32_t>(bytes.size())};
    write_all(header, sizeof(header));
    write_all(json.data(), json.size());
    write_all(bytes.data(), bytes.size());
}

bool line(std::string& out, ULONGLONG deadline) {
    out.clear();
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    if (GetFileType(input) != FILE_TYPE_PIPE) throw capture::Fault("ProtocolError");
    while (GetTickCount64() < deadline) {
        DWORD available = 0;
        if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) {
            if (GetLastError() == ERROR_BROKEN_PIPE) return false;
            throw capture::Fault("ProtocolError");
        }
        if (!available) { Sleep(5); continue; }
        char c = 0;
        DWORD read = 0;
        if (!ReadFile(input, &c, 1, &read, nullptr) || read != 1) throw capture::Fault("ProtocolError");
        if (c == '\n') return true;
        if (c == '\0' || c == '\r' || out.size() == 32768) throw capture::Fault("ProtocolError");
        out.push_back(c);
    }
    if (!out.empty()) throw capture::Fault("Timeout");
    return false;
}

std::vector<std::string> fields(const std::string& text) {
    std::vector<std::string> result;
    std::size_t start = 0;
    while (true) {
        const auto end = text.find('\t', start);
        result.push_back(text.substr(start, end == std::string::npos ? end : end - start));
        if (end == std::string::npos) return result;
        if (result.size() > 16) throw capture::Fault("ProtocolError");
        start = end + 1;
    }
}

std::uint32_t number(const std::string& value, std::uint32_t maximum) {
    std::uint32_t result = 0;
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
    if (value.empty() || (value.size() > 1 && value[0] == '0') || parsed.ec != std::errc{}
        || parsed.ptr != value.data() + value.size() || !result || result > maximum) {
        throw capture::Fault("ResourceLimit");
    }
    return result;
}

bool backend(const std::string& value) {
    if (value == "mf-memory") return true;
    if (value == "windows-mf") return false;
    throw capture::Fault("InvalidSelection");
}

std::string fault_json(const capture::Fault& fault, const std::string& operation) {
    return "{\"kind\":\"fault\",\"code\":" + capture::quote(fault.code) + ",\"operation\":"
        + capture::quote(operation) + ",\"retryable\":false,\"diagnosticId\":\"native-worker\","
        + "\"nativeDomain\":\"HRESULT\",\"nativeCode\":" + capture::quote(capture::hex_code(fault.native_code)) + "}";
}

std::string frame_json(const capture::Frame& frame, const capture::Source& source, std::uint64_t sequence) {
    const bool unsigned_ns = frame.has_time && frame.sample_time >= 0
        && static_cast<std::uint64_t>(frame.sample_time) <= std::numeric_limits<std::uint64_t>::max() / 100;
    return "{\"kind\":\"frame\",\"generation\":\"1\",\"sequence\":" + capture::quote(std::to_string(sequence))
        + ",\"modeId\":" + capture::quote(source.mode().id()) + ",\"format\":" + capture::quote(source.output())
        + ",\"width\":" + std::to_string(frame.width) + ",\"height\":" + std::to_string(frame.height)
        + ",\"payloadBytes\":" + std::to_string(frame.data.size()) + ",\"timing\":{\"hostReceiptMonotonicNs\":"
        + capture::quote(std::to_string(frame.host_ns)) + ",\"source\":null,\"pipelinePtsNs\":"
        + (unsigned_ns ? capture::quote(std::to_string(static_cast<std::uint64_t>(frame.sample_time) * 100)) : "null")
        + ",\"sdkSampleTime100ns\":" + (frame.has_time ? capture::quote(std::to_string(frame.sample_time)) : "null")
        + ",\"sdkSampleDuration100ns\":" + (frame.has_duration ? capture::quote(std::to_string(frame.sample_duration)) : "null")
        + ",\"sdkTimeProvenance\":\"IMFSample presentation time; not exposure or UTC\"}}";
}

int run() {
    capture::Runtime runtime;
    std::unique_ptr<capture::Source> source;
    ULONGLONG deadline = GetTickCount64() + 30000;
    std::uint64_t sequence = 0, dropped = 0;
    std::string operation = "open";
    auto finish = [&]() {
        capture::CloseResult result = source ? source->close() : capture::CloseResult{};
        source.reset();
        const HRESULT hr = runtime.close();
        if (FAILED(hr)) result.add(hr);
        packet(result.json());
        return !result.error_count ? 0 : 1;
    };
    packet("{\"kind\":\"hello\",\"protocol\":\"capture-v1\",\"outputs\":[\"JPEG\",\"I420\"],"
        "\"nativeBackends\":[\"windows-mf\",\"mf-memory\"],\"automaticDiscovery\":false}");
    try {
        std::string text;
        while (line(text, deadline)) {
            const auto args = fields(text);
            const std::string& command = args[0];
            operation = command == "describe" || command == "discover" ? "describe" : command == "next" ? "next"
                : command == "close" ? "close" : "open";
            if (command == "close" && args.size() == 1) return finish();
            if (command == "discover" && args.size() == 2 && args[1] == "permit-discovery" && !source) {
                packet(capture::discover());
            } else if (command == "describe" && args.size() == 5 && !source) {
                const bool synthetic = backend(args[1]);
                if (args[4] != (synthetic ? "permit-software-read" : "permit-native-read")) {
                    throw capture::Fault("PolicyDenied");
                }
                source = std::make_unique<capture::Source>(synthetic, capture::from_utf8(capture::unhex(args[2])), args[3]);
                const auto evidence = source->describe();
                const auto closed = source->close();
                if (closed.error_count) throw capture::Fault("CleanupFailed", closed.errors[0]);
                source.reset();
                packet(evidence.json());
            } else if (command == "open" && args.size() == 14 && !source) {
                if (args[13] != "permit-acquisition") throw capture::Fault("PolicyDenied");
                const bool synthetic = backend(args[1]);
                capture::Limits limits;
                limits.width = number(args[7], 4096);
                limits.height = number(args[8], 4096);
                limits.native_bytes = number(args[9], 33554432);
                limits.frame_bytes = number(args[10], 16777216);
                limits.read_ms = number(args[11], 2000);
                limits.validate();
                deadline = GetTickCount64() + number(args[12], 30000);
                source = std::make_unique<capture::Source>(synthetic, capture::from_utf8(capture::unhex(args[2])), args[3]);
                source->open(args[4], args[5], args[6], limits);
                if (GetTickCount64() >= deadline) throw capture::Fault("Timeout");
                packet("{\"kind\":\"opened\",\"generation\":\"1\",\"modeId\":" + capture::quote(source->mode().id()) + "}");
            } else if (command == "next" && args.size() == 1 && source) {
                try {
                    const auto frame = source->next();
                    packet(frame_json(frame, *source, ++sequence), frame.data);
                } catch (const capture::Fault& fault) {
                    if (fault.code == "NativeIncomplete") {
                        packet("{\"kind\":\"gap\",\"generation\":\"1\",\"reason\":\"native-incomplete\",\"dropped\":"
                            + capture::quote(std::to_string(++dropped)) + "}");
                    } else if (fault.code == "EndOfStream") {
                        packet("{\"kind\":\"end\",\"reason\":\"eos\"}");
                        return finish();
                    } else throw;
                }
            } else throw capture::Fault("ProtocolError");
        }
        return finish();
    } catch (const capture::Fault& fault) {
        packet(fault_json(fault, operation));
        finish();
        return 1;
    } catch (const std::bad_alloc&) {
        packet(fault_json(capture::Fault("ResourceLimit"), operation));
        finish();
        return 1;
    }
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 2 || std::strcmp(argv[1], "--stdio") != 0) return 2;
    try { return run(); }
    catch (const capture::Fault&) { return 2; }
    catch (const std::bad_alloc&) { return 2; }
}
