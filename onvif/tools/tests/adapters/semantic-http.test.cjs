"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { loadCanonical, OPERATIONS, REGISTRY_DIGEST } = require("../../../samples/adapters/src/canonical.cjs");
const { SemanticAdapter, pump } = require("../../../samples/adapters/src/semantic.cjs");
const { CaptureBackend, memoryTarget } = require("../../../samples/adapters/src/backend.cjs");
const { SourceFault } = require("../../../samples/adapters/src/fault.cjs");
const { startServer } = require("../../../samples/adapters/src/server.cjs");

test("source-pinned Media2 semantics, actual WoT HTTP Forms and native JPEG bytes", { timeout: 120000 }, async t => {
    const canonical = loadCanonical({
        dependencyAnchor: process.env.CAPTURE_DEPENDENCY_ANCHOR,
        bindingEntry: process.env.CAPTURE_BINDING_ENTRY
    });
    assert.equal(canonical.operationCount, 579);
    assert.equal(canonical.registryDigest, REGISTRY_DIGEST);
    const backend = new CaptureBackend({
        workerPath: path.resolve(__dirname, "..", "..", "..", "samples", "adapters", "build-windows", "windows-capture-worker.exe"),
        authorizeOpen: () => true
    });
    const target = memoryTarget();
    const evidence = await backend.describe(target, { refresh: "native-read-only", permitDeviceAccess: true });
    const profile = {
        $attributes: { token: "capture-p1", fixed: true }, Name: "Configured software mode",
        Configurations: {
            VideoSource: {
                $attributes: { token: "adapter-source-config" }, Name: "Adapter-owned source association",
                UseCount: 1, SourceToken: "adapter-source",
                Bounds: { $attributes: { x: 0, y: 0, width: 17, height: 13 } }
            }
        }
    };
    const adapter = new SemanticAdapter({
        canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
        thingId: "urn:example:windows-capture:test", profile, modeId: evidence.modes[0].modeId
    });
    const controlToken = randomBytes(32).toString("base64url");
    const snapshotTokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
    const options = { canonical, adapter, controlToken, snapshotTokens, port: 0 };
    await assert.rejects(startServer(options), error => error.code === "PolicyDenied");
    await assert.rejects(startServer({ ...options, permitPublication: true, address: "0.0.0.0" }),
        error => error.code === "PolicyDenied");
    const server = await startServer({ ...options, permitPublication: true });
    t.after(() => server.close());
    const auth = token => ({ Authorization: "Bearer " + token });
    const invoke = async (id, value) => {
        const response = await fetch(server.td.actions[id].forms[0].href, {
            method: "POST", headers: { ...auth(controlToken), "Content-Type": "application/json" },
            body: JSON.stringify(value)
        });
        return { status: response.status, value: await response.json() };
    };
    await t.test("published TD exposes only the supported HTTP operations and retrieval", async () => {
        const response = await fetch(server.tdUri, { headers: auth(controlToken) });
        assert.equal(response.status, 200);
        const td = await response.json();
        assert.deepEqual(Object.keys(td.actions).sort(), Object.values(OPERATIONS).sort());
        assert.equal(td.actions[OPERATIONS.profiles].forms[0]["htv:methodName"], "POST");
        assert.equal(td.properties.snapshot.forms[0].contentType, "image/jpeg");
        assert.equal(td.forms, undefined);
        assert.ok(!JSON.stringify(td).includes("application/soap+xml"));
        assert.ok(!JSON.stringify(td).includes("onvif:binding"));
        assert.ok(!JSON.stringify(td).includes("onvif:DeviceThing"));
        assert.equal(td.links.filter(value => value.rel === "type").length, 1);
        const modelResponse = await fetch(td.links.find(value => value.rel === "type").href, { headers: auth(controlToken) });
        assert.equal(modelResponse.status, 200);
        const model = await modelResponse.json();
        assert.equal(model["onvif:projection"].nativeProtocol, false);
        assert.equal(model["onvif:projection"].fullProfile, false);
        assert.equal((await fetch(server.snapshotUri)).status, 403);
        assert.equal((await fetch(server.snapshotUri, { headers: auth(controlToken) })).status, 403);
        assert.equal((await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) })).status, 503);
    });
    await t.test("canonical casing, attributes, absent Type, singleton All and mixed Type behavior", async () => {
        for (const input of [{}, { Type: [] }, { Token: "capture-p1" }]) {
            const result = await invoke(OPERATIONS.profiles, input);
            assert.equal(result.status, 200);
            assert.equal(result.value.Profiles[0].Configurations, undefined);
            assert.deepEqual(result.value.Profiles[0].$attributes, profile.$attributes);
        }
        assert.deepEqual((await invoke(OPERATIONS.profiles, { Type: ["All"] })).value.Profiles[0].Configurations, profile.Configurations);
        assert.deepEqual((await invoke(OPERATIONS.profiles, { Type: ["All", "AudioSource"] })).value.Profiles[0].Configurations, {});
        assert.deepEqual((await invoke(OPERATIONS.profiles, { Type: ["VideoSource"] })).value.Profiles[0].Configurations, profile.Configurations);
        assert.equal((await invoke(OPERATIONS.profiles, { Token: "unknown" })).status, 404);
        assert.equal((await invoke(OPERATIONS.profiles, { Type: "All" })).status, 400);
        assert.deepEqual((await invoke(OPERATIONS.profiles, { Type: ["all"] })).value.Profiles[0].Configurations, {});
        assert.equal((await invoke(OPERATIONS.snapshot, { profileToken: "capture-p1" })).status, 400);
        assert.throws(() => canonical.profiles.output({ Profiles: [{ token: "bad", Name: "bad" }] }), SourceFault);
    });
    await t.test("URI is canonical, stable across configuration changes and does not acquire", async () => {
        const first = await invoke(OPERATIONS.snapshot, { ProfileToken: "capture-p1" });
        assert.equal(first.status, 200);
        assert.deepEqual(first.value, { Uri: server.snapshotUri });
        adapter.configureProfile({ ...profile, Name: "Updated software association" }, evidence.modes[0].modeId);
        assert.deepEqual((await invoke(OPERATIONS.snapshot, { ProfileToken: "capture-p1" })).value, first.value);
        assert.equal((await invoke(OPERATIONS.snapshot, { ProfileToken: "unknown" })).status, 404);
        assert.equal((await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) })).status, 503);
    });
    const request = {
        target, modeId: evidence.modes[0].modeId, capabilityEvidenceDigest: evidence.digest, output: "JPEG", durationMs: 10000
    };
    const session = await backend.open(request);
    t.after(() => session.close());
    const frame = await session.next();
    await t.test("real native JPEG survives IPC, WoT finite-stream serialization and HTTP", async () => {
        adapter.accept(frame);
        const response = await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/jpeg");
        assert.equal(response.headers.get("cache-control"), "no-store");
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.deepEqual(bytes, frame.data);
        const simultaneous = await Promise.all(snapshotTokens.map(async token => {
            const current = await fetch(server.snapshotUri, { headers: auth(token) });
            assert.equal(current.status, 200);
            return new Uint8Array(await current.arrayBuffer());
        }));
        for (const current of simultaneous) assert.deepEqual(current, frame.data);
        fs.writeFileSync(path.join(__dirname, "..", "..", "..", "samples", "adapters", "build-windows", "software-http.jpg"), bytes);
        assert.equal((await session.next()).sequence, "2");
    });
    await t.test("two slow subscribers, per-subscriber credit and byte limits", async () => {
        adapter.accept(frame);
        const one = adapter.acquireSnapshot("slow-one"), two = adapter.acquireSnapshot("slow-two");
        try {
            const denied = await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) });
            assert.equal(denied.status, 409);
            assert.equal((await denied.json()).code, "Busy");
            assert.throws(() => adapter.acquireSnapshot("slow-three"), error => error.code === "Busy");
            assert.throws(() => adapter.acquireSnapshot("slow-one"), error => error.code === "Busy");
            one.data.fill(0);
            assert.deepEqual(two.data, frame.data);
            adapter.accept(frame);
            assert.deepEqual(two.data, frame.data);
        } finally { one.release(); two.release(); }
        assert.equal(adapter.inFlightBytes, 0);
        const size = frame.data.byteLength;
        const bounded = new SemanticAdapter({
            canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
            thingId: "urn:example:byte-bound", profile, modeId: frame.modeId,
            limits: { maxFrameBytes: size, maxQueuedBytes: size * 2 }
        });
        bounded.accept(frame);
        const lease = bounded.acquireSnapshot("one");
        assert.throws(() => bounded.acquireSnapshot("two"), error => error.code === "ResourceLimit");
        lease.release();
        const insufficient = new SemanticAdapter({
            canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
            thingId: "urn:example:byte-bound-plus-one", profile, modeId: frame.modeId,
            limits: { maxFrameBytes: size - 1 }
        });
        assert.throws(() => insufficient.accept(frame), SourceFault);
        const oneSlot = new SemanticAdapter({
            canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
            thingId: "urn:example:one-slot", profile, modeId: frame.modeId, limits: { maxQueuedFrames: 1 }
        });
        oneSlot.accept(frame);
        const only = oneSlot.acquireSnapshot("first");
        assert.throws(() => oneSlot.acquireSnapshot("second"), error => error.code === "Busy");
        only.release();
        const pressure = new SemanticAdapter({
            canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
            thingId: "urn:example:overflow", profile, modeId: frame.modeId,
            limits: { maxQueuedBytes: size * 3 }
        });
        pressure.accept(frame);
        const heldA = pressure.acquireSnapshot("held-a"), heldB = pressure.acquireSnapshot("held-b");
        const withComment = new Uint8Array(Buffer.concat([
            frame.data.subarray(0, 2), Buffer.from([0xff, 0xfe, 0, 3, 120]), frame.data.subarray(2)
        ]));
        try {
            assert.deepEqual(pressure.accept({
                ...frame, payloadBytes: withComment.byteLength, data: withComment
            }), { kind: "gap", generation: frame.generation, dropped: "1", reason: "overflow" });
            assert.deepEqual(pressure.cache.data, frame.data);
            assert.deepEqual(heldA.data, heldB.data);
        } finally { heldA.release(); heldB.release(); }
    });
    await t.test("staleness L/L+1 and device loss do not serve old bytes", async () => {
        let clock = BigInt(frame.freshnessOriginMonotonicNs);
        const timed = new SemanticAdapter({
            canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
            thingId: "urn:example:staleness", profile, modeId: frame.modeId,
            limits: { maxSnapshotAgeMs: 10 }, clock: () => clock
        });
        timed.accept(frame);
        clock += 10000000n;
        timed.acquireSnapshot("at-limit").release();
        clock++;
        assert.throws(() => timed.acquireSnapshot("over-limit"), error => error.code === "StaleFrame");
        adapter.unavailable(new SourceFault("DeviceLost", "next"));
        const response = await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "DeviceLost");
    });
    await t.test("capture updates independently of HTTP and cancellation invalidates the cache", async () => {
        const controller = new AbortController();
        const running = pump(session, adapter, controller.signal);
        for (let i = 0; i < 100 && !adapter.cache; i++) await delay(20);
        assert.ok(adapter.cache);
        const first = Uint8Array.from(adapter.cache.data);
        await delay(180);
        assert.notDeepEqual(adapter.cache.data, first);
        controller.abort();
        const result = await running;
        assert.ok(["closed", "failed"].includes(result.status));
        assert.equal(adapter.cache, null);
        assert.equal((await fetch(server.snapshotUri, { headers: auth(snapshotTokens[0]) })).status, 503);
    });
    await t.test("malformed and oversized HTTP bodies fail with bounded sanitized errors", async () => {
        const href = server.td.actions[OPERATIONS.profiles].forms[0].href;
        for (const [body, status] of [["{", 400], ['{"Type":' + " ".repeat(65537), 413]]) {
            const response = await fetch(href, {
                method: "POST", headers: { ...auth(controlToken), "Content-Type": "application/json" }, body
            });
            assert.equal(response.status, status);
            const error = await response.json();
            assert.deepEqual(Object.keys(error).sort(), ["code", "diagnosticId", "operation", "retryable"].sort());
            assert.ok(!JSON.stringify(error).includes(__dirname));
        }
    });
});
