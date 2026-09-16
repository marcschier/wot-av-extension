const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MemoryPublicationStore, JsonFilePublicationStore } = require("./.compiled/publication/state.js");
const { PublicationError } = require("./.compiled/publication/common.js");

const OWNER = "publication-owner";
const ID = "urn:publication:camera:1";
const DIGEST = "c993a08fa27df1910988f37429d582d43bae4d7a21f1f8d72ad283afbd50adae";
const producer = () => ({
    "@context": ["https://www.w3.org/2022/wot/td/v1.1"], id: ID, title: "Camera one",
    securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"]
});
const state = (revision = 1) => ({
    schemaVersion: 1, owner: OWNER, revision, inventoryRevision: 2,
    registrations: { [ID]: { deviceId: "native-device-one", producer: producer(), digest: DIGEST,
        etag: '"resource-7"', publishedAt: 1000, freshUntil: 11000, retainUntil: 31000,
        expiresAt: 30000, status: "active" } }
});
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
async function disk(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-publication-state-"));
    const file = path.join(root, "publication.json"), stores = [], failed = new Set();
    t.after(async () => {
        try {
            for (const store of stores) {
                if (failed.has(store)) await assert.rejects(store.close(), AggregateError);
                else await store.close();
            }
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
    return { root, file, failed, create(owner = OWNER, maximum) {
        const store = new JsonFilePublicationStore(owner, file, maximum);
        stores.push(store);
        return store;
    } };
}

for (const kind of ["memory", "persistent"]) {
    test(`${kind} store strictly compares same/stale/ahead revisions and isolates caller mutation`, { timeout: 20000 }, async (t) => {
        const temp = kind === "persistent" ? await disk(t) : null;
        const store = temp ? temp.create() : new MemoryPublicationStore(OWNER);
        if (!temp) t.after(() => store.close());
        assert.equal(await store.load(), null);
        const input = state(1);
        await store.save(input);
        input.registrations[ID].producer.title = "caller mutation";
        const loaded = await store.load();
        assert.equal(loaded.registrations[ID].producer.title, "Camera one");
        assert.equal(loaded.registrations[ID].digest, DIGEST);
        loaded.registrations[ID].status = "retired";
        for (const revision of [0, 1]) await assert.rejects(store.save(state(revision)), code("PublicationConflict"));
        assert.equal((await store.load()).registrations[ID].status, "active");
        await store.save(state(3));
        assert.equal((await store.load()).revision, 3);
        assert.equal((await store.load()).inventoryRevision, 2);
        if (temp) {
            const written = JSON.parse(await fs.readFile(temp.file, "utf8"));
            assert.equal(written.owner, "publication-owner");
            assert.equal(written.revision, 3);
            assert.equal(written.registrations[ID].etag, '"resource-7"');
            await store.close();
            const reopened = temp.create();
            assert.equal((await reopened.load()).revision, 3);
            await assert.rejects(reopened.save(state(3)), code("PublicationConflict"));
            assert.equal((await reopened.load()).registrations[ID].producer.id, "urn:publication:camera:1");
        }
    });
}

test("memory initial state is validated and cloned, including durable intent and diagnostic state", async (t) => {
    const input = state();
    input.registrations[ID].status = "pending";
    input.registrations[ID].failure = { code: "DirectoryTransport", at: 1001 };
    input.registrations[ID].intent = { producer: producer(), digest: DIGEST, at: 1001, freshUntil: 11000, retainUntil: 31000 };
    const store = new MemoryPublicationStore(OWNER, input);
    t.after(() => store.close());
    input.registrations[ID].intent.producer.title = "changed input";
    const restored = await store.load();
    assert.equal(restored.registrations[ID].intent.producer.title, "Camera one");
    assert.equal(restored.registrations[ID].intent.retainUntil, 31000);
    assert.deepEqual(restored.registrations[ID].failure, { code: "DirectoryTransport", at: 1001 });
    assert.throws(() => new MemoryPublicationStore("foreign-owner", state()), code("InvalidPublicationState"));
    assert.throws(() => new MemoryPublicationStore("../owner"), code("InvalidConfiguration"));
});

for (const [name, mutate] of [
    ["schema version", (value) => { value.schemaVersion = 2; }],
    ["owner", (value) => { value.owner = "another-owner"; }],
    ["negative revision", (value) => { value.revision = -1; }],
    ["fractional revision", (value) => { value.revision = 1.5; }],
    ["invalid inventory revision", (value) => { value.inventoryRevision = -2; }],
    ["registrations array", (value) => { value.registrations = []; }],
    ["producer ID mismatch", (value) => { value.registrations[ID].producer.id = "urn:other"; }],
    ["producer digest mismatch", (value) => { value.registrations[ID].digest = "a".repeat(64); }],
    ["invented status", (value) => { value.registrations[ID].status = "certified"; }],
    ["negative publication time", (value) => { value.registrations[ID].publishedAt = -1; }],
    ["fractional freshness time", (value) => { value.registrations[ID].freshUntil = 1.1; }],
    ["negative expiry", (value) => { value.registrations[ID].expiresAt = -1; }],
    ["weak resource ETag", (value) => { value.registrations[ID].etag = 'W/"resource-7"'; }],
    ["unquoted resource ETag", (value) => { value.registrations[ID].etag = "resource-7"; }],
    ["malformed failure time", (value) => { value.registrations[ID].failure = { code: "Failed", at: 1.5 }; }],
    ["negative failure time", (value) => { value.registrations[ID].failure = { code: "Failed", at: -1 }; }],
    ["durable intent digest", (value) => { value.registrations[ID].intent = { producer: producer(),
        digest: "wrong", at: 1001, freshUntil: 11000, retainUntil: 31000 }; }],
    ["durable intent time", (value) => { value.registrations[ID].intent = { producer: producer(),
        digest: DIGEST, at: -1, freshUntil: 11000, retainUntil: 31000 }; }]
]) {
    test(`state rejects invalid ${name} without advancing the stored revision`, async (t) => {
        const store = new MemoryPublicationStore(OWNER, state(1));
        t.after(() => store.close());
        const invalid = state(2);
        mutate(invalid);
        await assert.rejects(store.save(invalid), code("InvalidPublicationState"));
        const preserved = await store.load();
        assert.equal(preserved.revision, 1);
        assert.equal(preserved.registrations[ID].producer.title, "Camera one");
        assert.equal(preserved.registrations[ID].digest, DIGEST);
    });
}

test("persistent state restores complete crash intent, preserves tombstone identity and retains a real single-writer lock", { timeout: 20000 }, async (t) => {
    const temp = await disk(t), writer = temp.create();
    const input = state(4);
    input.registrations[ID].status = "pending";
    input.registrations[ID].intent = { producer: producer(), digest: DIGEST, at: 1200, freshUntil: 11200, retainUntil: 31200 };
    await writer.save(input);
    const competitor = temp.create();
    temp.failed.add(competitor);
    await assert.rejects(competitor.load(), { code: "EEXIST" });
    await assert.rejects(competitor.close(), AggregateError);
    assert.equal(await fs.readFile(`${temp.file}.lock`, "utf8"), "ONVIF publication single-writer lock\n");
    await writer.close();
    assert.deepEqual(await fs.readdir(temp.root), ["publication.json"]);
    const reopened = temp.create();
    const loaded = await reopened.load();
    assert.deepEqual(loaded.registrations[ID].intent, {
        producer: producer(), digest: DIGEST, at: 1200, freshUntil: 11200, retainUntil: 31200
    });
    loaded.revision = 5;
    loaded.registrations[ID].status = "retired";
    delete loaded.registrations[ID].intent;
    await reopened.save(loaded);
    const bytes = JSON.parse(await fs.readFile(temp.file, "utf8"));
    assert.equal(bytes.registrations[ID].status, "retired");
    assert.equal(bytes.registrations[ID].deviceId, "native-device-one");
    assert.equal(bytes.registrations[ID].intent, undefined);
    assert.equal(bytes.revision, 5);
});

for (const [label, bytes, expected] of [
    ["foreign owner", JSON.stringify({ ...state(), owner: "other-owner" }), code("InvalidPublicationState")],
    ["unsupported version", JSON.stringify({ ...state(), schemaVersion: 2 }), code("InvalidPublicationState")],
    ["invalid digest", JSON.stringify({ ...state(), registrations: { [ID]: { ...state().registrations[ID], digest: "wrong" } } }),
        code("InvalidPublicationState")],
    ["corrupt JSON", "{not-json", SyntaxError]
]) {
    test(`persistent state rejects ${label}, not empty-success or unrelated-file overwrite`, { timeout: 20000 }, async (t) => {
        const temp = await disk(t);
        await fs.writeFile(temp.file, bytes, { mode: 0o600 });
        const store = temp.create();
        temp.failed.add(store);
        await assert.rejects(store.load(), expected);
        assert.equal(await fs.readFile(temp.file, "utf8"), bytes);
        await assert.rejects(store.close(), AggregateError);
        assert.deepEqual(await fs.readdir(temp.root), ["publication.json"]);
    });
}

test("persistent byte limit rejects an oversized existing state and preserves its bytes", { timeout: 20000 }, async (t) => {
    const temp = await disk(t);
    const bytes = JSON.stringify(state());
    await fs.writeFile(temp.file, bytes, { mode: 0o600 });
    const store = temp.create(OWNER, 4);
    temp.failed.add(store);
    await assert.rejects(store.load(), code("FileOwnership"));
    assert.equal(await fs.readFile(temp.file, "utf8"), bytes);
});

for (const kind of ["memory", "persistent empty", "persistent populated"]) {
    test(`${kind} store rejects load and save after close with RuntimeClosed`, { timeout: 20000 }, async (t) => {
        const temp = kind.startsWith("persistent") ? await disk(t) : null;
        const store = temp ? temp.create() : new MemoryPublicationStore(OWNER);
        if (!temp) t.after(() => store.close());
        if (kind !== "persistent empty") await store.save(state());
        else assert.equal(await store.load(), null);
        await store.close();
        await assert.rejects(store.load(), code("RuntimeClosed"));
        await assert.rejects(store.save(state(2)), code("RuntimeClosed"));
        if (temp && kind === "persistent populated") {
            assert.equal(JSON.parse(await fs.readFile(temp.file, "utf8")).revision, 1);
        }
    });
}
