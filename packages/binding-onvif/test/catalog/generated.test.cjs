const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } = require("node:fs");
const http = require("node:http");
const { DOMParser } = require("@xmldom/xmldom");
const { join, resolve, dirname } = require("node:path");
const { tmpdir } = require("node:os");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const api = require("../../dist");
const { PACKAGE_ASSETS } = require("../../dist/catalog/artifacts");
const { operationSchemaKey, ONVIF_CONTEXT } = require("../../dist/catalog/schemas");

const root = resolve(__dirname, "..", "..", "..", "..");
const base = join(root, "bindings", "onvif");
const native = require("./fixtures/native-responses.json").cases;
const catalog = api.loadPackagedProjectionCatalog();
const policy = { securityDefinitions: { fixture: { scheme: "nosec" } }, security: ["fixture"] };
const evidence = [{ sourceId: "fixture:independent-generation-validation" }];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function command(executable, args, options = {}) {
    const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout: 120000,
        maxBuffer: 2 * 1024 * 1024, ...options });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result;
}

test("generated: --check is deterministic and performs no HTTP, DNS or socket retrieval", () => {
    const tool = join(root, "tools", "generate-onvif.cjs");
    const script = `
        const deny=()=>{throw new Error("Network is forbidden during generation");};
        for(const m of ["node:http","node:https"]) { require(m).request=deny; require(m).get=deny; }
        require("node:dns").lookup=deny;
        require("node:net").Socket.prototype.connect=deny;
        globalThis.fetch=deny;
        process.argv=[process.execPath,${JSON.stringify(tool)},"--check"];
        require(${JSON.stringify(tool)});
    `;
    const result = command(process.execPath, ["-e", script]);
    assert.match(result.stdout, /Verified .* ONVIF artifacts/);
    assert.match(result.stdout, /579 native operations/);
});

test("generated: manifest bytes, four-space JSON, codec privacy and additive ONVIF context agree", () => {
    const manifest = JSON.parse(readFileSync(join(base, "generated", "manifest.json"), "utf8"));
    assert.equal(manifest.registryDigest, catalog.registry.registryDigest);
    assert.equal(manifest.requirementsDigest, catalog.requirements.digest);
    for (const entry of manifest.artifacts) {
        const bytes = readFileSync(join(base, ...entry.path.split("/")));
        assert.equal(bytes.length, entry.bytes, entry.path);
        assert.equal(sha(bytes), entry.sha256, entry.path);
        if (entry.path.endsWith(".json") || entry.path.endsWith(".jsonld")) {
            const value = JSON.parse(bytes.toString("utf8"));
            assert.equal(bytes.toString("utf8"), JSON.stringify(value, null, 4) + "\n", entry.path);
        }
    }
    const context = api.readPackagedArtifact("context.jsonld")["@context"];
    assert.equal(context.onvif["@id"], "https://example.org/wot/onvif#");
    assert.equal(context["onvif:sourceDataSchema"]["@type"], "@id");
    assert.equal(context["onvif:xmlQName"]["@type"], "@json");
    assert.equal(Object.hasOwn(context, "av"), false);
    assert.equal(Object.hasOwn(context, "onvif:xml"), false, "The runtime augmentation is private, not a misleading public descriptor");
    const sources = api.readPackagedArtifact("sources.lock.json");
    assert.equal(sources.sources.length, 53);
    assert.equal(sources.sourceGroups.nativeDiscovery.length, 3);
    assert.equal(sha(readFileSync(api.packagedArtifactPath("sources.lock.json"))), catalog.registry.sourcePins.lockDigest);
    assert.equal(catalog.registry.operations.filter((entry) => entry.mappingSupport === "unsupported").length, 0);
    assert.equal(catalog.requirements.diagnostics.length, 0);
});

test("generated: independent JSON Schema and JSON-LD validation use only pinned offline resources", () => {
    const directory = mkdtempSync(join(tmpdir(), "onvif-catalog-schema-"));
    try {
        const data = { payloads: [], snapshots: [], tds: [] };
        for (const fixture of native) {
            const operation = catalog.registry.operations.find((entry) => entry.serviceNamespace === fixture.serviceNamespace
                && entry.portTypeQName.localName === fixture.portType && entry.operation === fixture.operation);
            assert.ok(operation);
            const value = api.decodeElement(operation.response, api.parseXml(fixture.xml), catalog.registry.xml);
            data.payloads.push({ fragment: `#/$defs/${operationSchemaKey(operation, "output")}`, value });
            const snapshot = { schemaVersion: 1, epr: { address: `urn:fixture:${fixture.id}`, referenceProperties: [] },
                services: [{ namespace: fixture.serviceNamespace, xaddr: `http://192.0.2.10/native/${fixture.id}`,
                    evidence, capabilities: { state: "unknown", evidence: [] },
                    readOutcomes: [{ operation: fixture.operation, portType: fixture.portType, outcome: { state: "known", value, evidence } }] }],
                profileClaims: [], resources: [] };
            data.snapshots.push(snapshot);
            const projected = api.project(snapshot, catalog, policy);
            for (const td of projected.tds) {
                assert.equal(td["@context"][1], ONVIF_CONTEXT);
                assert.equal(JSON.stringify(td).includes('"onvif:xml"'), false);
                data.tds.push(td);
            }
        }
        const input = join(directory, "cases.json");
        writeFileSync(input, JSON.stringify(data));
        const result = command("python", ["-B", join(__dirname, "validate-generated.py"), root, input]);
        const summary = JSON.parse(result.stdout.trim());
        assert.equal(summary.payloads, native.length);
        assert.equal(summary.tds, native.length);
        assert.equal(summary.ledgers, 3);
        assert.equal(summary.externalRetrieval, false);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("generated: every requirement has a per-clause runtime/process disposition, not merely a counter", () => {
    const coverage = api.readPackagedArtifact("coverage.json");
    assert.equal(coverage.requirements.length, catalog.requirements.requirements.length);
    for (const row of coverage.requirements) {
        assert.ok(row.source.sourceId);
        assert.ok(row.source.clause);
        assert.ok(row.resolution.rationale);
        assert.equal(row.requiresRuntimeOrProcessEvidence, true);
        assert.ok(row.evidenceTargets.length);
    }
    const clients = api.readPackagedArtifact("models.json").models.filter((entry) => entry.kind === "client-requirement-manifest");
    assert.equal(clients.length, 7);
    assert.ok(clients.every((entry) => entry.createsClientThing === false && !Object.hasOwn(entry, "actions")));
    assert.equal(coverage.productConformanceEstablished, false);
    assert.equal(coverage.publicationClearanceEstablished, false);
    assert.ok(coverage.ledgerReviews.every((review) => review.coverage));
});

test("generated: a real node-wot consumer invokes the compiled, projected Action with private type references", async () => {
    const fixture = native.find((entry) => entry.id === "device");
    let requests = 0;
    let wireFailure;
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
            try {
                const xml = new DOMParser().parseFromString(Buffer.concat(chunks).toString("utf8"), "application/xml");
                const body = xml.getElementsByTagNameNS("http://www.w3.org/2003/05/soap-envelope", "Body")[0];
                const elements = Array.from(body.childNodes).filter((node) => node.nodeType === 1);
                assert.equal(elements.length, 1);
                assert.equal(elements[0].namespaceURI, "http://www.onvif.org/ver10/device/wsdl");
                assert.equal(elements[0].localName, "GetDeviceInformation");
                assert.equal(elements[0].childNodes.length, 0);
                assert.equal(request.method, "POST");
                assert.match(request.headers["content-type"], /action="http:\/\/www.onvif.org\/ver10\/device\/wsdl\/GetDeviceInformation"/);
                requests++;
                response.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
                response.end(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${fixture.xml}</s:Body></s:Envelope>`);
            } catch (error) {
                wireFailure = error;
                response.writeHead(500);
                response.end("Independent wire assertion failed");
            }
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let runtime;
    try {
        const snapshot = { schemaVersion: 1, epr: { address: "urn:fixture:compiled-wire", referenceProperties: [] },
            profileClaims: [], resources: [],
            services: [{ namespace: fixture.serviceNamespace, xaddr: `${origin}/native`, evidence,
                capabilities: { state: "unknown", evidence: [] }, readOutcomes: [],
                supportedOperations: [{ operation: "GetDeviceInformation", portType: "Device",
                    support: { state: "known", value: true, evidence } }] }] };
        const td = api.project(snapshot, catalog, policy).tds[0];
        const original = JSON.stringify(td);
        runtime = await api.createOnvifRuntime({ registry: api.defineOperationRegistry(catalog.registry.operations, catalog.registry.xml),
            trust: { allowedOrigins: [origin] } });
        const thing = await runtime.consume(td);
        const result = await thing.invokeAction(Object.keys(td.actions)[0]);
        assert.deepEqual(await result.value(), fixture.expected);
        assert.equal(requests, 1);
        assert.equal(wireFailure, undefined);
        assert.equal(JSON.stringify(td), original, "The source TD is not mutated by codec augmentation");
    } finally {
        if (runtime) await runtime.close();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test("generated: artifact paths work outside the checkout and corrupted artifacts fail closed", () => {
    const directory = mkdtempSync(join(tmpdir(), "onvif-catalog-portable-"));
    try {
        const source = resolve(dirname(require.resolve("../../dist/catalog/packaged")), "..");
        const destination = join(directory, "installed", "dist");
        cpSync(source, destination, { recursive: true });
        const entry = join(destination, "catalog", "packaged.js");
        const script = `
            const p=require(${JSON.stringify(entry)});
            const c=p.loadPackagedProjectionCatalog();
            process.stdout.write(JSON.stringify({digest:c.registry.registryDigest,rows:c.requirements.requirements.length,
                path:p.packagedArtifactPath("catalog.json")}));
        `;
        const result = command(process.execPath, ["-e", script], { cwd: directory,
            env: { ...process.env, NODE_PATH: join(root, "node_modules") } });
        const summary = JSON.parse(result.stdout);
        assert.equal(summary.digest, catalog.registry.registryDigest);
        assert.equal(summary.rows, catalog.requirements.requirements.length);
        assert.ok(summary.path.startsWith(directory));
        const contextPath = join(destination, "catalog-data", "context.jsonld");
        writeFileSync(contextPath, '{"@context":{}}\n');
        const corrupted = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(entry)}).readPackagedArtifact("context.jsonld")`],
            { cwd: directory, encoding: "utf8", env: { ...process.env, NODE_PATH: join(root, "node_modules") } });
        assert.notEqual(corrupted.status, 0);
        assert.match(corrupted.stderr, /integrity mismatch/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("generated: npm's package selection includes every required registry/schema/context asset", () => {
    const npm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const result = command(process.execPath, [npm, "pack", "--dry-run", "--ignore-scripts", "--json"],
        { cwd: join(root, "packages", "binding-onvif") });
    const data = JSON.parse(result.stdout);
    const files = new Set(data[0].files.map((entry) => entry.path));
    for (const name of Object.keys(PACKAGE_ASSETS)) assert.ok(files.has(`dist/catalog-data/${name}`), name);
    assert.ok(files.has("dist/catalog-data/manifest.json"));
    assert.ok(files.has("dist/catalog/snapshot.d.ts"));
    assert.ok(files.has("dist/projection/project.d.ts"));
    assert.ok(![...files].some((path) => path.includes("third_party/") || path.endsWith(".pdf")));
});
