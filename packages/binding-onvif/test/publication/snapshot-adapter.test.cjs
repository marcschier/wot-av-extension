const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
    adaptInventory, projectInventory, createInspectionRegistry, observationSummary, currentObservationTime
} = require("./.compiled/publication/snapshot-adapter.js");
const { endpointIdentity } = require("./.compiled/discovery/protocol.js");
const { PublicationError } = require("./.compiled/publication/common.js");

const NS = "http://www.onvif.org/ver10/device/wsdl";
const REC = "http://www.onvif.org/ver10/recording/wsdl";
const XADDR = "http://192.0.2.10:8080/onvif/device?literal=1";
const EPR = "urn:uuid:11111111-2222-3333-4444-555555555555";
const NOW = 1700000000000;
const operation = (name = "GetServices", namespace = NS, binding = "DeviceBinding", port = "Device") => ({
    bindingQName: { namespace, localName: binding }, portTypeQName: { namespace, localName: port }, operation: name
});
const INFO = { manufacturer: "Observed vendor", model: "Camera model 4", firmwareVersion: "1.2.3",
    serialNumber: "serial-1", hardwareId: "hardware-4" };
const known = (value, at = NOW, source = { operation: operation(), xaddr: XADDR }) =>
    ({ status: "known", value, observedAt: at, source });
const failed = (status, lastValue) => ({
    status, code: `Native-${status}`, message: "Original failure detail", observedAt: NOW,
    source: { operation: operation(), xaddr: XADDR }, partial: structuredClone(lastValue),
    lastKnown: { value: structuredClone(lastValue), observedAt: NOW - 5000,
        source: { operation: operation(), xaddr: "http://192.0.2.10/old-exact-endpoint" } }
});
function inventory() {
    const epr = { address: EPR, referenceProperties: [], referenceParameters: [] };
    const device = {
        id: endpointIdentity(epr), endpointReference: epr, state: "verified", identityConflict: false,
        epoch: 3, inspectionGeneration: 7, ordering: { instanceId: "23", sequences: [] },
        metadataVersion: "5", types: [], scopes: [], claims: [],
        endpoints: [{ xaddr: XADDR, approval: "approved", provenance: [] }], provenance: [],
        seenAt: NOW + 200, updatedAt: NOW + 200, verifiedAt: NOW, suspectSince: null,
        failedLivenessRounds: 0, lastLivenessRound: null,
        information: known(structuredClone(INFO)),
        services: known([{ namespace: NS, xaddr: XADDR, version: { major: 2, minor: 6 },
            capabilities: known({ supportsAudio: false, count: 2 }) }]),
        reads: [{ operation: operation(), xaddr: XADDR, args: { IncludeCapability: true },
            outcome: known({ Service: [] }), responded: true }],
        resources: [], observedFeatures: [], identityEvidence: [], registryEvidence: [], diagnostics: []
    };
    return { schemaVersion: 1, revision: 11, capturedAt: NOW + 1000, truncated: false,
        devices: [device], seeds: [], diagnostics: [] };
}
const item = (token, parentTokens = [], data = {}) => ({ token, parentTokens, fixed: false, data });
const resource = (kind, values, namespace = REC, at = NOW - 100) =>
    ({ namespace, xaddr: XADDR, kind, outcome: known(values, at) });
const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;

test("adaptInventory preserves exact original EPR/evidence/lastKnown and keeps principals local while projecting only current values", () => {
    const input = inventory(), device = input.devices[0];
    device.endpointReference.referenceProperties = [{ kind: "element", name: { namespace: "urn:evidence:", localName: "Route" },
        prefix: "r", namespaces: { r: "urn:evidence:" }, attributes: [], children: [{ kind: "text", value: " exact route " }] }];
    device.endpointReference.referenceParameters = [{ kind: "element", name: { namespace: "urn:evidence:", localName: "Parameter" },
        namespaces: {}, attributes: [], children: [{ kind: "text", value: "value:1" }] }];
    device.id = endpointIdentity(device.endpointReference); // Pure input identity, never a discovery mutation.
    device.information.lastKnown = { value: { ...INFO, model: "PRIVATE-LAST-KNOWN" }, observedAt: NOW - 5000 };
    const principals = [
        { xaddr: XADDR, principal: "native-local-principal", security: ["native-digest"] },
        { xaddr: "http://192.0.2.10/not-observed", principal: "unmatched-principal", security: ["other"] }
    ];
    const before = structuredClone(input);
    const [adapted] = adaptInventory(input, { principals });
    assert.equal(adapted.inventoryId, device.id);
    assert.deepEqual(adapted.observationEnvelope, before.devices[0]);
    assert.deepEqual(adapted.snapshot.epr, before.devices[0].endpointReference);
    assert.deepEqual(adapted.principals, [{ xaddr: XADDR, principal: "native-local-principal", security: ["native-digest"] }]);
    assert.deepEqual(adapted.snapshot.identity.value, INFO);
    assert.deepEqual(adapted.snapshot.identity.evidence, [{
        sourceId: 'native-read:["http://www.onvif.org/ver10/device/wsdl","DeviceBinding","http://www.onvif.org/ver10/device/wsdl","Device","GetServices"]',
        observedAt: "2023-11-14T22:13:20.000Z", operation: operation(), detail: "Exact observed XAddr: http://192.0.2.10:8080/onvif/device?literal=1"
    }]);
    assert.equal(JSON.stringify(adapted.snapshot).includes("PRIVATE-LAST-KNOWN"), false);
    assert.equal(JSON.stringify(adapted.snapshot).includes("native-local-principal"), false);
    adapted.observationEnvelope.information.lastKnown.value.model = "caller mutation";
    adapted.principals[0].security.push("caller mutation");
    adapted.snapshot.epr.referenceProperties[0].children[0].value = "caller mutation";
    assert.deepEqual(input, before);
    assert.deepEqual(principals[0].security, ["native-digest"]);
});

for (const status of ["unknown", "denied", "fault", "unsupported", "truncated", "timeout"]) {
    test(`adaptInventory preserves ${status} as non-known, not false or promoted partial/last-known inventory`, () => {
        const input = inventory(), device = input.devices[0];
        device.information = failed(status, INFO);
        device.services.value[0].capabilities = failed(status, { supportsAudio: true });
        device.reads[0].outcome = failed(status, { Enabled: true });
        device.resources = [{ ...resource("recording", []), outcome: failed(status, [item("old-recording")]) }];
        device.observedFeatures = [{ namespace: NS, feature: "audio", operation: operation(), outcome: failed(status, true) }];
        const [adapted] = adaptInventory(input, { factMappings: [{ fact: "audio", namespace: NS, pointer: "/supportsAudio" }] });
        for (const outcome of [adapted.snapshot.identity, adapted.snapshot.services[0].capabilities,
            adapted.snapshot.services[0].readOutcomes[0].outcome, adapted.snapshot.facts[`${NS}#audio`], adapted.snapshot.facts.audio]) {
            assert.equal(outcome.state, status);
            assert.equal(Object.hasOwn(outcome, "value"), false);
            assert.equal(outcome.detail, `Native-${status}: Original failure detail`);
            assert.equal(outcome.evidence[0].observedAt, "2023-11-14T22:13:20.000Z");
            assert.equal(Object.hasOwn(outcome, "lastKnown"), false);
        }
        assert.deepEqual(adapted.snapshot.resources, []);
        assert.equal(adapted.observationEnvelope.resources[0].outcome.lastKnown.value[0].token, "old-recording");
        assert.equal(adapted.observationEnvelope.reads[0].outcome.partial.Enabled, true);
        assert.match(adapted.diagnostics[0], /incomplete and last-known members are not promoted/);
        device.services = failed(status, device.services.value);
        const [withoutCurrentServices] = adaptInventory(input);
        assert.deepEqual(withoutCurrentServices.snapshot.services, []);
        assert.equal(currentObservationTime(device), null);
    });
}

test("adapter joins reads by exact endpoint and namespace, and reports non-object capabilities as fault", () => {
    const input = inventory(), device = input.devices[0];
    device.reads.push({ ...structuredClone(device.reads[0]), xaddr: "http://192.0.2.10/other" });
    device.reads.push({ operation: operation("GetRecordings", REC, "RecordingBinding", "RecordingPort"),
        xaddr: XADDR, args: {}, outcome: known({ RecordingItem: [] }) });
    device.services.value[0].capabilities = known(["not", "an object"]);
    const [adapted] = adaptInventory(input);
    assert.equal(adapted.snapshot.services[0].readOutcomes.length, 1);
    assert.equal(adapted.snapshot.services[0].readOutcomes[0].operation, "GetServices");
    assert.equal(adapted.snapshot.services[0].readOutcomes[0].binding, `{${NS}}DeviceBinding`);
    assert.equal(adapted.snapshot.services[0].capabilities.state, "fault");
    assert.deepEqual(adapted.observationEnvelope.services.value[0].capabilities.value, ["not", "an object"]);
    assert.equal(adapted.snapshot.services[0].xaddr, XADDR);
});

test("adapter maps native resource kinds and fixed false without inventing unsupported ancestry", () => {
    const input = inventory(), device = input.devices[0];
    const pairs = [
        ["media-profile", "MediaProfile"], ["video-source-configuration", "VideoSourceConfiguration"],
        ["video-encoder-configuration", "VideoEncoderConfiguration"], ["metadata-configuration", "MetadataConfiguration"],
        ["recording", "Recording"], ["recording-job", "RecordingJob"], ["track", "RecordingTrack"],
        ["access-point", "AccessPoint"], ["door", "Door"], ["access-profile", "AccessProfile"], ["schedule", "Schedule"],
        ["receiver", "Receiver"], ["analytics-configuration", "AnalyticsConfiguration"],
        ["analytics-module", "AnalyticsModule"], ["analytics-rule", "AnalyticsRule"]
    ];
    device.resources = pairs.map(([kind]) => resource(kind, [item(`token-${kind}`,
        kind === "track" ? ["rec-one"] : ["analytics-module", "analytics-rule"].includes(kind) ? ["config-one"] : [],
        { Capabilities: { Supported: false }, LocalOnly: "preserved evidence" })]));
    const [adapted] = adaptInventory(input);
    assert.deepEqual(adapted.snapshot.resources.map((value) => value.kind), [
        "MediaProfile", "VideoSourceConfiguration", "VideoEncoderConfiguration", "MetadataConfiguration", "Recording",
        "RecordingJob", "RecordingTrack", "AccessPoint", "Door", "AccessProfile", "Schedule", "Receiver",
        "AnalyticsConfiguration", "AnalyticsModule", "AnalyticsRule"
    ]);
    assert.deepEqual(adapted.snapshot.resources[6].parentTokens, [{ kind: "Recording", token: "rec-one" }]);
    assert.deepEqual(adapted.snapshot.resources[13].parentTokens, [{ kind: "AnalyticsConfiguration", token: "config-one" }]);
    assert.equal(adapted.snapshot.resources[0].facts.fixed.value, false);
    assert.deepEqual(adapted.snapshot.resources[0].facts.capabilities.value, { Supported: false });
    assert.equal(adapted.snapshot.resources[0].facts.nativeEndpoint.value, XADDR);
    device.resources = [resource("door", [item("door", ["unrepresented"])]),
        resource("track", [item("track", ["too", "many"])]), resource("recording", [{ ...item("record"), fixed: null }])];
    const [partial] = adaptInventory(input);
    assert.deepEqual(partial.snapshot.resources.map((value) => value.token), ["record"]);
    assert.equal(Object.hasOwn(partial.snapshot.resources[0].facts, "fixed"), false);
    assert.equal(partial.diagnostics.length, 2);
    assert.match(partial.diagnostics[0], /without inventing ancestry/);
});

test("parent-scoped duplicate resource identity across endpoints is rejected instead of silently merged", () => {
    const input = inventory();
    input.devices[0].resources = [resource("track", [item("track-one", ["rec-one"])]),
        { ...resource("track", [item("track-one", ["rec-one"])]), xaddr: "http://192.0.2.20/recording" }];
    assert.throws(() => adaptInventory(input), code("ResourceIdentityConflict"));
    input.devices[0].resources[1].outcome.value[0].parentTokens = ["rec-two"];
    const [adapted] = adaptInventory(input);
    assert.deepEqual(adapted.snapshot.resources.map((value) => value.parentTokens),
        [[{ kind: "Recording", token: "rec-one" }], [{ kind: "Recording", token: "rec-two" }]]);
    assert.equal(adapted.snapshot.resources[1].facts.nativeEndpoint.value, "http://192.0.2.20/recording");
});

test("native reference facts distinguish declared default, explicit QName and ScheduleToken evidence", () => {
    const input = inventory();
    input.devices[0].resources = [
        resource("access-point", [item("point", [], { Entity: "door-token" })]),
        resource("access-profile", [item("profile", [], { AccessPolicy: [
            { Entity: "point-token", EntityType: { namespace: "urn:qualified:access", localName: "CustomPoint" }, ScheduleToken: "schedule-token" }
        ] })])
    ];
    const [adapted] = adaptInventory(input);
    assert.deepEqual(adapted.snapshot.resources[0].facts.nativeReferences.value, [{
        serviceNamespace: "http://www.onvif.org/ver10/doorcontrol/wsdl", kind: "Door", token: "door-token", typeBasis: "native-declared-default"
    }]);
    assert.deepEqual(adapted.snapshot.resources[1].facts.nativeReferences.value, [
        { serviceNamespace: "urn:qualified:access", kind: "CustomPoint", token: "point-token", typeBasis: "native-explicit-QName" },
        { serviceNamespace: "http://www.onvif.org/ver10/schedule/wsdl", kind: "Schedule", token: "schedule-token", typeBasis: "native-ScheduleToken" }
    ]);
    assert.equal(adapted.observationEnvelope.resources[1].outcome.value[0].data.AccessPolicy[0].Entity, "point-token");
});

test("fact mapping preserves false, RFC6901 escapes, empty pointer and canonical array boundaries; omission stays unknown", () => {
    const input = inventory(), device = input.devices[0];
    device.services.value[0].capabilities = known({ "a/b": { "~flag": false }, values: [3, 8] });
    const mappings = [
        ["false", "/a~1b/~0flag"], ["first", "/values/0"], ["last", "/values/1"], ["past", "/values/2"],
        ["leading-zero", "/values/01"], ["negative", "/values/-1"], ["missing", "/missing"], ["root", ""]
    ].map(([fact, pointer]) => ({ fact, pointer, namespace: NS }));
    const [adapted] = adaptInventory(input, { factMappings: mappings });
    assert.deepEqual([adapted.snapshot.facts.false.value, adapted.snapshot.facts.first.value, adapted.snapshot.facts.last.value], [false, 3, 8]);
    assert.deepEqual(adapted.snapshot.facts.root.value, { "a/b": { "~flag": false }, values: [3, 8] });
    for (const name of ["past", "leading-zero", "negative", "missing"]) {
        assert.equal(adapted.snapshot.facts[name].state, "unknown");
        assert.equal(Object.hasOwn(adapted.snapshot.facts[name], "value"), false);
        assert.equal(adapted.snapshot.facts[name].detail, "The native field was omitted, not observed false.");
    }
    assert.equal(adapted.snapshot.profile, undefined);
});

test("ambiguous service/read/feature evidence becomes unknown rather than arbitrarily choosing a source", () => {
    const input = inventory(), device = input.devices[0];
    device.services.value.push({ ...structuredClone(device.services.value[0]), xaddr: "http://192.0.2.20/device" });
    device.reads.push({ ...structuredClone(device.reads[0]), xaddr: "http://192.0.2.20/device" });
    device.observedFeatures = [true, false].map((value) => ({
        namespace: NS, feature: "conditional", operation: operation(), outcome: known(value)
    }));
    const [adapted] = adaptInventory(input, { factMappings: [
        { fact: "service", namespace: NS, pointer: "/supportsAudio" },
        { fact: "read", namespace: NS, operation: "GetServices", pointer: "" },
        { fact: "absent", namespace: "urn:unobserved:service", pointer: "" }
    ] });
    for (const name of ["service", "read", "absent", `${NS}#conditional`]) {
        assert.equal(adapted.snapshot.facts[name].state, "unknown");
        assert.deepEqual(adapted.snapshot.facts[name].evidence, []);
        assert.equal(Object.hasOwn(adapted.snapshot.facts[name], "value"), false);
    }
    assert.equal(adapted.observationEnvelope.observedFeatures[0].outcome.value, true);
    assert.equal(adapted.observationEnvelope.observedFeatures[1].outcome.value, false);
});

test("invalid/duplicate fact mappings fail without modifying the native snapshot", () => {
    const input = inventory(), before = structuredClone(input);
    for (const pointer of ["not/a/pointer", "/bad~2escape", "/" + "x".repeat(2048)]) {
        assert.throws(() => adaptInventory(input, { factMappings: [{ fact: "bad", namespace: NS, pointer }] }), code("InvalidConfiguration"));
    }
    for (const factMappings of [
        [{ fact: "", namespace: NS, pointer: "" }],
        [{ fact: "same", namespace: NS, pointer: "" }, { fact: "same", namespace: NS, pointer: "" }]
    ]) assert.throws(() => adaptInventory(input, { factMappings }), code("InvalidConfiguration"));
    assert.deepEqual(input, before);
    const boundary = inventory(), key = "x".repeat(2047);
    boundary.devices[0].services.value[0].capabilities.value = { [key]: 19 };
    const [maximum] = adaptInventory(boundary, { factMappings: [{ fact: "maximum", namespace: NS, pointer: "/" + key }] });
    assert.equal(maximum.snapshot.facts.maximum.state, "known");
    assert.equal(maximum.snapshot.facts.maximum.value, 19);
});

test("profile claims and registered firmware evidence stay distinct, exact-EPR scoped and non-certifying", () => {
    const input = inventory(), device = input.devices[0];
    device.claims = [{ scope: "onvif://www.onvif.org/Profile/T", label: "T", source: "discovery-scope", observedAt: NOW }];
    device.registryEvidence = [
        { endpointAddress: EPR, profile: "T", edition: "1.0", product: "Registered product", firmwareVersion: "9.9.9",
            authority: "Registry issuer", reference: "urn:fixture:registry-entry", status: "firmware-mismatch" },
        { endpointAddress: "urn:uuid:other-device", profile: "G", edition: "1.0", product: "Other product", firmwareVersion: "1.2.3",
            authority: "Registry issuer", reference: "urn:fixture:other-entry", status: "unverified" }
    ];
    const [adapted] = adaptInventory(input, { claims: {
        [EPR]: [{ profile: "M", edition: "1.0", role: "device", evidence: [{ sourceId: "urn:manual:claim" }] }],
        [device.id]: [{ profile: "G", role: "device", evidence: [{ sourceId: "urn:wrong:key" }] }]
    } });
    assert.deepEqual(adapted.snapshot.profileClaims, [
        { profile: "T", role: "device", evidence: [{ sourceId: "discovery-scope", observedAt: "2023-11-14T22:13:20.000Z",
            detail: "onvif://www.onvif.org/Profile/T" }] },
        { profile: "M", edition: "1.0", role: "device", evidence: [{ sourceId: "urn:manual:claim" }] }
    ]);
    assert.deepEqual(adapted.snapshot.conformanceEvidence, [{ issuer: "Registry issuer", product: "Registered product",
        firmware: "9.9.9", profile: "T", edition: "1.0", source: "urn:fixture:registry-entry" }]);
    assert.equal(adapted.snapshot.identity.value.firmwareVersion, "1.2.3");
    assert.equal(adapted.snapshot.profile, undefined);
    assert.match(adapted.diagnostics[0], /another EPR remains separate/);
    assert.equal(adapted.observationEnvelope.registryEvidence.length, 2);
});

test("observationSummary exposes status/time/provenance but not current, partial or lastKnown native values", () => {
    const input = inventory(), device = input.devices[0];
    device.information = failed("denied", { ...INFO, serialNumber: "LOCAL-LAST-KNOWN-ONLY" });
    device.resources = [resource("track", [item("PRIVATE-TOKEN", ["PRIVATE-PARENT"])])];
    const summary = observationSummary(device);
    assert.equal(summary.deviceId, device.id);
    assert.equal(summary.epoch, 3);
    assert.equal(summary.inspectionGeneration, 7);
    assert.deepEqual(summary.information, {
        status: "denied", observedAt: NOW, source: { operation: operation(), xaddr: XADDR },
        code: "Native-denied", partial: true,
        lastKnown: { observedAt: NOW - 5000, source: { operation: operation(), xaddr: "http://192.0.2.10/old-exact-endpoint" } }
    });
    assert.equal(summary.resources[0].kind, "RecordingTrack");
    assert.equal(summary.resources[0].observedAt, NOW - 100);
    assert.equal(JSON.stringify(summary).includes("PRIVATE-TOKEN"), false);
    assert.equal(JSON.stringify(summary).includes("LOCAL-LAST-KNOWN-ONLY"), false);
    assert.equal(JSON.stringify(summary).includes("Original failure detail"), false);
    assert.equal(summary.semantics, "Current outcomes and prior observation times are distinct. No inferred profile edition, client qualification, or certification.");
});

test("currentObservationTime uses the oldest current read/service observation, never capture/seen/lastKnown timestamps", () => {
    const input = inventory(), device = input.devices[0];
    device.services.observedAt = NOW - 300;
    device.reads[0].outcome.observedAt = NOW - 200;
    device.reads.push({ ...structuredClone(device.reads[0]), outcome: known({ result: 1 }, NOW - 400) });
    assert.equal(currentObservationTime(device), NOW - 400);
    device.reads[1].outcome = failed("denied", { result: 1 });
    assert.equal(currentObservationTime(device), NOW - 300);
    device.reads[0].outcome = failed("unknown", { Service: [] });
    assert.equal(currentObservationTime(device), null);
    assert.equal(device.seenAt, NOW + 200);
    device.services = failed("fault", device.services.value);
    device.reads[0].outcome = known({ Service: [] });
    assert.equal(currentObservationTime(device), null);
    const zero = inventory().devices[0];
    zero.services.observedAt = 0;
    zero.reads[0].outcome.observedAt = 0;
    assert.equal(currentObservationTime(zero), 0);
});

test("resource observation time requires exact namespace/kind/token/ordered parent path and current completeness", () => {
    const device = inventory().devices[0];
    device.resources = [resource("track", [item("track", ["record-a"])], REC, NOW - 10),
        resource("track", [item("track", ["record-b"])], REC, NOW - 20)];
    const target = { serviceNamespace: REC, kind: "RecordingTrack", token: "track", parentTokens: [{ token: "record-a" }] };
    assert.equal(currentObservationTime(device, target), NOW - 10);
    assert.equal(currentObservationTime(device, { ...target, parentTokens: [{ token: "record-b" }] }), NOW - 20);
    for (const change of [{ serviceNamespace: NS }, { kind: "Recording" }, { token: "different" },
        { parentTokens: [] }, { parentTokens: [{ token: "record-a" }, { token: "extra" }] }]) {
        assert.equal(currentObservationTime(device, { ...target, ...change }), null);
    }
    device.resources[0].outcome = failed("truncated", [item("track", ["record-a"])]);
    assert.equal(currentObservationTime(device, target), null);
});

function descriptor(namespace = NS, binding = "DeviceBinding", port = "Device", name = "GetServices", action = `${namespace}/${name}`) {
    return { ...operation(name, namespace, binding, port), soapAction: action, addressingAction: action,
        request: { name: { namespace, localName: name }, type: { kind: "complex", sequence: [] } },
        response: { name: { namespace, localName: `${name}Response` }, type: { kind: "complex", sequence: [] } },
        access: "stateful", source: { kind: "fixture", document: "urn:fixture:read-contract", locator: name } };
}
const catalog = (operations) => ({ formatVersion: 1, compilerVersion: "onvif-canonical-1", registryDigest: "original-registry-pin",
    sourcePins: [], xml: { types: {}, elements: {}, attributes: {} }, types: [], services: [], operations, issues: [] });

test("inspection registry overlays only exact reviewed reads, including exceptional Event and DeviceIO action spelling", () => {
    const input = catalog([
        descriptor(),
        descriptor("http://www.onvif.org/ver10/events/wsdl", "EventBinding", "EventPortType", "GetEventProperties",
            "http://www.onvif.org/ver10/events/wsdl/EventPortType/GetEventPropertiesRequest"),
        descriptor("http://www.onvif.org/ver10/deviceIO/wsdl", "DeviceIOBinding", "DeviceIOPort", "GetServiceCapabilities",
            "http://www.onvif.org/ver10/deviceio/wsdl/GetServiceCapabilities"),
        descriptor(NS, "DeviceBinding", "Device", "SetSystemDateAndTime"),
        descriptor(NS, "DeviceBinding", "Device", "GetStatefulSideEffect")
    ]);
    const before = structuredClone(input);
    const registry = createInspectionRegistry(input);
    for (const operation of input.operations.slice(0, 3)) assert.equal(registry.resolve(operation).access, "read");
    for (const operation of input.operations.slice(3)) assert.equal(registry.resolve(operation).access, "stateful");
    assert.equal(registry.resolve(input.operations[0]).request.name.localName, "GetServices");
    assert.equal(registry.resolve(input.operations[1]).soapAction,
        "http://www.onvif.org/ver10/events/wsdl/EventPortType/GetEventPropertiesRequest");
    assert.deepEqual(input, before);
    assert.equal(input.registryDigest, "original-registry-pin");
    assert.equal(input.operations[0].access, "stateful");
});

for (const [name, mutate] of [
    ["SOAP action", (value) => { value.soapAction += "Changed"; }],
    ["addressing action", (value) => { value.addressingAction += "Changed"; }],
    ["request root namespace", (value) => { value.request.name.namespace = "urn:wrong:namespace"; }],
    ["request root name", (value) => { value.request.name.localName = "GetServiceCapabilities"; }],
    ["absent response root", (value) => { value.response = null; }],
    ["response root namespace", (value) => { value.response.name.namespace = "urn:wrong:namespace"; }],
    ["response root name", (value) => { value.response.name.localName = "DifferentResponse"; }]
]) {
    test(`inspection overlay rejects a changed ${name} instead of granting read access`, () => {
        const operation = descriptor();
        mutate(operation);
        assert.throws(() => createInspectionRegistry(catalog([operation])), code("InspectionRegistryMismatch"));
        assert.equal(operation.access, "stateful");
    });
}

test("inspection overlay does not authorize neighboring binding/port/operation tuples and rejects native mutation snapshots", () => {
    const wrongBinding = descriptor(NS, "OtherBinding"), wrongPort = descriptor(NS, "DeviceBinding", "OtherPort");
    const wrongOperation = descriptor(NS, "DeviceBinding", "Device", "SetServices");
    const registry = createInspectionRegistry(catalog([wrongBinding, wrongPort, wrongOperation]));
    for (const reference of [wrongBinding, wrongPort, wrongOperation]) assert.equal(registry.resolve(reference).access, "stateful");
    const input = inventory();
    input.devices[0].reads[0].operation = operation("SetSystemDateAndTime");
    assert.throws(() => adaptInventory(input), { code: "PolicyDenied" });
    assert.equal(input.devices[0].reads[0].operation.operation, "SetSystemDateAndTime");
});

async function projectionInputs() {
    // Read-only locked inputs; no catalog generation, output staging or dist implementation imports.
    const data = path.resolve(__dirname, "../../dist/catalog-data");
    const registry = JSON.parse(await fs.readFile(path.join(data, "catalog.json"), "utf8"));
    const requirements = JSON.parse(await fs.readFile(path.join(data, "requirements-index.json"), "utf8"));
    const input = inventory(), device = input.devices[0];
    device.reads[0] = { operation: operation("GetDeviceInformation"), xaddr: XADDR, args: {},
        outcome: known({ Manufacturer: "Observed vendor", Model: "Camera model 4", FirmwareVersion: "1.2.3",
            SerialNumber: "serial-1", HardwareId: "hardware-4" }) };
    device.services.value.push({ namespace: REC, xaddr: XADDR, version: { major: 2, minor: 0 }, capabilities: known({}) });
    device.reads.push({ operation: operation("GetRecordings", REC, "RecordingBinding", "RecordingPort"),
        xaddr: XADDR, args: {}, outcome: known({ RecordingItem: [] }) });
    device.resources = [resource("recording", [item("rec-one")]), resource("track", [item("track-one", ["rec-one"])])];
    const policy = { securityDefinitions: { native: { scheme: "digest" } }, security: ["native"], includeSafeReadAliases: true };
    return { input, registry, requirements, policy };
}

test("projectInventory preserves stable device/recording/track IDs across firmware and XAddr changes without a profile badge", async () => {
    const { input, registry, requirements, policy } = await projectionInputs();
    const device = input.devices[0];
    const first = projectInventory(input, { registry, requirements }, policy);
    const expectedIds = [
        "urn:onvif:device:9e331b34a592c350ba30fd43a4715cf0135198966fa7367be1827d68673f42e0",
        "urn:onvif:resource:99cf6b32dbff992339dba58d7a28567341ec4cbf5fd391ac983c2e0a4ff12eec",
        "urn:onvif:resource:bf9178fde7572af18955b944f1367e57304e3315785a1e2850fdfc1c5f266773"
    ];
    assert.deepEqual(first.devices[0].projection.tds.map((td) => td.id), expectedIds);
    const track = first.devices[0].projection.tds[1];
    assert.deepEqual(track["onvif:resourceIdentity"].parentTokens, [{ kind: "Recording", token: "rec-one" }]);
    assert.equal(track.links.find((link) => link.rel === "up").href, expectedIds[2]);
    assert.equal(first.devices[0].snapshot.identity.value.firmwareVersion, "1.2.3");
    const deviceTd = first.devices[0].projection.tds[0];
    assert.equal(deviceTd.profile, undefined);
    assert.equal(deviceTd.links.filter((link) => link.rel === "type").length, 1);
    device.information.value.firmwareVersion = "2.0.0";
    device.services.value.forEach((service) => { service.xaddr = "http://192.0.2.11:8080/new-native"; });
    device.reads.forEach((read) => { read.xaddr = "http://192.0.2.11:8080/new-native"; });
    device.resources.forEach((entry) => { entry.xaddr = "http://192.0.2.11:8080/new-native"; });
    const second = projectInventory(input, { registry, requirements }, policy);
    assert.deepEqual(second.devices[0].projection.tds.map((td) => td.id), expectedIds);
    assert.equal(second.devices[0].snapshot.identity.value.firmwareVersion, "2.0.0");
    assert.equal(second.devices[0].projection.tds[0]["onvif:registryDigest"], deviceTd["onvif:registryDigest"]);
    assert.equal(first.inventory.devices[0].information.value.firmwareVersion, "1.2.3");
    assert.equal(first.inventory.revision, 11);
    assert.equal(first.inventory.capturedAt, NOW + 1000);
});

test("projectInventory projects a valid observed native read with its exact SOAP form, never a publication control gateway", async () => {
    const { input, registry, requirements, policy } = await projectionInputs();
    const projected = projectInventory(input, { registry, requirements }, policy);
    const device = projected.devices[0];
    const forms = Object.values(device.projection.tds[0].actions).flatMap((action) => action.forms);
    const read = forms.find((form) => form["onvif:operation"].operation === "GetDeviceInformation");
    assert.deepEqual(read, {
        href: XADDR, op: "invokeaction", contentType: "application/soap+xml", "htv:methodName": "POST",
        "onvif:binding": "soap12-http-v1", "onvif:operation": operation("GetDeviceInformation"),
        "onvif:soapAction": `${NS}/GetDeviceInformation`, security: ["native"]
    }, JSON.stringify(device.projection.diagnostics.filter((entry) => entry.code === "invalid-read-result")));
    assert.equal(device.projection.tds[0].title, "Observed vendor Camera model 4");
    assert.equal(device.snapshot.identity.value.firmwareVersion, "1.2.3");
});

for (const [label, registeredFirmware, unknownIdentity, match] of [
    ["matching current firmware", "1.2.3", false, "true"],
    ["mismatched current firmware", "8.8.8", false, "false"],
    ["only last-known firmware", "1.2.3", true, "unknown"]
]) {
    test(`projectInventory keeps claims/conditional facts distinct from registered evidence for ${label}`, async () => {
        const { input, registry, requirements, policy } = await projectionInputs();
        const device = input.devices[0];
        device.claims = [{ scope: "onvif://www.onvif.org/Profile/T", label: "T", source: "discovery-scope", observedAt: NOW }];
        device.registryEvidence = [{ endpointAddress: EPR, profile: "T", edition: "1.0", product: "Registered product",
            firmwareVersion: registeredFirmware, authority: "Registry issuer", reference: "urn:fixture:registered:firmware",
            status: "matched" }]; // Even this input label cannot certify mismatched or last-known firmware.
        if (unknownIdentity) device.information = failed("unknown", INFO);
        const projected = projectInventory(input, { registry, requirements }, policy, {
            principals: [{ xaddr: XADDR, principal: "native-local-principal-should-stay-local", security: ["native"] }],
            factMappings: [{ fact: "conditional-audio", namespace: NS, pointer: "/supportsAudio" }]
        });
        const result = projected.devices[0].projection.tds[0];
        assert.deepEqual(result["onvif:profileClaims"], [{
            profile: "T", role: "device", evidence: [{ sourceId: "discovery-scope",
                observedAt: "2023-11-14T22:13:20.000Z", detail: "onvif://www.onvif.org/Profile/T" }]
        }]);
        assert.deepEqual(result["onvif:conformanceEvidence"], [{
            issuer: "Registry issuer", product: "Registered product", firmware: registeredFirmware, profile: "T",
            edition: "1.0", source: "urn:fixture:registered:firmware", matchesObservedFirmware: match, independentlyVerified: false
        }]);
        assert.equal(result["onvif:capabilityEvidence"]["conditional-audio"].state, "known");
        assert.equal(result["onvif:capabilityEvidence"]["conditional-audio"].value, false);
        assert.equal(result.profile, undefined);
        assert.equal(result["onvif:claimSemantics"],
            "Advertised claims, observations, registered firmware evidence and runtime qualification are distinct. No profile conformance is inferred.");
        assert.equal(projected.devices[0].principals[0].principal, "native-local-principal-should-stay-local");
        assert.equal(JSON.stringify(projected.devices[0].projection).includes("native-local-principal-should-stay-local"), false);
        assert.equal(projected.devices[0].observationEnvelope.information.status, unknownIdentity ? "unknown" : "known");
    });
}
