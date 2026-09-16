const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { ConsumedThing } = require("@node-wot/core");
const {
    createOnvifBridge, createOnvifRuntime, loadPackagedProjectionCatalog, defineOperationRegistry,
    DirectoryClient, DirectoryPublisher, StaticModelPublisher, MemoryPublicationStore, projectInventory
} = require("../../dist/index.js");
const { nativeFixture, NS, EDITIONS, DSA } = require("./fixtures/native.cjs");
const { directory } = require("../publication/fixtures/directory.cjs");
const { setTimeout: delay } = require("node:timers/promises");

const policy = { securityDefinitions: { native: { scheme: "digest", in: "header" } },
    security: ["native"], includeSafeReadAliases: true, includeAddOns: true };

function actionName(td, operation, namespace) {
    const entries = Object.entries(td.actions ?? {}).filter(([, action]) => !action["onvif:safeRead"]
        && action.forms.some((form) => form["onvif:operation"]?.operation === operation
            && form["onvif:operation"].bindingQName.namespace === namespace));
    assert.equal(entries.length, 1, `${operation} must be projected from one actually successful native read`);
    return entries[0][0];
}

test("Directory-discovered independent native consumer reads device and A/C/D and subscribes after bridge close; seven profile roles remain conditional claims",
    { timeout: 120000 }, async (t) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-bridge-proof-"));
        const modelsPath = path.join(root, "models");
        await fs.mkdir(modelsPath);
        const native = await nativeFixture({ eventProfiles: ["C"] });
        const host = await directory({ modelDirectory: modelsPath, registrationOnly: true });
        const catalog = loadPackagedProjectionCatalog();
        const writer = new DirectoryClient(host.clientOptions());
        const publisher = new DirectoryPublisher({
            owner: "independent-bridge", directory: writer,
            models: new StaticModelPublisher({ directory: modelsPath, owner: "independent-bridge",
                baseUrl: host.modelBaseUrl, verification: "http" }),
            state: new MemoryPublicationStore("independent-bridge"),
            policy: { freshMs: 180000, graceMs: 60000, renewBeforeMs: 5000 }
        });
        const deviceClaims = native.claims("device"), clientClaims = native.claims("client");
        const claims = Object.fromEntries(native.devices.map((device) => [device.epr,
            [...deviceClaims[device.epr], ...clientClaims[device.epr]]]));
        const eventXAddr = native.origin + native.devices.find((device) => device.profile === "C").paths.events;
        const adapter = { claims, eventSubscriptions: [{ xaddr: eventXAddr,
            evidence: [{ sourceId: "fixture:explicit-subscription-publication-policy" }] }],
            factMappings: [{ fact: "device.feature.dynamicTracks", namespace: NS.recording, pointer: "/$attributes/DynamicTracks" }] };
        const bridge = createOnvifBridge({
            input: { mode: "discover", discovery: native.discoveryOptions(), runtimeOptions: () => native.runtimeOptions(),
                security: native.security, principal: native.principal },
            projection: policy, catalog, adapter,
            output: { mode: "directory", publisher, modelBaseUrl: host.modelBaseUrl }
        });
        const reader = new DirectoryClient(host.clientOptions("reader"));
        let consumer;
        t.after(async () => {
            try {
                const clients = await Promise.allSettled([bridge.close(), consumer?.close(), reader.close()]);
                const fixtures = await Promise.allSettled([native.close(), host.close()]);
                const errors = [...clients, ...fixtures].filter((result) => result.status === "rejected").map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "Independent integration cleanup failed");
            } finally { await fs.rm(root, { recursive: true, force: true }); }
        });
        assert.equal(bridge.state, "new");
        assert.equal(native.calls.length, 0, "Construction opens no native control path");
        await bridge.start().catch((error) => {
            const report = (failure) => {
                t.diagnostic(`${failure.code ?? failure.name}: ${failure.message}`);
                if (failure instanceof AggregateError) failure.errors.forEach(report);
            };
            report(error);
            throw error;
        });
        const inspected = await bridge.inspect();
        native.assertHealthy();
        assert.equal(inspected.inventory.devices.length, 7);
        for (const device of native.devices) {
            const observed = inspected.projection.devices.find((entry) => entry.snapshot.epr.address === device.epr);
            assert.ok(observed, device.profile);
            assert.equal(observed.observationEnvelope.services.status, "known", device.profile);
            assert.equal(observed.snapshot.identity.value.serialNumber, `0000${device.profile}`);
            assert.ok(observed.projection.assessments.some((row) => row.profile === device.profile && row.role === "device"));
            assert.ok(observed.projection.assessments.some((row) => row.profile === device.profile && row.role === "client"));
            assert.ok(observed.projection.assessments.every((row) => row.runtimeEvidence === "not-established-by-projection"));
            assert.equal(observed.projection.clientManifests.filter((manifest) => manifest.claim.profile === device.profile
                && manifest.claim.edition === EDITIONS[device.profile]).length, 1);
            assert.ok(observed.projection.diagnostics.some((entry) => entry.code === "unversioned-profile-claim"),
                "A scope does not supply an edition");
            assert.ok(observed.snapshot.services.every((service) => native.allowedXAddrs.includes(service.xaddr)));
        }
        assert.deepEqual({ actuations: native.counters.actuations, subscriptions: native.counters.subscriptions,
            searches: native.counters.searches, uriLookups: native.counters.uriLookups, rtspPlay: native.counters.rtspPlay },
        { actuations: 0, subscriptions: 0, searches: 0, uriLookups: 0, rtspPlay: 0 });
        const withoutOptIn = projectInventory(inspected.inventory, catalog, policy, { claims });
        assert.ok(withoutOptIn.devices.every((device) => device.projection.tds.every((td) => td.events === undefined)));
        for (const capacity of [0, 0.5, "4", undefined]) {
            const snapshot = structuredClone(inspected.inventory);
            const service = snapshot.devices.flatMap((device) => device.services.value).find((entry) => entry.namespace === NS.events);
            if (capacity === undefined) delete service.capabilities.value.$attributes.MaxPullPoints;
            else service.capabilities.value.$attributes.MaxPullPoints = capacity;
            assert.throws(() => projectInventory(snapshot, catalog, policy, adapter), { code: "UnsupportedCapability" },
                "A claim, unknown, zero or string capacity is not positive native PullPoint evidence");
        }
        const recordings = inspected.projection.devices.find((entry) => entry.snapshot.profileClaims.some((claim) => claim.profile === "G"));
        assert.equal(recordings.snapshot.facts["device.feature.dynamicTracks"].value, true);
        const tracks = recordings.projection.tds.filter((td) => td["onvif:resourceIdentity"]?.kind === "RecordingTrack");
        assert.equal(tracks.length, 2);
        assert.notEqual(tracks[0].id, tracks[1].id, "Repeated track token is scoped by distinct recording parents");
        for (const value of [false, undefined]) {
            const snapshot = structuredClone(inspected.inventory);
            const recordingService = snapshot.devices.flatMap((device) => device.services.value)
                .find((service) => service.namespace === NS.recording);
            if (value === undefined) delete recordingService.capabilities.value.$attributes.DynamicTracks;
            else recordingService.capabilities.value.$attributes.DynamicTracks = value;
            const variant = projectInventory(snapshot, catalog, policy, adapter).devices
                .find((entry) => entry.snapshot.profileClaims.some((claim) => claim.profile === "G"));
            const fact = variant.snapshot.facts["device.feature.dynamicTracks"];
            assert.equal(fact.state, value === undefined ? "unknown" : "known");
            if (value !== undefined) assert.equal(fact.value, false);
            assert.ok(variant.projection.assessments.every((row) => row.runtimeEvidence === "not-established-by-projection"));
        }

        const listed = await reader.list();
        assert.ok(listed.length >= 7);
        for (const td of listed) {
            assert.equal(td.profile, undefined);
            const links = td.links.filter((link) => link.rel === "type");
            assert.equal(links.length, 1);
            const model = await fetch(links[0].href);
            assert.equal(model.status, 200);
            assert.equal((await model.json()).id, links[0].href);
            assert.equal(td["onvif:registryDigest"], catalog.registry.registryDigest);
            for (const affordance of [...Object.values(td.actions ?? {}), ...Object.values(td.events ?? {})]) {
                assert.ok(affordance.forms.every((form) => native.allowedXAddrs.includes(form.href)),
                    "Published Forms use observed XAddrs, never Directory/model/control-proxy URLs");
                assert.ok(affordance.forms.every((form) => form.security?.includes("native")));
            }
            for (const secret of [host.writerToken, host.readerToken, ...native.devices.flatMap((device) => [...device.users.values()])]) {
                assert.equal(JSON.stringify(td).includes(secret), false);
            }
        }
        assert.ok(host.audit.filter((entry) => entry.method === "GET" && entry.path.startsWith("/things?")).length > 1,
            "Independent consumer follows bounded Directory pagination");
        const advertisedC = listed.find((td) => td["@type"] === "onvif:DeviceThing"
            && td["onvif:profileClaims"].some((claim) => claim.profile === "C"));
        assert.equal(Object.keys(advertisedC.events ?? {}).length, 1,
            "An explicitly permitted, currently observed PullPoint is published using the native Event template");
        await bridge.close();
        assert.equal(bridge.state, "closed");
        for (const url of new Set(listed.flatMap((td) => td.links.filter((link) => link.rel === "type").map((link) => link.href)))) {
            assert.equal((await fetch(url)).status, 200, "Published model survives bridge closure");
        }
        const beforeConsumer = native.calls.length;
        const aliasApprovals = [];
        consumer = await createOnvifRuntime({ ...native.runtimeOptions(),
            registry: defineOperationRegistry(catalog.registry.operations, catalog.registry.xml),
            trust: { allowedOrigins: [native.origin], allowedTargets: [...native.allowedXAddrs, ...native.subscriptionXAddrs],
                principalTargets: Object.fromEntries(native.devices.map((device) => [`consumer-${device.profile}`,
                    [...Object.values(device.paths).map((entry) => native.origin + entry),
                        ...(device.paths.events ? [native.origin + device.paths.events + "&subscription=0001"] : [])]])),
                authorizeLogicalEndpoint(scope) {
                    aliasApprovals.push(scope);
                    const device = native.devices.find((entry) => scope.principal === `consumer-${entry.profile}`);
                    const service = device && Object.entries(device.paths).find(([, path]) => native.origin + path === scope.href)?.[0];
                    return !!device && !!service && scope.origin === native.origin
                        && scope.thingId === `urn:onvif:device:${createHash("sha256").update(JSON.stringify([device.epr, []])).digest("hex")}`
                        && scope.operation.bindingQName.namespace === NS[service]
                        && scope.endpointReference.address === device.epr
                        && scope.endpointReference.addressingNamespace === DSA
                        && scope.endpointReference.referenceProperties.length === 0
                        && scope.endpointReference.referenceParameters.length === 0;
                } } });
        for (const [profile, operation, namespace, field] of [
            ["S", "GetDeviceInformation", NS.device, "SerialNumber"],
            ["A", "GetAccessProfileList", NS.rules, "AccessProfile"],
            ["C", "GetDoorInfoList", NS.door, "DoorInfo"],
            ["D", "GetServiceCapabilities", NS.io, "Capabilities"]
        ]) {
            const advertised = listed.find((td) => td["@type"] === "onvif:DeviceThing"
                && td["onvif:profileClaims"].some((claim) => claim.profile === profile));
            const fresh = (await reader.get(advertised.id)).td;
            const original = structuredClone(fresh);
            const thing = await consumer.consume(fresh, { principal: `consumer-${profile}` });
            assert.ok(thing instanceof ConsumedThing);
            const source = fresh["onvif:discovery"];
            const output = profile === "S"
                ? await consumer.invokeAction(thing, actionName(fresh, operation, namespace), {}, {
                    target: fresh.actions[actionName(fresh, operation, namespace)].forms[0].href,
                    addressing: {
                        namespace: source.addressingNamespace, to: source.endpointReference.address,
                        referenceProperties: source.endpointReference.referenceProperties,
                        referenceParameters: source.endpointReference.referenceParameters
                    }
                })
                : await thing.invokeAction(actionName(fresh, operation, namespace), {});
            const value = await output.value();
            if (profile === "S") assert.equal(value[field], "0000S");
            if (profile === "A") assert.equal(value[field][0].$attributes.token, "access-profile-01");
            if (profile === "C") assert.equal(value[field][0].$attributes.token, "door-0001");
            if (profile === "D") assert.equal(value[field].$attributes.RelayOutputs, 1);
            assert.deepEqual(fresh, original, "Independent consumption preserves the published TD, EPR and native security");
            assert.equal(thing.getThingDescription().id, original.id);
        }
        assert.equal(aliasApprovals.length, 1);
        assert.equal(aliasApprovals[0].principal, "consumer-S");
        const cThing = await consumer.consume((await reader.get(advertisedC.id)).td, { principal: "consumer-C" });
        let delivered, failed;
        const received = new Promise((resolve, reject) => { delivered = resolve; failed = reject; });
        const subscription = await consumer.subscribeEvent(cThing, Object.keys(advertisedC.events)[0],
            async (output) => delivered(await output.value()), failed,
            { pullTimeoutMs: 0, messageLimit: 1, minimumPollIntervalMs: 10 });
        try {
            const event = await Promise.race([received, delay(5000, undefined, { ref: false }).then(() => { throw new Error("Native notification deadline"); })]);
            assert.deepEqual(event.Topic.$children.map((node) => node.value), ["a:Door"]);
            assert.equal(event.Topic.$namespaces.a, "urn:fixture:access");
            assert.match(JSON.stringify(event), /door-0001/);
            assert.match(JSON.stringify(event), /Closed/);
        } finally { await subscription.stop(); }
        assert.equal(subscription.state, "closed");
        assert.ok(native.calls.slice(beforeConsumer).some((call) => call.authenticated && call.principal === "consumer-C"
            && call.operation === "Unsubscribe"));
        assert.ok(native.calls.slice(beforeConsumer).filter((call) => call.authenticated)
            .every((call) => call.principal.startsWith("consumer-")), "Inspection principal is not reused after bridge shutdown");
        assert.equal(native.counters.actuations, 0);
        assert.equal(native.counters.searches, 0);
        assert.equal(native.counters.rtspPlay, 0);
        native.assertHealthy();
    });
