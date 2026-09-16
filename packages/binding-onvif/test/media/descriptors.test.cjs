"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeMediaData, parseSupport } = require("./.compiled/media/protocol.js");
const { mediaLimits } = require("./.compiled/media/policy.js");

test("media descriptor: decoded I420 lengths and track descriptors are checked before delivery", () => {
    const prefix = Buffer.from("000100010000001000000010000000000000000000000001ffffffffffffffff00000180", "hex");
    const bytes = Buffer.alloc(384, 128);
    const frame = { kind: 0x9002, session: 5, generation: 1, sequence: 9,
        payload: Buffer.concat([prefix, bytes]) };
    assert.deepEqual(decodeMediaData(frame, mediaLimits()), {
        kind: "decoded", track: 1, generation: 1, sequence: 9, format: "I420",
        width: 16, height: 16, sampleRate: 0, channels: 0, count: 1, ptsNs: undefined, bytes
    });
    assert.throws(() => decodeMediaData({ ...frame, payload: frame.payload.subarray(0, -1) }, mediaLimits()),
        { code: "InvalidValue" });
    const inconsistent = Buffer.from(frame.payload);
    inconsistent.writeUInt32BE(17, 4);
    assert.throws(() => decodeMediaData({ ...frame, payload: inconsistent }, mediaLimits()), { code: "InvalidValue" });
});

test("media descriptor: P0 inventory cannot masquerade as v2 scoped native support", () => {
    assert.throws(() => parseSupport({ protocol: 1, nativeCredentialInput: false,
        worker: "onvif-p0", availableDecoders: ["JPEG"] }), { code: "UnsupportedCapability" });
});
