#include "capture.hpp"

#include <fstream>
#include <iostream>
#include <cstring>

namespace {

void require(bool condition) {
    if (!condition) throw capture::Fault("TestFailed");
}

template<class Function>
void rejects(const char* code, Function function) {
    try { function(); }
    catch (const capture::Fault& fault) {
        if (fault.code != code) throw capture::Fault(std::string("Expected-") + code + "-got-" + fault.code, fault.native_code);
        return;
    }
    throw capture::Fault("ExpectedFailure");
}

void raw_yuv_test(REFGUID subtype) {
    capture::Mode mode;
    mode.subtype = subtype;
    mode.width = 2;
    mode.height = 2;
    mode.stride = subtype == MFVideoFormat_YUY2 ? 4 : 2;
    std::vector<BYTE> bytes = subtype == MFVideoFormat_YUY2
        ? std::vector<BYTE>{81, 90, 81, 240, 81, 90, 81, 240}
        : std::vector<BYTE>{81, 81, 81, 81, 90, 240};
    capture::ComPtr<IMFMediaBuffer> buffer;
    capture::check(MFCreateMemoryBuffer(static_cast<DWORD>(bytes.size()), &buffer));
    BYTE* data = nullptr;
    capture::check(buffer->Lock(&data, nullptr, nullptr));
    std::memcpy(data, bytes.data(), bytes.size());
    capture::check(buffer->Unlock());
    capture::check(buffer->SetCurrentLength(static_cast<DWORD>(bytes.size())));
    capture::ComPtr<IMFSample> sample;
    capture::check(MFCreateSample(&sample));
    capture::check(sample->AddBuffer(buffer.Get()));
    const auto bgr = capture::copy_bgr(sample.Get(), mode, {});
    require(bgr.size() == 12 && bgr[2] > 245 && bgr[0] < 5 && bgr[1] < 5);
    capture::check(buffer->SetCurrentLength(static_cast<DWORD>(bytes.size() - 1)));
    rejects("UnsupportedFormat", [&] { capture::copy_bgr(sample.Get(), mode, {}); });
}

} // namespace

int main() {
    const char* phase = "runtime";
    try {
        capture::Runtime runtime;
        phase = "memory-copy";
        const auto evidence = capture::memory_evidence();
        require(evidence.modes.size() == 1 && evidence.synthetic);
        const auto mode = evidence.modes[0];
        auto sample = capture::memory_sample(mode, 0);
        const auto owned = capture::copy_bgr(sample.Get(), mode, {});
        require(owned.size() == 17 * 13 * 3);
        require(owned[0] == 20 && owned[1] == 20 && owned[2] == 180);
        require(owned[(17 * 12) * 3 + 1] == 230);
        capture::ComPtr<IMFMediaBuffer> buffer;
        capture::check(sample->GetBufferByIndex(0, &buffer));
        capture::ComPtr<IMF2DBuffer> two_d;
        capture::check(buffer.As(&two_d));
        BYTE* scan = nullptr;
        LONG stride = 0;
        capture::check(two_d->Lock2D(&scan, &stride));
        require(stride < 0);
        for (unsigned y = 0; y < mode.height; ++y) std::memset(scan + static_cast<std::ptrdiff_t>(stride) * y, 0, mode.width * 4);
        capture::check(two_d->Unlock2D());
        LONGLONG timestamp = 0, duration = 0;
        capture::check(sample->GetSampleTime(&timestamp));
        capture::check(sample->GetSampleDuration(&duration));
        require(timestamp == 90071992547409LL && duration == 500000);
        sample.Reset(); buffer.Reset(); two_d.Reset();
        require(owned[2] == 180 && owned[(17 * 12) * 3 + 1] == 230);

        phase = "wic-jpeg";
        const auto jpeg = capture::encode_jpeg(owned, 17, 13, 16777216);
        phase = "wic-decode";
        capture::verify_jpeg(jpeg, 17, 13);
        phase = "wic-at-byte-limit";
        require(capture::encode_jpeg(owned, 17, 13, static_cast<std::uint32_t>(jpeg.size())) == jpeg);
        phase = "wic-over-byte-limit";
        rejects("ResourceLimit", [&] { capture::encode_jpeg(owned, 17, 13, static_cast<std::uint32_t>(jpeg.size() - 1)); });
        phase = "write-software-fixture";
        std::ofstream fixture("software-native.jpg", std::ios::binary);
        fixture.write(reinterpret_cast<const char*>(jpeg.data()), static_cast<std::streamsize>(jpeg.size()));
        fixture.close();
        require(fixture.good());
        phase = "i420-limits";
        const auto i420 = capture::encode_i420(owned, 17, 13, 347);
        require(i420.size() == 17 * 13 + 2 * 9 * 7);
        rejects("ResourceLimit", [&] { capture::encode_i420(owned, 17, 13, 346); });
        rejects("ResourceLimit", [&] { capture::encode_i420(owned, 4097, 13, 16777216); });

        phase = "native-raw-yuv";
        raw_yuv_test(MFVideoFormat_YUY2);
        raw_yuv_test(MFVideoFormat_NV12);
        phase = "source-lifecycle";
        capture::Source source(true, L"memory:color-grid", evidence.identity);
        rejects("IdentityChanged", [&] { source.open("changed", mode.id(), "JPEG", {}); });
        rejects("InvalidSelection", [&] { source.open(evidence.digest(), "different-mode", "JPEG", {}); });
        rejects("UnsupportedFormat", [&] { source.open(evidence.digest(), mode.id(), "H264", {}); });
        capture::Limits tight;
        tight.width = 16;
        rejects("ResourceLimit", [&] { source.open(evidence.digest(), mode.id(), "JPEG", tight); });
        tight.width = 17;
        tight.height = 13;
        source.open(evidence.digest(), mode.id(), "JPEG", tight);
        const auto frame = source.next();
        require(frame.width == 17 && frame.height == 13 && frame.has_time && frame.host_ns > 0);
        capture::verify_jpeg(frame.data, 17, 13);
        const auto closed = source.close();
        require(!closed.error_count && closed.started && source.close().json() == closed.json());
        rejects("SourceUnavailable", [&] { source.next(); });
        capture::check(runtime.close());
        std::cout << "{\"result\":\"pass\",\"checks\":18,\"scope\":\"MF-memory-raw-copy-WIC-I420\","
            "\"hardwareEnumerationCalls\":0,\"hardwareOpenCalls\":0}\n";
        return 0;
    } catch (const capture::Fault& fault) {
        std::cout << "{\"result\":\"fail\",\"code\":" << capture::quote(fault.code)
            << ",\"phase\":" << capture::quote(phase)
            << ",\"nativeCode\":" << capture::quote(capture::hex_code(fault.native_code)) << "}\n";
        return 1;
    } catch (const std::bad_alloc&) {
        std::cout << "{\"result\":\"fail\",\"code\":\"ResourceLimit\"}\n";
        return 1;
    }
}
