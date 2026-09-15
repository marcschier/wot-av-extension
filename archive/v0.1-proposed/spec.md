# WoT AV Extension specification

**Draft `0.1-proposed`, 14 September 2026.** This document defines a proposed
audio/video vocabulary and associated behavioral requirements. It is not a W3C
Recommendation, an implementation claim, or an interoperability certificate.

The AV namespace is `https://example.org/wot/av#`. It is **unregistered**.
The context identifier `https://example.org/wot/av/context/v0.1` and AV profile
identifiers are **unhosted placeholders**. Their presence in a document does not
imply that an HTTP service exists at those addresses. The supplied offline
fixtures resolve selected identifiers through an explicit local cache.

## 1. Scope and document authority

AV describes media capabilities, application input requirements, accepted
execution plans, observations, and the provenance of retained media and results.
It adds annotations to native WoT descriptions; it does not replace the native
interaction model or define a universal media transport.

In this draft, **MUST** and **MUST NOT** express requirements for a claimed
feature, **SHOULD** expresses a recommendation whose departure needs a stated
reason, and **MAY** permits an option. These requirements do not modify the
upstream standards.

The baseline is [WoT Thing Description 1.1][td], [JSON-LD 1.1][jsonld],
[PROV-O][prov], and [DCMI Metadata Terms][dc]. [SHACL][shacl] supplies the
structural validation language. Later editions, draft WoT profile work, and
transport-specific specifications are not adopted implicitly.

[vocabulary/terms.json](vocabulary/terms.json) is the authored authority for
class and property definitions, class-specific ranges and cardinalities,
controlled values, and profile obligations. Its complete generated human
reference is [spec/terms.md](spec/terms.md). This document explains how those
definitions compose into descriptions and behavioral contracts.
The [context](vocabulary/context.jsonld),
[ontology](vocabulary/ontology.ttl), and [shapes](shapes/av.shacl.ttl) MUST agree
with the selected inventory. A conflicting artifact set is not a conforming
publication; an implementation MUST NOT silently choose whichever meaning
makes an input pass.

The core module covers description and matching. Lifecycle requirements apply
when assignments, status, or grants are claimed. Provenance requirements apply
when retained media, model loading, contracted outputs, or processing history
are claimed. A descriptive publisher need not implement a controller.

Every conformance statement MUST identify its target and selected versions.
Vocabulary publication, annotated-TD structure, domain-record structure,
resolved dependencies, admission behavior, lifecycle enforcement, and a
qualified native adapter are different targets. Success at an earlier target
does not establish the later ones.

## 2. Vocabulary model

The inventory defines **38 classes, 105 AV properties, and 17 directly reused
external properties**. It divides these into a 25-class/83-property core,
seven-class/21-property lifecycle module, and six-class/one-property provenance
module. The modules share one context.

| Class group | Classes in the AV namespace |
| --- | --- |
| Thing roles | `MediaSource`, `Connector`, `Processor`, `Controller` |
| Supply | `Offer`, `Mode`, `Track`, `ResourceUse` |
| Demand and selection criteria | `Need`, `InputRequirement`, `InputAlternative`, `TrackRequirement`, `IntegerConstraint`, `RationalConstraint`, `ChoiceConstraint`, `Preference`, `InputGroup` |
| Quantities, buffering, and time | `Rational`, `QueuePolicy`, `TimingConstraint`, `TimeSelector`, `TimestampMapping`, `Timestamp` |
| Immutable references | `DocumentPin`, `FormReference` |
| Lifecycle | `Assignment`, `InputSelection`, `TrackSelection`, `AssignmentStatus`, `LeaseGrant`, `Condition`, `Fault` |
| Artifacts and execution | `MediaAsset`, `MediaSample`, `InferenceModel`, `ResultContract`, `Result`, `ProcessingRun` |

A MediaSource identifies an origin, a Connector identifies acquisition or
adaptation, a Processor identifies a processing service, and a Controller
identifies coordination interactions. These roles extend `td:Thing`, can
coexist on one Thing, and do not automatically identify PROV Agents.
An Offer advertises alternatives; a Mode describes one complete combination of
acquisition, native access, simultaneous Tracks, and resource use. A Track is
one named component, not a device index or network packet identifier.

A Need is an immutable revision of desired work. An Assignment records an
accepted mapping, not an execution. AssignmentStatus records an observation,
not a mutation of that mapping. ProcessingRun denotes an actual activity;
retained artifacts and immutable records use the inventory's `prov:Entity`
relationships. The native Thing, its responsible Agent, and a running worker
incarnation are not interchangeable identities.

Property reuse is class-specific. For example, `av:mode` describes alternatives
on an Offer but the selected Mode on an InputSelection. `av:form` always names
a native Form; `av:forms` holds selected FormReference records.
`av:configuration` identifies a complete pinned configuration whose required
profile depends on the subject class. The singular predicates `av:offer`,
`av:mode`, `av:track`, `av:input`, and `av:alternative` MUST retain their
published spellings and meanings.

The external metadata predicates are `dcterms:identifier`,
`dcterms:isVersionOf`, `dcterms:format`, `dcterms:conformsTo`,
`dcterms:description`, `dcterms:title`, `dcterms:creator`, `dcterms:publisher`,
`dcterms:license`, and `dcterms:references`. Actual execution uses `prov:used`,
`prov:wasGeneratedBy`, `prov:wasDerivedFrom`, `prov:wasAssociatedWith`,
`prov:wasAttributedTo`, `prov:startedAtTime`, and `prov:endedAtTime`.
Their upstream meanings remain intact; the inventory supplies additional
class-specific use requirements, not replacement terms.

Domain alternatives in the catalogue are not conjunctive global RDFS domain
axioms. The vocabulary introduces neither blanket ontology equivalences nor
automatic imports, and it does not close every node in an external namespace.

## 3. JSON-LD, identities, and exact values

An AV-annotated TD MUST keep the native TD context first and add the AV context
without redefining native keys, operations, security terms, or default
vocabularies. An AV domain document may use the AV context on its own.
Controlled values are resource IRIs, such as `av:Still`, rather than bare
strings that accidentally resolve relative to a document.

Durable nodes marked as requiring IRI identity in the inventory MUST have
absolute identifiers. Offer, Mode, Track, input, alternative, and requirement
identities MUST remain stable within the referenced revision. Native Forms
selected under this draft also need named identity, as described below.
Identifiers are not evidence of authentication or current availability.

Set-valued collections are unordered. Only `av:preferences` uses an ordered
JSON-LD list. Set containers do not establish uniqueness. Implementations MUST
retain original JSON where rules depend on duplicate members, explicit
omissions, list structure, or an empty collection: an empty ordinary set can
disappear during RDF conversion. RDF-only validation is insufficient for those
requirements.

Integer fields MUST use JSON integer tokens without fractional or exponent
notation within magnitude `9007199254740991`. Larger exact integers MUST use a
typed value object with a decimal integer lexical string and the full datatype
IRI `http://www.w3.org/2001/XMLSchema#integer`. An ordinary numeric-looking
string is not an integer. A full-IRI property spelling does not automatically
inherit the compact property's coercion; explicit value objects are required
where needed to preserve its intended RDF value.

A Rational has an integer numerator and a strictly positive denominator,
reduced by their greatest common divisor. Context determines its units.
Frame rates, rate bounds, and seconds-per-tick time bases MUST be positive;
selector offsets MUST be nonnegative. Primitive ratios and observed
clock-relative timestamps may be signed. Millisecond quantities MUST be finite
and nonnegative, and dateTime values MUST state a timezone. Implementations MUST
reject non-finite quantities rather than coerce them to usable defaults.

## 4. Native access and pinned references

### 4.1 Forms retain operational meaning

Property, Action, Event, Form, and DataSchema nodes retain their TD 1.1 roles.
Typing an input/output DataSchema with `@type` types that schema node; it does
not, by itself, type every runtime payload. Native schema constraints still
govern the represented data. AV defines no generic DataSchema alias, additional
native operation token, or parallel endpoint object.

A selected Form MUST have an absolute, unique `@id` in its pinned TD. This
draft calls that reference convention **namedForms**; it is a profile label,
not an added AV class or a TD-core identity guarantee.
`av:form` MUST identify this node, never substitute the native `href`.
In the pinned native context, `forms` expresses `td:hasForm`, while `href`
expresses an `hctl:hasTarget` literal typed as `xsd:anyURI`.[^native]
Resolution MUST check native Form membership, not accept a lookalike node
elsewhere in the graph. It MUST NOT require an extra explicit `hctl:Form` type
triple solely because such a triple appears in an example.

Offers and Needs MUST NOT create another editable copy of the Form's address,
security, device selector, or protocol parameters. Native `contentType`
describes exchanged content; a JSON control message or SDP signaling payload
does not establish a media codec.

A media Form MUST declare its binding identity, locality, and one unambiguous
media direction. `av:FromThing` means media leaves the addressed Thing;
`av:ToThing` means media enters it. Neither means request direction or which
peer starts a session. Control-only Forms require no invented media direction.
A binding annotation alone does not identify a Form as carrying media.

Host-local access requires its declared host and qualified backend. Network
locality is not proof of reachability. A multi-leg protocol needs a pinned
binding/adapter contract identifying each relevant directed media leg;
ambiguous bidirectional signaling cannot be admitted by assigning an arbitrary
direction to its control request.

### 4.2 FormReference and DocumentPin

A FormReference MUST select one named native Form, one compatible existing TD
operation IRI, and one TD DocumentPin. Operation defaults, security inheritance,
URI variables, relative targets, and binding details MUST be resolved using the
original pinned TD. Its effective retrieval location and explicit native
`base` MUST be preserved; native target resolution and JSON-LD base processing
are distinct operations.

An optional `av:jsonPointer` uses [JSON Pointer][pointer] to select the same
Form in the original JSON. It does not assert that TD retrieval supports that
pointer as a URI-fragment service. A nameless legacy description needs a
separately identified and pinned adaptation; selecting the first Form is not a
permitted fallback.

A DocumentPin records effective document location, document kind, content media
type, and a SHA-256 digest encoded as 64 lowercase hexadecimal characters.
Hash the complete representation octets after HTTP content decoding and before
JSON parsing or media decoding. Do not normalize whitespace, strip fields,
canonicalize RDF, or apply JCS to this digest. A pin MUST stay outside the
document whose bytes it covers.

A TD pin selected by a FormReference MUST identify the expected Thing.
Acceptance requires the complete transitive interpretation and content
dependency closure, including selected TDs, contexts, inventories, schemas,
profiles, and artifacts. Traversal MUST preserve dependency edges and effective
bases and terminate safely on cycles. A missing dependency prevents acceptance;
a version label or unresolved hash is not a substitute for the bytes.

`av:PublisherTD` distinguishes publisher representations from
`av:DirectorySnapshot` representations enriched by a directory. Removing
directory fields does not recover an authenticated publisher snapshot.
Digest equality proves representation consistency, not publisher trust,
qualification, or permission to perform an operation.

## 5. Media modes and representation boundaries

An Offer MUST enumerate complete joint Modes. Combining the maximum resolution
from one Mode, the rate from another, and audio from a third does not produce
an advertised capability. Each Mode has a selected native Form, acquisition
configuration, complete simultaneous Track set, and complete resource uses.

| `av:kind` | Meaning and required distinction |
| --- | --- |
| `av:Live` | Open-ended live media, not a finite asset with an invented duration. |
| `av:Still` | Image access or acquisition. The acquisition profile determines existing-image versus new-exposure behavior. Still Tracks omit video cadence and frame rate. |
| `av:Clip` | Finite media with a named timeline and declared full offered extent. |

Repeated Still reads do not establish live acquisition or fresh exposure.
Cache behavior alone cannot establish capture time. A retained still is not a
zero-duration clip.

Every Track and TrackRequirement declares one representation family. The
four families are controlled values, not subclasses of Track.

| Representation | Relevant fields |
| --- | --- |
| `av:EncodedVideo` | Image geometry and encoded-video codec/configuration; codec values are H264, JPEG, or H265. |
| `av:RawVideo` | Geometry, pixel format, and raw buffer layout; no codec field. |
| `av:EncodedAudio` | Audio sampling/channel signature and codec/configuration; codec values are AAC or Opus. |
| `av:PCM` | Sampling rate, channel meaning, sample format, and buffer layout; no codec field. |

Width and height describe actual image geometry, not sensor limits, byte
strides, or model tensors. BGR8 specifies unsigned 8-bit B,G,R components in
logical HWC geometry. Colorimetry, alignment, memory kind, and plane/row strides
need the relevant configuration. Audio channel order and count are independent
of interleaved or planar storage, and sample rate is per channel.

Codec family IRIs identify coding families, not available encoders/decoders,
containers, transport framing, or WebRTC implementations. Exact codec
parameters and initialization need recognized, pinned configurations.
Transport clock rates and signaling channel counts MUST NOT be substituted for
the application-boundary audio signature. The inventory's H265 and Opus
definitions and public references are part of the selected release.

Constant video cadence requires an exact Rational rate. Variable and Triggered
cadence do not assert a fixed rate. `30/1` and `30000/1001` MUST remain distinct;
compare ratios exactly, not by rounded floating-point values.
Wire cadence, delivered cadence after loss, and processing throughput are
different quantities. Processing a Clip faster than real time does not change
its media-timeline frame rate.

For Clip selection, rational seconds refer to the declared timeline.
`av:AtInstant` has no end; interval selectors require
`0 <= start < end` within the offered extent. `av:ExactSamples` uses
presentation timestamps, including audio-sample trimming.
`av:CoveringInterval` permits only the stated edge tolerance, not internal
omissions. Keyframe access may require separately permitted preroll decoding.
Variable-rate selection MUST NOT replace timestamp selection with frame-index
arithmetic based on a nominal rate.

## 6. Needs, feasibility, and acceptance

### 6.1 Hard requirements

A Need identifies its Processor, revision series, generation, state, and named
logical inputs. Each selected input chooses exactly one complete
InputAlternative. Predicates within an alternative are conjunctive; alternatives
are disjunctive and their array order establishes no priority.

The wire and delivered boundaries have separate TrackRequirements. Equal
`dcterms:identifier` values join the requirements for one logical track, while
names MUST be unique within each boundary of that alternative.
Each required boundary requirement MUST be discharged exactly once by a
TrackSelection, which may join at most one wire and one delivered requirement.
Selecting delivery also selects its declared same-name wire filter, even when
that filter is marked Optional. A wire-only filter need not select an optional
delivered track. Required tracks for an input must fit the same selected Mode
and qualified path.

Integer constraints provide inclusive bounds for width, height, sampling rate,
or channel count. Rational constraints provide inclusive frame-rate bounds.
Equal bounds mean equality. Choice constraints require membership in a
nonempty allowed-IRI set, only on inventory-supported fields.
Alternative-level choices are limited to source, host, and backend.
There is no implicit expression language, arbitrary property path, unit
conversion, or approximate-codec substitution.

An Optional input or track can be omitted only explicitly: Assignment records
omitted InputRequirements and InputSelection records omitted TrackRequirements.
Once included, all its predicates remain hard. InputGroups contain at least two
distinct inputs of the same Need and are disjoint. Admission includes a whole
group or none of it; a required member makes the group required.
This is all-or-none admission, not a transaction across physical devices.

Omitted advertised facts are unknown, not favorable defaults. Unknown facts
needed by a hard constraint prevent feasibility. A missing bound adds no bound;
an empty choice set is invalid. Only a resolved Mode's complete enumeration
can establish a track's absence for that Mode. It cannot establish absence
across the entire source.

### 6.2 Effects, transformations, and resource sharing

`av:Observe` grants no permission to trigger or reconfigure acquisition.
`av:RequestCapture` and `av:ConfigureAndCapture` require authority for their
respective effects and the exact selected configuration.

Wire-to-delivered transformations need explicit permission. Decode,
ColorConvert, ResizeStretch, ResizeCrop, ResizeLetterbox, ResampleAudio,
RemixAudio, TemporalSubsample, DuplicateFrames, and PrerollDecode are distinct
operations. Missing or empty permissions authorize none. Delivering BGR images
does not grant permission for model tensor conversion or preprocessing;
`av:allowedPreprocessing` separately identifies permitted exact profiles.

Admission MUST evaluate a finite set of qualified complete plans and jointly
check placement, capture effects, every selected track, transforms, timing,
queues, resource costs, capacities, and existing allocations.
An Exclusive resource use prohibits a conflicting allocation.
SameConfiguration requires equivalence of the full pinned configuration and
its interpretation, not overlap between parameter subsets.

That comparison includes effective location/base, document kind, media type,
exact-byte digest, expected identity where applicable, recognized profile
identities, and the full context/schema/profile dependency graph. Local pin
names and version strings are lookup aids, not equivalence evidence.
Authorization is checked separately from configuration equality.

### 6.3 Ranking and failure

Only hard-feasible complete plans may be ranked. Evaluate the ordered Boolean
preference vector lexicographically, true before false; unknown or omitted
goals score false. Stable input, source, Mode, and configuration identities
break remaining ties. Native Form array order is not a preference rule.

An accepted Assignment MUST select at least one input and satisfy every
required input, track, and group. An all-optional Need with no selected input
remains unmatched rather than producing an empty media Assignment.
Failure reporting MUST retain the affected candidate/path, required and actual
evidence, and an applicable stable Fault code. Examples include
`av:UnknownRequiredFact`, `av:NoJointMode`, and
`av:BackendTrackUnsupported`. A failed lookup or unsupported contract MUST NOT
be turned into successful matching by discarding a requirement.

## 7. Timing and bounded queues

CaptureTime, PresentationTime, ReceiptTime, ProcessingTime, and CommitTime name
different physical meanings. A qualified CaptureTime denotes video exposure
midpoint or the first sample of an audio block. A network timestamp or a
declared mapping capability alone does not prove that meaning.

Clock mappings MUST identify source and reference clock incarnations/origins,
original ticks, exact seconds per tick, an anchor, a half-open validity
interval, basis evidence, and a conservative uncertainty bound including drift.
The affine relation is
`reference_seconds = (tick - anchor_tick) * time_base + anchor_reference_seconds`.
Do not extrapolate across clock reset/wrap or beyond the qualified interval.
UTC anchoring additionally needs timezone, authority, and uncertainty.

After establishing a compatible basis and common clock, admission evaluates
worst-case timing bounds:

```text
age_bound_ms  = 1000 * (evaluation_s - sample_s)
                + evaluation_error_ms + sample_error_ms
skew_bound_ms = 1000 * abs(sample_a_s - sample_b_s)
                + sample_a_error_ms + sample_b_error_ms
```

Each applicable bound MUST be at most its `av:limitMs`.
Age identifies the ApplicationIngress or InferenceStart evaluation stage.
Skew covers the admitted tracks/inputs, using an associated audio block's first
sample when comparing it with video. Missing uncertainty is unknown, not zero.
An arrival/deadline guarantee also needs qualified clock and window semantics;
frame rate alone supplies neither.

Each accepted path MUST disclose bounded public and internal queues, including
queues before a branch split. A QueuePolicy names its stage, positive capacity,
unit, overflow behavior, and coverage obligation. BlockUpstream is feasible
only with qualified upstream pause or bounded spooling behavior.

NoIntentionalDrop prohibits planned discard from the named stage through
application delivery; it does not promise absence of sensor or network loss.
Gaps must be reported as incomplete coverage or fail the obligation.
DropOldest and DropNewest do not establish completeness. A dropping queue
shared before recording and inference branches cannot satisfy a downstream
no-intentional-drop recording contract merely because the final recording
queue does not drop.

## 8. Required profile-contract families

The following eleven families are AV-defined contract requirements, **not a
claim that their complete executable schemas or native implementations exist**.
Their identifiers use the unhosted prefix
`https://example.org/wot/av/profile/`, followed by the suffix below.
The complete requirements remain in the term inventory/catalogue.

A recognized instance MUST provide exact fields, schema/dialect, units,
semantics, dependency pins, and applicable qualification. An arbitrary hashed
JSON object or an advertised profile URI is insufficient.

| Identifier suffix | Document kind | Required subject matter |
| --- | --- | --- |
| `acquisition/v0.1` | ProfileDocument | Acquisition mode, capture/trigger ownership, authorized intents, configuration/resources, native control references, uncertain effects, existing/new Still behavior, and Clip seek/selection behavior. |
| `adapter-plan/v0.1` | ProfileDocument | Implementation/version and placement; selected Forms/media legs; per-track wire/delivered signatures; ordered transforms; all queues and branches; pause/spool, resource, clock, and measured qualification evidence. |
| `clock-map/v0.1` | ProfileDocument | Clock incarnations/origins, original tick evidence, exact time base and anchor, bounded validity/drift, time basis, and uncertainty. |
| `resource-config/v0.1` | ProfileDocument | Whole resource state, parameter units, authority/scope, and compatible simultaneous allocations. |
| `codec-layout/v0.1` | ProfileDocument | Decoder initialization and codec parameters; raw color/packing/stride/alignment/memory details; qualified mappings from native formats. |
| `media-manifest/v0.1` | ManifestDocument | Sealed still/clip identity and state, file paths/types/lengths/hashes, pinned access Forms, finite timeline and gaps, derivation, retention, and its enforcer. |
| `model-manifest/v0.1` | ManifestDocument | Model dialect/files and checked external-data ranges; ordered tensor signatures; exact preprocessing/postprocessing, labels, geometry, and runtime dependencies. |
| `result-contract/v0.1` | ManifestDocument | Payload schema and dialect, media/semantic type, payload location, native delivery/replay references, completion/gaps/errors, output slot, deduplication, and commitment rules. |
| `run-config/v0.1` | ProfileDocument | Actual loaded model or identified provider configuration, processing dependencies/incarnation, accepted selections, grant checks, clocks, slots, and responsibilities. |
| `control/v0.1` | ProfileDocument | Native control-role mappings and exact schemas/envelopes; scoped idempotency, receipts, current-generation/grant comparison, outcomes, authority, revocation, fencing, and cleanup. |
| `commit-receipt/v0.1` | ReceiptDocument | Authenticated Result/Assignment/run/contract/slot/payload identity, effect scope, checked grants, and durable commitment time with clock uncertainty. |

The profile-owned acquisition labels Continuous and FreeRun are not new AV
classes. Listing HTTP, RTSP, UVC, industrial-camera, SRT, HLS, or WebRTC families
does not implement their negotiation, authentication, framing, timestamps,
errors, placement, or lifetime behavior. Native implementations require their
own complete, pinned contracts and qualified paths.

## 9. Immutable lifecycle and external authority

### 9.1 Revisions and observations

Changing desired work, model, output contracts, or withdrawal produces a new
Need revision with an increasing generation. Need state is Active or Withdrawn.
Reallocation produces a new Assignment even when intent is unchanged.
Need, Assignment, AssignmentStatus, and LeaseGrant revisions MUST be immutable;
external authorities maintain their current heads.

Assignment lifecycle is expressed by status observations. The permitted next
states are:

| Observed state | Permitted next state |
| --- | --- |
| Accepted | Applying, Draining |
| Applying | Ready, Degraded, Failed, Draining |
| Ready | Degraded, Failed, Draining |
| Degraded | Applying, Ready, Failed, Draining |
| Failed | Draining |
| Draining | Released |
| Released | None |

Released is terminal. A failed attempt is not restarted by editing its accepted
record; a new attempt needs a new Assignment. Cleanup failure remains Draining
with explicit issues.

A claim of current status requires an authorized active head selecting the
exact Need revision and Assignment, equal generations, matching dependency and
evidence scope, an authorized observer Agent/incarnation, and its latest
accepted sequence. Every applicable grant must be the externally current
revision for its authority/scope and accepted series, holder, and fence.
The entire uncertain evaluation-time interval must fit the status freshness
window `[observedAt, validUntil)` and every grant window
`[validFrom, validUntil)`, subject to earlier revocation.

Missing evidence does not establish currentness. A restarted observer needs a
new incarnation; stale sequences or superseded incarnations cannot replace
later observations. Replaying a historical record does not reactivate a
withdrawn Need.

### 9.2 Conditions are independent evidence claims

Every AssignmentStatus contains exactly one of each condition below.

| Condition | Meaning of a supported True value |
| --- | --- |
| MediaObserved | Selected media samples have actually been observed. |
| ApplicationReady | All required delivered-media predicates are qualified. |
| ModelLoaded | The holder incarnation loaded the exact accepted model/files/configuration. |
| ResultCommitted | At least one accepted output has durable commitment evidence; this is not completion of all work. |

Condition states are the IRIs `av:True`, `av:False`, `av:Unknown`, and
`av:NotApplicable`. True requires identified, scoped support. False is a
negative assessment rather than missing information. NotApplicable is allowed
for ModelLoaded only without a model-loading obligation and for ResultCommitted
only without an output obligation.

Ready requires ApplicationReady True. Starting model-dependent processing
also requires ModelLoaded True for the accepted model and holder.
Readiness alone does not prove media observation, result commitment, or present
authority. Undisclosed model internals remain unknown; they cannot satisfy a
requirement for a particular model pin.

### 9.3 Grants, release, and uncertain effects

A LeaseGrant covers one external authority/scope. Authority arises from
per-effect enforcement, not possession of a descriptive record.
Renewal creates a new grant ID and higher sequence in the same series while
preserving authority, scope, holder, and fence. Reassignment advances the fence
in each affected scope and creates a new Assignment. Counters from unrelated
scopes are not a common ordering.

Renewal does not extend observation freshness, modify intent, or change artifact
retention. Release compares current ownership and drains only the Assignment's
own readers, transformations, reservations, and permitted commits.
Shared capture needed by other work must remain active. Released requires
authoritative cleanup evidence; stale cleanup MUST NOT reset a replacement
owner's state. Expiry or revocation provides no implicit trigger/commit grace.

A fence cannot undo an already issued physical trigger. An ambiguous timeout
requires readback or reconciliation under the control profile, not blind
repetition. Retry identifiers cannot independently guarantee device atomicity
or exactly-once downstream effects.

### 9.4 Ordinary WoT control interactions

Controller role identifiers belong to a pinned control profile. They are not
new AV action classes or WoT operation values. Submit, release, and renewal
use native Action invocation; status uses Property reading and, if supported,
native observation. Result delivery uses its declared native interactions.
Action cancellation does not automatically mean assignment release.

The control profile MUST map each supported role to named Forms, standard
operations, exact payload/schema locations, and documented support limits.
It MUST scope client retry keys by authenticated principal, stable controller,
and action; reject key reuse with different input; persist receipts before
acknowledgment; and state the replay horizon.
Its request fingerprint uses SHA-256 over [JCS][jcs] input. This is a
control-request rule, not a change to DocumentPin's exact-byte hashing.

Outcomes distinguish accepted, proposed, rejected, pending, and uncertain
results. Accepted names the Assignment; proposals name explicit alternatives;
rejection or uncertainty includes issues. Unsupported roles MUST NOT be
implied by a schema example. Grant references are opaque scoped identifiers,
not bearer credentials embedded in public descriptions.

## 10. Retained media, models, and results

A MediaAsset is sealed retained Still or Clip content described by a recognized
manifest. A partial finalized Clip records its gaps. A MediaSample either
selects from a retained asset or identifies ephemeral media by source, stream
incarnation, Track, and media-unit sequence. That sequence is not assumed to
be a network packet counter, and a sample need not have a download URL.

InferenceModel identifies a learned-model manifest, not a WoT Thing Model or a
JSON Schema. Model files, external-data ranges, tensor names/dtypes/dimensions,
layout, preprocessing, postprocessing, labels, and runtime requirements must
be pinned as required by the profile. Symbolic dimension equality is distinct
from an unknown dimension. For an ONNX manifest, IR, opset/domain, and model
versions remain independently specified. Application image delivery does not
implicitly authorize tensor conversion, normalization, padding, or resizing.

A Need declares ResultContracts and its Assignment fixes the accepted contract
dependencies. Each Result identifies one contract, an output slot, a complete
payload pin, a generating ProcessingRun, state, committedAt, and authenticated
durable receipt. The contract determines payload meaning and completion:
empty detections may be complete, but errors or incomplete transcripts cannot
be reported as empty successful output.

PROV links MUST describe actual use, generation, derivation, responsible Agents,
and known execution times. An unstarted Assignment MUST NOT claim that inputs
were used or a result generated. A run's execution configuration identifies
what was actually loaded and which accepted selections and grants it used.
Computation finishing, a transport acknowledgment, and a subscriber's own
durable effect are separate events.

A commit receipt binds the result to Assignment, run, exact contract pin,
output slot, payload, effect authority/scope, checked grants, and commitment
time/uncertainty. Different payload bytes for the same
`(assignment, run, contract-pin, output-slot)` are an integrity conflict,
not a permitted overwrite. Digests and event identifiers do not alone make
effects exactly once.

Retention requires an identified enforcing authority. Deleting metadata,
revoking access, and deleting the underlying media or model bytes are different
operations; none is inferred from another.

## 11. Discovery and optional external coordination

[WoT Discovery][discovery] provides the baseline for obtaining TDs.
Discovery and candidate queries do not reserve a Mode, authorize capture, or
prove a path feasible. Directory enrichment and publication identity must
remain distinguishable when pinning representations.

A local indexing profile may project pinned snapshots into named graphs.
It MUST retain graph-to-pin provenance, native Form membership, interpretation
dependencies, complete Mode boundaries, and revision separation. That layout
is a profile choice, not a universal guarantee of every directory.
A timeout, denied request, unsupported query service, or incomplete view is
not evidence of a successful empty search. Lost change notifications require
reconciliation rather than assuming an up-to-date candidate set.

External registries may hold derived descriptions or references under a
separately specified mapping profile. Such projections MUST preserve native
access and security meaning, and MUST NOT become a second independently
editable source of media endpoints. Mutable version labels do not substitute
for immutable representation pins or fencing.

An external conversation system may exchange a Need pin and the references
needed for control or result retrieval. Those messages coordinate work; they
do not define the media transport. This draft specifies no conversation
language, private framework mapping, or choreography execution engine.

If a ResultContract selects [CloudEvents 1.0.2][cloudevents], it preserves the
standard envelope, places JSON-LD only within `data`, maintains stable
`source`/`id` for retransmission, and defines event time as result availability.
Those are this draft's integration-profile requirements, not new CloudEvents
attributes or general guarantees about downstream effects.

## 12. Worked fixtures and validation limits

The [source TD](examples/source.td.json) advertises one synthetic Still Mode
carrying JPEG at 1280x720 through a named snapshot Property Form. Its acquisition
semantics are latest-existing image, not new exposure.
The [Need](examples/need.jsonld) requests that wire signature and contiguous
BGR8 delivery with the same logical track name, explicitly permitting Decode
and ColorConvert. It requests no implicit resize, audio, frame rate, freshness,
model, or tensor contract.

The [controller TD](examples/controller.td.json) uses ordinary submit/release
Actions and a status Property. Its profile owns the envelope keys and role
mappings. Local-memory application delivery invents no network sink Form.
The accompanying [Assignment](examples/assignment.jsonld) is a
**negative admission fixture, NOT ADMITTED**: qualification bytes are missing
and the illustrative grant is expired at the fixed evaluation instant.
An all-zero qualification digest visibly marks that unresolved dependency;
it is not a verified checksum. Controller requests are unsent and receipts
are synthetic.

The separate [Live TD](tests/fixtures/live.td.json) supports a candidate query
for same-Mode H264 video at 1280x720 and exact 30/1, plus AAC mono audio at
48000 samples per second. It deliberately retains unresolved configuration
pins and unqualified identities. The [codec fragments](tests/fixtures/codec-fragments.jsonld)
are not complete TDs or native codec/WebRTC implementations.
A video-only path cannot silently satisfy a Need that also requires audio.

[examples/NOTES.md](examples/NOTES.md) and
[spec/validation.md](spec/validation.md) document the fixture boundaries.
The offline tools check generated-byte consistency, selected JSON/reference/
arithmetic cases, native TD structure, finite-graph SHACL and meta-SHACL, and
query expectations. They report expected rejections and known limitations as
such. They neither supply missing qualification nor perform real acquisition,
decoding, authorization, current-head lookup, or lifecycle enforcement.

SHACL runs on explicitly supplied finite graphs without network imports or
inference. Only the inventory-listed intrinsic shapes are closed:
Rational, IntegerConstraint, RationalConstraint, ChoiceConstraint, QueuePolicy,
TimingConstraint, TimeSelector, and Condition. Things remain extensible.
The PositiveRationalShape and NonNegativeRationalShape helpers implement
contextual sign restrictions; they are not additional domain classes.

SHACL alone does not establish every JSON-presence, numeric, list, reference,
profile-body, hard-match, clock, resource, or lifecycle requirement.
The native schema is the pinned upstream representation, not an automatically
updated service response. Its Draft-07 processing does not enforce the
`prefixItems` keyword, and optional `format` assertions are not enabled in the
supplied harness. Passing these structural checks is therefore not a complete
TD conformance claim, still less proof of native interoperability.

The [README](readme.md) gives setup and commands. Default validation and
`generate.py --check` MUST NOT reseal mismatching inputs. Intentional
regeneration is separate and changes derived artifacts and associated digests.
Historical fixture totals are not conformance thresholds for this document.
Complete executable profile schemas, qualified adapters, measured timing/media/
resource evidence, and production admission/lifecycle implementations remain
outside the functionality provided here.

## 13. Security, evolution, and publication boundaries

Implementations MUST authenticate publishers and effect authorities separately
from checking digests. Context and artifact loading MUST use explicit policies
and bounded resolution; unknown or unavailable dependencies cannot be replaced
with an assumed successful result. Model/manifest paths and external-data
ranges require validation before use.

Discovery, control, media access, and result consumption have distinct
authorization requirements. Credentials, bearer URLs, and private keys MUST
stay out of published TDs, pins, and Fault explanations. Descriptions and
evidence SHOULD minimize personal information and sensitive deployment
topology. No record in this vocabulary itself enforces privacy, retention, or
device authority.

Controlled sets belong to a recognized, pinned inventory/profile revision.
A future revision may add explicitly defined values and their dependencies,
applicability, schemas, and qualification rules. It MUST NOT silently widen an
older pinned set or redefine existing IRIs, context coercions, property
cardinalities, or native operations. Incompatible meanings need new terms or a
new namespace. Unknown required codecs, parameters, or profiles cannot satisfy
a hard constraint.

Publication MUST retain selected immutable artifacts, dependency identities,
digests, and change/deprecation records. The current package's integrity
manifest has an explicit limited scope; it does not cover every document in
the repository. Earlier research is not an alternative normative source.
Private implementation material is not incorporated by reference here.
First-party license selection, third-party notices, and local-only omissions
are described in the [README](readme.md); provenance is not a grant of reuse
rights.

## References

The dated baseline references below are deliberate. Following a newer document
at a mutable URL does not update this draft's adopted baseline.

[td]: https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/ "WoT Thing Description 1.1, W3C Recommendation, 5 December 2023"
[jsonld]: https://www.w3.org/TR/2020/REC-json-ld11-20200716/ "JSON-LD 1.1, W3C Recommendation, 16 July 2020"
[prov]: https://www.w3.org/TR/2013/REC-prov-o-20130430/ "PROV-O, W3C Recommendation, 30 April 2013"
[dc]: https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/ "DCMI Metadata Terms, 20 January 2020"
[shacl]: https://www.w3.org/TR/2017/REC-shacl-20170720/ "Shapes Constraint Language, W3C Recommendation, 20 July 2017"
[pointer]: https://www.rfc-editor.org/rfc/rfc6901.html "RFC 6901: JavaScript Object Notation (JSON) Pointer"
[jcs]: https://www.rfc-editor.org/rfc/rfc8785.html "RFC 8785: JSON Canonicalization Scheme"
[discovery]: https://www.w3.org/TR/2023/REC-wot-discovery-20231205/ "Web of Things Discovery, W3C Recommendation, 5 December 2023"
[cloudevents]: https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md "CloudEvents specification, version 1.0.2"

[^native]: W3C's native TD context at revision
    `87808f1644ba79eb0a58d238385a8bd4a2236853`,
    [Form context mappings, lines 380-451](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L380-L451).
    The [local provenance manifest](third_party/wot/manifest.json) identifies the
    unchanged context/schema bytes and their separate license notices.
