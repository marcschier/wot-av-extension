const test = require("node:test");
const assert = require("node:assert/strict");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("../../../fixtures/reference-runtime/publication/directory.cjs");

const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
async function setup(t, list = {}) {
    const fixture = await directory({ now: () => 1700000000000 });
    fixture.contract.verification = { mode: "attested", evidence: "Owned pagination fixture" };
    fixture.contract.list = { format: "array", pageSize: 2, maxPages: 8, maxItems: 20,
        collectionRevision: "canonical-link", maxRestarts: 0, ...list };
    const client = new DirectoryClient({ ...fixture.clientOptions(), maxReadRetries: 0 });
    t.after(async () => { try { await client.close(); } finally { await fixture.close(); } });
    return { fixture, client };
}
function seed(fixture, ids = ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"]) {
    for (const id of ids) fixture.set(id, td(id, { title: `Listed ${id}` }));
}

for (const [name, ids, expectedPaths] of [
    ["empty", [], ["/things?limit=2&offset=0"]],
    ["singleton", ["urn:item:a"], ["/things?limit=2&offset=0"]],
    ["exact page", ["urn:item:a", "urn:item:b"], ["/things?limit=2&offset=0"]],
    ["page plus one", ["urn:item:a", "urn:item:b", "urn:item:c"], ["/things?limit=2&offset=0", "/things?limit=2&offset=2"]],
    ["exact two pages", ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"], ["/things?limit=2&offset=0", "/things?limit=2&offset=2"]]
]) {
    test(`list returns concrete ordered unique TDs for ${name} rather than a partial/empty success`, async (t) => {
        const { fixture, client } = await setup(t);
        seed(fixture, ids);
        const listed = await client.list();
        assert.deepEqual(listed.map((value) => value.id), ids);
        assert.deepEqual(fixture.audit.map((entry) => entry.path), expectedPaths);
        if (ids.length) {
            assert.equal(listed[0].title, "Listed urn:item:a");
            listed[0].title = "caller mutation";
            assert.equal(fixture.records.get("urn:item:a").td.title, "Listed urn:item:a");
        }
        assert.equal(client.pendingRequests, 0);
    });
}

test("list uses Unicode code-point ordering, including prefix and supplementary-plane boundaries", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture, ["urn:id:\u{1f600}", "urn:id:z", "urn:id:\ue000", "urn:id", "urn:id:"]);
    assert.deepEqual((await client.list()).map((value) => value.id),
        ["urn:id", "urn:id:", "urn:id:z", "urn:id:\ue000", "urn:id:\u{1f600}"]);
    assert.deepEqual(fixture.audit.map((entry) => entry.path),
        ["/things?limit=2&offset=0", "/things?limit=2&offset=2", "/things?limit=2&offset=4"]);
});

test("exact page and item budgets succeed but their immediately adjacent overflows reject incomplete results", async (t) => {
    const { fixture, client } = await setup(t, { maxPages: 2, maxItems: 4 });
    seed(fixture);
    assert.deepEqual((await client.list()).map((value) => value.id), ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"]);
    const pageLimited = new DirectoryClient({ ...fixture.clientOptions(), contract: {
        ...fixture.contract, list: { ...fixture.contract.list, maxPages: 1 }
    } });
    const itemLimited = new DirectoryClient({ ...fixture.clientOptions(), contract: {
        ...fixture.contract, list: { ...fixture.contract.list, maxItems: 3 }
    } });
    t.after(async () => { await pageLimited.close(); await itemLimited.close(); });
    let start = fixture.audit.length;
    await assert.rejects(pageLimited.list(), code("PublicationLimit"));
    assert.equal(fixture.audit.length - start, 1);
    start = fixture.audit.length;
    await assert.rejects(itemLimited.list(), code("PublicationLimit"));
    assert.equal(fixture.audit.length - start, 2);
    assert.equal(fixture.records.size, 4);
});

test("an overfull page is rejected even if the total-item budget would allow all entries", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture, ["urn:item:a", "urn:item:b", "urn:item:c"]);
    fixture.behavior.ignoreLimits = true;
    await assert.rejects(client.list(), code("PublicationLimit"));
    assert.deepEqual(fixture.audit.map((entry) => entry.path), ["/things?limit=2&offset=0"]);
    assert.equal(fixture.records.size, 3);
});

test("canonical collection revision changes restart from the beginning once, not from a resource HTTP ETag", async (t) => {
    const { fixture, client } = await setup(t, { maxRestarts: 1 });
    seed(fixture);
    let calls = 0;
    fixture.behavior.listRevision = () => ++calls === 1 ? "before" : "after";
    assert.deepEqual((await client.list()).map((value) => value.id), ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"]);
    assert.deepEqual(fixture.audit.map((entry) => entry.path), [
        "/things?limit=2&offset=0", "/things?limit=2&offset=2", "/things?limit=2&offset=0", "/things?limit=2&offset=2"
    ]);
    assert.equal(calls, 4);
    assert.equal(fixture.records.get("urn:item:a").etag, '"resource-1"');
});

for (const maxRestarts of [0, 1, 3]) {
    test(`continuously changing collection exhausts the declared ${maxRestarts}-restart budget with CollectionChanged`, async (t) => {
        const { fixture, client } = await setup(t, { maxRestarts });
        seed(fixture);
        let revision = 0;
        fixture.behavior.listRevision = () => `revision-${++revision}`;
        await assert.rejects(client.list(), code("CollectionChanged"));
        assert.equal(fixture.audit.length, (maxRestarts + 1) * 2);
        assert.equal(fixture.records.size, 4);
        assert.equal(client.pendingRequests, 0);
    });
}

test("explicit no-collection-revision mode still enforces ordering and bounds without inventing a resource revision", async (t) => {
    const { fixture, client } = await setup(t, { collectionRevision: "none" });
    seed(fixture);
    let revision = 0;
    fixture.behavior.listRevision = () => String(++revision);
    assert.deepEqual((await client.list()).map((value) => value.id), ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"]);
    assert.equal(revision, 2);
    assert.equal((await client.get("urn:item:a")).etag, '"resource-1"');
});

test("HTTP collection ETag and canonical collection token never authorize a resource write", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture, ["urn:item:a", "urn:item:b", "urn:item:c"]);
    await client.list();
    const record = await client.get("urn:item:a");
    assert.equal(record.etag, '"resource-1"');
    for (const token of ['"collection-http-3"', '"3"']) {
        await assert.rejects(client.put(td("urn:item:a", { title: "Must not be written" }), { etag: token }), code("DirectoryConflict"));
        assert.equal(fixture.records.get("urn:item:a").td.title, "Listed urn:item:a");
    }
    await client.put(td("urn:item:a", { title: "Resource-CAS update" }), { etag: record.etag });
    assert.equal(fixture.records.get("urn:item:a").td.title, "Resource-CAS update");
    assert.equal(fixture.records.get("urn:item:a").etag, '"resource-4"');
    assert.deepEqual(fixture.audit.filter((entry) => entry.method === "PUT").map((entry) => entry.ifMatch),
        ['"collection-http-3"', '"3"', '"resource-1"']);
});

for (const [name, make] of [
    ["another path", () => "/other?limit=2&offset=2"],
    ["a resource subpath", () => "/things/subpath?limit=2&offset=2"],
    ["encoded ambiguous path", () => "/%74hings?limit=2&offset=2"],
    ["different limit", () => "/things?limit=1&offset=2"],
    ["missing limit", () => "/things?offset=2"],
    ["missing offset", () => "/things?limit=2"],
    ["nonprogressive offset", () => "/things?limit=2&offset=0"],
    ["negative offset", () => "/things?limit=2&offset=-1"],
    ["fractional offset", () => "/things?limit=2&offset=2.5"],
    ["unbounded offset", () => "/things?limit=2&offset=9007199254740992"],
    ["duplicate offset", () => "/things?limit=2&offset=2&offset=4"],
    ["duplicate limit", () => "/things?limit=2&limit=2&offset=2"],
    ["unnegotiated query parameter", () => "/things?limit=2&offset=2&cursor=undeclared"],
    ["fragment", () => "/things?limit=2&offset=2#fragment"]
]) {
    test(`pagination refuses ${name} before following its next link`, async (t) => {
        const { fixture, client } = await setup(t);
        seed(fixture);
        fixture.behavior.nextLink = make;
        await assert.rejects(client.list(), code("PolicyDenied"));
        assert.deepEqual(fixture.audit.map((entry) => entry.path), ["/things?limit=2&offset=0"]);
        assert.equal(fixture.records.size, 4);
    });
}

test("a next link to another owned origin is rejected without forwarding Directory bearer credentials", async (t) => {
    const { fixture, client } = await setup(t);
    const other = await directory();
    t.after(() => other.close());
    seed(fixture);
    fixture.behavior.nextLink = () => `${other.collectionUrl}?limit=2&offset=2`;
    await assert.rejects(client.list(), code("PolicyDenied"));
    assert.deepEqual(other.audit, []);
    assert.deepEqual(fixture.audit.map((entry) => entry.role), ["writer"]);
    assert.equal(fixture.records.size, 4);
});

test("an explicitly negotiated additional query parameter is carried only on the same collection path", async (t) => {
    const { fixture, client } = await setup(t, { additionalParameters: ["cursor"] });
    seed(fixture);
    fixture.behavior.nextLink = ({ offset }) => offset === 0 ? "/things?limit=2&offset=2&cursor=opaque-A" : undefined;
    assert.deepEqual((await client.list()).map((value) => value.id), ["urn:item:a", "urn:item:b", "urn:item:c", "urn:item:d"]);
    assert.deepEqual(fixture.audit.map((entry) => entry.path), ["/things?limit=2&offset=0", "/things?limit=2&offset=2&cursor=opaque-A"]);
});

test("repeated next-page link is stopped after one advance rather than looping or returning an incomplete prefix", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture);
    fixture.behavior.nextLink = () => "/things?limit=2&offset=2";
    await assert.rejects(client.list(), code("PolicyDenied"));
    assert.deepEqual(fixture.audit.map((entry) => entry.path), ["/things?limit=2&offset=0", "/things?limit=2&offset=2"]);
});

test("ambiguous next links are rejected instead of choosing an arbitrary page", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture);
    fixture.behavior.nextLink = () => '/things?limit=2&offset=2>; rel="next", </things?limit=2&offset=4';
    await assert.rejects(client.list(), code("InvalidDirectoryResponse"));
    assert.equal(fixture.audit.length, 1);
    assert.equal(fixture.records.size, 4);
});

for (const [name, next] of [
    ["malformed link target", "/things<bad"],
    ["duplicate Link relation parameter", '/things?limit=2&offset=2>; rel="next"; rel="next", </unused']
]) {
    test(`pagination rejects ${name} before issuing another request`, async (t) => {
        const { fixture, client } = await setup(t);
        seed(fixture);
        fixture.behavior.nextLink = () => next;
        await assert.rejects(client.list(), code("InvalidDirectoryResponse"));
        assert.equal(fixture.audit.length, 1);
    });
}

test("missing canonical revision is not replaced by the collection HTTP ETag", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture);
    fixture.behavior.listRevision = () => "";
    await assert.rejects(client.list(), code("InvalidDirectoryResponse"));
    assert.equal(fixture.audit.length, 1);
    assert.equal(fixture.records.get("urn:item:a").etag, '"resource-1"');
});

for (const [name, ids] of [
    ["duplicate IDs", ["urn:td:duplicate", "urn:td:duplicate"]],
    ["out-of-order IDs", ["urn:td:z", "urn:td:a"]]
]) {
    test(`pagination rejects ${name} in the body even if the collection revision is stable`, async (t) => {
        const { fixture, client } = await setup(t);
        fixture.set("urn:sort:a", td(ids[0]));
        fixture.set("urn:sort:b", td(ids[1]));
        await assert.rejects(client.list(), code("CollectionChanged"));
        assert.equal(fixture.audit.length, 1);
        assert.equal(fixture.records.size, 2);
    });
}

test("unnegotiated pagination and a next link on an empty page are explicit incomplete-list errors", async (t) => {
    const { fixture, client } = await setup(t, { pageSize: undefined });
    seed(fixture);
    fixture.behavior.nextLink = () => "/things?limit=2&offset=2";
    await assert.rejects(client.list(), code("InvalidDirectoryResponse"));
    assert.deepEqual(fixture.audit.map((entry) => entry.path), ["/things"]);
    const empty = await directory();
    const emptyClient = new DirectoryClient(empty.clientOptions());
    t.after(async () => { await emptyClient.close(); await empty.close(); });
    empty.behavior.nextLink = () => "/things?limit=2&offset=2";
    await assert.rejects(emptyClient.list(), code("InvalidDirectoryResponse"));
    assert.equal(empty.audit.length, 1);
});

test("unbounded Link response is rejected by the finite transport rather than returned as an empty list", async (t) => {
    const { fixture, client } = await setup(t);
    seed(fixture);
    fixture.behavior.nextLink = () => "/things?limit=2&offset=2&padding=" + "a".repeat(17000);
    await assert.rejects(client.list(), code("DirectoryTransport"));
    assert.equal(fixture.audit.length, 1);
    assert.equal(client.pendingRequests, 0);
    assert.equal(fixture.records.size, 4);
});
