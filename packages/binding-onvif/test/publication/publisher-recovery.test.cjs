const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DirectoryPublisher, PublicationBatchError } = require("./.compiled/publication/publisher.js");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { JsonFilePublicationStore } = require("./.compiled/publication/state.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("./fixtures/directory.cjs");

const NOW = 1700000000000, ID = "urn:recovery:camera", OWNER = "recovery-owner";
function publication(revision = 1, title = "Recovered camera", observedAt = NOW) {
    return { inventoryRevision: revision, capturedAt: NOW, documents: [], modelUrls: [],
        things: [{ deviceId: "native-recovery-device", observedAt, quarantined: false,
            td: td(ID, { title, "directory:annotation": "Directory-owned enrichment",
                "onvif:registryDigest": "registry-pin", "onvif:requirementsDigest": "requirements-pin",
                "onvif:discovery": { state: "verified", seenAt: NOW } }) }] };
}
const batch = (expected, action = "failed") => (error) => {
    assert.equal(error instanceof PublicationBatchError, true);
    assert.deepEqual(error.report.changes, [{ id: ID, action, code: expected }]);
    assert.equal(error.errors[0].code, expected);
    return true;
};
function forwarding(client, afterPut) {
    // Full public collaborator facade, not a private spy or replacement of a SUT method.
    return {
        contract: client.contract, collectionUrl: client.collectionUrl,
        get pendingRequests() { return client.pendingRequests; },
        resourceUrl: (id) => client.resourceUrl(id),
        preflight: () => client.preflight(), get: (id) => client.get(id),
        list: () => client.list(), find: (filter) => client.find(filter),
        async put(value, condition, ttl) { await client.put(value, condition, ttl); await afterPut(value); },
        renew: (id, condition, ttl) => client.renew(id, condition, ttl),
        delete: (id, condition) => client.delete(id, condition), close: () => client.close()
    };
}
async function setup(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-publication-recovery-"));
    const file = path.join(root, "publication.json"), clock = { now: NOW }, publishers = [];
    const fixture = await directory({ now: () => clock.now + (options.serverOffset ?? 0) });
    fixture.contract.verification = { mode: "attested", evidence: "Owned stateful fixture; no preflight write noise" };
    t.after(async () => {
        const closed = await Promise.allSettled(publishers.map((publisher) => publisher.close()));
        try { await fixture.close(); }
        finally { await fs.rm(root, { recursive: true, force: true }); }
        assert.deepEqual(closed.filter((result) => result.status === "rejected"), [], "All independently owned resources close naturally");
    });
    return {
        root, file, clock, fixture,
        open(afterPut) {
            const client = new DirectoryClient(fixture.clientOptions());
            const store = new JsonFilePublicationStore(OWNER, file);
            const models = { baseUrl: "https://models.invalid/site/", async publish() {}, async close() {} };
            const publisher = new DirectoryPublisher({ owner: OWNER,
                directory: afterPut ? forwarding(client, afterPut) : client, state: store, models,
                policy: { freshMs: 10000, graceMs: 20000, renewBeforeMs: 5000 }, now: () => clock.now });
            publishers.push(publisher);
            return { publisher, client, store };
        }
    };
}

test("durable creation intent reaches disk before HTTP mutation and a lost acknowledgement recovers without a duplicate PUT", { timeout: 20000 }, async (t) => {
    const context = await setup(t);
    let verifiedIntent = false, loseAck = true;
    context.fixture.behavior.beforeWrite = async ({ request, id, records }) => {
        if (request.method !== "PUT") return;
        const disk = JSON.parse(await fs.readFile(context.file, "utf8"));
        assert.equal(disk.schemaVersion, 1);
        assert.equal(disk.owner, "recovery-owner");
        assert.equal(disk.revision, 1);
        assert.equal(disk.inventoryRevision, -1);
        assert.equal(disk.registrations[ID].status, "pending");
        assert.equal(disk.registrations[ID].publishedAt, 0);
        assert.equal(disk.registrations[ID].intent.producer.title, "Recovered camera");
        assert.equal(disk.registrations[ID].intent.producer.id, "urn:recovery:camera");
        assert.equal(disk.registrations[ID].intent.at, NOW);
        assert.equal(disk.registrations[ID].intent.freshUntil, NOW + 10000);
        assert.equal(disk.registrations[ID].intent.retainUntil, NOW + 30000);
        assert.equal(records.has(id), false);
        verifiedIntent = true;
    };
    const first = context.open(async () => {
        if (loseAck) { loseAck = false; throw new PublicationError("DirectoryTransport", "Write was applied; acknowledgement was lost"); }
    });
    await assert.rejects(first.publisher.reconcile(publication()), batch("DirectoryTransport"));
    assert.equal(verifiedIntent, true);
    assert.equal(context.fixture.records.get(ID).td.title, "Recovered camera");
    assert.equal(context.fixture.records.get(ID).etag, '"resource-1"');
    let saved = JSON.parse(await fs.readFile(context.file, "utf8"));
    assert.equal(saved.revision, 3);
    assert.equal(saved.registrations[ID].status, "pending");
    assert.deepEqual(saved.registrations[ID].failure, { code: "DirectoryTransport", at: NOW });
    await first.publisher.close();
    assert.deepEqual(await fs.readdir(context.root), ["publication.json"]);
    context.fixture.behavior.beforeWrite = undefined;
    const auditStart = context.fixture.audit.length;
    const restarted = context.open();
    assert.deepEqual(await restarted.publisher.reconcile(publication()), {
        inventoryRevision: 1, publicationRevision: 5, changes: [{ id: ID, action: "unchanged" }]
    });
    assert.equal(context.fixture.audit.slice(auditStart).some((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method)), false);
    assert.deepEqual([...context.fixture.records.keys()], [ID]);
    saved = JSON.parse(await fs.readFile(context.file, "utf8"));
    assert.equal(saved.registrations[ID].intent, undefined);
    assert.equal(saved.registrations[ID].failure, undefined);
    assert.equal(saved.registrations[ID].status, "active");
    assert.equal(saved.registrations[ID].etag, '"resource-1"');
    assert.equal(saved.registrations[ID].publishedAt, NOW);
    assert.equal(saved.registrations[ID].producer.version.model, "registry-pin.requirements-pin");
    assert.equal(saved.registrations[ID].producer["onvif:publication"].lastConfirmedAt, NOW);
});

test("a write rejected before application retains intent and safely creates the same ID after restart, without an automatic write retry", { timeout: 20000 }, async (t) => {
    const context = await setup(t), first = context.open();
    context.fixture.behavior.nextWriteStatus = 503;
    await assert.rejects(first.publisher.reconcile(publication()), batch("DirectoryResponse"));
    assert.equal(context.fixture.records.size, 0);
    assert.equal(context.fixture.audit.filter((entry) => entry.method === "PUT").length, 1);
    const intent = JSON.parse(await fs.readFile(context.file, "utf8")).registrations[ID].intent;
    assert.equal(intent.producer.id, ID);
    assert.equal(intent.retainUntil, NOW + 30000);
    await first.publisher.close();
    const restarted = context.open();
    assert.deepEqual(await restarted.publisher.reconcile(publication()), {
        inventoryRevision: 1, publicationRevision: 6, changes: [{ id: ID, action: "created" }]
    });
    assert.deepEqual([...context.fixture.records.keys()], [ID]);
    assert.equal(context.fixture.records.get(ID).td.title, "Recovered camera");
    assert.equal(context.fixture.audit.filter((entry) => entry.method === "PUT").length, 2);
    assert.equal(context.fixture.audit.filter((entry) => entry.method === "PUT").at(-1).ifNoneMatch, "*");
    assert.equal(restarted.publisher.snapshot().registrations[ID].intent, undefined);
});

test("durable update intent is distinct from the previous producer and recovers the new remote revision without replaying replacement", { timeout: 20000 }, async (t) => {
    const context = await setup(t);
    let writes = 0;
    const first = context.open(async () => {
        if (++writes === 2) throw new PublicationError("DirectoryTransport", "Update applied; acknowledgement lost");
    });
    await first.publisher.reconcile(publication());
    await assert.rejects(first.publisher.reconcile(publication(2, "Recovered update")), batch("DirectoryTransport"));
    const interrupted = JSON.parse(await fs.readFile(context.file, "utf8"));
    assert.equal(interrupted.revision, 6);
    assert.equal(interrupted.registrations[ID].producer.title, "Recovered camera");
    assert.equal(interrupted.registrations[ID].intent.producer.title, "Recovered update");
    assert.notEqual(interrupted.registrations[ID].digest, interrupted.registrations[ID].intent.digest);
    assert.equal(context.fixture.records.get(ID).td.title, "Recovered update");
    await first.publisher.close();
    const auditStart = context.fixture.audit.length;
    const restarted = context.open();
    assert.deepEqual(await restarted.publisher.reconcile(publication(2, "Recovered update")), {
        inventoryRevision: 2, publicationRevision: 8, changes: [{ id: ID, action: "unchanged" }]
    });
    const recovered = JSON.parse(await fs.readFile(context.file, "utf8"));
    assert.equal(recovered.registrations[ID].producer.title, "Recovered update");
    assert.equal(recovered.registrations[ID].etag, '"resource-2"');
    assert.equal(recovered.registrations[ID].intent, undefined);
    assert.equal(recovered.registrations[ID].failure, undefined);
    assert.equal(context.fixture.audit.slice(auditStart).some((entry) => entry.method === "PUT"), false);
    assert.equal(context.fixture.records.size, 1);
});

for (const mutation of ["changed title", "independently added field"]) {
    test(`crash recovery rejects ${mutation} instead of treating durable intent as blanket authority`, { timeout: 20000 }, async (t) => {
        const context = await setup(t);
        const first = context.open(async () => { throw new PublicationError("DirectoryTransport", "Applied but unacknowledged"); });
        await assert.rejects(first.publisher.reconcile(publication()), batch("DirectoryTransport"));
        await first.publisher.close();
        const current = context.fixture.records.get(ID);
        const changed = mutation === "changed title" ? { ...current.td, title: "Independent owner" }
            : { ...current.td, independent: { writer: "external", revision: 9 } };
        context.fixture.set(ID, changed, current);
        const auditStart = context.fixture.audit.length;
        const restarted = context.open();
        await assert.rejects(restarted.publisher.reconcile(publication()), batch("DirectoryConflict", "conflict"));
        assert.equal(context.fixture.records.get(ID).etag, '"resource-2"');
        if (mutation === "changed title") assert.equal(context.fixture.records.get(ID).td.title, "Independent owner");
        else assert.deepEqual(context.fixture.records.get(ID).td.independent, { writer: "external", revision: 9 });
        assert.equal(context.fixture.audit.slice(auditStart).some((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method)), false);
        assert.equal(restarted.publisher.snapshot().registrations[ID].status, "conflict");
        assert.equal(restarted.publisher.snapshot().registrations[ID].intent.producer.title, "Recovered camera");
    });
}

test("restart never reclassifies an unconfirmed overlong expiry as success merely because producer content matches the intent", { timeout: 20000 }, async (t) => {
    const context = await setup(t, { serverOffset: 1001 }), first = context.open();
    await assert.rejects(first.publisher.reconcile(publication()), batch("UnsupportedDirectory"));
    assert.equal(context.fixture.records.get(ID).expiresAt, NOW + 31001);
    assert.equal(first.publisher.snapshot().registrations[ID].intent.retainUntil, NOW + 30000);
    await first.publisher.close();
    const restarted = context.open();
    await assert.rejects(restarted.publisher.reconcile(publication()), batch("UnsupportedDirectory"));
    assert.equal(restarted.publisher.snapshot().registrations[ID].failure.code, "UnsupportedDirectory");
    assert.equal(restarted.publisher.snapshot().registrations[ID].retainUntil, NOW + 30000);
    assert.equal(context.fixture.records.get(ID).td.id, ID);
});

test("expired unacknowledged creation intent retires at the original observation deadline after restart, not a new grace window", { timeout: 20000 }, async (t) => {
    const context = await setup(t);
    const first = context.open(async () => { throw new PublicationError("DirectoryTransport", "Applied but unacknowledged"); });
    await assert.rejects(first.publisher.reconcile(publication()), batch("DirectoryTransport"));
    await first.publisher.close();
    context.clock.now = NOW + 30000;
    const auditStart = context.fixture.audit.length;
    const restarted = context.open();
    const noLongerObserved = { inventoryRevision: 2, capturedAt: context.clock.now, things: [], documents: [], modelUrls: [] };
    assert.deepEqual((await restarted.publisher.reconcile(noLongerObserved)).changes, [{ id: ID, action: "retired" }]);
    assert.equal(context.fixture.records.size, 0);
    assert.equal(context.fixture.audit.slice(auditStart).some((entry) => entry.method === "PUT" || entry.method === "PATCH"), false);
    assert.equal(context.fixture.audit.slice(auditStart).some((entry) => entry.method === "PURGE" && entry.id === ID), true);
    const restored = JSON.parse(await fs.readFile(context.file, "utf8")).registrations[ID];
    assert.equal(restored.status, "retired");
    assert.equal(restored.freshUntil, NOW + 10000);
    assert.equal(restored.retainUntil, NOW + 30000);
    assert.equal(restored.intent, undefined);
    assert.equal(restored.failure, undefined);
    assert.equal(restored.producer.id, ID);
});
