"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { IpcFrameDecoder, IpcKind, encodeEnvelope } = require("./.compiled/media/ipc.js");

test("media IPC: fragmented headers and coalesced payloads preserve exact v2 frames", () => {
    const payload = Buffer.from('{"code":"fixture"}');
    const bytes = Buffer.from("4f4d50470002800400000029000000010000000700000012", "hex");
    const first = Buffer.concat([bytes, payload]);
    assert.deepEqual(encodeEnvelope(IpcKind.ERROR, 41, 1, 7, payload), first);
    const decoder = new IpcFrameDecoder("control");
    const observed = [];
    const accept = (frame) => observed.push(frame);
    decoder.push(first.subarray(0, 3), accept);
    decoder.push(first.subarray(3, 23), accept);
    assert.equal(observed.length, 0);
    decoder.push(Buffer.concat([first.subarray(23), first]), accept);
    decoder.end();
    assert.deepEqual(observed, [
        { kind: 0x8004, session: 41, generation: 1, sequence: 7, payload },
        { kind: 0x8004, session: 41, generation: 1, sequence: 7, payload }
    ]);
    assert.equal(decoder.bufferedBytes, 0);
});
