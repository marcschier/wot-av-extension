# WoT media vocabulary: TD and JSON-LD publication foundations

Research date: 2026-09-14. Scope: extension conformance, annotation placement, native-Form references, context design, and reference/version integrity. This is design evidence, not a repository change or a complete transport specification.

## 1. Baseline and publication contract

**Publish an additive TD 1.1 vocabulary, not a replacement endpoint model.** The baseline is the W3C Recommendation dated 2023-12-05. TD 2.0 and WoT Profiles dated 2025-11-04 are Working Drafts; Binding Templates dated 2025-11-04 explicitly retires its main document and points to successor binding work. Do not silently promote draft capabilities into TD 1.1 conformance.[^baseline]

The deliberately **unregistered** namespace is `https://example.org/wot/av#`; `https://example.org/wot/av/context/v1` is a **separate, unhosted context-URL placeholder**. Neither represents an existing W3C vocabulary. All proposed names below are original to this design.

The publication package should contain normative term definitions, dereferenceable RDF/RDFS plus human-readable documentation, a versioned JSON-LD context, versioned validation contracts, and a separately identified application profile with executable conformance requirements. A context maps syntax; it does not publish the ontology's subclass axioms or establish operational interoperability.[^context-usage]

Declare `MediaSource`, `Connector`, `Processor`, and `Controller` as non-disjoint subclasses of `td:Thing`. Retain `Offer`, `Mode`, `Track`, `Need`, `InputRequirement`, `Assignment`, `AssignmentStatus`, `MediaAsset`, `InferenceModel`, `ResultContract`, and `ProcessingRun` as domain classes; do not automatically make every instance a Thing. **Assignment means an accepted need-to-offer arrangement, not a WoT protocol binding.**

## 2. Annotation surfaces and core conformance

TD conformance is defined by normative Sections 5 and 6. Section 7 explains extensions but is explicitly informative. Its permission to annotate any class instance agrees with the non-closed information-model constraints and deliberately extensible validation schema; it does not authorize changing mandatory core members or operation semantics.[^extension]

Keep the TD 1.1 URI in `@context`, followed by AV extensions. Where TD 1.0 Consumers are possible, the specified order is TD 1.0 first, TD 1.1 second, then extensions.[^identity]

| Surface | Suitable proposed annotation | Boundary |
|---|---|---|
| Thing | `@type: av:MediaSource`, links to offers, needs, assets, runs | `id` identifies the Thing; native `profile` identifies claimed profile conformance. |
| Property affordance | Representation/contract relationships and invariant media characteristics | A Property is also a DataSchema; retain read/write/observe semantics. |
| Action affordance | Domain meaning of configuration, admission, or processing actions | Retain `invokeaction`, `queryaction`, `cancelaction`; annotate input/output schemas separately. |
| Event affordance | Domain meaning of status/result notifications | Retain subscribe/unsubscribe semantics and distinguish subscription, event-data, and response schemas. |
| Form | Native node identity, media direction, binding-specification IRI | Keep target, operation, security, representation, and protocol-specific fields here. |
| DataSchema | Units and relationships to an input/result contract | An annotation describes the schema node; it does not automatically type runtime payload instances. |

These distinctions follow the core class definitions. For example, putting `@type: av:Assignment` on an action would assert that the **action itself** is an Assignment, not that its output represents one. Use an explicit domain relationship where that is the intended meaning.[^classes]

The `op` vocabulary is closed, including restrictions by containing affordance. Do not introduce `av:stream`, `publishmedia`, or arbitrary IRI operation values. Additional transport information uses binding-vocabulary annotations, not an invented unqualified TD `protocol` field. A proposed `av:binding` can reference a binding specification by IRI; native Thing-level `profile` is reserved for an actual conformance claim, not a bag of supported transport names.[^forms][^profiles]

## 3. Direction, signaling, and xRegistry projections

**Prefer Form-level `av:mediaDirection`** when a binding identifies one media direction: `av:FromThing` means media leaves the addressed Thing; `av:ToThing` means media enters it. This is a proposed media semantic, not the direction of the HTTP request, subscription message, or signaling exchange. Affordance-level direction can be an explicitly specified invariant default only when every applicable media Form agrees. Mixed read/write or negotiation affordances must not acquire a misleading single direction.

There is no universal bidirectional value. Where one signaling Form negotiates multiple media legs, require binding-defined leg identification and directed track/offer descriptions; do not manufacture incompatible WoT operations merely to split the signaling transaction. Resolve the concrete media leg before accepting an Assignment.

Under the coordinator's supplied xRegistry correction and client-relative usage convention, `FromThing` projects to endpoint `usage: ["consumer"]`; `ToThing` projects to `["producer"]`. Reuse standard xRegistry endpoints for fixed-format media protocols **without requiring messages, messagegroups, or envelopes**, and express protocol-dependent constraints through `ifvalues`. These are projection constraints supplied to this task, not new W3C assertions. No competing `av:Endpoint` or media-address object is needed.

`contentType` describes the representation actually exchanged by its Form. A JPEG read uses `image/jpeg`. JSON camera settings followed by JPEG bytes use Form `contentType: application/json` and `response.contentType: image/jpeg`, as the Recommendation itself illustrates. An SDP response remains `application/sdp`: it is not the codec or MIME type of subsequently negotiated media. The binding must connect that signaling interaction to the media access. `contentMediaType`/`contentEncoding` describe, for example, an image embedded in a base64 JSON string, not raw media transported elsewhere.[^payload]

## 4. Native Form references: identity is not an address

The identifiers must remain distinct:

- **Thing `id`:** optional core identifier, aliased to JSON-LD `@id`; it may be a URN and need not retrieve a TD.
- **Form `@id`:** the RDF/JSON-LD identity of one native Form node, distinct from its submission target.
- **TD document URL:** an explicitly known retrieval location for a particular description or representation.
- **Form `href`:** the actual submission target, potentially a URI template or relative to TD `base`.
- **Fragment, version, digest:** respectively a selector/identifier component, a publisher's version label, and an integrity pin with a specified hashing procedure.[^identity][^native-context]

**A Form may carry JSON-LD `@id` as an extension-compatible annotation.** It is not a member of the TD 1.1 core Form signature. The official schema permits additional Form members, and the supplied example passes that schema and JSON-LD expansion. However, TD 1.1 does **not** define a stable Form-identifier service, mandate preserving that annotation through transformations, or require generic Consumers to resolve it. Stability must be an explicit application-profile guarantee, not an inference from schema acceptance.[^extension][^form-schema]

A separate profile-defined identifier property could be a lookup key, but would not itself establish JSON-LD node identity. Prefer requiring standard `@id` rather than creating a second identifier vocabulary. JSON-only implementations can string-match it under the same profile rules.

Recommended named-Form contract: mint an absolute, unique Form `@id`; preserve it while the identified access retains its meaning; never derive it solely from array position or mutable `href`. Put only a link such as `av:form` in each Offer. **Do not copy `href`, `op`, `security`, or protocol parameters into the Offer.** A Form can share a target with another Form while differing in operation, content, or security; matching by target alone is insufficient.[^forms]

Resolution should be specified as follows:

1. Obtain an explicit TD document location, independently of the Thing/Form identifiers. For durable references, an external Assignment/reference record carries proposed `av:tdDocument`, `av:expectedThing`, `av:tdInstanceVersion`, and `av:sha256` pins.
2. Retrieve the description and verify the selected representation, expected Thing identity, version, and digest before resolving access. Define `av:sha256` as lowercase SHA-256 of exact representation octets after HTTP content decoding, without whitespace normalization. A digest provides integrity, not publisher authenticity.
3. Locate the native Form whose absolute `@id` equals `av:form` within native `forms` arrays; require one unambiguous defining occurrence and a compatible operation/binding. Resolve native defaults, inherited security, URI variables, and TD `base` in the original TD context, retaining the effective retrieval URI. Domain metadata is never the operational authority.
4. For existing TDs without named Forms, allow an explicit `av:jsonPointer` string, for example `/properties/latest/forms/0`, together with the document/digest pins. Resolve against that exact JSON representation. If both selectors are supplied, require agreement.
5. Fail on missing, ambiguous, or mismatched references. Do not substitute a latest/default version, first Form, or similarly named endpoint.

The JSON Pointer fallback is **profile-defined reference machinery**, not a new endpoint object. Do not claim that `tdURL#/properties/latest/forms/0` automatically works as a native TD fragment: RFC 6901 requires a media type to define pointer fragments explicitly; TD's media-type registration only delegates to the generic `+json` rules. TD does explicitly define JSON Pointer syntax for **Thing Model `tm:ref`**, but that import feature is not a runtime Form-reference facility.[^fragments]

Forms are semantically a set in the official context, so expansion/compaction can destroy positional assumptions. Absolute named nodes survive reordering if preserved; numeric pointers require the pinned original serialization. Keep a whole-document digest **outside the document being digested** to avoid a self-reference problem.[^native-context]

## 5. Versioning and directory enrichment

Keep vocabulary release, context-document version, application-profile version, TD `version.instance`, and TM `version.model` independent. The latter describes the underlying **Thing Model**, not learned weights. An `InferenceModel`, its external files, and a `ResultContract` need their own artifact revisions and digests. A TD can link to its TM using `links` with `rel: "type"`; TD 1.1 permits at most one such TM relationship. Version labels alone do not establish immutability.[^versions]

Keep term meanings stable; publish a new term or namespace for incompatible semantics. Pin the context content used by semantic processing as well as the TD bytes: identical JSON interpreted under changed context definitions can mean something different. Preserve old context/profile releases and define deprecation explicitly.[^context-usage]

A TDD response is not necessarily byte-identical to the publisher's TD. Enriched TDs carry the Discovery context and registration metadata, including potentially retrieval time. A directory also adds a local `id` when exposing an anonymous TD. Directory retrieval URLs and those identifiers are different resources. Prefer non-anonymous source TDs for durable assignments; record provenance and whether a pin identifies publisher bytes or an enriched snapshot. Never silently strip directory fields and claim the original digest still applies.[^discovery]

## 6. Context pattern and scalar discipline

This is the proposed **external context document**, not a replacement TD context. It defines only `av` terms and never resets core `@vocab`, `id`, `type`, `forms`, or `security`. Use full datatype IRIs rather than redefining existing prefixes.

```json
{
  "@context": {
    "@version": 1.1,
    "@protected": true,
    "av": {"@id": "https://example.org/wot/av#", "@prefix": true},
    "av:offers": {"@id": "av:offers", "@type": "@id", "@container": "@set"},
    "av:form": {"@id": "av:form", "@type": "@id"},
    "av:tracks": {"@id": "av:tracks", "@type": "@id", "@container": "@set"},
    "av:pipeline": {"@id": "av:pipeline", "@type": "@id", "@container": "@list"},
    "av:binding": {"@id": "av:binding", "@type": "@id"},
    "av:mediaDirection": {"@id": "av:mediaDirection", "@type": "@id"},
    "av:processingRun": {"@id": "av:processingRun", "@type": "@id"},
    "av:rate": "av:rate",
    "av:numerator": "av:numerator",
    "av:denominator": "av:denominator",
    "av:enabled": "av:enabled",
    "av:observedAt": {
      "@id": "av:observedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
    },
    "av:tdDocument": {"@id": "av:tdDocument", "@type": "@id"},
    "av:expectedThing": {"@id": "av:expectedThing", "@type": "@id"},
    "av:jsonPointer": {
      "@id": "av:jsonPointer", "@type": "http://www.w3.org/2001/XMLSchema#string"
    },
    "av:tdInstanceVersion": {
      "@id": "av:tdInstanceVersion", "@type": "http://www.w3.org/2001/XMLSchema#string"
    },
    "av:sha256": {
      "@id": "av:sha256", "@type": "http://www.w3.org/2001/XMLSchema#string"
    },
    "av:opaqueContract": {"@id": "av:opaqueContract", "@type": "@json"}
  }
}
```

Use absolute instance IRIs and controlled values `av:ToThing`/`av:FromThing`. With `@type: @id`, bare `FromThing` is document-relative, **not** a vocabulary value. `@vocab` coercion has different expansion behavior. TD `base` does not establish the JSON-LD base, and an external context is not a portable place to set `@base`. Coercion depends on the literal property-key spelling: replacing `av:form` with its equivalent full-IRI key does not automatically reuse that term's coercion. Standardize compact keys or use explicit `@id` objects.[^identity][^jsonld-ids]

`@set` is appropriate for unordered offers/tracks; it is not a uniqueness validator. `@list` preserves transformation order, including repeated stages. Keep rational rates as exact native JSON integers, for example numerator `30000` and denominator `1001`; validate positivity, denominator nonzero, and application bounds separately, and define the rate's units. Keep booleans/numbers native, not quoted. Date coercion supplies a datatype, not lexical/timezone validation; the profile should require timezone-bearing timestamps.[^jsonld-values]

An opaque JSON contract needs `@json` to preserve uncontextualized keys and nulls; a semantically exposed DataSchema instead needs mapped properties.[^jsonld-values] Crucially, the TD context already supplies default vocabularies: misspelled bare keys can become unintended TD/hypermedia/schema IRIs rather than disappear. Prefix every domain key and validate the vocabulary whitelist. Protected terms reduce accidental redefinition but property-scoped contexts can override them; protection is not a validation or security boundary.[^native-context][^jsonld-protection]

## 7. Minimal TD and demonstrated expansion

The standalone specimen uses a simple inline prefix map and explicit `@id` value objects. This avoids a portability trap: the currently served TD schema rejects the richer inline context above, although the publication-time schema accepts it. This is an observed validation-artifact constraint, not a general JSON-LD prohibition. An external context URL is accepted; complex definitions belong in its separate document. With that context loaded, the two explicit links below can equivalently use scalar strings.

```json
{
  "@context": [
    "https://www.w3.org/2022/wot/td/v1.1",
    {"av": "https://example.org/wot/av#"}
  ],
  "id": "urn:uuid:755334ac-a484-43b1-bdc5-10b5de22c195",
  "@type": ["td:Thing", "av:MediaSource"],
  "title": "Example camera",
  "version": {"instance": "17"},
  "securityDefinitions": {"none": {"scheme": "nosec"}},
  "security": ["none"],
  "av:offers": [{
    "@id": "https://example.org/offers/camera-1/latest",
    "@type": "av:Offer",
    "av:form": {"@id": "https://example.org/things/camera-1/forms/latest"}
  }],
  "properties": {
    "latest": {
      "title": "Latest image",
      "readOnly": true,
      "forms": [{
        "@id": "https://example.org/things/camera-1/forms/latest",
        "href": "https://media.example.org/camera-1/latest.jpg",
        "op": "readproperty",
        "contentType": "image/jpeg",
        "av:mediaDirection": {"@id": "av:FromThing"}
      }]
    }
  }
}
```

This describes public example JPEG bytes, not a deployed camera or production security recommendation. DataSchema `type` is optional; no fictitious binary JSON type is introduced. HTTP `readproperty` defaults to GET. Here the externally recorded TD retrieval location is `https://example.org/descriptions/camera-1/17`, deliberately different from all identifiers and the media target.[^classes][^http]

The following are extracted subobjects from actual expansion, not the complete expanded TD:

```json
[
  {
    "@id": "https://example.org/offers/camera-1/latest",
    "https://example.org/wot/av#form": [
      {"@id": "https://example.org/things/camera-1/forms/latest"}
    ]
  },
  {
    "@id": "https://example.org/things/camera-1/forms/latest",
    "https://example.org/wot/av#mediaDirection": [
      {"@id": "https://example.org/wot/av#FromThing"}
    ],
    "https://www.w3.org/2019/wot/hypermedia#hasOperationType": [
      {"@id": "https://www.w3.org/2019/wot/td#readProperty"}
    ],
    "https://www.w3.org/2019/wot/hypermedia#hasTarget": [{
      "@type": "http://www.w3.org/2001/XMLSchema#anyURI",
      "@value": "https://media.example.org/camera-1/latest.jpg"
    }]
  }
]
```

The native target expands as an `xsd:anyURI` **literal**, while `av:form` is a node link. Confusing those two would defeat the proposed reference mechanism.[^native-context]

## 8. Validation boundaries and evidence

Keep RDF's open-world description model separate from closed admission validation. Publish versioned JSON Schema and/or SHACL contracts for the domain documents: allowed terms, required fields, direction enumeration, cardinality, rational values, unique identifiers, and reference integrity. SHACL provides `sh:closed` and explicit ignored properties; context expansion does not replace these constraints. Do not blanket-close TD core objects or contradict TD 1.1's rule that Consumers accept additional returned data.[^validation]

Executed with installed **PyLD 3.1.0** and **jsonschema 4.26.0**, without installation: the exact fenced TD passes both the publication-time and served TD Draft-07 schemas; its Form `@id` and links survive expansion. Replacing the inline map with the supplied context URL through a controlled in-memory loader, and using scalar `av:form`/`av:mediaDirection`, produces identical expansion. Numeric, boolean, datetime, ordered-list, opaque-JSON, and pointer-literal expansion were checked, including the accidental-relative-value and unknown-key traps. An invented `op` is rejected. The richer inline-context discrepancy is reported rather than bypassed.

The fetched canonical TD context matches the publication-time source structurally. The currently served schema identifies itself as `1.1-12-March-2025`, not the publication-time `1.1-09-November-2023`; relevant changes include tighter inline-context handling. Its fetched SHA-256 is `fd44f319f94c6f16f66978860ef2f9f4e0e9fd7fc5835a2f3840b9cf2002e0f1`; the context's is `9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069`.

This is structural and semantic-processing evidence, **not full WoT behavioral certification**. No live media endpoint, hosted example context, completed application profile, or domain SHACL contract was supplied. `pyshacl` is not installed, and no SHACL validation was performed. Their interoperability, deployment, and complete validation cannot yet be certified. TD distinguishes minimal, basic, and full validation explicitly.[^validation]

## 9. Primary sources and exact pins

[^baseline]: [TD 1.1 Recommendation, 2023-12-05, Conformance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#conformance); [TD 2.0 FPWD, 2025-11-04, Status](https://www.w3.org/TR/2025/WD-wot-thing-description-2.0-20251104/#sotd); [Profiles WD, 2025-11-04, Status](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#sotd); [Binding Templates retired Note, 2025-11-04, Status](https://www.w3.org/TR/2025/NOTE-wot-binding-templates-20251104/#sotd). TD source pin used throughout: `87808f1644ba79eb0a58d238385a8bd4a2236853`.

[^extension]: TD [5.2 Preliminaries](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#preliminary-definitions), [7.1 Semantic Annotations](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#semantic-annotations), and [Appendix B](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#json-schema-for-validation); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:2696-2737,10948-11002,15710-15754` at the TD pin.

[^classes]: TD [5.3.1.2 InteractionAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#interactionaffordance), [PropertyAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#propertyaffordance), [ActionAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#actionaffordance), [EventAffordance](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#eventaffordance), [DataSchema](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#dataschema); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:3757-3868,3874-3991,3995-4098,4306-4593`.

[^forms]: TD [5.3.4.2 Form, Tables 26-27](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form) and [6.3.9 forms](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-serialization-json); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:6569-6857,9883-9912`.

[^profiles]: [Profiles WD 4. Profiling Mechanism](https://www.w3.org/TR/2025/WD-wot-profile-20251104/#profiling-mechanism); TD [5.3.1.1 Thing](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing), `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:3314-3328`.

[^payload]: TD [6.3.9.3 response](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-response) and [6.3.9.5 contentMediaType and contentEncoding](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form-contentMediaType-contentEncoding); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:10160-10227,10331-10383`.

[^identity]: TD [5.3.1.1 Thing, id, base, and context-ordering rules](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:3040-3054,3166-3190`.

[^native-context]: [Pinned official TD context](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L380-L451): `w3c/wot-thing-description:context/td-context-1.1.jsonld:1-30,380-451`; served artifact: <https://www.w3.org/2022/wot/td/v1.1>.

[^form-schema]: [Pinned Form schema](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json#L335-L412), `w3c/wot-thing-description:validation/td-json-schema-validation.json:335-412`; maintained official artifact: <https://www.w3.org/2022/wot/td-schema/v1.1>.

[^fragments]: TD [12.1 application/td+json registration](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#media-type-section), [9.3.2 Extension and Import](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing-model-extension-import); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:14836-14838,12583-12617`; [RFC 6901 section 6](https://www.rfc-editor.org/rfc/rfc6901.html#section-6), [RFC 6839 section 3.1](https://www.rfc-editor.org/rfc/rfc6839.html#section-3.1).

[^versions]: TD [5.3.1.6 VersionInfo](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#versioninfo), [9.3.1 Versioning](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing-model-versioning), [9.4 Derivation of TD Instances](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#thing-model-td-generation); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:4103-4173,12383-12438,14025-14053`.

[^discovery]: Discovery Recommendation [7.3.1.1 Registration Information](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-registration-info), [7.3.1.3 Anonymous TD Identifiers](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-anonymous-td), [7.3.2.1.2 Retrieval](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#exploration-directory-api-things-retrieval); `w3c/wot-discovery:publication/6-rec/Overview.html:3245-3276,3473-3494,3872-3895`, commit `64c13d74466b5af68e7e56b2c9ce5ba35728bbdc`.

[^context-usage]: TD [Appendix D, JSON-LD Context Usage](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#json-ld-ctx-usage); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:16057-16171`. JSON-LD [3.1 The Context](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#the-context).

[^jsonld-ids]: JSON-LD 1.1 Recommendation [4.1.3 Base IRI](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#base-iri), [4.1.5 Compact IRIs](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#compact-iris), [4.2.3 Type Coercion](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#type-coercion); `w3c/json-ld-syntax:publication-snapshots/REC/Overview.html:3768-3773,3829-3834,4026-4034,5515-5528,5813-5816`, commit `a97d1d26648fea976298026a90e571f20ba889b7`.

[^jsonld-values]: JSON-LD [4.3.1 Lists](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#lists), [4.3.2 Sets](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#sets), [4.2.2 JSON Literals](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#json-literals); `w3c/json-ld-syntax:publication-snapshots/REC/Overview.html:5415-5435,6460-6463,6693-6705` at the syntax pin. JSON-LD API [Value Expansion](https://www.w3.org/TR/2020/REC-json-ld11-api-20200716/#value-expansion), `w3c/json-ld-api:publication-snapshots/REC/Overview.html:4582-4607`, commit `3e7fa5377b2b3c5176eacf8bde8e01fdb7c4a062`.

[^jsonld-protection]: JSON-LD [4.1.2 Default Vocabulary](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#default-vocabulary), [4.1.11 Protected Term Definitions](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#protected-term-definitions); `w3c/json-ld-syntax:publication-snapshots/REC/Overview.html:3621-3626,4901-4908,5016-5027,5099-5103` at the syntax pin.

[^http]: TD [8.3.1 Protocol Binding based on HTTP](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#http-binding-assertions); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:11790-11904`.

[^validation]: TD [6.5 Validation](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#validation-serialization-json), [8.2 Data Schemas](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#behavior-data); `w3c/wot-thing-description:publication/ver11/7-rec/Overview.html:10814-10871`. SHACL Recommendation [4.8.1 sh:closed, sh:ignoredProperties](https://www.w3.org/TR/2017/REC-shacl-20170720/#ClosedConstraintComponent).
