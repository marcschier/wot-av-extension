"use strict";

// This file is copied into an unrelated installation directory before execution.
// Only installed public exports and independent Node/OpenSSL fixtures are used.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const https = require("node:https");
const { dirname, join, resolve, sep } = require("node:path");
const { ConsumedThing } = require("@node-wot/core");
const { Observable } = require("rxjs/Observable");
const api = require("@wot-av/binding-onvif");
const catalogApi = require("@wot-av/binding-onvif/catalog");
const { project } = require("@wot-av/binding-onvif/projection");
const { DirectoryClient } = require("@wot-av/binding-onvif/publication");
const { MediaExecutor } = require("@wot-av/binding-onvif/media");
const { createDiscoveryEngine } = require("@wot-av/binding-onvif/discovery");

const installed = resolve(process.cwd());
const packageRoot = dirname(dirname(require.resolve("@wot-av/binding-onvif")));
const asset = (name) => require.resolve(`@wot-av/binding-onvif/artifacts/${name}`);
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pem = (name) => readFileSync(process.env[`ONVIF_PACKAGE_${name}`], "utf8");
const SOAP = "http://www.w3.org/2003/05/soap-envelope";
const WSA = "http://www.w3.org/2005/08/addressing";
const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const EVENT = "http://www.onvif.org/ver10/events/wsdl";
const WSN = "http://docs.oasis-open.org/wsn/b-2";
const BW = "http://docs.oasis-open.org/wsn/bw-2";
const TT = "http://www.onvif.org/ver10/schema";
const ACTIONS = {
    GetDeviceInformation: `${DEVICE}/GetDeviceInformation`,
    CreatePullPointSubscription: `${EVENT}/EventPortType/CreatePullPointSubscriptionRequest`,
    PullMessages: `${EVENT}/PullPointSubscription/PullMessagesRequest`,
    Unsubscribe: `${BW}/SubscriptionManager/UnsubscribeRequest`
};
const live = { Manufacturer: "Independent installed-package fixture", Model: "Loopback only",
    FirmwareVersion: "live-not-inspection-cache", SerialNumber: "000042", HardwareId: "000009" };

async function main() {
    assert.equal(process.env.NODE_PATH, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert(packageRoot.startsWith(installed + sep), "Runtime must resolve inside the unrelated installation");
    for (const subpath of ["", "/catalog", "/projection", "/binding/request", "/xml/metadata", "/events", "/media", "/discovery", "/publication"]) {
        assert(require.resolve(`@wot-av/binding-onvif${subpath}`).startsWith(packageRoot + sep));
    }
    assert.equal(typeof Observable, "function");
    assert.equal(typeof MediaExecutor, "function");
    assert.equal(typeof createDiscoveryEngine, "function");
    const metadata = json(join(packageRoot, "package.json"));
    assert.equal(metadata.private, true);
    assert.equal(metadata.license, undefined);
    assert.equal(metadata.dependencies.rxjs, "5.5.12");
    assert.equal(metadata.scripts.postinstall, undefined);
    assert.equal(metadata.scripts.install, undefined);
    const provenance = require("@wot-av/binding-onvif/package-provenance.json");
    assert.equal(provenance.distributionApproved, false);
    assert.equal(provenance.nativeBinaryIncluded, false);
    for (const entry of provenance.files) {
        const data = readFileSync(join(packageRoot, "dist", ...entry.path.split("/")));
        assert.equal(data.length, entry.bytes, entry.path);
        assert.equal(sha(data), entry.sha256, entry.path);
    }
    const manifest = json(asset("generated/manifest.json"));
    assert.equal(manifest.artifacts.length + 1, provenance.canonicalArtifacts);
    const modelEntries = manifest.artifacts.filter((entry) => entry.path.startsWith("models/"));
    assert.equal(modelEntries.length, provenance.modelDocuments);
    assert.equal(new Set(manifest.artifacts.map((entry) => entry.path)).size, manifest.artifacts.length);
    for (const entry of manifest.artifacts) {
        const data = readFileSync(asset(entry.path));
        assert.equal(sha(data), entry.sha256, entry.path);
        assert.equal(data.length, entry.bytes, entry.path);
    }
    const catalog = api.loadPackagedProjectionCatalog();
    assert.equal(catalog.registry.operations.length, 579);
    assert.equal(catalog.registry.operations.filter((operation) => operation.mappingSupport === "compiled").length, 579);
    assert.equal(catalog.registry.registryDigest, manifest.registryDigest);
    const library = api.readPackagedArtifact("models.json").models;
    catalogApi.assertModelImports(catalogApi.modelIndex(library));
    assert.deepEqual(library.map((model) => model.id).sort(), modelEntries.map((entry) => entry.logicalId).sort());
    const flatManifest = json(catalogApi.packagedArtifactPath("manifest.json"));
    assert.deepEqual(flatManifest.artifacts.map((entry) => entry.path).sort(), Object.keys(manifest.packageAssets).sort());
    for (const name of Object.keys(manifest.packageAssets)) catalogApi.readPackagedArtifact(name);
    for (const name of ["mapping.schema.json", "binding.schema.json", "model-translation.json", "topic-contracts.json"]) {
        assert(Object.hasOwn(manifest.packageAssets, name), `New public artifact is packaged: ${name}`);
    }
    const media2 = "http://www.onvif.org/ver20/media/wsdl";
    const semanticOperation = {
        bindingQName: { namespace: media2, localName: "Media2Binding" },
        portTypeQName: { namespace: media2, localName: "Media2" },
        operation: "GetProfiles"
    };
    const semanticOptions = {
        id: "urn:example:isolated-package-adapter", title: "Installed semantic fragment",
        operations: [semanticOperation], evidence: [{ sourceId: "urn:example:software-only" }],
        bindingForms: [{ operation: semanticOperation, forms: [{
            href: "http://127.0.0.1:65534/actions/profiles", op: "invokeaction",
            contentType: "application/json", "htv:methodName": "POST"
        }] }],
        securityDefinitions: { local: { scheme: "nosec" } }, security: ["local"]
    };
    const semantic = catalogApi.deriveAdapterTd(catalog.registry, semanticOptions);
    assert.equal(semantic.td.links.filter((link) => link.rel === "type").length, 1);
    assert.equal(semantic.td["onvif:projection"].nativeProtocol, false);
    assert.equal(semantic.td["onvif:projection"].fullProfile, false);
    catalogApi.assertSemanticAdapterValue(catalog.registry, semanticOperation, "input", { Type: ["All"] });
    catalogApi.assertSemanticAdapterValue(catalog.registry, semanticOperation, "output", {
        Profiles: [{ $attributes: { token: "software-p1", fixed: true }, Name: "Software fixture" }]
    });
    assert.throws(() => catalogApi.assertSemanticAdapterValue(catalog.registry, semanticOperation, "output",
        { Profiles: [{ $attributes: { token: "software-p1", fixed: "not-a-boolean" } }] }));
    assert.throws(() => catalogApi.deriveAdapterTd(catalog.registry, { ...semanticOptions, claim: "full" }));
    const mapping = json(asset("generated/mapping-reference.json"));
    assert.equal(mapping.operations.length, 579);
    assert.equal(mapping.registryDigest, catalog.registry.registryDigest);
    const lock = api.readPackagedArtifact("sources.lock.json");
    assert.equal(lock.sources.filter((source) => source.storage === "vendored").length, 43);
    assert.equal(lock.sources.filter((source) => source.storage === "fetch-only").length, 3);
    assert.deepEqual(api.readPackagedArtifact("profile-editions.json").profiles.map((profile) => profile.profileId).sort(),
        ["A", "C", "D", "G", "M", "S", "T"]);

    const calls = [], directoryCalls = [], records = new Map();
    let origin, fixtureFailure, etag = 0, runtime, subscription, directory;
    const server = https.createServer({ key: pem("SERVER_KEY"), cert: pem("SERVER_CERT"),
        ca: pem("CLIENT_CERT"), requestCert: true, rejectUnauthorized: true }, (request, response) => {
        void (async () => {
            assert.equal(request.socket.authorized, true);
            const url = new URL(request.url, origin);
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
                size += chunk.length;
                assert(size <= 2 * 1024 * 1024, "Bounded independent fixture request");
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString("utf8");
            if (url.pathname === "/things" || url.pathname.startsWith("/things/")) {
                assert.equal(request.headers.authorization, `Bearer ${process.env.ONVIF_PACKAGE_DIRECTORY_TOKEN}`);
                directoryCalls.push(request.method);
                const id = decodeURIComponent(url.pathname.slice("/things/".length));
                const old = records.get(id);
                const send = (status, value, headers = {}) => {
                    response.writeHead(status, { "Content-Type": "application/td+json", ...headers });
                    response.end(value === undefined ? undefined : JSON.stringify(value));
                };
                if (request.method === "GET" && url.pathname === "/things") {
                    send(200, [...records.values()].map((entry) => entry.td), { "Content-Type": "application/ld+json" });
                } else if (request.method === "GET") {
                    send(old ? 200 : 404, old?.td, old ? { ETag: old.etag } : {});
                } else if (request.method === "PUT") {
                    const value = JSON.parse(body);
                    assert.equal(value.id, id);
                    if ((request.headers["if-none-match"] === "*" && old)
                        || (request.headers["if-match"] && request.headers["if-match"] !== old?.etag)) return send(412);
                    assert(request.headers["if-none-match"] === "*" || request.headers["if-match"], "Explicit CAS required");
                    const tag = `"fixture-${++etag}"`;
                    records.set(id, { td: value, etag: tag });
                    send(old ? 204 : 201, undefined, { ETag: tag });
                } else if (request.method === "DELETE") {
                    assert.equal(request.headers["if-match"], old?.etag);
                    records.delete(id);
                    send(204);
                } else assert.fail("Unrequested Directory operation");
                return;
            }
            assert.equal(request.method, "POST");
            const match = /<(?:[A-Za-z0-9_]+:)?Body(?:\s[^>]*)?>\s*<(?:[A-Za-z0-9_]+:)?([A-Za-z0-9_]+)/.exec(body);
            assert(match, "Native SOAP body, not JSON or an HTTP gateway");
            const name = match[1];
            assert(Object.hasOwn(ACTIONS, name), `No actuation or unrelated native operation: ${name}`);
            assert(body.includes(SOAP));
            assert(body.includes(ACTIONS[name]), "Actual WS-Addressing Action");
            assert(request.headers["content-type"].includes("application/soap+xml"));
            assert(request.headers["content-type"].includes(ACTIONS[name]), "Actual SOAP action parameter");
            calls.push(name);
            const now = () => new Date().toISOString();
            const expiry = () => new Date(Date.now() + 60000).toISOString();
            let payload;
            if (name === "GetDeviceInformation") {
                assert.equal(url.pathname, "/device");
                payload = `<d:GetDeviceInformationResponse xmlns:d="${DEVICE}">${Object.entries(live)
                    .map(([key, value]) => `<d:${key}>${value}</d:${key}>`).join("")}</d:GetDeviceInformationResponse>`;
            } else if (name === "CreatePullPointSubscription") {
                assert.equal(url.pathname, "/events");
                payload = `<e:CreatePullPointSubscriptionResponse xmlns:e="${EVENT}" xmlns:n="${WSN}" xmlns:a="${WSA}">
<e:SubscriptionReference><a:Address>${origin}/subscription?id=0007</a:Address><a:ReferenceParameters><p:Token xmlns:p="urn:package:route">0007</p:Token></a:ReferenceParameters></e:SubscriptionReference>
<n:CurrentTime>${now()}</n:CurrentTime><n:TerminationTime>${expiry()}</n:TerminationTime></e:CreatePullPointSubscriptionResponse>`;
            } else {
                assert.equal(url.pathname + url.search, "/subscription?id=0007");
                assert(body.includes("urn:package:route") && body.includes("0007") && body.includes("IsReferenceParameter"),
                    "Native subscription EPR parameters must reach the wire");
                if (name === "PullMessages") {
                    payload = `<e:PullMessagesResponse xmlns:e="${EVENT}" xmlns:n="${WSN}"><e:CurrentTime>${now()}</e:CurrentTime><e:TerminationTime>${expiry()}</e:TerminationTime>
<n:NotificationMessage><n:Topic xmlns:p="urn:package:door" Dialect="http://docs.oasis-open.org/wsn/t-1/TopicExpression/Concrete">p:Door</n:Topic>
<n:Message><tt:Message xmlns:tt="${TT}" UtcTime="2026-09-16T07:00:00.123456789Z" PropertyOperation="Changed"><tt:Source><tt:SimpleItem Name="Token" Value="000042"/></tt:Source><tt:Data><tt:SimpleItem Name="State" Value="Closed"/></tt:Data></tt:Message></n:Message></n:NotificationMessage></e:PullMessagesResponse>`;
                } else payload = `<n:UnsubscribeResponse xmlns:n="${WSN}"/>`;
            }
            const action = name === "GetDeviceInformation" ? `${ACTIONS[name]}Response` : ACTIONS[name].replace(/Request$/, "Response");
            response.writeHead(200, { "Content-Type": "application/soap+xml" });
            response.end(`<s:Envelope xmlns:s="${SOAP}" xmlns:a="${WSA}"><s:Header><a:Action>${action}</a:Action></s:Header><s:Body>${payload}</s:Body></s:Envelope>`);
        })().catch((error) => {
            fixtureFailure ??= error;
            if (!response.headersSent) response.writeHead(500);
            response.end();
        });
    });
    await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
    origin = `https://127.0.0.1:${server.address().port}`;
    try {
        const targets = [`${origin}/device`, `${origin}/events`, `${origin}/subscription?id=0007`];
        const identity = { cert: pem("CLIENT_CERT"), key: pem("CLIENT_KEY") };
        const registry = api.defineOperationRegistry(catalog.registry.operations, catalog.registry.xml);
        runtime = await api.createOnvifRuntime({ registry,
            trust: { allowedOrigins: [origin], allowedTargets: targets, tls: { ca: pem("SERVER_CERT") },
                principalTargets: { "installed-consumer": targets } },
            credentials: async (scope) => {
                assert.equal(scope.principal, "installed-consumer");
                assert.equal(scope.origin, origin);
                assert.equal(scope.scheme, "cert");
                return { origin: scope.origin, principal: scope.principal, material: { kind: "tls", ...identity } };
            } });
        const security = { securityDefinitions: { native: { scheme: "cert" } }, security: ["native"] };
        const operations = json(asset("models/operations.tm.json"));
        const action = structuredClone(Object.values(operations.actions).find((entry) =>
            entry.forms[0]["onvif:operation"].operation === "GetDeviceInformation"));
        assert(action);
        action.forms[0].href = targets[0];
        const directTd = { "@context": catalogApi.context(), id: "urn:package:direct-operation",
            title: "Installed native operation proof", ...security, "onvif:registryDigest": registry.digest,
            actions: { information: action } };
        const direct = await runtime.consume(directTd, { principal: "installed-consumer" });
        assert(direct instanceof ConsumedThing);
        assert.deepEqual((await runtime.execute(direct, "information", {})).value, live);

        const evidence = [{ sourceId: "fixture:independent-package-observation" }];
        const snapshot = { schemaVersion: 1, epr: { address: "urn:uuid:40e85fb7-2cce-44f0-8aa9-430e513fd94d", referenceProperties: [] },
            services: [{ namespace: DEVICE, xaddr: targets[0], evidence,
                capabilities: { state: "unknown", evidence: [] },
                readOutcomes: [{ operation: "GetDeviceInformation", outcome: { state: "known",
                    value: { ...live, FirmwareVersion: "old-inspection-cache" }, evidence } }] }],
            profileClaims: [{ profile: "S", edition: "1.3", role: "device", evidence }], resources: [] };
        const before = structuredClone(snapshot);
        const projected = project(snapshot, catalog, security);
        assert.deepEqual(snapshot, before);
        assert.equal(projected.tds.length, 1);
        catalogApi.assertModelImports(catalogApi.modelIndex([...library, ...projected.models]));
        assert(projected.assessments.every((entry) => entry.runtimeEvidence === "not-established-by-projection"));
        const td = projected.tds[0];
        const name = Object.keys(td.actions).find((key) => td.actions[key].forms[0]["onvif:operation"].operation === "GetDeviceInformation");
        assert(name);
        directory = new DirectoryClient({ collectionUrl: `${origin}/things`,
            contract: { verification: { mode: "attested", evidence: "Independent owned TLS fixture with explicit CRUDL and ETag assertions" },
                ownership: { mode: "etag", evidence: "Independent fixture enforces conditional create/replace/delete" },
                list: { format: "array", pageSize: 8, maxPages: 2, maxItems: 8, collectionRevision: "none" },
                expiry: { mode: "bridge-delete", outageLimitation: "Finite fixture has no server TTL; explicit cleanup is required" } },
            http: { tls: { ca: pem("SERVER_CERT"), ...identity }, authorization: { origin, principal: "package-directory",
                bearer: async () => process.env.ONVIF_PACKAGE_DIRECTORY_TOKEN } } });
        await directory.put(td, { create: true });
        const retrieved = await directory.get(td.id);
        assert.deepEqual(retrieved.td, td);
        assert.equal((await directory.list()).length, 1);
        const independent = await runtime.consume(retrieved.td, { principal: "installed-consumer" });
        assert(independent instanceof ConsumedThing);
        assert.deepEqual(await (await independent.invokeAction(name, {})).value(), live);
        await directory.delete(td.id, { etag: retrieved.etag });
        assert.equal(await directory.get(td.id), null);

        const event = structuredClone(json(asset("models/events/PullPointSubscription.tm.json")).events.notifications);
        event.forms[0].href = targets[1];
        const eventThing = await runtime.consume({ "@context": catalogApi.context(), id: targets[1],
            title: "Installed direct native Event proof", ...security, "onvif:registryDigest": registry.digest,
            events: { notifications: event } }, { principal: "installed-consumer" });
        let deliver, reject;
        const received = new Promise((yes, no) => { deliver = yes; reject = no; });
        subscription = await runtime.subscribeEvent(eventThing, "notifications",
            async (output) => { try { deliver(await output.value()); } catch (error) { reject(error); } },
            reject, { pullTimeoutMs: 0, messageLimit: 1, minimumPollIntervalMs: 100 });
        let timer;
        const notification = await Promise.race([received, new Promise((_, no) => {
            timer = setTimeout(() => no(new Error("Installed native Event delivery deadline")), 10000);
        })]).finally(() => clearTimeout(timer));
        assert.deepEqual(notification.Topic.$children.map((entry) => entry.value), ["p:Door"]);
        assert.equal(notification.Topic.$namespaces.p, "urn:package:door");
        assert(JSON.stringify(notification).includes("2026-09-16T07:00:00.123456789Z"));
        assert(JSON.stringify(notification).includes("000042") && JSON.stringify(notification).includes("Closed"));
        await subscription.stop();
        assert.equal(subscription.state, "closed");
        assert.equal(calls.filter((name) => name === "GetDeviceInformation").length, 2);
        assert.equal(calls.filter((name) => name === "CreatePullPointSubscription").length, 1);
        assert.equal(calls.filter((name) => name === "Unsubscribe").length, 1);
        assert.equal(fixtureFailure, undefined);
        for (const filename of Object.keys(require.cache)) {
            assert(filename.startsWith(installed + sep), `No repository module/loader imports: ${filename}`);
        }
        writeFileSync(process.env.ONVIF_PACKAGE_REPORT, JSON.stringify({
            result: "passed", installedRoot: installed, packageRoot, node: process.version,
            nativeCalls: calls, directoryCalls, canonicalArtifacts: manifest.artifacts.length + 1,
            modelDocuments: modelEntries.length,
            nativeThingModels: modelEntries.filter((entry) => entry.role === "thing-model" && !entry.path.startsWith("models/abstract/")).length,
            abstractThingModels: modelEntries.filter((entry) => entry.role === "thing-model" && entry.path.startsWith("models/abstract/")).length,
            clientRequirementManifests: modelEntries.filter((entry) => entry.role === "client-requirement-manifest").length,
            publicArtifactAliases: flatManifest.artifacts.length, semanticAdapterFactory: true, canonicalTypedOutputs: true,
            operations: 579, compiledOperations: 579, sourceDocuments: 43,
            registryDigest: registry.digest, sourceLockDigest: provenance.sourceLockDigest,
            catalogManifestSha256: sha(readFileSync(asset("generated/manifest.json"))),
            independentModuleResolution: true, inheritedNodePath: false,
            consumedThing: true, directOperation: true, projectedDirectoryAction: true,
            nativeEventAndAwaitedUnsubscribe: true, loopbackOnly: true,
            logicalEprBridgeFinalProof: false, nativeMediaWorkerLaunched: false, distributionApproved: false
        }, null, 4) + "\n");
    } finally {
        const cleanup = await Promise.allSettled([subscription?.stop(), runtime?.close(), directory?.close()]);
        server.closeIdleConnections();
        await new Promise((yes, no) => server.close((error) => error ? no(error) : yes()));
        for (const entry of cleanup) if (entry.status === "rejected") throw entry.reason;
        if (fixtureFailure) throw fixtureFailure;
    }
}

main().catch((error) => {
    // No fixture credentials, PEM bytes, SOAP traces or inherited debug output.
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
});
