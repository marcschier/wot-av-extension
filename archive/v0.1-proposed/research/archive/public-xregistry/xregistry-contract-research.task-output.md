# Findings and recommended integration boundary

**Use xRegistry for discovery, contracts, versioned documents, and message destinations—not as an already-standardized camera/media API.** The authoritative Endpoint, Message Definitions, and Schema specifications inspected here **are directories inside `xregistry/spec`**, not separate companion repositories. Their canonical collections are `endpoints`, `messagegroups` → `messages`, and `schemagroups` → `schemas`. Crucially, **an Endpoint is a Group, not a versioned Resource**. [S1:36–44; S6:108–121,185–199]


Below, **MUST/MAY** identify specification requirements or permissions. **Proposed** identifies integration choices, not requirements imposed by xRegistry. `S#:lines` citations refer to the **13 pinned first-party sources** listed at the end.

## 1. Repository location, pins, and actual maturity

| Snapshot | Exact commit | Status |
|---|---|---|
| `xregistry/spec`, current `main` inspected | `16483bb564586423de9c128db89f3b61d360f4e3` | Commit dated 10 September 2026; working tree of the specifications |
| Published `v1.0-rc4` | `d2433a8c726ab096303bd943a4fc6691925f7910` | Release dated 19 August 2026 |

Commit records: [current specification](https://github.com/xregistry/spec/commit/16483bb564586423de9c128db89f3b61d360f4e3), [rc4 snapshot](https://github.com/xregistry/spec/commit/d2433a8c726ab096303bd943a4fc6691925f7910).

The official artifact table identifies **rc4 as the latest release** and current-branch documents as **WIP**. These are not final 1.0 specifications. Moreover, the current files still carry rc4 identifiers although `main` has advanced beyond the release commit. Pinning only the string `1.0-rc4` therefore does **not** distinguish the published snapshot from the current working draft. The mechanics below describe the inspected `16483bb…` snapshot. [S1:34–55; S2:3–8]

**Proposed:** freeze the specification commit, resolved domain models, and the integration profile together. Avoid treating mutable `main` URLs or a companion’s `modelcompatiblewith` declaration as proof of conformance; the latter explicitly does not imply runtime validation. [S4:538–553]

## 2. Core mechanics that constrain the design

### Hierarchy, identity, and versions

The abstract hierarchy is:

```text
Registry
  /<groups>/<group-id>
    /<resources>/<resource-id>
      /meta
      /versions/<version-id>
```

Every Resource **MUST** belong to one Group and **MUST** have at least one Version. Groups contain metadata and Resource collections; Resources can additionally have a domain-specific document. A Resource-level access selects its **default Version**, which need not be the newest Version. Neither Groups nor Endpoint Groups acquire Resource versioning merely because an application calls them “resources.” [S3:189–240,279–316]

Collections are JSON **maps keyed by entity IDs**, not arrays. Singular names determine identifier fields: `endpointid`, `messagegroupid`, `messageid`, `schemagroupid`, `schemaid`; Version identifiers are always `versionid`. If an ID is already supplied by the request path or collection key, its repetition inside the request object is optional, but a repeated value **MUST** agree. IDs are immutable, case-sensitive for lookup, and unique case-insensitively within their parent. [S3:246–258,1035–1063,1497–1532]

Version identifiers are not content hashes or immutability guarantees. Existing Version contents can be updated. Important model controls are:

| Control | Exact consequence |
|---|---|
| `maxversions` | Defaults to `0`: no stated limit, **not guaranteed historical retention**. Implementations may prune non-default Versions even with `0`. |
| `setversionid` | Defaults to `true`; allows clients to choose Version IDs at creation. |
| `versionmode` | Defaults to `manual`; determines ancestry and newest/oldest selection. It does not mean semantic-version ordering unless `semver` is selected. |
| `meta.defaultversionid` | Identifies the Resource’s default Version. |
| `meta.defaultversionsticky` | When true, holds the explicit default rather than automatically selecting the newest Version. It cannot be true for `maxversions: 1`. |

These are normative model and metadata rules. **Proposed:** reproducible workloads should record explicit schema/artifact versions plus deployment-enforced immutability, retention, or digest checks—not merely unversioned Resource URLs. [S4:754–917; S3:3069–3174,3280–3297]

### `/model` is not the customization write endpoint

At this snapshot, HTTP servers **MUST support `GET /model`**. It returns the full model, including specification-defined attributes and resolved customizations, and is **read-only**. `GET /modelsource` and `PUT /modelsource` are optional capabilities; `modelsource` represents the supplied customization source. An integration must not assume that `PUT /model` is supported. [S5:1009–1090]

Model authors may add Groups, Resources, and attributes, but cannot incompatibly redefine core attributes, remove requiredness/read-only constraints, or delete specification-defined attributes. Supported model updates must leave existing entity representations compliant. Unknown additions to the **model language itself** require server support; an arbitrary annotation in a model file is not automatically a valid model-language extension. [S4:1209–1275]

For Resource customizations:

- `attributes` defines **Version-level metadata**.
- `metaattributes` defines Resource-wide metadata under `meta`.
- `resourceattributes` is reserved for system-managed traversal attributes; users **MUST NOT** add ordinary application attributes there. [S4:1096–1161]

The model supports `$include`/`$includes` and `ximportresources`. Includes are resolved when the model is updated, not continuously; relative include paths resolve relative to their containing document. `ximportresources` reuses a Resource **type definition**, whereas `meta.xref` refers to a Resource **instance**. These mechanisms are not interchangeable. [S4:1284–1310,1345–1409]

### Extension naming and serialization

Normal attribute names **MUST** be 1–63 characters, contain only lowercase letters, digits, and underscores, and not begin with a digit. Thus proposed names such as `acf_transport` are suitable; `x-media`, `mediaType`, and URI-qualified strings are not ordinary attribute names. Explicitly modeled nested objects can opt into `namecharset: "extended"`; generic map keys have their own rules. [S3:853–863,929–976; S4:259–295]

An extension attribute must be explicitly modeled, allowed by a `*` definition at that level, or occur beneath an applicable `any` definition. Otherwise an unknown-attribute error is required. Wildcard acceptance does not give an attribute standardized meaning. Extensions must avoid conflicts with core and implicitly generated collection/document names; domain-specific prefixes are strongly recommended. [S3:979–1005]

Metadata is serialized directly on its owning entity—not automatically beneath a universal `extensions` object.

### References, metadata URLs, and document URLs

The following distinctions are essential:

| Reference | Meaning |
|---|---|
| `xid` | Registry-root-relative identity, such as `/endpoints/results` or `/schemagroups/vision/schemas/result/versions/1`; excludes `$details`. |
| `self` | Server-generated location of the entity. In HTTP API view, document-bearing Resource/Version metadata URLs include `$details`. |
| Document URL | The Resource/Version URL **without `$details`** when `hasdocument: true`. |
| `meta.xref` | A same-Registry Resource alias, not an arbitrary external URI or generic relationship. |
| Attribute `target` | A model constraint on the referenced entity type; an XID can still be dangling. |

For example, `target: "/endpoints"` targets Endpoint Groups. `target: "/schemagroups/schemas"` targets Schema Resources, while the literal target suffix `[/versions]` permits either a Resource or Version. [S3:1080–1205,2714–2738; S4:228–257]

For document-bearing Resources, `<RESOURCE>`, `<RESOURCE>base64`, and `<RESOURCE>url` are **templates for names derived from the singular Resource name**. They are not universal literal fields:

- Schema: `schema`, `schemabase64`, `schemaurl`.
- Conversation: `conversation`, `conversationbase64`, `conversationurl`.
- Proposed `artifact`: `artifact`, `artifactbase64`, `artifacturl`.

At most one carrier is serialized at a time. A URL carrier identifies the Version’s actual external document; it is not a spare address field for an unrelated service or stream. HTTP clients must handle document retrieval as a body response or a `303 See Other` to an external document. They must not assume the Registry validates or mirrors the external location. [S3:3551–3645; S5:1520–1558,1903–1992]

**Proposed:** a metadata-only live-source descriptor should expose a modeled locator such as `acf_locator`. If the Resource document is a manifest, its document URL must retrieve that manifest—not silently mean “connect to the RTSP stream described by the manifest.”

## 3. Endpoint mechanics and the media boundary

### Exact standard shape

The Endpoint model defines:

```text
/endpoints/<endpoint-id>                       Endpoint Group
/endpoints/<endpoint-id>/messages/<message-id> optional local Message Resource
```

There is no standard `/endpointgroups/.../endpoints/...` hierarchy, and no Endpoint-level `/versions/...`. The model imports the Message Resource type with:

```json
"ximportresources": ["/messagegroups/messages"]
```

An Endpoint can contain local `messages` and/or reference separate Message Groups through `messagegroups`. [S6:108–130,185–199,357–364; S7:950–965]

Endpoint attributes include `usage`, `channel`, `envelope`, `envelopeoptions`, `protocol`, `protocoloptions`, and `messagegroups`, alongside core metadata. **Do not confuse root `endpoints`—the collection of Endpoint Groups—with `protocoloptions.endpoints`—an array of connection-address objects.** [S6:225–343; S7:561–700]

### Roles are from the connecting client’s perspective

`usage` **MUST** be a non-empty array using the standardized roles:

| Value | Client-facing contract |
|---|---|
| `producer` | Clients push messages **to** the endpoint; an HTTP result receiver is therefore a producer endpoint. |
| `consumer` | Clients retrieve messages **from** the endpoint. |
| `subscriber` | Clients establish subscription interest; this is a control-plane contract, not the delivery stream itself. |

Normally exactly one role is required. `producer` cannot be combined with another role. Only MQTT, AMQP 1.0, and NATS may combine `["subscriber", "consumer"]`; HTTP and Kafka must keep those roles separate. A shared `channel` can correlate distinct endpoints, but core Endpoint semantics do not define a choreography from that correlation. [S6:366–488]

Canonical predefined protocol selectors are **`HTTP`, `AMQP/1.0`, `MQTT/3.1.1`, `MQTT/5.0`, `NATS`, and `KAFKA`**. Additional protocol names are permitted. Multiple protocols exposed by one physical entity **MUST** be declared as separate Endpoints. [S6:91–106,545–579]

For the predefined bindings, addresses normally use `protocoloptions.endpoints[].uri`; Kafka instead uses `protocoloptions.endpoints[].["bootstrap.servers"]`, an array of broker addresses. HTTP endpoint options include `method`, `headers` as an array, and `query` as a string map. These details belong to the binding—not a universal `url`, `host`, or `transport` field. [S6:592–645,904–913; S7:568–659]

### Do generic media endpoints fit?

**Not automatically.** The Endpoint companion explicitly scopes itself to unidirectional asynchronous message/event sources, sinks, and subscription points. Its HTTP section explicitly says it is **not a general-purpose HTTP API description**. [S6:24–44,867–902]

| Requested surface | Recommended treatment |
|---|---|
| HTTP webhook receiving inference results | Direct use of the standard HTTP producer Endpoint model. |
| HTTP pull interface returning defined frame/sample events | Potentially a standard consumer Endpoint, if its contract genuinely is message/event retrieval. |
| RTSP/RTP media sessions, GigE Vision | No predefined binding in the inspected model. A documented extension binding is possible, but its addressing and operational semantics are profile-defined. |
| Direct USB device access | A custom local-device/media-source descriptor, or a network adapter exposing a separately modeled messaging endpoint. |
| General HTTP control API, playlists, media asset download | Do not equate HTTP transport with Endpoint-companion conformance. Use an appropriate descriptor or document-bearing Resource. |

The classification is a **proposed application of the stated scope**, not a claim that xRegistry prohibits describing media. The core permits arbitrary Resource documents, and Endpoint permits additional protocols; neither permission standardizes RTSP session semantics, USB locality, or camera capability fields. [S3:212–221; S6:545–579,885–890]

### Credentials

`protocoloptions.authorization` describes accepted authorization mechanisms and where authorization is obtained. It **MUST NOT** be credential configuration. Defined metadata includes `type`, `mechanism`, `resourceuri`, and `authorityuri`; HTTP additionally defines carrier names and placement options. Credential values—including API keys, usernames, and passwords—must be supplied out-of-band. [S6:647–738,904–916]

**Proposed:** apply the same separation to media locators and artifact access. Publish neither credential-bearing URLs nor secret authorization-header values as discoverable metadata.

## 4. Message definitions, schemas, and CloudEvents

### Three different contracts

| Concern | Exact field/location |
|---|---|
| Catalog identity | `messageid`, usually supplied as the `messages` map key |
| CloudEvents semantic event type | `envelopemetadata.type.value` |
| Datatype of that metadata declaration | `envelopemetadata.type.type`, typically `"string"` |
| Message payload-schema dialect | `dataschemaformat` |
| Schema Resource/Version dialect | `format` |
| CloudEvents envelope | `envelope: "CloudEvents/1.0"` |
| CloudEvents serialization | `envelopeoptions.mode`; structured-format media type in `envelopeoptions.format` |
| Message transport binding | `protocol` and `protocoloptions` |

There is no standard top-level message-kind field named `type`, no standard `schemaformat`, and no generic `bindings` collection in these models. A business schema’s own `"type": "object"` is yet another, unrelated use of `type`. [S9:123–187,343–382,1345–1368; S11:25–41]

The supplied Message Resource model sets **`hasdocument: false` and `maxversions: 1`**. Message definitions are metadata, not separate opaque message documents. The Schema model instead describes schema documents and requires `format` to match across Versions. [S9:25–31; S10:133–152,363–368; S11:25–41]

### Schema references

`dataschema` and `dataschemauri` are optional but mutually exclusive; either one requires `dataschemaformat`. `dataschemauri` must identify a concrete schema object. `dataschemaxid` is a separate optional reference to an associated Schema Resource in the same Registry. If both `dataschemaxid` and `dataschemauri` are present, message prose requires the URI to equal the referenced entity’s `self`. That rule has an important current-draft conflict discussed below. [S8:728–782]

Use exact format identifiers: for example, **`JsonSchema/draft-07`**, not a guessed spelling. The Schema companion also distinguishes specific types within multi-type schema documents: Protobuf references, for example, must identify a contained message declaration. A format string is not the semantic type of the event. [S10:398–410,489–516,595–611]

The schema model enables `validateformat` and `validatecompatibility`, but sets `strictvalidation: false`. It does not promise that every uploaded document is strictly validated by every implementation. [S11:25–41]

### CloudEvents and bindings

CloudEvents is **recommended**, not mandatory. Matching a Message Resource ID to the CloudEvents `type` is also recommended, not universally required. A CloudEvents definition without an explicit transport can apply across CloudEvents bindings; an explicitly selected message protocol supplies the applicable binding rules. [S8:288–307,823–838]

Where an envelope is specified, prose requires `envelopemetadata`; where a protocol is specified, prose requires `protocoloptions`. CloudEvents declarations go directly under `envelopemetadata`, for example:

```json
{
  "type": {
    "type": "string",
    "value": "com.example.vision.result.v1",
    "required": true
  }
}
```

This is metadata constraining a runtime event, **not the runtime CloudEvent itself**. Missing declarations do not waive CloudEvents’ underlying required attributes. [S8:690–724,950–975; S9:123–187]

Message and Endpoint binding options are not interchangeable. For example, the current **message** HTTP model has `headers` and `query` arrays, whereas the **endpoint** HTTP model has `headers` as an array and `query` as a map. The actual WindGenerator sample uses Kafka message options with a header map whose values contain an inner `name`, plus `dataschemaformat` and `dataschemauri`. Do not translate these shapes into an invented universal binding object. [S9:1142–1285; S7:630–659; S13:2–20]

### Schema registry versus ML model registry

The Schema companion manages serialization, validation, and datatype-definition schemas. It does not define ML weight artifacts, model runtimes, tensor preprocessing, inference capability matching, or model deployment. Supporting additional schema formats does not automatically supply those meanings. [S10:40–67,398–404]

**Proposed:** use standard Schema Resources for workload requests, result payloads, and artifact manifests. Store an ONNX file, weights bundle, or model manifest under an explicitly defined artifact Resource model. Keep its artifact identity/version distinct from the schema version describing its metadata or inference results.


## 5. Discovery and expansion

The standard HTTP names are **`filter` and `inline`**, not `$filter` and `$expand`. Both are optional capabilities. Filters support existence, equality/inequality, ordered comparisons, string wildcards, and dot notation including array traversal. Within one `filter` parameter, comma-separated expressions are ANDed; repeated `filter` parameters are ORed. [S3:3970–4084,4522–4568; S5:3129–3174]

For example, assuming support:

```http
GET /endpoints?filter=usage[*]=producer,protocol=HTTP&inline=messages
```

`inline` expands specified Registry collections, metadata, or documents. It is not a generic graph join following arbitrary `messagegroups` or `dataschemauri` references. Filtering also does not imply inlining. Clients still need explicit reference resolution, and must tolerate capability restrictions and result-size limits. [S3:4136–4139,4297–4397]

For the proposed model below:

```http
GET /acfmediagroups/factory1/mediasources?filter=acf_transport=RTSP,acf_maxwidth>=1920
```

This is metadata matching, not standardized media negotiation.

## 6. Complete illustrative request objects

These are **complete JSON request bodies in the stated contexts**, not full GET responses. Server-generated identity, timestamps, and collection URLs are deliberately omitted. They use a non-conflicting subset of the inspected models; the business payload fields and example identifiers are illustrative.

### A. Result schema and message catalog

For `POST /` on a Registry at `https://catalog.example.com` with the Schema and Message models installed:

```json
{
  "schemagroups": {
    "vision": {
      "format": "JsonSchema/draft-07",
      "schemas": {
        "DetectionResult": {
          "versions": {
            "1": {
              "format": "JsonSchema/draft-07",
              "contenttype": "application/json",
              "schema": {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {
                  "jobid": { "type": "string" },
                  "count": { "type": "integer", "minimum": 0 }
                },
                "required": ["jobid", "count"],
                "additionalProperties": false
              }
            }
          }
        }
      }
    }
  },
  "messagegroups": {
    "vision": {
      "envelope": "CloudEvents/1.0",
      "protocol": "HTTP",
      "messages": {
        "com.example.vision.result.v1": {
          "envelope": "CloudEvents/1.0",
          "envelopemetadata": {
            "type": {
              "type": "string",
              "value": "com.example.vision.result.v1",
              "required": true
            }
          },
          "envelopeoptions": { "mode": "binary" },
          "protocol": "HTTP",
          "protocoloptions": { "method": "POST" },
          "datacontenttype": "application/json",
          "dataschemaformat": "JsonSchema/draft-07",
          "dataschemauri": "https://catalog.example.com/schemagroups/vision/schemas/DetectionResult/versions/1"
        }
      }
    }
  }
}
```

The schema reference intentionally selects a Version’s **document URL**, without `$details`. `jobid` and `count` are application payload properties, not xRegistry extension attributes. The Message definition is metadata-only; the schema is a Resource document. This follows the actual model structures and message-to-schema pattern in the checked-in examples. [S9:25–31,123–153,1205–1285,1345–1368; S11:3–41; S13:2–20,40–72]

### B. Concrete result publication destination

For `PUT /endpoints/vision-results` on an Endpoint Registry:

```json
{
  "usage": ["producer"],
  "protocol": "HTTP",
  "protocoloptions": {
    "deployed": true,
    "endpoints": [
      { "uri": "https://results.example.com/detections" }
    ],
    "method": "POST",
    "authorization": [
      {
        "type": "OAuth2",
        "authorityuri": "https://identity.example.com/.well-known/oauth-authorization-server",
        "resourceuri": "https://results.example.com/"
      }
    ]
  },
  "envelope": "CloudEvents/1.0",
  "envelopeoptions": { "mode": "binary" },
  "messagegroups": [
    "https://catalog.example.com/messagegroups/vision"
  ]
}
```

All attribute names here are standard. The absolute external Message Group URI also avoids the current model’s problematic relative-reference target described below. The endpoint has **no `versions` collection of its own**. [S6:366–450,518–579,647–768; S7:561–700,950–965]

### C. Explicitly proposed media/artifact model

This is a complete custom model contribution to compose with the official models—not a replacement for an existing populated `modelsource`.

**Every domain name and `acf_*` attribute below is proposed.** The structural modeling keywords are xRegistry core.

```json
{
  "groups": {
    "acfmediagroups": {
      "plural": "acfmediagroups",
      "singular": "acfmediagroup",
      "resources": {
        "mediasources": {
          "plural": "mediasources",
          "singular": "mediasource",
          "hasdocument": false,
          "attributes": {
            "acf_transport": {
              "name": "acf_transport",
              "type": "string",
              "required": true
            },
            "acf_locator": {
              "name": "acf_locator",
              "type": "uri",
              "required": true
            },
            "acf_maxwidth": {
              "name": "acf_maxwidth",
              "type": "uinteger"
            }
          }
        },
        "artifacts": {
          "plural": "artifacts",
          "singular": "artifact",
          "hasdocument": true,
          "attributes": {
            "acf_kind": {
              "name": "acf_kind",
              "type": "string",
              "required": true,
              "enum": ["mediaasset", "mlmodel"]
            }
          }
        }
      }
    }
  }
}
```

The profile must define what a locator and advertised width mean, including locality for USB and whether advertised values are limits or supported operating points. This example deliberately does not pretend those semantics already exist in xRegistry. [S4:69–151,194–257,699–815]

With that model installed, these are complete example bodies:

**`PUT /acfmediagroups/factory1/mediasources/camera7/versions/1`**

```json
{
  "acf_transport": "RTSP",
  "acf_locator": "rtsp://cam7.example.com/live",
  "acf_maxwidth": 1920
}
```

**`PUT /acfmediagroups/factory1/artifacts/clip42/versions/1$details`**

```json
{
  "acf_kind": "mediaasset",
  "contenttype": "video/mp4",
  "artifacturl": "https://artifacts.example.com/clip42.mp4"
}
```

**`PUT /acfmediagroups/factory1/artifacts/detector/versions/3$details`**

```json
{
  "acf_kind": "mlmodel",
  "contenttype": "application/octet-stream",
  "artifacturl": "https://artifacts.example.com/detector-v3.onnx"
}
```

The last two use the **same core document mechanism**, but distinct proposed artifact semantics. Neither is misrepresented as a Schema Resource. A manifest-based model could instead make `artifacturl` retrieve a manifest and define its referenced files explicitly. [S3:212–221,3551–3645; S5:1520–1570]

## 7. Current-draft interoperability pitfalls

The inspected artifacts are not perfectly consistent. These are concrete issues, not reasons to invent alternative API fields:

| Issue | Evidence and integration consequence |
|---|---|
| Endpoint Message Group target | Prose says `messagegroups` references Groups, including `/messagegroups/mygroup`; the model specifies `target: "/messagegroups/messages"`, which core target rules identify as a Resource type. Strict model validation and prose can disagree. Do not silently treat this as resolved. [S6:750–771; S7:950–957; S4:228–257] |
| Message inheritance name | Prose defines `basemessage`; the formal model declares `basemessageuri`. A profile must document its chosen compatibility behavior. [S8:588–637; S9:33–37] |
| Schema URI versus metadata `self` | Message prose’s `dataschemaxid`/`dataschemauri` equality rule conflicts with current core HTTP `self` URLs ending in `$details`, while schema references must retrieve schema content. Example A uses a document URL alone to avoid asserting both inconsistent conditions. [S8:761–782; S3:1093–1104; S5:1520–1558] |
| Stale Endpoint examples | Some prose examples use `HTTP/1.1` and an extra `envelopemetadata.attributes` layer. Current selectors/models use `HTTP` and direct metadata declarations. [S6:760–804; S7:561–566; S9:46–55,123–153] |
| Stale real sample placement | The linked Sparkplug sample places `deployed` and address `endpoints` at Endpoint top level. Current semantics put them inside `protocoloptions`; accepting those top-level fields as extensions would not give them the intended deployment meaning. [S12:3–18; S6:592–645,740–748] |
| Binding prose/model differences | Message HTTP prose describes `query` as a map, but the formal model uses an array. Some requiredness and protocol constraints also need semantic validation beyond the model. [S8:1061–1091; S9:1244–1285; S6:836–847] |

**The integration should therefore pin and document a compatibility profile, not claim that copying any current example yields complete conformance.** The sound boundary is standard messages, schemas, and messaging endpoints; explicitly modeled media inventory and artifacts.

## Pinned first-party source catalog

All xRegistry links below use **`16483bb564586423de9c128db89f3b61d360f4e3`**. Inline citations specify additional exact spans within these same files.

| ID | Full source path and pinned line link |
|---|---|
| **S1** | [xregistry/spec:README.md:34–71](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/README.md#L34-L71) — authoritative artifact locations and release/WIP status |
| **S2** | [xregistry/spec:docs/RELEASES.md:3–8](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/docs/RELEASES.md#L3-L8) — release dates |
| **S3** | [xregistry/spec:core/spec.md:189–318](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/spec.md#L189-L318) — hierarchy; attribute/URI rules at 929–1205; documents at 3551–3645; filtering/inlining at 3970–4397 |
| **S4** | [xregistry/spec:core/model.md:1096–1275](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/model.md#L1096-L1275) — model customization; targets at 228–257; version controls at 754–917 |
| **S5** | [xregistry/spec:core/http.md:1009–1090](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/core/http.md#L1009-L1090) — model APIs; document distinction at 1520–1570; external retrieval at 1903–1992; flags at 3129–3214 |
| **S6** | [xregistry/spec:endpoint/spec.md:24–130](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/spec.md#L24-L130) — scope and Group mechanics; roles at 366–450; protocols/auth at 545–768; HTTP scope at 867–916 |
| **S7** | [xregistry/spec:endpoint/model.json:561–700](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/endpoint/model.json#L561-L700) — actual HTTP model; Group references/import at 950–965 |
| **S8** | [xregistry/spec:message/spec.md:690–838](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/spec.md#L690-L838) — schema/envelope/binding rules; inheritance at 588–637; CloudEvents constraints at 950–975 |
| **S9** | [xregistry/spec:message/model.json:25–55](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/message/model.json#L25-L55) — actual Resource model; CloudEvents at 123–187 and 343–382; Kafka/HTTP at 1142–1285; schema fields at 1345–1368 |
| **S10** | [xregistry/spec:schema/spec.md:40–105](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/spec.md#L40-L105) — schema scope; document mechanics at 133–152; format rules at 398–410,489–516,595–611 |
| **S11** | [xregistry/spec:schema/model.json:3–41](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/schema/model.json#L3-L41) — exact Schema model |
| **S12** | [xregistry/spec:cloudevents/samples/scenarios/mqtt-sparkplugB.xreg.json:1–36](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/cloudevents/samples/scenarios/mqtt-sparkplugB.xreg.json#L1-L36) — real Endpoint example |
| **S13** | [xregistry/spec:cloudevents/samples/scenarios/windgenerator-kafka-avro.xreg.json:2–72](https://github.com/xregistry/spec/blob/16483bb564586423de9c128db89f3b61d360f4e3/cloudevents/samples/scenarios/windgenerator-kafka-avro.xreg.json#L2-L72) — real Message-to-Schema example |
