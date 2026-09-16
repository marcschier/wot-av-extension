# Native ONVIF discovery and read-only inspection

The implementation is isolated in `onvif\samples\reference-runtime\src\discovery`.
It is a CLI-less inventory engine, not an HTTP gateway or a Directory publisher.
Construction must not open sockets. Only `start(options)` authorizes configured
interfaces, segments, exact native endpoints, and explicit provisional seeds.
No device configuration, search allocation, subscriptions, synchronization,
credential harvesting, or RTSP PLAY belongs to inspection.

## Snapshot and integration contract

`src\discovery\types.ts` is the TypeScript authority for `InventorySnapshot`
(`schemaVersion: 1`). Projection should import that type; it must not reinterpret
discovery as product conformance. Snapshots are detached finite JSON data.
Times are UTC epoch milliseconds; protocol counters are decimal **strings**.

| Field | Meaning |
| --- | --- |
| `revision`, `capturedAt` | Inventory revision and capture time, not firmware or model versions |
| `devices[].id`, `endpointReference` | Stable EPR Address plus reference-properties identity; never an IP/URL seed hash |
| `epoch`, `inspectionGeneration`, `ordering` | Local work fencing plus separate per-SequenceId native watermarks |
| `state`, `identityConflict` | Candidate/verified/suspect/stale/conflict/departed lifecycle; identity quarantine is latched, not auto-approved |
| `endpoints`, `provenance` | Exact XAddr paths/queries, explicit approval, and interface/segment/source evidence |
| `information`, `services`, `reads`, `resources` | Timestamped observations with distinct known/unsupported/denied/fault/timeout/truncated/unknown outcomes |
| `claims` | Advertised profile-scope labels only, without inferred editions |
| `observedFeatures` | Native capability/read evidence, not satisfied profile requirements |
| `registryEvidence` | Separately curated product/firmware evidence, never scraped or manufactured |
| `seeds` | Operator-named provisional endpoints until native identity is established |
| `diagnostics`, `truncated` | Bounded explicit findings and incomplete inventory, never empty-success fallbacks |

A `ResourceInventory` groups tokens by native service namespace, exact endpoint,
and resource kind. Each token includes its complete `parentTokens` path. A fixed
media-profile flag is not permission to cache its configuration forever.
Only a complete confirmed inventory replaces a prior successful resource list;
errors and partial lists retain their own outcomes. `partial` contains the
current incomplete result. `lastKnown: { value, observedAt, source? }` separately
retains an earlier confirmed value; it is **not** relabeled current-known.
`Observation.source` identifies the actual qualified read and exact XAddr.
Capabilities returned inside `GetServices` or legacy `GetCapabilities` retain
that source, not an invented successful `GetServiceCapabilities` invocation.

`NativeReadAdapter.executeReadonly(operationKey, args, target, request)` receives
the existing registry's fully qualified `operationKey(OperationReference)`, not
an action name or a `Get*` heuristic. It returns the runtime's canonical JSON
result or a typed failure, and must honor byte/time/abort bounds and awaited
`close()`. `target.xaddr` is exact and `target.endpointReference` retains WS-
Addressing reference properties/parameters. An adapter's authenticated identity
evidence must attest the **device**, not merely a user's credential principal.
Exposure of an operation in a TD or registry does not authorize inspection.
`NativeReadResult.responded` distinguishes an actual remote response from a local
policy denial or unsupported decoder/registry. Only a remote unsupported
`GetServices` response enables the bounded legacy `GetCapabilities` fallback.

The compiler/runtime integration owns registry generation and canonical native
dispatch. The discovery module owns the additional fixed read allowlist,
normalization, target gate, bounded scheduling, and snapshot reconciliation.
The existing native SOAP/XML/security sources and package/root build
configuration are intentionally not modified here.

## Engine and adapter lifecycle

`createDiscoveryEngine(ports)` is inert. `start(options)` opens only explicitly
configured segments, restores and validates inventory, then starts bounded
probe/inspection work. `probe()` coalesces overlapping rounds;
`resolve(endpointReference, segmentId)` requires an opened configured segment.
`inspect(deviceId)` uses the same bounded queue and read gate as automatic
inspection. `reconcile()` updates freshness/liveness and checkpoints inventory;
`whenIdle()` waits for current work, not future periodic rounds. `close()` is
idempotent and asynchronous: cancel work, close owned channels/read adapters,
await completion, persist final inventory, and release owned storage locks.
Cleanup uncertainty is an error, never an empty successful snapshot.

Ports are exclusively owned by the engine. Do not share a mutable transport,
read adapter or persistence writer between live engines. `NodeClock`,
`NodeDatagramAdapter`, `RuntimeReadAdapter`, `MemoryPersistence` and
`JsonFilePersistence` are real implementations; the fixture clock/datagram/read
adapters are explicit alternatives. A provider that ignores cancellation
continues to occupy its concurrency budget. Failed provider shutdown is bounded
and reported; the engine cannot close handles secretly owned by a broken custom
provider.

The runtime adapter creates an owned, bounded `createOnvifRuntime` for each read,
consumes a one-action TD using the actual node-wot consumer, obtains the finite
canonical result, and awaits runtime close. Supply registry, credentials, trust,
security selection and principal through `RuntimeReadOptions`; none are obtained
by scanning credential databases. Reuse the deployment's approved trust policy,
not an automatically trusted origin derived from an announcement.

The source-layout import is `src\discovery\index.ts`. A package `./discovery`
export and composed root test scripts are now available.
An integration in the package's `src` can use:

```typescript
import {
    createDiscoveryEngine, JsonFilePersistence, NodeDatagramAdapter,
    RuntimeReadAdapter
} from "./discovery/index.js";

const engine = createDiscoveryEngine({
    datagrams: new NodeDatagramAdapter({
        ipv6Attestations: deployment.ipv6ConfinementEvidence
    }),
    nativeRead: new RuntimeReadAdapter({
        runtimeOptions: deployment.readRuntimeOptions,
        security: deployment.nativeSecurity,
        principal: deployment.nativePrincipal
    }),
    persistence: new JsonFilePersistence({
        path: deployment.privateInventoryPath
    })
});

try {
    await engine.start(deployment.discoveryOptions);
    await engine.whenIdle();
    const snapshot = engine.snapshot();
    // Pass snapshot to the separately owned pure projection module.
} finally {
    await engine.close();
}
```

`deployment` above is explicit operator configuration, not a supplied default.
`interfaces` require unique IDs and numeric non-wildcard addresses. Each segment
has its own ID, interface ID, canonical nonzero-prefix CIDR, exact UDP destination,
listen port and multicast flag. Unicast destinations must be inside the selected
segment; no host enumeration or broadcast fallback is implemented.
`allowedXAddrs` is an exact-string HTTP(S) allowlist including path/query, not
an origin wildcard. Userinfo, fragments, control escapes and ambiguous invalid
URIs are rejected. Seeds additionally require explicit `seedId`, interface and
segment. A seed remains provisional until `GetEndpointReference` establishes its
EPR; an expected EPR is a check, not permission to hash the seed URL into identity.

## Protocol and identity policy

Use SOAP 1.2, WS-Addressing **2004/08**, and WS-Discovery **April 2005**. Separate
`tds:Device` and `dn:NetworkVideoTransmitter` Probes express logical OR; putting
both QNames in one Probe would require AND and miss legacy S devices. Untyped
fallback is disabled unless explicitly selected and bounded. Scope matching
uses ONVIF's RFC3986 rule with case-sensitive path segments.
Scheme and authority comparisons are case-insensitive; unreserved percent
escapes are canonicalized, reserved escaped slashes are not path separators,
dot segments prohibit a match, and query/fragment components are excluded from
scope comparison. XAddr target authorization is a different operation and does
**not** discard path/query information.

Correlated matches require an outstanding request of the right action,
interface, segment, `RelatesTo`, and deadline. Retransmissions keep MessageIDs.
Unsolicited Hello/Bye and DiscoveryProxy announcements take distinct paths;
an announcement never auto-approves a proxy or suppresses configured probes.

Higher InstanceId advances the local epoch and fences inspections. Lower
instances, lower message numbers in the same sequence, and replayed MessageIDs
cannot renew freshness. Different SequenceIds, including omitted versus explicit,
are incomparable and retain separate watermarks. Contradictory presence is a
conflict, not last-arrival-wins. MetadataVersion never rolls back on restart.
Duplicate MessageIDs received on another interface retain provenance.
The omitted SequenceId is `null`; an explicitly empty or relative URI reference
is a distinct sequence. Counters remain lossless decimal strings.

Same EPR across NICs normally merges. Only contradictory authenticated or
provisioned identity evidence establishes a clone conflict; different addresses
alone do not. Bye marks suspicion; retirement requires grace plus at least two
separate failed liveness rounds. Denial or SOAP faults demonstrate responsiveness,
not absence. Tombstones remain durable and bounded.

### Transport confinement

Native multicast uses UDP 3702, IPv4 `239.255.255.250` and IPv6 `ff02::c`.
The Node adapter uses an **interface-address-bound ephemeral request socket**
for unicast replies and a separate **group-address-bound socket on 3702** for
unsolicited multicast Hello/Bye. Joining a group on a socket bound only to the
unicast address is not treated as proof of multicast reception. Membership and
outgoing interface are explicit; multicast hop limit is one. No `0.0.0.0`/`::`
receiver fallback exists. Unsupported group binding fails startup and closes
already opened sockets instead of pretending passive discovery works.

IPv6 zone selection uses the current OS interface data, not a hard-coded index
or an unscoped default route. Configured zones must agree with that data; current
interface/zone mapping is rechecked before sends. Link-local unicast destinations
also carry the selected zone. Windows IPv6 multicast requires explicit evidence
matching Node version, platform, interface ID/address and current scope ID.
`bestEffort` records unavailability without opening the unsupported IPv6 segment;
`required` fails startup and cleans up. The deployment must verify group binding,
join/send/receive, same-CIDR/multi-NIC behavior, wrong-interface rejection and
firewall confinement before claiming support. Interface provenance identifies
the configured receiving binding; Node's `message` callback is not an independent
kernel packet-interface attestation.

DiscoveryProxy suppression Hello requires `d:Suppression` and the native
DiscoveryProxy/TargetService types. Proxies are observed and guarded separately;
managed-mode proxy approval/suppression is deliberately not implemented. Device
ordering watermarks are never replaced with a proxy's sequence.

### Bounds and read coverage

Defaults are finite and validated; unknown configuration keys are errors.

| Budget | Default |
| --- | --- |
| Devices / provisional seeds | 128 each, additionally subject to total inventory bytes |
| Datagram / XML parser | 32 KiB, depth 32, 2,048 nodes, 32 attributes per element |
| Expanded parsed message | At most 16 times the datagram budget and within inventory bytes; normalized JSON nodes/depth also bounded |
| Datagram rate / outstanding requests or sends | 1,024 per configured interval / 64 |
| Deduplicated MessageIDs / sequences per identity | 1,024 / 16 |
| XAddrs / provenance / diagnostics | 16 endpoints, 32 provenance records, 128 diagnostics per applicable record |
| Inspection concurrency / queue | 4 / 128 |
| Services / requests per inspection | 32 / 48 |
| Native pagination / resources per inventory | 4 pages / 256 resources |
| Native read / entire inspection / durable inventory | 1 MiB / 4 MiB / 8 MiB |

Normalized JSON limits measure actual UTF-8/escaping, including failed and partial
adapter results. Inventory admission/replacement is byte-bounded before durable
save; rejected replacement retains prior confirmed data and records truncation.
No bounded map silently evicts identity tombstones to admit new devices.

Default timers: 3-second probe window, 30-second probe interval, initial retry
jitter 50-250 ms with exponential delay capped at 500 ms, 3-second native read,
15-second whole inspection, 60-second refresh, 180-second stale threshold and
60-second departure grace. `retransmissions` bounds **total transmissions including
the first**, default three, supported range one through four. Retransmissions
retain request IDs. Independent timers close request windows even if wall time
moves backward. Untyped fallback is disabled by default and has its own explicit
per-round cap after empty typed rounds.

The fixed allowlist contains **46 qualified reads across the 17 canonical service
namespaces**. Source-linked entries are in `operations.ts`. The gate also checks
literal SOAP/WS-Addressing actions and request/response QNames, so a read-named TD
or descriptor cannot disguise a write. Source details matter: Event actions use
`EventPortType/...Request`; DeviceIO's namespace contains `deviceIO` while its
literal SOAP action contains lowercase `deviceio`.

Baseline reads obtain services, device information, scopes and endpoint identity.
Advertised service contracts enable selective service capabilities, Media1/2
profiles/configurations, recording/job/track reads, event properties, analytics
descriptors and access-point/door/access-profile/schedule inventories. Empty
confirmed lists are distinct from unsupported, denied, faulted, timed-out or
truncated inventories. Continuation references and resource tokens are opaque;
changed or repeating pagination data is an explicit failure. No credential
enumeration, search allocation/results drain, subscription, synchronization,
media PLAY or mutation is in this read set. URI acquisition and richer opt-in
inspection require separately reviewed policy rather than a `Get*` shortcut.

### Persistence

`MemoryPersistence` is explicitly ephemeral. `JsonFilePersistence` requires an
absolute path in an existing private, non-symlink directory. POSIX ownership/mode
checks and Windows owner/ACL checks protect the directory and existing file.
Windows verification uses bounded local .NET ACL queries through the system
PowerShell executable, without relying on inherited PowerShell module paths;
an optional deployment verifier can add restrictions, not bypass these checks.

An exclusive owner-created `.lock` prevents concurrent writers. Snapshot schema,
finite JSON, exact identity, array/byte bounds and revisions are checked. Writes
use a private exclusive temporary file, file sync, atomic same-directory rename,
and directory sync where supported. Stale/conflicting revisions, corrupt input,
oversized files, permission errors and cleanup errors are explicit. There is no
silent empty recovery, replacement of damaged files, or automatic stale-lock
stealing. A crash-left lock requires operator reconciliation. Directory metadata
durability on Windows and non-local filesystems remains a deployment guarantee,
not a simulated power-loss qualification.

## Independent acceptance tests

Build only this owned test surface and execute its fixtures without changing
package/root configuration:

```powershell
node node_modules\typescript\bin\tsc -p onvif\tools\tests\reference-runtime\discovery\tsconfig.json
$tests = Get-ChildItem onvif\tools\tests\reference-runtime\discovery -File -Filter '*.test.cjs'
node --test $tests.FullName
```

The owned config emits `test\discovery\.compiled`, avoiding compiler-owned
`dist` races. The composed commands in `onvif-runtime.md` instead test the current
full `dist` with the existing Visual Studio Node 24.12.0 on this host; no new
library installation is needed. Static authored XML is decoded by production code;
outgoing wire XML and locked WSDL/action contracts are checked independently
with xmldom. The suite includes real owned UDP and native SOAP loopback emulators,
actual node-wot consumption, real JSON-file persistence, and a separate process
that exits naturally after closing active discovery with zero counted timers.
It never invokes real multicast scans, cameras, doors or production services.

## Source and delivery boundaries

The protocol source lock is `onvif\sources.lock.json`, nativeDiscovery
group. Its April 2005 discovery and 2004 addressing XML are **fetch-only** pending
redistribution permission. This module does not vendor those documents, retrieve
schemas at runtime, or substitute OASIS 2009. Fixtures are independently authored
messages, not copies of protected source documents.

The approved plan is the session's `research/onvif-discovery-plan-final.md`.
Native authority: ONVIF 26.06 commit
`68ee1b540a40f848c9599eba2c55b87547c588d6`, Core discovery and GetServices clauses;
Profile S 1.3 section 9.2; WS-Discovery April 2005 sections 3-6 and Appendix I.
The composed bridge integration is described below. A standalone runtime read
adapter without an extended execution hook still rejects nonempty EPR reference
properties/parameters with `AddressedReadHeaders`; the bridge now supplies that
hook. Snapshots retain the headers; they are never silently dropped. Full native
conformance qualification of every profile remains broader work.

No Directory listener, implicit file publication, production multicast/NIC
qualification, or ONVIF/W3C conformance/certification claim is supplied here.

## Composed bridge integration

`src\bridge.ts`, `src\publication` and `src\cli` now connect this inventory to the
actual packaged canonical projector and a separately configured Directory or
offline bundle. See `onvif-runtime.md` and the two
`examples\onvif-bridge-*.json` configuration references. Root
`test:onvif:discovery`, `test:onvif:publication`, `test:onvif:integration` and
`test:onvif:all` invoke their actual suites; integration is not a binding-gate
alias.

Inspection uses the unchanged canonical registry's reviewed read classifications.
It does not replace GetServices codecs or reclassify all native operations.
The optional `RuntimeReadOptions.execute` hook receives the real consumed Thing,
physical target and request budget. The bridge passes these to `runtime.execute`
with the original principal/trust, logical EPR To, both reference-header lists,
AbortSignal and byte/time bounds. WS-Discovery's EPR namespace is 2004/08; an
explicit programmatic addressing policy can use a separately known 2005 route.
Both namespaces have independent native-wire read gates.

The adapter retains the detached original observation envelope and separately
projects only current complete values. It preserves true/false/unknown facts,
claims without inferred editions, firmware-specific external evidence, exact
XAddr provenance, and parent-scoped recording/resource identities. Public
`onvif:discovery` metadata includes the source EPR/addressing namespace but no
credential material or local principal binding.

Every TD has one reachable, actually published composite type and native
endpoint Forms. The earlier ordinary-Form integration read Directory TDs with a separate
reader and consumed them after closing the bridge: native DeviceInformation,
A access profiles, C door information/PullPoint notifications, and D DeviceIO
capabilities. All seven device/client role projections are exercised as claims
and conditional assessments, not complete product/client certification.
Directory auth/CRUD/CAS/single-writer/TTL/grace/pagination cases have separate
preserved publication tests.

The final strengthened integration additionally supplies the published logical
EPR To. It currently fails closed: the native runtime permits a non-HTTP logical
To only when it equals the consumed Thing ID, whereas projected IDs are stable
hashes of the source EPR. Supplying a correct physical XAddr does not authorize
that alias. The failing test is retained; no identity/security rewrite or
target-policy bypass is used. See `onvif-runtime.md` for the exact boundary.

Event properties remain read-only inspection. Publishing a native Event requires
explicit policy plus current positive integral Event-service `MaxPullPoints`
and successful Event properties; no subscription, synchronization, search,
URI resolution or PLAY occurs before consumer intent. Native media remains its
own explicitly configured test command and qualification boundary.
