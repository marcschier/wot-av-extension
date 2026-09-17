import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { assemble, decodeUTF8, formatJSON, logicalPath, parseJSON, parseTDExcerpt, readApproved, sha256, sourceTarget } from "./lib.mjs";

const dataExtensions = new Set([".json", ".jsonld", ".ttl", ".md"]);
const inTree = (name, tree) => name === tree || name.startsWith(tree + "/");
const physicalName = item => typeof item === "string" ? item : item.physicalPath ?? item.path;

export function canonicalPaths(manifest, spec) {
    if (!Array.isArray(manifest.artifacts)) throw new Error("Canonical manifest requires an artifacts array");
    const paths = new Map();
    for (const item of manifest.artifacts) {
        if (!item.path || !item.physicalPath || !inTree(item.physicalPath, spec)) throw new Error("Canonical artifact lacks an owned physicalPath");
        if (logicalPath("spec.md", item.path) !== item.path || logicalPath("spec.md", item.physicalPath) !== item.physicalPath) throw new Error("Noncanonical artifact path");
        if (paths.has(item.path)) throw new Error(`Duplicate canonical artifact: ${item.path}`);
        paths.set(item.path, item.physicalPath);
    }
    if (manifest.artifactPathMap) {
        for (const [key, value] of Object.entries(manifest.artifactPathMap)) {
            if (typeof value !== "string") throw new Error(`Invalid artifactPathMap value: ${key}`);
            const physical = inTree(key, spec) ? key : value;
            const logical = inTree(key, spec) ? value : key;
            if (!inTree(physical, spec) || paths.get(logical) !== physical) throw new Error(`artifactPathMap disagrees with artifact record: ${logical}`);
        }
        if (Object.keys(manifest.artifactPathMap).length !== paths.size) throw new Error("artifactPathMap does not cover every canonical artifact");
    }
    return paths;
}

export function normativeMembers(manifest, { requireRoles = false } = {}) {
    const files = manifest.artifacts ?? manifest.files;
    if (!Array.isArray(files) || !files.length) throw new Error("Normative manifest requires a nonempty explicit artifacts or files array");
    const normative = [], mechanics = [], markdown = [];
    for (const item of files) {
        const name = physicalName(item);
        if (typeof name !== "string") throw new Error("Normative manifest contains an unnamed input");
        if (requireRoles && (typeof item === "string" || !item.role && !item.classification)) throw new Error(`Canonical manifest lacks a declared normative/informative role: ${name}`);
        const role = typeof item === "string" ? "normative" : item.role ?? item.classification ?? "normative";
        if (["normative", "normative-annex", "normative-catalog", "normative-schema", "normative-vocabulary", "thing-model", "client-requirement-manifest"].includes(role)) {
            normative.push(item);
            if (name.endsWith(".md")) markdown.push(name);
        } else if (role === "mechanics" || role === "publication-mechanics") mechanics.push(item);
        else if (!["informative", "informative-evidence", "supporting", "example"].includes(role)) throw new Error(`Unknown normative manifest role: ${role}`);
    }
    if (!normative.length) throw new Error("Normative manifest declares no normative inputs");
    for (const item of manifest.mechanicsFiles ?? []) mechanics.push(item);
    return { normative, mechanics, markdown };
}

export async function freezeSpecification(root, config, policy, outputMap) {
    if (config.schemaVersion !== 1 || !["av", "onvif"].includes(config.id)) throw new Error("Invalid specification configuration");
    if (config.source !== `${config.id}/spec.md` || config.output !== `${config.id}/index.html`) throw new Error("Only authoritative root specifications and their root HTML are supported");
    const hashes = Object.create(null), bytes = new Map(), identities = new Map(), localLinks = new Set();
    const approved = new Set([config.source, ...config.normativeFiles, ...config.mechanicsFiles]);
    const markdown = new Set([config.source, ...config.markdownIncludes]);
    const exampleFiles = new Set(config.exampleFiles ?? []);
    const rootReal = await realpath(path.join(root, config.id));
    let total = 0;
    function owned(name) {
        if (typeof name !== "string" || logicalPath("spec.md", name) !== name || !inTree(name, config.id)) throw new Error(`Source outside specification root: ${name}`);
        if (!dataExtensions.has(path.posix.extname(name))) throw new Error(`Source is not declared specification data: ${name}`);
        if (/(?:^|\/)(?:samples|tools|node_modules|history|research)(?:\/|$)/.test(name) && !exampleFiles.has(name)) throw new Error(`Implementation, test or historical source cannot be a normative input: ${name}`);
        return name;
    }
    for (const name of exampleFiles) {
        if (!/\.json(?:ld)?$/.test(name) || approved.has(name) || markdown.has(name)) throw new Error(`Explicit example data cannot be normative Markdown or a normative inventory: ${name}`);
        owned(name);
    }
    const resolveSource = (name, target) => config.sourceAliases?.[name]?.[target] ?? logicalPath(name, target);
    async function load(name) {
        owned(name);
        if (bytes.has(name)) return bytes.get(name);
        const target = await realpath(path.join(root, ...name.split("/")));
        const relative = path.relative(rootReal, target);
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error(`Input symlink escapes specification root: ${name}`);
        const size = (await stat(target)).size;
        const limit = name.endsWith(".md") ? policy.limits.markdownBytes : policy.limits.artifactBytes;
        if (size > limit || total + size > policy.limits.totalBytes || bytes.size >= policy.limits.inputs) throw new Error(`Publication input budget exceeded: ${name}`);
        const body = await readFile(target);
        total += body.length;
        hashes[name] = sha256(body);
        bytes.set(name, body);
        if (name.endsWith(".tm.json")) {
            const model = parseJSON(decodeUTF8(body)).value;
            const identity = model.id ?? model["@id"] ?? model.$id;
            if (typeof identity === "string" && /^https?:/.test(identity)) {
                if (identities.has(identity) && identities.get(identity) !== name) throw new Error(`Ambiguous canonical model identity: ${identity}`);
                identities.set(identity, name);
            }
        }
        return body;
    }
    const missing = [];
    async function required(name) {
        try { return await load(name); }
        catch (error) {
            if (error.code !== "ENOENT") throw error;
            missing.push(name);
            return undefined;
        }
    }
    for (const name of [config.source, config.normativeManifest, config.canonicalManifest, ...config.normativeFiles, ...config.mechanicsFiles, ...config.markdownIncludes].filter(Boolean)) await required(name);
    if (missing.length) throw new Error(`Publication inputs are not ready (${config.id}); missing:\n${[...new Set(missing)].sort().map(name => `  ${name}`).join("\n")}`);
    let canonical, paths = new Map(), declaredCount = config.normativeFiles.length;
    if (config.canonicalManifest) {
        canonical = parseJSON(decodeUTF8(bytes.get(config.canonicalManifest))).value;
        paths = canonicalPaths(canonical, config.id);
        approved.add(config.canonicalManifest);
    }
    if (config.normativeManifest) {
        const manifest = parseJSON(decodeUTF8(bytes.get(config.normativeManifest))).value;
        const members = normativeMembers(manifest, { requireRoles: config.normativeManifest === config.canonicalManifest });
        declaredCount = members.normative.length;
        approved.add(config.normativeManifest);
        for (const name of members.markdown) markdown.add(name);
        for (const item of [...members.normative, ...members.mechanics]) {
            const raw = physicalName(item);
            const name = paths.get(raw) ?? raw;
            if (exampleFiles.has(name)) throw new Error(`Example data cannot be admitted by the normative manifest: ${name}`);
            approved.add(owned(name));
            const body = await required(name);
            if (body && typeof item === "object" && item.sha256 && sha256(body) !== item.sha256) throw new Error(`Normative manifest digest mismatch: ${name}`);
        }
    }
    if (missing.length) throw new Error(`Missing declared normative or mechanics inputs:\n${missing.sort().map(name => `  ${name}`).join("\n")}`);
    for (const name of markdown) approved.add(owned(name));
    for (const item of canonical?.artifacts ?? []) {
        if (!approved.has(item.physicalPath)) continue;
        if (sha256(await load(item.physicalPath)) !== item.sha256) throw new Error(`Stale canonical artifact: ${item.physicalPath}`);
    }
    const scanned = new Set();
    async function directives(name, chain = []) {
        if (chain.includes(name)) throw new Error(`Include cycle: ${[...chain, name].join(" -> ")}`);
        if (chain.length >= policy.limits.includeDepth) throw new Error("Include depth limit exceeded");
        if (scanned.has(name)) return;
        scanned.add(name);
        let fence;
        for (const line of decodeUTF8(await load(name)).replace(/\r\n/g, "\n").split("\n")) {
            const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (mark) {
                if (!fence) fence = mark[1];
                else if (mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
                continue;
            }
            if (fence) continue;
            const match = line.match(/^<!-- (?:(include|example|td-excerpt): |BEGIN (EXAMPLE|GENERATED): )(.+?) -->$/);
            if (!match) continue;
            const kind = (match[1] ?? match[2]).toLowerCase();
            if (kind === "generated" && !/\.json(?:ld)?(?:#|$)/.test(match[3])) continue;
            const { target } = sourceTarget(kind === "td-excerpt" ? parseTDExcerpt(match[3]).source : match[3]);
            const resolved = resolveSource(name, target);
            if (kind === "include") {
                if (!markdown.has(resolved)) throw new Error(`Undeclared normative Markdown include: ${resolved}`);
                await directives(resolved, [...chain, name]);
            } else {
                if (kind === "example" || kind === "td-excerpt") {
                    if ((!config.exampleRoots.some(tree => inTree(resolved, tree)) && !exampleFiles.has(resolved)) || !/\.json(?:ld)?$/.test(resolved)) throw new Error(`Example outside declared example roots: ${resolved}`);
                    approved.add(owned(resolved));
                }
                if (kind === "generated" && exampleFiles.has(resolved)) throw new Error(`Example data cannot own a normative generated region: ${resolved}`);
                if (!approved.has(resolved)) throw new Error(`Undeclared normative source: ${resolved}`);
                await load(resolved);
            }
        }
    }
    await directives(config.source);
    const refs = parseJSON(decodeUTF8(await load(config.bibliography))).value;
    for (const key of config.requiredReferences ?? []) {
        if (!refs.entries[key] || refs.classification[key] !== "normative") throw new Error(`Missing approved normative bibliography entry: ${key}; see ${config.id}/support/publication/bibliography-review.json`);
    }
    const resolveLink = async (from, target) => {
        if (/^https?:/.test(target)) {
            const physical = identities.get(target);
            return physical ? { href: target, artifactHref: path.posix.relative(path.posix.dirname(config.output), physical) } : target;
        }
        const parts = target.split("#");
        if (parts.length > 2) throw new Error(`Invalid local publication link: ${target}`);
        const resolved = resolveSource(from, parts[0]);
        const logical = resolved.slice(config.id.length + 1);
        const physical = paths.get(logical) ?? resolved;
        if (!/^(?:av|onvif)\//.test(physical) || /(?:^|\/)(?:node_modules|local-only|\.git)(?:\/|$)/.test(physical)) throw new Error(`Publication link outside owned public trees: ${physical}`);
        const targetPath = await realpath(path.join(root, ...physical.split("/")));
        const repository = await realpath(root);
        const relative = path.relative(repository, targetPath);
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error(`Publication link escapes repository: ${physical}`);
        if (parts[1] && /\.json(?:ld)?$/.test(physical)) {
            if (!approved.has(physical)) throw new Error(`Undeclared linked JSON Pointer input: ${physical}`);
            const { pointer } = sourceTarget(physical + "#" + parts[1]);
            formatJSON(decodeUTF8(await load(physical)), pointer);
        }
        localLinks.add(physical);
        return path.posix.relative(path.posix.dirname(config.output), outputMap[physical] ?? physical) + (parts[1] ? "#" + parts[1] : "");
    };
    const result = await assemble({
        source: config.source, refs, outputMap, resolveLink, resolveSource,
        read: name => {
            if (!approved.has(name)) throw new Error(`Unapproved input: ${name}`);
            return readApproved(root, name, hashes);
        }
    });
    for (const name of config.requiredGeneratedSources) {
        if (!result.regions.some(region => region.kind === "GENERATED" && region.input === name)) throw new Error(`Required complete generated definitions are missing: ${config.source} from ${name}`);
    }
    if (result.metadata.draftDate && result.metadata.draftDate !== config.sourceDate) throw new Error(`Source date differs from declared publication date: ${config.source}`);
    result.metadata.draftDate = config.sourceDate;
    result.inputs = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
    result.annexes = { normativeArtifacts: declaredCount, canonicalArtifacts: canonical ? canonical.artifacts.length + 1 : 0 };
    result.localLinks = [...localLinks].sort();
    return {
        assembled: result,
        async assertUnchanged() {
            for (const [name, hash] of Object.entries(hashes)) {
                if (sha256(await readFile(path.join(root, ...name.split("/")))) !== hash) throw new Error(`Input changed during publication; rerun after authors finish: ${name}`);
            }
        }
    };
}
