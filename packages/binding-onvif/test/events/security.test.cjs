const test = require("node:test");
const assert = require("node:assert/strict");
const selfsigned = require("selfsigned");
const { setTimeout: delay } = require("node:timers/promises");
const f = require("./native-fixture.cjs");
const { createOnvifRuntime } = require("./.compiled/binding/runtime");
const { actionTemplate, context } = require("./.compiled/catalog/models");
const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
function description(href, scheme = "onvif:MutualTlsSecurityScheme") {
    return { "@context": context(), id: "urn:independent:security", title: "Independent scoped native identity",
        securityDefinitions: { native: { scheme }, none: { scheme: "nosec" }, basic: { scheme: "basic" } },
        security: ["native"], actions: { info: actionTemplate(f.operation(DEVICE, "GetDeviceInformation"), f.catalog, href) } };
}
function certificate(name, server = false) {
    return selfsigned.generate([{ name: "commonName", value: name }], {
        keySize: 2048, days: 2, algorithm: "sha256", extensions: [
            { name: "basicConstraints", cA: true },
            { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
            { name: "extKeyUsage", ...(server ? { serverAuth: true } : { clientAuth: true }) },
            ...(server ? [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }] : [])
        ]
    });
}

test("native security: actual mutual TLS selects per-principal certificates without cached cross-principal identity", { timeout: 20000 }, async (t) => {
    const host = certificate("loopback-server", true), alice = certificate("alice"), bob = certificate("bob");
    const seen = [], scopes = [];
    const server = await f.endpoint((request, response, body) => {
        f.verifyInformation(request, body);
        assert.equal(request.socket.authorized, true);
        seen.push(request.socket.getPeerCertificate().subject.CN);
        assert.equal(request.headers.authorization, undefined);
        f.reply(response, f.information);
    }, { key: host.private, cert: host.cert, ca: [alice.cert, bob.cert], requestCert: true, rejectUnauthorized: true });
    const runtime = await createOnvifRuntime({ registry: f.registry,
        trust: { allowedOrigins: [server.origin], tls: { ca: host.cert } },
        credentials: async (scope) => {
            scopes.push(scope);
            const cert = scope.principal === "alice" ? alice : bob;
            return { origin: scope.origin, principal: scope.principal,
                material: { kind: "tls", cert: cert.cert, key: cert.private } };
        } });
    t.after(async () => { try { await runtime.close(); } finally { await server.close(); } });
    const a = await runtime.consume(description(server.url), { principal: "alice" });
    const b = await runtime.consume(description(server.url, "cert"), { principal: "bob" });
    for (const thing of [a, b, a]) assert.equal((await (await thing.invokeAction("info")).value()).HardwareId, "0000");
    assert.deepEqual(seen, ["alice", "bob", "alice"]);
    assert.deepEqual(scopes.map((scope) => [scope.principal, scope.href]),
        [["alice", server.url], ["bob", server.url], ["alice", server.url]]);
    assert.ok(!JSON.stringify(a.getThingDescription()).includes("PRIVATE KEY"));
});

test("native security: missing, foreign or cleartext client identities fail closed with no Basic/nosec fallback", { timeout: 15000 }, async (t) => {
    const server = await f.endpoint(() => assert.fail("Invalid native authentication must not contact even the loopback endpoint"));
    const runtimes = [];
    t.after(async () => { try { await Promise.all(runtimes.map((runtime) => runtime.close())); } finally { await server.close(); } });
    const runtime = await createOnvifRuntime({ registry: f.registry, trust: { allowedOrigins: [server.origin] } });
    runtimes.push(runtime);
    for (const scheme of ["basic", "bearer"]) await assert.rejects(runtime.consume(description(server.url, scheme)), { code: "UnsupportedCapability" });
    const tls = await runtime.consume(description(server.url));
    await assert.rejects(tls.invokeAction("info"), { code: "PolicyDenied" });
    const wsse = await runtime.consume(description(server.url, "onvif:UsernameTokenSecurityScheme"));
    await assert.rejects(wsse.invokeAction("info"), { code: "AuthenticationFailed" });
    const foreign = await createOnvifRuntime({ registry: f.registry, trust: { allowedOrigins: [server.origin] },
        credentials: async (scope) => ({ origin: scope.origin, principal: "not-the-request-principal",
            material: { kind: "password", username: "fixture", password: "fixture" } }) });
    runtimes.push(foreign);
    const thing = await foreign.consume(description(server.url, "onvif:UsernameTokenSecurityScheme"), { principal: "alice" });
    await assert.rejects(thing.invokeAction("info"), { code: "PolicyDenied" });
    const global = await createOnvifRuntime({ registry: f.registry,
        trust: { allowedOrigins: [server.origin], tls: { cert: "not-a-scoped-identity", key: "not-a-scoped-key" } } });
    runtimes.push(global);
    const nosec = await global.consume(description(server.url, "nosec"));
    await assert.rejects(nosec.invokeAction("info"), { code: "InvalidSecurity" });
    assert.equal(server.requests.length, 0);
});

test("native security: stock node-wot HTTP remains per-request across principals and explicit nosec overrides", { timeout: 10000 }, async (t) => {
    const seen = [];
    const server = await f.endpoint((request, response) => {
        assert.equal(request.method, "GET");
        const principal = request.headers.authorization === undefined ? "anonymous"
            : Buffer.from(request.headers.authorization.slice("Basic ".length), "base64").toString("utf8").split(":")[0];
        seen.push([request.url, principal]);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ principal }));
    });
    const scopes = [];
    const runtime = await createOnvifRuntime({ registry: f.registry, trust: { allowedOrigins: [server.origin] },
        credentials: async (scope) => {
            scopes.push(scope);
            await delay(scope.principal === "alice" ? 5 : 1);
            return { origin: server.origin, principal: scope.principal,
                material: { kind: "password", username: scope.principal, password: "offline-fixture" } };
        } });
    t.after(async () => { try { await runtime.close(); } finally { await server.close(); } });
    const td = description(server.url, "nosec");
    td.properties = { identity: { type: "object", readOnly: true, forms: [
        { href: `${server.origin}/identity`, op: "readproperty", contentType: "application/json", security: ["basic"] },
        { href: `${server.origin}/public`, op: "readproperty", contentType: "application/json", security: ["none"] }
    ] } };
    const alice = await runtime.consume(td, { principal: "alice" }), bob = await runtime.consume(td, { principal: "bob" });
    for (const formIndex of [0, 1, 0]) {
        const values = await Promise.all([alice, bob].map(async (thing) => (await thing.readProperty("identity", { formIndex })).value()));
        assert.deepEqual(values, formIndex === 1 ? [{ principal: "anonymous" }, { principal: "anonymous" }]
            : [{ principal: "alice" }, { principal: "bob" }]);
    }
    assert.deepEqual(scopes.map((scope) => scope.principal).sort(), ["alice", "alice", "bob", "bob"]);
    assert.equal(seen.filter(([, principal]) => principal === "anonymous").length, 2);
});
