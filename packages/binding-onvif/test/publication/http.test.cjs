const test = require("node:test");
const assert = require("node:assert/strict");
const { PublicationHttpClient, responseJson, expectStatus } = require("./.compiled/publication/http.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { directory, td } = require("./fixtures/directory.cjs");

const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
const deferred = () => {
    let resolve;
    const promise = new Promise((accept) => { resolve = accept; });
    return { promise, resolve };
};
const waitForGate = (signal, work) => Promise.race([signal.promise, Promise.resolve(work).then(() => {
    throw new Error("Request completed before reaching its public fixture gate");
})]);
async function setup(t, options = {}, transport = {}) {
    const fixture = await directory(options);
    const client = new PublicationHttpClient({ allowedOrigins: [fixture.origin],
        ...fixture.clientOptions().http, ...transport });
    t.after(async () => { try { await client.close(); } finally { await fixture.close(); } });
    return { fixture, client };
}

test("HTTP constructor requires bounded queues/bytes/timeouts, origins and verifiable TLS", async () => {
    for (const options of [
        { allowedOrigins: [] }, { allowedOrigins: ["https://example.invalid/path"] },
        { allowedOrigins: ["https://example.invalid/?q=1"] },
        { timeoutMs: 0 }, { timeoutMs: 120001 }, { maxPending: 0 }, { maxPending: 129 },
        { maxResponseBytes: 0 }, { maxResponseBytes: 67108865 },
        { maxRequestBytes: 1.5 }, { maxRequestBytes: 67108865 },
        { tls: { rejectUnauthorized: false } }, { tls: { minVersion: "TLSv1" } },
        { authorization: { origin: "https://example.invalid", principal: "", bearer: async () => "synthetic" } }
    ]) {
        assert.throws(() => new PublicationHttpClient({ allowedOrigins: ["https://example.invalid"], ...options }),
            code("InvalidConfiguration"));
    }
    const maximum = new PublicationHttpClient({ allowedOrigins: ["https://example.invalid"], timeoutMs: 120000,
        maxRequestBytes: 67108864, maxResponseBytes: 67108864, maxPending: 128, tls: { minVersion: "TLSv1.3" } });
    assert.equal(maximum.pendingRequests, 0);
    await maximum.close();
    await assert.rejects(maximum.request("GET", "https://example.invalid/"), code("RuntimeClosed"));
});

test("real HTTP uses only Directory bearer identity and transmits the exact JSON/conditional headers", async (t) => {
    const { fixture, client } = await setup(t, { writerToken: "directory-writer-only", readerToken: "directory-reader-only" });
    let headers;
    fixture.behavior.beforeWrite = async ({ request }) => {
        headers = { authorization: request.headers.authorization, type: request.headers["content-type"],
            accept: request.headers.accept, encoding: request.headers["accept-encoding"] };
    };
    const body = td("urn:wire:camera", { title: "Wire camera", native: { href: "http://camera.invalid/exact" } });
    const response = await client.request("PUT", `${fixture.collectionUrl}/urn%3Awire%3Acamera`, body, { "If-None-Match": "*" });
    assert.equal(response.status, 201);
    assert.deepEqual(headers, { authorization: "Bearer directory-writer-only", type: "application/td+json",
        accept: "application/td+json, application/ld+json, application/json", encoding: "identity" });
    assert.deepEqual(fixture.audit.map(({ method, role, id, body, ifNoneMatch }) => ({ method, role, id, body, ifNoneMatch })),
        [{ method: "PUT", role: "writer", id: "urn:wire:camera", body, ifNoneMatch: "*" }]);
    assert.equal(fixture.records.get("urn:wire:camera").td.title, "Wire camera");
    assert.equal(JSON.stringify(fixture.audit).includes("directory-writer-only"), false);
    assert.equal(client.pendingRequests, 0);
});

test("transport rejects foreign origins and credential forwarding even when both owned origins are allowed", async (t) => {
    const first = await directory(), second = await directory();
    let bearerCalls = 0;
    const client = new PublicationHttpClient({ allowedOrigins: [first.origin, second.origin], authorization: {
        origin: first.origin, principal: "directory-only", bearer: async () => { bearerCalls++; return first.writerToken; }
    } });
    const deny = new PublicationHttpClient({ allowedOrigins: [first.origin] });
    t.after(async () => {
        await Promise.all([client.close(), deny.close()]);
        await Promise.all([first.close(), second.close()]);
    });
    await assert.rejects(client.request("GET", second.collectionUrl), code("PolicyDenied"));
    await assert.rejects(deny.request("GET", second.collectionUrl), code("PolicyDenied"));
    assert.equal(bearerCalls, 0);
    assert.deepEqual(first.audit, []);
    assert.deepEqual(second.audit, []);
});

test("transport-owned headers cannot be overridden with any casing", async (t) => {
    const { fixture, client } = await setup(t);
    for (const name of ["Authorization", "authorization", "HOST", "Content-Length", "Connection"]) {
        await assert.rejects(client.request("GET", fixture.collectionUrl, undefined, { [name]: "override" }), code("PolicyDenied"));
    }
    assert.deepEqual(fixture.audit, []);
    assert.equal(client.pendingRequests, 0);
});

test("invalid bearer partitions fail explicitly before issuing HTTP", async (t) => {
    const fixture = await directory();
    const clients = [];
    t.after(async () => { await Promise.all(clients.map((client) => client.close())); await fixture.close(); });
    for (const token of ["", "with space", "with\tcontrol", "line\nbreak", "a".repeat(16385)]) {
        const client = new PublicationHttpClient({ allowedOrigins: [fixture.origin], authorization: {
            origin: fixture.origin, principal: "directory-writer", bearer: async () => token
        } });
        clients.push(client);
        await assert.rejects(client.request("GET", fixture.collectionUrl), code("InvalidCredential"));
        assert.equal(client.pendingRequests, 0);
    }
    assert.deepEqual(fixture.audit, []);
});

test("request byte limit counts UTF8 and accepts the exact limit, not the adjacent overflow", async (t) => {
    const { fixture, client } = await setup(t, { auth: false }, { authorization: undefined, maxRequestBytes: 10 });
    const response = await client.request("PUT", `${fixture.collectionUrl}/urn%3Abytes`, { x: "é" });
    assert.equal(response.status, 400); // The transport sent JSON; it is deliberately not a complete TD.
    assert.deepEqual(fixture.audit[0].body, { x: "é" });
    const smaller = new PublicationHttpClient({ allowedOrigins: [fixture.origin], maxRequestBytes: 9 });
    t.after(() => smaller.close());
    await assert.rejects(smaller.request("PUT", `${fixture.collectionUrl}/urn%3Abytes`, { x: "é" }), code("PublicationLimit"));
    assert.equal(fixture.audit.length, 1);
    assert.equal(fixture.records.size, 0);
});

test("response byte limit accepts a two-byte empty list and rejects one-byte capacity without empty-success fallback", async (t) => {
    const { fixture, client } = await setup(t, {}, { maxResponseBytes: 2 });
    const response = await client.request("GET", fixture.collectionUrl);
    assert.equal(response.status, 200);
    assert.equal(response.body.toString("utf8"), "[]");
    const tooSmall = new PublicationHttpClient({ allowedOrigins: [fixture.origin],
        ...fixture.clientOptions().http, maxResponseBytes: 1 });
    t.after(() => tooSmall.close());
    await assert.rejects(tooSmall.request("GET", fixture.collectionUrl), code("PublicationLimit"));
    assert.deepEqual(fixture.audit.map((entry) => entry.method), ["GET", "GET"]);
    assert.equal(tooSmall.pendingRequests, 0);
});

test("pending bearer work consumes capacity and close awaits it before rejecting post-close work", async (t) => {
    const entered = deferred(), release = deferred();
    const owned = await directory();
    const transport = new PublicationHttpClient({ allowedOrigins: [owned.origin], maxPending: 1, authorization: {
        origin: owned.origin, principal: "directory-writer", bearer: async () => { entered.resolve(); await release.promise; return owned.writerToken; }
    } });
    t.after(async () => { release.resolve(); await transport.close(); await owned.close(); });
    const work = transport.request("GET", owned.collectionUrl);
    const rejected = assert.rejects(work, code("RuntimeClosed"));
    await waitForGate(entered, work);
    assert.equal(transport.pendingRequests, 1);
    await assert.rejects(transport.request("GET", owned.collectionUrl), code("PublicationLimit"));
    let finished = false;
    const close = transport.close().then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    release.resolve();
    await rejected;
    await close;
    assert.equal(transport.pendingRequests, 0);
    await assert.rejects(transport.request("GET", owned.collectionUrl), code("RuntimeClosed"));
    assert.deepEqual(owned.audit, []);
});

test("close waits for a real gated in-flight write and shares its completion promise", async (t) => {
    const { fixture, client } = await setup(t);
    const entered = deferred(), release = deferred();
    fixture.behavior.beforeWrite = async () => { entered.resolve(); await release.promise; };
    t.after(() => release.resolve());
    const work = client.request("PUT", `${fixture.collectionUrl}/urn%3Agated`, td("urn:gated"), { "If-None-Match": "*" });
    try {
        await waitForGate(entered, work);
        let closed = false;
        const close = client.close();
        assert.equal(client.close(), close);
        void close.then(() => { closed = true; });
        await Promise.resolve();
        assert.equal(closed, false);
        assert.equal(client.pendingRequests, 1);
        release.resolve();
        assert.equal((await work).status, 201);
        await close;
        assert.equal(closed, true);
        assert.equal(fixture.records.get("urn:gated").td.id, "urn:gated");
        assert.equal(client.pendingRequests, 0);
    } finally { release.resolve(); await work.catch(() => {}); }
});

test("a controlled request deadline rejects typed DirectoryTimeout and never treats an unconfirmed write as success", async (t) => {
    const { fixture, client } = await setup(t, {}, { timeoutMs: 50 });
    const entered = deferred(), release = deferred();
    fixture.behavior.beforeWrite = async () => { entered.resolve(); await release.promise; };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const work = client.request("PUT", `${fixture.collectionUrl}/urn%3Atimeout`, td("urn:timeout"));
    const rejected = assert.rejects(work, (error) => error instanceof PublicationError
        && error.code === "DirectoryTimeout" && error.retryable === false && error.status === undefined);
    try {
        await waitForGate(entered, work);
        t.mock.timers.tick(49);
        assert.equal(client.pendingRequests, 1);
        t.mock.timers.tick(1);
        await rejected;
        assert.equal(client.pendingRequests, 0);
        assert.equal(fixture.audit[0].id, "urn:timeout");
    } finally {
        release.resolve();
        t.mock.timers.reset();
        await work.catch(() => {});
    }
});

test("responseJson validates all negotiated media types and concrete UTF8 JSON", () => {
    for (const type of ["application/json", "application/ld+json", "application/td+json", "application/tm+json",
        "application/schema+json", " Application/TD+JSON ; charset=utf-8"]) {
        const response = { status: 200, headers: { "content-type": type }, body: Buffer.from('{"title":"caméra","count":2}') };
        assert.deepEqual(responseJson(response), { title: "caméra", count: 2 });
        assert.equal(response.body.toString(), '{"title":"caméra","count":2}');
    }
    for (const headers of [{}, { "content-type": "text/html" }, { "content-type": "application/problem+json" }]) {
        assert.throws(() => responseJson({ status: 200, headers, body: Buffer.from("{}") }), code("InvalidDirectoryResponse"));
    }
    for (const body of [Buffer.from(""), Buffer.from("{broken"), Buffer.from([0xc3, 0x28])]) {
        assert.throws(() => responseJson({ status: 200, headers: { "content-type": "application/json" }, body }),
            (error) => code("InvalidDirectoryResponse")(error) && error.status === 200);
    }
});

test("expectStatus maps denial, CAS, redirects and retryable service errors without output-mode fallback", () => {
    for (const status of [200, 201, 204]) assert.doesNotThrow(() => expectStatus({ status }, [200, 201, 204]));
    for (const [status, expected, retryable] of [
        [401, "DirectoryDenied", false], [403, "DirectoryDenied", false],
        [409, "DirectoryConflict", false], [412, "DirectoryConflict", false],
        [404, "UnsupportedDirectory", false], [405, "UnsupportedDirectory", false], [501, "UnsupportedDirectory", false],
        [301, "DirectoryRedirect", false], [307, "DirectoryRedirect", false], [399, "DirectoryRedirect", false],
        [400, "DirectoryResponse", false], [500, "DirectoryResponse", false],
        [429, "DirectoryResponse", true], [502, "DirectoryResponse", true],
        [503, "DirectoryResponse", true], [504, "DirectoryResponse", true]
    ]) {
        assert.throws(() => expectStatus({ status }, [200]),
            (error) => code(expected)(error) && error.status === status && error.retryable === retryable
                && error.message.includes("no output-mode fallback"));
    }
});

test("the configured request deadline also bounds a pending Directory bearer lookup before HTTP is sent", async (t) => {
    const fixture = await directory(), entered = deferred(), release = deferred();
    const client = new PublicationHttpClient({ allowedOrigins: [fixture.origin], timeoutMs: 50, authorization: {
        origin: fixture.origin, principal: "directory-only",
        bearer: async () => { entered.resolve(); await release.promise; return fixture.writerToken; }
    } });
    t.after(async () => { release.resolve(); await client.close(); await fixture.close(); });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let outcome;
    const request = client.request("GET", fixture.collectionUrl);
    const settled = request.then(
        (value) => { outcome = { status: value.status }; },
        (error) => { outcome = { code: error.code, retryable: error.retryable }; }
    );
    try {
        await waitForGate(entered, request);
        t.mock.timers.tick(50);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(outcome, { code: "DirectoryTimeout", retryable: true });
        assert.equal(client.pendingRequests, 0);
        assert.deepEqual(fixture.audit, []);
    } finally {
        release.resolve();
        await client.close();
        await settled;
        t.mock.timers.reset();
    }
});
