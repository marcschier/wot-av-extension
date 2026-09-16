#include "capture.hpp"
#include <arv.h>
#include <iostream>
#include <stdexcept>
#include <type_traits>

static_assert(std::is_same_v<decltype(&arv_camera_get_region),
    void (*)(ArvCamera*, gint*, gint*, gint*, gint*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_get_payload), guint (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_get_pixel_format), ArvPixelFormat (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_get_frame_rate), double (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_get_exposure_time), double (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_start_acquisition), void (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_camera_stop_acquisition), void (*)(ArvCamera*, GError**)>);
static_assert(std::is_same_v<decltype(&arv_buffer_get_image_region),
    void (*)(ArvBuffer*, gint*, gint*, gint*, gint*)>);
static_assert(std::is_same_v<decltype(&arv_buffer_get_image_data), const void* (*)(ArvBuffer*, size_t*)>);
static_assert(std::is_same_v<decltype(&arv_buffer_get_timestamp), guint64 (*)(ArvBuffer*)>);
static_assert(std::is_same_v<decltype(&arv_buffer_get_system_timestamp), guint64 (*)(ArvBuffer*)>);
static_assert(std::is_same_v<decltype(&arv_buffer_get_frame_id), guint64 (*)(ArvBuffer*)>);

namespace {
void expect(bool ok) {
    if (!ok) throw std::runtime_error("Aravis software contract assertion failed");
}
const std::string selector = R"({"vendor":"Aravis","model":"Fake","serial":"1","pixelFormat":"Mono8","width":"512","height":"512","x":"0","y":"0"})";
}
int main() {
    try {
        // These calls only change the SDK interface allowlist; no device-list update.
        arv_disable_interface("GigEVision");
#if ARAVIS_HAS_USB
        arv_disable_interface("USB3Vision");
#endif
        arv_enable_interface("Fake");
        auto denied = capture::make_aravis("aravis-fake");
        bool rejected = false;
        try { denied->connect(selector, std::string(64, '0'), capture::Access::native_read); }
        catch (const capture::Fault& fault) { rejected = fault.code == "PolicyDenied"; }
        expect(rejected);
        expect(denied->close().error_count == 0);
        auto probe = capture::make_aravis("aravis-fake");
        probe->connect(selector, "", capture::Access::identify);
        const auto evidence = probe->describe();
        expect(evidence.kind == "synthetic" && evidence.scope == "synthetic-aravis");
        expect(evidence.modes.size() == 1 && capture::is_sha256(evidence.identity));
        const auto mode = evidence.modes.front();
        expect(mode.width == 512 && mode.height == 512 && mode.x == 0 && mode.y == 0);
        expect(mode.pixel == ARV_PIXEL_FORMAT_MONO_8 && mode.stride == 512 && mode.payload == 512*512);
        expect(mode.fps_n == 0 && mode.fps_d == 0 && mode.json().find("\"cadence\":null") != std::string::npos);
        auto changed = mode; ++changed.width;
        expect(changed.id() != mode.id());
        expect(probe->close().error_count == 0);
        auto acquisition = capture::make_aravis("aravis-fake");
        acquisition->connect(selector, evidence.identity, capture::Access::acquisition);
        acquisition->open(evidence.digest(), mode.id(), "I420", capture::Limits{});
        const auto first = acquisition->next(capture::monotonic_ns() + 2000000000ULL);
        const auto retained = first.data;
        const auto second = acquisition->next(capture::monotonic_ns() + 2000000000ULL);
        expect(first.data == retained && first.data.size() == 512*512*3/2);
        expect(second.data.size() == first.data.size() && second.host_ns >= first.host_ns);
        const auto closed = acquisition->close();
        expect(closed.started && !closed.stop_failed && !closed.resources_unknown && closed.error_count == 0);
        expect(acquisition->close().json() == closed.json());
        std::cout << "Pinned API types and actual SDK Fake source contract passed; no hardware qualified\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
