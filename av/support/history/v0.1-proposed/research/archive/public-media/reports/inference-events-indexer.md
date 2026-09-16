# Media inference contracts and a finite-clip Video Indexer adapter

**Primary-source research, 14 September 2026.** This report addresses result contracts and one Azure adapter, not repository architecture or camera transport. xRegistry references use the supplied `xregistry/spec` baseline `16483bb564586423de9c128db89f3b61d360f4e3`; CloudEvents references use the v1.0.2 commit `fc1f6f31f5f011a72183f1bcea20c987cb683ade`. The latter still uses runtime `specversion: "1.0"`. [cloudevents/spec:cloudevents/spec.md:297-313][CE-version]

All media-specific contracts, JSON examples, domains, IDs, timestamps, tensor shapes, and digests below are **original illustrative proposals**, not deployed resources or standardized xRegistry media extensions. The proposed collection is `/mediagroups/factory1/{actors,sources,needs,bindings,bindingstatuses,assets,models}`. xRegistry permits domain-specific extensions, but that does not standardize these particular names. No repository files were changed. [xregistry/spec:core/spec.md:62-104][XR-core]

## 1. Keep four different objects separate

| Object | Meaning in this proposal |
|---|---|
| xRegistry message definition | `/messagegroups/vision/messages/com.example.vision.detections.v1`: constraints describing a class of messages, not an event instance. |
| Runtime CloudEvent | One occurrence, with `source`, `id`, `type`, other context attributes, and optionally `data`. |
| Event data | A `DetectionResult` instance, validated against `/schemagroups/vision/schemas/DetectionResult/versions/1`. |
| Learned-model manifest | `/mediagroups/factory1/models/detector/versions/3`: a proposed manifest identifying executable model artifacts and their interpretation. |

The first three distinctions follow the message catalog's template/filter role, CloudEvents' context/data separation, and the schema registry's document-store role. ONNX instead describes a model containing an executable graph and metadata; its graph inputs/outputs are not a published application event schema. [xregistry/spec:message/spec.md:93-131][XR-message-role] [cloudevents/spec:cloudevents/spec.md:477-492][CE-data] [xregistry/spec:schema/spec.md:134-159][XR-schema-store] [onnx/onnx:docs/IR.md:69-119][ONNX-model] [onnx/onnx:docs/IR.md:222-251][ONNX-graph]

**Proposed reference contract.** Set `registry` to `https://registry.example.com`. `needRef` identifies `/mediagroups/factory1/needs/inspect1`; `sourceRef` identifies `/mediagroups/factory1/sources/camera7`; `offer` selects that source's named `inspection720p` offer. `configRef` is the exact binding snapshot `/mediagroups/factory1/bindings/inspect1/versions/1`, not an invented `configs` collection. That snapshot fixes the need, source/offer, model, preprocessing/postprocessing configuration, and output endpoint `/endpoints/vision-results`.

For the combined example, this binding can configure two explicitly distinct stages: local detector inference and optional managed Video Indexer enrichment. Store each stage's settings separately. Sharing the need, input asset, and binding does not mean sharing model identity or result schema; only the local detector stage below claims detector version 3.

Use `modelRef` plus `modelDigest` for learned artifacts, `assetRef` for the exact analyzed media version, and a separately scoped `jobRef` for execution identity. A job URI does not imply a new standardized xRegistry job collection. Require published binding/model/asset versions to be immutable by **application policy**; a version path alone is not an immutability guarantee, since xRegistry explicitly permits updating a Version. [xregistry/spec:core/http.md:2881-2946][XR-version-write]

## 2. Catalog definitions, registration, and discovery

The following is an **xRegistry message-definition request body**, not a CloudEvent and not a JSON Schema. Attribute constraints are objects under `envelopemetadata`; `dataschemauri` references the payload schema instead of duplicating it. The exact upstream fields are `message/model.json`'s `envelope`, `envelopemetadata`, `dataschemaformat`, `dataschemauri`, and `datacontenttype`. [xregistry/spec:message/model.json:25-84][XR-message-model] [xregistry/spec:message/model.json:1345-1371][XR-message-fields]

```json
{
  "messageid": "com.example.vision.detections.v1",
  "envelope": "CloudEvents/1.0",
  "envelopemetadata": {
    "specversion": {"type": "string", "value": "1.0", "required": true},
    "id": {"type": "string", "required": true},
    "type": {"type": "string", "value": "com.example.vision.detections.v1", "required": true},
    "source": {"type": "uritemplate", "value": "https://vision.example.com/inference/factory1", "required": true},
    "subject": {"type": "string", "required": true},
    "time": {"type": "timestamp", "required": true},
    "dataschema": {"type": "uritemplate", "value": "https://registry.example.com/schemagroups/vision/schemas/DetectionResult/versions/1", "required": true},
    "datacontenttype": {"type": "string", "value": "application/json", "required": true},
    "correlationid": {"type": "string", "required": true},
    "causationsource": {"type": "uri", "required": true},
    "causationid": {"type": "string", "required": true}
  },
  "envelopeoptions": {"mode": "binary"},
  "dataschemaformat": "JsonSchema/draft-07",
  "dataschemauri": "https://registry.example.com/schemagroups/vision/schemas/DetectionResult/versions/1",
  "datacontenttype": "application/json"
}
```

**Upstream inconsistency:** the baseline's CloudEvents subsection mentions an `envelopemetadata.attributes` wrapper, but its authoritative model, generated document schema, and examples place attributes directly under `envelopemetadata`. This example follows that verified flat shape; it does not invent another wrapper. `dataschemaxid` is deliberately unnecessary here: the absolute `dataschemauri` already selects the concrete document. [xregistry/spec:message/spec.md:926-980][XR-envelope-prose] [xregistry/spec:message/model.json:25-84][XR-message-model] [xregistry/spec:message/schemas/document-schema.json:101-148][XR-message-generated]

The endpoint definition below describes a hypothetical provisioned HTTP **push target**. `usage: ["producer"]` means clients produce messages *to* it; it is not a consumer-polling or subscription-management API. The network address belongs in `protocoloptions.endpoints[].uri`, not in CloudEvents `source`. Binary mode must not set `envelopeoptions.format`. Credentials remain out of band. [xregistry/spec:endpoint/spec.md:366-450][XR-endpoint-role] [xregistry/spec:endpoint/spec.md:518-621][XR-endpoint-options] [xregistry/spec:endpoint/spec.md:865-914][XR-endpoint-http]

```json
{
  "endpointid": "vision-results",
  "usage": ["producer"],
  "channel": "vision-results",
  "envelope": "CloudEvents/1.0",
  "envelopeoptions": {"mode": "binary"},
  "protocol": "HTTP",
  "protocoloptions": {
    "endpoints": [{"uri": "https://results.example.com/vision"}],
    "method": "POST",
    "deployed": true
  },
  "messagegroups": ["/messagegroups/vision"]
}
```

**Proposed registration order; these operations were not executed:**

1. Inspect `GET /model` and `GET /capabilities`; provision the separately designed media extension only if supported. Do not reproduce or replace upstream message/endpoint/schema models with local lookalikes.
2. Create `/schemagroups/vision` with `{"schemagroupid":"vision"}` and `/messagegroups/vision` with `{"messagegroupid":"vision","envelope":"CloudEvents/1.0"}`, using the Group `PUT` API.
3. `PUT /schemagroups/vision/schemas/DetectionResult/versions/1`, with `Content-Type: application/schema+json`, `xRegistry-format: JsonSchema/draft-07`, and the **schema document in section 3** as the body. Parent creation is supported unless missing required parent attributes prevent it.
4. `PUT` the message-definition body above to its exact message XID, then the endpoint body to `/endpoints/vision-results`. These are metadata JSON bodies; no copied schema-registry model is needed.
5. Register media actors, camera7 and its named offers, inspect1, the detector manifest/version, and then binding version 1 referencing those existing entities. Publish readiness through the proposed `bindingstatuses` only after validating resolution and provisioning the real output target.
6. Register each immutable media asset descriptor before emitting its availability event. Separately register any frame-available, indexing-completed, or indexing-failed message/schema contracts before publishing those event types.

Group and Version writes, document-body headers, model/capability retrieval, and implicit-parent rules are defined upstream. A read-only/no-code registry may not offer those writes; capabilities and deployment procedures determine the available registration mechanism. [xregistry/spec:core/http.md:1336-1389][XR-group-write] [xregistry/spec:core/http.md:2881-2946][XR-version-write] [xregistry/spec:core/spec.md:701-713][XR-parent] [xregistry/spec:core/http.md:792-814][XR-capabilities] [xregistry/spec:core/http.md:1009-1036][XR-model-read]

**Downstream discovery:** resolve `/endpoints/vision-results`, follow its `messagegroups`, select the message by `messageid`/CloudEvents `type`, fetch `dataschemauri`, and configure the actual HTTP target from `protocoloptions`. The schema URL returns the schema document; the corresponding URL ending in `1$details` returns registry metadata. Do not validate a detection payload against that metadata object. [xregistry/spec:endpoint/spec.md:740-759][XR-endpoint-groups] [xregistry/spec:message/spec.md:568-582][XR-message-id] [xregistry/spec:core/http.md:1518-1578][XR-document-view]

**Another baseline discrepancy:** the generated endpoint JSON Schema assigns `format: "uri"` to `messagegroups` entries, although the normative endpoint text explicitly permits local XIDs such as `/messagegroups/vision`. A strict absolute-URI format check therefore rejects this permitted reference. Integrators need an explicit XID-aware check rather than silently treating the generated schema as a complete normative validator. [xregistry/spec:endpoint/schemas/document-schema.json:1265-1272][XR-endpoint-generated] [xregistry/spec:endpoint/spec.md:740-759][XR-endpoint-groups]

An application needing a pull output or subscription manager must register a **separate** endpoint and its real contract, possibly sharing `channel: "vision-results"`. Registering the push target does not create subscriptions or consumer delivery infrastructure. [xregistry/spec:endpoint/spec.md:865-914][XR-endpoint-http]

## 3. Complete original DetectionResult payload schema

This is the complete, self-contained **event-data schema**, using draft-07 and only local definition references. Its schema dialect corresponds to xRegistry `format: "JsonSchema/draft-07"`. Configure validators to check `format`; draft-07 does not universally require format assertions. [xregistry/spec:schema/spec.md:486-520][XR-jsonschema] [JSON Schema draft-07: Validation Keywords and format][JSONS]

**Application semantics:** detections are observations at individual asset-relative instants, not tracking intervals. A `frame` asset has duration zero and every detection at zero; a `clip` has positive duration. `captureStartUtc` means UTC at the analyzed asset's media-time zero, not upload time or necessarily the original recording's beginning. `recordingOffsetSeconds` maps asset zero into a separately identified recording. Unknown recording/clock information is represented explicitly by `null`, never an invented timestamp.

Optional `frameIndex` is a zero-based ordinal in the analyzed asset's decoded frames; `atSeconds` remains authoritative for timing. The XID patterns intentionally define an ASCII-ID subset for this application profile, not the full permitted identifier space of xRegistry.

Boxes use normalized `x,y,width,height` in the **display-oriented original asset frame**: origin top-left, x rightwards, y downwards. Undo model resizing, padding, cropping, and rotation before publishing. `confidence` is a bounded model/adapter score, not a promise of calibrated probability.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://registry.example.com/schemagroups/vision/schemas/DetectionResult/versions/1",
  "title": "DetectionResult",
  "description": "Original media proposal: bounded per-frame observations over a still or finite clip.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "registry", "needRef", "sourceRef", "offer", "configRef",
    "modelRef", "modelDigest", "assetRef", "jobRef", "media",
    "inlineComplete", "totalDetections", "detections"
  ],
  "properties": {
    "registry": {"type": "string", "format": "uri", "pattern": "^https://", "maxLength": 2048},
    "needRef": {
      "type": "string", "maxLength": 512,
      "pattern": "^/mediagroups/[A-Za-z0-9._~-]+/needs/[A-Za-z0-9._~-]+$"
    },
    "sourceRef": {
      "type": "string", "maxLength": 512,
      "pattern": "^/mediagroups/[A-Za-z0-9._~-]+/sources/[A-Za-z0-9._~-]+$"
    },
    "offer": {"type": "string", "minLength": 1, "maxLength": 128},
    "configRef": {
      "type": "string", "maxLength": 512,
      "pattern": "^/mediagroups/[A-Za-z0-9._~-]+/bindings/[A-Za-z0-9._~-]+/versions/[A-Za-z0-9._~-]+$"
    },
    "modelRef": {
      "type": "string", "maxLength": 512,
      "pattern": "^/mediagroups/[A-Za-z0-9._~-]+/models/[A-Za-z0-9._~-]+/versions/[A-Za-z0-9._~-]+$"
    },
    "modelDigest": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
    "assetRef": {"$ref": "#/definitions/assetVersion"},
    "jobRef": {"$ref": "#/definitions/uri"},
    "media": {"$ref": "#/definitions/media"},
    "inlineComplete": {"type": "boolean"},
    "totalDetections": {"type": "integer", "minimum": 0},
    "detections": {
      "type": "array", "maxItems": 100,
      "items": {"$ref": "#/definitions/detection"}
    },
    "resultSetRef": {"$ref": "#/definitions/assetVersion"}
  },
  "allOf": [
    {
      "if": {"properties": {"inlineComplete": {"const": false}}},
      "then": {"required": ["resultSetRef"]}
    },
    {
      "if": {
        "properties": {"media": {"properties": {"kind": {"const": "frame"}}}}
      },
      "then": {
        "properties": {
          "detections": {"items": {"properties": {"atSeconds": {"const": 0}}}}
        }
      }
    }
  ],
  "definitions": {
    "uri": {"type": "string", "format": "uri", "minLength": 1, "maxLength": 2048},
    "assetVersion": {
      "type": "string", "maxLength": 512,
      "pattern": "^/mediagroups/[A-Za-z0-9._~-]+/assets/[A-Za-z0-9._~-]+/versions/[A-Za-z0-9._~-]+$"
    },
    "media": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind", "width", "height", "captureRef", "recordingRef",
        "recordingOffsetSeconds", "timeBasis", "durationSeconds",
        "captureStartUtc", "captureClockUncertaintyMs"
      ],
      "properties": {
        "kind": {"enum": ["frame", "clip"]},
        "width": {"type": "integer", "minimum": 1},
        "height": {"type": "integer", "minimum": 1},
        "captureRef": {"$ref": "#/definitions/uri"},
        "recordingRef": {"type": ["string", "null"], "format": "uri", "minLength": 1, "maxLength": 2048},
        "recordingOffsetSeconds": {"type": ["number", "null"], "minimum": 0},
        "timeBasis": {"const": "asset-relative-seconds"},
        "durationSeconds": {"type": "number", "minimum": 0},
        "captureStartUtc": {"type": ["string", "null"], "format": "date-time"},
        "captureClockUncertaintyMs": {"type": ["number", "null"], "minimum": 0}
      },
      "allOf": [
        {
          "if": {"properties": {"kind": {"const": "frame"}}},
          "then": {"properties": {"durationSeconds": {"const": 0}}},
          "else": {"properties": {"durationSeconds": {"exclusiveMinimum": 0}}}
        },
        {
          "if": {"properties": {"recordingRef": {"type": "null"}}},
          "then": {"properties": {"recordingOffsetSeconds": {"type": "null"}}}
        },
        {
          "if": {"properties": {"captureStartUtc": {"type": "null"}}},
          "then": {"properties": {"captureClockUncertaintyMs": {"type": "null"}}}
        }
      ]
    },
    "detection": {
      "type": "object",
      "additionalProperties": false,
      "required": ["detectionId", "labelId", "label", "confidence", "atSeconds", "box"],
      "properties": {
        "detectionId": {"type": "string", "minLength": 1, "maxLength": 96},
        "labelId": {"type": "integer", "minimum": 0},
        "label": {"type": "string", "minLength": 1, "maxLength": 128},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "atSeconds": {"type": "number", "minimum": 0},
        "frameIndex": {"type": "integer", "minimum": 0},
        "box": {"$ref": "#/definitions/box"}
      }
    },
    "box": {
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "y", "width", "height"],
      "properties": {
        "x": {"type": "number", "minimum": 0, "exclusiveMaximum": 1},
        "y": {"type": "number", "minimum": 0, "exclusiveMaximum": 1},
        "width": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
        "height": {"type": "number", "exclusiveMinimum": 0, "maximum": 1}
      }
    }
  }
}
```

The adapter additionally enforces arithmetic and referential invariants: `x + width <= 1`, `y + height <= 1`, clip `atSeconds < durationSeconds`, unique detection IDs, label-ID/name agreement with the model manifest, and `totalDetections >= detections.length`. If `inlineComplete` is true, counts must be equal; otherwise the full set must exist at `resultSetRef`. These are explicitly **additional application checks**, not hidden claims about draft-07's local numeric-bound keywords. [JSON Schema draft-07: Validation Keywords and format][JSONS] (sections 6.2, 6.4-6.6)

Adopt a proposed 16-KiB serialized-data budget, measured after encoding; the item cap alone does not prove a byte limit. Store complete oversized results separately, advertise their count/reference, and never silently truncate. Bulk frames/clips stay in asset storage, with versioned descriptors, digests, access policy, and retention. Do not embed media bytes or durable credential-bearing download URLs in result events.

Treat a successful zero-detection result differently from a failed analysis: the former uses an empty array, `totalDetections: 0`, and `inlineComplete: true`; the latter belongs to a separately registered failure contract. Consumers resolve asset descriptors through an authorized, configured registry/artifact service, obtain temporary access out of band, and verify the advertised digest. Neither a reference nor schema validation proves that an asset exists, is accessible, or remains retained.

## 4. Runtime event and matching HTTP representation

**Envelope policy:** `source` identifies the inference occurrence context, not camera7 or the destination. `id` identifies this particular published result. `subject` is the inspect1 need XID within that source's context. `time` is when this result became available; media capture clocks belong in `data.media`. CloudEvents permits optional subject/time attributes, but this application makes them required. [cloudevents/spec:cloudevents/spec.md:248-295][CE-identity] [cloudevents/spec:cloudevents/spec.md:386-428][CE-subject-time]

`dataschema` is the absolute payload-schema document URI; `datacontenttype` is `application/json`. `correlationid` groups this inspection execution. The pair `causationsource`/`causationid` identifies its immediate triggering asset-availability event, avoiding the ambiguity of an ID without a source. These three extensions have **application-defined semantics**, respectively String, URI, and String; they are not built-in CloudEvents correlation guarantees. Their lowercase names and flat placement follow CloudEvents rules. [cloudevents/spec:cloudevents/spec.md:340-384][CE-schema-type] [cloudevents/spec:cloudevents/spec.md:430-457][CE-extensions] [cloudevents/spec:cloudevents/spec.md:162-175][CE-names] [cloudevents/spec:cloudevents/formats/json-format.md:35-47][CE-json]

This complete **runtime CloudEvent JSON representation** is not the registry definition above:

```json
{
  "specversion": "1.0",
  "id": "result-inspect1-run0001-01",
  "source": "https://vision.example.com/inference/factory1",
  "type": "com.example.vision.detections.v1",
  "subject": "/mediagroups/factory1/needs/inspect1",
  "time": "2026-09-14T08:15:12Z",
  "dataschema": "https://registry.example.com/schemagroups/vision/schemas/DetectionResult/versions/1",
  "datacontenttype": "application/json",
  "correlationid": "inspect1-run0001",
  "causationsource": "https://capture.example.com/factory1",
  "causationid": "asset-camera7-clip001-available",
  "data": {
    "registry": "https://registry.example.com",
    "needRef": "/mediagroups/factory1/needs/inspect1",
    "sourceRef": "/mediagroups/factory1/sources/camera7",
    "offer": "inspection720p",
    "configRef": "/mediagroups/factory1/bindings/inspect1/versions/1",
    "modelRef": "/mediagroups/factory1/models/detector/versions/3",
    "modelDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "assetRef": "/mediagroups/factory1/assets/camera7-clip001/versions/1",
    "jobRef": "urn:example:job:inspect1-run0001",
    "media": {
      "kind": "clip", "width": 1280, "height": 720,
      "captureRef": "urn:example:capture:camera7-clip001",
      "recordingRef": "urn:example:recording:camera7-r7",
      "recordingOffsetSeconds": 120,
      "timeBasis": "asset-relative-seconds", "durationSeconds": 10,
      "captureStartUtc": "2026-09-14T08:15:00Z",
      "captureClockUncertaintyMs": 5
    },
    "inlineComplete": true,
    "totalDetections": 1,
    "detections": [{
      "detectionId": "d1", "labelId": 0, "label": "part",
      "confidence": 0.97, "atSeconds": 5.75, "frameIndex": 172,
      "box": {"x": 0.2, "y": 0.3, "width": 0.1, "height": 0.2}
    }]
  }
}
```

Structured serialization would transmit that entire JSON object with `Content-Type: application/cloudevents+json`, but would require compatible message **and** endpoint metadata rather than the binary-only definitions above. Here the body is **only the data object**, and all other attributes map to `ce-` headers. There is no `ce-datacontenttype` header; HTTP `Content-Type` carries that value. The displayed body includes a final newline; actual authorization is supplied out of band. [cloudevents/spec:cloudevents/formats/json-format.md:114-174][CE-json-data] [cloudevents/spec:cloudevents/bindings/http-protocol-binding.md:159-202][CE-http]

```http
POST /vision HTTP/1.1
Host: results.example.com
Authorization: Bearer <RESULT_INGRESS_TOKEN>
Content-Type: application/json
Content-Length: 1013
ce-specversion: 1.0
ce-id: result-inspect1-run0001-01
ce-source: https://vision.example.com/inference/factory1
ce-type: com.example.vision.detections.v1
ce-subject: /mediagroups/factory1/needs/inspect1
ce-time: 2026-09-14T08:15:12Z
ce-dataschema: https://registry.example.com/schemagroups/vision/schemas/DetectionResult/versions/1
ce-correlationid: inspect1-run0001
ce-causationsource: https://capture.example.com/factory1
ce-causationid: asset-camera7-clip001-available

{"registry":"https://registry.example.com","needRef":"/mediagroups/factory1/needs/inspect1","sourceRef":"/mediagroups/factory1/sources/camera7","offer":"inspection720p","configRef":"/mediagroups/factory1/bindings/inspect1/versions/1","modelRef":"/mediagroups/factory1/models/detector/versions/3","modelDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","assetRef":"/mediagroups/factory1/assets/camera7-clip001/versions/1","jobRef":"urn:example:job:inspect1-run0001","media":{"kind":"clip","width":1280,"height":720,"captureRef":"urn:example:capture:camera7-clip001","recordingRef":"urn:example:recording:camera7-r7","recordingOffsetSeconds":120,"timeBasis":"asset-relative-seconds","durationSeconds":10,"captureStartUtc":"2026-09-14T08:15:00Z","captureClockUncertaintyMs":5},"inlineComplete":true,"totalDetections":1,"detections":[{"detectionId":"d1","labelId":0,"label":"part","confidence":0.97,"atSeconds":5.75,"frameIndex":172,"box":{"x":0.2,"y":0.3,"width":0.1,"height":0.2}}]}
```

**Deduplication proposal.** Persist the serialized event and `(source,id)` in an outbox before sending. Retries/replays of that same event retain both values and the original occurrence time; a genuinely new inference or revised result gets a new ID. Consumers atomically record `(source,id)` alongside their application effect. The deduplication retention window must cover the system's replay policy. CloudEvents explicitly permits treating matching source/ID pairs as duplicates, but does not implement that storage or transaction. [cloudevents/spec:cloudevents/spec.md:248-295][CE-identity] [cloudevents/spec:cloudevents/primer.md:323-350][CE-id-primer]

CloudEvents alone supplies **no retries, subscriptions, delivery ordering, exactly-once processing, or automatic schema discovery**. Its core/binding define representation rather than an application processing model; `dataschema` is an identifier, and registry discovery and message transport remain separately configured. Authentication also does not follow from a claimed `source`. [cloudevents/spec:cloudevents/primer.md:94-129][CE-nongoals] [cloudevents/spec:cloudevents/primer.md:145-198][CE-processing] [cloudevents/spec:cloudevents/spec.md:340-384][CE-schema-type]

**Evolution policy.** Preserve existing schema-version bytes. For compatible revisions, use a new version URI while retaining the event type as appropriate. For breaking changes, use a new type, such as `com.example.vision.detections.v2`, and a new schema resource, such as `DetectionResult.v2/versions/1`, retaining old definitions for replay/migration. CloudEvents recommends different schema URIs for incompatibility and its primer recommends changing type; the xRegistry schema specification explicitly requires a new schema Resource for a breaking change. [cloudevents/spec:cloudevents/spec.md:340-384][CE-schema-type] [cloudevents/spec:cloudevents/primer.md:272-316][CE-evolution] [xregistry/spec:schema/spec.md:192-206][XR-schema-breaking]

Do not call every additive field harmless: `additionalProperties: false` makes previously unknown fields invalid for old validators. Compatibility must consider the actual reader/writer direction and configured policy. xRegistry's `compatibility` attribute is optional; when absent it promises no compatibility checking. [JSON Schema draft-07: Validation Keywords and format][JSONS] (section 6.5.6) [xregistry/spec:core/spec.md:3020-3067][XR-compatibility]

## 5. Separate learned-model manifest

ONNX `ModelProto` supplies `ir_version`, `opset_import`, `producer_name`, `producer_version`, `model_version`, `graph`, and optional string metadata. Graph definitions expose input/output information and initializer tensors. These describe an executable learned artifact, not JSON event-property names. Optional metadata does not guarantee standardized preprocessing, class-label provenance, or training-data lineage. [onnx/onnx:docs/IR.md:69-119][ONNX-model] [onnx/onnx:docs/IR.md:222-251][ONNX-graph]

The following **original manifest document** belongs to proposed model version 3. Its repeated-letter digests are conspicuously synthetic, not claims about existing files. In deployment, calculate digests over exact artifact bytes and verify them before loading.

```json
{
  "modelRef": "/mediagroups/factory1/models/detector/versions/3",
  "version": "3",
  "artifact": {
    "uri": "https://artifacts.example.com/models/detector/3/detector.onnx",
    "mediaType": "application/octet-stream",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "externalFiles": []
  },
  "onnx": {
    "irVersion": 9,
    "opsetImports": [{"domain": "", "version": 18}],
    "producerName": "example-training-pipeline",
    "producerVersion": "2026.09",
    "modelVersion": 3
  },
  "inputs": [
    {"name": "images", "elementType": "float32", "shape": [1, 3, 640, 640], "layout": "NCHW"}
  ],
  "outputs": [
    {"name": "boxes", "elementType": "float32", "shape": [1, "N", 4]},
    {"name": "scores", "elementType": "float32", "shape": [1, "N", 2]}
  ],
  "preprocessing": {
    "orientation": "apply-asset-display-rotation",
    "colorOrder": "RGB",
    "resize": {
      "mode": "letterbox", "width": 640, "height": 640,
      "interpolation": "bilinear", "paddingRgb": [114, 114, 114]
    },
    "normalization": {"divideBy": 255, "mean": [0, 0, 0], "std": [1, 1, 1]}
  },
  "labels": {
    "uri": "https://artifacts.example.com/models/detector/3/labels.json",
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "indexBase": 0,
    "values": ["part", "defect"],
    "provenanceRef": "urn:example:ontology:factory1-parts-v2"
  },
  "adapter": {
    "implementationVersion": "1.0.0",
    "decoderRef": "https://artifacts.example.com/adapters/detector/1/decoder-contract.json",
    "postprocessing": {
      "boxMapping": "inverse-letterbox-to-display-oriented-asset",
      "confidenceThreshold": 0.25,
      "nmsIouThreshold": 0.45
    },
    "resultMessageRef": "/messagegroups/vision/messages/com.example.vision.detections.v1",
    "resultSchemaRef": "/schemagroups/vision/schemas/DetectionResult/versions/1"
  },
  "provenance": {
    "trainingRunRef": "urn:example:training-run:detector-3",
    "trainingDataRef": "urn:example:dataset:factory1-parts-v5",
    "trainingDataDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "sourceRevision": "dddddddddddddddddddddddddddddddddddddddd",
    "licenseRef": "https://artifacts.example.com/models/detector/3/license.txt",
    "createdAt": "2026-09-01T12:00:00Z"
  }
}
```

The manifest's camelCase fields are this proposal's representation, not literal ONNX protobuf fields. The decoder contract must fix output-coordinate conventions and postprocessing behavior. Persist exact adapter/preprocessing configuration alongside the binding: changing it can change results without changing weights.

ONNX permits external tensor-data files. If used, the deployment manifest must enumerate and digest **every** required file; hashing only the `.onnx` graph file does not identify external weights. [onnx/onnx:docs/IR.md:382-386][ONNX-external] Keep learned-model versions, adapter versions, and result-schema versions independent: detector version 3 can still publish `DetectionResult` version 1. Neither xRegistry's registry *model* nor a published result *data model* is a trained neural network.

## 6. Still images and clips: proposed lifecycle

**Still path:** capture camera7's selected offer, persist a frame asset and capture reference, then emit a small frame-available event. Inference resolves binding version 1 and model version 3 and publishes `DetectionResult`. For a standalone still, use `media.kind: "frame"`, zero duration/`atSeconds`, and null recording fields when no recording exists. A frame extracted from a recording remains a frame asset but retains its recording offset and capture mapping.

**Clip path:** finalize clip bytes, persist the clip asset/version/digest and recording mapping, publish asset-available, and create a durable local indexing job. Submit to the chosen indexer, associate its provider ID with that job, reconcile progress, retain raw results, and publish a small completed or failed result. Subsequent thumbnails or extracted clips receive their own assets with parent references and offsets.

These sequences are application designs, not CloudEvents execution semantics. They keep bulk media outside transport payloads and avoid claiming that every indexer, including Azure, implements the detector contract. Generic indexing may produce transcripts, labels, scenes, or other descriptors instead of spatial detections; Azure's insight types also differ in shape. [Insights overview][VI-insights] [API schema: VideoContract, VideoIndex, VideoState, InsightInstance][VI-schema]

## 7. Concrete Azure AI Video Indexer cloud adapter

### Ingestion and prerequisites

Use a provisioned **ARM-based cloud account**, its real region and account GUID, an authorized VI access token, and a finite media file. This example does not establish standalone-image, RTSP, live-stream, or Arc behavior. Upload Video documents `videoUrl` retrieval and multipart file upload, not an RTSP ingestion contract. [Upload Video: request.queryParameters and responses][VI-upload] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Paid/VideoIndexerClient/VideoIndexerClient.cs:219-240][VI-multipart]

| Verified property | Applicable limit or requirement |
|---|---|
| Multipart/device/byte upload | 2 GB; omit `videoUrl` and send the media as multipart content. |
| URL upload | 30 GB; URL must identify the actual accessible video/audio file, not a streaming-service webpage. |
| Duration | Six hours, except Basic Audio allows twelve; clips shorter than two seconds can fail. |
| Filename | Upload how-to specifies 80 characters. Do not silently reinterpret this as a verified maximum for every API string field. |
| Formats | Use the support matrix's container **and codec** tables; a file extension alone does not establish compatibility. |

Sources: Microsoft Learn, **Support matrix / Upload file size and video duration**, **Upload and index media / Prerequisites**, and **At scale / Consider using a URL over byte array**; first-party multipart implementation. Limits can change. [Support matrix: Upload file size and video duration; supported file formats and codecs][VI-limits] [Upload and index media: Prerequisites; Troubleshoot uploading issues][VI-upload-howto] [At scale: Consider using a URL over byte array; Respect throttling; Use callback URL][VI-scale] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Paid/VideoIndexerClient/VideoIndexerClient.cs:219-240][VI-multipart]

Ordinary URL ingestion needs public/read-authorized access, commonly a read-only SAS URL. The VI request token is not storage authorization. A separately configured ARM/managed-identity scenario supports firewall-protected storage with `useManagedIdentityToDownloadVideo=true`; do not assume a SAS alone bypasses a firewall. This example uses the ordinary URL path. [Upload Video: request.queryParameters and responses][VI-upload] [Upload videos from a firewall-protected storage account][VI-firewall]

Upload requires Account/Contributor VI-token permissions; Get Index supports Account/Video Reader permissions for private results. Tokens expire in approximately one hour, so background reconciliation needs renewal outside this snippet. The official ARM token-generation route below is a prerequisite reference, **not an operation performed here**. ARM account name and data-plane account GUID are distinct identifiers. [Upload Video: request.queryParameters and responses][VI-upload] [Get Video Index: query parameters and responses][VI-index] [Generate Access Token: URI Parameters; Examples][VI-arm] [FAQ: API access-token questions][VI-faq]

```http
POST https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.VideoIndexer/accounts/{accountName}/generateAccessToken?api-version=2025-04-01
Authorization: Bearer <AUTHORIZED_ARM_TOKEN>
Content-Type: application/json

{"permissionType":"Contributor","scope":"Account"}
```

The response contains `accessToken`. Securely supply it to the adapter; never place credentials in registry definitions or logs. [Generate Access Token: URI Parameters; Examples][VI-arm] [xregistry/spec:endpoint/spec.md:865-914][XR-endpoint-http]

### Upload and authoritative result retrieval

The following PowerShell is an illustrative adapter core, **not executed**. All variables are arbitrary deployment inputs. Durable job persistence, token supply/renewal, secured callback admission, and scheduling are prerequisites; comments identify those application integration points.

```powershell
# Securely supplied: $location, $accountId, $viUploadToken, $viReadToken,
# $clipName, $clipReadUrl, $callbackAdmissionUrl, $localJobId.
# Persist a pending local job before submitting.

function Encode-Query([System.Collections.IDictionary] $values) {
    ($values.GetEnumerator() | ForEach-Object {
        '{0}={1}' -f [Uri]::EscapeDataString([string]$_.Key),
                      [Uri]::EscapeDataString([string]$_.Value)
    }) -join '&'
}

$root = "https://api.videoindexer.ai/$location/Accounts/$accountId"
$query = Encode-Query ([ordered]@{
    name = $clipName
    privacy = 'Private'
    videoUrl = $clipReadUrl
    callbackUrl = $callbackAdmissionUrl
    indexingPreset = 'Default'
})

$accepted = Invoke-RestMethod -Method Post -Uri "$root/Videos?$query" `
    -Headers @{ Authorization = "Bearer $viUploadToken" } -ErrorAction Stop
$providerVideoId = [string]$accepted.id
if ([string]::IsNullOrWhiteSpace($providerVideoId)) {
    throw 'Missing provider video ID: reconcile submission before retrying.'
}
# Atomically persist localJobId -> location/accountId/providerVideoId.
# Upload success is not indexing completion.

# Run this read from the shared polling/callback reconciler with a fresh token.
$escapedId = [Uri]::EscapeDataString($providerVideoId)
$indexUri = "$root/Videos/$escapedId/Index" +
            '?includeSummarizedInsights=false&includeStreamingUrls=false'
$index = Invoke-RestMethod -Method Get -Uri $indexUri `
    -Headers @{ Authorization = "Bearer $viReadToken" } -ErrorAction Stop
# Inspect $index.state and per-video failure/progress fields.
# Persist terminal state, retained artifacts, and outgoing events atomically.
```

These paths, query names, bearer authorization, and ID handling are verified by the live API reference and Microsoft's implementation. The paid sample separately waits after upload; `Default` and `Private` here are explicit example choices. The public reference metadata URL's `api-version=2023-03-01-preview` is **not** a parameter to add to these data-plane requests. [Upload Video: request.queryParameters and responses][VI-upload] [Get Video Index: query parameters and responses][VI-index] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Paid/VideoIndexerClient/VideoIndexerClient.cs:102-134][VI-upload-src] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Paid/VideoIndexerClient/VideoIndexerClient.cs:151-177][VI-poll-src] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Trial/sampleCode.cs:53-61][VI-bearer]

Upload documents HTTP **200** with a `VideoSearchResultItem`; it does not wait for finished insights. Get Index returns `VideoContract`, including top-level `accountId`, `id`, `state`, and `videos[]`. Per-video entries expose string `processingProgress`, nullable `failureCode`/`failureMessage`, and `insights`. Documented states are exactly `Uploaded`, `Processing`, `Processed`, and `Failed`, not `Completed`. [Upload Video: request.queryParameters and responses][VI-upload] [API schema: VideoContract, VideoIndex, VideoState, InsightInstance][VI-schema] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Paid/VideoIndexerClient/Model/ProcessingState.cs:3-8][VI-states]

**Reconciler policy:** schedule bounded, jittered reads for nonterminal states; on `Processed`, retain authoritative results and publish completion once locally; on `Failed`, retain errors and publish failure. Distinguish provider failure from HTTP errors, unknown states, removed media, and local deadline expiry. Get Index documents errors such as `VIDEO_REMOVED`; API error objects use `ErrorType`/`Message`. Both operations document throttling and `Retry-After`. Honor it; a timed-out upload has an ambiguous creation outcome, so do not blindly resubmit. [Upload Video: request.queryParameters and responses][VI-upload] [Get Video Index: query parameters and responses][VI-index] [At scale: Consider using a URL over byte array; Respect throttling; Use callback URL][VI-scale]

### Callback semantics and authenticity

Upload's `callbackUrl` contract describes a completion **POST**, appending `id={videoId}&state={videoState}` and preserving an existing customer query string. A separate person-identification callback has additional face/person fields. The at-scale guide uses broader "state changes" wording; do not infer a callback for every pipeline stage. Microsoft's sample warns that callbacks may arrive **multiple times or never** because of networking failures, recommending idempotency and polling fallback. [Upload Video: request.queryParameters and responses][VI-upload] [At scale: Consider using a URL over byte array; Respect throttling; Use callback URL][VI-scale] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Trial/sampleCode.cs:35-41][VI-callback] [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Trial/sampleCode.cs:64-69][VI-callback-delivery]

No VI-origin signature protocol, signature header, or fixed callback retry schedule was verified in those sources. **Callback authenticity/admission is a prerequisite, not supplied by `id` or `state`.** A customer-controlled, short-lived URL capability can restrict admission but proves possession, not Microsoft identity. The documented `VideoIndexer` service tag is supplementary network filtering, not per-job authentication. If adequate admission/origin assurance cannot be established, use polling only. [Azure-Samples/azure-video-indexer-samples:API-Samples/C#/Trial/sampleCode.cs:35-41][VI-callback] [Network security: service tags][VI-network]

An admitted callback should enqueue reconciliation, match the pending job's stored provider ID, then read Get Index with the **stored** account/region/video ID. Treat callback state as a hint. Handle an early callback racing upload-response persistence without allowing an arbitrary claimed video to become bound to the job. Keep the callback endpoint on the adapter host, separate from registry metadata and the downstream result ingress.

**Attempt identity matters.** The separate `PUT .../Videos/{videoId}/ReIndex` operation documents 204 when re-indexing starts and the same completion callback fields. It is not a fresh-upload completion response. [Re-Index Video: callbackUrl and 204 response][VI-reindex] In this proposal, a re-index request creates a new local attempt and new terminal-event identity, even if the provider video ID stays the same. Never deduplicate all results solely by provider video ID. Serialize attempts or otherwise prevent stale callbacks/results from completing a newer attempt; callback ID/state alone does not identify an application attempt. Persist the normalized output, terminal transition, and outbox event together so duplicate callbacks and polling races converge on the same publication.

### Results, clocks, and retention

Use `videos[].insights`, not callback parameters, as result evidence. The current Get Index contract deprecates `summarizedInsights` and recommends `includeSummarizedInsights=false`. Insight instances carry duration-valued `start`/`end` and adjusted variants; the official transcript example uses `0:00:05.75` to `0:00:07.01`, meaning 5.75-7.01 clip-relative seconds, not UTC. Adjusted timing belongs to the edited timeline. [Get Video Index: query parameters and responses][VI-index] [API schema: VideoContract, VideoIndex, VideoState, InsightInstance][VI-schema] [Transcription, translation, and language identification: Example response][VI-transcript] [Object detection: insight fields and adjusted timing][VI-objects]

Normalize into a **separate proposed indexing-result contract**, for example:

```json
{
  "registry": "https://registry.example.com",
  "sourceRef": "/mediagroups/factory1/sources/camera7",
  "offer": "inspection720p",
  "configRef": "/mediagroups/factory1/bindings/inspect1/versions/1",
  "assetRef": "/mediagroups/factory1/assets/camera7-clip001/versions/1",
  "jobRef": "urn:example:job:camera7-index001",
  "provider": {
    "service": "azure-ai-video-indexer",
    "accountId": "11111111-1111-1111-1111-111111111111",
    "videoId": "example-provider-id",
    "state": "Processed",
    "indexingPreset": "Default"
  },
  "captureRef": "urn:example:capture:camera7-clip001",
  "recordingRef": "urn:example:recording:camera7-r7",
  "recordingOffsetSeconds": 120,
  "captureStartUtc": "2026-09-14T08:15:00Z",
  "timeBasis": "asset-relative-seconds",
  "segments": [{"kind": "transcript", "startSeconds": 5.75, "endSeconds": 7.01}],
  "rawResultRef": "/mediagroups/factory1/assets/camera7-index001/versions/1"
}
```

This is neither native VI JSON nor a `DetectionResult`; register its own message/schema before publishing, for example `com.example.video.index.completed.v1`. Never fabricate bounding boxes for transcripts/labels or attach detector version 3 to VI's managed pipeline. Record the provider preset/custom-model configuration and version information actually available; the examined material does not establish downloadable underlying weights or training lineage. [Indexing configuration: advanced settings and custom models; Delete media][VI-configuration] [Insights overview][VI-insights]

For the known, unedited example, offset 5.75 maps to recording offset 125.75 and UTC `08:15:05.750Z`. That calculation depends on the retained capture origin and timeline mapping; do not derive it from VI upload/creation timestamps or infer frame times from nominal FPS. Preserve clock uncertainty and editing maps separately. Microsoft also warns that scene/shot/keyframe boundaries may shift by less than a second; such analysis uncertainty is distinct from capture-clock uncertainty. [Scene, shot, and keyframe detection: download API and timing notes][VI-scenes]

Retain required raw JSON/thumbnails independently before provider deletion. `retentionPeriod`, when used, is documented as 1-7 days after indexing; source-URL expiration is a different concern. The API's Delete Video distinguishes 200 partial deletion from 204 successful deletion. Use actual retention and cleanup outcomes rather than promising durable availability merely because an event carries a reference. [Indexing configuration: advanced settings and custom models; Delete media][VI-configuration] [Delete Video: responses][VI-delete]

**Remaining ambiguities:** current trial-account pages conflict about API availability, so this adapter deliberately requires an ARM paid account. No current numeric encoded-URL limit was verified; do not invent one. Some public Get Index examples contain malformed-looking duration values, so normalization should follow the schema and insight-specific documentation rather than blindly copying those samples. Callback delivery guidance is sample guidance, not an exactly-once SLA. [Use the API: trial-account API restriction][VI-api-guide] [Accounts overview: Trial account][VI-accounts] [FAQ: API access-token questions][VI-faq] [Get Video Index: query parameters and responses][VI-index] [API schema: VideoContract, VideoIndex, VideoState, InsightInstance][VI-schema]

## Primary-source references

GitHub references are pinned to full SHAs and exact paths/line ranges. Microsoft Learn links are identified by their document/heading in the text; the VI `/mapi` links are first-party operation/schema metadata, not indexing endpoints.

[CE-version]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L297-L313
[CE-identity]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L248-L295
[CE-subject-time]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L386-L428
[CE-schema-type]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L340-L384
[CE-extensions]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L430-L457
[CE-names]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L162-L175
[CE-data]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md#L477-L492
[CE-json]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/formats/json-format.md#L35-L47
[CE-json-data]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/formats/json-format.md#L114-L174
[CE-http]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/bindings/http-protocol-binding.md#L159-L202
[CE-id-primer]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/primer.md#L323-L350
[CE-nongoals]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/primer.md#L94-L129
[CE-processing]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/primer.md#L145-L198
[CE-evolution]: https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/primer.md#L272-L316
[XR-core]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L62-L104
[XR-message-role]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L93-L131
[XR-message-model]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L25-L84
[XR-message-fields]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L1345-L1371
[XR-envelope-prose]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L926-L980
[XR-message-generated]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/schemas/document-schema.json#L101-L148
[XR-message-id]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L568-L582
[XR-schema-store]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L134-L159
[XR-schema-breaking]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L192-L206
[XR-jsonschema]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L486-L520
[XR-compatibility]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L3020-L3067
[XR-endpoint-role]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L366-L450
[XR-endpoint-options]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L518-L621
[XR-endpoint-groups]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L740-L759
[XR-endpoint-generated]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/schemas/document-schema.json#L1265-L1272
[XR-endpoint-http]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L865-L914
[XR-group-write]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1336-L1389
[XR-version-write]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L2881-L2946
[XR-parent]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L701-L713
[XR-capabilities]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L792-L814
[XR-model-read]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1009-L1036
[XR-document-view]: https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1518-L1578
[ONNX-model]: https://github.com/onnx/onnx/blob/c9f169adac34bd690bf0d628e9aae7fde3d4be85/docs/IR.md#L69-L119
[ONNX-graph]: https://github.com/onnx/onnx/blob/c9f169adac34bd690bf0d628e9aae7fde3d4be85/docs/IR.md#L222-L251
[ONNX-external]: https://github.com/onnx/onnx/blob/c9f169adac34bd690bf0d628e9aae7fde3d4be85/docs/IR.md#L382-L386
[JSONS]: https://json-schema.org/draft-07/draft-handrews-json-schema-validation-01
[VI-upload]: https://api-portal.videoindexer.ai/mapi/apis/Operations/operations/Upload-Video?api-version=2023-03-01-preview "Upload Video: request.queryParameters and responses"
[VI-index]: https://api-portal.videoindexer.ai/mapi/apis/Operations/operations/Get-Video-Index?api-version=2023-03-01-preview "Get Video Index: query parameters and responses"
[VI-schema]: https://api-portal.videoindexer.ai/mapi/apis/Operations/schemas/6aa26759ea971909740fb60b?api-version=2023-03-01-preview "API schema: VideoContract, VideoIndex, VideoState, InsightInstance"
[VI-delete]: https://api-portal.videoindexer.ai/mapi/apis/Operations/operations/Delete-Video?api-version=2023-03-01-preview "Delete Video: responses"
[VI-reindex]: https://api-portal.videoindexer.ai/mapi/apis/Operations/operations/Re-Index-Video?api-version=2023-03-01-preview "Re-Index Video: callbackUrl and 204 response"
[VI-limits]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/avi-support-matrix "Support matrix: Upload file size and video duration; supported file formats and codecs"
[VI-upload-howto]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/upload-index-media "Upload and index media: Prerequisites; Troubleshoot uploading issues"
[VI-scale]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/considerations-when-use-at-scale "At scale: Consider using a URL over byte array; Respect throttling; Use callback URL"
[VI-firewall]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/storage-behind-firewall#upload-videos-from-a-firewall-protected-storage-account "Upload videos from a firewall-protected storage account"
[VI-arm]: https://learn.microsoft.com/en-us/rest/api/videoindexer/generate/access-token?view=rest-videoindexer-2025-04-01 "Generate Access Token: URI Parameters; Examples"
[VI-faq]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/faq "FAQ: API access-token questions"
[VI-network]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/network-security "Network security: service tags"
[VI-configuration]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/indexing-configuration-guide "Indexing configuration: advanced settings and custom models; Delete media"
[VI-insights]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/insights-overview "Insights overview"
[VI-transcript]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/transcription-translation-lid-insight#example-response "Transcription, translation, and language identification: Example response"
[VI-objects]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/object-detection-insight "Object detection: insight fields and adjusted timing"
[VI-scenes]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/scene-shot-keyframe-detection-insight "Scene, shot, and keyframe detection: download API and timing notes"
[VI-api-guide]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/video-indexer-use-apis "Use the API: trial-account API restriction"
[VI-accounts]: https://learn.microsoft.com/en-us/azure/azure-video-indexer/accounts-overview "Accounts overview: Trial account"
[VI-upload-src]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Paid/VideoIndexerClient/VideoIndexerClient.cs#L102-L134
[VI-multipart]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Paid/VideoIndexerClient/VideoIndexerClient.cs#L219-L240
[VI-poll-src]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Paid/VideoIndexerClient/VideoIndexerClient.cs#L151-L177
[VI-states]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Paid/VideoIndexerClient/Model/ProcessingState.cs#L3-L8
[VI-callback]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Trial/sampleCode.cs#L35-L41
[VI-callback-delivery]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Trial/sampleCode.cs#L64-L69
[VI-bearer]: https://github.com/Azure-Samples/azure-video-indexer-samples/blob/a8a498b07126be895cae581a321431422156eaad/API-Samples/C%23/Trial/sampleCode.cs#L53-L61
