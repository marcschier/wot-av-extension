#include "../common/capture.hpp"

#include <openssl/evp.h>
#include <cerrno>
#include <ctime>
#include <numeric>

namespace capture {

std::string sha256(const std::string& value) {
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    if (EVP_Digest(value.data(), value.size(), digest, &length, EVP_sha256(), nullptr) != 1 || length != 32)
        throw Fault("SourceFailure");
    static constexpr char alphabet[] = "0123456789abcdef";
    std::string out;
    for (unsigned i = 0; i < length; ++i) {
        out += alphabet[digest[i] >> 4]; out += alphabet[digest[i] & 15];
    }
    return out;
}
std::uint64_t monotonic_ns() {
    timespec ts{};
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) system_fault(errno);
    if (ts.tv_sec < 0 || ts.tv_nsec < 0 || ts.tv_nsec >= 1000000000) throw Fault("SourceFailure");
    if (static_cast<std::uint64_t>(ts.tv_sec) > (UINT64_MAX-static_cast<std::uint64_t>(ts.tv_nsec))/1000000000ULL)
        throw Fault("ResourceLimit");
    return static_cast<std::uint64_t>(ts.tv_sec) * 1000000000ULL + static_cast<std::uint64_t>(ts.tv_nsec);
}
[[noreturn]] void system_fault(int error) {
    const char* code = error == EACCES || error == EPERM ? "PermissionDenied" :
        error == EBUSY ? "Busy" : error == ENODEV || error == ENXIO ? "DeviceLost" :
        error == ENOENT ? "SourceUnavailable" : error == ETIMEDOUT ? "Timeout" :
        error == ENOMEM || error == ENOSPC ? "ResourceLimit" : "SourceFailure";
    throw Fault(code, "errno", error);
}
std::string fault_json(const Fault& fault, const std::string& operation) {
    return "{\"kind\":\"fault\",\"code\":" + quote(fault.code) + ",\"operation\":" + quote(operation) +
        ",\"retryable\":false,\"diagnosticId\":\"linux-native-worker\"" +
        (fault.domain.empty() ? "" : ",\"nativeDomain\":" + quote(fault.domain) +
         ",\"nativeCode\":" + quote(std::to_string(fault.native_code))) + "}";
}
std::string Mode::tuple() const {
    return prefix + "|" + subtype + "|" + std::to_string(width) + "|" + std::to_string(height) +
        "|" + std::to_string(fps_n) + "|" + std::to_string(fps_d) + "|" + std::to_string(stride) +
        "|" + std::to_string(payload) + "|" + std::to_string(pixel) + "|" +
        std::to_string(x) + "|" + std::to_string(y) + "|" + details;
}
std::string Mode::id() const { return prefix + "-" + sha256(tuple()).substr(0, 32); }
std::string Mode::json() const {
    return "{\"modeId\":" + quote(id()) + ",\"nativeMediaType\":\"video\",\"nativeSubtype\":" + quote(subtype) +
        ",\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) +
        ",\"cadence\":" + (fps_n && fps_d ? "{\"numerator\":" + std::to_string(fps_n) +
            ",\"denominator\":" + std::to_string(fps_d) + "}" : "null") +
        ",\"stride\":" + std::to_string(stride) + ",\"interlace\":\"progressive\",\"evidenceLocator\":" +
        quote(locator) + ",\"nativeDetails\":" + quote(details) + "}";
}
std::string Evidence::digest() const {
    std::string canonical = "capture-v1:linux:evidence\n" + scope + "\n" + identity + "\n";
    for (const auto& m : modes) canonical += m.tuple() + "\n";
    return sha256(canonical);
}
std::string Evidence::json() const {
    std::string result = "{\"kind\":\"evidence\",\"evidenceKind\":" + quote(kind) +
        ",\"identity\":{\"fingerprint\":" + quote(identity) + ",\"scope\":" + quote(scope) +
        ",\"serial\":null,\"transport\":\"unknown\"},\"digest\":" + quote(digest()) + ",\"modes\":[";
    for (std::size_t i = 0; i < modes.size(); ++i) result += (i ? "," : "") + modes[i].json();
    return result + "]}";
}
void CloseResult::add(int code, bool resource_error, const char* domain) noexcept {
    if (error_count < errors.size()) {
        domains[error_count] = domain; errors[error_count++] = code;
    }
    resources_unknown = resources_unknown || resource_error;
}
std::string CloseResult::json() const {
    std::string out = "{\"kind\":\"closed\",\"status\":" + quote(error_count ? "failed" : "closed") +
        ",\"acquisitionStop\":" + quote(!started ? "not-started" : stop_failed ? "failed" : "acknowledged") +
        ",\"resources\":" + quote(resources_unknown ? "unknown" : "released") + ",\"faults\":[";
    for (std::size_t i = 0; i < error_count; ++i)
        out += (i ? "," : "") + fault_json(Fault("CleanupFailed", domains[i], errors[i]), "close");
    return out + "]}";
}
std::vector<std::uint8_t> encode_output(const std::vector<std::uint8_t>& rgb,
                                      const Mode& mode, const std::string& output, const Limits& limits) {
    if (output == "JPEG") return encode_jpeg(rgb, mode.width, mode.height, limits);
    if (output == "I420") return to_i420(rgb, mode.width, mode.height, limits);
    throw Fault("UnsupportedFormat");
}

} // namespace capture
