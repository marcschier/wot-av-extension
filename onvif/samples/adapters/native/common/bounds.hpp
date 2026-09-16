#pragma once

#include <cstddef>
#include <cstdint>
#include <exception>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace capture {

struct Fault : std::exception {
    std::string code;
    std::string domain;
    std::int64_t native_code;
    explicit Fault(std::string value, std::string native_domain = "", std::int64_t native = 0)
        : code(std::move(value)), domain(std::move(native_domain)), native_code(native) {}
    const char* what() const noexcept override { return code.c_str(); }
};

struct Limits {
    std::uint32_t width = 4096, height = 4096;
    std::uint32_t native_bytes = 33554432, frame_bytes = 16777216, read_ms = 2000;
    void validate() const;
};

std::size_t add_size(std::size_t a, std::size_t b, std::size_t bound);
std::size_t mul_size(std::size_t a, std::size_t b, std::size_t bound);
std::uint32_t number(const std::string& value, std::uint32_t maximum, bool allow_zero = false);
bool is_sha256(const std::string& value);
bool valid_utf8(const std::string& value);
std::string unhex(const std::string& value);
std::string quote(const std::string& value);
std::vector<std::string> fields(const std::string& value);
// Private selectors deliberately accept only flat JSON objects with string values.
std::map<std::string, std::string> string_object(const std::string& value);

enum class RawFormat { mono8, rgb8, yuyv601 };
struct Layout {
    std::uint32_t width = 0, height = 0;
    std::size_t stride = 0;
    RawFormat format = RawFormat::rgb8;
};
std::size_t row_bytes(const Layout& layout, const Limits& limits);
std::size_t layout_extent(const Layout& layout, const Limits& limits);
std::vector<std::uint8_t> copy_rows(const std::uint8_t* data, std::size_t size,
                                  const Layout& layout, const Limits& limits);
std::vector<std::uint8_t> to_rgb(const std::vector<std::uint8_t>& packed,
                               std::uint32_t width, std::uint32_t height,
                               RawFormat format, const Limits& limits);
std::vector<std::uint8_t> to_i420(const std::vector<std::uint8_t>& rgb,
                                std::uint32_t width, std::uint32_t height,
                                const Limits& limits);

} // namespace capture
