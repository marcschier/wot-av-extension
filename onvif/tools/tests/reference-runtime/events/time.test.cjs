const test = require("node:test");
const assert = require("node:assert/strict");
const { fixedDurationMilliseconds, instantMilliseconds, duration, eventClock } = require("./.compiled/events/time");

test("event time: bounded day/time durations include zero and exact scheduler edge but reject calendar and malformed values", () => {
    for (const [lexical, value] of [["PT0S", 0], ["P1DT2H3M4.005S", 93784005], ["PT2147483.647S", 2147483647]]) {
        assert.equal(fixedDurationMilliseconds(lexical), value);
    }
    assert.throws(() => fixedDurationMilliseconds("PT2147483.648S"), { code: "XmlLimit" });
    for (const lexical of ["P", "PT", "P1DT", "P1M", "-PT1S", "PT1e2S"]) {
        assert.throws(() => fixedDurationMilliseconds(lexical), { code: "InvalidValue" });
    }
});

test("event time: serialization is exact at zero and finite bounds and rejects invalid intervals", () => {
    assert.equal(duration(0), "PT0S");
    assert.equal(duration(125), "PT0.125S");
    assert.equal(duration(2147483647), "PT2147483.647S");
    for (const value of [-1, NaN, Infinity, 2147483648]) assert.throws(() => duration(value));
});

test("event time: explicit timezone offsets, small years, day rollover and fractional precision map without Date.parse normalization", () => {
    const base = instantMilliseconds("2026-09-16T03:00:00.123456789Z");
    assert.equal(base, Date.UTC(2026, 8, 16, 3, 0, 0, 123));
    assert.equal(instantMilliseconds("2026-09-16T05:00:00.123456789+02:00"), base);
    assert.equal(instantMilliseconds("2026-09-15T22:00:00.123456789-05:00"), base);
    assert.equal(new Date(instantMilliseconds("0099-01-01T00:00:00Z")).getUTCFullYear(), 99);
    assert.equal(instantMilliseconds("2026-09-15T24:00:00Z"), instantMilliseconds("2026-09-16T00:00:00Z"));
    assert.throws(() => instantMilliseconds("2026-09-16T03:00:00"), { code: "UnsupportedCapability" });
    assert.throws(() => instantMilliseconds("2026-02-30T03:00:00Z"), { code: "InvalidValue" });
    assert.throws(() => instantMilliseconds("2026-09-16T03:00:00+14:01"), { code: "InvalidValue" });
});

test("event time: native clock sleeps are cancellable and reject scheduler overflow without waiting", async () => {
    const clock = eventClock(() => 7);
    assert.equal(clock.now(), 7);
    const abort = new AbortController();
    const pending = clock.sleep(60000, abort.signal);
    abort.abort();
    await assert.rejects(pending, { code: "RuntimeClosed" });
    await assert.rejects(clock.sleep(0, abort.signal), { code: "RuntimeClosed" });
    await assert.rejects(clock.sleep(2147483648, new AbortController().signal), { code: "InvalidConfiguration" });
    await clock.sleep(0, new AbortController().signal);
});
