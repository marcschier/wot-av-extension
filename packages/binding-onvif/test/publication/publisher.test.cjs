const test = require("node:test");
const assert = require("node:assert/strict");
const { DirectoryPublisher, PublicationBatchError } = require("./.compiled/publication/publisher.js");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { MemoryPublicationStore } = require("./.compiled/publication/state.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("./fixtures/directory.cjs");

const NOW = 1700000000000, OWNER = "publisher-owner", A = "urn:publisher:a", B = "urn:publisher:b";
const POLICY = { freshMs: 10000, graceMs: 20000, renewBeforeMs: 5000 };
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const waitForGate = (signal, work) => Promise.race([signal.promise, Promise.resolve(work).then(() => {
    throw new Error("Publisher operation completed before reaching its public collaborator gate");
})]);
function thing(id = A, patch = {}, observedAt = NOW, quarantined = false) {
    return { deviceId: id === B ? "native-b" : "native-a", observedAt, quarantined,
        td: td(id, {
            title: id === B ? "Camera B" : "Camera A",
            securityDefinitions: { native: { scheme: "digest" } }, security: ["native"],
            // An explicit producer field matching the immutable fixture's annotation is intentional.
            // Strict independent-field ownership is tested separately, not weakened to ignore enrichment.
            "directory:annotation": "Directory-owned enrichment",
            "onvif:registryDigest": "registry-pin", "onvif:requirementsDigest": "requirements-pin",
            "onvif:discovery": { state: "verified", seenAt: NOW },
            actions: { read: { forms: [{ href: "http://192.0.2.10/onvif/native", op: "invokeaction",
                contentType: "application/soap+xml", security: ["native"], "htv:methodName": "POST" }] } },
            ...patch
        }) };
}
const prepared = (revision = 1, things = [thing()], capturedAt = NOW) =>
    ({ inventoryRevision: revision, capturedAt, things, documents: [], modelUrls: [] });
function modelPublisher() {
    return { baseUrl: "https://models.invalid/site/", calls: [], closed: false,
        async publish(value) { this.calls.push({ revision: value.inventoryRevision, ids: value.things.map((item) => item.td.id) }); },
        async close() { this.closed = true; } };
}
async function setup(t, options = {}) {
    const clock = { now: NOW };
    const fixture = await directory({ now: () => clock.now, writerToken: "publisher-directory-only" });
    fixture.contract.verification = { mode: "attested", evidence: "Owned fixture CRUDL contract tested independently" };
    if (options.expiry) fixture.contract.expiry = options.expiry;
    const client = new DirectoryClient(fixture.clientOptions());
    const store = options.store ?? new MemoryPublicationStore(OWNER), models = options.models ?? modelPublisher();
    const publisher = new DirectoryPublisher({ owner: OWNER, directory: client, models, state: store,
        policy: options.policy ?? POLICY, now: () => clock.now });
    t.after(async () => { try { await publisher.close(); } finally { await fixture.close(); } });
    return { fixture, client, store, models, publisher, clock };
}
function batch(expectedChanges, expectedCode) {
    return (error) => {
        assert.equal(error instanceof PublicationBatchError, true);
        assert.equal(error.code, "PublicationBatchFailed");
        assert.deepEqual(error.report.changes, expectedChanges);
        assert.equal(error.errors[0].code, expectedCode);
        return true;
    };
}

test("PublicationBatchError preserves precise failed-change report and child errors without a success fallback", () => {
    const denied = new PublicationError("DirectoryDenied", "writer rejected", 403);
    const error = new PublicationBatchError({ inventoryRevision: 7, publicationRevision: 11,
        changes: [{ id: A, action: "failed", code: "DirectoryDenied" }] }, [denied]);
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.code, "PublicationBatchFailed");
    assert.deepEqual(error.report, { inventoryRevision: 7, publicationRevision: 11,
        changes: [{ id: "urn:publisher:a", action: "failed", code: "DirectoryDenied" }] });
    assert.equal(error.errors[0].status, 403);
    assert.equal(error.errors[0], denied);
    assert.match(error.message, /no local-output fallback or conflict overwrite/);
});

test("publisher rejects invalid owners and nonpositive/unbounded lease configuration before using collaborators", () => {
    for (const policy of [{ ...POLICY, freshMs: 0 }, { ...POLICY, graceMs: 0 }, { ...POLICY, renewBeforeMs: 0 },
        { ...POLICY, freshMs: 1.5 }, { ...POLICY, graceMs: 2147483648 }]) {
        assert.throws(() => new DirectoryPublisher({ owner: OWNER, policy }), code("InvalidConfiguration"));
    }
    assert.throws(() => new DirectoryPublisher({ owner: "../owner", policy: POLICY }), code("InvalidConfiguration"));
});

test("start is shared, initializes explicit empty ownership state and snapshots cannot mutate durable state", async (t) => {
    const { fixture, publisher, store, models } = await setup(t);
    assert.equal(publisher.snapshot(), null);
    const starting = publisher.start();
    assert.equal(publisher.start(), starting);
    await starting;
    assert.deepEqual(publisher.snapshot(), { schemaVersion: 1, owner: OWNER, revision: 0, inventoryRevision: -1, registrations: {} });
    const snapshot = publisher.snapshot();
    snapshot.owner = "caller mutation";
    snapshot.registrations.invented = {};
    assert.equal(publisher.snapshot().owner, OWNER);
    assert.deepEqual(publisher.snapshot().registrations, {});
    assert.equal(await store.load(), null); // Starting did not fabricate a persisted registration.
    assert.deepEqual(models.calls, []);
    assert.deepEqual(fixture.audit.map((entry) => entry.method), ["GET"]);
});

test("creation persists concrete producer/version/lease metadata and uses only the Directory bearer for HTTP", async (t) => {
    const { fixture, publisher, store, models } = await setup(t);
    let wireAuthorization;
    fixture.behavior.beforeWrite = async ({ request }) => { wireAuthorization = request.headers.authorization; };
    const input = prepared();
    const before = structuredClone(input);
    const report = await publisher.reconcile(input);
    assert.deepEqual(report, { inventoryRevision: 1, publicationRevision: 3, changes: [{ id: A, action: "created" }] });
    const state = await store.load(), registration = state.registrations[A];
    assert.equal(state.owner, "publisher-owner");
    assert.equal(state.inventoryRevision, 1);
    assert.equal(registration.deviceId, "native-a");
    assert.equal(registration.status, "active");
    assert.equal(registration.publishedAt, NOW);
    assert.equal(registration.freshUntil, 1700000010000);
    assert.equal(registration.retainUntil, 1700000030000);
    assert.equal(registration.expiresAt, 1700000030000);
    assert.equal(registration.etag, '"resource-1"');
    assert.equal(registration.intent, undefined);
    assert.equal(registration.failure, undefined);
    assert.equal(registration.digest, "41f56274466272dddb64349506b6f3479e6fa130995065c02ae603a9f899d23d");
    assert.deepEqual(registration.producer.version, { model: "registry-pin.requirements-pin",
        instance: "4c31b7f1dd432dcc1aca252141c76efb7dd0122773438fbed8a8bdd3026aa303" });
    assert.deepEqual(registration.producer["onvif:publication"], {
        state: "current", freshUntil: 1700000010000, retainUntil: 1700000030000, lastConfirmedAt: NOW,
        semantics: "Inspection freshness is separate from registration liveness."
    });
    assert.equal(registration.producer.registration, undefined);
    assert.equal(fixture.records.get(A).td.actions.read.forms[0].href, "http://192.0.2.10/onvif/native");
    assert.deepEqual(fixture.records.get(A).td.security, ["native"]);
    assert.equal(wireAuthorization, "Bearer publisher-directory-only");
    assert.equal(JSON.stringify(fixture.records.get(A).td).includes("publisher-directory-only"), false);
    assert.deepEqual(models.calls, [{ revision: 1, ids: [A] }]);
    assert.deepEqual(input, before);
});

test("same inventory revision is content-idempotent and superseded revisions are rejected before model or Directory effects", async (t) => {
    const { fixture, publisher, models } = await setup(t);
    await publisher.reconcile(prepared());
    let start = fixture.audit.length;
    const repeated = await publisher.reconcile(prepared());
    assert.deepEqual(repeated, { inventoryRevision: 1, publicationRevision: 4, changes: [{ id: A, action: "unchanged" }] });
    assert.deepEqual(fixture.audit.slice(start).map((entry) => entry.method), ["GET"]);
    assert.equal(publisher.snapshot().registrations[A].publishedAt, NOW);
    assert.equal(fixture.records.get(A).etag, '"resource-1"');
    start = fixture.audit.length;
    await assert.rejects(publisher.reconcile(prepared(0)), code("PublicationConflict"));
    assert.equal(fixture.audit.length, start);
    assert.equal(models.calls.length, 2);
    assert.equal(publisher.snapshot().inventoryRevision, 1);
    assert.equal(publisher.snapshot().revision, 4);
    const copy = publisher.snapshot();
    copy.registrations[A].producer.title = "caller mutation";
    assert.equal(publisher.snapshot().registrations[A].producer.title, "Camera A");
});

test("a current update retains native ID and model/source identity while firmware evidence changes the producer instance", async (t) => {
    const { fixture, publisher, clock } = await setup(t);
    await publisher.reconcile(prepared());
    clock.now = NOW + 1000;
    const next = thing(A, { title: "Camera A firmware evidence updated",
        "onvif:profileClaims": [{ profile: "T", role: "device", evidence: [{ sourceId: "urn:advertised:claim" }] }],
        "onvif:conformanceEvidence": [{ firmware: "9.9.9", profile: "T", matchesObservedFirmware: "false",
            independentlyVerified: false, source: "urn:registry:firmware-evidence" }] }, clock.now);
    const report = await publisher.reconcile(prepared(2, [next], clock.now));
    assert.deepEqual(report.changes, [{ id: A, action: "updated" }]);
    const current = fixture.records.get(A).td;
    assert.equal(current.id, "urn:publisher:a");
    assert.equal(current.version.model, "registry-pin.requirements-pin");
    assert.notEqual(current.version.instance, "4c31b7f1dd432dcc1aca252141c76efb7dd0122773438fbed8a8bdd3026aa303");
    assert.equal(current["onvif:conformanceEvidence"][0].firmware, "9.9.9");
    assert.equal(current["onvif:conformanceEvidence"][0].independentlyVerified, false);
    assert.equal(current["onvif:profileClaims"][0].profile, "T");
    assert.equal(current.profile, undefined);
    assert.equal(current["onvif:publication"].lastConfirmedAt, NOW + 1000);
    assert.equal(current["onvif:registryDigest"], "registry-pin");
    assert.equal(fixture.audit.filter((entry) => entry.method === "PUT").at(-1).ifMatch, '"resource-1"');
});

test("new quarantined identities are not read, created or granted authoritative registration state", async (t) => {
    const { fixture, publisher } = await setup(t);
    await publisher.start();
    const start = fixture.audit.length;
    const report = await publisher.reconcile(prepared(1, [thing(A, {}, NOW, true)]));
    assert.deepEqual(report.changes, [{ id: A, action: "quarantined", code: "IdentityOrPublicationConflict" }]);
    assert.deepEqual(publisher.snapshot().registrations, {});
    assert.equal(fixture.audit.length, start);
    assert.equal(fixture.records.size, 0);
});

test("a quarantined previously owned identity is not refreshed or renewed even at its renewal threshold", async (t) => {
    const { fixture, publisher, clock } = await setup(t);
    await publisher.reconcile(prepared());
    const start = fixture.audit.length;
    clock.now = NOW + 25000;
    const report = await publisher.reconcile(prepared(2, [thing(A, {}, NOW, true)], clock.now));
    assert.deepEqual(report.changes, [{ id: A, action: "quarantined", code: "IdentityOrPublicationConflict" }]);
    assert.equal(fixture.audit.length, start);
    assert.equal(fixture.records.get(A).expiresAt, NOW + 30000);
    assert.equal(publisher.snapshot().registrations[A].freshUntil, NOW + 10000);
});

test("never-confirmed native observation is explicitly unconfirmed/stale, not retired or an authoritative create", async (t) => {
    const { fixture, publisher } = await setup(t);
    const report = await publisher.reconcile(prepared(1, [thing(A, { "onvif:discovery": { state: "suspect" } }, null)]));
    assert.deepEqual(report.changes, [{ id: A, action: "stale", code: "NoConfirmedNativeObservation" }]);
    assert.deepEqual(publisher.snapshot().registrations, {});
    assert.equal(fixture.records.size, 0);
    assert.equal(fixture.audit.some((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method)), false);
});

test("an existing remote ID is never adopted without durable ownership, even when its content resembles the candidate", async (t) => {
    const { fixture, publisher } = await setup(t);
    fixture.set(A, thing().td);
    await assert.rejects(publisher.reconcile(prepared()),
        batch([{ id: A, action: "conflict", code: "DirectoryConflict" }], "DirectoryConflict"));
    assert.equal(fixture.records.get(A).etag, '"resource-1"');
    assert.equal(fixture.records.get(A).td.title, "Camera A");
    assert.equal(fixture.audit.some((entry) => entry.method === "PUT"), false);
    assert.deepEqual(publisher.snapshot().registrations, {});
});

test("independently added remote producer content is detected before overwrite, not accepted as a broad subset match", async (t) => {
    const { fixture, publisher } = await setup(t);
    await publisher.reconcile(prepared());
    const original = fixture.records.get(A);
    fixture.set(A, { ...original.td, independent: { owner: "another writer", sequence: 4 } }, original);
    const start = fixture.audit.length;
    await assert.rejects(publisher.reconcile(prepared(2, [thing(A, { title: "Would overwrite independent revision" })])),
        batch([{ id: A, action: "conflict", code: "DirectoryConflict" }], "DirectoryConflict"));
    assert.equal(fixture.records.get(A).td.title, "Camera A");
    assert.deepEqual(fixture.records.get(A).td.independent, { owner: "another writer", sequence: 4 });
    assert.equal(fixture.audit.slice(start).some((entry) => entry.method === "PUT"), false);
    assert.equal(publisher.snapshot().registrations[A].status, "conflict");
});

test("resource ETag race isolates one conflict while the next ID updates, then quarantines only the conflicting record", async (t) => {
    const { fixture, publisher } = await setup(t);
    await publisher.reconcile(prepared(1, [thing(B), thing(A)]));
    let raced = false;
    fixture.behavior.beforeWrite = async ({ request, id, records, set }) => {
        if (!raced && request.method === "PUT" && id === A) {
            const current = records.get(id);
            set(id, { ...current.td, title: "Concurrent independent writer" }, current);
            raced = true;
        }
    };
    const next = prepared(2, [thing(B, { title: "Camera B updated" }), thing(A, { title: "Camera A desired" })]);
    await assert.rejects(publisher.reconcile(next), (error) => {
        assert.equal(error instanceof PublicationBatchError, true);
        assert.deepEqual(error.report, { inventoryRevision: 2, publicationRevision: 10, changes: [
            { id: A, action: "conflict", code: "DirectoryConflict" }, { id: B, action: "updated" }
        ] });
        assert.equal(error.errors.length, 1);
        assert.equal(error.errors[0].status, 412);
        return true;
    });
    assert.equal(fixture.records.get(A).td.title, "Concurrent independent writer");
    assert.equal(fixture.records.get(B).td.title, "Camera B updated");
    assert.equal(publisher.snapshot().registrations[A].status, "conflict");
    assert.deepEqual(publisher.snapshot().registrations[A].failure, { code: "DirectoryConflict", at: NOW });
    assert.equal(publisher.snapshot().registrations[B].failure, undefined);
    const start = fixture.audit.length;
    assert.deepEqual((await publisher.reconcile(next)).changes, [
        { id: A, action: "quarantined", code: "IdentityOrPublicationConflict" }, { id: B, action: "unchanged" }
    ]);
    assert.deepEqual(fixture.audit.slice(start).map((entry) => [entry.method, entry.id]), [["GET", B]]);
});

test("future native observation fails explicitly before Directory mutation instead of extending freshness", async (t) => {
    const { fixture, publisher } = await setup(t);
    await assert.rejects(publisher.reconcile(prepared(1, [thing(A, {}, NOW + 1)])),
        batch([{ id: A, action: "failed", code: "InvalidSnapshot" }], "InvalidSnapshot"));
    assert.equal(fixture.records.size, 0);
    assert.deepEqual(publisher.snapshot().registrations, {});
    assert.equal(fixture.audit.some((entry) => entry.id === A), false);
});

test("duplicate and over-capacity prepared IDs fail before models or resource I/O", async (t) => {
    const { fixture, publisher, models } = await setup(t);
    await publisher.start();
    const count = fixture.audit.length;
    await assert.rejects(publisher.reconcile(prepared(1, [thing(), thing()])), code("PublicationLimit"));
    const tooMany = Array.from({ length: 20001 }, (_, i) => thing(`urn:publisher:${i}`));
    await assert.rejects(publisher.reconcile(prepared(1, tooMany)), code("PublicationLimit"));
    assert.equal(fixture.audit.length, count);
    assert.deepEqual(models.calls, []);
    assert.equal(publisher.snapshot().revision, 0);
});

test("model publication failure propagates before any registration intent or output-mode fallback", async (t) => {
    const models = modelPublisher();
    models.publish = async () => { throw new PublicationError("ModelNotReachable", "not hosted"); };
    const { fixture, publisher, store } = await setup(t, { models });
    await publisher.start();
    const count = fixture.audit.length;
    await assert.rejects(publisher.reconcile(prepared()), code("ModelNotReachable"));
    assert.equal(fixture.audit.length, count);
    assert.deepEqual(publisher.snapshot().registrations, {});
    assert.equal(await store.load(), null);
});

test("concurrent reconciliation is rejected and close awaits model, Directory and state operations before releasing resources", async (t) => {
    const entered = deferred(), release = deferred(), events = [];
    const models = { baseUrl: "https://models.invalid/site/", async publish(value) {
        events.push(`publish:${value.inventoryRevision}:entered`); entered.resolve(); await release.promise; events.push("publish:finished");
    }, async close() { events.push("models:closed"); } };
    const { fixture, publisher, client, store } = await setup(t, { models });
    const work = publisher.reconcile(prepared());
    try {
        await waitForGate(entered, work);
        await assert.rejects(publisher.reconcile(prepared(2)), code("PublicationBusy"));
        let closed = false;
        const closing = publisher.close();
        assert.equal(publisher.close(), closing);
        void closing.then(() => { closed = true; });
        await Promise.resolve();
        assert.equal(closed, false);
        await assert.rejects(publisher.start(), code("RuntimeClosed"));
        await assert.rejects(publisher.reconcile(prepared(3)), code("RuntimeClosed"));
        assert.deepEqual(events, ["publish:1:entered"]);
        release.resolve();
        assert.deepEqual((await work).changes, [{ id: A, action: "created" }]);
        await closing;
        assert.deepEqual(events, ["publish:1:entered", "publish:finished", "models:closed"]);
        assert.equal(fixture.records.get(A).td.id, A);
        await assert.rejects(client.get(A), code("RuntimeClosed"));
        await assert.rejects(store.load(), code("RuntimeClosed"));
        assert.equal(publisher.snapshot().registrations[A].status, "active");
    } finally { release.resolve(); await work.catch(() => {}); }
});

test("start failure is cached and foreign durable ownership is never silently replaced", async (t) => {
    let loads = 0, closes = 0;
    const foreign = { schemaVersion: 1, owner: "foreign-owner", revision: 8, inventoryRevision: 9, registrations: {} };
    const store = { async load() { loads++; return structuredClone(foreign); },
        async save() { assert.fail("Foreign state must not be overwritten"); }, async close() { closes++; } };
    const { fixture, publisher, models } = await setup(t, { store });
    const first = publisher.start();
    await assert.rejects(first, code("PublicationConflict"));
    assert.equal(publisher.start(), first);
    await assert.rejects(publisher.start(), code("PublicationConflict"));
    assert.equal(loads, 1);
    assert.deepEqual(fixture.audit, []);
    assert.deepEqual(models.calls, []);
    assert.equal(publisher.snapshot(), null);
    await publisher.close();
    assert.equal(closes, 1);
    assert.equal(foreign.revision, 8);
});

test("close waits for a gated initial state load before closing its collaborators", async (t) => {
    const entered = deferred(), release = deferred(), events = [];
    const store = { async load() { events.push("load"); entered.resolve(); await release.promise; return null; },
        async save() { assert.fail("start does not save a registration"); }, async close() { events.push("state:closed"); } };
    const { fixture, publisher } = await setup(t, { store });
    const starting = publisher.start();
    try {
        await waitForGate(entered, starting);
        let closed = false;
        const closing = publisher.close().then(() => { closed = true; });
        await Promise.resolve();
        assert.equal(closed, false);
        assert.deepEqual(events, ["load"]);
        assert.deepEqual(fixture.audit, []);
        release.resolve();
        await starting;
        await closing;
        assert.deepEqual(events, ["load", "state:closed"]);
        assert.deepEqual(fixture.audit.map((entry) => entry.method), ["GET"]);
    } finally { release.resolve(); await starting.catch(() => {}); }
});

test("publisher cleanup aggregates all child failures and invokes every resource close exactly once", async () => {
    const directoryFailure = new Error("Directory close failed"), modelFailure = new Error("Models close failed"), calls = [];
    const publisher = new DirectoryPublisher({ owner: OWNER, policy: POLICY,
        directory: { async close() { calls.push("directory"); throw directoryFailure; } },
        models: { async close() { calls.push("models"); throw modelFailure; } },
        state: { async close() { calls.push("state"); } } });
    const closing = publisher.close();
    assert.equal(publisher.close(), closing);
    await assert.rejects(closing, (error) => error instanceof AggregateError
        && error.errors.length === 2 && error.errors[0] === directoryFailure && error.errors[1] === modelFailure);
    assert.deepEqual(calls, ["directory", "models", "state"]);
    await assert.rejects(publisher.reconcile(prepared()), code("RuntimeClosed"));
});

test("attested TTL without acknowledged expiry fails explicitly and retains durable intent instead of confirming success", async (t) => {
    const { fixture, publisher } = await setup(t);
    let requested;
    fixture.behavior.beforeWrite = async ({ request, body }) => {
        if (request.method === "PUT") {
            requested = body.registration.ttl;
            delete body.registration; // A lying server accepted a bounded TTL request without applying it.
        }
    };
    await assert.rejects(publisher.reconcile(prepared()),
        batch([{ id: A, action: "failed", code: "UnsupportedDirectory" }], "UnsupportedDirectory"));
    assert.equal(requested, 30);
    assert.equal(fixture.records.get(A).expiresAt, undefined);
    assert.equal(fixture.records.get(A).td.title, "Camera A");
    assert.equal(publisher.snapshot().registrations[A].status, "pending");
    assert.equal(publisher.snapshot().registrations[A].intent.retainUntil, NOW + 30000);
    assert.deepEqual(publisher.snapshot().registrations[A].failure, { code: "UnsupportedDirectory", at: NOW });
});

test("epoch-zero current observation is confirmed rather than lost to a truthiness check", async (t) => {
    const { fixture, publisher, clock } = await setup(t);
    clock.now = 0;
    const current = thing(A, { "onvif:discovery": { state: "verified", seenAt: 0 } }, 0);
    assert.deepEqual((await publisher.reconcile(prepared(1, [current], 0))).changes, [{ id: A, action: "created" }]);
    assert.equal(fixture.records.get(A).td["onvif:publication"].lastConfirmedAt, 0);
    assert.equal(fixture.records.get(A).expiresAt, 30000);
    assert.equal(publisher.snapshot().registrations[A].freshUntil, 10000);
    assert.equal(publisher.snapshot().registrations[A].retainUntil, 30000);
    assert.equal(publisher.snapshot().registrations[A].status, "active");
});
