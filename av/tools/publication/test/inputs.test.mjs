import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { canonicalPaths, normativeMembers, freezeSpecification } from "../inputs.mjs";
import { SUPPORT_ROOT, readJSON } from "../lib.mjs";
import { argumentsFor, buildSpecifications } from "../build-specs.mjs";

const policy = await readJSON(path.join(SUPPORT_ROOT, "publication-policy.json"));
const bibliography = await readJSON(path.join(SUPPORT_ROOT, "bibliography.json"));
async function repository(action) {
    const root = await mkdtemp(path.join(os.tmpdir(), "wot-av-publication-inputs-"));
    const write = async (name, value) => {
        const target = path.join(root, ...name.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, value);
    };
    const config = {
        schemaVersion: 1, id: "av", source: "av/spec.md", output: "av/index.html",
        bibliography: "av/support/publication/bibliography.json", sourceDate: policy.sourceDate,
        normativeFiles: ["av/terms.json"], mechanicsFiles: [], markdownIncludes: [],
        exampleRoots: ["av/examples"], requiredGeneratedSources: ["av/terms.json"]
    };
    const spec = "# Fixture\n<!-- BEGIN GENERATED: terms.json#/Example -->\nComplete readable definition.\n<!-- END GENERATED: terms.json#/Example -->";
    await write(config.source, spec);
    await write("av/terms.json", '{"Example":{}}');
    await write(config.bibliography, JSON.stringify(bibliography));
    try { await action({ root, write, config, spec }); }
    finally { await rm(root, { recursive: true, force: false }); }
}
test("canonical artifact count and mapping are derived, not the old 305 constant", () => {
    const artifacts = Array.from({ length: 517 }, (_, n) => ({ path: `models/native/Model-${n}.tm.json`, physicalPath: `onvif/models/native/Model-${n}.tm.json` }));
    const artifactPathMap = Object.fromEntries(artifacts.map(item => [item.path, item.physicalPath]));
    assert.equal(canonicalPaths({ artifacts, artifactPathMap }, "onvif").size, 517);
    artifactPathMap[artifacts[0].path] = "av/terms.json";
    assert.throws(() => canonicalPaths({ artifacts, artifactPathMap }, "onvif"), /disagrees/);
});
test("normative manifests admit only explicit roles and never whole implementation trees", () => {
    const value = normativeMembers({ artifacts: [{ path: "onvif/models.json", role: "normative" }, { path: "onvif/model-manifest.json", role: "mechanics" }, { path: "onvif/support/report.json", role: "informative" }] });
    assert.equal(value.normative.length, 1);
    assert.equal(value.mechanics.length, 1);
    assert.throws(() => normativeMembers({ artifacts: [{ path: "onvif/models", role: "guess" }] }), /Unknown/);
    assert.equal(normativeMembers({ artifacts: [{ physicalPath: "onvif/models/native/Model.tm.json", role: "thing-model" }, { physicalPath: "onvif/support/reports/coverage.json", role: "informative-evidence" }] }).normative.length, 1);
});
test("actual input snapshots detect edits during rendering", async () => repository(async ({ root, write, config }) => {
    const input = await freezeSpecification(root, config, policy, { "av/spec.md": "av/index.html" });
    await input.assertUnchanged();
    await write("av/terms.json", '{"Example":{"changed":true}}');
    await assert.rejects(input.assertUnchanged(), /changed during publication/);
}));
test("missing root and annexes are explicit readiness errors", async () => repository(async ({ root, config }) => {
    config.normativeManifest = "av/normative-manifest.json";
    config.normativeFiles.push("av/missing.schema.json");
    await assert.rejects(freezeSpecification(root, config, policy, {}), error => /normative-manifest\.json/.test(error.message) && /missing\.schema\.json/.test(error.message));
}));
test("undeclared includes and runtime/test sources cannot enter the specification", async () => repository(async ({ root, write, config, spec }) => {
    await write("av/spec.md", spec + "\n<!-- include: support/unapproved.md -->");
    await write("av/support/unapproved.md", "## Unapproved");
    await assert.rejects(freezeSpecification(root, config, policy, {}), /Undeclared normative Markdown/);
    config.markdownIncludes = ["av/tools/test.md"];
    await assert.rejects(freezeSpecification(root, config, policy, {}), /cannot be a normative input/);
}));
test("new example declarations resolve only physical examples and retain exact decimals", async () => repository(async ({ root, write, config, spec }) => {
    await write("av/spec.md", spec + "\n<!-- example: examples/actual.json#/data -->");
    await write("av/examples/actual.json", '{"data":[900719925474099312345,1.2300e+02]}');
    const result = await freezeSpecification(root, config, policy, {});
    assert.match(result.assembled.codes[0].raw, /900719925474099312345/);
    assert.match(result.assembled.codes[0].raw, /1\.2300e\+02/);
    await write("av/spec.md", spec + "\n<!-- example: ../onvif/examples/actual.json -->");
    await assert.rejects(freezeSpecification(root, config, policy, {}), /outside declared example roots/);
}));
test("release and browser qualification cannot be silently enabled in check or API mode", async () => {
    assert.throws(() => argumentsFor(["--check", "--qualify-browser"]), /requires --fixture/);
    assert.throws(() => argumentsFor(["--release"]), /Publication blocked/);
    assert.throws(() => argumentsFor(["--unknown"]), /Unknown argument/);
    assert.throws(() => argumentsFor(["--tool-package"]), /Missing value/);
    await assert.rejects(buildSpecifications({ release: true }), /Publication blocked/);
});
test("reviewed source aliases resolve exact example data without changing normative ownership", async () => repository(async ({ root, write, config, spec }) => {
    const example = "av/tools/fixtures/example.json";
    config.exampleFiles = [example];
    config.sourceAliases = { "av/spec.md": { [example]: example } };
    await write(example, '{"data":1.2300}');
    await write("av/spec.md", spec + `\n<!-- example: ${example}#/data -->`);
    const result = await freezeSpecification(root, config, policy, {});
    assert.equal(result.assembled.codes[0].raw, "1.2300");
    await write("av/spec.md", spec + `\n<!-- BEGIN GENERATED: ${example}#/data -->\nNot allowed.\n<!-- END GENERATED: ${example}#/data -->`);
    await assert.rejects(freezeSpecification(root, config, policy, {}), /cannot own a normative generated/);
}));
test("linked normative JSON Pointers are checked before browser rendering", async () => repository(async ({ root, write, config, spec }) => {
    await write("av/spec.md", spec + "\n[Definition](terms.json#/Example)");
    await freezeSpecification(root, config, policy, {});
    await write("av/spec.md", spec + "\n[Definition](terms.json#/Absent)");
    await assert.rejects(freezeSpecification(root, config, policy, {}), /Missing JSON Pointer/);
}));
