const test = require("node:test");
const assert = require("node:assert/strict");
const { DirectoryClient } = require("./.compiled/publication/directory.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("../../../fixtures/reference-runtime/publication/directory.cjs");

const ID = "urn:preflight:owned";
const OTHER = "urn:preflight:unrelated";
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
async function setup(t, configure = () => {}) {
    let now = 1700000000000;
    const fixture = await directory({ now: () => now, writerToken: "directory-preflight-writer", readerToken: "directory-preflight-reader" });
    fixture.contract.verification = { mode: "owned-roundtrip", id: ID };
    fixture.set(OTHER, td(OTHER, { title: "Must survive preflight" }));
    const options = fixture.clientOptions();
    configure(options, fixture, (value) => { now = value; });
    const client = new DirectoryClient(options);
    t.after(async () => { try { await client.close(); } finally { await fixture.close(); } });
    return { fixture, client };
}

test("owned preflight demonstrates GET/List/PUT-create/PUT-replace/stale-CAS/PATCH/DELETE and removes only its own ID", async (t) => {
    const { fixture, client } = await setup(t);
    await client.preflight();
    assert.deepEqual(fixture.audit.map((entry) => entry.method),
        ["GET", "GET", "PUT", "GET", "GET", "PUT", "GET", "PUT", "PATCH", "GET", "DELETE", "GET"]);
    const writes = fixture.audit.filter((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method));
    assert.deepEqual(writes.map((entry) => entry.id), [ID, ID, ID, ID, ID]);
    assert.deepEqual(writes.map((entry) => [entry.ifMatch, entry.ifNoneMatch]),
        [[undefined, "*"], ['"resource-2"', undefined], ['"resource-2"', undefined], ['"resource-3"', undefined], ['"resource-4"', undefined]]);
    assert.equal(writes[0].body.title, "Owned ONVIF publication preflight");
    assert.equal(writes[1].body.title, "Owned ONVIF publication preflight update");
    assert.deepEqual(writes[0].body.registration, { ttl: 30 });
    assert.deepEqual(writes[3].body, {});
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
    assert.equal(fixture.records.get(OTHER).td.title, "Must survive preflight");
    assert.equal(fixture.audit.every((entry) => entry.role === "writer"), true);
    assert.equal(JSON.stringify(fixture.audit).includes("directory-preflight-writer"), false);
});

test("attested preflight still validates listing but performs no mutation probe", async (t) => {
    const { fixture, client } = await setup(t, (options) => {
        options.contract.verification = { mode: "attested", evidence: "Owned CRUDL and ACL attestation" };
    });
    await client.preflight();
    assert.deepEqual(fixture.audit.map(({ method, path }) => ({ method, path })), [{ method: "GET", path: "/things?limit=2&offset=0" }]);
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
});

test("existing preflight ID is an explicit conflict and is neither overwritten nor deleted", async (t) => {
    const { fixture, client } = await setup(t);
    fixture.set(ID, td(ID, { title: "Independent existing preflight ID", marker: 17 }));
    await assert.rejects(client.preflight(), code("DirectoryConflict"));
    assert.equal(fixture.records.get(ID).td.title, "Independent existing preflight ID");
    assert.equal(fixture.records.get(ID).td.marker, 17);
    assert.equal(fixture.records.get(ID).etag, '"resource-2"');
    assert.deepEqual(fixture.audit.map((entry) => entry.method), ["GET", "GET"]);
    assert.equal(fixture.records.get(OTHER).td.title, "Must survive preflight");
});

test("preflight reader credentials cannot pass writer verification or remove other registrations", async (t) => {
    const { fixture, client } = await setup(t, (options, owned) => { options.http = owned.clientOptions("reader").http; });
    await assert.rejects(client.preflight(), (error) => code("DirectoryDenied")(error) && error.status === 403);
    assert.deepEqual(fixture.audit.map((entry) => [entry.method, entry.role]), [["GET", "reader"], ["GET", "reader"], ["PUT", "reader"]]);
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
});

for (const [stage, method, status, expected] of [
    ["create", "PUT", 403, "DirectoryDenied"],
    ["replace", "PUT", 405, "UnsupportedDirectory"],
    ["renew", "PATCH", 501, "UnsupportedDirectory"],
    ["delete", "DELETE", 403, "DirectoryDenied"]
]) {
    test(`preflight explicitly reports ${stage} denial rather than a successful export fallback`, async (t) => {
        const { fixture, client } = await setup(t);
        let injected = false;
        fixture.behavior.beforeWrite = async ({ request, body }) => {
            const isStage = request.method === method
                && (stage !== "replace" || body?.title === "Owned ONVIF publication preflight update")
                && (stage !== "create" || body?.title === "Owned ONVIF publication preflight");
            if (isStage && !injected) { fixture.behavior.nextWriteStatus = status; injected = true; }
        };
        await assert.rejects(client.preflight(), (error) => code(expected)(error) && error.status === status);
        assert.equal(injected, true);
        assert.equal(fixture.records.get(OTHER).td.title, "Must survive preflight");
        assert.equal(fixture.audit.filter((entry) => entry.method === "DELETE").every((entry) => entry.id === ID), true);
        if (stage !== "delete") assert.deepEqual([...fixture.records.keys()], [OTHER]);
    });
}

test("preflight rejects a Directory that acknowledges TTL creation but omits TTL/expiry and cleans only its probe", async (t) => {
    const { fixture, client } = await setup(t);
    let requested;
    fixture.behavior.beforeWrite = async ({ request, body }) => {
        if (request.method === "PUT") { requested = structuredClone(body.registration); delete body.registration; }
    };
    await assert.rejects(client.preflight(), code("UnsupportedDirectory"));
    assert.deepEqual(requested, { ttl: 30 });
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
    assert.deepEqual(fixture.audit.filter((entry) => entry.method === "DELETE").map((entry) => entry.id), [ID]);
});

test("preflight rejects acknowledged PATCH renewal that does not extend the negotiated registration expiry", async (t) => {
    let advance;
    const { fixture, client } = await setup(t, (_options, _fixture, setNow) => { advance = setNow; });
    let oldExpiry;
    fixture.behavior.beforeWrite = async ({ request, records }) => {
        if (request.method === "PATCH") {
            oldExpiry = records.get(ID).expiresAt;
            advance(1700000005000);
            fixture.behavior.nextWriteStatus = 204; // Deliberate success without applying the renewal.
        }
    };
    await assert.rejects(client.preflight(), code("UnsupportedDirectory"));
    assert.equal(oldExpiry, 1700000030000);
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
    assert.equal(fixture.audit.filter((entry) => entry.method === "PATCH").length, 1);
});

test("preflight rejects a Directory that acknowledges a stale conditional write instead of enforcing CAS", async (t) => {
    const { fixture, client } = await setup(t);
    let staleRejectedByProbe = false;
    fixture.behavior.beforeWrite = async ({ request, records }) => {
        if (request.method === "PUT" && request.headers["if-match"]
            && request.headers["if-match"] !== records.get(ID)?.etag) {
            staleRejectedByProbe = true;
            fixture.behavior.nextWriteStatus = 204;
        }
    };
    await assert.rejects(client.preflight(), code("UnsupportedDirectory"));
    assert.equal(staleRejectedByProbe, true);
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
    assert.equal(fixture.audit.filter((entry) => entry.method === "DELETE").length, 1);
});

test("preflight retains the ignored-CAS diagnosis when a genuinely applied stale write also causes cleanup conflict", async (t) => {
    const { fixture, client } = await setup(t);
    let ignored = false;
    fixture.behavior.beforeWrite = async ({ request, records }) => {
        if (request.method === "PUT" && request.headers["if-match"]
            && request.headers["if-match"] !== records.get(ID)?.etag) {
            delete request.headers["if-match"]; // Public fixture hook simulates a server ignoring CAS.
            ignored = true;
        }
    };
    await assert.rejects(client.preflight(), (error) => code("UnsupportedDirectory")(error)
        || (error instanceof AggregateError && error.errors.some(code("UnsupportedDirectory"))));
    assert.equal(ignored, true);
    assert.equal(fixture.records.get(OTHER).td.title, "Must survive preflight");
    assert.equal(fixture.audit.filter((entry) => entry.method === "DELETE").every((entry) => entry.id === ID), true);
});

test("sole-writer preflight cleans its confirmed-created ID even when the Directory readback is malformed", async (t) => {
    const { fixture, client } = await setup(t, (options) => {
        options.contract.ownership = { mode: "single-writer", evidence: "Exclusive owned writer ACL; cleanup cannot clobber another writer" };
    });
    fixture.behavior.beforeWrite = async ({ request, body, set }) => {
        if (request.method === "PUT") {
            set(ID, { ...body, securityDefinitions: [] });
            fixture.behavior.nextWriteStatus = 201;
        }
    };
    await assert.rejects(client.preflight(), code("InvalidDirectoryResponse"));
    assert.equal(fixture.records.has(ID), false, "The positively created probe must be cleaned under the explicit sole-writer contract");
    assert.equal(fixture.records.get(OTHER).td.title, "Must survive preflight");
    assert.deepEqual(fixture.audit.filter((entry) => entry.method === "DELETE").map((entry) => entry.id), [ID]);
});

test("preflight never attempts PATCH when only PUT-based TTL renewal was negotiated", async (t) => {
    const { fixture, client } = await setup(t, (options) => { options.contract.expiry.patch = false; });
    await client.preflight();
    assert.equal(fixture.audit.some((entry) => entry.method === "PATCH"), false);
    assert.equal(fixture.audit.filter((entry) => entry.method === "PUT").length, 3);
    assert.deepEqual([...fixture.records.keys()], [OTHER]);
});
