const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = require("./helpers.cjs");
const { nativeFixture } = require("./native-fixture.cjs");
const { operationKey } = require("./.compiled/binding/registry");

test("every allowed read resolves to its exact binding, portType and source operation in the locked WSDL", () => {
    const root = path.resolve(__dirname, "..", "..", "..", "..");
    const lock = JSON.parse(fs.readFileSync(path.join(root, "bindings", "onvif", "sources.lock.json"), "utf8"));
    const cache = new Map();
    const namespaces = new Set();
    for (const contract of h.READ_CONTRACTS) {
        const source = lock.sources.find((item) => item.id === contract.source);
        assert.ok(source, contract.source);
        assert.equal(source.storage, "vendored");
        if (!cache.has(source.id)) cache.set(source.id, h.wire(fs.readFileSync(path.join(root, "third_party", "onvif", ...source.relativePath.split("/")))));
        const doc = cache.get(source.id);
        const wsdl = "http://schemas.xmlsoap.org/wsdl/";
        const definitions = doc.documentElement;
        assert.equal(definitions.getAttribute("targetNamespace"), contract.reference.bindingQName.namespace);
        const bindings = [...Array.from(doc.getElementsByTagNameNS(wsdl, "binding"))];
        const binding = bindings.find((node) => node.getAttribute("name") === contract.reference.bindingQName.localName);
        assert.ok(binding, contract.locator);
        const [prefix, portName] = binding.getAttribute("type").split(":");
        assert.equal(binding.lookupNamespaceURI(prefix), contract.reference.portTypeQName.namespace);
        assert.equal(portName, contract.reference.portTypeQName.localName);
        const operation = Array.from(binding.getElementsByTagNameNS(wsdl, "operation")).find((node) =>
            node.getAttribute("name") === contract.reference.operation);
        assert.ok(operation, contract.locator);
        assert.equal(operation.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap12/", "operation").item(0).getAttribute("soapAction"),
            contract.soapAction, "Literal SOAP action must match the source, including DeviceIO case and Event action rules");
        assert.equal(h.readonlyContract(operationKey(contract.reference)), contract);
        namespaces.add(contract.reference.bindingQName.namespace);
    }
    assert.equal(namespaces.size, 17, "All 17 source-selected service namespaces have an explicit safe capability/read contract");
    assert.equal(h.READ_CONTRACTS.length, 46);
    assert.ok(h.READ_CONTRACTS.some((item) => item.reference.operation === "GetRecordingJobState"));
    assert.ok(h.READ_CONTRACTS.some((item) => item.reference.operation === "GetAccessProfileList"));
    assert.ok(!h.READ_CONTRACTS.some((item) => item.reference.operation === "GetCredentials"));
});

test("local registry/adapter unsupported results do not masquerade as a device's unsupported GetServices response", async (t) => {
    const fixture = nativeFixture(({ reference }) => {
        if (reference.operation === "GetServices") return {
            status: "unsupported", code: "UnsupportedCapability", message: "The supplied runtime registry lacks this operation", responded: false
        };
    });
    t.after(() => fixture.inspector.close());
    const report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.equal(report.services.status, "unsupported");
    assert.ok(!fixture.adapter.calls.some((call) => h.readonlyContract(call.key).reference.operation === "GetCapabilities"));
});

test("capabilities included in GetServices retain that actual read provenance, not an invented GetServiceCapabilities call", async (t) => {
    const fixture = nativeFixture();
    t.after(() => fixture.inspector.close());
    const media = fixture.data.services.Service.find((item) => item.Namespace === h.NAMESPACES.media1);
    media.Capabilities = { $extensions: [{ kind: "element", name: { namespace: h.NAMESPACES.media1, localName: "Capabilities" },
        namespaces: {}, attributes: [], children: [] }] };
    const report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.ok(!fixture.adapter.calls.some((call) => h.readonlyContract(call.key).reference.bindingQName.namespace === h.NAMESPACES.media1
        && h.readonlyContract(call.key).reference.operation === "GetServiceCapabilities"));
    const feature = report.observedFeatures.find((item) => item.namespace === h.NAMESPACES.media1 && item.feature === "service-capabilities");
    assert.equal(feature.operation.operation, "GetServices");
    assert.equal(feature.operation.bindingQName.namespace, h.NAMESPACES.device);
    assert.equal(feature.outcome.source.xaddr, h.XADDR);
});

test("a read adapter that fails to quiesce makes close fail within its deadline instead of hanging or claiming cleanup", async () => {
    const clock = new h.FixtureClock(1000);
    const adapter = new h.FixtureReadAdapter(() => new Promise(() => {}));
    const inspector = new h.ReadonlyInspector(adapter, clock, h.boundedOptions(), h.timerOptions({ readTimeoutMs: 5 }), new Set([h.XADDR]));
    const target = { xaddr: h.XADDR, endpointReference: null, interfaceId: "loop-a", segmentId: "segment-a" };
    const pending = inspector.executeReadonly(operationKey(h.readContract(h.NAMESPACES.device, "GetDeviceInformation").reference),
        {}, target, new AbortController().signal);
    await h.flush();
    const closed = assert.rejects(inspector.close(), { code: "OutcomeUnknown" });
    await clock.advance(6);
    await closed;
    assert.equal((await pending).status, "timeout");
    assert.equal(clock.pendingTimers, 0);
});

test("source-keyed inspection normalizes Media1/2, recording/jobs/tracks and A/C/D inventories without profile certification", async (t) => {
    const fixture = nativeFixture();
    t.after(() => fixture.inspector.close());
    const report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.equal(report.information.status, "known");
    assert.equal(report.information.value.serialNumber, "0000007");
    assert.equal(report.services.status, "known");
    assert.equal(report.services.value.length, 11);
    assert.equal(report.services.value.find((item) => item.namespace === h.NAMESPACES.media2).xaddr, "http://127.0.0.1:18080/native/media2?mode=all");
    const inventories = report.resources.filter((item) => item.outcome.status === "known");
    assert.deepEqual(inventories.filter((item) => item.kind === "media-profile").map((item) =>
        [item.namespace, item.outcome.value[0].token, item.outcome.value[0].fixed]), [
        [h.NAMESPACES.media1, "fixed-profile-0001", true], [h.NAMESPACES.media2, "media2-profile-0001", null]
    ]);
    const tracks = inventories.find((item) => item.kind === "track");
    assert.deepEqual(tracks.outcome.value.map((track) => [track.parentTokens, track.token]), [
        [["recording-a"], "same-track-token"], [["recording-b"], "same-track-token"]
    ]);
    for (const [kind, token] of [
        ["recording-job", "job-0001"], ["access-point", "access-0001"], ["door", "door-0001"],
        ["access-profile", "rule-profile-0001"], ["schedule", "schedule-0001"]
    ]) assert.equal(inventories.find((item) => item.kind === kind).outcome.value[0].token, token);
    const operations = fixture.adapter.calls.map((call) => h.readonlyContract(call.key).reference.operation);
    assert.ok(operations.includes("GetRecordingJobConfiguration"));
    assert.ok(operations.includes("GetRecordingJobState"));
    assert.ok(operations.includes("GetSupportedAnalyticsModules"), "Service order cannot prevent descriptor reads after media configuration discovery");
    assert.ok(operations.includes("GetSupportedRules"));
    assert.ok(!operations.some((name) => /^(Set|Create|Delete|Start|Find|Pull|Renew|Synchron)/.test(name)));
    const credential = fixture.adapter.calls.filter((call) => h.readonlyContract(call.key).reference.bindingQName.namespace.includes("/credential/"));
    assert.deepEqual(credential.map((call) => h.readonlyContract(call.key).reference.operation), ["GetServiceCapabilities"]);
    assert.equal(report.observedFeatures.find((item) => item.namespace === h.NAMESPACES.media1).outcome.value.StreamingCapabilities.$attributes.RTP_RTSP_TCP, true);
    assert.ok(!("conformance" in report) && !("profiles" in report));
    assert.equal(fixture.clock.pendingTimers, 0);
    assert.equal(fixture.inspector.pendingReads, 0);
});

test("arbitrary TD exposure, name collisions and Get-prefix APIs do not authorize writes, searches, subscriptions or PLAY", async (t) => {
    const fixture = nativeFixture();
    t.after(() => fixture.inspector.close());
    const reference = h.readContract(h.NAMESPACES.device, "GetDeviceInformation").reference;
    for (const operation of [
        "SetScopes", "SystemReboot", "FindRecordings", "GetRecordingSearchResults", "CreatePullPointSubscription",
        "PullMessages", "Renew", "SetSynchronizationPoint", "GetCredentials", "PLAY"
    ]) {
        await assert.rejects(fixture.inspector.executeReadonly(operationKey({ ...reference, operation }), {},
            fixture.target, new AbortController().signal), { code: "PolicyDenied" });
    }
    await assert.rejects(fixture.inspector.executeReadonly(operationKey({
        ...reference, bindingQName: { namespace: "urn:untrusted:same-local-name", localName: "DeviceBinding" }
    }), {}, fixture.target, new AbortController().signal), { code: "PolicyDenied" });
    assert.equal(fixture.adapter.calls.length, 0);
    const allowed = operationKey(reference);
    const denied = await fixture.inspector.executeReadonly(allowed, {}, { ...fixture.target, xaddr: "http://127.0.0.1:18080/custom/device" }, new AbortController().signal);
    assert.equal(denied.status, "denied", "An origin match is not approval of a different path/query");
    assert.equal(fixture.adapter.calls.length, 0);
});

test("legacy GetCapabilities is a selective unsupported fallback, not a retry after denial or a SOAP fault", async (t) => {
    for (const status of ["unsupported", "denied", "fault", "timeout", "unknown"]) {
        const fixture = nativeFixture(({ reference, data }) => {
            if (reference.operation === "GetServices") return { status, code: "SourceResponse", message: "Explicit source outcome",
                responded: ["denied", "fault", "unsupported"].includes(status) };
            if (reference.operation === "GetCapabilities") return { status: "known",
                value: { Capabilities: { Media: { XAddr: data.services.Service.find((item) => item.Namespace === h.NAMESPACES.media1).XAddr } } } };
        });
        t.after(() => fixture.inspector.close());
        const report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
        const calls = fixture.adapter.calls.map((call) => h.readonlyContract(call.key).reference.operation);
        assert.equal(calls.includes("GetCapabilities"), status === "unsupported", status);
        if (status === "unsupported") {
            assert.equal(report.services.status, "known");
            assert.equal(report.services.value[0].namespace, h.NAMESPACES.media1);
            assert.equal(report.services.value[0].version, null, "Legacy service categories do not invent a service specification version");
        } else assert.equal(report.services.status, status);
    }
});

test("fixed media profiles are always refreshed; native token failure keeps separate last-known data instead of current-known success", async (t) => {
    const fixture = nativeFixture();
    t.after(() => fixture.inspector.close());
    const { inventory } = h.inventory({ allowed: [...fixture.allowed] });
    const message = h.parseDiscovery(h.fixture("hello-device.xml"));
    const id = inventory.observe(message, h.provenance(message))[0];
    let report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    inventory.commitInspection(inventory.beginInspection(id), report);
    fixture.data.routes[`${h.NAMESPACES.media1}|GetProfiles`].Profiles[0].Name = "Changed while fixed";
    report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    inventory.commitInspection(inventory.beginInspection(id), report);
    const current = () => inventory.device(id).resources.find((item) => item.kind === "media-profile" && item.namespace === h.NAMESPACES.media1);
    assert.equal(current().outcome.value[0].data.Name, "Changed while fixed");
    const calls = fixture.adapter.calls.filter((call) => h.readonlyContract(call.key).reference.operation === "GetProfiles"
        && h.readonlyContract(call.key).reference.bindingQName.namespace === h.NAMESPACES.media1);
    assert.equal(calls.length, 2);
    const failed = structuredClone(report);
    const profile = failed.resources.find((item) => item.kind === "media-profile" && item.namespace === h.NAMESPACES.media1);
    profile.outcome = { status: "fault", code: "NoEntity", message: "Native token invalidated during refresh", observedAt: 1002, partial: [] };
    inventory.commitInspection(inventory.beginInspection(id), failed);
    assert.equal(current().outcome.status, "fault");
    assert.deepEqual(current().outcome.partial, []);
    assert.equal(current().outcome.lastKnown.value[0].token, "fixed-profile-0001");
    assert.equal(current().outcome.lastKnown.observedAt, 1000);
    h.assertSnapshot(inventory.snapshot());
});

test("native access pagination uses opaque continuation handles with bounded pages, duplicate/change detection and partial outcomes", async (t) => {
    let mode = "normal";
    const fixture = nativeFixture(({ reference, args }) => {
        if (reference.operation === "GetServices") return { status: "known", value: {
            Service: [{ Namespace: h.NAMESPACES.access, XAddr: h.XADDR, Version: { Major: 2, Minor: 0 } }]
        } };
        if (reference.operation === "GetAccessPointInfoList") {
            assert.equal(args.Limit, 128);
            if (args.StartReference === undefined) return { status: "known", value: {
                NextStartReference: "opaque:not-an-offset?next=1", AccessPointInfo: [{ $attributes: { token: "one" }, Name: "One" }]
            } };
            assert.equal(args.StartReference, "opaque:not-an-offset?next=1");
            return { status: "known", value: {
                ...(mode === "normal" ? {} : { NextStartReference: "opaque:not-an-offset?next=1" }),
                AccessPointInfo: [{ $attributes: { token: mode === "changed" ? "one" : "two" }, Name: "Two" }]
            } };
        }
    });
    t.after(() => fixture.inspector.close());
    let report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.deepEqual(report.resources[0].outcome.value.map((item) => item.token), ["one", "two"]);
    mode = "repeat";
    report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.equal(report.resources[0].outcome.status, "fault");
    mode = "changed";
    report = await fixture.inspector.inspect(fixture.target, new AbortController().signal);
    assert.equal(report.resources[0].outcome.status, "fault", "Changed token data in one paged read is not merged as confirmed data");
});

test("resource N+1, service N+1, per-read bytes and total request budgets report truncation rather than false empty inventories", async (t) => {
    const source = nativeFixture();
    const bounds = h.boundedOptions({ maxResources: 1, maxRequestsPerInspection: 12 });
    const inspector = new h.ReadonlyInspector(source.adapter, source.clock, bounds, source.timers, source.allowed);
    t.after(() => inspector.close());
    source.data.routes[`${h.NAMESPACES.media1}|GetProfiles`].Profiles.push({ $attributes: { token: "extra" }, Name: "Extra" });
    const report = await inspector.inspect(source.target, new AbortController().signal);
    assert.equal(report.resources.find((item) => item.namespace === h.NAMESPACES.media1 && item.kind === "media-profile").outcome.status, "truncated");
    assert.ok(source.adapter.calls.length <= 12);
    assert.equal(report.truncated, true);
    const tooMany = nativeFixture();
    const narrow = new h.ReadonlyInspector(tooMany.adapter, tooMany.clock, h.boundedOptions({ maxServices: 1 }), tooMany.timers, tooMany.allowed);
    t.after(() => narrow.close());
    const limited = await narrow.inspect(tooMany.target, new AbortController().signal);
    assert.equal(limited.services.status, "truncated");
    const byteBound = new h.ReadonlyInspector(new h.FixtureReadAdapter(() => ({ status: "known", value: "x".repeat(101) })),
        new h.FixtureClock(), h.boundedOptions({ maxReadBytes: 100 }), h.timerOptions(), new Set([h.XADDR]));
    t.after(() => byteBound.close());
    const result = await byteBound.executeReadonly(operationKey(h.readContract(h.NAMESPACES.device, "GetDeviceInformation").reference),
        {}, source.target, new AbortController().signal);
    assert.equal(result.status, "truncated");
    assert.equal(result.code, "XmlLimit");
});

test("whole-inspection byte accounting includes failed/partial results, not only successful values", async (t) => {
    const clock = new h.FixtureClock(1000);
    const adapter = new h.FixtureReadAdapter(() => ({
        status: "fault", code: "NativeFault", message: "Fixture partial diagnostic payload", partial: { Padding: "x".repeat(400) }, responded: true
    }));
    const inspector = new h.ReadonlyInspector(adapter, clock, h.boundedOptions({ maxReadBytes: 1000, maxInspectionBytes: 650 }),
        h.timerOptions(), new Set([h.XADDR]));
    t.after(() => inspector.close());
    const report = await inspector.inspect({ xaddr: h.XADDR, endpointReference: null, interfaceId: "loop-a", segmentId: "segment-a" },
        new AbortController().signal);
    assert.equal(adapter.calls.length, 2);
    assert.equal(report.services.status, "fault");
    assert.equal(report.information.status, "truncated");
    assert.equal(report.truncated, true);
    assert.equal(report.responsive, true, "A remote fault is not corroborated absence");
});

test("deadlines cancel reads; unsettled adapters consume the concurrency budget until real completion", async (t) => {
    const clock = new h.FixtureClock(1000);
    let finish;
    const adapter = new h.FixtureReadAdapter(() => new Promise((resolve) => { finish = resolve; }));
    const inspector = new h.ReadonlyInspector(adapter, clock, h.boundedOptions({ maxConcurrentInspections: 1 }),
        h.timerOptions({ readTimeoutMs: 5 }), new Set([h.XADDR]));
    t.after(async () => { finish?.({ status: "unknown", code: "Closed", message: "Explicit fixture cleanup" }); await inspector.close(); });
    const target = { xaddr: h.XADDR, endpointReference: null, interfaceId: "loop-a", segmentId: "segment-a" };
    const key = operationKey(h.readContract(h.NAMESPACES.device, "GetDeviceInformation").reference);
    const pending = inspector.executeReadonly(key, {}, target, new AbortController().signal);
    await clock.advance(6);
    assert.equal((await pending).status, "timeout");
    assert.equal(inspector.pendingReads, 1);
    assert.equal((await inspector.executeReadonly(key, {}, target, new AbortController().signal)).code, "ReadConcurrency");
    assert.equal(adapter.calls.length, 1);
    finish({ status: "known", value: { Late: true } });
    await h.flush();
    assert.equal(inspector.pendingReads, 0);
    assert.equal(clock.pendingTimers, 0);
});
