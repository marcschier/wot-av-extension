# Native ONVIF media: current P0 + IPC v2 qualification

**2026-09-16 current ALL cohort: PASS, 7/7 CTest targets.** The one unfiltered
run at **06:59:22Z-07:00:51Z** passed **30/30 preserved P0 scenarios,
106/106 v2 runtime scenarios and 10/10 codec scenarios**, plus 15 named
native unit checks. CTest elapsed time was **87.88 seconds**. This is local
Windows x64 reference qualification, **not certification or distribution
approval**.

The v2 runtime and codec suites use the same measured
`onvif_media_worker.exe` and private revision **classic-media-v2-scoped-auth-4**.
Ten `p0-runtime-{live|recorded}-{none|legacy|md5|sha256|stale}` cases run the
preserved media/auth behavior on that v2 executable. The additional 30-case
v1 preservation suite uses `p0_fixture_worker.exe`; it is not passed off as
v2 runtime evidence.

Authority is `native\onvif-media\build-p0\final-cohort.json`, with the fresh
`final-cohort-ctest.xml`, `qualification.json`, `runtime-qualification.json`
and `codec-qualification.json` from that run. All 43 functional source files,
182 selected SDK/runtime/tool inputs, native artifacts and CTest configuration
were stable before/after. All 28 pristine upstream source pins were rechecked.
No historical targeted pass is merged into these totals.

The first ALL attempt is retained intact under
`build-p0\cohort-before-tool-isolation`: runtime/P0/units passed, but the SDK's
unrestricted test-tool plugin scan crashed during H.264/H.265 fixture setup.
Test encoders now use eight required existing plugins, no external GIO modules
and a private registry; CTest native units also use private paths. The complete
cohort was rerun, not repaired by substituting two codec results.

## Current executed support matrix

The transport matrix uses four exact 16x16 JPEG frames, 640 exact PCMU-decoded
samples and four complete XML documents per normal receive generation.
It is **not** the Cartesian product of every codec/profile and transport.

| Current v2 operation | TCP | UDP unicast | HTTP tunnel | HTTPS tunnel | TLS interleaved |
| --- | --- | --- | --- | --- | --- |
| Live receive, JPEG + PCMU + metadata | Pass | Pass | Pass | Pass | Pass |
| Forward recorded receive, absolute range | Pass | Unsupported | Pass | Pass | Pass |
| Native PAUSE, PLAY, seek from paused/playing; four generations | Pass | Unsupported | Pass | Pass | Pass |
| Opt-in live PCMU backchannel from S16LE/8kHz mono | Pass | Pass | Pass | Pass | Pass |
| Recorded backchannel | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported |

Positive transport cases use real scoped SHA-256 Digest; tunnels independently
verify outer GET/POST SHA-256 Digest and fragmented base64 traffic. TLS uses
per-session fixture CA trust. Private native/outer credentials and realms are
also injected with non-default values (`private-injected-tcp`,
`private-injected-https`), checked against independently calculated wire Digest,
and absent from public control/diagnostics/argv.

Live/recorded TCP additionally cover explicit no-auth, legacy MD5, MD5/auth,
SHA-256 and stale nonce; MD5 requires opt-in. Mixed challenges prefer SHA-256.
Basic, session algorithms, SHA-512-256, auth-int-only, wrong principal/target/
origin/realm and wrong outer scope fail without unauthorized credentials.
Untrusted-chain and wrong-host **HTTPS** cases fail with
`TlsCertificateRejected` and exact certificate-error flags before either
credential-bearing protocol. Direct RTSPS positive/duplex cases use the same
strict TLS implementation; separate direct-RTSPS negative vectors are not
claimed by these two HTTPS tests.

`target-*` cases check SDP/redirect escape, explicitly authorized same-origin
redirect, URI/transport mismatch, downgrade and wrong advertised UDP source.
`udp-sender-address`, `udp-sender-port`, `udp-sender-rtcp-address` inject
actual foreign loopback datagrams and require `ForbiddenTarget`, no foreign
media/clock output and acknowledged cleanup. The initial counterexample
received four exact foreign RTP packets and four decoded images; the source
guard is now before RTP-manager processing, not only a Transport-header check.

| Codec reference, actual TCP decode | Current oracle/result |
| --- | --- |
| JPEG baseline | Four 16x16 I420 frames, every byte=128 |
| ONVIF JPEG SOF, live and replay | Four **17x16 / 416-byte** I420 frames each, exact bytes; header override and component selectors preserved |
| H.264 constrained-baseline, 8-bit | Eight 64x48 I420 frames, every Y/U/V byte exact |
| H.265 Main, 8-bit | Eight 64x48 I420 frames, every Y/U/V byte exact |
| MPEG-4 Simple Profile | Eight 64x48 I420 frames, every byte exact; native finite-stream EOS drains the last frame |
| AAC-LC, 48kHz mono | Nine decoded AUs / **9216 samples**, including 1024 priming samples; silence error <=1 S16 LSB |
| Four disabled codec masks | `NoDecoder`, no READY/decoded media/transmission |

Synthetic references and recipe/plugin/encoded hashes are preserved.
Existing OpenH264, x265 and libav encoders are **test-only**. x265 is GPL and
is not copied into the runtime bundle. No camera captures or external media
were used; neither availability nor these narrow profiles implies arbitrary
codec/bit-depth/hardware support.

## Current lifecycle, bounds and metadata evidence

Each replay-control transport preserves one native Session ID over four
generations and **80 exact whole RTP packets**, native 0x8008 receipts and
final access-unit/metadata tails. `replay-stale-generations` rejects three
injected old-CSeq packets with explicit gaps. END's actual lastDataSequence
is asserted; the Node adapter must honor its session/generation drain
watermark before reporting complete delivery.

`lifecycle-credit` delivers exactly four envelopes without replenishment,
then exactly four more after returned credit; over-grant fails. Live/recorded
stalled readers, pending SETUP, pending seek, 500/454/missing TEARDOWN,
private SECURITY EOF, owned process death and independent same-URI sessions
are exercised. Close requires a consumed correlation, local cleanup and
observed process exit, never an adapter-generated acknowledgment.

Measured seek cancellation was **2.042 s**; missing TEARDOWN **2.054 s**,
both below the five-second bound and both remotely **uncertain**. Stalled
live/recorded close took **0.017/0.031 s** with queue peaks **13800/14666
bytes**, below 65536. Maximum observed lifecycle peak working set was
**38981632 bytes**, below the asserted 256 MiB fixture threshold; this is
not a universal process-memory cap. Whole-frame discards are explicit.

Required fields, native frame version/length/truncation, origin vector count,
declared maxima, actual encoded-byte and pre-decode width limits are checked.
Backchannel verifies four actual packets/640 independently decoded samples
per transport, RTP sequence/timestamp progression, opt-out and invalid input.
Twenty additional exact direct-TLS duplex repeats passed after serializing
the **existing Python fixture's** SSL object; they are not added to ALL totals.

Metadata covers gzip, CRC, expansion/wire/inflated limits, UDP reorder,
loss/recovery, sequence/timestamp wrap, deadline/SSRC changes, empty versus
invalid XML, UTF-8, DTD/XXE rejection and EXI rejection. The native root/
resource guard does **not** validate full XSD or canonical semantics.
The canonical owner's completed `runtime.decodeMetadata` and 579-operation
registry are separate evidence; Node must use that mapper and preserve native
timing/provenance. This native cohort does not claim composed node-wot,
Directory-publication or installed-package acceptance.

## Current provenance, warnings and limits

| Artifact / scope | SHA-256 |
| --- | --- |
| v2 worker, 70656 bytes | `4a70945b9698b7a0a777e8af80d80e9140f23cd69079a437e1dbefec7610ef34` |
| Private RTSP library | `d69f7e2a702e58a6e589661a78c1638378a61e99ca320566de8c9442596995ca` |
| Private RTSP plugin | `3ee3008715e8c09de6adae99b6c5908de1c6e8ebabd98d82a6caf0f614bcd08b` |
| Functional-source fingerprint, 43 files | `f0c24ac0682674e21b3db3a5e70ac7fa5cd7739f33a89bbe9938459857685da1` |
| Selected SDK-input fingerprint, 182 files | `b58130d7047da7a0e4cbd63f3f4b244981d937c2910a386c5efa236e35223736` |

Individual file hashes and the canonical fingerprint input maps are in
`final-cohort.json`; the SDK fingerprint is not a hash of its entire directory.
The existing official archive still matches
`032fc6062b8539838fc8da22589cb9b24c5d820baa7f8cc160af9ea08395badf`;
Authenticode is **NotSigned**. The verified replacement SDK was reused without
download/extraction/installation. Core DLL SHA-256 is
`9728a996dfeb03c79b20310a43967f32c41f1c3ab8d2dd15b2a6d27ff206300d`.

Remaining warnings are preserved: replay JPEG paths emit two
**segment-before-caps** sticky-event warnings; the corrected
caps-before-stream-start warning is absent from current v2/codec captures.
Successful tunnel Digest retries still log the initial 401 as native
ERROR-level diagnostics. Expected TLS/codec denial logs remain. The HTTPS
backchannel case also retains the jitter-buffer warning **backward timestamps
at server, schedule resync**; no blanket warning-free
or full RFC/ONVIF conformance claim is made.

Unsupported/unqualified: reverse replay, multicast, SRTP/MIKEY, EXI, mTLS,
SRT/WebRTC, arbitrary codec profiles, IPv6/device interoperability, hardware
clock accuracy and real cameras. No such optional capability was added.
Private patch/API review, original-code license, corresponding source/
relinking, codec patents and distribution approval remain open gates.

The actual IPC v2 contract and portable explicit build commands are in
[onvif-media.md](onvif-media.md). The final local handoff/report are
`%TEMP%\acf-media-research\onvif-media-v2-contract-final-20260916.md` and
`%TEMP%\acf-media-research\onvif-native-final-cohort-20260916.md`.

## Archived P0/v1 qualification - not the current runtime contract

The remaining text records the September 15 fixture-only boundary. Its v1
limits and unsupported cells do **not** describe the current v2 worker above.

**2026-09-15 result: the Windows MSVC x64 functional P0 gate passes.**
The three native CTest targets pass, including 30 independent loopback/IPC
scenarios. This is an isolated qualification harness, **not Phase 5, a production
media executor, an ONVIF-conformant client, or permission to distribute binaries**.
The selected classic GStreamer patch is a private review candidate.

The worker performs native RTSP/RTP reception and uses existing software
decoders. It does not merely return a URI, run a new HTTP proxy, invoke
`gst-launch`, acquire camera credentials, or perform ONVIF SOAP operations.
Only explicitly supplied `rtsp://127.0.0.1:<port>/p0/...` fixture targets are
accepted. Discovery, camera scans, PTZ, recording configuration, backchannel,
and real credential input are outside this executable.

## Qualified cells and exact evidence

All positive media cases negotiate DESCRIBE, three SETUPs, PLAY, and TEARDOWN
against the independently implemented Python-stdlib server. The server chooses
interleaved RTP channels 6, 10, and 14 rather than echoing assumed channel numbers.
RTSP headers and interleaved records are fragmented across socket writes.

| Mode / direction | Transport | Authentication | Result |
| --- | --- | --- | --- |
| Live receive | RTSP/TCP interleaved | Explicit fixture no-auth | Pass |
| Live receive | RTSP/TCP interleaved | Legacy MD5 without qop; MD5/auth; SHA-256/auth | Pass |
| Forward recorded receive, absolute range | RTSP/TCP interleaved | Explicit fixture no-auth; legacy MD5; MD5/auth; SHA-256/auth | Pass |
| Live and recorded receive | RTSP/TCP interleaved | SHA-256 stale-nonce exchange | Pass |
| Live receive | RTSP/TCP interleaved | SHA-256 preferred over offered MD5 and Basic | Pass |
| Unsupported challenge | RTSP/TCP interleaved | Basic-only, SHA-512-256, MD5-sess, auth-int-only | Explicit `UnsupportedAuthentication`; no Authorization header disclosed |
| Node process adapter | Private Windows stdio pipe 3 | Live and recorded SHA-256 | Pass with existing Node 24.12.0 x64 |

Each normal positive media case verifies **all** of:

- Four complete 16x16 JPEG frames: every decoded I420 byte equals the independent
  synthetic oracle (384 bytes of value 128 per frame).
- Four G.711 mu-law packets decoded into 640 mono, 8 kHz, S16LE samples. The
  complete expected sequence is `[0, 0, 32124, -32124]` repeated; a nonzero byte
  count alone cannot pass.
- Four byte-identical XML documents, including an extension namespace and a
  multibyte UTF-8 character split between RTP packets. The checked path is
  `{http://www.onvif.org/ver10/schema}MetadataStream/VideoAnalytics/Frame`.
- Twenty native RTP packets, with independently checked payload type, SSRC,
  sequence, timestamp, marker, and actual wire bytes.
- Acknowledged remote TEARDOWN, local cleanup, and worker exit.

The steady-state metadata-loss case receives 19 RTP packets, reports a gap,
discards the affected document, and emits exactly three intact documents. Native
unit tests additionally cover sequence wrap, changing RTP timestamps within a
document, SSRC changes, assembly deadlines, malformed/wrong-namespace XML, and
DTD/external-content rejection. This is a bounded XML **frame-subset guard**, not
the future canonical mapper or full ONVIF schema validation.

Recorded PLAY is independently checked as:

```text
Range: clock=20260915T120000.25Z-20260915T120002.25Z
Require: onvif-replay
Rate-Control: no
Frames: all
Scale: 1.0
```

The worker supplies GStreamer nanoseconds since **1900**, not Unix nanoseconds.
The native replay extension retains the 64-bit NTP value, its fractional part,
C/E/D/T flags, and the **low-order one-byte PLAY CSeq**, not a fabricated
24-bit sequence. The terminal flag on the first fragment of the final metadata
document does not discard its remaining fragments. No RTCP sender reports are
sent by this replay fixture; no RTCP-to-UTC accuracy is claimed.

Cancellation scenarios cover stalled data consumption, pending live/recorded
SETUP, a 500 TEARDOWN response, a missing TEARDOWN response, and termination of
the specific owned worker process. Cleanup distinguishes acknowledged,
already-ended, uncertain, and not-created remote state. Two workers opening the
same URI have independent native Session IDs and ownership.

The final suite also rejects wrong IPC versions, excessive lengths, truncated
frames, unsupported UDP descriptors, and RTSPS descriptors before network
requests. **Rejecting RTSPS is not evidence of TLS trust validation.**

## Stack, source, and binary provenance

| Component | Observed version / provenance |
| --- | --- |
| GStreamer runtime, headers, required plugins | 1.28.7, Windows MSVC x64 |
| GStreamer source | `070125524a8422e29d3b69a372ed4f62fd343ffa` |
| Cerbero packaging source | `e0e7007e210dab3e2f3e898939e2cfe1fd02f123` |
| CMake / Ninja | Pre-existing pip distributions 4.4.3 / 1.13.2 |
| Compiler | Pre-existing MSVC 19.51.36257.0 x64; toolset directory 14.51.36231 |
| Visual Studio / Windows SDK | Enterprise 2026 18.9.12128.139 / 10.0.26100.0 |
| System MSVC runtime DLLs | 14.51.36247.0 |
| Python / Node for fixtures | Pre-existing Python 3.13.15 / VS-bundled Node 24.12.0 x64 |
| GLib / libxml2 SDK headers | 2.82.4 / 2.14.5 |
| JPEG implementation | SDK libjpeg-turbo 3.1.0, imported as `jpeg8.dll` |

The official SDK executable SHA-256 is
`032fc6062b8539838fc8da22589cb9b24c5d820baa7f8cc160af9ea08395badf`.
It matched the upstream HTTPS checksum. **Authenticode reports NotSigned**;
checksum verification is not a publisher-signature claim.

`native\onvif-media\dependencies.lock.json` records the exact distribution,
notices, versions, and policy. `sources.lock.json` locks 28 necessary public
source/header inputs by commit and Git blob; the fetch audit also records each
input's SHA-256 and URL. The build verifies pristine inputs before applying the
private patch and compiles only seven RTSP-library and five classic-plugin C
sources, plus the worker/helper/tests. There is no vcpkg assumption, Meson
bootstrap, or full GStreamer/Cerbero rebuild.

The worker loads a private plugin directory: patched `gstrtsp.dll` plus the
seven selected SDK plugins `gstcoreelements`, `gstapp`, `gstrtp`, `gstrtpmanager`,
`gstjpeg`, `gstmulaw`, and `gsttypefindfunctions`. Startup checks actual
GStreamer/plugin versions, the private RTSP library revision, and the private
response-observation signal. Unselected GIO modules/proxy discovery are excluded
from this plaintext-loopback-only harness. TLS is not silently disabled to
enable an advertised TLS path; no such path is exposed.

All ten executable/plugin artifacts were checked as PE machine `8664` (x64).
The worker imports the real GStreamer RTSP/app/RTP/SDP/video/audio libraries,
GLib/GObject, `xml2-16.dll`, and MSVC/UCRT, not a decoder stub. The generated
`build-p0\qualification.json` records binary sizes/SHA-256, native inventories,
fixture hashes, every case result, timing diagnostics, and captured stderr.
Hashes identify the measured build, not a promise of bit-reproducible PE output.

### Private patch and remaining review

The original classic connection ignores the offered algorithm/qop and invokes
the legacy MD5 generator. The new Rust RTSP source was not substituted for
classic replay. The private candidate supplies strict Digest selection and
response generation, nonce counting, BCrypt cnonce generation, stale handling,
quoted-string safety, and no Basic/downgrade fallback in this P0 plugin.
Literal RFC 2617 and RFC 7616 section 3.9.1 vectors independently verify MD5 and
SHA-256 calculations.

The exact-frame gate found a second issue: classic `rtspsrc` gave the first
ONVIF packet a running-time receipt DTS despite an absolute-1900 segment.
The measured values were approximately 0.19 seconds versus 3998462400.25
seconds. A one-condition fix suppresses that implicit DTS for ONVIF mode while
preserving explicit `tcp-timestamp` requests. Unknown decode timestamps remain
unknown; receipt time and native NTP are separate. Recorded TCP uses the
documented `is-live=false`, `onvif-rate-control=false` combination.

**Remaining native warning:** recorded cases still emit GStreamer sticky-event
ordering warnings (`caps` before `stream-start`, and `segment` before `caps`).
They are retained in the result, not suppressed. Exact payload/count checks
pass, but event-ordering/API review remains a promotion blocker.

See `native\onvif-media\patches\README.md` for private vendoring and upstream
review notes. No upstream submission or review approval is implied. Sources
and existing notices are preserved; binary redistribution, the original-code
license, complete corresponding-source/relinking obligations, codec patent
review, and the final plugin bundle remain separate approval gates.

## IPC v1 proposal, implemented by the P0 worker

One v1 fixture worker owns one session and exits after cleanup. This is not a Node ABI
addon. The parent launches `bin\p0_fixture_worker.exe --data-fd 3` using Node
`stdio: ["pipe", "pipe", "pipe", "pipe"]`. The C/Python fixture alternatively
passes one private inherited Windows pipe with `--data-handle <handle>`.
No URI, username, or password is accepted in worker argv.

stdin carries commands; stdout carries control/status; descriptor 3 carries
binary media. stderr is a separate bounded diagnostic channel. The parent must
drain control/stderr independently of media, enforce its own deadline, and
await **both CLOSED and worker exit**. A killed/crashed worker without a CLOSED
receipt leaves remote teardown uncertain, even after local process exit.

Every message starts with this 24-byte header. All integers are unsigned
big-endian; payload length excludes the header.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | ASCII `OMPG` |
| 4 | 2 | Protocol version, exactly 1 |
| 6 | 2 | Message kind |
| 8 | 4 | Parent-selected session ID; 0 reserved for startup |
| 12 | 4 | Generation; OPEN uses 0, the one P0 session uses 1 |
| 16 | 4 | Command correlation sequence, or monotonically increasing data sequence |
| 20 | 4 | Payload byte length |

Commands are `OPEN=0x0001` and `CLOSE=0x0002`. Control kinds are
`HELLO=0x8001`, `READY=0x8002`, `CLOSED=0x8003`, `ERROR=0x8004`,
`RTSP_RESPONSE=0x8005`, `GAP=0x8006`, and `NATIVE_DIAGNOSTIC=0x8007`.
Control payloads are finite UTF-8 JSON. Data kinds are `RTP=0x9001`,
`DECODED=0x9002`, and `METADATA=0x9003`.

### OPEN and CLOSE

OPEN's payload is `mode:u8, transport:u8, auth:u8, tracks:u8,
startNtpNs:u64, endNtpNs:u64, uriBytes:u16, uri:UTF8[uriBytes]`.
The fixed prefix is 22 bytes.

| Field | Accepted P0 values |
| --- | --- |
| mode | 0 live, 1 forward recorded |
| transport | 1 RTSP/TCP interleaved only |
| auth | 0 explicitly unauthenticated fixture; 1 built-in synthetic Digest fixture principal |
| tracks | Exactly 7: JPEG video, PCMU audio, XML metadata all required |
| live times | Both zero |
| recorded times | Nanoseconds since 1900; start at/after Unix epoch, end greater than start and at most signed-64-bit maximum |
| URI | At most 1024 UTF-8 bytes, no NUL/userinfo/fragment/whitespace; literal loopback host, explicit port at least 1024, `/p0/` path |

Generation must be 0, and session/correlation IDs must be nonzero. Authentication
1 is **not a credential API**: it only selects the known synthetic fixture
principal. There is no native access-class or real credential/trust-handle
input. Supplying a production URI fails the target boundary.

READY uses generation 1 and echoes the OPEN correlation:

```json
{
    "state": "playing",
    "protocolReady": true,
    "receivingIsSeparate": true,
    "tracks": [1, 2, 3]
}
```

Track IDs are worker-local: 1 JPEG, 2 PCMU, 3 metadata. They are not stable
device/recording identifiers. READY follows accepted native PLAY and three
accepted SETUPs with allocated sinks; it does not wait for first media or EOF.

CLOSE has an empty payload, matching session/generation, and a sequence greater
than OPEN's. CLOSED reports `localCleanup`, `remote`, `teardownStatus`,
`dataDiscardedFrames`, `dataQueuePeakBytes`, and `awaitWorkerExit:true`.
`remote` is `acknowledged`, `already-ended`, `uncertain`, or `not-created`.
Correlation 0 denotes terminal cleanup without a consumed CLOSE request.
Parents must reconcile terminal cleanup with pending operations rather than
invent a remote acknowledgment. Further controls, reopen, and successive
PLAY/seek generations are not implemented.

### Data payloads

| Kind | Fixed prefix, in order | Following bytes |
| --- | --- | --- |
| RTP, 40 bytes | track:u16, payloadType:u8, marker:u8, SSRC:u32, RTPsequence:u16, replayFlags:u8, PLAYcseqLow:u8, RTPtimestamp:u32, receiptMonoNs:u64, replayNtp:u64, options:u32, packetBytes:u32 | Complete native RTP packet |
| DECODED, 36 bytes | track:u16, format:u16, width:u32, height:u32, sampleRate:u32, channels:u16, reserved:u16, count:u32, gstPtsNs:u64, dataBytes:u32 | Tight I420 planes or S16LE PCM |
| METADATA, 32 bytes | track:u16, reserved:u16, firstSequence:u16, lastSequence:u16, SSRC:u32, firstRtpTimestamp:u32, lastRtpTimestamp:u32, receiptMonoNs:u64, xmlBytes:u32 | One complete guarded UTF-8 XML document |

RTP `options & 1` means a recognized three-word ONVIF replay extension;
`replayFlags` preserves C=0x80, E=0x40, D=0x20, T=0x10.
`replayNtp` is raw NTP fixed-point, **not nanoseconds or Unix time**.
An all-ones timestamp is unknown. Other option bits are reserved.
DECODED formats are 1 I420 (video count is one frame) and 2 S16LE (audio count
is samples per channel). `gstPtsNs=UINT64_MAX` is unknown. GStreamer PTS, NTP
acquisition time, receipt monotonic time, and XML `UtcTime` are not interchangeable.

Limits are 4096-byte control payloads, 65536-byte data payloads, 64 queued data
frames / 1 MiB including in-flight writes, and 32768-byte metadata documents
with a two-second assembly deadline. Overflow is an explicit error/gap, never
a partial successful document. The open/main-loop deadlines are six/thirty
seconds; these are not a substitute for the parent's process deadline when
control output or native state transitions are blocked. Native decoder
allocation limits and credit-driven replay backpressure remain unqualified.

## Reproducing this gate

Run from the repository root in PowerShell. No build step fetches
or installs dependencies automatically. Use the dependency tools explicitly
only after a missing-dependency failure and review of the locked notices.

```powershell
.\native\onvif-media\tools\build.ps1 `
  -SdkRoot $SdkRoot -SourceRoot $SourceRoot `
  -NodeExecutable $NodeExecutable -Test
```

For an already provisioned SDK, skip fetching; the fetch tool deliberately
refuses to overlay an existing SDK directory. `-CachedArchive <path>` can reuse
the exact hash-verified upstream installer in a **new** task-local directory.
`-NodeExecutable <path>` selects an existing Node installation; the build tool
also recognizes the standard VS-bundled Node path. It never installs Node.
The VS `.bat` setup and native build run in the same `ComSpec` process.

Measured final commands used the `...-final` SDK/source directory and
`C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe`.
The earlier SDK's headers changed independently during final checking; its
runtime/cache was left untouched. A new isolated extraction from the same
verified installer completed the gate. No system/user GStreamer environment
variables, firewall rules, root/Node packages, or vendor/AV artifacts were changed.

## Not qualified by P0

UDP, multicast, HTTP/HTTPS tunnels, TLS trust/authentication, SRTP/MIKEY,
backchannel, gzip/EXI, H.264/H.265/MPEG-4/AAC, ONVIF JPEG RTP extensions,
pause/seek/reverse/successive generations, RTCP clock correlation, arbitrary
devices/SDP, full metadata schemas/canonical mapping, installed-package use,
and real node-wot TD/resolver integration remain separate gates.
**Direct TCP interleaving alone does not meet the profiles' UDP-or-HTTP-tunnel
baseline.** No profile label or five-codec support flag follows from these tests.

### Primary implementation anchors

- `GStreamer/gstreamer:subprojects/gst-plugins-base/gst-libs/gst/rtsp/gstrtspdefs.c:604-641`
  and `gstrtspconnection.c:1325-1400`, at the locked commit: legacy Digest path.
- `GStreamer/gstreamer:subprojects/gst-plugins-good/gst/rtsp/gstrtspsrc.c:1060-1111`,
  `6281-6294`, and `6980-7140`: ONVIF mode, receipt DTS, and challenge selection.
- `onvif/specs:doc/Streaming.xml:1622-1802`, commit
  `68ee1b540a40f848c9599eba2c55b87547c588d6`: replay/SDP/NTP/CSeq semantics.
- [RFC 7616 section 3.9.1](https://www.rfc-editor.org/rfc/rfc7616.html#section-3.9.1):
  literal MD5/SHA-256 response oracles.
- `D:\git\marcschier\wot-av-extension\native\onvif-media\src\ipc.c:12-25`,
  `91-126`, `170-199`: actual frame layout, bounded input, and data-write cancellation.
- `D:\git\marcschier\wot-av-extension\native\onvif-media\src\metadata.c:71-170`:
  bounded native XML and marker-based RTP assembly.
