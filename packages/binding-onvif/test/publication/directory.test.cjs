const test = require("node:test");
const assert = require("node:assert/strict");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("./fixtures/directory.cjs");

const NOW = 1700000000000;
const ID = "urn:directory:camera";
const DISCOVERY = "https://www.w3.org/2022/wot/discovery";
const TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1";
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const waitForGate = (signal, work) => Promise.race([signal.promise, Promise.resolve(work).then(() => {
    throw new Error("Directory operation completed before reaching its public fixture gate");
})]);
function contract() {
    return { verification: { mode: "attested", evidence: "Owned test capability attestation" },
        ownership: { mode: "etag", evidence: "Owned resource CAS" },
        list: { format: "array", pageSize: 2, maxPages: 10, maxItems: 20, collectionRevision: "canonical-link", maxRestarts: 0 },
        expiry: { mode: "registration-ttl", ttlSeconds: 30, patch: true, purgeAttestation: "Owned fixture expires at its controlled clock" } };
}
async function setup(t, options = {}, configure = () => {}) {
    const fixture = await directory({ now: () => NOW, ...options });
    fixture.contract = contract();
    const clientOptions = fixture.clientOptions();
    configure(clientOptions, fixture);
    const client = new DirectoryClient(clientOptions);
    t.after(async () => { try { await client.close(); } finally { await fixture.close(); } });
    return { fixture, client };
}

test("Directory constructor validates negotiated capability/evidence limits and clones the declared contract", async () => {
    const input = contract();
    const client = new DirectoryClient({ collectionUrl: "https://directory.invalid/things", contract: input });
    try {
        input.expiry.ttlSeconds = 1;
        input.list.pageSize = 9;
        assert.equal(client.contract.expiry.ttlSeconds, 30);
        assert.equal(client.contract.list.pageSize, 2);
        assert.equal(client.collectionUrl, "https://directory.invalid/things");
        assert.equal(client.pendingRequests, 0);
    } finally { await client.close(); }
    const inclusive = contract();
    Object.assign(inclusive.list, { pageSize: 2000, maxPages: 1024, maxItems: 20000, maxRestarts: 3 });
    inclusive.expiry.ttlSeconds = 604800;
    const maximum = new DirectoryClient({ collectionUrl: "https://directory.invalid/things", contract: inclusive, maxReadRetries: 3 });
    try {
        assert.deepEqual(maximum.contract.list, { format: "array", pageSize: 2000, maxPages: 1024,
            maxItems: 20000, collectionRevision: "canonical-link", maxRestarts: 3 });
        assert.equal(maximum.contract.expiry.ttlSeconds, 604800);
    } finally { await maximum.close(); }
    for (const change of [
        (value) => { value.ownership = { mode: "guess", evidence: "not valid" }; },
        (value) => { value.ownership.evidence = " "; },
        (value) => { value.verification.evidence = ""; },
        (value) => { value.verification.evidence = "x".repeat(4097); },
        (value) => { value.list.pageSize = 0; },
        (value) => { value.list.pageSize = 2001; },
        (value) => { value.list.maxPages = 1025; },
        (value) => { value.list.maxItems = 20001; },
        (value) => { value.list.maxRestarts = -1; },
        (value) => { value.list.maxRestarts = 4; },
        (value) => { value.list.collectionRevision = "resource-etag"; },
        (value) => { value.expiry.ttlSeconds = 0; },
        (value) => { value.expiry.ttlSeconds = 604801; },
        (value) => { value.expiry.patch = "yes"; },
        (value) => { value.expiry.purgeAttestation = ""; },
        (value) => { value.expiry = { mode: "bridge-delete", outageLimitation: "" }; }
    ]) {
        const value = contract();
        change(value);
        assert.throws(() => new DirectoryClient({ collectionUrl: "https://directory.invalid/things", contract: value }), code("InvalidConfiguration"));
    }
    assert.throws(() => new DirectoryClient({ collectionUrl: "https://directory.invalid/things",
        contract: { ...contract(), list: { ...contract().list, format: "jsonpath" } } }), code("UnsupportedDirectory"));
    for (const maxReadRetries of [-1, 1.5, 4]) {
        assert.throws(() => new DirectoryClient({ collectionUrl: "https://directory.invalid/things", contract: contract(), maxReadRetries }),
            code("InvalidConfiguration"));
    }
});

test("Directory collection rejects queries/fragments/trailing slash and cross-origin or downgrade redirect allowances", async () => {
    for (const [collectionUrl, expected] of [
        ["https://directory.invalid/things?q=1", "InvalidConfiguration"],
        ["https://directory.invalid/things/", "InvalidConfiguration"],
        ["https://directory.invalid/things#item", "PolicyDenied"],
        ["https://directory.invalid/things#", "PolicyDenied"]
    ]) assert.throws(() => new DirectoryClient({ collectionUrl, contract: contract() }), code(expected));
    for (const target of ["https://another.invalid/things", "http://directory.invalid/things"]) {
        assert.throws(() => new DirectoryClient({ collectionUrl: "https://directory.invalid/things",
            contract: contract(), allowedReadRedirects: [target] }), code("PolicyDenied"));
    }
    const explicit = new DirectoryClient({ collectionUrl: "https://directory.invalid/things",
        contract: contract(), allowedReadRedirects: ["https://directory.invalid/declared"] });
    await explicit.close(); // Configuration-only evidence; this is not a redirect wire test.
});

test("non-loopback Directory origins require HTTPS instead of silently allowing plaintext publication", async () => {
    let client;
    try {
        assert.throws(() => { client = new DirectoryClient({ collectionUrl: "http://directory.invalid/things", contract: contract() }); },
            code("PolicyDenied"));
    } finally { await client?.close(); }
});

test("resourceUrl encodes an absolute ID as exactly one path segment and bounds its length", async () => {
    const client = new DirectoryClient({ collectionUrl: "https://directory.invalid/things", contract: contract() });
    try {
        assert.equal(client.resourceUrl("urn:camera:space%20/?x=1#part!()*'"),
            "https://directory.invalid/things/urn%3Acamera%3Aspace%2520%2F%3Fx%3D1%23part%21%28%29%2A%27");
        const maximum = "urn:x:" + "a".repeat(8186);
        assert.equal(client.resourceUrl(maximum), "https://directory.invalid/things/urn%3Ax%3A" + "a".repeat(8186));
        for (const id of ["", "relative", "urn:has space", "urn:line\nbreak", maximum + "a"]) {
            assert.throws(() => client.resourceUrl(id), code("InvalidConfiguration"));
        }
    } finally { await client.close(); }
});

test("GET returns the exact identified TD, registration expiry and resource ETag; only 404 is absence", async (t) => {
    const { fixture, client } = await setup(t);
    fixture.set(ID, td(ID, { title: "Camera GET", registration: { ttl: 30 } }));
    const record = await client.get(ID);
    assert.equal(record.etag, '"resource-1"');
    assert.equal(record.expiresAt, 1700000030000);
    assert.equal(record.td.id, "urn:directory:camera");
    assert.equal(record.td.title, "Camera GET");
    assert.deepEqual(record.td.registration, { ttl: 30, created: "2023-11-14T22:13:20.000Z",
        modified: "2023-11-14T22:13:20.000Z", retrieved: "2023-11-14T22:13:20.000Z", expires: "2023-11-14T22:13:50.000Z" });
    assert.equal(await client.get("urn:directory:absent"), null);
    assert.deepEqual(fixture.audit.map(({ method, id, role }) => ({ method, id, role })), [
        { method: "GET", id: ID, role: "writer" }, { method: "GET", id: "urn:directory:absent", role: "writer" }
    ]);
    assert.equal(client.pendingRequests, 0);
});

test("PUT201-create and PUT204-replace preserve exact bodies, strong resource CAS and negotiated TTL only", async (t) => {
    const { fixture, client } = await setup(t);
    const input = td(ID, { title: "Created camera", description: "remove on replacement",
        registration: { ttl: 900, created: "producer cannot dictate registration metadata" } });
    const before = structuredClone(input);
    await client.put(input, { create: true }, 30);
    assert.equal(fixture.audit[0].ifNoneMatch, "*");
    assert.deepEqual(fixture.audit[0].body, { ...before, "@context": [TD_CONTEXT, DISCOVERY], registration: { ttl: 30 } });
    assert.equal(fixture.records.get(ID).etag, '"resource-1"');
    assert.equal(fixture.records.get(ID).expiresAt, NOW + 30000);
    const current = await client.get(ID);
    await client.put(td(ID, { title: "Replaced camera" }), { etag: current.etag }, 1);
    const writes = fixture.audit.filter((entry) => entry.method === "PUT");
    assert.equal(writes[1].ifMatch, '"resource-1"');
    assert.equal(writes[1].ifNoneMatch, undefined);
    assert.deepEqual(writes[1].body, td(ID, { title: "Replaced camera", "@context": [TD_CONTEXT, DISCOVERY], registration: { ttl: 1 } }));
    assert.equal(fixture.records.get(ID).td.description, undefined);
    assert.equal(fixture.records.get(ID).etag, '"resource-2"');
    assert.equal(fixture.records.get(ID).expiresAt, NOW + 1000);
    assert.deepEqual(input, before);
});

test("PUT creation refuses replacement status and never adopts an existing unrelated registration", async (t) => {
    const { fixture, client } = await setup(t);
    fixture.behavior.nextWriteStatus = 204;
    await assert.rejects(client.put(td(ID), { create: true }), (error) => code("DirectoryConflict")(error) && error.status === 204);
    assert.equal(fixture.records.size, 0);
    fixture.set(ID, td(ID, { title: "Independent owner" }));
    await assert.rejects(client.put(td(ID), { create: true }), (error) => code("DirectoryConflict")(error) && error.status === 412);
    assert.equal(fixture.records.get(ID).td.title, "Independent owner");
    assert.equal(fixture.audit.at(-1).ifNoneMatch, "*");
});

test("PUT replacement refuses a lying 201-create response rather than reporting confirmed replacement", async (t) => {
    const { fixture, client } = await setup(t);
    fixture.set(ID, td(ID, { title: "Existing" }));
    fixture.behavior.nextWriteStatus = 201;
    await assert.rejects(client.put(td(ID, { title: "Desired" }), { etag: '"resource-1"' }),
        (error) => code("DirectoryConflict")(error) && error.status === 201);
    assert.equal(fixture.records.get(ID).td.title, "Existing");
    assert.equal(fixture.records.get(ID).etag, '"resource-1"');
});

test("TTL PATCH modifies registration only at the negotiated capability, using the resource ETag", async (t) => {
    let now = NOW;
    const { fixture, client } = await setup(t, { now: () => now });
    fixture.set(ID, td(ID, { title: "Content stays stable", evidence: { observedAt: 1000 }, registration: { ttl: 30 } }));
    let contentType;
    fixture.behavior.beforeWrite = async ({ request }) => { contentType = request.headers["content-type"]; };
    now += 1000;
    await client.renew(ID, { etag: '"resource-1"' }, 5);
    assert.equal(contentType, "application/merge-patch+json");
    assert.deepEqual(fixture.audit[0].body, { registration: { ttl: 5 } });
    assert.equal(fixture.audit[0].ifMatch, '"resource-1"');
    assert.equal(fixture.records.get(ID).expiresAt, NOW + 6000);
    assert.equal(fixture.records.get(ID).created, NOW);
    assert.deepEqual(fixture.records.get(ID).td.evidence, { observedAt: 1000 });
    assert.equal(fixture.records.get(ID).td.title, "Content stays stable");
    await client.renew(ID, { etag: '"resource-2"' });
    assert.deepEqual(fixture.audit[1].body, {});
    assert.equal(fixture.records.get(ID).etag, '"resource-3"');
});

test("unnegotiated TTL/PATCH, TTL bounds and invalid CAS conditions fail before any write", async (t) => {
    const { fixture, client } = await setup(t);
    for (const ttl of [0, -1, 1.5, 31]) {
        await assert.rejects(client.put(td(ID), { create: true }, ttl), code("InvalidConfiguration"));
        await assert.rejects(client.renew(ID, { etag: '"resource-1"' }, ttl), code("InvalidConfiguration"));
    }
    for (const condition of [{ singleWriter: true }, { etag: 'W/"resource-1"' }, { etag: "unquoted" }]) {
        await assert.rejects(client.put(td(ID), condition), code("InvalidConfiguration"));
    }
    const noPatch = new DirectoryClient({ ...fixture.clientOptions(), contract: { ...contract(),
        expiry: { ...contract().expiry, patch: false } } });
    const noTtl = new DirectoryClient({ ...fixture.clientOptions(), contract: { ...contract(),
        expiry: { mode: "bridge-delete", outageLimitation: "Explicit no offline expiry" } } });
    t.after(async () => { await noPatch.close(); await noTtl.close(); });
    await assert.rejects(noPatch.renew(ID, { etag: '"resource-1"' }), code("UnsupportedDirectory"));
    await assert.rejects(noTtl.renew(ID, { etag: '"resource-1"' }), code("UnsupportedDirectory"));
    await assert.rejects(noTtl.put(td(ID), { create: true }, 1), code("UnsupportedDirectory"));
    assert.deepEqual(fixture.audit, []);
});

test("explicit single-writer mode omits CAS and registration TTL rather than pretending ETag negotiation", async (t) => {
    const { fixture, client } = await setup(t, {}, (options) => {
        options.contract.ownership = { mode: "single-writer", evidence: "Dedicated owned writer ACL" };
        options.contract.expiry = { mode: "bridge-delete", outageLimitation: "Offline publisher cannot retire records" };
    });
    await client.put(td(ID, { registration: { ttl: 99 } }), { create: true });
    await client.put(td(ID, { title: "Updated by sole writer" }), { singleWriter: true });
    assert.deepEqual(fixture.audit.map((entry) => [entry.ifMatch, entry.ifNoneMatch]), [[undefined, undefined], [undefined, undefined]]);
    assert.equal(Object.hasOwn(fixture.audit[0].body, "registration"), false);
    assert.equal(fixture.records.get(ID).ttl, undefined);
    assert.equal(fixture.records.get(ID).td.title, "Updated by sole writer");
    await assert.rejects(client.delete(ID, { etag: '"resource-2"' }), code("InvalidConfiguration"));
});

test("DELETE removes only the owned target and handles 404 without pretending a stale If-Match succeeded", async (t) => {
    const { fixture, client } = await setup(t);
    fixture.set(ID, td(ID));
    fixture.set("urn:directory:unrelated", td("urn:directory:unrelated", { title: "Unrelated" }));
    await assert.rejects(client.delete(ID, { etag: '"stale"' }), code("DirectoryConflict"));
    assert.equal(fixture.records.has(ID), true);
    await client.delete(ID, { etag: '"resource-1"' });
    assert.deepEqual([...fixture.records.keys()], ["urn:directory:unrelated"]);
    await assert.rejects(client.delete(ID, { etag: '"resource-1"' }), code("DirectoryConflict"));
    const soleWriter = new DirectoryClient({ ...fixture.clientOptions(), contract: {
        ...contract(), ownership: { mode: "single-writer", evidence: "Explicit sole writer for absent-delete check" }
    } });
    t.after(() => soleWriter.close());
    await soleWriter.delete(ID, { singleWriter: true });
    await soleWriter.delete(ID, { singleWriter: true });
    assert.equal(fixture.records.get("urn:directory:unrelated").td.title, "Unrelated");
    assert.deepEqual(fixture.audit.map((entry) => entry.id), [ID, ID, ID, ID, ID]);
});

test("Directory auth distinguishes absent/reader/writer credentials and denies CRUD without native credential leakage", async (t) => {
    const { fixture } = await setup(t, { writerToken: "directory-writer-only", readerToken: "directory-reader-only" });
    fixture.set(ID, td(ID, { title: "Authorized data" }));
    const reader = new DirectoryClient({ ...fixture.clientOptions("reader"), contract: contract() });
    const unauthenticated = new DirectoryClient({ collectionUrl: fixture.collectionUrl, contract: contract() });
    t.after(async () => { await reader.close(); await unauthenticated.close(); });
    assert.equal((await reader.get(ID)).td.title, "Authorized data");
    assert.deepEqual((await reader.list()).map((value) => value.id), [ID]);
    for (const invoke of [
        () => reader.put(td(ID), { etag: '"resource-1"' }), () => reader.delete(ID, { etag: '"resource-1"' }),
        () => reader.renew(ID, { etag: '"resource-1"' })
    ]) await assert.rejects(invoke(), (error) => code("DirectoryDenied")(error) && error.status === 403);
    await assert.rejects(unauthenticated.get(ID), (error) => code("DirectoryDenied")(error) && error.status === 401);
    await assert.rejects(unauthenticated.list(), (error) => code("DirectoryDenied")(error) && error.status === 401);
    assert.equal(fixture.records.get(ID).td.title, "Authorized data");
    assert.deepEqual(fixture.audit.map((entry) => entry.role), ["reader", "reader", "reader", "reader", "reader", "denied", "denied"]);
    assert.equal(JSON.stringify(fixture.records.get(ID).td).includes("directory-reader-only"), false);
    assert.equal(JSON.stringify(fixture.audit).includes("directory-writer-only"), false);
});

for (const [name, value] of [
    ["query fragment", { id: ID }],
    ["mismatched resource ID", td("urn:wrong:identity")],
    ["malformed nested TD", td(ID, { actions: { read: { forms: [{ href: 42 }] } } })]
]) {
    test(`GET rejects ${name} rather than treating it as a published TD`, async (t) => {
        const { fixture, client } = await setup(t);
        fixture.set(ID, value);
        await assert.rejects(client.get(ID), code("InvalidDirectoryResponse"));
        assert.deepEqual(fixture.records.get(ID).td, value);
        assert.equal(fixture.audit.length, 1);
    });
}

for (const mode of ["missing", "weak"]) {
    test(`GET rejects ${mode} resource ETag instead of borrowing the collection revision for writes`, async (t) => {
        const { fixture, client } = await setup(t);
        fixture.set(ID, td(ID));
        if (mode === "missing") fixture.behavior.omitEtag = true;
        else fixture.records.get(ID).etag = 'W/"resource-1"';
        await client.list(); // Its canonical revision/HTTP ETag must not become the resource CAS token.
        await assert.rejects(client.get(ID), code("UnsupportedDirectory"));
        assert.equal(fixture.audit.every((entry) => entry.method === "GET"), true);
        assert.equal(fixture.records.get(ID).td.id, ID);
    });
}

test("portable find keeps claimed profile, observed service and registered matching-firmware evidence distinct and conjunctive", async (t) => {
    const { fixture, client } = await setup(t);
    const claim = { "onvif:profileClaims": [{ profile: "T", role: "device", evidence: [{ sourceId: "urn:advertised:claim" }] }] };
    const observed = { "onvif:observedServices": [{ namespace: "urn:observed:recording", xaddr: "http://192.0.2.10/native" }] };
    const registered = (match) => ({ "onvif:conformanceEvidence": [{ profile: "T", firmware: "1.2.3",
        matchesObservedFirmware: match, independentlyVerified: false, source: "urn:registered:evidence" }] });
    for (const [id, data] of [
        ["a-claim", claim], ["b-observed", observed], ["c-registered", registered("true")],
        ["d-mismatch", registered("false")], ["e-unknown", registered("unknown")], ["f-boolean-not-proof", registered(true)],
        ["g-badge-not-proof", { profile: ["urn:onvif:profile:T"] }], ["h-combined", { ...claim, ...observed, ...registered("true") }]
    ]) fixture.set(`urn:filter:${id}`, td(`urn:filter:${id}`, data));
    assert.deepEqual((await client.find({ claimedProfile: "T" })).map((value) => value.id), ["urn:filter:a-claim", "urn:filter:h-combined"]);
    assert.deepEqual((await client.find({ observedService: "urn:observed:recording" })).map((value) => value.id),
        ["urn:filter:b-observed", "urn:filter:h-combined"]);
    assert.deepEqual((await client.find({ registeredProfile: "T" })).map((value) => value.id),
        ["urn:filter:c-registered", "urn:filter:h-combined"]);
    const combined = await client.find({ claimedProfile: "T", observedService: "urn:observed:recording", registeredProfile: "T" });
    assert.deepEqual(combined.map((value) => value.id), ["urn:filter:h-combined"]);
    assert.equal(combined[0]["onvif:conformanceEvidence"][0].independentlyVerified, false);
    assert.equal(combined[0].profile, undefined);
    assert.deepEqual(await client.find({ claimedProfile: "G" }), []);
    assert.equal(fixture.records.size, 8);
});

test("Directory close awaits a public in-flight write and rejects all subsequent I/O with RuntimeClosed", async (t) => {
    const { fixture, client } = await setup(t);
    const entered = deferred(), release = deferred();
    fixture.behavior.beforeWrite = async () => { entered.resolve(); await release.promise; };
    const work = client.put(td(ID), { create: true });
    try {
        await waitForGate(entered, work);
        let closed = false;
        const closing = client.close();
        assert.equal(client.close(), closing);
        void closing.then(() => { closed = true; });
        await Promise.resolve();
        assert.equal(closed, false);
        assert.equal(client.pendingRequests, 1);
        release.resolve();
        await work;
        await closing;
        assert.equal(fixture.records.get(ID).td.id, ID);
        for (const invoke of [() => client.get(ID), () => client.list(), () => client.find({}), () => client.preflight(),
            () => client.put(td(ID), { create: true }), () => client.renew(ID, { etag: '"resource-1"' }),
            () => client.delete(ID, { etag: '"resource-1"' })]) {
            await assert.rejects(invoke(), code("RuntimeClosed"));
        }
        assert.equal(client.pendingRequests, 0);
        assert.equal(fixture.audit.length, 1);
    } finally { release.resolve(); await work.catch(() => {}); }
});

test("Directory read retries are bounded and stop at the exact declared backoff without replaying writes", async (t) => {
    let calls = 0;
    const first = deferred();
    const { fixture, client } = await setup(t, {}, (options, owned) => {
        options.maxReadRetries = 1;
        options.http.authorization.bearer = async () => {
            calls++;
            if (calls === 1) { first.resolve(); throw new PublicationError("DirectoryTransport", "retryable public credential provider failure", undefined, true); }
            return owned.writerToken;
        };
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const listing = client.list();
    try {
        await waitForGate(first, listing);
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(249);
        assert.equal(calls, 1);
        t.mock.timers.tick(1);
        assert.deepEqual(await listing, []);
        assert.equal(calls, 2);
        assert.deepEqual(fixture.audit.map((entry) => entry.method), ["GET"]);
    } finally { await client.close(); t.mock.timers.reset(); await listing.catch(() => {}); }
});

test("Directory close cancels a pending read retry and never attempts a second credential lookup", async (t) => {
    let calls = 0;
    const entered = deferred();
    const { fixture, client } = await setup(t, {}, (options) => {
        options.http.authorization.bearer = async () => {
            calls++; entered.resolve(); throw new PublicationError("DirectoryTimeout", "controlled retry", undefined, true);
        };
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const failure = assert.rejects(client.list(), code("RuntimeClosed"));
    try {
        await waitForGate(entered, failure);
        await new Promise((resolve) => setImmediate(resolve));
        await client.close();
        await failure;
        t.mock.timers.tick(1000);
        assert.equal(calls, 1);
        assert.deepEqual(fixture.audit, []);
        assert.equal(client.pendingRequests, 0);
    } finally { t.mock.timers.reset(); }
});
