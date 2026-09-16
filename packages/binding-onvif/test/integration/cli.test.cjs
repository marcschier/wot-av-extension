const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const selfsigned = require("selfsigned");
const { loadBridgeConfiguration } = require("../../dist/cli/config.js");
const { createOnvifRuntime, loadPackagedCatalog, defineOperationRegistry, RuntimeReadAdapter,
    operationKey, readEndpointReference, parseXml } = require("../../dist/index.js");
const wire = require("../fixtures/endpoint.cjs");
const { nativeFixture, NS, DSA, WSA } = require("./fixtures/native.cjs");

const cli = path.resolve(__dirname, "../../dist/cli/main.js");
const policy = { securityDefinitions: { native: { scheme: "nosec" } }, security: ["native"] };
async function temporary(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-cli-proof-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
const write = (file, value) => fs.writeFile(file, JSON.stringify(value));
const command = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000 });

test("CLI bin help, inspect, export and run-once execute real configured modes; unknown scope and implicit continuous run fail",
    { timeout: 60000 }, async (t) => {
        const root = await temporary(t), snapshotPath = path.join(root, "inventory.json"), configPath = path.join(root, "bridge.json");
        const models = path.join(root, "models"), things = path.join(root, "things");
        await Promise.all([fs.mkdir(models), fs.mkdir(things)]);
        const snapshot = { schemaVersion: 1, revision: 7, capturedAt: Date.now(), truncated: false, devices: [], seeds: [], diagnostics: [] };
        await write(snapshotPath, snapshot);
        const config = { schemaVersion: 1, input: { mode: "fixture", path: snapshotPath }, projection: policy,
            output: { mode: "file", owner: "cli-proof", directory: things, models: { directory: models, baseUrl: "https://models.example.invalid/onvif/" } } };
        await write(configPath, config);
        const help = command("--help");
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /inspect\|export\|run/);
        const inspect = command("inspect", "--config", configPath);
        assert.equal(inspect.status, 0, inspect.stderr);
        assert.deepEqual(JSON.parse(inspect.stdout), snapshot);
        assert.deepEqual(await fs.readdir(models), [], "inspect performs no publication even with file output configured");
        for (const [mode, extra] of [["export", []], ["run", ["--once"]]]) {
            const result = command(mode, "--config", configPath, ...extra);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(JSON.parse(result.stdout).nativeControlGateway, false);
            assert.equal(JSON.parse(result.stdout).conformanceEstablished, false);
            assert.equal(JSON.parse(await fs.readFile(path.join(things, "inventory-publication.json"), "utf8")).inventoryRevision, 7);
            assert.equal(JSON.parse(await fs.readFile(path.join(models, "onvif-bundle-manifest.json"), "utf8")).owner, "cli-proof");
        }
        const continuous = command("run", "--config", configPath);
        assert.equal(continuous.status, 1);
        assert.equal(JSON.parse(continuous.stderr).code, "InvalidConfiguration");
        assert.equal(command("inspect", "--config", configPath, "--once").status, 2);
        assert.equal(command("inspect", "--config", "relative.json").status, 1);
        await write(configPath, { ...config, uncontrolledNetwork: true });
        const invalid = command("inspect", "--config", configPath);
        assert.equal(invalid.status, 1);
        assert.equal(JSON.parse(invalid.stderr).code, "InvalidConfiguration");
    });

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

test("CLI certificate references retain native security and DataSchema; a separate principal reads changed device data rather than cached inspection",
    { timeout: 60000 }, async (t) => {
        const root = await temporary(t), host = certificate("loopback-host", true);
        const inspector = certificate("certificate-inspector"), consumerIdentity = certificate("certificate-consumer");
        const native = await nativeFixture({ profiles: ["C"], auth: false,
            tls: { key: host.private, cert: host.cert, ca: [inspector.cert, consumerIdentity.cert], requestCert: true, rejectUnauthorized: true } });
        const caFile = path.join(root, "ca.pem"), certFile = path.join(root, "identity.pem"), keyFile = path.join(root, "identity.key");
        await Promise.all([fs.writeFile(caFile, host.cert), fs.writeFile(certFile, inspector.cert), fs.writeFile(keyFile, inspector.private)]);
        const configPath = path.join(root, "bridge.json");
        const security = { securityDefinitions: { native: { scheme: "cert" } }, security: ["native"] };
        const config = { schemaVersion: 1, input: { mode: "discover", discovery: native.discoveryOptions(),
            inventory: { mode: "memory" }, native: { securityDefinitions: security.securityDefinitions, tlsCaFile: caFile,
                targets: native.allowedXAddrs.map((xaddr) => ({ xaddr, principal: "certificate-inspector", security: ["native"],
                    credential: { kind: "tls", certFile, keyFile } })) } }, projection: security, output: { mode: "inspect" } };
        await write(configPath, config);
        let bridge, consumer;
        t.after(async () => {
            const clients = await Promise.allSettled([bridge?.close(), consumer?.close()]);
            await native.close();
            for (const result of clients) if (result.status === "rejected") throw result.reason;
        });
        ({ bridge } = await loadBridgeConfiguration(configPath, "inspect", {}));
        await bridge.start();
        const inspected = await bridge.inspect();
        assert.equal(inspected.inventory.devices[0].information.value.firmwareVersion, "1.0");
        const td = inspected.projection.devices[0].projection.tds.find((entry) => entry["@type"] === "onvif:DeviceThing");
        assert.deepEqual(td.securityDefinitions.native, { scheme: "cert" });
        const [name, action] = Object.entries(td.actions).find(([, entry]) => entry.forms[0]["onvif:operation"].operation === "GetDeviceInformation");
        assert.equal(typeof action.output["onvif:sourceDataSchema"], "string");
        assert.match(action.output["onvif:sourceDataSchema"], /payloads\.schema\.json#/);
        assert.equal(JSON.stringify(td).includes("PRIVATE KEY"), false);
        assert.ok(native.peers.every((peer) => peer === "certificate-inspector"));
        await bridge.close();
        native.devices[0].firmware = "2.0-after-inspection";
        const catalog = loadPackagedCatalog();
        consumer = await createOnvifRuntime({ registry: defineOperationRegistry(catalog.operations, catalog.xml),
            trust: { allowedOrigins: [native.origin], allowedTargets: native.allowedXAddrs, tls: { ca: host.cert },
                principalTargets: { "certificate-consumer": native.allowedXAddrs } },
            credentials: async (scope) => {
                assert.equal(scope.principal, "certificate-consumer");
                assert.equal(scope.scheme, "cert");
                return { origin: scope.origin, principal: scope.principal,
                    material: { kind: "tls", cert: consumerIdentity.cert, key: consumerIdentity.private } };
            } });
        const thing = await consumer.consume(td, { principal: "certificate-consumer" });
        const result = await (await thing.invokeAction(name, {})).value();
        assert.equal(result.FirmwareVersion, "2.0-after-inspection");
        assert.equal(result.SerialNumber, "0000C");
        assert.equal(native.peers.at(-1), "certificate-consumer");
        for (const mutate of [
            (value) => { value.input.native.securityDefinitions.native.scheme = "basic"; },
            (value) => { value.input.native.securityDefinitions.native.unimplementedSecurityParameter = true; },
            (value) => { value.input.native.targets[0].credential.password = "must-never-be-accepted"; },
            (value) => { value.projection.securityDefinitions = { native: { scheme: "nosec" } }; },
            (value) => { value.input.native.targets[0].xaddr += "&unapproved=true"; }
        ]) {
            const invalid = structuredClone(config);
            mutate(invalid);
            await write(configPath, invalid);
            await assert.rejects(loadBridgeConfiguration(configPath, "inspect", {}), { code: "InvalidConfiguration" });
        }
        assert.deepEqual({ actuations: native.counters.actuations, subscriptions: native.counters.subscriptions,
            searches: native.counters.searches }, { actuations: 0, subscriptions: 0, searches: 0 });
    });

for (const namespace of [DSA, WSA]) {
    test(`addressed read hook preserves ${namespace} logical To, ordered EPR headers, principal and physical target`, { timeout: 15000 }, async (t) => {
        const epr = readEndpointReference(parseXml(`<a:EndpointReference xmlns:a="${namespace}"><a:Address>urn:fixture:logical-device</a:Address>${namespace === DSA ? '<a:ReferenceProperties><p:Partition xmlns:p="urn:fixture:route">0001</p:Partition></a:ReferenceProperties>' : ""}<a:ReferenceParameters><p:Route xmlns:p="urn:fixture:route">first</p:Route><p:Route xmlns:p="urn:fixture:route">second</p:Route></a:ReferenceParameters></a:EndpointReference>`));
        const server = await wire.endpoint((request, response, body) => {
            const xml = wire.parseWire(body), header = wire.one(xml, wire.SOAP, "Header");
            assert.equal(wire.one(xml, namespace, "To").textContent, "urn:fixture:logical-device");
            assert.equal(wire.one(xml, namespace, "Action").textContent, `${NS.device}/GetDeviceInformation`);
            assert.deepEqual(Array.from(header.getElementsByTagNameNS("urn:fixture:route", "Route")).map((entry) => entry.textContent), ["first", "second"]);
            if (namespace === DSA) {
                const partition = wire.one(header, "urn:fixture:route", "Partition");
                assert.equal(partition.textContent, "0001");
                assert.equal(partition.hasAttributeNS(WSA, "IsReferenceParameter"), false);
            }
            assert.equal(request.url, "/onvif/device_service");
            wire.reply(response);
        });
        const catalog = loadPackagedCatalog(), registry = defineOperationRegistry(catalog.operations, catalog.xml);
        const reference = catalog.operations.find((entry) => entry.serviceNamespace === NS.device && entry.operation === "GetDeviceInformation");
        const adapter = new RuntimeReadAdapter({
            runtimeOptions: () => ({ registry, trust: { allowedOrigins: [server.origin], allowedTargets: [server.url],
                principalTargets: { "addressed-inspector": [server.url] } } }),
            security: () => policy, principal: () => "addressed-inspector",
            execute: async (runtime, thing, args, target, request) => (await runtime.execute(thing, "inspect", args, {
                target: target.xaddr, signal: request.signal, timeoutMs: request.timeoutMs, maxResponseBytes: request.maxBytes,
                addressing: { namespace: epr.addressingNamespace, to: epr.address,
                    referenceProperties: epr.referenceProperties, referenceParameters: epr.referenceParameters }
            })).value
        });
        t.after(async () => { try { await adapter.close(); } finally { await server.close(); } });
        const result = await adapter.executeReadonly(operationKey(reference), {}, {
            xaddr: server.url, endpointReference: epr, interfaceId: "owned", segmentId: "loopback"
        }, { signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 32768 });
        assert.equal(result.status, "known");
        assert.equal(result.value.HardwareId, "0000");
        assert.equal(server.requests.length, 1);
    });
}
