# Native camera adapters and a remotely consumable relay

## 1. Scope and adapter contract

**Source-reviewed examples, not hardware-tested.** No device discovery, camera opening, capture, media-network connection, installation, or server launch was executed. These are original examples, not a connector implementation or another standards survey. Repository files and the existing final report were not changed.

**Proposed contract:** acquire only on the owning host; resolve identity before opening; distinguish requested settings, device/backend readback, and delivered frame layout; return an application-owned BGR8 NumPy array usable by OpenCV, never a borrowed SDK pointer. Record acquisition/trigger ownership separately from downstream relay access. The concrete ownership evidence is [basler/pypylon:src\pylon\PylonImage.i:116-128](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/PylonImage.i#L116-L128) and [opencv/opencv:modules\python\src2\cv2_convert.cpp:322-335](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/python/src2/cv2_convert.cpp#L322-L335).

## 2. Industrial native acquisition: Basler/pypylon

**Prerequisites:** pypylon **26.8**, NumPy, supported 64-bit Windows/Python, and appropriate installed Basler USB/GigE transport support/drivers. The wheels bundle pylon C++ runtimes; installing Python packages is not installing device drivers. The full pylon suite is recommended, not universally required. This targets **Basler/pylon-compatible cameras exposing the exact features below**, not every GigE Vision or USB3 Vision device. Sources: [basler/pypylon:README.md:8-13](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/README.md#L8-L13), [README.md:128-157](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/README.md#L128-L157), [installation guide:5-14](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/docs/programmers_guide/pypylon_pg_chapter02-installation_and_environment_setup.md#L5-L14), [Basler Windows installation](https://docs.baslerweb.com/software-installation-%28windows%29#installation).

**Ownership prerequisite:** reserve the camera for an authorized exclusive free-run experiment; never run against PLC-owned acquisition. The acknowledgement flag below is not a lock. Importantly, ordinary `InstantCamera` opening applies a default free-run configuration. Remove that handler **before** opening, then reject active triggers rather than silently disabling them. Sources: [basler/pypylon:src\pylon\DoxyPylon.i:87-118](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/DoxyPylon.i#L87-L118), [samples\pylon\grab_multicast\grab_multicast.py:65-89](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/samples/pylon/grab_multicast/grab_multicast.py#L65-L89), [Basler free-run requirements](https://docs.baslerweb.com/free-run-image-acquisition#enabling-free-run-image-acquisition).

Example script `C:\Media\native_grab.py`; arguments are `SERIAL BaslerGigE --approved-exclusive-free-run`, or substitute `BaslerUsb`. Deliberately restricted to ordinary single-image Mono8, 640x480, with no feature-name fallbacks:

```python
import sys
from pypylon import pylon
if len(sys.argv) != 4 or sys.argv[3] != "--approved-exclusive-free-run":
    raise SystemExit("Arguments: SERIAL BaslerGigE|BaslerUsb --approved-exclusive-free-run")
serial, transport = sys.argv[1:3]
if not serial.strip() or transport not in ("BaslerGigE", "BaslerUsb"):
    raise SystemExit("A nonempty serial and supported transport class are required")
factory = pylon.TlFactory.GetInstance()
infos = [d for d in factory.EnumerateDevices()
         if d.GetSerialNumber() == serial and d.GetDeviceClass() == transport]
if len(infos) != 1: raise RuntimeError("Expected exactly one matching camera")
cam = pylon.InstantCamera(factory.CreateDevice(infos[0]))
try:
    cam.RegisterConfiguration(None, pylon.RegistrationMode_ReplaceAll, pylon.Cleanup_None)
    cam.Open()
    nm = cam.GetNodeMap()
    selector = cam.TriggerSelector
    choices = selector.GetSymbolics()
    if not selector.IsWritable() or "FrameStart" not in choices:
        raise RuntimeError("Cannot verify the required frame-trigger configuration")
    for choice in choices:
        selector.SetValue(choice)
        if cam.TriggerMode.GetValue() != "Off":
            raise RuntimeError(f"{choice} trigger is active; refusing to change it")
    want = {"AcquisitionMode": "Continuous", "ExposureMode": "Timed",
            "PixelFormat": "Mono8", "OffsetX": 0, "OffsetY": 0, "Width": 640, "Height": 480,
            "AcquisitionFrameRateEnable": True, "AcquisitionFrameRate": 10.0}
    for name, value in want.items():
        node = nm.GetNode(name)
        if not node.IsReadable() or not node.IsWritable():
            raise RuntimeError(f"Required readable/writable feature unavailable: {name}")
        node.SetValue(value)
    actual = {name: nm.GetNode(name).GetValue() for name in want}
    print("camera:", serial, transport, "\nrequested:", want, "\nreadback:", actual)
    if actual != want: raise RuntimeError("Requested configuration was not achieved")
    cam.MaxNumBuffer.Value = 5
    converter = pylon.ImageFormatConverter()
    converter.OutputPixelFormat = pylon.PixelType_BGR8packed
    converter.OutputBitAlignment.Value = pylon.OutputBitAlignment_MsbAligned
    converter.OutputPaddingX.Value = 0
    converter.OutputOrientation.Value = pylon.OutputOrientation_TopDown
    cam.StartGrabbingMax(100, pylon.GrabStrategy_OneByOne)
    for i in range(100):
        grab = cam.RetrieveResult(5000, pylon.TimeoutHandling_ThrowException)
        try:
            if not grab.GrabSucceeded():
                raise RuntimeError(f"Grab error {grab.ErrorCode}: {grab.ErrorDescription}")
            if (grab.Width, grab.Height, grab.PixelType, grab.PayloadType) != (640, 480, pylon.PixelType_Mono8, pylon.PayloadType_Image):
                raise RuntimeError("Unexpected image geometry, pixel format, or payload")
            converted = converter.Convert(grab)
            frame = converted.GetArray().copy()
            if frame.shape != (480, 640, 3) or frame.dtype.name != "uint8" or not frame.flags.c_contiguous:
                raise RuntimeError("Unexpected BGR ndarray layout")
        finally:
            grab.Release()
        print(i + 1, frame.shape)
finally:
    try:
        if cam.IsGrabbing(): cam.StopGrabbing()
    finally:
        cam.Close()
```

**API evidence:** [serial selection:48-78](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/docs/programmers_guide/pypylon_pg_chapter05-discovering_and_selecting_cameras.md#L48-L78), [device-class getter:121-134](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/tests/pylon/emulated/deviceinfo_test.py#L121-L134), [missing-node wrappers:542-558](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/tests/pylon/emulated/nodemapwrapper_test.py#L542-L558), [enumeration bindings:97-115](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/EnumParameter.i#L97-L115), [ROI/format setters:48-83](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/samples/pylon/parametrize_camera_generic_parameter_access/parametrize_camera_generic_parameter_access.py#L48-L83), [BGR converter:39-45](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/samples/pylon/utility_opencv_video_writer/utility_opencv_video_writer.py#L39-L45), [converter orientation:207-225](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/tests/pylon/emulated/imageformatconverter_test.py#L207-L225), [conversion return:562-572](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/tests/pylon/emulated/imageformatconverter_test.py#L562-L572), [finite grabs/release:627-640](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/tests/pylon/emulated/instantcamera_test.py#L627-L640), [grab properties:109-120](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/GrabResultPtr.i#L109-L120).

The explicit copy happens **while both grab and converted image are alive, before release**. In this pin, ordinary `GetArray()` already copies; do not confuse it with `GetArrayZeroCopy()`. Five SDK buffers and no accumulating application queue bound this example's buffering, not all runtime memory. `AcquisitionFrameRate` readback is a configured upper limit, not measured delivery FPS. Sources: [PylonImage.i:116-128](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/PylonImage.i#L116-L128), [grab sample:31-38](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/samples/pylon/grab/grab.py#L31-L38), [Basler frame-rate semantics](https://docs.baslerweb.com/acquisition-frame-rate#setting-the-acquisition-frame-rate).

Running this changes camera settings, including selector state; **no rollback** is implemented. Unsupported features/increments, readback mismatch, active/uninspectable triggers and grab failures abort. Retrieval timeout is per call, not a whole-program deadline. `StopGrabbing()` can execute `AcquisitionStop`; nested cleanup still attempts `Close()`. Sources: [DoxyPylon.i:6489-6520](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/DoxyPylon.i#L6489-L6520), [6682-6690](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/DoxyPylon.i#L6682-L6690), [6719-6746](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/DoxyPylon.i#L6719-L6746).

**Safe Aravis alternative:** native timeout-pop returns ownership or NULL on timeout. Require successful ordinary-image status, known Mono8 format, bounded positive dimensions, non-null data and sufficient size. For a simple tight-row copy, reject padding and check multiplication overflow before calculating `width * height`. These are proposed defensive checks, not claims about the upstream example. Copy into owned storage **before** `arv_stream_push_buffer()` transfers ownership back. Return/unref rejected buffers too; stop acquisition and unref stream/camera on exit. This avoids the previously established plugin lifetime caveat rather than copying after requeue. Sources, Aravis 0.8.36: [src\arvstream.c:159-180](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvstream.c#L159-L180), [85-105](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvstream.c#L85-L105), [src\arvbuffer.h:120-157](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvbuffer.h#L120-L157), [tests\arvexample.c:120-135](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/tests/arvexample.c#L120-L135).

## 3. Windows UVC: identity, backend and owned frame

Windows' UVC driver exposes Media Foundation and DirectShow. Use external `MFEnumDeviceSources` enumeration to persist the **opaque symbolic link**, with owning-host context; display friendly names separately. Device-interface paths can survive reboots, but do not promise portability across hosts/reinstallation/topology changes. Re-enumerate and verify. DirectShow's `DevicePath` distinguishes identical camera models on that system. Sources: [Microsoft UVC driver](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/usb-video-class-driver-overview), [MF enumeration](https://learn.microsoft.com/en-us/windows/win32/medfound/enumerating-video-capture-devices), [symbolic-link identity](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-devsource-attribute-source-type-vidcap-symbolic-link), [SetupAPI path reuse](https://learn.microsoft.com/en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetdeviceinterfacedetailw), [DirectShow selection](https://learn.microsoft.com/en-us/windows/win32/directshow/selecting-a-capture-device).

**OpenCV 4.13.0 MSMF uses `devices[index]`**, not a persistent serial selector. The following index must be resolved from the current host/backend enumeration; separate snapshots can race. Strict identity-based activation needs a native identity-aware adapter. Passing the symbolic link as a `VideoCapture` string instead selects a URL-opening path, not this camera-index API. Sources: [opencv/opencv:modules\videoio\src\cap_msmf.cpp:722-744](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L722-L744), [1283-1290](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L1283-L1290).

```python
import cv2
import numpy as np
def one_owned_bgr(index):
    api = cv2.CAP_MSMF
    if not cv2.videoio_registry.hasBackend(api):
        raise RuntimeError("MSMF unavailable in this OpenCV runtime")
    cap = cv2.VideoCapture()
    try:
        if not cap.open(index, api):
            raise RuntimeError("Open failed: check index, device and camera privacy")
        print("backend:", cap.getBackendName())
        requests = [
            ("width", cv2.CAP_PROP_FRAME_WIDTH, 640),
            ("height", cv2.CAP_PROP_FRAME_HEIGHT, 480),
            ("fps", cv2.CAP_PROP_FPS, 30),
            ("convert_bgr", cv2.CAP_PROP_CONVERT_RGB, 1),
        ]
        status = [(name, prop, value, cap.set(prop, value))
                  for name, prop, value in requests]
        for name, prop, value, accepted in status:
            print(name, "requested=", value, "set=", accepted, "reported=", cap.get(prop))
        if cap.get(cv2.CAP_PROP_CONVERT_RGB) != 1:
            raise RuntimeError("BGR conversion not enabled")
        ok, frame = cap.read()
        if not ok or frame is None or frame.size == 0:
            raise RuntimeError("No frame delivered")
        if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
            raise RuntimeError("Expected uint8 HxWx3 BGR")
        print("delivered:", frame.shape, frame.dtype)
        return frame.copy()
    finally:
        cap.release()
bgr = one_owned_bgr(0)
```

Prerequisites are `cv2`, NumPy, an actually available MSMF backend, a supported device mode and Windows camera permission. `hasBackend()` checks runtime availability. Setters/readback are not acceptance/throughput guarantees; this example reports negotiated differences rather than demanding 640x480. BGR semantics come from MSMF's conversion implementation, not merely counting channels. Sources: [registry implementation:474-486](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/videoio_registry.cpp#L474-L486), [videoio.hpp:996-1030](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L996-L1030), [MSMF conversion:1937-1977](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L1937-L1977), [Microsoft privacy handling](https://learn.microsoft.com/en-us/windows/win32/medfound/enumerating-video-capture-devices).

Do not add a purported MSMF timeout using OpenCV's FFmpeg/GStreamer-only timeout properties. One read is not a wall-clock bound; use a supervised worker for operational deadlines. Nor is an MSMF `"MJPG"` FourCC setter a portable native-format negotiation mechanism. Sources: [videoio.hpp:193-201](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L193-L201), [MSMF format handling:1153-1191](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L1153-L1191), [2330-2336](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L2330-L2336).

**FFmpeg n7.1.1 DirectShow enumeration**, shown but not executed:

```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
ffmpeg -hide_banner -list_options true -f dshow -i 'video=CAMERA_NAME'
```

Use the emitted friendly/alternative name; do not synthesize it from an MF identifier. `video_device_number` selects a same-name occurrence, **not an OpenCV index**. Listing is not successful capture. Sources: [FFmpeg/FFmpeg:doc\indevs.texi:657-684](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L657-L684), [545-551](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L545-L551), [libavdevice\dshow.c:509-535](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/libavdevice/dshow.c#L509-L535).

## 4. ORIGINAL proposed connector-local configuration

These are **local design objects**, not standardized xRegistry endpoint options, SDK arguments, or MediaMTX keys. The URNs and field names are proposals. Treat the three objects as alternatives; simultaneous connectors need distinct publication paths. `auth_ref` is separate from identity/URLs; `null` applies only to this isolated local-access example. Store observed effective mode separately after opening, never manufacture it from `requested`.

```json
[
  {"accessprofile":"urn:acf:media:uvc:0.1","owning_host":"win-capture-01","backend":"opencv:CAP_MSMF",
   "selector":{"mf_symbolic_link":"OPAQUE_ENUMERATED_ID"},"requested":{"width":640,"height":480,"fps":30,"output":"BGR8"},
   "ownership":{"acquisition":"connector","trigger":"not-managed"},"auth_ref":null},
  {"accessprofile":"urn:acf:media:gige-vision:0.1","owning_host":"win-capture-01","backend":"pypylon:26.8",
   "selectorserial":"KNOWN_SERIAL","deviceclass":"BaslerGigE","requested":{"width":640,"height":480,"fps":10,"pixel_format":"Mono8","output":"BGR8"},
   "ownership":{"acquisition":"exclusive-connector","trigger":"approved-free-run"},"auth_ref":null},
  {"accessprofile":"urn:acf:media:usb3-vision:0.1","owning_host":"win-capture-01","backend":"pypylon:26.8",
   "selectorserial":"KNOWN_SERIAL","deviceclass":"BaslerUsb","requested":{"width":640,"height":480,"fps":10,"pixel_format":"Mono8","output":"BGR8"},
   "ownership":{"acquisition":"exclusive-connector","trigger":"approved-free-run"},"auth_ref":null}
]
```

Proposed downstream contract: consume the relay URL, not the USB index or SDK serial. An encoder/publisher must connect owned frames to that relay. MediaMTX's OpenCV example explicitly requires a GStreamer-enabled build and uses `appsrc`, conversion, H.264 encoding and `rtspclientsink`; it is not an ordinary Windows-wheel guarantee. Source: [bluenviron/mediamtx:docs\3-publish\20-python-opencv.md:3-23](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/3-publish/20-python-opencv.md#L3-L23), [41-48](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/3-publish/20-python-opencv.md#L41-L48).

## 5. MediaMTX v1.21.0: two independent paths

Pinned to **`2c6727904fbf233615de74a6c54a9b94dbf6025d`**. Use a separately provisioned Windows binary and save this standalone configuration as `C:\Media\mediamtx.yml`; do not append it to the stock permissive configuration. The stock file permits anonymous publish/read and enables multiple listeners. Sources: [installation:11-19](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/1-kickoff/2-install.md#L11-L19), [mediamtx.yml:62-93](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/mediamtx.yml#L62-L93), [internal\conf\conf.go:469-534](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/conf/conf.go#L469-L534).

```yaml
authMethod: internal
authInternalUsers:
  - user: any
    ips: ["127.0.0.1"]
    permissions:
      - {action: read, path: camera}
      - {action: read, path: local-live}
      - {action: publish, path: local-live}
rtsp: true
rtspAddress: 127.0.0.1:8554
rtspTransports: [tcp]
api: false
metrics: false
pprof: false
playback: false
rtmp: false
hls: false
webrtc: false
srt: false
moq: false
paths:
  camera:
    source: rtsp://camera.internal.example:554/live
    rtspTransport: tcp
    sourceOnDemand: false
    record: true
    recordPath: 'C:\Media\recordings\%path\%Y-%m-%d_%H-%M-%S-%f'
    recordFormat: fmp4
    recordDeleteAfter: 0s
  local-live:
    source: publisher
    overridePublisher: false
```

**Semantics:** `camera` starts pulling independently of viewers; `sourceOnDemand: false` is intentional for recording obligations, not a bandwidth optimization. `record: true` separately enables recording when media exists. `local-live` accepts an external encoded publisher; a second publisher cannot evict the current one, and cannot publish into the camera-source path. These are not two names for one stream. Sources: [internal\core\path.go:242-263](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/core/path.go#L242-L263), [977-979](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/core/path.go#L977-L979), [585-602](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/core/path.go#L585-L602), [RTSP pull transport:170-181](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/staticsources/rtsp/source.go#L170-L181). Neither path re-encodes: require mutually compatible source, recorder and reader formats. Sources: [RTSP codecs:3-7](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/4-read/04-rtsp.md#L3-L7), [re-encoding:1-14](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/2-features/07-remuxing-reencoding-compression.md#L1-L14).

**Deployment prerequisites:** replace the camera placeholder with an authorized source, provide writable recording storage, firewall/isolate the camera network, and supervise source/recorder failures and disk capacity. `0s` disables automatic deletion, not disk exhaustion; choose retention explicitly. Recording has crash-loss windows and cannot guarantee continuous evidence through camera/network failure. Sources: [mediamtx.yml:571-593](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/mediamtx.yml#L571-L593). Where upstream credentials are required, an authorized secret resolver can supply `MTX_PATHS_CAMERA_SOURCE`; no raw credential URL is embedded here, and `auth_ref` is not a MediaMTX option. Control inherited environment overrides before deployment. Source: [configuration:35-59](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/2-features/05-configuration.md#L35-L59).

**Remote access without public default-server exposure:** keep this listener on loopback. On the capture host, launch the explicit configuration; on the remote operator's Windows client, use an already provisioned/authenticated SSH account with forwarding permission and verified host key:

```powershell
& 'C:\Tools\MediaMTX\mediamtx.exe' 'C:\Media\mediamtx.yml'
ssh -N -L 127.0.0.1:18554:127.0.0.1:8554 media-operator@win-capture-01
```

Local RTSP outputs are `rtsp://127.0.0.1:8554/camera` and `rtsp://127.0.0.1:8554/local-live`; on that remote client use port **18554** instead. Readers must use RTSP-over-TCP through this tunnel. The tunnel is encrypted; the sample's RTSP endpoints themselves are not TLS. Sources: [RTSP URL:9-15](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/4-read/04-rtsp.md#L9-L15), [RTSP settings:243-252](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/mediamtx.yml#L243-L252), [OpenSSH forwarding](https://man.openbsd.org/ssh.1#L), [no-command mode](https://man.openbsd.org/ssh.1#N), [Microsoft Windows OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview).

**Trust boundary:** loopback is not user authentication. Local processes and tunnel holders inherit the listed read/**publish** privileges. Restrict this recipe to trusted operators; for read-only tenants replace anonymous access with per-path authenticated roles and protected transport, not merely a public bind/firewall opening. Sources: [internal\auth\manager.go:152-190](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/auth/manager.go#L152-L190), [authentication:15-39](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/2-features/06-authentication.md#L15-L39), [encryption warning:73-73](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/2-features/06-authentication.md#L73-L73).

## 6. Real audio publication and finite clip

The UVC `read()` example is video-only. MSMF defaults audio off and rejects simultaneous video/audio device-index capture in this implementation; an integrated microphone is also a separate DirectShow device. Use an explicit audio/video pipeline, not `VideoCapture.read()` magic. Sources: [cap_msmf.cpp:873-884](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L873-L884), [1221-1231](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L1221-L1231), [Microsoft capture-device separation](https://learn.microsoft.com/en-us/windows/win32/directshow/selecting-a-capture-device).

Optional **alternative capture process** on the owning host, not a consumer of the Python array and not a second concurrent camera owner:

```powershell
ffmpeg -hide_banner -f dshow -video_size 640x480 -framerate 30 `
  -i 'video=CAMERA_NAME:audio=MICROPHONE_NAME' -map 0:v:0 -map 0:a:0 `
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p `
  -c:a aac -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/local-live
```

Replace enumerated names; require supported modes, DirectShow, and enabled `libx264`/AAC encoders. Strict maps require both tracks. A common DirectShow input may improve synchronization, not guarantee it. Encoding happens in FFmpeg: MediaMTX does **not** turn raw BGR into H.264 automatically. Sources: [indevs.texi:503-527](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L503-L527), [stream maps:1837-1852](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L1837-L1852), [encoders.texi:29-33](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/encoders.texi#L29-L33), [2505-2511](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/encoders.texi#L2505-L2511), [H.264 settings](https://trac.ffmpeg.org/wiki/Encode/H.264), [protocols.texi:1234-1261](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/protocols.texi#L1234-L1261), [MediaMTX re-encoding:1-14](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/docs/2-features/07-remuxing-reencoding-compression.md#L1-L14).

Optional local ten-second media clip of that **controlled H.264/AAC publication**, with `C:\Media` provisioned:

```powershell
ffmpeg -hide_banner -n -rtsp_transport tcp -i rtsp://127.0.0.1:8554/local-live `
  -map 0:v:0 -map 0:a:0 -t 10 -c copy 'C:\Media\clip.mkv'
```

`-n` prevents overwriting; `-t` limits media duration, not wall-clock runtime or frame-exact boundaries. Streamcopy is conditional on codec/container compatibility: Matroska supports these selected codecs, but arbitrary `-c copy` is not universally valid. Sources: [ffmpeg.texi:492-494](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L492-L494), [525-535](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L525-L535), [202-220](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L202-L220), [keyframe handling:1397-1399](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L1397-L1399), [matroska.c:27-29](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/libavformat/matroska.c#L27-L29), [88-92](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/libavformat/matroska.c#L88-L92).

## 7. Evidence and licensing limits

No model/firmware compatibility, accepted mode, driver availability, realized FPS, latency, losslessness, authentication deployment, relay interoperability, recording integrity or throughput is guaranteed. HTML documentation is first-party but unversioned; GitHub evidence is commit-pinned. Existing installations must match the reviewed APIs, especially pypylon 26.8's parameter wrappers.

The original examples do not replace dependency licensing review: pypylon's binding is BSD-3-Clause and MediaMTX is MIT; review native SDK/runtime redistribution terms separately. FFmpeg licensing depends on build options; `libx264` is explicitly a GPL consideration. Sources: [basler/pypylon:LICENSE:1-11](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/LICENSE#L1-L11), [bluenviron/mediamtx:LICENSE:1-21](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/LICENSE#L1-L21), [FFmpeg legal guidance](https://ffmpeg.org/legal.html).
