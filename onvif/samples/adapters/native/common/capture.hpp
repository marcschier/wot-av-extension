#pragma once
#include "bounds.hpp"

#include <array>
#include <memory>

namespace capture {

std::string sha256(const std::string& value);
std::uint64_t monotonic_ns();
[[noreturn]] void system_fault(int error);
std::string fault_json(const Fault& fault, const std::string& operation);

struct Mode {
    std::string prefix, subtype, locator, details;
    std::uint32_t width = 0, height = 0, fps_n = 0, fps_d = 0;
    std::uint32_t stride = 0, payload = 0, pixel = 0, x = 0, y = 0;
    std::string tuple() const;
    std::string id() const;
    std::string json() const;
};
struct Evidence {
    std::string identity, scope, kind;
    std::vector<Mode> modes;
    std::string digest() const;
    std::string json() const;
};
struct Frame {
    std::vector<std::uint8_t> data;
    std::uint32_t width = 0, height = 0;
    std::uint64_t host_ns = 0;
    std::string timing_fields;
};
struct CloseResult {
    bool started = false, stop_failed = false, resources_unknown = false;
    std::array<int, 4> errors{};
    std::array<const char*, 4> domains{};
    std::size_t error_count = 0;
    void add(int code, bool resource_error = true, const char* domain = "errno") noexcept;
    std::string json() const;
};
enum class Access { native_read, control_probe, acquisition, identify };
class Source {
public:
    virtual ~Source() = default;
    virtual void connect(const std::string& selector, const std::string& expected, Access access) = 0;
    virtual Evidence describe() = 0;
    virtual void open(const std::string& digest, const std::string& mode,
                      const std::string& output, const Limits& limits) = 0;
    virtual Frame next(std::uint64_t deadline_ns) = 0;
    virtual CloseResult close() noexcept = 0;
    virtual const Mode& mode() const = 0;
    virtual const std::string& output() const = 0;
};
std::unique_ptr<Source> make_v4l2();
std::unique_ptr<Source> make_aravis(const std::string& backend);
std::vector<std::uint8_t> decode_jpeg(const std::vector<std::uint8_t>& data,
                                    std::uint32_t width, std::uint32_t height, const Limits& limits);
std::vector<std::uint8_t> encode_jpeg(const std::vector<std::uint8_t>& rgb,
                                    std::uint32_t width, std::uint32_t height, const Limits& limits);
std::vector<std::uint8_t> encode_output(const std::vector<std::uint8_t>& rgb,
                                      const Mode& mode, const std::string& output, const Limits& limits);

} // namespace capture
