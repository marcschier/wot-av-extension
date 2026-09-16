"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMediaTrust, authorizeMediaTarget, validateMediaSecurity } = require("./.compiled/media/policy.js");

test("media policy: native credentials require exact target origin principal and realm", () => {
    const trust = validateMediaTrust({
        serviceTargets: ["https://camera.invalid/onvif/media"],
        allowedOrigins: ["rtsp://camera.invalid:554"],
        transports: ["tcp-interleaved"],
        authentication: { kind: "digest", realm: "synthetic-realm" }
    });
    const scope = {
        thingId: "urn:test:device", targetRef: "test-camera", principal: "reader-A",
        serviceTarget: trust.serviceTargets[0], operation: {
            bindingQName: { namespace: "urn:test", localName: "B" },
            portTypeQName: { namespace: "urn:test", localName: "P" }, operation: "GetStreamUri"
        },
        uri: "rtsp://camera.invalid:554/live", origin: "rtsp://camera.invalid:554",
        transport: "tcp-interleaved", authentication: trust.authentication
    };
    const material = { thingId: scope.thingId, targetRef: scope.targetRef, principal: scope.principal,
        origin: scope.origin, native: { origin: scope.origin, principal: scope.principal,
            realm: "synthetic-realm", username: "synthetic-user", password: "unit-only-secret" } };
    assert.equal(authorizeMediaTarget(scope.uri, scope.transport, trust).origin, scope.origin);
    assert.equal(validateMediaSecurity(scope, material).native.username, "synthetic-user");
    for (const key of ["principal", "origin", "realm"]) {
        assert.throws(() => validateMediaSecurity(scope,
            { ...material, native: { ...material.native, [key]: "mismatch" } }), { code: "PolicyDenied" });
    }
    assert.throws(() => authorizeMediaTarget("rtsp://unapproved.invalid:554/live", scope.transport, trust),
        { code: "PolicyDenied" });
    assert.throws(() => authorizeMediaTarget("rtsp://synthetic-user:unit-only-secret@camera.invalid:554/live",
        scope.transport, trust), { code: "PolicyDenied" });
});
