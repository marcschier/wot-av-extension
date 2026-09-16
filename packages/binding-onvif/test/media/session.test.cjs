"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startMediaSession } = require("./.compiled/media/session.js");
const { mediaLimits } = require("./.compiled/media/policy.js");
const { MemoryWorker, envelope, hello } = require("./fixtures/memory-worker.cjs");
const { OnvifError } = require("./.compiled/binding/errors.js");
const { options } = require("./fixtures/session-options.cjs");

test("media session: READY resolves without first media and reports negotiated support", async () => {
    const worker = new MemoryWorker();
    const session = await startMediaSession(options(worker));
    assert.equal(session.state, "playing");
    assert.equal(session.generation, 1);
    assert.deepEqual(session.support.decoders, ["JPEG", "PCMU"]);
    assert.deepEqual(session.tracks.map((track) => track.id), [1, 2, 3]);
    assert.equal(worker.received[0].kind, 1);
    assert.equal(worker.received[0].payload.length > 64, true);
    const result = await session.close();
    assert.equal(result.remote, "acknowledged");
    assert.deepEqual(result.workerExit, { observed: true, code: 0, signal: null });
    assert.equal(result.failure, undefined);
});

test("media session: close is idempotent and waits for CLOSED and worker exit", async () => {
    const worker = new MemoryWorker({ autoClose: false });
    const session = await startMediaSession(options(worker));
    const first = session.close(), second = session.close();
    assert.equal(first, second);
    let complete = false;
    first.then(() => { complete = true; });
    await new Promise((resolve) => setImmediate(resolve));
    const command = worker.received.find((entry) => entry.kind === 2);
    worker.closed(command.sequence);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(complete, false);
    worker.finish();
    assert.equal((await first).remote, "acknowledged");
    assert.equal(worker.received.filter((entry) => entry.kind === 2).length, 1);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const replayRange = { startNtpNs: 3998462400250000000n, endNtpNs: 3998462402250000000n };

function metadataPacket(xml, sequence = 1, generation = 1, session = 1) {
    const bytes = Buffer.from(xml);
    const payload = Buffer.alloc(32 + bytes.length);
    payload.writeUInt16BE(3, 0);
    payload.writeUInt16BE(65535, 4);
    payload.writeUInt16BE(0, 6);
    payload.writeUInt32BE(0x30405060, 8);
    payload.writeUInt32BE(0xfffffffe, 12);
    payload.writeUInt32BE(35, 16);
    payload.writeBigUInt64BE(9999999999999999n, 20);
    payload.writeUInt32BE(bytes.length, 28);
    bytes.copy(payload, 32);
    return envelope(0x9003, session, generation, sequence, payload);
}

test("media session: play pause seek mutate only after matching native ACK", async () => {
    const worker = new MemoryWorker({ autoControl: false });
    const settings = options(worker);
    settings.selection.mode = "recorded";
    settings.descriptor.request.replay = replayRange;
    const session = await startMediaSession(settings);
    const pause = session.pause();
    assert.equal(session.state, "playing");
    assert.equal(session.generation, 1);
    const pauseCommand = worker.received.find((command) => command.kind === 3);
    assert.equal(pauseCommand.generation, 1);
    worker.ack(pauseCommand);
    assert.deepEqual(await pause, { acknowledged: true, state: "paused", generation: 1 });
    await assert.rejects(session.pause(), { code: "InvalidValue" });
    const play = session.play();
    assert.equal(session.state, "paused");
    assert.equal(session.generation, 1);
    worker.ack(worker.received.find((command) => command.kind === 4));
    assert.deepEqual(await play, { acknowledged: true, state: "playing", generation: 2 });
    const moved = { startNtpNs: 3998462405250000000n, endNtpNs: 3998462407250000000n };
    const seek = session.seek(moved);
    assert.equal(session.generation, 2);
    const seekCommand = worker.received.find((command) => command.kind === 5);
    assert.equal(seekCommand.payload.readBigUInt64BE(0), 3998462405250000000n);
    assert.equal(seekCommand.payload.readBigUInt64BE(8), 3998462407250000000n);
    assert.equal(seekCommand.generation, 2);
    worker.ack(seekCommand);
    assert.deepEqual(await seek, { acknowledged: true, state: "playing", generation: 3 });
    await session.close();
});

test("media session: future-generation metadata waits for native PLAY ACK and preserves complete bytes", async () => {
    const worker = new MemoryWorker({ autoControl: false });
    const bytes = Buffer.from("<complete-native-document/>"), seen = [];
    const session = await startMediaSession(options(worker, {
        decodeMetadata: (xml) => { seen.push(Buffer.from(xml)); return { accepted: "canonical-fixture" }; }
    }));
    const metadata = session.metadata[Symbol.asyncIterator]();
    let delivered = false;
    const next = metadata.next().then((value) => { delivered = true; return value; });
    const play = session.play();
    worker.data.write(metadataPacket(bytes, 1, 2, session.id));
    await tick();
    assert.equal(delivered, false);
    assert.equal(session.generation, 1);
    assert.deepEqual(seen, []);
    worker.ack(worker.received.find((command) => command.kind === 4));
    await play;
    const value = (await next).value;
    assert.equal(value.generation, 2);
    assert.equal(value.firstRtpSequence, 65535);
    assert.equal(value.lastRtpSequence, 0);
    assert.equal(value.receiptMonoNs, 9999999999999999n);
    assert.deepEqual(value.value, { accepted: "canonical-fixture" });
    assert.deepEqual(seen, [bytes]);
    await metadata.return();
    await session.close();
});

test("media session: canonical malformed metadata reports a gap and never emits an empty success object", async () => {
    const worker = new MemoryWorker();
    const good = "<complete/>", bad = "<broken", calls = [];
    const session = await startMediaSession(options(worker, { decodeMetadata: (bytes) => {
        calls.push(bytes.toString("utf8"));
        if (bytes.toString("utf8") === bad) throw new OnvifError("InvalidXml", "Independent canonical rejection");
        return { complete: "mapped" };
    } }));
    const reader = session.metadata[Symbol.asyncIterator](), diagnostics = session.diagnostics[Symbol.asyncIterator]();
    worker.data.write(metadataPacket(bad, 1, 1, session.id));
    worker.data.write(metadataPacket(good, 2, 1, session.id));
    const value = (await reader.next()).value;
    assert.deepEqual(calls, [bad, good]);
    assert.deepEqual(value.value, { complete: "mapped" });
    assert.equal(value.sequence, 2);
    const gap = (await diagnostics.next()).value;
    assert.deepEqual(gap, { kind: "gap", code: "CanonicalMetadataRejected", track: 3, droppedUnits: 1, generation: 1 });
    await reader.return();
    await diagnostics.return();
    await session.close();
});

test("media session: abort discards queued media and settles blocked subscribers without data delivery", async () => {
    const worker = new MemoryWorker(), controller = new AbortController();
    const session = await startMediaSession(options(worker, { signal: controller.signal, decodeMetadata: () => ({ complete: true }) }));
    const first = session.metadata[Symbol.asyncIterator](), second = session.metadata[Symbol.asyncIterator]();
    worker.data.write(metadataPacket("<document/>", 1, 1, session.id));
    assert.deepEqual((await first.next()).value.value, { complete: true });
    const pending = first.next();
    const rejected = assert.rejects(pending, { code: "TransportError" });
    controller.abort();
    await rejected;
    await assert.rejects(second.next(), { code: "TransportError" });
    const closed = await session.closed;
    assert.equal(closed.remote, "acknowledged");
    assert.equal(closed.workerExit.observed, true);
    assert.ok(closed.droppedUnits >= 1);
    assert.throws(() => session.frames(), { code: "RuntimeClosed" });
});

test("media session: abort during pending SETUP uses an owned CLOSE with the last acknowledged generation", async () => {
    const worker = new MemoryWorker({ autoReady: false }), controller = new AbortController();
    const opening = startMediaSession(options(worker, { signal: controller.signal }));
    const rejected = assert.rejects(opening, (error) => {
        assert.equal(error.code, "TransportError");
        assert.equal(error.cleanup.workerExit.observed, true);
        return true;
    });
    await tick();
    assert.ok(worker.received.some((command) => command.kind === 1));
    controller.abort();
    await rejected;
    assert.equal(worker.received.filter((command) => command.kind === 2).length, 1);
    assert.equal(worker.received.find((command) => command.kind === 2).generation, 0);
    assert.equal(worker.commands.destroyed, true);
});

test("media session: missing negotiated decoder is explicit before credentials or OPEN", async () => {
    const worker = new MemoryWorker({ inventory: { ...hello, availableDecoders: ["PCMU"] } });
    await assert.rejects(startMediaSession(options(worker)), (error) => {
        assert.equal(error.code, "UnsupportedCapability");
        assert.equal(error.cleanup.remote, "not-created");
        assert.equal(error.cleanup.workerExit.observed, true);
        return true;
    });
    assert.deepEqual(worker.secretFrames, []);
    assert.deepEqual(worker.received, []);
});

test("media session: required missing metadata track rejects READY rather than succeeding with a URI", async () => {
    const worker = new MemoryWorker({ autoReady: false });
    const opening = startMediaSession(options(worker));
    const rejected = assert.rejects(opening, { code: "UnsupportedCapability" });
    await tick();
    worker.ready({ tracks: [] });
    await rejected;
    assert.equal(worker.exited, true);
});

test("media session: unacknowledged control rejects and an owned deadline kill is reported", async () => {
    const worker = new MemoryWorker({ autoControl: false, autoClose: false });
    const settings = options(worker);
    settings.descriptor.limits = mediaLimits({ controlTimeoutMs: 30, closeTimeoutMs: 30, killTimeoutMs: 100 });
    const session = await startMediaSession(settings);
    await assert.rejects(session.pause(), { code: "OutcomeUnknown" });
    const closed = await session.closed;
    assert.equal(worker.killed, true);
    assert.equal(closed.terminated, true);
    assert.equal(closed.workerExit.observed, true);
    assert.equal(closed.remote, "uncertain");
    assert.equal(closed.localCleanup, false);
    assert.equal(closed.failure.code, "OutcomeUnknown");
});

test("media session: CLOSED without worker exit is not cleanup completion", async () => {
    const worker = new MemoryWorker({ autoClose: false });
    const settings = options(worker);
    settings.descriptor.limits = mediaLimits({ closeTimeoutMs: 30, killTimeoutMs: 100 });
    const session = await startMediaSession(settings), closed = session.close();
    const close = worker.received.find((entry) => entry.kind === 2);
    worker.closed(close.sequence);
    const result = await closed;
    assert.equal(result.remote, "acknowledged", "The real receipt is retained even when local exit subsequently fails");
    assert.equal(result.localCleanup, false);
    assert.equal(result.terminated, true);
    assert.equal(result.workerExit.observed, true);
    assert.equal(result.failure.code, "OutcomeUnknown");
});

test("media session: worker exit without CLOSED remains remote-uncertain even at exit code zero", async () => {
    const worker = new MemoryWorker({ autoClose: false });
    const session = await startMediaSession(options(worker));
    worker.finish(0);
    const result = await session.closed;
    assert.equal(result.remote, "uncertain");
    assert.equal(result.workerExit.code, 0);
    assert.equal(result.localCleanup, false);
    assert.equal(result.failure.code, "OutcomeUnknown");
});

test("media session: native 454 cleanup is already-ended and does not fabricate a 2xx acknowledgement", async () => {
    const worker = new MemoryWorker({ autoClose: false });
    const session = await startMediaSession(options(worker)), closing = session.close();
    const command = worker.received.find((entry) => entry.kind === 2);
    worker.closed(command.sequence, { remote: "already-ended", teardownStatus: 454 });
    worker.finish();
    const result = await closing;
    assert.equal(result.remote, "already-ended");
    assert.equal(result.teardownStatus, 454);
    assert.equal(result.localCleanup, true);
    assert.equal(result.failure, undefined);
});

test("media session: close settles a pending control and recognizes its late ACK without reopening", async () => {
    const worker = new MemoryWorker({ autoClose: false, autoControl: false });
    const session = await startMediaSession(options(worker));
    const play = session.play();
    const rejected = assert.rejects(play, { code: "OutcomeUnknown" });
    const command = worker.received.find((entry) => entry.kind === 4);
    const closing = session.close();
    worker.ack(command);
    assert.equal(session.state, "closing");
    assert.equal(session.generation, 1);
    worker.closed(0);
    worker.finish();
    await rejected;
    const closed = await closing;
    assert.equal(closed.failure, undefined);
    assert.equal(closed.remote, "acknowledged");
});

test("media session: separate stderr is bounded and never returned verbatim as diagnostics", async () => {
    const worker = new MemoryWorker({ autoClose: false });
    const settings = options(worker);
    settings.descriptor.limits = mediaLimits({ stderrBytes: 8, closeTimeoutMs: 30, killTimeoutMs: 100 });
    const session = await startMediaSession(settings);
    const diagnostics = session.diagnostics[Symbol.asyncIterator]();
    worker.stderr.write(Buffer.from("secret-from-worker-must-not-be-logged"));
    const notice = (await diagnostics.next()).value;
    assert.equal(notice.code, "NativeStderrReceived");
    assert.equal(JSON.stringify(notice).includes("secret-from-worker"), false);
    const closed = await session.closed;
    assert.equal(closed.failure.code, "TransportError");
    assert.ok(closed.stderrBytes > 8);
    assert.equal(JSON.stringify(closed).includes("secret-from-worker"), false);
});
