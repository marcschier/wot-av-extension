#include "capture.hpp"
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <cerrno>
#include <cstdarg>
#include <cstring>
#include <iostream>
#include <map>
#include <stdexcept>

extern "C" int __real_close(int);
extern "C" void* __real_mmap64(void*, size_t, int, int, int, off64_t);
extern "C" int __real_munmap(void*, size_t);

namespace {
constexpr char target[] = "/synthetic-camera/fixture-only";
enum class Failure { none, short_frame, error_frame, timeout, lost, drift, stop };
struct Fixture {
    int storage = -1, fd = -1;
    std::size_t page = 0;
    unsigned queues = 0, releases = 0, stops = 0, configurations = 0, forbidden = 0;
    int access = -1;
    bool streaming = false;
    Failure failure = Failure::none;
    std::map<void*, std::size_t> mappings;
} state;
void expect(bool ok) {
    if (!ok) throw std::runtime_error("V4L2 simulated-ioctl assertion failed");
}
int deny() { ++state.forbidden; errno = EACCES; return -1; }
bool selected(int fd) { return state.fd >= 0 && fd == state.fd; }
void metadata(struct stat64* value) {
    *value = {};
    value->st_mode = S_IFCHR | 0600; value->st_dev = 1; value->st_ino = 42;
    value->st_rdev = makedev(81, 0);
}
v4l2_pix_format pixels() {
    v4l2_pix_format p{};
    p.width = 2; p.height = 2; p.pixelformat = V4L2_PIX_FMT_YUYV;
    p.field = V4L2_FIELD_NONE; p.bytesperline = 4; p.sizeimage = 8;
    p.colorspace = V4L2_COLORSPACE_SMPTE170M;
    return p;
}
void write_pixels(bool image) {
    const unsigned char values[8] = {16,128,235,128,16,128,235,128};
    const unsigned char cleared[8]{};
    expect(pwrite(state.storage, image ? values : cleared, 8, 0) == 8);
}
struct Storage {
    Storage() {
        state = {};
        const auto page = sysconf(_SC_PAGESIZE);
        expect(page > 0);
        state.page = static_cast<std::size_t>(page);
        state.storage = memfd_create("synthetic-v4l2-fixture", MFD_CLOEXEC);
        expect(state.storage >= 0 && ftruncate(state.storage, static_cast<off_t>(4*state.page)) == 0);
    }
    ~Storage() {
        if (state.fd >= 0) __real_close(state.fd);
        for (const auto& mapping : state.mappings) __real_munmap(mapping.first, mapping.second);
        if (state.storage >= 0) __real_close(state.storage);
    }
};
}

// No wrapper falls through to a real path lookup, device open, poll or ioctl.
extern "C" char* __wrap_realpath(const char* path, char* resolved) {
    if (std::strcmp(path, target) || !resolved) { deny(); return nullptr; }
    std::strcpy(resolved, target); return resolved;
}
extern "C" int __wrap_stat64(const char* path, struct stat64* value) {
    if (std::strcmp(path, target)) return deny();
    metadata(value); return 0;
}
extern "C" int __wrap_fstat64(int fd, struct stat64* value) {
    if (!selected(fd)) return deny();
    metadata(value); return 0;
}
extern "C" int __wrap_open64(const char* path, int flags, ...) {
    if (std::strcmp(path, target) || state.fd >= 0 ||
        (flags & (O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW)) != (O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW))
        return deny();
    state.fd = fcntl(state.storage, F_DUPFD_CLOEXEC, 3);
    state.access = flags & O_ACCMODE;
    return state.fd;
}
extern "C" int __wrap_close(int fd) {
    if (!selected(fd)) return deny();
    state.fd = -1; return __real_close(fd);
}
extern "C" void* __wrap_mmap64(void* address, size_t size, int prot, int flags, int fd, off64_t offset) {
    if (!selected(fd) || address || size != state.page || offset < 0 ||
        static_cast<std::uint64_t>(offset) >= 4*state.page ||
        static_cast<std::size_t>(offset) % state.page || prot != (PROT_READ | PROT_WRITE) || flags != MAP_SHARED) {
        deny(); return MAP_FAILED;
    }
    auto* result = __real_mmap64(address, size, prot, flags, fd, offset);
    if (result != MAP_FAILED) state.mappings.emplace(result, size);
    return result;
}
extern "C" int __wrap_munmap(void* address, size_t size) {
    const auto found = state.mappings.find(address);
    if (found == state.mappings.end() || found->second != size) return deny();
    const int result = __real_munmap(address, size);
    if (!result) state.mappings.erase(found);
    return result;
}
extern "C" int __wrap_poll(pollfd* fds, nfds_t count, int timeout) {
    if (count != 1 || !selected(fds[0].fd) || timeout < 0 || timeout > 2000) return deny();
    if (state.failure == Failure::timeout) return 0;
    fds[0].revents = state.failure == Failure::lost ? POLLHUP : POLLIN;
    return 1;
}
extern "C" int __wrap_ioctl(int fd, unsigned long request, ...) {
    if (!selected(fd)) return deny();
    va_list args; va_start(args, request); void* data = va_arg(args, void*); va_end(args);
    switch (request) {
    case VIDIOC_QUERYCAP: {
        auto& value = *static_cast<v4l2_capability*>(data); value = {};
        std::strcpy(reinterpret_cast<char*>(value.driver), "synthetic");
        std::strcpy(reinterpret_cast<char*>(value.card), "fixture");
        std::strcpy(reinterpret_cast<char*>(value.bus_info), "memory");
        value.capabilities = V4L2_CAP_VIDEO_CAPTURE | V4L2_CAP_STREAMING; return 0;
    }
    case VIDIOC_G_FMT:
        expect(static_cast<v4l2_format*>(data)->type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        static_cast<v4l2_format*>(data)->fmt.pix = pixels();
        if (state.failure == Failure::drift && state.configurations)
            static_cast<v4l2_format*>(data)->fmt.pix.colorspace = V4L2_COLORSPACE_REC709;
        return 0;
    case VIDIOC_G_PARM: {
        expect(static_cast<v4l2_streamparm*>(data)->type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        auto& value = static_cast<v4l2_streamparm*>(data)->parm.capture;
        value.capability = V4L2_CAP_TIMEPERFRAME; value.timeperframe = {1,30}; return 0;
    }
    case VIDIOC_ENUM_FMT: {
        auto& value = *static_cast<v4l2_fmtdesc*>(data);
        if (value.index) { errno = EINVAL; return -1; }
        value.pixelformat = V4L2_PIX_FMT_YUYV; return 0;
    }
    case VIDIOC_ENUM_FRAMESIZES: {
        auto& value = *static_cast<v4l2_frmsizeenum*>(data);
        if (value.index) { errno = EINVAL; return -1; }
        value.type = V4L2_FRMSIZE_TYPE_DISCRETE; value.discrete = {2,2}; return 0;
    }
    case VIDIOC_TRY_FMT:
        expect(static_cast<v4l2_format*>(data)->type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        expect(static_cast<v4l2_format*>(data)->fmt.pix.width == 2);
        expect(static_cast<v4l2_format*>(data)->fmt.pix.height == 2);
        expect(static_cast<v4l2_format*>(data)->fmt.pix.pixelformat == V4L2_PIX_FMT_YUYV);
        static_cast<v4l2_format*>(data)->fmt.pix = pixels(); return 0;
    case VIDIOC_ENUM_FRAMEINTERVALS: {
        auto& value = *static_cast<v4l2_frmivalenum*>(data);
        if (value.index) { errno = EINVAL; return -1; }
        value.type = V4L2_FRMIVAL_TYPE_DISCRETE; value.discrete = {1,30}; return 0;
    }
    case VIDIOC_S_FMT: {
        expect(state.access == O_RDWR);
        const auto& value = *static_cast<v4l2_format*>(data);
        const auto& p = value.fmt.pix;
        expect(value.type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        expect(p.width == 2 && p.height == 2 && p.pixelformat == V4L2_PIX_FMT_YUYV);
        expect(p.field == V4L2_FIELD_NONE && p.bytesperline == 4 && p.sizeimage == 8);
        expect(p.colorspace == V4L2_COLORSPACE_SMPTE170M &&
               p.ycbcr_enc == V4L2_YCBCR_ENC_DEFAULT && p.quantization == V4L2_QUANTIZATION_DEFAULT);
        ++state.configurations; return 0;
    }
    case VIDIOC_S_PARM:
        expect(static_cast<v4l2_streamparm*>(data)->parm.capture.timeperframe.numerator == 1);
        expect(static_cast<v4l2_streamparm*>(data)->parm.capture.timeperframe.denominator == 30);
        return 0;
    case VIDIOC_REQBUFS: {
        auto& value = *static_cast<v4l2_requestbuffers*>(data);
        expect(value.memory == V4L2_MEMORY_MMAP && value.type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        if (!value.count) ++state.releases;
        else expect(value.count == 4);
        return 0;
    }
    case VIDIOC_QUERYBUF: {
        auto& value = *static_cast<v4l2_buffer*>(data);
        expect(value.index < 4);
        value.length = static_cast<__u32>(state.page);
        value.m.offset = static_cast<__u32>(value.index*state.page); return 0;
    }
    case VIDIOC_QBUF:
        expect(static_cast<v4l2_buffer*>(data)->index < 4);
        expect(static_cast<v4l2_buffer*>(data)->type == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        expect(static_cast<v4l2_buffer*>(data)->memory == V4L2_MEMORY_MMAP);
        ++state.queues;
        if (state.streaming) write_pixels(false); // Immediate native reuse after requeue.
        return 0;
    case VIDIOC_STREAMON:
        expect(state.access == O_RDWR && *static_cast<v4l2_buf_type*>(data) == V4L2_BUF_TYPE_VIDEO_CAPTURE);
        state.streaming = true; return 0;
    case VIDIOC_DQBUF: {
        expect(state.streaming);
        auto& value = *static_cast<v4l2_buffer*>(data);
        expect(value.type == V4L2_BUF_TYPE_VIDEO_CAPTURE && value.memory == V4L2_MEMORY_MMAP);
        value.index = 0; value.bytesused = state.failure == Failure::short_frame ? 7 : 8;
        value.flags = V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC | V4L2_BUF_FLAG_TSTAMP_SRC_SOE;
        if (state.failure == Failure::error_frame) value.flags |= V4L2_BUF_FLAG_ERROR;
        value.timestamp.tv_sec = 1; value.timestamp.tv_usec = 2; value.sequence = 7;
        write_pixels(true); return 0;
    }
    case VIDIOC_STREAMOFF:
        ++state.stops; state.streaming = false;
        if (state.failure == Failure::stop) { errno = EIO; return -1; }
        return 0;
    default: return deny();
    }
}

int main() {
    try {
        for (const auto failure : {Failure::none, Failure::short_frame, Failure::error_frame,
                                   Failure::timeout, Failure::lost, Failure::drift, Failure::stop}) {
            Storage storage;
            auto probe = capture::make_v4l2();
            probe->connect(target, "", capture::Access::identify);
            const auto evidence = probe->describe();
            expect(evidence.modes.size() == 1 && state.configurations == 0 && state.queues == 0 && state.access == O_RDONLY);
            expect(evidence.modes[0].fps_n == 30 && evidence.modes[0].fps_d == 1);
            expect(probe->close().error_count == 0);
            auto source = capture::make_v4l2();
            source->connect(target, evidence.identity, capture::Access::acquisition);
            state.failure = failure;
            std::string fault;
            try {
                source->open(evidence.digest(), evidence.modes[0].id(), "I420", capture::Limits{});
                const auto frame = source->next(capture::monotonic_ns() + 2000000000ULL);
                expect(frame.data == std::vector<std::uint8_t>({16,235,16,235,128,128}));
                expect(frame.timing_fields.find("\"nativeTimestampNs\":\"1000002000\"") != std::string::npos);
                expect(frame.timing_fields.find("\"nativeTimestampClock\":\"monotonic\"") != std::string::npos);
            } catch (const capture::Fault& error) { fault = error.code; }
            const std::string expected = failure == Failure::short_frame || failure == Failure::error_frame ?
                "SourceFailure" : failure == Failure::timeout ? "Timeout" : failure == Failure::lost ?
                "DeviceLost" : failure == Failure::drift ? "UnsupportedFormat" : "";
            expect(fault == expected);
            const auto closed = source->close();
            expect(state.fd == -1 && state.mappings.empty() && state.forbidden == 0);
            expect(state.releases == (failure == Failure::drift ? 0U : 1U));
            expect(state.stops == (failure == Failure::drift ? 0U : 1U));
            if (failure == Failure::short_frame || failure == Failure::error_frame || failure == Failure::none)
                expect(state.queues == 5);
            expect((closed.error_count != 0) == (failure == Failure::stop));
            expect(closed.stop_failed == (failure == Failure::stop));
            expect(source->close().json() == closed.json());
        }
        std::cout << "Actual V4L2 translation unit with simulated ioctls/memfd passed; not driver/device proof\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
