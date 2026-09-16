"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { configuredCapturePermission, memoryTarget, normalizeLimits, validateTarget, validateEvidence,
    PacketDecoder, CaptureBackend, NativeWorker } = require("../../../samples/adapters/src/backend.cjs");
const { SourceFault } = require("../../../samples/adapters/src/fault.cjs");

test("finite configured permission approves only the selected target, mode, duration and tightened limits", () => {
    const request = {
        target: memoryTarget(), modeId: "mf-" + "a".repeat(32), capabilityEvidenceDigest: "b".repeat(64),
        output: "JPEG", durationMs: 1000, limits: normalizeLimits()
    };
    const permission = configuredCapturePermission({ ...request, permitAcquisition: true });
    assert.equal(permission(request), true);
    for (const change of [
        { modeId: "mf-" + "c".repeat(32) }, { durationMs: 1001 }, { output: "I420" },
        { target: { ...request.target, adapterDeviceKey: "another-camera" } }
    ]) assert.equal(permission({ ...request, ...change }), false);
    assert.equal(permission({ ...request, limits: normalizeLimits({ maxFrameBytes: 64 }) }), true);
});

test("Linux cached evidence preserves native tuples and never launches unavailable worker", async () => {
    const target = {
        backend: "linux-v4l2", privateSelector: "/dev/v4l/by-id/operator-selected", adapterDeviceKey: "linux-camera",
        expectedIdentity: { fingerprint: "d".repeat(64), scope: "linux-device-node", serial: null, transport: "unknown" }
    };
    const evidence = {
        targetKey: target.adapterDeviceKey, evidenceKind: "operator-supplied", digest: "e".repeat(64),
        identity: target.expectedIdentity,
        modes: [{
            modeId: "v4l2-" + "f".repeat(32), nativeMediaType: "video", nativeSubtype: "V4L2:MJPG",
            width: 640, height: 480, cadence: { numerator: 30, denominator: 1 }, stride: 0,
            interlace: "progressive", evidenceLocator: "VIDIOC_ENUM_FMT", nativeDetails: "fixture tuple; not hardware"
        }]
    };
    assert.deepEqual(validateTarget(target), target);
    assert.equal(validateEvidence(evidence, target, "describe", true).modes[0].nativeDetails, evidence.modes[0].nativeDetails);
    const backend = new CaptureBackend({ workerPath: path.resolve(__dirname, "not-built"), cachedEvidence: [evidence] });
    assert.equal((await backend.describe(target)).cached, true);
    await assert.rejects(backend.open({
        target, modeId: evidence.modes[0].modeId, capabilityEvidenceDigest: evidence.digest,
        durationMs: 1000, output: "JPEG"
    }), error => error.code === "PolicyDenied");
    assert.throws(() => validateTarget({ ...target, privateSelector: "/dev/video*" }), SourceFault);
    assert.throws(() => validateEvidence({
        ...evidence, modes: [{ ...evidence.modes[0], width: -1 }]
    }, target, "describe", true), SourceFault);
});

test("adjacent binary packets survive every split and malformed UTF8/truncated bodies fail", () => {
    const metadata = Buffer.from('{"kind":"frame"}');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(metadata.length);
    header.writeUInt32LE(4, 4);
    const packet = Buffer.concat([header, metadata, Buffer.from([0xff, 0, 1, 0xfe])]);
    const wire = Buffer.concat([packet, packet]);
    for (let split = 0; split <= wire.length; split++) {
        let count = 0;
        const decoder = new PacketDecoder((value, bytes) => {
            assert.equal(value.kind, "frame");
            assert.deepEqual(bytes, packet.subarray(packet.length - 4));
            count++;
        });
        decoder.push(wire.subarray(0, split));
        decoder.push(wire.subarray(split));
        decoder.finish();
        assert.equal(count, 2);
    }
    const corrupt = Buffer.from(packet);
    corrupt[8] = 0xff;
    assert.throws(() => new PacketDecoder(() => {}).push(corrupt), error => error.code === "ProtocolError");
    const truncated = new PacketDecoder(() => {});
    truncated.push(packet.subarray(0, -1));
    assert.throws(() => truncated.finish(), error => error.code === "ProtocolError");
});

test("missing native binary is explicit, not a successful empty device", async () => {
    const worker = new NativeWorker({ executable: path.resolve(__dirname, "missing-native-worker") });
    await assert.rejects(worker.request("next", [], ["frame"]), error => error.code === "MissingDependency");
    const result = await worker.closed;
    assert.equal(result.workerExit, "observed");
    assert.equal(result.acquisitionStop, "unknown");
});
