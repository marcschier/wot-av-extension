# Proposed AV vocabulary: complete TD examples and transport contracts

**Original design/prototype, 2026-09-14.** The namespace remains the unregistered draft `https://example.org/wot/av#`. None of the `av:` vocabulary, profile identifiers, example endpoints, advertised media, or operational observations below is a deployed service or an upstream standard. No camera, media session, controller job, server, or repository change was made.

The two complete TDs are:

- `media-research\wot-vocab-td-examples.source.td.json`: one logical HTTPS source/connector, a latest JPEG still, and a finite audiovisual MP4 clip.
- `media-research\wot-vocab-td-examples.controller.td.json`: typed `submitNeed` and `releaseAssignment` actions, read-only AssignmentStatus and Result properties, and a fully specified original HTTP JSON-long-poll result event.

**Result:** HTTP JPEG is the portable media-access baseline. HTTP GET/POST and the TD affordance/schema mappings are established TD 1.1 mechanisms; AV admission/lifecycle semantics and the result-long-poll contract are explicitly original additions. Native streaming is not made interoperable by adding a URI, codec, direction, or profile label. The native template below defines the obligations that a concrete implementation profile still has to discharge. [T1, T2, T3, T4]

## 1. Evidence baseline and decisions inherited from the other work

Read as design inputs, not as independent standards: `media-research\wot-vocab-foundation.md:5-78,126-239`; `media-research\wot-vocab-offers-needs.md:3-128,241-323`; `media-research\wot-vocab-lifecycle.md:11-113,142-223`. Earlier unprefixed AV examples, AV `@vocab`, rational `n`/`d`, string-valued domain enums, and pointer-only FormRefs are not copied into these examples.

The normative baseline is the **TD 1.1 Recommendation, 5 December 2023**. WoT Profiles of **4 November 2025 is a Working Draft**, not a Recommendation; Binding Templates of the same date is a **retired Note**. The prototype claims neither a 2025 HTTP Basic/SSE profile nor TD 2.0 conformance. In particular, it does not adopt draft `ActionStatus` response envelopes while pretending they are TD 1.1 requirements. [T1, T5]

**Proposal choices used here:**

| Boundary | Decision |
|---|---|
| Core versus domain | Retain `https://www.w3.org/2022/wot/td/v1.1`; add only the simple inline `av` prefix. Every domain key is prefixed. Native TD/HTTP/JSON-LD/RFC 9457 keys retain their standard spelling. |
| Classes | Source and Connector are non-disjoint roles and are both explicitly present on the source Thing. Controller is a Thing; its actions are SubmitNeedAction/ReleaseAssignmentAction, never Assignment instances. Processor, Need, InferenceModel, ResultContract, MediaAsset, and ProcessingRun remain distinct domain entities. |
| Forms | Native Form `@id` is optional in TD core, but REQUIRED by this proposal whenever referenced. Every example Form is named. Mode references that Form through `av:form`; it never copies `href`, security, method, or native protocol options. |
| Direction | `av:FromThing` and `av:ToThing` describe audiovisual media relative to the addressed Thing, not HTTP request direction, caller/listener role, or feedback traffic. Controller result notifications are not annotated as audiovisual media. |
| Representations | JPEG is EncodedVideo for this draft's Still convention. The clip has an exact H264/AAC wire tuple. BGR/PCM delivery and model tensors are different boundaries. |
| Values | Controlled AV values are node objects such as `{"@id":"av:FromThing"}`. Rational members are `av:numerator` and `av:denominator`. TD `op`, HTTP method names, MIME strings, codec profile strings, names, and client keys keep their protocol/literal types. |
| References | Acceptance requires an authenticated, pinned dependency closure: parent TD/document, contexts, profiles, selected entities, model/artifacts, and result contract. A syntactically valid unhosted IRI or hash-shaped string is insufficient. |

TD permits semantic extensions and optional DataSchema `type`; it does not standardize this proposed vocabulary or named-Form resolver. The exact native Form and context rules are independently verified in the pinned official artifacts. [T2, T3, T6, T7]

## 2. Complete source/connector TD: the interoperable boundary

The source file is a complete TD, not a Thing Model or a fragment. Its HTTPS interface can be implemented over a UVC, USB3 Vision, GigE Vision, RTSP, file, or other backend, but it deliberately does not infer that backend from the HTTP interface. The combined Source/Connector typing describes the logical adapter Thing, not an assertion that a physical camera and its host are identical.

### 2.1 Original `urn:example:profile:av-http-jpeg:1`

**Normative for this proposed profile only:**

1. Resolve the pinned TD and named `urn:example:form:camera7-latest-jpeg`. Require native `op: readproperty`, HTTPS, `contentType: image/jpeg`, and `av:mediaDirection: av:FromThing`. Select only the complete Still Mode referring to that Form.
2. Use HTTP GET, as stated explicitly by `htv:methodName` and also specified by the TD 1.1 default. Send `Accept: image/jpeg`, valid out-of-band Authorization, and `Cache-Control: no-cache` for this latest-image profile. No JSON request body is defined. [T4]
3. A successful response is `200`, `Content-Type: image/jpeg`, with one complete JPEG representation. The profile requires `Cache-Control: no-store`; redirects are refused unless an authenticated deployment policy pins the new origin and its credential policy. Bound response size and time before reading.
4. Dispatch to a JPEG decoder, not a JSON parser. Validate the returned dimensions and actual codec against the selected Mode. Its 1280x720 dimensions are hypothetical advertised facts; no image was fetched to verify them here.
5. Reading observes the latest image from continuous acquisition. It does NOT trigger a new exposure, reserve the sensor, prove capture time/freshness, imply audio, or promise any frame rate. An explicit capture action with authority and uncertain-outcome semantics would be a different affordance.
6. Stop means finish or abort this HTTP request and release local buffers; it does not stop shared acquisition. Authentication, timeout, malformed/truncated JPEG, unavailable image, and dimension changes are explicit errors, never empty-success images.

The Property intentionally omits DataSchema `type`. There is no JSON `binary` type and no false `type: string`/base64 assertion for raw JPEG bytes. `contentMediaType` would describe an embedded string representation, not this response. This follows the TD's own non-JSON payload mechanism. [T2, T3]

### 2.2 Original `urn:example:profile:av-http-sealed-mp4:1`

The second source Property uses the same authenticated GET mechanism but `contentType: video/mp4`. It returns one immutable finite container with video H264 High/3.1, 1280x720, constant `30/1` presentation cadence, and AAC-LC mono 48 kHz. MP4's registered container media type is not the elementary codec name. [T4, M1]

**Additional proposal requirements:** verify container initialization, complete track enumeration, sample descriptions, dimensions, sample rate/layout, duration, and actual media timestamps; reject a representation that differs from the selected tuple. The published clip spans `[0,10)` on its identified presentation timeline, not on an inferred UTC capture clock. HTTP download speed is not its frame rate. This profile offers sequential retrieval only: no implied Range support, sample-accurate seeking, DVR window, or live playback. Authorized local decoding and preroll/sample selection need a separately qualified plan. A MediaAsset manifest would additionally pin the retained bytes, retention/completion state, and provenance; the TD and Mode do not replace that manifest.

These two complete source Modes cannot satisfy an InputContract whose `av:kind` is `av:Live`, even though one is continuously refreshed and the other contains 30-fps video.

## 3. Complete controller TD and original HTTP contract

### 3.1 Original `urn:example:profile:av-http-controller:1`

All Forms inherit the TD's bearer scheme over HTTPS. The example chooses ES256 JWTs, without embedding any token, issuer secret, password, signed URL, or acquisition credential. A deployment must configure issuer/audience/trust and principal-scoped authorization separately; describing a bearer scheme is not granting access. Controller responses MUST use `Cache-Control: no-store`; validate authorization at response/effect time as well as request admission. [T8]

| Native affordance | Standard TD operation | Exact proposed HTTP exchange |
|---|---|---|
| `submitNeed` Action | `invokeaction` | POST the input schema to `/av/submit-need`; `200 application/json` returns an OperationOutcome conforming to `output`. This action completes when the durable admission decision is recorded, not when processing becomes ready. |
| `status` Property | `readproperty` | GET `/av/status{?assignment}`, expanding the **full Assignment IRI** into the required query variable. `200 application/json` returns AssignmentStatus. It is `readOnly: true`, `observable: false`; no writable desired-state shortcut or undocumented observation transport exists. |
| `releaseAssignment` Action | `invokeaction` | POST its typed input to `/av/release-assignment`; `200 application/json` returns a durable withdrawal/drain receipt. It is not `cancelaction`, and accepted release is not completed cleanup. |
| `result` Property | `readproperty` | GET `/av/results{?result}` with the full Result IRI. `200 application/json` returns the immutable Result envelope plus contract-specific fields; a missing/expired retained result is an explicit error. |
| `resultAvailable` Event | `subscribeevent`, `unsubscribeevent` | The original JSON-long-poll profile in section 3.3 defines GET, iteration, cursor, timeout, and local cancellation. TD 1.1 does not give these event operations the GET/POST defaults used for Property reads and Action invocation. |

The operations, schema roles, URI variables, and HTTP GET/POST defaults are established mechanisms; the resource paths and admission/result semantics in this table are original. Neither action is annotated `av:Assignment`. Their `synchronous: true` refers to completion of the action's receipt-producing work. [T2, T3, T4]

**Admission and release requirements:**

1. Validate the typed JSON envelope, controlled values, UTC timestamps, safe integer limits, allowed domain keys, and the exact supplied context. Do not let a caller add a context that changes AV term meaning. Verify the Need pin and its entire dependency closure before considering acceptance.
2. `av:expectedGeneration` is a compare-current precondition, not the new desired generation. A submitted Need revision identifies its logical Need and new generation. A generation conflict is explicit; do not silently overwrite or weaken intent.
3. Key deduplication is scoped to authenticated principal + Controller identity + semantic action. Fingerprint the **complete input** with SHA-256 over RFC 8785 JCS; same key with different input is a conflict. Store the durable outcome before acknowledgment. Replay returns the original receipt without reactivating its Assignment. The receipt advertises `av:replayUntil`; beyond that horizon, reconcile rather than blind retry. The TD leaves `idempotent: false` because bounded replay is not an unconditional idempotence promise. [T9]
4. Accepted admission has exactly one Assignment reference and no hard-contract relaxation. Proposed alternatives are pins to alternative Need revisions; they are not accepted changes. Rejected/Uncertain receipts require issues. This minimal synchronous profile does not return Pending and advertises no `queryaction`/`cancelaction` lifecycle. Uncertain permits neither assuming an Assignment exists nor retrying a physical effect: after safe same-key replay, any unresolved outcome requires external enforcer/operator reconciliation. No automated reconciliation endpoint is claimed here.
5. AssignmentStatus must contain each condition exactly once: MediaObserved, ApplicationReady, ModelLoaded, ResultCommitted. True requires appropriate evidence. The property schema constrains the envelope; generation/lease/current-head/freshness/condition relationships are additional profile validation, not implied by `state: Ready`.
6. Release compares the target and current generation, records withdrawal, and drains only that Assignment's resources. `Released` requires cleanup evidence. It must not reset a replacement owner's configuration or stop shared capture. Retriggering or other uncertain physical effects are not part of this controller example.
7. Return non-2xx RFC 9457 Problem Details for malformed requests, unauthorized access, conflicts that prevent receipt creation, unavailable dependencies, or transport/service failure. A `200` receipt with explicit `av:Rejected` represents a successfully recorded **negative domain decision**, not success at obtaining media. Never hide rejection in an empty body. [T10]

**Envelope boundaries:** The Result Property and Event use the same common Result schema. They deliberately leave contract-specific detections/transcript fields open; the pinned ResultContract's pinned payload schema must validate the complete payload separately. Consumers accept unrelated additional returned members as TD 1.1 requires, but admission must not ignore an unknown hard requirement. A schema node's annotations never automatically type the runtime payload. [T2, T11]

### 3.2 Processor Need: hard WIRE 30 fps, BGR delivery, separate tensor preprocessing

This complete domain-document example is not a TD. The model, preprocessing, result-contract, and Processor references are placeholders requiring pinned authenticated resolution before acceptance. It requests live input, so neither complete source Mode in section 2 qualifies. The BGR request is not a sensor pixel-format setting, and the dropping queue does not redefine the source cadence.

<!-- example: hard30-need -->
```json
{
  "@context": {"av": "https://example.org/wot/av#"},
  "@id": "urn:example:need:inspection:3",
  "@type": "av:Need",
  "av:logicalNeed": {"@id": "urn:example:need:inspection"},
  "av:desiredGeneration": 3,
  "av:intentState": {"@id": "av:Active"},
  "av:processor": {"@id": "urn:example:thing:opencv-processor7"},
  "av:model": {"@id": "urn:example:model:detector:3"},
  "av:allowedPreprocessing": [
    {"@id": "urn:example:preprocessing:bgr-to-rgb640-pad114:1"}
  ],
  "av:resultContracts": [
    {"@id": "urn:example:result-contract:detections:1"}
  ],
  "av:inputs": [
    {
      "@id": "urn:example:need:inspection:3:picture",
      "@type": "av:InputRequirement",
      "av:name": "inspection",
      "av:presence": {"@id": "av:Required"},
      "av:alternatives": [
        {
          "@type": "av:InputContract",
          "av:kind": {"@id": "av:Live"},
          "av:captureIntent": {"@id": "av:Observe"},
          "av:transformPermissions": [
            {"@id": "av:Decode"},
            {"@id": "av:ColorConvert"}
          ],
          "av:wireTracks": [
            {
              "@type": "av:VideoRequirement",
              "av:name": "picture",
              "av:presence": {"@id": "av:Required"},
              "av:representationKind": {"@id": "av:EncodedVideo"},
              "av:codecs": [{"@id": "av:H264"}],
              "av:widthRange": {"av:min": 1280, "av:max": 1280},
              "av:heightRange": {"av:min": 720, "av:max": 720},
              "av:cadences": [{"@id": "av:Constant"}],
              "av:frameRateRange": {
                "av:min": {"av:numerator": 30, "av:denominator": 1},
                "av:max": {"av:numerator": 30, "av:denominator": 1}
              }
            }
          ],
          "av:deliveredTracks": [
            {
              "@type": "av:VideoRequirement",
              "av:name": "picture",
              "av:presence": {"@id": "av:Required"},
              "av:representationKind": {"@id": "av:RawVideo"},
              "av:pixelFormats": [{"@id": "av:BGR8"}],
              "av:bufferLayouts": [{"@id": "av:Contiguous"}],
              "av:widthRange": {"av:min": 1280, "av:max": 1280},
              "av:heightRange": {"av:min": 720, "av:max": 720}
            },
            {
              "@type": "av:AudioRequirement",
              "av:name": "sound",
              "av:presence": {"@id": "av:Optional"},
              "av:representationKind": {"@id": "av:PCM"},
              "av:sampleFormats": [{"@id": "av:S16LE"}],
              "av:bufferLayouts": [{"@id": "av:Interleaved"}],
              "av:sampleRateRangeHz": {"av:min": 48000, "av:max": 48000},
              "av:channelsRange": {"av:min": 1, "av:max": 1},
              "av:channelLayouts": [{"@id": "av:Mono"}]
            }
          ],
          "av:queuePolicies": [
            {
              "av:stage": {"@id": "av:DecodedDelivery"},
              "av:capacity": 1,
              "av:unit": {"@id": "av:Bundle"},
              "av:overflow": {"@id": "av:DropOldest"},
              "av:maxResidenceMs": 100,
              "av:coverage": {"@id": "av:BestEffort"}
            }
          ]
        }
      ]
    }
  ]
}
```

**Five distinct checks:** advertised Mode; negotiated/observed wire; decoded BGR HWC uint8 `[720,1280,3]`; model tensor preprocessing; ResultContract. The separately pinned example preprocessing would define BGR-to-RGB, resize/letterbox to 640x640 with pad value 114, float32 division by 255, and NCHW `[1,3,640,640]`, including interpolation and rounding. These are proposed choices, not ONNX or camera defaults. The two earlier mechanism notes disagree on padding 0 versus 114: an exact preprocessing pin, not either default, must decide.

`30/1` and `30000/1001` compare unequal. The hard filter applies to `av:wireTracks`, not to the consumer dequeue frequency. Dropping a decoded queue, replaying a frame, or temporally subsampling a faster source cannot discharge the hard source predicate. There is no constant delivered-fps condition here. Missing measurement/configuration evidence remains unknown; a nominal library FPS property alone does not prove continuing wire cadence. An eventual timing profile must distinguish nominal media cadence, clock quantization, measurement interval, and any explicitly authorized tolerance; this draft supplies no hidden tolerance. [M2, M3, M4]

**Typed submit envelope:** the digest below covers the exact UTF-8 JSON fence above, including one final LF, not this whole Markdown file. The document URL is an illustrative retrieval identity; the validation harness uses a local pinned cache and does not fetch it.

<!-- example: submit-request -->
```json
{
  "@context": {"av": "https://example.org/wot/av#"},
  "@type": "av:OperationRequest",
  "av:clientKey": "inspection-3-submit-01",
  "av:expectedGeneration": 2,
  "av:need": {
    "@type": "av:Pin",
    "av:document": {"@id": "https://example.org/needs/inspection/3.jsonld"},
    "av:digest": {
      "av:algorithm": {"@id": "av:Sha256"},
      "av:scope": {"@id": "av:RepresentationOctets"},
      "av:canonicalization": {"@id": "av:None"},
      "av:value": "bd22b5c6f76e825163c523c74b5a298e7322dff9c84c3e1e062c0a487b9ab9d9"
    }
  }
}
```

**Illustrative receipt, not an executed admission:** assuming the request's pinned dependencies were available, a search limited to the two source-file Modes rejects the Live requirement. Unavailable dependency pins would instead prevent admission before that search. No Accepted/Ready state is fabricated for these candidates.

<!-- example: submit-receipt -->
```json
{
  "@context": {"av": "https://example.org/wot/av#"},
  "@id": "urn:example:operation-receipt:inspection-3-submit-01",
  "@type": "av:OperationOutcome",
  "av:outcome": {"@id": "av:Rejected"},
  "av:requestDigest": {
    "av:algorithm": {"@id": "av:Sha256"},
    "av:scope": {"@id": "av:JsonDocument"},
    "av:canonicalization": {"@id": "https://www.rfc-editor.org/rfc/rfc8785"},
    "av:value": "90383f0bf291f28b7e346c201aa77f9b4498b96ce4f0b099a0218babc8de343e"
  },
  "av:replayUntil": {
    "@value": "2026-09-14T13:30:00Z",
    "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
  },
  "av:issues": [
    {
      "av:code": {"@id": "av:NoJointMode"},
      "av:message": "The candidate Modes provide Still and Clip, not the required Live input.",
      "av:retryability": {"@id": "av:AfterChange"}
    }
  ]
}
```

The provisional enum spellings Sha256, RepresentationOctets, None, JsonDocument, Active, and the capitalized lifecycle states/conditions are defined here solely to make the examples explicit JSON-LD. RepresentationOctets means whole representation bytes after HTTP content decoding, with no JSON reserialization. JsonDocument + the RFC 8785 IRI means whole-document JCS bytes. These are distinct digest domains, never interchangeable; ontology/context work must ratify their names. [T9]

### 3.3 Original `urn:example:profile:av-http-result-longpoll:1`

**Maturity:** this is a complete minimal **proposed application/protocol mapping**, not an existing W3C HTTP Profile. TD 1.1 includes `longpoll` as a subprotocol example; RFC 6202 describes the held-request mechanism and operational issues but is **Informational**, not an Internet Standards Track specification. Neither source defines this cursor/header/retention contract. [T3, T12]

**Normative algorithm for this proposal:**

1. Resolve the pinned Event Form and inherited authorization. `assignment` is REQUIRED and contains the full Assignment IRI. `cursor` is REQUIRED; initial literal `0` means before the first result in that Assignment's log. If any of that prefix has been discarded, the server MUST return 410 rather than start at the earliest remaining entry. Noninitial cursors are opaque, principal/assignment-scoped, 1-256 ASCII unreserved characters, and are never compared numerically or equated with AssignmentStatus.sequence.
2. `subscribeevent` starts a local subscription handle. Send one authenticated HTTP GET to the expanded Form target with `Accept: application/json` and `Cache-Control: no-store`. There is no JSON subscription body and no server subscription resource created. At most one request per local handle is outstanding.
3. A queued result yields `200 application/json`, exactly one complete immutable Result body conforming to the Event `data` schema and the pinned ResultContract, plus `AV-Result-Cursor: <opaque-token>`. Every successful result response also states `AV-Retention-Start: <opaque-token>` identifying its current retained lower bound. Server responses use `Cache-Control: no-store`. Cursor order is defined by the server log, not by lexical order or result timestamps.
4. The server maintains a per-Assignment ordered result log. A resume cursor requests the next entry after that cursor; duplicate retries of the same cursor return the same next retained entry. Arrival of newer results must not skip older eligible entries. The Consumer verifies the contract, committed Result/CommitReceipt relationship, and applicable integrity/provenance before effects; it advances its durable cursor only atomically with its own deduplicated effect or durable acceptance.
5. No result within **25 seconds** yields `204` with no body. Wait at least **1 second**, then resubmit with the same cursor unless cancelled. These are profile choices, not TD defaults. The Consumer's network timeout must exceed the server hold time with a declared margin. An HTTP 204 is not an empty Result and is not delivered to the Event callback.
6. A `410 application/problem+json` for an expired/unknown cursor is a replay gap: surface it and stop automatic resumption. Do not silently jump to cursor `0` or claim complete coverage. A separately authorized recovery may fetch known immutable results via the Result Property; broader catalog/backfill is outside this minimal profile.
7. `401`/`403` require authorization handling, not a tight retry loop. `429`/`503` require bounded backoff honoring valid Retry-After; temporary transport failure retries the same cursor only within a configured deadline. Other malformed responses, missing cursor, wrong media type, invalid contract, or contradictory result identity are explicit failures. A successful delivery is not exactly-once effects at another sink.
8. `unsubscribeevent` aborts only that handle's pending HTTP request, cancels timers, and prevents resubmission/callback delivery after completion of local cancellation. It sends no DELETE and does not release the Assignment or stop processing. An already committed remote result is unaffected. For multiplexed HTTP, abort the stream, not unrelated requests.
9. Bound payload size, concurrent subscriptions, retained history, and processing queues; expose configured retention out of band in the pinned deployment profile. A contract requiring coverage beyond available retention is unsupported. Cross-origin browser access requires explicit CORS authorization and exposure of the two custom response headers, never query-string bearer tokens.

The one Form carries both standard event operations but intentionally no single `htv:methodName`: their per-operation mapping is GET versus local cancellation, specified above. An `av:accessProfile` identifier is an implementation requirement, not a new TD `op`.

**If SSE is chosen instead:** the 2025 Profiles Working Draft section 7.2.2 explicitly makes `Form.contentType: application/json` the embedded data encoding and `subprotocol: sse` imply an HTTP `text/event-stream` envelope. One must implement that exact layered mapping, event names, reconnection/Last-Event-ID, and close behavior, and label the dependency a draft. Do not silently swap between this convention and a Form describing raw HTTP bytes. The browser EventSource constructor exposes URL and `withCredentials`, not an arbitrary Authorization-header option; bearer-header use needs a capable HTTP/SSE client or an explicitly designed authentication alternative. No SSE profile is claimed by the saved TD. [T5, T13]

## 4. Named-Form and dependency integrity contract

**Normative for all proposed profiles in this note:**

1. A resolver starts with an authenticated pin bundle containing the actual TD retrieval/document identity, expected Thing `id`, TD `version.instance`, exact-byte SHA-256 pin, context pins, and application/binding-profile pins. Form identity, Thing identity, TD retrieval URL, and native `href` are different values.
2. Verify the full retrieved representation after HTTP content decoding. For these examples, byte hashing is chosen over JSON/RDF canonicalization for TDs, profiles, contexts, and Need references. Preserve those bytes. Do not hash an enriched/normalized/compacted document and call it the publisher's original snapshot.
3. Expand JSON-LD only with a controlled loader bound to the pinned contexts; reject unknown context loads and conflicting redefinitions. A byte-pinned TD with mutable unpinned context is not a semantically pinned document. Record inline context content as part of its parent document.
4. Resolve `av:form` by exact absolute `@id` within native TD root/Property/Action/Event **forms arrays only**. Require one defining occurrence. An identically named node under an AV graph is not a native Form definition. Duplicate/missing IDs, mismatched parents, unavailable profiles, or wrong operations fail closed. Do not substitute the first Form or match by `href`.
5. Preserve original TD `base`, URI-variable definitions, security inheritance, content type, operations, and binding metadata while executing. The examples use absolute targets; their query variables use complete entity IRIs, not undocumented extraction of path components from identifiers.
6. Persist selected Offer/Mode/Track IDs and the same pinned parent TD in the Assignment. If a reference also contains a JSON Pointer, it must agree with the named Form in the exact original serialization. This profile does not accept a pointer-only reference as a substitute for a required Form ID.
7. Whole-document self-hashes live in an external manifest, not in the document being hashed. A digest establishes integrity, not publisher authenticity, current lease authority, or continued endpoint availability. Profile URNs in the TD resolve through that manifest; they are not implicitly downloadable URLs.

These are additional profile guarantees. TD 1.1 does not require a generic Consumer to preserve/resolve Form `@id`, and JSON-LD set semantics make array-position references fragile after transformation. The core schema's acceptance of extension members is not a reference-integrity proof. [T3, T6, T7]

**Candidate FormRef consolidation:** keep the lifecycle Pin/Digest structure but use `av:form` plus a pinned parent TD, `av:expectedThing`, and `av:tdInstanceVersion` as the primary selector. If `av:operationType` is exposed semantically, use the existing operation IRI such as `https://www.w3.org/2019/wot/td#readProperty`; the actual native Form still serializes standard `op: "readproperty"`. This reconciles the foundation's stable IDs with the lifecycle note's pointer machinery without inventing a second endpoint model. Final range/cardinality naming is an ontology integration decision.

## 5. Minimal normative native-media binding profile TEMPLATE

This is an **original template**, not a filled universal binding. Uppercase MUST/SHOULD below apply to any new concrete profile claiming this design, not retroactively to the cited protocols. Unfilled REQUIRED cells mean **not implementable/interoperable under this proposal**.

| REQUIRED profile field | What a concrete profile MUST specify |
|---|---|
| Identity and scope | Immutable profile ID/version/document pin; exact protocol/specification revisions and supported implementations; source/sink directions; supported media kinds, transports, containers, codecs, and excluded features. |
| Native Form surface | Valid URI/selector convention and every binding-vocabulary field; exact permitted standard TD operation(s), containing affordance, input/output/event schemas, and per-operation protocol/API mapping. If no defensible standard operation mapping is supplied, do not publish an executable Form or conformance claim. |
| Security and locality | Effective TD schemes plus native authentication/authorization/confidentiality; host placement and driver/SDK permissions; trust/credential provisioning; all derived destinations/redirects, including media servers, TURN servers, HLS keys, segments, and session resources. |
| Named-Form integrity | Parent TD/document/Thing/version pins, context and profile closure, unique Form `@id`, Mode reference, and effective inherited security/URI-variable resolution. |
| Direction and roles | Thing-relative media direction for each media leg; control/feedback direction; connection roles and which peer instantiates the session. Do not derive media direction from caller/listener or HTTP verbs. |
| Wire tuple and selection | One jointly realizable Mode and complete simultaneous track set; stable logical track identity plus session-scoped mapping; codec/profile/level/packetization or raw packing/layout, dimensions, cadence, audio sample/channel facts, container and timing. |
| Setup and negotiation | Ordered selection/configuration/invocation steps, capabilities and authority checks, timeout/cancellation points, input serialization, expected response/media types, session handle lifecycle, and required negotiation/readback checks. |
| Data plane | Exact framing/demux/depacketization and media-unit reconstruction; initialization/keyframes/parameter sets; buffer ownership/alignment/bounds; loss/reorder/partial-frame rules; codec and timestamp interpretation. Signaling payloads MUST NOT be mislabeled as later media. |
| Time and hard predicates | Source versus presentation/receipt clocks, stream incarnation, wrap/reset rules, wire cadence interpretation and actual validation boundary; clock-mapping uncertainty where age/skew matters. No timestamp clock rate or average callback frequency substitutes for source fps. |
| Lifetime and change | Start-ready criteria, liveness/keepalive, changes allowed within the selected Mode, downgrade/renegotiation behavior, reconnect/incarnation policy, finite/end-of-stream semantics, and resource-specific normal/abnormal cleanup. |
| Observation and errors | Requested, negotiated, and observed records; failure codes with candidate/path/evidence; condition transitions and revocation propagation. Unknown facts cannot prove hard compliance. |
| Conformance vectors | Positive complete media traces plus wrong codec/layout/cadence, missing required audio, negotiation downgrade, selector ambiguity, context/hash/Form mismatch, resource conflict, lost control, disconnect, stop-during-start, incomplete frames, and reconnect/identity-change tests. |

**Normative profile algorithm:**

1. Validate and authenticate the entire pinned dependency closure. Select a Form by identity, operation, binding profile, reachability, and direction; no protocol-name heuristic may bypass this.
2. Match one complete advertised Mode against hard wire constraints. Solve every input/track and shared resource jointly using a finite catalog of qualified adapter plans. BGR application delivery and model preprocessing remain separate constraints/permissions.
3. Obtain external authority/reservations for any configuration, trigger, access, or result-commit effects. Metadata is not a lease or fencing enforcement mechanism. Observation-only use MUST NOT change acquisition settings.
4. Execute the profile's setup algorithm. Distinguish HTTP/SDP/control responses from session handles and media legs. If one signaling exchange negotiates several legs, identify and validate each leg before declaring a match; do not invent a bidirectional media enum.
5. Inspect the effective negotiated configuration/track set against the exact Mode and Need. Reject silent fallback, unsupported mandatory profile features, missing audio, or changed pixel layout. Negotiation success alone is not MediaObserved or ApplicationReady.
6. Run the bounded media loop, reconstructing complete units and preserving timing/incarnation evidence. Validate required effective wire facts before application admission; qualify decoding/conversion/audio delivery and all queues independently. Do not set ModelLoaded or ResultCommitted from media startup.
7. Continuously enforce obligations. A material mode/source/configuration/incarnation change requires revalidation, degraded/failed state as appropriate, and possibly a new Assignment. Never relabel new media as the old pinned contract merely because the socket survived.
8. Stop only the owned session/branches and release the correct authority scopes. Complete finite clips according to coverage rules; expose partial coverage and uncertain effects. Cleanup failure remains a failure/draining observation, not fabricated Released success.

**Safe directional annotation fragment, NOT a complete/native-interoperable Form:**

<!-- example: native-direction-fragment -->
```json
{
  "@context": {"av": "https://example.org/wot/av#"},
  "@id": "urn:example:form:edge1-native-camera7-media",
  "av:mediaDirection": {"@id": "av:FromThing"},
  "av:locality": {"@id": "av:HostLocal"},
  "av:host": {"@id": "urn:example:host:edge1"},
  "av:accessProfile": {"@id": "urn:example:profile:native-camera-unfilled:1"}
}
```

This deliberately omits `href`, `op`, `contentType`, and security: it shows only annotations that would be merged into a real named native Form after a concrete profile fills those requirements. It MUST NOT be submitted as a TD, treated as an endpoint, or accepted into an Assignment. Inventing `gige://`, `usb://`, a generic native `video/raw` body, or `op: "stream"` would conceal rather than solve the gap. IANA's `video/raw` registration is for an RTP payload format with required parameters, not arbitrary host image buffers. [M5]

## 6. Transport mapping and concrete implementation gaps

**S** = published protocol/specification behavior; **I** = verified implementation evidence; **P** = an original profile obligation here. A protocol standard is not automatically a WoT binding standard.

| Transport/use | Signaling or selection versus actual media | Defensible MIME / TD mapping boundary | Remaining concrete profile contract |
|---|---|---|---|
| HTTPS JPEG Still | GET returns one JPEG; no implied fresh exposure. | **S:** TD `readproperty` -> HTTP GET, `image/jpeg`, no JSON `type`. **P:** section 2.1 supplies error/lifetime/exact-mode rules. [T2-T4] | JPEG mode/readback, authorized latest-image policy, bounds and lifecycle. This is the portable complete baseline, not a native-camera claim. |
| HTTPS sealed Clip | GET returns an immutable finite container, later demuxed locally. | `video/mp4` is container media type, not H264. **P:** section 2.2 supplies exact clip/track validation. [M1] | Artifact pin/retention, timeline, decoder and sample selector qualification; no implicit Range/DVR/live semantics. |
| SRT Live A/V | SRT connection and socket setup are distinct from application byte/message transfer. Caller/listener/rendezvous do not determine media direction. **I** [N1] | No intrinsic SRT codec/container MIME type or standardized WoT operation follows from an SRT URL. MPEG-TS is common, not mandatory; 1316 bytes is not a video-frame identity. **I** [N1] | **P:** exact SRT version/mode, peer roles, stream-ID convention, container/program/track selector, socket/latency/loss policy, encryption, media-unit reconstruction, close/reconnect, and standard-op/affordance mapping. |
| HLS Live / VOD Clip | HTTP master/multivariant and media playlists select variant/rendition resources, initialization data, keys, and media segments. **S** [N2] | A playlist read can honestly be `readproperty` with `application/vnd.apple.mpegurl`; that body is a playlist, NOT the selected media. Segment HTTP bodies have their own container types. Treating a playlist Form as a complete AV media-access recipe requires an additional profile. | **P:** pin the HLS edition, variant/rendition selection and adaptive-switch restrictions, reload/live edge/discontinuity/key/segment logic, demux, credential boundaries, and exact effective Mode checks. VOD/end-list and finite retention must qualify Clip; a live playlist is not a sealed MediaAsset. |
| WebRTC / WHIP ingest | HTTP SDP offer/answer plus ICE/DTLS setup; subsequent SRTP/SRTCP media/feedback. WHIP media enters the ingest-server Thing: ToThing. **S** [N3] | `application/sdp` and `application/trickle-ice-sdpfrag` are signaling, not H264 bytes. **WHIP is RFC 9725, Proposed Standard.** A proposed WoT setup Action could map `invokeaction` to SDP POST, but that alone omits session Location, PATCH, DELETE, data-plane ownership and media-leg binding. | **P:** define that complete native binding, accepted direction/track constraints, session resource and error mapping, authenticated ICE/TURN/DTLS setup, renegotiation limits, media validation, and stop. Do not pretend a single POST Form fully specifies the stream. |
| WebRTC / WHEP egress | Player and egress server negotiate; media leaves the server Thing: FromThing. **Draft** [N4] | Versioned **draft-ietf-wish-whep-04, 22 June 2026**, not an RFC/Recommendation. It includes 201-answer and 406-SDP-counter-offer paths; a generic 406 is not necessarily a counter-offer. | **P:** pin the draft, fully implement its signaling paths, track/direction validation, ICE updates/restarts, session DELETE, authorization, and accepted partial-media policy. A generic "WebRTC"/"WHEP" tag is insufficient. |
| RTSP playback / RTP A/V | DESCRIBE commonly obtains SDP; SETUP negotiates session/transport; PLAY starts delivery; RTP/RTCP carry media and control. TCP interleaving does not make RTP an RTSP entity body. **S** [N5] | `application/sdp` can describe the DESCRIBE response. Codec payload types, clock rates and `fmtp` come from RTP/SDP mapping, not that content type. No generic native WoT playback operation mapping is supplied here. | **P:** RTSP version/method capability, aggregate/per-track URI resolution, transport/channel selection, PT/fmtp/depacketization, clocks, keepalive/TEARDOWN, credentials and media protection. |
| RTSP ingest/recording | RTSP 1.0 ANNOUNCE/RECORD are optional; RTSP 2.0 removed them. Playback support does not prove a ToThing ingest path. **S** [N5] | Neither a PLAY Form nor a declared "RTSP" capability authorizes inventing `op: record`. | **P:** a separate explicit version/extension/server-capability and publish-session profile; otherwise unsupported. |
| Native GigE Vision | Device discovery/control/GVCP, GenICam feature model/configuration, and GVSP packet streams are distinct. **S/I** [N6] | PFNC format identifiers and GVSP leader/payload/trailer framing are not a generic URL/HTTP MIME contract. No native Form mapping is claimed. | **P:** host NIC and stable device identity, control privilege/heartbeat, feature recipe and readback, stream destination/channel, packet size/resend/reassembly, timestamps, bandwidth, stop/release. Full normative specification access remains a gap. |
| Native USB3 Vision | USB discovery and distinct control/event/data interfaces; stream-register setup and bulk-transfer assembly. **I** [N7] | USB3 Vision is not UVC. GenICam/PFNC plus USB3 Vision framing cannot be replaced with a naked pixel-format name or device index. | **P:** pinned host adapter/SDK/driver, device collision policy, interface claim/permissions, endpoint selection, transfer sizing/alignment, buffers, acquisition order, disconnect/cancel/release. Full normative specification access remains a gap. |
| Native USB UVC | VideoControl/VideoStreaming descriptors, PROBE/COMMIT, then isochronous or bulk payloads. **S** [N8] | Format GUID/index, frame index, interval, bandwidth and payload headers are part of the negotiated wire contract; they are not ordinary JSON data or universal PFNC mappings. | **P:** UVC version/driver, identity/interface selection, full negotiated readback, interval precision, bandwidth/alternate setting, FID/EOF/PTS assembly, format changes, stop and disconnect recovery. |

### 6.1 Protocol-specific traps that change admission

**SRT:** `SRTO_STREAMID` is an application-convention string, not codec negotiation. `SRTO_ENFORCEDENCRYPTION=true` by itself can permit both peers to have no passphrase; a profile must explicitly require encryption and provision secrets out of band. Native SRT authentication/encryption is not automatically satisfied by the HTTPS bearer definition of an unrelated controller. [N1]

**HLS:** RFC 8216 is **Informational**, covering protocol version 7, not every later low-latency extension. `FRAME-RATE` is the variant's maximum, rounded to three decimals; it is not proof of constant 30/1 source cadence. Do not synchronize alternative renditions using equal media-sequence numbers alone. A profile must constrain switching and observe effective media. Apple documents `video/MP2T` for HTTP TS segments, while that IANA registration's own scope is RTP; cite it as an HLS deployment convention, not proof that a generic MIME declaration completes SRT/HLS binding. [N2]

**WebRTC:** logical AV track identity is not RTP SSRC. Map the selected track to negotiated transceiver/MID **within a session incarnation**, and separately define source replacement. Local and remote track IDs need not correspond one-to-one; SSRC can change or multiply, and dimensions/source may change without full renegotiation. SDP success proves neither stable wire tuple nor application-ready BGR. [N3, M3]

**RTSP/RTP:** resolve `a=control` track URIs using the protocol's Content-Base/Content-Location/request-URI rules, not a guessed `trackID=1` convention. `H264/90000` describes an RTP timestamp clock, not 90,000 or 30 frames per second. RTCP timestamp mapping is not by itself bounded exposure-to-UTC evidence. Secure RTSP control does not automatically encrypt an independently negotiated RTP media path. [N5, M3]

**Industrial/native acquisition:** PFNC naming does not completely determine packing, numeric properties, endianness, or all transport arrangements. Read effective PixelFormat/PayloadSize/feature state and actual stream headers. SFNC AcquisitionFrameRate depends on trigger/exposure configuration; API setter success is not frame observation. UVC's frame interval is expressed in 100 ns units: `10,000,000/333333` is not exactly `30/1`. A library's integer-FPS helper must not round that into an exact hard-rate promise. Required controls can be unavailable or their effective values can change. [N6-N8, M4]

## 7. Validation evidence and limits

The saved complete TDs are checked with installed **jsonschema 4.26.0** and **PyLD 3.1.0**, without installing packages. Validation uses the official publication-time Draft-07 schema from commit `87808f1644ba79eb0a58d238385a8bd4a2236853` and the separately fetched maintained TD 1.1 schema. JSON-LD expansion maps the canonical TD 1.1 context URL to the pinned official context bytes through an allow-list-only loader. [T6, T7]

**Executed result:** both complete TDs pass both official schemas and JSON-LD expansion. All **7 native Form IDs** are unique and preserved in expansion; both **Mode-to-Form references** resolve inside their digest-pinned parent TD. The harness also rejects duplicate/missing/dangling Form identities, wrong parent identity/version, unpinned contexts/profiles, copied transport metadata, fake operations/types, digest-domain mismatches, and weakened rate/result/status invariants. Its fixed hashes additionally protect the cached official schemas/context from silent replacement.

The historical local validation harness and evidence manifest are outside this publication inventory and are not supplied for replay. The recorded result above describes the original local run only; it was not rerun as part of archival publication.

**Scope of proof:** official TD structural validation; expansion with pinned context; unique native-Form identity/reference resolution; JSON payload envelope checks and selected profile invariants. Not full WoT certification, complete AV ontology/SHACL validation, authenticated deployment, physical wire-cadence proof, protocol implementation tests, camera configuration, tensor execution, lease enforcement, or result commitment. No remote example endpoint/model/profile was resolved as if deployed. The native fragment is intentionally not validated as a complete TD.

## 8. Cross-topic decisions still requiring consolidation

| Decision | Why it matters / proposal here |
|---|---|
| FormRef and pin spelling | Foundation uses named IDs and flat TD pin fields; lifecycle uses Pin/Digest plus pointers. Prefer named `av:form` + parent Pin + expected Thing/version; pointer only as a checked secondary selector. Decide normative property ranges and profile document lookup packaging. |
| Digest domain and contexts | These TD/Need pins hash exact decoded representation bytes; request replay hashes whole JCS input. Ratify enum names and digest domains, and include external context/profile closure without self-hashes or unpinned "latest". |
| `av:accessProfile` versus `av:binding` | Existing notes name both. These examples consistently use `av:accessProfile`; decide whether one term is sufficient or whether separate layers have explicitly different meanings. Native `profile` remains a genuine conformance claim, not a list of transport names. |
| Event interoperability | The complete original JSON-long-poll contract avoids ambiguous MIME layering and EventSource bearer-header limits. Decide whether to standardize it, implement a pinned 2025 SSE draft profile, or choose another fully specified delivery profile; preserve explicit maturity and failure/retention semantics. |
| Lifecycle/result types and faults | Ratify capitalized state/condition IRIs and whether matching failures such as NoJointMode are direct Fault codes or nested under NoFeasibleAssignment. Result Event data here is the same immutable Result envelope as the Property, not an Assignment or arbitrary notification bag. Automated reconciliation beyond same-key replay is not exposed; decide whether a later profile needs an operation/head observation affordance. |
| Model preprocessing | Earlier examples differ on padding 0 versus 114. Pin exact preprocessing/postprocessing and model manifests; BGR delivery alone must not choose tensor layout, normalization, padding, or detection/indexing schema. |
| Hard30fps evidence | Decide clock quantization, observation window and permissible uncertainty independently of exact rational negotiation. No tolerance or delivered-fps relaxation is silently introduced. Separate mandatory audio support and timestamp-qualified synchronization. |
| Native interoperability | Standard-op mapping, payload/session recipes, native selectors/security, qualified adapters, and conformance traces remain required. GigE Vision/USB3 Vision full-spec access and edition coverage are explicit gaps; Aravis examples are implementation evidence, not certification. |
| Discovery/projection integration | Preserve native Form identity and pins through directory enrichment/projection; do not reintroduce endpoints inside Offer/Mode/Need. FromThing/ToThing describe media even where control/signaling travels oppositely. Result publication is a separate contract surface. |

## 9. Primary sources, pinned paths, and stable sections

All standards/implementation claims above point to primary sources. Protocol evidence was researched independently from the HTTP TD authoring; no secondary blog is used as the authority. Public documentation/specification excerpts were read, not camera or server endpoints.

**T1. Baseline and status.** [TD 1.1 REC 2023-12-05, Conformance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#conformance); [WoT Profiles WD 2025-11-04, Status](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#sotd); [Binding Templates retired Note 2025-11-04, Status](https://www.w3.org/TR/2025/NOTE-wot-binding-templates-20251104/#sotd).

**T2. Affordances and schemas.** TD REC [5.3.1.3 PropertyAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#propertyaffordance), [5.3.1.4 ActionAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#actionaffordance), [5.3.1.5 EventAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#eventaffordance), [5.3.2.1 DataSchema](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#dataschema), [7.1 semantic annotations](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#semantic-annotations); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:3757-4098,4306-4593,10948-11002` at commit `87808f1644ba79eb0a58d238385a8bd4a2236853`.

**T3. Forms and payload roles.** TD REC [5.3.4.2 Form, operation/data-schema mapping](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form), [6.3.9.1 URI variables](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-uriVariables), [6.3.9.2 contentType](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-contentType), [6.3.9.3 response](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-response), [6.3.9.5 embedded media strings](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-contentMediaType-contentEncoding); pinned `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:6569-6857,10133-10227,10331-10383`.

**T4. HTTP method mapping.** TD REC [8.3.1 Protocol Binding based on HTTP, Table 32](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#http-binding-assertions); [pinned source](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/publication/ver11/7-rec/Overview.html#L11790-L11904), `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:11790-11904`.

**T5. Draft HTTP/SSE profiles.** Profiles WD 2025-11-04 [6.2.2.1 invokeaction/ActionStatus](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#http-basic-profile-protocol-binding-invokeaction), [7.2.2 events and embedded JSON/text-event-stream distinction](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#http-sse-profile-protocol-binding-events), [7.2.2.2 unsubscribe](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#http-sse-profile-protocol-binding-events-unsubscribeevent). Work in progress, not adopted wholesale here.

**T6. Pinned official TD schema.** [Publication-time schema](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json#L315-L493), `w3c/wot-thing-description:validation/td-json-schema-validation.json:315-493`; [raw immutable source](https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json). Publication schema version `1.1-09-November-2023`; separately maintained artifact [https://www.w3.org/2022/wot/td-schema/v1.1](https://www.w3.org/2022/wot/td-schema/v1.1), fetched version `1.1-12-March-2025`. Artifact hashes are in the external validation manifest.

**T7. Pinned native JSON-LD context.** [Form scoping and set semantics](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L380-L451), `w3c/wot-thing-description:context/td-context-1.1.jsonld:1-30,380-451`; [raw immutable context](https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld). JSON-LD REC [compact IRIs](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#compact-iris), [node identifiers](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#node-identifiers), [base IRI](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#base-iri).

**T8. Security.** TD REC [5.3.3.1 SecurityScheme, out-of-band secrets](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#securityscheme), [5.3.3.8 BearerSecurityScheme](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#bearersecurityscheme), [6.3.4.2 Form security inheritance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#security-security-forms).

**T9. JCS.** [RFC 8785 sections 3.1-3.2](https://www.rfc-editor.org/rfc/rfc8785.html#section-3): input restrictions and canonical serialization. It does not canonicalize RDF or verify publisher authenticity.

**T10. HTTP errors.** [RFC 9457 section 3](https://www.rfc-editor.org/rfc/rfc9457.html#section-3): Problem Details JSON object and `application/problem+json`; [RFC 9110 section 15.3.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5): 204 response without content.

**T11. Validation limits.** TD REC [6.5 validation](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#validation-serialization-json), [8.2 Data Schemas](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#behavior-data).

**T12. Long polling.** [RFC 6202 section 2.1](https://www.rfc-editor.org/rfc/rfc6202.html#section-2.1), [5.3-5.6 operational issues](https://www.rfc-editor.org/rfc/rfc6202.html#section-5.3). Informational; its mechanism is not this original AV cursor protocol.

**T13. SSE API.** WHATWG HTML Living Standard [9.2.2 EventSource interface](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface), [9.2.3 processing model](https://html.spec.whatwg.org/multipage/server-sent-events.html#sse-processing-model), [9.2.4 Last-Event-ID](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header).

**M1. MP4 media type.** [IANA `video/mp4` registration](https://www.iana.org/assignments/media-types/video/mp4); the registered container type is distinct from individual encoded track formats.

**M2. HLS advertised frame rate.** [RFC 8216 section 4.3.4.2](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.4.2): FRAME-RATE, RESOLUTION, CODECS and variants.

**M3. RTP/track identity and timestamps.** [RFC 3550 sections 5.1, 6.4.1, 8.2](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1); [WebRTC REC 2025-03-13, 5.4 transceiver](https://www.w3.org/TR/2025/REC-webrtc-20250313/#rtcrtptransceiver-interface), [replaceTrack](https://www.w3.org/TR/2025/REC-webrtc-20250313/#dom-rtcrtpsender-replacetrack).

**M4. Native effective-rate/readback mechanisms.** [GenICam SFNC 2.8](https://www.emva.org/wp-content/uploads/GenICam_SFNC_v2_8.pdf), section 4.42 p.151, sections 5.5.10-5.5.11 p.189, section 27.2.5 p.523; [UVC 1.5 public archive](https://www.usb.org/sites/default/files/USB_Video_Class_1_5.zip), `UVC 1.5 Class specification.pdf`, section 4.3.1.1 and Tables 4-75-4-77 pp.133-146, sections 2.4.3.5-2.4.3.6 p.34.

**M5. Not generic native buffers.** [IANA `video/raw`](https://www.iana.org/assignments/media-types/video/raw): RTP payload-format registration and required parameters.

**N1. SRT implementation contract.** Commit `cae8f624a5a777066d12512f7b60debc260bdfa5`: [Haivision/srt:docs/apps/srt-live-transmit.md:207-242](https://github.com/Haivision/srt/blob/cae8f624a5a777066d12512f7b60debc260bdfa5/docs/apps/srt-live-transmit.md#L207-L242) (roles versus input/output); [docs/features/live-streaming.md:6-28](https://github.com/Haivision/srt/blob/cae8f624a5a777066d12512f7b60debc260bdfa5/docs/features/live-streaming.md#L6-L28) (TS convention/other formats); [docs/API/API-socket-options.md:1643-1666](https://github.com/Haivision/srt/blob/cae8f624a5a777066d12512f7b60debc260bdfa5/docs/API/API-socket-options.md#L1643-L1666) (stream ID), [438-453](https://github.com/Haivision/srt/blob/cae8f624a5a777066d12512f7b60debc260bdfa5/docs/API/API-socket-options.md#L438-L453) and [1107-1130](https://github.com/Haivision/srt/blob/cae8f624a5a777066d12512f7b60debc260bdfa5/docs/API/API-socket-options.md#L1107-L1130) (encryption/passphrase).

**N2. HLS.** [RFC 8216 sections 3.2-3.3](https://www.rfc-editor.org/rfc/rfc8216.html#section-3.2) (TS/fMP4); [4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4) (playlists/MIME); [4.3.3.5](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.3.5) (VOD/EVENT), [4.3.4.1-4.3.4.2](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.4.1) (renditions/variants), [6.3.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-6.3.4) (reload/synchronization); [Apple Streaming Media Guide, Configuring a Web Server](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/StreamingMediaGuide/DeployingHTTPLiveStreaming/DeployingHTTPLiveStreaming.html); [IANA MP2T](https://www.iana.org/assignments/media-types/video/MP2T).

**N3. WebRTC / WHIP.** [RFC 9725 sections 3-4.4](https://www.rfc-editor.org/rfc/rfc9725.html#section-3) (SDP POST/201/session Location, ICE PATCH, DELETE, directions and media constraints), [4.7 and 5](https://www.rfc-editor.org/rfc/rfc9725.html#section-4.7) (HTTPS/authentication); [RFC status](https://datatracker.ietf.org/doc/rfc9725/); [WebRTC REC 2025-03-13 section 5](https://www.w3.org/TR/2025/REC-webrtc-20250313/#rtp-media-api).

**N4. WHEP exact draft.** [draft-ietf-wish-whep-04, 2026-06-22, sections 3 and 4.3.1-4.3.6](https://www.ietf.org/archive/id/draft-ietf-wish-whep-04.html#section-3), [4.4-4.5](https://www.ietf.org/archive/id/draft-ietf-wish-whep-04.html#section-4.4). This version's counter-offer path is why an unversioned WHEP promise is inadequate.

**N5. RTSP/RTP.** [RFC 7826 sections 13.2-13.4](https://www.rfc-editor.org/rfc/rfc7826.html#section-13.2) (DESCRIBE/SETUP/PLAY); [14](https://www.rfc-editor.org/rfc/rfc7826.html#section-14) (interleaving); [2.6](https://www.rfc-editor.org/rfc/rfc7826.html#section-2.6) (session lifetime); [Appendix D.1.1](https://www.rfc-editor.org/rfc/rfc7826.html#appendix-D.1.1) (control URIs); [Appendix I.1](https://www.rfc-editor.org/rfc/rfc7826.html#appendix-I.1) and [18.54](https://www.rfc-editor.org/rfc/rfc7826.html#section-18.54) (removed recording/reserved mode); [RFC 2326 section 10, Table 2, and 10.11](https://www.rfc-editor.org/rfc/rfc2326.html#section-10) (optional RECORD/ANNOUNCE); [RFC 6184 section 8.2.1](https://www.rfc-editor.org/rfc/rfc6184.html#section-8.2.1) (H264 RTP/SDP).

**N6. GigE Vision / PFNC.** [A3 standard elements/licensing](https://www.automate.org/vision/vision-standards/gige-vision-license-product-registration), [evaluation-copy access](https://www.automate.org/vision/vision-standards/download-gige-vision-standard-specification); [EMVA PFNC 2.4 sections 1.1, 1.4, 2, 6; pp.7,10,12,31-35](https://www.emva.org/wp-content/uploads/GenICam_PFNC_2_4.pdf). Aravis commit `98c2d790ddd9da53c96a50ab51aac25ee6c37139`: [AravisProject/aravis:src/arvgvdevice.c:467-495](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgvdevice.c#L467-L495), [523-568](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgvdevice.c#L523-L568) (control/heartbeat); [src/arvgvstream.c:1656-1683](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgvstream.c#L1656-L1683) (host destination); [src/arvgvspprivate.h:123-176](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvgvspprivate.h#L123-L176) (frame/payload metadata).

**N7. USB3 Vision.** [A3 evaluation-copy access](https://www.automate.org/vision/vision-standards/usb3-vision-standard-download-standard-specification), [licensing](https://www.automate.org/vision/vision-standards/vision-standards-usb3-vision-license-product-registration). Same Aravis commit: [AravisProject/aravis:src/arvuvinterfaceprivate.h:33-45](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvinterfaceprivate.h#L33-L45), [src/arvuvdevice.c:139-191](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvdevice.c#L139-L191), [872-913](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvdevice.c#L872-L913), [1099-1128](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvdevice.c#L1099-L1128); [src/arvuvstream.c:904-981](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvstream.c#L904-L981); [src/arvuvspprivate.h:32-99](https://github.com/AravisProject/aravis/blob/98c2d790ddd9da53c96a50ab51aac25ee6c37139/src/arvuvspprivate.h#L32-L99).

**N8. UVC.** [USB-IF Video Class 1.5 document set](https://www.usb.org/document-library/video-class-v15-document-set), [archive](https://www.usb.org/sites/default/files/USB_Video_Class_1_5.zip): `UVC 1.5 Class specification.pdf`, sections 2.4.3-2.4.3.1 pp.18-20 (isochronous/bulk), 2.4.3.3 pp.29-31 (payload headers/FID/EOF), 2.4.3.5-2.4.3.6 p.34 (dynamic changes), 4.3.1.1/Tables 4-75-4-77 pp.133-146 (PROBE/COMMIT); `USB_Video_Payload_Uncompressed_1.5.pdf`, sections 3.1.1-3.1.2 pp.4-8. libuvc commit `4e9fc773914377ec0bcf2f31621f56da5a0fa09f`: [libuvc/libuvc:src/device.c:118-159](https://github.com/libuvc/libuvc/blob/4e9fc773914377ec0bcf2f31621f56da5a0fa09f/src/device.c#L118-L159), [252-263](https://github.com/libuvc/libuvc/blob/4e9fc773914377ec0bcf2f31621f56da5a0fa09f/src/device.c#L252-L263); [src/stream.c:498-565](https://github.com/libuvc/libuvc/blob/4e9fc773914377ec0bcf2f31621f56da5a0fa09f/src/stream.c#L498-L565), [624-649](https://github.com/libuvc/libuvc/blob/4e9fc773914377ec0bcf2f31621f56da5a0fa09f/src/stream.c#L624-L649) (integer-fps and post-probe validation limitations).
