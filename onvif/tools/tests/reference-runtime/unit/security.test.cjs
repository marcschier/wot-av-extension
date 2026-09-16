const test = require("node:test");
const assert = require("node:assert/strict");
const { createDigestAuthorization, selectDigestChallenge, createUsernameToken } = require("../../../../samples/reference-runtime/dist");
const { parseWire, one } = require("../../../fixtures/reference-runtime/endpoint.cjs");

test("Digest: published RFC 2617 MD5 auth vector is byte-exact", () => {
    const challenge = selectDigestChallenge([
        'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"'
    ], { algorithms: ["MD5"], qops: ["auth"] });
    const authorization = createDigestAuthorization({
        challenge, username: "Mufasa", password: "Circle Of Life",
        method: "GET", uri: "/dir/index.html", body: Buffer.alloc(0),
        cnonce: "0a4f113b", nonceCount: 1
    });
    assert.match(authorization, /response="6629fae49393a05397450978507c4ef1"/);
    assert.match(authorization, /nc=00000001/);
    assert.match(authorization, /qop=auth(?:,|$)/);
});

test("Digest: strongest permitted challenge wins; unsupported requirements never downgrade", () => {
    const selected = selectDigestChallenge([
        'Basic realm="ignore", Digest realm="cam", nonce="weak", algorithm=MD5, qop="auth"',
        'Digest realm="cam, east", nonce="strong", algorithm=SHA-256, qop="auth-int"'
    ], { algorithms: ["SHA-256", "MD5"], qops: ["auth-int", "auth"] });
    assert.equal(selected.algorithm, "SHA-256");
    assert.equal(selected.realm, "cam, east");
    assert.equal(selected.qop, "auth-int");
    for (const header of [
        'Basic realm="cam"',
        'Digest realm="cam",nonce="a",algorithm=SHA-512,qop="auth"',
        'Digest realm="cam",nonce="a",algorithm=SHA-256,qop="auth-conf"',
        'Digest realm="cam",nonce="a",nonce="b",algorithm=SHA-256,qop="auth"'
    ]) {
        assert.throws(() => selectDigestChallenge([header],
            { algorithms: ["SHA-256"], qops: ["auth"] }), { code: "AuthenticationFailed" });
    }
});

test("WSSE: fixed clock/nonce oracle, fresh token and bounded offset without changing the device", () => {
    const crypto = require("node:crypto");
    const nonce = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    const created = "2026-09-15T10:00:05.000Z";
    const expected = crypto.createHash("sha1").update(nonce).update(created).update("private-fixture-password")
        .digest("base64");
    const token = createUsernameToken({
        username: "fixture-user", password: "private-fixture-password",
        clock: () => new Date("2026-09-15T10:00:00Z"), nonce: () => nonce, offsetMs: 5000, maxOffsetMs: 10000
    });
    const doc = parseWire(token);
    const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
    const WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
    assert.equal(one(doc, WSSE, "Password").textContent, expected);
    assert.equal(one(doc, WSSE, "Nonce").textContent, nonce.toString("base64"));
    assert.equal(one(doc, WSU, "Created").textContent, created);
    assert.ok(!token.includes("private-fixture-password"));
    assert.throws(() => createUsernameToken({
        username: "fixture-user", password: "secret", clock: () => new Date(),
        nonce: () => nonce, offsetMs: 10001, maxOffsetMs: 10000
    }), { code: "InvalidConfiguration" });
});
