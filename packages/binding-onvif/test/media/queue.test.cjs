"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BoundedMediaQueue } = require("./.compiled/media/queue.js");

test("media queue: live overflow drops complete oldest units and emits gaps", async () => {
    const gaps = [], released = [];
    const queue = new BoundedMediaQueue({ maxBytes: 5, maxUnits: 2, maxSubscribers: 2,
        mode: "live", onGap: (count) => gaps.push(count) });
    const reader = queue[Symbol.asyncIterator]();
    queue.publish("one", 3, () => released.push(1));
    queue.publish("two", 3, () => released.push(2));
    assert.deepEqual(gaps, [1]);
    assert.deepEqual(released, [1]);
    assert.equal(queue.queuedBytes, 3);
    assert.deepEqual(await reader.next(), { value: "two", done: false });
    assert.deepEqual(released, [1, 2]);
    await reader.return();
    queue.finish();
});

test("media queue: returning one subscriber preserves another", async () => {
    const queue = new BoundedMediaQueue({ maxBytes: 16, maxUnits: 2, maxSubscribers: 2,
        mode: "recorded", onGap: () => assert.fail("Replay must not drop") });
    const first = queue[Symbol.asyncIterator](), second = queue[Symbol.asyncIterator]();
    let released = 0;
    queue.publish("native-unit", 8, () => released++);
    await first.return();
    assert.equal(released, 0);
    assert.deepEqual(await second.next(), { value: "native-unit", done: false });
    assert.equal(released, 1);
    const pending = second.next();
    queue.finish();
    assert.deepEqual(await pending, { value: undefined, done: true });
});
