const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { root } = require("../../../paths.cjs");
const { publicMappingInterpretations, loadRequirementIndex, assertRequirementIndex } = require("../../../../samples/reference-runtime/dist/catalog/requirements.js");
const { digest } = require("../../../../samples/reference-runtime/dist/catalog/sources.js");

const baseline = "0685c5a2f55deca2b3e7fd8734a36d0a41a027dc";
const revision = "1a9216897254fb132ce55065287bcbdd933adf37";
const read = name => JSON.parse(readFileSync(join(root, ...name.split("/")), "utf8"));
const original = name => execFileSync("git", ["show", `${baseline}:${name}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(source, published = `example/repository@${revision}:spec/old.md:1-4`) {
    const id = "ONVIF-FIXTURE";
    const mapping = { id, oldSource: source, native: { namespace: "urn:native", localName: "GetMedia", example: "C:\\Media" } };
    const standards = { decisions: [{ id, oldSource: published }], publicProvenance: {
        schemaVersion: 1, repository: "example/repository", repositoryRevision: revision,
        reviewedOriginalSha256: { [id]: sha(source) }, sourceRecords: []
    } };
    return { mapping, standards, published };
}

test("provenance: exact reviewed repository and session paths normalize without altering native evidence", () => {
    for (const source of ["D:\\git\\project\\spec\\old.md:1-4", "C:\\Users\\author\\.copilot\\session-state\\draft\\plan.md:3-5"]) {
        const data = fixture(source, source.startsWith("C:") ? "record:ONVIF-FIXTURE-plan" : undefined);
        if (source.startsWith("C:")) data.standards.publicProvenance.sourceRecords.push({
            id: "ONVIF-FIXTURE-plan", label: "Private drafting plan", availability: "Not a public source authority."
        });
        const before = structuredClone(data);
        const result = publicMappingInterpretations([data.mapping], data.standards);
        assert.deepEqual(result, [{ ...data.mapping, oldSource: data.published }]);
        assert.deepEqual(data, before);
        assert.equal(result[0].native.example, "C:\\Media");
        assert.deepEqual(publicMappingInterpretations(result, data.standards), result);
    }
});

test("provenance: native Windows examples stay literal and unreviewed machine paths fail closed", () => {
    const literal = fixture("C:\\Media", "C:\\Media");
    assert.deepEqual(publicMappingInterpretations([literal.mapping], literal.standards), [literal.mapping]);
    const data = fixture("D:\\git\\project\\spec\\old.md:1-4");
    for (const source of ["C:\\Users\\another-author\\draft.md", "D:\\git\\other\\spec.md:1-4", "C:\\Media"]) {
        assert.throws(() => publicMappingInterpretations([{ ...data.mapping, oldSource: source }], data.standards), /differs from both/);
    }
    data.standards.decisions[0].oldSource = "C:\\Users\\author\\draft.md";
    assert.throws(() => publicMappingInterpretations([data.mapping], data.standards), /machine-specific authoring provenance/);
});

test("provenance: exact decision membership, declared records and historical revisions are required", () => {
    const mutate = callback => {
        const data = fixture("D:\\git\\project\\spec\\old.md:1-4");
        callback(data);
        assert.throws(() => publicMappingInterpretations([data.mapping], data.standards), { code: "InvalidRegistry" });
    };
    mutate(data => { data.standards.publicProvenance.repositoryRevision = "main"; });
    mutate(data => { data.standards.publicProvenance.reviewedOriginalSha256 = {}; });
    mutate(data => { data.standards.decisions.push(data.standards.decisions[0]); });
    mutate(data => { data.standards.decisions[0].id = "UNKNOWN"; });
    mutate(data => { data.standards.decisions[0].oldSource = "record:missing"; });
    mutate(data => { data.mapping.oldSource = { path: "spec/old.md" }; });
    const data = fixture("D:\\git\\project\\spec\\old.md:1-4");
    assert.throws(() => publicMappingInterpretations([data.mapping, data.mapping], data.standards), /duplicate/);
    assert.throws(() => publicMappingInterpretations([], data.standards), /exact mapping decision set/);
});

test("provenance: all 33 public sources use historical locators or honest qualified records", () => {
    const standards = read("onvif/support/editorial/standards-decisions.json");
    const editorials = read("onvif/support/editorial/editorial-decisions.json");
    const index = read("onvif/requirements-index.json");
    const expected = Object.fromEntries(standards.decisions.map(row => [row.id, row.oldSource]));
    assert.equal(Object.keys(expected).length, 33);
    assert.equal(expected["ONVIF-D001"],
        `marcschier/wot-av-extension@${revision}:spec/onvif-mapping.md:1-55; marcschier/wot-av-extension@${revision}:spec/onvif-binding-reference.md:1-9`);
    assert.equal(expected["ONVIF-D031"], "record:ONVIF-D031-source-1; record:ONVIF-D031-source-2");
    assert.ok(expected["ONVIF-D006"].endsWith("; record:ONVIF-D006-source-2"));
    assert.deepEqual(standards.publicProvenance.sourceRecords.find(row => row.id === "ONVIF-D006-source-2"),
        { id: "ONVIF-D006-source-2", label: "Unverified working-draft line range", repository: "marcschier/wot-av-extension",
            path: "packages/binding-onvif/src/binding/operation-policy.ts", recordedRange: "1-49",
            referenceRevision: revision, committedFileLines: 42,
            availability: "The path exists at the reference revision, but the recorded draft range exceeds that file. The original range is retained as a record, not a verified citation or a current-file locator." });
    for (const rows of [editorials.mappingInterpretations, index.editorialDecisions.filter(row => row.oldSource !== undefined)]) {
        assert.deepEqual(Object.fromEntries(rows.map(row => [row.id, row.oldSource])), expected);
    }
    for (const value of [standards, editorials, index]) assert.doesNotMatch(JSON.stringify(value), /[A-Za-z]:\\\\(?:Users|git)\\\\/);
    assert.equal(standards.repositoryRoot, ".");
    assert.equal(standards.draft, "record:ONVIF-DRAFT-2026-09-16");
    assertRequirementIndex(index);
});

test("provenance: native operation tuples, requirement semantics and all 70 terms remain unchanged", () => {
    const catalogPath = "onvif/catalog.json", termsPath = "onvif/terms.json";
    for (const name of [catalogPath, termsPath]) assert.deepEqual(readFileSync(join(root, ...name.split("/"))), original(name), name);
    const catalog = read(catalogPath), terms = read(termsPath);
    assert.equal(catalog.operations.length, 579);
    assert.equal(catalog.registryDigest, "3410bc34844a3f718cde6964365b2f8e9e617f8f30e13b224e93a7768ab3defd");
    assert.equal(terms.terms.length, 70);
    assert.ok(terms.terms.some(term => term.name === "NativeContract"));
    const previous = JSON.parse(original("onvif/requirements-index.json"));
    const current = loadRequirementIndex(root, catalog), committed = read("onvif/requirements-index.json");
    assert.equal(current.digest, committed.digest);
    const restored = structuredClone(current);
    const oldSources = new Map(previous.editorialDecisions.map(row => [row.id, row.oldSource]));
    for (const row of restored.editorialDecisions) if (row.oldSource !== undefined) row.oldSource = oldSources.get(row.id);
    delete restored.digest;
    const { digest: previousDigest, ...content } = previous;
    assert.equal(digest(restored), previousDigest, "Only oldSource bookkeeping and the consequent index digest may change");
    assert.equal(digest(content), previousDigest);
    assert.notEqual(current.digest, previousDigest);
});

test("provenance: the audit binds exact original and public fields without copying original values", () => {
    const audit = read("av/support/publication/provenance-normalization.json");
    assert.equal(audit.counts.fields, 68);
    assert.equal(audit.counts.repositoryLocatorsPerMappingSet, 65);
    assert.equal(audit.counts.verifiedRepositoryLocatorsPerMappingSet, 58);
    assert.equal(audit.counts.unverifiedDraftRangesPerMappingSet, 7);
    assert.equal(audit.counts.privateMappingLocatorsPerMappingSet, 2);
    const at = (value, pointer) => pointer.slice(1).split("/").reduce((node, key) => node[key], value);
    for (const entry of audit.files) {
        const before = original(entry.path), after = readFileSync(join(root, ...entry.path.split("/")));
        assert.equal(entry.originalSha256, sha(before));
        assert.equal(entry.sha256, sha(after));
        assert.equal(entry.bytes, after.length);
        for (const field of entry.fields) {
            assert.equal(field.originalSha256, sha(at(JSON.parse(before), field.pointer)));
            assert.equal(field.publicValue, at(JSON.parse(after), field.pointer));
            assert.equal(field.sha256, sha(field.publicValue));
            assert.equal(Object.hasOwn(field, "originalValue"), false);
        }
    }
    assert.doesNotMatch(JSON.stringify(audit), /[A-Za-z]:\\\\(?:Users|git)\\\\|metadataHiddenData|privateOriginalValues/);
});
