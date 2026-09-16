#include "bounds.hpp"

#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace capture;
namespace {
unsigned checks = 0;
void expect(bool condition) {
    ++checks;
    if (!condition) throw std::runtime_error("portable camera assertion failed");
}
void rejects(const std::function<void()>& call, const std::string& code = "") {
    bool failed = false;
    try { call(); } catch (const Fault& f) { failed = true; expect(code.empty() || code == f.code); }
    expect(failed);
}
}
int main() {
    try {
        Limits limits; limits.validate();
        expect(number("4294967295", UINT32_MAX) == UINT32_MAX);
        expect(number("0", 10, true) == 0);
        for (const auto* s : {"-1", "+1", "01", "1 ", "", "4294967296", "0", "1.0", "1e1"})
            rejects([&] { number(s, UINT32_MAX); }, "ResourceLimit");
        expect(mul_size(12, 4, 48) == 48);
        expect(add_size(12, 4, 16) == 16);
        rejects([] { mul_size(SIZE_MAX, 2, SIZE_MAX); });
        rejects([] { add_size(SIZE_MAX, 1, SIZE_MAX); });
        expect(is_sha256(std::string(64, 'a')));
        expect(!is_sha256(std::string(64, 'A')));
        expect(unhex("46616b655f31") == "Fake_1");
        for (const auto* s : {"00", "0a", "7f", "zz", "1", "c080", "eda080", "f4908080", "e282"})
            rejects([&] { unhex(s); });
        expect(valid_utf8("\xc3\xa9"));
        expect(quote("\"\\\n") == "\"\\\"\\\\\\u000a\"");
        expect(fields("open\tone\ttwo").size() == 3);
        expect(fields("next\t").back().empty());
        rejects([] { fields("next\r"); }, "ProtocolError");
        rejects([] { fields(std::string(32769, 'x')); }, "ResourceLimit");
        const auto object = string_object("{ \"cameraAddress\":\"192.0.2.1\", \"width\":\"512\" }");
        expect(object.at("width") == "512");
        expect(string_object("{\"a\":\"x\\\\y\"}").at("a") == "x\\y");
        for (const auto* s : {"{\"a\":1}", "{\"a\":true}", "{\"a\":\"1\",\"a\":\"2\"}",
                              "{\"a\":\"1\",}", "{\"a\":\"\\u0000\"}", "{}x", "[]", "{\"a\":\"x\""})
            rejects([&] { string_object(s); });
        std::vector<std::uint8_t> native{1,2,3,4,5,6,99,99,7,8,9,10,11,12};
        const Layout rgb_layout{2,2,8,RawFormat::rgb8};
        expect(layout_extent(rgb_layout, limits) == 14);
        auto owned = copy_rows(native.data(), native.size(), rgb_layout, limits);
        expect(owned == std::vector<std::uint8_t>({1,2,3,4,5,6,7,8,9,10,11,12}));
        native.assign(native.size(), 0);
        expect(owned[0] == 1 && owned.back() == 12); // Models native requeue/reuse after copy.
        rejects([&] { copy_rows(native.data(), 13, rgb_layout, limits); }, "SourceFailure");
        rejects([&] { copy_rows(nullptr, 14, rgb_layout, limits); });
        rejects([&] { copy_rows(native.data(), native.size(), Layout{2,2,5,RawFormat::rgb8}, limits); });
        rejects([&] { layout_extent(Layout{2,2,SIZE_MAX,RawFormat::rgb8}, limits); });
        rejects([&] { layout_extent(Layout{0,2,8,RawFormat::rgb8}, limits); });
        rejects([&] { layout_extent(Layout{4097,2,8,RawFormat::rgb8}, limits); });
        rejects([&] { layout_extent(Layout{3,2,8,RawFormat::yuyv601}, limits); }, "UnsupportedFormat");
        rejects([&] { row_bytes(Layout{3,2,8,static_cast<RawFormat>(99)}, limits); }, "UnsupportedFormat");
        const auto mono = to_rgb({0,127,255}, 3,1,RawFormat::mono8,limits);
        expect(mono == std::vector<std::uint8_t>({0,0,0,127,127,127,255,255,255}));
        const auto bw = to_rgb({16,128,235,128},2,1,RawFormat::yuyv601,limits);
        expect(bw == std::vector<std::uint8_t>({0,0,0,255,255,255}));
        rejects([&] { to_rgb({1,2},2,1,RawFormat::rgb8,limits); });
        auto i420 = to_i420(mono,3,1,limits);
        expect(i420.size() == 7 && i420[0] == 16 && i420[2] == 235);
        expect(i420[3] == 128 && i420[4] == 128 && i420[5] == 128 && i420[6] == 128);
        const auto singleton = to_i420({255,0,0},1,1,limits);
        expect(singleton.size() == 3 && singleton[0] == 82 && singleton[1] == 90 && singleton[2] == 240);
        limits.frame_bytes = 2;
        rejects([&] { to_i420({255,0,0},1,1,limits); }, "ResourceLimit");
        limits.native_bytes = 1;
        rejects([&] { to_rgb({0,1},2,1,RawFormat::mono8,limits); }, "ResourceLimit");
        std::cout << checks << " portable assertions passed; no Linux SDK or hardware exercised\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
