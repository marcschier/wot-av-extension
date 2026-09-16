#include "../native/common/capture.hpp"

#include <arv.h>
#if CAPTURE_ARAVIS_USB && ARAVIS_HAS_USB
#include <libusb.h>
#endif
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <set>

#if ARAVIS_MAJOR_VERSION != 0 || ARAVIS_MINOR_VERSION != 8 || ARAVIS_MICRO_VERSION != 36
#error "This sample requires the verified Aravis 0.8.36 API."
#endif

namespace capture {
namespace {
void check(GError*& error) {
    if (!error) return;
    const auto value = error->code;
    const bool device = error->domain == ARV_DEVICE_ERROR;
    const char* code = "SourceFailure";
    if (device) {
        switch (value) {
        case ARV_DEVICE_ERROR_NOT_CONNECTED: code = "DeviceLost"; break;
        case ARV_DEVICE_ERROR_NOT_FOUND: code = "SourceUnavailable"; break;
        case ARV_DEVICE_ERROR_TIMEOUT: code = "Timeout"; break;
        case ARV_DEVICE_ERROR_NOT_CONTROLLER:
        case ARV_DEVICE_ERROR_PROTOCOL_ERROR_BUSY: code = "Busy"; break;
        case ARV_DEVICE_ERROR_PROTOCOL_ERROR_ACCESS_DENIED: code = "PermissionDenied"; break;
        case ARV_DEVICE_ERROR_INVALID_PARAMETER: code = "InvalidSelection"; break;
        default: break;
        }
    } else if (g_error_matches(error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED)) code = "PermissionDenied";
    else if (g_error_matches(error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT)) code = "Timeout";
    g_clear_error(&error);
    throw Fault(code, "Aravis", value);
}
std::string text(const char* p) {
    if (!p) throw Fault("SourceFailure");
    const auto size = strnlen(p, 1025);
    if (!size || size > 1024) throw Fault("SourceFailure");
    std::string out(p, size);
    if (!valid_utf8(out)) throw Fault("SourceFailure");
    for (unsigned char c : out) if (c < 32 || c == 127) throw Fault("SourceFailure");
    return out;
}
struct Inet {
    GInetAddress* value = nullptr;
    explicit Inet(const std::string& literal) {
        value = g_inet_address_new_from_string(literal.c_str());
        if (!value || g_inet_address_get_family(value) != G_SOCKET_FAMILY_IPV4 ||
            g_inet_address_get_is_any(value) || g_inet_address_get_is_multicast(value) ||
            g_inet_address_get_is_loopback(value)) {
            if (value) g_object_unref(value);
            value = nullptr;
            throw Fault("InvalidSelection");
        }
        const auto* bytes = g_inet_address_to_bytes(value);
        if (bytes[0] == 0 || bytes[0] >= 224 || bytes[3] == 255) {
            g_object_unref(value); value = nullptr; throw Fault("InvalidSelection");
        }
        gchar* canonical = g_inet_address_to_string(value);
        const bool exact = canonical && literal == canonical;
        g_free(canonical);
        if (!exact) { g_object_unref(value); value = nullptr; throw Fault("InvalidSelection"); }
    }
    ~Inet() { if (value) g_object_unref(value); }
};
struct Popped {
    ArvStream* stream;
    ArvBuffer* buffer;
    ~Popped() { if (buffer) arv_stream_push_buffer(stream, buffer); }
};
class Aravis final : public Source {
    std::string backend_, identity_, scope_, output_;
    std::map<std::string, std::string> selection_;
    ArvDevice* device_ = nullptr;
    ArvCamera* camera_ = nullptr;
    ArvStream* stream_ = nullptr;
    bool acquisition_ = false, started_ = false, closed_ = false, construction_attempted_ = false;
    bool control_owned_ = false;
    gint stream_channel_ = -1;
    Limits limits_;
    Mode selected_;
    CloseResult receipt_;
    std::string identity() {
        GError* error = nullptr;
        const auto* v = arv_camera_get_vendor_name(camera_, &error); check(error); const auto vendor = text(v);
        const auto* m = arv_camera_get_model_name(camera_, &error); check(error); const auto model = text(m);
        const auto* s = arv_camera_get_device_serial_number(camera_, &error); check(error); const auto serial = text(s);
        if (vendor != selection_.at("vendor") || model != selection_.at("model") || serial != selection_.at("serial"))
            throw Fault("IdentityChanged");
        const auto endpoint = backend_ == "aravis-gige" ?
            selection_.at("localAddress") + "\n" + selection_.at("cameraAddress") : "";
        return sha256("capture-v1:" + backend_ + "\n" + endpoint + "\n" + vendor + "\n" + model + "\n" + serial + "\n");
    }
    Mode current() {
        GError* error = nullptr;
        gint x = 0, y = 0, w = 0, h = 0;
        arv_camera_get_region(camera_, &x, &y, &w, &h, &error); check(error);
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || w > 4096 || h > 4096) throw Fault("ResourceLimit");
        const auto pixel = arv_camera_get_pixel_format(camera_, &error); check(error);
        const auto payload = arv_camera_get_payload(camera_, &error); check(error);
        const auto wanted = selection_.at("pixelFormat") == "Mono8" ? ARV_PIXEL_FORMAT_MONO_8 : ARV_PIXEL_FORMAT_RGB_8_PACKED;
        if (pixel != wanted) throw Fault("UnsupportedFormat");
        if (static_cast<std::uint32_t>(w) != number(selection_.at("width"), 4096) ||
            static_cast<std::uint32_t>(h) != number(selection_.at("height"), 4096) ||
            static_cast<std::uint32_t>(x) != number(selection_.at("x"), 4096, true) ||
            static_cast<std::uint32_t>(y) != number(selection_.at("y"), 4096, true)) throw Fault("IdentityChanged");
        Mode m;
        m.prefix = "arv"; m.subtype = selection_.at("pixelFormat");
        m.width = static_cast<std::uint32_t>(w); m.height = static_cast<std::uint32_t>(h);
        m.x = static_cast<std::uint32_t>(x); m.y = static_cast<std::uint32_t>(y);
        m.pixel = pixel; m.stride = m.width*(pixel == ARV_PIXEL_FORMAT_MONO_8 ? 1U : 3U); m.payload = payload;
        if (!payload || payload > 33554432 || mul_size(m.stride, m.height, 33554432) > payload)
            throw Fault("ResourceLimit");
        m.locator = "arv_camera_get_region/get_pixel_format/get_payload";
        m.details = "pfnc=" + std::to_string(m.pixel) + ";x=" + std::to_string(m.x) +
            ";y=" + std::to_string(m.y) + ";payload=" + std::to_string(payload) + ";padding=buffer-evidenced";
        return m;
    }
public:
    explicit Aravis(std::string backend) : backend_(std::move(backend)) {}
    ~Aravis() override { close(); }
    void connect(const std::string& selector, const std::string& expected, Access access) override {
        // Even constructors can write control state. Reject before any SDK object.
        if (access == Access::native_read) throw Fault("PolicyDenied");
        if (device_ || camera_) throw Fault("Busy");
        selection_ = string_object(selector);
        std::set<std::string> keys{"vendor", "model", "serial", "pixelFormat", "width", "height", "x", "y"};
        if (backend_ == "aravis-gige") { keys.insert("localAddress"); keys.insert("cameraAddress"); scope_ = "aravis-gige-endpoint"; }
        else if (backend_ == "aravis-usb3") {
            keys.insert("permitLibraryEnumeration"); keys.insert("permitDriverDetach"); scope_ = "aravis-usb-identity";
        } else if (backend_ == "aravis-fake") scope_ = "synthetic-aravis";
        else throw Fault("InvalidSelection");
        if (keys.size() != selection_.size()) throw Fault("InvalidSelection");
        for (const auto& p : selection_) if (!keys.count(p.first) || p.second.empty()) throw Fault("InvalidSelection");
        if (selection_.at("pixelFormat") != "Mono8" && selection_.at("pixelFormat") != "RGB8")
            throw Fault("UnsupportedFormat");
        number(selection_.at("width"), 4096); number(selection_.at("height"), 4096);
        number(selection_.at("x"), 4096, true); number(selection_.at("y"), 4096, true);
        acquisition_ = access == Access::acquisition;
        GError* error = nullptr;
        if (backend_ == "aravis-gige") {
            Inet local(selection_.at("localAddress")), remote(selection_.at("cameraAddress"));
            if (selection_.at("localAddress") == selection_.at("cameraAddress")) throw Fault("InvalidSelection");
            construction_attempted_ = true;
            device_ = arv_gv_device_new(local.value, remote.value, &error); check(error);
            if (!device_) throw Fault("SourceUnavailable");
            if (!arv_gv_device_is_controller(ARV_GV_DEVICE(device_))) throw Fault("Busy");
            control_owned_ = true;
            arv_gv_device_set_packet_size_adjustment(ARV_GV_DEVICE(device_), ARV_GV_PACKET_SIZE_ADJUSTMENT_NEVER);
            arv_gv_device_set_stream_options(ARV_GV_DEVICE(device_), ARV_GV_STREAM_OPTION_PACKET_SOCKET_DISABLED);
            camera_ = arv_camera_new_with_device(device_, &error); check(error);
        } else if (backend_ == "aravis-usb3") {
            if (selection_.at("permitLibraryEnumeration") != "yes" || selection_.at("permitDriverDetach") != "yes")
                throw Fault("PolicyDenied");
#if CAPTURE_ARAVIS_USB && ARAVIS_HAS_USB
            if (!libusb_has_capability(LIBUSB_CAP_SUPPORTS_DETACH_KERNEL_DRIVER)) throw Fault("MissingDependency");
            construction_attempted_ = true;
            device_ = arv_uv_device_new(selection_.at("vendor").c_str(), selection_.at("model").c_str(),
                                        selection_.at("serial").c_str(), &error); check(error);
            if (!device_) throw Fault("SourceUnavailable");
            camera_ = arv_camera_new_with_device(device_, &error); check(error);
#else
            throw Fault("MissingDependency");
#endif
        } else {
            if (selection_.at("vendor") != "Aravis" || selection_.at("model") != "Fake" ||
                selection_.at("serial") != "1") throw Fault("InvalidSelection");
            arv_select_interface("Fake");
            construction_attempted_ = true;
            camera_ = arv_camera_new("Fake_1", &error); check(error);
            if (camera_) device_ = ARV_DEVICE(g_object_ref(arv_camera_get_device(camera_)));
        }
        if (!camera_) throw Fault("SourceUnavailable");
        identity_ = identity();
        if (access != Access::identify && (!is_sha256(expected) || expected != identity_)) throw Fault("IdentityChanged");
        current();
    }
    Evidence describe() override {
        if (!camera_ || started_) throw Fault("Busy");
        if (identity() != identity_) throw Fault("IdentityChanged");
        return Evidence{identity_, scope_, backend_ == "aravis-fake" ? "synthetic" : "authorized-session-probe", {current()}};
    }
    void open(const std::string& digest, const std::string& id, const std::string& output, const Limits& limits) override {
        if (!acquisition_) throw Fault("PolicyDenied");
        limits.validate();
        if (output != "JPEG" && output != "I420") throw Fault("UnsupportedFormat");
        const auto evidence = describe();
        if (!is_sha256(digest) || evidence.digest() != digest) throw Fault("IdentityChanged");
        if (evidence.modes[0].id() != id) throw Fault("InvalidSelection");
        selected_ = evidence.modes[0]; limits_ = limits; output_ = output;
        if (selected_.width > limits.width || selected_.height > limits.height || selected_.payload > limits.native_bytes)
            throw Fault("ResourceLimit");
        mul_size(mul_size(selected_.width, selected_.height, limits.native_bytes), 3, limits.native_bytes);
        GError* error = nullptr;
        if (backend_ == "aravis-gige") {
            stream_channel_ = arv_camera_gv_get_current_stream_channel(camera_, &error); check(error);
            if (stream_channel_ < 0 || stream_channel_ > 31) throw Fault("UnsupportedFormat");
        }
        stream_ = arv_camera_create_stream(camera_, nullptr, nullptr, &error); check(error);
        if (!stream_) throw Fault("SourceUnavailable");
        for (unsigned i = 0; i < 4; ++i) {
            ArvBuffer* buffer = arv_buffer_new_allocate(selected_.payload);
            if (!buffer) throw Fault("ResourceLimit");
            arv_stream_push_buffer(stream_, buffer);
        }
        if (identity() != identity_ || current().id() != id) throw Fault("IdentityChanged");
        started_ = true;
        arv_camera_start_acquisition(camera_, &error); check(error);
    }
    Frame next(std::uint64_t deadline_ns) override {
        if (!started_ || !stream_) throw Fault("SourceUnavailable");
        const auto now = monotonic_ns();
        const auto end = std::min<std::uint64_t>(deadline_ns, now + limits_.read_ms*1000000ULL);
        if (now >= end) throw Fault("Timeout");
        Frame frame; frame.width = selected_.width; frame.height = selected_.height;
        std::vector<std::uint8_t> owned;
        {
            Popped popped{stream_, arv_stream_timeout_pop_buffer(stream_, (end-now)/1000)};
            if (!popped.buffer) throw Fault("Timeout");
            frame.host_ns = monotonic_ns();
            ArvBuffer* b = popped.buffer;
            if (arv_buffer_get_status(b) != ARV_BUFFER_STATUS_SUCCESS) throw Fault("SourceFailure", "Aravis", arv_buffer_get_status(b));
            if (arv_buffer_get_payload_type(b) != ARV_BUFFER_PAYLOAD_TYPE_IMAGE ||
                arv_buffer_get_n_parts(b) != 1 || arv_buffer_has_chunks(b) || arv_buffer_has_gendc(b))
                throw Fault("UnsupportedFormat");
            gint x = 0, y = 0, w = 0, h = 0, xp = 0, yp = 0;
            arv_buffer_get_image_region(b, &x, &y, &w, &h);
            arv_buffer_get_image_padding(b, &xp, &yp);
            if (x < 0 || y < 0 || w <= 0 || h <= 0 || xp < 0 || yp < 0 ||
                static_cast<std::uint32_t>(x) != selected_.x || static_cast<std::uint32_t>(y) != selected_.y ||
                static_cast<std::uint32_t>(w) != selected_.width || static_cast<std::uint32_t>(h) != selected_.height ||
                arv_buffer_get_image_pixel_format(b) != selected_.pixel) throw Fault("SourceFailure");
            if (yp != 0) throw Fault("UnsupportedFormat");
            std::size_t size = 0, total = 0;
            const auto* image = static_cast<const std::uint8_t*>(arv_buffer_get_image_data(b, &size));
            const auto* base = static_cast<const std::uint8_t*>(arv_buffer_get_data(b, &total));
            const auto start = reinterpret_cast<std::uintptr_t>(base), address = reinterpret_cast<std::uintptr_t>(image);
            if (!image || !base || !size || total > selected_.payload || total > limits_.native_bytes ||
                address < start || address-start > total || size > total-(address-start)) throw Fault("SourceFailure");
            const auto stride = add_size(selected_.stride, static_cast<std::size_t>(xp), limits_.native_bytes);
            if (mul_size(stride, selected_.height, limits_.native_bytes) != size) throw Fault("SourceFailure");
            owned = copy_rows(image, size, Layout{selected_.width, selected_.height, stride,
                selected_.subtype == "Mono8" ? RawFormat::mono8 : RawFormat::rgb8}, limits_);
            frame.timing_fields = ",\"cameraTimestampNs\":" + quote(std::to_string(arv_buffer_get_timestamp(b))) +
                ",\"sdkSystemTimestampNs\":" + quote(std::to_string(arv_buffer_get_system_timestamp(b))) +
                ",\"nativeFrameId\":" + quote(std::to_string(arv_buffer_get_frame_id(b))) +
                ",\"sdkTimeProvenance\":\"ArvBuffer camera timestamp and SDK system timestamp; not verified exposure or UTC\"";
        } // SDK buffer requeued exactly once, only after the adapter-owned copy.
        const auto rgb = to_rgb(owned, selected_.width, selected_.height,
                                 selected_.subtype == "Mono8" ? RawFormat::mono8 : RawFormat::rgb8, limits_);
        frame.data = encode_output(rgb, selected_, output_, limits_);
        if (monotonic_ns() >= end) throw Fault("Timeout");
        return frame;
    }
    CloseResult close() noexcept override {
        if (closed_) return receipt_;
        closed_ = true; receipt_.started = started_;
        GError* error = nullptr;
        if (camera_ && started_) {
            arv_camera_stop_acquisition(camera_, &error);
            if (error) { receipt_.stop_failed = true; receipt_.add(error->code, false, "Aravis"); g_clear_error(&error); }
        }
        if (stream_ && device_ && backend_ == "aravis-gige" && control_owned_ && stream_channel_ >= 0) {
            // Same transport-only stream-channel stop as 0.8.36's finalizer,
            // but checked here because that finalizer merely logs errors.
            const auto ok = arv_device_write_register(device_, 0xd00ULL + 0x40ULL*static_cast<unsigned>(stream_channel_),
                                                       0, &error);
            if (!ok || error) receipt_.add(error ? error->code : 0, true, "Aravis");
            g_clear_error(&error);
        }
        // 0.8.36 finalizers stop/join the receive thread themselves; calling
        // arv_stream_stop_thread before unref would double-stop and log a critical.
        g_clear_object(&stream_);
        if (device_ && backend_ == "aravis-gige" && control_owned_) {
            const auto ok = arv_gv_device_leave_control(ARV_GV_DEVICE(device_), &error);
            if (!ok || error) receipt_.add(error ? error->code : 0, true, "Aravis");
            g_clear_error(&error);
        }
        if (construction_attempted_ && (backend_ == "aravis-usb3" || !device_ ||
            (backend_ == "aravis-gige" && !control_owned_)))
            receipt_.add(0, true, "Aravis");
        g_clear_object(&camera_); g_clear_object(&device_);
        if (backend_ == "aravis-fake" && construction_attempted_) arv_shutdown();
        return receipt_;
    }
    const Mode& mode() const override { return selected_; }
    const std::string& output() const override { return output_; }
};
}
std::unique_ptr<Source> make_aravis(const std::string& backend) { return std::make_unique<Aravis>(backend); }
} // namespace capture
