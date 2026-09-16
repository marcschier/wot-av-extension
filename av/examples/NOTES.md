# Native-first media examples: 0.2-proposed

**Use native ONVIF first when the camera and application already support the
required services.** These examples add optional descriptions and metadata
matching across cameras, files and an explicitly selected processor. They do
not add camera controls or implement a universal controller.

The namespace `https://example.org/wot/av/0.2#` and context
`https://example.org/wot/av/context/v0.2` are unregistered, unhosted proposal
identifiers. This is an honest breaking revision, not an alias or conformance
claim for v0.1. The core has seven classes, 29 AV properties and **zero required
AV profile documents**. Historical material belongs under
`av\support\history\v0.1-proposed`, not in the active examples.

All endpoints, native tokens, author roles and payloads here are fictional.
No credential, reachable device, processing result or successful control
invocation is supplied. HTTP demo Things declare bearer metadata without a
token; the RTSP example declares hypothetical native Digest metadata. Neither
is a universal ONVIF authentication default or proof of authentication.
There is no ONVIF, RTSP, decoder, conversion, scheduling, admission or sink
runtime in this directory.

## Scenarios and authors

| Files | Who authors what; how to use it | Absence/default and native authority |
|---|---|---|
| `source.td.json`, `encoded-need.jsonld` | The source publisher describes one HTTP JPEG Still. A workload author requests the encoded 1280x720 interface. | One GET reads an existing image. No new exposure, exact freshness, Live semantics or raw-pixel delivery is inferred. No processor is selected in the encoded Need. |
| `processor.td.json`, `need.jsonld` | A processor implementer defines explicit `convert` and `inspect` Actions plus a separate BGR8 output Offer. The workload author requests that advertised raw input. | JPEG does not directly match BGR8. Conversion, decoder support, native authorization and a real returned `imageId` are separate prerequisites, not matcher side effects. |
| `live.td.json`, `live-need.jsonld` | A read-only adapter publisher projects one complete native Media2 profile; the workload author requires simultaneous H.264 and AAC in one Mode. | Missing audio is not filled from another Mode or private adapter knowledge. Missing cadence is unknown. Native SOAP, RTSP, RTP and codec initialization remain authoritative. |
| `clip.td.json`, `clip-need.jsonld` | A file publisher advertises one whole finite H.264 MP4; a workload author selects that whole item. | GET and the container own access and extent. There is no invented seek, zero duration, frame selector or Live conversion. |
| `pcm.td.json`, `two-input-need.jsonld` | A publisher describes PCM inside a finite WAV item. A workload author names an inspection image and an optional independent reference recording. | PCM sample format is not an RTP clock or a claim of headerless bytes. Including the optional input keeps every constraint hard. No processor, synchronization or joint transaction is selected. |
| `result-need.jsonld`, `processor.td.json`, `sink.td.json` | The requester selects `inspect` output and a receiving Action. Producer and receiver owners define their native payload schemas. | The processor explicitly accepts an optional `destination` parameter. Omitting it requests no push. Form selection is neither routing execution nor delivery, authorization or durability evidence. |
| `onvif-adapter.json` | An integrator supplies an illustrative read-only native adapter configuration. | It is not ONVIF JSON on the wire or configuration for a shipped implementation. Native responses supply tokens and service addresses; no AV camera-control terms are introduced. |
| `expected-matches.json`, `query.rq`, `live.query.rq` | Example authors supply an offline comparison oracle and optional directory prefilters. | These are developer examples, not mandatory AV profiles, accepted-work records or native capability tests. |

## Start with an encoded Still, not an implied decoder

`source.td.json` is a complete native TD with one named Property Form, one
Offer, one Mode and one Track. `av:source` is the Thing identity;
`av:document` explicitly locates its TD. The media address appears in the
native Form's `href`, not a second AV endpoint field.

The Form declares `readproperty`, HTTP `GET` and `image/jpeg`. Its payload is
JPEG bytes. The Property deliberately has no invented JSON binary type or
base64 schema. Native `readOnly` and `observable` describe access to that
Property; the AV facts themselves are descriptions, not writable settings.

`encoded-need.jsonld` matches this encoded interface. `need.jsonld` instead
requests the processor's own contiguous BGR8 output and therefore rejects the
camera JPEG. This source restriction is intentional: the example `inspect`
API accepts a local `imageId`, not arbitrary raw images from any Thing.
Requests for another implementation need that implementation's real input
contract.

## Explicit conversion uses ordinary application parameters

The processor's `convert.input` is a native WoT DataSchema for ordinary JSON
parameters. It selects an existing JPEG Form and explicitly requests BGR8,
contiguous layout and unchanged 1280x720 geometry. Missing parameters,
unsupported media, unexpected dimensions, native failures and authorization
failures are errors, not defaults or automatic resize instructions.

This is a complete **unsent example Action input**, not a TD, a control
invocation or an accepted-work record:

```json
{
    "source": {
        "document": "https://media.example.org/source.td.json",
        "form": "urn:example:av-example:form:snapshot",
        "operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "pixelFormat": "BGR8",
    "bufferLayout": "Contiguous",
    "width": 1280,
    "height": 720
}
```

An actual successful conversion would return the native output schema's
`imageId`, `document`, `form` and `operation`. The `image` Property uses
`imageId` as a declared URI variable; it has no latest-image fallback. No real
ID or successful response is claimed here. A FormReference alone cannot fill
this native parameter or prove that its image exists. The current offline
Form resolver deliberately rejects URI templates: a native-capable application
must supply template expansion and the actual returned parameter. That access
limitation is separate from the positive raw-output metadata match.

The separate output Offer describes packed, row-major BGR8: 1280 columns,
720 rows, three uint8 components per pixel, a 3840-octet row stride and
2764800 total octets. Native GET returns `application/octet-stream`, not a
JSON object. Those geometry and layout facts do not specify an inference
tensor, model, normalization pipeline or processing throughput.

The processor's `inspect` Action consumes such a local image. Its output
DataSchema declares `resultId`, `imageId` and `meanBlue`: the arithmetic mean
of the blue-channel byte values over all 921600 pixels, from 0 through 255.
This small application result needs neither a generic inference-result
vocabulary nor an invented execution receipt.

## ONVIF Media2: one profile, one complete live Mode

`onvif-adapter.json` represents ordinary integrator configuration, not a
serialization of a SOAP envelope. Its hypothetical implementation must:

1. Call Device `GetServices` with `IncludeCapability=true` and resolve the
   Media2 namespace to the returned service `XAddr`.
2. Call Media2 `GetProfiles` with `Type=["All"]`, retaining the profile and
   component configuration tokens together. Query profile-scoped encoder
   options where needed; options are not observed settings.
3. Call Media2 `GetStreamUri(Protocol, ProfileToken)` for the selected native
   profile, then use a native RTSP/RTP implementation. Project only supported,
   known facts; do not invoke configuration setters.

The configuration's `"profile-main"` is a fictional device-issued
media-profile token. It is not an ONVIF conformance-profile name. The matching
Form carries that native token as `dcterms:identifier`; its RTSP `href`
represents an independently returned URI, not one computed from the token.
`live.td.json` shows exactly one complete H.264 1280x720 plus AAC mono 48 kHz
Mode. The AAC sampling frequency is a media fact, not merely a signaling
clock-rate value.

The exact constant `30/1` cadence is explicitly synthetic example evidence.
A real publisher must establish that media fact separately; an encoder
`FrameRateLimit`, a device maximum, or an SDP/RTP clock is insufficient.
If exact cadence is unknown, omit both cadence and frameRate; this strict
Live Need then does not match. If an essential concrete field or the
complete track roster is unknown, do not publish that concrete Mode.

The native Form's `application/sdp` is **signaling**, never video bytes.
Reading that description does not deliver the H.264 and AAC tracks.
DESCRIBE, SETUP, PLAY, transport selection, authentication and native codec
initialization require a native-capable client. The illustrative
`readproperty` association does not assert a standardized or implemented
ONVIF-to-WoT binding. No HTTP method annotation is applied to RTSP.

No H.265 alternative is advertised merely because ONVIF Profile T mentions
H.264/H.265: a product need not expose both. Adding one would require a
separately established complete native profile, its own returned access
Form and its actual simultaneous roster. A `fixed` native profile token
also does not mean immutable configuration.

| Configuration field | Author and how it is supplied | Omission/default rule |
|---|---|---|
| `adapter`, `deviceService`, `credentialRef` | Integrator selects a native Media2 implementation, configured Device endpoint and local secret reference. | Required by this illustrative adapter contract; no embedded password, guessed device or anonymous fallback. The adapter name is not a package or executable supplied here. |
| `mediaServiceNamespace` | Integrator chooses `http://www.onvif.org/ver20/media/wsdl`; discover its actual `XAddr`. | No guessed Media endpoint, silent Media1 substitution or generic URL-to-service inference. |
| `GetServices.IncludeCapability` | Explicit `true` requests capability information from the Device service. | This example does not rely on an adapter default. |
| `GetProfiles.Type` | Explicit array containing `All` requests all configuration information. | Omitted `Token` means all profiles; omitted `Type` means no configuration information. Those are native Media2 rules, not AV defaults. |
| `GetVideoEncoderConfigurationOptions` tokens | Select `ProfileToken` and `ConfigurationToken` from the same device and relevant profile context. | No invented token defaults; unrelated capability maxima cannot be combined into a Mode. |
| `GetStreamUri.Protocol`, `ProfileToken` | Explicit `RTSP` and selected native token use the Media2 request shape. | `RTSP` selects RTP over RTSP/TCP, not TLS. Unsupported or policy-incompatible choices fail; Media1's `StreamSetup` shape is not substituted. |
| `GetSnapshotUri.ProfileToken` | Integrator separately requests native snapshot support for the profile. | Omission means no requested snapshot lookup. A returned JPEG is not a newly triggered exposure or a JPEG stream encoder requirement. |
| `configurationWrites` | Integrator explicitly sets `false`; the described adapter is read-only. | `false` is this adapter contract's invariant/default, not an ONVIF setting. A request for `true` is rejected, not converted into setters. |

Primary native definitions: [Media2 profile configuration selection][profiles],
[profile-scoped encoder options][options], [Media2 stream URI requests][stream],
[snapshot URI semantics][snapshot] and [native streaming operations][rtsp].
These pinned public sources define ONVIF behavior; the example AV annotations
do not.

## Whole clips and named inputs do not introduce scheduling

`clip.td.json` offers one H.264-only MP4 with one native whole-item GET Form.
The finite media extent and timestamps remain in the container. Absent
duration is unknown, not zero; no frame index, timestamp interval, range
support or seek operation is invented.

`pcm.td.json` similarly offers a whole finite WAV recording. `av:PCM`
describes the contained samples, while `audio/wav` describes the native
payload container. S16LE, 48000 samples/second/channel, Mono and Interleaved
are explicit facts; none is a host-format or audio default.

`two-input-need.jsonld` uses the logical names `inspection` and
`reference-audio`. These names identify inputs within the Need, not device
indices or native track tokens. The image is Required. The independent
audio reference is Optional, but when included it must satisfy every
declared fact. A missing required image cannot produce a successful empty
selection. No target processor is named because the illustrated single-image
processor does not implement this two-input application contract.

## Normalize before comparing; preserve native access separately

`av:accepts` is an **object-valued opaque JSON-LD `@json` literal**, containing
JSON Schema 2020-12. It validates a normalized description of one complete
Mode, not a TD, JPEG bytes, PCM samples, Action parameters or a DataSchema
graph. An omitted `$schema` uses 2020-12; another dialect is rejected.
The schemas use only local references such as `#/$defs/video`. Required
schema references must resolve without an external fetch.

The complete normalized Live comparison object is:

```json
{
    "av:source": "urn:example:av-example:live-source",
    "av:kind": "av:Live",
    "av:track": [
        {
            "dcterms:identifier": "audio",
            "av:representation": "av:EncodedAudio",
            "av:codec": "av:AAC",
            "av:sampleRate": 48000,
            "av:channels": 1,
            "av:channelLayout": "av:Mono"
        },
        {
            "dcterms:identifier": "video",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:H264",
            "av:cadence": "av:Constant",
            "av:frameRate": {
                "av:numerator": 30,
                "av:denominator": 1
            }
        }
    ]
}
```

Its root has exactly `av:source`, `av:kind` and `av:track`. Known controlled
IRIs use the fixed `av:` spellings; the source is an absolute Thing IRI.
Tracks have unique identifiers and are sorted by `dcterms:identifier`.
Resource `@id`/`@type`, context, Form addresses, security and native
parameters are outside this comparison value, including inside the
frameRate object. Keep the original Offer, Mode and TD for later native
Form resolution; do not discard their access authority.

Every hard fact uses `required`, including the Rational numerator and
denominator. `properties` alone constrains a field only when present.
`default` does not fill publisher facts. The joint Live requirement uses
`allOf` and two `contains` branches against the **same track array**. Local
`$defs` keep those complete branches readable. Track order never supplies
priority or permits crossing Mode or graph boundaries.

The exact reduced pair `30/1` differs from `30000/1001`; there is no rounding,
general rational inequality engine or cross-field arithmetic promise.
Media frames/second is not decoder throughput, losslessness, processing
latency or wall-clock delivery rate.

Full JSON Schema features appear only inside `av:accepts`, not inside native
TD `input`, `output` or Property schemas. Those native payload contracts use
the standard WoT DataSchema subset. Native schema validity still does not
prove transport support, application semantics or optional format assertions.

### Illustrative application matching, not a runtime API

The following ordinary Python helper uses the repository's
`av\tools\matching.py` API with `tools` on the Python module path, as in the
repository validators. It operates on already-loaded, locally validated TDs.
Invalid descriptions/schemas raise errors, including when no Offers are
available. The returned records are candidates, **not accepted work**.

```python
from matching import matches_input, validate_input


def metadata_candidates(td, requirement):
    validate_input(requirement)
    candidates = []
    for offer in td.get("av:offer", []):
        for mode in offer["av:mode"]:
            if matches_input(requirement, offer, mode):
                candidates.append({
                    "input": requirement["dcterms:identifier"],
                    "source": offer["av:source"],
                    "mode": mode["@id"],
                    "document": offer["av:document"],
                    "form": mode["av:form"]
                })
    return candidates
```

Selecting a native operation is a separate step after resolving the named
Form. No HTTP, SOAP, RTSP, decoder, converter or receiving Action is invoked
by this helper. Empty candidates mean no metadata match, not successful
acceptance of a missing Required input.

## Result contracts and explicit destinations

`result-need.jsonld` selects the producer's existing `inspect` Action Form
with the standard `td:invokeAction` IRI. Its native Action `output` is the
result DataSchema. The example deliberately uses Action output rather than
pretending that a result Event or callback transport is implemented.

This complete reference selects the result interaction; it is not an
invocation or an alternative payload schema:

```json
{
    "@type": "av:FormReference",
    "av:document": "https://processing.example.org/processor.td.json",
    "av:form": "urn:example:av-example:form:inspect",
    "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
}
```

The optional `av:destination` in that Need names `sink.receive`. The sink's
native Action `input` exactly matches the declared producer payload schema.
The processor's `inspect.input` explicitly has an optional `destination`
object. An application may translate the selected reference into that
ordinary parameter only for this supporting API; `convert` does not accept
a destination. Selection metadata alone never creates a callback.

This is an **unsent input shape**, using a clearly unissued placeholder ID:

```json
{
    "imageId": "illustrative-id-not-issued",
    "destination": {
        "document": "https://results.example.org/sink.td.json",
        "form": "urn:example:av-example:form:receive-result",
        "operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

Omit the optional native parameter when no push is requested. Omitting
`av:result` means no declared result selection, not "no output" or
"arbitrary output is compatible." Omitting `av:destination` means no
requested push. Including a destination requires a result and explicit
native support, required parameters, compatible payloads and independent
authorization. Native delivery and durability remain separate questions.

Resolve Forms by their unique absolute `@id` inside the stated TD, never by
taking the first Form, substituting `href`, or retrieving a Thing IRI as
though it were a TD URL. Preserve TD base resolution, native URI variables,
security inheritance and native operation defaults. These Forms explicitly
declare lowercase TD `op` tokens; a FormReference uses the corresponding
standard TD operation IRI. `document` is a retrieval location, not a digest
pin or authenticity guarantee.

## Complete thin vocabulary ownership and defaults

The following covers every proposed class and every AV property used by these
examples. "Publisher" includes an explicit adapter's or converter's own
output publisher; it does not confer authority to change the original device.

| Class | Author and how to supply it | Absence/default |
|---|---|---|
| `Offer` | Publisher identifies one source Thing, its TD document and a nonempty set of complete alternative Modes. | No annotation makes no AV advertisement; it does not deny native capabilities. |
| `Mode` | Publisher identifies one kind, named native Form and complete simultaneous Track roster. | Do not synthesize a missing combination from other Modes or maxima. |
| `Track` | Publisher supplies an absolute identity, unique local `dcterms:identifier`, representation and applicable concrete facts. | Missing essential facts prevent that concrete Mode; other absent facts are unknown. |
| `Rational` | Publisher supplies a reduced exact numerator and positive denominator; a frame rate must be positive. | No denominator-one or nominal-rate fallback. |
| `Need` | Workload author identifies a requested revision and named inputs, optionally a processor and result/destination. | No active-state, generation, execution or acceptance is implied. |
| `InputRequirement` | Workload author supplies a unique logical name, explicit presence and one complete acceptance schema. | Missing presence/schema is invalid; Optional relaxes inclusion only. |
| `FormReference` | Selecting party names a TD retrieval location, native Form identity and standard TD operation. | All three fields are required; no first-Form, address-as-identity or implicit-document fallback. |

| AV property | Author; value and how it is used | Absence/default and native boundary |
|---|---|---|
| `offer` | Publisher attaches identified Offer records to a native Thing; unordered set. | Optional annotation; no implied absence of native features. |
| `need` | Workload author associates identified Need revisions with an application Thing. | Optional; no implied current state or work submission. |
| `source` | Publisher uses the absolute native Thing IRI for the Offer, including a converter's own output Thing. | Required; not a media address or TD retrieval shortcut. |
| `mode` | Publisher enumerates complete jointly offered alternatives, not independent parameter arrays. | Nonempty; order is not preference or simultaneous availability. |
| `kind` | Publisher explicitly states Still, Live or whole finite Clip. | Required; Still is not fresh exposure and Clip has no duration-zero default. |
| `form` | Publisher or selecting party gives an absolute native Form `@id` in the stated TD. | Required in a Mode/reference; never `href`, an array index or a guessed binding. |
| `track` | Publisher supplies the entire simultaneous roster with unique identities and names. | Nonempty; missing audio is not implied video-only knowledge about some other stream. |
| `representation` | Publisher describes actual EncodedVideo, RawVideo, EncodedAudio or PCM at this interface. | Required; never implies decoding, conversion or native client support. |
| `width` | Publisher states a positive exact integer video/image width in pixels. | Required for video, absent for audio; not a sensor maximum, stride or tensor dimension. |
| `height` | Publisher states a positive exact integer video/image height in pixels. | Required for video, absent for audio; no resize or sensor-maximum fallback. |
| `codec` | Publisher names the actual encoded family: H264/JPEG/H265 or AAC/Opus as applicable. | Required only for encoded tracks; initialization and transport negotiation remain native. |
| `pixelFormat` | Publisher gives the actual RawVideo component order and packing, such as BGR8. | Required for RawVideo only; no RGB, host-native or color-conversion default. |
| `cadence` | Publisher optionally describes known Constant, Variable or Triggered live/clip video cadence. | Absent means unknown; forbidden for Still/audio. Triggered does not expose a trigger Action. |
| `frameRate` | Publisher supplies a positive reduced Rational in frames per media second for Constant cadence. | Required with Constant, absent otherwise; not rounded FPS, delivered-losslessness or throughput. |
| `sampleRate` | Publisher supplies positive exact audio samples/second/channel. | Required for audio, absent for video; no default 48000 or inference from an RTP clock. |
| `channels` | Publisher supplies the actual positive exact audio channel count. | Required for audio; no mono/stereo default; must agree with channelLayout. |
| `channelLayout` | Publisher describes channel meaning/order, such as Mono/1 or StereoLR/2. | Required for audio; not inferred from count or confused with buffer layout. |
| `sampleFormat` | Publisher describes actual PCM numeric representation, such as S16LE or F32LE. | Required for PCM only; no host numeric-format or encoded-audio default. |
| `bufferLayout` | Publisher names image Contiguous/Strided or audio Interleaved/Planar layout as applicable. | Required for RawVideo/PCM; native strides, colorimetry and memory access are not filled by this category. |
| `numerator` | Publisher supplies the exact integer part of a reduced Rational; positive for frameRate. | Required; no zero or approximate-floating fallback. |
| `denominator` | Publisher supplies a strictly positive exact integer denominator with gcd reduction. | Required; no implicit denominator 1. |
| `processor` | Workload author optionally names the target processing Thing, not a running worker or learned model. | Missing means no target selected; discovery and execution stay external. |
| `input` | Workload author supplies a nonempty set of uniquely named InputRequirements. | Missing/empty is invalid; distinct from the native Action `input` DataSchema. |
| `presence` | Workload author explicitly chooses Required or Optional for the whole logical input. | Required, with no default; included optionals retain all hard constraints. |
| `document` | Publisher/selecting party supplies the explicit TD retrieval IRI; an Offer's TD identifies its source Thing. | Required for Offers/references; preserve native base and do not invent immutable-byte guarantees. |
| `operation` | Selecting party uses an existing standard TD operation IRI supported by the named Form. | Required in a reference; native lowercase `op`, binding rules and defaults remain native. |
| `accepts` | Workload author supplies an object-valued JSON Schema for the normalized whole incoming Mode, carried as `@json`. | Required; 2020-12 is the omitted-dialect default. Hard facts require `required`; schema defaults inject nothing; unresolved/nonlocal refs prevent matching. |
| `result` | Workload author selects a native producer Form; its Property schema, Action output or Event data owns the payload contract. | Optional; no inferred completion, arbitrary-output compatibility or guaranteed output. |
| `destination` | Workload author selects a receiving writable Property or Action Form whose owner defines input/security. | Optional, requires result; absent means no requested push. Explicit processor support and native parameters/authorization are still necessary. |

`dcterms:identifier` is an ordinary string local to the containing Mode or
Need, not a global codec, topic or native device token convention.
`dcterms:isVersionOf` is optional ordinary revision metadata, not a
generation protocol. Descriptions and author metadata confer no authority.
All example integers use exact safe JSON integer tokens; larger exact
values require the vocabulary's explicit typed-integer representation.

## Human and machine expectations

`expected-matches.json` contains five complete normalized descriptor oracles,
named positive/negative comparisons, cross-Mode and named-input cases,
invalid descriptions/schemas, native reference/access checks and clearly
synthetic payloads. Its `documents` object is a small offline fixture lookup, not a
runtime pin manifest. Every location maps to a local example; there is no
network fallback. JSON Patch operations there mutate test copies only.

| Comparison | Expected metadata outcome |
|---|---|
| JPEG source -> encoded Still Need | Match; no decoder or raw interface promised. |
| JPEG source -> raw inspection Need | Reject; no implicit decode or BGR conversion. |
| Explicit processor BGR output -> raw inspection Need | Match; a real image and native parameters remain unavailable until actual processing. |
| One Live Mode with H.264 and AAC at exact 30/1 | Match as a joint metadata contract, not transport/decoder qualification. |
| Audio in another Mode, or only in adapter knowledge | Reject; no Cartesian composition or invented advertised facts. |
| Still or finite Clip -> Live Need | Reject. |
| Whole finite MP4 -> whole-Clip Need | Match without an AV seek or duration default. |
| Constant 30000/1001 -> exact 30/1 Need | Reject without rounding. |
| Missing cadence plus a schema `default` | Reject; hard fact presence still requires actual metadata. |
| Optional PCM omitted / included with wrong sample format | Omission allowed / incompatible inclusion rejected. |
| Native result and sink FormReferences | Resolve the declared schemas only; do not invoke or route. |

`query.rq` and `live.query.rq` are optional discovery prefilters using native
Form membership and one TD graph per candidate. The Live query joins audio
and video within the same Mode and graph. These queries do not replace the
whole-Mode acceptance schema, validate an entire native transport binding,
or execute acquisition. Generated datasets and release manifests belong to
publication tooling, not the authored runtime contract.

[profiles]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Media2.xml#L713-L749
[options]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Media2.xml#L1285-L1313
[stream]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Media2.xml#L1377-L1439
[snapshot]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Media2.xml#L1469-L1489
[rtsp]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Streaming.xml#L1312-L1366
