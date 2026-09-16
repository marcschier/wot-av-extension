#include "../common/capture.hpp"

#include <csetjmp>
#include <cstdio>
#include <cstdlib>
#include <jpeglib.h>

namespace capture {
namespace {
struct Error {
    jpeg_error_mgr base{};
    std::jmp_buf jump;
    int code = 0;
    bool overflow = false;
};
extern "C" void jpeg_fail(j_common_ptr c) {
    auto* e = reinterpret_cast<Error*>(c->err);
    e->code = c->err->msg_code;
    std::longjmp(e->jump, 1);
}
extern "C" void jpeg_message(j_common_ptr c, int level) {
    if (level < 0) jpeg_fail(c); // libjpeg's truncated-image recovery is not success.
}
struct Decoder {
    jpeg_decompress_struct codec{};
    Error error{};
    bool created = false;
    ~Decoder() { if (created) jpeg_destroy_decompress(&codec); }
};
struct Destination {
    jpeg_destination_mgr base{};
    JOCTET* data = nullptr;
    std::size_t capacity = 0, used = 0;
};
extern "C" void destination_init(j_compress_ptr c) {
    auto* d = reinterpret_cast<Destination*>(c->dest);
    d->base.next_output_byte = d->data;
    d->base.free_in_buffer = d->capacity;
}
extern "C" boolean destination_full(j_compress_ptr c) {
    reinterpret_cast<Error*>(c->err)->overflow = true;
    jpeg_fail(reinterpret_cast<j_common_ptr>(c));
    return FALSE;
}
extern "C" void destination_end(j_compress_ptr c) {
    auto* d = reinterpret_cast<Destination*>(c->dest);
    d->used = d->capacity - d->base.free_in_buffer;
}
struct Encoder {
    jpeg_compress_struct codec{};
    Error error{};
    Destination destination{};
    bool created = false;
    ~Encoder() { if (created) jpeg_destroy_compress(&codec); }
};
}

std::vector<std::uint8_t> decode_jpeg(const std::vector<std::uint8_t>& data,
                                    std::uint32_t w, std::uint32_t h, const Limits& limits) {
    const auto row = row_bytes(Layout{w, h, 0, RawFormat::rgb8}, limits);
    if (data.size() < 4 || data.size() > limits.native_bytes ||
        data[0] != 0xff || data[1] != 0xd8 || data[data.size()-2] != 0xff || data.back() != 0xd9)
        throw Fault("SourceFailure", "libjpeg");
    auto state = std::make_unique<Decoder>();
    std::vector<std::uint8_t> rgb(mul_size(row, h, limits.native_bytes));
    state->codec.err = jpeg_std_error(&state->error.base);
    state->error.base.error_exit = jpeg_fail; state->error.base.emit_message = jpeg_message;
    if (setjmp(state->error.jump)) throw Fault("SourceFailure", "libjpeg", state->error.code);
    jpeg_create_decompress(&state->codec); state->created = true;
    jpeg_mem_src(&state->codec, data.data(), static_cast<unsigned long>(data.size()));
    if (jpeg_read_header(&state->codec, TRUE) != JPEG_HEADER_OK ||
        state->codec.image_width != w || state->codec.image_height != h ||
        state->codec.data_precision != 8 ||
        (state->codec.num_components != 1 && state->codec.num_components != 3))
        throw Fault("UnsupportedFormat", "libjpeg");
    state->codec.out_color_space = JCS_RGB;
    state->codec.mem->max_memory_to_use = limits.native_bytes;
    if (!jpeg_start_decompress(&state->codec) || state->codec.output_width != w ||
        state->codec.output_height != h || state->codec.output_components != 3) throw Fault("SourceFailure", "libjpeg");
    while (state->codec.output_scanline < h) {
        JSAMPROW line = rgb.data() + static_cast<std::size_t>(state->codec.output_scanline) * row;
        if (jpeg_read_scanlines(&state->codec, &line, 1) != 1) throw Fault("SourceFailure", "libjpeg");
    }
    if (!jpeg_finish_decompress(&state->codec)) throw Fault("SourceFailure", "libjpeg");
    return rgb;
}
std::vector<std::uint8_t> encode_jpeg(const std::vector<std::uint8_t>& rgb,
                                    std::uint32_t w, std::uint32_t h, const Limits& limits) {
    const auto row = row_bytes(Layout{w, h, 0, RawFormat::rgb8}, limits);
    if (rgb.size() != mul_size(row, h, limits.native_bytes)) throw Fault("SourceFailure");
    auto state = std::make_unique<Encoder>();
    std::vector<std::uint8_t> out(limits.frame_bytes);
    state->codec.err = jpeg_std_error(&state->error.base);
    state->error.base.error_exit = jpeg_fail; state->error.base.emit_message = jpeg_message;
    if (setjmp(state->error.jump))
        throw Fault(state->error.overflow ? "ResourceLimit" : "SourceFailure", "libjpeg", state->error.code);
    jpeg_create_compress(&state->codec); state->created = true;
    auto& dest = state->destination;
    dest.data = out.data(); dest.capacity = out.size();
    dest.base.init_destination = destination_init;
    dest.base.empty_output_buffer = destination_full; dest.base.term_destination = destination_end;
    state->codec.dest = &dest.base;
    state->codec.image_width = w; state->codec.image_height = h;
    state->codec.input_components = 3; state->codec.in_color_space = JCS_RGB;
    jpeg_set_defaults(&state->codec); jpeg_set_quality(&state->codec, 85, TRUE);
    state->codec.mem->max_memory_to_use = limits.native_bytes;
    jpeg_start_compress(&state->codec, TRUE);
    while (state->codec.next_scanline < h) {
        JSAMPROW line = const_cast<JSAMPROW>(rgb.data() + static_cast<std::size_t>(state->codec.next_scanline) * row);
        if (jpeg_write_scanlines(&state->codec, &line, 1) != 1) throw Fault("SourceFailure", "libjpeg");
    }
    jpeg_finish_compress(&state->codec);
    out.resize(dest.used);
    if (out.size() < 4 || out[0] != 0xff || out[1] != 0xd8 ||
        out[out.size()-2] != 0xff || out.back() != 0xd9) throw Fault("SourceFailure", "libjpeg");
    return out;
}
} // namespace capture
