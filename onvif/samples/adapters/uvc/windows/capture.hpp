#pragma once

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <cstdint>
#include <array>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace capture {

using Microsoft::WRL::ComPtr;

struct Fault : std::exception {
    std::string code;
    HRESULT native_code;
    explicit Fault(std::string value, HRESULT hr = S_OK);
    const char* what() const noexcept override;
};

void check(HRESULT hr);
std::string quote(const std::string& value);
std::string hex_code(HRESULT hr);
std::string sha256(const std::string& value);
std::wstring from_utf8(const std::string& value);
std::string to_utf8(const std::wstring& value);
std::string unhex(const std::string& value);
std::uint64_t monotonic_ns();

struct Limits {
    std::uint32_t width = 4096;
    std::uint32_t height = 4096;
    std::uint32_t native_bytes = 32 * 1024 * 1024;
    std::uint32_t frame_bytes = 16 * 1024 * 1024;
    std::uint32_t read_ms = 2000;
    void validate() const;
};

struct Mode {
    std::uint32_t index = 0;
    GUID subtype = MFVideoFormat_RGB32;
    std::uint32_t width = 0, height = 0;
    std::uint32_t numerator = 0, denominator = 1;
    std::uint32_t interlace = MFVideoInterlace_Progressive;
    LONG stride = 0;
    std::string id() const;
    std::string tuple() const;
    std::string json(bool synthetic = false) const;
};

struct Evidence {
    std::string identity;
    std::vector<Mode> modes;
    bool synthetic = false;
    std::string digest() const;
    std::string json() const;
};

struct Frame {
    std::vector<BYTE> data;
    std::uint32_t width = 0, height = 0;
    std::uint64_t host_ns = 0;
    LONGLONG sample_time = 0, sample_duration = 0;
    bool has_time = false, has_duration = false;
};

struct CloseResult {
    bool started = false;
    std::array<HRESULT, 4> errors{};
    std::size_t error_count = 0;
    void add(HRESULT hr) noexcept;
    std::string json() const;
};

class Runtime {
    bool com_ = false, mf_ = false;
public:
    Runtime();
    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;
    ~Runtime();
    HRESULT close() noexcept;
};

std::vector<BYTE> copy_bgr(IMFSample* sample, const Mode& mode, const Limits& limits);
std::vector<BYTE> encode_jpeg(const std::vector<BYTE>& bgr,
    std::uint32_t width, std::uint32_t height, std::uint32_t limit);
std::vector<BYTE> encode_i420(const std::vector<BYTE>& bgr,
    std::uint32_t width, std::uint32_t height, std::uint32_t limit);
void verify_jpeg(const std::vector<BYTE>& jpeg, std::uint32_t width, std::uint32_t height);
ComPtr<IMFSample> memory_sample(const Mode& mode, std::uint64_t sequence);
Evidence memory_evidence();

class Source {
    class Impl;
    std::unique_ptr<Impl> impl_;
public:
    Source(bool synthetic, const std::wstring& selector, const std::string& expected_identity);
    ~Source();
    Source(const Source&) = delete;
    Source& operator=(const Source&) = delete;
    Evidence describe();
    void open(const std::string& evidence_digest, const std::string& mode_id,
        const std::string& output, const Limits& limits);
    Frame next();
    CloseResult close() noexcept;
    const Mode& mode() const;
    const std::string& output() const;
};

// Only the separately authorized operator command calls this function.
std::string discover();

} // namespace capture
