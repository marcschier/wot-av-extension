# Proposed WoT media vocabulary: lifecycle, results, and provenance

## 1. Scope and standards boundary

**Original proposal, not a registered vocabulary or W3C specification.** The provisional namespace is `https://example.org/wot/av#`, prefix `av`. Every new class, property, controlled value, invariant, and example below is proposed. Requirements describe interoperable assertions and externally enforceable obligations, not an implementation supplied by metadata.

WoT TD provides Property, Action, and Event affordances, semantic `@type` annotations, and Forms describing protocol interactions. It does not make an annotated object a scheduler, lease authority, or transaction coordinator. Preserve standard `op` values and security definitions; credentials remain outside TDs.[^td] Use **Assignment** for an accepted workload-to-media mapping; retain **protocol binding** for WoT's protocol mapping. `av:ToThing`/`av:FromThing` describe media direction relative to the described Thing, never which party opens a session.

Offer/Need matching and general TD/JSON-LD foundations are integration boundaries, not redesigned here.

## 2. Term inventory and conformance grammar

All table names are `av:` terms unless explicitly qualified; **all have provisional status**. `I` means an absolute-IRI reference; `N` a nonnegative integer; `T` an explicitly typed UTC `xsd:dateTime`; `D` a finite `xsd:decimal`/`xsd:double`; `S` a string; `P` a `Pin`. Brackets give per-subject cardinality, not RDF inference. Unknown is never zero, false, or success. Ordered values use JSON-LD `@list`; large integers use typed lexical forms rather than lossy JSON numbers. Durable records have one `@id`; these are proposed validation shapes, not published OWL/SHACL.

| Classes | Meaning and alignment |
|---|---|
| `MediaSource`, `Connector`, `Processor`, `Controller` | Non-disjoint Thing types: media origin; access/adaptation boundary; processing service; coordination interface. A Thing type alone does not imply `prov:Agent`. |
| `Offer`, `Mode`, `Track`, `Need`, `InputRequirement` | Shared vocabulary boundary: capability, joint configuration, media component, desired intent, and one input constraint. |
| `Assignment`, `AssignmentStatus`, `LeaseGrant` | Immutable accepted snapshot, immutable observation, and immutable assertion of an externally issued grant revision. |
| `Pin`, `FragmentRef`, `FormRef`, `InputSelection` | Document integrity pin; pinned JSON Pointer selection; selection of an actual TD Form; accepted input mapping. |
| `OperationRequest`, `OperationOutcome`, `Condition`, `Fault` | Invocation input, durable receipt, scoped evidence claim, and structured problem. |
| `MediaAsset`, `MediaSample`, `InferenceModel`, `ResultContract`, `Result` | Fixed-aspect `prov:Entity` specializations: retained media, possibly ephemeral selected media, learned artifact manifest, payload contract, and produced result. |
| `ProcessingRun` | `prov:Activity`; use `prov:used`, `prov:wasAssociatedWith`, and `prov:startedAtTime`/`endedAtTime`. |
| `File`, `FileSlice`, `Digest`, `TimeBase`, `ClockInstant`, `ClockMapping`, `TemporalSelector`, `Tensor`, `OpSet`, `CommitReceipt` | Auxiliary value/evidence shapes defined below. |
| `DetectionResult`, `IndexResult`, `Detection`, `TranscriptSegment` | Distinct result specializations and their payload components. |

PROV's Entity/Activity/Agent meanings support these narrow alignments; `prov:wasGeneratedBy` and `prov:wasDerivedFrom` describe actual production and derivation. Neither every Thing nor every plan-like object is automatically a PROV Agent or Plan. No `owl:equivalentClass` assertions are proposed.[^prov]

| Domain | Properties: range [cardinality] |
|---|---|
| `Need` revision | `logicalNeed:I[1]`, `desiredGeneration:N[1]`, `intentState:{active,withdrawn}[1]`; input content belongs to the matching vocabulary. |
| `Pin` | `document:I[1]`, `digest:Digest[1]`; target is an exact document representation, not a floating default. |
| `FragmentRef` / `FormRef` | `pin:P[1]`, `pointer:S[1]` (JSON Pointer); FormRef additionally `operationType:S[1]`, restricted to a supported standard TD operation. |
| `Assignment` | `need:P[1]`, `desiredGeneration:N[1]`, `controller:I[1]`, `holderInstance:I[1]`, `selections:InputSelection[1..n]`, `omittedInputs:FragmentRef[0..n]`, `initialLease:I[1..n]`, `accessGrants:I[0..n]`, `model:P[0..1]`, `resultContracts:P[0..n]` (required for declared outputs). |
| `InputSelection` | `requirement:FragmentRef[1]`, `source:I[1]`, `offer:FragmentRef[1]`, `mode:FragmentRef[1]`, `tracks:FragmentRef[1..n]`, `inputForms:FormRef[1..n]`, `profiles:P[1..n]`. |
| `LeaseGrant` | `leaseSeries:I[1]`, `authority:I[1]`, `holderInstance:I[1]`, `scope:I[1]`, `fence:N[1]`, `renewal:N[1]`, `validFrom:T[1]`, `expiresAt:T[1]`. |
| `AssignmentStatus` | `assignment:I[1]`, `observedGeneration:N[1]`, `observer:I[1]`, `observerIncarnation:I[1]`, `sequence:N[1]`, `state:S[1]`, `lease:I[1..n]`, `observedAt:T[1]`, `validUntil:T[1]`, `observationClock:I[1]`, `uncertaintySeconds:D[0..1]`, `conditions:Condition[4]`, `issues:Fault[0..n]`, `validity:S[0..1]`, `assessedAt:T[0..1]`. |
| `Condition` | `name:S[1]`, `value:{true,false,unknown,not-applicable}[1]` as strings, `evidence:I[0..n]`; true requires evidence. |
| `OperationRequest` | `clientKey:S[1]`, `expectedGeneration:N[1]`, `need:P[0..1]`, `assignment:I[0..1]`, `expectedLease:I[0..1]`; action-dependent requirements below. |
| `OperationOutcome` | `outcome:{accepted,proposed,rejected,pending,uncertain}[1]`, `requestDigest:Digest[1]`, `replayUntil:T[1]`, `assignment:I[0..1]`, `lease:I[0..1]`, `alternatives:P[0..n]`, `issues:Fault[0..n]`. |
| `Fault` | `code:I[1]`, `message:S[1]`, `retryability:{safe-same-key,after-change,never,unknown}[1]`, `related:I[0..n]`; messages must not expose secrets. |
| TD affordance / Form | `mediaDirection:{ToThing,FromThing}[0..1]`, represented as IRIs; not an alternative `op`. |

## 3. Lifecycle invariants and states

**Intent and acceptance.** Each logical Need has immutable revisions and a strictly increasing desired generation. Changed constraints, model, result contract, or withdrawal require a new revision. Acceptance identifies one exact revision and one Assignment attempt; retry/reallocation creates a new Assignment identity, even for unchanged intent. Every required InputRequirement has exactly one selection; explicitly permitted optional omissions are listed. A hard mismatch yields rejection or proposed alternative Need revisions, never a partially compliant accepted Assignment.

**Pinning.** Acceptance fixes source TD, Offer/Mode/Track selectors, chosen Forms, transport/application profiles, model manifest, and result contracts. A FormRef selects a Form inside a digest-pinned TD; its endpoint remains solely in that Form's `href`. Pins require whole-document digests, never partial-byte coverage; compare document IRI plus algorithm/scope/canonicalization/digest, not merely a local Pin identifier. Dependency changes, unavailable pins, or integrity failures prohibit silent substitution. Preserve authenticated snapshots, referenced contexts, and retention sufficient for replay. xRegistry version identifiers do not by themselves make Version content immutable; epochs are conditional entity-local conflict checks, not desired generations, ownership fences, or distributed transactions.[^xr]

**Current observation.** At evaluation time, require all of: the authoritative head remains active and selects this Assignment and Need pin; head generation = Assignment generation = `observedGeneration`; the observer and its incarnation are authorized; the sequence is the latest accepted for that observer-incarnation/Assignment; evidence matches selected dependencies; freshness is provable; and `lease` references the externally current grant revision for every required authority/scope, matching its initial lease's series, holder, and fence. Equal-sequence replay is harmless; lower sequences and obsolete incarnations cannot overwrite later evidence. Sequence is not a global cursor.

`validity` is a time-stamped assessment (`current`, `stale`, `revoked`, `expired`, `unknown`), requiring `assessedAt`; it is never self-authenticating permission. Compare observation and grant intervals using trusted, uncertainty-bounded clock mappings; uncertainty that prevents proving membership means unknown, not current. Historical facts survive supersession, expiry, and revocation, but cannot restart withdrawn work.

**Authority and renewal.** Only the external enforcer grants authority and checks each effect. Each grant covers one named fencing domain; multi-domain assignments require independently valid grants, not fictitious atomic ownership. Grant validity is half-open `[validFrom, expiresAt)` on its authority's clock and can end earlier by revocation. A renewal creates a new grant revision with increasing `renewal`, preserving series/holder/scope/fence; a reassignment needs a new Assignment and higher fence in the affected authority/scope ordering. Reject obsolete renewal responses; never compare unrelated scopes' counters. Renewal neither changes intent nor extends media freshness, access grants, or artifact retention. Loss of durable fencing state cannot justify automatic takeover.

**Release and uncertain effects.** Release records a compare-current withdrawal, prevents new owned work, and drains only this Assignment's readers, transforms, reservations, and permitted commits. Drain permission is explicit: revoked/expired grants confer no grace period for triggers or result commits. Shared capture remains while other obligations exist. Expiry/revocation is not proof of cleanup; `released` needs authoritative cleanup evidence. Stale cleanup must not reset a replacement owner's source. Fencing cannot recall an already issued trigger: an ambiguous timeout is `uncertain`, requiring definitive completion/readback or reconciliation, not blind retriggering. No multi-device atomicity is promised.

**Idempotency.** Scope a client key by authenticated principal, stable Controller identity, and action semantic type. Fingerprint the complete canonical input using SHA-256/JCS; same key/different input is a conflict. Persist outcome before acknowledgment; replay the original receipt before reevaluating admission, without making its old Assignment current again. Advertise the replay horizon; after it, reconcile rather than assuming retries are safe. CloudEvents identities are a different scope.[^jcs][^ce]

The four Condition names occur exactly once: `media-observed` means samples were observed, not merely configuration readback; `application-ready` means all required delivered-media predicates were qualified; `model-loaded` means the exact model/files and execution configuration were loaded by the identified processor instance; `result-committed` means at least one result under an accepted contract has an identified durable receipt, not that all work is complete. For model-loaded, `not-applicable` means no pinned-model loading obligation, not proof that a managed provider uses no ML; for result-committed it means no declared result obligation. Undisclosed internals cannot satisfy a required model pin. Observer aggregation must retain underlying evidence; application readiness does not establish model loading, and neither establishes result commitment.

State transitions are `accepted -> applying`; `applying -> ready|degraded|failed|draining`; `ready -> degraded|failed|draining`; `degraded -> applying|ready|failed|draining`; `failed -> draining`; `draining -> released`. Release also permits `accepted -> draining`. `ready` requires application-ready evidence, not a committed result; processing under a model pin additionally requires model-loaded evidence. Cleanup failure remains `draining` with issues. `released` is terminal; recovery from `failed` needs a new attempt.

Fault codes are `av:InvalidIntent`, `av:RevisionConflict`, `av:IdempotencyConflict`, `av:NoFeasibleAssignment`, `av:DependencyUnavailable`, `av:IntegrityMismatch`, `av:Unauthorized`, `av:LeaseExpired`, `av:LeaseRevoked`, `av:StaleObservation`, `av:ContractMismatch`, `av:ClockUncertain`, `av:OutcomeUncertain`, `av:ResultCommitFailed`, and `av:ReleaseIncomplete`. Rejected/uncertain outcomes require issues; proposed outcomes require alternatives. Admission includes an Assignment iff accepted; release/renew receipts may reference their existing target, and accepted renewal requires the replacement `lease`. No failure is encoded as successful empty output.

## 4. Controller interaction contract

These are semantic `@type` classes on ordinary TD affordances, not new operation types. Actual Forms, schemas, security, and transport response mappings remain authoritative.[^td]

| Affordance / semantic class | Standard operation(s) | Proposed interaction contract |
|---|---|---|
| `submitNeed` / `av:SubmitNeedAction` | `invokeaction`, optionally `queryaction` | Request requires Need pin, client key, expected head generation. Receipt reports accepted/proposed/rejected/pending/uncertain; acceptance is not readiness. |
| `releaseAssignment` / `av:ReleaseAssignmentAction` | `invokeaction`, optionally `queryaction` | Request identifies Assignment, expected generation, key. Receipt acknowledges withdrawal/draining, not completed cleanup. TD `cancelaction` cancels an action instance, not necessarily its Assignment. |
| `renewLease` / `av:RenewLeaseAction` | `invokeaction` | Requires Assignment, expected generation, current grant revision, key. Reports the enforcer's replacement grant or refusal; metadata cannot renew itself. |
| `status` / `av:AssignmentStatusProperty` | `readproperty`; optional `observeproperty`, `unobserveproperty` | Read-only AssignmentStatus, including evidence and freshness. Notifications may prompt rereading; observation need not deliver an initial property value. |
| `resultAvailable` / `av:ResultAvailableEvent` | `subscribeevent`, `unsubscribeevent` | Emits a committed Result under its ResultContract. Receivers must deduplicate effects; TD/Event metadata does not perform deduplication. |
| `result` / `av:ResultProperty` | `readproperty` | Retrieves an identified immutable committed result for replay through its advertised Form. |

Trigger-capable deployments must separately specify their action's request/uncertain-outcome contract. A client key alone does not justify TD `idempotent:true`; declare that only when the advertised repeated-invocation behavior really holds. Access grants are opaque broker references scoped to actor, resource, operations, and lifetime, never bearer credentials or signed URLs embedded in TDs.

## 5. Artifact, model, and result contracts

| Domain | Properties: range [cardinality]; units/constraints |
|---|---|
| `MediaAsset` | `kind:{still,clip}[1]`, `completion:{complete,partial}[1]`, `files:File[1..n]`, `retentionUntil:T[1]`, `source:I[0..n]`, `timeBase:I[0..1]`, `extent:TemporalSelector[0..1]`, `gaps:TemporalSelector[0..n]`; clip requires time base/extent; partial clip requires gaps; still must be complete. |
| `MediaSample` | Either `asset:I[1]`, or `source:I[1]` + `streamIncarnation:I[1]` + `track:FragmentRef[1]` + `sequence:N[1]`. `selector:TemporalSelector[0..1]` required for clip selection; `captureTime:ClockInstant[0..1]`, `receiveTime:ClockInstant[0..1]`, with receive time required for a received live sample. |
| `TimeBase` / `ClockInstant` | TimeBase: `basis:{utc,media-pts,monotonic}[1]`, `origin:I[0..1]`, `secondsPerTick:@list(N,N)[0..1]`, `utcMapping:P[0..1]`; tick bases require origin and positive ratio. Instant: `timeBase:I[1]`, `value:T or integer[1]`, `uncertaintySeconds:D[0..1]`, nonnegative. |
| `TemporalSelector` | `timeBase:I[1]`, `selectionKind:{instant,interval}[1]`, `startTick:integer[1]`, `endTick:integer[0..1]`; interval requires end > start and is end-exclusive; instant omits end. |
| `ClockMapping` | `sourceTimeBase:I[1]`, `anchorTick:integer[1]`, `anchorUtc:T[1]`, `validTickRange:TemporalSelector[1]`, `uncertaintySeconds:D[1]`, nonnegative; the bounded affine mapping referenced by `utcMapping`. |
| `Digest` | `algorithm:{sha-256}[1]`, `scope:{file-octets,json-document,byte-range}[1]`, `canonicalization:S[1]`, `value:S[1]` (64 lowercase hex characters); byte-range additionally requires `byteOffset:N[1]`, `byteLength:N[1]`. |
| `File` / `FileSlice` | File: `location:I[1]`, `relativePath:S[1]`, `mediaType:S[1]`, `byteLength:N[1]`, `digest:Digest[1]`. Slice: `file:I[1]`, `byteOffset:N[1]`, `byteLength:N[1]`; lengths/offsets are bytes. |
| `InferenceModel` | `format:S[1]`, `files:File[1..n]`, `entryPoint:I[1]`, `externalData:FileSlice[0..n]`, `inputs:Tensor[1..n]`, `outputs:Tensor[1..n]`, `preprocessing:P[1]`, `postprocessing:P[1]`, `runtimeRequirements:P[1]`, `labelMap:P[0..1]`; classification requires labels. ONNX requires `irVersion:N[1]`, `opsets:OpSet[1..n]`. |
| `Tensor` / `OpSet` | Tensor: `name:S[1]`, `dtype:S[1]`, `shape:@list(dimensions)[1]`, `layout:S[0..1]`, `channelOrder:S[0..1]`; dimensions are N, nonempty symbol strings, or `av:UnknownDimension` IRI. OpSet: `domain:S[1]`, `version:N[1]`, positive. |
| `ProcessingRun` | `assignment:I[1]`, `processorInstance:I[1]`, `processingClock:I[1]`, `configuration:P[1]`, `lease:I[1..n]`, `runState:{running,succeeded,failed,canceled,uncertain}[1]`, `issues:Fault[0..n]`; `prov:used:I[1..n]`, `prov:wasAssociatedWith:I[1..n]`, start/end timestamps when known. |
| `ResultContract` | `payloadSchema:P[1]` (document is the schema URI), `messageType:S[1]`, `mediaType:S[1]`, `deliveryForms:FormRef[1..n]`, `completionPolicy:P[1]`, `cloudEventsSpec:I[0..1]`, `registryMessage:P[0..1]`. |
| `Result` | `contract:P[1]`, `outputSlot:S[1]`, `completion:{complete,partial,error}[1]`, `coverage:I[0..n]`, `gaps:I[0..n]` (selected media), `issues:Fault[0..n]`, `commitReceipt:I[1]`, `committedAt:T[1]`, `prov:wasGeneratedBy:I[1]`. |
| `CommitReceipt` | `result:I[1]`, `assignment:I[1]`, `run:I[1]`, `contract:P[1]`, `authority:I[1]`, `scope:I[1]`, `lease:I[1..n]`, `digest:Digest[1]`, `committedAt:T[1]`; authenticated evidence, not another grant. |
| `DetectionResult` / `Detection` | `detections:Detection[0..n]`; detection requires `classIndex:N[1]`, `label:S[1]`, `confidence:D[1]` in [0,1], `box:@list(D,D,D,D)[1]` = original-image normalized x,y,width,height; positive dimensions and in-bounds box. |
| `IndexResult` / `TranscriptSegment` | `segments:TranscriptSegment[0..n]`, `rawResults:File[0..n]`; segment requires `selector:TemporalSelector[1]`, `text:S[1]`, optionally `language:S[0..1]` (BCP 47). |

A MediaAsset denotes **sealed retained bytes**, including a retained still; a clip adds a finite timeline. Partially captured but finalized clips remain explicitly partial. A live MediaSample needs no asset or download URL. Its source/incarnation/track/sequence identifies a media unit, not an RTP packet; restart/discontinuity resets require a new incarnation. RTP timestamps have stream-specific offsets/rates and are not intrinsically UTC.[^rtp] Capture, reception, processing, and commitment clocks stay distinct. Still selection does not require an invented zero-duration clip. Descriptor deletion, grant expiry, byte deletion, and retention enforcement are separate external operations.

Within `validTickRange`, ClockMapping defines UTC = anchorUtc + (tick - anchorTick) * secondsPerTick, with uncertainty bounding the entire interval, including drift. Outside it, conversion is unknown. Edited media needs its own timeline/mapping, not an assumed capture-time offset. Unit identity and time-base identity are both mandatory; missing uncertainty cannot satisfy a hard age bound. Repeated tensor symbols constrain equal dimensions within one model; repeated UnknownDimension occurrences impose no such equality.

Digest file octets after transport/content decoding, not decoded pixels. Byte-range scope names its offset/length. Canonicalization is `none` for byte scopes; JSON-document scope uses the RFC 8785 URI, hashes the complete detached document, and follows JCS input restrictions. It is not RDF graph canonicalization.[^jcs] Every model external file is independently listed and verified; package paths are unique, relative, traversal-free, and slices fit their files. ONNX's optional external-data checksum is SHA-1 of its referenced file; do not repurpose it as this manifest's SHA-256 or as a slice checksum.[^onnx]

**InferenceModel is neither a WoT Thing Model, xRegistry model, nor payload schema.** Pin tensor names/types/shapes, symbolic-dimension constraints, image layout/channel semantics, preprocessing order, resize/crop/padding/interpolation/rounding, normalization, output decoding, suppression, thresholds, inverse geometry, and class-index labels. ONNX distinguishes IR/opset/model versions; arbitrary metadata does not standardize that whole application pipeline.[^onnx] Record actual training/export derivation where known, runtime/configuration used, and responsible agents; unknown provider internals remain unknown. A run's computational success does not prove result commitment.

ResultContract versions independently of learned artifacts. Its schema URI identifies payload syntax; message type identifies the result meaning; Forms identify delivery without copying `href`. Optional xRegistry message references are not execution instructions. CloudEvents requires `source` + `id` uniqueness for distinct events; preserve them on retransmission, independently of client invocation keys. Event source identifies occurrence context, not necessarily the media source. Here `time` means result availability/commit, never capture. Keep the standard envelope unchanged and JSON-LD inside `data`; schema/type/content type must agree with the contract. A Form chooses wire encoding: structured CloudEvents uses `application/cloudevents+json`, distinct from the payload media type.[^ce]

Complete/partial results require coverage. Partial requires at least one gap and issue; complete has no gaps. Error requires issues and omits detections; a complete DetectionResult must include `detections`, possibly empty. These presence rules require JSON validation, not inference from an absent RDF triple. Commitment means validated payload/artifacts and a durable receipt naming its storage/effect scope, not acknowledgment by every subscriber. Delivery or provider callbacks alone are not commitment. IndexResult carries transcripts and other schema-defined indexing outputs, not invented detection boxes; managed-provider configuration/raw outputs replace unavailable local-model provenance.[^prior]

Result identity is stable for `(Assignment, ProcessingRun, ResultContract pin, outputSlot)`. A slot names the selected frame/window or output partition; intentional reprocessing creates another run. Same identity with different payload is an integrity conflict. CommitReceipt ties the result digest to that identity, checked grants, authority, and scope; authenticate it rather than trusting its URI. Its digest covers the complete Result document, excluding only the separate transport envelope, not selected properties. Receivers must couple deduplication to their own committed effect. Neither an event identifier nor a publisher's storage receipt promises exactly-once effects at independent sinks.

## 6. Compact linked examples

These are hypothetical records, not executed workloads. Repeated hexadecimal digests are **fixture placeholders**, not verified checksums. External evidence/grant IRIs require authenticated resolution. Every pin's target is assumed retained and byte-immutable for this example; a real deployment must verify that assumption.

### 6.1 Shared pin catalog

```json
{
  "@context": {"av":"https://example.org/wot/av#"},
  "@graph": [
    {"@id":"urn:pin:need7","@type":"av:Pin","av:document":{"@id":"https://example.org/needs/inspect/7.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"1111111111111111111111111111111111111111111111111111111111111111"}},
    {"@id":"urn:pin:camera4","@type":"av:Pin","av:document":{"@id":"https://example.org/td/camera7/4.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"2222222222222222222222222222222222222222222222222222222222222222"}},
    {"@id":"urn:pin:transport2","@type":"av:Pin","av:document":{"@id":"https://example.org/profiles/rtsp-h264/2.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"3333333333333333333333333333333333333333333333333333333333333333"}},
    {"@id":"urn:pin:model3","@type":"av:Pin","av:document":{"@id":"https://example.org/models/detector/3.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"4444444444444444444444444444444444444444444444444444444444444444"}},
    {"@id":"urn:pin:result1","@type":"av:Pin","av:document":{"@id":"https://example.org/contracts/detections/1.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"5555555555555555555555555555555555555555555555555555555555555555"}},
    {"@id":"urn:pin:controller2","@type":"av:Pin","av:document":{"@id":"https://example.org/td/controller/2.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"6666666666666666666666666666666666666666666666666666666666666666"}},
    {"@id":"urn:pin:schema1","@type":"av:Pin","av:document":{"@id":"https://example.org/schemas/detections/1.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"7777777777777777777777777777777777777777777777777777777777777777"}},
    {"@id":"urn:pin:pre3","@type":"av:Pin","av:document":{"@id":"https://example.org/profiles/detector-pre/3.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"8888888888888888888888888888888888888888888888888888888888888888"}},
    {"@id":"urn:pin:post3","@type":"av:Pin","av:document":{"@id":"https://example.org/profiles/detector-post/3.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"9999999999999999999999999999999999999999999999999999999999999999"}},
    {"@id":"urn:pin:labels1","@type":"av:Pin","av:document":{"@id":"https://example.org/labels/parts/1.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
    {"@id":"urn:pin:runtime1","@type":"av:Pin","av:document":{"@id":"https://example.org/profiles/runtime/1.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},
    {"@id":"urn:pin:completion1","@type":"av:Pin","av:document":{"@id":"https://example.org/profiles/one-frame-complete/1.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}},
    {"@id":"urn:pin:runconfig1","@type":"av:Pin","av:document":{"@id":"https://example.org/runs/run1/config.json"},"av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}}
  ]
}
```

### 6.2 Complete Assignment and observed status

Need 7 requests one 1280x720 BGR application input with a 100 ms conservative capture-to-receive limit. The selected TD contains the named Offer/Mode/Track and Form; the transport profile fixes decoding/application format. At assessment, the external head still selects Assignment a1/generation 7, and the respective enforcers confirm reader grant g0 and result-writer grant r0. These external facts are prerequisites, not effects of the following JSON.

```json
{
  "@context": {
    "av":"https://example.org/wot/av#",
    "prov":"http://www.w3.org/ns/prov#",
    "xsd":"http://www.w3.org/2001/XMLSchema#"
  },
  "@graph": [
    {
      "@id":"urn:lease:g0","@type":"av:LeaseGrant",
      "av:leaseSeries":{"@id":"urn:lease:series17"},
      "av:authority":{"@id":"urn:thing:access-enforcer"},
      "av:holderInstance":{"@id":"urn:instance:processor5-boot2"},
      "av:scope":{"@id":"urn:scope:camera7:reader-branch17"},
      "av:fence":317,"av:renewal":0,
      "av:validFrom":{"@value":"2026-09-14T08:30:00Z","@type":"xsd:dateTime"},
      "av:expiresAt":{"@value":"2026-09-14T08:35:00Z","@type":"xsd:dateTime"}
    },
    {
      "@id":"urn:lease:r0","@type":"av:LeaseGrant",
      "av:leaseSeries":{"@id":"urn:lease:result-series18"},
      "av:authority":{"@id":"urn:thing:result-store"},
      "av:holderInstance":{"@id":"urn:instance:processor5-boot2"},
      "av:scope":{"@id":"urn:scope:result-store:need-inspect"},
      "av:fence":29,"av:renewal":0,
      "av:validFrom":{"@value":"2026-09-14T08:30:00Z","@type":"xsd:dateTime"},
      "av:expiresAt":{"@value":"2026-09-14T08:35:00Z","@type":"xsd:dateTime"}
    },
    {
      "@id":"urn:assignment:a1","@type":"av:Assignment",
      "av:need":{"@id":"urn:pin:need7"},"av:desiredGeneration":7,
      "av:controller":{"@id":"urn:thing:controller"},
      "av:holderInstance":{"@id":"urn:instance:processor5-boot2"},
      "av:initialLease":[{"@id":"urn:lease:g0"},{"@id":"urn:lease:r0"}],
      "av:accessGrants":[{"@id":"urn:access:reader17"},{"@id":"urn:access:model3"},{"@id":"urn:access:result-writer18"}],
      "av:model":{"@id":"urn:pin:model3"},
      "av:resultContracts":[{"@id":"urn:pin:result1"}],
      "av:omittedInputs":[],
      "av:selections":[{
        "@id":"urn:selection:a1:video","@type":"av:InputSelection",
        "av:requirement":{"av:pin":{"@id":"urn:pin:need7"},"av:pointer":"/av:inputs/0"},
        "av:source":{"@id":"urn:thing:camera7"},
        "av:offer":{"av:pin":{"@id":"urn:pin:camera4"},"av:pointer":"/av:offers/0"},
        "av:mode":{"av:pin":{"@id":"urn:pin:camera4"},"av:pointer":"/av:offers/0/av:modes/0"},
        "av:tracks":[{"av:pin":{"@id":"urn:pin:camera4"},"av:pointer":"/av:offers/0/av:modes/0/av:tracks/0"}],
        "av:inputForms":[{
          "@type":"av:FormRef","av:pin":{"@id":"urn:pin:camera4"},
          "av:pointer":"/properties/media/forms/0","av:operationType":"readproperty"
        }],
        "av:profiles":[{"@id":"urn:pin:transport2"}]
      }]
    },
    {
      "@id":"urn:status:a1:42","@type":"av:AssignmentStatus",
      "av:assignment":{"@id":"urn:assignment:a1"},"av:observedGeneration":7,
      "av:observer":{"@id":"urn:thing:controller"},
      "av:observerIncarnation":{"@id":"urn:instance:controller-boot3"},
      "av:sequence":42,"av:state":"ready",
      "av:lease":[{"@id":"urn:lease:g0"},{"@id":"urn:lease:r0"}],
      "av:observationClock":{"@id":"urn:clock:controller-utc"},
      "av:uncertaintySeconds":0.002,
      "av:observedAt":{"@value":"2026-09-14T08:30:01.100Z","@type":"xsd:dateTime"},
      "av:validUntil":{"@value":"2026-09-14T08:30:02.100Z","@type":"xsd:dateTime"},
      "av:validity":"current",
      "av:assessedAt":{"@value":"2026-09-14T08:30:01.120Z","@type":"xsd:dateTime"},
      "av:conditions":[
        {"av:name":"media-observed","av:value":"true","av:evidence":[{"@id":"urn:sample:camera7:s1:30"}]},
        {"av:name":"application-ready","av:value":"true","av:evidence":[{"@id":"urn:evidence:app-qualification:a1:42"}]},
        {"av:name":"model-loaded","av:value":"true","av:evidence":[{"@id":"urn:evidence:processor5:loaded-model3"}]},
        {"av:name":"result-committed","av:value":"false","av:evidence":[]}
      ],
      "av:issues":[]
    }
  ]
}
```

A renewal g1 may extend grant expiry while retaining fence 317, but cannot extend this observation past its freshness limit. Generation 8, a replacement Assignment, a later degradation observation, or revocation invalidates the current assessment. Releasing this reader branch does not authorize stopping shared camera capture.

### 6.3 Retained clip, ephemeral frame, model, contract, and run

Preprocessing profile pre3 specifies BGR-to-RGB, bilinear half-pixel letterboxing with ties-to-even rounding to 640x640, RGB padding 114, division by 255, float32 NCHW. For 1280x720, content is 640x360 with 140-pixel top/bottom padding. Post3 interprets rows as x1,y1,x2,y2,score,classId after in-graph suppression: validate finite fields and scores in [0,1], retain score >= 0.25, require integral known class IDs, invert letterboxing, clip to image bounds, reject nonpositive boxes, then normalize. Confidence is a score, not a calibration guarantee. Labels1 maps 0 to part, 1 to defect. These are hypothetical profile semantics, not ONNX defaults.

```json
{
  "@context": {
    "av":"https://example.org/wot/av#",
    "prov":"http://www.w3.org/ns/prov#",
    "xsd":"http://www.w3.org/2001/XMLSchema#"
  },
  "@graph": [
    {
      "@id":"https://example.org/assets/clip1/1.json",
      "@type":["av:MediaAsset","prov:Entity"],
      "av:kind":"clip","av:completion":"complete",
      "av:source":{"@id":"urn:thing:camera7"},
      "av:retentionUntil":{"@value":"2026-09-15T08:20:00Z","@type":"xsd:dateTime"},
      "av:timeBase":{"@id":"urn:timebase:clip1"},
      "av:extent":{"av:timeBase":{"@id":"urn:timebase:clip1"},"av:selectionKind":"interval","av:startTick":0,"av:endTick":900000},
      "av:files":[{
        "@id":"urn:file:clip1","@type":"av:File",
        "av:location":{"@id":"https://example.org/bytes/clip1.mp4"},
        "av:relativePath":"clip1.mp4","av:mediaType":"video/mp4","av:byteLength":1280000,
        "av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}
      }],
      "prov:wasGeneratedBy":{"@id":"urn:run:record-clip1"}
    },
    {
      "@id":"urn:timebase:clip1","@type":"av:TimeBase",
      "av:basis":"media-pts","av:origin":{"@id":"https://example.org/assets/clip1/1.json"},
      "av:secondsPerTick":{"@list":[1,90000]}
    },
    {
      "@id":"urn:sample:clip1:2s","@type":["av:MediaSample","prov:Entity"],
      "av:asset":{"@id":"https://example.org/assets/clip1/1.json"},
      "av:selector":{"av:timeBase":{"@id":"urn:timebase:clip1"},"av:selectionKind":"instant","av:startTick":180000},
      "prov:wasDerivedFrom":{"@id":"https://example.org/assets/clip1/1.json"}
    },
    {"@id":"urn:clock:camera7-utc","@type":"av:TimeBase","av:basis":"utc"},
    {"@id":"urn:clock:processor5-utc","@type":"av:TimeBase","av:basis":"utc"},
    {"@id":"urn:clock:controller-utc","@type":"av:TimeBase","av:basis":"utc"},
    {
      "@id":"urn:sample:camera7:s1:30","@type":["av:MediaSample","prov:Entity"],
      "av:source":{"@id":"urn:thing:camera7"},
      "av:streamIncarnation":{"@id":"urn:stream:camera7:s1"},
      "av:track":{"av:pin":{"@id":"urn:pin:camera4"},"av:pointer":"/av:offers/0/av:modes/0/av:tracks/0"},
      "av:sequence":30,
      "av:captureTime":{
        "av:timeBase":{"@id":"urn:clock:camera7-utc"},
        "av:value":{"@value":"2026-09-14T08:30:01Z","@type":"xsd:dateTime"},
        "av:uncertaintySeconds":0.005
      },
      "av:receiveTime":{
        "av:timeBase":{"@id":"urn:clock:processor5-utc"},
        "av:value":{"@value":"2026-09-14T08:30:01.080Z","@type":"xsd:dateTime"},
        "av:uncertaintySeconds":0.002
      }
    },
    {
      "@id":"https://example.org/models/detector/3.json",
      "@type":["av:InferenceModel","prov:Entity"],
      "av:format":"onnx","av:irVersion":8,
      "av:opsets":[{"av:domain":"","av:version":17}],
      "av:entryPoint":{"@id":"urn:file:model3"},
      "av:files":[
        {
          "@id":"urn:file:model3","av:location":{"@id":"https://example.org/bytes/model3/model.onnx"},
          "av:relativePath":"model.onnx","av:mediaType":"application/octet-stream","av:byteLength":6000000,
          "av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}
        },
        {
          "@id":"urn:file:weights3","av:location":{"@id":"https://example.org/bytes/model3/weights.bin"},
          "av:relativePath":"weights.bin","av:mediaType":"application/octet-stream","av:byteLength":4800000,
          "av:digest":{"av:algorithm":"sha-256","av:scope":"file-octets","av:canonicalization":"none","av:value":"abababababababababababababababababababababababababababababababab"}
        }
      ],
      "av:externalData":[{"av:file":{"@id":"urn:file:weights3"},"av:byteOffset":0,"av:byteLength":4800000}],
      "av:inputs":[{"av:name":"images","av:dtype":"float32","av:shape":{"@list":[1,3,640,640]},"av:layout":"NCHW","av:channelOrder":"RGB"}],
      "av:outputs":[{"av:name":"detections","av:dtype":"float32","av:shape":{"@list":[1,100,6]}}],
      "av:preprocessing":{"@id":"urn:pin:pre3"},
      "av:postprocessing":{"@id":"urn:pin:post3"},
      "av:runtimeRequirements":{"@id":"urn:pin:runtime1"},
      "av:labelMap":{"@id":"urn:pin:labels1"},
      "prov:wasGeneratedBy":{"@id":"urn:activity:model-export3"}
    },
    {
      "@id":"https://example.org/contracts/detections/1.json",
      "@type":["av:ResultContract","prov:Entity"],
      "av:payloadSchema":{"@id":"urn:pin:schema1"},
      "av:messageType":"com.example.vision.detections.v1",
      "av:mediaType":"application/ld+json",
      "av:completionPolicy":{"@id":"urn:pin:completion1"},
      "av:cloudEventsSpec":{"@id":"https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md"},
      "av:deliveryForms":[
        {"@type":"av:FormRef","av:pin":{"@id":"urn:pin:controller2"},"av:pointer":"/events/resultAvailable/forms/0","av:operationType":"subscribeevent"},
        {"@type":"av:FormRef","av:pin":{"@id":"urn:pin:controller2"},"av:pointer":"/properties/result/forms/0","av:operationType":"readproperty"}
      ]
    },
    {
      "@id":"urn:run:inference1","@type":["av:ProcessingRun","prov:Activity"],
      "av:assignment":{"@id":"urn:assignment:a1"},
      "av:processorInstance":{"@id":"urn:instance:processor5-boot2"},
      "av:processingClock":{"@id":"urn:clock:processor5-utc"},
      "av:configuration":{"@id":"urn:pin:runconfig1"},
      "av:lease":[{"@id":"urn:lease:g0"},{"@id":"urn:lease:r0"}],
      "av:runState":"succeeded",
      "prov:used":[
        {"@id":"urn:sample:camera7:s1:30"},
        {"@id":"https://example.org/models/detector/3.json"},
        {"@id":"https://example.org/runs/run1/config.json"}
      ],
      "prov:wasAssociatedWith":{"@id":"urn:software:processor5-boot2"},
      "prov:startedAtTime":{"@value":"2026-09-14T08:30:01.130Z","@type":"xsd:dateTime"},
      "prov:endedAtTime":{"@value":"2026-09-14T08:30:01.150Z","@type":"xsd:dateTime"}
    },
    {
      "@id":"urn:receipt:result-store:inference1:frame30",
      "@type":"av:CommitReceipt",
      "av:result":{"@id":"urn:result:inference1:frame30"},
      "av:assignment":{"@id":"urn:assignment:a1"},
      "av:run":{"@id":"urn:run:inference1"},
      "av:contract":{"@id":"urn:pin:result1"},
      "av:authority":{"@id":"urn:thing:result-store"},
      "av:scope":{"@id":"urn:scope:result-store:need-inspect"},
      "av:lease":[{"@id":"urn:lease:r0"}],
      "av:digest":{"av:algorithm":"sha-256","av:scope":"json-document","av:canonicalization":"https://www.rfc-editor.org/rfc/rfc8785","av:value":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
      "av:committedAt":{"@value":"2026-09-14T08:30:01.160Z","@type":"xsd:dateTime"}
    }
  ]
}
```

The live sample's conservative capture-to-receive age is 80 + 5 + 2 = 87 ms. The retained clip is a separate artifact, not something inference1 recorded or consumed. Its selector denotes two presentation seconds; without `utcMapping`, no capture UTC is inferred.

### 6.4 Committed detection result in an optional CloudEvent

```json
{
  "specversion":"1.0",
  "id":"result-inference1-frame30",
  "source":"https://example.org/inference/processor5",
  "type":"com.example.vision.detections.v1",
  "time":"2026-09-14T08:30:01.160Z",
  "dataschema":"https://example.org/schemas/detections/1.json",
  "datacontenttype":"application/ld+json",
  "data":{
    "@context":{
      "av":"https://example.org/wot/av#",
      "prov":"http://www.w3.org/ns/prov#",
      "xsd":"http://www.w3.org/2001/XMLSchema#"
    },
    "@id":"urn:result:inference1:frame30",
    "@type":["av:DetectionResult","av:Result","prov:Entity"],
    "av:contract":{"@id":"urn:pin:result1"},
    "av:outputSlot":"camera7-s1-track0-frame30",
    "av:completion":"complete",
    "av:coverage":[{"@id":"urn:sample:camera7:s1:30"}],
    "av:gaps":[],"av:issues":[],
    "av:commitReceipt":{"@id":"urn:receipt:result-store:inference1:frame30"},
    "av:committedAt":{"@value":"2026-09-14T08:30:01.160Z","@type":"xsd:dateTime"},
    "prov:wasGeneratedBy":{"@id":"urn:run:inference1"},
    "prov:wasDerivedFrom":{"@id":"urn:sample:camera7:s1:30"},
    "av:detections":[{
      "av:classIndex":0,"av:label":"part","av:confidence":0.97,
      "av:box":{"@list":[0.2,0.3,0.1,0.2]}
    }]
  }
}
```

The earlier status truthfully has `result-committed:false`; this later receipt does not retroactively rewrite it. A transcript instead uses an IndexResult contract, temporal segments and text, and its own ProcessingRun/provider configuration. It does not borrow this model digest or fabricate boxes.

## 7. Sources and limits

Primary sources were consulted on 2026-09-14. CloudEvents links select v1.0.2; ONNX/xRegistry `main` links are moving documents, not immutable release claims. The namespace, validation shapes, clock/fencing obligations, and payload designs remain proposals; no controller, ontology publication, provider behavior, or conformance implementation is established by these examples.

[^td]: W3C **WoT Thing Description 1.1**, [sections 5.3.1.2-5.3.1.5, affordances and permitted operations](https://www.w3.org/TR/wot-thing-description11/#interactionaffordance), [5.3.4.2 Forms](https://www.w3.org/TR/wot-thing-description11/#form), [6.3.4.1 out-of-band private security configuration](https://www.w3.org/TR/wot-thing-description11/#security-multiple), [7.1 semantic annotations](https://www.w3.org/TR/wot-thing-description11/#semantic-annotations), [9.1 Thing Models](https://www.w3.org/TR/wot-thing-description11/#thing-model-concept).

[^prov]: W3C **PROV-O**, [3.1 Entity/Activity/Agent, usage, generation, derivation, responsibility](https://www.w3.org/TR/prov-o/#description-starting-point-terms), [3.2 expanded terms and Plan](https://www.w3.org/TR/prov-o/#description-expanded-terms).

[^xr]: **xregistry/spec:core/spec.md:1206-1246**, [epoch checks](https://github.com/xregistry/spec/blob/main/core/spec.md#L1206-L1246); **xregistry/spec:core/http.md:2881-2905**, [Version updates](https://github.com/xregistry/spec/blob/main/core/http.md#L2881-L2905); **xregistry/spec:core/model.md:754-771**, [version retention](https://github.com/xregistry/spec/blob/main/core/model.md#L754-L771). Earlier report baseline: commit `16483bb564586423de9c128db89f3b61d360f4e3`.

[^onnx]: **onnx/onnx:docs/IR.md:69-119,237-250,442-480**, [model/metadata](https://github.com/onnx/onnx/blob/main/docs/IR.md#L69-L119), [graph signatures](https://github.com/onnx/onnx/blob/main/docs/IR.md#L237-L250), [shape semantics](https://github.com/onnx/onnx/blob/main/docs/IR.md#L442-L480); **docs/Versioning.md:13-27**, [independent versions](https://github.com/onnx/onnx/blob/main/docs/Versioning.md#L13-L27); **docs/ExternalData.md:83-98**, [relative external files, byte ranges, SHA-1 checksum](https://github.com/onnx/onnx/blob/main/docs/ExternalData.md#L83-L98); **docs/MetadataProps.md:9-35**, [experimental image metadata](https://github.com/onnx/onnx/blob/main/docs/MetadataProps.md#L9-L35).

[^ce]: **cloudevents/spec:cloudevents/spec.md:248-285,315-329,375-384,416-428**, [source/id](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#L248-L285), [type](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#L315-L329), [dataschema](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#L375-L384), [time](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#L416-L428); **cloudevents/formats/json-format.md:114-174**, [unchanged envelope and JSON-valued data](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md#L114-L174).

[^rtp]: **RFC 3550**, [5.1 sequence/timestamp/SSRC semantics and clock mapping](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1). This proposal's media-unit sequence is deliberately not the packet sequence.

[^jcs]: **RFC 8785** (Informational), [3.1 input restrictions and 3.2 canonical serialization](https://www.rfc-editor.org/rfc/rfc8785.html#section-3); canonicalization is an explicit application choice.

