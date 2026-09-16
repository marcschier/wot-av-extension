# Linux capture-v1 integration contract (informative sample)

This sample adds `linux-v4l2`, `aravis-gige`, `aravis-usb3`, and `aravis-fake`.
It does not change AV, ONVIF, any canonical model, or the native RTSP protocol.
Linux compilation/linking and all six software CTest cohorts, including actual
Aravis Fake execution, **passed on 2026-09-16** in an isolated Ubuntu 24.04
x86_64 VM. All real V4L2/GigE/USB hardware qualification remains **unverified**.

The worker accepts `--stdio` and exactly the staged capture-v1 binary framing:
8 little-endian header bytes, UTF-8 JSON, owned payload; 65,536 metadata bytes,
16 MiB output, 32 MiB individual native buffers, dimensions at most 4096.
It never prints selectors, SDK error messages or debugging to stdout/stderr.
`hello.nativeBackends` lists compiled backends only; requesting a compiled-out
Aravis backend returns `MissingDependency`. No discovery takes place at startup.

## Selections and native access

* V4L2: `privateSelector` is one absolute Linux device path, not a glob.
  Scope `linux-device-node`; native subtype `V4L2:YUYV` or `V4L2:MJPG`;
  mode prefix `v4l2-` followed by 32 lowercase SHA-256 hex characters.
  Identity hashes descriptor-verified realpath, device/inode/rdev, driver,
  card and bus information. It is topology/instance scoped, **not** a global
  serial. `serial:null, transport:"unknown"` are intentional.
* Aravis: selector is a flat JSON object of **string values only**, encoded as
  UTF-8 hex on stdin. Duplicate/unknown keys and escaped controls/unicode are
  rejected. Non-ASCII UTF-8 can be literal; `\"`, `\\`, `\/` are supported.
  Common required keys: `vendor`, `model`, `serial`, `pixelFormat` (`Mono8` or
  `RGB8`), `width`, `height`, `x`, `y`. Geometry values are canonical unsigned
  decimal strings; x/y may be zero. No feature setter supplies these values:
  all must match actual current camera getters.
  GigE additionally requires `localAddress` and `cameraAddress`, both literal
  unicast IPv4 addresses (no hostname, interface scan or subnet discovery).
  USB additionally requires `permitLibraryEnumeration:"yes"` and
  `permitDriverDetach:"yes"`. Stock Aravis enumerates the libusb device list
  and opens candidate handles to read descriptors, not just the selected
  camera; these permissions explicitly cover that behavior. No constrained
  USB-open claim is made.
  Fake has no extra keys, selects **only** the SDK `Fake` interface, and uses
  `Fake_1` with vendor `Aravis`, model `Fake`, serial `1`, current defaults
  (normally Mono8, 512x512, x=0, y=0). This is SDK-generated software data.
  Scopes are `aravis-gige-endpoint`, `aravis-usb-identity`, `synthetic-aravis`.
  Native subtypes `Mono8`/`RGB8`; prefix `arv-` plus 32 lowercase hex.

Both mode kinds have nativeMediaType `video`, progressive interlace,
native stride (zero for compressed MJPG; Aravis's minimum packed row size), nullable rational
cadence, and `evidenceLocator`. Additional `nativeDetails` preserves a
canonical native tuple. Mode IDs/digests hash actual tuple values, not labels.
Aravis cadence is null: no fabricated rate from unrelated camera features.

## Evidence workflow (no unreachable fresh digest)

`describe` and `open` retain the staged five/fourteen-field layouts:

```
describe BACKEND SELECTOR_HEX EXPECTED_SHA256 permit-native-read
open BACKEND SELECTOR_HEX EXPECTED_SHA256 EVIDENCE_SHA256 MODE_ID JPEG|I420 MAX_W MAX_H MAX_NATIVE MAX_FRAME READ_MS DURATION_MS permit-acquisition
next
close
```

The spaces above denote tabs. `describe` with `permit-native-read` works for
V4L2, but **fails PolicyDenied before construction for every Aravis backend**:
GigE construction attempts control; USB construction claims interfaces.
Explicit control-session evidence uses the same describe fields, replacing
the permission with `permit-control-probe`. It returns evidenceKind
`authorized-session-probe` (`synthetic` for Fake), reads the configured current
tuple, closes without starting acquisition, and reports cleanup failures.
The Node layer must expose a distinct authorized probe option or operator
tool; it must not label this native-read-only.

Separate operator-only `identify BACKEND SELECTOR_HEX PERMISSION` has four
fields and obtains initial identity/evidence for that **exact configured**
target. V4L2 permission is `permit-native-read`; Aravis permission is
`permit-control-probe`. Aravis still compares actual vendor/model/serial and
geometry to the private selection before evidence. This command is not
discovery and does not accept an empty target. Its fault operation is
`describe`. `linux-probe.py` supports this explicit private workflow.
Public `describe`/`open` always require an actual lowercase 64-hex fingerprint;
no sentinel digest or identity bypass is accepted.

Save returned identity/modes/digest as operator-supplied cached evidence, then
use `open` with their exact IDs. At open the worker freshly verifies identity
and the entire evidenced tuple set, rejecting drift before streaming. Aravis
does not set region, format, cadence, exposure, focus, trigger or PTZ.
Acquisition/session permission is local sample policy, not a normative grant
or lease control plane.

## Timing and terminal records

`hostReceiptMonotonicNs` is Linux CLOCK_MONOTONIC at native dequeue/pop.
`pipelinePtsNs:null`, `source:null`; neither backend invents exposure time or
UTC. V4L2 adds `nativeTimestampNs` (nullable), `nativeTimestampClock`
(`monotonic`, `copy`, `unknown`), `nativeTimestampPoint`
(`start-of-exposure` or `end-of-frame` per driver flags), and `nativeSequence`.
Aravis adds `cameraTimestampNs`, `sdkSystemTimestampNs`, `nativeFrameId`.
All unsigned 64-bit values are canonical decimal strings, not JSON numbers.
`sdkTimeProvenance` identifies the native API and expressly disclaims UTC or
exposure-clock synchronization.

Fault codes use the staged SourceFault allowlist. `nativeDomain` may be
`errno`, `Aravis` or `libjpeg`; `nativeCode` is signed decimal, not HRESULT.
Truncated/error native buffers are failures, never successful images.
Close follows staged `closed` / acquisitionStop / resources / faults.
GigE uses checked explicit `arv_gv_device_leave_control`, not just finalizers.
Stock USB exposes no checked interface-release API; its finalizer ignores
libusb release results. Consequently USB close reports resources `unknown`
and `CleanupFailed`, even after a successful capture. That policy limitation
is not hidden as successful hardware cleanup.

An evidence packet can precede a failed close receipt (notably stock USB).
Operator tooling can preserve that observation, but must not turn the failed
cleanup into a successful probe. The shared Node API should reject the close
failure; an operator can explicitly supply the saved tuple for a later session.

## Build/test entry and qualification boundary

The canonical software-only entry is now
`onvif/tools/adapters/linux/build-test.sh`, delegating to the existing native
build script. On an **approved Linux runner**, the default/`--system-aravis`
path requires an existing exact `aravis-0.8` 0.8.36 installation and performs no
fetch. `--aravis-source CHECKOUT` verifies and builds a pristine offline checkout;
only explicit `--bootstrap-aravis` permits fetching the locked public commit.
`--without-usb` and `--without-aravis` are explicit coverage reductions, never
automatic responses to a missing development dependency.

Source pins, minimum system prerequisites, upstream license provenance and
commands are in [`tools/adapters/linux/README.md`](../../../../tools/adapters/linux/README.md).
The newly defined `.github/workflows/camera-adapters.yml` provisions ephemeral
`ubuntu-24.04` software-only jobs after owner integration/push/dispatch. Writing
the workflow did not execute it or approve this host for Linux execution.

The extra V4L2 test compiles the actual translation unit against simulated
path/descriptor/ioctl/poll replies and anonymous memfd-backed buffers. It never
opens a device node and is not a driver/device protocol test. Actual Aravis SDK
tests use only exact `Fake_1`, with all real interfaces disabled before camera
creation. They do not use a network fake-camera daemon or multicast discovery.

Actual GNU 13.3.0/CMake 3.28.3 Linux builds passed with the pinned Aravis 0.8.36
SDK, system libjpeg and OpenSSL. The full and SDK-without-USB variants each
passed six CTest cohorts; explicit V4L2-only passed four. The final full cohort
ran on one built state with all 23 input files and five ELF binary hashes
unchanged before/after. Actual SDK Fake JPEG/I420 frames were exported for
independent decoding/plane checks. Details are in the linked build README.

This is native software qualification, not a Linux Node/HTTP deployment,
kernel camera-driver or real-camera pass. All hardware gates and
the stock USB cleanup limitation above are unchanged. Host-portable parser
results alone still are not Linux execution evidence.
