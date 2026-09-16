#include "capture.hpp"
#include <iostream>
#include <stdexcept>

int main() {
    try {
        capture::Limits limits;
        std::vector<std::uint8_t> rgb(17*19*3, 127);
        const auto jpeg = capture::encode_jpeg(rgb,17,19,limits);
        const auto decoded = capture::decode_jpeg(jpeg,17,19,limits);
        if (decoded.size() != rgb.size()) throw std::runtime_error("JPEG geometry mismatch");
        bool failed = false;
        auto truncated = jpeg; truncated.resize(truncated.size()-3);
        try { capture::decode_jpeg(truncated,17,19,limits); } catch (const capture::Fault&) { failed = true; }
        if (!failed) throw std::runtime_error("truncated JPEG accepted");
        failed = false;
        try { capture::decode_jpeg(jpeg,18,19,limits); } catch (const capture::Fault&) { failed = true; }
        if (!failed) throw std::runtime_error("wrong JPEG geometry accepted");
        failed = false; limits.frame_bytes = 16;
        try { capture::encode_jpeg(rgb,17,19,limits); } catch (const capture::Fault& f) { failed = f.code == "ResourceLimit"; }
        if (!failed) throw std::runtime_error("JPEG output cap not enforced");
        if (capture::sha256("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
            throw std::runtime_error("SHA256 mismatch");
        std::cout << "System libjpeg encode/decode/bounds and OpenSSL SHA256 passed; no camera used\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
