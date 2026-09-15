**Design conclusion:** keep **device discovery/control**, **media-session access**, and **application-frame delivery** distinct. “Camera URL,” “GenICam,” and “pull” are not sufficient connector descriptions. In particular, a client-initiated RTSP session can receive continuously arriving RTP packets, while an application pulls already-buffered frames from an in-process appsink.

The findings below use official documentation and source, with GitHub references pinned to commits. Examples are **source-reviewed templates, not runtime-tested configurations**. The principal implementation baselines are OpenCV 4.13.0, FFmpeg 7.1.1, and Aravis 0.8.36; newer Aravis behavior is explicitly qualified. No registry schema is proposed, no repository files were changed, and no final report was saved.

## Transport and discovery boundaries

### GigE Vision, GenICam, and GenTL are different layers

**GenICam is not a streaming protocol or universal camera locator.** EMVA distinguishes GenApi’s device-description/feature-access machinery, SFNC’s standardized feature vocabulary, PFNC’s pixel-format vocabulary, and GenTL’s transport-layer API for enumeration, register access, streaming, and events. GigE Vision uses GenApi descriptions, but that does not turn a GigE camera into an RTSP server. Sources: [EMVA GenICam introduction](https://www.emva.org/standards-technology/genicam/introduction-new/), [A3 GigE Vision overview](https://www.automate.org/vision/vision-standards/vision-standards-gige-vision).

In the reviewed Aravis implementation, GigE discovery sends **GVCP discovery broadcasts through host interfaces**. Acquisition subsequently programs the destination host address and receive port for the stream; this is materially different from opening a fixed RTSP resource. Sources: [AravisProject/aravis:src/arvgvinterface.c:170–203](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvinterface.c#L170-L203), [AravisProject/aravis:src/arvgvstream.c:1652–1675](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvstream.c#L1652-L1675).

A **GenTL producer is a host-side runtime dependency**, not something implied by a device’s network address. For example, development Aravis searches architecture-specific `GENICAM_GENTL64_PATH`/`GENICAM_GENTL32_PATH` locations for `.cti` producers, then enumerates producer interfaces and devices. That development feature should not be silently attributed to stable 0.8.36. Sources: [AravisProject/aravis:src/arvgentlsystem.c:166–210](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgentlsystem.c#L166-L210), [AravisProject/aravis:src/arvgentlinterface.c:218–254](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgentlinterface.c#L218-L254).

Consequently, **GigE Vision is not universally accessible through `cv2.VideoCapture`**. OpenCV explicitly documents industrial cameras lacking standard OS interfaces and recommends their SDKs, potentially wrapping SDK-owned image buffers in `Mat`. A compatible backend or adapter must actually be installed. Source: [OpenCV Video I/O overview—third-party cameras](https://docs.opencv.org/4.13.0/d0/da7/videoio_overview.html).

### USB UVC is not USB3 Vision

For **UVC**, Windows supplies `Usbvideo.sys`, exposes the device through multimedia APIs including Media Foundation and DirectShow, and negotiates streaming parameters using UVC probe/commit controls. The USB bus generation alone does not identify this programming model. Source: [Microsoft UVC driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/usb-video-class-driver-overview).

For **USB3 Vision**, stable Aravis registers a distinct `USB3Vision` interface, examines USB3 Vision control/data descriptors, and claims USB interfaces through libusb. That native backend is not a general UVC webcam adapter. Sources: [AravisProject/aravis:src/arvsystem.c:54–72](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvsystem.c#L54-L72), [AravisProject/aravis:src/arvuvinterface.c:185–208](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvuvinterface.c#L185-L208), [AravisProject/aravis:src/arvuvdevice.c:1062–1084](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvuvdevice.c#L1062-L1084).

Discovery must therefore name its execution environment:

- Windows Media Foundation uses `MFEnumDeviceSources`; camera privacy permissions can prevent opening an enumerated device. Source: [Microsoft device enumeration](https://learn.microsoft.com/en-us/windows/win32/medfound/enumerating-video-capture-devices).
- Linux V4L2 device numbering depends on probe order; its documentation recommends identity/path-based links when stable identification is required. Associated audio can be exposed separately through ALSA. Source: [Linux V4L2 opening and device naming](https://docs.kernel.org/userspace-api/media/v4l/open.html).
- “Aravis never supports UVC” would nevertheless be too broad: development Aravis includes an **experimental, disabled-by-default V4L2 backend**. That is separate from native USB3 Vision support. Source: [AravisProject/aravis:meson_options.txt:11–15](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/meson_options.txt#L11-L15).

### ONVIF discovery is not RTSP discovery

Where supported and enabled, ONVIF discovery uses **WS-Discovery**. Successful discovery supplies the **device-service address**, from which clients discover services and query media profiles. It does not directly enumerate decoded frames or substitute for a media connection. Devices may also be non-discoverable. Sources: [onvif/specs:doc/Core.xml:1192–1197](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Core.xml#L1192-L1197), [onvif/specs:doc/Core.xml:2702–2724](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Core.xml#L2702-L2724).

ONVIF media configuration uses SOAP/HTTP; RTSP performs session initiation/playback control; SDP describes media; RTP transports media. GStreamer’s `rtspsrc` creates a separate RTP pad for each SDP stream and handles RTCP, reordering, and jitter buffering internally. Thus audio/video selection must be explicit rather than inferred from “RTSP.” Sources: [onvif/specs:doc/Streaming.xml:575–577](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Streaming.xml#L575-L577), [onvif/specs:doc/Streaming.xml:1029–1033](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Streaming.xml#L1029-L1033), [GStreamer `rtspsrc`](https://gstreamer.freedesktop.org/documentation/rtsp/rtspsrc.html).

RTSP also does not imply ONVIF support. A vendor can provide its own documented RTSP URL and configuration interface; Axis, for example, documents stream-profile and audio-selection URL parameters. Source: [Axis RTSP URL parameters](https://developer.axis.com/vapix/network-video/video-streaming/#parameter-specification-rtsp-url).

### Still images, clips, and continuous HTTP responses need different treatment

An HTTP endpoint may return a single JPEG, a finite recording, or an ongoing multipart image stream. Axis explicitly distinguishes its JPEG snapshot endpoint from its continuous multipart Motion JPEG endpoint. Classify the **resource and response semantics**, not just the `http` scheme or filename suffix. Source: [Axis HTTP video and snapshots](https://developer.axis.com/vapix/network-video/video-streaming/#video-streaming-over-http).

For stored clips, access and seekability are separate concerns. FFmpeg’s HTTP protocol can autodetect seekability; its file protocol distinguishes ordinary files from non-seekable inputs. A connector should separately declare finite/live behavior, seeking, looping, pacing, and the worker’s filesystem access. Source: [FFmpeg file and HTTP protocols](https://ffmpeg.org/ffmpeg-protocols.html#file).

## Control ownership and format semantics

**Opening another consumer must not implicitly mean acquiring camera-control ownership.** Reviewed Aravis GigE code acquires control and maintains a heartbeat; stream creation rejects a non-controller. Basler separately documents multicast configurations with exactly one controller and read-only monitoring applications. This is evidence for distinct roles—not evidence that `aravissrc` implements every monitoring mode. Sources: [AravisProject/aravis:src/arvgvdevice.c:2049–2059](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvdevice.c#L2049-L2059), [AravisProject/aravis:src/arvgvdevice.c:1874–1878](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvdevice.c#L1874-L1878), [Basler controlling and monitoring applications](https://docs.baslerweb.com/stream-grabber-parameters#controlling-and-monitoring-applications).

Likewise, V4L2 may permit multiple opens while assigning streaming ownership to the filehandle that allocates buffers. Its documentation explicitly recommends a userspace proxy rather than driver-level replication for multiple readers of the same stream. Source: [V4L2 multiple opens and shared streams](https://docs.kernel.org/userspace-api/media/v4l/open.html).

For industrial triggering, the required sequence is approximately **configure → determine payload → queue buffers → start acquisition → trigger when ready → consume/requeue**. Aravis demonstrates queuing before acquisition and distinguishes configuring a trigger source from executing `TriggerSoftware`. Hardware-line names and readiness constraints remain camera-specific; Basler warns that triggers received while unready may be ignored. Sources: [AravisProject/aravis:tests/arvexample.c:78–94](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/tests/arvexample.c#L78-L94), [AravisProject/aravis:src/arvcamera.c:1365–1452](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvcamera.c#L1365-L1452), [AravisProject/aravis:src/arvcamera.c:1588–1603](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvcamera.c#L1588-L1603), [Basler triggered acquisition](https://docs.baslerweb.com/triggered-image-acquisition).

Maintain **four distinct observations**: advertised capabilities, requested settings, effective camera/transport configuration, and delivered application format. OpenCV warns that `set()` returning true does not prove device acceptance, and unsupported `get()` properties return zero. V4L2 explicitly permits adjustment of requested formats. GStreamer distinguishes possible caps from the selected format carried by a CAPS event. Sources: [opencv/opencv:modules/videoio/include/opencv2/videoio.hpp:996–1024](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L996-L1024), [V4L2 format negotiation](https://docs.kernel.org/userspace-api/media/v4l/vidioc-g-fmt.html), [GStreamer caps negotiation](https://gstreamer.freedesktop.org/documentation/plugin-development/advanced/negotiation.html).

Changing an RTSP decoder’s output size is not camera configuration. The reviewed OpenCV FFmpeg backend does not implement width/FPS setters as remote camera controls. ONVIF’s `SetVideoEncoderConfiguration` contract also warns that a new URI request and stream restart may be necessary for changes to take effect. Sources: [opencv/opencv:modules/videoio/src/cap_ffmpeg_impl.hpp:2352–2375](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L2352-L2375), [ONVIF Media WSDL—`SetVideoEncoderConfiguration`](https://www.onvif.org/ver10/media/wsdl/media.wsdl).

## Six configuration examples

These examples deliberately expose the actual configuration surfaces: launcher environment, backend selection, library parameters, GStreamer properties/caps, and FFmpeg arguments.

### 1. RTSP → OpenCV, with explicit backend and bounded reads

Set this in the **worker launcher**, before starting Python:

```powershell
$env:OPENCV_FFMPEG_CAPTURE_OPTIONS = 'rtsp_transport;tcp'
```

OpenCV documents that changing `os.environ` inside Python may not affect its C++ runtime on some Windows/Python combinations. The FFmpeg backend reads this environment option and parses `key;value|key;value` pairs; it is process configuration, not a per-camera property object. Sources: [OpenCV environment-variable caveats](https://docs.opencv.org/4.13.0/d6/dea/tutorial_env_reference.html), [opencv/opencv:modules/videoio/src/cap_ffmpeg_impl.hpp:1165–1181](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L1165-L1181).

```python
import os
import cv2

def read_one(source, backend):
    if not cv2.videoio_registry.hasBackend(backend):
        raise RuntimeError("Requested OpenCV backend is unavailable")

    cap = cv2.VideoCapture()
    try:
        opened = cap.open(source, backend, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
        ])
        if not opened:
            raise RuntimeError("Capture open failed")

        ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError("No decoded video frame received")

        print(cap.getBackendName(), frame.shape, frame.dtype,
              "reported_fps=", cap.get(cv2.CAP_PROP_FPS))
        return frame.copy()
    finally:
        cap.release()

frame = read_one(os.environ["CAMERA_RTSP_URL"], cv2.CAP_FFMPEG)
```

Prerequisites are a usable FFmpeg-enabled OpenCV build, supported input codec, authorized URL, and network access. Having the `ffmpeg` executable installed is not the backend-presence check; OpenCV provides `videoio_registry.hasBackend`. Open/read timeout properties are documented for FFmpeg and GStreamer. Sources: [OpenCV backend enablement](https://docs.opencv.org/4.13.0/d0/da7/videoio_overview.html), [opencv/opencv:modules/videoio/include/opencv2/videoio.hpp:193–201](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L193-L201).

**Audio caveat:** do not say “OpenCV has no audio support,” but do not promise audio from this example. OpenCV defines audio properties, with audio disabled by default. Its reviewed GStreamer backend supports only the first audio stream and leaves some audio timing properties unsupported; the reviewed FFmpeg capture path discards packets outside its selected video stream. Sources: [opencv/opencv:modules/videoio/include/opencv2/videoio.hpp:200–209](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L200-L209), [opencv/opencv:modules/videoio/src/cap_gstreamer.cpp:1382–1385](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_gstreamer.cpp#L1382-L1385), [1929–1940](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_gstreamer.cpp#L1929-L1940), [opencv/opencv:modules/videoio/src/cap_ffmpeg_impl.hpp:1671–1683](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L1671-L1683).

### 2. RTSP/H.264 → GStreamer → OpenCV, latest-frame policy

Using the helper above:

```python
pipeline = (
    'rtspsrc location="rtsp://camera.example/stream" '
    'protocols=tcp latency=100 drop-on-latency=true ! '
    'application/x-rtp,media=video,encoding-name=H264 ! '
    'rtph264depay ! h264parse ! avdec_h264 ! '
    'videoconvert ! video/x-raw,format=BGR ! '
    'appsink name=opencvsink max-buffers=1 drop=true '
    'sync=false wait-on-eos=false'
)
frame = read_one(pipeline, cv2.CAP_GSTREAMER)
```

This requires an H.264 video track and the named installed elements. The depayloader accepts H.264 RTP; the parser produces H.264 elementary-stream caps; the decoder produces raw video. These are distinct operations, not generic URL-to-pixel magic. Sources: [`rtph264depay`](https://gstreamer.freedesktop.org/documentation/rtp/rtph264depay.html), [`h264parse`](https://gstreamer.freedesktop.org/documentation/videoparsersbad/h264parse.html), [`avdec_h264`](https://gstreamer.freedesktop.org/documentation/libav/avdec_h264.html).

The sink configuration is intentional:

- `max-buffers=1` bounds the **appsink queue**, while `drop=true` discards old queued buffers instead of blocking indefinitely behind a slow consumer.
- `sync=false` disables sink clock waiting; it does not eliminate upstream buffering.
- `wait-on-eos=false` avoids waiting indefinitely for an absent consumer during EOS handling.
- `latency=100` and `drop-on-latency=true` configure the RTP jitterbuffer, **not a 100 ms end-to-end guarantee**.

Sources: [appsink properties](https://gstreamer.freedesktop.org/documentation/app/appsink.html), [base-sink synchronization](https://gstreamer.freedesktop.org/documentation/base/gstbasesink.html), [`rtspsrc` latency properties](https://gstreamer.freedesktop.org/documentation/rtsp/rtspsrc.html#rtspsrc:latency).

On GStreamer 1.28+, `drop` is deprecated in favor of `leaky-type`; use the oldest-buffer-dropping policy appropriate to that installed version. The example retains `drop=true` for older deployments. OpenCV’s source explicitly documents manual appsink naming and the need to request dropping for live pipelines. Sources: [appsink versioned properties](https://gstreamer.freedesktop.org/documentation/app/appsink.html#appsink:drop), [opencv/opencv:modules/videoio/src/cap_gstreamer.cpp:1342–1350](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_gstreamer.cpp#L1342-L1350).

### 3. Aravis GigE Vision acquisition pipeline

A Linux-oriented acquisition/caps smoke test:

```text
gst-inspect-1.0 aravissrc
arv-tool-0.8
arv-tool-0.8 --name "ENUMERATED_ID" features

gst-launch-1.0 -v aravissrc camera-name="ENUMERATED_ID" num-arv-buffers=16 do-timestamp=true ! "video/x-raw,format=GRAY8,width=640,height=480,framerate=30/1" ! fakesink sync=false
```

Substitute an enumerated ID and a supported format tuple. `arv-tool-0.8` lists IDs and addresses. The selector is **`camera-name`**, forwarded to `arv_camera_new()`; the separate `camera` property is read-only. `Mono8` is mapped to GStreamer `GRAY8`. Sources: [AravisProject/aravis:src/arvtool.c:829–847](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvtool.c#L829-L847), [AravisProject/aravis:gst/gstaravis.c:435–443](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/gst/gstaravis.c#L435-L443), [1031–1042](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/gst/gstaravis.c#L1031-L1042), [AravisProject/aravis:src/arvmisc.c:652–658](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvmisc.c#L652-L658).

**USB3 qualification:** this plugin opens through the same Aravis camera abstraction supporting GigE Vision and USB3 Vision; there is no separate `usb-camera-id` selector. However, the GStreamer plugin and USB support are optional build features, and USB requires libusb and suitable device permissions. Sources: [AravisProject/aravis:meson_options.txt:3–6](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/meson_options.txt#L3-L6), [AravisProject/aravis:meson.build:69–84](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/meson.build#L69-L84), [AravisProject/aravis:docs/reference/aravis/usb.md:5–15](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/docs/reference/aravis/usb.md#L5-L15).

This example intentionally uses `fakesink`, which consumes/discards buffers rather than providing application images. **A significant production caveat exists in reviewed Aravis 0.8.36:** the aligned-image path wraps native buffer memory and immediately requeues the native buffer, with a lifetime-related FIXME. Do not promise safe retained, zero-copy appsink frames from that implementation. A production adapter needs verified lifetime handling or a copy **before native-buffer requeue**, not merely a copy after `VideoCapture.read()`. Sources: [GStreamer `fakesink`](https://gstreamer.freedesktop.org/documentation/coreelements/fakesink.html), [AravisProject/aravis:gst/gstaravis.c:592–625](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/gst/gstaravis.c#L592-L625).

### 4. OS-local UVC configuration on Windows

For a device actually exposed through Windows DirectShow:

```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
ffmpeg -hide_banner -list_options true -f dshow -i 'video=CAMERA_NAME'

ffmpeg -hide_banner -f dshow -video_size 640x480 -framerate 30 -pixel_format yuyv422 -i 'video=CAMERA_NAME' -t 5 -f null -
```

The last command requests a specific raw tuple and ingests five seconds without creating a recording. Choose a tuple from the preceding enumeration; FFmpeg documents that unsupported DirectShow options cause opening to fail. Use the returned device name or alternative name, including duplicate-device selection where necessary. Sources: [FFmpeg/FFmpeg:doc/indevs.texi:496–555](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L496-L555), [653–690](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L653-L690).

A microphone is a separately selected audio device: DirectShow input syntax permits `video=NAME:audio=NAME`. Do not infer microphone identity, clock alignment, or availability from the video name. Opening both in one input is supported and documented as potentially improving synchronism. Source: [FFmpeg/FFmpeg:doc/indevs.texi:498–513](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/indevs.texi#L498-L513).

### 5. HTTP still and file/HTTP clip reads, with explicit lifetimes

Using `read_one` from example 1:

```python
from urllib.request import urlopen
import numpy as np

def fetch_still(url):
    limit = 8 * 1024 * 1024
    with urlopen(url, timeout=5) as response:
        encoded = response.read(limit + 1)

    if len(encoded) > limit:
        raise ValueError("Encoded still exceeds configured byte limit")

    image = cv2.imdecode(
        np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR
    )
    if image is None:
        raise ValueError("Response is not a decodable still image")
    return image

still = fetch_still(os.environ["CAMERA_SNAPSHOT_URL"])
first_local_frame = read_one(r"D:\media\clip.mp4", cv2.CAP_FFMPEG)
first_http_frame = read_one(os.environ["CLIP_HTTPS_URL"], cv2.CAP_FFMPEG)
```

The HTTP response is closed after reading its bytes; decoding consumes an in-memory buffer. `imdecode` is the appropriate OpenCV entry point for those bytes, whereas `imread` loads a filesystem image. The byte limit here is not a decoded-pixel budget. Sources: [Python HTTP request API](https://docs.python.org/3.13/library/urllib.request.html#urllib.request.urlopen), [opencv/opencv:modules/imgcodecs/include/opencv2/imgcodecs.hpp:372–386](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/imgcodecs/include/opencv2/imgcodecs.hpp#L372-L386), [586–597](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/imgcodecs/include/opencv2/imgcodecs.hpp#L586-L597).

These clip calls intentionally retrieve one frame and release the decoder/session. For whole-clip ingestion, define EOF, decode failure, cancellation, and pacing separately; `VideoCapture.read()` ultimately returns whether it produced a nonempty image, not a rich termination reason. Source: [opencv/opencv:modules/videoio/src/cap.cpp:521–564](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap.cpp#L521-L564).

**URI lifetime is separate from request/session lifetime.** ONVIF Media1 requires stream and snapshot URIs to remain valid indefinitely; the actual `MediaUri` schema specifies `InvalidAfterConnect=false`, `InvalidAfterReboot=false`, and `Timeout=PT0S`. A snapshot URI is fetched with HTTP GET. Do not interpret that URI timeout as an RTSP keepalive timeout or an artifact-retention promise. Sources: [ONVIF Media WSDL—`GetStreamUri` and `GetSnapshotUri`](https://www.onvif.org/ver10/media/wsdl/media.wsdl), [ONVIF `MediaUri` schema](https://www.onvif.org/ver10/schema/onvif.xsd).

### 6. FFmpeg pulls RTSP audio/video and publishes to a relay

```powershell
ffmpeg -hide_banner `
  -rtsp_transport tcp -timeout 5000000 `
  -i "$env:CAMERA_RTSP_URL" `
  -map 0:v:0 -map '0:a:0?' -c copy `
  -f rtsp -rtsp_transport tcp `
  "$env:RELAY_RTSP_PUBLISH_URL"
```

The input is a client-initiated playback session. The output publishes to an **existing server supporting RTSP publication/ANNOUNCE**; this command does not itself deploy a general-purpose fanout server. TCP mode interleaves RTP within the RTSP connection; the input timeout is in microseconds. Source: [FFmpeg/FFmpeg:doc/protocols.texi:1225–1261](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/protocols.texi#L1225-L1261), [1307–1381](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/protocols.texi#L1307-L1381).

The mapping requires the first video stream and optionally includes the first audio stream. Remove `?` if missing audio must be an error. `-c copy` avoids decoding/re-encoding, but still requires output codec/packetization compatibility and cannot perform pixel-domain filtering. Sources: [FFmpeg/FFmpeg:doc/ffmpeg.texi:1837–1852](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L1837-L1852), [202–220](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L202-L220).

Do not add `-re` reflexively to a live-camera input. FFmpeg documents it as input pacing, primarily useful for simulating real-time ingestion from files, and warns that inappropriate live-input pacing can cause packet loss. Source: [FFmpeg/FFmpeg:doc/ffmpeg.texi:1980–1994](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L1980-L1994).

## Push/pull, clocks, and backpressure

**Use separate vocabulary for three independent directions:**

| Dimension | Example |
|---|---|
| Session initiation | Connector initiates camera playback; publisher initiates relay publication. |
| Media direction | Camera sends media toward connector; connector sends media toward relay. |
| Local application scheduling | `appsink.pull_sample()` waits for locally queued samples, regardless of who initiated the network session. |

GStreamer separately defines pad-level push/pull scheduling, including `pull_range()`. Appsink’s pull API retrieves samples from its internal queue; it is not evidence that the camera waits for a per-frame network request. Sources: [GStreamer scheduling](https://gstreamer.freedesktop.org/documentation/additional/design/scheduling.html), [appsink pull-sample semantics](https://gstreamer.freedesktop.org/documentation/app/appsink.html#appsink::pull-sample).

**Preserve timestamp provenance.** RTP timestamps have payload-dependent clock rates and independent initial offsets; directly comparing audio and video RTP timestamps is ineffective. RTCP sender reports provide reference-clock/RTP timestamp pairs. Even an NTP-format timestamp does not prove the sender has an accurate absolute clock. Source: [RFC 3550 §5.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1), [§6.4.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-6.4.1).

GStreamer running time depends on its clock, base time, timestamps, and segment mapping. OpenCV’s FFmpeg `CAP_PROP_PTS` uses an FPS time base, not UTC. Reviewed Aravis distinguishes device time from host receipt time, while its plugin can rebase camera timestamps against the first frame; `do-timestamp=true` changes that stamping behavior. Sources: [GStreamer clocks](https://gstreamer.freedesktop.org/documentation/application-development/advanced/clocks.html), [opencv/opencv:modules/videoio/include/opencv2/videoio.hpp:214–215](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L214-L215), [AravisProject/aravis:src/arvbuffer.c:378–436](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvbuffer.c#L378-L436), [AravisProject/aravis:gst/gstaravis.c:575–622](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/gst/gstaravis.c#L575-L622).

PTP synchronization also does not by itself guarantee simultaneous exposures. Supported cameras, clock convergence, suitable infrastructure, and acquisition synchronization must be considered separately. Basler documents both PTP and additional Synchronous Free Run behavior. Sources: [Basler PTP](https://docs.baslerweb.com/precision-time-protocol), [Basler Synchronous Free Run](https://docs.baslerweb.com/synchronous-free-run).

**Backpressure must be defined at each queue.** GStreamer queues block when full unless configured to leak; appsink can independently block or drop. Native Aravis acquisition buffers require requeueing, and GigE reception can report underruns, missing packets, and timeouts. Blocking an application therefore must not be advertised as guaranteed sensor throttling. Sources: [GStreamer queue behavior](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html), [AravisProject/aravis:src/arvstream.c:84–130](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvstream.c#L84-L130), [AravisProject/aravis:src/arvgvstream.c:795–833](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvstream.c#L795-L833).

For inference, dropping stale decoded frames can be an appropriate policy; recording may require a different policy. Do not treat arbitrary compressed-packet loss as equivalent: GStreamer’s H.264 depayloader explicitly provides keyframe-request/recovery behavior after loss. Source: [`rtph264depay` loss-recovery properties](https://gstreamer.freedesktop.org/documentation/rtp/rtph264depay.html).

## Connector placement and actionable requirements

**Recommended placement:** put USB acquisition where the USB interfaces are accessible, and industrial acquisition where the required NIC, discovery scope, SDK/producer, and control privileges exist. Treat an appsink and a `VideoCapture` instance as process-local resources. A remotely usable output requires an explicit forwarding, publication, or serving component—not merely publishing the local device selector. This recommendation follows the transport/locality and API evidence above.

**Recommended fanout:** acquire/control once where necessary, then distribute downstream. A GStreamer `tee` needs a queue or multiqueue per branch to isolate execution, but a full blocking branch can still propagate pressure. Each subscriber needs an intentional lag, drop, disconnection, or durable-spooling policy. Sources: [GStreamer `tee`](https://gstreamer.freedesktop.org/documentation/coreelements/tee.html), [queue limits](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html).

Distinguish **relay/repackaging** from **transcoding**. The FFmpeg example can retain compatible compressed streams without pixel decoding. Raw industrial imagery destined for a compressed distribution format requires additional transformation/encoding. Neither route justifies a blanket throughput claim; provision from actual payload sizes, formats, conversion work, copies, subscriber count, and measured queue/frame age. The processing distinction is documented in [FFmpeg/FFmpeg:doc/ffmpeg.texi:114–122](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L114-L122) and [202–220](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L202-L220).

The resulting configuration requirements are:

| Concern | Information the connector should carry |
|---|---|
| Identity and discovery | Discovery mechanism, worker/network scope, stable device identity, resolved locator, last successful observation. |
| Runtime dependencies | Host/process placement, backend and version, plugins, SDK/GenTL producer, device/NIC access. |
| Control ownership | Controller versus observer role, permitted camera changes, trigger source, readiness and acquisition lifecycle. |
| Desired versus effective format | Requested source tuple, camera readback, negotiated transport/track formats, delivered pixel/audio format, mismatch policy. |
| Audio | Required/optional status, selected track/device, codec, sample format/rate/channels, synchronization requirements. |
| Timing | Device timestamp, receive timestamp, presentation time, clock domain, epoch/time base, synchronization status and uncertainty. |
| Pressure and latency | Per-stage queue limits, block/drop policy, reconnect/timeouts, frame-age budget, loss/underrun counters. |
| Lifetime and distribution | Finite/live resource, seek/replay policy, URI versus session/auth lifetime, retained-buffer ownership, relay/fanout ownership. |

**Remaining evidence limits:** these are not hardware, interoperability, latency, or throughput results. The complete USB3 Vision specification was not available through unrestricted public access; A3’s official download process requires a reviewed request, so no certification-level claim is made. Source: [A3 USB3 Vision specification access](https://www.automate.org/vision/vision-standards/usb3-vision-standard-download-standard-specification).