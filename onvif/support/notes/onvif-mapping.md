# Canonical ONVIF source compilation and WoT projection

The private `@wot-av/binding-onvif` package now compiles the locked native
contracts and generates an additive ONVIF vocabulary, payload schemas, reusable
Thing Models, role-specific requirement manifests, and observed TDs. The
compiler and pure projector do not run discovery, change a device, publish a
Directory entry, or establish product conformance. The separately composed
[runtime/bridge](onvif-runtime.md) performs explicitly configured native reads
and publication; consumers invoke native services without a control gateway.

The namespace is deliberately provisional:
`https://example.org/wot/onvif#`, with context
`https://example.org/wot/onvif/context/v0.1` is an **unhosted placeholder**, not
a public download endpoint. These identifiers are separate from AV v0.1
history and do not change AV 0.2. TDs retain the TD 1.1 context
`https://www.w3.org/2022/wot/td/v1.1`. The AV 0.2 vocabulary and its generators,
archives, vendor W3C files, and `local-only` material are not changed.

## Source authority and measured coverage

[`sources.lock.json`](../../sources.lock.json) remains the only
source/import authority. The baseline is ONVIF 26.06, commit
`68ee1b540a40f848c9599eba2c55b87547c588d6`; individual schema versions are
preserved independently of that release and of profile editions.

| Current artifact | Measured scope |
| --- | --- |
| Source lock | 53 records, including 42 XML inputs and 50 import/include edges |
| Selected service compiler closure | 39 unchanged vendored XML inputs, 48 import/include edges |
| Canonical service entry points | All 17 WSDLs; 500 qualified binding/portType/operation tuples |
| Optional source groups | AdvancedSecurity and AuthenticationBehavior add 79 tuples |
| Generated catalog | 33 bindings, 579 operations, 3,426 source/builtin/anonymous/element type contracts |
| Descriptor support | All 579 current operation graphs compile; 0 unsupported operation graphs |
| Authored requirement index | 2,636 rows, with 28 normalized at-least-N groups and no unresolved native-reference lint errors |
| Generated bundle | 305 files including the manifest (304 listed artifacts), seven device profile wrappers, seven separate client manifests, and the opt-in PullPoint Event TM |

The three older April 2005 discovery/addressing XML inputs are deliberately
outside this service closure. They remain fetch-only under the phase-1 source
policy. Requesting them without an explicit prepared cache is an error, not an
implicit download. The 43 vendored source/notice records remain unchanged.
See [source provenance and legal boundaries](onvif-sources.md).

`loadLockedSources()` verifies each selected source's bytes and SHA-256, XML
document kind and namespace, and the actual ordered import declarations against
the lock. Resolution follows source IDs rather than namespace-only lookup or
arbitrary filesystem paths. DTD/entity declarations and source-time network
retrieval are forbidden. `saxes` supplies namespace-aware syntax parsing.
The development-only `node-soap` probes are not the canonical compiler.

The compiler indexes WSDL bindings, imported portTypes/messages, global and
anonymous XSD types, elements, attributes, and type derivations. All selected
service WSDLs currently omit `wsdl:service`; this is not an error or a reason
to manufacture a service overlay.

An operation's identity is the complete tuple:

```typescript
{
    bindingQName: { namespace, localName },
    portTypeQName: { namespace, localName },
    operation
}
```

The catalog retains the native SOAPAction literal, explicit WS-Addressing action
when declared, request/response roots, WSDL message class names, source IDs,
line/hash provenance, declared faults, and caller/service parameter ownership.
When no explicit input WS-Addressing action is declared, the compiler uses the
literal SOAP 1.2 action, not an operation-name URL guess. One-way operations
have `response: null`, not a fictional empty response.

Media1 and Media2 remain different native contracts. Imported notification
portTypes retain their OASIS namespace even when their binding belongs to the
ONVIF Event WSDL. Declared WSDL faults are not a claim that other SOAP faults
cannot occur.

## Canonical XML values and schemas

There is one runtime descriptor interface, shared by the compiler and codec.
`XmlRegistry` contains type, element, and attribute definitions. A
`{ kind: "ref", ref: "..." }` descriptor resolves in that registry; recursive
types are not infinitely expanded. The registry digest includes the operation
and XML descriptor graphs.

| Native construct | Canonical representation |
| --- | --- |
| Qualified names | `{ namespace, localName }`; namespace-sensitive values are not reduced to local names |
| Attributes | `$attributes`, separate from child elements |
| Simple content | `$value` alongside attributes |
| Repetition | Arrays for zero, one, or many occurrences |
| Ordered choice | Ordered `{ "$case": branch, "$value": value }` entries |
| Mixed content | Ordered `$children` plus `$namespaces`; declared children still undergo native type, sequence and occurrence checks |
| Non-flat model groups | Explicit ordered group arrays; source occurrence bounds remain enforced |
| Absence / empty / nil | Omitted field, empty native value, and permitted `{ "$nil": true }` remain distinct |
| Explicit empty defaulted element | `{ "$default": true }`; the original empty element can be reconstructed |
| Attribute default | Native lexical default is documented; omission is preserved rather than silently inserted |
| Extension | Base sequence/attributes are composed from native derivations |
| `xsi:type` | Locally declared qualified type selections and derived alternatives; abstract types require a concrete selection |
| List / union | Typed arrays / named `$member` selection with XSD first-match checking |
| Int32 / UInt32 | Exact range-checked JSON numbers |
| Int64 / UInt64 / integer / decimal | Lexical strings, not JavaScript numeric coercion |
| Float / double | Lexical strings, including native `INF`, `-INF`, and `NaN` spellings |
| Temporal types | Validated native lexical values; timezone absence and fractional precision remain intact |
| Enumerations | Native XSD value-space comparison, including QName namespaces; not lossy numeric or date coercion |
| Binary | Octets, including leading zeros, preserved in hex/base64 form |
| Native wildcards / `xs:anyType` | Complete namespace-aware XML nodes, only where the source declares open content |

Wildcard namespace exclusions and `processContents` are explicit. Known
lax/strict declarations use the local registry. Unknown strict content is
rejected; unknown lax/skip content is preserved. Wildcard attributes retain
the namespace context needed by unknown QName-valued content. This is typed
XML/content preservation, not signature-preserving byte rewriting.

The generated [payload library](../../payloads.schema.json)
uses JSON Schema 2020-12 `$defs` and references. Select an operation/type fragment;
the library root deliberately rejects payloads. Unsupported operation fragments
also reject validation rather than using permissive `{}` placeholders.
The library describes structure, occurrences, choices, QName objects, primitive
ranges, and representable restrictions. `onvif:nativeConstraints` identifies
checks that ordinary JSON Schema cannot fully express, including native
calendar/value-space/namespace rules. The canonical codec remains required.

TD 1.1 does not provide JSON Schema `$ref`. Published Action DataSchemas therefore
carry an explicit `onvif:sourceDataSchema` IRI and canonical type/XMLQName
annotations rather than expanding recursive graphs or pretending a bare object
schema is the full native type. Ordinary TD validation alone is not canonical
payload validation. The ONVIF context declares these terms; QName annotations
are JSON literals, and schema references are IRIs.

The native runtime augments only its private consumed copy with `onvif:xml`,
`onvif:xmlRegistryId`, and `onvif:xmlLimits`. The ID selects a live, locally
owned XML registry rather than embedding the full graph in every DataSchema.
These descriptors come from the local registry, not from untrusted published
TD annotations. The original TD is unchanged. The
[binding reference](onvif-binding-reference.md) distinguishes these private
codec fields from all 68 generated vocabulary entries.

### Implemented graphs and remaining limits

The former 556-compiled/23-unsupported snapshot is superseded. Current source,
schemas and [coverage](../reports/coverage.json) agree on
**579 compiled / 0 unsupported operations**. The completed mapping includes:

* Ordered native mixed content and namespace-aware known/unknown extensions.
* The locked XSD pattern subset, including OASIS topic patterns, `DotDecimalOID`
  and `Dot11PSKPassphrase`, without substituting JavaScript regex semantics.
* Complete MetadataStream choices; explicit expanded QNames take precedence
  over compatible wildcard branches.
* Document-wide `xml:id`/typed XSD ID and native scoped `xs:unique` checks.
* The two one-way Notify contracts with explicit accepted-empty HTTP 202/204
  execution, not fictional response objects.

This is the selected source graph, not support for every possible XSD construct,
vendor topic or native operation workflow. Unsupported future graphs still
produce rejecting descriptors; there is no opaque whole-operation fallback.
Source-regex qualification is bounded, and genuinely unsupported constructs
remain explicit errors. The projector does not automatically expose one-way
operations from ordinary successful read observations.

Native [Events](onvif-events.md), recording-search drains and
[`runtime.decodeMetadata`](onvif-binding.md#canonical-xml-and-metadata) have
their own exercised paths. The worker's bounded XML guard is not an XSD mapper:
the Node media layer passes complete XML to that canonical runtime decoder.
See [support versus conformance](../reports/onvif-conformance.md).

## Requirement and model composition

The indexer reads `requirements-st.json`, `requirements-gm.json`, and
`requirements-acd.json` without editing them. It preserves the authored rows,
source locators, role, M/C/O levels, enclosing conditions, editorial IDs,
non-TD rationale, and evidence targets. Per-clause resolutions and remaining
runtime/process gates are emitted, not just coverage counters.

| Profile edition | Device rows | Client rows |
| --- | ---: | ---: |
| S 1.3 | 292 | 209 |
| T 1.0 | 477 | 370 |
| G 1.1 | 187 | 193 |
| M 1.1 | 142 | 112 |
| A 1.0 | 108 | 102 |
| C 1.0 | 101 | 96 |
| D 1.0 | 133 | 114 |

These are authored requirement-atom counts, not distinct-operation counts or
proof of complete incorporated-specification coverage. Each ledger's own review
and recursive-dependency limitations remain in the generated coverage artifact.

The adapter normalizes the ledgers' documented group encodings: A/C/D
`atLeast`/`requirementIds`, S/T `atLeastN`/`allRequirementIds`, and G/M inline
alternatives/evidence targets. An M member of a group is not independently
universal. Complete active branches are counted; multiple successful branches
are allowed. Explicit requirement/build evidence is needed to evaluate branch
implementation, not merely an observed remote operation.

Conditions use three-valued logic. Missing, denied, faulted, truncated, untyped,
or uninspected values are unknown, not false. Native absence does not disprove
proprietary support. Client facts remain client facts; resource-scoped facts
are not flattened into endpoint-wide assertions. Unrecognized expressions
produce an explicit unresolved diagnostic.

S's selected document month remains November 2019. Q is retired history;
V/Security Add-on release candidates are excluded and TLS Configuration is
separate. The S GetNodes/GetNode and
G SetTrackConfiguration interpretation conflicts remain unresolved; a known
feature fact does not resolve their normative ambiguity.

Generated native operations are Actions with `safe: false` and `idempotent: false` by
default. The separate SafeReads TM has 28 explicitly reviewed **Action aliases**.
It is opt-in and is not a native Property implementation. There is no `Get*`
heuristic, inferred setter pairing, or safe search-result-drain alias.
The runtime also has an explicit reviewed native access classification;
discovery applies its additional fixed read allowlist. Neither uses a `Get*`
heuristic. WSDLs do not supply the complete authorization table, and an
unclassified or stateful operation is not relabeled as an inspection read.

`models/operations.tm.json` defines each native affordance once. Service,
feature, and device-profile TMs import those definitions with `tm:ref`.
Each generated TM has at most one immediate `tm:extends` base. An observed TD
links to one concrete observed composite TM, not directly to a complete profile
wrapper. Client requirements are separate JSON manifests, not fictional
client-hosted copies of device Actions.

Resource TMs include MediaProfile, Recording, RecordingTrack, RecordingJob,
AccessPoint, Door, analytics module/rule, Receiver, video/audio source,
DigitalInput, RelayOutput, and SerialPort. Tokens remain dynamic native
inventory. A fixed media profile is non-deletable, not immutable. Resource
identity metadata does not silently fill native Action arguments.

## External projection seam

The bridge-facing input authority is
`onvif\samples\reference-runtime\src\catalog\snapshot.ts`; the projector is
`src\projection\project.ts`.

```typescript
project(
    snapshot: DeviceSnapshot,
    catalog: ProjectionCatalog,
    policy: ProjectionPolicy
): ProjectionSet
```

`ProjectionCatalog` is `{ registry: CanonicalCatalog, requirements:
RequirementIndex }`. `ProjectionSet` contains `models`, `tds`,
`clientManifests`, per-clause `assessments`, `diagnostics`, and content digests.
The function is synchronous, deterministic, detached from its inputs, and has
no network, clock, or device-side effects.

| DeviceSnapshot field | Exact contract |
| --- | --- |
| `schemaVersion` | Exactly `1` |
| `epr` | `{ address, referenceProperties: XmlElement[], referenceParameters?: XmlElement[] }` |
| `identity?` | Observation of string `manufacturer?`, `model?`, `firmwareVersion?`, `serialNumber?`, `hardwareId?` |
| `services` | Array of `{ namespace, xaddr, version?: { major, minor }, evidence, capabilities, readOutcomes, supportedOperations? }` |
| `profileClaims` | `{ profile, edition?, role: "device" \| "client", evidence }[]` |
| `resources` | `{ serviceNamespace, kind, token, parentTokens: { kind, token }[], evidence, facts?, operations? }[]` |
| `facts?` | Named `Observation<JsonValue>` records for explicitly scoped/typed condition facts |
| `conformanceEvidence?` | Separate `{ issuer, product, firmware, profile, edition?, source }[]` records |

`Observation<T>` is either `{ state: "known", value: T, evidence }` or
`{ state: "unsupported" | "denied" | "fault" | "timeout" | "truncated" |
"unknown", evidence, detail? }`. A known observation needs nonempty evidence;
a non-known observation must not carry a success-shaped value. Evidence is
`{ sourceId, observedAt?, operation?: OperationReference, detail? }[]`.

Service `capabilities` is an observation of a JSON object. `readOutcomes` is
`{ operation, portType?, binding?, outcome: Observation<JsonValue> }[]`.
Known read results must match the compiled canonical response before they
establish an exposed operation. `supportedOperations` instead supplies
`{ operation, portType?, binding?, support: Observation<boolean> }[]` for
explicitly evidenced operation support. A service advertisement alone does
not establish all its optional operations.

The discovery engine's `InventorySnapshot` is a different, richer inventory
contract. The bridge's snapshot adapter normalizes its current, approved per-device
observations to `DeviceSnapshot`; it must not pass an inventory envelope
directly to `project`. Preserve EPR reference properties, exact service XAddrs,
typed failure outcomes, token ancestry, and claim provenance. Do not silently
promote `lastKnown`/partial data to a current known observation, assign an edition
to an unversioned scope, or convert epoch-millisecond observation times into
native XSD date values. Discovery's lifecycle/conflict/freshness and publisher
eligibility policy remain outside the projector.
Its internal per-device type is also named `DeviceSnapshot`; import that with
an explicit alias rather than conflating it with `catalog/snapshot.ts` or
wildcard-reexporting both names from the package root.

`ProjectionPolicy` requires explicit `securityDefinitions` and a nonempty
`security` selection. Optional `serviceSecurity` entries have
`{ namespace, xaddr?, security }`; an exact endpoint override takes precedence
over the namespace rule. Alternatives are not invented from a conjunction.
`includeSafeReadAliases` and `includeAddOns` default to false.
Credentials are out of band. Native XAddrs must be absolute HTTP(S) URIs with
no userinfo or fragments and are otherwise preserved exactly.

Device IDs hash the EPR Address/reference-properties tuple. Resource IDs also
include service namespace, resource kind, ordered parent kind/token path, and
native token. Changing an IP does not change the identity. Distinct recording
parents can therefore have the same track token without collision. Unknown
resource kinds retain a generic resource TM and a diagnostic; missing parent
inventories or endpoints are not fabricated.

Raw read-result bodies are not copied into TD metadata. Claims, capabilities,
read outcomes/provenance, and registered-evidence association remain visibly
separate. A firmware mismatch is reported rather than turned into conformance.

## Offline artifacts, package use, and commands

The package loads resources relative to its own `dist\catalog-data` directory,
not the caller's working directory or a checkout-relative WSDL path.
`loadPackagedProjectionCatalog()` returns the registry plus requirement index;
`loadPackagedCatalog()` returns the canonical catalog alone.
`defineOperationRegistry(catalog.registry.operations, catalog.registry.xml)`
creates the immutable runtime view of the same contracts, not a second compiler.
`packagedArtifactPath("context.jsonld")` locates the bundled context. There is no
public `loadDefaultCatalog` export in the current package.

Use the [fully typed integration helper](../reference-runtime-guide.md#typed-integration-helper)
for actual constructor options and generated Action selection. Credentials,
principals and trust remain caller-owned and out of band. Loading local
schemas/models/contexts never enables remote retrieval.

Publication is separate from generation. `preparePublication` relocates model,
schema and context document identifiers to the configured static base without
changing the vocabulary namespace or native Form XAddrs. `StaticModelPublisher`
writes an owned directory; it is **not a web server**. Directory mode requires
independent HTTP readback of each required model/import/context/schema document
before registering TDs. File mode is an offline bundle, not reachability proof.
Each TD's single `rel: "type"` points to its observed composite TM.

`generated/manifest.json` owns only its listed files under the five ONVIF
generation directories. Generated JSON uses four spaces. Stale files are
reported by check mode; normal generation removes only obsolete
manifest-owned, unmodified files. `build:onvif` stages the checked generated
assets into the private package; `generate:onvif` can bootstrap those assets
with a compile-only first step.

```powershell
npm run build:onvif
npm run generate:onvif -- --check
npm run test:onvif:catalog
```

`npm run generate:onvif` is reserved for intentional, reviewed regeneration;
do not use it to conceal unexplained integrity changes.
`npm run test:onvif` now selects the composed non-native-worker suite, not only
the historical 37-test SOAP gate. `test:onvif:catalog` covers source/compiler, native-input profile-role goldens,
three-valued/group/editorial cases, independent JSON Schema/JSON-LD checks,
native node-wot execution through generated descriptors, and package artifact
integrity/portability checks. Network-negative generation checks and actual
loopback native tests are separate from legacy AV validation.

The package engine is Node >=20.19.0. Root compilation includes all package
sources and stages pinned generated assets. Current native SOAP/Events,
discovery, publication and media APIs are composed; the bridge's
[logical-EPR regression](onvif-runtime.md#logical-epr-authorization-status)
now passes with explicit independent authorization. Installed-package and CI results belong to
[packaging](onvif-packaging.md), and hardware/full-profile qualification is
not inferred from either. No legacy AV generation or public package/site
publication is performed by the commands above.
