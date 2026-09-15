# Media registry research report

**Public-standards-based edition, 14 September 2026. INFORMATIVE.**

**Editorial update for `0.2-proposed`: if ONVIF meets requirements, use ONVIF
directly.** Its services already cover discovery, configuration, PTZ/imaging,
live media, snapshots, supported analytics/events, and recording/replay;
Profiles S/T/G/M have different, support-dependent obligations. Distributed
analytics is also within ONVIF's architecture. An external processor does not
by itself require WoT.[^onvif-scope]

This report preserves the broader **historical `0.1-proposed` investigation**.
The new [native-first specification](../spec.md) makes WoT optional read-only
heterogeneous application integration: seven classes, 29 AV properties, and
zero mandatory AV profile families. Assignments, leases, pins, model manifests,
and lifecycle contracts discussed below are historical design alternatives,
not requirements of the active core. See the [migration note](../spec/migration.md)
and [ONVIF reuse boundary](../spec/onvif-integration.md).

The research originally investigated an additive design: use Web of Things descriptions for
native interactions and discovery, describe complete media Offers and workload
Needs alongside them, and record accepted Assignments separately from observed
execution and Results. Keep high-volume media on its native transport.
xRegistry can provide an optional, derived catalog view, including fixed-format
media Endpoints without message definitions or envelopes. Neither registry
metadata nor a successful schema check establishes a working media path.

This is a newly authored synthesis of public standards and the cleared
[research archive](archive/README.md), not a verbatim or fully comprehensive
edition of the earlier consolidated report. Private-source code, prose,
implementation findings, and source locators are omitted. The unredacted
original is retained unchanged locally and is not distributed or linked here.
Unavailable private evidence is not silently replaced by public citations.
Repository visibility does not supply redistribution permission; this edition
does not select a first-party reuse license.

The [specification](../spec.md) and
[authored term inventory](../vocabulary/terms.json) remain **normative for this
proposal**. This report explains rationale, alternatives, and limits; it adds
no vocabulary terms or conformance requirements. The AV namespace and context
URLs remain unregistered, unhosted examples, not W3C publications.

## 1. Research question and architectural answer

**How can heterogeneous cameras and media services advertise what they can
supply, let applications state what they actually need, and preserve evidence
of what was accepted and produced without inventing a universal media API?**

A useful answer has to cover a local industrial camera, a webcam, a network
stream, a retained image, and a finite recording. It also has to distinguish a
detector expecting image buffers from an indexer accepting uploaded clips.
Calling everything a URL, a message, or a model hides the differences that
determine whether the work can run.

The historical separation studied was:

| Layer | Responsibility | What it does not establish |
| --- | --- | --- |
| Description and discovery | Find TDs, complete media modes, and relevant contracts. | Reservation, permission, or current reachability. |
| Control and admission | Select a feasible plan; authorize configuration, capture, renewal, and release. | That samples have arrived or inference has started. |
| Media data | Acquire, transport, decode, and deliver selected tracks. | Durable results or complete recording coverage. |
| Artifacts and results | Retain assets, identify models, describe output payloads, and record provenance. | Exactly-once downstream effects merely from identifiers. |

This is an integration architecture, not an upstream standard's prescribed
deployment topology. A single process can implement several layers. Conversely,
the device owner, relay, processor, controller, and result store can be separate
authorities. WoT supplies interaction descriptions; it does not turn those
descriptions into running services.[^td]

The important distinction is between *saying*, *accepting*, and *observing*.
An advertised resolution says something about a source mode. An Assignment
records an accepted choice under identified dependencies. A readiness
observation says something about a particular execution scope and time.
Conflating these claims is how a catalog entry becomes an unjustified promise.

## 2. WoT: descriptions, reusable models, and discovery

A **Thing Description (TD)** describes a Thing's Properties, Actions, Events,
Forms, data constraints, and security configuration. A **Thing Model (TM)** is
a reusable description template from which TD instances can be derived.
`version.model` concerns that Thing Model, not learned weights; an inference
model artifact needs its own identity and version. A **Thing Description
Directory (TDD)** makes descriptions discoverable. These three roles should
not be collapsed into one registry record.[^td][^tm]

Preserve native interaction meaning: configuration or job submission can be an
Action, current status can be a Property, and notifications can be Events.
Annotations do not introduce arbitrary WoT operation names. Typing an Action's
output DataSchema also does not automatically type each runtime payload.
JSON-LD supplies semantic mappings, not an execution engine or a substitute
for payload validation.[^td][^jsonld]

**Native Forms remain the access authority.** A Form's `href`, operation,
content type, inherited security, URI variables, and effective base determine
access. Its named identity is distinct from that target and from the TD's
retrieval location. The proposal's `av:form` references a named native Form;
it does not duplicate its address. Stable Form identities are additional
proposal conventions; exact representation pins belonged to v0.1, not the
active core. Neither is a universal TD
identifier-resolution service. The native context maps `href` to an
`xsd:anyURI` literal, rather than an RDF link to the Form node.[^forms]

WoT Discovery already addresses registration and search. It is not necessary
to invent a parallel registration API solely because the descriptions concern
media. Capability distinctions still matter: listing is required, individual
CRUD interfaces are optional, and search is recommended rather than universal.
Use the directory's advertised interactions; do not assume every deployment
supports SPARQL, a particular graph layout, or change replay.[^discovery]

A candidate search is only a shortlist. Authorization filtering, timeouts,
unsupported queries, and incomplete pages are not evidence of a successful
empty search. Directory enrichment can also change TD bytes and add
registration metadata. Preserve whether a pin identifies publisher bytes or
a directory snapshot; removing enrichment does not reconstruct an authenticated
original. Change notifications are useful invalidations, but a missed interval
requires reconciliation rather than assumed completeness.[^discovery-watch]

## 3. Optional xRegistry projection, with the media correction

**Fixed-format media can use xRegistry Endpoints without `messages`,
`messagegroups`, or `envelope`.** Those constructs are optional; their absence
does not force media into a special non-endpoint descriptor. This edition
supersedes that overly restrictive recommendation in earlier research.
An additional media protocol still needs a specified binding and option model:
the general extension mechanism does not standardize its native behavior.
The Endpoint companion is not a general-purpose description of every camera
control API.[^xr-endpoint]

Endpoint usage is client-relative. A source from which clients consume media
projects to `usage: ["consumer"]`; a sink accepting media from clients projects
to `["producer"]`. `subscriber` describes subscription setup, not simply
"something reading video." Connection initiation and media direction are
independent. A bidirectional signaling exchange needs explicit media-leg
mapping rather than an arbitrary single-direction label.[^xr-usage]

The following **original illustrative fragments** show the single-authority
rule. This native Form fragment belongs inside a TD:

```json
{
    "@id": "https://example.org/things/camera/forms/latest",
    "href": "https://media.example.org/camera/latest.jpg",
    "op": "readproperty",
    "contentType": "image/jpeg"
}
```

A projector can derive this addressing view under a fixed HTTP/JPEG profile:

```json
{
    "endpointid": "camera-latest",
    "usage": [
        "consumer"
    ],
    "protocol": "HTTP",
    "protocoloptions": {
        "endpoints": [
            {
                "uri": "https://media.example.org/camera/latest.jpg"
            }
        ],
        "method": "GET",
        "deployed": false
    }
}
```

The second address is **generated, not independently editable**. The studied projection
manifest additionally identifies the exact TD pin, Form, complete Mode,
interpretation dependencies, and mapping-profile revision. Consumers reject
stale or inconsistent projections. The fragments omit full TD security and
binding dependencies and describe no deployed service; they are not complete
admission fixtures. HTTP uses the selector `HTTP`, and this example explicitly
selects GET rather than the binding's default POST.[^xr-http]

The xRegistry model's `ifvalues` mechanism conditionally introduces sibling
attribute definitions based on a selector value. It can therefore describe
protocol-specific `protocoloptions`, including a fixed media format's options.
It is **not runtime negotiation**: it does not perform RTSP setup, SDP
offer/answer, codec selection, camera reconfiguration, or capacity admission.
Extensions belong in a coherent composed model and cannot silently redefine
existing protocol semantics.[^xr-ifvalues]

Keep WoT primary even when both systems are deployed: publish or update the TD,
then regenerate the optional xRegistry view. Copying a TD into xRegistry does
not itself implement TDD registration, search, or notification behavior.
An Endpoint is a Group, not a versioned Resource. Resource Version contents can
also be replaced, and older versions can be pruned. Reproducibility therefore
requires trusted pins and retention policy, not merely a version-looking URL
or an extension called "digest."[^xr-version]

## 4. Offers, Needs, Assignments, and evidence

This section records the v0.1 design. Its whole-Mode distinction survives in
0.2; its typed constraint, assignment, and lifecycle frameworks do not.

The proposal treats an **Offer** as complete alternatives, not independent
capability maxima. One Mode combines acquisition configuration, native access,
simultaneous Tracks, and resource use. A camera advertising 1080p25 with audio
and 720p30 without audio has not advertised 720p30 with audio. Combining
independent search hits would invent a mode.

A **Need** describes named application inputs and acceptable alternatives.
The wire contract is distinct from the delivered contract: H264 arriving over
a stream is not contiguous BGR8 in application memory; AAC is not a PCM buffer.
Decoding, color conversion, resizing, audio resampling, and temporal
subsampling are separate changes with different costs and semantic effects.
The [v0.1 matching rules](../archive/v0.1-proposed/spec.md#6-needs-feasibility-and-acceptance) made
permission explicit instead of assuming that any available conversion is
acceptable.

Hard constraints precede preferences. Unknown audio capability cannot satisfy
required audio, and a video-only backend cannot erase that requirement.
Optional inputs and tracks need explicit omission records. Exact rate requests
also remain exact: `30/1` is not `30000/1001`. A better-preferred source that
fails one hard condition is not a fallback success.

An **Assignment** fixes an accepted selection and its dependencies, including
the adapter path and applicable authority. It is not an assertion that
processing occurred. Configuration changes or reallocation produce a new
accepted record; observations belong in **AssignmentStatus**. The distinction
allows a source to be discoverable while unavailable, accepted while not ready,
or application-ready before any contracted output exists.

The lifecycle separates media observation, application readiness, model
loading, and result commitment. A device lease is not artifact retention;
a directory TTL is not a capture grant. Renewal cannot retroactively refresh
stale observations. An uncertain trigger timeout needs reconciliation, not a
blind retry that may cause another physical exposure. These are proposed
coordination obligations, detailed in the
[v0.1 lifecycle specification](../archive/v0.1-proposed/spec.md#9-immutable-lifecycle-and-external-authority),
not capabilities supplied merely by WoT or xRegistry.

## 5. Native acquisition is not interchangeable network playback

GenICam provides feature-access and naming machinery, including GenApi, SFNC,
PFNC, and GenTL-related interfaces. It is not itself a universal stream URI.
Public Aravis code demonstrates separate device discovery, configuration,
buffer handling, and streaming paths. That is why an industrial camera's
identity and acquisition authority should not be reduced to a playback
address.[^genicam][^aravis]

| Family | Relevant access distinction | Consequence for a qualified path |
| --- | --- | --- |
| GigE Vision | Industrial discovery/control and streaming; Aravis programs a stream destination. | Network attachment alone does not provide an RTSP service or acquisition ownership. |
| USB UVC | OS multimedia-device access; Windows provides a UVC driver. | Resolve the device on its owning host and select a supported backend. |
| USB3 Vision | Separate industrial-camera interface and transport path, not simply UVC on a faster bus. | Qualify the SDK/GenTL/native stack and feature support independently. |
| RTSP/RTP | RTSP controls a session; SDP describes media; RTP carries media. | Session access, codec configuration, media clocks, and decoding remain separate concerns. |
| SRT | UDP-based data transport with recovery and timing mechanisms; caller/listener roles are independent of data direction. | Specify payload framing, roles, buffering, and measured limits; the protocol name is not a codec contract. |
| HLS | Playlists reference media segments and can describe alternate renditions. | Select rendition and timeline semantics; do not equate playlist retrieval with fresh camera acquisition. |
| WebRTC | A negotiated media path with implementation-specific codec/track support. | Qualify signaling and actual media legs; another working relay protocol is not interoperability proof. |

The first three distinctions are supported by EMVA, Microsoft's UVC
documentation, and pinned Aravis implementation paths.[^genicam][^aravis][^uvc]
The network distinctions come from ONVIF's streaming specification, the
historical SRT protocol draft, HLS's RFC, and the reviewed MediaMTX
implementation.[^rtsp][^srt][^hls][^mediamtx]

The archived Aravis baseline is **0.8.36**, not its separate development
snapshot. OpenCV findings use **4.13.0**, and the relay findings use
**MediaMTX 1.21.0**. In that relay snapshot, WebRTC selects at most one video
and one audio track; an AAC source is not automatically converted into
supported WebRTC audio. Codec adaptation belongs to an explicit adapter, not
an assumed property of changing the access URL.[^mediamtx]

A practical integration can acquire through the native device stack on an
authorized host and expose a separate network relay. This improves remote
consumer portability but adds buffering, format conversion, deployment, and
failure boundaries. Keeping direct local access may preserve native control
and avoid extra copies, but it increases platform and device coupling.
Neither choice is universally preferable.

## 6. OpenCV delivery, audio, clocks, and overload

OpenCV is useful at the decoded-frame boundary, but its backend behavior is
part of the contract. An installed FFmpeg executable does not establish that
OpenCV was built with a usable FFmpeg backend. A successful property `set()`
does not prove that the camera accepted the requested value; unsupported
`get()` operations can return zero. Preserve advertised capabilities,
requested configuration, readback, and observed delivery separately.[^opencv]

An indexed MSMF camera is not a persistent device identity. Re-resolve the
authorized device after enumeration changes instead of assuming that index
zero is always the same camera. Width, height, channel order, dtype, strides,
and memory ownership need delivery checks. Resizing decoded frames does not
configure the remote camera, and native acquisition buffers cannot be reused
while consumers still depend on their contents.[^opencv-device][^buffer]

Avoid both "OpenCV has no audio" and "`read()` supplies complete synchronized
A/V." The reviewed FFmpeg capture path filters nonselected-video packets,
while MSMF rejects simultaneous video/audio device-index capture in the cited
path. Audio support, stream selection, timing, and retrieval vary by backend.
A Need requiring audio therefore needs a qualified audio delivery path, not
an inferred capability from the container or camera brochure.[^opencv-audio]

Time also has several meanings: exposure, presentation, receipt, processing,
and durable commitment. RTP timestamps have payload-specific rates and
independent offsets; RTCP sender reports can relate clocks, but neither those
timestamps nor local arrival time automatically proves capture UTC. OpenCV's
reviewed FFmpeg PTS uses an FPS time base, not UTC. End-to-end age and A/V skew
need a valid clock mapping, identified clock incarnations, and uncertainty.
Without that evidence, report receive-age rather than relabeling it
capture-age.[^rtp][^opencv-pts]

Queue policy is similarly end-to-end. A one-buffer appsink does not bound
every upstream queue, and blocking an application does not guarantee that a
sensor can pause. Dropping stale decoded frames for inference can be useful;
dropping compressed packets has different consequences. Recording needs its
own coverage policy, bounded spooling or backpressure, and explicit gap
reporting. A dropping queue before the branch split already compromises
downstream recording completeness.[^queues]

This **original pseudocode**, not a library API or implementation claim,
illustrates buffer ownership and separate branch obligations:

```text
sample = acquire_with_deadline()
try:
    verify_layout(sample)
    owned, timing = retain_or_copy_payload_and_clock_evidence(sample)
finally:
    recycle_native_buffer(sample)

recording.enqueue_or_report_gap(owned, timing, bounded_deadline)
inference.replace_latest_and_account_for_drop(owned, timing)
```

The sketch still needs a qualified upstream queue policy and a decision about
whether recording failure aborts the work or yields an explicitly incomplete
asset. It does not make the recording path lossless, nor establish a latency
bound merely because the inference branch keeps only the latest sample.

## 7. Stills, clips, inference artifacts, and indexer results

**Still**, **Live**, and **Clip** have different temporal contracts. Reading
a latest JPEG can return an existing image; it need not trigger a new exposure.
A continuous multipart image response is not one finite still. A Clip has a
finite timeline whose selected interval and coverage matter. Repeated Still
reads do not prove a live frame rate.[^still]

Clip processing needs presentation timestamps, not simply frame-count
arithmetic using a nominal rate. Seeking can require preroll, and a
stream-copied recording may have codec/container or keyframe constraints.
FFmpeg 7.1.1's `-t` limits media duration, not wall-clock task execution or
arbitrary frame-exact boundaries. Early EOF is only successful if the required
coverage has actually been obtained.[^ffmpeg]

Four meanings of "model" or "schema" need separate identities:

| Item | What it describes |
| --- | --- |
| WoT Thing Model | Reusable Thing interaction structure. |
| xRegistry model | Registry Groups, Resource types, attributes, and constraints. |
| Inference model artifact | Executable learned graph/weights and required runtime dependencies. |
| Result payload schema | The serialized shape and validation rules for an output. |

ONNX describes graphs, tensor types, and metadata; weights can also reside in
external data files. For reproducible execution, application-owned model/artifact
packaging should identify the full
artifact set, tensor signatures, runtime compatibility, preprocessing,
postprocessing, and labels. A digest of one graph file is insufficient when
accepted external weights are unaccounted for. A result JSON Schema describes
neither those weights nor the algorithm that produced its values.[^onnx]

The earlier proposal consequently kept image delivery separate from model
preprocessing. Permission to decode JPEG to BGR does not authorize arbitrary
tensor layout conversion, normalization, letterboxing, or resizing. Detection
coordinates need the inverse geometry mapping back to the source image;
clip-relative observations need a mapping to the selected media timeline.
An undisclosed managed-service model remains unknown, not equivalent to an
accepted local model pin.

In v0.1, a **ResultContract** defined payload meaning, schema/dialect, output slots,
completion, gaps, and commitment expectations. A **ProcessingRun** recorded
what actually executed; PROV relationships express actual use, derivation,
generation, and responsibility rather than planned activity.[^prov]
The active core instead references the producer's native result DataSchema
and Form; it requires no AV result manifest or execution record.
A complete covered empty detection result is different from a failed job or
an absent response. Preserve those differences in both storage and events.

CloudEvents is appropriate for result notifications, not necessarily for
wrapping every video frame. Version 1.0.2 still uses runtime
`specversion: "1.0"`. Stable `(source, id)` supports duplicate recognition;
it does not supply durable deduplication or exactly-once effects. The
proposal uses event time for result availability, keeping media timestamps
inside the result. A transport acknowledgment and a subscriber's committed
effect remain different events.[^cloudevents]

The archived Azure AI Video Indexer investigation concerns asynchronous
**finite-file ingestion**. Upload acceptance is not completed analysis:
the recorded states include Uploaded, Processing, Processed, and Failed.
Retain application-job and provider-video identities, and reconcile callbacks
with authoritative index retrieval; callbacks may repeat or never arrive.
That evidence does not establish a still-image, RTSP/live-ingestion, or Arc
adapter.[^indexer]

Indexer outputs also need their own contract. Transcript and scene intervals
are not spatial detections, and clip-relative time is not automatically
capture UTC. Preserve required raw provider results before provider deletion,
and retain both provider provenance and any normalized derivative. Historical
API-version strings, quotas, and retention observations are not current
service guarantees.[^indexer-time]

## 8. Tradeoffs, confidence, and source history

The main tradeoff is descriptive portability versus executable completeness.
WoT plus an additive vocabulary avoids a second interaction language.
An optional xRegistry projection helps existing catalog consumers but creates
a consistency obligation. Exact pins improve reproducibility but do not
authenticate publishers, enforce retention, or authorize effects.
Complete mode matching avoids false compatibility at the cost of richer
descriptions and explicit admission work.

Confidence is **high in the cited representation and API distinctions** at
their stated snapshots, **conditional in the proposed integration design**,
and **unestablished for real hardware interoperability, measured latency,
losslessness, and production lifecycle enforcement**. Passing JSON, JSON-LD,
or SHACL checks does not establish those physical or operational properties.
The archived v0.1 worked Assignment remains deliberately **NOT ADMITTED**;
see its [historical fixture notes](../archive/v0.1-proposed/examples/NOTES.md).

The retained research is dated **14 September 2026**. Its WoT baseline is the
**5 December 2023** TD 1.1 and Discovery Recommendations. The xRegistry
investigation distinguishes published **v1.0-rc4**, released 19 August 2026 at
`d2433a8c726ab096303bd943a4fc6691925f7910`, from the inspected working draft at
`16483bb564586423de9c128db89f3b61d360f4e3`. A shared RC4 label does not make
those snapshots identical or final standards.[^xr-baseline]

Public implementation citations below retain the archived revision pins.
Unversioned vendor documentation remains a historical reference, not a
replayed observation. Focused public-source clarification for this edition
confirmed Endpoint optionality and `ifvalues`, and supplied the SRT/HLS
transport distinction; it did not rerun device or service experiments. The
SRT citation is explicitly an expired **2021 Internet-Draft**, not an adopted
IETF standard.

Earlier xRegistry compatibility notes preserve snapshot-specific conflicts,
including schema-document versus metadata references. They should not be
generalized into either universal conformance guarantees or a prohibition on
media Endpoints. The [archive index](archive/index.md) preserves that history;
the present report supplies a reading synthesis without changing its bytes,
dates, recorded outcomes, or the proposal's canonical authority.

## Primary sources

[^onvif-scope]: ONVIF, [Profile S v1.3, sections 6-8](https://www.onvif.org/wp-content/uploads/2019/12/ONVIF_Profile_-S_Specification_v1-3.pdf),
    [Profile T v1.0, sections 7-8](https://www.onvif.org/wp-content/uploads/2018/09/ONVIF_Profile_T_Specification_v1-0.pdf),
    [Profile G v1.1, sections 7-9](https://www.onvif.org/wp-content/uploads/2025/11/ONVIF-Profile-G-Specification-v1-1.pdf),
    and [Profile M v1.1, sections 5, 7-8](https://www.onvif.org/wp-content/uploads/2024/04/onvif-profile-m-specification-v1-1.pdf).
    ONVIF release 26.06, commit `68ee1b540a40f848c9599eba2c55b87547c588d6`,
    [distributed analytics architecture, lines 552-587](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Analytics.xml#L552-L587).

[^td]: W3C, [WoT Thing Description 1.1, sections 5-6](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#sec-vocabulary-definition),
    Recommendation, 5 December 2023.

[^tm]: W3C TD 1.1, [Thing Models](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing-model)
    and [VersionInfo](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#versioninfo).

[^jsonld]: W3C, [JSON-LD 1.1: the context](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#the-context),
    Recommendation, 16 July 2020; TD 1.1 [validation](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#validation-serialization-json).

[^forms]: W3C TD 1.1 [Forms](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form)
    and native context at `87808f1644ba79eb0a58d238385a8bd4a2236853`,
    [Form mappings, lines 380-451](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L380-L451).

[^discovery]: W3C, [WoT Discovery: Directory API](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-api),
    Recommendation, 5 December 2023; public source pin
    `64c13d74466b5af68e7e56b2c9ce5ba35728bbdc`,
    [search provisions, lines 4895-5093](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4895-L5093).

[^discovery-watch]: W3C Discovery, [registration information](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-registration-info)
    and [notifications, lines 4593-4822](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4593-L4822).

[^xr-endpoint]: xRegistry at `16483bb564586423de9c128db89f3b61d360f4e3`,
    [optional envelope and messages, lines 102-130](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L102-L130),
    [serialization, lines 239-351](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L239-L351),
    and [additional protocols, lines 545-579](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L545-L579).

[^xr-usage]: xRegistry Endpoint [client usage roles, lines 366-450](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L366-L450).

[^xr-http]: xRegistry Endpoint [HTTP binding and scope, lines 867-914](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L867-L914)
    and [HTTP option model, lines 561-645](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L561-L645).

[^xr-ifvalues]: xRegistry core model, [`ifvalues`, lines 457-489](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L457-L489),
    and [customization constraints, lines 1209-1275](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1209-L1275).

[^xr-version]: xRegistry [Group/Resource distinction, lines 189-240](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L189-L240),
    [Version replacement, lines 2881-2905](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L2881-L2905),
    and [version retention, lines 754-778](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L754-L778).

[^genicam]: EMVA, [GenICam introduction and modules](https://www.emva.org/standards-technology/genicam/introduction-new/).

[^aravis]: Aravis 0.8.36 at `97ff5e330919d7a44b871df4eda669feeafdf342`,
    [GigE discovery, lines 170-203](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvinterface.c#L170-L203),
    [stream destination, lines 1652-1675](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvstream.c#L1652-L1675),
    and [USB device interface, lines 1062-1084](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvuvdevice.c#L1062-L1084).

[^uvc]: Microsoft, [USB Video Class driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/usb-video-class-driver-overview).

[^rtsp]: ONVIF streaming source at `bf3ea360e20247d68c2ae0e9c9a715a948f79d78`,
    [protocol separation, lines 575-577](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Streaming.xml#L575-L577)
    and [session description, lines 1029-1033](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Streaming.xml#L1029-L1033).

[^srt]: Sharabayko et al., [The SRT Protocol, section 1.2](https://datatracker.ietf.org/doc/html/draft-sharabayko-srt-01#section-1.2),
    Internet-Draft, 7 September 2021; expired 11 March 2022, work in progress,
    not an IETF standard.

[^hls]: Pantos and May, [RFC 8216, sections 1-2](https://www.rfc-editor.org/rfc/rfc8216.html#section-2),
    HTTP Live Streaming, Informational, August 2017.

[^mediamtx]: MediaMTX 1.21.0 at `2c6727904fbf233615de74a6c54a9b94dbf6025d`,
    [WebRTC track/codec selection, lines 732-778](https://github.com/bluenviron/mediamtx/blob/2c6727904fbf233615de74a6c54a9b94dbf6025d/internal/protocols/webrtc/from_stream.go#L732-L778).

[^opencv]: OpenCV 4.13.0 at `fe38fc608f6acb8b68953438a62305d8318f4fcd`,
    [property support and backend caveats, lines 996-1024](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L996-L1024).

[^opencv-device]: OpenCV 4.13.0, [MSMF enumeration, lines 722-744](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L722-L744).

[^buffer]: Aravis 0.8.36, [GStreamer native-buffer handling, lines 592-625](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/gst/gstaravis.c#L592-L625);
    pypylon 26.8 at `1159036904d6d83a53ffadf4594f709256deb370`,
    [array-copy behavior, lines 116-128](https://github.com/basler/pypylon/blob/1159036904d6d83a53ffadf4594f709256deb370/src/pylon/PylonImage.i#L116-L128).

[^opencv-audio]: OpenCV 4.13.0,
    [FFmpeg packet selection, lines 1671-1683](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L1671-L1683)
    and [MSMF A/V restriction, lines 1221-1231](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L1221-L1231).

[^rtp]: [RFC 3550, section 5.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1)
    and [section 6.4.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-6.4.1),
    RTP timestamps and RTCP sender reports.

[^opencv-pts]: OpenCV 4.13.0, [PTS time base, lines 214-215](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L214-L215).

[^queues]: GStreamer, [appsink queue controls](https://gstreamer.freedesktop.org/documentation/app/appsink.html)
    and [queue behavior](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html).

[^still]: Axis VAPIX, [HTTP video and JPEG snapshots](https://developer.axis.com/vapix/network-video/video-streaming/#video-streaming-over-http).
    The proposal's Still/Clip classification is an integration choice.

[^ffmpeg]: FFmpeg 7.1.1 at `db69d06eeeab4f46da15030a80d539efb4503ca8`,
    [duration options, lines 525-535](https://github.com/FFmpeg/FFmpeg/blob/db69d06eeeab4f46da15030a80d539efb4503ca8/doc/ffmpeg.texi#L525-L535).

[^onnx]: ONNX at `c9f169adac34bd690bf0d628e9aae7fde3d4be85`,
    [IR and model structure, lines 69-119](https://github.com/onnx/onnx/blob/c9f169adac34bd690bf0d628e9aae7fde3d4be85/docs/IR.md#L69-L119)
    and [external tensor data, lines 382-386](https://github.com/onnx/onnx/blob/c9f169adac34bd690bf0d628e9aae7fde3d4be85/docs/IR.md#L382-L386).

[^prov]: W3C, [PROV-O starting-point terms](https://www.w3.org/TR/2013/REC-prov-o-20130430/#description-starting-point-terms),
    Recommendation, 30 April 2013.

[^cloudevents]: CloudEvents 1.0.2 at `fc1f6f31f5f011a72183f1bcea20c987cb683ade`,
    [required context attributes, lines 248-313](https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L248-L313).

[^indexer]: Microsoft, [Upload Video API](https://api-portal.videoindexer.ai/mapi/apis/Operations/operations/Upload-Video?api-version=2023-03-01-preview);
    Azure samples at `a8a498b07126be895cae581a321431422156eaad`,
    [indexing-state handling, lines 64-69](https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Trial/sampleCode.cs#L64-L69).

[^indexer-time]: Microsoft, [transcription output example](https://learn.microsoft.com/en-us/azure/azure-video-indexer/transcription-translation-lid-insight#example-response).

[^xr-baseline]: xRegistry [artifact-status table, lines 34-51](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/README.md#L34-L51)
    and [published RC4 snapshot](https://github.com/xregistry/spec/commit/d2433a8c726ab096303bd943a4fc6691925f7910).
