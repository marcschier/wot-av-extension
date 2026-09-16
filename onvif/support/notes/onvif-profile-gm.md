# Profile G/M canonical requirement ledger

The [G/M ledger](../../requirements/requirements-gm.json) records **634
role-separated requirement atoms** for Profile **G 1.1, October 2025**, and
Profile **M 1.1, March 2024**. It is an original mapping inventory, not a copy of
the profile publications, a runtime implementation, or evidence of ONVIF
conformance. **Six unresolved G issues affect 48 atoms.** They remain visible
and prevent an unqualified profile-satisfaction claim.

The [source lock](../../sources.lock.json),
[edition catalog](../../profile-editions.json), and
[editorial decisions](../editorial/editorial-decisions.json) are
the read-only source authorities. Native operations are identified by the
locked namespace, port type and operation, not by a local name alone. The
[vectors](../../tools/fixtures/requirements/requirements-gm-vectors.json) contain
declarative offline examples and future assertion targets, not invented
results from devices.

## Source and coverage boundary

| Profile | Source ID | Requirement pages reviewed, physical PDF | Atoms: device / client | Tables / rows | Physical bullets |
| --- | --- | --- | --- | --- | --- |
| G | `profile-G-1.1` | 5-19 | 187 / 193 | 15 / 134 | 147 |
| M | `profile-M-1.1` | 8-49 | 142 / 112 | 51 / 182 | 154 |

All **301 physical bullets** have explicit source cross-references. The 66
tables include the two scope-parameter tables. The 316 rows therefore include
314 function rows and two scope rows. The ledger also records 203
section headings, 751 authored review units, 48 feature overviews, 84 condition
facts and five nonexclusive alternative groups. Review-unit counts are **not**
counts of distinct physical paragraphs: a paragraph can contain several
obligations, several roles can refer to it, and equivalent prose/table
obligations can reference the same atom.

`coverage.sectionsReviewed`, `sourceUnitsReviewed` and
`physicalPdfBulletCrosswalk` preserve these distinctions. Definitions, feature
overviews, references, footnotes and prose-only behavior are classified rather
than discarded. There are 42 explicitly labeled inherited wire-contract review
units, including token scoping, adjusted job configurations and MQTT property
semantics.

This is an inventory of the **explicit profile requirements**, including all
their function tables and physical bullets, plus those selected inherited
contracts. It does **not** exhaustively atomize every paragraph of the referenced
Core, Streaming, Analytics, Recording, Media or Profile Policy specifications.
It is not a public ONVIF test-suite export. A complete profile inventory is
neither a complete service implementation nor a product-conformance result.

G's running headers still say 1.0; the cover and revision history select 1.1.
M's printed pagination cannot be used as a physical offset:

| M physical PDF page | Printed page | Example |
| --- | --- | --- |
| 15 | 14 | Authentication |
| 19 | 18 | Discovery scopes |
| 20 | 21 | System |
| 26 | 27 | Metadata configuration |
| 35 | 23 | Pull-point device requirements |
| 36 | 23 | Pull-point client table |
| 37 | 24 | MQTT device requirements |
| 41 | 28 | Object classification |
| 48 | 35 | Plate recognition |
| 49 | 36 | Line crossing counter |

Every atom carries both `pdfPage` and `printedPage`, its clause and, where
applicable, its table/row. The full physical-to-printed map is in
`coverage.profileSources`. The exact PDF hashes are retained there and in the
source lock; no second PDF download or edited PDF is part of this work.

## Reading an atom

An atom has the shared fields `id`, `profile`, `edition`, `role`, `source`,
`requirementLevel`, `feature`, `condition`, `classification`, `native`,
`mapping`, `evidenceTargets` and `editorialDecisionIds`. Its source-oriented ID
does not depend on a later generated affordance name.

**Level and condition have different jobs.** `requirementLevel` records the
local mandatory, conditional or optional function/obligation level.
`condition` preserves the complete enclosing feature gate and any more local
condition. For example, G's Media1 device operations can be **mandatory with
an on-board-source condition**, while M's client module operations are
**mandatory inside a conditional client configuration feature**. Flattening
either to an unconditional M loses the profile contract.

Conditions contain only `fact`/`equals`, `all`, `any`, `not`, or `null`; they
are data, not executable code. `null` means unconditional. Facts are defined
in `coverage.facts` with role, scope, meaning and evidence/default rules.

| Input or state | Meaning |
| --- | --- |
| Feature exists through native or proprietary functionality | The feature gate is true. |
| Affirmative evidence that no applicable native or proprietary functionality exists | The feature gate can be false. |
| Native advertisement missing, denied, timed out, invalid, or insufficient | Unknown, not false. |
| Native XML boolean `false` or `0` | Boolean false, never truthy merely because its lexical form is a nonempty string. |
| Missing optional capability without an applicable native default | Unknown; do not invent a default. |
| A valid response with an actual schema/contract default | The default can be applied with its provenance; it is not a substitute for receiving the response. |
| False mandatory-feature advertisement | A discrepancy with the requirement, not permission to drop the mandatory row. |
| Device capability true | No inference about the client feature, decoder, receiver or workflow. |

`all` and `any` use three-valued logic: false dominates `all`, true dominates
`any`, and otherwise unresolved inputs remain unknown. `not unknown` remains
unknown. A condition being true establishes applicability, **not satisfaction**.
Optional rows remain optional even when their feature gate is true.

`obligationGroup.atLeastN` is an implementation choice among complete branches.
It is separate from a condition's `any`. G requires at least one complete
on-board or receiver source branch. M has separate device video-codec,
device image-transfer, client metadata-transport and client video-transport
groups. Supporting more than the minimum is valid: **never use exclusive
`oneOf` for these groups**. M's video footnote additionally requires a native
codec conditionally when that codec is supported in any way.

### Mapping classes

| Classification | Meaning and usual mapping |
| --- | --- |
| `protocol` | Native SOAP action or native topic event. Client action rows require the consumer to use device actions; they do not create client-hosted endpoints. |
| `schema` | Preserve native element/type structure, identity, cardinality and extension data. |
| `capability` | Advertisements, capacity constraints or potential-element samples; not necessarily telemetry. |
| `behavior` | Authentication, media execution, filtering, lifecycle or semantic behavior requiring runtime evidence. |
| `process` | Version, role, requirement-level and inherited-specification obligations that a TD cannot prove. |
| `notRepresentableTd` | The two unresolved job-configuration notification rows currently lack a justified exact native topic. `mapping.kind=none` prevents inventing an event. This is an evidence gap, not a claim that such events are intrinsically impossible in a TD. |

All native SOAP operations default to `mapping.kind=action`, including ordinary
`Get*` operations. This ledger adds no convenience property aliases. A later
alias needs an explicit safe native read/set mapping and must not replace a
consuming operation or confuse requested configuration with observed state.
`evidenceTargets` are stable future assertion IDs; they do not assert that
native requests or media sessions have run.

## Profile G feature overviews

In this table, **device** means the native service provider and **client** means
the consumer implementation. A default of "unknown" concerns feature evidence,
not the local M/C/O level. A mandatory device interface remains required when
its operation has not been probed.

| Feature ID and clauses | Who | What it describes | Used for | Default / activation |
| --- | --- | --- | --- | --- |
| `g.profile-contract`, 5-6 and section scopes | Device and client, independently | Minimum specification version 2.4, nested levels and inherited native contracts. | Interpret every other row without turning device obligations into client obligations. | Applies to a selected G role; profile claims do not prove satisfaction. |
| `g.security`, 7.1 | Both roles | Native HTTP Digest authentication. | Authenticate service requests, not merely describe a TD security scheme. | Mandatory; no anonymous-success fallback establishes it. |
| `g.capabilities`, 7.2 | Device supplies; client inspects | GetServices, per-service GetServiceCapabilities, GetWsdlUrl and Event MaxPullPoints. | Discover actual services and configuration/capability information. | Device capabilities are M except conditioned Media1/Receiver rows. Client GetServices is M; the other inspections are O. MaxPullPoints must be at least 2. |
| `g.recording-search`, 7.3 | Device serves; client runs sessions | Recording/event searches, consuming result pages, summaries, attributes, XPath and recording/track state notifications. | Search a bounded recording scope, display available time ranges and release search resources. | Search start/drain/end is M for both. Client information, XPath and state-event gates are separate and initially unknown. |
| `g.replay`, 7.4 and client overview | Device streams; client executes/decodes | Replay URI, timeout configuration, native RTSP/RTP replay and client codecs. | Play actual recorded data with clock ranges and replay flags. | Basic replay is M. Client timeout configuration is conditional; reverse playback is O. Client audio/metadata reception has separate gates. |
| `g.dynamic-recordings`, 8.1 | Device creation/deletion feature; client recording provisioning | CreateRecording, DeleteRecording and their native notifications. | Provision/remove recording resources with destructive lifecycle semantics. | Independent conditional recording gate; unknown is not false. |
| `g.dynamic-tracks`, 8.1 | Device track feature; client track provisioning | CreateTrack, DeleteTrack and notifications within a recording. | Manage individual video/audio/metadata channels. | Independent conditional track gate; not implied by dynamic recordings. |
| `g.recording-jobs`, 9.1 | Device supplies jobs; client provisions them | Recording inventory, job list/create/delete, requested mode, actual state and content-deletion events. | Route sources to recording tracks and monitor whether data really transfers. | Device core is M; client core is C on job provisioning. Client GetRecordingOptions is O; timeline deletion events have their own gate. |
| `g.onboard-source`, 9.1.4 | Device with local sources; client configuring them | Capability-dependent local source branch. | Meet one complete alternative of G's source requirement. | Conditional on on-board functionality; not the newer OnboardStorage capability. Neither this branch nor Receiver excludes the other. |
| `g.onboard-media-profiles`, 9.1.4 | Local-source device and applicable client | Media1 CreateProfile, DeleteProfile, GetProfiles and GetProfile. | Select/configure local media profile resources for recording. | Device table M* is nested under on-board sources. Client optional prose and C table rows are both retained. |
| `g.onboard-video-source`, 9.1.4 | Local-source device and applicable client | Video-source lists, configurations, compatibility, options, attachment and removal. | Configure the source side without confusing it with encoder configuration. | Device M* under the source gate; client configuration-feature gate is independent. The duplicated prose name does not replace native GetVideoSourceConfigurationOptions. |
| `g.onboard-video-encoder`, 9.1.4 | Local-source device and applicable client | Media1 encoder settings, compatible configurations and encoder-instance bounds. | Select recording encodings and encoder profiles. | Device M* under the source gate. Four client get/set/options operations are M in scope; attachment/removal/compatibility/instance queries are O. |
| `g.onboard-metadata`, 9.1.4 | Local-source device and applicable client | Media1 metadata settings, compatible configurations, options and attachment. | Configure metadata associated with a recording source. | Device optional prose versus M* table remains unresolved. Client may/C evidence is retained; no universal metadata track is manufactured. |
| `g.onboard-audio-source`, 9.1.4 | Device with on-board audio and applicable client | Audio-source selection, configuration, compatibility and attachment. | Configure an actual audio source for recording. | Device M** uses the audio-source gate. Optional device prose versus the table remains unresolved; absence of audio is not a universal failure. |
| `g.onboard-audio-encoder`, 9.1.4 | Device with on-board audio and applicable client | Audio encoder configurations, options and profile attachment. | Configure encoding of actual audio recording sources. | Device M** uses the audio-source gate; the prose/table issue is retained. Client capability is not inferred from the device. |
| `g.receiver-source`, 9.1.5 | Device with Receiver functionality; client configuring receivers | Receiver list/get/create/delete, configuration, mode, state and receiver events. | Obtain a remote recording source through a real RTSP client endpoint. | Device M* inside Receiver support; client C on receiver configuration. A configuration object alone does not implement reception. |
| `g.recording-configuration`, 9.2 | Device configuration provider; client provisioning recordings/tracks | Recording, track and job get/set contracts and configuration changes. | Manage resource configuration without flattening identities. | Client track configuration requires both recording and track provisioning. Device SetTrackConfiguration and exact job-change topics remain unresolved. |
| `g.discovery`, 9.3 | Device advertises/configures; client optionally discovers/configures | Core WS-Discovery, modes, scopes and the G scope value. | Find native services and manage discovery metadata. | Device functions are M. Client WS-Discovery M* is inside network discovery; mode/scope management is O. |
| `g.network-configuration`, 9.4 | Device; client network administrator | Hostname, DNS, interfaces, protocols and gateway settings. | Authorized native network configuration. | Device rows are M. Client interface/gateway rows are M* under its network-configuration feature; other client rows are O. |
| `g.system`, 9.5 | Device; client system operator | Device identity, clock, factory default and native SystemReboot. | Inspect identity and perform explicitly authorized administration. | Device rows are M. Client identity retrieval has its own gate; clock/default/reboot are O. These are not discovery probes. |
| `g.users`, 9.6 | Device; authorized client administrator | Device-login account list/create/delete/update using singular SetUser. | Administer service users, not access-control credential databases. | Device M; client M* inside user-management support. Never publish account secrets as discovery data. |
| `g.event-pull-points`, 9.7 | Device publisher; conditional client receiver | Create/synchronize/pull, native renewal/termination and topic/content filtering. | Maintain native real-time recording-related subscriptions. | Device supports at least 2 concurrent pull points. Client workflow is C; properties/filter inspection is O. Full base notification is not universally mandatory. |

### G identity and state invariants

`GetRecordings` returns recording items with configuration and nested
`Tracks/Track` entries. The named XSD types are
`tt:GetRecordingsResponseItem`, `tt:GetTracksResponseList` and
`tt:GetTracksResponseItem`, not an invented globally indexed `RecordingItem`
type. Track identity includes its parent recording token, endpoint and service.
Two recordings may legitimately reuse the same track-token spelling.

`CreateRecordingJob` returns **both** `JobToken` and the `JobConfiguration`
actually used by the device. The returned configuration can differ from the
request. Preserve priority, typed Profile/Receiver source references and
SourceTag-to-Destination routing. An `Active` request means attempt reception;
only `GetRecordingJobState` and its aggregate/source/track states provide
observed transfer state.

`FindRecordings` and `FindEvents` allocate search sessions.
`GetRecordingSearchResults` and `GetEventSearchResults` consume previously
unreturned results. Keep scope, keepalive, time bounds, IncludeStartState,
minimum/maximum result counts and wait duration. `EndSearch` releases the
session. A later empty page is not a repeatable snapshot of an earlier page,
and a failed request is not a successful empty result.

Replay keeps `GetReplayUri(StreamSetup, RecordingToken)` separate from native
session execution. Runtime obligations include `Require: onvif-replay`,
absolute `Range: clock=...`, session/CSeq correlation, original-capture NTP
time and RTP C/E/D flags. Preserve the T terminal hint without upgrading its
recommendation to a mandatory flag. Reverse playback is optional and uses
native negative Scale semantics. G clients must decode H.264, MPEG-4 and
M-JPEG; a URI action or a codec string does not satisfy a decoder obligation.

## Profile M feature overviews

| Feature ID and clauses | Who | What it describes | Used for | Default / activation |
| --- | --- | --- | --- | --- |
| `m.profile-contract`, 4-5 and section scopes | Device and client separately | Specification minimum 21.06 and native/nested requirement interpretation. | Separate profile edition, schema version, feature support and product evidence. | Applies to a selected M role; no automatic conformance inference. |
| `m.authentication`, 7.1 | Both roles | HTTP Digest, RTSP Digest and RTSP-level Digest inside an HTTP tunnel. | Authenticate the actual native control/media exchange. | All three obligations are M; authenticating only the outer tunnel is insufficient. |
| `m.services`, 7.2 | Device describes; client enumerates | Device/Media2/Analytics capabilities and conditional Event capabilities. | Discover service contracts without assuming every optional branch. | Client GetServices is M and capability queries O. Device Event support is C; the capacity of 2 applies only when pull points are supported. |
| `m.discovery`, 7.3 | Both roles, asymmetrically | WS-Discovery, scope listing and Profile M advertisement. | Find devices and preserve their claimed scope metadata. | Device WS-Discovery is O, GetScopes M; client WS-Discovery M, GetScopes O. M scope advertisement remains a device requirement. |
| `m.system`, 7.4 | Device; client with system functionality | GetDeviceInformation, GetSystemDateAndTime and SystemReboot. | Inspect/administer device system state. | Device functions M; client System feature C, with GetDeviceInformation M inside it and time/reboot O. |
| `m.metadata-streaming`, 7.5 | Device streams; client receives | Ready metadata profile, Media2 URI acquisition, RTSP and native metadata transports. | Receive actual metadata XML, not just a URI or sample frame. | M for both roles. Device supports UDP and HTTP tunneling; client at least one. HTTPS has its own role gate; client synchronization is O. |
| `m.metadata-information`, 7.6 | Device describes; client reads capabilities | GetSupportedMetadata, SupportedMetadata and per-module SampleFrame. | Discover elements that an analytics module can potentially generate. | M for both; samples are not telemetry or an exhaustive class-value catalog. Type omission selects all existing modules in the native contract. |
| `m.metadata-profile-configuration`, 7.7 | Device provider; conditional configuring client | Media2 video-source/metadata configuration attachment and removal. | Assemble metadata-streaming profiles using existing configuration tokens. | Device core M; client feature C. Client RemoveConfiguration and event handling are O. Device change events require Event service support. |
| `m.metadata-configuration`, 7.8 | Both roles with different operation levels | Current metadata settings, options, Analytics/Events and optional compression/geolocation controls. | Read or modify metadata stream configuration. | Device get/options/set M. Client GetMetadataConfigurations M, Options/Set O. Conditional fields and notifications keep their own gates. |
| `m.analytics-profile-configuration`, 7.9 | Device provider; conditional configuring client | Media2 analytics configuration attachment/removal. | Select analytics configuration for a media profile. | Device core M; client feature C. Client removal/events O; device profile-change event requires Event service support. |
| `m.analytics-modules`, 7.10 | Device provider; conditional configuring client | Supported descriptions, assigned modules, create/delete and options/modification. | Configure named module instances under a VideoAnalyticsConfiguration. | Device core M. Options/Modify are C on returned AnalyticsModuleOptionsSupported=true; client Options/Modify are O in its feature scope. |
| `m.media-profile-management`, 8.1 | Independently supporting device/client | Media2 profile creation/deletion and profile changes. | Manage dynamic media profiles within native resource limits. | Conditional feature. Device Create/Delete M in scope; client Create M, Delete O. Preserve MaximumNumberOfProfiles and fixed=false eligibility without hiding the service operation. |
| `m.video-streaming`, 8.2 | Independently supporting device/client | Ready video profile, RTSP, codecs, transports and key-frame requests. | Execute video sessions in addition to mandatory metadata. | Not implied by M metadata. Device at least one H.264/H.265, with per-codec conditions; client both decoders. Client at least one baseline transport. |
| `m.image-sending`, 8.3 | Independently supporting device/client | URI and base64 event/metadata images. | Send/receive actual images carried or referenced by native data. | Conditional feature. Device at least one approach; client both. No invented GetImage SOAP operation. |
| `m.event-pull-points`, 8.4 | Independently supporting device/client | Real-time event create/synchronize/pull, filters and termination. | Receive native events over pull points. | Conditional feature. Device filtering/properties/unsubscribe M and concurrency at least 2; client corresponding extras O. Renew is not added as a universal M row. |
| `m.mqtt-events`, 8.5 | Device publisher; independent client MQTT workflow | Broker management, native MQTT publication and JSON events. | Configure event brokers and exchange native ONVIF event identities/data. | Device mqtt and mqtts are M inside the feature; ws/wss C. Client broker CRUD is M in its own feature, not proof of MQTT reception. MaxEventBrokers is at least 1. |
| `m.rules`, 8.6 | Independently configuring device/client | Rule descriptions, assigned rules, create/delete and optional modification surfaces. | Configure analytics rule instances by parent token and rule name. | Conditional feature. Device Options/Modify additionally requires RuleOptionsSupported=true; client Options/Modify O. |
| `m.object-classification`, 8.7 | Independently supporting producer/consumer | Native Appearance/Class/Type metadata and likelihood/extension data. | Interpret applicable classifications without closing the class vocabulary. | Conditional feature, not mandatory on every M device/client. Class fields remain optional per object/frame. |
| `m.human-face-metadata`, 8.8 | Independently supporting producer/consumer | HumanFace information in potential samples and actual metadata. | Describe/read applicable face characteristics. | Conditional; not equivalent to face recognition and not required in every frame. |
| `m.human-body-metadata`, 8.9 | Independently supporting producer/consumer | HumanBody information in potential samples and actual metadata. | Describe/read applicable body characteristics. | Conditional, separately gated from face and classification. |
| `m.vehicle-metadata`, 8.10 | Independently supporting producer/consumer | VehicleInfo in samples and streams. | Describe/read applicable vehicle information. | Conditional; preserve native collection/cardinality and extension semantics. |
| `m.license-plate-metadata`, 8.11 | Independently supporting producer/consumer | LicensePlateInfo in samples and streams. | Describe/read plate information without inventing a recognition event. | Conditional and separate from vehicle metadata and plate recognition. |
| `m.geolocation-metadata`, 8.12 | Independently supporting producer/consumer | Native GeoLocation in samples and streams. | Carry geographic object information. | Conditional; neither this field nor an optional distance scalar implies a dense depth map. |
| `m.face-recognition-events`, 8.13 | Independently supporting publisher/consumer | FaceRecognition rule advertisement and RuleEngine/Recognition/Face events. | Advertise and exchange actual recognition notifications. | Conditional; client table GetEventProperties/GetSupportedRules/event rows are M in this feature despite its copied Device banner. |
| `m.plate-recognition-events`, 8.14 | Independently supporting publisher/consumer | LicensePlateRecognition and RuleEngine/Recognition/LicensePlate. | Exchange plate recognition without generating face notifications from copied prose. | Conditional; the existing editorial decision selects the specific plate rule/topic while retaining the contradictory locator. |
| `m.line-crossing-counter`, 8.15 | Independently supporting publisher/consumer | LineCounting rule and RuleEngine/CountAggregation/Counter property. | Exchange an integer Count with its native source and property lifecycle. | Conditional; Count is not a per-frame object count and is not a generic motion event. |

### Metadata elements, types and capabilities

The wire path is `MetadataStream/VideoAnalytics/Frame`, not
`MetadataStream/VideoAnalyticsStream/Frame`. The latter substitutes a type
name for an XML child element. The six semantic paths are resolved against the
locked XML graph in `coverage.nativeMetadataElementPaths`, including their
actual content types. For example, the ONVIF-namespace `HumanFace` element has
a type in the separate human-face namespace.

`Frame/@UtcTime` is required, while its Object collection can be empty.
Appearance and its individual semantic fields are optional in the schema.
Feature support and sample-frame obligations do not change every instance's
cardinality. `Class/Type` uses repeatable `StringLikelihood`, not a closed
legacy `ClassType` enumeration. Keep unknown class strings and extensions.

`GetSupportedMetadata(Type?)` returns module entries whose Type is a QName and
whose SampleFrame describes potential elements. It must not produce live
"observed object" state merely because the sample contains an Object.
`tt:FaceRecognition`, `tt:LicensePlateRecognition` and `tt:LineCounting` are
advertised rule **QName values**, not claims that same-named global XSD types
exist. They are recorded separately from `native.typeQName`.

Neither audio-analytics nor dense-depth support is a universal M obligation.
The optional audio extension and an object-distance scalar remain native
schema possibilities, not new mandatory profile features. The separate
AnalyticsDevice service is not substituted for M's Analytics/Media2 contract.

### MQTT and event identity

`AddEventBroker` is an Address-keyed add/update operation. TopicPrefix is
required and nonempty; returned broker configurations omit Password.
Optional QoS values, including integer **2**, retain their native meaning;
this does not assert that Profile M universally mandates QoS 2.

Native JSON events use `TopicPrefix/onvif-ej/LocalTopic`, with applicable source
suffixes and namespace aliases. Keep UtcTime, Source and optional Data.
Default ONVIF and extension topics must not collapse into a generic event name.

For property events the publisher sets the MQTT retained flag and does not
include PropertyOperation in the JSON payload. Deletion is an **actual
zero-byte payload** for the retained topic, not `null`, `{}`, `""`, or a JSON
Deleted object. A client actually receiving MQTT must preserve those semantics,
but broker management alone does not establish a receiving interface. Event
SetSynchronizationPoint must not be converted into republishing MQTT property
events. Device publication and client reception/configuration facts remain
independent.

## Native identity and locked source provenance

All 147 distinct native operation references and 28 named type references
resolve within the existing **42 XML documents / 50 import edges**. The
operation inventory retains input/output message and element QNames,
source IDs/lines and SOAP actions. It does not require a concrete WSDL
`service` declaration where the source has none.

| Native service namespace | Port type local name | Exact locked source ID |
| --- | --- | --- |
| `http://www.onvif.org/ver10/recording/wsdl` | `RecordingPort` | `onvif:wsdl/ver10/recording.wsdl` |
| `http://www.onvif.org/ver10/search/wsdl` | `SearchPort` | `onvif:wsdl/ver10/search.wsdl` |
| `http://www.onvif.org/ver10/replay/wsdl` | `ReplayPort` | `onvif:wsdl/ver10/replay.wsdl` |
| `http://www.onvif.org/ver10/receiver/wsdl` | `ReceiverPort` | `onvif:wsdl/ver10/receiver.wsdl` |
| `http://www.onvif.org/ver10/media/wsdl` | `Media` | `onvif:wsdl/ver10/media/wsdl/media.wsdl` |
| `http://www.onvif.org/ver20/media/wsdl` | `Media2` | `onvif:wsdl/ver20/media/wsdl/media.wsdl` |
| `http://www.onvif.org/ver20/analytics/wsdl` | `AnalyticsEnginePort`, `RuleEnginePort` | `onvif:wsdl/ver20/analytics/wsdl/analytics.wsdl` |
| `http://www.onvif.org/ver10/events/wsdl` | `EventPortType`, `PullPointSubscription` | `onvif:wsdl/ver10/events/wsdl/event.wsdl` |
| `http://docs.oasis-open.org/wsn/bw-2` | `SubscriptionManager` | `oasis-wsn-bw-2` |
| `http://www.onvif.org/ver10/device/wsdl` | `Device` | `onvif:wsdl/ver10/device/wsdl/devicemgmt.wsdl` |

`Renew` is on the imported OASIS SubscriptionManager port, not an invented
EventPortType operation. PullMessages and Event SetSynchronizationPoint use
PullPointSubscription. Media2 SetSynchronizationPoint uses Media2. The
namespace plus port type matters even when operation names match.

The lock pins ONVIF release 26.06 to commit
`68ee1b540a40f848c9599eba2c55b87547c588d6`. The observed tag includes the August
correction, not proof of the original July tag contents. Individual schema
versions remain different: Recording/Receiver/Media2 26.06, Search 2.4.2,
Replay/Media1 21.06, Analytics 20.12, Event 24.12, metadata/onvif types 25.12,
common types 25.06, human-face types 24.06 and human-body types 25.06.

The 17 retained topic paths occur in the profile tables, but `topicns.xml` is
explicitly a placeholder. XML syntax/name resolution is not verification of
an absent complete topic tree or all event payload specifications. The ledger
does not invent a locked source ID for supplemental research prose.

## Unresolved interpretations and release boundary

| Issue | Affected atoms | Retained evidence |
| --- | --- | --- |
| `profile-g-settrackconfiguration-condition` | 2 | G 9.2.1, PDF 15, conditional track-description update; G 9.2.3, PDF 16, device M table row. The existing editorial decision remains unresolved. |
| `gm-g-onboard-metadata-prose-table` | 14 | Seven device optional prose operations in 9.1.4.1 versus seven M* table operations in 9.1.4.3. |
| `gm-g-onboard-audio-source-prose-table` | 16 | Eight device optional prose operations versus eight M** audio-source table operations. |
| `gm-g-onboard-audio-encoder-prose-table` | 14 | Seven device optional prose operations versus seven M** audio-source table operations. |
| `gm-g-job-configuration-topic-device` | 1 | G device configuration-change prose includes jobs, but the table does not identify an exact job-configuration topic. |
| `gm-g-job-configuration-topic-client` | 1 | Corresponding client job-configuration notification, with its own provisioning condition and no invented topic. |

Every affected ID is listed in `coverage.unresolved[].requirementIds`; native
actions are retained, not arbitrarily removed. Client optional prose versus
conditional on-board table entries is recorded separately: optional feature
support does not excuse omitting its native interface when the feature exists.
M's copied client banners and plate-recognition wording retain their source
locators and explicit interpretation.

The compiler/model registry can consume the rows and crosswalk later; this
work does not edit its schemas, indexes, native runtime or generated models.
It does not publish packages, source documents, profile symbols or conformance
claims. Original source notices and the
[existing legal/source-policy gates](onvif-sources.md) remain in force; no
first-party license or upstream document is changed.
