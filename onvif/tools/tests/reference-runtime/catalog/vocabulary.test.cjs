const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { root } = require("../../../paths.cjs");
const { assertVocabularyInventory, generateVocabulary } = require("../../../../samples/reference-runtime/dist/catalog/vocabulary.js");
const { defineOperationRegistry } = require("../../../../samples/reference-runtime/dist/binding/registry.js");
const { validateNativeForm, validateEventForm } = require("../../../../samples/reference-runtime/dist/binding/forms.js");
const { buildVocabularyExamples, excerptMetadata, hosts } = require("../../../vocabulary-examples.cjs");
const { formatTDExcerpt, assertTDExcerpt, formatJSON } = require("../../../../../av/tools/publication/lib.mjs");
const read = name => JSON.parse(readFileSync(join(root, "onvif", ...name.split("/")), "utf8"));
const terms = read("terms.json"), catalog = read("catalog.json");
const revision = read("support/editorial/standards-decisions.json").vocabularyRevision;
const examples = buildVocabularyExamples(catalog, terms);

function visit(value, inspect) {
    inspect(value);
    if (value && typeof value === "object") Object.values(value).forEach(item => visit(item, inspect));
}

test("vocabulary: all 18 class renames are collision-free and absent from active RDF and models", () => {
    assert.equal(Object.keys(revision.renames).length, 18);
    assert.equal(new Set(Object.values(revision.renames)).size, 18);
    assertVocabularyInventory(terms, catalog);
    const ontology = generateVocabulary(catalog, terms).ontology;
    const guide = readFileSync(join(root, "onvif", "support", "notes", "onvif-binding-reference.md"), "utf8");
    const guideTerms = [...guide.matchAll(/^\| `onvif:([A-Za-z0-9]+)` \|/gm)].map(match => match[1]);
    assert.deepEqual(guideTerms.toSorted(), terms.terms.map(term => term.name).toSorted());
    const classes = new Set(terms.terms.filter(term => term.kind === "class").map(term => term.name));
    for (const [oldName, newName] of Object.entries(revision.renames)) {
        assert.equal(newName, oldName === "NativeThing" ? "NativeContract" : oldName.slice(0, -5));
        assert.ok(classes.has(newName), newName);
        assert.ok(!classes.has(oldName), oldName);
        assert.ok(ontology.includes(`onvif:${newName} a rdfs:Class`), newName);
        assert.ok(!ontology.includes(`onvif:${oldName} `), oldName);
        assert.equal(guide.includes(`onvif:${oldName}`), false, oldName);
    }
    const obsolete = new Set([...Object.keys(revision.renames), "Native"].flatMap(name => [`onvif:${name}`, terms.namespace + name]));
    for (const value of [terms, read("context.jsonld"), read("models.json"), examples]) {
        visit(value, item => { if (typeof item === "string") assert.equal(obsolete.has(item), false, item); });
    }
    assert.ok(read("models.json").models.some(model => model["@type"] === "tm:ThingModel"));
    assert.equal(catalog.registryDigest, "3410bc34844a3f718cde6964365b2f8e9e617f8f30e13b224e93a7768ab3defd");
    const before = JSON.parse(execFileSync("git", ["show", `${revision.baselineCommit}:onvif/model-manifest.json`],
        { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
    assert.deepEqual(read("model-manifest.json").artifacts.map(entry => [entry.path, entry.physicalPath]),
        before.artifacts.map(entry => [entry.path, entry.physicalPath]), "Model document identities and paths are not class names");
});

test("vocabulary: NativeContract preserves the native contract meaning without merging Device or Resource", () => {
    const current = terms.terms.find(term => term.name === "NativeContract");
    const before = JSON.parse(execFileSync("git", ["show", `${revision.baselineCommit}:onvif/terms.json`],
        { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 })).terms.find(term => term.name === "NativeThing");
    for (const key of ["description", "hosts", "producer", "consumer", "cardinality", "defaultBehavior", "validation", "securityPrivacy"]) {
        assert.deepEqual(current[key], before[key], key);
    }
    assert.equal(current.iri, terms.namespace + "NativeContract");
    assert.equal(examples.NativeContract["@type"], "onvif:NativeContract");
    const models = new Map(read("models.json").models.map(model => [model.id, model]));
    for (const path of ["NativeThing.tm.json", "operations.tm.json", "events/PullPointSubscription.tm.json"]) {
        const model = models.get(`https://example.org/wot/onvif/models/${path}`);
        assert.equal(model["@type"], "tm:ThingModel");
        assert.equal(model["onvif:modelClass"], "onvif:NativeContract", path);
    }
    for (const name of ["Device", "Resource", "MediaProfile", "Recording"]) {
        const path = ["Device", "Resource"].includes(name) ? `${name}Thing.tm.json` : `resources/${name}Thing.tm.json`;
        assert.equal(models.get(`https://example.org/wot/onvif/models/${path}`)["onvif:modelClass"], `onvif:${name}`, name);
    }
    const definition = generateVocabulary(catalog, terms).ontology.split("\n\n")
        .find(block => block.startsWith("onvif:NativeContract "));
    assert.doesNotMatch(definition, /subClassOf|equivalentClass/u);
});

test("vocabulary: obsolete, empty, colliding and missing source classes fail rather than alias", () => {
    for (const name of ["NativeThing", "Native", "Thing", ""]) {
        const invalid = structuredClone(terms);
        invalid.terms[0].name = name;
        invalid.terms[0].iri = terms.namespace + name;
        assert.throws(() => assertVocabularyInventory(invalid, catalog), { code: "InvalidRegistry" });
    }
    const collision = structuredClone(terms);
    collision.terms.push({ ...collision.terms[0], kind: "property", representation: "literal" });
    assert.throws(() => assertVocabularyInventory(collision, catalog), /duplicate term identity/);
    const missing = structuredClone(terms);
    missing.terms = missing.terms.filter(term => term.name !== "Device");
    assert.throws(() => assertVocabularyInventory(missing, catalog), /missing source\/model class Device/);
});

test("vocabulary: every example retains its annotation at the declared TD or TM host", () => {
    const registry = defineOperationRegistry(catalog.operations, catalog.xml);
    assert.deepEqual(Object.keys(examples), terms.terms.map(term => term.name));
    for (const term of terms.terms) {
        const document = examples[term.name], host = hosts[term.exampleHost];
        const placed = JSON.parse(formatJSON(JSON.stringify(document), host));
        for (const [key, value] of Object.entries(term.example)) assert.deepEqual(placed[key], value, `${term.name} ${host}/${key}`);
        assert.deepEqual(document["@context"], ["https://www.w3.org/2022/wot/td/v1.1", terms.context]);
        assert.equal(typeof document.title, "string");
        if (term.exampleHost === "tm") assert.equal(document["@type"], "tm:ThingModel");
        else assert.deepEqual(document.security, ["example"]);
        const metadata = excerptMetadata(term);
        const body = formatTDExcerpt(JSON.stringify(examples), `/${term.name}`, metadata.retain);
        assert.equal(assertTDExcerpt(body, JSON.stringify(examples), `/${term.name}`, metadata.retain), body);
        assert.match(body, /\/\/ \.\.\./, term.name);
        for (const action of Object.values(document.actions ?? {})) {
            for (const form of action.forms) assert.equal(validateNativeForm(form, registry).operation, "GetProfiles");
        }
        for (const event of Object.values(document.events ?? {})) {
            for (const form of event.forms) assert.equal(validateEventForm(form, registry).descriptor.mode, "pullpoint");
        }
    }
    assert.equal(examples.Device["@type"], "onvif:Device");
    assert.equal(examples.Semantic["@type"], "onvif:Semantic");
    assert.equal(examples.XMLQName.properties.value["@type"], "onvif:XMLQName");
    assert.equal(examples.operation.actions.getProfiles.forms[0]["onvif:operation"].operation, "GetProfiles");
    assert.equal(examples.operation.actions.getProfiles.forms[0]["onvif:operation"].bindingQName.localName, "Media2Binding");
    assert.equal(examples.subscription.events.notifications.forms[0]["onvif:subscription"].mode, "pullpoint");
    assert.equal(examples.UsernameTokenSecurityScheme.securityDefinitions.example.scheme, "onvif:UsernameTokenSecurityScheme");
    assert.equal(Object.hasOwn(examples.operation, "onvif:operation"), false);
    assert.equal(Object.hasOwn(examples.XMLQName, "@type"), false);
});

test("vocabulary: captured TD fixtures change only class membership and keep frozen wire oracles", () => {
    const oldClasses = new Map(Object.entries(revision.renames).flatMap(([from, to]) =>
        [[`onvif:${from}`, `onvif:${to}`], [terms.namespace + from, terms.namespace + to]]));
    function rename(value) {
        if (Array.isArray(value)) return value.map(rename);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
            [key, ["@type", "onvif:modelClass"].includes(key) ? oldClasses.get(item) ?? item : rename(item)]));
        return value;
    }
    for (const name of ["mf-memory-camera.td.json", "mf-memory-camera.tm.json", "native-repeat-0/camera.td.json", "native-repeat-1/camera.td.json"]) {
        const logical = "onvif/tools/fixtures/implementer/generated/" + name;
        const before = JSON.parse(execFileSync("git", ["show", `${revision.baselineCommit}:${logical}`], { cwd: root, encoding: "utf8" }));
        assert.deepEqual(read("tools/fixtures/implementer/generated/" + name), rename(before), name);
    }
    const before = execFileSync("git", ["show", `${revision.baselineCommit}:onvif/tools/fixtures/implementer/oracles.json`], { cwd: root });
    assert.deepEqual(readFileSync(join(root, "onvif", "tools", "fixtures", "implementer", "oracles.json")), before);
    const contextBefore = execFileSync("git", ["show", `${revision.baselineCommit}:onvif/context.jsonld`], { cwd: root });
    assert.deepEqual(readFileSync(join(root, "onvif", "context.jsonld")), contextBefore, "Standard WoT context and property mappings are unchanged");
});

test("vocabulary: wrong class, Form and DataSchema example positions are rejected", () => {
    for (const [name, host] of [["NativeContract", "data-schema"], ["operation", "data-schema"], ["xmlQName", "form"]]) {
        const invalid = structuredClone(terms);
        invalid.terms.find(term => term.name === name).exampleHost = host;
        assert.throws(() => buildVocabularyExamples(catalog, invalid), /wrong host|contradicts its domain/);
    }
    const stale = structuredClone(terms);
    stale.terms.find(term => term.name === "Semantic").example["@type"] = "onvif:NativeContract";
    assert.throws(() => assertVocabularyInventory(stale, catalog), /wrong host or IRI/);
});
