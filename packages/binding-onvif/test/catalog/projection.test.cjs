const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const api = require("../../dist");
const { generateModels, profileModelId } = require("../../dist/catalog/models");
const { modelIndex, assertModelImports, resolveModel } = require("../../dist/catalog/model-resolver");

const root = resolve(__dirname, "..", "..", "..", "..");
const registry = api.compileCatalog({ root });
const requirements = api.loadRequirementIndex(root, registry);
const catalog = { registry, requirements };
const native = require("./fixtures/native-responses.json").cases;
const goldens = require("./fixtures/projection-goldens.json");
const policy = { securityDefinitions: { fixture: { scheme: "nosec" } }, security: ["fixture"] };
const proof = (id) => [{ sourceId: `fixture:${id}` }];
const known = (value, id = "known") => ({ state: "known", value, evidence: proof(id) });
const unknown = (state = "unknown") => ({ state, evidence: [] });
const fixtures = new Map(native.map((fixture) => [fixture.id, fixture]));
const staticModels = [...generateModels(registry, requirements).values()];

function service(id, xaddr) {
    const fixture = fixtures.get(id);
    const operation = registry.operations.find((entry) => entry.serviceNamespace === fixture.serviceNamespace
        && entry.portTypeQName.localName === fixture.portType && entry.operation === fixture.operation);
    assert.ok(operation);
    const value = api.decodeElement(operation.response, api.parseXml(fixture.xml), registry.xml);
    return { namespace: fixture.serviceNamespace, xaddr, evidence: proof(id),
        capabilities: value.Capabilities ? known(value.Capabilities, id) : unknown(),
        readOutcomes: [{ operation: fixture.operation, portType: fixture.portType, outcome: known(value, id) }] };
}
function snapshot(example, role = "device") {
    const result = { schemaVersion: 1, epr: { address: goldens.epr, referenceProperties: [] },
        profileClaims: [{ profile: example.profile, edition: example.edition, role, evidence: proof("profile-claim") }],
        services: [], resources: [] };
    if (role === "client") return result;
    const observed = service(example.nativeFixture, example.endpoint);
    result.services = [service("device", "http://192.0.2.10/native/device"), observed];
    const value = observed.readOutcomes[0].outcome.value;
    const resource = (kind, token, parentTokens = [], facts) => ({
        serviceNamespace: observed.namespace, kind, token, parentTokens, evidence: proof(example.nativeFixture),
        ...(facts ? { facts } : {})
    });
    if (value.Profiles) result.resources = value.Profiles.map((profile) =>
        resource("MediaProfile", profile.$attributes.token, [], { fixed: known(profile.$attributes.fixed, "fixed-native-attribute") }));
    if (value.RecordingItem) result.resources = value.RecordingItem.flatMap((recording) => [
        resource("Recording", recording.RecordingToken),
        ...recording.Tracks.Track.map((track) => resource("RecordingTrack", track.TrackToken, [{ kind: "Recording", token: recording.RecordingToken }]))
    ]);
    if (value.DoorInfo) result.resources = value.DoorInfo.map((door) => resource("Door", door.$attributes.token));
    if (value.DigitalInputs) result.resources = value.DigitalInputs.map((input) => resource("DigitalInput", input.$attributes.token));
    return result;
}

function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}
const names = (td) => Object.values(td.actions).map((action) => action.forms[0]["onvif:operation"].operation).sort();

for (const example of goldens.cases) {
    test(`projection: Profile ${example.profile} device/native-input golden`, () => {
        const input = snapshot(example), original = structuredClone(input);
        const output = api.project(deepFreeze(input), catalog, policy);
        assert.deepEqual(input, original, "project is not permitted to mutate its snapshot");
        assert.equal(output.tds.length, example.tdCount);
        const device = output.tds.find((td) => td.id === goldens.deviceId);
        assert.ok(device);
        assert.deepEqual(names(device), example.deviceActions);
        assert.deepEqual(output.tds.filter((td) => td.id !== device.id).map((td) => td["onvif:resourceIdentity"].kind).sort(),
            [...example.resourceKinds].sort());
        for (const action of Object.values(device.actions)) {
            assert.equal(action.safe, false);
            assert.equal(action.idempotent, false);
            assert.equal(action.forms[0]["onvif:binding"], "soap12-http-v1");
            assert.ok(action.input["onvif:sourceDataSchema"]);
            const operation = action.forms[0]["onvif:operation"].operation;
            assert.equal(action.forms[0].href, operation === "GetDeviceInformation" ? "http://192.0.2.10/native/device" : example.endpoint);
            assert.equal(Object.hasOwn(action.input, "onvif:xml"), false);
        }
        const models = modelIndex([...staticModels, ...output.models]);
        assertModelImports(models);
        for (const td of output.tds) {
            const types = td.links.filter((link) => link.rel === "type");
            assert.equal(types.length, 1);
            assert.notEqual(types[0].href, profileModelId(example.profile, example.edition), "Partial snapshots do not instantiate complete profile wrappers");
            const composite = models.get(types[0].href);
            assert.equal(composite.links.filter((link) => link.rel === "tm:extends").length, 1);
            const resolved = resolveModel(types[0].href, models);
            assert.deepEqual(Object.keys(resolved.actions).sort(), Object.keys(td.actions).sort());
            assert.equal(td["onvif:registryDigest"], registry.registryDigest);
        }
        assert.ok(output.assessments.every((row) => row.runtimeEvidence === "not-established-by-projection"));
        assert.ok(output.assessments.length > 0);
        assert.equal(output.clientManifests.length, 0);
    });
    test(`projection: Profile ${example.profile} client and combined-role goldens`, () => {
        const client = api.project(snapshot(example, "client"), catalog, policy);
        assert.equal(client.tds.length, goldens.clientRole.tdCount);
        assert.equal(client.clientManifests.length, goldens.clientRole.clientManifestCount);
        assert.equal(client.clientManifests[0].createsClientThing, false);
        assert.equal(Object.hasOwn(client.clientManifests[0], "actions"), false);
        assert.ok(client.assessments.every((row) => row.role === "client"));
        const combined = snapshot(example);
        combined.profileClaims.push({ profile: example.profile, edition: example.edition, role: "client", evidence: proof("client-claim") });
        const mixed = api.project(combined, catalog, policy);
        assert.equal(mixed.clientManifests.length, goldens.mixedRole.clientManifestCount);
        assert.deepEqual(names(mixed.tds.find((td) => td.id === goldens.deviceId)), example.deviceActions);
        assert.ok(mixed.assessments.some((row) => row.role === "device"));
        assert.ok(mixed.assessments.some((row) => row.role === "client"));
    });
}

test("projection: absent/denied/truncated facts are unknown, boolean coercion is forbidden and null remains null", () => {
    const expression = api.condition({ all: [
        { any: [{ fact: "native", equals: true }, { fact: "proprietary", equals: true }] },
        { not: { fact: "disabled", equals: true } }
    ] });
    assert.equal(api.evaluateCondition(expression, { native: known(false), proprietary: unknown("denied"), disabled: known(false) }).value, "unknown");
    assert.equal(api.evaluateCondition(expression, { native: known(false), proprietary: known(true), disabled: known(false) }).value, "true");
    assert.equal(api.evaluateCondition(expression, { native: known(false), proprietary: known(false), disabled: unknown("truncated") }).value, "false");
    assert.equal(api.evaluateCondition(api.condition({ fact: "typed", equals: true }), { typed: known("true") }).value, "unknown");
    assert.equal(api.evaluateCondition(api.condition({ fact: "nullable", equals: null }), { nullable: known(null) }).value, "true");
    assert.equal(api.evaluateCondition(api.condition({ not: { fact: "missing", equals: true } }), {}).value, "unknown");
    assert.equal(api.evaluateCondition(api.condition({ all: [{ fact: "known", equals: true }, { invalidOperator: "must-not-be-true" }] }),
        { known: known(true) }).value, "unknown");
});

test("projection: source editions and unresolved S/G editorial obligations are preserved, not inferred", () => {
    assert.equal(requirements.profileEditions.find((profile) => profile.profileId === "S").documentDate, "2019-11");
    assert.equal(requirements.editorialDecisions.find((entry) => entry.id === "profile-s-november-edition").status, "resolved-by-document");
    const input = snapshot(goldens.cases.find((entry) => entry.profile === "G"));
    input.facts = { "device.feature.dynamicTracks": known(true, "explicit-proprietary-and-native-evidence") };
    const projected = api.project(input, catalog, policy);
    for (const id of ["G-9.2.3-device-recording-set-track-configuration", "G-9.2.1-device-track-description-update"]) {
        const row = projected.assessments.find((entry) => entry.requirementId === id);
        assert.ok(row);
        assert.equal(row.applicability, "unknown");
        assert.ok(row.unresolvedEditorialDecisionIds.includes("profile-g-settrackconfiguration-condition"));
    }
    const unversioned = snapshot(goldens.cases[0]);
    delete unversioned.profileClaims[0].edition;
    const partial = api.project(unversioned, catalog, policy);
    assert.equal(partial.assessments.length, 0);
    assert.ok(partial.diagnostics.some((entry) => entry.code === "unversioned-profile-claim"));
    assert.deepEqual(partial.tds.find((td) => td.id === goldens.deviceId)["onvif:profileModels"], []);
});

test("projection: at-least-N groups count complete active branches, never exclusive oneOf or remote reads", () => {
    const input = snapshot(goldens.cases.find((entry) => entry.profile === "A"), "client");
    const group = requirements.obligationGroups.find((entry) => entry.id === "A-client-access-profile-list");
    assert.ok(group);
    input.facts = Object.fromEntries(group.branches.flatMap((branch) => branch.requirementIds.map((id) => [`requirement:${id}`, known(true, id)])));
    const output = api.project(input, catalog, policy);
    const assessment = output.clientManifests[0].obligationGroups.find((entry) => entry.id === group.id);
    assert.equal(assessment.implementationEvidence, "true");
    assert.equal(assessment.branches.filter((entry) => entry.implementationEvidence === "true").length, 2);
    assert.equal(assessment.isProfileConformanceResult, false);
    const noEvidence = api.project(snapshot(goldens.cases.find((entry) => entry.profile === "A"), "client"), catalog, policy);
    assert.equal(noEvidence.clientManifests[0].obligationGroups.find((entry) => entry.id === group.id).implementationEvidence, "unknown");
});

test("projection: IDs are endpoint-independent but include namespace, kind, parent path and reference properties", () => {
    const input = snapshot(goldens.cases.find((entry) => entry.profile === "G"));
    assert.equal(api.deviceThingId(input), goldens.deviceId);
    const track = input.resources.find((entry) => entry.kind === "RecordingTrack");
    const expected = `urn:onvif:resource:${createHash("sha256").update(JSON.stringify([
        goldens.epr, [], track.serviceNamespace, "RecordingTrack", [{ kind: "Recording", token: "rec-001" }], "0001"
    ])).digest("hex")}`;
    assert.equal(api.resourceThingId(input, track), expected);
    const original = api.project(input, catalog, policy);
    input.services.forEach((entry) => { entry.xaddr = entry.xaddr.replace("192.0.2.10", "192.0.2.20"); });
    const moved = api.project(input, catalog, policy);
    assert.deepEqual(moved.tds.map((entry) => entry.id), original.tds.map((entry) => entry.id));
    assert.deepEqual(moved.models.map((entry) => entry.id), original.models.map((entry) => entry.id));
    assert.notEqual(api.resourceThingId(input, { ...track, parentTokens: [{ kind: "Recording", token: "rec-002" }] }), expected);
    assert.notEqual(api.resourceThingId(input, { ...track, kind: "Recording" }), expected);
    assert.notEqual(api.resourceThingId(input, { ...track, serviceNamespace: "urn:other-service" }), expected);
    const scoped = structuredClone(input);
    scoped.epr.referenceProperties = [api.parseXml('<v:key xmlns:v="urn:vendor">other</v:key>')];
    assert.notEqual(api.deviceThingId(scoped), goldens.deviceId);
});

test("projection: fixed profiles are non-deletable, not immutable, and inventory tokens never become schema enums", () => {
    const input = snapshot(goldens.cases[0]);
    input.resources[0].operations = [{ operation: "DeleteProfile", portType: "Media" }, { operation: "AddVideoSourceConfiguration", portType: "Media" }];
    const output = api.project(input, catalog, policy);
    const profile = output.tds.find((entry) => entry["onvif:resourceIdentity"]?.token === "0001");
    assert.deepEqual(names(profile), ["AddVideoSourceConfiguration"]);
    assert.ok(output.diagnostics.some((entry) => entry.code === "fixed-profile-nondeletable"));
    assert.ok(!JSON.stringify(profile.actions).includes('"enum":["0001"'), "Current inventories cannot freeze the native argument domain");
    const reference = structuredClone(input.resources[0]);
    reference.token = "new-profile-created-after-generation";
    input.resources.push(reference);
    const expanded = api.project(input, catalog, policy);
    assert.equal(expanded.tds.length, output.tds.length + 1);
});

test("projection: only explicit safe aliases are safe and stateful GetSearchResults remains an unsafe Action", () => {
    const input = snapshot(goldens.cases[0]);
    input.services.push({ namespace: "http://www.onvif.org/ver10/search/wsdl", xaddr: "http://192.0.2.10/native/search",
        evidence: proof("search"), capabilities: unknown(), readOutcomes: [], supportedOperations: [
            { operation: "GetRecordingSearchResults", portType: "SearchPort", support: known(true, "explicit-operation-support") }
        ] });
    const output = api.project(input, catalog, { ...policy, includeSafeReadAliases: true });
    const device = output.tds.find((entry) => entry.id === goldens.deviceId);
    const search = Object.entries(device.actions).filter(([, action]) => action.forms[0]["onvif:operation"].operation === "GetRecordingSearchResults");
    assert.equal(search.length, 1);
    assert.equal(search[0][1].safe, false);
    assert.equal(search[0][1].idempotent, false);
    assert.ok(Object.entries(device.actions).some(([id, action]) => id.startsWith("read_") && action.safe && action.idempotent));
});

test("projection: malformed/denied outcomes and unsupported operations cannot create success-shaped affordances", () => {
    const input = snapshot(goldens.cases[0]);
    input.services[0].readOutcomes[0].outcome = known({ Manufacturer: "incomplete" });
    input.services[1].readOutcomes[0].outcome = unknown("denied");
    const output = api.project(input, catalog, policy);
    assert.deepEqual(names(output.tds.find((td) => td.id === goldens.deviceId)), []);
    assert.ok(output.diagnostics.some((entry) => entry.code === "invalid-read-result"));
    assert.ok(output.diagnostics.some((entry) => entry.code === "read-denied"));
    assert.throws(() => api.project({ ...input, extra: true }, catalog, policy), { code: "InvalidValue" });
    assert.throws(() => api.project(input, catalog, { ...policy, security: [] }), { code: "InvalidValue" });
    assert.throws(() => api.project(input, catalog, { securityDefinitions: { credential: { scheme: "digest", password: "never-publish" } }, security: ["credential"] }), { code: "InvalidValue" });
    const forbidden = structuredClone(input); forbidden.services[0].xaddr = "http://name:secret@192.0.2.10/native";
    assert.throws(() => api.project(forbidden, catalog, policy), { code: "InvalidValue" });
});

test("projection: deterministic composition has no caller aliases, duplicate client IDs, fake endpoints or missing imports", () => {
    const input = snapshot(goldens.cases[0]);
    input.profileClaims.push({ ...input.profileClaims[0], evidence: proof("independent-claim") });
    const first = api.project(input, catalog, policy);
    const reordered = structuredClone(input);
    reordered.services.reverse(); reordered.resources.reverse(); reordered.profileClaims.reverse();
    const second = api.project(reordered, catalog, policy);
    assert.deepEqual(second, first);
    first.tds.find((entry) => entry.id === goldens.deviceId)["onvif:profileClaims"][0].evidence[0].sourceId = "changed-output-only";
    assert.ok(input.profileClaims.every((claim) => claim.evidence[0].sourceId !== "changed-output-only"));
    const missing = structuredClone(input); missing.services = missing.services.filter((entry) => entry.namespace.includes("/device/"));
    const partial = api.project(missing, catalog, policy);
    assert.ok(partial.diagnostics.some((entry) => entry.code === "resource-service-unobserved"));
    for (const td of partial.tds.filter((entry) => entry["onvif:resourceIdentity"])) assert.deepEqual(names(td), []);
    const broken = modelIndex([...staticModels, ...second.models]);
    const anyComposite = second.models.find((entry) => Object.keys(entry.actions).length > 0);
    assert.ok(anyComposite);
    broken.delete("https://example.org/wot/onvif/models/operations.tm.json");
    assert.throws(() => resolveModel(anyComposite.id, broken), { code: "InvalidRegistry" });
});
