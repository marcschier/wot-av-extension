"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const { root, onvif: source, runtime } = require("./paths.cjs");
const dist = join(runtime, "dist");
const { physicalArtifactPath } = require(join(dist, "catalog", "artifacts.js"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const records = [];

function inspect(relative, expected) {
    const file = join(dist, ...relative.split("/"));
    assert(!lstatSync(file).isSymbolicLink(), `Staged output is a symbolic link: ${relative}`);
    const data = readFileSync(file);
    if (expected) {
        assert.equal(data.length, expected.bytes, `Staged asset size: ${relative}`);
        assert.equal(sha(data), expected.sha256, `Staged asset hash: ${relative}`);
    }
    records.push({ path: relative, bytes: data.length, sha256: sha(data) });
}

function copy(relative, original, expected) {
    assert(!lstatSync(original).isSymbolicLink(), `Package input is a symbolic link: ${original}`);
    assert(relative.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && ![".", ".."].includes(part)),
        `Unsafe package asset path: ${relative}`);
    const data = readFileSync(original);
    if (expected) {
        assert.equal(data.length, expected.bytes, `Source size: ${original}`);
        assert.equal(sha(data), expected.sha256, `Source hash: ${original}`);
    }
    const target = join(dist, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || !readFileSync(target).equals(data)) writeFileSync(target, data);
    records.push({ path: relative, bytes: data.length, sha256: sha(data) });
}

const generatedPath = physicalArtifactPath(root, "generated/manifest.json");
const generated = json(generatedPath);
assert.equal(generated.formatVersion, 1);
assert(Array.isArray(generated.artifacts) && generated.artifacts.length > 0);
const unique = new Set();
for (const entry of generated.artifacts) {
    assert(!unique.has(entry.path), `Duplicate generated asset: ${entry.path}`);
    unique.add(entry.path);
    assert(/^(generated|models|schemas|vocabulary|coverage)\//.test(entry.path));
    const physical = physicalArtifactPath(root, entry.path);
    assert.equal(entry.physicalPath, physical.slice(root.length + 1).replaceAll("\\", "/"));
    copy(`catalog-data/${entry.path}`, physical, entry);
}
copy("catalog-data/generated/manifest.json", generatedPath);

const lockPath = join(source, "sources.lock.json");
const lock = json(lockPath);
assert.equal(sha(readFileSync(lockPath)), generated.sourceLockDigest, "Canonical source lock must not change during packaging");
const vendored = lock.sources.filter((entry) => entry.storage === "vendored");
const sourceIds = new Set(vendored.map((entry) => entry.id));
for (const entry of vendored) {
    assert.equal(entry.redistribution.status, "permitted-unchanged", `Source lacks unchanged-copy permission: ${entry.id}`);
    for (const id of [...entry.redistribution.noticeIds, ...(entry.imports ?? []).map((item) => item.sourceId)]) {
        assert(sourceIds.has(id), `Vendored source/notice closure is incomplete: ${entry.id} -> ${id}`);
    }
    copy(`source-documents/${entry.relativePath}`, join(source, "support", "upstream", "onvif", ...entry.relativePath.split("/")), entry);
}
copy("source-documents/sources.lock.json", lockPath);
copy("source-documents/source-policy.json", physicalArtifactPath(root, "catalog/source-policy.json"));

const inputs = [];
const sourceRoot = join(runtime, "src");
function recordInputs(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        const file = join(directory, entry.name);
        assert(!entry.isSymbolicLink(), `Authored input is a symbolic link: ${file}`);
        if (entry.isDirectory()) recordInputs(file);
        else if (entry.name.endsWith(".ts")) {
            inputs.push({ path: file.slice(root.length + 1).replaceAll("\\", "/"), sha256: sha(readFileSync(file)) });
            const output = file.slice(sourceRoot.length + 1).replaceAll("\\", "/").slice(0, -3);
            inspect(output + ".js");
            inspect(output + ".d.ts");
        }
    }
}
recordInputs(sourceRoot);
const runtimeManifest = json(join(dist, "catalog-data", "manifest.json"));
for (const entry of runtimeManifest.artifacts) inspect(`catalog-data/${entry.path}`, entry);
inspect("catalog-data/manifest.json");
const allowed = new Set([...records.map((entry) => entry.path), "package-provenance.json"]);
assert.equal(allowed.size, records.length + 1, "Package staging paths must be unique");
function audit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        assert(!entry.isSymbolicLink(), `Package staging contains a symbolic link: ${file}`);
        if (entry.isDirectory()) audit(file);
        else assert(allowed.has(file.slice(dist.length + 1).replaceAll("\\", "/")),
            `Unowned output in package staging; remove it explicitly before packing: ${file}`);
    }
}
audit(dist);
for (const name of ["package.json", "package-lock.json", "onvif/samples/reference-runtime/package.json",
    "onvif/samples/reference-runtime/tsconfig.json", "onvif/samples/reference-runtime/NOTICE.md",
    "onvif/tools/stage-onvif-package.cjs", "onvif/tools/paths.cjs"]) {
    inputs.push({ path: name, sha256: sha(readFileSync(join(root, ...name.split("/")))) });
}
const provenance = {
    formatVersion: 1,
    private: true,
    distributionApproved: false,
    firstPartyLicenseSelected: false,
    transformation: "Project-authored TypeScript compiled with the workspace lock; existing canonical artifact bytes copied and verified, not regenerated by the packaging step.",
    generatedManifest: { path: "catalog-data/generated/manifest.json", sha256: sha(readFileSync(generatedPath)) },
    registryDigest: generated.registryDigest,
    sourceLockDigest: generated.sourceLockDigest,
    canonicalArtifacts: generated.artifacts.length + 1,
    modelDocuments: generated.artifacts.filter((entry) => entry.path.startsWith("models/")).length,
    sourceDocuments: vendored.length,
    excludedSourceIds: lock.sources.filter((entry) => entry.storage !== "vendored").map((entry) => entry.id),
    sourceNoticePolicy: "NOTICE.md and source-documents/source-policy.json; unchanged source-copy permission is not generated-derivative or release clearance.",
    nativeBinaryIncluded: false,
    inputs: inputs.sort((a, b) => a.path.localeCompare(b.path, "en")),
    files: records.sort((a, b) => a.path.localeCompare(b.path, "en"))
};
writeFileSync(join(dist, "package-provenance.json"), JSON.stringify(provenance, null, 4) + "\n");
console.log(`Staged ${provenance.canonicalArtifacts} canonical artifacts (${provenance.modelDocuments} model documents) and ${vendored.length} unchanged source/notice files; distributionApproved=false.`);
