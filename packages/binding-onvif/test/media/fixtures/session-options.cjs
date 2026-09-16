"use strict";

const { mediaLimits } = require("../.compiled/media/policy.js");

function options(worker, patch = {}) {
    const request = { action: "stream", input: {}, transport: "tcp-interleaved",
        tracks: { video: ["JPEG"], audio: ["PCMU"], metadata: true }, localAddress: "127.0.0.1" };
    const scope = { thingId: "urn:unit:camera", targetRef: "unit-camera", principal: "unit-user",
        serviceTarget: "http://127.0.0.1:1/media", operation: {
            bindingQName: { namespace: "urn:unit", localName: "B" },
            portTypeQName: { namespace: "urn:unit", localName: "P" }, operation: "GetStreamUri"
        }, uri: "rtsp://127.0.0.1:1/no-network", origin: "rtsp://127.0.0.1:1",
        transport: request.transport, authentication: { kind: "none" } };
    return {
        process: worker, descriptor: { request, scope, trust: { allowedOrigins: [scope.origin] },
            limits: mediaLimits({ closeTimeoutMs: 250, killTimeoutMs: 100 }), trackMask: 7, codecMask: 17,
            credentialHandle: 0, trustHandle: 42 },
        selection: { ...scope, action: "stream", formIndex: 0, mode: "live" },
        material: { thingId: scope.thingId, targetRef: scope.targetRef, principal: scope.principal, origin: scope.origin },
        decodeMetadata: () => { throw new Error("This no-media readiness test never decodes"); },
        signal: new AbortController().signal, ...patch
    };
}
module.exports = { options };
