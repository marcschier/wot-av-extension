# First native ONVIF WoT runtime qualification

**Status: first native SOAP gate passed, 2026-09-15.** This is a bounded
implementation gate, not an all-profile implementation, ONVIF certification,
hardware interoperability result, or native-media qualification.

The project-owned, private package is `@wot-av/binding-onvif@0.1.0-dev.0`.
Its `consume()` returns an actual released node-wot `ConsumedThing`. Invoking an
annotated Action sends document/literal SOAP 1.2 directly to its native HTTP(S)
XAddr. The runtime does not start a control server or introduce a gateway.
Ordinary HTTP interactions can run alongside native ONVIF interactions.

## Commands and dependency baseline

From the repository root, with Node available on PATH:

```powershell
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm run test:onvif
```

`test:onvif` performs a fresh strict TypeScript build and runs only this gate's
seven test files. The separate commands are:

| Command | Scope |
|---|---|
| `npm run build:onvif` | Owned binding, security, XML and public entry-point sources |
| `npm run test:onvif:unit` | Build and 15 unit checks, including two dependency qualification probes |
| `npm run test:onvif:binding-gate` | Build and 22 independent loopback integration checks |
| `npm run test:onvif:integration` | Alias for the first binding gate, not the later whole-project integration suite |
| `npm run test:onvif` | Build and all 37 checks above, with no skipped tests |

Do not run `npm ci` in the shared checkout while another process is using its
dependencies. The first installation encountered a stale configured package
mirror; selecting the official registry for that command resolved the missing
version without changing global npm configuration.

Node **>=20.19.0** is required by the manifests and runtime startup guard.
The measured environment was Windows x64, Node **24.21.0**, npm **11.19.0**.
Other Node versions and operating systems have not received this qualification.

| Dependency | Exact version / source pin | Decision |
|---|---|---|
| `@node-wot/core`, `@node-wot/binding-http` | `0.9.2`, `2fd12ddf95ad9684e89d703bb916bc07e1959c79` | Published runtime; no development-master dependency |
| `wot-typescript-definitions` | `0.8.0-SNAPSHOT.31` | Published type package pinned by that released node-wot source |
| `saxes` | `6.0.0` | Namespace-aware parser; canonical mapping is owned by this package |
| `node-fetch` | `2.7.0` | Same transport dependency as the stock HTTP binding, used at its scoped fetch seam |
| `soap` | `1.12.0`, `e65947414c5037b2da55e32d383eb7dd7ac3bc9c` | Development-only WSDL/candidate probes, **not** the runtime XML mapper |
| TypeScript / Node types | `5.9.3` / `22.19.0` | Strict owned-source build |
| Independent fixture parser | `@xmldom/xmldom@0.8.15` | Different parser from the production mapper |
| TLS fixture generator | `selfsigned@2.4.1` | Ephemeral certificates and keys in memory; no committed private key |

The lockfile records exact resolved dependency artifacts and integrity values.
`skipLibCheck` is enabled because published dependency declarations, notably
saxes' generic constraints and optional-property declarations, do not pass the
selected strict declaration checks. Owned sources retain `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
unused-code checks and `noEmitOnError`; no `any` escape or TypeScript suppression
was introduced. External-consumer declaration compatibility with
`skipLibCheck: false` remains a dependency qualification issue.

The node-soap probes show that its lower-level WSDL reader accepts a service-less
WSDL, while its default object mapping coerces a large `long`, a precise decimal
and a nanosecond lexical timestamp into lossy JavaScript values. A passing
disqualification probe is not evidence of a passing node-soap canonical mapper.
No runtime WSDL service overlay or invocation-time schema download is used.

## Public contract and node-wot integration

The public entry point exports:

```typescript
createOnvifRuntime(options): Promise<OnvifRuntime>
defineOperationRegistry(operations): OperationRegistry
readEndpointReference(xml): EndpointReference
```

`OnvifRuntime` provides `consume(td, { principal? })`,
`manageSubscription(thing, options)`, `capabilities` and awaited `close()`.
Options inject the local registry, credential provider, origin/TLS trust policy,
HTTP transport, clock and nonce source. There is a real Node HTTP(S) transport;
injection is not a success-shaped replacement for native execution.

An operation is identified by the complete tuple:

```typescript
interface OperationReference {
    bindingQName: { namespace: string; localName: string };
    portTypeQName: { namespace: string; localName: string };
    operation: string;
}
```

An `OperationDescriptor` adds literal `soapAction` and `addressingAction`,
request/response `ElementDescriptor`s, an access classification and source
provenance. Both action values must be supplied and agree for this SOAP 1.2 gate.
A concrete `wsdl:service` is not required. `defineOperationRegistry` validates,
copies and freezes descriptors and computes an order-independent registry digest.
The digest identifies the supplied contracts; it does not attest to profile
coverage or the completeness of their source compilation.

The provisional native Form contract is:

```json
{
    "href": "https://device.example/onvif/device_service",
    "op": "invokeaction",
    "contentType": "application/soap+xml",
    "htv:methodName": "POST",
    "security": ["nativeDigest"],
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

This is a Form fragment, not a complete TD or deployed vocabulary. The matching
TD defines `nativeDigest` with `scheme: "digest"`. Optional
`onvif:soapAction` must match the registry. Optional TD-level
`onvif:registryDigest` must match the local registry. These project-owned metadata
names must be reconciled with the separately owned binding vocabulary and
generator before publication.

Each consumed TD gets a real Servient with exactly one multiplex factory for
`http` and one for `https`. All Actions in that TD share those scheme factories.
Native Forms dispatch to SOAP; other Forms delegate to the released HTTP client.
There is no `onvif://` scheme. The regression covers ordinary Directory-like
HTTP reads simultaneously with an empty-input native Action.

The stock core initializes client security through a scheme cache. This runtime
instead captures the TD/principal context and resolves the selected Form's
security and credentials for each request, including explicit `formIndex`
overrides. Ordinary HTTP signing remains asynchronous and delegated; fresh
delegates avoid carrying a previous credential into `nosec` requests.
The scoped fetch seam deliberately rejects redirects and retains TLS verification.
Stock SSE, TD security proxies and cross-origin HTTP authentication endpoints
are not qualified and are rejected rather than bypassing that seam.

node-wot selects a codec before protocol invocation and gives it a DataSchema,
not a Form. The runtime therefore adds immutable `onvif:xml` and
`onvif:xmlLimits` descriptors to the **private consumed copy** of Action schemas,
using only the local registry. It does not mutate the source TD. The codec is
stateless, so the global node-wot codec registration does not capture a
particular runtime or registry. Alternative native Forms on one Action must
share the same operation contract; distinct contracts need distinct Actions.
An absent Action argument still causes the executor to construct and send the
required empty SOAP request element.

## Canonical XML gate

| Construct | Qualified representation / behavior |
|---|---|
| Element, attribute and QName-valued identities | Expanded `{ namespace, localName }`; namespace-sensitive values are resolved, not stripped to local names |
| Attributes / simple content | `$attributes` separate from children; `$value` for simple content |
| Repeated elements | Arrays for zero, one and many occurrences |
| Repeated ordered choice | Ordered `{ "$case": branch, "$value": value }` entries |
| Absent / empty / nil | Omitted optional field, empty string/complex element, and permitted `{ "$nil": true }` remain distinct; nil can retain attributes |
| `xsi:type` | Explicit locally declared type alternatives; unknown types fail |
| Lists / unions | List arrays; unions retain `$member` and reject a selection that would change under XSD first-match rules |
| Integers / decimals | Int32/UInt32 are range-checked numbers; Int64/UInt64/arbitrary integer/decimal are lexical strings |
| Binary / temporal | Hex/base64 preserve octets and leading zeros; dateTime remains a validated lexical string, including precision and timezone absence |
| Opaque extensions | Ordered XML nodes, attributes, text, comments, processing instructions, prefixes and retained namespace context |
| Wildcard attributes | `$anyAttributes` plus `$namespaces`, including the explicit empty default namespace |

The primary oracle is static, independently authored XML checked using the
fixture DOM implementation. It is not an expected document generated by the
production codec. Equality is at the typed XML/content-model level: prefix
spelling and redundant new aliases are not identity, but every original
namespace binding and QName interpretation must be retained. This is not a
signature-preserving or byte-identical XML rewriter.

DTD/entity declarations, external entities, undeclared prefixes, malformed XML,
non-UTF-8 input and non-UTF-8 native response charsets fail explicitly.
The parser never retrieves schemas, stylesheets or image URIs.

| Bound | Default | Supported ceiling |
|---|---|---|
| XML / native response bytes | 1 MiB | 16 MiB |
| Element depth | 64 | 64 |
| XML nodes | 20,000 | 20,000 |
| Attributes/declarations per serialized element | 128 | 128 |
| Request deadline | 10,000 ms | 2,147,483,647 ms |
| Adopted subscriptions | 64 | Fixed for this gate |

Native Action input streams and native SOAP HTTP response bodies are bounded
before mapping. Ordinary HTTP response streaming retains the stock binding's
behavior; it is not a bounded native-media interface.
SOAP attachments, MTOM/XOP, compressed SOAP and general mixed-content,
substitution-group, recursive-reference or other unsupported XSD constructs
are not silently represented by permissive schemas. Unknown descriptor fields
are rejected. A future compiler can explicitly emit `kind: "unsupported"` for
an unsupported feature; selecting it fails before invocation.

## Native security, faults and ownership

Credentials are out of band:

```typescript
type CredentialProvider = (scope: CredentialScope) =>
    Promise<ScopedCredential | undefined>;
```

The scope includes Thing ID, principal, origin, complete target URI, security
definition name/scheme and the actual Digest realm when challenged. Returned
material is explicitly scoped to origin/principal/realm. A credential for one
origin cannot be sent to a second origin merely because both origins appear in
the allowlist. URI userinfo and credential-bearing TD headers are rejected.
The binding itself emits no credential logs and does not place credentials in
generated TD copies. Upstream/application diagnostic logging still requires
normal secret-handling discipline.

Native security supports `nosec`, Digest and the provisional
`onvif:UsernameTokenSecurityScheme`. Security arrays are conjunctions;
Digest plus WSSE runs only when both are requested. Alternatives use separate
Forms in this gate; `combo.oneOf` is explicitly unsupported.

SHA-256 is the default permitted Digest algorithm. Legacy MD5 requires explicit
configuration. Independent wire checks cover MD5/auth, SHA-256/auth, and
SHA-256/auth-int with a stale nonce. Only a bounded authentication exchange is
repeated: an initial challenge and at most one changed, explicitly stale nonce,
without changing realm, algorithm or qop. Unsupported algorithms/qop do not
become Basic, bearer or unsecured access. Extra Digest variants in the
implementation are not additional wire-qualification claims.

UsernameToken uses fresh nonce/Created values and the specified PasswordDigest.
Clock and nonce sources are injectable; clock offset is bounded and local.
The runtime does not set device time or change device authentication policy.
HTTP authentication does not encrypt SOAP data; configure HTTPS where required.
TLS checks both trust and hostname. An untrusted issuer and a wrong hostname
are independently rejected; provisioned CA trust is positively exercised.
Client-certificate options do not imply a qualified mutual-TLS workflow.

SOAP faults retain HTTP status, operation identity, expanded Code and ordered
nested Subcodes, localized reasons, Detail, Node and Role. Sender faults are
reported as rejected; a request whose response is lost is `OutcomeUnknown`.
There is no automatic replay after an uncertain write or stateful request.

For the lifecycle gate, a native Action returns an EPR which is read using
`readEndpointReference`. The complete XML is retained alongside Address and
ReferenceParameters. `manageSubscription(thing, { endpoint, unsubscribeAction })`
adopts that EPR. `stop()` and `close()` await the native Unsubscribe response;
runtime `close()` also drains owned cleanup and forbids new interactions.
Repeated cleanup calls share the same result and do not replay an uncertain
Unsubscribe. State is `active`, `closing`, `closed` or `uncertain`.

The independent server holds the Unsubscribe response until explicitly released.
The tests prove that neither subscription stop nor runtime close resolves early,
and that a lost cleanup response is surfaced through an aggregate shutdown
error. This avoids the released node-wot Event stop path that does not await
`unlinkResource`.

The EPR test uses the real namespace distinction: SubscriptionManager's WSDL
portType and Unsubscribe action are in **`http://docs.oasis-open.org/wsn/bw-2`**;
request/response XML elements and creation-response CurrentTime/TerminationTime
are in **`http://docs.oasis-open.org/wsn/b-2`**. Action URIs are registry literals,
not namespace concatenation performed by the runtime.

## Evidence, limits and handoff

| Evidence | Executable source |
|---|---|
| Real consumed TD, SOAP 1.2, empty input, ordinary HTTP coexistence | `packages\binding-onvif\test\binding-gate\native.test.cjs` |
| Colliding binding/portType local names in different namespaces | Same file and `test\unit\registry.test.cjs` |
| Independent typed XML and bounds | `packages\binding-onvif\test\unit\xml.test.cjs` and `test\fixtures\mapping.xml` |
| Digest, WSSE, security cache isolation, TLS and credential origin confinement | `packages\binding-onvif\test\binding-gate\security.test.cjs` and `test\unit\security.test.cjs` |
| Parameter-bearing EPR and awaited/uncertain cleanup | `packages\binding-onvif\test\binding-gate\lifecycle.test.cjs` |
| Service-less WSDL and rejected generic mapper | `packages\binding-onvif\test\unit\soap-candidate.test.cjs` |

The fixtures are intentionally local, independently authored operation
descriptors. GetDeviceInformation's request, five string response members,
portType and SOAP binding were checked against the pinned native WSDL.
The event fixture checks native empty creation and cleanup wire shapes, but
does not implement the complete creation options or a managed PullPoint loop.
The other collision, mapping and lost-write operations are explicitly synthetic.
No production all-profile catalog or generated mapping coverage is shipped here.

**Not implemented or qualified here:** released-profile requirement coverage;
the authoritative WSDL/XSD compiler; full generated DataSchemas/TMs;
native Property aliases; PullMessages serialization, filtering, lease expiry,
renewal, recovery or delivery-gap policy; discovery and Directory publication;
RTSP/RTP/RTCP, metadata-stream reassembly, decoders or native worker integration;
general optional encodings/transports/authentication; hardware access; publication
and certification. Unsupported requested capabilities fail rather than returning
empty successes.

The generator owner must settle the published Form/schema metadata, complete
XSD grammar and type-reference strategy, and registry provenance/coverage rules.
Do not turn inline gate descriptors or opaque EPR/extension handling into a
second competing source compiler. Media metadata must reuse the canonical
mapper through an explicitly qualified descriptor set; this gate does not
implement MetadataStream/VideoAnalytics/Frame or imply media support from a URI.

Root `package.json` and `package-lock.json` belong to this gate until handoff.
The workspace and test/build selectors deliberately cover only the owned package
surfaces; the parent must compose later catalog, discovery, media and native
commands. The existing `.gitignore` was outside this task's edit scope: the
parent must address generated `node_modules` and `packages\binding-onvif\dist`
before any separately authorized source-control/publication work.

No AV Python validator was run during concurrent partial implementation.
Protected tracked AV/archive/W3C paths were checked with a read-only Git diff and
were unchanged. Other agents' source locks, vendor trees, native worker and
discovery/media/catalog code were not edited. No real-device call, Git staging,
commit, push or publication was performed.

Primary pinned references:

- [Released node-wot scheme registration](https://github.com/eclipse-thingweb/node-wot/blob/2fd12ddf95ad9684e89d703bb916bc07e1959c79/packages/core/src/servient.ts#L148-L173),
  [security cache](https://github.com/eclipse-thingweb/node-wot/blob/2fd12ddf95ad9684e89d703bb916bc07e1959c79/packages/core/src/consumed-thing.ts#L478-L565),
  and [Event unlink without await](https://github.com/eclipse-thingweb/node-wot/blob/2fd12ddf95ad9684e89d703bb916bc07e1959c79/packages/core/src/consumed-thing.ts#L272-L292).
- [GetDeviceInformation schema](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/device/wsdl/devicemgmt.wsdl#L479-L517)
  and [SOAP binding](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/device/wsdl/devicemgmt.wsdl#L3870-L3878).
- [Event response elements](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/events/wsdl/event.wsdl#L111-L135)
  and [SubscriptionManager binding](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/events/wsdl/event.wsdl#L713-L746).
- [WS-Addressing reference parameters](https://www.w3.org/TR/2006/REC-ws-addr-soap-20060509/#bindrefp)
  and [RFC 7616 Digest authentication](https://www.rfc-editor.org/rfc/rfc7616).
