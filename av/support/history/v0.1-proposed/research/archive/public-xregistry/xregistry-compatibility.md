# Focused xRegistry compatibility adjudication

**Decision:** retain the seven document-bearing media Resource types, remove every extension-attribute `immutable` aspect, and publish one coherent metadata model per Registry. Use genuinely external absolute Message Group references and schema-document URIs without `dataschemaxid` in the final interoperability examples. This is a bounded compatibility recommendation, not a certification of the conflicting upstream artifacts or the earlier media-document schemas.

## 1. Authority and release boundary

Citation prefixes identify exact snapshots:

| Prefix | Repository and commit | Role |
|---|---|---|
| M | `xregistry/spec@16483bb564586423de9c128db89f3b61d360f4e3` | Requested current-main working-draft target |
| R | `xregistry/spec@d2433a8c726ab096303bd943a4fc6691925f7910` | Published `v1.0-rc4` |

The artifact table distinguishes released RC4 from WIP; the release record dates RC4 to 2026-08-19. Main's RC4 labels do not identify the release commit.[^baseline]

**Adjudication priority:** an explicit prose MUST/MUST NOT is not weakened by a permissive JSON Schema or sample. Conversely, the companion's named formal model is evidence, not permission to silently rewrite contradictory prose. Where the two disagree, identify the defect and select an explicitly documented representation; do not claim that schemas generally trump normative text.

Direct comparison found the three companion `model.json` files and Endpoint prose byte-identical between M and R. Message prose adds one blank line after R:511; Schema prose adds one after R:442, shifting later citations by one. The disputed references are therefore not merely post-release changes. Core model prose, including the extension-immutability prohibition, is unchanged; main's generic model schema has fixes absent from R. Main also adds an implementation-customization paragraph that must not be attributed to published RC4.[^pins]

## 2. Extension immutability and publication safeguards

**The lifecycle objection is correct.** `core/model.md:356-368` restricts `immutable` to server-controlled specification-defined attributes and says it **MUST NOT** be used for extensions. Delete the aspect from `acf_digest`, including any attempted `immutable: false` replacement. The legal declaration is an ordinary optional string with matching `name`; the corrected contribution below supplies it.[^immutable]

`readonly: true` is not a substitute for client-set-once behavior: client values are ignored on creation and update. It is suitable only when the server itself supplies the extension. Likewise, `matchversions: true` would force the same digest across Versions, not freeze each Version independently. Here a designated admission/publishing principal writes optional derived indexes; authorization, not a misleading model aspect, excludes other writers.[^attribute-aspects]

**Proposed safeguards:** retain a separately specified digest algorithm/canonicalization contract; validate documents before publication; compute any emitted indexes from those documents; publish consistent metadata and document content together; reject mismatches on acceptance; and pin trusted expected digests outside the freely replaceable record. Enforce overwrite/deletion restrictions and retention of accepted dependencies operationally. Optional indexes are discovery hints, not independent configuration or integrity roots.

Inline JSON is not guaranteed byte-for-byte preservation. If the digest covers exact bytes rather than a defined canonical form, use the singular-name `base64` carrier or separately preserved external bytes. A Version-looking URL, a nearby checksum, and even Resource `meta.readonly` do not together establish permanent archival immutability: the latter's update rejection is SHOULD and concerns non-admin access.[^integrity]

## 3. Concrete reference and messaging subset

An Endpoint is a **Group**, `/endpoints/vision-results`, not a Resource with `/versions/...`. Its imported `messages` are Resources. An HTTP result receiver is `usage: ["producer"]`: producers push messages **to** it. HTTP requires exactly one role; this companion is not a general camera-control or arbitrary HTTP API description.[^endpoint]

**Message Group mismatch:** Endpoint prose permits `/messagegroups/vision`, but the formal array item has `type: "uri"` and `target: "/messagegroups/messages"`, a Message Resource target rather than a Group target. Core requires slash-prefixed URI values to satisfy that target; it explicitly exempts absolute URIs. Use `https://registry.example.com/messagegroups/vision` from an Endpoint stored in another Registry, such as `https://control.example.com`. This satisfies the external-Group prose and avoids the local-target conflict. Do not change the official target to `/messagegroups`, append `/messages` to a Group reference, or merely absolutize a same-Registry reference and call it external. The server stores the external URI without resolving it; clients must resolve and validate the contract.[^targets]

**Schema subset:** use `dataschemaformat: "JsonSchema/draft-07"` and a `dataschemauri` pointing to a particular Schema Version's document, without `$details`. JSON Schema's top-level definition is a concrete schema object; a pointer fragment can select a nested definition. Omit both inline `dataschema` and `dataschemaxid` in this example.[^schema-uri]

The reason is substantive: Message prose says a simultaneous `dataschemauri` must equal the referenced entity's `self`, whereas HTTP `self` for document-bearing metadata ends in `$details`. A metadata wrapper is not the schema document. The `dataschemaxid` prose names a Schema Resource; its unconstrained generic `xid` model does not establish that substituting a Version XID is intended. A URI-only reference avoids both questions without redefining either field. XID-only portable documents remain a separate representation, not equivalent to the URI-only example.[^schema-conflict]

Use protocol selector **`HTTP`**, not `HTTP/1.1`; HTTP wire versions share this binding. Use **flat** `envelopemetadata.type`, not `envelopemetadata.attributes.type`, following the formal model and the Message specification's worked example. However, Message prose also contains the contradictory `attributes`-wrapper sentence; flat placement is the declared compatibility choice, not a claim that this defect is fixed. With binary CloudEvents, omit `envelopeoptions.format`. These are definitions constraining runtime messages, not runtime CloudEvents themselves.[^envelope]

## 4. Model APIs, capabilities, filters, and request hygiene

`GET /model` is **MUST-supported and read-only**. `GET /modelsource` and `PUT /modelsource` are **MAY-supported**; the latter accepts a JSON object and is not a patch of one isolated contribution. Compose existing application profiles, applicable pinned companions, and this media contribution into **one coherent model per Registry** before replacing its source. Do not mix the lifecycle note's metadata-only control records with this document-bearing choice. Includes resolve on model update, not continuously.[^model-api]

`GET /capabilities` is **SHOULD**, not an unconditional MUST. Updating capabilities is MAY. When capabilities are serialized, supported entries must be represented; `available` must include `capabilities`, `entities`, and `model`, and `model.mutable` must be false. Those conditional requirements do not turn every optional API or flag into a mandatory feature. Preserve the wording rather than normalizing all of it to MAY or MUST.[^capabilities]

The original array-filter spelling is **correct**:

```http
GET /mediagroups/factory1/sources?filter=acf_kinds%5B*%5D=live,acf_has_audio=true
```

The decoded selector is `acf_kinds[*]=live`, not `acf_kinds[]=live` or `acf_kinds=live`. Paths are relative to the request URL. Comma-separated predicates in one HTTP `filter` are AND; repeated parameters are OR. Filtering is optional, and coarse existential indexes cannot prove one jointly feasible media mode. Re-read candidate documents and evaluate the actual constraints.[^filter]

For `hasdocument: true`, an individual Resource/Version URL without `$details` carries document bytes; with `$details`, it carries metadata JSON and optionally the singular-name document carrier. Collection POSTs always use ID-keyed metadata maps: Resource IDs for a Resource collection, Version IDs for `/versions`. POST to an individual Resource's `$details` instead takes one Version serialization; supplying an existing `versionid` can replace that Version.[^carriers]

Scalar metadata can accompany document bytes in `xRegistry-` headers. Arrays such as `acf_kinds`, objects, and non-scalar maps cannot; use metadata JSON. Do not combine `xRegistry-` headers with a metadata JSON body. Document media type uses `Content-Type` in byte mode and the standard `contenttype` metadata field in metadata mode. At most one singular-name document, `base64`, or `url` carrier may be supplied.[^headers]

**Readonly means preserve the prescribed model aspects, not manufacture response fields in POSTs.** The source contribution should omit standard definitions and let the server add them. If restated, requiredness and readonly constraints cannot be weakened. Root `specversion`/`registryid`, `self`, `xid`, and `epoch` have required readonly declarations; `shortself` and navigation URLs/counts are readonly; `isdefault` and Meta `readonly` are required with default false and readonly semantics. `formatvalidated`, `formatvalidatedreason`, `compatibilityvalidated`, and `compatibilityvalidatedreason` are server-owned readonly outputs. Core `createdat`/`modifiedat` are required, but not declared readonly. IDs and epochs have explicit request/checking exceptions; required response metadata does not imply client-supplied `self`, counts, or fabricated epochs.[^readonly]

Custom names must be 1-63 lowercase/digit/underscore characters, not begin with a digit, and avoid core/generated-name collisions. Each modeled attribute below has matching `name` and `type`. Version projections belong in `attributes`; Resource-wide extensions belong in `metaattributes`, not user-added `resourceattributes`. No wildcard or invented `index` keyword supplies missing field semantics.[^custom]

## 5. Version identity, breaking changes, and epochs

Core explicitly permits replacing an existing Version. Immutable identity is not immutable content. For update/delete, a supplied non-null epoch must match; on create it is ignored; omission/null disables comparison. Updates, including no-op touches, increase epoch, not necessarily by exactly one. Check the intended Version's epoch: `meta.epoch` concerns Resource metadata and Version membership, not edits to existing Version contents.[^epochs]

The supplied Message model fixes `hasdocument: false`, `maxversions: 1`. Message prose recommends this matching simplification and says wire-changing modifications **SHOULD NOT** be made to an existing definition; create a new Message Resource and new semantic event `type`/`messageid` instead. This is recommendation-strength, not a universal MUST, and deviations require an explicit unique-message matching mechanism. Do not describe successive overwritten Message Versions as durable contract history.[^messages]

For breaking result-schema changes, the conservative profile creates a new message identity and a new major schema identity, rather than silently repointing the old message. Schema prose recommends major identifiers in `schemaid`; its `format` is required and must match across Versions. Schema compatibility constraints and actual validation support still apply.[^schema-versioning]

Within the seven **custom media types**, set `maxversions: 1` only on `bindingstatuses`; leave the standard Message model unchanged. Creating a new status Version can delete the previous default; sticky default selection is forbidden for this case. Omitting `maxversions` on the other six defaults to zero, which still permits pruning non-default Versions, even down to one. Audit retention and frozen accepted plans therefore need an explicit deployment/archive guarantee.[^retention]

## 6. Corrected complete media model contribution

This is a complete **media contribution to modelsource**, not the expanded `/model` response or a replacement for other profiles. All seven types bear JSON documents. Optional indexes have deliberately limited scope: host; offered kinds/audio availability; pinned actor/need/binding relations; observed state; media type; runtime. Targets contain type names, while runtime XIDs contain entity IDs.[^custom]

```json
{
  "groups": {
    "mediagroups": {
      "plural": "mediagroups", "singular": "mediagroup",
      "resources": {
        "actors": {
          "plural": "actors", "singular": "actor", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_host": {"name":"acf_host","type":"string","required":false}
          }
        },
        "sources": {
          "plural": "sources", "singular": "source", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_kinds": {"name":"acf_kinds","type":"array","required":false,"item":{"type":"string"}},
            "acf_has_audio": {"name":"acf_has_audio","type":"boolean","required":false}
          }
        },
        "needs": {
          "plural": "needs", "singular": "need", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_actor": {"name":"acf_actor","type":"xid","required":false,"target":"/mediagroups/actors/versions"}
          }
        },
        "bindings": {
          "plural": "bindings", "singular": "binding", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_need": {"name":"acf_need","type":"xid","required":false,"target":"/mediagroups/needs/versions"}
          }
        },
        "bindingstatuses": {
          "plural": "bindingstatuses", "singular": "bindingstatus", "hasdocument": true,
          "maxversions": 1,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_binding": {"name":"acf_binding","type":"xid","required":false,"target":"/mediagroups/bindings/versions"},
            "acf_state": {"name":"acf_state","type":"string","required":false}
          }
        },
        "assets": {
          "plural": "assets", "singular": "asset", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_mediatype": {"name":"acf_mediatype","type":"string","required":false}
          }
        },
        "models": {
          "plural": "models", "singular": "model", "hasdocument": true,
          "attributes": {
            "acf_digest": {"name":"acf_digest","type":"string","required":false},
            "acf_runtime": {"name":"acf_runtime","type":"string","required":false}
          }
        }
      }
    }
  }
}
```

**Separate document validation:** freeze explicit, closed JSON Schema definitions for Actor, Source, Need, Binding, BindingStatus, Asset, and Model; select by collection and pinned schema version, validate the authoritative document, then derive any emitted projections. For example, `acf_has_audio` means any offered mode has audio, not that the selected mode does. This is a profile admission obligation, not wildcard metadata acceptance. The earlier full document-schema bundle was not broadly reaudited here.

Core format/compatibility validation switches are omitted: their defaults are false; enabling strict validation without a supported format handler would not provide the intended validator. Do not invent a standard media `format` identifier or claim that `application/json` validates a manifest contract. The standard Schema companion's validation settings are a separate matter.[^validation]

The singular carriers are `actor`, `source`, `need`, `binding`, `bindingstatus`, `asset`, and `model`, with their `base64`/`url` variants. **`modelurl` retrieves the model manifest, not ONNX weights**; weight locators belong inside that manifest. Likewise, `sourceurl` retrieves a source document, not an RTSP stream. The Version's `model` carrier is unrelated to Registry `/model`.[^document-names]

## 7. Minimal standard request payloads

Preconditions: the catalog Registry at `https://registry.example.com` has the pinned Message/Schema models and existing `vision` Message/Schema Groups. The separate control Registry has the Endpoint model. These are initial publication examples, not create-only or transactional guarantees. The result schema below is illustrative, not a replacement for the media-manifest schemas.

`POST https://registry.example.com/schemagroups/vision/schemas`

`Content-Type: application/json`

```json
{
  "result.v1": {
    "versionid": "1",
    "format": "JsonSchema/draft-07",
    "contenttype": "application/json",
    "schema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "asset": {"type": "string"},
        "label": {"type": "string"}
      },
      "required": ["asset", "label"],
      "additionalProperties": false
    }
  }
}
```

`POST https://registry.example.com/messagegroups/vision/messages`

`Content-Type: application/json`

```json
{
  "com.example.vision.result.v1": {
    "versionid": "1",
    "envelope": "CloudEvents/1.0",
    "envelopeoptions": {"mode": "binary"},
    "envelopemetadata": {
      "type": {
        "type": "string",
        "value": "com.example.vision.result.v1",
        "required": true
      }
    },
    "dataschemaformat": "JsonSchema/draft-07",
    "dataschemauri": "https://registry.example.com/schemagroups/vision/schemas/result.v1/versions/1",
    "datacontenttype": "application/json"
  }
}
```

`POST https://control.example.com/endpoints`

`Content-Type: application/json`

```json
{
  "vision-results": {
    "usage": ["producer"],
    "envelope": "CloudEvents/1.0",
    "envelopeoptions": {"mode": "binary"},
    "protocol": "HTTP",
    "protocoloptions": {
      "endpoints": [{"uri": "https://results.example.com/ingest"}],
      "method": "POST",
      "deployed": true
    },
    "messagegroups": ["https://registry.example.com/messagegroups/vision"]
  }
}
```

The schema carrier is metadata-wrapped because this is a collection request; the metadata-only Message has no `message` document carrier; the Endpoint has no `versionid`. Sender-generated CloudEvents `id`, `source`, and `specversion` remain required by the envelope despite omitted constraint declarations. Message-specific HTTP options are intentionally omitted: CloudEvents' implicit HTTP binding suffices, avoiding the disputed Message `query` shape. The addresses contain no credentials.[^example]

## 8. Remaining defects and limits

Retain, rather than silently repair, the local Message Group target mismatch, schema-URI/metadata-`self` conflict, and flat-versus-wrapper envelope contradiction discussed above. Additional directly relevant caveats:

- Message prose names `basemessage`; the model names `basemessageuri`. The subset uses neither.[^inheritance]
- Message HTTP prose calls `query` a map; its model makes it an array. Endpoint HTTP `query` is a separate, consistently modeled map. The example needs no query options.[^query-defect]
- Stale examples use `HTTP/1.1`, wrapped envelope metadata, or binary mode with `format`; copy the selected declarations and explicit constraints, not those examples.[^envelope]
- R's closed generic Resource model schema omits validation switches that R's model prose defines; M adds them. Both generic schemas also allow Boolean `immutable` syntactically without enforcing the extension prohibition. Schema acceptance is neither normative proof nor a substitute for semantic validation.[^schema-defects]

No deployed server was exercised, no upstream defects were changed, and no broad media-schema rereview is implied. A deployment must verify its composed model, advertised features, admission rules, and retention behavior against this explicitly bounded profile.

## Sources (exact SHA, path, and line ranges)

[^baseline]: M [README.md:34-51](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/README.md#L34-L51), [docs/RELEASES.md:3-8](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/docs/RELEASES.md#L3-L8).

[^pins]: Compare M/R [endpoint/model.json:950-965](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L950-L965) / [R:950-965](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/endpoint/model.json#L950-L965), [endpoint/spec.md:750-771](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L750-L771) / [R:750-771](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/endpoint/spec.md#L750-L771); the blank-line boundaries are M [message/spec.md:507-515](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L507-L515) / [R:507-514](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/message/spec.md#L507-L514) and M [schema/spec.md:439-446](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L439-L446) / [R:439-445](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/schema/spec.md#L439-L445). Main-only customization: M [core/spec.md:785-816](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L785-L816) versus R [core/spec.md:784-805](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/spec.md#L784-L805).

[^immutable]: M [core/model.md:356-368](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L356-L368); identical R [core/model.md:356-368](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.md#L356-L368).

[^attribute-aspects]: M [core/model.md:194-226](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L194-L226), [324-354](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L324-L354), [370-409](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L370-L409).

[^integrity]: M [core/spec.md:2687-2712](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2687-L2712), [2998-3018](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2998-L3018), [3195-3213](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3195-L3213).

[^endpoint]: M [endpoint/spec.md:108-130](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L108-L130), [366-452](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L366-L452), [867-900](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L867-L900).

[^targets]: M [endpoint/spec.md:750-771](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L750-L771), [endpoint/model.json:950-957](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L950-L957), [core/model.md:228-256](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L228-L256).

[^schema-uri]: M [message/spec.md:728-771](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L728-L771), [schema/spec.md:489-516](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L489-L516).

[^schema-conflict]: M [message/spec.md:758-782](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L758-L782), [message/model.json:1356-1365](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L1356-L1365), [core/spec.md:1093-1105](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1093-L1105), [core/http.md:1520-1558](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1520-L1558); R Message counterpart [message/spec.md:757-781](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/message/spec.md#L757-L781).

[^envelope]: M [endpoint/spec.md:527-543](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L527-L543), [545-579](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L545-L579), [760-804](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L760-L804); M [message/spec.md:926-935](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L926-L935), [982-1004](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L982-L1004), [1032-1053](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L1032-L1053), [message/model.json:46-55](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L46-L55), [123-153](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L123-L153).

[^model-api]: M [core/http.md:1011-1089](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1011-L1089), [core/model.md:1163-1207](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1163-L1207), [1284-1310](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1284-L1310), [core/spec.md:1805-1836](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1805-L1836).

[^capabilities]: M [core/http.md:794-813](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L794-L813), [core/spec.md:1848-1903](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1848-L1903), [1935-1956](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1935-L1956), [2068-2079](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2068-L2079).

[^filter]: M [core/spec.md:3993-4023](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3993-L4023), [4562-4605](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L4562-L4605), [core/http.md:3147-3175](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L3147-L3175); R array syntax [core/spec.md:4547-4590](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/spec.md#L4547-L4590).

[^carriers]: M [core/http.md:287-313](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L287-L313), [1520-1569](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1520-L1569), [1778-1803](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1778-L1803), [2216-2243](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L2216-L2243).

[^headers]: M [core/http.md:344-355](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L344-L355), [430-441](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L430-L441), [1571-1616](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1571-L1616), [core/spec.md:3572-3645](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3572-L3645).

[^readonly]: M [core/model.json:4-36](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.json#L4-L36), [56-63](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.json#L56-L63), [core/model.md:1220-1239](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1220-L1239), [core/spec.md:1514-1533](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1514-L1533), [2477-2486](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2477-L2486), [2998-3018](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2998-L3018), [3119-3132](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3119-L3132), [3251-3276](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3251-L3276), [3301-3314](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3301-L3314), [3454-3476](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3454-L3476), [3522-3549](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3522-L3549), [core/http.md:315-333](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L315-L333).

[^custom]: M [core/spec.md:929-1009](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L929-L1009), [core/model.md:194-226](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L194-L226), [228-256](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L228-L256), [428-443](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L428-L443), [491-521](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L491-L521), [699-729](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L699-L729), [1096-1129](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1096-L1129), [1241-1245](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1241-L1245).

[^epochs]: M [core/spec.md:1206-1246](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1206-L1246), [3195-3213](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3195-L3213); R [core/spec.md:1195-1235](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/spec.md#L1195-L1235), [3180-3198](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/spec.md#L3180-L3198).

[^messages]: M [message/model.json:25-31](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L25-L31), [message/spec.md:288-307](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L288-L307); identical R [message/model.json:25-31](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/message/model.json#L25-L31), [message/spec.md:288-307](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/message/spec.md#L288-L307).

[^schema-versioning]: M [schema/spec.md:363-395](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L363-L395), [schema/model.json:25-40](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/model.json#L25-L40); identical R [schema/model.json:25-40](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/schema/model.json#L25-L40).

[^retention]: M [core/model.md:754-778](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L754-L778), [core/spec.md:3147-3165](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3147-L3165).

[^validation]: M [core/model.md:937-1016](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L937-L1016), [core/spec.md:3355-3401](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3355-L3401), [schema/model.json:25-40](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/model.json#L25-L40).

[^document-names]: M [core/model.md:794-815](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L794-L815), [core/spec.md:3551-3645](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3551-L3645).

[^example]: M [core/http.md:287-333](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L287-L333), [1778-1803](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1778-L1803), [message/spec.md:690-726](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L690-L726), [823-838](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L823-L838), [950-975](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L950-L975), [endpoint/model.json:561-645](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L561-L645), [endpoint/spec.md:867-914](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L867-L914).

[^inheritance]: M [message/spec.md:588-635](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L588-L635), [message/model.json:33-37](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L33-L37).

[^query-defect]: M [message/spec.md:1068-1084](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L1068-L1084), [message/model.json:1244-1273](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L1244-L1273), [endpoint/model.json:652-659](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L652-L659).

[^schema-defects]: R [core/model.schema.json:166-215](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.schema.json#L166-L215), [core/model.md:937-1016](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.md#L937-L1016), [core/model.schema.json:332-345](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.schema.json#L332-L345); M [core/model.schema.json:179-198](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.schema.json#L179-L198), [354-367](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.schema.json#L354-L367), [core/model.md:356-368](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L356-L368).
