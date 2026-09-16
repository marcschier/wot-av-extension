# Native ONVIF binding

The private `@wot-av/binding-onvif` runtime consumes native ONVIF SOAP Forms
through node-wot 0.9.2. It is a client binding, not an HTTP control proxy.
Ordinary HTTP(S) affordances still use the stock node-wot HTTP client behind
per-request target and credential checks.

## Authority and support boundary

The local canonical catalog resolves an operation by the complete
`bindingQName`, `portTypeQName`, and operation name, not by a name such as
`GetProfiles` alone. Its digest covers operation and XML descriptors. The
consumed TD may pin that digest; a mismatch fails before a request.

The generated service closure contains 579 operation contracts, 3,426 type
contracts, 33 service bindings, and 39 XML documents with 48 imports. All current
request, response, declared-fault and derived-type graphs compile. These counts
include separately classified conditional/add-on services. The 2,636 source
requirement atoms for S/T/G/M/A/C/D are unchanged and remain separate from
runtime evidence.

**Compiled does not mean every operation is qualified, every optional feature
exists, or any product is ONVIF-conformant.** `coverage/coverage.json` retains
per-operation and per-clause evidence boundaries. Unknown/unimplemented schema
constructs still produce explicit unsupported contracts, not whole-payload XML
escape hatches. No package, site, Directory, or product certification is
established by generation.

## Invocation

```typescript
const thing = await runtime.consume(description, { principal: "operator-a" });
const output = await runtime.invokeAction(thing, actionName, nativeInput, {
    target: approvedXAddr,
    addressing: {
        namespace: endpoint.addressingNamespace,
        to: endpoint.address,
        referenceParameters: endpoint.referenceParameters,
        referenceProperties: endpoint.referenceProperties
    },
    signal,
    timeoutMs: 5000,
    maxResponseBytes: 1024 * 1024
});
const value = await output.value();
```

`thing.invokeAction` uses normal node-wot dispatch. `runtime.invokeAction`
adds a request-local context while retaining that same Action/client/codec
path. Concurrent invocations do not share addressed headers or principals.
`runtime.execute(thing, name, input, options)` uses the same owned TD, registry,
Form, security context and native executor, and returns:

```typescript
{
    value: CanonicalValue | undefined;
    xml: XmlElement | undefined;
    status: number;
    outcome: "response" | "accepted-one-way";
}
```

The closed `NativeInvokeOptions` interface in `src/binding/request.ts` supports
`formIndex`, `target`, `addressing`, `headers`, `signal`, `timeoutMs`, and
`maxResponseBytes`. The `headers` object is keyed by `{namespace}localName` and
contains namespace-aware `XmlElement` values. It cannot replace SOAP,
WS-Addressing, or WS-Security headers. It is not an HTTP Authorization override.

The timeout is one monotonic invocation budget, including streamed input,
credential lookup, Digest challenge/stale-nonce exchanges and the native HTTP
request. A late credential result cannot cause a request after timeout.
Cancellation before send is distinguishable from an uncertain request already
sent. The response byte bound can tighten, not relax, the runtime XML bound.

## Addressing and security

WS-Addressing 2005 and August 2004 are distinct supported namespaces. The full
EPR is retained. In 2005, reference parameters become SOAP headers marked
`IsReferenceParameter=true`; reference properties are invalid. In 2004, both
reference properties and reference parameters are sent without inventing the
2005 marker. Prefix bindings needed by nested XML and QName-valued attributes
are preserved. Mixed-version EPRs fail explicitly.

The physical target must satisfy `trust.allowedOrigins`, optional exact
`allowedTargets`, and optional `principalTargets`. Exact matching includes path
and query. By default, a logical non-HTTP `To` must equal the owned Thing ID;
another HTTP `To` must identify the selected target. A projected logical EPR
alias instead requires explicit `trust.authorizeLogicalEndpoint` policy, the
validated projected identity association, exact ordered EPR headers and the
selected Form target. See the [logical-EPR contract and current regression
status](onvif-runtime.md#logical-epr-authorization-status). This does not relax
physical target or credential policy; URI userinfo, fragments, redirects and
unapproved authentication endpoints remain prohibited.

Credentials are provided out of band for the consumed principal, target
origin/URL, security name and, for Digest, challenged realm. Supported native
selections are explicit `nosec`, Digest, UsernameToken, and principal-scoped
mutual TLS (`cert` or `onvif:MutualTlsSecurityScheme`). Conjunctions require each
declared mechanism. A client certificate/key is credential material, not a
global identity silently inherited from TLS trust. CA and server identity
verification remain enabled. Native Basic/Bearer fallback and unqualified
WS-Security mechanisms are not implemented.

Ordinary HTTP Basic/Bearer/nosec Forms remain a separate stock-client path;
security is resolved per request rather than relying on node-wot's cached
scheme initialization. Unsupported stock paths such as the unscoped SSE
transport remain explicit errors.

## Canonical XML and metadata

Public TD DataSchemas use `onvif:sourceDataSchema` to reference the generated
schema graph. Private consumed-schema fields select a locally registered,
reference-counted XML authority. The multi-megabyte registry is not embedded
in every input/output. Native constraints not expressible in JSON Schema are
annotated and enforced by the codec.

The canonical representation preserves expanded QNames, attributes, ordered
choices, source-declared wildcards, nil versus absence/default, lexical 64-bit
integers/decimals and temporal precision. Mixed types retain ordered text,
elements, comments and processing instructions in `$children`; known declared
children remain type/sequence/occurrence checked. Explicit expanded-QName
alternatives take precedence over wildcard branches. Unknown strict wildcard
content is rejected. This is not a generic claim to validate vendor semantics.

The source-exact XSD pattern subset includes the locked OID, passphrase, and
OASIS topic patterns, including XML-name class subtraction. Unsupported
patterns remain unsupported. Document-wide XML/typed IDs and source-declared
namespace-aware `xs:unique` selectors are checked without correcting spelling
or changing their scope.

`runtime.decodeMetadata(stringOrUtf8Bytes)` maps the complete global
`{http://www.onvif.org/ver10/schema}MetadataStream`, not just a video Frame.
Its `$choice1_1` sequence includes VideoAnalytics, PTZ, Event, Extension,
SensorData and wildcard cases. VideoAnalytics uses `$choice1`. Declared
attributes, extension attributes, namespaces and unknown permitted extension
XML remain available. RTP assembly, bounded gzip and media close are the media
layer's responsibility.

XML defaults are 1 MiB, depth 64, 20,000 nodes, and 128 attributes per element.
The byte limit may be configured up to 16 MiB; other limits can only be
tightened. Malformed/non-UTF-8 XML, DTD/entity declarations, invalid known
fields and exceeded limits fail explicitly.

## Outcomes and lifecycle

SOAP faults retain expanded nested codes, multilingual reasons, native detail
XML, and decoded declared/known detail elements. Sender faults report rejected
execution; a lost/late response after send reports `OutcomeUnknown`. Stateful
drains and writes are not automatically replayed. Digest challenge handling is
not permission to replay an uncertain operation.

The two source one-way Notify bindings have explicit one-way policy. Empty
HTTP 202/204 responses need no SOAP response body, Content-Type, or invented
JSON result. Other status/body combinations are errors; they are not converted
to empty successes.

Native Actions remain conservative in generated TMs. Explicit reviewed read
aliases are separate. Recording search results are stateful Actions: successive
calls drain distinct batches, and EndSearch/fault outcomes remain native.
There is no generic SOAP Property alias.

`runtime.close()` rejects new interactions, accounts for in-flight work, awaits
owned native Event/legacy subscription cleanup before closing factories, then
closes services, codec ownership and transport. Cleanup uncertainty is
observable and repeated close does not replay a native Unsubscribe. See
[Native events](onvif-events.md) for the Event-specific wrapper and limits.

## Qualification

The unit, binding-gate, catalog, and events suites cover independent loopback
SOAP peers, all-source provenance, source-specific canonical facets,
generated/offline schemas and JSON-LD, addressed invocation, mTLS, faults,
one-way messages and selected native workflows. A passing loopback fixture is
not hardware, all-operation, all-profile, network-deployment, or distribution
clearance. Root packaging/exports, bridge composition, and native media have
their own coordinated acceptance gates.
