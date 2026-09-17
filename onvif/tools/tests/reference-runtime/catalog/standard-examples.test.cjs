const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const http = require("node:http");
const { DOMParser } = require("@xmldom/xmldom");
const { root } = require("../../../paths.cjs");
const api = require("../../../../samples/reference-runtime/dist");
const { modelIndex, assertModelImports, resolveModel } = require("../../../../samples/reference-runtime/dist/catalog/model-resolver.js");
const { generate } = require("../../../generate-onvif-examples.cjs");
const { assemble, checkReferences, bibliography } = require("../../../generate-spec-annexes.cjs");
const base = join(root, "onvif");
const read = (path) => JSON.parse(readFileSync(join(base, ...path.split("/")), "utf8"));
const catalog = api.loadPackagedProjectionCatalog();
const registry = api.defineOperationRegistry(catalog.registry.operations, catalog.registry.xml);
const manifest = read("examples/golden-manifest.json");

test("examples: seven native families, complete imported models and separately authored adapter examples resolve", () => {
    assert.deepEqual([...new Set(manifest.scenarios.flatMap((scene) => scene.profiles.map((profile) => profile.profile)))].sort(),
        ["A", "C", "D", "G", "M", "S", "T"]);
    const models = modelIndex([
        ...read("models.json").models, ...read("examples/model-index.json").models,
        read("examples/adapted-cameras/uvc-camera.tm.json"), read("examples/adapted-cameras/genicam-camera.tm.json")
    ]);
    assertModelImports(models);
    for (const scene of manifest.scenarios) {
        const td = read(`examples/${scene.td}`), source = read(`examples/${scene.source}`);
        assert.equal(source.noHardwareDiscovery, true);
        assert.equal(source.readOnlyEmulation, true);
        assert.equal(td["onvif:projection"].fullProfile, false);
        const types = td.links.filter((link) => link.rel === "type");
        assert.equal(types.length, 1);
        const resolved = resolveModel(types[0].href, models);
        assert.deepEqual(Object.keys(resolved.actions).sort(), Object.keys(td.actions).sort());
        const sourceKeys = new Set(source.wire.map((entry) => api.operationKey(entry.operation)));
        for (const action of Object.values(td.actions)) for (const form of action.forms) {
            assert.ok(sourceKeys.has(api.operationKey(form["onvif:operation"])), "A read-only source cannot advertise a non-emulated write/session operation");
            assert.equal(form["onvif:soapAction"], registry.resolve(form["onvif:operation"]).soapAction);
        }
        assert.ok(!Object.values(td.actions).some((action) => /^(Set|Create|Delete|Find|PullMessages|Get.*SearchResults)/.test(action.title)));
    }
});

test("examples: recording tracks retain complete parents and typed native job configuration is not a transfer claim", () => {
    const resources = read("examples/recorders/g-recording-resources.tds.json");
    const tracks = resources.filter((td) => td["onvif:resourceIdentity"].kind === "RecordingTrack");
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0]["onvif:resourceIdentity"].token, tracks[1]["onvif:resourceIdentity"].token);
    assert.notEqual(tracks[0].id, tracks[1].id);
    assert.notDeepEqual(tracks[0]["onvif:resourceIdentity"].parentTokens, tracks[1]["onvif:resourceIdentity"].parentTokens);
    assert.ok(resources.some((td) => td["onvif:resourceIdentity"].kind === "RecordingJob"));
    const returned = read("examples/recorders/recording-job-returned-configuration.json");
    api.encodeElement(registry.resolve(returned.operation).response, returned.result, catalog.registry.xml);
    assert.equal(returned.result.JobToken, "job-01");
    assert.equal(returned.result.JobConfiguration.Mode, "Idle");
    assert.match(returned.provenance, /no create operation was performed/);
});

test("examples: D reader-only/door-only/both preserve exact capacities and all four zero-capacity inventory interfaces", () => {
    for (const [name, points, doors] of [["d-reader-only", 1, 0], ["d-door-only", 0, 1], ["d-reader-door", 1, 1]]) {
        const source = read(`examples/access-control/${name}-source.json`), td = read(`examples/access-control/${name}.td.json`);
        assert.equal(source.snapshot.facts["device.accessPoints.MaxAccessPoints"].value, points);
        assert.equal(source.snapshot.facts["device.doors.MaxDoors"].value, doors);
        assert.ok(points > 0 || doors > 0);
        for (const [kind, capacity] of [["AccessPoint", points], ["Door", doors]]) if (capacity === 0) {
            for (const name of [`Get${kind}s`, `Get${kind}List`, `Get${kind}Info`, `Get${kind}InfoList`]) {
                const wire = source.wire.find((entry) => entry.operation.operation === name);
                assert.ok(wire, name);
                const operation = registry.resolve(wire.operation);
                const value = api.decodeElement(operation.response, api.parseXml(wire.responseXml), catalog.registry.xml);
                assert.ok(Object.values(value).every((field) => Array.isArray(field) && field.length === 0), name);
                assert.ok(Object.values(td.actions).some((action) => api.operationKey(action.forms[0]["onvif:operation"]) === api.operationKey(wire.operation)));
            }
        }
    }
    const numericContract = read("binding.schema.json").$defs.profileDCapacities;
    assert.equal(numericContract.anyOf.length, 2);
    assert.equal(Object.hasOwn(numericContract, "oneOf"), false);
});

test("references: complete vocabulary/descriptor regions regenerate and unresolved references fail closed", () => {
    assert.deepEqual(generate(true).stale, []);
    const assembled = assemble(true);
    assert.deepEqual(assembled.stale, []);
    assert.equal(assembled.terms, 70);
    assert.equal(assembled.diagrams, 6);
    const source = readFileSync(join(base, "spec.md"), "utf8");
    assert.throws(() => checkReferences(source + "\n[missing][not-a-published-reference]\n"), /Unresolved bibliography/);
    assert.throws(() => checkReferences(source + "\n[missing](#nonexistent-anchor)\n"), /Unresolved local anchor/);
    assert.throws(() => checkReferences(source + "\n[missing](mapping.schema.json#/$defs/PrivateSourceNode)\n"), /Unresolved JSON Pointer/);
    assert.throws(() => bibliography(source.replace("/doc/Core.xml", "/doc/InventedCore.xml"), catalog.registry, read("sources.lock.json")),
        /lacks verified pinned document identity/);
    assert.ok(!source.includes("RTP_unicast"));
});

test("examples: native SOAP uses source-derived action metadata and explicit GetStreamUri still works with idempotent=false", async () => {
    const source = read("examples/cameras/t-m-camera-source.json");
    const uriWire = source.wire.find((entry) => entry.dynamicResponse === "profile-token-stream-uri");
    const operation = registry.resolve(uriWire.operation);
    const operationId = catalog.registry.operations.find((entry) => api.operationKey(entry) === api.operationKey(uriWire.operation)).id;
    const requests = [];
    let failure;
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
            try {
                assert.equal(request.method, "POST");
                assert.ok(String(request.headers["content-type"]).includes(`action="${operation.soapAction}"`));
                const document = new DOMParser().parseFromString(Buffer.concat(chunks).toString("utf8"), "application/xml");
                const body = document.getElementsByTagNameNS("http://www.w3.org/2003/05/soap-envelope", "Body")[0];
                const rootElement = Array.from(body.childNodes).find((node) => node.nodeType === 1);
                assert.equal(rootElement.namespaceURI, operation.request.name.namespace);
                assert.equal(rootElement.localName, operation.request.name.localName);
                const token = rootElement.getElementsByTagNameNS(operation.request.name.namespace, "ProfileToken")[0].textContent;
                const protocol = rootElement.getElementsByTagNameNS(operation.request.name.namespace, "Protocol")[0].textContent;
                assert.ok(["0001", "0002"].includes(token));
                assert.equal(protocol, "RtspUnicast");
                requests.push(token);
                response.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
                response.end(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><m:GetStreamUriResponse xmlns:m="${operation.response.name.namespace}"><m:Uri>rtsp://192.0.2.30:554/live/${encodeURIComponent(token)}</m:Uri></m:GetStreamUriResponse></s:Body></s:Envelope>`);
            } catch (error) {
                failure = error;
                response.writeHead(500);
                response.end("Independent native source assertion failed");
            }
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let runtime;
    try {
        const snapshot = structuredClone(source.snapshot);
        snapshot.services.forEach((service) => { service.xaddr = origin + new URL(service.xaddr).pathname; });
        const projected = api.project(snapshot, catalog, { securityDefinitions: { fixture: { scheme: "nosec" } }, security: ["fixture"] });
        const td = projected.tds.find((entry) => entry["@type"] === "onvif:Device");
        assert.equal(td.actions[operationId].idempotent, false);
        assert.equal(td.actions[operationId].safe, false);
        const before = JSON.stringify(td);
        runtime = await api.createOnvifRuntime({ registry, trust: { allowedOrigins: [origin] } });
        const thing = await runtime.consume(td);
        for (const token of ["0001", "0002"]) {
            const output = await thing.invokeAction(operationId, { Protocol: "RtspUnicast", ProfileToken: token });
            assert.deepEqual(await output.value(), { Uri: `rtsp://192.0.2.30:554/live/${token}` });
        }
        assert.deepEqual(requests, ["0001", "0002"]);
        assert.equal(failure, undefined);
        assert.equal(JSON.stringify(td), before, "The published source TD never receives private registry augmentation");
        assert.ok(!before.includes("onvif:xmlRegistry"));
    } finally {
        if (runtime) await runtime.close();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
