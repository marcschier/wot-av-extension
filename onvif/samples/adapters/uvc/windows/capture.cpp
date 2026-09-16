#include "capture.hpp"

#include <bcrypt.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devpkey.h>
#include <mferror.h>
#include <propvarutil.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <iomanip>
#include <limits>
#include <mutex>
#include <numeric>
#include <sstream>
#include <thread>

namespace capture {
namespace {

constexpr std::size_t max_modes = 256;
constexpr DWORD first_video = static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM);
constexpr DWORD all_streams = static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS);

std::string guid_text(REFGUID value) {
    wchar_t text[40]{};
    if (!StringFromGUID2(value, text, 40)) throw Fault("SourceFailure");
    return to_utf8(text);
}

std::uint64_t raw_size(const Mode& mode) {
    if (mode.stride == std::numeric_limits<LONG>::min()) throw Fault("UnsupportedFormat");
    const auto stride = static_cast<std::uint64_t>(mode.stride < 0 ? -mode.stride : mode.stride);
    return stride * mode.height + (mode.subtype == MFVideoFormat_NV12 ? stride * mode.height / 2 : 0);
}

void geometry(const Mode& mode, const Limits& limits) {
    if (!mode.width || !mode.height || mode.width > limits.width || mode.height > limits.height
        || raw_size(mode) > limits.native_bytes
        || static_cast<std::uint64_t>(mode.width) * mode.height * 3 > limits.native_bytes) {
        throw Fault("ResourceLimit");
    }
    if (mode.interlace != MFVideoInterlace_Progressive) throw Fault("UnsupportedFormat");
    const auto row_bytes = static_cast<std::uint64_t>(mode.width)
        * (mode.subtype == MFVideoFormat_RGB32 ? 4 : mode.subtype == MFVideoFormat_YUY2 ? 2 : 1);
    const auto stride = static_cast<std::uint64_t>(mode.stride < 0 ? -mode.stride : mode.stride);
    if (stride < row_bytes) throw Fault("UnsupportedFormat");
    if (mode.subtype == MFVideoFormat_NV12) {
        if (mode.width % 2 || mode.height % 2 || mode.stride <= 0) throw Fault("UnsupportedFormat");
    } else if (mode.subtype == MFVideoFormat_YUY2) {
        if (mode.width % 2) throw Fault("UnsupportedFormat");
    } else if (mode.subtype != MFVideoFormat_RGB32) {
        throw Fault("UnsupportedFormat");
    }
}

std::vector<BYTE> interface_property(const std::wstring& selector, const DEVPROPKEY& key) {
    ULONG bytes = 0;
    DEVPROPTYPE type = 0;
    CONFIGRET result = CM_Get_Device_Interface_PropertyW(selector.c_str(), &key, &type, nullptr, &bytes, 0);
    if (result != CR_BUFFER_SMALL || !bytes || bytes > 16384) throw Fault("IdentityChanged");
    std::vector<BYTE> value(bytes);
    result = CM_Get_Device_Interface_PropertyW(selector.c_str(), &key, &type, value.data(), &bytes, 0);
    if (result != CR_SUCCESS || type != DEVPROP_TYPE_STRING || bytes < sizeof(wchar_t)
        || bytes % sizeof(wchar_t) != 0) throw Fault("IdentityChanged");
    value.resize(bytes);
    return value;
}

std::string device_identity(const std::wstring& selector) {
    auto bytes = interface_property(selector, DEVPKEY_Device_InstanceId);
    std::wstring instance(bytes.size() / sizeof(wchar_t), L'\0');
    std::memcpy(instance.data(), bytes.data(), bytes.size());
    if (instance.back() != L'\0') throw Fault("IdentityChanged");
    DEVINST node = 0;
    if (CM_Locate_DevNodeW(&node, instance.data(), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS) {
        throw Fault("IdentityChanged");
    }
    GUID container{};
    ULONG size = sizeof(container);
    DEVPROPTYPE type = 0;
    if (CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_ContainerId, &type,
        reinterpret_cast<PBYTE>(&container), &size, 0) != CR_SUCCESS
        || type != DEVPROP_TYPE_GUID || size != sizeof(container)) {
        throw Fault("IdentityChanged");
    }
    instance.pop_back();
    return sha256(to_utf8(instance) + "\n" + guid_text(container));
}

Mode read_mode(IMFMediaType* type, std::uint32_t index) {
    Mode mode;
    mode.index = index;
    GUID major{};
    check(type->GetGUID(MF_MT_MAJOR_TYPE, &major));
    if (major != MFMediaType_Video) throw Fault("UnsupportedFormat");
    check(type->GetGUID(MF_MT_SUBTYPE, &mode.subtype));
    if (mode.subtype == MFVideoFormat_YUY2 || mode.subtype == MFVideoFormat_NV12) {
        UINT32 matrix = 0, range = 0;
        if (FAILED(type->GetUINT32(MF_MT_YUV_MATRIX, &matrix))
            || FAILED(type->GetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, &range))
            || matrix != MFVideoTransferMatrix_BT601 || range != MFNominalRange_16_235) {
            throw Fault("UnsupportedFormat");
        }
    }
    check(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &mode.width, &mode.height));
    HRESULT hr = MFGetAttributeRatio(type, MF_MT_FRAME_RATE, &mode.numerator, &mode.denominator);
    if (hr == MF_E_ATTRIBUTENOTFOUND) {
        mode.numerator = 0;
        mode.denominator = 1;
    } else {
        check(hr);
        if (!mode.numerator || !mode.denominator) throw Fault("UnsupportedFormat");
        const auto divisor = std::gcd(mode.numerator, mode.denominator);
        mode.numerator /= divisor;
        mode.denominator /= divisor;
    }
    check(type->GetUINT32(MF_MT_INTERLACE_MODE, &mode.interlace));
    UINT32 unsigned_stride = 0;
    hr = type->GetUINT32(MF_MT_DEFAULT_STRIDE, &unsigned_stride);
    if (hr == MF_E_ATTRIBUTENOTFOUND) {
        check(MFGetStrideForBitmapInfoHeader(mode.subtype.Data1, mode.width, &mode.stride));
    } else {
        check(hr);
        static_assert(sizeof(mode.stride) == sizeof(unsigned_stride));
        std::memcpy(&mode.stride, &unsigned_stride, sizeof(mode.stride));
    }
    geometry(mode, Limits{});
    return mode;
}

class BufferLock {
    ComPtr<IMFMediaBuffer> buffer_;
    ComPtr<IMF2DBuffer2> two_d_;
    bool locked_ = false;
public:
    BYTE* row = nullptr;
    BYTE* start = nullptr;
    DWORD length = 0;
    LONG stride = 0;
    BufferLock(IMFMediaBuffer* buffer, const Mode& mode, const Limits& limits) : buffer_(buffer) {
        DWORD current = 0;
        check(buffer_->GetCurrentLength(&current));
        if (!current || current > limits.native_bytes) throw Fault("ResourceLimit");
        const auto offset = mode.stride < 0
            ? static_cast<std::uint64_t>(-static_cast<std::int64_t>(mode.stride)) * (mode.height - 1) : 0;
        if (offset > current) throw Fault("UnsupportedFormat");
        HRESULT hr = buffer_.As(&two_d_);
        if (SUCCEEDED(hr)) {
            check(two_d_->Lock2DSize(MF2DBuffer_LockFlags_Read, &row, &stride, &start, &length));
            locked_ = true;
        } else if (hr == E_NOINTERFACE) {
            DWORD capacity = 0;
            check(buffer_->Lock(&start, &capacity, &length));
            locked_ = true;
            stride = mode.stride;
            row = start;
            if (stride < 0) row += static_cast<std::size_t>(offset);
        } else {
            check(hr);
        }
    }
    ~BufferLock() {
        if (locked_) {
            if (two_d_) two_d_->Unlock2D();
            else buffer_->Unlock();
        }
    }
    void unlock() {
        if (!locked_) return;
        const HRESULT hr = two_d_ ? two_d_->Unlock2D() : buffer_->Unlock();
        locked_ = false;
        check(hr);
    }
    const BYTE* line(std::uint32_t y, std::uint32_t bytes, std::uint64_t plane_offset = 0) const {
        const auto first = reinterpret_cast<std::uintptr_t>(start);
        const auto top = reinterpret_cast<std::uintptr_t>(row);
        if (top < first || top - first > length) throw Fault("UnsupportedFormat");
        const auto offset = static_cast<std::int64_t>(top - first)
            + static_cast<std::int64_t>(stride) * y + static_cast<std::int64_t>(plane_offset);
        if (offset < 0 || static_cast<std::uint64_t>(offset) + bytes > length) {
            throw Fault("UnsupportedFormat");
        }
        return start + static_cast<std::size_t>(offset);
    }
};

BYTE clamp(int value) { return static_cast<BYTE>(std::clamp(value, 0, 255)); }

void yuv(BYTE y, BYTE u, BYTE v, BYTE* bgr) {
    const int c = static_cast<int>(y) - 16;
    const int d = static_cast<int>(u) - 128;
    const int e = static_cast<int>(v) - 128;
    bgr[0] = clamp((298 * c + 516 * d + 128) >> 8);
    bgr[1] = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
    bgr[2] = clamp((298 * c + 409 * e + 128) >> 8);
}

class BoundedStream final : public IStream {
    std::atomic<ULONG> references_{1};
    std::size_t position_ = 0, limit_;
public:
    std::vector<BYTE> bytes;
    bool limit_reached = false;
    explicit BoundedStream(std::size_t limit) : limit_(limit) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER;
        *out = nullptr;
        if (iid != IID_IUnknown && iid != IID_ISequentialStream && iid != IID_IStream) return E_NOINTERFACE;
        *out = static_cast<IStream*>(this);
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG value = --references_;
        if (!value) delete this;
        return value;
    }
    HRESULT STDMETHODCALLTYPE Read(void* target, ULONG count, ULONG* read) override {
        if (!target && count) return STG_E_INVALIDPOINTER;
        const auto size = std::min<std::size_t>(count, position_ < bytes.size() ? bytes.size() - position_ : 0);
        if (size) std::memcpy(target, bytes.data() + position_, size);
        position_ += size;
        if (read) *read = static_cast<ULONG>(size);
        return size == count ? S_OK : S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE Write(const void* source, ULONG count, ULONG* written) override {
        if (written) *written = 0;
        if (!source && count) return STG_E_INVALIDPOINTER;
        if (count > limit_ - position_) { limit_reached = true; return STG_E_MEDIUMFULL; }
        try {
            if (position_ + count > bytes.size()) bytes.resize(position_ + count);
        } catch (const std::bad_alloc&) {
            return E_OUTOFMEMORY;
        }
        if (count) std::memcpy(bytes.data() + position_, source, count);
        position_ += count;
        if (written) *written = count;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Seek(LARGE_INTEGER move, DWORD origin, ULARGE_INTEGER* result) override {
        const auto base = origin == STREAM_SEEK_SET ? 0LL
            : origin == STREAM_SEEK_CUR ? static_cast<LONGLONG>(position_)
            : origin == STREAM_SEEK_END ? static_cast<LONGLONG>(bytes.size()) : -1LL;
        if (base >= 0 && move.QuadPart > static_cast<LONGLONG>(limit_) - base) {
            limit_reached = true;
            return STG_E_MEDIUMFULL;
        }
        if (base < 0 || move.QuadPart < -base) {
            return STG_E_INVALIDFUNCTION;
        }
        position_ = static_cast<std::size_t>(base + move.QuadPart);
        if (result) result->QuadPart = position_;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetSize(ULARGE_INTEGER size) override {
        if (size.QuadPart > limit_) { limit_reached = true; return STG_E_MEDIUMFULL; }
        try { bytes.resize(static_cast<std::size_t>(size.QuadPart)); }
        catch (const std::bad_alloc&) { return E_OUTOFMEMORY; }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE CopyTo(IStream*, ULARGE_INTEGER, ULARGE_INTEGER*, ULARGE_INTEGER*) override {
        return E_NOTIMPL;
    }
    HRESULT STDMETHODCALLTYPE Commit(DWORD) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE Revert() override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE LockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE UnlockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE Stat(STATSTG* stat, DWORD) override {
        if (!stat) return E_POINTER;
        *stat = {};
        stat->type = STGTY_STREAM;
        stat->cbSize.QuadPart = bytes.size();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Clone(IStream**) override { return E_NOTIMPL; }
};

class ReaderCallback final : public IMFSourceReaderCallback {
    std::atomic<ULONG> references_{1};
    std::mutex mutex_;
    ComPtr<IMFSample> sample_;
    HRESULT status_ = S_OK;
    DWORD flags_ = 0;
public:
    HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HANDLE flushed = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    ReaderCallback() {
        if (!ready || !flushed) {
            if (ready) CloseHandle(ready);
            if (flushed) CloseHandle(flushed);
            throw Fault("ResourceLimit");
        }
    }
    ~ReaderCallback() { CloseHandle(ready); CloseHandle(flushed); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER;
        *out = nullptr;
        if (iid != IID_IUnknown && iid != __uuidof(IMFSourceReaderCallback)) return E_NOINTERFACE;
        *out = static_cast<IMFSourceReaderCallback*>(this);
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG value = --references_;
        if (!value) delete this;
        return value;
    }
    HRESULT STDMETHODCALLTYPE OnReadSample(HRESULT hr, DWORD, DWORD flags, LONGLONG, IMFSample* sample) override {
        std::lock_guard<std::mutex> guard(mutex_);
        status_ = hr;
        flags_ = flags;
        sample_ = sample;
        return SetEvent(ready) ? S_OK : E_FAIL;
    }
    HRESULT STDMETHODCALLTYPE OnFlush(DWORD) override { return SetEvent(flushed) ? S_OK : E_FAIL; }
    HRESULT STDMETHODCALLTYPE OnEvent(DWORD, IMFMediaEvent* event) override {
        HRESULT status = S_OK;
        if (!event || FAILED(event->GetStatus(&status))) return E_FAIL;
        if (FAILED(status)) return OnReadSample(status, 0, MF_SOURCE_READERF_ERROR, 0, nullptr);
        return S_OK;
    }
    ComPtr<IMFSample> take(DWORD& flags) {
        std::lock_guard<std::mutex> guard(mutex_);
        check(status_);
        flags = flags_;
        ComPtr<IMFSample> sample;
        sample.Swap(sample_);
        return sample;
    }
};

} // namespace

Fault::Fault(std::string value, HRESULT hr) : code(std::move(value)), native_code(hr) {}
const char* Fault::what() const noexcept { return code.c_str(); }

void check(HRESULT hr) {
    if (SUCCEEDED(hr)) return;
    if (hr == E_ACCESSDENIED) throw Fault("PermissionDenied", hr);
    if (hr == MF_E_VIDEO_RECORDING_DEVICE_INVALIDATED || hr == MF_E_SHUTDOWN) throw Fault("DeviceLost", hr);
    if (hr == HRESULT_FROM_WIN32(ERROR_BUSY) || hr == MF_E_NOTACCEPTING) throw Fault("Busy", hr);
    if (hr == E_OUTOFMEMORY || hr == STG_E_MEDIUMFULL) throw Fault("ResourceLimit", hr);
    if (hr == MF_E_INVALIDMEDIATYPE || hr == WINCODEC_ERR_UNSUPPORTEDPIXELFORMAT) throw Fault("UnsupportedFormat", hr);
    throw Fault("SourceFailure", hr);
}

std::string quote(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c < 0x20) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<unsigned>(c);
        else out << c;
    }
    out << '"';
    return out.str();
}

std::string hex_code(HRESULT hr) {
    std::ostringstream out;
    out << "0x" << std::hex << std::setw(8) << std::setfill('0') << static_cast<ULONG>(hr);
    return out.str();
}

std::string sha256(const std::string& value) {
    BYTE result[32]{};
    if (value.size() > std::numeric_limits<ULONG>::max() || BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0,
        reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())), static_cast<ULONG>(value.size()),
        result, sizeof(result)) < 0) throw Fault("SourceFailure");
    std::ostringstream out;
    for (BYTE b : result) out << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned>(b);
    return out.str();
}

std::wstring from_utf8(const std::string& value) {
    if (value.empty() || value.size() > 8192 || value.find('\0') != std::string::npos) throw Fault("InvalidSelection");
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (!size) throw Fault("InvalidSelection");
    std::wstring result(size, L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        result.data(), size) != size) throw Fault("InvalidSelection");
    return result;
}

std::string to_utf8(const std::wstring& value) {
    if (value.size() > 16384) throw Fault("ResourceLimit");
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        nullptr, 0, nullptr, nullptr);
    if (!size) throw Fault("SourceFailure");
    std::string result(size, '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        result.data(), size, nullptr, nullptr) != size) throw Fault("SourceFailure");
    return result;
}

std::string unhex(const std::string& value) {
    if (value.empty() || value.size() > 16384 || value.size() % 2) throw Fault("InvalidSelection");
    auto nibble = [](char c) -> unsigned {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        throw Fault("InvalidSelection");
    };
    std::string result;
    result.reserve(value.size() / 2);
    for (std::size_t i = 0; i < value.size(); i += 2) {
        result.push_back(static_cast<char>(nibble(value[i]) * 16 + nibble(value[i + 1])));
    }
    return result;
}

std::uint64_t monotonic_ns() {
    const auto value = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    if (value < 0) throw Fault("SourceFailure");
    return static_cast<std::uint64_t>(value);
}

void Limits::validate() const {
    if (!width || width > 4096 || !height || height > 4096 || !native_bytes || native_bytes > 33554432
        || !frame_bytes || frame_bytes > 16777216 || !read_ms || read_ms > 2000) throw Fault("ResourceLimit");
}

std::string Mode::tuple() const {
    return guid_text(subtype) + ":" + std::to_string(width) + ":" + std::to_string(height)
        + ":" + std::to_string(numerator) + ":" + std::to_string(denominator)
        + ":" + std::to_string(interlace) + ":" + std::to_string(stride);
}
std::string Mode::id() const { return "mf-" + sha256(tuple()).substr(0, 32); }
std::string Mode::json(bool synthetic) const {
    const auto cadence = numerator ? "{\"numerator\":" + std::to_string(numerator)
        + ",\"denominator\":" + std::to_string(denominator) + "}" : "null";
    return "{\"modeId\":" + quote(id()) + ",\"nativeMediaType\":\"video\",\"nativeSubtype\":"
        + quote(guid_text(subtype)) + ",\"width\":" + std::to_string(width)
        + ",\"height\":" + std::to_string(height) + ",\"cadence\":" + cadence
        + ",\"stride\":" + std::to_string(stride) + ",\"interlace\":\"progressive\",\"evidenceLocator\":"
        + quote(synthetic ? "MFCreate2DMediaBuffer/software-mode"
            : "IMFSourceReader::GetNativeMediaType/" + std::to_string(index)) + "}";
}
std::string Evidence::digest() const {
    std::vector<std::string> tuples;
    for (const auto& mode : modes) tuples.push_back(mode.tuple());
    std::sort(tuples.begin(), tuples.end());
    tuples.erase(std::unique(tuples.begin(), tuples.end()), tuples.end());
    std::string value = identity;
    for (const auto& tuple : tuples) value += "\n" + tuple;
    return sha256(value);
}
std::string Evidence::json() const {
    std::string value = "{\"kind\":\"evidence\",\"identity\":{\"fingerprint\":" + quote(identity)
        + ",\"scope\":" + quote(synthetic ? "synthetic-memory" : "windows-instance-and-container")
        + ",\"serial\":null,\"transport\":\"unknown\"},\"evidenceKind\":"
        + quote(synthetic ? "synthetic" : "native-read-only") + ",\"digest\":" + quote(digest()) + ",\"modes\":[";
    for (std::size_t i = 0; i < modes.size(); ++i) value += (i ? "," : "") + modes[i].json(synthetic);
    return value + "]}";
}
void CloseResult::add(HRESULT hr) noexcept {
    if (error_count < errors.size()) errors[error_count++] = hr;
}
std::string CloseResult::json() const {
    std::string value = "{\"kind\":\"closed\",\"status\":" + quote(!error_count ? "closed" : "failed")
        + ",\"acquisitionStop\":" + quote(!started ? "not-started" : !error_count ? "acknowledged" : "failed")
        + ",\"resources\":" + quote(!error_count ? "released" : "unknown") + ",\"faults\":[";
    for (std::size_t i = 0; i < error_count; ++i) {
        value += (i ? "," : "") + std::string("{\"code\":\"CleanupFailed\",\"operation\":\"close\",")
            + "\"retryable\":false,\"diagnosticId\":\"native-cleanup\",\"nativeDomain\":\"HRESULT\",\"nativeCode\":"
            + quote(hex_code(errors[i])) + "}";
    }
    return value + "]}";
}

Runtime::Runtime() {
    check(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
    com_ = true;
    const HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
    if (FAILED(hr)) { CoUninitialize(); com_ = false; check(hr); }
    mf_ = true;
}
Runtime::~Runtime() { close(); }
HRESULT Runtime::close() noexcept {
    const HRESULT hr = mf_ ? MFShutdown() : S_OK;
    mf_ = false;
    if (com_) CoUninitialize();
    com_ = false;
    return hr;
}

std::vector<BYTE> copy_bgr(IMFSample* sample, const Mode& mode, const Limits& limits) {
    limits.validate();
    geometry(mode, limits);
    DWORD count = 0, bytes = 0;
    check(sample->GetBufferCount(&count));
    check(sample->GetTotalLength(&bytes));
    if (!count || bytes > limits.native_bytes) throw Fault("ResourceLimit");
    if (count != 1) throw Fault("UnsupportedFormat");
    ComPtr<IMFMediaBuffer> buffer;
    check(sample->GetBufferByIndex(0, &buffer));
    BufferLock locked(buffer.Get(), mode, limits);
    if (locked.length > limits.native_bytes) throw Fault("ResourceLimit");
    if (!locked.row || !locked.start || !locked.length) throw Fault("UnsupportedFormat");
    Mode observed = mode;
    observed.stride = locked.stride;
    geometry(observed, limits);
    std::vector<BYTE> out(static_cast<std::size_t>(mode.width) * mode.height * 3);
    for (std::uint32_t y = 0; y < mode.height; ++y) {
        BYTE* row = out.data() + static_cast<std::size_t>(y) * mode.width * 3;
        const BYTE* source = locked.line(y, mode.width
            * (mode.subtype == MFVideoFormat_RGB32 ? 4 : mode.subtype == MFVideoFormat_YUY2 ? 2 : 1));
        const BYTE* uv = mode.subtype == MFVideoFormat_NV12
            ? locked.line(y / 2, mode.width, static_cast<std::uint64_t>(locked.stride) * mode.height) : nullptr;
        for (std::uint32_t x = 0; x < mode.width; ++x) {
            if (mode.subtype == MFVideoFormat_RGB32) std::memcpy(row + x * 3, source + x * 4, 3);
            else if (mode.subtype == MFVideoFormat_YUY2) {
                const auto pair = x / 2 * 4;
                yuv(source[pair + (x % 2) * 2], source[pair + 1], source[pair + 3], row + x * 3);
            } else yuv(source[x], uv[x / 2 * 2], uv[x / 2 * 2 + 1], row + x * 3);
        }
    }
    locked.unlock();
    return out;
}

std::vector<BYTE> encode_jpeg(const std::vector<BYTE>& bgr, std::uint32_t width,
    std::uint32_t height, std::uint32_t limit) {
    if (!width || !height || width > 4096 || height > 4096
        || bgr.size() != static_cast<std::uint64_t>(width) * height * 3 || !limit || limit > 16777216) {
        throw Fault("ResourceLimit");
    }
    ComPtr<IWICImagingFactory> factory;
    check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
    ComPtr<BoundedStream> stream;
    stream.Attach(new BoundedStream(limit));
    const auto stream_check = [&](HRESULT hr) {
        if (stream->limit_reached) throw Fault("ResourceLimit", hr);
        check(hr);
    };
    ComPtr<IWICBitmapEncoder> encoder;
    check(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder));
    stream_check(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    check(encoder->CreateNewFrame(&frame, &options));
    PROPBAG2 option{};
    wchar_t quality_name[] = L"ImageQuality";
    option.pstrName = quality_name;
    VARIANT quality;
    VariantInit(&quality);
    quality.vt = VT_R4;
    quality.fltVal = 0.90f;
    check(options->Write(1, &option, &quality));
    check(frame->Initialize(options.Get()));
    check(frame->SetSize(width, height));
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    check(frame->SetPixelFormat(&format));
    if (format != GUID_WICPixelFormat24bppBGR) throw Fault("UnsupportedFormat");
    stream_check(frame->WritePixels(height, width * 3, static_cast<UINT>(bgr.size()), const_cast<BYTE*>(bgr.data())));
    stream_check(frame->Commit());
    stream_check(encoder->Commit());
    if (stream->bytes.size() < 4 || stream->bytes[0] != 0xff || stream->bytes[1] != 0xd8
        || stream->bytes[stream->bytes.size() - 2] != 0xff || stream->bytes.back() != 0xd9) {
        throw Fault("SourceFailure");
    }
    return std::move(stream->bytes);
}

void verify_jpeg(const std::vector<BYTE>& jpeg, std::uint32_t width, std::uint32_t height) {
    ComPtr<IWICImagingFactory> factory;
    check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
    ComPtr<IWICStream> stream;
    check(factory->CreateStream(&stream));
    check(stream->InitializeFromMemory(const_cast<BYTE*>(jpeg.data()), static_cast<DWORD>(jpeg.size())));
    ComPtr<IWICBitmapDecoder> decoder;
    check(factory->CreateDecoderFromStream(stream.Get(), nullptr, WICDecodeMetadataCacheOnLoad, &decoder));
    ComPtr<IWICBitmapFrameDecode> frame;
    check(decoder->GetFrame(0, &frame));
    UINT w = 0, h = 0;
    check(frame->GetSize(&w, &h));
    if (w != width || h != height || w > 4096 || h > 4096) throw Fault("SourceFailure");
    ComPtr<IWICFormatConverter> converter;
    check(factory->CreateFormatConverter(&converter));
    check(converter->Initialize(frame.Get(), GUID_WICPixelFormat24bppBGR,
        WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
    std::vector<BYTE> pixels(static_cast<std::size_t>(w) * h * 3);
    check(converter->CopyPixels(nullptr, w * 3, static_cast<UINT>(pixels.size()), pixels.data()));
}

std::vector<BYTE> encode_i420(const std::vector<BYTE>& bgr, std::uint32_t width,
    std::uint32_t height, std::uint32_t limit) {
    if (!width || !height || width > 4096 || height > 4096
        || bgr.size() != static_cast<std::uint64_t>(width) * height * 3) throw Fault("ResourceLimit");
    const std::size_t chroma_w = (width + 1) / 2, chroma_h = (height + 1) / 2;
    const std::size_t luma = static_cast<std::size_t>(width) * height;
    const std::size_t size = luma + 2 * chroma_w * chroma_h;
    if (size > limit) throw Fault("ResourceLimit");
    std::vector<BYTE> out(size);
    for (std::size_t i = 0; i < luma; ++i) {
        const BYTE* pixel = bgr.data() + i * 3;
        out[i] = clamp(((66 * pixel[2] + 129 * pixel[1] + 25 * pixel[0] + 128) >> 8) + 16);
    }
    for (std::size_t cy = 0; cy < chroma_h; ++cy) {
        for (std::size_t cx = 0; cx < chroma_w; ++cx) {
            int r = 0, g = 0, b = 0, count = 0;
            for (std::size_t y = cy * 2; y < std::min<std::size_t>(cy * 2 + 2, height); ++y) {
                for (std::size_t x = cx * 2; x < std::min<std::size_t>(cx * 2 + 2, width); ++x) {
                    const BYTE* pixel = bgr.data() + (y * width + x) * 3;
                    b += pixel[0]; g += pixel[1]; r += pixel[2]; ++count;
                }
            }
            r /= count; g /= count; b /= count;
            const std::size_t offset = cy * chroma_w + cx;
            out[luma + offset] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
            out[luma + chroma_w * chroma_h + offset] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
        }
    }
    return out;
}

Evidence memory_evidence() {
    Mode mode;
    mode.width = 17;
    mode.height = 13;
    mode.stride = -static_cast<LONG>(mode.width * 4);
    mode.numerator = 20;
    Evidence evidence;
    evidence.synthetic = true;
    evidence.identity = sha256("capture-v1:mf-memory:color-grid");
    evidence.modes.push_back(mode);
    return evidence;
}

ComPtr<IMFSample> memory_sample(const Mode& mode, std::uint64_t sequence) {
    ComPtr<IMFMediaBuffer> buffer;
    check(MFCreate2DMediaBuffer(mode.width, mode.height, MFVideoFormat_RGB32.Data1, TRUE, &buffer));
    ComPtr<IMF2DBuffer> two_d;
    check(buffer.As(&two_d));
    BYTE* data = nullptr;
    LONG stride = 0;
    check(two_d->Lock2D(&data, &stride));
    for (std::uint32_t y = 0; y < mode.height; ++y) {
        BYTE* row = data + static_cast<std::ptrdiff_t>(stride) * y;
        for (std::uint32_t x = 0; x < mode.width; ++x) {
            row[x * 4] = x < mode.width / 2 ? 20 : 230;
            row[x * 4 + 1] = y < mode.height / 2 ? 20 : 230;
            row[x * 4 + 2] = static_cast<BYTE>(180 + sequence % 40);
            row[x * 4 + 3] = 0;
        }
    }
    check(two_d->Unlock2D());
    DWORD contiguous_length = 0;
    check(two_d->GetContiguousLength(&contiguous_length));
    check(buffer->SetCurrentLength(contiguous_length));
    ComPtr<IMFSample> sample;
    check(MFCreateSample(&sample));
    check(sample->AddBuffer(buffer.Get()));
    check(sample->SetSampleTime(90071992547409LL + static_cast<LONGLONG>(sequence) * 500000));
    check(sample->SetSampleDuration(500000));
    return sample;
}

class Source::Impl {
public:
    bool synthetic = false, opened = false, closed = false, started = false;
    std::wstring selector;
    std::string identity, output;
    Limits limits;
    Mode selected;
    std::uint64_t sequence = 0;
    ComPtr<IMFMediaSource> source;
    ComPtr<IMFSourceReader> reader;
    ComPtr<ReaderCallback> callback;
    CloseResult result;
    ~Impl() {
        if (source) source->Shutdown();
    }
};

Source::Source(bool synthetic, const std::wstring& selector, const std::string& expected_identity)
    : impl_(std::make_unique<Impl>()) {
    impl_->synthetic = synthetic;
    impl_->selector = selector;
    if (synthetic) {
        if (selector != L"memory:color-grid") throw Fault("InvalidSelection");
        impl_->identity = memory_evidence().identity;
    } else {
        if (selector.size() < 8 || selector.compare(0, 4, L"\\\\?\\") != 0) throw Fault("InvalidSelection");
        impl_->identity = device_identity(selector);
    }
    if (expected_identity != impl_->identity) throw Fault("IdentityChanged");
    if (synthetic) return;
    ComPtr<IMFAttributes> attributes;
    check(MFCreateAttributes(&attributes, 2));
    check(attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID));
    check(attributes->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, selector.c_str()));
    check(MFCreateDeviceSource(attributes.Get(), &impl_->source));
    impl_->callback.Attach(new ReaderCallback());
    ComPtr<IMFAttributes> reader_attributes;
    check(MFCreateAttributes(&reader_attributes, 3));
    check(reader_attributes->SetUnknown(MF_SOURCE_READER_ASYNC_CALLBACK, impl_->callback.Get()));
    check(reader_attributes->SetUINT32(MF_READWRITE_DISABLE_CONVERTERS, TRUE));
    check(reader_attributes->SetUINT32(MF_SOURCE_READER_DISABLE_CAMERA_PLUGINS, TRUE));
    check(MFCreateSourceReaderFromMediaSource(impl_->source.Get(), reader_attributes.Get(), &impl_->reader));
}
Source::~Source() { close(); }

Evidence Source::describe() {
    if (impl_->closed) throw Fault("SourceUnavailable");
    if (impl_->synthetic) return memory_evidence();
    if (device_identity(impl_->selector) != impl_->identity) throw Fault("IdentityChanged");
    Evidence evidence;
    evidence.identity = impl_->identity;
    for (std::uint32_t i = 0; i <= max_modes; ++i) {
        ComPtr<IMFMediaType> type;
        const HRESULT hr = impl_->reader->GetNativeMediaType(first_video, i, &type);
        if (hr == MF_E_NO_MORE_TYPES) return evidence;
        check(hr);
        if (i == max_modes) throw Fault("ResourceLimit");
        try {
            Mode mode = read_mode(type.Get(), i);
            if (std::none_of(evidence.modes.begin(), evidence.modes.end(),
                [&](const Mode& existing) { return existing.id() == mode.id(); })) evidence.modes.push_back(mode);
        } catch (const Fault& fault) {
            if (fault.code != "UnsupportedFormat" && fault.code != "ResourceLimit"
                && fault.native_code != MF_E_ATTRIBUTENOTFOUND) throw;
        }
    }
    throw Fault("ResourceLimit");
}

void Source::open(const std::string& evidence_digest, const std::string& mode_id,
    const std::string& output, const Limits& limits) {
    if (impl_->opened || impl_->closed) throw Fault("Busy");
    limits.validate();
    if (output != "JPEG" && output != "I420") throw Fault("UnsupportedFormat");
    const auto evidence = describe();
    if (evidence.digest() != evidence_digest) throw Fault("IdentityChanged");
    const auto found = std::find_if(evidence.modes.begin(), evidence.modes.end(),
        [&](const Mode& value) { return value.id() == mode_id; });
    if (found == evidence.modes.end()) throw Fault("InvalidSelection");
    geometry(*found, limits);
    if (!impl_->synthetic) {
        ComPtr<IMFMediaType> selected, actual;
        check(impl_->reader->GetNativeMediaType(first_video, found->index, &selected));
        check(impl_->reader->SetStreamSelection(all_streams, FALSE));
        check(impl_->reader->SetStreamSelection(first_video, TRUE));
        check(impl_->reader->SetCurrentMediaType(first_video, nullptr, selected.Get()));
        check(impl_->reader->GetCurrentMediaType(first_video, &actual));
        if (read_mode(actual.Get(), found->index).id() != mode_id
            || device_identity(impl_->selector) != impl_->identity) throw Fault("IdentityChanged");
    }
    impl_->selected = *found;
    impl_->limits = limits;
    impl_->output = output;
    impl_->opened = true;
}

Frame Source::next() {
    if (!impl_->opened || impl_->closed) throw Fault("SourceUnavailable");
    ComPtr<IMFSample> sample;
    if (impl_->synthetic) {
        if (impl_->limits.read_ms < 50) throw Fault("Timeout");
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        sample = memory_sample(impl_->selected, impl_->sequence++);
        impl_->started = true;
    } else {
        check(impl_->reader->ReadSample(first_video, 0, nullptr, nullptr, nullptr, nullptr));
        impl_->started = true;
        const DWORD result = WaitForSingleObject(impl_->callback->ready, impl_->limits.read_ms);
        if (result == WAIT_TIMEOUT) throw Fault("Timeout");
        if (result != WAIT_OBJECT_0) throw Fault("SourceFailure");
        DWORD flags = 0;
        sample = impl_->callback->take(flags);
        if (flags & MF_SOURCE_READERF_ERROR) throw Fault("SourceFailure");
        if (flags & (MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED | MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED
            | MF_SOURCE_READERF_NEWSTREAM)) throw Fault("IdentityChanged");
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) throw Fault("EndOfStream");
        if (!sample || flags & MF_SOURCE_READERF_STREAMTICK) throw Fault("NativeIncomplete");
    }
    Frame frame;
    frame.width = impl_->selected.width;
    frame.height = impl_->selected.height;
    HRESULT hr = sample->GetSampleTime(&frame.sample_time);
    if (hr != MF_E_NO_SAMPLE_TIMESTAMP) { check(hr); frame.has_time = true; }
    hr = sample->GetSampleDuration(&frame.sample_duration);
    if (hr != MF_E_NO_SAMPLE_DURATION) { check(hr); frame.has_duration = true; }
    auto pixels = copy_bgr(sample.Get(), impl_->selected, impl_->limits);
    sample.Reset();
    frame.data = impl_->output == "JPEG"
        ? encode_jpeg(pixels, frame.width, frame.height, impl_->limits.frame_bytes)
        : encode_i420(pixels, frame.width, frame.height, impl_->limits.frame_bytes);
    frame.host_ns = monotonic_ns();
    return frame;
}

CloseResult Source::close() noexcept {
    if (impl_->closed) return impl_->result;
    impl_->closed = true;
    impl_->result.started = impl_->started;
    if (impl_->reader && impl_->started) {
        const HRESULT hr = impl_->reader->Flush(all_streams);
        if (FAILED(hr)) impl_->result.add(hr);
        else if (WaitForSingleObject(impl_->callback->flushed, 500) != WAIT_OBJECT_0) {
            impl_->result.add(HRESULT_FROM_WIN32(WAIT_TIMEOUT));
        }
    }
    if (impl_->source) {
        const HRESULT hr = impl_->source->Shutdown();
        if (FAILED(hr)) impl_->result.add(hr);
    }
    impl_->reader.Reset();
    impl_->source.Reset();
    impl_->callback.Reset();
    return impl_->result;
}
const Mode& Source::mode() const { return impl_->selected; }
const std::string& Source::output() const { return impl_->output; }

std::string discover() {
    ComPtr<IMFAttributes> attributes;
    check(MFCreateAttributes(&attributes, 1));
    check(attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID));
    struct Activations {
        IMFActivate** data = nullptr;
        UINT32 count = 0;
        ~Activations() {
            for (UINT32 i = 0; i < count; ++i) if (data[i]) data[i]->Release();
            CoTaskMemFree(data);
        }
    } devices;
    check(MFEnumDeviceSources(attributes.Get(), &devices.data, &devices.count));
    if (devices.count > 64) throw Fault("ResourceLimit");
    std::string result = "{\"kind\":\"discovery\",\"devices\":[";
    for (UINT32 i = 0; i < devices.count; ++i) {
        wchar_t* raw = nullptr;
        UINT32 length = 0;
        check(devices.data[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &raw, &length));
        std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> owned(raw, CoTaskMemFree);
        if (!length || length > 8192) throw Fault("ResourceLimit");
        const std::wstring selector(raw, length);
        std::string identity;
        try { identity = device_identity(selector); }
        catch (const Fault& fault) {
            if (fault.code != "IdentityChanged") throw;
        }
        result += (i ? "," : "") + std::string("{\"privateSelector\":") + quote(to_utf8(selector))
            + ",\"expectedIdentity\":" + (identity.empty() ? "null" : "{\"fingerprint\":" + quote(identity)
                + ",\"scope\":\"windows-instance-and-container\",\"serial\":null,\"transport\":\"unknown\"}") + "}";
    }
    return result + "]}";
}

} // namespace capture
