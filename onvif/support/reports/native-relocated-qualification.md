# Relocated native ONVIF/GStreamer qualification

**PASS, 2026-09-16: the relocated sources and tools were actually built and
executed.** All seven CTest targets passed, containing 146 complete fixture
scenarios and 15 named C unit checks. All 23 Node/native integration cases
also passed, with zero failures, cancellations or skips. This closes the
missing-native-prerequisite/runtime-execution gap in the earlier regroup
integration record; source-hash preservation alone was not treated as a pass.

Machine-readable evidence: [native-relocated-provenance.json](native-relocated-provenance.json).
It records all test names, the 43 logical-to-physical native source mappings,
source/SDK/binary hashes, official acquisition provenance, negative gates and
exact local evidence paths. It contains no SDK or executable payload.

## Actual execution

| Cohort | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Unfiltered CTest targets | 7 | 0 | 0 |
| P0 loopback scenarios, within CTest | 30 | 0 | 0 |
| V2 runtime scenarios, within CTest | 106 | 0 | 0 |
| Codec scenarios, within CTest | 10 | 0 | 0 |
| Named C unit checks, within CTest | 15 | 0 | 0 |
| Full Node/native integration | 23 | 0 | 0 |

The seven target names are exactly `p0.digest`, `p0.metadata`, `p0.loopback`,
`media.metadata`, `media.jpeg`, `media.loopback` and `media.codecs`. The
scenario total is **30 + 106 + 10 = 146**; the unit total is **4 + 4 + 4 + 3 = 15**.
These are contents of the seven targets, not additional CTest targets.

The fresh native cohort ran from **16:56:40 to 16:58:20 UTC**. Its reports
require `selection=all`, the measured worker hash and fresh output timestamps.
No targeted historical result or passing subset replaced the complete run.

The same entry point then freshly compiled the current TypeScript package and
passed all 23 Node/native tests. PowerShell's transcript retained the invocation
but omitted native child stdout, so the **entire 23-case Node suite** was run
again from **17:02:11 to 17:02:35 UTC**, capturing stdout/stderr explicitly in
`node-native-final.log`. Both runs passed; this is **23 unique cases, not 46**.
The earlier evidence-parser check of the incomplete transcript was a logging
failure, not a product-test failure, and was not accepted as durable Node proof.

The Node build staged **596 canonical artifacts, including 578 model documents**,
plus **43 unchanged ONVIF source/notice files**. All **90 package input hashes**
and **826 staged content-file hashes/sizes** were checked. The existing composed
test loader resolves the relocated suite's `.compiled` references to the freshly
built `onvif\samples\reference-runtime\dist`, not an old isolated build.
`NODE_PATH` and `NODE_OPTIONS` were absent. This was not a new isolated-package
installation exercise.

## Inputs and command

The initial real `verify-onvif-native-ci.ps1 -AllowNative` invocation failed
with exit 1 before native execution: the documented TEMP SDK, pristine source
directory and cached archive were missing. The existing VS-bundled Node was
present. There was no permission denial, TEMP redirection or ACL workaround.

The selected new ignored cache and build directories are:

```text
D:\git\marcschier\wot-av-extension\onvif\tools\native-media\.cache\qualification-relocated-20260916
D:\git\marcschier\wot-av-extension\onvif\samples\reference-runtime\native-media\build-relocated-qualification-20260916
```

Commands actually executed from the repository root, with the same explicit
paths expanded through these variables:

```powershell
$cache = 'D:\git\marcschier\wot-av-extension\onvif\tools\native-media\.cache\qualification-relocated-20260916'
$build = 'D:\git\marcschier\wot-av-extension\onvif\samples\reference-runtime\native-media\build-relocated-qualification-20260916'
$node = 'C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe'

.\onvif\tools\native-media\fetch-sdk.ps1 -AcceptUpstreamLicenses -ProvisionPortable -TaskRoot $cache
python -B onvif\tools\native-media\fetch-sources.py --task-root $cache

$env:CTEST_PARALLEL_LEVEL = '1'
.\onvif\tools\verify-onvif-native-ci.ps1 -AllowNative `
    -SdkRoot (Join-Path $cache 'sdk') `
    -SourceRoot (Join-Path $cache 'upstream') `
    -SdkArchive (Join-Path $cache 'gstreamer-1.0-msvc-x86_64-1.28.7.exe') `
    -NodeExecutable $node -BuildRoot $build
```

The fetch/provision commands describe the first creation, not instructions to
overlay this now-existing SDK. Subsequent verification reuses the explicit
verified paths. The entry point itself performs no download.

Existing tools were reused: **MSVC 19.51.36257.0 x64**, Windows SDK
**10.0.26100.0**, Python **3.13.15**, CMake **4.4.3**, Ninja
**1.13.2.git.kitware.jobserver-pipe-1** and VS-bundled Node **24.12.0**.
CMake configured the relocated project and built with **two compiler jobs**.
The bounded upstream compilation remains seven RTSP-library C files and five
RTSP-plugin C files, plus the existing generated enum/local worker/test code.
No full GStreamer monorepo rebuild or old ignored native output was used.

## SDK, source and binary provenance

The unchanged dependency lock selects the official **GStreamer 1.28.7 MSVC x64**
development archive. The locked/published checksum was checked before execution.
The archive is **NotSigned**: this is SHA-256 provenance, not an Authenticode
publisher-signature claim.

The pinned Cerbero portable-mode sources at
`e0e7007e210dab3e2f3e898939e2cfe1fd02f123` and the upstream notice/licensing
advisory were read before provisioning. The existing fetch tool invoked
`/portable=1 /CURRENTUSER /TYPE=devel /TASKS= /NORESTART`, with silent/no-icon
flags. Its log confirms portable mode, non-administrative execution, successful
completion and no restart; it has no Run or Registry entry records. This is
bounded source/log evidence, not an OS-wide registry audit.

Only **28 public files** were fetched from the locked GStreamer commit
`070125524a8422e29d3b69a372ed4f62fd343ffa`. Every Git blob and SHA-256 was verified;
the JSON also records hashes of the prepared build copies after patching.
No private source or patch was uploaded.

| Measured item | SHA-256 |
| --- | --- |
| Official SDK archive | `032fc6062b8539838fc8da22589cb9b24c5d820baa7f8cc160af9ea08395badf` |
| Current 43-input native source fingerprint | `868f9b8fbb9e58e0f02ca65c3833d16ca17b9cd84b4f1fe61da97b0be1a4c7c3` |
| Selected 182-file SDK input fingerprint | `b58130d7047da7a0e4cbd63f3f4b244981d937c2910a386c5efa236e35223736` |
| New `onvif_media_worker.exe` | `eac5cf6c705f4bab51586643e9271a5c28e3893a4396e9b33da617732b8a2142` |
| New `bin\gstrtsp-1.0-0.dll` | `64f0389df6b73322baa3c3ee4925931b926b4eb617d024d65483d141c673f23d` |
| New `plugins\gstrtsp.dll` | `0430c836bbf7fda582e30842050bb6bcfb7d9af6d169893d9e0705ef869cb51c` |

The original logical source membership is preserved exactly: **20 runtime,
8 fixture, 11 test and 4 tool inputs**. Six supplementary native records are
separate: four original metadata/documentation files outside that fingerprint,
plus the two relocated root helpers. They are not extra tests or missing members
of the 43. Another **98 Node/source/run-support inputs** were frozen and checked
across the dedicated Node run.

All 43 native inputs, **22 measured native binaries**, the selected **182 SDK
inputs** and the CTest configuration remained identical through the native
cohort and after the final Node run. The SDK fingerprint is explicitly the
selected build/runtime/test-tool input set, not every extracted SDK file.

## Scope and negative evidence

Actual fixtures used only owned **127.0.0.1/127.0.0.2** endpoints: TCP, unicast
UDP, HTTP/HTTPS tunneling and TLS. Existing packet/pixel/sample oracles,
canonical metadata rejection, gzip integrity, replay generations/END draining,
backchannel, principal separation, cancellation and resource bounds all ran.
Untrusted/wrong-host certificates, unauthorized absolute SDP control and
authentication/origin-policy rejection were exercised without weakening them.

Codec generation remained the existing independently generated narrow fixtures:
H.264 constrained-baseline 8-bit, H.265 Main 8-bit, MPEG-4 Simple, AAC-LC,
JPEG/SOF cases and the P0 JPEG/G.711 oracles. Test encoders used the existing
**eight-plugin private directory**, private registry and isolated GIO settings;
the worker and CTest units retained their separate selected plugin/GIO paths.
No unrelated SDK Python/GTK plugin scan or global registry-cache deletion was used.

Four additional pre-execution checks passed, separately from the totals above:
both fetch tools rejected an unowned directory; the native entry point rejected
an invalid archive hash before creating a build; the existing eight-plugin
test-tool guard rejected an unexpected filename before copying/loading a plugin.
The latter two used inert non-executable inputs, which were removed. They prove
those preflight guards, not execution of a corrupt SDK or malicious DLL.

## Changes, preservation and integration handoff

Only two existing native inputs changed during this continuation:
`onvif\tools\native-media\fetch-sdk.ps1` and `fetch-sources.py`. Their former
TEMP-only restrictions were actually reproduced as blocking the selected
durable cache. The small extension accepts only owned `qualification-*` direct
children of the native tool's ignored `.cache`, retaining the legacy TEMP
mode, ownership marker, exact locks/origins and portable flags. A scoped
`.gitignore` and local provisioning `readme.md` document/exclude that state.

The other **41 original native inputs are unchanged from task start**. No CMake,
native C/patch/fixture/assertion, shared Node test link, runtime TypeScript,
root package/lock, AV/ONVIF semantics or adapter implementation was edited.
All **290 protected exact-file hashes** were freshly checked against the original
ledger. The protected `classic-media-v2.patch` remains
`83a7f897984d223fa907c984dfb854488064b78ba3bedff0bdab383e8af3c0b9`,
with actual Git attributes `text: unset`, `eol: unspecified`. Only the existing
source preparer normalized in-memory patch application bytes.

The Git index remains unchanged:
`7d043a5eabb77468385d347d0f1bbb2218e552820c7240f9132c2c4e20c9c91d`.
SDK/cache/build paths are ignored; no staging, commit, push, CI dispatch, real
device access, service/driver/global installation or binary publication occurred.

**Integration-owner action:** incorporate the two current fetch-tool
representations and four new repository files (scoped ignore, tool readme,
this report and its provenance JSON) into the existing transformation/inventory
process, then reseal ONVIF followed by AV metadata in the approved order.
Original baseline hashes must not be replaced. This task did not edit or reseal
another owner's publication inventories.

This is local synthetic native qualification, **not** Linux/adapter hardware
qualification, ONVIF certification, W3C/ONVIF publication authorization,
first-party license selection or approval to distribute a native/codec bundle.
`distributionApproved=false` remains explicit.
