"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { finished } = require("node:stream/promises");
const { startMediaSession } = require("./.compiled/media/session.js");
const { MemoryWorker, envelope } = require("./fixtures/memory-worker.cjs");
const { options } = require("./fixtures/session-options.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const pcm = (samples = 160, ptsNs = 0n) => ({
    format: "S16LE", sampleRate: 8000, channels: 1, ptsNs, bytes: Buffer.alloc(samples * 2, 3)
});
function backchannelOptions(worker) {
    const settings = options(worker);
    settings.descriptor.request.tracks.backchannel = "PCMU";
    settings.descriptor.trackMask |= 8;
    return settings;
}
function decoded(session, sequence, generation = 1) {
    const payload = Buffer.alloc(36 + 384, 128);
    payload.fill(0, 0, 36);
    payload.writeUInt16BE(1, 0);
    payload.writeUInt16BE(1, 2);
    payload.writeUInt32BE(16, 4);
    payload.writeUInt32BE(16, 8);
    payload.writeUInt32BE(1, 20);
    payload.writeBigUInt64BE(9999999999999999n, 24);
    payload.writeUInt32BE(384, 32);
    return envelope(0x9002, session.id, generation, sequence, payload);
}
function end(worker, watermark, generation = worker.generation) {
    worker.control.write(envelope(0x8009, worker.session, generation, worker.open.sequence,
        { reason: "native-eos", lastDataSequence: watermark }));
}

test("media v2: negotiated backchannel sends exact private prefix and PCM, then ends only its sending leg", async () => {
    const worker = new MemoryWorker();
    const session = await startMediaSession(backchannelOptions(worker));
    assert.equal(session.nativeSessionId, "memory-native-session");
    assert.equal(session.support.backchannel.maxBytes, 1600);
    assert.equal(session.support.backchannel.sampleBlock, 160);
    assert.ok(session.backchannel);
    await new Promise((resolve, reject) => session.backchannel.write(pcm(), (error) => error ? reject(error) : resolve()));
    session.backchannel.end(pcm(160, 20000000n));
    await finished(session.backchannel);
    assert.equal(worker.audio.writableEnded, true);
    assert.equal(session.state, "playing");
    assert.equal(worker.received.some((entry) => entry.kind === 2), false);
    assert.equal(worker.audioFrames.length, 2);
    for (let index = 0; index < 2; index++) {
        const bytes = worker.audioFrames[index];
        assert.equal(bytes.subarray(0, 4).toString("ascii"), "OMPG");
        assert.equal(bytes.readUInt16BE(4), 2);
        assert.equal(bytes.readUInt16BE(6), 0x1001);
        assert.equal(bytes.readUInt32BE(8), session.id);
        assert.equal(bytes.readUInt32BE(12), 1);
        assert.equal(bytes.readUInt32BE(16), index + 1);
        assert.equal(bytes.readUInt32BE(20), 336);
        assert.deepEqual(bytes.subarray(24, 40), Buffer.from("0004000200001f4000010000000000a0", "hex"));
        assert.deepEqual(bytes.subarray(40), pcm().bytes);
    }
    const reader = session.frames()[Symbol.asyncIterator]();
    worker.data.write(decoded(session, 1));
    assert.equal((await reader.next()).value.ptsNs, 9999999999999999n);
    await reader.return();
    const receipt = await session.close();
    assert.equal(receipt.backchannelPackets, 0, "A pipe write is not a fabricated remote acknowledgement");
    assert.equal(receipt.backchannelSamples, 0);
});

for (const [name, chunk] of [
    ["wrong rate", { ...pcm(), sampleRate: 16000 }],
    ["unaligned samples", pcm(159)],
    ["oversize samples", pcm(960)],
    ["timestamp discontinuity", pcm(160, 1n)],
    ["floating timestamp", { ...pcm(), ptsNs: 0 }],
    ["unknown format", { ...pcm(), format: "S16BE" }]
]) {
    test(`media v2: backchannel rejects ${name} without sending or closing receive tracks`, async () => {
        const worker = new MemoryWorker(), session = await startMediaSession(backchannelOptions(worker));
        const complete = finished(session.backchannel);
        session.backchannel.write(chunk);
        await assert.rejects(complete, { code: "InvalidValue" });
        assert.deepEqual(worker.audioFrames, []);
        assert.equal(session.state, "playing");
        assert.equal(worker.received.some((entry) => entry.kind === 2), false);
        await session.close();
    });
}

test("media v2: END waits for its exact data watermark, drains queued frames and ends readers without fake CLOSED", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(options(worker));
    const reader = session.frames()[Symbol.asyncIterator]();
    let received = false;
    const pending = reader.next().then((value) => { received = true; return value; });
    end(worker, 2);
    await tick();
    assert.equal(received, false);
    worker.data.write(decoded(session, 1));
    worker.data.write(decoded(session, 2));
    assert.equal((await pending).value.sequence, 1);
    assert.equal((await reader.next()).value.sequence, 2);
    assert.equal((await reader.next()).done, true);
    assert.equal(session.state, "playing");
    assert.equal(worker.received.some((entry) => entry.kind === 2), false);
    assert.equal((await session.close()).remote, "acknowledged");
});

test("media v2: complete data before END remains readable and a native PLAY ACK starts the next generation", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(options(worker));
    worker.data.write(decoded(session, 1));
    end(worker, 1);
    const first = session.frames()[Symbol.asyncIterator]();
    assert.equal((await first.next()).value.sequence, 1);
    assert.equal((await first.next()).done, true);
    await session.play();
    const second = session.frames()[Symbol.asyncIterator]();
    worker.data.write(decoded(session, 2, 2));
    end(worker, 2, 2);
    assert.equal((await second.next()).value.generation, 2);
    assert.equal((await second.next()).done, true);
    await session.close();
});

test("media v2: data pipe EOF before END watermark fails and closes the owned session", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(options(worker));
    const stream = session.frames(), completion = finished(stream);
    stream.resume();
    end(worker, 2);
    worker.data.end(decoded(session, 1));
    await assert.rejects(completion, { code: "TransportError" });
    const receipt = await session.closed;
    assert.equal(receipt.workerExit.observed, true);
    assert.equal(receipt.failure.code, "TransportError");
});

test("media v2: invalid CLOSED counts fail rather than becoming a successful receipt", async () => {
    const worker = new MemoryWorker({ autoClose: false }), session = await startMediaSession(options(worker));
    const closing = session.close(), command = worker.received.find((entry) => entry.kind === 2);
    worker.closed(command.sequence, { backchannelPackets: -1 });
    worker.finish();
    const receipt = await closing;
    assert.equal(receipt.remote, "uncertain");
    assert.equal(receipt.failure.code, "InvalidValue");
});

test("media v2: maximum PCM chunk is inclusive and end cannot bypass input byte bounds", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(backchannelOptions(worker));
    await new Promise((resolve, reject) => session.backchannel.write(pcm(800), (error) => error ? reject(error) : resolve()));
    assert.equal(worker.audioFrames[0].length, 1640);
    assert.equal(worker.audioFrames[0].readUInt32BE(36), 800);
    const completion = finished(session.backchannel);
    session.backchannel.end(pcm(960, 100000000n));
    assert.equal(session.backchannel.destroyed, true, "end(chunk) must validate before queuing");
    await assert.rejects(completion, { code: "InvalidValue" });
    assert.equal(worker.audioFrames.length, 1);
    assert.equal(session.state, "playing");
    await session.close();
});

test("media v2: backchannel credits bound queued writes and pending samples block control generation changes", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(backchannelOptions(worker));
    const completion = finished(session.backchannel);
    assert.equal(session.backchannel.write(pcm()), false, "A writer must obey Node drain backpressure");
    await assert.rejects(session.pause(), { code: "InvalidValue" });
    for (let index = 1; index < 9; index++) session.backchannel.write(pcm(160, BigInt(index) * 20000000n));
    await assert.rejects(completion, { code: "InvalidValue" });
    assert.equal(worker.audioFrames.length, 1, "Unsent overflow is not silently pumped into the native appsrc");
    assert.equal(worker.received.some((entry) => entry.kind === 3), false);
    assert.equal(session.generation, 1);
    await session.close();
});

test("media v2: zero-unit END completes readers and post-watermark frames are rejected before delivery", async () => {
    const worker = new MemoryWorker(), session = await startMediaSession(options(worker));
    const reader = session.frames()[Symbol.asyncIterator]();
    end(worker, 0);
    assert.equal((await reader.next()).done, true);
    worker.data.write(decoded(session, 1));
    const closed = await session.closed;
    assert.equal(closed.failure.code, "InvalidValue");
    assert.equal(closed.workerExit.observed, true);
    assert.equal(closed.remote, "acknowledged");
});

test("media v2: a future-generation END and data stay staged until their exact control ACK", async () => {
    const worker = new MemoryWorker({ autoControl: false }), session = await startMediaSession(options(worker));
    const reader = session.frames()[Symbol.asyncIterator]();
    const next = reader.next();
    let delivered = false;
    next.then(() => { delivered = true; });
    const playing = session.play();
    end(worker, 1, 2);
    worker.data.write(decoded(session, 1, 2));
    await tick();
    assert.equal(delivered, false);
    assert.equal(session.generation, 1);
    worker.ack(worker.received.find((entry) => entry.kind === 4));
    await playing;
    assert.equal((await next).value.generation, 2);
    assert.equal((await reader.next()).done, true);
    await session.close();
});

test("media v2: missing terminal data and regressing CLOSED generations never become successful completion", async () => {
    const worker = new MemoryWorker({ autoClose: false }), settings = options(worker);
    settings.descriptor.limits = { ...settings.descriptor.limits, controlTimeoutMs: 30 };
    const session = await startMediaSession(settings);
    const stream = session.frames(), completion = finished(stream);
    stream.resume();
    end(worker, 1);
    await assert.rejects(completion, { code: "TransportError" });
    const command = worker.received.find((entry) => entry.kind === 2);
    worker.control.write(envelope(0x8003, session.id, 0, command.sequence, {
        localCleanup: true, remote: "acknowledged", teardownStatus: 200, dataDiscardedFrames: 0,
        dataQueuePeakBytes: 0, backchannelPackets: 0, backchannelSamples: 0, awaitWorkerExit: true
    }));
    worker.finish();
    const receipt = await session.closed;
    assert.equal(receipt.remote, "uncertain");
    assert.equal(receipt.localCleanup, false);
});

test("media v2: typed native rejection retains only its code and observed CLOSED outcome", async () => {
    const worker = new MemoryWorker({ autoReady: false });
    const opening = startMediaSession(options(worker));
    const rejected = assert.rejects(opening, (error) => {
        assert.equal(error.code, "InvalidSecurity");
        assert.equal(error.nativeCode, "TlsCertificateRejected");
        assert.equal(error.message, "Native media rejected the operation");
        assert.equal(error.cleanup.workerExit.observed, true);
        return true;
    });
    await tick();
    worker.control.write(envelope(0x8004, worker.session, 1, worker.open.sequence,
        { code: "TlsCertificateRejected", message: "Never echo untrusted private text" }));
    await rejected;
});
