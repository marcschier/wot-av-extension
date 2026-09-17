import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, sha256 } from "../lib.mjs";
import { freezeSpecification } from "../inputs.mjs";
import { fileAt, fileRecord, json, publicationInputs, publicationManifest, publicationOutputs } from "../metadata.mjs";
import { checkCommitted, verifyPublicationSnapshot } from "../check-committed.mjs";
import { SOURCE_MANIFEST, produceWithSourceSeal, sourceInputRecords, sourceManifest } from "../source-inputs.mjs";

async function fixture(action) {
    const root = await mkdtemp(path.join(os.tmpdir(), "wot-av-committed-snapshot-"));
    const write = async (name, value) => {
        const target = fileAt(root, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, typeof value === "string" ? value : json(value));
    };
    const read = async name => JSON.parse(await readFile(fileAt(root, name), "utf8"));
    const edit = async (name, change) => { const value = await read(name); change(value); await write(name, value); };
    const browser = { node: process.versions.node, puppeteer: "25.10.0", executableSha256: "1".repeat(64),
        protocolVersion: "1.3", product: "Edg/153.0.4234.32", revision: "@fixture", userAgent: "Synthetic producer", jsVersion: "fixture" };
    const policy = {
        schemaVersion: 1, sourceDate: "2026-09-16", sourceDateEpoch: 1789516800,
        node: { version: process.versions.node, executable: "Z:\\absent\\node.exe" },
        browser: { product: browser.product, revision: browser.revision, protocolVersion: browser.protocolVersion,
            executable: "Z:\\absent\\browser.exe" },
        publication: { releaseApprovals: { editors: false, firstPartyLicense: false, distribution: false, publicIdentifiers: false } },
        limits: { inputs: 10000, markdownBytes: 8 * 1024 * 1024, artifactBytes: 64 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, includeDepth: 20 },
        specifications: ["av/support/publication/specification.json", "onvif/support/publication/specification.json"]
    };
    const configs = ["av", "onvif"].map(id => ({
        schemaVersion: 1, id, source: `${id}/spec.md`, output: `${id}/index.html`,
        bibliography: `${id}/support/publication/bibliography.json`, sourceDate: policy.sourceDate,
        normativeFiles: [`${id}/terms.json`], mechanicsFiles: [], markdownIncludes: [], exampleRoots: [`${id}/examples`],
        requiredGeneratedSources: [`${id}/terms.json`], prepare: [],
        ...(id === "onvif" ? { normativeManifest: "onvif/model-manifest.json", canonicalManifest: "onvif/model-manifest.json" } : {})
    }));
    const ownership = {
        schemaVersion: 1, avGeneratedFiles: ["av/spec.md"], sharedPublication: { inputField: "sharedAuthoredFiles" },
        sharedAuthoredFiles: ["av/tools/publication/package.json", "av/tools/publication/fixture.mjs", "av/support/publication/publication-policy.json",
            "av/support/publication/assets.lock.json", "av/support/publication/browser-qualification.json", "av/support/publication/THIRD-PARTY-NOTICES.txt"],
        onvifAuthoredFiles: ["onvif/sources.lock.json"],
        onvifAuthoredRoots: ["onvif/samples/reference-runtime/src", "onvif/samples/reference-runtime/native-media/src", ".github/workflows", "onvif/requirements"],
        excludedBuildDirectoryNames: ["node_modules", "dist", ".compiled", "__pycache__"], excludedBuildDirectoryPrefixes: ["build"]
    };
    const notices = "Synthetic fixture notices.\n", css = "body { color: black; }\n";
    const lock = {
        version: 1, node: process.versions.node,
        browser: { ...policy.browser, sha256: browser.executableSha256 },
        packages: [{ package: "node_modules/puppeteer", version: "25.10.0", integrity: "sha512-fixture",
            source: "https://registry.npmjs.org/puppeteer/-/puppeteer-25.10.0.tgz" }],
        noticesSha256: sha256(notices),
        assets: [{ path: "assets/publication.css", bytes: Buffer.byteLength(css), sha256: sha256(css), urls: [], contentType: "text/css" }]
    };
    const bibliography = {
        entries: { RFC2119: { title: "Key words", href: "https://www.rfc-editor.org/rfc/rfc2119" },
            RFC8174: { title: "Requirement words", href: "https://www.rfc-editor.org/rfc/rfc8174" } },
        classification: { RFC2119: "normative", RFC8174: "normative" }, aliases: {}
    };
    const canonical = [
        { path: "vocabulary/terms.json", physicalPath: "onvif/terms.json", role: "normative-vocabulary" },
        { path: "generated/catalog.json", physicalPath: "onvif/catalog.json", role: "normative-catalog" },
        { path: "models/Fixture.tm.json", physicalPath: "onvif/models/native/Fixture.tm.json", role: "thing-model" },
        { path: "coverage/coverage.json", physicalPath: "onvif/support/reports/coverage.json", role: "informative-evidence" }
    ];
    async function canonicalManifest() {
        const artifacts = await Promise.all(canonical.map(async item => {
            const bytes = await readFile(fileAt(root, item.physicalPath));
            return { ...item, bytes: bytes.length, sha256: sha256(bytes) };
        }));
        await write("onvif/model-manifest.json", { formatVersion: 1, artifacts });
    }
    async function renderSnapshots(ids = ["av", "onvif"]) {
        const shared = await publicationInputs(policy, root), outputMap = Object.fromEntries(configs.map(config => [config.source, config.output]));
        for (const config of configs.filter(config => ids.includes(config.id))) {
            const { assembled } = await freezeSpecification(root, config, policy, outputMap);
            const [htmlPath, reportPath, manifestPath] = publicationOutputs(config);
            await write(htmlPath, `<!doctype html><html lang="en"><head><title>${config.id} fixture</title></head><body><h1>${config.id}</h1><p>Independent test draft.</p></body></html>\n`);
            const report = { status: { errors: [], warnings: [] }, readable: { errors: [], headings: 1, textLength: 36 }, browser,
                requests: ["/document", "/assets/publication.css"], blocked: [], source: assembled.source, inputs: assembled.inputs,
                regions: assembled.regions, diagnostics: assembled.diagnostics, annexes: assembled.annexes,
                localLinks: assembled.localLinks, referenceRewrites: assembled.referenceRewrites };
            await write(reportPath, report);
            const records = await Promise.all([htmlPath, reportPath].map(name => fileRecord(root, name)));
            await write(manifestPath, publicationManifest(config, assembled, policy, shared, records));
        }
    }
    const prove = () => produceWithSourceSeal({ root, policy, configs }, renderSnapshots, () => verifyPublicationSnapshot({ root }));
    async function repairPublicationHashes(id) {
        const config = configs.find(config => config.id === id);
        const [htmlPath, reportPath, manifestPath] = publicationOutputs(config);
        const manifest = await read(manifestPath);
        manifest.artifacts = await Promise.all([htmlPath, reportPath].map(name => fileRecord(root, name)));
        await write(manifestPath, manifest);
    }
    try {
        for (const [name, value] of Object.entries({
            "package.json": { private: true, workspaces: ["av/tools/publication", "onvif/samples/reference-runtime"] },
            "package-lock.json": { lockfileVersion: 3 }, "requirements-dev.txt": "# Fixture only\n", "publication-ownership.json": ownership,
            "av/tools/publication/package.json": { dependencies: { puppeteer: "25.10.0" } },
            "av/tools/publication/fixture.mjs": "export const fixture = 1;\n",
            "av/tools/generate.py": "GENERATOR_VERSION = 1\n",
            "av/support/publication/publication-policy.json": policy, "av/support/publication/assets.lock.json": lock,
            "av/support/publication/browser-qualification.json": browser, "av/support/publication/THIRD-PARTY-NOTICES.txt": notices,
            "av/support/publication/assets/publication.css": css, "av/support/publication/transformation-register.json": { sha256: "2".repeat(64) },
            "onvif/samples/reference-runtime/src/catalog/generator.ts": "export const generator = 1;\n",
            "onvif/samples/reference-runtime/native-media/src/worker.cpp": "int source_fixture = 1;\n",
            ".github/workflows/native.yml": "name: fixture\n",
            "onvif/requirements/requirements-fixture.json": { requirements: [{ id: "fixture" }] },
            "onvif/sources.lock.json": { schemaVersion: 1, sources: [] },
            "onvif/support/upstream/onvif/native.wsdl": "<fixture/>\n",
            "packages/binding-onvif/package.json": { name: "original-package-input" },
            "onvif/catalog.json": { operations: [], nativeQName: { namespace: "urn:native", localName: "GetMedia" } },
            "onvif/models/native/Fixture.tm.json": { id: "https://example.org/wot/onvif/models/Fixture.tm.json", title: "Fixture" },
            "onvif/support/reports/coverage.json": { runtimeQualified: false }
        })) await write(name, value);
        for (const config of configs) {
            await write(`${config.id}/support/publication/specification.json`, config);
            await write(config.bibliography, bibliography);
            await write(`${config.id}/terms.json`, { Example: { meaning: "Complete fixture definition." } });
            await write(config.source, `# ${config.id} fixture\n<!-- BEGIN GENERATED: terms.json#/Example -->\nComplete normative fixture definition.\n<!-- END GENERATED: terms.json#/Example -->\n`);
        }
        await canonicalManifest();
        await prove();
        await action({ root, write, read, edit, configs, policy, canonical, canonicalManifest, renderSnapshots, repairPublicationHashes, prove });
    } finally { await rm(root, { recursive: true, force: false }); }
}

async function tree(root, prefix = "") {
    const result = [];
    for (const entry of await readdir(prefix ? fileAt(root, prefix) : root, { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) result.push(...await tree(root, name));
        else {
            const metadata = await stat(fileAt(root, name));
            result.push({ ...await fileRecord(root, name), mtimeMs: metadata.mtimeMs,
                mode: metadata.mode, ino: metadata.ino, nlink: metadata.nlink });
        }
    }
    return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

test("committed: both models verify without a browser, dependencies or a fabricated Git commit", async () => fixture(async ({ root }) => {
    const before = await tree(root), result = await checkCommitted({ root });
    assert.equal(result.status, "verified");
    assert.equal(result.browserInvoked, false);
    assert.deepEqual(result.specifications.map(item => [item.id, item.normativeArtifacts, item.canonicalArtifacts]), [["av", 1, 0], ["onvif", 3, 5]]);
    assert.equal(before.some(item => item.path.startsWith("node_modules/") || item.path.startsWith(".git/")), false);
    assert.deepEqual(await tree(root), before);
}));

test("committed: HTML tampering and a repaired per-spec hash cannot whitewash a stale producer seal", async () => fixture(async ({ root, write, repairPublicationHashes }) => {
    await write("av/index.html", "<!doctype html><h1>Changed after rendering</h1>\n");
    const before = await tree(root);
    await assert.rejects(checkCommitted({ root }), /av publication manifest/);
    assert.deepEqual(await tree(root), before);
    await repairPublicationHashes("av");
    await assert.rejects(checkCommitted({ root }), /Producer output digest or metadata mismatch/);
}));

test("committed: changed source text and newly declared example inputs invalidate stored reports", async () => fixture(async ({ root, write, configs }) => {
    const name = configs[0].source, original = await readFile(fileAt(root, name), "utf8");
    await write(name, original + "\nAn authored requirement changed.\n");
    await assert.rejects(checkCommitted({ root }), /render report inputs/);
    await write("av/examples/new.json", { literal: "new example" });
    await write(name, original + "\n<!-- example: examples/new.json -->\n");
    await assert.rejects(checkCommitted({ root }), /render report inputs/);
}));

test("committed: newly generated model membership is dynamic and requires a successful full producer", async () => fixture(async data => {
    const { root, canonical, write, canonicalManifest, prove } = data;
    canonical.push({ path: "models/Added.tm.json", physicalPath: "onvif/models/native/Added.tm.json", role: "thing-model" });
    await write("onvif/models/native/Added.tm.json", { id: "https://example.org/wot/onvif/models/Added.tm.json", title: "Added" });
    await canonicalManifest();
    await assert.rejects(checkCommitted({ root }), /render report inputs/);
    await prove();
    const result = await checkCommitted({ root });
    assert.equal(result.specifications.find(item => item.id === "onvif").normativeArtifacts, 4);
    assert.equal(result.specifications.find(item => item.id === "onvif").canonicalArtifacts, 6);
}));

test("committed: missing normative files and unowned artifacts fail rather than shrinking the verified set", async () => fixture(async ({ root, edit, write }) => {
    await rm(fileAt(root, "onvif/models/native/Fixture.tm.json"));
    await assert.rejects(checkCommitted({ root }), /Missing declared normative/);
    await write("onvif/models/native/Fixture.tm.json", { id: "https://example.org/wot/onvif/models/Fixture.tm.json", title: "Fixture" });
    await edit("onvif/model-manifest.json", value => { value.artifacts[1].physicalPath = "av/terms.json"; });
    await assert.rejects(checkCommitted({ root }), /owned physicalPath/);
}));

test("committed: native inputs, CI code, original package inputs and corrupted ledger hashes invalidate generation", async t => {
    for (const [name, content] of [
        ["onvif/support/upstream/onvif/native.wsdl", "<changed-native-source/>\n"],
        ["onvif/samples/reference-runtime/native-media/src/worker.cpp", "int source_fixture = 2;\n"],
        [".github/workflows/native.yml", "name: changed\n"],
        ["packages/binding-onvif/package.json", { name: "changed-original-package-input" }],
        ["av/support/publication/transformation-register.json", { sha256: "0".repeat(64) }]
    ]) await t.test(name, () => fixture(async ({ root, write }) => {
        await write(name, content);
        await verifyPublicationSnapshot({ root });
        const before = await tree(root);
        await assert.rejects(checkCommitted({ root }), /Generator source input digest or metadata mismatch/);
        assert.deepEqual(await tree(root), before);
    }));
});

test("committed: added generator files and missing source files are detected independently of the stored input list", async () => fixture(async ({ root, write }) => {
    await write("onvif/samples/reference-runtime/src/catalog/new-generator.ts", "export const added = true;\n");
    await assert.rejects(checkCommitted({ root }), /Generator source input membership/);
    await rm(fileAt(root, "onvif/samples/reference-runtime/src/catalog/new-generator.ts"));
    await rm(fileAt(root, "onvif/samples/reference-runtime/src/catalog/generator.ts"));
    await assert.rejects(checkCommitted({ root }), /Generator source input membership/);
}));

test("committed: a self-consistent seal cannot omit inputs, add output authority or change its classification", async t => {
    for (const mutation of ["omit-input", "extra-output", "classification", "digest"]) await t.test(mutation, () => fixture(async ({ root, read, write }) => {
        const seal = await read(SOURCE_MANIFEST);
        if (mutation === "omit-input") seal.inputs = seal.inputs.filter(item => !item.path.endsWith("generator.ts"));
        if (mutation === "extra-output") seal.outputs.push({ path: "onvif/unowned.json", bytes: 2, sha256: sha256("{}") });
        if (mutation === "classification") seal.classification = "normative";
        const { digest, ...content } = seal;
        seal.digest = mutation === "digest" ? "0".repeat(64) : sha256(json(content));
        await write(SOURCE_MANIFEST, seal);
        await assert.rejects(checkCommitted({ root }), /membership|seal metadata|seal digest/);
    }));
});

test("committed: altered render counters, errors, blocked requests and malformed artifact digests are rejected", async t => {
    for (const mutation of ["counter", "warning", "blocked", "annex", "digest"]) await t.test(mutation, () => fixture(async ({ root, edit, repairPublicationHashes }) => {
        if (mutation === "digest") await edit("onvif/model-manifest.json", value => { value.artifacts[0].sha256 = "invalid"; });
        else {
            await edit("onvif/support/publication/render-report.json", value => {
                if (mutation === "counter") value.readable.headings++;
                if (mutation === "warning") value.status.warnings.push("unresolved normative citation");
                if (mutation === "blocked") value.blocked.push("https://unapproved.invalid/");
                if (mutation === "annex") value.annexes.normativeArtifacts++;
            });
            await repairPublicationHashes("onvif");
        }
        await assert.rejects(checkCommitted({ root }), /Producer output digest|unsuccessful|render report annexes|digest mismatch/);
    }));
});

test("committed: AV generator drift cannot be cleared by refreshing ONVIF alone", async () => fixture(async ({ root, write, renderSnapshots, configs, policy }) => {
    await write("av/tools/generate.py", "GENERATOR_VERSION = 2\n");
    await renderSnapshots(["onvif"]);
    await verifyPublicationSnapshot({ root });
    await assert.rejects(checkCommitted({ root }), /Generator source input digest.*av\/tools\/generate\.py/);
    await assert.rejects(produceWithSourceSeal({ root, policy, configs: [configs[1]] }, async () => {}, async () => {}),
        /complete AV and ONVIF/);
}));

test("committed: qualification uses stable recorded fields rather than local executable paths", async () => fixture(async ({ root, read, write, prove }) => {
    const policyPath = "av/support/publication/publication-policy.json", lockPath = "av/support/publication/assets.lock.json";
    const policy = await read(policyPath), lock = await read(lockPath);
    policy.node.executable = "/nonexistent/producer/node";
    policy.browser.executable = "/nonexistent/producer/browser";
    lock.browser.executable = policy.browser.executable;
    await write(policyPath, policy);
    await write(lockPath, lock);
    await prove();
    assert.equal((await checkCommitted({ root })).status, "verified");
    policy.node.version = "0.0.0";
    await write(policyPath, policy);
    await assert.rejects(checkCommitted({ root }), /Reviewed Node/);
}));

test("committed: missing seals, removed required files and changed artifact roles cannot be repaired by checking", async () => fixture(async ({ root, write, edit }) => {
    const seal = await readFile(fileAt(root, SOURCE_MANIFEST));
    await rm(fileAt(root, SOURCE_MANIFEST));
    await assert.rejects(checkCommitted({ root }), /ENOENT/);
    await assert.rejects(readFile(fileAt(root, SOURCE_MANIFEST)), /ENOENT/);
    await write(SOURCE_MANIFEST, seal.toString("utf8"));
    await edit("onvif/model-manifest.json", value => { value.artifacts[2].role = "source"; });
    await assert.rejects(checkCommitted({ root }), /Unknown normative manifest role/);
    await rm(fileAt(root, "av/support/publication/THIRD-PARTY-NOTICES.txt"));
    await assert.rejects(checkCommitted({ root }), /ENOENT/);
}));

test("producer: canonical or renderer failure leaves the preceding seal byte-exact", async () => fixture(async ({ root, configs, policy }) => {
    const before = await readFile(fileAt(root, SOURCE_MANIFEST));
    for (const phase of ["canonical", "renderer"]) {
        let verified = false;
        await assert.rejects(produceWithSourceSeal({ root, configs, policy }, async () => { throw new Error(`${phase} failed`); },
            async () => { verified = true; }), new RegExp(`${phase} failed`));
        assert.equal(verified, false);
        assert.deepEqual(await readFile(fileAt(root, SOURCE_MANIFEST)), before);
    }
}));

test("producer: changed sources during generation and unsuccessful output verification never reseal", async () => fixture(async ({ root, configs, policy, write }) => {
    const before = await readFile(fileAt(root, SOURCE_MANIFEST));
    await assert.rejects(produceWithSourceSeal({ root, configs, policy },
        () => write("av/tools/generate.py", "GENERATOR_VERSION = 3\n"), () => verifyPublicationSnapshot({ root })), /Generator source during/);
    assert.deepEqual(await readFile(fileAt(root, SOURCE_MANIFEST)), before);
    await assert.rejects(produceWithSourceSeal({ root, configs, policy },
        () => write("av/index.html", "<h1>Not the recorded output</h1>"), () => verifyPublicationSnapshot({ root })), /publication manifest/);
    assert.deepEqual(await readFile(fileAt(root, SOURCE_MANIFEST)), before);
}));

test("producer: its own seal and downstream inventories never become circular generation inputs", async () => fixture(async ({ root, configs, policy, write }) => {
    const before = await sourceInputRecords(root, policy, configs);
    await write("av/support/publication/release-manifest.json", { sourceSeal: "downstream reference only" });
    await write("onvif/support/publication/release-manifest.json", { sourceSeal: "downstream reference only" });
    await write("av/support/publication/integration-result.json", { sourceSeal: "downstream reference only" });
    assert.deepEqual(await sourceInputRecords(root, policy, configs), before);
    assert.equal(before.some(item => item.path === SOURCE_MANIFEST), false);
    assert.throws(() => sourceManifest(policy, [...before, { path: SOURCE_MANIFEST, bytes: 1, sha256: "1".repeat(64) }], []), /cannot hash itself/);
}));

test("committed CLI: dependency and write guards permit verification and reject mutating options", async () => fixture(async ({ root }) => {
    const module = pathToFileURL(path.join(REPO_ROOT, "av", "tools", "publication", "check-committed.mjs")).href;
    const script = `
        import fs from "node:fs";
        import fsp from "node:fs/promises";
        import { registerHooks, syncBuiltinESMExports } from "node:module";
        for (const name of ["writeFile", "appendFile", "mkdir", "rm", "unlink", "rename", "copyFile", "truncate"]) {
            fsp[name] = () => { throw new Error("Verifier attempted a filesystem write: " + name); };
            fs[name + "Sync"] = () => { throw new Error("Verifier attempted a filesystem write: " + name); };
        }
        syncBuiltinESMExports();
        registerHooks({ resolve(specifier, context, next) {
            if (/render\\.mjs|puppeteer|mermaid|respec|node_modules/.test(specifier)) throw new Error("Renderer dependency imported: " + specifier);
            return next(specifier, context);
        } });
        const { runCLI } = await import(${JSON.stringify(module)});
        await runCLI(["--root", ${JSON.stringify(root)}]);
    `;
    const before = await tree(root);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).browserInvoked, false);
    assert.deepEqual(await tree(root), before);
    const invalid = spawnSync(process.execPath, [fileAt(REPO_ROOT, "av/tools/publication/check-committed.mjs"), "--seal"], { encoding: "utf8", timeout: 30000 });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /verification is read-only/);
}));
