# Explicit-path Linux V4L2 backend

Single-plane `VIDEO_CAPTURE` + MMAP only. Select one configured absolute device
path: no globs, `/dev` scan, USB enumeration or automatically chosen camera.
The backend pins realpath to an `O_CLOEXEC|O_NONBLOCK|O_NOFOLLOW` descriptor and
checks character-device, inode/device/rdev identity across path/open readback.
Identity is local descriptor/topology evidence, not a global serial assertion.

`VIDIOC_QUERYCAP` honors `device_caps`. Read-only description opens O_RDONLY,
uses `G_FMT/G_PARM`, and bounded conditional `ENUM_FMT`, discrete frame sizes,
discrete frame intervals and exact `TRY_FMT` validation. Range/stepwise modes
are not expanded into invented tuples. At most 64 native entries per enumeration
and 96 evidenced modes are accepted; exceeding a cap fails rather than truncates.
Current mode remains eligible even when size/interval enumeration is unsupported.
Cadence requires actual `TIMEPERFRAME` support; unsupported drivers fail closed.

Acquisition opens O_RDWR, matches fresh evidence, uses S_FMT/S_PARM and exact
G_FMT/G_PARM readback, requests at most four buffers, bounds QUERYBUF lengths
before mmap, queues and STREAMONs only the owned fd. Poll/dequeue uses a finite
deadline. Index/status/bytesused/layout validation precedes copying, and every
valid dequeued slot is requeued once after its bytes are owned. Malformed native
indexes cannot be safely requeued: the source is stopped/closed instead.
STREAMOFF, unmap, REQBUFS(0) and fd-close outcomes reach the close receipt.
Failed close(EINTR) is not retried against a potentially reused Linux fd.

Supported inputs are progressive even-width YUYV with actual BT.601 matrix and
limited range, and MJPEG decoded/geometry-validated by system libjpeg before
JPEG re-encoding or I420 conversion. Unknown colorimetry, multi-plane, Bayer,
interlacing and truncated/error frames fail. No exposure/focus/PTZ/trigger setter
is used. Selected format/cadence may remain configured after the session; the
backend does not issue unrequested restoration writes.

Build/selection/timing details: [`native/linux/CONTRACT.md`](../../native/linux/CONTRACT.md).
Linux API reference: <https://www.kernel.org/doc/html/v6.8/userspace-api/media/v4l/v4l2.html>.
**Linux compilation and simulated-ioctl runtime passed on 2026-09-16; no real
device or kernel camera driver is qualified.** The fixture compiles this actual
translation unit with fail-closed wrappers and anonymous memfd buffers. It
checks exact pixels after immediate native-buffer reuse, short/error frames,
timeout, device-loss simulation, format drift and failed stop. See
[the build/qualification record](../../../../tools/adapters/linux/README.md).
