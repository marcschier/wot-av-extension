"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { resolve } = require("node:path");
const { DOMParser } = require("@xmldom/xmldom");
const { compileCatalog } = require("../../../tests/reference-runtime/media/.compiled/catalog/compiler.js");
const { loadRequirementIndex } = require("../../../tests/reference-runtime/media/.compiled/catalog/requirements.js");
const { defineOperationRegistry } = require("../../../tests/reference-runtime/media/.compiled/binding/registry.js");
const { project } = require("../../../tests/reference-runtime/media/.compiled/projection/project.js");

const namespaces = {
    media1: "http://www.onvif.org/ver10/media/wsdl",
    media2: "http://www.onvif.org/ver20/media/wsdl",
    replay: "http://www.onvif.org/ver10/replay/wsdl"
};
let compiled;
function generated() {
    if (compiled) return compiled;
    const root = require("../../../paths.cjs").root;
    const catalog = compileCatalog({ root });
    compiled = { catalog, registry: defineOperationRegistry(catalog.operations, catalog.xml),
        requirements: loadRequirementIndex(root, catalog) };
    return compiled;
}
function generatedThing(serviceTarget, variant = "media1", identity = "urn:media:independent-loopback") {
    const { catalog, registry, requirements } = generated();
    const namespace = namespaces[variant], name = variant === "replay" ? "GetReplayUri" : "GetStreamUri";
    const operation = catalog.operations.find((entry) => entry.serviceNamespace === namespace && entry.operation === name);
    assert.ok(operation, "Operation must come from the locked WSDL compiler, never a hand-authored registry");
    const snapshot = {
        schemaVersion: 1, epr: { address: identity, referenceProperties: [] }, profileClaims: [], resources: [],
        services: [{ namespace, xaddr: serviceTarget, evidence: [{ sourceId: "fixture:independent-native-media" }],
            capabilities: { state: "unknown", evidence: [] }, readOutcomes: [],
            supportedOperations: [{ operation: name, portType: operation.portTypeQName.localName,
                binding: operation.bindingQName.localName,
                support: { state: "known", value: true, evidence: [{ sourceId: "fixture:independent-native-media" }] } }] }]
    };
    const projection = project(snapshot, { registry: catalog, requirements },
        { securityDefinitions: { native: { scheme: "nosec" } }, security: ["native"] });
    const description = projection.tds[0];
    assert.ok(description);
    const action = Object.keys(description.actions).find((name) =>
        description.actions[name].forms[0]["onvif:operation"].operation === operation.operation);
    assert.ok(action);
    const input = variant === "media2" ? { Protocol: "RTSP", ProfileToken: "profile-0007" }
        : { StreamSetup: { Stream: "RTP-Unicast", Transport: { Protocol: "RTSP" } },
            [variant === "replay" ? "RecordingToken" : "ProfileToken"]: variant === "replay" ? "recording-0007" : "profile-0007" };
    return { registry, description, action, input, operation, projection };
}
const escapeXml = (value) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/"/gu, "&quot;");
async function soapFixture(uri, { variant = "media1", delay = 0 } = {}) {
    const records = [];
    const namespace = namespaces[variant], operation = variant === "replay" ? "GetReplayUri" : "GetStreamUri";
    const server = http.createServer((request, response) => {
        let chunks = [], size = 0;
        request.on("data", (chunk) => {
            size += chunk.length;
            if (size > 65536) request.destroy(new Error("Independent SOAP fixture request limit"));
            else chunks.push(chunk);
        });
        request.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            chunks = [];
            const xml = new DOMParser().parseFromString(body, "application/xml");
            const native = xml.getElementsByTagNameNS(namespace, operation);
            records.push({ method: request.method, url: request.url, contentType: request.headers["content-type"],
                authorization: request.headers.authorization, body, rootCount: native.length,
                input: native.length === 1 ? native[0] : null });
            const target = escapeXml(typeof uri === "function" ? uri() : uri);
            const result = variant === "media1"
                ? `<MediaUri><tt:Uri>${target}</tt:Uri><tt:InvalidAfterConnect>true</tt:InvalidAfterConnect><tt:InvalidAfterReboot>true</tt:InvalidAfterReboot><tt:Timeout>PT30S</tt:Timeout></MediaUri>`
                : `<Uri>${target}</Uri>`;
            const send = () => {
                if (response.destroyed) return;
                response.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
                response.end(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><${operation}Response xmlns="${namespace}" xmlns:tt="http://www.onvif.org/ver10/schema">${result}</${operation}Response></s:Body></s:Envelope>`);
            };
            if (delay) {
                const timer = setTimeout(send, delay);
                response.once("close", () => clearTimeout(timer));
            } else send();
        });
        request.on("error", () => { response.destroy(); });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, target = `${origin}/onvif/media`;
    return { origin, target, records, close: () => new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
    }) };
}
module.exports = { generated, generatedThing, soapFixture, namespaces };
