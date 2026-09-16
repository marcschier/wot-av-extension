# WoT media/workload vocabulary: reuse and conformance boundaries

Research date: 14 September 2026. Baseline: **WoT Thing Description 1.1, W3C
Recommendation, 5 December 2023**. The namespace `https://example.org/wot/av#`
and deliberately unregistered `av` prefix remain experimental. Names below are
conditional alignment examples, not a replacement for the core vocabulary,
TD examples, or lifecycle design being developed separately.

## 1. Dependency decision and bounded findings

Use **TD 1.1, PROV-O, and selected Dublin Core Terms** as the small semantic
dependency set. Keep Media Ontology and SOSA alignments optional; neither should
be an unconditional import for every controller. Media Fragments supplies
selector syntax, not workload management. Schema.org is an outward-publication
option; QUDT is unnecessary until heterogeneous quantities require it.
RDF/RDFS/XSD supply representation machinery; SHACL supplies a separate validation
contract. Reusing external IRIs does not require blindly importing every associated
ontology or requiring consumers to perform unrestricted OWL reasoning.

The TD Recommendation includes a `takePhoto` action returning JPEG, but that is
an **example, not a camera profile**.[^td] The examined November 2025 WoT Profiles
Working Draft defines HTTP Basic, SSE, and Webhook profiles.[^profiles]
The May 2024 Binding Templates catalog lists HTTP, CoAP, MQTT, Modbus, and BACnet,
with an unstructured-payload binding marked planned; it supplies no RTSP or
camera-specific profile in those tables. The core Binding Templates document was
subsequently retired in November 2025.[^bindings] This establishes a bounded
documentation finding, not exhaustive absence or novelty. Neither TD 2.0 work
nor Profiles drafts become adopted dependencies through this proposal.


## 2. Reuse/avoid matrix

| Surface | Reuse | Avoid |
|---|---|---|
| Device/controller interface | `td:Thing`, Property/Action/Event Affordances, existing TD identity, titles, descriptions, security | New equivalents of Thing, action, endpoint security, or ordinary metadata |
| Interaction and data shape | `hctl:Form`, `hctl:Link`, `jsonschema:DataSchema`; TD `href`, `contentType`, `op`, input/output | Treating a resource link as an executable operation or a codec as a MIME type |
| Execution evidence | PROV Entity/Activity/Agent and existing provenance relationships | Equating planned assignments with executions or model files with agents |
| Actual image/A/V content | Media Ontology resources, tracks, format/compression, duration | Equating content with its offer, connector, lease, or access conditions |
| Sensing | SOSA Observation/Sensor/Procedure when their definitions fit | Making every relay, replay source, or processor a sensor |
| Metadata/publication | Dublin Core license, creator, publisher, version and conformance links | Duplicated `av` metadata or conformance links treated as certificates |
| Segment addressing | Media Fragments temporal selectors | Treating selectors as clip-generation commands or transport guarantees |

The interface rows follow TD's distinct interaction, hypermedia, and data-schema
vocabularies; subsequent sections qualify the remaining alignments.[^td]

## 3. Precise one-way alignments

For appropriately defined local concepts, the following are defensible
**proposed axioms**, using the external namespaces defined by the cited sources:

```turtle
av:Execution rdfs:subClassOf prov:Activity .
av:ModelArtifact rdfs:subClassOf prov:Entity .
av:ResultArtifact rdfs:subClassOf prov:Entity .
av:usedModel rdfs:subPropertyOf prov:used .
av:producedArtifact rdfs:subPropertyOf prov:generated .
av:SchemaFormat rdfs:subClassOf dcterms:Standard .
```

The property directions matter: execution-to-model for actual usage;
execution-to-artifact for actual production. Prefer the existing PROV properties
directly unless a narrower application relationship genuinely improves querying.
These implications do not run backwards: not every PROV Activity is a workload
execution. Do not add broad `owl:equivalentClass`, `owl:equivalentProperty`, or
`owl:sameAs` assertions merely because descriptions look similar.[^owl]

PROV's Entity covers versioned weights, datasets, stills, clips, and result
documents; Activity covers actual training, capture, transcoding, or inference.
A responsible running software component may be a `prov:SoftwareAgent`; its
binary or learned weights are not agents just because software consumes them.
Use `prov:wasGeneratedBy` from output to execution, `prov:used` from execution
to inputs, and `prov:wasDerivedFrom` from derived output to source entity.
`prov:wasAssociatedWith` connects execution to responsible agent;
`prov:wasAttributedTo` connects entity to agent. Add qualified associations,
roles, or plans only when their extra detail is needed.[^prov]

Do not emit those execution assertions for a desired input, candidate match, or
unstarted assignment. Versioned request/assignment records may themselves be
Entities; a cancelled-before-start assignment need not denote an Activity.
`prov:Plan` fits intended steps, not an arbitrary needs record. PROV describes
provenance, not this design's assignment state machine.[^prov]

**Schema format is a standard, not an artifact.** If retained, `av:SchemaFormat`
should identify an established schema language/dialect. A particular schema
document is a separate Entity and can `dcterms:conformsTo` that standard.
Keep its document location separate from the standard identifier and from the
model/result artifact it validates. Dublin Core defines Standard as a reference
point for evaluation and `conformsTo` as a relationship to an established
standard; neither statement performs validation.[^dc]

## 4. Media, sensing, metadata, and units

The Media Ontology's Media Resource includes URI-identifiable physical or logical
resources, including abstract content and particular encodings. Live content
can fit; this is not an ontology restricted to completed files. Nevertheless,
an offer or access endpoint is not thereby the content. Model representation,
track, and access-offer identities separately.[^media]

In an optional media alignment, a local class restricted to actual image/A/V
artifacts can subclass both `prov:Entity` and `ma:MediaResource`; a still-image
artifact can more specifically subclass `ma:Image`. An independently generated
clip is not automatically identical to a fragment of its source. Use derivation
for the new artifact and fragment identity for the referenced subpart.
JSON detection results and model weights are not necessarily media resources.

Use the **RDF terms**, not guessed versions of the tabular API labels:
`ma:hasTrack`, `ma:hasCompression`, `ma:hasFormat`, `ma:duration`,
`ma:locator`, and `ma:createdIn`/`ma:hasRelatedLocation`. Compression and format
are object properties; locator is an `xsd:anyURI`-valued datatype property,
not automatically an RDF resource link. Location describes a related place,
including shooting location, not an RTSP address. Duration means actual seconds,
not maximum acceptable clip length or connection lifetime. Leave unknown
live duration unknown rather than inventing zero.[^media]

For a referenced interval, `video.mp4#t=npt:10,20` denotes the half-open interval
`[10,20)`. The basic Recommendation specifies normal play time; SMPTE and
wall-clock formats belong to its advanced work. A fragment does not itself
create a new clip or promise frame-accurate seeking. Clients may resolve it
locally or map it to retrieval requests; do not assume the fragment is sent
unchanged as a server instruction.[^fragments]

SOSA fits observations with a meaningful feature of interest, observable
property, procedure, and result. A class specifically denoting physical sensing
cameras can subclass `sosa:Sensor`; a generic camera connector should not.
SOSA also explicitly permits software/virtual sensors, so a processor estimating
a real-world property may qualify. Pure routing, storage, or re-encoding does
not establish that fit. SSN's capability module is useful for metrological
capabilities under conditions, not a general codec/assignment vocabulary.[^sosa]

Reuse `dcterms:creator`, `publisher`, `license`, `isVersionOf`, and `references`
on artifacts where appropriate; retain TD metadata on Things. Distinguish
licensing from authorization.[^dc] Optional Schema.org publication can use
MediaObject's `contentUrl` for media bytes and `encodingFormat` for representation
format, not a controller action URL. Its duration representation differs from
MA's numeric seconds; avoid automatic property equivalence.[^schema]

Specify units and conversions in the matching contract. MA already fixes duration
to seconds, frame rate to frames/second, sampling rate to samples/second, and
average bitrate to **kilobits/second**, not bits/second.[^media] Do not add QUDT
solely for those quantities. Consider a separately versioned quantity module
only if consumers exchange heterogeneous units or measurement uncertainty.
SSN explicitly leaves quantity-value modeling to external vocabularies and
mentions QUDT without mandating it.[^sosa]

## 5. Advertisement, acceptance, and observation

Keep three distinct assertion layers: **advertised capability**, **acceptance
criteria**, and **observed execution**. A supported encoding is not evidence it
was selected; a requested frame rate is not an achieved measurement. Keep
correlated alternatives together: independently listed codec, resolution, and
rate sets must not accidentally advertise their unsupported Cartesian product.

A matcher needs specified quantifiers, hard versus preferred constraints,
unit normalization, missing-information handling, and tie-breaking. An absent
capability is unknown under open-world semantics, not automatically false.
A controller may explicitly reject missing evidence for a hard requirement;
that is a closed-world acceptance rule, not an ontology entailment.[^owl]

Reuse TD DataSchema at its defined locations: Property values, Action
input/output, Event payloads, and URI variables. `DataSchema` is a class,
not a universal `dataSchema` member. JSON schemas do not automatically describe
JPEG, model weights, or native frame buffers without a representation mapping.
If an action returns a job descriptor containing a media URL, its output schema
describes that descriptor, not the referenced bytes. TD's JPEG-returning photo
example illustrates this boundary.[^td]

TD 1.1's `op` vocabulary is closed: use `invokeaction`, not invented `av` operation
verbs. `additionalResponses[].schema` names a local `schemaDefinitions` entry,
not an external schema artifact. Lowercase `schemaformat` is not a TD 1.1 core
member. An external schema link therefore needs an application contract naming
the validating document, dialect/version, and payload location; neither a link
nor a MIME-type hint supplies that contract.[^td]

## 6. Publication and conformance deliverables

Publish a governed persistent namespace before production, leaving this example
namespace explicitly provisional. Use stable term IRIs, immutable release
contexts, versioned ontology/specification artifacts, change/deprecation policy,
and normative dependency versions. Separate conformance targets for vocabulary
publication, annotated TDs, controller payloads, matchers, and protocol adapters.
Avoid an undifferentiated claim of being "av compliant."

An ontology can express cardinality axioms, but it does not enforce required
JSON members under closed-world rules. Domain/range assertions infer types;
they are not JSON validation instructions.[^owl] SHACL validates a chosen RDF
data graph against shapes. Specify graph boundaries and entailment assumptions;
full RDFS inferencing is not required of every SHACL processor.[^shacl]

| Artifact | Meaningful vocabulary-design deliverable | Separate commitment |
|---|---|---|
| Human specification | Definitions, assertion layers, normative requirements, exclusions, conformance targets | Native-operation behavior |
| JSON-LD context | Exact term/IRI, datatype, language, and collection mappings | Neither payload validation nor deployment availability |
| Turtle ontology | Classes/properties, conservative one-way axioms, metadata, optional alignments | No implicit closed-world completeness |
| SHACL node shapes | Required links, value types, counts, alternatives, scoped closed shapes | Transport behavior and controller execution |
| Controller payload schemas | Versioned envelope/result schemas tied to defined application points | Final API/lifecycle choices owned by the controller profile |
| Protocol binding specifications | Required profile sections and explicit gaps | Concrete native and network interoperability rules |
| Test vectors | Expansion, graph/payload validation, matching decisions and negative cases | Live exchange, timing, recovery, and adapter tests |

For GigE Vision, USB3 Vision/UVC, and RTSP access, profiles must settle adapter
placement, discovery/control mapping, negotiation, representations, frame
boundaries, timestamps, authentication, errors, and session lifetime. A connector
family label cannot settle these choices. HTTP access also needs method,
header/status, streaming-framing, and failure rules. These are proposed profile
requirements, not verified claims about native protocol specifications examined
here.[^bindings] Static conformance artifacts can accompany the vocabulary once
terms stabilize; end-to-end interoperability requires those separate profiles.

## 7. Interoperability traps to make testable

Preserve the TD 1.1 context and explicitly bind `av`; reject duplicate JSON
members and conflicting prefix definitions. Extend an existing `@type` into
one array without dropping prior types or writing a second `@type` key.
Preserve exact namespace IRIs, including HTTP versus HTTPS.

Ordinary multi-value JSON-LD arrays do not imply ordered RDF collections.
Use explicit list mappings for ordered extension sequences, such as channel
order; keep alternatives as sets. Do not reinterpret TD `forms` ordering as
preference: the TD context uses a set and consumers may choose a compatible
Form. Context composition itself is order-sensitive.[^td]

Test the **publisher TD versus directory-returned TD** distinction. Discovery
permits enrichment, including registration metadata, and requires assigning an
identifier to returned anonymous TDs. Therefore a digest of enriched directory
content is not necessarily a digest of publisher content. Define covered bytes
or graph, canonicalization, context versions, and whether enrichment is excluded.
Canonicalization does not remove additional statements.[^discovery]

This deliverable is research, not a generated or certified conformance bundle.
No validator availability probes, installations, account access, private-data
submission, or media execution were needed.

## Primary sources

[^td]: W3C, [Thing Description 1.1, Recommendation, 2023-12-05](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form). Sections 5.3.1-5.3.4, especially Data Schema, Link, Form, AdditionalExpectedResponse; 6.3.9.3 "Response"; 6.5 validation; 7.1 semantic annotations.

[^profiles]: W3C, [WoT Profiles, Working Draft, 2025-11-04, Abstract](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#abstract): HTTP Basic, HTTP SSE, and HTTP Webhook profiles. Draft status is not adoption.

[^bindings]: W3C, [Binding Templates, Group Note, 2024-05-28](https://www.w3.org/TR/2024/NOTE-wot-binding-templates-20240528/#protocol-bindings-table), sections 4.1.3, 4.1.5, 4.2.4; [2025-11-04 retirement notice, Status](https://www.w3.org/TR/2025/NOTE-wot-binding-templates-20251104/#sotd).

[^prov]: W3C, [PROV-O, Recommendation, 2013-04-30, Starting Point Terms](https://www.w3.org/TR/2013/REC-prov-o-20130430/#description-starting-point-terms), sections 3.1-3.3: Entities, Activities, Agents, expanded terms, qualified associations.

[^media]: W3C, [Ontology for Media Resources 1.0, Recommendation, 2012-02-09](https://www.w3.org/TR/2012/REC-mediaont-10-20120209/#core-property-definitions), sections 3, 5.1.2 and 7.3 "RDF ontology"; the latter identifies the authoritative RDF/OWL representation and its actual term names.

[^fragments]: W3C, [Media Fragments URI 1.0 (basic), Recommendation, 2012-09-25, Temporal Dimension](https://www.w3.org/TR/2012/REC-media-frags-20120925/#naming-time), sections 3.2, 4.2.1 and 6.1.1.

[^sosa]: W3C/OGC, [Semantic Sensor Network Ontology, Recommendation, 2017-10-19](https://www.w3.org/TR/2017/REC-vocab-ssn-20171019/#SOSASensor), sections 4.3.2, 4.8.2.1, 5.1; non-normative PROV alignment in 6.5 and unit guidance in 7.3.

[^dc]: DCMI, [Metadata Terms, Recommendation, 2020-01-20](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/#http://purl.org/dc/terms/Standard), "Standard"; section 2 entries "conformsTo", "license", "creator", "publisher", "isVersionOf", and "references".

[^schema]: Schema.org, [MediaObject, Properties from MediaObject](https://schema.org/MediaObject), entries "contentUrl", "encodingFormat", and "duration", accessed 2026-09-14. Living vocabulary documentation, not a W3C Recommendation or a WoT profile.

[^owl]: W3C, [OWL 2 Primer, Second Edition, 2012-12-11](https://www.w3.org/TR/2012/REC-owl2-primer-20121211/#What_is_OWL_2.3F), section 2 on open-world semantics and syntax validation; sections 4.2, 4.5-4.8 on implication, equivalence, domain/range, and datatypes. Informative explanatory document.

[^shacl]: W3C, [SHACL, Recommendation, 2017-07-20](https://www.w3.org/TR/2017/REC-shacl-20170720/#shacl-rdfs), sections 1.5, 2.2, 3 and 4: inference policy, node shapes, validation, cardinality, and closed-shape constraints.

[^discovery]: W3C, [WoT Discovery, Recommendation, 2023-12-05, Directory Information Model](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-info), sections 7.3.1-7.3.2.1.2 on enrichment and identifiers; 7.3.2.1.6 on TD validation.
