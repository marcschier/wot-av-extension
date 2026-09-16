# Linux adapter build and software qualification

**Linux compilation, linking and all six software cohorts passed on
2026-09-16. Every real-hardware combination remains unverified.** Qualification
used an isolated local Ubuntu VM, not Windows stubs or a GitHub workflow run.
No real camera, host NIC/USB device, host service or OS feature was accessed
or changed.

The stable entry is `build-test.sh`. It delegates native configuration,
compilation and CTest to the existing `../scripts/linux-build.sh` rather than
maintaining another worker build graph. Paths resolve from the script location,
not the caller's working directory. The C++ implementation and exact
`aravis-0.8=0.8.36` CMake requirement are unchanged.

## Recorded Linux software result

| Item | Executed qualification |
| --- | --- |
| Runner | Ubuntu 24.04.5 x86_64, Linux 6.8.0-139-generic, QEMU TCG 11.1.0, 2 vCPUs / 4096 MiB |
| Toolchain | GNU C++ 13.3.0, CMake 3.28.3, Meson 1.3.2, Ninja 1.11.1, Python 3.12.3 |
| Native dependencies | Aravis 0.8.36, OpenSSL 3.0.13, libjpeg-turbo 2.1.5, GLib 2.80.0, libusb 1.0.27 |
| Full Aravis/USB build | Explicit bootstrap, actual source compilation/linking; six of six CTest cohorts passed |
| Aravis without USB | Same locked pristine source built with SDK USB disabled; six of six cohorts passed |
| Explicit V4L2-only build | Four of four applicable cohorts passed, including compiled-out Aravis rejection |
| Final full build | Restored full SDK configuration; all six cohorts rerun on one unchanged built state, zero failures/skips |
| Additional checks | 16 Python framing/definition/source-policy tests; two actual SDK Fake JPEGs independently decoded with host Pillow 12.3.0; two I420 frames checked |

The dated official image was
[`noble/20260911/noble-server-cloudimg-amd64.img`](https://cloud-images.ubuntu.com/noble/20260911/noble-server-cloudimg-amd64.img),
SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`.
It remained an immutable backing image with a task-owned copy-on-write disk,
no host mounts/device passthrough and only a loopback SSH forward. The existing
entry first failed for missing CMake; only then were the declared CI packages
installed in the disposable guest (73 new packages, zero upgrades/removals).
No host-wide package installation, Docker/WSL startup or driver change occurred.

All 354 upstream source blobs and the locked source/license hashes were
verified. The actual worker and four native test binaries are x86_64 Linux
ELFs; dynamic linkage and the worker's real `capture-v1` hello were checked.
The full hello advertises `linux-v4l2`, `aravis-gige`, `aravis-usb3` and
`aravis-fake`, with automatic discovery false. The 23 native build/test/fixture
inputs were byte-identical before and after the final cohort; all five binary
hashes were also unchanged across it. No production source fix was needed.
Repeated variant runs are not additional distinct test cases.

Only the SDK Fake path and simulated V4L2 calls were executed. GigE/USB camera
construction, physical V4L2 capture, driver behavior and real-device cleanup
remain untested. This result does not qualify a Linux Node/HTTP deployment,
hardware timing, sanitizer instrumentation or ONVIF profile conformance.

## Approved-runner commands

From the repository root, on a separately approved Linux runner:

```sh
# Offline; exact Aravis 0.8.36 already installed and discoverable by pkg-config.
bash onvif/tools/adapters/linux/build-test.sh
bash onvif/tools/adapters/linux/build-test.sh --system-aravis

# Offline pristine upstream Git checkout at the locked commit; build it locally.
bash onvif/tools/adapters/linux/build-test.sh --aravis-source /approved/cache/aravis

# Explicit permission to fetch ONLY the locked public Aravis source and build it.
bash onvif/tools/adapters/linux/build-test.sh --bootstrap-aravis
bash onvif/tools/adapters/linux/build-test.sh --bootstrap-aravis --without-usb

# Explicit reduced coverage; missing Aravis does not silently select this mode.
bash onvif/tools/adapters/linux/build-test.sh --without-aravis

# Optional instrumented first-party build, on an approved runner.
CAPTURE_SANITIZERS=ON bash onvif/tools/adapters/linux/build-test.sh --system-aravis
```

`--system-aravis`, `--aravis-source` and `--bootstrap-aravis` are mutually
exclusive. No dependency source option is accepted with `--without-aravis`.
`--without-usb` retains the real Aravis/Fake build but excludes stock USB
capture. An absent compiler, development package, exact Aravis version or
USB-enabled SDK fails rather than reporting a skip/pass. The operator remains
responsible for authorizing the runner; a Linux platform check is not consent.

All shell files in this call chain must retain **LF**, including the two legacy
scripts. A host-portable definition test checks the actual bytes; `bash -n`
alone does not reliably catch CRLF execution problems. Root integration must
not reformat these shell files to CRLF.

## Dependency and permitted-source policy

`dependencies.lock.json` distinguishes the **exact Aravis pin** from minimum
system requirements and unpinned Ubuntu package names. It is not an exact OS
image/package closure or bit-reproducibility claim. Ubuntu's `libaravis-dev`
package name is not proof of 0.8.36: an installation exposing 0.8.31 fails.
No other Aravis development ABI is qualified by these definitions. Supporting
one later requires primary API review and a real compiler/runtime result,
not a relaxed pkg-config comparison or version-macro override.

`sources.lock.json` permits Aravis **0.8.36**, public repository
`https://github.com/AravisProject/aravis.git`, commit
`97ff5e330919d7a44b871df4eda669feeafdf342`, tree
`1a428056f753d308885f389ab3ff84c1443557f8`. It records independently read
SHA-256 values for the license, Meson definitions and relevant primary headers.
No archive SHA-256 is asserted: bootstrap fetches a Git commit, not an
unverified moving release archive/tag. No SDK binary or source implementation
is vendored into this repository.

`source-policy.py` performs **offline verification only**. It requires that
the supplied source directory itself is an upstream Git checkout, matches
the locked commit/tree, contains no untracked files (including ignored build
files), and that every tracked file/symlink matches its Git blob. Escaping
symlinks and submodules are rejected. The selected source/license SHA-256
hashes are also checked. A sparse, changed or incomplete cache fails before
Meson execution. Missing source is not fetched unless `--bootstrap-aravis`
was explicitly supplied.

Bootstrap disables Git hooks and external/file fetch transports. It builds a
shared library into a fresh adapter-owned `native/linux/build-aravis.*`
directory, with separate pristine source, build and private install trees.
No `sudo`, global install, `ldconfig`, postinstall, Docker, WSL, driver setup,
device attachment or host network change is in the script. Its child process
environment points pkg-config and the dynamic loader at that private prefix.
Build directories are ignored by the existing adapter rules; their exact
paths are shown by the build tools and remain operator-owned.
The entry clears only the generated worker `build-linux-capture/CMakeCache.txt`
before configuring, so an earlier pkg-config prefix or USB feature-test cache
cannot qualify a different installation. It does not delete a build directory,
source cache or user files; provide compiler selection through the approved
runner environment rather than relying on an old worker CMake cache.

Meson uses `--wrap-mode=nodownload`; tests, viewer, GStreamer plugin,
introspection, documentation and packet sockets are disabled. USB support is
an explicit enabled/disabled option. System GLib/GObject/GIO, libxml2, zlib and
optional libusb must already exist. Upstream camera tools/tests are never
executed (the upstream build may compile/install its command-line tools into
the private prefix). The worker also needs Linux UAPI headers, C++17, CMake, Python,
pkg-config, OpenSSL and system libjpeg development files.

The upstream source/header SPDX designation is **LGPL-2.1-or-later** and the
locked `COPYING` file contains LGPL 2.1. Retain upstream notices and review
applicable corresponding-source/relinking obligations before distribution.
Other dependencies retain their own licenses; see the existing
[`genicam/README.md`](../../../samples/adapters/genicam/README.md).
These statements do not assign a license to first-party repository source or
authorize redistribution of an SDK/package/binary.

## Primary API evidence and software cohorts

The pinned [`src/arvsystem.h`](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvsystem.h#L35-L39)
exports enable, disable and select. Its
[`src/arvsystem.c`](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvsystem.c#L131-L149)
implements `arv_select_interface("Fake")` by enabling Fake and disabling
**all** other interfaces, without instantiating them. The existing production
Fake path does this before exact `arv_camera_new("Fake_1", ...)`; no first-camera
fallback or device-list update was added. The contract test also explicitly
disables GigEVision/compiled USB3Vision and enables Fake before SDK use.
Fake defaults in pinned `arvfakecamera.h` are 512x512 Mono8.

`aravis-contract.cpp` makes compiler-enforced checks of the exact region
out-parameter signature, pixel/payload types, floating-point frame-rate and
exposure getters, and unsigned 64-bit buffer timestamps/IDs. These assertions
now compile against the actual pinned Linux SDK; its Fake runtime also passed.
No region/format/exposure/trigger setter is used.

| Passed cohort | Actual software evidence |
| --- | --- |
| Python `test_definitions.py` | Host-portable framing/lock/source-policy fixtures; no SDK or native worker execution |
| `camera-portable-bounds` | Real dependency-free C++ bounds, conversions, selector parsing and owned-copy checks |
| `camera-system-jpeg` | Real system JPEG encode/decode, malformed/bounded output and SHA-256 |
| `camera-protocol-no-device` | Real worker startup, framing, malformed/incomplete commands, explicit missing-backend failures; no device target |
| `camera-v4l2-simulated-ioctl` | Actual V4L2 translation unit, linker-wrapped path/open/stat/ioctl/poll; anonymous memfd mappings, never a device node |
| `camera-aravis-api-contract` | Actual pinned SDK Fake identity/mode/types, policy rejection, bounded copy and close |
| `camera-aravis-sdk-fake` | Actual worker and exact SDK `Fake_1`; JPEG/I420 framing, fields/timing, invalid identity/mode/digest/limits/permissions |

The V4L2 fixture supplies synthetic descriptor metadata, bounded ioctl replies,
YUYV bytes, timestamps and failures. Wrappers reject unknown paths/fds/requests;
only anonymous memory mappings and owned-fd cleanup use real POSIX operations.
Immediate backing-memory overwrite at requeue exercises copy-before-reuse.
Short/error frames, timeout, loss, format drift and failed STREAMOFF are
simulation scenarios, **not** kernel-driver, UVC device, unplug or protocol
qualification. No v4l2loopback module, `/dev/video*`, USB passthrough or GVCP/GVSP
emulator is required or allowed by the default cohorts.

SDK Fake data is generated in-process, not by a network fake-camera daemon.
Only the explicit synthetic fixture is selected. No real frame, private
selector, credential, camera record or raw packet is saved/uploaded. Test
results are ordinary runner output, not a hardware support matrix.

## CI and remaining integration

Only `.github/workflows/camera-adapters.yml` is newly defined. It uses an
ephemeral GitHub-hosted `ubuntu-24.04` runner, read-only contents permission,
SHA-pinned checkout with credentials not persisted, no secrets and no artifact
upload. Its declared apt step installs compilers/development prerequisites;
Aravis itself is built from the locked public source by an explicit bootstrap
step. Matrix entries cover Aravis+USB, Aravis without USB, and explicit
V4L2-only compilation/software tests.

Future main-branch pushes, pull requests touching adapter paths, or an owner
dispatch can run it after integration. **No workflow was dispatched and no
commit/push was made here.** Existing root workflows, ownership/validation
registries, root package scripts, manifests and lockfile belong to the final
integrator and are not changed. The previous informative self-hosted workflow
remains a historical pre-provisioned-runner example, not the new CI definition.

The local Linux compiler/linker/runtime and actual SDK Fake gates passed;
GitHub CI itself was not executed. V4L2/USB/GigE hardware, NIC behavior, driver
access, timing synchronization and real-device resource cleanup still require
separate operator-authorized qualification. Stock USB's unknown-release
limitation remains unchanged.
