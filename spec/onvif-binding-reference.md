# ONVIF binding vocabulary and runtime reference

This is a human reference for **all 68 entries: 21 classes and 47 properties**
in the current generated [inventory](../bindings/onvif/vocabulary/terms.json).
It does not edit that artifact or add terms. The implementation authorities are
the [model/vocabulary generator](../packages/binding-onvif/src/catalog/models.ts),
[schema generator](../packages/binding-onvif/src/catalog/schemas.ts),
[projector](../packages/binding-onvif/src/projection/project.ts) and
[native Form gate](../packages/binding-onvif/src/binding/forms.ts).

All entries use the separate provisional namespace
`https://example.org/wot/onvif#`. The context identifier
`https://example.org/wot/onvif/context/v0.1` is an **unhosted placeholder**.
Use the local [context](../bindings/onvif/vocabulary/context.jsonld) or a
configured publication host. Neither the namespace nor binding version changes
[AV 0.2](../spec.md). Terms are project-authored, not registered ONVIF/W3C
vocabulary or certification marks.

## Reading the reference

Every row identifies its author/source, described value, consumer use and
omission/default behavior. "Generator" means this repository's compiler/model
tooling using the locked native source, not the device manufacturing new WoT
terms. "Publisher" means the projector/bridge acting on explicit observations
and deployment policy. These annotations do not grant permission.

The context encodes structured properties as **JSON literals**, document/class
references as **IRIs**, and the remaining properties as literals. This is
different from flattening arbitrary native objects into RDF predicates.
Omission never invents native support, a profile edition, a token, credentials
or successful execution. A declared-only term has no additional runtime
behavior merely because it appears in the inventory.

## Classes

Resource classes describe observed native resources, not instantiated controllers.
The publisher supplies device EPR, native service namespace, kind, ordered
parent-kind/token path and token. Consumers retain that scope; tokens are not
automatically copied into Action input. Resource-specific class absence does
not establish native absence; an unknown kind can retain `ResourceThing` plus
a diagnostic. This common rule applies to every resource row below.

| Entry | Who supplies it / what it describes | How it is used | Omission/default |
| --- | --- | --- | --- |
| `onvif:NativeThing` | Generator: base native endpoint model. | Reuse the pinned registry/source and native Form conventions. | No default implementation or endpoint is created. |
| `onvif:DeviceThing` | Publisher: one observed device identity. | Read its evidenced native interfaces and separate claims. | No device TD is fabricated from an unverified URL alone. |
| `onvif:ResourceThing` | Generator/publisher: generic native resource. | Retain native identity when a more specific resource class is unavailable. | Not an assertion that all resource kinds or operations are known. |
| `onvif:CanonicalXmlValue` | Generator: canonical native payload DataSchema. | Use its source schema plus the local XML codec. | An ordinary TD schema alone does not imply canonical native validation. |
| `onvif:XMLQName` | Generator: expanded XML name value. | Preserve `{ namespace, localName }`, including namespace-sensitive values. | Neither namespace nor local name is inferred from a lexical prefix. |
| `onvif:UsernameTokenSecurityScheme` | Deployment author: explicitly selected WS-Security UsernameToken mechanism. | Runtime obtains scoped password material out of band and emits the native token. | No implicit WSSE or anonymous fallback; unsupported mechanisms fail. |
| `onvif:MutualTlsSecurityScheme` | Deployment author: native SOAP client-certificate mechanism. | Runtime selects a principal-scoped certificate/key for HTTPS. | No inherited global identity; SOAP support does not imply media mTLS. |
| `onvif:MediaProfileThing` | Publisher: device-supplied media-profile bundle/token. | Keep configuration associations and current facts together. | `fixed` means non-deletable, not immutable or a conformance profile. |
| `onvif:RecordingThing` | Publisher: one native recording token. | Select explicit recording/search/replay interactions. | No implicit search, replay URI, seek or recording creation. |
| `onvif:RecordingTrackThing` | Publisher: track token under its recording parent. | Distinguish identical track tokens under different recordings. | No parent or track inventory is invented. |
| `onvif:RecordingJobThing` | Publisher: native recording-job resource. | Retain its identity and evidenced job facts. | No job allocation, start or scheduling default. |
| `onvif:AccessPointThing` | Publisher: native access-point token. | Keep per-access-point facts and explicit related-resource references. | No default access grant or access-control action. |
| `onvif:DoorThing` | Publisher: native door token. | Inspect per-door capabilities; use explicit native operations if authorized. | No inferred lock state, door operation or physical effect. |
| `onvif:AnalyticsModuleThing` | Publisher: analytics module under native configuration scope. | Preserve module identity and declared interface facts. | No model download, inference start or universal algorithm support. |
| `onvif:AnalyticsRuleThing` | Publisher: analytics rule under native configuration scope. | Preserve rule identity without inventing a rule-management API. | No implicit rule configuration or subscription. |
| `onvif:ReceiverThing` | Publisher: native receiver resource. | Describe the evidenced receiver interface. | No automatic push, connection or receiver creation. |
| `onvif:VideoSourceThing` | Publisher: native video-source identity. | Keep source-level facts separate from encoder/profile options. | No sensor-maximum or active-mode default. |
| `onvif:AudioSourceThing` | Publisher: native audio-source identity. | Preserve its token and observed audio facts. | No implied audio track, format or backchannel. |
| `onvif:DigitalInputThing` | Publisher: native digital-input resource. | Associate only its evidenced state/capabilities. | Missing state is unknown, not false. |
| `onvif:RelayOutputThing` | Publisher: native relay-output resource. | Select only explicit, authorized native relay operations. | No relay actuation or default physical state. |
| `onvif:SerialPortThing` | Publisher: native serial-port resource. | Keep native port identity and capabilities. | No automatic serial transfer or settings. |

## Native Form and lifecycle properties

These properties are structured JSON literals except `binding`, `soapAction`
and `registryDigest`, which are literals. The
[Form validator](../packages/binding-onvif/src/binding/forms.ts#L21-L74)
accepts a closed native surface, not arbitrary extension keys.

| Entry | Who supplies it / what it describes | How it is used | Omission/default |
| --- | --- | --- | --- |
| `onvif:binding` | Generator/publisher: native Form binding selector. | `soap12-http-v1` selects Actions; `pullpoint-v1` selects the native Event lifecycle. | Required for a native Form; not an invented `onvif://` URI scheme. |
| `onvif:operation` | Generator: complete binding QName, portType QName and operation tuple. | Resolve exactly one local registry contract. | Required for native Actions; no local-name-only lookup or inferred SOAPAction. |
| `onvif:soapAction` | Generator: literal source SOAP 1.2 action URI. | If supplied, it must equal the registered native action. | Optional in the Form; the local registry remains authoritative. |
| `onvif:registryDigest` | Generator/publisher: content digest of operation and XML descriptors. | Native consume checks a supplied pin; media requires the generated pin. | Optional for ordinary native consume, required for media association; no digest mismatch fallback. |
| `onvif:subscription` | Generator: explicit native Event lifecycle descriptor. | Resolve Create/Pull/Unsubscribe and separately conditional operations/schema from the local registry. | Required for a native PullPoint Event Form; absence never starts a subscription. |

The following is a **native Action Form fragment**, not a complete TD or a
JSON request envelope. The containing TD must define/select `nativeDigest`
and the matching canonical Action schemas. The endpoint is illustrative.

```json
{
    "href": "https://device.example/onvif/device_service",
    "op": "invokeaction",
    "contentType": "application/soap+xml",
    "htv:methodName": "POST",
    "security": [
        "nativeDigest"
    ],
    "onvif:binding": "soap12-http-v1",
    "onvif:operation": {
        "bindingQName": {
            "namespace": "http://www.onvif.org/ver10/device/wsdl",
            "localName": "DeviceBinding"
        },
        "portTypeQName": {
            "namespace": "http://www.onvif.org/ver10/device/wsdl",
            "localName": "Device"
        },
        "operation": "GetDeviceInformation"
    }
}
```

Action input is the canonical value of the registered native request element.
The runtime uses actual document/literal SOAP 1.2 POST at `href`, including
native security and WS-Addressing. It does not send this Form JSON to an RPC
gateway. `onvif:operationQName` is **not** a current term or accepted substitute
for `onvif:operation`; XML payload roots use `onvif:xmlQName` separately.

## Canonical payload properties

The [schema generator](../packages/binding-onvif/src/catalog/schemas.ts) derives
these annotations from native declarations. `sourceDataSchema` is an IRI;
`xmlQName`, `xmlTypeQName`, `xmlFacets`, `xmlWildcard` and `nativeConstraints`
are JSON literals. The other entries in this table are literals.

| Entry | Who supplies it / what it describes | How it is used | Omission/default |
| --- | --- | --- | --- |
| `onvif:sourceDataSchema` | Generator: complete canonical JSON Schema definition IRI, including fragment. | Resolve the local/published definition and also apply native codec constraints. | No ordinary TD `type: "object"` fallback proves the full native contract. |
| `onvif:canonicalType` | Generator: local native type identifier, or `XMLQName` family label. | Relate a schema to the local canonical type graph. | No type is guessed; the operation registry still controls execution. |
| `onvif:xmlQName` | Generator: exact expanded element/attribute name. | Keep namespaces and request/response field identity. | No local-name collapse or prefix-based identity. |
| `onvif:xmlTypeQName` | Generator: declared expanded native type name. | Retain native type/derived-type context. | Anonymous types do not acquire invented names. |
| `onvif:xmlKind` | Generator: `element` or `attribute` mapping origin. | Distinguish native children from `$attributes`. | No element/attribute substitution. |
| `onvif:xmlFacets` | Generator: source restriction facets and their lexical/namespace context. | Apply supported exact native restrictions alongside JSON Schema. | Missing annotation does not erase inherited registry constraints. |
| `onvif:xmlWildcard` | Generator: native wildcard namespace/process policy. | Preserve permitted unknown XML; validate known strict/lax content as required. | No open-content escape where the native source declares none. |
| `onvif:nativeConstraints` | Generator: checks not fully expressible in ordinary JSON Schema. | Require the canonical codec for namespace, calendar, value-space and other native checks. | A valid JSON Schema result alone is not native validation. |
| `onvif:xmlDefault` | Generator: native lexical default. | Preserve explicit empty-defaulted versus absent fields. | Does not insert an omitted observation or argument. |
| `onvif:xmlFixed` | Generator: native fixed lexical value on an attribute. | Apply the registered fixed-value rule. | No fabricated attribute/value when absent. |
| `onvif:validation` | Generator: `sourceDataSchema-and-canonical-codec` validation boundary. | Treat both validation layers as necessary. | Not a certificate or permission to bypass the codec. |
| `onvif:unsupported` | Generator: explicit unimplemented schema reason. | Reject the affected graph, rather than accepting an opaque whole payload. | Absence is not operation/hardware qualification; all current operation graphs compile. |

Native enumerations retain XSD value-space semantics. Int32/UInt32 use exact
range-checked JSON numbers; 64-bit/arbitrary integers, decimals, float/double
lexical values and native dates/times remain strings where required.
Do not coerce them to JavaScript `number` or `Date`. Absence, empty, nil and
explicit defaulted elements differ. Ordered choices, mixed `$children`,
namespace maps and source-declared wildcards preserve native content; this is
not signature-preserving byte rewriting. See the complete
[XML/JSON mapping](onvif-mapping.md#canonical-xml-values-and-schemas).

## Source, integrity and support properties

`source` and `sourcePins` are JSON literals; the remaining entries here are
literals. Their presence identifies source/mapping state, not a product test.

| Entry | Who supplies it / what it describes | How it is used | Omission/default |
| --- | --- | --- | --- |
| `onvif:source` | Generator: source ID, locator/hash and applicable native input/output ownership. | Trace the exact WSDL/XSD declaration rather than guessed protocol behavior. | No source provenance is inferred from an operation name. |
| `onvif:sourcePins` | Generator: source-lock digest and baseline. | Relate the model to the locked public-source set. | No automatic fetch or floating-release selection. |
| `onvif:sourceGroup` | Generator: canonical versus separately conditional/add-on service classification. | Keep add-ons distinct from released-profile requirements. | No automatic add-on inclusion. |
| `onvif:authorship` | Generator: project-authored mapping disclaimer. | Distinguish this mapping from upstream specifications. | No upstream authorship or reuse license is inferred. |
| `onvif:mappingSupport` | Generator: compiled/unsupported operation-graph state. | Check structural descriptor availability. | Not evidence that a device exposes the operation or a workflow passed. |
| `onvif:runtimeStatus` | Generator: explicit runtime qualification/support boundary. | Read the stated operation/Event caveat. | No implicit qualified status from a compiled model. |
| `onvif:requirementsDigest` | Generator/publisher: requirement-index digest. | Identify the role/condition/obligation set used. | No profile edition or requirement satisfaction is inferred. |
| `onvif:projectionDigest` | Projector/publisher: digest of its produced content. | Detect a changed projection; publication can re-version relocated documents. | No signature, trust grant, immutable device state or registration lease is implied. |

## Observation, profile and resource properties

`clientRequirements`, `serviceModels`, `profileModels` and `modelClass` are
IRIs; `serviceNamespace`, `resourceKind`, `requirementSemantics` and
`claimSemantics` are literals. The remaining entries are JSON literals.
The [projector](../packages/binding-onvif/src/projection/project.ts#L511-L608)
keeps claims, observations and supplied registered evidence separate.

| Entry | Who supplies it / what it describes | How it is used | Omission/default |
| --- | --- | --- | --- |
| `onvif:profileClaims` | Publisher: provenance-bearing advertised device profile assertions. | Preserve label, role and any explicitly supplied edition. | No edition is inferred from an unversioned discovery scope. |
| `onvif:profileEdition` | Generator: selected public profile document record. | Read version, date, source pin and role scope. | No current/latest edition or product conformance is inferred. |
| `onvif:observedServices` | Publisher: native namespace/XAddr/version and observation summaries. | Select actual evidenced endpoints, not guessed service URLs. | Missing/failed inventory is not confirmed empty support. |
| `onvif:capabilityEvidence` | Publisher: typed, scoped observations from native facts or explicit evidence. | Evaluate only the relevant device/resource/client condition. | Unknown, denied or omitted facts remain unknown, not false. |
| `onvif:conformanceEvidence` | Deployment supplies; publisher associates issuer/product/firmware/profile/source records. | Keep firmware matching and independent verification status explicit. | No record is manufactured or independently verified by projection. |
| `onvif:resourceIdentity` | Publisher: EPR, service, kind, ordered parents, token and evidence. | Compare parent-scoped resource identity. | Never fill native Action arguments or invent missing parents. |
| `onvif:nativeIdentity` | Generator: native identity components or source type/parent metadata in a TM. | Explain native identity composition. | Not a replacement for an observed device/resource identity. |
| `onvif:requirements` | Generator: requirement-atom IDs associated with feature/profile models. | Resolve the role-specific ledger/index rows. | No unstated requirement set or satisfied status. |
| `onvif:obligationGroups` | Generator: normalized at-least-N alternatives and member obligations. | Preserve complete branches and allow multiple successful alternatives. | No exclusive `oneOf`, independent-universal-M or favorable unknown default. |
| `onvif:safeRead` | Generator/projector: explicit reviewed read Action alias record. | Opt into repeatable aliases; stateful drains remain Actions outside this list. | `includeSafeReadAliases` defaults to false; no `Get*` inference or Property alias. |
| `onvif:diagnostics` | Vocabulary generator: declared diagnostic annotation name. | Current projection returns diagnostics separately; this term has no additional emitted TD behavior. | No missing-diagnostics-means-success rule. |
| `onvif:profileAssessments` | Projector: per-clause applicability, observed operation IDs and unresolved conditions. | Read true/false/unknown applicability, separately from runtime evidence. | No full-profile pass from missing findings or native service presence. |
| `onvif:inputBindings` | Vocabulary generator: declared input-binding annotation name. | No automatic input binding is implemented by this term. | Full canonical Action input remains caller-supplied. |
| `onvif:readOutcomes` | Vocabulary generator: declared outcome annotation name. | Actual summaries currently occur as unprefixed `readOutcomes` inside `observedServices`; do not invent a second execution channel. | Missing result is not an empty successful response. |
| `onvif:clientRequirements` | Generator: separate client-manifest IRI. | Read client consumption/workflow/process obligations. | Does not create a client Thing hosting device Actions. |
| `onvif:serviceModels` | Vocabulary generator: declared service-model reference name. | Service TMs exist, but this term itself has no current emitted linking behavior. | No service implementation is inferred or instantiated. |
| `onvif:profileModels` | Projector: associated released device-profile wrapper IRIs for versioned claims. | Consult requirement context; use the TD's single `rel: "type"` for its observed composite. | No complete-profile typing or inferred edition for unversioned claims. |
| `onvif:modelClass` | Generator: class IRI associated with a model. | Relate a TM to the project device/resource class. | No executable behavior or certification is attached automatically. |
| `onvif:serviceNamespace` | Generator: exact native service namespace. | Distinguish Media1/Media2 and imported native interfaces. | Never infer an XAddr or conflate schema/service/profile versions. |
| `onvif:resourceKind` | Generator: native resource-model kind. | Interpret the appropriate resource identity scope. | Unknown observed kinds retain a generic resource model and diagnostic. |
| `onvif:requirementSemantics` | Generator: explanation of source requiredness, conditions and alternatives. | Read with the actual requirement index. | Prose alone cannot resolve a normative conflict or establish support. |
| `onvif:claimSemantics` | Projector: explicit separation of claims, observations, registered evidence and runtime qualification. | Prevent profile labels becoming conformance badges. | Removing the disclaimer does not turn a claim into proof. |

## Private runtime and separately scoped annotations

The fields below are **not additional entries in the 68-term inventory**.
Do not add them to the generated vocabulary by hand or mistake implementation
metadata for a public binding extension contract.

| Field/surface | Actual owner and restriction |
| --- | --- |
| DataSchema `onvif:xml` | Runtime-owned native element descriptor, regenerated from the local operation registry on the private consumed TD copy. |
| DataSchema `onvif:xmlRegistryId` | Runtime-owned digest selecting a live, reference-counted local XML authority. The graph is not duplicated in every payload schema. |
| DataSchema `onvif:xmlLimits` | Runtime-owned byte/depth/node/attribute bounds. Caller configuration can tighten the supported limits; a TD cannot grant larger limits. |
| DataSchema `onvif:xmlRegistry` | Codec compatibility path for an explicitly supplied inline local registry; not the normal prepared TD layout or authority supplied by an untrusted published TD. |
| Form `onvif:input` | Accepted by the current Action Form key gate but not used to replace registered input or bind tokens. It is not a documented execution shortcut. |
| Schema `onvif:xmlUnique` | Generated schema annotation for native scoped `xs:unique`; codec checks the actual selector/field/value-space constraints. It is not currently an inventory entry. |
| `onvif:discovery`, `onvif:publication`, `onvif:eventPolicyEvidence` | Separate publication context at configured `context/publication/v1`; discovery provenance, registration state and Event policy evidence, not credentials or native route authorization. |

There is no exported `RuntimeCallDataSchema` type in the current package.
The actual schema preparation is
[`canonicalDataSchema`](../packages/binding-onvif/src/binding/forms.ts#L88-L93):
existing public schema annotations plus local `onvif:xml`, `onvif:xmlRegistryId`
and `onvif:xmlLimits`. It runs inside the real node-wot Action/Event path.
The process-wide codec registry is reference-counted by live runtime owners;
the published TD is not mutated. See [native binding](onvif-binding.md).

Native invocation uses `createOnvifRuntime` with explicit `trust` and optional
scoped `credentials`; consume binds the principal to the actual consumed object.
Security selections are conjunctions, not automatic alternatives. Digest,
UsernameToken and SOAP mTLS remain distinct from ordinary stock HTTP
Basic/Bearer/nosec and from media credentials. Do not put passwords, certificate
keys or grants in TDs, vocabulary annotations, URLs or worker arguments.
The [logical-EPR policy](onvif-runtime.md#logical-epr-authorization-status)
uses the independently configured `trust.authorizeLogicalEndpoint` callback.
Its Thing/principal/target/operation/EPR scope must be explicitly approved;
`onvif:discovery` is not a grant. This is runtime configuration, not a new
vocabulary term or an authorization value to serialize into a TD.
