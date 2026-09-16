"use strict";

// Process/pipe fixture only. There is no RTSP stack, authentication or decoder here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { hello, tracks, envelope } = require("./memory-worker.cjs");

function exact(fd, length, eof = false) {
    const result = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const count = fs.readSync(fd, result, offset, length - offset);
        if (!count && !offset && eof) return undefined;
        assert.ok(count > 0, "Truncated fixture command");
        offset += count;
    }
    return result;
}
function frame(fd, eof = false) {
    const header = exact(fd, 24, eof);
    if (!header) return undefined;
    assert.equal(header.toString("ascii", 0, 4), "OMPG");
    assert.equal(header.readUInt16BE(4), 2);
    const length = header.readUInt32BE(20);
    assert.ok(length <= 65536);
    return { kind: header.readUInt16BE(6), session: header.readUInt32BE(8),
        generation: header.readUInt32BE(12), sequence: header.readUInt32BE(16), payload: exact(fd, length) };
}
function strings(payload, offset, count) {
    const result = [];
    for (let index = 0; index < count; index++) {
        const length = payload.readUInt16BE(offset);
        offset += 2;
        assert.ok(offset + length <= payload.length);
        result.push(new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(offset, offset + length)));
        offset += length;
    }
    return result;
}
function write(fd, bytes) {
    for (let offset = 0; offset < bytes.length; offset += 7) fs.writeSync(fd, bytes.subarray(offset, offset + 7));
}
function main() {
    assert.deepEqual(process.argv.slice(2), ["--data-fd", "3", "--secret-fd", "4", "--input-fd", "5"]);
    if (process.env.ONVIF_MEDIA_FAKE_MODE === "bad-handshake") {
        const invalid = envelope(0x8001, 0, 0, 0, hello);
        invalid.write("NOPE", 0, "ascii");
        write(1, invalid);
        assert.equal(frame(4, true), undefined, "No secret may be sent after an invalid binary handshake");
        return;
    }
    write(1, envelope(0x8001, 0, 0, 0, hello));
    const security = frame(4);
    assert.equal(security.kind, 0x10);
    assert.equal(security.sequence, 1);
    assert.equal(security.generation, 0);
    const secret = strings(security.payload, 12, 11);
    assert.equal(frame(4, true), undefined, "SECURITY must be the only frame before EOF");
    const open = frame(0);
    assert.equal(open.kind, 1);
    assert.equal(open.session, security.session);
    const supplied = strings(open.payload, 64, 4);
    assert.equal(supplied[1], secret[0]);
    assert.equal(supplied[2], secret[1]);
    if (secret[5]) {
        assert.equal(open.payload.includes(Buffer.from(secret[5])), false);
        assert.equal(JSON.stringify(process.argv).includes(secret[5]), false);
        assert.equal(Object.values(process.env).includes(secret[5]), false);
    }
    write(2, Buffer.from("fake-worker-process-only\n"));
    const prefix = Buffer.from("000100010000001000000010000000000000000000000001ffffffffffffffff00000180", "hex");
    write(3, envelope(0x9002, open.session, 1, 1, Buffer.concat([prefix, Buffer.alloc(384, 90)])));
    write(1, envelope(0x8002, open.session, 1, open.sequence, {
        state: "playing", protocolReady: true, receivingIsSeparate: true, nativeSessionId: "fake-native-session",
        tracks: tracks.filter((entry) => open.payload[2] & (1 << (entry.id - 1)))
    }));
    let last = open.sequence;
    while (true) {
        const command = frame(0, true);
        if (command === undefined) return;
        assert.ok(command.sequence > last);
        last = command.sequence;
        assert.equal(command.session, open.session);
        if (command.kind === 6) continue;
        assert.equal(command.kind, 2);
        assert.equal(command.generation, 1);
        if (process.env.ONVIF_MEDIA_FAKE_MODE === "ignore-close") continue;
        write(1, envelope(0x8003, open.session, 1, command.sequence, {
            localCleanup: true, remote: "acknowledged", teardownStatus: 200,
            dataDiscardedFrames: 0, dataQueuePeakBytes: 444, gaps: 0,
            backchannelPackets: 0, backchannelSamples: 0, awaitWorkerExit: true
        }));
        return;
    }
}
try {
    main();
} finally {
    for (const fd of [3, 4, 5]) fs.closeSync(fd);
}
