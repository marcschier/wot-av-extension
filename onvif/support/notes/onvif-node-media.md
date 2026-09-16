# Native ONVIF media in Node

The private `@wot-av/binding-onvif/media` API composes the generated ONVIF
SOAP runtime with the separately owned native media worker. It does not add
media streams to SOAP DataSchemas, publish a control proxy, or turn a
GetStreamUri/GetReplayUri response into proof that a device supports a stream.
Each open owns one worker and one server-issued native RTSP session.

This is local reference software, not hardware qualification, ONVIF
certification, codec-patent clearance, or distribution approval. See
[native media qualification](../reports/onvif-media-qualification.md) for the separate
native implementation boundary.

## Associate the actual consumer and invoke its resolver

```typescript
import { MediaExecutor, openMedia } from "@wot-av/binding-onvif/media";

const media = new MediaExecutor({
    worker: {
        executable: absoluteWorkerExecutable,
        dllDirectory: absoluteSdkBinDirectory
    },
    security: resolveScopedMediaSecurity
});

const thing = await media.consume(runtime, retrievedTd, {
    principal: independentlyAuthenticatedPrincipal,
    targetRef: independentlyApprovedTarget,
    document: effectiveTdRetrievalUrl,
    trust: {
        serviceTargets: ["https://camera.example/onvif/media_service"],
        allowedOrigins: ["rtsp://camera.example:554"],
        transports: ["tcp-interleaved"],
        authentication: { kind: "digest", realm: approvedNativeRealm }
    }
});

const session = await openMedia(runtime, thing, {
    action: declaredGetStreamUriAction,
    input: canonicalNativeInput,
    transport: "tcp-interleaved",
    localAddress: approvedLocalInterfaceIp,
    tracks: { video: ["JPEG"], audio: ["PCMU"], metadata: true },
    signal: cancellation.signal
});
```

`media.consume` calls the real `runtime.consume(td, { principal })` and binds
the returned object by identity. A different runtime/executor or an
unassociated consumed object cannot borrow that identity. Principals,
target references and policy are not inferred from TD JSON. The caller owns
TD retrieval, authentication and verification; `document` records the
effective retrieval location, not the Thing ID. It is optional for already
absolute Forms and required when using a FormReference. Relative native
Forms use the TD's base, or this explicit document location when no base
exists, without modifying the caller's TD.

The default registry is the verified packaged catalog. An explicitly supplied
registry remains local authority. URI Actions must be generated Media1
GetStreamUri, Media2 GetStreamUri, or Replay GetReplayUri with their full
native binding/portType/operation and request/response identities.
`runtime.invokeAction` performs the selected actual node-wot interaction;
only its finite SOAP output is read with `.value()`. The return variant is
schema-checked before reading Media1 `MediaUri.Uri` or Media2/Replay `Uri`.
There is no arbitrary `extractionUri`, property-name search, or URI-looking
string fallback.

`formIndex` selects a native Action Form. Alternatively, an explicit named
FormReference checks unique membership across the TD, the actual document,
the requested Action, and the standard operation:

```typescript
const session = await openMedia(runtime, thing, {
    ...request,
    formRef: {
        document: effectiveTdRetrievalUrl,
        form: "urn:device:form:media-resolver",
        operation: "https://www.w3.org/2019/wot/td#invokeAction"
    }
});
```

These fields correspond to `av:document`, `av:form`, and `av:operation`.
`form` is the Form's absolute `@id`, never its `href`. There is no first-Form
fallback for a FormReference; a supplied `formIndex` must agree. The actual
resolved Form target is passed as the runtime's `target` option.
Unresolved URI templates fail with `UnsupportedCapability`: choose an
existing concrete, independently authorized Form rather than inventing an
endpoint or treating a Thing ID as a retrieval location. Returned native
RTSP URIs must be absolute and have an explicit port.

`addressing` preserves the runtime's WSA2004/WSA2005 logical To and reference
headers. `timeoutMs` bounds the total resolver/credential/SETUP open, and
`signal` continues to own cancellation after readiness. Metadata uses the
public `runtime.decodeMetadata` and the complete generated source registry,
not a separate DOM-to-object mapper.

## Private security and process ownership

The async security resolver receives an immutable `MediaSecurityScope` plus
an AbortSignal. Its `MediaSecurityMaterial` must match `thingId`, `targetRef`,
`principal` and native `origin`. Digest credentials additionally match the
exact origin, principal and realm. HTTP/HTTPS tunnel credentials have a
separate outer HTTP(S) origin and realm. The provider is application-owned;
there are no production fixture accounts or environment credential defaults.

Targets, credentials and PEM never go in worker argv. Six private pipes carry
stdin commands, stdout control, separately drained stderr, fd3 binary output,
fd4 one SECURITY envelope followed by EOF, and fd5 PCM input. DLL PATH and
GStreamer DLL settings are changed only in the spawned child's environment.
The native worker controls its plugin inventory. No trust-disable flag,
system certificate installation or plugin-path fallback is introduced.

The adapter requires scoped-auth revision 2 or later within IPC protocol 2,
then validates the actual decoder/transport/control/plugin declarations.
The revision label is retained, not confused with a new wire version.
P0/v1 and missing scoped lifecycle capabilities fail closed. Native v2
revisions 3 and 4 use the same framing. Receive capabilities come from HELLO plus
negotiated READY tracks, not from an advertised URI alone.

Origins are exact normalized native `scheme://host:explicit-port` values.
`serviceTargets` separately authorizes the exact SOAP resolver targets.
`allowedTargets` can further restrict returned media URIs. Redirects require
explicit `allowedRedirectOrigins`, also present in `allowedOrigins`; these do
not authorize cross-origin credential reuse. Native SDP controls and UDP
peer/interface negotiation remain checked by the worker.

TLS uses normal certificate checks and optional per-session `caPem`. A
native certificate rejection becomes `InvalidSecurity` with structured
`nativeCode: "TlsCertificateRejected"`. `MediaNativeError` and
`MediaOpenError` do not echo arbitrary native message text or stderr.
Certificate diagnostic flags are separate bounded numeric observations.

## Receiving data and finite generations

`session.support`, `tracks`, `id`, and `nativeSessionId` distinguish validated
capabilities, negotiated tracks, the local IPC owner, and the actual
server-issued RTSP Session. READY means accepted native SETUP/PLAY, not
receipt of a first sample.

`session.frames()` returns an object-mode Node Readable of complete I420 or
S16LE decoded units. `metadata` and optional `packets` are bounded async
iterables; `packetOutput: true` requests original RTP packets and RTCP sender
report observations. Returning/destroying one receiver detaches only that
subscriber. All requested outputs must be drained if lossless recorded
progress is required; unread outputs can exhaust the shared native credits.
Live overflow drops complete units with gap diagnostics, never splices
partial image buffers. Recorded output backpressures instead of silently
dropping its retained units.

Each metadata record preserves the complete original `xml`, canonical
`value`, RTP fields, `originalSource` (Thing/target/URI/native session/track/
SSRC), and `clock` (RTP rate and timestamps, native monotonic receipt time,
and a same-generation/SSRC sender-report observation when available).
Frame Object absence, Event blocks, vendor ordering, QName namespace maps
and lexical numbers/times remain canonical data. No synthetic capture UTC
is created. All wire u64 values use bigint. RTP NTP is 32.32 fixed point
since 1900; decoded unknown PTS is `undefined`; native monotonic receipt
time is not wall-clock UTC. Sender reports are observations, not an
extrapolated or hardware-accuracy guarantee.

IPC parsing checks magic, version, channel, length, correlation, monotonic
sequences, descriptor byte counts, format and negotiated track. Partial
frames and private writes have deadlines. Output credits include the
24-byte envelope and are returned once per fully released unit; they do not
reset at a new generation.

Native END is an observation with `lastDataSequence`, not CLOSED. The control
pipe can lead fd3, so the adapter waits for the exact watermark, then drains
already queued units before ending that generation's iterators/Readables.
Missing terminal bytes, premature fd3 EOF, or post-watermark data fail
explicitly. Live streams without END remain continuous until cancellation
or close; do not collect them into a single `.value()` or unbounded array.

## Backchannel

Request `tracks.backchannel: "PCMU"` only for live media. A Writable is exposed
only after HELLO advertises the actual fd5 contract and READY includes track 4,
send-only PCMU at 8 kHz. Its object-mode chunks are:

```typescript
session.backchannel.write({
    format: "S16LE",
    sampleRate: 8000,
    channels: 1,
    ptsNs: 0n,
    bytes: first320BytePcmBlock
});
```

Chunks contain 160..800 samples in multiples of 160: 320..1600 bytes.
`ptsNs` must exactly equal all prior submitted sample counts multiplied by
125000n, beginning at zero. Format, byte bounds and sample-clock continuity
are validated for both `write(chunk)` and `end(chunk)`. Submitted bytes are
copied. Observe standard Writable backpressure (`write` returns false, then
await `drain`); the high-water mark is one object and the hard queue bound is
eight objects. Drain writes before PLAY/PAUSE/SEEK.

fd5 uses its own increasing sequence and the current acknowledged generation.
Its 16-byte big-endian descriptor contains track=4, format=2, rate=8000,
channels=1, reserved=0 and sample count; PCM bytes remain little-endian.
The native worker derives PTS from its sample count. The parent paces chunks
at their sample duration because v2 has **no inbound credit or remote send-ACK
message**. Pipe callbacks/`finish` mean local transfer/pacing, not remote
playback or acceptance. `.end()` flushes and closes only the sending pipe;
receive tracks and native session controls remain open. Invalid input closes
that Writable with a typed error rather than sending malformed PCM.

Valid native CLOSED supplies actual `backchannelPackets` and
`backchannelSamples`. These fields are absent without a valid receipt, never
synthesized from local writes, and do not establish that hardware played
audio. Closing the whole session can discard unfinished sending work.

## Controls, cancellation and cleanup

`pause`, `play`, and recorded-only `seek` change public state/generation only
after the matching native CONTROL receipt. SEEK uses increasing bigint
nanoseconds since 1900, at/after the Unix epoch and within signed i64.
PAUSE preserves generation; accepted PLAY/SEEK advances it. Future-generation
data waits boundedly for that ACK, and intentionally obsolete data is
discarded with gap accounting. A later PLAY/SEEK opens a fresh finite
generation after END.

`close()` is idempotent and returns the same promise as `closed`. The result
distinguishes `acknowledged` (actual 2xx TEARDOWN), `already-ended` (454),
`uncertain`, and `not-created`; a successful local pipe write never creates
a native ACK. Completed local cleanup requires valid CLOSED plus observed
successful process exit. Exit alone, CLOSED alone, a failed close, or an
owned deadline kill cannot become successful remote cleanup.

Cancellation during OPEN/SETUP or pending SEEK sends an owned CLOSE using
the last acknowledged generation, including zero before READY. The native
v2 contract permits correctly scoped older-generation CLOSE. Late READY/ACK
does not reopen a cancelled session. Before OPEN, input EOF cancels startup.
All subscribers and pending controls settle without waiting for consumers
to drain data queues. Only the owned worker PID may be terminated, after
the close deadline; unconfirmed exit and remote uncertainty remain explicit.

`MediaOpenError.cleanup` reports cleanup of an unsuccessful open.
`media.close()` rejects further opens, cancels pending opens and awaits all
owned ready sessions. Runtime shutdown remains the caller's separate
responsibility. Root exports, package staging, and bridge composition are
owned by the package integrator.

## Reproduce the owned slice

Use existing Node >=20.19 and the repository's installed TypeScript. No
dependency installation or root build is needed for the isolated slice:

```powershell
$node = "C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe"
& $node .\node_modules\typescript\bin\tsc -p .\onvif\tools\tests\reference-runtime\media\tsconfig.json
& $node .\node_modules\typescript\bin\tsc -p .\onvif\tools\tests\reference-runtime\media\tsconfig.unit.json
$tests = @(Get-ChildItem .\onvif\tools\tests\reference-runtime\media -Filter "*.test.cjs" -File | ForEach-Object FullName)
& $node --test --test-timeout=30000 @tests
```

The packaged-registry case uses the existing first-party artifact stager only
inside the isolated `.compiled` directory. A composed test runner uses its
already staged distribution instead, without an isolated fallback.

The real-worker runner is separate and fails clearly unless all explicit
dependencies are provided:

```powershell
$env:ONVIF_MEDIA_NATIVE_TEST = "1"
$env:ONVIF_MEDIA_WORKER = (Resolve-Path .\onvif\samples\reference-runtime\native-media\build-p0\bin\onvif_media_worker.exe).Path
$env:ONVIF_MEDIA_SDK_ROOT = "$env:TEMP\acf-media-research\onvif-native-p0-runtime-c82da58f-20260916\sdk"
$env:ONVIF_MEDIA_PYTHON = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
& $node --test --test-timeout=50000 .\onvif\tools\tests\reference-runtime\media\native.integration.cjs
```

These fixtures bind only owned loopback endpoints. They exercise actual
native TCP, UDP unicast, HTTP/HTTPS tunnels and TLS interleaving, four replay
generations, PCMU backchannel, canonical metadata and independent decoded
byte/packet/sample oracles. Fake processes separately prove private IPC and
deadline behavior; they do not substitute for the native runner.

Unqualified/unsupported here: unresolved URI templates, reverse replay,
multicast, SRTP/MIKEY, EXI, native mTLS, arbitrary codec profiles, non-Windows
worker packaging, real cameras and hardware certificate/audio behavior.
All seven profile catalogs remain source-compilation evidence, not a claim
that every profile's device/client obligations are exercised by this media
slice.
