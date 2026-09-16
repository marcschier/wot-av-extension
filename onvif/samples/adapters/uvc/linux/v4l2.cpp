#include "../../native/common/capture.hpp"

#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstring>
#include <cstdlib>
#include <limits>
#include <map>
#include <numeric>

namespace capture {
namespace {
int xioctl(int fd, unsigned long request, void* arg) {
    int result;
    do { result = ioctl(fd, request, arg); } while (result < 0 && errno == EINTR);
    return result;
}
void checked_ioctl(int fd, unsigned long request, void* arg) {
    if (xioctl(fd, request, arg) < 0) system_fault(errno);
}
std::string native_text(const __u8* data, std::size_t size) {
    const auto* end = static_cast<const __u8*>(std::memchr(data, 0, size));
    if (!end) throw Fault("SourceFailure");
    std::string result(reinterpret_cast<const char*>(data), static_cast<std::size_t>(end-data));
    if (!valid_utf8(result) || result.find('\n') != std::string::npos) throw Fault("SourceFailure");
    return result;
}
bool supported(const v4l2_pix_format& p) {
    if (!p.width || !p.height || p.width > 4096 || p.height > 4096 ||
        p.field != V4L2_FIELD_NONE || !p.sizeimage || p.sizeimage > 33554432) return false;
    if (p.pixelformat == V4L2_PIX_FMT_MJPEG) return true;
    if (p.pixelformat != V4L2_PIX_FMT_YUYV || p.width % 2 ||
        p.bytesperline < p.width*2 || p.bytesperline > 33554432) return false;
    const bool matrix = p.ycbcr_enc == V4L2_YCBCR_ENC_601 ||
        (p.ycbcr_enc == V4L2_YCBCR_ENC_DEFAULT && p.colorspace == V4L2_COLORSPACE_SMPTE170M);
    const bool range = p.quantization == V4L2_QUANTIZATION_LIM_RANGE ||
        (p.quantization == V4L2_QUANTIZATION_DEFAULT && p.colorspace == V4L2_COLORSPACE_SMPTE170M);
    return matrix && range;
}
Mode make_mode(const v4l2_pix_format& p, v4l2_fract interval, const std::string& locator) {
    if (!supported(p) || !interval.numerator || !interval.denominator) throw Fault("UnsupportedFormat");
    Mode m;
    m.prefix = "v4l2"; m.pixel = p.pixelformat;
    m.subtype = p.pixelformat == V4L2_PIX_FMT_YUYV ? "V4L2:YUYV" : "V4L2:MJPG";
    m.width = p.width; m.height = p.height; m.stride = p.bytesperline;
    m.payload = p.sizeimage;
    const auto divisor = std::gcd(interval.numerator, interval.denominator);
    m.fps_n = interval.denominator/divisor; m.fps_d = interval.numerator/divisor;
    m.locator = locator;
    m.details = "field=" + std::to_string(p.field) + ";colorspace=" + std::to_string(p.colorspace) +
        ";ycbcr=" + std::to_string(p.ycbcr_enc) + ";quantization=" + std::to_string(p.quantization) +
        ";xfer=" + std::to_string(p.xfer_func) + ";sizeimage=" + std::to_string(p.sizeimage) +
        ";bytesperline=" + std::to_string(p.bytesperline);
    if (p.pixelformat == V4L2_PIX_FMT_YUYV &&
        layout_extent(Layout{p.width, p.height, p.bytesperline, RawFormat::yuyv601}, Limits{}) > p.sizeimage)
        throw Fault("SourceFailure");
    return m;
}
bool same_stat(const struct stat& a, const struct stat& b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_rdev == b.st_rdev && S_ISCHR(b.st_mode);
}
struct Mapping { void* address = MAP_FAILED; std::size_t size = 0; bool queued = false; };

class V4l2 final : public Source {
    int fd_ = -1;
    bool buffers_ = false, started_ = false, acquisition_ = false, closed_ = false;
    std::string identity_, output_;
    Limits limits_;
    Mode selected_;
    std::array<Mapping, 4> mapped_{};
    std::size_t count_ = 0;
    std::map<std::string, v4l2_pix_format> formats_;
    CloseResult receipt_;

    v4l2_fract interval() {
        v4l2_streamparm p{}; p.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        checked_ioctl(fd_, VIDIOC_G_PARM, &p);
        if (!(p.parm.capture.capability & V4L2_CAP_TIMEPERFRAME) ||
            !p.parm.capture.timeperframe.numerator || !p.parm.capture.timeperframe.denominator)
            throw Fault("UnsupportedFormat");
        return p.parm.capture.timeperframe;
    }
    void queue(std::uint32_t index) {
        v4l2_buffer b{}; b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; b.memory = V4L2_MEMORY_MMAP; b.index = index;
        checked_ioctl(fd_, VIDIOC_QBUF, &b);
        mapped_[index].queued = true;
    }
public:
    ~V4l2() override { close(); }
    void connect(const std::string& selector, const std::string& expected, Access access) override {
        if (fd_ >= 0 || selector.empty() || selector[0] != '/' || selector.size() >= PATH_MAX ||
            selector.find_first_of("*?[]\r\n\t") != std::string::npos) throw Fault("InvalidSelection");
        if (access == Access::control_probe) throw Fault("PolicyDenied");
        acquisition_ = access == Access::acquisition;
        char canonical[PATH_MAX]{};
        if (!realpath(selector.c_str(), canonical)) system_fault(errno);
        struct stat before{};
        if (stat(canonical, &before) != 0) system_fault(errno);
        if (!S_ISCHR(before.st_mode)) throw Fault("InvalidSelection");
        fd_ = ::open(canonical, (acquisition_ ? O_RDWR : O_RDONLY) | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
        if (fd_ < 0) system_fault(errno);
        struct stat owned{}, after{};
        if (fstat(fd_, &owned) != 0 || stat(canonical, &after) != 0) system_fault(errno);
        if (!same_stat(before, owned) || !same_stat(owned, after)) throw Fault("IdentityChanged");
        char check[PATH_MAX]{};
        if (!realpath(selector.c_str(), check) || std::strcmp(canonical, check)) throw Fault("IdentityChanged");
        v4l2_capability cap{}; checked_ioctl(fd_, VIDIOC_QUERYCAP, &cap);
        const auto flags = cap.capabilities & V4L2_CAP_DEVICE_CAPS ? cap.device_caps : cap.capabilities;
        if (!(flags & V4L2_CAP_VIDEO_CAPTURE) || !(flags & V4L2_CAP_STREAMING))
            throw Fault("UnsupportedFormat");
        identity_ = sha256("capture-v1:linux-v4l2\n" + std::string(canonical) + "\n" +
            std::to_string(static_cast<std::uint64_t>(owned.st_dev)) + "\n" +
            std::to_string(static_cast<std::uint64_t>(owned.st_ino)) + "\n" +
            std::to_string(major(owned.st_rdev)) + ":" + std::to_string(minor(owned.st_rdev)) + "\n" +
            native_text(cap.driver, sizeof(cap.driver)) + "\n" + native_text(cap.card, sizeof(cap.card)) + "\n" +
            native_text(cap.bus_info, sizeof(cap.bus_info)) + "\n");
        if (access != Access::identify && (!is_sha256(expected) || expected != identity_)) throw Fault("IdentityChanged");
    }
    Evidence describe() override {
        if (fd_ < 0 || started_) throw Fault("Busy");
        Evidence e{identity_, "linux-device-node", "native-read-only", {}};
        formats_.clear();
        auto add = [&](const v4l2_pix_format& p, v4l2_fract rate, const std::string& where) {
            if (!supported(p)) return;
            auto m = make_mode(p, rate, where);
            const auto id = m.id();
            if (formats_.find(id) != formats_.end()) return;
            if (e.modes.size() == 96) throw Fault("ResourceLimit");
            formats_.emplace(id, p); e.modes.push_back(std::move(m));
        };
        v4l2_format current{}; current.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        checked_ioctl(fd_, VIDIOC_G_FMT, &current);
        const auto current_rate = interval();
        add(current.fmt.pix, current_rate, "VIDIOC_G_FMT+VIDIOC_G_PARM");
        for (std::uint32_t fi = 0; fi <= 64; ++fi) {
            v4l2_fmtdesc format{}; format.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; format.index = fi;
            if (xioctl(fd_, VIDIOC_ENUM_FMT, &format) < 0) {
                if (errno == EINVAL) break;
                system_fault(errno);
            }
            if (fi == 64) throw Fault("ResourceLimit");
            if (format.pixelformat != V4L2_PIX_FMT_YUYV && format.pixelformat != V4L2_PIX_FMT_MJPEG) continue;
            for (std::uint32_t si = 0; si <= 64; ++si) {
                v4l2_frmsizeenum size{}; size.index = si; size.pixel_format = format.pixelformat;
                if (xioctl(fd_, VIDIOC_ENUM_FRAMESIZES, &size) < 0) {
                    if (errno == EINVAL) break;
                    system_fault(errno);
                }
                if (si == 64) throw Fault("ResourceLimit");
                if (size.type != V4L2_FRMSIZE_TYPE_DISCRETE) break;
                if (!size.discrete.width || !size.discrete.height || size.discrete.width > 4096 ||
                    size.discrete.height > 4096) continue;
                v4l2_format trial{}; trial.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
                trial.fmt.pix.width = size.discrete.width; trial.fmt.pix.height = size.discrete.height;
                trial.fmt.pix.pixelformat = format.pixelformat; trial.fmt.pix.field = V4L2_FIELD_NONE;
                if (xioctl(fd_, VIDIOC_TRY_FMT, &trial) < 0) {
                    if (errno == EINVAL || errno == ENOTTY) continue;
                    system_fault(errno);
                }
                if (trial.fmt.pix.width != size.discrete.width || trial.fmt.pix.height != size.discrete.height ||
                    trial.fmt.pix.pixelformat != format.pixelformat || !supported(trial.fmt.pix)) continue;
                for (std::uint32_t ii = 0; ii <= 64; ++ii) {
                    v4l2_frmivalenum iv{}; iv.index = ii; iv.pixel_format = format.pixelformat;
                    iv.width = size.discrete.width; iv.height = size.discrete.height;
                    if (xioctl(fd_, VIDIOC_ENUM_FRAMEINTERVALS, &iv) < 0) {
                        if (errno == EINVAL) break;
                        system_fault(errno);
                    }
                    if (ii == 64) throw Fault("ResourceLimit");
                    if (iv.type != V4L2_FRMIVAL_TYPE_DISCRETE) break;
                    if (!iv.discrete.numerator || !iv.discrete.denominator) throw Fault("SourceFailure");
                    add(trial.fmt.pix, iv.discrete, "VIDIOC_ENUM_FMT/ENUM_FRAMESIZES/ENUM_FRAMEINTERVALS+TRY_FMT");
                }
            }
        }
        std::sort(e.modes.begin(), e.modes.end(), [](const Mode& a, const Mode& b) { return a.tuple() < b.tuple(); });
        return e;
    }
    void open(const std::string& digest, const std::string& id, const std::string& output, const Limits& limits) override {
        limits.validate();
        if (!acquisition_) throw Fault("PolicyDenied");
        if (output != "JPEG" && output != "I420") throw Fault("UnsupportedFormat");
        const auto evidence = describe();
        if (!is_sha256(digest) || digest != evidence.digest()) throw Fault("IdentityChanged");
        const auto found = std::find_if(evidence.modes.begin(), evidence.modes.end(), [&](const Mode& m) { return m.id() == id; });
        if (found == evidence.modes.end()) throw Fault("InvalidSelection");
        selected_ = *found; output_ = output; limits_ = limits;
        if (selected_.width > limits.width || selected_.height > limits.height || selected_.payload > limits.native_bytes)
            throw Fault("ResourceLimit");
        // Validate RGB scratch extent before any configuration or driver allocation.
        mul_size(mul_size(selected_.width, selected_.height, limits.native_bytes), 3, limits.native_bytes);
        v4l2_format requested{}; requested.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; requested.fmt.pix = formats_.at(id);
        checked_ioctl(fd_, VIDIOC_S_FMT, &requested);
        v4l2_streamparm rate{}; rate.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        rate.parm.capture.timeperframe.numerator = selected_.fps_d;
        rate.parm.capture.timeperframe.denominator = selected_.fps_n;
        checked_ioctl(fd_, VIDIOC_S_PARM, &rate);
        v4l2_format actual{}; actual.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        checked_ioctl(fd_, VIDIOC_G_FMT, &actual);
        if (make_mode(actual.fmt.pix, interval(), "").id() != id) throw Fault("UnsupportedFormat");
        v4l2_requestbuffers request{}; request.count = 4;
        request.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; request.memory = V4L2_MEMORY_MMAP;
        checked_ioctl(fd_, VIDIOC_REQBUFS, &request); buffers_ = true;
        if (request.count < 2 || request.count > mapped_.size()) throw Fault("ResourceLimit");
        count_ = request.count;
        for (std::uint32_t i = 0; i < count_; ++i) {
            v4l2_buffer b{}; b.type = request.type; b.memory = request.memory; b.index = i;
            checked_ioctl(fd_, VIDIOC_QUERYBUF, &b);
            if (b.index != i || b.type != request.type || b.memory != request.memory ||
                !b.length || b.length > limits.native_bytes || b.length < selected_.payload) throw Fault("ResourceLimit");
            static_assert(sizeof(off_t) >= 8, "Build with _FILE_OFFSET_BITS=64");
            mapped_[i].size = b.length;
            mapped_[i].address = mmap(nullptr, b.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd_, static_cast<off_t>(b.m.offset));
            if (mapped_[i].address == MAP_FAILED) system_fault(errno);
        }
        for (std::uint32_t i = 0; i < count_; ++i) queue(i);
        auto type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        // A failed STREAMON may have partially started the owned source.
        started_ = true;
        checked_ioctl(fd_, VIDIOC_STREAMON, &type);
    }
    Frame next(std::uint64_t deadline_ns) override {
        if (!started_) throw Fault("SourceUnavailable");
        const auto local_deadline = std::min<std::uint64_t>(deadline_ns, monotonic_ns() + limits_.read_ms*1000000ULL);
        v4l2_buffer b{};
        while (true) {
            const auto now = monotonic_ns();
            if (now >= local_deadline) throw Fault("Timeout");
            const auto remaining = static_cast<int>((local_deadline-now+999999)/1000000);
            pollfd p{fd_, POLLIN | POLLPRI, 0};
            const auto result = poll(&p, 1, remaining);
            if (result < 0) { if (errno == EINTR) continue; system_fault(errno); }
            if (!result) throw Fault("Timeout");
            if (p.revents & (POLLHUP | POLLNVAL)) throw Fault("DeviceLost");
            if (p.revents & POLLERR) throw Fault("SourceFailure");
            b = {}; b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; b.memory = V4L2_MEMORY_MMAP;
            if (xioctl(fd_, VIDIOC_DQBUF, &b) == 0) break;
            if (errno != EAGAIN) system_fault(errno);
        }
        Frame frame; frame.host_ns = monotonic_ns(); frame.width = selected_.width; frame.height = selected_.height;
        if (b.index >= count_ || !mapped_[b.index].queued) throw Fault("SourceFailure");
        mapped_[b.index].queued = false;
        // Everything that can fail after dequeue is inside this ownership scope.
        bool requeue_attempted = false;
        try {
            if (b.type != V4L2_BUF_TYPE_VIDEO_CAPTURE || b.memory != V4L2_MEMORY_MMAP ||
                (b.flags & V4L2_BUF_FLAG_ERROR) || !b.bytesused ||
                b.bytesused > mapped_[b.index].size || b.bytesused > limits_.native_bytes ||
                b.bytesused > selected_.payload) throw Fault("SourceFailure");
            std::vector<std::uint8_t> owned;
            const auto* data = static_cast<const std::uint8_t*>(mapped_[b.index].address);
            if (selected_.pixel == V4L2_PIX_FMT_YUYV)
                owned = copy_rows(data, b.bytesused, Layout{selected_.width, selected_.height, selected_.stride,
                                  RawFormat::yuyv601}, limits_);
            else owned.assign(data, data + b.bytesused);
            requeue_attempted = true; queue(b.index);
            const auto rgb = selected_.pixel == V4L2_PIX_FMT_YUYV ?
                to_rgb(owned, selected_.width, selected_.height, RawFormat::yuyv601, limits_) :
                decode_jpeg(owned, selected_.width, selected_.height, limits_);
            frame.data = encode_output(rgb, selected_, output_, limits_);
            std::string stamp = "null";
            if (b.timestamp.tv_sec < 0 || b.timestamp.tv_usec < 0 || b.timestamp.tv_usec >= 1000000 ||
                static_cast<std::uint64_t>(b.timestamp.tv_sec) > (UINT64_MAX-999999000ULL)/1000000000ULL)
                throw Fault("SourceFailure");
            stamp = quote(std::to_string(static_cast<std::uint64_t>(b.timestamp.tv_sec)*1000000000ULL +
                                         static_cast<std::uint64_t>(b.timestamp.tv_usec)*1000ULL));
            const auto clock = b.flags & V4L2_BUF_FLAG_TIMESTAMP_MASK;
            frame.timing_fields = ",\"nativeTimestampNs\":" + stamp + ",\"nativeTimestampClock\":" +
                quote(clock == V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC ? "monotonic" :
                      clock == V4L2_BUF_FLAG_TIMESTAMP_COPY ? "copy" : "unknown") +
                ",\"nativeTimestampPoint\":" + quote((b.flags & V4L2_BUF_FLAG_TSTAMP_SRC_MASK) ==
                    V4L2_BUF_FLAG_TSTAMP_SRC_SOE ? "start-of-exposure" : "end-of-frame") +
                ",\"nativeSequence\":" + quote(std::to_string(b.sequence)) +
                ",\"sdkTimeProvenance\":\"VIDIOC_DQBUF timeval and driver flags; not verified exposure or UTC\"";
            if (monotonic_ns() >= local_deadline) throw Fault("Timeout");
            return frame;
        } catch (...) {
            if (!requeue_attempted) {
                try { requeue_attempted = true; queue(b.index); }
                catch (const Fault& f) { receipt_.add(static_cast<int>(f.native_code)); }
            }
            throw;
        }
    }
    CloseResult close() noexcept override {
        if (closed_) return receipt_;
        closed_ = true; receipt_.started = started_;
        if (fd_ >= 0) {
            if (started_) {
                auto type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
                if (xioctl(fd_, VIDIOC_STREAMOFF, &type) < 0) {
                    receipt_.stop_failed = true; receipt_.add(errno, false);
                }
            }
            for (auto& m : mapped_) if (m.address != MAP_FAILED) {
                if (munmap(m.address, m.size) != 0) receipt_.add(errno);
                m.address = MAP_FAILED;
            }
            if (buffers_) {
                v4l2_requestbuffers r{}; r.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; r.memory = V4L2_MEMORY_MMAP;
                if (xioctl(fd_, VIDIOC_REQBUFS, &r) < 0) receipt_.add(errno);
            }
            // Do not retry close(EINTR): Linux may already have released the fd.
            if (::close(fd_) != 0) receipt_.add(errno);
            fd_ = -1;
        }
        return receipt_;
    }
    const Mode& mode() const override { return selected_; }
    const std::string& output() const override { return output_; }
};
}
std::unique_ptr<Source> make_v4l2() { return std::make_unique<V4l2>(); }
} // namespace capture
