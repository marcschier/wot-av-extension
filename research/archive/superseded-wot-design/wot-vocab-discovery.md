# Proposed AV vocabulary: discovery, projection, and acceptance

2026-09-14. Design delta against the three supplied contracts [C], not a published vocabulary or implementation claim. Namespace: `https://example.org/wot/av#`, prefix `av`. Retain TD core; prefix every domain key. The supplied correction supersedes bare keys and Rational `n/d` examples: use `av:numerator` / `av:denominator`.

## Boundary glossary

| Term | Boundary |
|---|---|
| Directory match | Positive evidence for an Offer's whole Mode; neither reservation nor admission. |
| Assignment | Admitted binding of a Need to selected media and obligations; not WoT protocol binding. |
| Projection | Generated access view with retained semantic references; not another editable specification. |
| Pin | Exact document representation plus digest procedure; neither Thing identity nor authorization. |
| Status / grant | Observation / externally enforced authority; neither follows from directory presence. |
| InferenceModel | Learned artifact, not a TD Thing Model or xRegistry model. |

Two narrow proposed refinements: reuse `av:form` on `FormRef` to record the expected native Form identity alongside its pinned pointer; both selectors must agree. Add `av:omittedTracks: FragmentRef[0..n]` to `InputSelection`, pointing into the pinned Need, **only** to record optional track omissions. Existing `av:omittedInputs` cannot express omitted audio inside a retained required input. No new endpoint, locator, negotiation DSL, or major container is needed.

## Directory registration, search, watch, and pins

**Registration.** Discovery REC requires listing; individual CRUD interfaces are optional, with full HTTP directories recommended to implement CRUDL. Where supported: identified registration uses `PUT /things/{id}`, matching the TD's body identifier; anonymous registration uses `POST /things` and returns `Location`; creation returns 201. GET retrieves; replacing PUT, Merge-Patch PATCH, and DELETE return 204. An anonymous TD acquires a directory-local `id`, not automatically a publisher identity. Enriched TDs include the Discovery context; optional server-generated `registration.created/modified/retrieved` differ from TD timestamps/version. Where expiry is supported, `ttl` overrides `expires`; periodic expiry purging is SHOULD, not a media lease. Recommended/minimal syntactic validation does not verify media behavior. [D1]

**Search/security.** Search is recommended, not mandatory; JSONPath is optional/non-normative. Optional SPARQL requires GET when implemented; POST is optional. SELECT/ASK default to `application/json`; CONSTRUCT/DESCRIBE to `application/ld+json`. Use advertised directory Forms/security/URI variables where supplied, not assumed optional capabilities. Authenticate registration and discovery separately from media access. Authorization-filtered or unexpandable facts are unknown; 401/403, unsupported interfaces, query refusal, and timeout are not successful empty bindings. Bound query cost and remote-context/federation access. [D2,D3,T]

```http
GET /search/sparql?query=<percent-encoded-query-below> HTTP/1.1
Host: <authority-from-directory-form>
Accept: application/json
```

**Completeness/pagination.** Listing normally returns an array. Optional positive-`limit` paging supplies `next` and `canonical` links; the latter has an `etag` parameter for ordering consistency, not immutable TD content. Default listing order is identifier code-point order. JSONPath specifies no equivalent paging guarantee. SPARQL LIMIT/OFFSET needs deterministic ordering and a separately stabilized dataset to avoid concurrent-change gaps. Its default/named graph layout is implementation-defined: TDD does **not** promise a complete union graph or one graph per TD. [D2]

The following **additional indexing profile** requires one named graph per retained, shape-validated TD snapshot, an external graph-to-Pin manifest, pinned contexts, preserved native Form membership, and no version mixing. Completeness must be established for the selected Mode/dependency closure, not inferred from missing triples. A redacted graph cannot prove absence of audio. Query results identify snapshots to fetch and validate; they are not complete contracts or Assignments.

```sparql
PREFIX av:   <https://example.org/wot/av#>
PREFIX td:   <https://www.w3.org/2019/wot/td#>
PREFIX hctl: <https://www.w3.org/2019/wot/hypermedia#>
PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>

SELECT DISTINCT
  ?graph ?source ?offer ?mode ?form ?videoTrack ?audioTrack ?target
WHERE {
  GRAPH ?graph {
    ?source a av:MediaSource ; av:offers ?offer .
    ?offer a av:Offer ; av:source ?source ; av:modes ?mode .
    ?mode a av:Mode ; av:kind av:Live ; av:form ?form ;
          av:tracks ?videoTrack, ?audioTrack .

    ?source (
      td:hasForm |
      (td:hasPropertyAffordance |
       td:hasActionAffordance |
       td:hasEventAffordance) / td:hasForm
    ) ?form .
    ?form av:mediaDirection av:FromThing ; hctl:hasTarget ?target .

    ?videoTrack a av:VideoTrack ; av:representation ?video .
    ?video a av:EncodedVideo ; av:codec av:H264 ;
           av:width 1280 ; av:height 720 ; av:cadence av:Constant ;
           av:frameRate ?rate .
    ?rate a av:Rational ; av:numerator ?num ; av:denominator ?den .

    ?audioTrack a av:AudioTrack ; av:representation ?audio .
    ?audio a av:EncodedAudio ; av:codec av:AAC ;
           av:sampleRateHz 48000 ; av:channels 1 ;
           av:channelLayout av:Mono .

    FILTER(isIRI(?form) && isLiteral(?target) &&
           DATATYPE(?target) = xsd:anyURI)
    FILTER(DATATYPE(?num) = xsd:integer &&
           DATATYPE(?den) = xsd:integer &&
           ?den > 0 && ?num = 30 * ?den)
  }
}
ORDER BY ?graph ?source ?offer ?mode ?form ?videoTrack ?audioTrack ?target
LIMIT 100
```

The official TD context maps native Form membership to `td:hasForm`; `href` becomes an `xsd:anyURI` **literal**, unlike the `av:form` node link. All track predicates share one `?mode` and one `?graph`. Integer normalization/shape validation precedes this query; it assumes no ontology entailment. Operation, codec profile/level, adapters, placement, clocks, capacity, grants, and delivery qualification remain admission work. [T,C]

**Watch.** Optional notifications use SSE (`text/event-stream`), types `thing_created`, `thing_updated`, `thing_deleted`, event-type filtering, and JSON data containing TD `id`. With `diff=true`, creation may include the TD and update may include a Merge Patch; deletion does not acquire those extra fields. Event IDs/replay are SHOULD, without specified retention horizon or atomic list/watch cutover. Treat events as invalidations; re-retrieve/relist after gaps. [D3]

**Pin.** Retain authenticated publisher bytes, contexts, expected Thing identity, optional `version.instance`, and effective-base provenance. TDD anonymous IDs, enrichment, retrieval time, and language negotiation can change the representation: pin an enriched snapshot separately, never strip fields and reuse the publisher digest. Resolve the unique named native Form inside the chosen pin; legacy JSON Pointers address only that serialization. Version labels, registration TTL, and watch cursors are not integrity or ownership proofs. [D1,T,C]

## Deterministic, loss-aware xRegistry projection

| Fact | Authoritative source | Generated view / loss boundary |
|---|---|---|
| Target, operation, security, binding options | Pinned native TD Form, effective defaults/base, pinned profile | xRegistry protocol/options; unsupported mappings fail, never silently weaken security. |
| Advertised codec/track/configuration tuple | Publisher's whole Mode and representations | Retain Mode reference, not independent codec/resolution/audio lists. |
| Required output and preferences | Workload owner's pinned Need | Typed hard predicates first; Boolean lexicographic ranking only among feasible plans. |
| Semantic class meanings / assertions | Vocabulary/profile publisher / authenticated TD publisher | Preserve IRIs and provenance; labels are not equivalent semantics. |
| Actual wire/output, admission, ownership | Negotiating peers/observer, Controller, external enforcers respectively | Separate negotiation, AssignmentStatus, and LeaseGrant; do not rewrite advertisements as observed truth. |

**Algorithm (proposal).** Resolve and validate the entire selected tuple. Represent each Pin as `[document, algorithm, scope, canonicalization, digest]`, preserving strings without URI/Unicode normalization. Deduplicate identical dependency tuples and sort by unsigned UTF-8 byte order of their JCS encodings. Dependencies include contexts, binding/application profiles, and the projection-profile release. Compute using RFC 8785 JCS [J]:

```text
I = [sourcePinTuple, effectiveBase, modeId, formId, standardOperation,
     sortedDependencyPinTuples]
endpointid = "av-" + lowercase_unpadded_base32(SHA256(JCS(I)))
```

Emit one Endpoint per whole Mode/Form/operation/profile tuple, not per independent track or shared `href`. Resolve addressing in the original TD context; unsupported template, media-leg, security, or protocol mappings reject deployable export. Preserve semantic constraints by authenticated reference. Endpoint-only clients consequently have transport metadata, **not** sufficient admission evidence. Fieldset-to-model mappings can be formalized later.

The projector alone writes generated fields; changes start at the TD/profile publisher and regenerate projections. Check generated fields against pins before use; hashes do not enforce immutability. Endpoints are xRegistry **Groups**, hence have no native `/versions/...`; retain content-derived identities and restrict writes externally. Resource Version contents can also be updated, and versions can be pruned. Epoch checks detect entity-local conflicting updates, not ownership fencing or transactions. [X3]

**Tiny hypothetical HTTP/JPEG Endpoint.** Existing HTTP is deliberately used, with explicit GET overriding xRegistry's POST default. All reference targets and digest digits in `vectors.json` are fixtures, not deployed services or verified checksums. The full identifier is derived from that file's projection fixture. Server-managed metadata is omitted.

```json
{
  "endpointid": "av-owz7sffyzpn4k2h75ht3avrzfyemvbwx6bt3mkg5ihaao7qbufxa",
  "usage": ["consumer"],
  "protocol": "HTTP",
  "protocoloptions": {
    "endpoints": [{"uri": "https://media.example.org/camera-1/latest.jpg"}],
    "method": "GET",
    "deployed": false,
    "av:form": "https://example.org/things/camera-1/forms/latest",
    "av:pin": "urn:pin:camera-1:17",
    "av:mode": {
      "av:pin": "urn:pin:camera-1:17",
      "av:pointer": "/av:offers/0/av:modes/0"
    },
    "av:profiles": ["urn:pin:http-jpeg:1", "urn:pin:av-xregistry:1"]
  }
}
```

`protocol` and `protocoloptions` are real Endpoint-root fields; `messages`, `messagegroups`, and `envelope` are absent deliberately. `FromThing -> ["consumer"]`, `ToThing -> ["producer"]` reflects **logical media relative to the addressed Thing**, not request/session initiation. `subscriber` is control-only, not a synonym for media consumption. Additional protocol identifiers are permitted; SRT/HLS/WebRTC still need explicit binding/profile, option model, and qualified implementation. `ifvalues` conditionally introduces sibling definitions; it does not negotiate anything. [X1,X2]

**Exact extension ownership.** The composite profile extends the existing model object at:

```text
/groups/endpoints/attributes/protocol/ifvalues/HTTP/siblingattributes/protocoloptions
```

Preserve its HTTP attributes, set `namecharset: "extended"`, and define typed `av:form`/`av:pin` URI references, `av:profiles` URI array, and `av:mode` FragmentRef object. That nested object also needs extended names. Keep additions optional in the general HTTP model; the projection profile requires them for projected media entries. Core root names cannot contain `:`; extended names permit these lowercase keys, **not arbitrary camelCase AV fieldsets**. Store full JSON-LD as referenced resource documents instead. This is xRegistry JSON, not a TD/context replacement. [X2,X3]

Storing TD documents in xRegistry does not implement TDD registration/search/watch conformance. [D1-D3]

## Semantic acceptance vectors

`vectors.json` contains twelve fixture groups with explicit facts and stage-specific expected decisions; V11 contrasts two outcomes. Its envelope/evidence keys are non-vocabulary fixture metadata, not new AV terms or repository test code. `conditional` means unresolved/not admitted, not a new AV status. Unknown hard facts fail; preferences cannot repair them. Numbers below are synthetic oracle inputs, not performance promises. [C]

```text
a/b = c/d iff a*d = c*b; denominators positive, integer arithmetic.
r_del(W) = count(distinct eligible delivered media-unit identities in W)/|W|; |W| > 0.
loss(W) = (eligible expected units - delivered distinct units)/expected units; expected > 0.
age_upper_ms = delivery_ms - sample_ms + u_delivery_ms + u_sample_ms.
skew_upper_ms = abs(t_video_ms - t_audio-first-sample_ms) + u_video_ms + u_audio_ms.
feasible(P) = every hard predicate is proven true; unknown is not true.
rank(P) = lexicographic Boolean preferences, true before false, then stable IDs.
```

Rate/coverage evidence names boundary, window, stream incarnation and units; duplication is not new capture. Age/skew require valid common-domain mappings and uncertainty bounds. Lease validity is `[validFrom, expiresAt)` plus nonrevocation/current authority; fresh status additionally needs current generation, authorized latest observation, and dependency agreement. No finite measurement establishes an unconditional future rate guarantee. JSON presence/completeness validation, not missing RDF triples, distinguishes explicit empty detections from absent or errored output.

| ID | Explicit decisive facts | Expected decision / reason |
|---|---|---|
| V01 | Mode A: 1080p25 + audio; B: 720p30 without audio; require 720p30 + audio | Reject `NoJointMode`; no Cartesian join. |
| V02 | Matching A/V Mode; adapter delivers video only; audio required | Reject `BackendTrackUnsupported`; no invented audio adapter. |
| V03 | Video feasible; audio optional and absent in complete Mode | Accept with explicit omitted-track reference; audio preference false. |
| V04 | Require exact 30/1; offer 30000/1001 | Reject: 30030 differs from 30000. |
| V05 | Source 30; dropping queue; 270 distinct deliveries/10 s; require delivered 30 | Reject: 27 delivered/s; source setting proves no delivered minimum. |
| V06 | Capture-age bound; only unrelated, unmapped clocks | Reject `ClockUnqualified`, not zero age. |
| V07 | Old ready status/generation; grant expires exactly at evaluation time | Reject stale observation and expired authority. |
| V08 | Same TD version/Form ID, reordered Forms, changed digest; original unavailable | Reject integrity/substitution; repinning and new named resolution required. |
| V09 | Clip interval [2.1,4.2); Still candidate; keyframe-only clip without preroll; early EOF at 3 | Reject wrong kind/seek/coverage; EOF succeeds only after required coverage. |
| V10 | Recorder owns live capture configuration; competitor requests incompatible configuration without grant | Reject conflict; preference/directory presence authorizes no takeover. |
| V11 | Complete covered empty detections with receipt versus failed invocation/no receipt | Accept empty result; reject coercing failure into successful emptiness. |
| V12 | Repeated trigger key after timeout; effect and durable outcome unknown | Conditional `OutcomeUncertain`; reconcile, do not retrigger. |

## Primary sources and contract locators

All GitHub line references below are immutable. Discovery pin `64c13d74466b5af68e7e56b2c9ce5ba35728bbdc`; TD pin `87808f1644ba79eb0a58d238385a8bd4a2236853`; xRegistry pin **`16483bb564586423de9c128db89f3b61d360f4e3`**.

- **[C]** Contract files: `media-research\wot-vocab-foundation.md:44-78`; `media-research\wot-vocab-offers-needs.md:28-128`; `media-research\wot-vocab-lifecycle.md:44-113`. Proposals, not independent standards evidence.
- **[D1]** `w3c/wot-discovery:publication/6-rec/Overview.html`: [3245-3496](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L3245-L3496), [3650-3896](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L3650-L3896), [4053-4229](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4053-L4229), [4487-4543](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4487-L4543).
- **[D2]** Same source: [4253-4345](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4253-L4345), [4460-4470](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4460-L4470), [4895-5093](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4895-L5093); [SPARQL protocol request/dataset rules](https://www.w3.org/TR/2013/REC-sparql11-protocol-20130321/#query-operation), [OFFSET caveat](https://www.w3.org/TR/2013/REC-sparql11-query-20130321/#modOffset).
- **[D3]** Same source: [3509-3567](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L3509-L3567), [4593-4822](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L4593-L4822), [5958-5979](https://github.com/w3c/wot-discovery/blob/64c13d74466b5af68e7e56b2c9ce5ba35728bbdc/publication/6-rec/Overview.html#L5958-L5979).
- **[T]** `w3c/wot-thing-description:context/td-context-1.1.jsonld`: [17-21](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L17-L21), [156-166](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L156-L166), [380-449](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld#L380-L449); `publication/ver11/7-rec/Overview.html`: [3040-3192](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/publication/ver11/7-rec/Overview.html#L3040-L3192), [4140-4176](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/publication/ver11/7-rec/Overview.html#L4140-L4176), [14520-14539](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/publication/ver11/7-rec/Overview.html#L14520-L14539).
- **[X1]** `xregistry/spec:endpoint/spec.md`: [239-351](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L239-L351), [366-450](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L366-L450), [545-619](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L545-L619), [648-664](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L648-L664).
- **[X2]** `xregistry/spec:endpoint/model.json`: [561-633](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L561-L633); `core/model.md`: [259-287](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L259-L287), [457-489](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L457-L489); `core/spec.md`: [853-859](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L853-L859), [931-935](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L931-L935).
- **[X3]** `xregistry/spec:core/spec.md`: [212-225](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L212-L225), [1206-1246](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1206-L1246); `core/http.md`: [2881-2905](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L2881-L2905); `core/model.md`: [754-771](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L754-L771).
- **[J]** [RFC 8785 section 3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3): JCS input restrictions, canonical serialization, and UTF-8 output; chosen here, not imposed by WoT/xRegistry.
