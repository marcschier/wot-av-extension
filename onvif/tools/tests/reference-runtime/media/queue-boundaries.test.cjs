"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BoundedMediaQueue } = require("./.compiled-unit/media/queue.js");
const { OnvifError } = require("./.compiled-unit/binding/errors.js");

const done = { value: undefined, done: true };

function onvifError(code, message, execution = "not-sent") {
    return (error) => {
        assert.equal(error instanceof OnvifError, true);
        assert.equal(error.name, "OnvifError");
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        assert.equal(error.execution, execution);
        return true;
    };
}

function identical(expected) {
    return (error) => {
        assert.equal(error, expected);
        return true;
    };
}

function fixture(maxBytes, maxUnits, maxSubscribers, mode, ids) {
    const counts = Object.fromEntries(ids.map((id) => [id, 0]));
    const gaps = [], events = [], readers = [];
    const queue = new BoundedMediaQueue({
        maxBytes, maxUnits, maxSubscribers, mode,
        onGap: (units) => {
            gaps.push(units);
            events.push(`gap:${units}`);
        }
    });
    return {
        queue, ids, counts, gaps, events, readers,
        reader() {
            const reader = queue[Symbol.asyncIterator]();
            readers.push(reader);
            return reader;
        },
        publish(id, bytes) {
            queue.publish(id, bytes, () => {
                counts[id]++;
                events.push(`release:${id}`);
            });
        }
    };
}

// State is [stored bytes, stored subscriber entries, historical per-slot peak].
// Release vectors use the fixture's explicit ID order, including unpublished/held IDs at zero.
function check(f, state, releases, gaps = [], events) {
    assert.deepEqual([f.queue.queuedBytes, f.queue.queuedUnits, f.queue.peakBytesPerSubscriber], state,
        "bytes / units / historical per-subscriber peak");
    assert.deepEqual(f.ids.map((id) => f.counts[id]), releases, `release counts for ${f.ids.join("/")}`);
    assert.deepEqual(f.gaps, gaps, "gap callback arguments");
    if (events !== undefined) assert.deepEqual(f.events, events, "release/gap order");
}

async function take(f, reader, value, state, releases, gaps = [], events) {
    const next = reader.next();
    check(f, state, releases, gaps, events);
    assert.deepEqual(await next, { value, done: false });
    check(f, state, releases, gaps, events);
}

async function returnReader(f, reader, state, releases, gaps = [], events) {
    const returned = reader.return();
    check(f, state, releases, gaps, events);
    assert.deepEqual(await returned, done);
    check(f, state, releases, gaps, events);
}

function terminal(next, error) {
    if (error !== undefined) return assert.rejects(next, identical(error));
    return next.then((result) => assert.deepEqual(result, done));
}

async function cleanup(f) {
    f.queue.finish();
    for (const reader of f.readers) assert.deepEqual(await reader.return(), done);
}

async function prepareFinishFixture(f) {
    const first = f.reader(), second = f.reader(), retained = f.reader();
    f.publish("A", 2);
    check(f, [6, 3, 2], [0, 0], [], []);
    f.publish("B", 3);
    check(f, [15, 6, 5], [0, 0], [], []);
    await take(f, first, "A", [13, 5, 5], [0, 0], [], []);
    await take(f, first, "B", [10, 4, 5], [0, 0], [], []);
    await take(f, second, "A", [8, 3, 5], [0, 0], [], []);
    await take(f, second, "B", [5, 2, 5], [0, 0], [], []);
    return { first, second, retained };
}

test("media queue: exact count capacity drops the whole oldest unit on adjacent overflow", async () => {
    const f = fixture(20, 2, 1, "live", ["A", "B", "C"]);
    const reader = f.reader();
    const finalEvents = ["release:A", "gap:1", "release:B", "release:C"];
    try {
        f.publish("A", 2);
        check(f, [2, 1, 2], [0, 0, 0], [], []);
        f.publish("B", 3);
        check(f, [5, 2, 5], [0, 0, 0], [], []);
        f.publish("C", 4);
        check(f, [7, 2, 7], [1, 0, 0], [1], ["release:A", "gap:1"]);
        await take(f, reader, "B", [4, 1, 7], [1, 1, 0], [1]);
        await take(f, reader, "C", [0, 0, 7], [1, 1, 1], [1], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 7], [1, 1, 1], [1], finalEvents);
});

test("media queue: exact byte capacity drops a whole unit on the next byte", async () => {
    const f = fixture(6, 4, 1, "live", ["A", "B", "C"]);
    const reader = f.reader();
    const finalEvents = ["release:A", "gap:1", "release:B", "release:C"];
    try {
        f.publish("A", 2);
        check(f, [2, 1, 2], [0, 0, 0], [], []);
        f.publish("B", 4);
        check(f, [6, 2, 6], [0, 0, 0], [], []);
        f.publish("C", 1);
        check(f, [5, 2, 6], [1, 0, 0], [1], ["release:A", "gap:1"]);
        await take(f, reader, "B", [1, 1, 6], [1, 1, 0], [1]);
        await take(f, reader, "C", [0, 0, 6], [1, 1, 1], [1], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 6], [1, 1, 1], [1], finalEvents);
});

test("media queue: an oversized live unit drops only the incoming stalled-slot entry", async () => {
    const f = fixture(6, 4, 1, "live", ["A", "B", "X"]);
    const reader = f.reader();
    const finalEvents = ["gap:1", "release:X", "release:A", "release:B"];
    try {
        f.publish("A", 2);
        check(f, [2, 1, 2], [0, 0, 0], [], []);
        f.publish("B", 3);
        check(f, [5, 2, 5], [0, 0, 0], [], []);
        f.publish("X", 7);
        check(f, [5, 2, 5], [0, 0, 1], [1], ["gap:1", "release:X"]);
        await take(f, reader, "A", [3, 1, 5], [1, 0, 1], [1]);
        await take(f, reader, "B", [0, 0, 5], [1, 1, 1], [1], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 5], [1, 1, 1], [1], finalEvents);
});

test("media queue: recorded capacity and unit overflow preserve the full slot", async () => {
    const rows = [
        { maxBytes: 20, maxUnits: 2, bBytes: 3, xBytes: 1, retained: 5,
            message: "Recorded media exceeded its outstanding consumer credits" },
        { maxBytes: 6, maxUnits: 4, bBytes: 4, xBytes: 1, retained: 6,
            message: "Recorded media exceeded its outstanding consumer credits" },
        { maxBytes: 6, maxUnits: 4, bBytes: 3, xBytes: 7, retained: 5,
            message: "Recorded media unit exceeds the consumer queue bound" }
    ];
    for (const row of rows) {
        const f = fixture(row.maxBytes, row.maxUnits, 1, "recorded", ["A", "B", "X", "Y"]);
        const reader = f.reader();
        const finalEvents = ["release:X", "release:A", "release:B", "release:Y"];
        try {
            f.publish("A", 2);
            check(f, [2, 1, 2], [0, 0, 0, 0], [], []);
            f.publish("B", row.bBytes);
            check(f, [row.retained, 2, row.retained], [0, 0, 0, 0], [], []);
            assert.throws(() => f.publish("X", row.xBytes), onvifError("InvalidValue", row.message));
            check(f, [row.retained, 2, row.retained], [0, 0, 1, 0], [], ["release:X"]);
            await take(f, reader, "A", [row.bBytes, 1, row.retained], [1, 0, 1, 0]);
            await take(f, reader, "B", [0, 0, row.retained], [1, 1, 1, 0]);
            f.publish("Y", 1);
            check(f, [1, 1, row.retained], [1, 1, 1, 0]);
            await take(f, reader, "Y", [0, 0, row.retained], [1, 1, 1, 1], [], finalEvents);
        } finally {
            await cleanup(f);
        }
        check(f, [0, 0, row.retained], [1, 1, 1, 1], [], finalEvents);
    }
});

test("media queue: an unclaimed initial subscriber stores only the bounded burst tail", async () => {
    const f = fixture(6, 3, 1, "live", ["A", "B", "C", "D", "E", "F"]);
    const finalEvents = [
        "release:A", "gap:1", "release:B", "gap:1", "release:C", "gap:1",
        "release:D", "release:E", "release:F"
    ];
    try {
        // No iterator exists during this entire finite burst.
        for (const [id, state, releases, gaps, events] of [
            ["A", [2, 1, 2], [0, 0, 0, 0, 0, 0], [], []],
            ["B", [4, 2, 4], [0, 0, 0, 0, 0, 0], [], []],
            ["C", [6, 3, 6], [0, 0, 0, 0, 0, 0], [], []],
            ["D", [6, 3, 6], [1, 0, 0, 0, 0, 0], [1], ["release:A", "gap:1"]],
            ["E", [6, 3, 6], [1, 1, 0, 0, 0, 0], [1, 1], ["release:A", "gap:1", "release:B", "gap:1"]],
            ["F", [6, 3, 6], [1, 1, 1, 0, 0, 0], [1, 1, 1],
                ["release:A", "gap:1", "release:B", "gap:1", "release:C", "gap:1"]]
        ]) {
            f.publish(id, 2);
            check(f, state, releases, gaps, events);
        }
        const reader = f.reader();
        check(f, [6, 3, 6], [1, 1, 1, 0, 0, 0], [1, 1, 1]);
        await take(f, reader, "D", [4, 2, 6], [1, 1, 1, 1, 0, 0], [1, 1, 1]);
        await take(f, reader, "E", [2, 1, 6], [1, 1, 1, 1, 1, 0], [1, 1, 1]);
        await take(f, reader, "F", [0, 0, 6], [1, 1, 1, 1, 1, 1], [1, 1, 1], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 6], [1, 1, 1, 1, 1, 1], [1, 1, 1], finalEvents);
});

test("media queue: clean finish resolves two pending readers and releases retained fanout", async () => {
    const f = fixture(8, 3, 3, "recorded", ["A", "B"]);
    try {
        const { first, second, retained } = await prepareFinishFixture(f);
        const firstPending = first.next(), secondPending = second.next();
        check(f, [5, 2, 5], [0, 0], [], []);
        f.queue.finish();
        check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
        assert.deepEqual(await firstPending, done);
        assert.deepEqual(await secondPending, done);
        assert.deepEqual(await retained.next(), done);
        check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
});

test("media queue: error finish rejects two pending readers with the identical error", async () => {
    const f = fixture(8, 3, 3, "recorded", ["A", "B"]);
    const sentinel = new Error("finish-Q7");
    try {
        const { first, second, retained } = await prepareFinishFixture(f);
        const firstRejected = assert.rejects(first.next(), identical(sentinel));
        const secondRejected = assert.rejects(second.next(), identical(sentinel));
        check(f, [5, 2, 5], [0, 0], [], []);
        f.queue.finish(sentinel);
        check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
        await Promise.all([firstRejected, secondRejected]);
        await assert.rejects(retained.next(), identical(sentinel));
        check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
});

test("media queue: first finish outcome survives repeated finish and return", async () => {
    for (const failure of [undefined, new Error("first-finish")]) {
        const f = fixture(6, 3, 2, "live", ["A"]);
        const first = f.reader(), second = f.reader();
        try {
            f.publish("A", 2);
            check(f, [4, 2, 2], [0], [], []);
            await take(f, first, "A", [2, 1, 2], [0], [], []);
            const pendingOutcome = terminal(first.next(), failure);
            check(f, [2, 1, 2], [0], [], []);
            f.queue.finish(failure);
            check(f, [0, 0, 2], [1], [], ["release:A"]);
            await pendingOutcome;
            f.queue.finish(new Error("replacement"));
            check(f, [0, 0, 2], [1], [], ["release:A"]);
            f.queue.finish();
            check(f, [0, 0, 2], [1], [], ["release:A"]);
            await returnReader(f, first, [0, 0, 2], [1], [], ["release:A"]);
            await returnReader(f, first, [0, 0, 2], [1], [], ["release:A"]);
            await returnReader(f, second, [0, 0, 2], [1], [], ["release:A"]);
            await terminal(first.next(), failure);
            await terminal(second.next(), failure);
            const later = f.reader();
            await terminal(later.next(), failure);
            check(f, [0, 0, 2], [1], [], ["release:A"]);
        } finally {
            await cleanup(f);
        }
        check(f, [0, 0, 2], [1], [], ["release:A"]);
    }
});

test("media queue: asymmetric return preserves retained and future values for the survivor", async () => {
    const f = fixture(10, 4, 2, "recorded", ["A", "B", "C"]);
    const fast = f.reader(), slow = f.reader();
    const finalEvents = ["release:A", "release:B", "release:C"];
    try {
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0, 0], [], []);
        f.publish("B", 3);
        check(f, [10, 4, 5], [0, 0, 0], [], []);
        await take(f, fast, "A", [8, 3, 5], [0, 0, 0], [], []);
        await returnReader(f, slow, [3, 1, 5], [1, 0, 0], [], ["release:A"]);
        assert.deepEqual(await slow.next(), done);
        f.publish("C", 4);
        check(f, [7, 2, 7], [1, 0, 0], [], ["release:A"]);
        await take(f, fast, "B", [4, 1, 7], [1, 1, 0]);
        await take(f, fast, "C", [0, 0, 7], [1, 1, 1], [], finalEvents);
        assert.deepEqual(await slow.next(), done);
        check(f, [0, 0, 7], [1, 1, 1], [], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 7], [1, 1, 1], [], finalEvents);
});

test("media queue: final subscriber return releases all retained units once", async () => {
    const f = fixture(10, 3, 1, "recorded", ["A", "B", "C"]);
    const reader = f.reader();
    const finalEvents = ["release:A", "release:B", "release:C"];
    try {
        f.publish("A", 2);
        check(f, [2, 1, 2], [0, 0, 0], [], []);
        f.publish("B", 3);
        check(f, [5, 2, 5], [0, 0, 0], [], []);
        f.publish("C", 4);
        check(f, [9, 3, 9], [0, 0, 0], [], []);
        await returnReader(f, reader, [0, 0, 9], [1, 1, 1], [], finalEvents);
        await returnReader(f, reader, [0, 0, 9], [1, 1, 1], [], finalEvents);
        assert.equal(f.queue.discard(), 0);
        check(f, [0, 0, 9], [1, 1, 1], [], finalEvents);
        f.queue.finish();
        check(f, [0, 0, 9], [1, 1, 1], [], finalEvents);
        f.queue.finish();
        check(f, [0, 0, 9], [1, 1, 1], [], finalEvents);
        assert.deepEqual(await reader.next(), done);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 9], [1, 1, 1], [], finalEvents);
});

test("media queue: fanout drop iterator throw and finish release every entry exactly once", async () => {
    const f = fixture(6, 3, 2, "live", ["A", "B", "C", "D", "E"]);
    const fast = f.reader(), slow = f.reader();
    const sentinel = new Error("Q11-stop");
    const finalEvents = ["release:A", "release:B", "gap:2", "release:C", "release:D", "release:E"];
    try {
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0, 0, 0, 0], [], []);
        f.publish("B", 2);
        check(f, [8, 4, 4], [0, 0, 0, 0, 0], [], []);
        f.publish("C", 2);
        check(f, [12, 6, 6], [0, 0, 0, 0, 0], [], []);
        await take(f, fast, "A", [10, 5, 6], [0, 0, 0, 0, 0], [], []);
        await take(f, fast, "B", [8, 4, 6], [0, 0, 0, 0, 0], [], []);
        f.publish("D", 3);
        check(f, [10, 4, 6], [1, 1, 0, 0, 0], [2], ["release:A", "release:B", "gap:2"]);
        await take(f, fast, "C", [8, 3, 6], [1, 1, 0, 0, 0], [2]);
        const thrown = assert.rejects(slow.throw(sentinel), identical(sentinel));
        check(f, [3, 1, 6], [1, 1, 1, 0, 0], [2], ["release:A", "release:B", "gap:2", "release:C"]);
        await thrown;
        assert.deepEqual(await slow.next(), done);
        f.publish("E", 1);
        check(f, [4, 2, 6], [1, 1, 1, 0, 0], [2]);
        f.queue.finish();
        check(f, [0, 0, 6], [1, 1, 1, 1, 1], [2], finalEvents);
        assert.deepEqual(await fast.next(), done);
        assert.deepEqual(await slow.next(), done);
        await returnReader(f, fast, [0, 0, 6], [1, 1, 1, 1, 1], [2], finalEvents);
        await returnReader(f, slow, [0, 0, 6], [1, 1, 1, 1, 1], [2], finalEvents);
        f.queue.finish();
        check(f, [0, 0, 6], [1, 1, 1, 1, 1], [2], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 6], [1, 1, 1, 1, 1], [2], finalEvents);
});

test("media queue: returning the reserved slot makes no-subscriber publication release immediately", async () => {
    const f = fixture(6, 3, 1, "live", ["A", "B"]);
    const initial = f.reader();
    try {
        await returnReader(f, initial, [0, 0, 0], [0, 0], [], []);
        f.publish("A", 2);
        check(f, [0, 0, 0], [1, 0], [], ["release:A"]);
        const replacement = f.reader();
        const pending = replacement.next();
        check(f, [0, 0, 0], [1, 0], [], ["release:A"]);
        f.publish("B", 3);
        check(f, [0, 0, 0], [1, 1], [], ["release:A", "release:B"]);
        assert.deepEqual(await pending, { value: "B", done: false });
        assert.deepEqual(await initial.next(), done);
        check(f, [0, 0, 0], [1, 1], [], ["release:A", "release:B"]);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 0], [1, 1], [], ["release:A", "release:B"]);
});

test("media queue: exact subscriber capacity rejects one more and reuses a returned slot", async () => {
    const f = fixture(6, 3, 2, "recorded", ["A", "B"]);
    const first = f.reader(), second = f.reader();
    try {
        assert.equal(first[Symbol.asyncIterator](), first);
        assert.equal(second[Symbol.asyncIterator](), second);
        assert.throws(() => f.reader(), onvifError("InvalidValue", "Media subscriber capacity reached"));
        check(f, [0, 0, 0], [0, 0], [], []);
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0], [], []);
        await returnReader(f, second, [2, 1, 2], [0, 0], [], []);
        const replacement = f.reader();
        assert.equal(replacement[Symbol.asyncIterator](), replacement);
        const pending = replacement.next();
        check(f, [2, 1, 2], [0, 0], [], []);
        f.publish("B", 3);
        check(f, [5, 2, 5], [0, 0], [], []);
        assert.deepEqual(await pending, { value: "B", done: false });
        await take(f, first, "A", [3, 1, 5], [1, 0], [], ["release:A"]);
        await take(f, first, "B", [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
        assert.throws(() => f.reader(), onvifError("InvalidValue", "Media subscriber capacity reached"));
        check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
        assert.deepEqual(await second.next(), done);
        await returnReader(f, replacement, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
        await returnReader(f, first, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 5], [1, 1], [], ["release:A", "release:B"]);
});

test("media queue: a second pending next rejects without replacing the first", async () => {
    const f = fixture(6, 3, 1, "recorded", ["A", "B", "C"]);
    const reader = f.reader();
    const finalEvents = ["release:A", "release:B", "release:C"];
    try {
        const first = reader.next();
        check(f, [0, 0, 0], [0, 0, 0], [], []);
        await assert.rejects(reader.next(),
            onvifError("InvalidValue", "Only one pending read per media subscriber is permitted"));
        check(f, [0, 0, 0], [0, 0, 0], [], []);
        f.publish("A", 2);
        check(f, [0, 0, 0], [1, 0, 0], [], ["release:A"]);
        assert.deepEqual(await first, { value: "A", done: false });
        f.publish("B", 1);
        check(f, [1, 1, 1], [1, 0, 0], [], ["release:A"]);
        f.publish("C", 2);
        check(f, [3, 2, 3], [1, 0, 0], [], ["release:A"]);
        const second = reader.next();
        check(f, [2, 1, 3], [1, 1, 0], [], ["release:A", "release:B"]);
        const third = reader.next();
        check(f, [0, 0, 3], [1, 1, 1], [], finalEvents);
        assert.deepEqual(await second, { value: "B", done: false });
        assert.deepEqual(await third, { value: "C", done: false });
        check(f, [0, 0, 3], [1, 1, 1], [], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 3], [1, 1, 1], [], finalEvents);
});

test("media queue: finished queues never deliver buffered or later publications", async () => {
    for (const failure of [undefined, new Error("terminal-first")]) {
        const f = fixture(6, 3, 1, "live", ["A", "B", "C"]);
        const old = f.reader();
        const finalEvents = ["release:A", "release:B", "release:C"];
        try {
            f.publish("A", 2);
            check(f, [2, 1, 2], [0, 0, 0], [], []);
            f.publish("B", 3);
            check(f, [5, 2, 5], [0, 0, 0], [], []);
            f.queue.finish(failure);
            check(f, [0, 0, 5], [1, 1, 0], [], ["release:A", "release:B"]);
            await terminal(old.next(), failure);
            // Three unreturned terminal iterators cannot consume a maxSubscribers=1 live capacity.
            const later = [f.reader(), f.reader(), f.reader()];
            for (const reader of later) await terminal(reader.next(), failure);
            check(f, [0, 0, 5], [1, 1, 0], [], ["release:A", "release:B"]);
            f.publish("C", 4);
            check(f, [0, 0, 5], [1, 1, 1], [], finalEvents);
            f.queue.finish(new Error("terminal-later"));
            await terminal(old.next(), failure);
            for (const reader of later) await terminal(reader.next(), failure);
            check(f, [0, 0, 5], [1, 1, 1], [], finalEvents);
        } finally {
            await cleanup(f);
        }
        check(f, [0, 0, 5], [1, 1, 1], [], finalEvents);
    }
});

test("media queue: configuration and publication bounds distinguish validation from credit ownership", async () => {
    const bounds = [
        ["maxBytes", "queue bytes", 134217728, 134217729],
        ["maxUnits", "queue units", 256, 257],
        ["maxSubscribers", "queue subscribers", 16, 17]
    ];
    for (const mode of ["live", "recorded"]) {
        for (const [field, , cap] of bounds) {
            for (const value of [1, cap]) {
                const options = { maxBytes: 6, maxUnits: 3, maxSubscribers: 2, [field]: value };
                const f = fixture(options.maxBytes, options.maxUnits, options.maxSubscribers, mode, []);
                try {
                    check(f, [0, 0, 0], [], [], []);
                } finally {
                    await cleanup(f);
                }
                check(f, [0, 0, 0], [], [], []);
            }
        }
    }
    for (const [field, label, , excessive] of bounds) {
        for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, 9007199254740992, excessive]) {
            const gaps = [];
            assert.throws(() => new BoundedMediaQueue({
                maxBytes: 6, maxUnits: 3, maxSubscribers: 2, mode: "live",
                onGap: (count) => gaps.push(count), [field]: value
            }), onvifError("InvalidConfiguration", `${label} must be a positive integer within its supported bound`));
            assert.deepEqual(gaps, []);
        }
    }
    for (const mode of ["buffered", undefined, null]) {
        const gaps = [];
        assert.throws(() => new BoundedMediaQueue({
            maxBytes: 6, maxUnits: 3, maxSubscribers: 2, mode, onGap: (count) => gaps.push(count)
        }), onvifError("InvalidConfiguration", "Invalid media queue mode or gap observer"));
        assert.deepEqual(gaps, []);
    }
    for (const onGap of [undefined, null, 0, {}]) {
        assert.throws(() => new BoundedMediaQueue({
            maxBytes: 6, maxUnits: 3, maxSubscribers: 2, mode: "recorded", onGap
        }), onvifError("InvalidConfiguration", "Invalid media queue mode or gap observer"));
    }

    const valid = fixture(134217728, 2, 1, "recorded", ["min", "hard-max"]);
    const reader = valid.reader();
    try {
        valid.publish("min", 1);
        check(valid, [1, 1, 1], [0, 0], [], []);
        await take(valid, reader, "min", [0, 0, 1], [1, 0], [], ["release:min"]);
        valid.publish("hard-max", 134217728);
        check(valid, [134217728, 1, 134217728], [1, 0], [], ["release:min"]);
        await take(valid, reader, "hard-max", [0, 0, 134217728], [1, 1], [], ["release:min", "release:hard-max"]);
        valid.queue.publish("default", 1);
        check(valid, [1, 1, 134217728], [1, 1], [], ["release:min", "release:hard-max"]);
        await take(valid, reader, "default", [0, 0, 134217728], [1, 1], [], ["release:min", "release:hard-max"]);
    } finally {
        await cleanup(valid);
    }
    check(valid, [0, 0, 134217728], [1, 1], [], ["release:min", "release:hard-max"]);

    for (const topology of ["active", "finished", "no-subscribers"]) {
        const f = fixture(6, 3, 1, "live", ["A", "invalid"]);
        const initial = f.reader();
        const expectedState = topology === "active" ? [2, 1, 2] : [0, 0, 0];
        try {
            if (topology === "active") f.publish("A", 2);
            else if (topology === "finished") f.queue.finish();
            else await returnReader(f, initial, [0, 0, 0], [0, 0], [], []);
            check(f, expectedState, [0, 0], [], []);
            for (const bytes of [0, -1, 1.5, NaN, Infinity, -Infinity, 9007199254740992, 134217729]) {
                assert.throws(() => f.publish("invalid", bytes),
                    onvifError("InvalidConfiguration", "media unit bytes must be a positive integer within its supported bound"));
                check(f, expectedState, [0, 0], [], []);
            }
        } finally {
            await cleanup(f);
        }
        check(f, topology === "active" ? [0, 0, 2] : [0, 0, 0],
            topology === "active" ? [1, 0] : [0, 0], [], topology === "active" ? ["release:A"] : []);
    }
});

test("media queue: discard counts stored shares, preserves peak, and leaves pending readers active", async () => {
    const f = fixture(8, 4, 3, "recorded", ["A", "B", "C", "D"]);
    const finalEvents = ["release:A", "release:B", "release:C", "release:D"];
    try {
        check(f, [0, 0, 0], [0, 0, 0, 0], [], []);
        assert.equal(f.queue.discard(), 0);
        check(f, [0, 0, 0], [0, 0, 0, 0], [], []);
        const first = f.reader();
        f.reader();
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0, 0, 0], [], []);
        f.publish("B", 3);
        check(f, [10, 4, 5], [0, 0, 0, 0], [], []);
        assert.equal(f.queue.discard(), 4);
        check(f, [0, 0, 5], [1, 1, 0, 0], [], ["release:A", "release:B"]);
        assert.equal(f.queue.discard(), 0);
        check(f, [0, 0, 5], [1, 1, 0, 0], [], ["release:A", "release:B"]);
        f.reader();
        const pendingC = first.next();
        f.publish("C", 1);
        check(f, [2, 2, 5], [1, 1, 0, 0], [], ["release:A", "release:B"]);
        assert.deepEqual(await pendingC, { value: "C", done: false });
        const pendingD = first.next();
        assert.equal(f.queue.discard(), 2);
        check(f, [0, 0, 5], [1, 1, 1, 0], [], ["release:A", "release:B", "release:C"]);
        f.publish("D", 2);
        check(f, [4, 2, 5], [1, 1, 1, 0], [], ["release:A", "release:B", "release:C"]);
        assert.deepEqual(await pendingD, { value: "D", done: false });
        f.queue.finish();
        check(f, [0, 0, 5], [1, 1, 1, 1], [], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 5], [1, 1, 1, 1], [], finalEvents);
});

test("media queue: pending delivery bypasses storage bounds without retaining immediate shares", async () => {
    for (const mode of ["live", "recorded"]) {
        for (const count of [1, 2]) {
            const f = fixture(6, 2, count, mode, ["X"]);
            try {
                const readers = Array.from({ length: count }, () => f.reader());
                const pending = readers.map((reader) => reader.next());
                check(f, [0, 0, 0], [0], [], []);
                f.publish("X", 7);
                check(f, [0, 0, 0], [1], [], ["release:X"]);
                assert.deepEqual(await Promise.all(pending), count === 1
                    ? [{ value: "X", done: false }]
                    : [{ value: "X", done: false }, { value: "X", done: false }]);
                check(f, [0, 0, 0], [1], [], ["release:X"]);
            } finally {
                await cleanup(f);
            }
            check(f, [0, 0, 0], [1], [], ["release:X"]);
        }

        const mixed = fixture(6, 2, 2, mode, ["M"]);
        const first = mixed.reader(), second = mixed.reader();
        try {
            const pending = first.next();
            mixed.publish("M", 4);
            check(mixed, [4, 1, 4], [0], [], []);
            assert.deepEqual(await pending, { value: "M", done: false });
            await take(mixed, second, "M", [0, 0, 4], [1], [], ["release:M"]);
        } finally {
            await cleanup(mixed);
        }
        check(mixed, [0, 0, 4], [1], [], ["release:M"]);

        const oversized = fixture(6, 2, 2, mode, ["A", "X"]);
        const fast = oversized.reader(), slow = oversized.reader();
        const gaps = mode === "live" ? [1] : [];
        const overflowEvents = mode === "live" ? ["gap:1", "release:X"] : ["release:X"];
        const finalEvents = mode === "live" ? ["gap:1", "release:X", "release:A"] : ["release:X", "release:A"];
        try {
            oversized.publish("A", 2);
            check(oversized, [4, 2, 2], [0, 0], [], []);
            await take(oversized, fast, "A", [2, 1, 2], [0, 0], [], []);
            const pending = fast.next();
            if (mode === "live") oversized.publish("X", 7);
            else assert.throws(() => oversized.publish("X", 7),
                onvifError("InvalidValue", "Recorded media unit exceeds the consumer queue bound"));
            check(oversized, [2, 1, 2], [0, 1], gaps, overflowEvents);
            assert.deepEqual(await pending, { value: "X", done: false });
            await take(oversized, slow, "A", [0, 0, 2], [1, 1], gaps, finalEvents);
        } finally {
            await cleanup(oversized);
        }
        check(oversized, [0, 0, 2], [1, 1], gaps, finalEvents);
    }
});

test("media queue: live multi-oldest drops report one gap per affected slot", async () => {
    const f = fixture(6, 4, 2, "live", ["A", "B", "C", "D"]);
    const first = f.reader(), second = f.reader();
    const overflowEvents = ["gap:1", "release:A", "release:B", "gap:2"];
    const finalEvents = ["gap:1", "release:A", "release:B", "gap:2", "release:C", "release:D"];
    try {
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0, 0, 0], [], []);
        f.publish("B", 2);
        check(f, [8, 4, 4], [0, 0, 0, 0], [], []);
        f.publish("C", 2);
        check(f, [12, 6, 6], [0, 0, 0, 0], [], []);
        await take(f, first, "A", [10, 5, 6], [0, 0, 0, 0], [], []);
        f.publish("D", 3);
        check(f, [10, 4, 6], [1, 1, 0, 0], [1, 2], overflowEvents);
        await take(f, first, "C", [8, 3, 6], [1, 1, 0, 0], [1, 2], overflowEvents);
        await take(f, second, "C", [6, 2, 6], [1, 1, 1, 0], [1, 2]);
        await take(f, first, "D", [3, 1, 6], [1, 1, 1, 0], [1, 2]);
        await take(f, second, "D", [0, 0, 6], [1, 1, 1, 1], [1, 2], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 6], [1, 1, 1, 1], [1, 2], finalEvents);
});

test("media queue: recorded partial fanout retains an earlier accepted share after a later slot rejects", async () => {
    const f = fixture(20, 2, 2, "recorded", ["A", "B", "X", "Y"]);
    const fast = f.reader(), slow = f.reader();
    const finalEvents = ["release:X", "release:A", "release:B", "release:Y"];
    try {
        f.publish("A", 2);
        check(f, [4, 2, 2], [0, 0, 0, 0], [], []);
        f.publish("B", 2);
        check(f, [8, 4, 4], [0, 0, 0, 0], [], []);
        await take(f, fast, "A", [6, 3, 4], [0, 0, 0, 0], [], []);
        await take(f, fast, "B", [4, 2, 4], [0, 0, 0, 0], [], []);
        // Fast is empty but has no pending next: X must stay buffered despite the later throw.
        assert.throws(() => f.publish("X", 1),
            onvifError("InvalidValue", "Recorded media exceeded its outstanding consumer credits"));
        check(f, [5, 3, 4], [0, 0, 0, 0], [], []);
        await take(f, fast, "X", [4, 2, 4], [0, 0, 1, 0], [], ["release:X"]);
        await take(f, slow, "A", [2, 1, 4], [1, 0, 1, 0], [], ["release:X", "release:A"]);
        await take(f, slow, "B", [0, 0, 4], [1, 1, 1, 0], [], ["release:X", "release:A", "release:B"]);
        f.publish("Y", 3);
        check(f, [6, 2, 4], [1, 1, 1, 0]);
        await take(f, fast, "Y", [3, 1, 4], [1, 1, 1, 0]);
        await take(f, slow, "Y", [0, 0, 4], [1, 1, 1, 1], [], finalEvents);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 4], [1, 1, 1, 1], [], finalEvents);
});

test("media queue: iterator return and throw cancel pending reads without poisoning reusable slots", async () => {
    const actions = [
        { kind: "return" },
        { kind: "throw", error: new Error("iterator-stop") },
        { kind: "throw", error: "iterator-stop" },
        { kind: "throw-omitted", error: undefined }
    ];
    for (const action of actions) {
        const f = fixture(6, 3, 2, "recorded", ["X"]);
        const first = f.reader(), second = f.reader();
        try {
            assert.equal(first[Symbol.asyncIterator](), first);
            assert.equal(second[Symbol.asyncIterator](), second);
            const firstPending = first.next(), secondPending = second.next();
            check(f, [0, 0, 0], [0], [], []);
            const actionOutcome = action.kind === "return"
                ? first.return().then((result) => assert.deepEqual(result, done))
                : assert.rejects(action.kind === "throw-omitted" ? first.throw() : first.throw(action.error),
                    identical(action.error));
            check(f, [0, 0, 0], [0], [], []);
            await actionOutcome;
            assert.deepEqual(await firstPending, done);
            assert.deepEqual(await first.next(), done);
            const replacement = f.reader();
            const replacementPending = replacement.next();
            f.publish("X", 2);
            check(f, [0, 0, 0], [1], [], ["release:X"]);
            assert.deepEqual(await secondPending, { value: "X", done: false });
            assert.deepEqual(await replacementPending, { value: "X", done: false });
            await returnReader(f, first, [0, 0, 0], [1], [], ["release:X"]);
        } finally {
            await cleanup(f);
        }
        check(f, [0, 0, 0], [1], [], ["release:X"]);
    }

    const f = fixture(6, 3, 2, "recorded", []);
    const reader = f.reader();
    const queueError = new Error("queue-terminal"), iteratorError = new Error("different-iterator-error");
    try {
        const pendingRejected = assert.rejects(reader.next(), identical(queueError));
        f.queue.finish(queueError);
        const throwRejected = assert.rejects(reader.throw(iteratorError), identical(iteratorError));
        check(f, [0, 0, 0], [], [], []);
        await Promise.all([pendingRejected, throwRejected]);
        await assert.rejects(reader.next(), identical(queueError));
        await returnReader(f, reader, [0, 0, 0], [], [], []);
    } finally {
        await cleanup(f);
    }
    check(f, [0, 0, 0], [], [], []);
});
