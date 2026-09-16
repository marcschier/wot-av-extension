"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BoundedMediaQueue } = require("./.compiled/media/queue.js");

function queue() {
    return new BoundedMediaQueue({ mode: "recorded", maxBytes: 768, maxUnits: 2, maxSubscribers: 2,
        onGap: () => { throw new Error("No decoded-frame corruption or unexpected drop"); } });
}

test("media queue: END preserves complete queued I420 units until final consumption releases their credits", async () => {
    const buffer = queue(), released = [];
    const frames = [Buffer.alloc(384, 73), Buffer.alloc(384, 149)];
    buffer.publish(frames[0], 384, () => released.push(1));
    buffer.publish(frames[1], 384, () => released.push(2));
    buffer.end();
    buffer.end();
    assert.equal(buffer.queuedBytes, 768);
    assert.deepEqual(released, []);
    const reader = buffer[Symbol.asyncIterator]();
    assert.deepEqual((await reader.next()).value, Buffer.alloc(384, 73));
    assert.deepEqual(released, [1]);
    assert.deepEqual((await reader.next()).value, Buffer.alloc(384, 149));
    assert.deepEqual(released, [1, 2]);
    assert.deepEqual(await reader.next(), { value: undefined, done: true });
    assert.equal(buffer.queuedBytes, 0);
});

test("media queue: cancellation supersedes terminal draining and resume opens only a fresh generation", async () => {
    const buffer = queue(), released = [];
    const old = buffer[Symbol.asyncIterator]();
    buffer.publish("old", 1, () => released.push("old"));
    buffer.end();
    buffer.resume();
    assert.deepEqual(released, ["old"]);
    assert.deepEqual(await old.next(), { value: undefined, done: true });
    const current = buffer[Symbol.asyncIterator]();
    buffer.publish("new", 1, () => released.push("new"));
    buffer.end();
    const error = new Error("Owned cancellation");
    buffer.finish(error);
    await assert.rejects(current.next(), (actual) => actual === error);
    assert.deepEqual(released, ["old", "new"]);
    assert.equal(buffer.queuedUnits, 0);
    assert.throws(() => buffer.resume(), { code: "RuntimeClosed" });
});
