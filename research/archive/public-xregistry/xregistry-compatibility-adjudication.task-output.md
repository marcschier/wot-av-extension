Historical adjudication of [the cleared compatibility report](xregistry-compatibility.md).
| Artifact section | Published section |
| --- | --- |
| Authority and release boundary | [Section](xregistry-compatibility.md#1-authority-and-release-boundary) |
| Extension immutability and safeguards | [Section](xregistry-compatibility.md#2-extension-immutability-and-publication-safeguards) |
| Reference and messaging subset | [Section](xregistry-compatibility.md#3-concrete-reference-and-messaging-subset) |
| APIs, capabilities, filters, request hygiene | [Section](xregistry-compatibility.md#4-model-apis-capabilities-filters-and-request-hygiene) |
Source-line coordinates in the original task output are not coordinates in the redacted edition.
## 1. Authority and release boundary

The snapshots must remain distinct:

| Label | Exact repository commit |
|---|---|
| **Main** | `xregistry/spec@16483bb564586423de9c128db89f3b61d360f4e3` |
| **Published RC4** | `xregistry/spec@d2433a8c726ab096303bd943a4fc6691925f7910` |

The artifact table distinguishes released RC4 from WIP. Source: [Main README.md:34-51](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/README.md#L34-L51).

**Adjudication priority:** explicit prose MUST/MUST NOT requirements are not weakened by permissive JSON Schemas or examples. Conversely, a named formal model does not authorize silently rewriting contradictory prose. Where artifacts disagree, disclose the defect and select a documented representation—not an invented universal “schemas win” rule.

The three companion models and Endpoint prose are byte-identical between these pins. Message and Schema prose differ only by one inserted blank line each; their later main line numbers are consequently one greater. The disputed companion rules therefore also affect published RC4. Core model prose’s immutability prohibition is likewise unchanged. The artifact’s source catalog provides both-pin references and identifies the main-only core customization paragraph.

## 2. `acf_digest`: remove `immutable`, preserve the invariant elsewhere

**The lifecycle objection is correct.** Core restricts `immutable` to server-controlled specification-defined attributes and expressly prohibits its use for extensions. Remove the aspect entirely from `acf_digest`, including any attempted `immutable: false` replacement. A legal declaration is an explicitly named, optional string. Sources: [Main `core/model.md:356–368`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L356-L368), [RC4 same range](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.md#L356-L368).

Neither adjacent aspect supplies the missing guarantee:

- `readonly: true` causes client-provided extension values to be ignored on creation and update; it is not client-set-once behavior.
- `matchversions: true` would require the same digest across Versions, rather than freezing each Version independently.

Source: [Main `core/model.md:324–354`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L324-L354).

**Proposed safeguards:** a designated admission/publishing principal validates authoritative documents, derives any emitted indexes, publishes consistent metadata and content together, and rejects discrepancies during acceptance. Preserve a separately specified digest/canonicalization contract and trusted expected digests outside the freely replaceable record. Enforce overwrite restrictions, deletion restrictions, and dependency retention operationally.

Inline JSON does not guarantee byte-for-byte preservation. Exact-byte digests therefore require the singular-name `base64` carrier or separately preserved external bytes; canonical-form digests require an explicit canonicalization contract. Resource `meta.readonly` is also not archival immutability: its update rejection is SHOULD and concerns non-admin access. Sources: [Main `core/spec.md:2687–2712`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2687-L2712), [2998–3018](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2998-L3018).

## 3. Safe concrete interoperability subset

An Endpoint is a **Group** at `/endpoints/vision-results`, not a Resource with Versions. Its imported `messages` are Resources. An HTTP result receiver is `usage: ["producer"]`: producers push messages **to** it. HTTP permits exactly one role and is not a general-purpose camera-control API description. Sources: [Main `endpoint/spec.md:108–130`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L108-L130), [867–900](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L867-L900).

**Message Group references:** prose permits `/messagegroups/vision`, but the model’s URI-array item targets `/messagegroups/messages`—a Message Resource, not a Group. Core applies that target constraint to slash-prefixed URI values but explicitly exempts absolute URIs. Therefore use:

```text
Endpoint registry: https://control.example.com
Endpoint:         /endpoints/vision-results
Message Group:    https://registry.example.com/messagegroups/vision
```

This is genuinely external, satisfying the external-Group prose without violating the local target constraint. Do not silently edit the official target, append `/messages` to a Group reference, or call an absolutized same-Registry reference external. External resolution and contract verification remain client responsibilities. Sources: [Main `endpoint/spec.md:750–771`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L750-L771), [model.json:950–957](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L950-L957), [core/model.md:228–256](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L228-L256).

**Schema references:** use `dataschemaformat: "JsonSchema/draft-07"` and `dataschemauri` pointing to a particular Schema Version’s **document**, without `$details`. Omit `dataschemaxid` and inline `dataschema`.

The simultaneous-field rule requires `dataschemauri` to equal the referenced entity’s `self`; HTTP metadata `self` for document-bearing entities ends in `$details`. That wrapper is not the schema document. Furthermore, `dataschemaxid` prose names a Schema Resource; its generic `xid` model does not establish intended Version-XID support. URI-only references avoid both questions. JSON Schema’s top-level definition supplies the concrete schema object required by Message prose. Sources: [Main `message/spec.md:758–782`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L758-L782), [core/http.md:1520–1558](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1520-L1558), [schema/spec.md:489–516](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L489-L516).

Use **`HTTP`**, not `HTTP/1.1`, as the selector. Use **flat `envelopemetadata.type`**, following the formal model and worked Message example. The contradictory prose sentence introducing an `attributes` wrapper remains a defect; flat placement is the declared compatibility choice, not an assertion that the contradiction disappeared. Binary CloudEvents must omit `envelopeoptions.format`. Sources: [Main `endpoint/spec.md:533–579`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L533-L579), [message/spec.md:926–935](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L926-L935), [1032–1053](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L1032-L1053), [message/model.json:123–153](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L123-L153).

## 4. APIs, capabilities, filters, and requests

`GET /model` is **MUST-supported and read-only**. `GET /modelsource` and `PUT /modelsource` are **MAY-supported**. Model-source replacement is not an isolated-fragment patch: combine applicable pinned companions, existing application profiles, and this contribution into **one coherent model per Registry**. Do not combine the lifecycle note’s metadata-only controls with this document-bearing representation. Sources: [Main `core/http.md:1011–1089`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1011-L1089), [core/model.md:1163–1207](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1163-L1207).

`GET /capabilities` is **SHOULD**; capability updating is MAY. When capabilities are serialized, supported entries must be represented; `available` must include `capabilities`, `entities`, and `model`, with `model.mutable: false`. These conditional requirements do not make every flag or optional API mandatory. Sources: [Main `core/http.md:794–813`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L794-L813), [core/spec.md:1935–1956](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1935-L1956), [2068–2079](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L2068-L2079).

**The original array-filter syntax is correct:**

```http
GET /mediagroups/factory1/sources?filter=acf_kinds%5B*%5D=live,acf_has_audio=true
```

Decoded, this is `acf_kinds[*]=live`, not `acf_kinds[]=live` or a scalar comparison. Comma-separated expressions in one parameter are AND; repeated parameters are OR. Filtering is optional. These coarse indexes do not establish that one jointly feasible mode satisfies all requirements. Sources: [Main `core/spec.md:4562–4605`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L4562-L4605), [core/http.md:3147–3175](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L3147-L3175).

For document-bearing types, individual Resource/Version URLs without `$details` carry document bytes; `$details` carries metadata JSON with an optional document carrier. Collection POSTs take ID-keyed maps: Resource IDs for Resource collections, Version IDs for `/versions`. POST to an individual Resource’s `$details` takes one Version serialization; an existing supplied `versionid` can be replaced. Sources: [Main `core/http.md:287–313`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L287-L313), [2216–2243](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L2216-L2243).

Scalar metadata can accompany document bytes through `xRegistry-` headers. Arrays, objects, and non-scalar maps cannot. Metadata-JSON requests must not also contain these headers. Document media type uses `Content-Type` in byte mode and `contenttype` inside metadata mode. Sources: [Main `core/http.md:344–355`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L344-L355), [1571–1616](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1571-L1616).

**Preserve core readonly aspects rather than fabricating response fields in POSTs.** Root `specversion`/`registryid`, `self`, `xid`, and `epoch` have required readonly declarations. Navigation attributes are readonly; `isdefault` and Meta `readonly` have required/default-false/readonly semantics. `formatvalidated`, `formatvalidatedreason`, `compatibilityvalidated`, and `compatibilityvalidatedreason` are readonly outputs. IDs and epochs have explicit request exceptions. Core timestamps are required but not declared readonly. The complete per-field source ranges are in artifact lines 265–266; principal declarations are [Main `core/model.json:4–63`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.json#L4-L63), [core/spec.md:3251–3314](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3251-L3314), [3454–3549](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3454-L3549).

Custom names must be 1–63 lowercase/digit/underscore characters, not start with a digit, and avoid generated-name collisions. Version projections belong in `attributes`; Resource-wide fields belong in `metaattributes`, not custom `resourceattributes`. Sources: [Main `core/spec.md:929–1009`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L929-L1009), [core/model.md:1096–1129](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1096-L1129).

## 5. Versions, breaking changes, and epochs

Core permits replacing an existing Version. A non-null supplied epoch must match on update/delete; it is ignored on creation; omission/null disables comparison. Updates, including no-op touches, increase epoch without requiring an increment of exactly one. Use the intended Version’s epoch: `meta.epoch` concerns Resource metadata and Version membership, not changes to existing Version contents. Sources: [Main `core/spec.md:1206–1246`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L1206-L1246), [3195–3213](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3195-L3213).

The supplied Message model fixes `hasdocument: false`, `maxversions: 1`. Prose recommends avoiding wire-changing modifications and creating new Message Resources with new `type`/`messageid` values instead. This is SHOULD-strength, not a universal MUST; deviations require an explicit matching mechanism. Breaking result-schema changes should therefore receive new message and major schema identities in this conservative profile. Sources: [Main `message/model.json:25–31`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L25-L31), [message/spec.md:288–307](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L288-L307), [schema/spec.md:363–395](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L363-L395).

Within the seven **custom media types**, only `bindingstatuses` gets `maxversions: 1`; standard Messages remain unchanged. New status Versions can remove the previous default, and sticky defaults are prohibited there. Omission elsewhere defaults to zero but still permits pruning non-default Versions—even retaining only one. Neither setting provides audit retention. Sources: [Main `core/model.md:754–778`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L754-L778), [core/spec.md:3147–3165](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3147-L3165).

## 6. Corrected complete media contribution

This is **modelsource contribution JSON**, not an expanded `/model` response. It has no illegal `immutable`, wildcard, invented index keyword, or redefinition of core attributes.

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

**Separate document validation:** freeze seven explicit closed JSON Schema definitions—Actor, Source, Need, Binding, BindingStatus, Asset, Model—selected by collection and pinned schema version. Validate authoritative documents, then derive optional projections. For example, `acf_has_audio` means some offered mode has audio, not necessarily the selected mode. This does not broadly reapprove the earlier document-schema bundle.

Core validation switches are omitted because their defaults are false; declaring JSON media type or inventing a format name does not install a manifest validator. Source: [Main `core/model.md:937–1016`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L937-L1016).

The carriers follow singular names. **`modelurl` retrieves the manifest, not ONNX weights**; weight locators belong inside the manifest. Likewise, `sourceurl` retrieves the source document, not its RTSP stream. Source: [Main `core/spec.md:3551–3645`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3551-L3645).

## 7. Standard request examples

Assume the catalog’s `vision` Message/Schema Groups already exist and both registries have their appropriate coherent models. These initial-publication requests are not create-only or transactional guarantees.

**Schema:** `POST https://registry.example.com/schemagroups/vision/schemas`, `Content-Type: application/json`

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

**Message:** `POST https://registry.example.com/messagegroups/vision/messages`, `Content-Type: application/json`

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

**Endpoint:** `POST https://control.example.com/endpoints`, `Content-Type: application/json`

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

The schema is metadata-wrapped because this is a collection request. The metadata-only Message has no `message` carrier; the Endpoint has no `versionid`. Runtime CloudEvents still require `id`, `source`, and `specversion`. Message-specific HTTP options are omitted because the CloudEvents implicit binding suffices. Sources: [Main `core/http.md:1778–1803`](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1778-L1803), [message/spec.md:823–838](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L823-L838), [950–975](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L950-L975).

## 8. Remaining defects—not silently repaired

Besides the target, schema-`self`, and envelope-wrapper contradictions:

- Prose names `basemessage`; the model names `basemessageuri`. This subset uses neither. Sources: [Main Message prose:588–635](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L588-L635), [model:33–37](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L33-L37).
- Message HTTP `query` is a map in prose but an array in the model; Endpoint HTTP `query` is a separate map. Sources: [Main Message prose:1068–1084](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L1068-L1084), [model:1244–1273](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L1244-L1273).
- Published RC4’s closed generic Resource-model schema omits validation switches defined by RC4 prose; main adds them. Both schemas permit Boolean `immutable` syntactically without enforcing the extension prohibition. Sources: [RC4 schema:166–215](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.schema.json#L166-L215), [RC4 prose:937–1016](https://github.com/xregistry/spec/blob/d2433a8c726ab096303bd943a4fc6691925f7910/core/model.md#L937-L1016), [Main schema:179–198](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.schema.json#L179-L198).

No deployed server was exercised. This establishes a bounded, explicit interoperability recommendation—not universal RC4 conformance, or proof that a JSON Schema check establishes normative compatibility.
