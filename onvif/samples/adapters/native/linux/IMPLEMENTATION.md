# Linux backend implementation and handoff — 2026-09-16

## Subsequent Linux software qualification

On 2026-09-16, the actual sources below compiled and linked in an isolated
Ubuntu 24.04 x86_64 VM with GNU 13.3.0 and pinned Aravis 0.8.36. All six native
software CTest cohorts passed; SDK-without-USB also passed six and V4L2-only
passed four. Exact final source/binary bytes were checked before and after
the full cohort. No production source correction was required.
See [the current build/qualification record](../../../../tools/adapters/linux/README.md).
All hardware and stock USB cleanup limitations remain unchanged.

The remaining sections preserve the **initial Windows authoring handoff**.
Their original not-executed statements describe that earlier pass, not the
current Linux software result.

## Outcome and qualification boundary

Real C++17 V4L2 and direct Aravis 0.8.36 capture paths are implemented, with a
binary capture-v1 worker and system libjpeg/OpenSSL integration. They are
**not Linux-compiled, Linux-executed or hardware-qualified in this session**.
No Docker/WSL/service/OS-feature startup, dependency install, device/NIC/USB
inspection, elevation, remote push or GitHub CI run was performed.
Public pinned SDK source was read in memory for API/ownership verification;
that evidence is not described as compilation.

The requested temporary-directory report is instead persisted here, inside
the owned backend documentation tree. No temporary source/SDK copy is needed.

## Exact delivered files

Under `onvif/samples/adapters/`:

* `native/common/bounds.hpp`, `bounds.cpp`: dependency-free C++17 checked
  sizes/geometry, canonical integer parsing, UTF-8/selector/framing validation,
  packed row copy, Mono8/RGB8/YUYV-to-RGB and BT.601 limited-range I420 conversion.
* `native/common/capture.hpp`: native source, evidence, owned frame and checked
  close declarations; not a root Node or normative API edit.
* `native/linux/runtime.cpp`: EVP SHA256, CLOCK_MONOTONIC, SourceFault translation,
  canonical actual-mode IDs/evidence digests and JSON records.
* `native/linux/jpeg.cpp`: bounded real system-libjpeg encode and decode; native
  JPEG dimensions and truncation are checked, no opaque pass-through image claim.
* `native/linux/worker.cpp`: capture-v1 little-endian binary packets, bounded
  ASCII/tab commands, exact-source access permissions, deadline-controlled
  stdin/stdout, single session, cleanup receipt. Inherited ARV_DEBUG is unset.
* `native/linux/CMakeLists.txt`: real Linux prerequisites/build/software tests;
  explicit `CAPTURE_WITH_ARAVIS=OFF` returns MissingDependency for Aravis.
* `native/linux/CONTRACT.md`: parent integration schema (read before Node changes).
* `uvc/linux/v4l2.cpp`, `uvc/linux/README.md`: explicit path, descriptor identity,
  bounded native tuples/TRY_FMT, exact S_FMT/S_PARM readback, four MMAP slots,
  poll/DQBUF/copy-before-QBUF and STREAMOFF/unmap/REQBUFS(0)/fd cleanup.
* `genicam/aravis.cpp`, `genicam/README.md`: actual GigE/USB/Fake API capture,
  identity/current-format validation, control-policy gates, owned ArvBuffers,
  checked stop/stream-channel release/GigE control release. README records the
  exact public source URL, Git pin, header/implementation hashes and API matrix.

Under `onvif/tools/`:

* `tests/adapters/linux/portable.cpp`, `CMakeLists.txt`: 103 portable safety
  assertions, standalone Windows/Linux C++17 test target.
* `tests/adapters/linux/jpeg.cpp`: future Linux system-codec/SHA256 tests.
* `tests/adapters/linux/protocol.py`: future Linux protocol-only no-device tests,
  no-Aravis MissingDependency test, and actual SDK Fake acquisition checks.
* `fixtures/adapters/linux/aravis-fake.json`: explicit SDK Fake-only selector.
* `adapters/scripts/check-linux-prereqs.sh`: fails real missing prerequisites,
  never installs dependencies or labels package detection as compilation.
* `adapters/scripts/linux-build.sh`: configure/build/CTest, never selects a real
  camera. `--without-aravis` and `--without-usb` are explicit build choices.
* `adapters/scripts/linux-probe.py`: explicit operator-only exact-target
  identity/current-tuple probe; preserves unsuccessful cleanup as unsuccessful.
* `adapters/scripts/linux-build-ci.informative.yml`: suggested manual CI on an
  already provisioned approved Linux builder, **not** an installed workflow.

## Parent integration requirements

See CONTRACT.md for finite selectors, timing and complete command layouts.
Add backend names, the scopes `linux-device-node`, `aravis-gige-endpoint`,
`aravis-usb-identity`, `synthetic-aravis`, and mode prefixes `v4l2-`/`arv-`.
Keep mode/nativeDetails and distinguish compressed MJPG stride zero from raw
positive stride. Linux timestamps are native/SDK/host provenance, not MF time.
Aravis evidence kind is `authorized-session-probe` (Fake `synthetic`); native
read-only permission must not be silently promoted to control/acquisition.
The existing five-field describe accepts a separate `permit-control-probe`
token only for Aravis. The separate four-field operator `identify` command
solves initial-identity bootstrap for the exact configured source, without
discovery or a digest sentinel. Describe/open still require real SHA256 hashes.

No mandatory lease/grant control plane is introduced. Existing Node ownership,
HTTP sample and local permission policy remain the parent's integration work.
No files outside the assigned Linux/common/GenICam/tests/fixtures/scripts trees
were intentionally edited; no Git commit was made.

## Tests actually executed

Existing Windows MSVC 19.51.36257.0, CMake via
`C:\Users\mschier\AppData\Local\Programs\Python\Python313\Scripts\cmake.exe`,
and `C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat`
in the **same cmd.exe invocation**, with VS Installer on PATH:

```
cmake -S onvif\tools\tests\adapters\linux -B onvif\tools\tests\adapters\linux\build-msvc -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Debug
cmake --build onvif\tools\tests\adapters\linux\build-msvc
onvif\tools\tests\adapters\linux\build-msvc\camera-portable-tests.exe
cmake --build onvif\tools\tests\adapters\linux\build-msvc --target test
```

Result: **103 portable assertions passed**, `/W4 /WX /permissive-`, CTest 1/1.
The first build printed a vswhere PATH warning but passed; final rebuild and
tests used PATH setup before vcvars and passed without that warning.

Python AST parsing passed for protocol.py/linux-probe.py. The Fake selector JSON
parsed; portable Python framing tests accepted a valid closed record and rejected
partial/oversize/invalid packets. No Fake SDK execution is implied.
Scoped `git diff --check` found no tracked whitespace errors; a separate check
passed for all 22 newly added text files, including Python AST checks.
Linux-worker CMake configuration on Windows failed
with the intended explicit Linux-platform prerequisite diagnostic (exit 1).
That negative gate is not a Linux compiler result.

Build artifacts were produced only in `tests/adapters/linux/build-msvc/` and
`tests/adapters/linux/build-platform-rejection/`. The existing ignore rules did
not cover these new trees, so generated artifacts were removed after testing.
The parent should add ignore patterns for
`onvif/tools/tests/adapters/linux/build-*/` and
`onvif/samples/adapters/native/linux/build-*/` when integrating. No .gitignore
change was made by this implementation. Test results remain recorded above.

## Runnable future Linux commands (NOT executed)

```
bash onvif/tools/adapters/scripts/linux-build.sh
bash onvif/tools/adapters/scripts/linux-build.sh --without-usb
bash onvif/tools/adapters/scripts/linux-build.sh --without-aravis
CAPTURE_SANITIZERS=ON bash onvif/tools/adapters/scripts/linux-build.sh
```

These require an explicitly approved Linux host and already installed
development dependencies. CTest defaults are portable memory, real libjpeg,
packet protocol, and (when enabled) Aravis's own Fake interface with **all real
transports disabled before camera creation**. No hardware target is implicit.

## Remaining gates and deliberately unsupported policy paths

* Linux compiler/linker, libjpeg/OpenSSL linking, actual Aravis 0.8.36 SDK
  runtime/Fake and every V4L2/GigE/USB hardware scenario remain unverified.
* Stock Aravis USB performs library enumeration/candidate descriptor opens and
  auto-detach attempts. Two explicit private permissions are required; there
  is no fabricated constrained libusb open. Without USB SDK support/development
  files/capability the path fails MissingDependency.
* USB's private finalizer does not expose interface-release/reattach results.
  The implemented permitted USB capture path is real, but cleanup necessarily
  reports unknown resources/CleanupFailed. Evidence can be retained by the
  operator alongside that failed receipt, never silently called a successful probe.
* SDK constructor-failure cleanup is not provable if no device object is
  returned; reports unknown resources. GigE release is explicitly checked when
  control was owned, though SDK finalizers repeat their own unchecked operations.
* Aravis supports present configured Mono8/RGB8 only; nonzero vertical padding,
  multipart/chunks/GenDC and arbitrary format/features are rejected. Camera/SDK
  timestamps are not synchronization or exposure guarantees.
* V4L2 requires bounded single-plane MMAP, progressive supported colorimetry,
  actual time-per-frame, and exact native tuple readback. No ranges are invented,
  no format restoration/control setter is issued outside approved acquisition.
* Per-buffer, packet, geometry, output and wait bounds do not imply a hard
  process-memory/SDK allocation cap. Blocking kernel/SDK construction/finalizers
  may still require the parent watchdog; forced termination is unknown cleanup.

Dependency licensing is documented in genicam/README.md. No first-party license
was assigned, no third-party implementation vendored, and no new GStreamer or
Node package dependency introduced.
