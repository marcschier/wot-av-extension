const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { createOnvifRuntime, defineOperationRegistry } = require("../../dist");
const fixtures = require("../fixtures/operations.cjs");
const wire = require("../fixtures/endpoint.cjs");

const registry = () => defineOperationRegistry(fixtures.operations);
const hash = (algorithm, value) => createHash(algorithm).update(value).digest("hex");

function verifyDigest(header, request, body, { algorithm, realm, nonce, qop, username, password }) {
    assert.ok(header.startsWith("Digest "));
    const fields = Object.fromEntries([...header.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)=(?:"((?:\\.|[^"])*)"|([^,\s]+))/g)]
        .map((match) => [match[1], (match[2] ?? match[3]).replace(/\\(.)/g, "$1")]));
    assert.equal(fields.username, username);
    assert.equal(fields.realm, realm);
    assert.equal(fields.nonce, nonce);
    assert.equal(fields.algorithm, algorithm);
    assert.equal(fields.qop, qop);
    assert.equal(fields.uri, request.url);
    assert.equal(fields.nc, "00000001");
    assert.ok(fields.cnonce.length >= 16);
    const h = algorithm === "MD5" ? "md5" : "sha256";
    const a1 = hash(h, `${username}:${realm}:${password}`);
    const a2 = hash(h, `${request.method}:${request.url}${qop === "auth-int" ? `:${hash(h, body)}` : ""}`);
    assert.equal(fields.response, hash(h, `${a1}:${nonce}:${fields.nc}:${fields.cnonce}:${qop}:${a2}`));
}

function credentials(origin, scopes) {
    return async (scope) => {
        scopes.push(scope);
        await delay(2);
        return {
            origin, principal: scope.principal, ...(scope.realm === undefined ? {} : { realm: scope.realm }),
            material: { kind: "password", username: scope.principal, password: `secret-${scope.principal}` }
        };
    };
}

for (const [algorithm, qop, stale] of [
    ["MD5", "auth", false], ["SHA-256", "auth", false], ["SHA-256", "auth-int", true]
]) {
    test(`gate: native Digest ${algorithm}/${qop}${stale ? " with stale nonce" : ""}`, { timeout: 15000 }, async (t) => {
        const scopes = [];
        const realm = "independent native realm";
        const server = await wire.endpoint((request, response, body, count) => {
            wire.verifyInformation(request, body);
            const nonce = count <= 2 ? "initial-fixture-nonce" : "renewed-fixture-nonce";
            if (count > 1) {
                verifyDigest(request.headers.authorization, request, body, {
                    algorithm, qop, realm, nonce, username: "alice", password: "secret-alice"
                });
            }
            if (count === 1 || (stale && count === 2)) {
                response.writeHead(401, { "WWW-Authenticate":
                    `Digest realm="${realm}", nonce="${count === 1 ? "initial-fixture-nonce" : "renewed-fixture-nonce"}", algorithm=${algorithm}, qop="${qop}"${count === 2 ? ", stale=true" : ""}` });
                response.end();
            } else wire.reply(response);
        });
        t.after(() => server.close());
        const runtime = await createOnvifRuntime({
            registry: registry(), trust: { allowedOrigins: [server.origin] },
            credentials: credentials(server.origin, scopes),
            digest: { algorithms: ["SHA-256", "MD5"], qops: ["auth-int", "auth"] }
        });
        t.after(() => runtime.close());
        const description = fixtures.td(`${server.url}?token=0007`);
        description.actions.information.forms[0].security = ["digest"];
        const thing = await runtime.consume(description, { principal: "alice" });
        assert.equal((await (await thing.invokeAction("information")).value()).HardwareId, "0000");
        assert.equal(server.requests.length, stale ? 3 : 2);
        assert.ok(scopes.every((scope) => scope.realm === realm && scope.origin === server.origin && scope.principal === "alice"));
        assert.ok(!JSON.stringify(thing.getThingDescription()).includes("secret-alice"));
    });
}

test("gate: cached scheme client cannot leak across per-request realm, principal or form security override", { timeout: 20000 }, async (t) => {
    const warnings = [];
    const onWarning = (warning) => { if (warning.name === "MaxListenersExceededWarning") warnings.push(warning); };
    process.on("warning", onWarning);
    t.after(() => {
        process.removeListener("warning", onWarning);
        assert.deepEqual(warnings, [], "Reused sockets must not accumulate connection listeners");
    });
    const scopes = [];
    const server = await wire.endpoint((request, response, body) => {
        wire.verifyInformation(request, body);
        const url = new URL(request.url, "http://fixture.invalid");
        const realm = url.searchParams.get("realm");
        if (!realm) {
            assert.equal(request.headers.authorization, undefined);
            wire.reply(response);
            return;
        }
        if (!request.headers.authorization) {
            response.writeHead(401, { "WWW-Authenticate": `Digest realm="${realm}",nonce="n-${realm}",algorithm=SHA-256,qop="auth"` });
            response.end();
            return;
        }
        const username = /username="([^"]+)"/.exec(request.headers.authorization)[1];
        verifyDigest(request.headers.authorization, request, body, {
            algorithm: "SHA-256", qop: "auth", realm, nonce: `n-${realm}`, username, password: `secret-${username}`
        });
        wire.reply(response);
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin] },
        credentials: credentials(server.origin, scopes)
    });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url, { security: ["digest"] });
    description.actions.information.forms = [
        fixtures.form(`${server.url}?realm=first`, fixtures.device, ["digest"]),
        fixtures.form(server.url, fixtures.device, ["none"]),
        fixtures.form(`${server.url}?realm=second`, fixtures.device, ["digest"])
    ];
    delete description.actions.information.forms[0].security;
    const alice = await runtime.consume(description, { principal: "alice" });
    const bob = await runtime.consume({ ...description, id: "urn:wot-av:test:bob" }, { principal: "bob" });
    for (const thing of [alice, bob, alice]) {
        for (const formIndex of [0, 1, 2, 1, 0]) {
            await (await thing.invokeAction("information", undefined, { formIndex })).value();
        }
    }
    assert.deepEqual(new Set(scopes.map((scope) => `${scope.principal}/${scope.realm}`)),
        new Set(["alice/first", "alice/second", "bob/first", "bob/second"]));
    assert.equal(server.requests.length, 24);
});

test("gate: ordinary HTTP keeps Basic/Bearer/nosec, custom headers and awaited credential behavior", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response) => {
        assert.equal(request.method, "GET");
        assert.equal(request.headers["x-fixture"], "preserved");
        const expected = request.url === "/basic" ? `Basic ${Buffer.from("alice:secret-alice").toString("base64")}`
            : request.url === "/bearer" ? "Bearer ordinary-fixture-token" : undefined;
        assert.equal(request.headers.authorization, expected);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"serial":"0000"}');
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin] },
        credentials: async (scope) => {
            await delay(15);
            return {
                origin: server.origin, principal: scope.principal,
                material: scope.scheme === "bearer" ? { kind: "http", value: { token: "ordinary-fixture-token" } }
                    : { kind: "password", username: "alice", password: "secret-alice" }
            };
        }
    });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url, {
        security: ["basic"],
        properties: Object.fromEntries(["basic", "none", "bearer"].map((scheme) => [scheme, {
            type: "object", readOnly: true,
            forms: [{
                href: `${server.origin}/${scheme}`, op: "readproperty", contentType: "application/json",
                security: [scheme], "htv:headers": [{ "htv:fieldName": "X-Fixture", "htv:fieldValue": "preserved" }]
            }]
        }]))
    });
    const thing = await runtime.consume(description, { principal: "alice" });
    for (let i = 0; i < 2; i++) {
        const results = await Promise.all(["basic", "none", "bearer"].map(async (name) =>
            (await thing.readProperty(name)).value()));
        assert.deepEqual(results, [{ serial: "0000" }, { serial: "0000" }, { serial: "0000" }]);
    }
});

test("gate: WSSE token has exact namespaces, fresh nonce/Created, injected clock offset, no HTTP bearer default", { timeout: 15000 }, async (t) => {
    const observed = [];
    const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
    const WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
    const server = await wire.endpoint((request, response, body) => {
        const { document } = wire.verifyInformation(request, body);
        assert.equal(request.headers.authorization, undefined);
        const created = wire.one(document, WSU, "Created").textContent;
        const nonce = wire.one(document, WSSE, "Nonce").textContent;
        const password = wire.one(document, WSSE, "Password");
        assert.equal(wire.one(document, WSSE, "Username").textContent, "alice");
        assert.equal(password.getAttribute("Type"),
            "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest");
        assert.equal(password.textContent, createHash("sha1").update(Buffer.from(nonce, "base64"))
            .update(created).update("secret-alice").digest("base64"));
        observed.push({ created, nonce });
        assert.ok(!body.includes("secret-alice"));
        wire.reply(response);
    });
    t.after(() => server.close());
    let tick = 0;
    let nonceCounter = 1;
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin] },
        credentials: credentials(server.origin, []),
        clock: () => new Date(Date.parse("2026-09-15T10:00:00Z") + tick++ * 1000),
        nonce: () => Buffer.alloc(16, nonceCounter++),
        usernameToken: { offsetMs: 5000, maxOffsetMs: 10000 }
    });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url);
    description.actions.information.forms[0].security = ["wsse"];
    const thing = await runtime.consume(description, { principal: "alice" });
    await (await thing.invokeAction("information")).value();
    await (await thing.invokeAction("information")).value();
    assert.deepEqual(observed.map((value) => value.created),
        ["2026-09-15T10:00:05.000Z", "2026-09-15T10:00:06.000Z"]);
    assert.equal(new Set(observed.map((value) => value.nonce)).size, 2);
});

test("gate: credentials cannot cross origin; redirects are not followed and URI userinfo is rejected", { timeout: 15000 }, async (t) => {
    const destination = await wire.endpoint((request, response) => {
        assert.equal(request.headers.authorization, undefined, "No origin-A credential reaches origin B");
        response.writeHead(401, { "WWW-Authenticate": 'Digest realm="foreign",nonce="foreign",algorithm=SHA-256,qop="auth"' });
        response.end();
    });
    t.after(() => destination.close());
    const source = await wire.endpoint((request, response) => {
        response.writeHead(307, { Location: destination.url });
        response.end();
    });
    t.after(() => source.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [source.origin, destination.origin] },
        credentials: credentials(source.origin, [])
    });
    t.after(() => runtime.close());
    const description = fixtures.td(source.url);
    const thing = await runtime.consume(description);
    await assert.rejects(thing.invokeAction("information"), { code: "PolicyDenied" });
    assert.equal(destination.requests.length, 0);
    description.actions.information.forms[0] = fixtures.form(destination.url, fixtures.device, ["digest"]);
    const foreign = await runtime.consume(description, { principal: "alice" });
    await assert.rejects(foreign.invokeAction("information"), { code: "PolicyDenied" });
    assert.equal(destination.requests.length, 1, "Only the credential-free challenge request is sent");
    const userinfo = fixtures.td(source.url.replace("http://", "http://user:secret@"));
    await assert.rejects(runtime.consume(userinfo), { code: "PolicyDenied" });
    assert.equal(source.requests.length, 1);
});

test("gate: TLS rejects untrusted issuer and succeeds only with explicitly provisioned CA", { timeout: 20000 }, async (t) => {
    const selfsigned = require("selfsigned");
    const pair = selfsigned.generate([{ name: "commonName", value: "independent-loopback" }], {
        keySize: 2048, days: 2, algorithm: "sha256",
        extensions: [
            { name: "basicConstraints", cA: true },
            { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
            { name: "extKeyUsage", serverAuth: true },
            { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }
        ]
    });
    const server = await wire.endpoint((request, response, body) => {
        wire.verifyInformation(request, body);
        wire.reply(response);
    }, { key: pair.private, cert: pair.cert });
    t.after(() => server.close());
    const untrusted = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => untrusted.close());
    const first = await untrusted.consume(fixtures.td(server.url));
    await assert.rejects(first.invokeAction("information"), { code: "TransportError", execution: "not-sent" });
    assert.equal(server.requests.length, 0);
    const trusted = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin], tls: { ca: pair.cert } }
    });
    t.after(() => trusted.close());
    const second = await trusted.consume(fixtures.td(server.url));
    assert.equal((await (await second.invokeAction("information")).value()).HardwareId, "0000");
    assert.equal(server.requests.length, 1);
});

test("gate: unsupported native auth is not treated as nosec or a bearer default", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint(() => assert.fail("Unsupported authentication must not invoke"));
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({ registry: registry(), trust: { allowedOrigins: [server.origin] } });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url);
    description.actions.information.forms[0].security = ["bearer"];
    await assert.rejects(runtime.consume(description), { code: "UnsupportedCapability" });
    description.actions.information.forms[0].security = ["none", "digest"];
    await assert.rejects(runtime.consume(description), { code: "InvalidSecurity" });
    assert.equal(server.requests.length, 0);
});

test("gate: ordinary HTTP cannot redirect Basic/Bearer credentials to another approved origin", { timeout: 15000 }, async (t) => {
    const target = await wire.endpoint(() => assert.fail("Redirect target must not be contacted"));
    t.after(() => target.close());
    const source = await wire.endpoint((request, response) => {
        assert.equal(request.headers.authorization, "Bearer scoped-http-token");
        response.writeHead(307, { Location: target.url });
        response.end();
    });
    t.after(() => source.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [source.origin, target.origin] },
        credentials: async (scope) => ({
            origin: source.origin, principal: scope.principal,
            material: { kind: "http", value: { token: "scoped-http-token" } }
        })
    });
    t.after(() => runtime.close());
    const description = fixtures.td(source.url, { properties: {
        value: { type: "object", readOnly: true, forms: [
            { href: source.url, op: "readproperty", contentType: "application/json", security: ["bearer"] }
        ] }
    } });
    const thing = await runtime.consume(description);
    await assert.rejects(thing.readProperty("value"), { code: "PolicyDenied" });
    assert.equal(target.requests.length, 0);
});

test("gate: Digest and WSSE are a real conjunction only when both are explicitly requested", { timeout: 15000 }, async (t) => {
    const nonces = [];
    const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
    const server = await wire.endpoint((request, response, body, count) => {
        const { document } = wire.verifyInformation(request, body);
        assert.equal(wire.one(document, WSSE, "Username").textContent, "alice");
        nonces.push(wire.one(document, WSSE, "Nonce").textContent);
        if (count === 1) {
            assert.equal(request.headers.authorization, undefined);
            response.writeHead(401, { "WWW-Authenticate": 'Digest realm="and",nonce="both",algorithm=SHA-256,qop="auth-int"' });
            response.end();
        } else {
            verifyDigest(request.headers.authorization, request, body, {
                algorithm: "SHA-256", qop: "auth-int", realm: "and", nonce: "both",
                username: "alice", password: "secret-alice"
            });
            wire.reply(response);
        }
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin] },
        credentials: credentials(server.origin, [])
    });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url);
    description.actions.information.forms[0].security = ["digest", "wsse"];
    const thing = await runtime.consume(description, { principal: "alice" });
    await (await thing.invokeAction("information")).value();
    assert.equal(server.requests.length, 2);
    assert.equal(new Set(nonces).size, 2, "The WSSE nonce is fresh even during Digest negotiation");
});

test("gate: an explicitly trusted CA does not bypass TLS hostname identity", { timeout: 20000 }, async (t) => {
    const pair = require("selfsigned").generate([{ name: "commonName", value: "wrong.example.invalid" }], {
        keySize: 2048, days: 2, algorithm: "sha256",
        extensions: [{ name: "basicConstraints", cA: true },
            { name: "subjectAltName", altNames: [{ type: 2, value: "wrong.example.invalid" }] }]
    });
    const server = await wire.endpoint(() => assert.fail("TLS identity rejection must precede SOAP"),
        { key: pair.private, cert: pair.cert });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: registry(), trust: { allowedOrigins: [server.origin], tls: { ca: pair.cert } }
    });
    t.after(() => runtime.close());
    const thing = await runtime.consume(fixtures.td(server.url));
    await assert.rejects(thing.invokeAction("information"), {
        code: "TransportError", execution: "not-sent", transportCode: "ERR_TLS_CERT_ALTNAME_INVALID"
    });
    assert.equal(server.requests.length, 0);
});
