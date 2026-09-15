# One Still-to-BGR worked example, v0.1

**Outcome: a coherent conditional candidate, NOT an admitted media path.** The source, controller, hosts, backends, profiles and endpoints are hypothetical. No media request, controller invocation, decoding, camera operation or production observation occurred. All outputs are new `wot-av-example-v0.1` files in Temp; the supplied originals and repository are unchanged.

This example uses the supplied **38-class / 105-property formal inventory**, not the conflicting earlier examples. Exact inventory/context snapshots are retained for reproducibility. Additional H265/Opus codec IRIs are unnecessary here. The AV namespace remains a proposal; its context URL is unhosted and resolves only through the explicitly pinned local cache. [F,C]

## 1. One source, one complete request

The 62-line source TD describes one logical Thing with both `av:MediaSource` and `av:Connector` roles. Its self-referencing `av:connector`, host identity and versioned backend identity are explicit; this does not identify a physical camera with its host. One `av:Offer` contains one `av:Mode`, one `av:Track`, a configuration pin and a complete declared resource-use tuple. `av:offer`, `av:mode` and `av:track` are singular predicates. The Track directly carries `av:representation: av:EncodedVideo`, `av:codec: av:JPEG`, width 1280 and height 720; there is no VideoTrack subclass or intermediate Representation node. [F]

The native `snapshot` Property is read-only and non-observable. Its named Form uses **HTTPS GET / `readproperty`**, bearer authentication, and `contentType` plus `response.contentType` of **`image/jpeg`**. The payload is one complete JPEG byte representation, not JSON/base64; the Property intentionally omits JSON DataSchema `type`. The custom HTTP profile's `payloadType` is merely its own descriptive MIME field, not a TD/AV property. Tokens, issuer keys and credentials are absent. `jwt`/`ES256` are explicit scheme choices, not authentication proof. [T]

The complete Need requests **Still JPEG 1280x720 at the wire boundary, then contiguous BGR8 `[720,1280,3]` at application delivery**. It has `av:generation: 1`, `av:state: av:Active` and logical identity through `dcterms:isVersionOf`. Its InputRequirement is named `inspection`; both TrackRequirements use `dcterms:identifier: picture`, joining the wire and delivered boundaries. Integer constraints use `av:field` with equal `av:lowerInteger`/`av:upperInteger`; choices use `av:allowedValues`. `av:Decode` and `av:ColorConvert` are explicitly permitted. No resizing, model preprocessing, tensor contract, audio, FPS or freshness obligation is silently added. [F]

A latest-existing image can satisfy this **kind** of request without being a new exposure. Cache-control rules do not prove capture age. Repeated snapshot reads remain Still, and finite video remains Clip: neither can satisfy a Live Need. The source Form's `av:mediaDirection: av:FromThing` describes media leaving the addressed Thing; `av:binding` is an IRI and `av:locality` is Network. Delivery is local application memory, so no fictitious Processor sink Form or `av:ToThing` annotation is invented. Control Forms have no media direction.

Both TDs retain the native TD 1.1 context first and add the final AV context without resetting it. Every AV key is prefixed. Profile links use `describedby` with local-cache-resolved synthetic URNs, **not** top-level `profile` claims about unhosted standards.

## 2. Query the advertisement, not imagined readiness

The JPEG query executes against the expanded source TD in `urn:example:av-example:graph:source`, mapped to its exact PublisherTD pin. It returns exactly:

| Source | Mode | Native Form | Target |
|---|---|---|---|
| `urn:example:av-example:source` | `urn:example:av-example:mode:jpeg720` | `urn:example:av-example:form:snapshot` | `https://media.example.org/latest.jpg` |

The query follows **native `td:hasForm` membership** through the Thing/affordance, not an arbitrary similarly named AV node. `av:form` identifies the Form node; `hctl:hasTarget` is an **`xsd:anyURI` literal**, never the Form identity. Results are candidates for exact-pin retrieval and qualification, not Assignments. This named-graph layout is an explicit indexing convention, not a TDD-wide default guarantee. [C,D]

The separate Live query is for an actual Live catalogue: H264 1280x720 at exact 30/1 plus AAC mono 48 kHz, with both flat `av:Track` values in **the same Mode and graph**. Rational values use `av:numerator`/`av:denominator`; cross-multiplication rejects 30000/1001. This advertised cadence does not prove delivered FPS. A separate copied formal **synthetic Live fixture** supplies the query-positive control; it is not this JPEG source or a qualified live service.

Executed negatives return no match for Live versus the refreshed Still, Live versus a finite Clip, audio only in another Mode/graph, 30000/1001 versus 30/1, and a Form-shaped node outside native Forms. The last is deliberately malformed membership evidence, not a valid deployable TD.

## 3. Submit through ordinary TD affordances

The 105-line controller has exactly these native interactions:

| Semantic operation in the custom Control profile | TD affordance | Named Form suffix | Standard operation |
|---|---|---|---|
| `SubmitNeed:v1` | Action `submitNeed` | `form:submit` | `td:invokeAction` |
| `ReadStatus:v1` | read-only Property `status` | `form:status` | `td:readProperty` |
| `Release:v1` | Action `release` | `form:release` | `td:invokeAction` |

Semantic/form identifiers have prefix `urn:example:av-example:`; the semantic identifiers additionally contain `control:`. The pinned profile supplies their exact complete identifiers, parent TD pin, native schema pointers, methods and request/receipt rules. There are no invented AV Action/NeedRef/receipt classes. Native Form `op` tokens remain lowercase standard TD tokens. [C,T]

This complete **unsent fixture input** assumes prior generation 0; it does not assert a discovered current head:

```json
{"clientKey":"still-1-submit","expectedGeneration":0,"needPin":"urn:example:av-example:pin:need"}
```

These are profile-owned ordinary JSON fields. `needPin` resolves a canonical `av:DocumentPin` of the current worked Need, not an old Live Need. `assignmentPin(s)`, `statusPin` and `grantPins` reference pins of canonical Assignment, AssignmentStatus and LeaseGrant documents; `issues` references canonical Fault records. The resolver is a configured authenticated cache, not an invented universal URN HTTP API.

Standard DataSchema `oneOf`, `const`, `enum`, object requirements and array bounds make accepted receipts contain exactly one Assignment pin; rejected/uncertain receipts contain none and require issues. There is no `$ref`, `allOf`, `not`, `additionalProperties` or other unsupported JSON Schema shortcut. Cross-document semantics still require profile validation.

The custom contract defines compare-current installation, principal/controller/action-scoped retry keys, RFC 8785 request fingerprints, durable receipt-before-ack, an exclusive replay horizon, explicit errors and scoped draining. Only acceptance installs the new Need head; rejection leaves it unchanged. `recorded` release is not `av:Released` cleanup. Pending/proposed receipts, renew, result operations and events are explicitly unsupported; no long-poll contract is smuggled in. The saved rejection receipt is a **dated synthetic negative fixture**, not an invocation result. [J]

`status` returns an Assignment/status pin-reference envelope, **not** an abbreviated AssignmentStatus. A real referenced status must obey the complete formal record, four-condition, current-generation, observer, clock and grant rules. No Ready observation is produced here.

## 4. Pins, mapping roles and the admission stop

The external pin bundle uses canonical `av:DocumentPin` records: `av:document`, `av:documentKind`, exact representation-octet SHA-256 `av:hexDigest`, `dcterms:format`, and dependency `av:pin` edges. TD pins also carry `av:expectedThing`. No document embeds its own digest. Request JCS fingerprints are a different digest domain. Controller/profile dependency cycles are explicit and traversed cycle-safely. [F,J]

The complete Assignment file is a **counterfactual serialization / negative admission fixture**, not an accepted record. Its current worked Need pin and generation agree, and its mapping roles are:

| Canonical record | Maps |
|---|---|
| Assignment | exact Need revision, holder incarnation, controller Agent, pins and grant |
| InputSelection | InputRequirement, chosen InputAlternative, Offer, Mode and adapter configuration pin |
| TrackSelection | offered JPEG Track to same-name wire and delivered TrackRequirements |
| FormReference | source TD pin, named native Form, standard `td:readProperty`, and optional agreeing `/properties/snapshot/forms/0` pointer |

All **14 resolved worked-example pins** verify locally, including synthetic acquisition, resource, codec and adapter boundary descriptions. They are typed JSON descriptions, **not complete executable operational-profile schemas or external qualifications**; no conformance to their unhosted formal profile families is asserted.

The worked path's `urn:example:av-example:pin:qualification-missing` is explicitly unresolved. Its zero digest is a conspicuous negative-fixture sentinel, not a known checksum. Adapter and Assignment dependency resolution therefore fail with `DependencyUnavailable`; there is no qualification bypass. The illustrative grant expired in 2000; authoritative heads, real credentials, capacities, codec behavior and delivery remain unproved. The separate Live query fixture also has **four explicitly enumerated unresolved configuration pins**, plus its unqualified Connector/binding identities, listed separately in the manifest.

No xRegistry projection is emitted. A later projection would retain descriptors/pins, not collect every high-rate frame into a registry.

## 5. Complete artifacts and reproducibility

All paths are absolute; line counts refer to complete files, not excerpts.

| Artifact path | Lines |
|---|---:|
| `media-research\wot-av-example-v0.1.source.td.json` | 62 |
| `media-research\wot-av-example-v0.1.controller.td.json` | 105 |
| `media-research\wot-av-example-v0.1.need.jsonld` | 49 |
| `media-research\wot-av-example-v0.1.assignment.jsonld` | 51 |
| `media-research\wot-av-example-v0.1.query.rq` | 30 |
| `media-research\wot-av-example-v0.1.live.query.rq` | 32 |
| `media-research\wot-av-example-v0.1.pins.jsonld` | 188 |
| `media-research\wot-av-example-v0.1.http-profile.json` | 14 |
| `media-research\wot-av-example-v0.1.control-profile.json` | 50 |
| `media-research\wot-av-example-v0.1.acquisition.json` | 15 |
| `media-research\wot-av-example-v0.1.resource.json` | 12 |
| `media-research\wot-av-example-v0.1.codec.json` | 13 |
| `media-research\wot-av-example-v0.1.adapter.json` | 19 |

Run without resealing:

```powershell
python "media-research\wot-av-example-v0.1.verify.py"
```

Installed jsonschema 4.26.0, PyLD 3.1.0 and RDFLib 7.6.0 validate both TDs with the pinned official schema, expand JSON-LD with an allow-list-only loader, check canonical names/selected cardinalities/graph preservation, resolve four Form selections, verify pins and execute both queries plus negatives. No packages were installed. Full AV/SHACL validation, a complete matcher, profile-body conformance and operational qualification are **not** claimed.

`media-research\wot-av-example-v0.1.checks.json` records results, query bindings, limits, source integrity and every artifact's absolute path/line count/SHA-256. The companion `media-research\wot-av-example-v0.1.manifest.json` records cache/pin/graph mappings and unresolved references. Converted query data persists in `media-research\wot-av-example-v0.1.dataset.nq`. Only the fixed ASCII/string/integer request specimen uses a JCS-equivalent encoding calculation; no generic JCS implementation is claimed.

## Sources

- **[F]** Canonical authority: `media-research\wot-av-formal-v0.1.terms.json:26-77,146-270,271-341,343-367`. Earlier drafts are integration inputs, not term authorities: `media-research\wot-vocab-td-examples.md:14-65,269-277`.
- **[C]** Final mappings: `media-research\wot-av-formal-v0.1.context.jsonld:16-139,306-418,449-481`; native Form semantics: `media-research\wot-av-example-v0.1.td-context.snapshot.jsonld:380-450`.
- **[D]** Indexing assumptions and discovery limits: `media-research\wot-vocab-discovery.md:27-40,86-90`; [Discovery REC search](https://www.w3.org/TR/2023/REC-wot-discovery-20231205/#search).
- **[T]** [TD 1.1 Form/response](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#form), [DataSchema](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#dataschema), [bearer](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#bearersecurityscheme), [HTTP mapping](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#http-binding-assertions); [pinned schema source](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json#L315-L493). Cached SHA-256 is `87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da`.
- **[J]** [RFC 8785 section 3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3). Replay and receipt behavior are custom-profile choices, not WoT core guarantees.
