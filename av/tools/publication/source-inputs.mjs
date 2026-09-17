import { lstat, readdir, writeFile } from "node:fs/promises";
import { readJSON, sha256 } from "./lib.mjs";
import { canonicalPaths } from "./inputs.mjs";
import { fileAt, fileRecords, json, publicationOutputs } from "./metadata.mjs";

export const SOURCE_MANIFEST = "av/support/publication/source-input-manifest.json";
const downstreamInventories = new Set([
    SOURCE_MANIFEST, "av/support/publication/release-manifest.json",
    "onvif/support/publication/release-manifest.json", "av/support/publication/integration-result.json"
]);
const sourceRoots = [
    "av/tools", "av/examples", "av/samples/queries", "av/support/reference", "av/support/migration",
    "av/support/publication", "av/support/upstream/wot", "onvif/requirements", "onvif/tools",
    "onvif/support/editorial", "onvif/support/notes", "onvif/support/publication", "onvif/support/upstream",
    "packages", "native", "tools", "bindings", "spec", "vocabulary", "shapes"
];
const inTree = (name, tree) => name === tree || name.startsWith(tree + "/");
function strings(value, label) {
    if (!Array.isArray(value) || value.some(name => typeof name !== "string" || !name)) throw new Error(`Invalid ${label} source membership`);
    return value;
}

export async function sourceInputRecords(root, policy, configs) {
    const ownership = await readJSON(fileAt(root, "publication-ownership.json"));
    if (ownership.schemaVersion !== 1) throw new Error("Unsupported generation ownership version");
    const outputNames = new Set([...downstreamInventories, ...configs.flatMap(publicationOutputs),
        ...strings(ownership.avGeneratedFiles, "AV generated"),
        "onvif/spec.md", "onvif/support/notes/onvif-binding-reference.md"]);
    for (const config of configs) {
        if (!config.canonicalManifest) continue;
        outputNames.add(config.canonicalManifest);
        const manifest = await readJSON(fileAt(root, config.canonicalManifest));
        for (const name of canonicalPaths(manifest, config.id).values()) outputNames.add(name);
    }
    const shared = strings(ownership.sharedAuthoredFiles, "shared authored");
    for (const name of shared) {
        if (outputNames.has(name)) throw new Error(`Generated output cannot be a shared authored input: ${name}`);
    }
    const names = new Set(["package.json", "package-lock.json", "publication-ownership.json", "requirements-dev.txt",
        ...policy.specifications, ...shared, ...strings(ownership.onvifAuthoredFiles, "ONVIF authored"),
        ...configs.flatMap(config => [config.source, ...config.normativeFiles, ...config.mechanicsFiles])]);
    const roots = new Set([...sourceRoots, ...strings(ownership.onvifAuthoredRoots, "ONVIF authored root")]);
    const workspace = await readJSON(fileAt(root, "package.json"));
    for (const name of strings(workspace.workspaces, "workspace")) {
        fileAt(root, name);
        if (/[*?[\]{}]/.test(name)) throw new Error(`Generation seal requires an explicit workspace path: ${name}`);
        roots.add(name);
    }
    const excluded = new Set([".git", "local-only", "node_modules", ".venv", "__pycache__",
        ...strings(ownership.excludedBuildDirectoryNames, "excluded build directory")]);
    const prefixes = strings(ownership.excludedBuildDirectoryPrefixes ?? [], "excluded build prefix");
    const excludedOutput = name => outputNames.has(name) || inTree(name, "onvif/examples");
    const insensitive = new Map();
    async function walk(name, required = false) {
        let info;
        try { info = await lstat(fileAt(root, name)); }
        catch (error) {
            if (!required && error.code === "ENOENT") return;
            throw error;
        }
        if (info.isSymbolicLink()) throw new Error(`Linked generator input is forbidden: ${name}`);
        if (info.isDirectory()) {
            for (const entry of (await readdir(fileAt(root, name), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
                if (excluded.has(entry.name) || entry.isDirectory() && prefixes.some(prefix => entry.name.startsWith(prefix))) continue;
                const child = `${name}/${entry.name}`;
                if (!excludedOutput(child)) await walk(child, true);
            }
        } else {
            if (!info.isFile() || info.nlink !== 1) throw new Error(`Generator input is not a single regular file: ${name}`);
            if (info.size > policy.limits.artifactBytes) throw new Error(`Generator input exceeds byte limit: ${name}`);
            const folded = name.toLowerCase(), previous = insensitive.get(folded);
            if (previous && previous !== name) throw new Error(`Case-colliding generator input: ${name}`);
            insensitive.set(folded, name);
            names.add(name);
        }
    }
    for (const name of roots) await walk(name, ownership.onvifAuthoredRoots.includes(name));
    for (const name of names) {
        if (excludedOutput(name)) names.delete(name);
        else await walk(name, true);
    }
    if (!names.size || names.size > policy.limits.inputs) throw new Error("Generator input membership exceeds the publication budget");
    const inputs = await fileRecords(root, names);
    if (inputs.reduce((total, item) => total + item.bytes, 0) > policy.limits.totalBytes) throw new Error("Generator input bytes exceed the publication budget");
    return inputs;
}

export function assertRecords(actual, expected, label) {
    if (!Array.isArray(actual) || actual.length !== expected.length
        || actual.some((item, index) => item?.path !== expected[index].path)) {
        throw new Error(`${label} membership differs from the current source configuration`);
    }
    for (const [index, item] of actual.entries()) {
        if (json(item) !== json(expected[index])) throw new Error(`${label} digest or metadata mismatch: ${expected[index].path}`);
    }
}
export function sourceManifest(policy, inputs, outputs) {
    const content = {
        schemaVersion: 1,
        classification: "PrivateSourceOnly",
        inputRulesVersion: 1,
        sourceDate: policy.sourceDate,
        producer: { command: "npm run build:specs", specifications: ["av", "onvif"], node: policy.node.version },
        assurance: "Successful owning canonical generation and HTML rendering; checked snapshots are not an independent render or semantic recompilation.",
        hashAlgorithm: "SHA-256 of exact bytes; digest hashes this four-space LF JSON object without digest. The seal and downstream inventories are not inputs.",
        inputs,
        outputs
    };
    if ([...inputs, ...outputs].some(item => downstreamInventories.has(item.path))) throw new Error("The source seal cannot hash itself or downstream inventories");
    return { ...content, digest: sha256(json(content)) };
}
export function assertSourceManifest(actual, policy, inputs, outputs) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) throw new Error("Missing producer source seal");
    const { digest, ...content } = actual;
    if (!/^[a-f0-9]{64}$/.test(digest) || sha256(json(content)) !== digest) throw new Error("Producer source seal digest mismatch");
    assertRecords(actual.inputs, inputs, "Generator source input");
    assertRecords(actual.outputs, outputs, "Producer output");
    if (json(actual) !== json(sourceManifest(policy, inputs, outputs))) throw new Error("Producer source seal metadata is stale or unapproved");
}

export async function produceWithSourceSeal({ root, policy, configs }, produce, verify) {
    if (configs.map(config => config.id).sort().join(",") !== "av,onvif") throw new Error("Source sealing requires a complete AV and ONVIF producer run");
    const inputs = await sourceInputRecords(root, policy, configs);
    const result = await produce();
    assertRecords(await sourceInputRecords(root, policy, configs), inputs, "Generator source during canonical/HTML generation");
    const snapshot = await verify();
    await writeFile(fileAt(root, SOURCE_MANIFEST), json(sourceManifest(policy, inputs, snapshot.outputs)));
    return result;
}
