# WoT AV v0.1 - complete term catalogue

**Original, unregistered proposal; external context unhosted.** The sole authored term authority is `vocabulary/terms.json`: 38 classes, 105 AV properties and 17 reused external properties.

Domains are alternatives, not global RDFS intersections. More-specific class uses override inherited uses. Cardinalities count RDF values, except preferences count list items; * is unbounded. Set labels and SHACL helper names are not domain classes. Default JSON containers do not imply scalar-only values. Structural validity never establishes admission, qualification or present availability.

## Classes and glossary
| Class | Module | Identity | Superclasses | Complete meaning |
|---|---|---|---|---|
| `av:MediaSource` | core | iri | `td:Thing` | A physical or logical origin of media, represented as a Thing. Not its media URL or retained content. |
| `av:Connector` | core | iri | `td:Thing` | A Thing exposing acquisition or adaptation, including host-local native camera access. Not automatically a sensor or PROV Agent. |
| `av:Processor` | core | iri | `td:Thing` | A Thing offering media processing or receiving input media. Its service identity is distinct from a running holder incarnation. |
| `av:Controller` | core | iri | `td:Thing` | A Thing exposing coordination interactions through native TD affordances. Its metadata does not implement admission or authority. |
| `av:Offer` | core | iri | - | A discoverable set of mutually alternative complete Modes from one source, not an endpoint or promise of current availability. |
| `av:Mode` | core | iri | - | One jointly valid acquisition, native Form, representation, simultaneous track and resource configuration. Track enumeration is complete for this Mode. |
| `av:Track` | core | iri | - | One named simultaneous media component of a Mode, with one encoded or raw wire representation. Identity is not an SSRC or device index. |
| `av:ResourceUse` | core | node | - | Use of one shared acquisition/configuration resource in a complete state, with an explicit sharing rule. |
| `av:Rational` | core | node | - | An exact reduced numerator/positive-denominator ratio. Units are determined only by the containing predicate. |
| `av:Need` | core | iri | `prov:Entity` | An immutable desired-intent revision. dcterms:isVersionOf identifies its logical Need and generation orders revisions; current heads are external. |
| `av:InputRequirement` | core | iri | - | One named logical workload input, required or optional, with complete alternatives. A Need may have multiple such inputs. |
| `av:InputAlternative` | core | iri | - | One complete permitted input contract. Its predicates are conjunctive; alternatives are disjunctive, without array-order priority. |
| `av:TrackRequirement` | core | iri | - | One logical required or optional track at the wire or delivered boundary. Equal dcterms:identifier values join its wire and delivered contracts within an alternative. |
| `av:IntegerConstraint` | core | node | - | Inclusive integer bounds on one supported integer field. At least one bound is present; identical bounds express exact equality. |
| `av:RationalConstraint` | core | node | - | Inclusive exact-rational bounds on a supported rate field. Compare by cross multiplication, never floating-point rounding. |
| `av:ChoiceConstraint` | core | node | - | Membership in a nonempty set of explicitly supported term/resource IRIs for one supported field. Not a general expression language. |
| `av:Preference` | core | node | - | One Boolean preference goal for an input. Need preference order gives lexicographic ranking after all hard constraints pass. |
| `av:InputGroup` | core | iri | - | An all-or-none group of at least two Need inputs, optionally synchronized. Groups are disjoint in v0.1; admission atomicity is not physical transaction atomicity. |
| `av:QueuePolicy` | core | node | - | A bounded hard policy at one explicitly named processing stage, including overflow and coverage obligations. |
| `av:TimingConstraint` | core | node | - | A maximum age or pairwise skew in milliseconds for a stated time basis. An age also states the evaluation stage. |
| `av:TimeSelector` | core | node | - | An instant or half-open interval in one named media timeline, in exact rational seconds. Also describes the full finite extent of an offered Clip. |
| `av:TimestampMapping` | core | node | - | A declared mapping capability or actual qualified clock mapping, with time basis, seconds-per-tick and a pinned bounded affine-record profile. It is not itself measured exposure evidence. |
| `av:Timestamp` | core | node | - | An observed instant in rational seconds from one incarnation-specific clock origin, with basis, provenance and optional known uncertainty. |
| `av:DocumentPin` | core | iri | `prov:Entity` | A fixed representation snapshot with retrieval location, exact-octet SHA-256 and provenance scope. dcterms:format/conformsTo describe the pinned content, not the JSON serialization of this descriptive pin record. |
| `av:FormReference` | core | node | - | An accepted selection of one native Form and one standard TD operation in one pinned TD. An optional JSON Pointer is an explicit selector against those original JSON bytes, never an assumed URI-fragment service. |
| `av:Assignment` | lifecycle | iri | `prov:Entity` | An immutable accepted mapping of one Need revision to selected input/track paths and initial grants. Not a WoT protocol binding or an execution Activity. |
| `av:InputSelection` | lifecycle | iri | - | One accepted logical input, complete alternative, Offer, Mode, adapter configuration and source/sink native Form selections. |
| `av:TrackSelection` | lifecycle | iri | - | A mapping of one offered Track to the wire and/or delivered TrackRequirements of one logical track; the qualified adapter configuration supplies the actual boundary signatures. |
| `av:AssignmentStatus` | lifecycle | iri | `prov:Entity` | An immutable observation of an Assignment at a generation and observer-incarnation sequence. Currentness, revocation and head selection must be checked externally. |
| `av:LeaseGrant` | lifecycle | iri | `prov:Entity` | An immutable revision of an externally enforced, single-authority/scope grant. dcterms:isVersionOf is its series; renewal sequence and fencing epoch are distinct. |
| `av:Condition` | lifecycle | node | - | One scoped evidence claim, whose four-valued truth state is independent of lifecycle state and digest literals. |
| `av:Fault` | lifecycle | node | - | A structured failure with a stable code, non-secret explanation, and optional pinned/identified evidence. Retry and uncertain-effect rules are supplied by the control profile. |
| `av:MediaAsset` | provenance | iri | `prov:Entity` | Sealed retained still or clip content, complete or explicitly partial, described by an exact typed manifest. Not its Offer or storage endpoint. |
| `av:MediaSample` | provenance | iri | `prov:Entity` | A selected media unit: either derived from a retained asset with a selector, or identified by source, stream incarnation, Track and media-unit sequence. It need not have a media URL. |
| `av:InferenceModel` | provenance | iri | `prov:Entity` | A versioned learned-model manifest with verified files, exact tensor/pre/postprocessing/runtime semantics. Neither a WoT Thing Model, JSON Schema, nor xRegistry model. |
| `av:ResultContract` | provenance | iri | `prov:Entity` | A versioned typed contract for a declared output, naming payload schema/dialect/location, meaning, completion rules and native delivery FormReferences in its pinned manifest. |
| `av:Result` | provenance | iri | `prov:Entity` | An identified output payload under an accepted ResultContract, with explicit completion state, derivation and durable commitment evidence. Its payload is not forced into a universal detection schema. |
| `av:ProcessingRun` | provenance | iri | `prov:Activity` | An actual capture, transform, training/export, inference or indexing execution. Use PROV directly for inputs, generation, derivation, responsible agents and execution times. |

## Property uses by domain
| Property | Module | Domain | Range | Cardinality | Units | JSON value/container; lexical limits | Complete meaning |
|---|---|---|---|---|---|---|---|
| `av:offer` | core | `td:Thing`<br>`av:InputSelection` | `av:Offer`<br>`av:Offer` | 0..*<br>1..1 | - | node/set | Links an advertised or selected Offer; no copied media address. |
| `av:need` | core | `td:Thing`<br>`av:Assignment` | `av:Need`<br>`av:Need` | 0..*<br>1..1 | - | node/set | Links a described or accepted immutable Need revision, not its mutable head. |
| `av:source` | core | `av:Offer`<br>`av:InputAlternative`<br>`av:MediaSample` | `av:MediaSource`<br>`av:MediaSource`<br>`av:MediaSource` | 1..1<br>0..1<br>0..1 | - | node/default | Media source identity; omission on an alternative permits discovery. |
| `av:connector` | core | `av:MediaSource` | `av:Connector` | 0..1 | - | node/default | Acquisition/adaptation Thing; required for host-local native-camera sources. |
| `av:host` | core | `av:Connector`<br>`hctl:Form` | `IRI`<br>`IRI` | 1..1<br>0..1 | - | node/default | Execution host identity, not device index or network address. HostLocal media Forms require it. |
| `av:backend` | core | `av:Connector` | `IRI` | 1..1 | - | node/default | Qualified native/adapter runtime identity with a versioned capability profile. |
| `av:locality` | core | `hctl:Form` | `enum:Locality` | 0..1 | - | node/default | Access locality. Optional on generic Forms; exactly one is required for media Forms under native_form_rules. |
| `av:binding` | core | `hctl:Form` | `IRI` | 0..1 | - | node/default | Recognized binding specification IRI. Its exact content and dependencies must be pinned at acceptance; this is not native Thing profile conformance and does not by itself assert media flow. Optional on generic Forms; required on media Forms under native_form_rules. |
| `av:mediaDirection` | core | `hctl:Form` | `enum:MediaDirection` | 0..1 | - | node/default | Media direction relative to the addressed Thing, not request/signaling/session-initiation direction. No universal Both value. Absent on control-only Forms; required for an unambiguously directed media access under native_form_rules. |
| `av:mode` | core | `av:Offer`<br>`av:InputSelection` | `av:Mode`<br>`av:Mode` | 1..*<br>1..1 | - | node/set | Links complete joint Modes, not independent capability axes. |
| `av:kind` | core | `av:Mode`<br>`av:InputAlternative`<br>`av:MediaAsset` | `enum:MediaKind`<br>`enum:MediaKind`<br>`av:Still` OR `av:Clip` | 1..1<br>1..1<br>1..1 | - | node/default | Temporal media kind. Still does not imply fresh exposure; Clip requires a finite selector/extent. |
| `av:form` | core | `av:Mode`<br>`av:InputAlternative`<br>`av:FormReference` | `hctl:Form`<br>`hctl:Form`<br>`hctl:Form` | 1..1<br>0..1<br>1..1 | - | node/default | Always the absolute @id of a native TD Form node, never its href. On InputAlternative this is an optional Processor sink Form; acceptance still uses FormReference. |
| `av:track` | core | `av:Mode`<br>`av:TrackRequirement`<br>`av:TrackSelection`<br>`av:MediaSample` | `av:Track`<br>`av:Track`<br>`av:Track`<br>`av:Track` | 1..*<br>0..1<br>1..1<br>0..1 | - | node/set | Links offered media Track identities. A TrackRequirement may optionally restrict selection to one exact Track. |
| `av:resourceUses` | core | `av:Mode` | `av:ResourceUse` | 1..* | - | node/set | Complete shared resource/configuration uses of the Mode; admission also checks externally supplied capacities and allocations. |
| `av:resource` | core | `av:ResourceUse` | `IRI` | 1..1 | - | node/default | One named resource/fencing configuration domain, not an address. |
| `av:configuration` | core | `av:Mode`<br>`av:Track`<br>`av:ResourceUse`<br>`av:TimestampMapping`<br>`av:InputSelection`<br>`av:ProcessingRun` | `av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin` | 1..1<br>0..1<br>1..1<br>0..1<br>1..1<br>1..1 | - | node/default | One exact typed configuration pin. Mode: acquisition/capture/control/seek profile; Track: codec/layout details; ResourceUse: complete resource state; TimestampMapping: bounded affine records; InputSelection: qualified adapter plan; ProcessingRun: actual execution configuration. Unsupported profiles cannot establish feasibility. |
| `av:sharing` | core | `av:ResourceUse` | `enum:Sharing` | 1..1 | - | node/default | Resource sharing requires exact complete-configuration equivalence, not overlapping parameter subsets or similarly named IDs. |
| `av:representation` | core | `av:Track`<br>`av:TrackRequirement` | `enum:Representation`<br>`enum:Representation` | 1..1<br>1..1 | - | node/default | One exact encoded/raw representation family. On Track it is wire content; on TrackRequirement it describes the containing wire/delivered boundary. |
| `av:width` | core | `av:Track` | `integer` | 0..1 | pixel | integer/default; minimum=1 | Actual display/image width in pixels, not sensor maximum, byte stride or tensor width. |
| `av:height` | core | `av:Track` | `integer` | 0..1 | pixel | integer/default; minimum=1 | Actual display/image height in pixels, not sensor maximum or tensor height. |
| `av:codec` | core | `av:Track` | `enum:Codec` | 0..1 | - | node/default | Encoded-media codec family; an SDP/JSON Form content type is not a codec claim. |
| `av:pixelFormat` | core | `av:Track` | `enum:PixelFormat` | 0..1 | - | node/default | Exact raw-pixel channel order/sample packing; colorimetry, strides and native PFNC mappings require qualified configuration. |
| `av:cadence` | core | `av:Track` | `enum:Cadence` | 0..1 | - | node/default | Offered video cadence semantics. Still omits cadence/frameRate; Constant requires frameRate; Variable/Triggered do not assert an exact rate. |
| `av:frameRate` | core | `av:Track` | `av:Rational` | 0..1 | frame/media-timeline-second | node/default | Exact media cadence at the specified boundary: an offered Track states wire cadence; a TrackRequirement evaluates the wire or retained delivered samples as identified by its containing collection. Never infer delivered cadence from wire cadence after queue loss. This is not wall-clock decoder throughput; an arrival/deadline SLA must additionally fix clock/window semantics in a qualified delivery profile. 30000/1001 is not 30; faster-than-real-time clip processing does not alter media cadence. |
| `av:sampleRate` | core | `av:Track` | `integer` | 0..1 | sample/second/channel | integer/default; minimum=1 | Audio sampling frequency per channel; not bytes/second. |
| `av:channels` | core | `av:Track` | `integer` | 0..1 | channel | integer/default; minimum=1 | Number of audio channels; Mono requires one and StereoLR two. |
| `av:channelLayout` | core | `av:Track` | `enum:ChannelLayout` | 0..1 | - | node/default | Audio channel meaning/order, independent of interleaved/planar storage. |
| `av:sampleFormat` | core | `av:Track` | `enum:SampleFormat` | 0..1 | - | node/default | PCM numeric sample representation; separate from codec identity. |
| `av:bufferLayout` | core | `av:Track` | `enum:BufferLayout` | 0..1 | - | node/default | Raw-video Contiguous/Strided or PCM Interleaved/Planar memory layout; applicability is representation-specific. |
| `av:timing` | core | `av:Track`<br>`av:MediaSample` | `av:TimestampMapping`<br>`av:Timestamp` | 0..*<br>0..* | - | node/set | Track mapping descriptions or actual sample timestamps. A description of mapping capability is not observed timing evidence. |
| `av:numerator` | core | `av:Rational` | `integer` | 1..1 | - | integer/default | Signed exact numerator; context requires positivity for rates/time bases and nonnegativity for selectors. Never n, tuple position zero or an anonymous mixed value. |
| `av:denominator` | core | `av:Rational` | `integer` | 1..1 | - | integer/default; minimum=1 | Strictly positive exact denominator, reduced with numerator by gcd. The same Rational shape is used everywhere. |
| `av:processor` | core | `av:Need`<br>`av:ProcessingRun` | `av:Processor`<br>`av:Processor` | 1..1<br>0..1 | - | node/default | Processing service Thing identity, not a loaded model or running instance. |
| `av:input` | core | `av:Need`<br>`av:InputGroup`<br>`av:Preference` | `av:InputRequirement`<br>`av:InputRequirement`<br>`av:InputRequirement` | 1..*<br>2..*<br>1..1 | - | node/set | Named logical inputs of a Need/group or the input addressed by a preference. All group members belong to the same Need. |
| `av:groups` | core | `av:Need` | `av:InputGroup` | 0..* | - | node/set | Disjoint all-or-none groups. A group containing a required member makes all members required; an all-optional group is admitted entirely or omitted. |
| `av:preferences` | core | `av:Need` | `av:Preference` | 0..* | - | node/list | Lexicographically ordered Boolean goals; true before false. Rank only hard-feasible plans, then use stable input/source/mode/plan IDs as a deterministic tie-break. |
| `av:model` | core | `av:Need`<br>`av:Assignment` | `av:InferenceModel`<br>`av:InferenceModel` | 0..1<br>0..1 | - | node/default | Exact InferenceModel identity; its complete manifest/files/profiles are pinned independently of native TD/TM versions. |
| `av:contract` | core | `av:Need`<br>`av:Assignment`<br>`av:Result` | `av:ResultContract`<br>`av:ResultContract`<br>`av:ResultContract` | 0..*<br>0..*<br>1..1 | - | node/set | Declared, accepted or actually used ResultContract identities. Each accepted declared output needs an exact contract pin in the dependency closure. |
| `av:allowedPreprocessing` | core | `av:Need` | `av:DocumentPin` | 0..* | - | node/set | Explicitly permitted exact model-preprocessing profile pins, independent of image delivery transforms. Omission or empty means none permitted; a model declaration does not grant permission. |
| `av:generation` | core | `av:Need`<br>`av:Assignment`<br>`av:AssignmentStatus` | `integer`<br>`integer`<br>`integer` | 1..1<br>1..1<br>1..1 | - | integer/default; minimum=0 | Desired Need generation, repeated exactly by its Assignment and observation. Not a directory epoch, lease renewal sequence or fencing token. |
| `av:presence` | core | `av:InputRequirement`<br>`av:TrackRequirement` | `enum:Presence`<br>`enum:Presence` | 1..1<br>1..1 | - | node/default | Admission obligation. Optional does not relax predicates after inclusion. |
| `av:alternative` | core | `av:InputRequirement`<br>`av:InputSelection` | `av:InputAlternative`<br>`av:InputAlternative` | 1..*<br>1..1 | - | node/set | Complete permitted alternatives on a requirement; exactly one chosen alternative on an InputSelection. |
| `av:wireTracks` | core | `av:InputAlternative` | `av:TrackRequirement` | 0..* | - | node/set | Additional hard constraints at the negotiated source wire boundary, before decode/conversion/queue loss. Logical track names join to deliveredTracks. |
| `av:deliveredTracks` | core | `av:InputAlternative` | `av:TrackRequirement` | 1..* | - | node/set | Hard application-delivery representation requirements. They do not describe tensors or inherit wire cadence as guaranteed delivered FPS. |
| `av:constraints` | core | `av:TrackRequirement`<br>`av:InputAlternative` | `av:IntegerConstraint` OR `av:RationalConstraint` OR `av:ChoiceConstraint`<br>`av:ChoiceConstraint` | 0..*<br>0..* | - | node/set | Conjunctive typed predicates. Track fields use supported integer/rational/choice constraints; an alternative permits only source/host/backend placement ChoiceConstraints. |
| `av:field` | core | `av:IntegerConstraint`<br>`av:RationalConstraint`<br>`av:ChoiceConstraint` | `enum:IntegerField`<br>`enum:RationalField`<br>`enum:ChoiceField` | 1..1<br>1..1<br>1..1 | - | node/default | The supported vocabulary property whose value is constrained. Unlisted fields/scripts/coercions are not a v0.1 matcher extension point. |
| `av:lowerInteger` | core | `av:IntegerConstraint` | `integer` | 0..1 | - | integer/default; minimum=1 | Inclusive lower integer bound, in the fixed units of field. |
| `av:upperInteger` | core | `av:IntegerConstraint` | `integer` | 0..1 | - | integer/default; minimum=1 | Inclusive upper integer bound, in the fixed units of field; must not be below lowerInteger. |
| `av:lowerRational` | core | `av:RationalConstraint` | `av:Rational` | 0..1 | - | node/default | Inclusive lower exact-rational bound, in the fixed units of field. |
| `av:upperRational` | core | `av:RationalConstraint` | `av:Rational` | 0..1 | - | node/default | Inclusive upper exact-rational bound, in the fixed units of field; compare to lowerRational by exact cross multiplication. |
| `av:allowedValues` | core | `av:ChoiceConstraint` | `IRI` | 1..* | - | node/set | Nonempty allowed IRI set for the selected field. Fields with controlled enums restrict values to that enum; host/backend/source/configuration use exact recognized identities/pins. |
| `av:goal` | core | `av:Preference` | `av:TrackRequirement` OR `av:ChoiceConstraint` | 1..1 | - | node/default | A delivered TrackRequirement goal named by dcterms:identifier, or source/backend/host ChoiceConstraint. Omitted tracks and unknown facts score false. |
| `av:captureIntent` | core | `av:InputAlternative` | `enum:CaptureIntent` | 1..1 | - | node/default | Permitted acquisition effect; grants, control Forms, trigger behavior and uncertain outcomes must still be qualified by the pinned acquisition/control profile. |
| `av:transformPermissions` | core | `av:InputAlternative` | `enum:Transform` | 0..* | - | node/set | Explicit operations permitted between wire and delivered media. Omitted/empty permits none; queue discards and model preprocessing are governed separately. |
| `av:selector` | core | `av:Mode`<br>`av:InputAlternative`<br>`av:MediaAsset`<br>`av:MediaSample` | `av:TimeSelector`<br>`av:TimeSelector`<br>`av:TimeSelector`<br>`av:TimeSelector` | 0..1<br>0..1<br>0..1<br>0..1 | - | node/default | Full offered Clip extent on Mode, requested selection on an alternative, or retained/selected-media extent. All values use one named timeline; seeking ability comes only from a recognized configuration. |
| `av:maxAge` | core | `av:InputAlternative` | `av:TimingConstraint` | 0..1 | - | node/default | Hard worst-case media age at its explicit ApplicationIngress/InferenceStart stage, including all mapped clock uncertainty. |
| `av:maxSkew` | core | `av:InputAlternative`<br>`av:InputGroup` | `av:TimingConstraint`<br>`av:TimingConstraint` | 0..1<br>0..1 | - | node/default | Hard worst-case pairwise skew across included tracks or grouped inputs after proven common-domain conversion; compare video time to associated audio first-sample time. |
| `av:queues` | core | `av:InputAlternative` | `av:QueuePolicy` | 0..* | - | node/set | Explicit requested per-stage queue policies. The accepted qualified plan must disclose every queue, including internal buffers and pre-branch sharing, even if Need gives no bound. |
| `av:stage` | core | `av:QueuePolicy`<br>`av:TimingConstraint` | `av:CaptureIngress` OR `av:EncodedBranch` OR `av:DecodedDelivery` OR `av:ModelInput`<br>`av:ApplicationIngress` OR `av:InferenceStart` | 1..1<br>0..1 | - | node/default | Queue boundary or age-evaluation boundary. Not a global drop switch. |
| `av:capacity` | core | `av:QueuePolicy` | `integer` | 1..1 | - | integer/default; minimum=1 | Finite positive number of units buffered at the named queue stage; no unbounded sentinel. |
| `av:unit` | core | `av:QueuePolicy` | `enum:QueueUnit` | 1..1 | - | node/default | Queue capacity unit. Fixed-unit physical terms do not take an arbitrary unit field. |
| `av:overflow` | core | `av:QueuePolicy` | `enum:Overflow` | 1..1 | - | node/default | Required reaction at capacity; BlockUpstream needs proven upstream support or bounded spool. |
| `av:coveragePolicy` | core | `av:QueuePolicy` | `enum:CoveragePolicy` | 1..1 | - | node/default | Coverage obligation beginning at this queue stage through application delivery, separate from artifact/result completion state. |
| `av:gapResponse` | core | `av:QueuePolicy` | `enum:GapResponse` | 0..1 | - | node/default | Failure/reporting obligation when coverage is incomplete; required for NoIntentionalDrop. Report never means complete success. |
| `av:limitMs` | core | `av:TimingConstraint`<br>`av:QueuePolicy` | `number`<br>`number` | 1..1<br>0..1 | millisecond | number/default; minimum=0 | Maximum age/skew for TimingConstraint, or maximum residence at a QueuePolicy stage. Context fixes which bound; no implicit seconds conversion. |
| `av:clock` | core | `av:TimestampMapping`<br>`av:Timestamp`<br>`av:TimeSelector`<br>`av:AssignmentStatus`<br>`av:LeaseGrant` | `IRI`<br>`IRI`<br>`IRI`<br>`IRI`<br>`IRI` | 1..1<br>1..1<br>1..1<br>1..1<br>1..1 | - | node/default | Named clock/timeline origin and incarnation. Matching names, NTP/PTP labels or RTP clocks alone do not prove synchronization. |
| `av:basis` | core | `av:TimestampMapping`<br>`av:Timestamp`<br>`av:TimingConstraint` | `enum:TimeBasis`<br>`enum:TimeBasis`<br>`av:CaptureTime` OR `av:PresentationTime` OR `av:ReceiptTime` | 1..1<br>1..1<br>1..1 | - | node/default | Physical/semantic meaning of time, independent of clock unit or mapping availability. |
| `av:timeBase` | core | `av:TimestampMapping` | `av:Rational` | 1..1 | second/tick | node/default | Exact source tick duration; numerator is positive. Mapping configuration fixes affine offset, anchor, bounded tick intervals, drift uncertainty and resets. |
| `av:referenceClock` | core | `av:TimestampMapping` | `IRI` | 0..1 | - | node/default | Target clock of a qualified bounded mapping. Presence requires matching configuration and uncertaintyMs; absence means no common-domain conversion is asserted. |
| `av:uncertaintyMs` | core | `av:TimestampMapping`<br>`av:Timestamp`<br>`av:AssignmentStatus`<br>`av:LeaseGrant` | `number`<br>`number`<br>`number`<br>`number` | 0..1<br>0..1<br>0..1<br>0..1 | millisecond | number/default; minimum=0 | Conservative error bound. Omission means unknown, not zero; mapping scope/validity must be proved by pinned records. |
| `av:start` | core | `av:TimeSelector` | `av:Rational` | 1..1 | second | node/default | Nonnegative rational start/instant from selector clock origin. |
| `av:end` | core | `av:TimeSelector` | `av:Rational` | 0..1 | second | node/default | Exclusive rational end, strictly greater than start; absent for AtInstant. Bounds must lie within the selected finite extent. |
| `av:selection` | core | `av:TimeSelector` | `enum:SelectorKind` | 1..1 | - | node/default | Exact selector edge/sample semantics. No implied frame-index/FPS conversion, URI fragment support or clip-generation command. |
| `av:toleranceMs` | core | `av:TimeSelector` | `number` | 0..1 | millisecond | number/default; minimum=0 | Maximum permitted excess at each CoveringInterval edge; required only for that selector kind. |
| `av:time` | core | `av:Timestamp` | `av:Rational` | 1..1 | second | node/default | Exact observed rational seconds from the stated clock origin. Raw tick/UTC affine conversion and exposure provenance must be retained as evidence; not a datetime-or-integer union. |
| `av:document` | core | `av:DocumentPin` | `IRI` | 1..1 | - | node/default | Explicit effective retrieval IRI for this exact representation. Distinct from Thing id, Form @id and href; preserve it as the base for native relative targets. Do not silently substitute redirects or latest versions. |
| `av:documentKind` | core | `av:DocumentPin` | `enum:DocumentKind` | 1..1 | - | node/default | Exact provenance/content scope of pinned representation, especially publisher TD versus enriched directory snapshot. |
| `av:hexDigest` | core | `av:DocumentPin` | `string` | 1..1 | - | string/default; pattern=^[0-9a-f]{64}$ | Lowercase SHA-256 of the COMPLETE exact representation octets after HTTP content decoding, before parsing or media decoding; no whitespace normalization, field stripping, JCS or RDF canonicalization. Pin is external to covered document. Integrity is not authenticity. |
| `av:pin` | core | `av:DocumentPin`<br>`av:FormReference`<br>`av:Need`<br>`av:Assignment`<br>`av:AssignmentStatus`<br>`av:MediaAsset`<br>`av:InferenceModel`<br>`av:ResultContract`<br>`av:Result` | `av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin`<br>`av:DocumentPin` | 0..*<br>1..1<br>0..*<br>1..*<br>0..*<br>1..1<br>1..1<br>1..1<br>1..1 | - | node/set | Exact fixed representations: FormReference has one TD pin; DocumentPin lists direct semantic/validation dependencies; Need/Assignment/status close over required records, contexts, profiles and artifacts; MediaAsset/InferenceModel/ResultContract have one recognized typed manifest; Result has its exact payload pin. |
| `av:expectedThing` | core | `av:DocumentPin` | `td:Thing` | 0..1 | - | node/default | Expected native TD id, required for any TD pin used by a FormReference. Anonymous legacy TDs need a separately identified and pinned named adapter snapshot. |
| `av:operation` | core | `av:FormReference` | `enum:NativeOperation` | 1..1 | - | node/default | Exactly one existing native TD operation IRI. Resolve native op/defaults in the pinned Form/affordance and require compatibility; serialize native Form op using its standard lowercase TD token, never this AV property. |
| `av:jsonPointer` | core | `av:FormReference` | `string` | 0..1 | - | string/default; pattern=^(?:/(?:[^~/]&#124;~[01])*)*$ | Optional RFC 6901 JSON Pointer evaluated against the pinned original JSON representation. If present, it must identify the same named native Form as av:form. Not an automatically supported URI fragment. |
| `av:holder` | lifecycle | `av:Assignment`<br>`av:LeaseGrant`<br>`av:ProcessingRun` | `IRI`<br>`IRI`<br>`IRI` | 1..1<br>1..1<br>1..1 | - | node/default | Authorized running processor/worker incarnation identity, not merely a service Thing or model file. |
| `av:selections` | lifecycle | `av:Assignment`<br>`av:InputSelection` | `av:InputSelection`<br>`av:TrackSelection` | 1..*<br>1..* | - | node/set | Accepted mappings: Assignment has InputSelections; each InputSelection has TrackSelections for all included logical tracks. |
| `av:omitted` | lifecycle | `av:Assignment`<br>`av:InputSelection` | `av:InputRequirement`<br>`av:TrackRequirement` | 0..*<br>0..* | - | node/set | Explicit optional omissions, never missing required work. Assignment lists InputRequirement IDs; InputSelection lists omitted wire/delivered TrackRequirement IDs. |
| `av:forms` | lifecycle | `av:InputSelection` | `av:FormReference` | 1..* | - | node/set | Accepted native interaction selections, including source and optional Processor sink legs. Each is a FormReference, not a duplicate target/transport/security object. |
| `av:requirement` | lifecycle | `av:InputSelection`<br>`av:TrackSelection` | `av:InputRequirement`<br>`av:TrackRequirement` | 1..1<br>1..2 | - | node/set | Requirement discharged by a selection. TrackSelection maps one offered track to one wire and/or one delivered requirement of the same logical name, never two from the same boundary. Wire-only filters are allowed; required coverage, optional omissions and boundary applicability are checked by admission. |
| `av:assignment` | lifecycle | `av:AssignmentStatus`<br>`av:ProcessingRun` | `av:Assignment`<br>`av:Assignment` | 1..1<br>1..1 | - | node/default | Exact immutable accepted attempt whose status or actual processing is described. |
| `av:state` | core | `av:Need`<br>`av:AssignmentStatus`<br>`av:ProcessingRun`<br>`av:MediaAsset`<br>`av:Result` | `enum:NeedState`<br>`enum:AssignmentState`<br>`enum:RunState`<br>`av:Complete` OR `av:Partial`<br>`enum:ContentState` | 1..1<br>1..1<br>1..1<br>1..1<br>1..1 | - | node/default | Class-specific lifecycle or content state, always an IRI. No direct inference to Condition truth or currentness follows from it. |
| `av:incarnation` | lifecycle | `av:AssignmentStatus`<br>`av:MediaSample` | `IRI`<br>`IRI` | 1..1<br>0..1 | - | node/default | Observer process or media stream incarnation defining sequence/timestamp scope. Restart/discontinuity requires a new identity; old sequences cannot overwrite current evidence. |
| `av:sequence` | lifecycle | `av:AssignmentStatus`<br>`av:MediaSample`<br>`av:LeaseGrant` | `integer`<br>`integer`<br>`integer` | 1..1<br>0..1<br>1..1 | - | integer/default; minimum=0 | Nonnegative ordinal within its explicit scope: observer-incarnation/Assignment observations, stream media units, or lease-series renewals. Not a global cursor, packet sequence or fencing token. |
| `av:observedAt` | lifecycle | `av:AssignmentStatus` | `dateTime` | 1..1 | - | dateTime/default | Timestamp when status was observed, with explicit timezone and observation clock. Record publication time may differ. |
| `av:validFrom` | lifecycle | `av:LeaseGrant` | `dateTime` | 1..1 | - | dateTime/default | Inclusive grant start on the authority's named, uncertainty-bounded clock. |
| `av:validUntil` | lifecycle | `av:AssignmentStatus`<br>`av:LeaseGrant` | `dateTime`<br>`dateTime` | 1..1<br>1..1 | - | dateTime/default | Exclusive freshness/expiry boundary. Status uses [observedAt,validUntil); grant uses [validFrom,validUntil), subject to earlier revocation. |
| `av:lease` | lifecycle | `av:Assignment`<br>`av:AssignmentStatus`<br>`av:ProcessingRun` | `av:LeaseGrant`<br>`av:LeaseGrant`<br>`av:LeaseGrant` | 1..*<br>1..*<br>1..* | - | node/set | Externally enforced grant revisions: initial revisions on Assignment, observed currently applicable revisions on status, effect-checked revisions on a run. Renewals do not rewrite prior facts. |
| `av:conditions` | lifecycle | `av:AssignmentStatus` | `av:Condition` | 4..4 | - | node/set | Exactly one of each of the four distinct Condition names; cardinality alone does not prove their uniqueness or truth. |
| `av:condition` | lifecycle | `av:Condition` | `enum:ConditionName` | 1..1 | - | node/default | Which distinct condition is claimed: media observed, application ready, model loaded, or result committed. |
| `av:conditionState` | lifecycle | `av:Condition` | `enum:TruthState` | 1..1 | - | node/default | Explicit True/False/Unknown/NotApplicable IRI, never JSON false as an unknown sentinel. True requires evidence; false is an actual negative assessment. |
| `av:evidence` | lifecycle | `av:Condition`<br>`av:Fault`<br>`av:Timestamp`<br>`av:Result` | `IRI`<br>`IRI`<br>`IRI`<br>`av:DocumentPin` | 0..*<br>0..*<br>1..*<br>1..1 | - | node/set | Identified support for a claim/fault/timestamp; Result requires a pin of an authenticated durable receipt identifying result, payload digest, contract, run, checked grants and commit scope. Evidence identities are not self-authenticating. |
| `av:authority` | lifecycle | `av:LeaseGrant` | `IRI` | 1..1 | - | node/default | External grant enforcer identity. Only its current state and per-effect fencing checks confer authority. |
| `av:scope` | lifecycle | `av:LeaseGrant` | `IRI` | 1..1 | - | node/default | One authority-defined fencing/effect domain. Multi-scope assignments require independent current grants, not implied distributed atomicity. |
| `av:fence` | lifecycle | `av:LeaseGrant` | `integer` | 1..1 | - | integer/default; minimum=0 | Monotonic ownership epoch within one authority/scope. Renewal preserves it; reassignment advances it. Do not compare unrelated scopes or assume a fence can recall an issued trigger. |
| `av:issues` | lifecycle | `av:AssignmentStatus`<br>`av:ProcessingRun`<br>`av:Result` | `av:Fault`<br>`av:Fault`<br>`av:Fault` | 0..*<br>0..*<br>0..* | - | node/set | Explicit structured problems. A failed/degraded/draining cleanup or incomplete/error result cannot masquerade as successful empty output. |
| `av:code` | lifecycle | `av:Fault` | `enum:FaultCode` | 1..1 | - | node/default | Stable failure IRI from the closed v0.1 failure vocabulary; the control profile fixes action outcomes and retryability. |
| `av:committedAt` | provenance | `av:Result` | `dateTime` | 1..1 | - | dateTime/default | Durable commitment time established by the authenticated receipt, not capture, computation completion, delivery or subscriber acknowledgment. |
| `dcterms:identifier` | external reuse | `av:InputRequirement`<br>`av:TrackRequirement`<br>`av:Track`<br>`av:Result` | `string`<br>`string`<br>`string`<br>`string` | 1..1<br>1..1<br>1..1<br>1..1 | - | string/default | A stable local identifier: input/track logical name, track label, or a Result output slot. It supplements rather than replaces absolute @id. |
| `dcterms:isVersionOf` | external reuse | `av:Need`<br>`av:LeaseGrant`<br>`av:InferenceModel`<br>`av:ResultContract`<br>`av:MediaAsset` | `IRI`<br>`IRI`<br>`IRI`<br>`IRI`<br>`IRI` | 1..1<br>1..1<br>0..1<br>0..1<br>0..1 | - | node/default | Logical Need or lease-series identity; model/contract/artifact version lineage where known. |
| `dcterms:format` | external reuse | `av:DocumentPin` | `string` | 1..1 | - | string/default | Media type of pinned representation; do not replace native Form contentType. |
| `dcterms:conformsTo` | external reuse | `av:DocumentPin` | `IRI` | 0..* | - | node/set | Established profile/standard claimed for a pinned content representation. Claim is not validation evidence; the corresponding standard's bytes/dependencies must be pinned. |
| `dcterms:description` | external reuse | `av:Fault`<br>`prov:Entity` | `string`<br>`string` | 1..1<br>0..* | - | string/default | Non-secret human explanation. Fault evidence/profile supplies machine-readable candidate/path/required/actual facts. |
| `dcterms:title` | external reuse | `prov:Entity` | `string` | 0..* | - | string/default | Optional title on domain artifacts; retain native title on Things. |
| `dcterms:creator` | external reuse | `prov:Entity` | `IRI` | 0..* | - | node/set | Identified creator; no new AV metadata alias. |
| `dcterms:publisher` | external reuse | `prov:Entity` | `IRI` | 0..* | - | node/set | Identified publisher, not authorization. |
| `dcterms:license` | external reuse | `prov:Entity` | `IRI` | 0..* | - | node/set | License document identity; distinct from access grants/security. |
| `dcterms:references` | external reuse | `prov:Entity` | `IRI` | 0..* | - | node/set | Supplemental references, not substitutes for required content pins or access Forms. |
| `prov:used` | external reuse | `av:ProcessingRun` | `prov:Entity` | 1..* | - | node/set | Actual consumed samples/assets/model/configuration entities; not planned use in an unstarted Assignment. |
| `prov:wasGeneratedBy` | external reuse | `av:Result`<br>`av:MediaAsset`<br>`av:InferenceModel` | `av:ProcessingRun`<br>`prov:Activity`<br>`prov:Activity` | 1..1<br>0..1<br>0..1 | - | node/default | Actual generating execution; not an accepted plan. |
| `prov:wasDerivedFrom` | external reuse | `av:MediaSample`<br>`av:Result`<br>`av:MediaAsset`<br>`av:InferenceModel` | `av:MediaAsset`<br>`prov:Entity`<br>`prov:Entity`<br>`prov:Entity` | 0..1<br>0..*<br>0..*<br>0..* | - | node/set | Actual derivation. A retained-asset MediaSample names its source asset here; a live sample uses source/incarnation/track/sequence instead. |
| `prov:wasAssociatedWith` | external reuse | `av:ProcessingRun` | `prov:Agent` | 1..* | - | node/set | Responsible actual execution Agent(s); software instances may be SoftwareAgents, but learned weights are not Agents. |
| `prov:wasAttributedTo` | external reuse | `av:Assignment`<br>`av:AssignmentStatus`<br>`prov:Entity` | `prov:Agent`<br>`prov:Agent`<br>`prov:Agent` | 1..1<br>1..1<br>0..* | - | node/set | Responsible Agent for an immutable record. Assignment requires its authorized controller agent; status requires the authorized observer agent. A Thing is not thereby the same as its agent. |
| `prov:startedAtTime` | external reuse | `av:ProcessingRun` | `dateTime` | 0..1 | - | dateTime/default | Actual activity start, when known, with timezone; processing is not capture. |
| `prov:endedAtTime` | external reuse | `av:ProcessingRun` | `dateTime` | 0..1 | - | dateTime/default | Actual activity end, when known; computational success is not commitment. |

## Controlled IRI glossary
| Set label | Complete members and meanings |
|---|---|
| `MediaKind` | `av:Live`: Unbounded live media; no invented zero duration.<br>`av:Still`: An image-shaped acquisition/access, not necessarily a new exposure.<br>`av:Clip`: Finite media with a named timeline and full offered extent. |
| `MediaDirection` | `av:ToThing`: Media enters the addressed Thing; xRegistry client-relative usage is producer.<br>`av:FromThing`: Media leaves the addressed Thing; xRegistry client-relative usage is consumer. |
| `Locality` | `av:HostLocal`: Access requires the declared host and native runtime.<br>`av:Network`: Access uses a network binding; reachability is still separately proven. |
| `Representation` | `av:EncodedVideo`: Codec-encoded video/image data, distinct from decoded pixels.<br>`av:RawVideo`: Unencoded image pixels with a fixed format and memory layout.<br>`av:EncodedAudio`: Codec-encoded audio, distinct from decoded samples.<br>`av:PCM`: Uncompressed audio samples with explicit sample and buffer formats. |
| `Codec` | `av:H264`: ITU-T H.264/AVC family; profile, level and other decoder parameters require the pinned configuration.<br>`av:JPEG`: JPEG-coded image data; exact coding variant belongs to the pinned configuration.<br>`av:AAC`: AAC family; object type/configuration is required by the pinned decoder configuration.<br>`av:H265`: ITU-T H.265 / ISO/IEC 23008-2 High Efficiency Video Coding (HEVC) bitstream family, used with EncodedVideo. The exact standard edition, profile, tier, level, compatibility/constraint flags and VPS/SPS/PPS initialization belong to a recognized pinned codec configuration. This is not H.264, a container, RTP packetization or a WebRTC capability claim; the family IRI alone implies no encoding or decoding support.<br>`av:Opus`: IETF Opus interactive speech and audio coding family defined by RFC 6716, used with EncodedAudio. The exact codec configuration, channel semantics, sampling, framing and negotiated transport parameters belong to recognized pinned codec/binding profiles. This is not PCM, a container or RTP packetization; the family IRI alone implies no encoding, decoding or WebRTC implementation support. |
| `PixelFormat` | `av:BGR8`: uint8 B,G,R component order; HWC logical geometry; three bytes per pixel.<br>`av:RGB8`: uint8 R,G,B component order; HWC logical geometry; three bytes per pixel.<br>`av:Mono8`: One uint8 intensity component per pixel.<br>`av:YUV420P`: 8-bit planar Y then U then V, 4:2:0 sampling; exact colorimetry and strides require configuration. |
| `Cadence` | `av:Constant`: Exact constant media cadence, requiring frameRate.<br>`av:Variable`: Variable media cadence; no exact frameRate is implied.<br>`av:Triggered`: Event/trigger-determined cadence, not a constant rate. |
| `ChannelLayout` | `av:Mono`: One audio channel.<br>`av:StereoLR`: Two ordered audio channels: left, then right. |
| `SampleFormat` | `av:S16LE`: Signed 16-bit little-endian PCM samples.<br>`av:F32LE`: IEEE 754 binary32 little-endian PCM samples. |
| `BufferLayout` | `av:Contiguous`: No inter-row gaps for packed raw images; detailed plane layout remains fixed by pixel format.<br>`av:Strided`: Explicit image plane/row strides are supplied by the qualified configuration.<br>`av:Interleaved`: Audio channel samples alternate within each sample frame.<br>`av:Planar`: Each audio channel occupies its own plane. |
| `Presence` | `av:Required`: Must be admitted and satisfied.<br>`av:Optional`: May be explicitly omitted; if admitted, all its constraints remain hard. |
| `CaptureIntent` | `av:Observe`: No trigger or acquisition-configuration mutation is authorized.<br>`av:RequestCapture`: The selected plan needs authority to request acquisition without changing the selected configuration.<br>`av:ConfigureAndCapture`: The selected plan needs explicit authority for both the exact configuration and acquisition. |
| `Transform` | `av:Decode`: Decode an encoded representation.<br>`av:ColorConvert`: Convert pixel/channel color representation, with qualified colorimetry.<br>`av:ResizeStretch`: Resize without aspect preservation; the profile fixes interpolation and rounding.<br>`av:ResizeCrop`: Aspect-preserving resize/crop with a pinned crop rule.<br>`av:ResizeLetterbox`: Aspect-preserving resize/pad with pinned padding, interpolation and rounding.<br>`av:ResampleAudio`: Change audio sample rate.<br>`av:RemixAudio`: Change audio channels/layout.<br>`av:TemporalSubsample`: Intentionally select fewer media samples; not queue overflow.<br>`av:DuplicateFrames`: Synthesize repeated video frames; cannot be inferred from a rate request.<br>`av:PrerollDecode`: Decode/discard prerequisite samples before the selected interval. |
| `Stage` | `av:CaptureIngress`: First captured/acquired units before branch selection.<br>`av:EncodedBranch`: Encoded-media branch after acquisition.<br>`av:DecodedDelivery`: Decoded media immediately before application delivery.<br>`av:ModelInput`: Model tensor/input queue.<br>`av:ApplicationIngress`: The application receipt boundary for age evaluation.<br>`av:InferenceStart`: The beginning of processing/inference for age evaluation. |
| `QueueUnit` | `av:Frame`: One video media unit.<br>`av:Bundle`: One synchronized group of video units and associated audio blocks.<br>`av:Packet`: One binding-defined encoded packet, not a decoded frame.<br>`av:Byte`: One octet of buffered content. |
| `Overflow` | `av:DropOldest`: Discard the oldest queued unit at this stage.<br>`av:DropNewest`: Discard the incoming unit at this stage.<br>`av:BlockUpstream`: Backpressure only where a qualified upstream can pause or bounded spool proves feasibility.<br>`av:Fail`: Report failure rather than silently continue. |
| `CoveragePolicy` | `av:BestEffort`: Declared drops may occur; no completeness guarantee.<br>`av:NoIntentionalDrop`: No planned discard from the named stage through application delivery; not a promise against sensor/network loss. |
| `GapResponse` | `av:Report`: Report incomplete coverage explicitly; not complete success.<br>`av:Fail`: Fail the affected completeness obligation. |
| `TimeBasis` | `av:CaptureTime`: Video exposure midpoint, or first audio sample time, when qualified as such.<br>`av:PresentationTime`: Media presentation timestamp semantics, not automatically UTC.<br>`av:ReceiptTime`: Time observed at the identified receiver.<br>`av:ProcessingTime`: Time at the identified processing boundary.<br>`av:CommitTime`: Durable result-commit time, not capture time. |
| `SelectorKind` | `av:AtInstant`: One timestamp-selected sample according to the pinned selector profile; end is absent.<br>`av:ExactSamples`: Samples whose presentation timestamps lie in [start,end), including audio-sample trimming.<br>`av:CoveringInterval`: May include at most toleranceMs extra media at either edge; no internal omission is authorized. |
| `Sharing` | `av:Exclusive`: No concurrent conflicting allocation in this resource scope.<br>`av:SameConfiguration`: Share only when complete configuration pins identify identical configuration content under the same recognized profile. |
| `DocumentKind` | `av:PublisherTD`: Exact publisher TD representation; no directory enrichment is silently removed.<br>`av:DirectorySnapshot`: Exact directory-enriched snapshot, including registration fields and directory-assigned identity.<br>`av:ContextDocument`: A JSON-LD context representation used for semantic interpretation.<br>`av:OntologyDocument`: A vocabulary/ontology representation used for interpretation.<br>`av:ShapeDocument`: A shape/schema validation representation.<br>`av:ProfileDocument`: A recognized versioned operational/configuration profile or specification.<br>`av:DomainDocument`: A Need, Assignment, status, grant or other domain-record representation.<br>`av:ManifestDocument`: A typed media/model/result-contract manifest.<br>`av:PayloadDocument`: A particular result payload representation.<br>`av:ReceiptDocument`: An authenticated durable commitment receipt representation.<br>`av:ArtifactFile`: A complete artifact file representation, after HTTP content decoding but before media decoding. |
| `NeedState` | `av:Active`: Desired intent is active, subject to its authoritative current head.<br>`av:Withdrawn`: This immutable revision records withdrawal; no new work is authorized. |
| `AssignmentState` | `av:Accepted`: Admission succeeded, not readiness.<br>`av:Applying`: Applying the accepted configuration/plan.<br>`av:Ready`: Application-ready is true; required model processing additionally needs model-loaded true.<br>`av:Degraded`: One or more current execution obligations are not met.<br>`av:Failed`: The attempt failed; recovery requires a new Assignment.<br>`av:Draining`: Owned work is being withdrawn/cleaned up; not proof of cleanup.<br>`av:Released`: Authoritative scoped cleanup is evidenced; terminal for this Assignment. |
| `RunState` | `av:Running`: Actual execution is in progress.<br>`av:Succeeded`: Computation completed successfully, not necessarily result commitment.<br>`av:Failed`: Execution failed.<br>`av:Canceled`: Execution was canceled.<br>`av:Uncertain`: An effect may have happened; reconcile rather than blindly repeat. |
| `ContentState` | `av:Complete`: The declared content/coverage obligation is complete, including a valid empty detection set.<br>`av:Partial`: Finalized content is incomplete and has explicit gaps/issues.<br>`av:Error`: A result reports failure rather than successful empty content. |
| `ConditionName` | `av:MediaObserved`: Selected media samples have actually been observed.<br>`av:ApplicationReady`: All required delivered-media predicates have been qualified.<br>`av:ModelLoaded`: The exact accepted model/files/execution configuration are loaded by the identified processor incarnation.<br>`av:ResultCommitted`: At least one output under an accepted contract has an identified durable commitment receipt; not all-work-complete. |
| `TruthState` | `av:True`: Positive claim supported by identified evidence.<br>`av:False`: Evidence establishes the claim does not hold; not merely absent information.<br>`av:Unknown`: The claim has not been established either way.<br>`av:NotApplicable`: The obligation is explicitly absent; only allowed by the class-specific lifecycle contract. |
| `IntegerField` | `av:width`<br>`av:height`<br>`av:sampleRate`<br>`av:channels` |
| `RationalField` | `av:frameRate` |
| `ChoiceField` | `av:codec`<br>`av:pixelFormat`<br>`av:cadence`<br>`av:sampleFormat`<br>`av:channelLayout`<br>`av:bufferLayout`<br>`av:host`<br>`av:backend`<br>`av:source`<br>`av:configuration` |
| `NativeOperation` | `td:readProperty`<br>`td:writeProperty`<br>`td:observeProperty`<br>`td:unobserveProperty`<br>`td:readAllProperties`<br>`td:writeAllProperties`<br>`td:readMultipleProperties`<br>`td:writeMultipleProperties`<br>`td:observeAllProperties`<br>`td:unobserveAllProperties`<br>`td:invokeAction`<br>`td:queryAction`<br>`td:cancelAction`<br>`td:queryAllActions`<br>`td:subscribeEvent`<br>`td:unsubscribeEvent`<br>`td:subscribeAllEvents`<br>`td:unsubscribeAllEvents` |
| `FaultCode` | `av:InvalidContract`: Invalid syntax, structure, identifier or conditional contract.<br>`av:UnknownRequiredFact`: Required evidence is unavailable or unknown.<br>`av:UnsupportedProfile`: A required binding, configuration or validation profile is not recognized.<br>`av:NoJointMode`: No single jointly supported Mode satisfies the alternative.<br>`av:MissingTrack`: A required logical track cannot be selected.<br>`av:BackendTrackUnsupported`: The chosen adapter cannot deliver the required track.<br>`av:UnreachablePlacement`: Host/runtime/reachability constraints fail.<br>`av:CaptureAuthorityRequired`: Acquisition/configuration authority is not established.<br>`av:SharedConfigurationConflict`: A shared resource has an incompatible complete configuration.<br>`av:CapacityExceeded`: Qualified bounded capacity is insufficient.<br>`av:TransformForbidden`: The needed operation/preprocessing was not explicitly authorized.<br>`av:ClockUnqualified`: The required time basis or common-clock mapping is unqualified.<br>`av:AgeBudgetUnproven`: The worst-case age budget cannot be proved.<br>`av:SkewBudgetUnproven`: The worst-case pairwise skew budget cannot be proved.<br>`av:RangeUnavailable`: The requested finite interval is not available.<br>`av:SeekSemanticsUnsupported`: The selector cannot be implemented with the required boundary semantics.<br>`av:QueuePolicyConflict`: Queue, overflow, branch-isolation or coverage constraints conflict.<br>`av:RevisionConflict`: The expected logical Need generation/current head differs.<br>`av:IdempotencyConflict`: The same scoped client key was reused with different canonical input.<br>`av:NoFeasibleAssignment`: No complete accepted mapping is feasible.<br>`av:DependencyUnavailable`: An exact pinned dependency cannot be retrieved.<br>`av:IntegrityMismatch`: Pinned content or immutable identity has conflicting bytes.<br>`av:Unauthorized`: Required authorization is absent.<br>`av:LeaseExpired`: The applicable enforced grant expired.<br>`av:LeaseRevoked`: The applicable enforced grant was revoked.<br>`av:StaleObservation`: The observation is stale, superseded or belongs to an obsolete incarnation.<br>`av:ContractMismatch`: Output, model or negotiated media violates the accepted contract.<br>`av:ClockUncertain`: Clock uncertainty prevents a currentness/validity decision.<br>`av:OutcomeUncertain`: An externally visible effect has an uncertain outcome.<br>`av:ResultCommitFailed`: Computation/delivery did not produce a valid durable receipt.<br>`av:ReleaseIncomplete`: Cleanup of this Assignment's owned scope is not established. |

## Required pinned-profile contracts
| Profile IRI | Document kind; profile-owned labels | Complete required meaning |
|---|---|---|
| `https://example.org/wot/av/profile/acquisition/v0.1` | `av:ProfileDocument`; Continuous: Continuous acquisition without per-frame consumer commands.; FreeRun: Acquisition proceeds from the device's own timing rather than a software or external-line trigger. | Complete capture behavior (continuous, single, finite burst, playback), trigger source/owner, capture owner, exact configuration/resource identities, supported authorized capture intents, named control FormReferences and uncertain-effect rules. Native device selectors, driver/options, privilege and transport parameters remain exclusively in pinned native Forms/binding definitions. For clips include timeline origin, full extent, sequential/restart/keyframe seek behavior and exact versus covering sample-selection qualification. Still must specify latest-existing versus new exposure. |
| `https://example.org/wot/av/profile/adapter-plan/v0.1` | `av:ProfileDocument` | Finite recognized adapter implementation/version and host/backend; selected native source/sink Forms and identified media legs; exact wire/delivered signatures per TrackSelection; ordered transformations with every numeric/color/layout parameter; all public/internal bounded queues, pre-split topology, pause/spool qualifications, coverage obligations; resource costs, timing/clock records, provenance of measured qualification and its validity interval. A list of protocol/codec names is not qualification. |
| `https://example.org/wot/av/profile/clock-map/v0.1` | `av:ProfileDocument` | Incarnation-specific source/reference clock identities and origins; original tick evidence; exact seconds-per-tick Rational, anchor tick and reference-origin Rational seconds; half-open valid tick interval; conservative uncertaintyMs including drift over that interval; capture/PTS/receipt basis provenance. referenceSeconds=(tick-anchorTick)*timeBase+anchorReferenceSeconds. No extrapolation after wrap/reset or beyond validity; UTC anchors need explicit timezone, authority and uncertainty. |
| `https://example.org/wot/av/profile/resource-config/v0.1` | `av:ProfileDocument` | The entire shared resource state relevant to simultaneous acquisition, including all profile-owned control parameters and their units, authority/scope, and compatible allocations. Configuration equivalence compares recognized profile identity plus exact content pin; missing fields or subset overlap never prove equality. |
| `https://example.org/wot/av/profile/codec-layout/v0.1` | `av:ProfileDocument` | Codec profile/level/object type and all decoder initialization data; raw bit depth, color matrix/range/chroma siting, plane offsets/strides, alignment/memory kind and mapping of native PFNC/driver formats to the exact AV representation. Unsupported, undisclosed or unknown required parameters prevent hard matching. |
| `https://example.org/wot/av/profile/media-manifest/v0.1` | `av:ManifestDocument` | Sealed still/clip identity, complete/partial state, every file with safe relative path, media type, byte length and complete exact-octet SHA-256; authorized access through named pinned Forms, not Offer URLs; finite clip timeline/extent and explicit gap selectors; source derivation; declared retention deadline and enforcing authority. A still is complete, not a zero-duration clip. Deleting description, grants and bytes are distinct external operations. |
| `https://example.org/wot/av/profile/model-manifest/v0.1` | `av:ManifestDocument` | Model format/dialect and entry file; all files independently pinned with safe relative paths, lengths and exact-octet hashes; external-data file/offset/length mappings with range checks; ordered tensor names, dtypes, dimensions and equality-scoped symbols/unknowns, layouts/channel order; exact ordered preprocessing, resize/pad/interpolation/rounding/normalization and inverse geometry; postprocessing decoding/suppression/threshold rules, label mapping and runtime/configuration requirements. ONNX additionally requires independent IR/opset/domain versions. Pre/post/label/runtime documents are separately pinned. Managed-provider nondisclosure remains unknown and cannot satisfy a local-model pin. |
| `https://example.org/wot/av/profile/result-contract/v0.1` | `av:ManifestDocument` | Exact payload schema pin and schema-language/dialect IRI; payload representation media type; message semantic type; exact payload location (including an explicit JSON Pointer into an envelope if applicable); named pinned native delivery/replay FormReferences; coverage/completion/gap/error and durable commitment rules; output-slot identity/deduplication and effect scope. Detection and transcript/indexing contracts remain different: empty detections may be complete, errors are not empty success. Optional CloudEvents preserves its standard envelope, pins v1.0.2, places JSON-LD only in data, and defines source+id retransmission stability/time as result availability. Optional xRegistry message pins are descriptions, not execution instructions. |
| `https://example.org/wot/av/profile/run-config/v0.1` | `av:ProfileDocument` | Actual loaded model/manifest/file pins or explicitly identified managed-provider configuration, exact pre/post/runtime pins, processor incarnation, accepted adapter/selection pins, all grant checks, processing clock and uncertainty, input/output slot mapping, and execution/commit responsibility. Do not assert PROV use/generation for unstarted intentions. |
| `https://example.org/wot/av/profile/control/v0.1` | `av:ProfileDocument` | An explicit mapping from versioned submit/release/renew/status/result semantic identifiers to named native affordance/FormReferences, standard operations and exact input/output/event/property schemas; authenticated principal+stable-controller+action scoped client key and RFC8785/JCS SHA-256 request fingerprint, same-key/different-input conflict, durable receipt-before-ack and replay horizon; compare-current expected generation/grant; accepted/proposed/rejected/pending/uncertain outcomes with exact alternatives/issues; opaque scoped access-grant references without bearer secrets; grant authority, revocation and per-effect fencing; release/drain/cleanup evidence and no implicit grace period or trigger retry. The profile defines every envelope field, controlled IRI, schema dialect and payload location. These controller-envelope keys are not TD vocabulary or new AV operation values. |
| `https://example.org/wot/av/profile/commit-receipt/v0.1` | `av:ReceiptDocument` | Authenticated durable receipt naming Result identity, Assignment, ProcessingRun, exact ResultContract pin, output slot, full payload document pin, effect authority/scope, checked grant revisions and committedAt clock/uncertainty. Integrity or event IDs alone do not provide exactly-once effects. Same result identity=(assignment,run,contract-pin,output-slot) with different bytes is an integrity conflict. |

## Modules

### Core

Additive TD annotation, complete offers, requirements, matching values, timing, and immutable reference machinery.

### Lifecycle

Optional for descriptive-only publishers; required when claiming accepted assignments, observed status, or grants.

### Provenance

Optional unless retained media, learned-model loading, declared results, or processing provenance are in scope.

## Conventions

### Inventory authority

This file is the sole authored term source for the generated JSON-LD context, RDFS vocabulary and structural shapes. Uses list exact per-class domain, value range and profile cardinality; domains are alternatives, never conjunctive global RDFS axioms.

### Ranges

IRI means an absolute resource IRI; av:Class means a node of that class; enum:Name is the explicitly enumerated IRI set below; integer means xsd:integer; number means a finite xsd:integer, xsd:decimal or xsd:double; string means xsd:string; dateTime means xsd:dateTime with an explicit timezone.

### Cardinality

min/max count RDF values unless container=list, when they count list items. null max is unbounded. JSON admission additionally enforces member presence, arrays, unique IDs and names, closed AV keys and conditional rules; RDF open-world inference does not.

### Numbers

Emit integer fields as native JSON integer tokens without decimal points/exponents, up to 9007199254740991 in magnitude. Larger exact integers require an explicit @value decimal-digit string and full xsd:integer @type. No coercion of numeric strings. Rational numerators/denominators are reduced by gcd, denominator positive. Every ms-valued number is finite and nonnegative. This integer-token profile avoids the observed PyLD 3.1.0 conversion of an integral Python float such as 30.0 to xsd:double, rather than the JSON-LD API specification's value-based integer conversion.

### Nodes

Every durable class marked identity=iri requires an absolute @id. Offer, Mode, Track, InputRequirement, InputAlternative and TrackRequirement IDs are stable within their pinned revision. Native Forms additionally require an absolute @id under this profile, not under TD core.

### Collections

Set collections are unordered; only preferences are ordered lists. A set context does not check uniqueness. JSON-only admission must preserve empty lists and explicit optional omissions even where RDF lacks a corresponding triple.

### External terms

External properties are reused directly with class-specific profile requirements in external_properties. No new DataSchema alias, generic endpoint, import, equivalence, or namespace-wide closure is defined.

### Property reuse

Singular RDF predicates such as av:offer, av:mode, av:track, av:input and av:contract are reused with explicit class-specific cardinalities. av:form always identifies a native Form; av:forms contains FormReference selections. av:configuration always points to one complete, typed, pinned configuration document, whose exact profile depends on the subject class.

## Native form rules

### Scope

Native generic and control-only Forms do not require AV media annotations. A binding annotation alone must not be interpreted as media flow.

### Media form required

```json
[
  "av:mediaDirection",
  "av:locality",
  "av:binding"
]
```

### Media form identity

Any media Form selected by a Mode or Processor sink contract has an absolute native @id, one unambiguous directed media leg and the required media annotations. Control-only Forms selected by FormReference also require named identity but not a fictitious media direction.

### Multi leg

For multi-leg signaling, the binding must expose an unambiguous directed media access/leg in the selected native Form description and pinned adapter contract without inventing TD operations. Unsupported or ambiguous bidirectional access is not admitted by the v0.1 core. Do not label an arbitrary signaling/control transaction FromThing/ToThing merely from request direction.

### Shape scope

MediaFormShape is automatically targeted only by an explicit av:mediaDirection annotation and may also be invoked by a resolved-media validation profile. Missing annotations on selected external Forms require separate reference/admission checks.

## Admission rules

### Missing information

Omitted advertised facts are unknown. Missing hard evidence rejects feasibility; missing preference evidence scores false. Omitted bounds impose no constraint; empty ChoiceConstraint sets are invalid. Empty transform/preprocessing permission sets authorize nothing.

### Track join

TrackRequirement dcterms:identifier is unique within each wire/delivered boundary of one InputAlternative. Equal identifiers across the two boundaries describe one logical track with separate representation requirements. Every required boundary requirement must occur in exactly one TrackSelection; each selection has at most one requirement from each boundary. Required tracks share one jointly feasible Mode and qualified path. Including a delivered track also includes its same-name declared wire filter, whose predicates remain hard even if its presence is Optional. A wire-only selected filter does not force inclusion of an optional delivered track.

### Groups

InputGroup members are distinct InputRequirements of this Need and groups are disjoint. A required group member makes all members required; an all-optional group is wholly admitted or omitted. Synchronization covers all admitted tracks in the group. This is atomic admission, not transactional device control.

### Ranking

Hard constraints first. Order surviving complete plans by the lexicographic Boolean vector of preferences, true before false; omitted tracks score false. Tie-break by stable input/source/mode/configuration identities. Alternatives and native Form arrays have no implicit preference order.

### Configuration equality

SameConfiguration compares the exact snapshot and recognized profile: effective document IRI/base, document kind, media type, whole-octet SHA-256, expected Thing identity where applicable, conformance-profile identities, and the complete context/profile/schema dependency closure including its edges. Local pin IDs are lookup keys, not equivalence evidence. Different interpretations of identical document bytes are not interchangeable. Do not compare only subsets, overlapping options, directory epochs or a version label; grants/authorization are checked separately.

### Qualified profiles

Pins are references to recognized, versioned contracts with exact fields, schema/dialect, units and semantics, not escape-hatch JSON blobs. The profile contracts enumerate obligations here; deployers must publish and pin executable profile schemas and actual qualifications before accepting their instances. Synthetic fixture profiles do not discharge those obligations.

### Empty acceptance

An accepted media Assignment has at least one selected input and all required inputs/tracks. A Need with only optional inputs may remain unmatched when all are omitted; v0.1 does not fabricate an empty accepted media assignment.

## Lifecycle rules

### Transitions

```json
{
  "av:Accepted": [
    "av:Applying",
    "av:Draining"
  ],
  "av:Applying": [
    "av:Ready",
    "av:Degraded",
    "av:Failed",
    "av:Draining"
  ],
  "av:Ready": [
    "av:Degraded",
    "av:Failed",
    "av:Draining"
  ],
  "av:Degraded": [
    "av:Applying",
    "av:Ready",
    "av:Failed",
    "av:Draining"
  ],
  "av:Failed": [
    "av:Draining"
  ],
  "av:Draining": [
    "av:Released"
  ],
  "av:Released": []
}
```

### Currentness

An authorized active external head must select this exact Need revision and Assignment; generations must agree; exact dependencies and evidence must match; observer Agent/incarnation must be authorized; sequence must be the latest accepted within that scope; the entire uncertain current-time interval must lie within freshness and all applicable grants. Every grant must be the externally current revision in its authority/scope with the accepted series/holder/fence. Missing proof is unknown, not current. Historical facts never resurrect withdrawn work.

### Condition truth

Exactly one MediaObserved, ApplicationReady, ModelLoaded and ResultCommitted claim is present. True needs identified support. False is an actual negative assessment, not absent data. NotApplicable is allowed for ModelLoaded only when no pinned-model loading obligation exists, and for ResultCommitted only when no result obligation exists; it does not assert that an undisclosed managed provider uses no ML.

### Readiness

Ready requires ApplicationReady True. Starting model-dependent processing additionally requires ModelLoaded True for the exact accepted model/configuration/holder. Readiness does not entail media observation, model loading, result commitment or currentness without their separate evidence and checks.

### Renewal

A grant renewal has a new @id and higher sequence within dcterms:isVersionOf series, preserving authority/scope/holder/fence. Reassignment uses a new Assignment and a higher fence in each affected authority/scope. Renewal does not modify a Need, Assignment, past observation, artifact retention or freshness.

### Release

Release compares the current head, withdraws new work and drains only this Assignment's owned scopes. No post-expiry/revocation trigger/commit grace is implied. Shared capture persists for other obligations. Released requires authoritative cleanup evidence; cleanup failure remains Draining with issues. Old cleanup cannot reset a replacement owner.

### Uncertain effects

Fencing does not recall an issued physical trigger. An ambiguous timeout is an uncertain outcome requiring readback/reconciliation, not a blind repeat. An idempotency key or CloudEvents id alone gives neither device atomicity nor exactly-once subscriber effects.

## Shape coverage

### Graph boundary

A finite supplied graph of the records under review plus their explicitly included resolved descriptions. No network dereferencing, OWL imports or inference is required. Target each AV class explicitly; nested sh:node checks do not depend on superclass triples existing only in a shapes graph.

### Closed shapes

```json
[
  "Rational",
  "IntegerConstraint",
  "RationalConstraint",
  "ChoiceConstraint",
  "QueuePolicy",
  "TimingConstraint",
  "TimeSelector",
  "Condition"
]
```

### Generated checks

Local allowed value kinds/enums, integer bounds, strings, dateTime datatypes, per-class cardinalities, mandatory identity, reusable node shapes for intrinsic value objects, and ordered preference member checks. MediaFormShape is scoped to explicit media direction, not every generic or binding-annotated control Form. Additional hand-coded SHACL Core conditional constraints are explicitly named by the generator.

### Not covered

Not whole-matcher or camera conformance. The portable harness executes SHACL Core and meta-SHACL, including six contextual Rational sign checks and the three H265/Opus codec lists. Structural SHACL alone does not validate profile bodies, duplicate JSON keys/IDs/names, RDF list topology/length, finite numbers, timezone lexical validity, Rational gcd/cross-products, constraint applicability, whole-Mode/track closure, cross-record/reference/pin integrity, native op defaults/authorization, hard-match feasibility, optional omission/group/resource solving, queues/cadence/clock physical behavior, lifecycle/currentness/fencing, manifests or actual PROV evidence. Separate fixture probes cover selected JSON, arithmetic, pin, reference and query cases, not universal admission.

## Codec publication

### Additions

```json
{
  "H265": {
    "representation": "av:EncodedVideo",
    "media_type_reference": "video/H265",
    "sources": [
      "https://www.itu.int/rec/T-REC-H.265-202309-S/en",
      "https://www.rfc-editor.org/rfc/rfc7798.html#section-1.1",
      "https://www.rfc-editor.org/rfc/rfc7798.html#section-7.1",
      "https://www.iana.org/assignments/media-types/video/H265"
    ]
  },
  "Opus": {
    "representation": "av:EncodedAudio",
    "media_type_reference": "audio/opus",
    "sources": [
      "https://www.rfc-editor.org/rfc/rfc6716.html#section-2",
      "https://www.rfc-editor.org/rfc/rfc7587.html#section-4.1",
      "https://www.rfc-editor.org/rfc/rfc7587.html#section-6.1",
      "https://www.iana.org/assignments/media-types/audio/opus"
    ]
  }
}
```

### Representation codec sets

```json
{
  "av:EncodedVideo": [
    "av:H264",
    "av:JPEG",
    "av:H265"
  ],
  "av:EncodedAudio": [
    "av:AAC",
    "av:Opus"
  ]
}
```

### Media type scope

IANA media-type references identify registered RTP media-type mechanisms, not equivalent RDF resources or generic Form contentType defaults. Native signaling content types do not identify negotiated media codecs.

### Opus clock scope

RFC 7587 sections 4.1 and 7 use a 48000 Hz RTP timestamp clock and opus/48000/2 SDP signaling for all Opus modes; these do not prove 48000 samples/second at an application boundary or two actual media channels. Track sampleRate/channels/channelLayout describe the stated media signature; clock ticks use TimestampMapping/timeBase separately.

### Extension policy

Controlled sets are closed under the explicitly selected, recognized and content-pinned vocabulary/profile release. This release adds only H265 and Opus to Codec; older pinned releases retain their original sets. A future recognized versioned profile may declare an explicit additive set of absolute IRIs, each with a stable definition, primary sources, representation/field applicability, exact configuration/schema dependencies and matching rules. AV-namespace additions require a corresponding future authored AV inventory; profile-owned IRIs use that profile's declared namespace. Publish and pin the extended inventory, context dependencies and validator/shape set together. Existing IRI meanings, coercions, property cardinalities and native TD operations cannot be redefined. New values are usable only after the admission implementation explicitly recognizes that exact profile and has qualified the complete selected plan. Namespace expansion, a family name, a media type or an advertised profile URI is not recognition, parameter evidence or codec support. Unknown codecs, codec parameters or required profiles cannot satisfy a hard requirement; never drop them, substitute a nearest codec or silently widen an older controlled set. Detailed profiles refine family semantics without changing the family IRI's meaning.

## Specification baselines

- https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/
- https://www.w3.org/TR/2020/REC-json-ld11-20200716/
- https://www.w3.org/TR/2013/REC-prov-o-20130430/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/
