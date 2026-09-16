# Native ONVIF WoT binding

`@wot-av/binding-onvif` is a **private, local reference implementation** of
native ONVIF consumption through node-wot. It compiles locked WSDL/XSD contracts,
models all seven released A/C/D/G/M/S/T profiles with separate client obligations,
executes SOAP/Events at native XAddrs, and composes native RTSP media and
read-only discovery/publication. It is not a JSON camera gateway, ONVIF
certification, or a claim to implement every complete client workflow.

The optional [AV 0.2 metadata specification](../../spec.md) is complementary,
not a prerequisite. Its vocabulary and read-only matching semantics are
unchanged. The provisional `onvif:` namespace is
`https://example.org/wot/onvif#`; its context identifier
`https://example.org/wot/onvif/context/v0.1` is an **unhosted placeholder**.
Use the bundled context offline or the explicitly configured publication host,
not an assumed public endpoint. ONVIF binding version `0.1` is not AV v0.1.

## Specification index

| Document or artifact | Authority and scope |
| --- | --- |
| [Native integration](../../spec/onvif-integration.md) | Seven-profile scope, native operation flow, ownership, and why WoT remains optional. |
| [Source catalog](../../spec/onvif-sources.md), [source lock](sources.lock.json), [profile editions](catalog/profile-editions.json) | Exact release 26.06 commit, service/schema versions, seven PDF pins, exclusions and redistribution decisions. |
| [S/T ledger](../../spec/onvif-profile-st.md), [G/M ledger](../../spec/onvif-profile-gm.md), [A/C/D ledger](../../spec/onvif-profile-acd.md) | 2,636 device/client requirement atoms, source locators, conditions, alternatives, and remaining process/editorial gates. |
| [Compiler and projection](../../spec/onvif-mapping.md), [coverage](coverage/coverage.json) | 579 compiled operation graphs, 3,426 type contracts, reusable models and evidence-preserving observed TDs. |
| [Binding reference](../../spec/onvif-binding-reference.md), [inventory](vocabulary/terms.json) | Every current vocabulary entry, authorship/use/defaults, native Form rules, and private runtime-field boundaries. |
| [Native SOAP binding](../../spec/onvif-binding.md), [Events](../../spec/onvif-events.md) | Actual node-wot Action/Event execution, canonical XML, scoped credentials, faults and awaited lifecycle. |
| [Node media](../../spec/onvif-node-media.md), [native media](../../spec/onvif-media.md), [native qualification](../../spec/onvif-media-qualification.md) | URI resolution, per-open RTSP sessions, decoded units/metadata/backchannel and the measured codec/transport matrix. |
| [Discovery](../../spec/onvif-discovery.md), [composed runtime/CLI](../../spec/onvif-runtime.md) | Read-only inspection, model hosting, Directory/file publication, identities, leases and explicit logical-EPR authorization. |
| [Support and conformance boundaries](../../spec/onvif-conformance.md) | Declared/mapped versus exercised, conditional, unsupported and unqualified behavior. |
| [Packaging](../../spec/onvif-packaging.md) | Current install/build/CI commands, native prerequisites, package provenance and promotion gates. |

The [first SOAP gate report](../../spec/onvif-runtime-qualification.md) is a
dated, narrower qualification record, not the current script/API inventory.
The [generated manifest](generated/manifest.json) owns 304 listed artifacts
(305 files including itself); do not hand-edit them to change a mapping.

## Local setup

Use Node >=20.19.0 and npm on PATH. For a fresh private checkout:

```powershell
npm ci --ignore-scripts
npm run build:onvif
node .\packages\binding-onvif\dist\cli\main.js --help
npm run test:onvif
```

Run these from the repository root. Do not replace a dependency tree in use by
another process. The default suite does not launch a native media worker;
[native execution](../../spec/onvif-runtime.md#scope-and-qualification) is
explicitly opt-in. A compatible built worker, matching SDK, approved native
endpoints, network interfaces, Directory and static document host are external
deployment inputs. No npm command installs a camera SDK or starts those services.

## Typed integration helper

This complete TypeScript module uses the current
[public exports](../../packages/binding-onvif/src/index.ts).
It defines helpers only: importing it performs no discovery, publication,
subscription, Action invocation or media open. Its options are **externally
provided integration configuration**, not defaults or an executable fixture.
The caller supplies verified snapshots/TDs, actual constructor options,
out-of-band credential providers and independently approved trust policy.

```typescript
import {
    createOnvifBridge,
    createOnvifRuntime,
    defineOperationRegistry,
    loadPackagedProjectionCatalog,
    MediaExecutor,
    OnvifError,
    operationKey,
    operationReference,
    project,
    type DeviceSnapshot,
    type MediaConsumerContext,
    type MediaExecutorOptions,
    type MediaSession,
    type OnvifBridgeOptions,
    type OnvifRuntimeOptions,
    type OpenMediaRequest,
    type OperationReference,
    type ProjectionPolicy
} from "@wot-av/binding-onvif";
import type { ThingDescription } from "wot-typescript-definitions";

export interface IntegrationOptions {
    snapshot: DeviceSnapshot;
    projection: ProjectionPolicy;
    native: Omit<OnvifRuntimeOptions, "registry">;
    bridge: Omit<OnvifBridgeOptions, "catalog" | "projection">;
    media: Omit<MediaExecutorOptions, "registry">;
}

export async function prepareIntegration(options: IntegrationOptions) {
    const catalog = loadPackagedProjectionCatalog();
    const registry = defineOperationRegistry(
        catalog.registry.operations,
        catalog.registry.xml
    );
    const projection = project(options.snapshot, catalog, options.projection);
    const bridge = createOnvifBridge({
        ...options.bridge,
        catalog,
        projection: options.projection
    });
    const media = new MediaExecutor({ ...options.media, registry });
    const runtime = await createOnvifRuntime({ ...options.native, registry });
    return { catalog, projection, bridge, media, runtime };
}

export async function openSelectedMedia(
    integration: Awaited<ReturnType<typeof prepareIntegration>>,
    retrievedTd: ThingDescription,
    consumer: MediaConsumerContext,
    resolver: OperationReference,
    request: Omit<OpenMediaRequest, "action">
): Promise<MediaSession> {
    const key = operationKey(resolver);
    const matches = Object.entries(retrievedTd.actions ?? {}).filter(
        ([, action]) => action["onvif:safeRead"] === undefined
            && action.forms.some((form) =>
                form["onvif:operation"] !== undefined
                && operationKey(operationReference(form["onvif:operation"])) === key)
    );
    const action = matches[0]?.[0];
    if (matches.length !== 1 || action === undefined) {
        throw new OnvifError("UnsupportedCapability", "Select one evidenced native URI Action");
    }
    const thing = await integration.media.consume(
        integration.runtime, retrievedTd, consumer
    );
    return integration.media.openMedia(
        integration.runtime, thing, { ...request, action }
    );
}
```

`loadPackagedProjectionCatalog()` is the actual public loader; there is no
`loadDefaultCatalog` export. `DeviceSnapshot` above is the pure projector input,
not discovery's `InventorySnapshot`. The bridge adapts that richer inventory
itself. `prepareIntegration` does not start the bridge; explicit
`await bridge.start()` authorizes its configured input/output work.
The returned pure projection is not automatically published or consumed.

Calling `openSelectedMedia` **does** invoke a native URI Action and open media.
Choose `resolver` from `catalog.registry.operations`, preserving the complete
binding QName, portType QName and operation tuple. The helper finds the TD's
actual generated Action key; it never assumes an Action is named `GetStreamUri`.
An advertised service or profile alone does not supply an evidenced resolver
Action, and read-only discovery deliberately does not invoke URI lookups.

| Native resolver | Canonical input and result used by the media API |
| --- | --- |
| Media1 `GetStreamUri` | `StreamSetup` and device `ProfileToken`; result `MediaUri.Uri`. |
| Media2 `GetStreamUri` | `Protocol` and device `ProfileToken`; result `Uri`. |
| Replay `GetReplayUri` | `StreamSetup` and `RecordingToken`; result `Uri`, with an explicit increasing bigint `replay` range. |

For TCP interleaving, Media2 uses `Protocol: "RTSP"`; Media1/Replay use
`StreamSetup.Stream: "RTP-Unicast"` and `StreamSetup.Transport.Protocol: "RTSP"`.
UDP uses `RtspUnicast` / `UDP`; HTTP(S) tunneling uses `RtspOverHttp` / `HTTP`.
Do not interchange these request shapes or infer TLS from the string `RTSP`.
The [media resolver](../../packages/binding-onvif/src/media/executor.ts)
checks the selected native schema, transport and returned URI variant.

`consumer` must independently provide `principal`, `targetRef` and media
`trust`; `document` is the effective TD retrieval URL, required for an explicit
FormReference. `request` supplies native input, transport, local interface and
tracks, plus any explicit Form selection/addressing and cancellation. The
media constructor needs a real worker executable and a scoped security resolver.
No credential literal or executable path is embedded in the helper.
For a projected logical EPR distinct from the Thing ID, configure
[`native.trust.authorizeLogicalEndpoint`](../../spec/onvif-runtime.md#logical-epr-authorization-status)
from independent operator policy. Metadata does not grant that route; do not
rewrite the TD ID, drop headers or approve every callback request.

Consume finite SOAP results with `await output.value()`. Media frames are
Readables and metadata/packets are bounded async iterables, not one infinite
Action value. Drain the outputs you request, handle gaps, and await
`session.close()`/its actual cleanup result. The caller owns `media.close()`,
`bridge.close()` and `runtime.close()`; close media and subscriptions before
their runtime, await every owned cleanup, and retain uncertain outcomes.

## Rights and publication

No first-party reuse license has been selected, and the package/repository
remain private. Public-source copying notices, fetch-only exclusions,
transformed-dataset clearance, native patch review, corresponding-source/
relinking obligations and codec patents remain separate gates. Test-only
plugins are not runtime-bundle approval. Do not change visibility or infer
distribution permission from a successful local build or fixture.
