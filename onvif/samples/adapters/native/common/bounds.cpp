#include "bounds.hpp"

#include <algorithm>
#include <charconv>
#include <cstring>
#include <limits>

namespace capture {

void Limits::validate() const {
    if (!width || width > 4096 || !height || height > 4096 ||
        !native_bytes || native_bytes > 33554432 || !frame_bytes ||
        frame_bytes > 16777216 || !read_ms || read_ms > 2000) throw Fault("ResourceLimit");
}

std::size_t add_size(std::size_t a, std::size_t b, std::size_t bound) {
    if (a > bound || b > bound - a) throw Fault("ResourceLimit");
    return a + b;
}
std::size_t mul_size(std::size_t a, std::size_t b, std::size_t bound) {
    if (a && b > bound / a) throw Fault("ResourceLimit");
    return a * b;
}
std::uint32_t number(const std::string& text, std::uint32_t maximum, bool allow_zero) {
    std::uint32_t result = 0;
    const auto parsed = std::from_chars(text.data(), text.data() + text.size(), result);
    if (text.empty() || (text.size() > 1 && text[0] == '0') ||
        parsed.ec != std::errc{} || parsed.ptr != text.data() + text.size() ||
        (!allow_zero && !result) || result > maximum) throw Fault("ResourceLimit");
    return result;
}
bool is_sha256(const std::string& value) {
    return value.size() == 64 && std::all_of(value.begin(), value.end(), [](char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    });
}
bool valid_utf8(const std::string& value) {
    std::size_t i = 0;
    while (i < value.size()) {
        auto first = static_cast<unsigned char>(value[i++]);
        if (first < 0x80) continue;
        unsigned count = 0;
        std::uint32_t cp = 0, minimum = 0;
        if (first >= 0xc2 && first <= 0xdf) { count = 1; cp = first & 31; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { count = 2; cp = first & 15; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { count = 3; cp = first & 7; minimum = 0x10000; }
        else return false;
        if (value.size() - i < count) return false;
        while (count--) {
            const auto c = static_cast<unsigned char>(value[i++]);
            if ((c & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (c & 63);
        }
        if (cp < minimum || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    }
    return true;
}
static int hex_digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    throw Fault("InvalidSelection");
}
std::string unhex(const std::string& value) {
    if (value.empty() || value.size() > 16384 || value.size() % 2) throw Fault("InvalidSelection");
    std::string out;
    out.reserve(value.size() / 2);
    for (std::size_t i = 0; i < value.size(); i += 2) {
        const auto c = static_cast<char>((hex_digit(value[i]) << 4) | hex_digit(value[i + 1]));
        if (static_cast<unsigned char>(c) < 32 || c == 127) throw Fault("InvalidSelection");
        out.push_back(c);
    }
    if (!valid_utf8(out)) throw Fault("InvalidSelection");
    return out;
}
std::string quote(const std::string& value) {
    if (!valid_utf8(value)) throw Fault("ProtocolError");
    static constexpr char hex[] = "0123456789abcdef";
    std::string out = "\"";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
        else if (c < 32 || c == 127) {
            out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15];
        } else out += static_cast<char>(c);
    }
    return out + '"';
}
std::vector<std::string> fields(const std::string& value) {
    if (value.size() > 32768) throw Fault("ResourceLimit");
    for (unsigned char c : value)
        if ((c < 32 && c != '\t') || c > 126) throw Fault("ProtocolError");
    std::vector<std::string> result;
    std::size_t at = 0;
    do {
        const auto end = value.find('\t', at);
        result.push_back(value.substr(at, end == std::string::npos ? end : end - at));
        if (result.size() > 14) throw Fault("ProtocolError");
        if (end == std::string::npos) break;
        at = end + 1;
    } while (true);
    return result;
}
std::map<std::string, std::string> string_object(const std::string& value) {
    if (value.empty() || value.size() > 8192 || !valid_utf8(value)) throw Fault("InvalidSelection");
    std::size_t at = 0;
    auto ws = [&]() { while (at < value.size() && value[at] == ' ') ++at; };
    auto take = [&](char c) {
        ws();
        if (at >= value.size() || value[at++] != c) throw Fault("InvalidSelection");
    };
    auto text = [&]() {
        take('"');
        std::string out;
        bool ended = false;
        while (at < value.size()) {
            unsigned char c = static_cast<unsigned char>(value[at++]);
            if (c == '"') { ended = true; break; }
            if (c < 32 || c == 127) throw Fault("InvalidSelection");
            if (c == '\\') {
                if (at == value.size()) throw Fault("InvalidSelection");
                c = static_cast<unsigned char>(value[at++]);
                // UTF-8 is accepted literally. Escaped controls/unicode are excluded
                // so selectors have only one unambiguous, printable representation.
                if (c != '\\' && c != '"' && c != '/') throw Fault("InvalidSelection");
            }
            out.push_back(static_cast<char>(c));
            if (out.size() > 1024) throw Fault("ResourceLimit");
        }
        if (!ended) throw Fault("InvalidSelection");
        return out;
    };
    std::map<std::string, std::string> result;
    take('{'); ws();
    if (at < value.size() && value[at] == '}') ++at;
    else while (true) {
        const auto key = text(); take(':'); const auto val = text();
        if (key.empty() || !result.emplace(key, val).second || result.size() > 16) throw Fault("InvalidSelection");
        ws();
        if (at < value.size() && value[at] == '}') { ++at; break; }
        take(',');
    }
    ws();
    if (at != value.size()) throw Fault("InvalidSelection");
    return result;
}

std::size_t row_bytes(const Layout& l, const Limits& limits) {
    limits.validate();
    if (l.format != RawFormat::mono8 && l.format != RawFormat::rgb8 && l.format != RawFormat::yuyv601)
        throw Fault("UnsupportedFormat");
    if (!l.width || !l.height || l.width > limits.width || l.height > limits.height) throw Fault("ResourceLimit");
    if (l.format == RawFormat::yuyv601 && l.width % 2) throw Fault("UnsupportedFormat");
    return mul_size(l.width, l.format == RawFormat::rgb8 ? 3 : l.format == RawFormat::mono8 ? 1 : 2,
                    limits.native_bytes);
}
std::size_t layout_extent(const Layout& l, const Limits& limits) {
    const auto row = row_bytes(l, limits);
    if (l.stride < row) throw Fault("SourceFailure");
    return add_size(mul_size(l.height - 1, l.stride, limits.native_bytes), row, limits.native_bytes);
}
std::vector<std::uint8_t> copy_rows(const std::uint8_t* data, std::size_t size,
                                  const Layout& l, const Limits& limits) {
    const auto row = row_bytes(l, limits);
    const auto extent = layout_extent(l, limits);
    if (!data || size < extent || size > limits.native_bytes) throw Fault("SourceFailure");
    std::vector<std::uint8_t> out(mul_size(row, l.height, limits.native_bytes));
    for (std::size_t y = 0; y < l.height; ++y)
        std::memcpy(out.data() + y * row, data + y * l.stride, row);
    return out;
}
static std::uint8_t clamp(int n) { return static_cast<std::uint8_t>(std::max(0, std::min(255, n))); }
std::vector<std::uint8_t> to_rgb(const std::vector<std::uint8_t>& packed,
                               std::uint32_t w, std::uint32_t h, RawFormat format, const Limits& limits) {
    Layout l{w, h, 0, format};
    const auto row = row_bytes(l, limits);
    if (packed.size() != mul_size(row, h, limits.native_bytes)) throw Fault("SourceFailure");
    if (format == RawFormat::rgb8) return packed;
    const auto n = mul_size(w, h, limits.native_bytes);
    std::vector<std::uint8_t> out(mul_size(n, 3, limits.native_bytes));
    if (format == RawFormat::mono8) {
        for (std::size_t i = 0; i < n; ++i) out[3*i] = out[3*i+1] = out[3*i+2] = packed[i];
    } else {
        for (std::size_t i = 0; i < n; i += 2) {
            const int u = packed[2*i+1] - 128, v = packed[2*i+3] - 128;
            for (std::size_t p = 0; p < 2; ++p) {
                const int y = std::max(0, static_cast<int>(packed[2*i+2*p]) - 16);
                out[3*(i+p)] = clamp((298*y + 409*v + 128) / 256);
                out[3*(i+p)+1] = clamp((298*y - 100*u - 208*v + 128) / 256);
                out[3*(i+p)+2] = clamp((298*y + 516*u + 128) / 256);
            }
        }
    }
    return out;
}
std::vector<std::uint8_t> to_i420(const std::vector<std::uint8_t>& rgb,
                                std::uint32_t w, std::uint32_t h, const Limits& limits) {
    const auto row = row_bytes(Layout{w, h, 0, RawFormat::rgb8}, limits);
    if (rgb.size() != mul_size(row, h, limits.native_bytes)) throw Fault("SourceFailure");
    const auto ysize = mul_size(w, h, limits.frame_bytes);
    const std::size_t cw = (w + 1) / 2, ch = (h + 1) / 2;
    const auto csize = mul_size(cw, ch, limits.frame_bytes);
    std::vector<std::uint8_t> out(add_size(ysize, mul_size(csize, 2, limits.frame_bytes), limits.frame_bytes));
    for (std::size_t y = 0; y < h; ++y) for (std::size_t x = 0; x < w; ++x) {
        const auto i = (y*w+x)*3;
        out[y*w+x] = clamp(((66*rgb[i] + 129*rgb[i+1] + 25*rgb[i+2] + 128) / 256) + 16);
    }
    for (std::size_t y = 0; y < h; y += 2) for (std::size_t x = 0; x < w; x += 2) {
        int r = 0, g = 0, b = 0, count = 0;
        for (std::size_t dy = 0; dy < 2 && y+dy < h; ++dy)
            for (std::size_t dx = 0; dx < 2 && x+dx < w; ++dx) {
                const auto i = ((y+dy)*w+x+dx)*3;
                r += rgb[i]; g += rgb[i+1]; b += rgb[i+2]; ++count;
            }
        r = (r+count/2)/count; g = (g+count/2)/count; b = (b+count/2)/count;
        const auto c = (y/2)*cw+x/2;
        out[ysize+c] = clamp(((-38*r - 74*g + 112*b + 128) >> 8) + 128);
        out[ysize+csize+c] = clamp(((112*r - 94*g - 18*b + 128) >> 8) + 128);
    }
    return out;
}

} // namespace capture
