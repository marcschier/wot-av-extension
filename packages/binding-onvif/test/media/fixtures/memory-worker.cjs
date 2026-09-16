"use strict";

const { PassThrough } = require("node:stream");
const assert = require("node:assert/strict");

const hello = {
    protocol: 2, worker: "onvif-media-reference", gstreamer: "1.28.7",
    nativeRevision: "classic-media-v2-scoped-auth-2",
    backchannelInput: "PCMU-from-S16LE-8000-mono-private-fd5",
    nativeCredentialInput: true, scope: "explicit-native-origin-interface-principal-policy",
    plugins: [], availableDecoders: ["JPEG", "PCMU"], tlsBackend: false,
    transports: ["tcp-interleaved"],
    controls: ["open", "close", "pause", "play", "seek", "credit"],
    metadataGuard: "bounded-xml-root-not-canonical-validation",
    certification: false, distributionApproved: false
};
const tracks = [
    { id: 1, kind: "video", direction: "receive", encoding: "JPEG", payloadType: 26, clockRate: 90000 },
    { id: 2, kind: "audio", direction: "receive", encoding: "PCMU", payloadType: 0, clockRate: 8000 },
    { id: 3, kind: "metadata", direction: "receive", encoding: "VND.ONVIF.METADATA", payloadType: 110, clockRate: 90000 },
    { id: 4, kind: "audio", direction: "send", encoding: "PCMU", payloadType: 97, clockRate: 8000 }
];
function envelope(kind, session, generation, sequence, value) {
    const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const bytes = Buffer.alloc(24 + payload.length);
    bytes.write("OMPG");
    bytes.writeUInt16BE(2, 4);
    bytes.writeUInt16BE(kind, 6);
    bytes.writeUInt32BE(session, 8);
    bytes.writeUInt32BE(generation, 12);
    bytes.writeUInt32BE(sequence, 16);
    bytes.writeUInt32BE(payload.length, 20);
    payload.copy(bytes, 24);
    return bytes;
}
class MemoryWorker {
    constructor({ autoReady = true, autoClose = true, autoControl = true, inventory = hello } = {}) {
        for (const name of ["commands", "control", "data", "stderr", "secrets", "audio"]) this[name] = new PassThrough();
        this.pid = 123456789;
        this.received = [];
        this.secretFrames = [];
        this.audioFrames = [];
        this.exited = false;
        this.generation = 0;
        this.sequence = 0;
        this.autoClose = autoClose;
        this.exit = new Promise((resolve) => { this.resolveExit = resolve; });
        let pending = Buffer.alloc(0);
        this.commands.on("data", (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 24 && pending.length >= 24 + pending.readUInt32BE(20)) {
                const size = pending.readUInt32BE(20);
                assert.equal(pending.toString("ascii", 0, 4), "OMPG");
                assert.equal(pending.readUInt16BE(4), 2);
                const command = { kind: pending.readUInt16BE(6), session: pending.readUInt32BE(8),
                    generation: pending.readUInt32BE(12), sequence: pending.readUInt32BE(16),
                    payload: Buffer.from(pending.subarray(24, 24 + size)) };
                pending = pending.subarray(24 + size);
                this.received.push(command);
                this.session = command.session;
                if (command.kind === 1) {
                    this.generation = 1;
                    this.open = command;
                    if (autoReady) this.ready();
                } else if (command.kind === 2 && autoClose) {
                    this.closed(command.sequence);
                    this.finish();
                } else if ([3, 4, 5].includes(command.kind) && autoControl) {
                    this.ack(command);
                }
            }
        });
        this.commands.on("close", () => {
            if (autoClose && !this.exited) { this.closed(0); this.finish(); }
        });
        this.secrets.on("data", (chunk) => this.secretFrames.push(Buffer.from(chunk)));
        this.audio.on("data", (chunk) => this.audioFrames.push(Buffer.from(chunk)));
        process.nextTick(() => this.control.write(envelope(0x8001, 0, 0, 0, inventory)));
    }
    ready(overrides = {}) {
        this.control.write(envelope(0x8002, this.session, this.generation, this.open.sequence, {
            state: "playing", protocolReady: true, receivingIsSeparate: true, nativeSessionId: "memory-native-session",
            tracks: tracks.filter((track) => this.open.payload[2] & (1 << (track.id - 1))), ...overrides
        }));
    }
    ack(command, overrides = {}) {
        if (command.kind !== 3) this.generation++;
        this.control.write(envelope(0x8008, this.session, this.generation, command.sequence, {
            state: command.kind === 3 ? "paused" : "playing", acknowledged: true, command: command.kind, ...overrides
        }));
    }
    closed(sequence = 0, overrides = {}) {
        this.control.write(envelope(0x8003, this.session || 0, this.generation, sequence, {
            localCleanup: true, remote: this.open ? "acknowledged" : "not-created",
            teardownStatus: this.open ? 200 : 0, dataDiscardedFrames: 0, dataQueuePeakBytes: 0,
            gaps: 0, backchannelPackets: 0, backchannelSamples: 0, awaitWorkerExit: true, ...overrides
        }));
    }
    finish(code = 0) {
        if (this.exited) return;
        this.exited = true;
        for (const name of ["control", "data", "stderr"]) this[name].end();
        this.commands.destroy();
        this.secrets.destroy();
        this.audio.destroy();
        setImmediate(() => this.resolveExit({ observed: true, code, signal: null }));
    }
    terminate() {
        this.killed = true;
        this.finish(137);
        return true;
    }
}
module.exports = { MemoryWorker, hello, tracks, envelope };
