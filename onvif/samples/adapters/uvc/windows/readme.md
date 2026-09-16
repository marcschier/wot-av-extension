# Windows OS-video / MF backend

This is the real C++17 Media Foundation and WIC implementation, promoted from
the approved memory-qualified stage. The shared Node package and operator
instructions are in [the adapter readme](../../readme.md). It is not a SOAP
device, a complete ONVIF profile, or hardware qualification.

The worker compiles with the installed Windows SDK and MSVC, linking MF, WIC,
COM, Configuration Manager and BCrypt import libraries. No GStreamer,
third-party camera SDK, driver installation or redistributed system DLL is
needed. Build from the repository root:

```powershell
.\onvif\tools\adapters\scripts\windows-build.ps1
node .\onvif\tools\adapters\run.cjs
```

Build products stay in `onvif\samples\adapters\build-windows`. CMake locates
test source under `onvif\tools\tests\adapters`, not in this sample directory.
The original staged worker/capture sources are retained without rewriting
their native behavior; only build/test placement changed.

## Selection and supported native layouts

`windows-mf` requires one exact opaque MF device symbolic link and approved
instance/container identity fingerprint. `MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK`
selects that device directly. There is no index, friendly-name or first-device
fallback. Configuration Manager queries the selected interface only.
MF hardware-source status does not prove UVC: transport remains unknown
without separately observed transport evidence.

The optional operator `discover --allow-discovery --output <private-file>`
command invokes `MFEnumDeviceSources`, without activation or selection.
It is never run by construction, HTTP publication or qualification.
Fresh `describe` requires `--native-read-only --allow-device-access`; it
activates the selected source to read native types but does not negotiate or
call `ReadSample`. Windows privacy/access denial fails explicitly.

Accepted progressive inputs are RGB32/BGRX with checked signed stride,
even-width YUY2, and even-dimension positive-stride NV12. YUV requires
reported BT.601 limited-range colorimetry. Interlacing, multiple buffers,
unknown colorimetry and compressed/other layouts are rejected.
The exact native tuple is checked again before and after authorized format
selection. No exposure, focus, gain, trigger, PTZ or persistent camera setter
is exposed. MF hardware converters are not used as an implicit fallback.

## Ownership, encoding and timing

MF buffers are locked and bounded before copying into owned vectors.
Negative strides and odd RGB geometry are supported; I420 chroma rounds up.
The asynchronous source callback retains only bounded pending native samples;
it does not wait for HTTP readers. WIC encodes actual JPEG through a capped
IStream. Failed/partial writes remain failures. Native memory tests decode
with WIC; independent HTTP qualification decodes with Pillow/libjpeg.

The explicit `mf-memory` backend uses real MF memory samples and WIC with a
17x13 color grid. It is software simulation, not a UVC or hardware probe.
Its pixels and sample timing are intentionally synthetic.

IMFSample presentation time/duration remain signed 100-ns decimal values.
Representable nonnegative PTS also has a nanosecond presentation value;
it is not sensor exposure time. Native monotonic receipt and Node freshness
origin remain separate, with no invented UTC mapping.

Close flushes/stops only this source and releases owned COM references.
The Node watchdog observes its own child's exit. Forced process termination
reports acquisition/resource state unknown even if an earlier partial
receipt existed. It never certifies that physical capture stopped.

## Qualification boundary

MSVC 19.51.36257 and Windows SDK 10.0.26100.0 compile/link the native selected
device implementation. The executed path is MF memory/WIC only. Exact
physical-device activation, negotiation, privacy denial, busy state, unplug,
driver behavior and UVC transport identity remain hardware-unverified.
Fault/lifecycle fixtures are software evidence, not those hardware results.
Microsoft component rights and deployment prerequisites remain separate;
this sample assigns no first-party or SDK redistribution license.
