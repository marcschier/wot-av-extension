const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { root } = require("../../../paths.cjs");
const { compileCatalog } = require("../../../../samples/reference-runtime/dist/catalog/compiler.js");
const { loadRequirementIndex, assertRequirementIndex } = require("../../../../samples/reference-runtime/dist/catalog/requirements.js");
const {
    generateModels, abstractModelId, ABSTRACT_OPERATION_MODEL, ABSTRACT_MODEL, OPERATION_MODEL, profileModelId
} = require("../../../../samples/reference-runtime/dist/catalog/models.js");
const { modelIndex, assertModelImports, resolveModel } = require("../../../../samples/reference-runtime/dist/catalog/model-resolver.js");
const { physicalArtifactPath } = require("../../../../samples/reference-runtime/dist/catalog/artifacts.js");
const { operationKey } = require("../../../../samples/reference-runtime/dist/binding/registry.js");
const { parseXml } = require("../../../../samples/reference-runtime/dist/xml/parser.js");
const { decodeElement } = require("../../../../samples/reference-runtime/dist/xml/mapper.js");
const { condition, evaluateCondition } = require("../../../../samples/reference-runtime/dist/catalog/conditions.js");
const {
    createSemanticAdapterModel, deriveAdapterTd, semanticAdapterOperationId, assertSemanticAdapterValue
} = require("../../../../samples/reference-runtime/dist/catalog/semantic-adapter.js");

const catalog = compileCatalog({ root });
const requirements = loadRequirementIndex(root, catalog);
const models = generateModels(catalog, requirements), index = modelIndex(models.values());
const ns = "http://www.onvif.org/ver20/media/wsdl";
const reference = (operation) => ({
    bindingQName: { namespace: ns, localName: "Media2Binding" },
    portTypeQName: { namespace: ns, localName: "Media2" }, operation
});
const profiles = reference("GetProfiles"), snapshot = reference("GetSnapshotUri");
const evidence = [{ sourceId: "urn:example:operator-facts", detail: "Fictional schema/API evidence, not a discovered camera." }];
const selected = [profiles, snapshot];
const options = {
    id: "urn:example:semantic-adapter", title: "Fictional semantic camera",
    operations: selected, evidence,
    bindingForms: selected.map((operation) => ({ operation, forms: [{
        href: `https://adapter.example.invalid/actions/${operation.operation}`, op: "invokeaction",
        contentType: "application/json", "htv:methodName": "POST"
    }] })),
    securityDefinitions: { adapterDigest: { scheme: "digest" } }, security: ["adapterDigest"]
};

function walk(value, visitor) {
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, visitor)); return; }
    if (value === null || typeof value !== "object") return;
    visitor(value);
    Object.values(value).forEach((entry) => walk(entry, visitor));
}
const known = (value) => ({ state: "known", value, evidence });

test("layers: every qualified operation has a form-free semantic contract and an unchanged native overlay", () => {
    assertModelImports(index);
    const semantic = index.get(ABSTRACT_OPERATION_MODEL), native = index.get(OPERATION_MODEL);
    assert.deepEqual(Object.keys(semantic.actions).sort(), catalog.operations.map((operation) => operation.id).sort());
    for (const operation of catalog.operations) {
        const canonical = semantic.actions[operation.id], overlay = native.actions[operation.id];
        assert.deepEqual(canonical.input, overlay.input);
        assert.deepEqual(canonical.output, overlay.output);
        assert.equal(canonical.safe, false);
        assert.equal(canonical.idempotent, false);
        assert.equal(canonical["onvif:source"].operationKey, operationKey(operation));
        assert.equal(canonical["onvif:source"].inputOwner, "caller");
        assert.equal(canonical["onvif:source"].outputOwner, operation.output === null ? null : "service");
        assert.equal(overlay.forms[0]["onvif:soapAction"], operation.soapAction);
        assert.deepEqual(overlay.forms[0]["onvif:operation"], {
            bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName, operation: operation.operation
        });
        assert.equal(overlay.forms[0].href, "{{xaddr}}");
    }
    const semanticModels = [...index.values()].filter((entry) => entry.id.includes("/models/abstract/"));
    for (const entry of semanticModels) walk(entry, (object) => {
        for (const key of ["forms", "security", "securityDefinitions", "onvif:binding", "onvif:soapAction", "onvif:subscription"]) {
            assert.equal(Object.hasOwn(object, key), false, `${entry.id} must not contain ${key}`);
        }
    });
    assert.ok(semanticModels.some((entry) => entry.id.endsWith("/features/CameraInventorySnapshot.tm.json")));
});

test("layers: all seven native profile IDs extend complete abstract counterparts and keep separate client obligations", () => {
    for (const edition of requirements.profileEditions.filter((entry) => entry.publicationState === "released")) {
        const id = profileModelId(edition.profileId, edition.edition), native = index.get(id);
        const semantic = index.get(abstractModelId(id));
        const atoms = requirements.requirements.filter((row) => row.profile === edition.profileId && row.edition === edition.edition && row.role === "device");
        assert.deepEqual(native.links, [{ rel: "tm:extends", href: semantic.id, type: "application/tm+json" }]);
        assert.deepEqual(semantic["onvif:requirements"], atoms.map((row) => row.id));
        assert.deepEqual(native["onvif:requirements"], semantic["onvif:requirements"]);
        assert.equal(index.get(native["onvif:clientRequirements"]).createsClientThing, false);
        assert.ok(atoms.some((row) => ["behavior", "process"].includes(row.classification)));
        const physical = physicalArtifactPath(root, `models/profiles/Profile-${edition.profileId}-${edition.edition}.tm.json`);
        assert.ok(physical.includes("\\onvif\\models\\native\\profiles\\"));
        assert.equal(JSON.parse(readFileSync(physical, "utf8")).id, id);
    }
    const translation = JSON.parse(readFileSync(join(root, "onvif", "model-translation.json"), "utf8"));
    assert.equal(translation.namespaceChanged, false);
    for (const entry of translation.entries) {
        assert.ok(index.has(entry.nativeId));
        assert.ok(index.has(entry.abstractId));
        assert.equal(index.get(entry.nativeId).links[0].href, entry.abstractId);
    }
    assert.throws(() => physicalArtifactPath(root, "models/abstract/../outside.json"), /Unsafe/);
    assert.throws(() => physicalArtifactPath(root, "models/abstract/0.2-proposed/..\\outside.json"), /Unsafe/);
});

test("layers: source tuple imports preserve imported WSN portTypes and reject cycles or absent fragments", () => {
    const imported = catalog.services.filter((service) => service.bindingQName.namespace !== service.portTypeQName.namespace);
    assert.ok(imported.length > 0);
    for (const service of imported) {
        const id = `https://example.org/wot/onvif/models/services/${service.id}.tm.json`;
        const resolved = resolveModel(id, index);
        for (const id of service.operationIds) {
            assert.deepEqual(resolved.actions[id].forms[0]["onvif:operation"].portTypeQName, service.portTypeQName);
        }
    }
    const broken = new Map(index);
    broken.set("urn:cycle:a", { "@type": "tm:ThingModel", id: "urn:cycle:a", links: [{ rel: "tm:extends", href: "urn:cycle:b" }] });
    broken.set("urn:cycle:b", { "@type": "tm:ThingModel", id: "urn:cycle:b", links: [{ rel: "tm:extends", href: "urn:cycle:a" }] });
    assert.throws(() => assertModelImports(broken), /Cyclic/);
    broken.set("urn:cycle:b", { id: "urn:cycle:b", actions: { bad: { "tm:ref": `${OPERATION_MODEL}#/actions/does-not-exist` } } });
    assert.throws(() => assertModelImports(broken), /Unresolved model pointer/);
});

test("adapter: pure model and TD factories keep canonical schemas, genuine bindings and one immediate semantic type", () => {
    const before = structuredClone(options);
    const output = deriveAdapterTd(catalog, options);
    assert.deepEqual(options, before);
    assert.equal(output.model.links[0].href, ABSTRACT_MODEL);
    const models = modelIndex([...index.values(), output.model]);
    assertModelImports(models);
    const resolved = resolveModel(output.model.id, models);
    assert.equal(output.td.links.filter((link) => link.rel === "type").length, 1);
    assert.equal(output.td.links[0].href, output.model.id);
    assert.equal(output.td["@type"], "onvif:SemanticThing");
    assert.equal(output.td["onvif:projection"].category, "wotSemanticProfile");
    assert.equal(output.td["onvif:projection"].status, "declared-fragment");
    assert.equal(output.td["onvif:projection"].fullProfile, false);
    assert.equal(output.td["onvif:projection"].nativeProtocol, false);
    for (const operation of selected) {
        const id = semanticAdapterOperationId(catalog, operation), action = output.td.actions[id];
        assert.deepEqual(action.input, resolved.actions[id].input);
        assert.deepEqual(action.output, resolved.actions[id].output);
        assert.equal(action.forms[0].contentType, "application/json");
        assert.deepEqual(action.forms[0].security, ["adapterDigest"]);
        for (const name of ["onvif:binding", "onvif:soapAction", "onvif:operation"]) assert.equal(Object.hasOwn(action.forms[0], name), false);
    }
    const reordered = deriveAdapterTd(catalog, { ...options, operations: [...selected].reverse(), bindingForms: [...options.bindingForms].reverse() });
    assert.equal(reordered.model.id, output.model.id);
    assert.equal(reordered.td["onvif:projectionDigest"], output.td["onvif:projectionDigest"]);
});

test("adapter: aliases, unsupported operations, full claims, private fields and false authentication are rejected", () => {
    assert.throws(() => createSemanticAdapterModel(catalog, { title: "wrong", operations: ["GetProfiles"], evidence }), /qualified operation|identity/);
    assert.throws(() => createSemanticAdapterModel(catalog, { title: "wrong", operations: [{ operationQName: "GetProfiles" }], evidence }), /qualified operation/);
    assert.throws(() => createSemanticAdapterModel(catalog, { title: "wrong", operations: [reference("CreateProfile")], evidence }), { code: "UnsupportedCapability" });
    assert.throws(() => deriveAdapterTd(catalog, { ...options, claim: "full" }), /only a fragment/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options, fullProfile: true }), /invalid TD options/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options, evidence: [] }), /provenance/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options, evidence: [{ sourceId: "C:\\private\\camera" }] }), /private filesystem/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options, bindingForms: [options.bindingForms[0], options.bindingForms[0]] }), /duplicate or unselected/);
    const privateForm = structuredClone(options);
    privateForm.bindingForms[0].forms[0]["onvif:xmlRegistry"] = {};
    assert.throws(() => deriveAdapterTd(catalog, privateForm), /invalid adapter Form/);
    const nativeForm = structuredClone(options);
    nativeForm.bindingForms[0].forms[0]["onvif:binding"] = "soap12-http-v1";
    assert.throws(() => deriveAdapterTd(catalog, nativeForm), /invalid adapter Form/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options,
        securityDefinitions: { adapterDigest: { scheme: "digest", password: "fixture-secret-must-stay-private" } } }), /credential/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options,
        securityDefinitions: { adapterDigest: { scheme: "digest", nested: { Password: "fixture-secret-must-stay-private" } } } }), /credential/);
    assert.throws(() => deriveAdapterTd(catalog, { ...options, securityDefinitions: {
        adapterDigest: { scheme: "digest" }, anonymous: { scheme: "nosec" }
    }, security: ["adapterDigest", "anonymous"] }), /nosec mixed/);
});

test("adapter: independently authored native XML agrees with exact canonical JSON request/result shapes", () => {
    const profiled = catalog.operations.find((entry) => operationKey(entry) === operationKey(profiles));
    const uri = catalog.operations.find((entry) => operationKey(entry) === operationKey(snapshot));
    const profileValue = decodeElement(profiled.response, parseXml(
        `<m:GetProfilesResponse xmlns:m="${ns}"><m:Profiles token="adapter-main" fixed="true"><m:Name>Operator supplied bundle</m:Name></m:Profiles></m:GetProfilesResponse>`
    ), catalog.xml);
    assert.equal(profileValue.Profiles[0].$attributes.token, "adapter-main");
    assert.equal(Object.hasOwn(profileValue.Profiles[0], "Configurations"), false, "omitted Type does not fabricate configuration observations");
    assertSemanticAdapterValue(catalog, profiles, "input", {});
    assertSemanticAdapterValue(catalog, profiles, "input", { Token: "adapter-main", Type: ["All"] });
    assertSemanticAdapterValue(catalog, profiles, "output", profileValue);
    assertSemanticAdapterValue(catalog, snapshot, "input", { ProfileToken: "adapter-main" });
    const uriValue = decodeElement(uri.response, parseXml(
        `<m:GetSnapshotUriResponse xmlns:m="${ns}"><m:Uri>https://adapter.example.invalid/snapshot/main.jpg</m:Uri></m:GetSnapshotUriResponse>`
    ), catalog.xml);
    assert.deepEqual(uriValue, { Uri: "https://adapter.example.invalid/snapshot/main.jpg" });
    assertSemanticAdapterValue(catalog, snapshot, "output", uriValue);
    assert.throws(() => assertSemanticAdapterValue(catalog, profiles, "input", { Type: "All" }), { code: "InvalidValue" });
    assert.throws(() => assertSemanticAdapterValue(catalog, snapshot, "input", {}), { code: "InvalidValue" });
    assert.throws(() => assertSemanticAdapterValue(catalog, snapshot, "output", { MediaUri: uriValue }), { code: "InvalidValue" });
    assert.throws(() => assertSemanticAdapterValue(catalog, snapshot, "output", { ...uriValue, __runtimeHandle: "private" }), { code: "InvalidValue" });
});

test("interpretations: raw atoms, group count and exact NP-G3 source/topic/type coordinates are preserved", () => {
    assertRequirementIndex(requirements);
    assert.equal(requirements.requirements.length, 2636);
    assert.equal(requirements.obligationGroups.length, 28);
    const topics = JSON.parse(readFileSync(join(root, "onvif", "topic-contracts.json"), "utf8")).contracts;
    const contract = topics.find((entry) => entry.decisionId === "ONVIF-D027");
    assert.equal(contract.topic.namespace, "http://www.onvif.org/ver10/topics");
    assert.deepEqual(contract.topic.path, ["RecordingConfig", "RecordingJobConfiguration"]);
    assert.equal(contract.topic.isProperty, false);
    assert.equal(contract.topic.source[0].name, "RecordingJobToken");
    assert.equal(contract.topic.data[0].name, "Configuration");
    assert.equal(contract.topic.data[0].globalElementVerified, false);
    assert.ok(contract.sourceReferences.some((source) => source.path === "doc/RecordingControl.xml" && source.clause === "5.29.2"));
    assert.ok(contract.sourceReferences.some((source) => source.path === "doc/Core.xml" && source.clause === "9.4.3"));
    assert.deepEqual(contract.sourceReferences.find((source) => source.path === "doc/Core.xml").lines, [7631, 7643]);
    const decisions = JSON.parse(readFileSync(join(root, "onvif", "support", "editorial", "editorial-decisions.json"), "utf8"));
    assert.equal(decisions.mappingInterpretations.length, 33);
    assert.equal(decisions.decisions.find((entry) => entry.id === "profile-g-settrackconfiguration-condition").decision, null);
    const selectedReview = requirements.editorialDecisions.find((entry) => entry.id === "profile-g-settrackconfiguration-condition");
    assert.equal(selectedReview.sourceReviewStatus, "unresolved-normative-interpretation");
    assert.equal(selectedReview.selectedMappingEdition, "0.2-proposed");
    const type = "{http://www.onvif.org/ver10/schema}RecordingJobConfiguration";
    assert.ok(catalog.xml.types[type]);
    assert.equal(Object.hasOwn(catalog.xml.elements, type), false);
    for (const id of contract.affectedRequirementIds) {
        const row = requirements.requirements.find((entry) => entry.id === id);
        assert.deepEqual(row.raw.native, []);
        assert.equal(row.mapping.kind, "event");
        assert.ok(row.native.some((entry) => entry.topic === "{http://www.onvif.org/ver10/topics}RecordingConfig/RecordingJobConfiguration"));
        assert.equal(row.interpretation.approval, "pending-named-review");
        assert.ok(requirements.diagnostics.some((entry) => entry.requirementId === id && entry.code === "native-topic-element-root-needs-description"));
    }
});

test("interpretations: native/proprietary feature existence, inactive features and client role evidence remain distinct", () => {
    const row = requirements.requirements.find((entry) => entry.id === "G-9.1.4.1-device-media1-get-metadata-configuration");
    assert.equal(row.raw.requirementLevel, "optional");
    assert.equal(row.localLevel, "optional");
    assert.equal(row.effectiveLevel, "mandatory");
    const facts = {
        "device.feature.onboardMediaSources": known(true),
        "device.feature.onboardMetadata.native": known(false),
        "device.feature.onboardMetadata.proprietary": known(true)
    };
    assert.equal(evaluateCondition(row.condition, facts).value, "true");
    facts["device.feature.onboardMetadata.proprietary"] = known(false);
    assert.equal(evaluateCondition(row.condition, facts).value, "false");
    facts["device.feature.onboardMetadata.proprietary"] = { state: "denied", evidence: [] };
    assert.equal(evaluateCondition(row.condition, facts).value, "unknown");
    const client = requirements.requirements.find((entry) => entry.id === "A-1.0-client-6.5.4-Schedule-GetScheduleState");
    assert.equal(evaluateCondition(client.condition, { "device.schedules.StateReportingSupported": known(true) }).value, "unknown");
    assert.equal(evaluateCondition(client.condition, { "client.schedules.StateReportingSupported": known(true) }).value, "true");
    assert.equal(evaluateCondition(condition({ fact: "typed", equals: true }), { typed: known(1) }).value, "unknown");
    assert.ok(Object.keys(requirements.conditionFacts).some((id) => id.startsWith("device.feature.")), "G/M fact definitions are not lost merely because there is no top-level conditionFacts member");
});

test("standards: independent schemas, JSON-LD/SHACL, term inventory and source reference checks use public artifacts only", () => {
    const result = spawnSync("python", ["-B", join(__dirname, "validate-standard.py"), root], {
        cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.originalTerms, 68);
    assert.equal(summary.terms, 70);
    assert.equal(summary.nativeProfiles, 7);
    assert.equal(summary.abstractProfiles, 7);
    assert.equal(summary.externalRetrieval, false);
});
