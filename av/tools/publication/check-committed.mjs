import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, readJSON } from "./lib.mjs";
import { verifiedAssets } from "./assets.mjs";
import { canonicalPaths, normativeMembers, freezeSpecification } from "./inputs.mjs";
import { browserMetadata, configurations, fileAt, fileRecord, fileRecords, json, publicationInputs, publicationManifest, publicationOutputs } from "./metadata.mjs";
import { SOURCE_MANIFEST, assertSourceManifest, sourceInputRecords } from "./source-inputs.mjs";

function same(actual, expected, label) {
    if (json(actual) !== json(expected)) throw new Error(`${label} differs from the current publication inputs`);
}
function empty(value, label) {
    if (!Array.isArray(value) || value.length) throw new Error(`Committed render has missing or unsuccessful ${label}`);
}
async function canonicalRecords(root, config) {
    if (!config.canonicalManifest) return [];
    const manifest = await readJSON(fileAt(root, config.canonicalManifest));
    canonicalPaths(manifest, config.id);
    normativeMembers(manifest, { requireRoles: true });
    const physical = new Set(), result = [await fileRecord(root, config.canonicalManifest)];
    for (const item of manifest.artifacts) {
        if (physical.has(item.physicalPath.toLowerCase())) throw new Error(`Duplicate physical canonical artifact: ${item.physicalPath}`);
        physical.add(item.physicalPath.toLowerCase());
        const record = await fileRecord(root, item.physicalPath);
        if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)
            || record.bytes !== item.bytes || record.sha256 !== item.sha256) throw new Error(`Canonical artifact digest or metadata mismatch: ${item.physicalPath}`);
        result.push(record);
    }
    return result;
}

export async function verifyPublicationSnapshot({ root = REPO_ROOT } = {}) {
    const { policy, lock } = await verifiedAssets({ root });
    if (process.env.SOURCE_DATE_EPOCH && process.env.SOURCE_DATE_EPOCH !== String(policy.sourceDateEpoch)) {
        throw new Error("SOURCE_DATE_EPOCH differs from the reviewed publication date");
    }
    const configs = await configurations(policy, {}, root);
    if (configs.map(config => config.id).sort().join(",") !== "av,onvif") throw new Error("The committed snapshot must cover both AV and ONVIF");
    const shared = await publicationInputs(policy, root), browser = await browserMetadata(root, policy, lock);
    const outputMap = Object.fromEntries(configs.map(config => [config.source, config.output]));
    const outputs = new Map(), specifications = [], frozen = [];
    for (const config of configs) {
        const input = await freezeSpecification(root, config, policy, outputMap);
        frozen.push(input);
        const { assembled } = input;
        empty(assembled.diagnostics, `${config.id} assembly diagnostics`);
        const [htmlPath, reportPath, manifestPath] = publicationOutputs(config);
        const report = await readJSON(fileAt(root, reportPath));
        for (const [value, label] of [[report.status?.errors, "errors"], [report.status?.warnings, "warnings"],
            [report.readable?.errors, "readability errors"], [report.blocked, "blocked requests"], [report.diagnostics, "diagnostics"]]) empty(value, `${config.id} ${label}`);
        for (const field of ["source", "inputs", "regions", "annexes", "localLinks", "referenceRewrites"]) {
            same(report[field], assembled[field], `${config.id} render report ${field}`);
        }
        same(report.browser, browser, `${config.id} recorded browser qualification`);
        if (!Array.isArray(report.requests) || !report.requests.includes("/document")
            || report.requests.some(request => typeof request !== "string" || request !== "/document"
                && !lock.assets.some(asset => request === "/" + asset.path || asset.urls.includes(request)))) {
            throw new Error(`${config.id} render request evidence is missing or unapproved`);
        }
        const artifacts = await Promise.all([htmlPath, reportPath].map(name => fileRecord(root, name)));
        const expected = publicationManifest(config, assembled, policy, shared, artifacts);
        const manifest = await readJSON(fileAt(root, manifestPath));
        same(manifest, expected, `${config.id} publication manifest`);
        if (await readFile(fileAt(root, manifestPath), "utf8") !== json(expected)) throw new Error(`${config.id} publication manifest serialization differs from the producer`);
        for (const item of [...await canonicalRecords(root, config),
            ...await fileRecords(root, [...Object.keys(assembled.inputs), ...publicationOutputs(config)])]) outputs.set(item.path, item);
        specifications.push({ id: config.id, inputs: Object.keys(assembled.inputs).length,
            ...assembled.annexes, htmlSha256: artifacts[0].sha256 });
    }
    for (const input of frozen) await input.assertUnchanged();
    same(shared, await publicationInputs(policy, root), "Shared tooling during verification");
    return { policy, configs, outputs: [...outputs.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), specifications };
}

export async function checkCommitted({ root = REPO_ROOT } = {}) {
    const snapshot = await verifyPublicationSnapshot({ root });
    const inputs = await sourceInputRecords(root, snapshot.policy, snapshot.configs);
    const manifest = await readJSON(fileAt(root, SOURCE_MANIFEST));
    assertSourceManifest(manifest, snapshot.policy, inputs, snapshot.outputs);
    return { status: "verified", assurance: "committed-generation-consistency", browserInvoked: false,
        generatorInputs: inputs.length, outputs: snapshot.outputs.length, sourceSealDigest: manifest.digest,
        specifications: snapshot.specifications };
}
export async function runCLI(args = process.argv.slice(2)) {
    try {
        if (args.length && (args.length !== 2 || args[0] !== "--root" || !args[1] || args[1].startsWith("--"))) {
            throw new Error("Usage: node av/tools/publication/check-committed.mjs [--root PATH]; verification is read-only");
        }
        console.log(JSON.stringify(await checkCommitted(args.length ? { root: path.resolve(args[1]) } : {})));
    } catch (error) {
        console.error(`Committed publication error: ${error.message}`);
        process.exitCode = 1;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runCLI();
