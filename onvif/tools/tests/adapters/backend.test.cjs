"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const { CaptureBackend, CaptureSession, configuredCapturePermission, discover, memoryTarget, DEFAULT_LIMITS,
    normalizeLimits, PacketDecoder, NativeWorker, u64 } = require("../../../samples/adapters/src/backend.cjs");
const { SourceFault } = require("../../../samples/adapters/src/fault.cjs");
const workerPath = path.resolve(__dirname, "..", "..", "..", "samples", "adapters", "build-windows", "windows-capture-worker.exe");
const is = code => error => error instanceof SourceFault && error.code === code;

async function setup() {
    const backend = new CaptureBackend({ workerPath, authorizeOpen: () => true });
    const target = memoryTarget();
    const evidence = await backend.describe(target, { refresh: "native-read-only", permitDeviceAccess: true });
    return { backend, target, evidence };
}

function authorized(value, additions = {}, durationMs = 5000) {
    const request = {
        target: value.target, modeId: value.evidence.modes[0].modeId,
        capabilityEvidenceDigest: value.evidence.digest, output: "JPEG", durationMs, ...additions
    };
    return request;
}

test("constructors, cached describe and denied discovery do not launch a worker or select a camera", async () => {
    const backend = new CaptureBackend({ workerPath: path.resolve(__dirname, "does-not-exist.exe") });
    await assert.rejects(backend.describe(memoryTarget()), is("SourceUnavailable"));
    await assert.rejects(backend.describe(memoryTarget(), { refresh: "native-read-only" }), is("PolicyDenied"));
    await assert.rejects(discover({ workerPath, permitDiscovery: false }), is("PolicyDenied"));
    for (const privateSelector of ["", "0", "first camera"]) {
        await assert.rejects(backend.describe({ ...memoryTarget(), backend: "windows-mf", privateSelector }),
            is("InvalidSelection"));
    }
    assert.throws(() => configuredCapturePermission({ target: memoryTarget(), permitAcquisition: false }), is("PolicyDenied"));
});

test("real MF memory evidence, one owner, owned JPEG and decimal timestamps", async () => {
    const fixture = await setup();
    assert.equal(fixture.evidence.evidenceKind, "synthetic");
    assert.equal(fixture.evidence.modes.length, 1);
    assert.equal(fixture.evidence.modes[0].width, 17);
    assert.deepEqual(fixture.evidence.modes[0].cadence, { numerator: 20, denominator: 1 });
    const cached = await fixture.backend.describe(fixture.target);
    assert.equal(cached.cached, true);
    cached.modes[0].width = 999;
    assert.equal((await fixture.backend.describe(fixture.target)).modes[0].width, 17);
    const request = authorized(fixture);
    const session = await fixture.backend.open(request);
    try {
        await assert.rejects(fixture.backend.open(request), is("Busy"));
        await assert.rejects(fixture.backend.open(authorized(fixture)), is("Busy"));
        const first = await session.next();
        assert.equal(first.format, "JPEG");
        assert.equal(first.payloadBytes, first.data.byteLength);
        assert.equal(first.timing.pipelinePtsNs, "9007199254740900");
        assert.equal(first.timing.sdkSampleTime100ns, "90071992547409");
        assert.equal(first.timing.sdkSampleDuration100ns, "500000");
        assert.equal(first.timing.source, null);
        assert.ok(u64(first.timing.hostReceiptMonotonicNs));
        fs.writeFileSync(path.join(__dirname, "..", "..", "..", "samples", "adapters", "build-windows", "software-ipc.jpg"), first.data);
        const original = Uint8Array.from(first.data);
        const second = await session.next();
        assert.deepEqual(first.data, original);
        first.data.fill(0);
        assert.equal(second.data[0], 0xff);
        assert.equal(second.sequence, "2");
    } finally {
        const result = await session.close();
        assert.equal(result.status, "closed");
        assert.equal(result.acquisitionStop, "acknowledged");
        assert.deepEqual(await session.close(), result);
        assert.deepEqual(await session.closed, result);
    }
});

test("I420 odd geometry and output byte L and L+1 bounds use the native encoder", async () => {
    const fixture = await setup();
    const session = await fixture.backend.open(authorized(fixture, {
        output: "I420", limits: { maxWidth: 17, maxHeight: 13, maxFrameBytes: 347 }
    }));
    assert.equal((await session.next()).payloadBytes, 347);
    assert.equal((await session.close()).status, "closed");
    const small = await fixture.backend.open(authorized(fixture, { output: "I420", limits: { maxFrameBytes: 346 } }));
    await assert.rejects(small.next(), is("ResourceLimit"));
    const closed = await small.close();
    assert.equal(closed.status, "failed");
    assert.ok(closed.faults.some(value => value.code === "ResourceLimit"));
    assert.throws(() => normalizeLimits({ maxWidth: 4097 }), is("ResourceLimit"));
    assert.throws(() => normalizeLimits({ maxFrameBytes: 16777217 }), is("ResourceLimit"));
    assert.throws(() => normalizeLimits({ maxQueuedFrames: 3 }), is("ResourceLimit"));
    assert.throws(() => normalizeLimits({ maxSubscribers: 3 }), is("ResourceLimit"));
});

test("changed identity, evidence and mode fail closed with default-denied acquisition", async () => {
    const fixture = await setup();
    const changed = { ...fixture.target, expectedIdentity: { ...fixture.target.expectedIdentity, fingerprint: "0".repeat(64) } };
    await assert.rejects(fixture.backend.describe(changed), is("IdentityChanged"));
    const request = authorized(fixture);
    const denied = new CaptureBackend({ workerPath, cachedEvidence: [fixture.evidence] });
    await assert.rejects(denied.open(request), is("PolicyDenied"));
    await assert.rejects(fixture.backend.open({ ...request, modeId: "mf-" + "0".repeat(32) }), is("InvalidSelection"));
    await assert.rejects(fixture.backend.open({ ...request, capabilityEvidenceDigest: "0".repeat(64) }), is("IdentityChanged"));
    const missing = new CaptureBackend({ workerPath: path.resolve(__dirname, "missing.exe") });
    await assert.rejects(missing.describe(fixture.target, { refresh: "native-read-only", permitDeviceAccess: true }), is("MissingDependency"));
});

test("one in-flight next, cancellation and bounded operator duration", async () => {
    const fixture = await setup();
    const session = await fixture.backend.open(authorized(fixture));
    const controller = new AbortController();
    const first = session.next(controller.signal);
    const rejected = assert.rejects(first, is("Cancelled"));
    await assert.rejects(session.next(), is("Busy"));
    controller.abort();
    await rejected;
    const result = await session.close();
    assert.ok(["closed", "forced"].includes(result.status));
    await assert.rejects(session.next(), is("SourceUnavailable"));
    const short = await fixture.backend.open(authorized(fixture, {}, 500));
    const born = Date.now();
    const expired = await short.closed;
    assert.ok(Date.now() - born < 3000);
    assert.equal(expired.workerExit, "observed");
});

test("fragmented framing, uint64 exactness, malformed data and truncation", () => {
    let packets = 0;
    const decoder = new PacketDecoder((metadata, data) => {
        assert.deepEqual(metadata, { kind: "frame" });
        assert.deepEqual([...data], [1, 2, 3]);
        packets++;
    }, 3);
    const json = Buffer.from('{"kind":"frame"}');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(json.length);
    header.writeUInt32LE(3, 4);
    for (const byte of Buffer.concat([header, json, Buffer.from([1, 2, 3])])) decoder.push(Buffer.from([byte]));
    decoder.finish();
    assert.equal(packets, 1);
    header.writeUInt32LE(4, 4);
    assert.throws(() => new PacketDecoder(() => {}, 3).push(header), is("ResourceLimit"));
    const partial = new PacketDecoder(() => {});
    partial.push(Buffer.from([1]));
    assert.throws(() => partial.finish(), is("ProtocolError"));
    assert.equal(u64("18446744073709551615"), true);
    assert.equal(u64("18446744073709551616"), false);
    assert.equal(u64("01"), false);
    assert.equal(u64(9007199254740992), false);
});

test("blocked native reads and partial writes have observed forced cleanup", async () => {
    for (const mode of ["blocked-read", "partial-write", "wrong-kind"]) {
        const worker = new NativeWorker({
            executable: process.execPath, args: [path.join(__dirname, "..", "..", "fixtures", "adapters", "worker-fixture.cjs"), mode],
            limits: normalizeLimits({ readDeadlineMs: 50, closeDeadlineMs: 100 })
        });
        const started = Date.now();
        await assert.rejects(worker.request("next", [], ["frame"]), error => error instanceof SourceFault);
        const result = await worker.shutdown();
        assert.equal(result.status, "forced");
        assert.equal(result.resources, "unknown");
        assert.equal(result.acquisitionStop, "unknown");
        assert.equal(result.workerExit, "observed");
        assert.ok(Date.now() - started < 2000);
    }
});

test("source loss and cleanup failure are both retained without raw diagnostics", async () => {
    const worker = new NativeWorker({
        executable: process.execPath,
        args: [path.join(__dirname, "..", "..", "fixtures", "adapters", "worker-fixture.cjs"), "source-and-cleanup-failure"]
    });
    await assert.rejects(worker.request("next", [], ["frame"]), is("DeviceLost"));
    const result = await worker.closed;
    assert.equal(result.status, "failed");
    assert.deepEqual(result.faults.map(value => value.code), ["DeviceLost", "CleanupFailed"]);
    assert.ok(!JSON.stringify(result).includes(__dirname));
});

test("incomplete native status is a gap, while EOS ends and closes the session", async () => {
    const worker = new NativeWorker({
        executable: process.execPath, args: [path.join(__dirname, "..", "..", "fixtures", "adapters", "worker-fixture.cjs"), "gap-then-eos"]
    });
    const session = new CaptureSession(worker, { output: "JPEG", limits: DEFAULT_LIMITS }, {}, 5000);
    assert.deepEqual(await session.next(), { kind: "gap", generation: "1", dropped: "1", reason: "native-incomplete" });
    assert.deepEqual(await session.next(), { kind: "end", reason: "eos" });
    assert.equal((await session.closed).status, "closed");
    await assert.rejects(session.next(), is("SourceUnavailable"));
});
