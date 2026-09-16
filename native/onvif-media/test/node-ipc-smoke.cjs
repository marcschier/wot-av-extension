"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const [worker, sdk] = process.argv.slice(2);
const descriptor = JSON.parse(readFileSync(0, "utf8"));
const session = 41;
const expectedCycles = descriptor.cycles;
const counts = { video: 0, audio: 0, metadata: 0, rtp: 0 };
let ready = false;
let closing = false;
let closed = null;
let error = null;
let lastDataSequence = 0;
let stderr = "";

const child = spawn(worker, ["--data-fd", "3"], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PATH: path.join(sdk, "bin") + path.delimiter + process.env.PATH },
});

function fail(reason) {
    if (!error) error = reason instanceof Error ? reason : new Error(String(reason));
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
}

function command(kind, generation, sequence, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(24);
    header.write("OMPG", 0, "ascii");
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(kind, 6);
    header.writeUInt32BE(session, 8);
    header.writeUInt32BE(generation, 12);
    header.writeUInt32BE(sequence, 16);
    header.writeUInt32BE(payload.length, 20);
    child.stdin.write(Buffer.concat([header, payload]));
}

function maybeClose() {
    if (ready && !closing && counts.video === expectedCycles &&
        counts.audio === expectedCycles && counts.metadata === expectedCycles &&
        counts.rtp === expectedCycles * 5) {
        closing = true;
        command(2, 1, 2);
    }
}

function frames(stream, maximum, consume) {
    let pending = Buffer.alloc(0);
    stream.on("data", (chunk) => {
        try {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 24) {
                assert.equal(pending.toString("ascii", 0, 4), "OMPG");
                assert.equal(pending.readUInt16BE(4), 1);
                const length = pending.readUInt32BE(20);
                assert.ok(length <= maximum);
                if (pending.length < 24 + length) break;
                consume({
                    kind: pending.readUInt16BE(6),
                    session: pending.readUInt32BE(8),
                    generation: pending.readUInt32BE(12),
                    sequence: pending.readUInt32BE(16),
                    payload: pending.subarray(24, 24 + length),
                });
                pending = pending.subarray(24 + length);
            }
            assert.ok(pending.length <= maximum + 24);
        } catch (reason) {
            fail(reason);
        }
    });
    stream.on("end", () => {
        if (pending.length) fail(new Error("Truncated private Node IPC frame"));
    });
    stream.on("error", fail);
}

frames(child.stdout, 4096, (message) => {
    const value = JSON.parse(message.payload.toString("utf8"));
    if (message.kind === 0x8001) {
        assert.equal(value.gstreamer, "1.28.7");
        assert.equal(value.nativeCredentialInput, false);
        const uri = Buffer.from(descriptor.uri, "utf8");
        const payload = Buffer.alloc(22 + uri.length);
        payload[0] = descriptor.recorded ? 1 : 0;
        payload[1] = 1;
        payload[2] = descriptor.auth ? 1 : 0;
        payload[3] = 7;
        payload.writeBigUInt64BE(BigInt(descriptor.startNtpNs || "0"), 4);
        payload.writeBigUInt64BE(BigInt(descriptor.endNtpNs || "0"), 12);
        payload.writeUInt16BE(uri.length, 20);
        uri.copy(payload, 22);
        command(1, 0, 1, payload);
    } else if (message.kind === 0x8002) {
        assert.equal(message.session, session);
        assert.equal(message.generation, 1);
        ready = true;
        maybeClose();
    } else if (message.kind === 0x8003) {
        assert.equal(value.localCleanup, true);
        assert.equal(value.remote, "acknowledged");
        assert.equal(message.sequence, 2);
        closed = value;
    } else if (message.kind === 0x8004 || message.kind === 0x8006) {
        fail(new Error(JSON.stringify(value)));
    }
});

frames(child.stdio[3], 65536, (message) => {
    assert.equal(message.session, session);
    assert.equal(message.generation, 1);
    assert.equal(message.sequence, ++lastDataSequence);
    const payload = message.payload;
    const track = payload.readUInt16BE(0);
    if (message.kind === 0x9001) {
        assert.equal(payload.length, 40 + payload.readUInt32BE(36));
        assert.ok(payload.readBigUInt64BE(16) > 0n);
        if (descriptor.recorded) {
            assert.equal(payload.readUInt32BE(32) & 1, 1);
            assert.equal(payload.readBigUInt64BE(24), payload.readBigUInt64BE(56));
        }
        counts.rtp++;
    } else if (message.kind === 0x9002) {
        const bytes = payload.subarray(36);
        assert.equal(bytes.length, payload.readUInt32BE(32));
        const expected = track === 1 ? descriptor.hashes.decodedI420 : descriptor.hashes.decodedPcmS16LE;
        assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
        if (track === 1) {
            assert.equal(payload.readUInt32BE(4), 16);
            assert.equal(payload.readUInt32BE(8), 16);
            counts.video++;
        } else {
            assert.equal(track, 2);
            assert.equal(payload.readUInt32BE(12), 8000);
            assert.equal(payload.readUInt32BE(20), 160);
            counts.audio++;
        }
    } else if (message.kind === 0x9003) {
        assert.equal(track, 3);
        assert.equal(createHash("sha256").update(payload.subarray(32)).digest("hex"), descriptor.hashes.metadataXml);
        counts.metadata++;
    } else {
        throw new Error("Undeclared native data message");
    }
    maybeClose();
});

child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 16384) fail(new Error("Native stderr exceeded its fixture bound"));
});
child.stdin.on("error", fail);
child.on("error", fail);
const deadline = setTimeout(() => fail(new Error("Owned Node worker deadline; remote cleanup uncertain")), 15000);
child.on("close", (code) => {
    clearTimeout(deadline);
    if (error || code !== 0 || !closed) {
        console.error(JSON.stringify({ error: error?.message || "Missing successful close/exit", code, counts, stderr }));
        process.exitCode = 1;
    } else {
        console.log(JSON.stringify({ node: process.version, nodeArch: process.arch, counts, close: closed, stderr }));
    }
});
