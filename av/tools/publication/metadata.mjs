import path from "node:path";
import { readFile } from "node:fs/promises";
import { REPO_ROOT, logicalPath, readJSON, sha256 } from "./lib.mjs";

export const json = value => JSON.stringify(value, null, 4) + "\n";
export function fileAt(root, name) {
    if (logicalPath("spec.md", name) !== name) throw new Error(`Noncanonical publication path: ${name}`);
    return path.join(root, ...name.split("/"));
}
export async function fileRecord(root, name) {
    const data = await readFile(fileAt(root, name));
    return { path: name, bytes: data.length, sha256: sha256(data) };
}
export async function fileRecords(root, names) {
    return Promise.all([...new Set(names)].sort().map(name => fileRecord(root, name)));
}
export async function configurations(policy, options = {}, root = REPO_ROOT) {
    const configs = [], ids = new Set();
    if (!Array.isArray(policy.specifications) || !policy.specifications.length) throw new Error("No publication specifications are declared");
    for (const name of policy.specifications) {
        if (!/^(av|onvif)\/support\/publication\/specification\.json$/.test(name)) throw new Error(`Unapproved specification configuration: ${name}`);
        const config = await readJSON(fileAt(root, name));
        if (config.id !== name.split("/")[0] || ids.has(config.id)) throw new Error(`Duplicate or mismatched specification: ${name}`);
        ids.add(config.id);
        if (!options.ids?.length || options.ids.includes(config.id)) configs.push(config);
    }
    if (!configs.length) throw new Error("No requested publication specification is declared");
    return configs;
}
export async function publicationInputs(policy, root = REPO_ROOT) {
    const ownership = await readJSON(fileAt(root, "publication-ownership.json"));
    if (ownership.sharedPublication?.inputField !== "sharedAuthoredFiles") throw new Error("Shared publication authored-file ownership is not declared");
    const names = ownership.sharedAuthoredFiles;
    if (!Array.isArray(names) || !names.length) throw new Error("Shared publication inputs are empty");
    return fileRecords(root, ["package.json", "package-lock.json", "publication-ownership.json", ...policy.specifications, ...names]);
}
export function publicationManifest(config, assembled, policy, inputs, artifacts) {
    return {
        schemaVersion: 1,
        status: "Independent technical draft; distribution not approved",
        sourceDate: config.sourceDate,
        generationCommand: `npm run build:specs -- --${config.id}`,
        checkCommand: `npm run check:specs -- --${config.id}`,
        hashAlgorithm: "SHA-256 of exact bytes; this manifest excludes its own hash",
        releaseApprovals: policy.publication.releaseApprovals,
        inputs,
        specification: { id: config.id, source: config.source, output: config.output, inputs: assembled.inputs, annexes: assembled.annexes },
        artifacts: artifacts.filter(item => item.path.startsWith(config.id + "/"))
    };
}
export function publicationOutputs(config) {
    return [config.output, `${config.id}/support/publication/render-report.json`, `${config.id}/support/publication/publication-manifest.json`];
}
export async function browserMetadata(root, policy, lock) {
    const pin = await readJSON(fileAt(root, "av/support/publication/browser-qualification.json"));
    const pkg = await readJSON(fileAt(root, "av/tools/publication/package.json"));
    if (pin.node !== policy.node.version || pin.node !== lock.node || pin.puppeteer !== pkg.dependencies.puppeteer) {
        throw new Error("Recorded browser qualification has stale Node or Puppeteer metadata");
    }
    for (const key of ["product", "revision", "protocolVersion"]) {
        if (typeof pin[key] !== "string" || !pin[key] || pin[key] !== policy.browser[key] || pin[key] !== lock.browser[key]) {
            throw new Error(`Recorded browser qualification disagrees with reviewed ${key}`);
        }
    }
    if (!/^[a-f0-9]{64}$/.test(pin.executableSha256) || pin.executableSha256 !== lock.browser.sha256) {
        throw new Error("Recorded browser qualification executable digest disagrees with the asset lock");
    }
    return pin;
}
