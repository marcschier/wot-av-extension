# WoT AV v0.1 - complete term catalog

**Original proposal; namespace unregistered and context URL unhosted.** This catalog defines 38 classes, 105 AV properties and 17 directly reused external properties. Read it with [the current root specification](../../../spec.md) for conditional requirements, matching, lifecycle, references and conformance.

Domains in a row are alternatives, not conjunctive RDFS axioms. Cardinalities correspond to the listed domains in order. `*` means unbounded; preferences count ordered list items, other counts concern values. `IRI` means an absolute resource identifier. `integer` is exact; `number` is finite; `dateTime` has an explicit timezone. A range denotes the expected description, not permission to substitute an unresolved IRI for evidence.

Integer JSON values use integer tokens without decimal/exponent notation, within the interoperable safe-integer range; larger integers use explicit typed `xsd:integer` lexical values. Numeric strings, NaN, infinity and unknown-as-zero are not accepted. Rates/tick durations and rate bounds are strictly positive; selector offsets are nonnegative; generic Rational values and relative timestamps may be signed.

Module labels are functional groupings, not isolated import graphs. All terms share one context. A publisher implements only the conformance features it claims, but shared terms retain their meaning.

## Classes

| Class | Module | Identity | Superclass | Definition |
|---|---|---|---|---|
| `av:MediaSource` | core | IRI | `td:Thing` | Physical or logical media origin; not its URL or retained content. |
| `av:Connector` | core | IRI | `td:Thing` | Acquisition/adaptation interface, including host-local native access; not automatically a sensor or PROV Agent. |
| `av:Processor` | core | IRI | `td:Thing` | Processing/input-receiving service; distinct from its running incarnation. |
| `av:Controller` | core | IRI | `td:Thing` | Coordination interface using native TD affordances; metadata does not execute admission. |
| `av:Offer` | core | IRI | - | Alternative complete Modes from one source; not an endpoint or current-availability promise. |
| `av:Mode` | core | IRI | - | One jointly valid acquisition, Form, track set and resource configuration; track enumeration is complete for this Mode. |
| `av:Track` | core | IRI | - | Identified simultaneous media component with one wire representation; not an SSRC/device index. |
| `av:ResourceUse` | core | node | - | Use of one shared resource in an exact complete configuration under a sharing rule. |
| `av:Rational` | core | node | - | Reduced exact numerator/positive-denominator ratio; containing property fixes units. |
| `av:Need` | core | IRI | `prov:Entity` | Immutable intent revision; logical identity through `dcterms:isVersionOf`; current head is external. |
| `av:InputRequirement` | core | IRI | - | Named required/optional logical input with complete alternatives. |
| `av:InputAlternative` | core | IRI | - | One complete permitted input contract; predicates AND, alternatives OR. |
| `av:TrackRequirement` | core | IRI | - | Required/optional track contract at wire or delivered boundary; matching identifiers join boundaries. |
| `av:IntegerConstraint` | core | node | - | Inclusive integer bounds; at least one bound; equality uses equal bounds. |
| `av:RationalConstraint` | core | node | - | Inclusive rational bounds on rate; exact cross-multiplication comparison. |
| `av:ChoiceConstraint` | core | node | - | Membership in nonempty allowed IRIs for a supported field; not a script/expression language. |
| `av:Preference` | core | node | - | Boolean input goal, ordered lexicographically after hard feasibility. |
| `av:InputGroup` | core | IRI | - | Disjoint all-or-none group of at least two inputs, optionally synchronized; not a hardware transaction. |
| `av:QueuePolicy` | core | node | - | Bounded policy at one named stage, including overflow and coverage. |
| `av:TimingConstraint` | core | node | - | Maximum age/skew in milliseconds for a time basis; age identifies its evaluation stage. |
| `av:TimeSelector` | core | node | - | Instant or half-open interval in rational seconds of one named timeline. |
| `av:TimestampMapping` | core | node | - | Clock mapping description with time basis, tick duration and pinned bounded affine mapping; not itself observed exposure evidence. |
| `av:Timestamp` | core | node | - | Observed rational seconds in an incarnation-specific clock, with basis/evidence/uncertainty. |
| `av:DocumentPin` | core | IRI | `prov:Entity` | Fixed representation with retrieval base, exact-octet SHA-256 and provenance scope; external to covered content. |
| `av:FormReference` | core | node | - | One named native Form and standard operation selected inside a pinned TD; optional agreeing JSON Pointer. |
| `av:Assignment` | lifecycle | IRI | `prov:Entity` | Immutable accepted Need mapping and initial grants; neither a protocol binding nor execution. |
| `av:InputSelection` | lifecycle | IRI | - | Chosen input alternative, Offer, Mode, adapter configuration and source/sink Forms. |
| `av:TrackSelection` | lifecycle | IRI | - | Offered Track mapped to same-name wire/delivered requirements; adapter supplies actual signatures. |
| `av:AssignmentStatus` | lifecycle | IRI | `prov:Entity` | Immutable generation/observer-incarnation observation; currentness is externally evaluated. |
| `av:LeaseGrant` | lifecycle | IRI | `prov:Entity` | Immutable revision of externally enforced authority for one scope and holder. |
| `av:Condition` | lifecycle | node | - | One named four-valued evidence claim, separate from lifecycle state. |
| `av:Fault` | lifecycle | node | - | Stable failure code, non-secret explanation and evidence; control profile defines retry handling. |
| `av:MediaAsset` | provenance | IRI | `prov:Entity` | Sealed retained still/clip content with a typed manifest and completion state. |
| `av:MediaSample` | provenance | IRI | `prov:Entity` | Selected retained or ephemeral media unit; no mandatory media URL. |
| `av:InferenceModel` | provenance | IRI | `prov:Entity` | Versioned learned-model manifest with files, tensors, preprocessing and runtime requirements; not a Thing Model/schema. |
| `av:ResultContract` | provenance | IRI | `prov:Entity` | Versioned output contract: schema, meaning, completion and native delivery Forms. |
| `av:Result` | provenance | IRI | `prov:Entity` | Identified payload under a ResultContract, with completion, provenance and commitment evidence. |
| `av:ProcessingRun` | provenance | IRI | `prov:Activity` | Actual capture/transformation/training/inference/indexing activity, not an unstarted plan. |

## AV properties

Every property uses the `av:` prefix. IRI-valued controls are expanded resource identifiers, not bare strings. The complete JSON-LD context defines collection/coercion behavior.

| Property | Domain(s) | Range(s) | Cardinality | Definition / units |
|---|---|---|---|---|
| `offer` | `td:Thing`; `InputSelection` | `Offer` | 0..*; 1 | Advertised or selected offer, without a copied address. |
| `need` | `td:Thing`; `Assignment` | `Need` | 0..*; 1 | Described or accepted immutable revision, not its head. |
| `source` | `Offer`; `InputAlternative`; `MediaSample` | `MediaSource` | 1; 0..1; 0..1 | Source identity; omitted alternative source allows discovery. |
| `connector` | `MediaSource` | `Connector` | 0..1 | Required for native host-local acquisition. |
| `host` | `Connector`; native Form | IRI | 1; 0..1 | Execution host, not address/index; HostLocal Form requires it. |
| `backend` | `Connector` | IRI | 1 | Versioned qualified adapter/runtime identity. |
| `locality` | native Form | Locality | 0..1 | Exactly one on media Forms; no requirement on control-only Forms. |
| `binding` | native Form | IRI | 0..1 | Binding specification; required on media Forms and pinned at acceptance. Does not itself assert media flow. |
| `mediaDirection` | native Form | MediaDirection | 0..1 | Media relative to addressed Thing; required on directed media access, absent on control-only access. |
| `mode` | `Offer`; `InputSelection` | `Mode` | 1..*; 1 | Complete alternatives or one selected tuple. |
| `kind` | `Mode`; `InputAlternative`; `MediaAsset` | MediaKind; MediaKind; Still/Clip | 1 | Temporal media kind; Clip requires finite extent. |
| `form` | `Mode`; `InputAlternative`; `FormReference` | native Form | 1; 0..1; 1 | Native Form `@id`, never `href`. Alternative value is an optional Processor sink. |
| `track` | `Mode`; `TrackRequirement`; `TrackSelection`; `MediaSample` | `Track` | 1..*; 0..1; 1; 0..1 | Offered component identity or explicit track restriction. |
| `resourceUses` | `Mode` | `ResourceUse` | 1..* | Complete shared acquisition/configuration resource uses. |
| `resource` | `ResourceUse` | IRI | 1 | Resource/configuration scope, not an address. |
| `configuration` | `Mode`; `Track`; `ResourceUse`; `TimestampMapping`; `InputSelection`; `ProcessingRun` | `DocumentPin` | 1; 0..1; 1; 0..1; 1; 1 | Typed pinned acquisition, codec/layout, resource-state, mapping, qualified adapter or actual-run configuration, respectively. |
| `sharing` | `ResourceUse` | Sharing | 1 | Requires whole-configuration equivalence, not overlapping subsets. |
| `representation` | `Track`; `TrackRequirement` | Representation | 1 | Wire representation or the containing requirement boundary's representation. |
| `width` | `Track` | integer >= 1 | 0..1 | Display/image width in pixels, not maximum, stride or tensor width. |
| `height` | `Track` | integer >= 1 | 0..1 | Display/image height in pixels, not maximum or tensor height. |
| `codec` | `Track` | Codec | 0..1 | Encoded family; required for encoded content, not a signaling MIME type. |
| `pixelFormat` | `Track` | PixelFormat | 0..1 | Raw component order/packing; detailed colorimetry/strides require configuration. |
| `cadence` | `Track` | Cadence | 0..1 | Constant requires rate; Still omits cadence/rate; Variable/Triggered assert no exact rate. |
| `frameRate` | `Track` | positive `Rational` | 0..1 | Frames per media-timeline second at the selected boundary; not decoder throughput or guaranteed arrival rate. |
| `sampleRate` | `Track` | integer >= 1 | 0..1 | Audio samples/second/channel, not bytes/second. |
| `channels` | `Track` | integer >= 1 | 0..1 | Audio channel count; Mono=1, StereoLR=2. |
| `channelLayout` | `Track` | ChannelLayout | 0..1 | Channel meaning/order, independent of memory layout. |
| `sampleFormat` | `Track` | SampleFormat | 0..1 | PCM numeric representation, not codec. |
| `bufferLayout` | `Track` | BufferLayout | 0..1 | Raw-video Contiguous/Strided or PCM Interleaved/Planar, as applicable. |
| `timing` | `Track`; `MediaSample` | `TimestampMapping`; `Timestamp` | 0..* | Mapping descriptions versus actual observed instants. |
| `numerator` | `Rational` | integer | 1 | Signed primitive; rate/tick-duration contexts require >0, selectors >=0. |
| `denominator` | `Rational` | integer >= 1 | 1 | Reduced with numerator by greatest common divisor. |
| `processor` | `Need`; `ProcessingRun` | `Processor` | 1; 0..1 | Service identity, distinct from holder incarnation or model. |
| `input` | `Need`; `InputGroup`; `Preference` | `InputRequirement` | 1..*; 2..*; 1 | Named logical inputs; group members belong to the same Need. |
| `groups` | `Need` | `InputGroup` | 0..* | Disjoint all-or-none groups. |
| `preferences` | `Need` | ordered `Preference` list | 0..* items | Boolean lexicographic ranking only after all hard predicates pass. |
| `model` | `Need`; `Assignment` | `InferenceModel` | 0..1 | Exact learned-model identity, separately pinned. |
| `contract` | `Need`; `Assignment`; `Result` | `ResultContract` | 0..*; 0..*; 1 | Declared, accepted or used output contracts. |
| `allowedPreprocessing` | `Need` | `DocumentPin` | 0..* | Exact permitted model preprocessing; omission/empty authorizes none. |
| `generation` | `Need`; `Assignment`; `AssignmentStatus` | integer >= 0 | 1 | Desired generation, repeated exactly; not epoch, renewal sequence or fence. |
| `presence` | `InputRequirement`; `TrackRequirement` | Presence | 1 | Optional permits omission, not weakened predicates after inclusion. |
| `alternative` | `InputRequirement`; `InputSelection` | `InputAlternative` | 1..*; 1 | Complete OR alternatives or the single chosen alternative. |
| `wireTracks` | `InputAlternative` | `TrackRequirement` | 0..* | Requirements before decode/conversion/queue loss. |
| `deliveredTracks` | `InputAlternative` | `TrackRequirement` | 1..* | Application-delivery requirements, not tensors or implicit wire cadence. |
| `constraints` | `TrackRequirement`; `InputAlternative` | Integer/Rational/ChoiceConstraint; ChoiceConstraint | 0..* | AND predicates; alternative constraints are only source/host/backend placement. |
| `field` | `IntegerConstraint`; `RationalConstraint`; `ChoiceConstraint` | IntegerField; RationalField; ChoiceField | 1 | Supported field only; no scripts or arbitrary paths. |
| `lowerInteger` | `IntegerConstraint` | integer >= 1 | 0..1 | Inclusive lower bound in field units. |
| `upperInteger` | `IntegerConstraint` | integer >= 1 | 0..1 | Inclusive upper bound, not below lower. |
| `lowerRational` | `RationalConstraint` | positive `Rational` | 0..1 | Inclusive rate lower bound. |
| `upperRational` | `RationalConstraint` | positive `Rational` | 0..1 | Inclusive rate upper bound, exact comparison with lower. |
| `allowedValues` | `ChoiceConstraint` | IRI | 1..* | Nonempty membership set; field-specific applicability still applies. |
| `goal` | `Preference` | `TrackRequirement` or `ChoiceConstraint` | 1 | Delivered-track goal or source/backend/host preference; unknown/omitted scores false. |
| `captureIntent` | `InputAlternative` | CaptureIntent | 1 | Requested acquisition effect, still requiring authority and profile qualification. |
| `transformPermissions` | `InputAlternative` | Transform | 0..* | Explicit wire-to-delivered operations; no implicit permission from model or queue policy. |
| `selector` | `Mode`; `InputAlternative`; `MediaAsset`; `MediaSample` | `TimeSelector` | 0..1 | Full Clip extent or selected retained-media interval/instant. |
| `maxAge` | `InputAlternative` | `TimingConstraint` | 0..1 | Worst-case age including mapped uncertainty at declared evaluation stage. |
| `maxSkew` | `InputAlternative`; `InputGroup` | `TimingConstraint` | 0..1 | Pairwise included-track/input skew after common-domain mapping. |
| `queues` | `InputAlternative` | `QueuePolicy` | 0..* | Requested boundaries; accepted adapter still discloses all internal/shared queues. |
| `stage` | `QueuePolicy`; `TimingConstraint` | queue stage; age boundary | 1; 0..1 | CaptureIngress/EncodedBranch/DecodedDelivery/ModelInput; ApplicationIngress/InferenceStart, respectively. |
| `capacity` | `QueuePolicy` | integer >= 1 | 1 | Finite queue units; no unbounded sentinel. |
| `unit` | `QueuePolicy` | QueueUnit | 1 | Queue capacity unit; not a generic override of fixed physical units. |
| `overflow` | `QueuePolicy` | Overflow | 1 | Required response to capacity; blocking needs a qualified pausable/spooled upstream. |
| `coveragePolicy` | `QueuePolicy` | CoveragePolicy | 1 | Coverage from this stage through delivery, separate from result completion. |
| `gapResponse` | `QueuePolicy` | GapResponse | 0..1 | Required for NoIntentionalDrop; Report is not complete success. |
| `limitMs` | `TimingConstraint`; `QueuePolicy` | number >= 0 | 1; 0..1 | Milliseconds: age/skew bound or residence bound, respectively. |
| `clock` | `TimestampMapping`; `Timestamp`; `TimeSelector`; `AssignmentStatus`; `LeaseGrant` | IRI | 1 | Named clock/timeline origin and incarnation; matching labels do not prove synchronization. |
| `basis` | `TimestampMapping`; `Timestamp`; `TimingConstraint` | TimeBasis; TimeBasis; Capture/Presentation/ReceiptTime | 1 | Physical meaning, independent of units or mapping availability. |
| `timeBase` | `TimestampMapping` | positive `Rational` | 1 | Seconds per source tick. |
| `referenceClock` | `TimestampMapping` | IRI | 0..1 | Mapping target; presence requires configuration and known uncertainty. |
| `uncertaintyMs` | `TimestampMapping`; `Timestamp`; `AssignmentStatus`; `LeaseGrant` | number >= 0 | 0..1 | Conservative error bound; omission is unknown. |
| `start` | `TimeSelector` | nonnegative `Rational` | 1 | Seconds from selector clock origin. |
| `end` | `TimeSelector` | nonnegative `Rational` | 0..1 | Exclusive end > start; absent for AtInstant. |
| `selection` | `TimeSelector` | SelectorKind | 1 | Exact sample/edge semantics, not an automatic seek API. |
| `toleranceMs` | `TimeSelector` | number >= 0 | 0..1 | Required only for CoveringInterval; allowed excess at each edge. |
| `time` | `Timestamp` | `Rational` | 1 | Observed seconds from clock origin; not an integer/datetime ambiguity. |
| `document` | `DocumentPin` | IRI | 1 | Effective retrieval location/base of the exact representation; distinct from Thing/Form identity. |
| `documentKind` | `DocumentPin` | DocumentKind | 1 | Publisher/snapshot/content provenance scope. |
| `hexDigest` | `DocumentPin` | string | 1 | 64 lowercase hex SHA-256 of complete representation octets after HTTP content decoding; no normalization. |
| `pin` | `DocumentPin`; `FormReference`; `Need`; `Assignment`; `AssignmentStatus`; `MediaAsset`; `InferenceModel`; `ResultContract`; `Result` | `DocumentPin` | 0..*; 1; 0..*; 1..*; 0..*; 1; 1; 1; 1 | Dependencies; selected TD; dependency closure; typed manifest; or complete output payload, as applicable. |
| `expectedThing` | `DocumentPin` | `td:Thing` | 0..1 | Required for TD used by FormReference; match native Thing `id`. |
| `operation` | `FormReference` | NativeOperation | 1 | One existing TD operation IRI; native Form still uses standard lowercase `op` token. |
| `jsonPointer` | `FormReference` | string | 0..1 | RFC 6901 pointer into pinned original JSON; must agree with named Form, not an assumed URI fragment. |
| `holder` | `Assignment`; `LeaseGrant`; `ProcessingRun` | IRI | 1 | Authorized running worker incarnation. |
| `selections` | `Assignment`; `InputSelection` | `InputSelection`; `TrackSelection` | 1..* | Accepted input or track mappings. |
| `omitted` | `Assignment`; `InputSelection` | `InputRequirement`; `TrackRequirement` | 0..* | Explicit optional omissions only. |
| `forms` | `InputSelection` | `FormReference` | 1..* | Accepted native source/sink interactions, not copied targets/security. |
| `requirement` | `InputSelection`; `TrackSelection` | `InputRequirement`; `TrackRequirement` | 1; 1..2 | Discharged requirement; at most one wire and one delivered requirement of one logical track. |
| `assignment` | `AssignmentStatus`; `ProcessingRun` | `Assignment` | 1 | Exact accepted attempt. |
| `state` | `Need`; `AssignmentStatus`; `ProcessingRun`; `MediaAsset`; `Result` | NeedState; AssignmentState; RunState; Complete/Partial; ContentState | 1 | Class-specific state IRI, not automatic evidence/currentness. |
| `incarnation` | `AssignmentStatus`; `MediaSample` | IRI | 1; 0..1 | Observer-process or media-stream reset/sequence scope. |
| `sequence` | `AssignmentStatus`; `MediaSample`; `LeaseGrant` | integer >= 0 | 1; 0..1; 1 | Scoped observation, media-unit ordinal, or renewal sequence; not a global cursor/fence. |
| `observedAt` | `AssignmentStatus` | dateTime | 1 | Observation time, distinct from publication time. |
| `validFrom` | `LeaseGrant` | dateTime | 1 | Inclusive start on authority clock. |
| `validUntil` | `AssignmentStatus`; `LeaseGrant` | dateTime | 1 | Exclusive freshness/expiry boundary; grants can be revoked earlier. |
| `lease` | `Assignment`; `AssignmentStatus`; `ProcessingRun` | `LeaseGrant` | 1..* | Initial, currently observed, or effect-checked revisions, respectively. |
| `conditions` | `AssignmentStatus` | `Condition` | 4 | Exactly one of each ConditionName; not merely any four nodes. |
| `condition` | `Condition` | ConditionName | 1 | Distinct claim identity. |
| `conditionState` | `Condition` | TruthState | 1 | Four-valued IRI; True requires evidence, False is not absence. |
| `evidence` | `Condition`; `Fault`; `Timestamp`; `Result` | IRI; IRI; IRI; `DocumentPin` | 0..*; 0..*; 1..*; 1 | Support or authenticated full commitment receipt; identifiers are not self-authenticating. |
| `authority` | `LeaseGrant` | IRI | 1 | External enforcing authority. |
| `scope` | `LeaseGrant` | IRI | 1 | One fencing/effect domain; no implied multi-domain atomicity. |
| `fence` | `LeaseGrant` | integer >= 0 | 1 | Ownership epoch within authority/scope; renewal preserves it. |
| `issues` | `AssignmentStatus`; `ProcessingRun`; `Result` | `Fault` | 0..* | Explicit failures/incompleteness; conditionally required. |
| `code` | `Fault` | FaultCode | 1 | Stable failure IRI; control profile supplies detailed retry rules. |
| `committedAt` | `Result` | dateTime | 1 | Durable commitment time, not capture/computation/delivery. |

## Reused properties

These predicates keep their external meanings. Listed uses are this profile's requirements, not replacements for their ontologies.

| Property | Domain(s) | Range | Cardinality | Profile meaning |
|---|---|---|---|---|
| `dcterms:identifier` | `InputRequirement`; `TrackRequirement`; `Track`; `Result` | string | 1 | Local input/track name or output slot; supplements absolute identity. |
| `dcterms:isVersionOf` | `Need`; `LeaseGrant`; `InferenceModel`; `ResultContract`; `MediaAsset` | IRI | 1; 1; 0..1; 0..1; 0..1 | Logical intent/lease series or artifact lineage. |
| `dcterms:format` | `DocumentPin` | string | 1 | Media type of covered representation, not replacement Form content type. |
| `dcterms:conformsTo` | `DocumentPin` | IRI set | 0..* | Recognized profile/standard claim; not validation evidence. |
| `dcterms:description` | `Fault`; `prov:Entity` | string | 1; 0..* | Non-secret explanation. |
| `dcterms:title` | `prov:Entity` | string | 0..* | Optional artifact title; retain native TD title on Things. |
| `dcterms:creator` | `prov:Entity` | IRI set | 0..* | Creator identity. |
| `dcterms:publisher` | `prov:Entity` | IRI set | 0..* | Publisher identity, not authorization. |
| `dcterms:license` | `prov:Entity` | IRI set | 0..* | License document, separate from access permission. |
| `dcterms:references` | `prov:Entity` | IRI set | 0..* | Supplemental links, not substitutes for pins or Forms. |
| `prov:used` | `ProcessingRun` | `prov:Entity` set | 1..* | Actual consumed media/model/configuration. |
| `prov:wasGeneratedBy` | `Result`; `MediaAsset`; `InferenceModel` | `ProcessingRun`; `prov:Activity`; `prov:Activity` | 1; 0..1; 0..1 | Actual execution, never an unstarted assignment. |
| `prov:wasDerivedFrom` | `MediaSample`; `Result`; `MediaAsset`; `InferenceModel` | `MediaAsset`; `prov:Entity`; `prov:Entity`; `prov:Entity` | 0..1; 0..*; 0..*; 0..* | Actual derivation; retained sample names its asset here. |
| `prov:wasAssociatedWith` | `ProcessingRun` | `prov:Agent` set | 1..* | Responsible actual execution agents. |
| `prov:wasAttributedTo` | `Assignment`; `AssignmentStatus`; `prov:Entity` | `prov:Agent` set | 1; 1; 0..* | Controller/observer or other responsible agent, not automatically the same as a service Thing. |
| `prov:startedAtTime` | `ProcessingRun` | dateTime | 0..1 | Actual start when known. |
| `prov:endedAtTime` | `ProcessingRun` | dateTime | 0..1 | Actual end when known; not evidence of commitment. |

## Controlled IRI sets

Set labels below are catalog names, not additional AV classes. Members have the `av:` prefix unless explicitly marked `td:`.

| Set | Complete members / interpretation |
|---|---|
| MediaKind | `Live`: unbounded live media; `Still`: image-shaped access, not necessarily new exposure; `Clip`: finite media with named timeline/extent. |
| MediaDirection | `ToThing`: media enters addressed Thing; `FromThing`: media leaves it. |
| Locality | `HostLocal`: requires declared host/native runtime; `Network`: network binding, still requiring reachability. |
| Representation | `EncodedVideo`, `RawVideo`, `EncodedAudio`, `PCM`; encoded image/video, raw pixels, encoded audio and raw samples, respectively. |
| Codec | `H264`, `H265`, `JPEG`, `AAC`, `Opus`. Family identity is not support, transport, container, profile/tier/level or initialization. H265 is HEVC; Opus is the RFC 6716 family. |
| PixelFormat | `BGR8`: uint8 B,G,R HWC; `RGB8`: uint8 R,G,B HWC; `Mono8`: one uint8 intensity; `YUV420P`: 8-bit planar Y/U/V 4:2:0, with colorimetry/strides separately fixed. |
| Cadence | `Constant`: exact rate required; `Variable`: no exact rate; `Triggered`: acquisition-event cadence, not constant FPS. |
| ChannelLayout | `Mono`: one channel; `StereoLR`: two channels ordered left/right. |
| SampleFormat | `S16LE`: signed 16-bit little-endian; `F32LE`: IEEE binary32 little-endian. |
| BufferLayout | `Contiguous`/`Strided` for video; `Interleaved`/`Planar` for PCM. |
| Presence | `Required`; `Optional`, with hard predicates retained if included. |
| CaptureIntent | `Observe`: no configuration/trigger mutation; `RequestCapture`: acquisition under selected configuration; `ConfigureAndCapture`: both exact configuration and acquisition authority required. |
| Transform | `Decode`, `ColorConvert`, `ResizeStretch`, `ResizeCrop`, `ResizeLetterbox`, `ResampleAudio`, `RemixAudio`, `TemporalSubsample`, `DuplicateFrames`, `PrerollDecode`. Exact parameters require qualified profiles. |
| Stage | Queue: `CaptureIngress`, `EncodedBranch`, `DecodedDelivery`, `ModelInput`; age evaluation: `ApplicationIngress`, `InferenceStart`. |
| QueueUnit | `Frame`, `Bundle`, `Packet`, `Byte`; packets are not frames, bundles identify associated media. |
| Overflow | `DropOldest`, `DropNewest`, `BlockUpstream`, `Fail`. |
| CoveragePolicy | `BestEffort`; `NoIntentionalDrop`, which is not a sensor/network-loss guarantee. |
| GapResponse | `Report` incomplete coverage; `Fail` the obligation. |
| TimeBasis | `CaptureTime`, `PresentationTime`, `ReceiptTime`, `ProcessingTime`, `CommitTime`; capture means exposure midpoint or first audio sample when qualified. |
| SelectorKind | `AtInstant`: no end; `ExactSamples`: samples in `[start,end)`; `CoveringInterval`: bounded excess at edges, not missing interior samples. |
| Sharing | `Exclusive`; `SameConfiguration`, requiring exact recognized complete-configuration equivalence. |
| DocumentKind | `PublisherTD`, `DirectorySnapshot`, `ContextDocument`, `OntologyDocument`, `ShapeDocument`, `ProfileDocument`, `DomainDocument`, `ManifestDocument`, `PayloadDocument`, `ReceiptDocument`, `ArtifactFile`. |
| NeedState | `Active`, `Withdrawn`. |
| AssignmentState | `Accepted`, `Applying`, `Ready`, `Degraded`, `Failed`, `Draining`, `Released`. |
| RunState | `Running`, `Succeeded`, `Failed`, `Canceled`, `Uncertain`; computation success is not commitment. |
| ContentState | `Complete`, `Partial`, `Error`. |
| ConditionName | `MediaObserved`, `ApplicationReady`, `ModelLoaded`, `ResultCommitted`. |
| TruthState | `True`, `False`, `Unknown`, `NotApplicable`; see lifecycle eligibility rules. |
| IntegerField | `width`, `height`, `sampleRate`, `channels`. |
| RationalField | `frameRate`. |
| ChoiceField | `codec`, `pixelFormat`, `cadence`, `sampleFormat`, `channelLayout`, `bufferLayout`, `host`, `backend`, `source`, `configuration`. Alternative-level placement is restricted to source/host/backend. |
| NativeOperation | `td:readProperty`, `td:writeProperty`, `td:observeProperty`, `td:unobserveProperty`, `td:readAllProperties`, `td:writeAllProperties`, `td:readMultipleProperties`, `td:writeMultipleProperties`, `td:observeAllProperties`, `td:unobserveAllProperties`, `td:invokeAction`, `td:queryAction`, `td:cancelAction`, `td:queryAllActions`, `td:subscribeEvent`, `td:unsubscribeEvent`, `td:subscribeAllEvents`, `td:unsubscribeAllEvents`. Containing-affordance restrictions still apply. |

## Failure vocabulary

| Code | Meaning |
|---|---|
| `InvalidContract` | Syntax, shape, identifier or conditional rule is invalid. |
| `UnknownRequiredFact` | Required evidence is unavailable or unknown. |
| `UnsupportedProfile` | Required binding/configuration/validation profile is not recognized. |
| `NoJointMode` | No single complete Mode satisfies the alternative. |
| `MissingTrack` | Required logical track cannot be selected. |
| `BackendTrackUnsupported` | Adapter cannot deliver the track. |
| `UnreachablePlacement` | Host, runtime or reachability constraints fail. |
| `CaptureAuthorityRequired` | Acquisition/configuration authority is unestablished. |
| `SharedConfigurationConflict` | Existing shared resource configuration conflicts. |
| `CapacityExceeded` | Qualified finite capacity is insufficient. |
| `TransformForbidden` | Required transform/preprocessing lacks permission. |
| `ClockUnqualified` | Required time basis or common-clock mapping is unqualified. |
| `AgeBudgetUnproven` | Worst-case age cannot be established. |
| `SkewBudgetUnproven` | Worst-case pairwise skew cannot be established. |
| `RangeUnavailable` | Requested finite interval is unavailable. |
| `SeekSemanticsUnsupported` | Required selector semantics cannot be implemented. |
| `QueuePolicyConflict` | Queue, coverage or branch-isolation requirements conflict. |
| `RevisionConflict` | Expected generation/head differs. |
| `IdempotencyConflict` | Same scoped key has a different complete input fingerprint. |
| `NoFeasibleAssignment` | No complete mapping can be accepted. |
| `DependencyUnavailable` | Exact pinned dependency cannot be retrieved. |
| `IntegrityMismatch` | Pin or immutable identity has conflicting content. |
| `Unauthorized` | Required authorization is absent. |
| `LeaseExpired` | Enforced grant has expired. |
| `LeaseRevoked` | Enforced grant was revoked. |
| `StaleObservation` | Observation is stale, superseded or from an obsolete incarnation. |
| `ContractMismatch` | Negotiated/output/model content violates the accepted contract. |
| `ClockUncertain` | Uncertainty prevents a currentness/validity decision. |
| `OutcomeUncertain` | An external effect may have happened; reconcile before repeating. |
| `ResultCommitFailed` | No valid durable commitment receipt exists. |
| `ReleaseIncomplete` | Owned-scope cleanup is unestablished. |

The main specification defines the eleven profile families used by `configuration`, artifact manifests and control/result contracts. They are explicit separately versioned obligations, not permission to insert arbitrary untyped data.
