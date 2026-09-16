const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const f = require("./native-fixture.cjs");
const { decodeElement } = require("./.compiled/xml/mapper");
const { parseXml } = require("./.compiled/xml/parser");
const { eventTemplate, PULLPOINT_MODEL, context } = require("./.compiled/catalog/models");
const { elementSchemaUri } = require("./.compiled/catalog/schemas");
const { loadPackagedProjectionCatalog, readPackagedArtifact } = require("./.compiled/catalog/packaged");

test("generated event artifacts: persisted opt-in TM and all579 compiled graphs agree with packaged authority without conformance claims", () => {
    const packaged = loadPackagedProjectionCatalog();
    assert.equal(packaged.registry.registryDigest, f.registry.digest);
    assert.deepEqual(packaged.registry.issues, []);
    assert.equal(packaged.registry.operations.length, 579);
    assert.equal(packaged.registry.types.length, 3426);
    assert.equal(packaged.requirements.requirements.length, 2636);
    const model = readPackagedArtifact("models.json").models.find((entry) => entry.id === PULLPOINT_MODEL);
    assert.deepEqual(model.events.notifications, eventTemplate(f.catalog, "{{xaddr}}"));
    assert.deepEqual(model["tm:optional"], ["/events/notifications"]);
    const coverage = readPackagedArtifact("coverage.json");
    assert.equal(coverage.counts.unsupportedOperations, 0);
    assert.equal(coverage.counts.compiledOperations, 579);
    assert.equal(coverage.productConformanceEstablished, false);
    assert.equal(coverage.publicationClearanceEstablished, false);
    assert.ok(coverage.operations.every((entry) => entry.runtimeGate.includes("Not established by compilation")));
    assert.match(coverage.runtimeAdapters.properties, /Stateful.*drains/);
});

test("generated event artifacts: independent offline JSON Schema and JSON-LD validate complete Event data and reject malformed Forms", () => {
    const directory = mkdtempSync(join(tmpdir(), "onvif-event-schema-"));
    try {
        const model = JSON.parse(readFileSync(join(f.root, "bindings", "onvif", "models", "events", "PullPointSubscription.tm.json"), "utf8"));
        const event = structuredClone(model.events.notifications);
        event.forms[0].href = "http://127.0.0.1:49100/events";
        const td = { "@context": context(), id: "urn:independent:generated-event", title: "Generated native Event",
            securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"],
            "onvif:registryDigest": f.registry.digest, links: [{ rel: "type", href: PULLPOINT_MODEL }],
            events: { notifications: event } };
        const descriptor = f.registry.xml.elements[`{${f.N}}NotificationMessage`];
        const native = decodeElement(descriptor, parseXml(f.notification()), f.registry.xml);
        const metadataDescriptor = f.registry.xml.elements[`{${f.TT}}MetadataStream`];
        const metadataXml = `<tt:MetadataStream xmlns:tt="${f.TT}"><tt:Event>${f.notification()}</tt:Event></tt:MetadataStream>`;
        const bad = (patch) => ({ ...event.forms[0], ...patch });
        const data = { tds: [td], snapshots: [], payloads: [
            { fragment: elementSchemaUri(descriptor).slice(elementSchemaUri(descriptor).indexOf("#")), value: native },
            { fragment: elementSchemaUri(metadataDescriptor).slice(elementSchemaUri(metadataDescriptor).indexOf("#")),
                value: decodeElement(metadataDescriptor, parseXml(metadataXml), f.registry.xml) }
        ], invalidForms: [
            bad({ "onvif:binding": "soap12-http-v1" }), bad({ op: "invokeaction" }),
            bad({ "onvif:ignoredOption": true }), bad({ "onvif:subscription": { mode: "pullpoint" } })
        ] };
        const input = join(directory, "cases.json");
        writeFileSync(input, JSON.stringify(data));
        const result = spawnSync("python", ["-B", join(f.root, "packages", "binding-onvif", "test", "catalog", "validate-generated.py"), f.root, input],
            { encoding: "utf8", timeout: 30000 });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { schemas: 4, payloads: 2, tds: 1, snapshots: 0, ledgers: 3, externalRetrieval: false });
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
