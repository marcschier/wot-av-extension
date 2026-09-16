import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, REPO_ROOT, SUPPORT_ROOT, FIXTURE_ROOT, assemble, readJSON, sha256 } from "./lib.mjs";
import { freezeSpecification } from "./inputs.mjs";
import { render } from "./render.mjs";
import { recordQualification, verifiedAssets } from "./assets.mjs";

const json = value => JSON.stringify(value, null, 4) + "\n";
const fileAt = (root, name) => path.join(root, ...name.split("/"));

export function argumentsFor(args) {
    const options = { ids: [] };
    const flags = { "--fixture": "fixture", "--qualify-browser": "qualify", "--check": "check", "--inputs-only": "inputsOnly", "--render-only": "renderOnly", "--release": "release" };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (flags[arg]) options[flags[arg]] = true;
        else if (arg === "--av" || arg === "--onvif") options.ids.push(arg.slice(2));
        else if (arg === "--output-dir" || arg === "--tool-package") {
            const value = args[++index];
            if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
            options[arg === "--output-dir" ? "outputDir" : "toolPackage"] = path.resolve(value);
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.release) throw new Error("Publication blocked: editor, first-party license, distribution and public-identifier approvals are unassigned; --release is not implemented");
    if (options.qualify && (!options.fixture || options.check)) throw new Error("--qualify-browser requires --fixture and cannot be used by check mode");
    if (options.check && options.outputDir) throw new Error("--check compares repository outputs and does not accept --output-dir");
    if (options.fixture && options.inputsOnly) throw new Error("--inputs-only checks actual root specifications, not fixtures");
    if (options.inputsOnly && options.check || options.fixture && options.check) throw new Error("--check cannot be combined with fixture or input-only mode");
    return options;
}

function run(command, args, { timeout = 360000 } = {}) {
    let executable = command, parameters = args;
    if (command === "npm") {
        executable = process.execPath;
        parameters = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args];
    } else if (command === "node") executable = process.execPath;
    else if (command !== "python") throw new Error(`Unapproved publication preparation command: ${command}`);
    const result = spawnSync(executable, parameters, {
        cwd: REPO_ROOT, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, PUPPETEER_SKIP_DOWNLOAD: "true" }
    });
    if (result.error || result.status !== 0) throw new Error(`Publication command failed: ${command} ${args.join(" ")}\n${result.error?.message ?? (result.stderr.trim() || result.stdout.trim())}`);
    return result.stdout.trim();
}

async function configurations(policy, options) {
    const configs = [];
    for (const name of policy.specifications) {
        if (!/^(av|onvif)\/support\/publication\/specification\.json$/.test(name)) throw new Error(`Unapproved specification configuration: ${name}`);
        const config = await readJSON(fileAt(REPO_ROOT, name));
        if (!options.ids.length || options.ids.includes(config.id)) configs.push(config);
    }
    return configs;
}

async function prepare(configs, check) {
    for (const config of configs) {
        for (const [command, ...args] of config.prepare) {
            run(command, check ? [...args, ...(command === "npm" ? ["--"] : []), "--check"] : args);
        }
    }
}

export async function assembleSpecifications(configs, policy) {
    const map = Object.fromEntries(policy.specifications.map(name => {
        const id = name.split("/")[0];
        return [`${id}/spec.md`, `${id}/index.html`];
    }));
    const inputs = [], errors = [];
    for (const config of configs) {
        try { inputs.push({ config, ...await freezeSpecification(REPO_ROOT, config, policy, map) }); }
        catch (error) { errors.push(`${config.id}: ${error.message}`); }
    }
    if (errors.length) throw new Error(errors.join("\n\n"));
    return inputs;
}

async function fixture(options) {
    const refs = await readJSON(path.join(SUPPORT_ROOT, "bibliography.json"));
    const assembled = await assemble({
        source: "spec.md", refs,
        read: name => {
            if (!["spec.md", "annex.md", "example.json", "terms.json"].includes(name)) throw new Error(`Unapproved input: ${name}`);
            return readFile(fileAt(FIXTURE_ROOT, name), "utf8");
        }
    });
    const result = await render(assembled, { qualify: options.qualify, toolPackage: options.toolPackage });
    if (options.qualify) {
        const second = await render(assembled, { qualify: true, toolPackage: options.toolPackage });
        if (second.html !== result.html) throw new Error("Browser qualification failed: fresh-profile fixture bytes differ");
        await recordQualification(result.report.browser);
    }
    if (options.outputDir) {
        await mkdir(path.join(options.outputDir, "fixture"), { recursive: true });
        await writeFile(path.join(options.outputDir, "fixture", "index.html"), result.html);
        await writeFile(path.join(options.outputDir, "fixture-report.json"), json(result.report));
    }
    return [{ spec: "fixture", bytes: Buffer.byteLength(result.html), sha256: sha256(result.html), ...result.report.readable }];
}

async function publicationInputs(policy) {
    const ownership = await readJSON(path.join(REPO_ROOT, "publication-ownership.json"));
    if (ownership.sharedPublication?.inputField !== "sharedAuthoredFiles") throw new Error("Shared publication authored-file ownership is not declared");
    const names = ownership.sharedAuthoredFiles;
    if (!Array.isArray(names) || !names.length) throw new Error("Shared publication inputs are empty");
    const inputs = [];
    for (const name of [...new Set(["package.json", "package-lock.json", "publication-ownership.json", ...policy.specifications, ...names])].sort()) {
        if (name.startsWith("/") || name.includes("..") || name.includes("\\")) throw new Error(`Invalid publication ownership path: ${name}`);
        const data = await readFile(fileAt(REPO_ROOT, name));
        inputs.push({ path: name, bytes: data.length, sha256: sha256(data) });
    }
    return inputs;
}

async function build(configs, policy, options) {
    const inputs = await assembleSpecifications(configs, policy);
    if (options.inputsOnly) return inputs.map(({ config, assembled }) => ({ spec: config.id, status: "ready", inputs: Object.keys(assembled.inputs).length, ...assembled.annexes }));
    const toolInputs = await publicationInputs(policy);
    const rendered = [];
    for (const input of inputs) {
        rendered.push({ ...input, ...await render(input.assembled, { toolPackage: options.toolPackage }) });
    }
    for (const input of inputs) await input.assertUnchanged();
    if (json(toolInputs) !== json(await publicationInputs(policy))) throw new Error("Publication tooling changed during rendering; rerun after owners finish");
    const out = options.outputDir ?? REPO_ROOT;
    const artifacts = [];
    for (const { config, html, report } of rendered) {
        const reportPath = `${config.id}/support/publication/render-report.json`;
        for (const [name, data] of [[config.output, html], [reportPath, json(report)]]) {
            await mkdir(path.dirname(fileAt(out, name)), { recursive: true });
            await writeFile(fileAt(out, name), data);
            artifacts.push({ path: name, bytes: Buffer.byteLength(data), sha256: sha256(data) });
        }
    }
    for (const { config, assembled } of inputs) {
        const manifest = {
            schemaVersion: 1,
            status: "Independent technical draft; distribution not approved",
            sourceDate: config.sourceDate,
            generationCommand: `npm run build:specs -- --${config.id}`,
            checkCommand: `npm run check:specs -- --${config.id}`,
            hashAlgorithm: "SHA-256 of exact bytes; this manifest excludes its own hash",
            releaseApprovals: policy.publication.releaseApprovals,
            inputs: toolInputs,
            specification: { id: config.id, source: config.source, output: config.output, inputs: assembled.inputs, annexes: assembled.annexes },
            artifacts: artifacts.filter(item => item.path.startsWith(config.id + "/"))
        };
        const manifestPath = `${config.id}/support/publication/publication-manifest.json`;
        await writeFile(fileAt(out, manifestPath), json(manifest));
    }
    return rendered.map(({ config, html, report }) => ({ spec: config.id, path: config.output, bytes: Buffer.byteLength(html), sha256: sha256(html), ...report.readable }));
}

async function check(configs, options) {
    const directories = [];
    try {
        for (let pass = 0; pass < 2; pass++) {
            const directory = await mkdtemp(path.join(os.tmpdir(), "wot-av-publication-check-"));
            directories.push(directory);
            const args = [path.join(ROOT, "build-specs.mjs"), "--render-only", "--output-dir", directory, ...configs.map(config => "--" + config.id)];
            if (options.toolPackage) args.push("--tool-package", options.toolPackage);
            run("node", args, { timeout: 600000 });
        }
        const outputs = configs.flatMap(config => [config.output, `${config.id}/support/publication/render-report.json`, `${config.id}/support/publication/publication-manifest.json`]);
        const results = [];
        for (const name of outputs) {
            const a = await readFile(fileAt(directories[0], name)), b = await readFile(fileAt(directories[1], name));
            if (!a.equals(b)) throw new Error(`Nondeterministic publication output: ${name}`);
            let existing;
            try { existing = await readFile(fileAt(REPO_ROOT, name)); }
            catch (error) {
                if (error.code !== "ENOENT") throw error;
                throw new Error(`Missing generated publication: ${name}; run npm run build:specs after source integration`);
            }
            if (!existing.equals(a)) throw new Error(`Stale publication output: ${name}; run npm run build:specs`);
            results.push({ path: name, sha256: sha256(a), freshProcessEquality: true });
        }
        return results;
    } finally {
        for (const directory of directories) await rm(directory, { recursive: true, force: false });
    }
}

export async function buildSpecifications(options = {}) {
    options = { ids: [], ...options };
    if (options.release) throw new Error("Publication blocked: no approved release metadata or implemented release route");
    if (options.qualify && (!options.fixture || options.check)) throw new Error("--qualify-browser requires --fixture outside check mode");
    const { policy } = await verifiedAssets();
    if (process.env.SOURCE_DATE_EPOCH && process.env.SOURCE_DATE_EPOCH !== String(policy.sourceDateEpoch)) throw new Error("SOURCE_DATE_EPOCH must equal the explicitly declared source date epoch");
    if (options.fixture) return fixture(options);
    const configs = await configurations(policy, options);
    if (!options.renderOnly && !options.inputsOnly) await prepare(configs, options.check);
    const results = options.check ? await check(configs, options) : await build(configs, policy, options);
    if (!options.check && !options.outputDir && !options.inputsOnly && !options.renderOnly) {
        run("python", ["-B", "onvif/tools/generate_onvif.py"]);
        run("python", ["-B", "av/tools/generate.py"]);
    }
    return results;
}

export async function runCLI(args = process.argv.slice(2)) {
    try {
        for (const result of await buildSpecifications(argumentsFor(args))) console.log(JSON.stringify(result));
    } catch (error) {
        console.error(`Publication error: ${error.message}`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runCLI();
