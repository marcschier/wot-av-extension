const test = require("node:test");
const assert = require("node:assert/strict");
const { DirectoryPublisher, PublicationBatchError } = require("./.compiled/publication/publisher.js");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { MemoryPublicationStore } = require("./.compiled/publication/state.js");
const { directory, td } = require("../../../fixtures/reference-runtime/publication/directory.cjs");

const NOW = 1700000000000, ID = "urn:lease:camera", OWNER = "lease-owner";
const SHORT = { freshMs: 10000, graceMs: 20000, renewBeforeMs: 5000 };
const LONG = { freshMs: 120000, graceMs: 180000, renewBeforeMs: 5000 };
const BRIDGE = { mode: "bridge-delete", outageLimitation: "Explicitly no server expiry while the bridge is offline" };
function thing(id = ID, observedAt = NOW, patch = {}) {
    return { deviceId: "native-lease-device", observedAt, quarantined: false, td: td(id, {
        title: "Lease camera", "directory:annotation": "Directory-owned enrichment",
        "onvif:registryDigest": "registry-pin", "onvif:requirementsDigest": "requirements-pin",
        "onvif:discovery": { state: "verified", seenAt: NOW },
        actions: { nativeRead: { forms: [{ href: "http://192.0.2.10/exact-native", op: "invokeaction", contentType: "application/soap+xml" }] } },
        ...patch
    }) };
}
const prepared = (revision, things, capturedAt) => ({ inventoryRevision: revision, capturedAt, things, documents: [], modelUrls: [] });
async function setup(t, options = {}) {
    const clock = { now: NOW };
    const fixture = await directory({ now: () => clock.now + (options.serverOffset ?? 0) });
    fixture.contract.verification = { mode: "attested", evidence: "Owned fixture; preflight tested separately" };
    if (options.expiry) fixture.contract.expiry = options.expiry;
    const client = new DirectoryClient(fixture.clientOptions());
    const store = new MemoryPublicationStore(OWNER);
    const models = { baseUrl: "https://models.invalid/site/", async publish() {}, async close() {} };
    const publisher = new DirectoryPublisher({ owner: OWNER, directory: client, models, state: store,
        policy: options.policy ?? SHORT, now: () => clock.now });
    t.after(async () => { try { await publisher.close(); } finally { await fixture.close(); } });
    return { clock, fixture, client, store, publisher };
}
const failedBatch = (expected) => (error) => {
    assert.equal(error instanceof PublicationBatchError, true);
    assert.deepEqual(error.report.changes, [{ id: ID, action: "failed", code: expected }]);
    assert.equal(error.errors[0].code, expected);
    return true;
};

for (const [label, offset, action, state] of [
    ["immediately before freshness", 9999, "unchanged", "active"],
    ["exactly at freshness", 10000, "stale", "stale"],
    ["immediately after freshness", 10001, "stale", "stale"],
    ["immediately before retention", 29999, "stale", "stale"],
    ["exactly at retention", 30000, "retired", "retired"],
    ["immediately after retention", 30001, "retired", "retired"]
]) {
    test(`observation lease ${label} uses fixed freshMs + graceMs boundaries`, async (t) => {
        const { clock, fixture, publisher } = await setup(t, { expiry: BRIDGE });
        await publisher.reconcile(prepared(1, [thing()], clock.now));
        clock.now = NOW + offset;
        const report = await publisher.reconcile(prepared(2, [thing()], clock.now));
        assert.deepEqual(report.changes, [{ id: ID, action }]);
        const owned = publisher.snapshot().registrations[ID];
        assert.equal(owned.status, state);
        assert.equal(owned.freshUntil, 1700000010000);
        assert.equal(owned.retainUntil, 1700000030000);
        assert.equal(owned.producer["onvif:publication"].lastConfirmedAt, NOW);
        assert.equal(fixture.records.has(ID), state !== "retired");
        if (state === "retired") {
            assert.deepEqual(fixture.audit.filter((entry) => entry.method === "DELETE").map((entry) => entry.id), [ID]);
            assert.equal(owned.intent, undefined);
        } else {
            const remote = fixture.records.get(ID).td;
            assert.equal(remote["onvif:publication"].state, state === "active" ? "current" : "stale");
            assert.equal(remote.actions.nativeRead.forms[0].href, "http://192.0.2.10/exact-native");
            assert.equal(fixture.records.get(ID).expiresAt, undefined);
        }
    });
}

for (const [label, offset, expected] of [
    ["one millisecond before", 29999, "stale"], ["exactly at", 30000, "retired"], ["one millisecond after", 30001, "retired"]
]) {
    test(`registration TTL keeps last-known content until ${label} the observation-retention endpoint`, async (t) => {
        const { clock, fixture, publisher } = await setup(t);
        await publisher.reconcile(prepared(1, [thing()], clock.now));
        clock.now = NOW + 10000;
        await publisher.reconcile(prepared(2, [thing()], clock.now));
        assert.equal(fixture.records.get(ID).expiresAt, NOW + 30000);
        clock.now = NOW + offset;
        const start = fixture.audit.length;
        const report = await publisher.reconcile(prepared(3, [thing()], clock.now));
        assert.deepEqual(report.changes, [{ id: ID, action: expected }]);
        assert.equal(publisher.snapshot().registrations[ID].retainUntil, NOW + 30000);
        assert.equal(publisher.snapshot().registrations[ID].producer["onvif:publication"].lastConfirmedAt, NOW);
        assert.equal(fixture.records.has(ID), expected !== "retired");
        if (expected === "stale") {
            assert.deepEqual(fixture.audit.slice(start).map((entry) => entry.method), ["GET"]);
            assert.equal(fixture.records.get(ID).expiresAt, NOW + 30000);
        }
    });
}

test("repeated same-revision unconfirmed reconciliation never refreshes last-known observation age through capture or renewal time", async (t) => {
    const { clock, fixture, publisher } = await setup(t);
    await publisher.reconcile(prepared(1, [thing()], clock.now));
    clock.now = NOW + 5000;
    const unknown = thing(ID, null, { title: "Unconfirmed replacement must not be used",
        "onvif:discovery": { state: "suspect", seenAt: NOW + 5000, information: { status: "denied" } } });
    await publisher.reconcile(prepared(2, [unknown], clock.now));
    const staleProducer = structuredClone(publisher.snapshot().registrations[ID].producer);
    assert.equal(staleProducer.title, "Lease camera");
    assert.equal(staleProducer["onvif:publication"].semantics, "Last-known native Forms, not a fresh observation or absence claim.");
    assert.equal(staleProducer["onvif:discovery"].information.status, "denied");
    const start = fixture.audit.length;
    for (const offset of [9000, 25000, 29000]) {
        clock.now = NOW + offset;
        assert.deepEqual((await publisher.reconcile(prepared(2, [unknown], clock.now))).changes, [{ id: ID, action: "stale" }]);
        const registration = publisher.snapshot().registrations[ID];
        assert.equal(registration.freshUntil, NOW + 10000);
        assert.equal(registration.retainUntil, NOW + 30000);
        assert.equal(registration.producer["onvif:publication"].lastConfirmedAt, NOW);
        assert.deepEqual(registration.producer, staleProducer);
        assert.equal(fixture.records.get(ID).expiresAt, NOW + 30000);
    }
    assert.deepEqual(fixture.audit.slice(start).filter((entry) => entry.method === "PATCH").map((entry) => entry.body),
        [{ registration: { ttl: 5 } }, { registration: { ttl: 1 } }]);
    assert.equal(fixture.audit.slice(start).some((entry) => entry.method === "PUT"), false);
    clock.now = NOW + 30000;
    assert.deepEqual((await publisher.reconcile(prepared(2, [unknown], clock.now))).changes, [{ id: ID, action: "retired" }]);
    assert.equal(fixture.records.has(ID), false);
    assert.equal(publisher.snapshot().registrations[ID].status, "retired");
    assert.equal(publisher.snapshot().registrations[ID].producer["onvif:publication"].lastConfirmedAt, NOW);
});

for (const [label, offset, action, writes] of [
    ["before", 24999, "unchanged", []], ["at", 25000, "renewed", ["PATCH"]], ["after", 25001, "renewed", ["PATCH"]]
]) {
    test(`renewal ${label} expiry minus renewBeforeMs changes only registration liveness`, async (t) => {
        const { clock, fixture, publisher } = await setup(t, { policy: LONG });
        await publisher.reconcile(prepared(1, [thing()], clock.now));
        const original = structuredClone(publisher.snapshot().registrations[ID].producer);
        const start = fixture.audit.length;
        clock.now = NOW + offset;
        const report = await publisher.reconcile(prepared(1, [thing()], clock.now));
        assert.deepEqual(report.changes, [{ id: ID, action }]);
        const mutations = fixture.audit.slice(start).filter((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method));
        assert.deepEqual(mutations.map((entry) => entry.method), writes);
        assert.deepEqual(publisher.snapshot().registrations[ID].producer, original);
        assert.equal(original["onvif:publication"].lastConfirmedAt, NOW);
        assert.equal(original["onvif:publication"].freshUntil, NOW + 120000);
        assert.equal(original["onvif:publication"].retainUntil, NOW + 300000);
        assert.equal(fixture.records.get(ID).expiresAt, action === "renewed" ? NOW + offset + 30000 : NOW + 30000);
        assert.equal(fixture.records.get(ID).created, NOW);
        if (mutations.length) {
            assert.deepEqual(mutations[0].body, { registration: { ttl: 30 } });
            assert.equal(mutations[0].ifMatch, '"resource-1"');
            assert.equal(publisher.snapshot().registrations[ID].publishedAt, NOW + offset);
        }
    });
}

test("negotiated TTL without PATCH renews with conditional PUT, never a local-output or native-control fallback", async (t) => {
    const { clock, fixture, publisher } = await setup(t, { policy: LONG, expiry: {
        mode: "registration-ttl", ttlSeconds: 30, patch: false, purgeAttestation: "Owned TTL fixture with PUT-only renewal"
    } });
    await publisher.reconcile(prepared(1, [thing()], clock.now));
    const before = structuredClone(publisher.snapshot().registrations[ID].producer);
    const start = fixture.audit.length;
    clock.now = NOW + 25000;
    assert.deepEqual((await publisher.reconcile(prepared(1, [thing()], clock.now))).changes, [{ id: ID, action: "renewed" }]);
    const writes = fixture.audit.slice(start).filter((entry) => entry.method === "PUT" || entry.method === "PATCH");
    assert.deepEqual(writes.map((entry) => entry.method), ["PUT"]);
    assert.equal(writes[0].ifMatch, '"resource-1"');
    assert.deepEqual(writes[0].body.registration, { ttl: 30 });
    assert.equal(writes[0].body.actions.nativeRead.forms[0].href, "http://192.0.2.10/exact-native");
    assert.deepEqual(publisher.snapshot().registrations[ID].producer, before);
    assert.equal(fixture.records.get(ID).expiresAt, NOW + 55000);
});

for (const [label, offset, action, method, purged] of [
    ["before", 2999, "renewed", "PATCH", false], ["at", 3000, "created", "PUT", true], ["after", 3001, "created", "PUT", true]
]) {
    test(`server TTL ${label} expiry preserves the stable ID while distinguishing renewal from recreation`, async (t) => {
        const { clock, fixture, publisher } = await setup(t, { policy: { ...LONG, renewBeforeMs: 1 }, expiry: {
            mode: "registration-ttl", ttlSeconds: 3, patch: true, purgeAttestation: "Owned three-second TTL fixture"
        } });
        await publisher.reconcile(prepared(1, [thing()], clock.now));
        clock.now = NOW + offset;
        const start = fixture.audit.length;
        assert.deepEqual((await publisher.reconcile(prepared(1, [thing()], clock.now))).changes, [{ id: ID, action }]);
        assert.deepEqual(fixture.audit.slice(start).filter((entry) => ["PUT", "PATCH"].includes(entry.method)).map((entry) => entry.method), [method]);
        assert.equal(fixture.audit.slice(start).some((entry) => entry.method === "PURGE"), purged);
        assert.equal(fixture.records.get(ID).td.id, ID);
        assert.equal(fixture.records.get(ID).etag, '"resource-2"');
        assert.equal(fixture.records.get(ID).expiresAt, NOW + offset + 3000);
        assert.equal(publisher.snapshot().registrations[ID].producer["onvif:publication"].lastConfirmedAt, NOW);
        assert.equal(fixture.records.get(ID).td.version.model, "registry-pin.requirements-pin");
    });
}

test("removed recording-track resource retains its own observation deadline, retires without touching its device, and reuses its stable ID", async (t) => {
    const { clock, fixture, publisher } = await setup(t, { expiry: BRIDGE });
    const deviceId = "urn:lease:device", trackId = "urn:lease:track";
    const identity = { serviceNamespace: "http://www.onvif.org/ver10/recording/wsdl",
        kind: "RecordingTrack", parentTokens: [{ kind: "Recording", token: "rec-one" }], token: "track-one" };
    const device = thing(deviceId), track = thing(trackId, NOW, { title: "Track one", "onvif:resourceIdentity": identity });
    fixture.set("urn:lease:unrelated", td("urn:lease:unrelated", { title: "Independent directory owner" }));
    await publisher.reconcile(prepared(1, [track, device], clock.now));
    clock.now = NOW + 5000;
    const refreshed = thing(deviceId, clock.now, { "onvif:discovery": { state: "verified", seenAt: clock.now } });
    assert.deepEqual((await publisher.reconcile(prepared(2, [refreshed], clock.now))).changes, [
        { id: deviceId, action: "updated" }, { id: trackId, action: "stale" }
    ]);
    assert.equal(publisher.snapshot().registrations[trackId].retainUntil, NOW + 30000);
    assert.equal(fixture.records.get(trackId).td["onvif:discovery"].seenAt, NOW + 5000);
    assert.deepEqual(fixture.records.get(trackId).td["onvif:resourceIdentity"], identity);
    clock.now = NOW + 30000;
    const current = thing(deviceId, clock.now);
    assert.deepEqual((await publisher.reconcile(prepared(3, [current], clock.now))).changes, [
        { id: deviceId, action: "updated" }, { id: trackId, action: "retired" }
    ]);
    assert.equal(fixture.records.has(trackId), false);
    assert.equal(fixture.records.has(deviceId), true);
    assert.equal(fixture.records.get("urn:lease:unrelated").td.title, "Independent directory owner");
    assert.deepEqual(fixture.audit.filter((entry) => entry.method === "DELETE").map((entry) => entry.id), [trackId]);
    clock.now = NOW + 31000;
    const returned = thing(trackId, clock.now, { title: "Track one again", "onvif:resourceIdentity": identity });
    const report = await publisher.reconcile(prepared(4, [current, returned], clock.now));
    assert.deepEqual(report.changes, [{ id: deviceId, action: "unchanged" }, { id: trackId, action: "created" }]);
    assert.equal(publisher.snapshot().registrations[trackId].producer.id, trackId);
    assert.equal(publisher.snapshot().registrations[trackId].retainUntil, NOW + 61000);
    assert.deepEqual(fixture.records.get(trackId).td["onvif:resourceIdentity"], identity);
});

test("a subsecond observation lease that cannot be represented by negotiated integer TTL fails explicitly, not as successful retirement", async (t) => {
    const { clock, fixture, publisher } = await setup(t, { policy: { freshMs: 500, graceMs: 499, renewBeforeMs: 1 }, expiry: {
        mode: "registration-ttl", ttlSeconds: 1, patch: true, purgeAttestation: "Only positive whole-second TTL is supported"
    } });
    await assert.rejects(publisher.reconcile(prepared(1, [thing()], clock.now)), failedBatch("UnsupportedDirectory"));
    assert.equal(fixture.records.size, 0);
    assert.equal(fixture.audit.some((entry) => entry.method === "PUT"), false);
});

test("an exactly one-second observation lease is representable and never rounds TTL to zero", async (t) => {
    const { clock, fixture, publisher } = await setup(t, { policy: { freshMs: 500, graceMs: 500, renewBeforeMs: 1 }, expiry: {
        mode: "registration-ttl", ttlSeconds: 1, patch: true, purgeAttestation: "Owned whole-second TTL fixture"
    } });
    assert.deepEqual((await publisher.reconcile(prepared(1, [thing()], clock.now))).changes, [{ id: ID, action: "created" }]);
    assert.equal(fixture.records.get(ID).ttl, 1);
    assert.equal(fixture.records.get(ID).expiresAt, NOW + 1000);
    assert.equal(publisher.snapshot().registrations[ID].retainUntil, NOW + 1000);
});

for (const [label, serverOffset, expiry, accepted] of [
    ["at now", -30000, NOW, false],
    ["one millisecond after now", -29999, NOW + 1, true],
    ["at retention plus allowed skew", 1000, NOW + 31000, true],
    ["one millisecond beyond allowed skew", 1001, NOW + 31001, false]
]) {
    test(`publisher verifies acknowledged expiry ${label} rather than blindly confirming the write`, async (t) => {
        const { clock, fixture, publisher } = await setup(t, { serverOffset });
        if (accepted) {
            assert.deepEqual((await publisher.reconcile(prepared(1, [thing()], clock.now))).changes, [{ id: ID, action: "created" }]);
            assert.equal(publisher.snapshot().registrations[ID].expiresAt, expiry);
            assert.equal(publisher.snapshot().registrations[ID].intent, undefined);
        } else {
            await assert.rejects(publisher.reconcile(prepared(1, [thing()], clock.now)), failedBatch("UnsupportedDirectory"));
            assert.equal(publisher.snapshot().registrations[ID].status, "pending");
            assert.equal(publisher.snapshot().registrations[ID].intent.retainUntil, NOW + 30000);
            assert.equal(publisher.snapshot().registrations[ID].failure.code, "UnsupportedDirectory");
        }
        assert.equal(fixture.records.get(ID).expiresAt, expiry);
        assert.equal(fixture.records.get(ID).td["onvif:publication"].retainUntil, NOW + 30000);
    });
}

for (const [label, value] of [["negative", -1], ["fractional", 1.5], ["nonfinite", NaN]]) {
    test(`publisher rejects a ${label} clock explicitly before any resource mutation`, async (t) => {
        const { clock, fixture, publisher } = await setup(t);
        clock.now = value;
        await assert.rejects(publisher.reconcile(prepared(1, [thing()], NOW)), failedBatch("InvalidConfiguration"));
        assert.equal(fixture.records.size, 0);
        assert.equal(fixture.audit.some((entry) => entry.method === "PUT"), false);
    });
}
