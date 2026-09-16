const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { versionedThing, preparePublication, StaticModelPublisher, FilePublication } = require("./.compiled/publication/models.js");
const { PublicationHttpClient, responseJson } = require("./.compiled/publication/http.js");
const { PublicationError } = require("./.compiled/publication/common.js");
const { adaptInventory } = require("./.compiled/publication/snapshot-adapter.js");
const { endpointIdentity } = require("./.compiled/discovery/protocol.js");
const { directory, td } = require("./fixtures/directory.cjs");

const TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1";
const ID = "urn:publication:camera:1";
const TD_PATH = "things/88087000441c3266e84849320ea963f4d8223a62df1fceaf2ea83077b1ff0ca4.td.json";
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
const camera = () => td(ID, { title: "Camera one", "onvif:registryDigest": "registry-pin",
    "onvif:requirementsDigest": "requirements-pin" });
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const waitForGate = (signal, work) => Promise.race([signal.promise, Promise.resolve(work).then(() => {
    throw new Error("File publication completed before reaching its public model-publisher gate");
})]);
async function temp(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-publication-models-"));
    const resources = [], fixtures = [];
    t.after(async () => {
        try {
            for (const resource of resources) await resource.close();
            for (const fixture of fixtures) await fixture.close();
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
    return { root, resources, fixtures };
}
function documents(baseUrl) {
    return [
        { path: "models/camera.tm.json", value: { "@context": [TD_CONTEXT, `${baseUrl}context/v0.1`],
            "@type": "tm:ThingModel", id: `${baseUrl}models/camera.tm.json`, title: "Camera model",
            links: [{ rel: "tm:extends", href: `${baseUrl}models/native.tm.json`, type: "application/tm+json" }] } },
        { path: "models/native.tm.json", value: { id: `${baseUrl}models/native.tm.json`, title: "Native model",
            actions: { read: { "tm:ref": `${baseUrl}models/operations.tm.json#/actions/read` } } } },
        { path: "models/operations.tm.json", value: { id: `${baseUrl}models/operations.tm.json`, title: "Operations",
            actions: { read: { "onvif:sourceDataSchema": `${baseUrl}schemas/payload.json#/$defs/Read` } } } },
        { path: "schemas/payload.json", value: { $id: `${baseUrl}schemas/payload.json`, $defs: { Read: { type: "object" } } } },
        { path: "context/v0.1", value: { "@context": { onvif: "https://example.org/wot/onvif#" } } },
        { path: "context/publication/v1", value: { "@context": { "onvif:publication": { "@type": "@json" } } } }
    ];
}
function publication(baseUrl) {
    return { inventoryRevision: 7, capturedAt: 1700000000000,
        things: [{ deviceId: "native-one", observedAt: 1699999999000, quarantined: false, td: {
            ...camera(), links: [{ rel: "type", href: `${baseUrl}models/camera.tm.json`, type: "application/tm+json" }],
            actions: { nativeRead: { forms: [{ href: "http://192.0.2.10/onvif/native", op: "invokeaction",
                contentType: "application/soap+xml", "htv:methodName": "POST" }] } }
        } }],
        documents: documents(baseUrl), modelUrls: [`${baseUrl}models/camera.tm.json`] };
}

test("versionedThing pins a literal instance digest, ignores old versions and separates model pins from firmware evidence", () => {
    const input = { ...camera(), version: { model: "stale-model", instance: "stale-instance" }, "onvif:projectionDigest": "stale-digest" };
    const before = structuredClone(input);
    const versioned = versionedThing(input);
    assert.deepEqual(versioned.version, { model: "registry-pin.requirements-pin",
        instance: "f5bd182b6691739c61b3c1150a0aa1181cfa1f7de5968c7b1724ce4abb181b32" });
    assert.equal(versioned["onvif:projectionDigest"], "f5bd182b6691739c61b3c1150a0aa1181cfa1f7de5968c7b1724ce4abb181b32");
    assert.equal(versioned.id, "urn:publication:camera:1");
    assert.equal(versioned.title, "Camera one");
    versioned.securityDefinitions.none.scheme = "changed by caller";
    assert.deepEqual(input, before);
    const firmware = versionedThing({ ...camera(), "onvif:conformanceEvidence": [{ firmware: "9.9.9", source: "urn:registered:evidence" }] });
    assert.equal(firmware.version.model, "registry-pin.requirements-pin");
    assert.notEqual(firmware.version.instance, "f5bd182b6691739c61b3c1150a0aa1181cfa1f7de5968c7b1724ce4abb181b32");
    const repinned = versionedThing({ ...camera(), "onvif:registryDigest": "new-source-pin" });
    assert.equal(repinned.version.model, "new-source-pin.requirements-pin");
    assert.equal(repinned.id, ID);
});

test("model preparation and static publisher require an explicit safe trailing-slash base and verification mode", () => {
    for (const baseUrl of ["https://example.invalid/models", "https://example.invalid/models/?q=1"]) {
        assert.throws(() => preparePublication({ devices: [] }, baseUrl), code("InvalidConfiguration"));
        assert.throws(() => new StaticModelPublisher({ directory: os.tmpdir(), owner: "models", baseUrl, verification: "file-only" }),
            code("InvalidConfiguration"));
    }
    assert.throws(() => preparePublication({ devices: [] }, "https://example.invalid/models/#fragment"), code("PolicyDenied"));
    assert.throws(() => new StaticModelPublisher({ directory: os.tmpdir(), owner: "models",
        baseUrl: "https://example.invalid/models/" }), code("InvalidConfiguration"));
});

test("preparePublication relocates model/type/import/context URIs under the configured base but leaves native Forms and vocabulary intact", () => {
    const authored = "https://example.org/wot/onvif", baseUrl = "https://publication.invalid/site/";
    const sourceTd = { ...camera(), "@context": [TD_CONTEXT, `${authored}/context/v0.1`],
        "@type": "onvif:DeviceThing",
        links: [{ rel: "type", href: `${authored}/models/composites/camera.tm.json`, type: "application/tm+json" }],
        actions: { read: { forms: [{ href: "http://192.0.2.10/native", op: "invokeaction", contentType: "application/soap+xml" }] } } };
    const nativeNamespace = "http://www.onvif.org/ver10/device/wsdl";
    const endpointReference = { address: "urn:uuid:11111111-2222-3333-4444-555555555555",
        referenceProperties: [], referenceParameters: [] };
    const envelope = { id: endpointIdentity(endpointReference), endpointReference,
        state: "verified", epoch: 1, inspectionGeneration: 2, metadataVersion: "3",
        ordering: { instanceId: null, sequences: [] }, types: [], scopes: [], claims: [],
        seenAt: 1000, updatedAt: 1000, verifiedAt: 900, identityConflict: false,
        suspectSince: null, failedLivenessRounds: 0, lastLivenessRound: null,
        endpoints: [{ xaddr: "http://192.0.2.10/native", approval: "approved", provenance: [] }],
        provenance: [], observedFeatures: [], identityEvidence: [], registryEvidence: [], diagnostics: [],
        information: { status: "known", observedAt: 900, value: { manufacturer: "Fixture", model: "Camera",
            firmwareVersion: "1.0", serialNumber: "serial-1", hardwareId: "hardware-1" } },
        services: { status: "known", observedAt: 850, value: [{ namespace: nativeNamespace,
            xaddr: "http://192.0.2.10/native", version: null, capabilities: { status: "known", observedAt: 850, value: {} } }] },
        reads: [{ operation: { bindingQName: { namespace: nativeNamespace, localName: "DeviceBinding" },
            portTypeQName: { namespace: nativeNamespace, localName: "Device" }, operation: "GetDeviceInformation" },
            xaddr: "http://192.0.2.10/native", args: {}, outcome: { status: "known", observedAt: 800,
                value: { Manufacturer: "Fixture", Model: "Camera", FirmwareVersion: "1.0", SerialNumber: "serial-1", HardwareId: "hardware-1" } } }],
        resources: [] };
    const inventory = { schemaVersion: 1, revision: 7, capturedAt: 1000, truncated: false,
        devices: [envelope], seeds: [], diagnostics: [] };
    const adapted = adaptInventory(inventory)[0];
    const input = { schemaVersion: 1, inventory, devices: [{
        ...adapted, projection: { formatVersion: 1, registryDigest: "registry-pin", requirementsDigest: "requirements-pin",
            projectionDigest: "projection-pin", clientManifests: [], assessments: [], diagnostics: [], tds: [sourceTd], models: [{
            "@context": [TD_CONTEXT, `${authored}/context/v0.1`], "@type": "tm:ThingModel",
            id: `${authored}/models/composites/camera.tm.json`, title: "Composite",
            links: [{ rel: "tm:extends", href: `${authored}/models/DeviceThing.tm.json`, type: "application/tm+json" }],
            actions: { read: { "tm:ref": `${authored}/models/operations.tm.json#/actions/read`,
                "onvif:sourceDataSchema": `${authored}/schemas/payloads.schema.json#/$defs/read` } }
        }] }
    }] };
    // Deliberately calls the real public preparation API. Missing adjacent packaged assets are
    // a prerequisite failure to report, never an excuse to mock its loader or regenerate outputs.
    const prepared = preparePublication(input, baseUrl);
    assert.equal(prepared.inventoryRevision, 7);
    assert.equal(prepared.things[0].observedAt, 800);
    assert.deepEqual(prepared.modelUrls, ["https://publication.invalid/site/models/composites/camera.tm.json"]);
    assert.deepEqual(prepared.things[0].td["@context"], [
        TD_CONTEXT, "https://publication.invalid/site/context/v0.1", "https://publication.invalid/site/context/publication/v1"
    ]);
    assert.equal(prepared.things[0].td.actions.read.forms[0].href, "http://192.0.2.10/native");
    assert.equal(prepared.things[0].td["@type"], "onvif:DeviceThing");
    const composite = prepared.documents.find((document) => document.path === "models/composites/camera.tm.json").value;
    assert.equal(composite.links[0].href, "https://publication.invalid/site/models/DeviceThing.tm.json");
    assert.equal(composite.actions.read["tm:ref"], "https://publication.invalid/site/models/operations.tm.json#/actions/read");
    assert.equal(composite.actions.read["onvif:sourceDataSchema"], "https://publication.invalid/site/schemas/payloads.schema.json#/$defs/read");
    assert.equal(prepared.documents.some((document) => document.path === "context/publication/v1"), true);
    assert.equal(sourceTd.links[0].href, "https://example.org/wot/onvif/models/composites/camera.tm.json");
});

test("static model HTTP verification serves the full transitive import graph at the actual configured base", { timeout: 20000 }, async (t) => {
    const context = await temp(t);
    const fixture = await directory({ modelDirectory: context.root });
    context.fixtures.push(fixture);
    const models = new StaticModelPublisher({ directory: context.root, owner: "model-owner",
        baseUrl: fixture.modelBaseUrl, verification: "http" });
    context.resources.push(models);
    const input = publication(fixture.modelBaseUrl);
    await models.publish(input);
    const transport = new PublicationHttpClient({ allowedOrigins: [fixture.origin] });
    context.resources.push(transport);
    const response = await transport.request("GET", `${fixture.modelBaseUrl}models/camera.tm.json`);
    assert.equal(response.status, 200);
    assert.deepEqual(responseJson(response).links, [{
        rel: "tm:extends", href: `${fixture.modelBaseUrl}models/native.tm.json`, type: "application/tm+json"
    }]);
    const imported = await transport.request("GET", `${fixture.modelBaseUrl}schemas/payload.json`);
    assert.deepEqual(responseJson(imported).$defs, { Read: { type: "object" } });
    const manifest = JSON.parse(await fs.readFile(path.join(context.root, "onvif-bundle-manifest.json"), "utf8"));
    assert.equal(manifest.owner, "model-owner");
    assert.deepEqual(Object.keys(manifest.files).sort(), [
        "context/publication/v1", "context/v0.1", "models/camera.tm.json", "models/native.tm.json",
        "models/operations.tm.json", "schemas/payload.json"
    ]);
    assert.deepEqual(fixture.audit, []); // Static model hosting does not use or borrow Directory authorization.
    const control = await transport.request("PUT", `${fixture.modelBaseUrl}models/camera.tm.json`, { should: "not execute" });
    assert.equal(control.status, 405);
    assert.equal(JSON.parse(await fs.readFile(path.join(context.root, "models/camera.tm.json"), "utf8")).title, "Camera model");
});

for (const missing of ["models/native.tm.json", "models/operations.tm.json", "schemas/payload.json", "context/v0.1", "context/publication/v1"]) {
    test(`static model verification rejects missing transitive document ${missing} without file-only fallback`, { timeout: 20000 }, async (t) => {
        const context = await temp(t);
        const fixture = await directory({ modelDirectory: context.root });
        context.fixtures.push(fixture);
        const models = new StaticModelPublisher({ directory: context.root, owner: "models", baseUrl: fixture.modelBaseUrl, verification: "http" });
        context.resources.push(models);
        const input = publication(fixture.modelBaseUrl);
        input.documents = input.documents.filter((entry) => entry.path !== missing);
        await assert.rejects(models.publish(input), code("InvalidModel"));
        await assert.rejects(fs.stat(path.join(context.root, missing)), { code: "ENOENT" });
        assert.equal(fixture.records.size, 0);
    });
}

for (const mode of ["missing", "different", "whitespace only"]) {
    test(`static HTTP verification handles ${mode} hosted bytes explicitly`, { timeout: 20000 }, async (t) => {
        const context = await temp(t);
        const hosted = path.join(context.root, "hosted"), written = path.join(context.root, "written");
        await fs.mkdir(hosted, { mode: 0o700 });
        await fs.mkdir(written, { mode: 0o700 });
        const fixture = await directory({ modelDirectory: hosted });
        context.fixtures.push(fixture);
        const models = new StaticModelPublisher({ directory: written, owner: "models", baseUrl: fixture.modelBaseUrl, verification: "http" });
        context.resources.push(models);
        const input = publication(fixture.modelBaseUrl);
        if (mode !== "missing") {
            for (const document of input.documents) {
                const file = path.join(hosted, document.path);
                await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
                const value = mode === "different" && document.path === "models/camera.tm.json"
                    ? { ...document.value, title: "Independent hosted content" } : document.value;
                await fs.writeFile(file, " \n" + JSON.stringify(value) + "\n ", { mode: 0o600 });
            }
        }
        if (mode === "missing") await assert.rejects(models.publish(input), (error) => code("UnsupportedDirectory")(error) && error.status === 404);
        else if (mode === "different") await assert.rejects(models.publish(input), code("ModelNotReachable"));
        else await models.publish(input);
        assert.equal(JSON.parse(await fs.readFile(path.join(written, "models/camera.tm.json"), "utf8")).title, "Camera model");
        assert.equal(fixture.records.size, 0);
        if (mode === "different") assert.equal(JSON.parse(await fs.readFile(path.join(hosted, "models/camera.tm.json"), "utf8")).title, "Independent hosted content");
    });
}

test("file publication exports TD/index and separate model/context owner manifests, omits quarantine and retains native Forms", { timeout: 20000 }, async (t) => {
    const context = await temp(t);
    const modelsRoot = path.join(context.root, "models"), exportRoot = path.join(context.root, "export");
    await fs.mkdir(modelsRoot, { mode: 0o700 });
    await fs.mkdir(exportRoot, { mode: 0o700 });
    const models = new StaticModelPublisher({ directory: modelsRoot, owner: "export-owner",
        baseUrl: "https://publication.invalid/site/", verification: "file-only" });
    const exporter = new FilePublication(models, exportRoot, "export-owner");
    context.resources.push(exporter);
    const input = publication(models.baseUrl);
    input.things.push({ deviceId: "quarantined-native", observedAt: null, quarantined: true, td: td("urn:publication:quarantined") });
    await fs.writeFile(path.join(exportRoot, "unrelated.txt"), "unrelated file");
    await exporter.publish(input);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(exportRoot, "inventory-publication.json"), "utf8")), {
        schemaVersion: 1, inventoryRevision: 7, capturedAt: 1700000000000,
        things: [{ id: "urn:publication:camera:1", path: TD_PATH }]
    });
    const published = JSON.parse(await fs.readFile(path.join(exportRoot, TD_PATH), "utf8"));
    assert.equal(published.title, "Camera one");
    assert.deepEqual(published.links, [{ rel: "type", href: "https://publication.invalid/site/models/camera.tm.json", type: "application/tm+json" }]);
    assert.equal(published.actions.nativeRead.forms[0].href, "http://192.0.2.10/onvif/native");
    assert.equal(published.actions.nativeRead.forms[0]["htv:methodName"], "POST");
    assert.deepEqual(await fs.readdir(path.join(exportRoot, "things")), [path.basename(TD_PATH)]);
    for (const root of [modelsRoot, exportRoot]) {
        assert.equal(JSON.parse(await fs.readFile(path.join(root, "onvif-bundle-manifest.json"), "utf8")).owner, "export-owner");
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(modelsRoot, "context/v0.1"), "utf8"))["@context"].onvif,
        "https://example.org/wot/onvif#");
    await exporter.publish({ ...input, inventoryRevision: 8, things: [] });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(exportRoot, "inventory-publication.json"), "utf8")).things, []);
    assert.equal(JSON.parse(await fs.readFile(path.join(exportRoot, TD_PATH), "utf8")).id, ID);
    assert.equal(await fs.readFile(path.join(exportRoot, "unrelated.txt"), "utf8"), "unrelated file");
});

test("file export does not publish an index/TD when the public model publisher fails", { timeout: 20000 }, async (t) => {
    const context = await temp(t), calls = [];
    const models = { baseUrl: "https://publication.invalid/site/", async publish(input) {
        calls.push({ revision: input.inventoryRevision, id: input.things[0].td.id });
        throw new PublicationError("ModelNotReachable", "not hosted");
    }, async close() {} };
    const exporter = new FilePublication(models, context.root, "export-owner");
    context.resources.push(exporter);
    await assert.rejects(exporter.publish(publication(models.baseUrl)), code("ModelNotReachable"));
    assert.deepEqual(calls, [{ revision: 7, id: "urn:publication:camera:1" }]);
    assert.deepEqual(await fs.readdir(context.root), []);
});

test("static model publisher rejects post-close publication without writing files", { timeout: 20000 }, async (t) => {
    const context = await temp(t);
    const models = new StaticModelPublisher({ directory: context.root, owner: "models",
        baseUrl: "https://publication.invalid/site/", verification: "file-only" });
    context.resources.push(models);
    await models.close();
    await assert.rejects(models.publish(publication(models.baseUrl)), code("RuntimeClosed"));
    assert.deepEqual(await fs.readdir(context.root), []);
});

test("file publication close waits for an in-flight model publication and its dependent export", { timeout: 20000 }, async (t) => {
    const context = await temp(t), entered = deferred(), release = deferred(), calls = [];
    const models = { baseUrl: "https://publication.invalid/site/", async publish() {
        calls.push("publish-enter"); entered.resolve(); await release.promise; calls.push("publish-finished");
    }, async close() { calls.push("models-closed"); } };
    const exporter = new FilePublication(models, context.root, "export-owner");
    context.resources.push(exporter);
    const work = exporter.publish(publication(models.baseUrl));
    void work.catch(() => {}); // A retained regression must still release/settle its owned operation.
    try {
        await waitForGate(entered, work);
        let closed = false;
        const closing = exporter.close().then(() => { closed = true; });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(closed, false, "Close must await the public publish operation before closing its export bundle");
        release.resolve();
        await work;
        await closing;
        assert.equal(JSON.parse(await fs.readFile(path.join(context.root, "inventory-publication.json"), "utf8")).inventoryRevision, 7);
        assert.deepEqual(calls, ["publish-enter", "publish-finished", "models-closed"]);
    } finally { release.resolve(); await work.catch(() => {}); }
});

test("file publication close aggregates public collaborator errors instead of hiding cleanup failure", async (t) => {
    const context = await temp(t);
    const failure = new Error("model resource close failed");
    const models = { baseUrl: "https://publication.invalid/site/", async publish() {}, async close() { throw failure; } };
    const exporter = new FilePublication(models, context.root, "export-owner");
    await assert.rejects(exporter.close(), (error) => error instanceof AggregateError
        && error.errors.length === 1 && error.errors[0] === failure);
    assert.deepEqual(await fs.readdir(context.root), []);
});

test("every concurrent static-model close waits for the pending file publication, not only the first caller", { timeout: 20000 }, async (t) => {
    const context = await temp(t);
    const models = new StaticModelPublisher({ directory: context.root, owner: "models",
        baseUrl: "https://publication.invalid/site/", verification: "file-only" });
    context.resources.push(models);
    let published = false;
    const writing = models.publish({ inventoryRevision: 1, capturedAt: 0, things: [], modelUrls: [],
        documents: [{ path: "models/pending.json", value: { title: "Pending model" } }] });
    void writing.then(() => { published = true; }, () => {});
    const first = models.close(), second = models.close();
    try {
        await second;
        assert.equal(published, true, "Every close completion must include the in-flight publication");
        await first;
        assert.equal(JSON.parse(await fs.readFile(path.join(context.root, "models/pending.json"), "utf8")).title, "Pending model");
        assert.equal(JSON.parse(await fs.readFile(path.join(context.root, "onvif-bundle-manifest.json"), "utf8")).owner, "models");
    } finally { await writing.catch(() => {}); await first; }
});
