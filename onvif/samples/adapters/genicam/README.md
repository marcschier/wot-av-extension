# Direct Aravis camera backend

This is an informative C++17 backend, not a companion model, ONVIF server,
GStreamer element or hardware qualification. See
[`native/linux/CONTRACT.md`](../native/linux/CONTRACT.md) for exact private
selection, framing, identity, evidence and timing schemas.

## Source/API pin

Aravis **0.8.36**, Git tag resolving to
`97ff5e330919d7a44b871df4eda669feeafdf342`.
Primary source URL prefix:
`https://raw.githubusercontent.com/AravisProject/aravis/97ff5e330919d7a44b871df4eda669feeafdf342/src/`.
The following public headers and relevant implementation were initially read
as source. The complete pinned SDK was subsequently built in an isolated Linux
qualification VM; the adapter's API contract and SDK Fake cohorts passed.
No SDK implementation is vendored into this repository.

| File | SHA-256 |
|---|---|
| arvbuffer.h | `0cf34dba30d170b4c2008fac77bcdb1c1c34dd1ee481163487634ef4fcb9490f` |
| arvcamera.h | `274eba7f30df1b60a22a50121e7981879711e1ec3921e64ced062a398cebe6e1` |
| arvgvdevice.h | `04859a19d632b201859db2f34e3191eb1bfc69ba2502d516f3ee44891f6ab013` |
| arvgvstream.h | `1ad30cbdab19f90bcbe54c8a30d5b25cf728854cc0fe203fff78ac215a5a2ad2` |
| arvuvdevice.h | `cb63f43115a44825a9724152b8ca255bc4600d45860575a5862e426cb5fe52bf` |
| arvstream.h | `8fff70f1c4d507bfc6ecd57783dcf57ca5666f6a997de8206d21eb6540890ac3` |
| arvsystem.h | `ea4ffeb83c17cb8675f22e6948ce2f012bfbf0ba286a19f5b3131a2e9c95a931` |
| arvdevice.h | `ca63cbdf7f1bafb48baceeacaa17c3490a9b88eaf19dbca770a202bb2381c729` |
| arvgvdevice.c | `6894d67c7e7158677af49bd055fa32e15f79f99c5c3f12bad316c9785fabdac6` |
| arvuvdevice.c | `99003cee79381649aaa40b34ece03bf3e14f4bf7f70aa9f64829292978a52858` |
| arvbuffer.c | `da71ee9385378164b366538fd2afb2c9d090793fc8686e331b861fa2f09de3ac` |
| arvcamera.c | `c519ed64089e36268e8e7e2ee092675cc2a287c60ab2542680fceeda3f0301c9` |
| arvfakeinterface.c | `0efbd2dc64c325ef118842079835ed3fecec97f4e8dc7dee2e7cbaa72afadc4b` |
| arvsystem.c | `eafd42cd8c03156ea239b4d490bc53ea147ebd639487f3ad64dd16cc64bb15a0` |
| arvgvstream.c | `8ef52e1d5217abfee592a1c45addec568d8ebdba6d9ab328b1041dbcc06aa0cb` |
| arvfakestream.c | `d7e0543bbc4fb47ef1aef8669070943a9a68d83c1cd55a2eb4a6c2175dcc004e` |
| arvstream.c | `ab5d1a8326b4ba8b84bcfb8a79520c6b84ded0b40141494b22a7ac041c2b7396` |

### Verified signatures and access implications

* `ArvDevice *arv_gv_device_new(GInetAddress*, GInetAddress*, GError**)`:
  direct selected interface/camera IP; construction attempts control and
  downloads that camera's GenICam XML. No broad GV discovery is called.
* `ArvCamera *arv_camera_new_with_device(ArvDevice*, GError**)`: camera owns an
  additional reference; backend retains its original device reference.
* `const char *arv_camera_get_vendor_name/get_model_name/get_device_serial_number(ArvCamera*, GError**)`:
  actual identity readback is compared to configured expectation.
* `void arv_gv_device_set_packet_size_adjustment(ArvGvDevice*, ArvGvPacketSizeAdjustment)`:
  uses `ARV_GV_PACKET_SIZE_ADJUSTMENT_NEVER` before creating a stream.
* `void arv_gv_device_set_stream_options(ArvGvDevice*, ArvGvStreamOption)`:
  disables packet sockets; no raw-socket privilege/elevation is requested.
* `void arv_camera_get_region(ArvCamera*, gint*, gint*, gint*, gint*, GError**)`,
  `ArvPixelFormat arv_camera_get_pixel_format(ArvCamera*, GError**)`,
  `guint arv_camera_get_payload(ArvCamera*, GError**)`: current configured mode
  only. Supported PFNC constants are Mono8 `0x01080001` and RGB8 `0x02180014`.
* `ArvStream *arv_camera_create_stream(ArvCamera*, ArvStreamCallback, void*, GError**)`;
  `ArvBuffer *arv_buffer_new_allocate(size_t)`; four bounded buffers.
* `ArvBuffer *arv_stream_timeout_pop_buffer(ArvStream*, guint64 timeout_us)`;
  `void arv_stream_push_buffer(ArvStream*, ArvBuffer*)`: the popped buffer remains
  alive while its bytes/metadata are copied; scope guard requeues exactly once,
  including validation failures. Conversion/encoding occurs after copying.
* `ArvBufferStatus arv_buffer_get_status(ArvBuffer*)`;
  `ArvBufferPayloadType arv_buffer_get_payload_type(ArvBuffer*)`;
  `const void *arv_buffer_get_data/get_image_data(ArvBuffer*, size_t*)`;
  `void arv_buffer_get_image_region/get_image_padding(...)`: validates part
  count, no chunks/GenDC, geometry, PFNC, size, pointer containment and stride.
  Horizontal byte padding is supported; nonzero vertical padding is rejected.
* `guint64 arv_buffer_get_timestamp/get_system_timestamp/get_frame_id(ArvBuffer*)`:
  each is preserved separately, without labeling SDK time as UTC/exposure.
* `void arv_camera_start_acquisition/stop_acquisition(ArvCamera*, GError**)`:
  checked start/stop, no trigger/exposure or arbitrary feature setter.
* `gint arv_camera_gv_get_current_stream_channel(ArvCamera*, GError**)`;
  `gboolean arv_device_write_register(ArvDevice*, guint64, guint32, GError**)`:
  selected GV stream channel stop at `0xd00 + 0x40*channel`, exactly the
  transport stop performed (unchecked) in 0.8.36's stream finalizer.
* `gboolean arv_gv_device_leave_control(ArvGvDevice*, GError**)`: checked release
  only when the constructor reports owned control; finalizer alone is not proof.
  SDK finalizers repeat their own stop/release operations without exposing errors.
* `void arv_select_interface(const char*)` (since 0.8.35): `"Fake"` disables
  **every other interface before** `arv_camera_new("Fake_1", GError**)`.
* `ArvDevice *arv_uv_device_new(const char*,const char*,const char*,GError**)`:
  stock libusb enumeration and candidate descriptor opens, then auto detach and
  interface claims. Requires both explicit private permissions. Build requires
  `ARAVIS_HAS_USB==1`; runtime requires libusb detach capability. Aravis does not
  expose the actual result of its auto-detach policy call. No constrained-open,
  uniqueness across duplicate USB identity strings or driver-reattach guarantee
  is claimed. Interface-release results are not exposed, so USB cleanup is
  always reported unknown/failed, never successfully qualified.

## Prerequisites and third-party licensing

System packages only: Linux C++17 compiler/UAPI headers; CMake >=3.20;
pkg-config; Python >=3.9 for checks; OpenSSL >=1.1.1 development files; a system
libjpeg-compatible implementation with `jpeg_mem_src` (libjpeg-turbo recommended);
Aravis exactly 0.8.36; optional libusb >=1.0.16 and USB-enabled Aravis.
Native CMake never installs/downloads dependencies and has no GStreamer dependency.
The separate approved-runner `tools/adapters/linux/build-test.sh` permits a
locked private source build only with an explicit source/bootstrap option.

Aravis is LGPL-2.1-or-later; GLib/GObject/GIO are LGPL-2.1-or-later; libusb is
LGPL-2.1-or-later. libjpeg-turbo includes IJG, BSD-style and zlib licensing;
consult the installed distribution's license files. OpenSSL 3.x is Apache-2.0;
OpenSSL 1.1.1 has its earlier OpenSSL/SSLeay licensing. Linux UAPI headers carry
their own syscall-interface licensing exceptions. These are dependency notices,
not a new licensing assignment to this repository's first-party source.

## Software qualification and remaining hardware gates

Actual Linux GNU 13.3.0 compilation/linking against Aravis 0.8.36 and all six
native software cohorts passed on 2026-09-16. Both USB-enabled and USB-disabled
SDK builds were exercised through Fake only, with real interfaces disabled.
Actual worker JPEGs were independently decoded, and I420 planes, ownership,
failure handling and cleanup were covered by the software cohorts.
See [the build/qualification record](../../../tools/adapters/linux/README.md).

No real GigE/USB camera was constructed or acquired. Header/source verification
alone remains **not compilation**, and Fake is **not transport qualification**.
Device transport timing, USB driver behavior, GigE control handoff, latency,
disconnects, cameras with nonstandard XML and kernel/SDK allocations need an
explicit approved-target qualification. Adapter-owned buffers have finite
individual limits; SDK/OS allocations and total process memory are not hard capped.
