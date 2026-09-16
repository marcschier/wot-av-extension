const test = require("node:test");
const assert = require("node:assert/strict");
const {
    DISCOVERY_CONTEXT, PublicationError, contextEntries, contextValue, boundedInteger,
    httpUrl, assertThingDescription, producerContent, producerDigest, matchesProducer,
    mergeProducer, errorCode, isMissing, assertOwner
} = require("./.compiled/publication/common.js");

const TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1";
const DISCOVERY = "https://www.w3.org/2022/wot/discovery";
const camera = () => ({
    "@context": [TD_CONTEXT], id: "urn:publication:camera:1", title: "Camera one",
    securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"]
});
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;

test("PublicationError and error helpers preserve typed status/retry metadata without trusting plain objects", () => {
    const failure = new PublicationError("DirectoryDenied", "writer denied", 403, true);
    assert.equal(failure.name, "PublicationError");
    assert.equal(failure.message, "writer denied");
    assert.equal(failure.status, 403);
    assert.equal(failure.retryable, true);
    assert.equal(errorCode(failure), "DirectoryDenied");
    const defaults = new PublicationError("LocalFailure", "local");
    assert.equal(defaults.status, undefined);
    assert.equal(defaults.retryable, false);
    for (const value of [null, "ENOENT", { code: "ENOENT" }, new Error("ENOENT"), Object.assign(new Error(), { code: 7 })]) {
        assert.equal(errorCode(value), "PublicationFailure");
        assert.equal(isMissing(value), false);
    }
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    assert.equal(errorCode(missing), "ENOENT");
    assert.equal(isMissing(missing), true);
    assert.equal(isMissing(Object.assign(new Error(), { code: "EACCES" })), false);
});

test("context conversion supports both WoT Recommendation roots and copies the context list", () => {
    assert.equal(DISCOVERY_CONTEXT, DISCOVERY);
    assert.deepEqual(contextEntries({ "@context": TD_CONTEXT }), [TD_CONTEXT]);
    const entries = [TD_CONTEXT, { local: "urn:local:" }];
    const converted = contextValue(entries);
    assert.deepEqual(converted, [TD_CONTEXT, { local: "urn:local:" }]);
    assert.notEqual(converted, entries);
    assert.deepEqual(contextValue(["https://www.w3.org/2019/wot/td/v1", "urn:extra:context"]),
        ["https://www.w3.org/2019/wot/td/v1", "urn:extra:context"]);
    const source = { "@context": entries };
    contextEntries(source).push("urn:later:context");
    assert.equal(source["@context"].length, 2);
    for (const invalid of [[], ["urn:unsupported"], [{ local: "urn:local:" }, TD_CONTEXT]]) {
        assert.throws(() => contextValue(invalid), code("InvalidDirectoryResponse"));
    }
});

test("boundedInteger accepts exact inclusive bounds and rejects every noninteger/outside partition", () => {
    assert.equal(boundedInteger(1, "limit", 4), 1);
    assert.equal(boundedInteger(3, "limit", 4), 3);
    assert.equal(boundedInteger(4, "limit", 4), 4);
    assert.equal(boundedInteger(2147483647, "limit"), 2147483647);
    for (const value of [0, -1, 1.5, 5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "2"]) {
        assert.throws(() => boundedInteger(value, "limit", 4), code("InvalidConfiguration"), String(value));
    }
    assert.throws(() => boundedInteger(2147483648, "limit"), code("InvalidConfiguration"));
});

test("owner validation admits one and 128 safe characters but rejects invalid lengths and shapes", () => {
    for (const owner of ["A", "publisher.A_1-2:3", "a".repeat(128)]) assert.doesNotThrow(() => assertOwner(owner));
    for (const owner of ["", "a".repeat(129), ".leading", "a/b", "a\\b", "a b", "a\nb", null, 1]) {
        assert.throws(() => assertOwner(owner), code("InvalidConfiguration"), String(owner));
    }
});

test("httpUrl returns canonical HTTP(S) URLs but rejects credentials, fragments, whitespace and other schemes", () => {
    assert.equal(httpUrl("https://EXAMPLE.invalid:443/models/a?edition=1").href, "https://example.invalid/models/a?edition=1");
    assert.equal(httpUrl("http://127.0.0.1:1234/things").origin, "http://127.0.0.1:1234");
    for (const value of ["file:///private", "ftp://example.invalid/", "https://user:pw@example.invalid/",
        "https://example.invalid/a#part", "https://example.invalid/a#", "https://example.invalid/a b", "https://example.invalid\\a",
        " https://example.invalid/", "https://example.invalid/\n"]) {
        assert.throws(() => httpUrl(value), code("PolicyDenied"), value);
    }
    for (const value of ["relative/path", "not a URL"]) assert.throws(() => httpUrl(value), code("InvalidConfiguration"));
});

test("assertThingDescription accepts a complete concrete TD without modifying security or native forms", () => {
    const input = { ...camera(), actions: { read: { forms: [{ href: "http://camera.invalid/onvif", op: "invokeaction" }] } } };
    const before = structuredClone(input);
    assert.doesNotThrow(() => assertThingDescription(input));
    assert.deepEqual(input, before);
    assert.equal(input.actions.read.forms[0].href, "http://camera.invalid/onvif");
});

for (const [name, make] of [
    ["query fragment", () => ({ id: "urn:publication:camera:1" })],
    ["relative ID", () => ({ ...camera(), id: "camera/1" })],
    ["array root", () => [camera()]],
    ["missing security definitions", () => { const value = camera(); delete value.securityDefinitions; return value; }],
    ["nonstring title", () => ({ ...camera(), title: 4 })],
    ["malformed security references", () => ({ ...camera(), security: [42] })],
    ["unknown security reference", () => ({ ...camera(), security: ["not-defined"] })],
    ["non-context value", () => ({ ...camera(), "@context": 4 })],
    ["malformed properties", () => ({ ...camera(), properties: "not-an-affordance-map" })],
    ["malformed native forms", () => ({ ...camera(), actions: { read: { forms: [{ href: 42 }] } } })]
]) {
    test(`assertThingDescription rejects ${name} rather than accepting an incomplete TD`, () => {
        assert.throws(() => assertThingDescription(make()), code("InvalidDirectoryResponse"));
    });
}

test("producerContent removes only registration and the known Discovery context while keeping exact native evidence", () => {
    const original = { ...camera(), "@context": [TD_CONTEXT, DISCOVERY, { native: "urn:native:" }],
        registration: { ttl: 30, created: "2026-01-01T00:00:00Z" },
        evidence: { outcome: "denied", source: "http://camera.invalid/exact?x=1" } };
    const before = structuredClone(original);
    const content = producerContent(original);
    assert.deepEqual(content, { ...camera(), "@context": [TD_CONTEXT, { native: "urn:native:" }],
        evidence: { outcome: "denied", source: "http://camera.invalid/exact?x=1" } });
    content.evidence.outcome = "changed by caller";
    assert.deepEqual(original, before);
    assert.deepEqual(producerContent({ ...camera(), "@context": TD_CONTEXT }), { ...camera(), "@context": TD_CONTEXT });
});

test("producerDigest pins canonical content to an independent SHA256 and excludes only registration augmentation", () => {
    const expected = "c993a08fa27df1910988f37429d582d43bae4d7a21f1f8d72ad283afbd50adae";
    assert.equal(producerDigest(camera()), expected);
    const reordered = { title: "Camera one", security: ["none"], securityDefinitions: { none: { scheme: "nosec" } },
        id: "urn:publication:camera:1", "@context": [TD_CONTEXT, DISCOVERY], registration: { ttl: 19 } };
    assert.equal(producerDigest(reordered), expected);
    assert.notEqual(producerDigest({ ...camera(), title: "A different producer title" }), expected);
    assert.notEqual(producerDigest({ ...camera(), additional: true }), expected);
});

test("matchesProducer accepts exact content and only registration/known Discovery augmentation", () => {
    assert.equal(matchesProducer(camera(), camera()), true);
    assert.equal(matchesProducer({ ...camera(), "@context": [TD_CONTEXT, DISCOVERY], registration: { ttl: 20 } }, camera()), true);
    assert.equal(matchesProducer(camera(), { ...camera(), registration: { ttl: 9 } }), true);
});

for (const [name, mutate] of [
    ["independently added producer field", (value) => { value.unrelated = "not ours"; }],
    ["changed title", (value) => { value.title = "Another writer"; }],
    ["deleted title", (value) => { delete value.title; }],
    ["changed security scheme", (value) => { value.securityDefinitions.none.scheme = "basic"; }],
    ["extra nested security content", (value) => { value.securityDefinitions.none.description = "Another writer"; }],
    ["extra non-Discovery context", (value) => { value["@context"].push("urn:another-writer:context"); }],
    ["duplicate producer context", (value) => { value["@context"].push({ local: "urn:local:" }); }],
    ["reordered producer contexts", (value) => { [value["@context"][1], value["@context"][2]] = [value["@context"][2], value["@context"][1]]; }],
    ["changed inline context", (value) => { value["@context"][1].local = "urn:changed:"; }],
    ["deleted producer context", (value) => { value["@context"].pop(); }]
]) {
    test(`matchesProducer rejects ${name} before ownership can authorize overwrite`, () => {
        const expected = { ...camera(), "@context": [TD_CONTEXT, { local: "urn:local:" }, "urn:ordered:context"] };
        const actual = structuredClone(expected);
        mutate(actual);
        const before = structuredClone(actual);
        assert.equal(matchesProducer(actual, expected), false);
        assert.deepEqual(actual, before);
        assert.equal(expected.title, "Camera one");
    });
}

test("mergeProducer replaces and removes previously owned fields, retains unrelated context, and detaches inputs", () => {
    const previous = { ...camera(), "@context": [TD_CONTEXT, "urn:old:context"], description: "old description" };
    const remote = { ...previous, "@context": [TD_CONTEXT, "urn:old:context", DISCOVERY, { third: "urn:third:" }],
        registration: { ttl: 10 }, independent: { note: "retained but not an ownership grant" } };
    const desired = { ...camera(), title: "New title", "@context": [TD_CONTEXT, "urn:new:context"] };
    const originals = structuredClone([remote, previous, desired]);
    const merged = mergeProducer(remote, previous, desired);
    assert.deepEqual(merged, { ...camera(), title: "New title",
        "@context": [TD_CONTEXT, "urn:new:context", { third: "urn:third:" }],
        independent: { note: "retained but not an ownership grant" } });
    merged.independent.note = "caller mutation";
    assert.deepEqual([remote, previous, desired], originals);
    assert.deepEqual(mergeProducer(null, undefined, desired), desired);
    assert.deepEqual(mergeProducer(null, undefined, { ...camera(), "@context": TD_CONTEXT }),
        { ...camera(), "@context": TD_CONTEXT });
});
