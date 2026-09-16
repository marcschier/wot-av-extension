# Native ONVIF media reference runtime

The Windows MSVC x64 reference worker implements native GStreamer RTSP/RTP
sessions with bounded IPC **version 2**. It is not a control proxy, a
`gst-launch` subprocess, an ONVIF SOAP implementation, or a certified/
redistributable product. [Qualification](../reports/onvif-media-qualification.md) separates
executed cells from advertised decoder inventory and unsupported extensions.

The parent resolves the URI through the declared ONVIF action, binds the Thing
to its actual principal/target/trust policy, and launches one worker per lease.
Do not publish media session handles as SOAP schemas or share a native session
merely because two leases resolve to the same URI. Canonical metadata mapping
belongs to the Node runtime's `runtime.decodeMetadata`, not this native guard.

## Build and private dependency boundary

Use an existing exact GStreamer **1.28.7 MSVC x64 SDK** and pristine sources
locked by `onvif\samples\reference-runtime\native-media\sources.lock.json`. The build verifies all 28
source blobs before applying the two private patches. No download, global
installer, package hook, firewall change or plugin-registry overwrite occurs.

```powershell
.\onvif\tools\native-media\build.ps1 `
  -SdkRoot $SdkRoot -SourceRoot $SourceRoot `
  -NodeExecutable $NodeExecutable -Test
```

The three variables refer to explicitly selected existing dependencies.
`-BuildRoot` optionally selects an owned native subdirectory. MSVC setup and
compilation run in the same `ComSpec` process. Node >=22 is fixture-only.
`-Test` executes `test\cohort_gate.py`, which runs **all** configured CTest
targets and rejects stale, skipped, partial or mixed-binary evidence.
`build-p0\final-cohort.json` is the machine-readable run/provenance manifest.
To additionally verify a cached provisioning archive against the approved lock:

```powershell
python -B .\onvif\tools\tests\native-media\cohort_gate.py `
  --build-root .\onvif\samples\reference-runtime\native-media\build-p0 `
  --sdk-root $SdkRoot --sdk-archive $SdkArchive
```

`onvif_media_worker.exe` is v2; `p0_fixture_worker.exe` preserves the old v1
fixture harness. The v2 runtime also executes the preserved P0 media/auth
matrix, so a v1 harness pass is not substituted for runtime preservation.
The current private library marker is `classic-media-v2-scoped-auth-4`.

## Private channels and framing

Spawn argv is exactly `--data-fd 3 --secret-fd 4 --input-fd 5`, using six pipes:
stdin commands, stdout control, stderr diagnostics, **fd3 outbound media,
fd4 private SECURITY, fd5 inbound backchannel**. The Windows fixture can use
the corresponding `--data-handle`, `--secret-handle`, `--input-handle` arguments.
No URL, userinfo, credential or PEM belongs in argv or logs.

Every frame has a 24-byte unsigned big-endian envelope:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | bytes[4] | `OMPG` |
| 4 / 6 | u16 / u16 | version=2 / kind |
| 8 / 12 / 16 | u32 / u32 / u32 | session / generation / sequence |
| 20 | u32 | payload bytes, excluding envelope |

Commands: OPEN=1, CLOSE=2, PAUSE=3, PLAY=4, SEEK=5, CREDIT=6,
SECURITY=0x10, BACKCHANNEL=0x1001. Control JSON: HELLO=0x8001,
READY=0x8002, CLOSED=0x8003, ERROR=0x8004, RTSP_RESPONSE=0x8005,
GAP=0x8006, NATIVE_DIAGNOSTIC=0x8007, CONTROL=0x8008, END=0x8009.
Binary data: RTP=0x9001, DECODED=0x9002, METADATA=0x9003, RTCP=0x9004.

Control/input payloads are <=65536 bytes; outbound data <=64 MiB+64.
Incomplete inputs expire after two seconds. Strings are a u16 byte length and
valid UTF-8 without NUL. Use BigInt for u64 timestamps, not JS Number.
stdin sequences increase, including CREDIT; <=4096 commands/second.
Data sequences are worker-global; fd5 has its own increasing sequence.

## Required OPEN and SECURITY policy

OPEN is a 64-byte prefix followed by four strings and two vectors:

| Offset | Type | Field / accepted range |
| --- | --- | --- |
| 0 / 1 | u8 / u8 | mode 0 live, 1 recorded / transport 1 TCP, 2 UDP, 3 HTTP, 4 HTTPS, 5 TLS |
| 2 / 3 | u8 / u8 | tracks video=1/audio=2/metadata=4/backchannel=8 / flags rawRtp=1/explicitNoAuth=2 |
| 4 / 8 | u32 / u32 | credentialHandle / trustHandle |
| 12 / 20 | u64 / u64 | start1900Ns / end1900Ns |
| 28 / 32 | u32 / u32 | wireMax 1..8 MiB / inflatedMax 1..32 MiB |
| 36 | u32 | metadataDeadlineMs 1..10000 |
| 40 / 44 | u32 / u32 | queueBytes 65536..128 MiB / queueFrames 1..256 |
| 48 / 52 | u32 / u32 | maxWidth / maxHeight, each 1..8192 |
| 56 / 60 | u32 / u32 | decodedMax 384..64 MiB / nonzero codec mask <=0x3f |

Codec bits are JPEG=1, H264=2, H265=4, MP4V-ES=8, PCMU=16, AAC=32.
Four strings in order: uri<=2048, nonempty targetRef<=256, nonempty
principal<=256, localAddress<=64. localAddress is a non-wildcard,
non-multicast IP literal. Each following allowedOrigins/redirectOrigins vector
is a u16 count <=16 followed by strings <=2048; allowedOrigins is nonempty.

Live times are zero. Recorded times are nanoseconds since 1900, start at least
2208988800000000000, end>start and <=signed-i64 maximum. Recorded mode forbids
UDP/backchannel. Replay is forward Scale 1.0, Rate-Control no.

SECURITY on fd4 has a 12-byte prefix: credentialHandle:u32, trustHandle:u32,
allowMd5:u8 (0/1), three reserved zero bytes. Eleven strings follow:
targetRef, principal, nativeOrigin, nativeRealm, nativeUsername, nativePassword,
outerOrigin, outerRealm, outerUsername, outerPassword, caPem.
Limits: target/principal 256, origins 2048, realm/user/password 1024, PEM 32768.
Trust handle is nonzero. Credential handle zero requires empty native
realm/user/password and OPEN explicitNoAuth; nonzero requires realm/user and
forbids that flag. An outer user requires outer realm/origin.

OPEN/SECURITY must match both handles, targetRef, principal and native origin.
SECURITY uses the OPEN session, generation 0, sequence 1; exactly one frame
and **EOF are required before network access**. The worker has no fixture
principal/password defaults. The parent must acquire and bind real policy;
untrusted labels copied into both frames are not authorization.

Origins are exact normalized scheme/host/explicit-port values, never
wildcard/prefix matches. URI userinfo, fragments, whitespace and backslashes
are forbidden. Transport 5 requires `rtsps`, all others native `rtsp`.
Tunnel aliases are internal; outer HTTP/HTTPS scope is separate and pinned
to the exact target host/port. Redirects need both lists and cannot downgrade
transport or grant cross-origin credential reuse. Native requests and absolute
SDP controls are checked. UDP validates both advertised transport and the
actual RTP/RTCP sender address **and negotiated port**, before RTP-manager
processing. Multicast and unrequested transport fallback are rejected.

SHA-256/auth is preferred. Legacy MD5 and MD5/auth require explicit allowMd5;
Basic, unsupported algorithms, realm changes and downgrade are rejected.
Outer GET/POST Digest uses separate private values and nonce state.
TLS validates chain and hostname; per-session CA PEM never installs global
trust. Temporary public trust material is removed on close. No mTLS API.

## Native state, generation and close receipts

HELLO identifies actual plugins/versions/licenses/hashes, decoders and native
revision; inventory alone is not qualification. READY follows actual accepted
SETUP/PLAY and contains state="playing", protocolReady=true,
receivingIsSeparate=true, **nativeSessionId** and tracks. Each track has id,
kind, direction, encoding, payloadType and clockRate. IDs are 1 receive video,
2 receive audio, 3 receive metadata, 4 send audio; nativeSessionId is the
actual server Session header, not the parent session ID or an ONVIF token.

OPEN uses generation 0; native opening reserves 1 before READY. PAUSE/PLAY
are empty; SEEK carries start/end u64. **CONTROL 0x8008** is
`{"state":"paused"|"playing","acknowledged":true,"command":3|4|5}`.
The envelope correlates the real command. PAUSE keeps generation; PLAY/SEEK
publish generation+1 only after successful native PLAY. Implicit PAUSE cannot
acknowledge SEEK. Only one control can be pending. Native control work runs
off the IPC loop; CLOSE interrupts a pending wire seek, then joins local work.
Neither native scheduling nor adapter callbacks may manufacture an ACK.

Data may arrive before READY/CONTROL on a separate pipe. Buffer boundedly
until native acceptance; distinguish protocol-ready from receiving.
Discard parent old-generation caches at accepted control boundaries.

END is `{"reason":"native-eos","lastDataSequence":N}`, with the native
session/generation envelope. N is the last **enqueued** data sequence.
Drain fd3 through the matching generation's watermark before reporting
complete delivery: stdout can overtake fd3. END is not TEARDOWN/CLOSED.
Control/close may intentionally flush old queued data; never relabel it.

CLOSE is empty, correct session and later command sequence. It accepts any
observed generation <=current, including 0 during pending OPEN, but not a
future generation. CREDIT likewise accepts old delivered generations.
Other commands require the current generation. CLOSED includes:

```ts
{
  localCleanup: boolean;
  remote: "acknowledged" | "already-ended" | "uncertain" | "not-created";
  teardownStatus: number;
  dataDiscardedFrames: number;
  dataQueuePeakBytes: number;
  gaps: number;
  backchannelPackets: number;
  backchannelSamples: number;
  awaitWorkerExit: true;
}
```

Acknowledged requires actual 2xx TEARDOWN; 454 is already-ended; no SETUP sent
is not-created; otherwise uncertain. Status 0 is not success. Correlation 0
means no CLOSE was consumed. Require CLOSED **and observed exit**, never a
synthetic acknowledgment after crash. Exit 0 normal, 2 input/native failure,
3 local cleanup not established. Terminate only the owned PID if necessary.

ERROR has a nonempty code and execution="not-sent" or "see-native-responses".
TLS rejects use TlsCertificateRejected and certificateErrors diagnostics.
RTSP_RESPONSE carries actual method/status/cseq/range, including 401; a PLAY
observation can still carry the preceding generation. CSeq is not IPC sequence.

## Binary data, credits and metadata

All prefix integers are big-endian; body bytes are unchanged.

| Kind | Prefix in wire order | Body |
| --- | --- | --- |
| RTP, 40 bytes | track:u16, pt:u8, marker:u8, ssrc:u32, seq:u16, flags:u8, playCseqLow:u8, stamp:u32, receiptMonoNs:u64, ntpFixed64:u64, validity:u32, bytes:u32 | Complete wire RTP packet |
| DECODED, 36 | track:u16, format:u16, width:u32, height:u32, rate:u32, channels:u16, reserved:u16, count:u32, ptsNs:u64, bytes:u32 | Tight I420 or S16LE |
| METADATA, 32 | track:u16, reserved:u16, firstSeq:u16, lastSeq:u16, ssrc:u32, firstStamp:u32, lastStamp:u32, receiptMonoNs:u64, bytes:u32 | Whole UTF-8 XML, inflated if negotiated |
| RTCP, 36 | track:u16, reserved:u16, ssrc:u32, stamp:u32, ntpFixed64:u64, receiptMonoNs:u64, clockRate:u32, incarnation:u32 | None; observed sender-report anchor |
| BACKCHANNEL input, **16** | track:u16=4, format:u16=2, rate:u32=8000, channels:u16=1, reserved:u16=0, samples:u32 | Exactly samples*2 S16LE bytes |

RTP validity bit0 is replay, bit1 ONVIF JPEG. C/E/D/T and one-byte PLAY CSeq
remain native values. NTP fixed64 is seconds/fraction since 1900, not Unix ns.
PTS all-ones means unknown; monotonic receipt is not UTC. Match
session/generation/SSRC/incarnation and apply wrap/extrapolation bounds before
deriving clocks. No clock accuracy or hardware synchronization is claimed.

DECODED formats are 1 I420, 2 S16LE. Video count=1; tight I420 is
w*h+2*ceil(w/2)*ceil(h/2), so 17x16 is 416 bytes. PCM is <=96 kHz/eight channels
on receive. Backchannel is opt-in live PCMU/8kHz mono, samples 160..800 in
multiples of 160. It requires a negotiated send-only track and native readiness.
Native appsrc is bounded by 2560 bytes/eight buffers/160ms; overflow is an error.
It uses existing mulawenc/rtppcmupay and native send, not a new RTP stack.
Parent pacing is required; no fd5 CREDIT protocol or acoustic delivery claim.

Initial output credit equals queueBytes/queueFrames. Return
CREDIT(24+payloadBytes,1) only after fully consuming an envelope. Both grants
are positive and cannot exceed spent credit. No reset at generation boundaries;
native flush refunds only undelivered queued frames. Live pressure drops whole
frames with GAP; replay waits for credit. Keep stdout/stderr drained even with
stalled fd3, and enforce the parent's own process/control deadline.

Metadata enforces wire/inflated/deadline bounds, <=128x gzip expansion,
65536 XML nodes, depth<=64 and <=128 attributes per node. It rejects DTD/
entities/external resources, invalid UTF-8/XML and wrong MetadataStream root/
namespace. RTP gaps drain the affected document rather than return a partial
success. It is **not full XSD or canonical A/C/D/G/M/S/T semantics**. Preserve
provenance and pass the whole document to the separate canonical Node decoder.

Reverse replay, multicast, SRTP/MIKEY, EXI, SRT/WebRTC, mTLS, arbitrary codec
profiles and hardware certification are not implemented/qualified here.
Private patches, sticky-event warnings, original-source licensing,
corresponding-source/relinking obligations and codec patents remain explicit
promotion/distribution gates.
