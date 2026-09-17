import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const ROOT = import.meta.dirname;
export const REPO_ROOT = path.resolve(ROOT, "..", "..", "..");
export const SUPPORT_ROOT = path.join(REPO_ROOT, "av", "support", "publication");
export const FIXTURE_ROOT = path.join(ROOT, "test", "fixtures");
export const decodeUTF8 = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
export const jsonScript = value => JSON.stringify(value).replace(/</g, "\\u003c");
export const slug = value => value.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
export function mermaidInput(raw) {
    // Mermaid treats semicolons as statement terminators even in sequence labels.
    // Entity-encode label punctuation only; retain the authoritative source text.
    if (!/^sequenceDiagram\b/.test(raw)) return raw;
    return raw.split("\n").map(line => {
        const match = line.match(/^(\s*[^:\n]+(?:->>|-->>|->|-->|-x|--x)[^:\n]+:)(.*)$/);
        return match ? match[1] + match[2].replace(/(?<!#\d{1,6});/g, "#59;") : line;
    }).join("\n");
}
export function mapProse(markdown, transform) {
    const literal = /<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
    let result = "", end = 0;
    for (const match of markdown.matchAll(literal)) {
        result += transform(markdown.slice(end, match.index)) + match[0];
        end = match.index + match[0].length;
    }
    return result + transform(markdown.slice(end));
}

// Keep original number and string tokens; JSON.parse alone loses large integers.
export function parseJSON(source) {
    const tokens = source.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]|[ \t\r\n]+|./gs) ?? [];
    const ts = tokens.filter(t => !/^[ \t\r\n]+$/.test(t));
    let index = 0;
    function value(depth) {
        if (depth > 100) throw new Error("JSON nesting limit exceeded");
        const t = ts[index++];
        if (t === "{" || t === "[") {
            const object = t === "{", end = object ? "}" : "]";
            const items = [], keys = new Set();
            if (ts[index] === end) { index++; return { raw: t + end, value: object ? {} : [] }; }
            const result = object ? Object.create(null) : [];
            while (true) {
                let key;
                if (object) {
                    const k = ts[index++];
                    if (!k?.startsWith('"')) throw new Error("JSON object key expected");
                    key = JSON.parse(k);
                    if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
                    keys.add(key);
                    if (ts[index++] !== ":") throw new Error("JSON colon expected");
                    key = { token: k, name: key };
                }
                const v = value(depth + 1);
                items.push({ key, node: v });
                if (object) result[key.name] = v.value; else result.push(v.value);
                const next = ts[index++];
                if (next === end) break;
                if (next !== ",") throw new Error("JSON separator expected");
            }
            return { object, items, value: result };
        }
        if (!t || !/^(?:"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/s.test(t)) throw new Error("Invalid JSON value");
        return { raw: t, value: JSON.parse(t) };
    }
    const tree = value(0);
    if (index !== ts.length) throw new Error("Trailing JSON data");
    return tree;
}

function selectJSON(node, pointer = "") {
    if (pointer) {
        if (!pointer.startsWith("/")) throw new Error("JSON Pointer must be empty or start with /");
        for (const part of pointer.slice(1).split("/")) {
            if (/~(?![01])/u.test(part)) throw new Error("Invalid JSON Pointer escape");
            const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
            node = node.object ? node.items?.find(item => item.key.name === key)?.node : /^(0|[1-9]\d*)$/.test(key) ? node.items?.[Number(key)]?.node : undefined;
            if (!node) throw new Error(`Missing JSON Pointer component: ${key}`);
        }
    }
    return node;
}

function printJSON(node, level = 0) {
    if (node.raw !== undefined) return node.raw;
    const pad = "    ".repeat(level), child = pad + "    ";
    return `${node.object ? "{" : "["}\n${node.items.map(item => child + (item.key ? `${item.key.token}: ` : "") + printJSON(item.node, level + 1)).join(",\n")}\n${pad}${node.object ? "}" : "]"}`;
}

export function formatJSON(source, pointer = "") {
    return printJSON(selectJSON(parseJSON(source), pointer));
}

export function parseTDExcerpt(metadata) {
    const value = parseJSON(metadata).value;
    if (!value || Array.isArray(value) || typeof value.source !== "string"
        || Object.keys(value).sort().join(",") !== "retain,source"
        || !Array.isArray(value.retain) || !value.retain.length
        || value.retain.some(item => typeof item !== "string" || !item.startsWith("/"))
        || new Set(value.retain).size !== value.retain.length
        || !value.retain.includes("/@context")) throw new Error("TD excerpt requires a source, unique retained paths and complete /@context");
    sourceTarget(value.source);
    return value;
}

export function formatTDExcerpt(source, pointer, retain) {
    parseTDExcerpt(JSON.stringify({ source: "example.json", retain }));
    const root = selectJSON(parseJSON(source), pointer);
    const contexts = root.value?.["@context"];
    if (!root.object || typeof root.value.title !== "string" || !Array.isArray(contexts)
        || !contexts.includes("https://www.w3.org/2022/wot/td/v1.1")) throw new Error("TD excerpt source must be a complete TD or TM with the TD 1.1 context and title");
    if (JSON.stringify(root.value).includes('"onvif:')
        && !contexts.some(context => context === "https://example.org/wot/onvif/context/v0.1"
            || context?.onvif === "https://example.org/wot/onvif#"
            || context?.onvif?.["@id"] === "https://example.org/wot/onvif#")) throw new Error("TD excerpt requires the complete ONVIF context or prefix declaration");
    const selection = { children: new Map() };
    for (const pointer of retain) {
        selectJSON(root, pointer);
        let branch = selection;
        for (const part of pointer.slice(1).split("/")) {
            if (branch.all) throw new Error("Overlapping TD excerpt paths");
            const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
            if (!branch.children.has(key)) branch.children.set(key, { children: new Map() });
            branch = branch.children.get(key);
        }
        if (branch.children.size) throw new Error("Overlapping TD excerpt paths");
        branch.all = true;
    }
    function project(node, selected, level) {
        if (selected.all) return printJSON(node, level);
        const items = node.items.filter((item, index) => selected.children.has(node.object ? item.key.name : String(index)));
        if (!node.object && items.some((item, index) => item !== node.items[index])) throw new Error("TD excerpt arrays must retain a contiguous prefix or the complete array");
        const pad = "    ".repeat(level), child = pad + "    ";
        const lines = items.map((item, index) => child + (item.key ? `${item.key.token}: ` : "")
            + project(item.node, selected.children.get(node.object ? item.key.name : String(index)), level + 1));
        const omitted = items.length !== node.items.length ? `\n${child}// ...` : "";
        return `${node.object ? "{" : "["}\n${lines.join(",\n")}${omitted}\n${pad}${node.object ? "}" : "]"}`;
    }
    return project(root, selection, 0);
}

export function assertTDExcerpt(body, source, pointer, retain) {
    const expected = formatTDExcerpt(source, pointer, retain);
    if (body.replace(/\r\n/g, "\n").replace(/\n$/, "") !== expected) throw new Error("Source TD excerpt differs: visible values, retained paths or omission markers changed");
    // Only standalone omission lines are comments. URLs and string tokens are untouched.
    parseJSON(expected.split("\n").filter(line => !/^ *\/\/ \.\.\.$/.test(line)).join("\n"));
    return expected;
}

export async function readJSON(file) { return parseJSON(decodeUTF8(await readFile(file))).value; }
export function logicalPath(from, target) {
    if (!target || /^[a-z][a-z0-9+.-]*:|^[/\\]|\\|[\0-\x1f?#%]/i.test(target)) throw new Error(`Disallowed source path: ${target}`);
    const result = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
    if (result === ".." || result.startsWith("../")) throw new Error(`Source traversal: ${target}`);
    return result;
}
export function sourceTarget(value) {
    const parts = value.split("#");
    if (parts.length > 2 || !parts[0]) throw new Error(`Invalid source target: ${value}`);
    let pointer;
    try { pointer = decodeURIComponent(parts[1] ?? ""); }
    catch { throw new Error(`Invalid source pointer encoding: ${value}`); }
    if (pointer && !pointer.startsWith("/")) throw new Error(`Invalid JSON Pointer: ${value}`);
    return { target: parts[0], pointer };
}
export async function readApproved(root, name, manifest) {
    if (!Object.hasOwn(manifest, name)) throw new Error(`Unapproved input: ${name}`);
    if (logicalPath("spec.md", name) !== name) throw new Error(`Noncanonical input path: ${name}`);
    const base = await realpath(root), file = await realpath(path.join(root, ...name.split("/")));
    const rel = path.relative(base, file);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Input symlink escapes approved root");
    const bytes = await readFile(file);
    if (sha256(bytes) !== manifest[name]) throw new Error(`Input digest mismatch: ${name}`);
    return decodeUTF8(bytes);
}

export function bibliography(config) {
    const result = {};
    for (const [key, entry] of Object.entries(config.entries)) {
        if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(key) || !entry.title || !/^https:\/\//.test(entry.href)) throw new Error(`Invalid local bibliography: ${key}`);
        if (!["normative", "informative"].includes(config.classification[key])) throw new Error(`Missing reference classification: ${key}`);
        result[key] = entry;
    }
    for (const [alias, key] of Object.entries(config.aliases)) {
        if (!result[key]) throw new Error(`Missing bibliography alias target: ${key}`);
        const normalized = alias.toUpperCase();
        if (normalized === key) continue;
        if (result[normalized] && result[normalized].aliasOf !== key) throw new Error(`Ambiguous bibliography alias: ${alias}`);
        result[normalized] = { aliasOf: key };
    }
    for (const key of ["RFC2119", "RFC8174"]) if (!result[key]) throw new Error(`Required local reference missing: ${key}`);
    const hrefs = new Set(Object.values(config.entries).map(entry => entry.href));
    for (const [from, to] of Object.entries(config.hrefAliases ?? {})) {
        if (!/^https:\/\//.test(from) || !hrefs.has(to)) throw new Error(`Invalid bibliography representation alias: ${from}`);
    }
    return result;
}

export async function assemble({ source, read, refs, prototype = false, outputMap = {}, resolveLink, resolveSource = logicalPath }) {
    if (prototype) throw new Error("Prototype substitution is not supported by the repository publication pipeline");
    const diagnostics = [], regions = [], used = new Map(), loaded = new Map();
    async function load(name) {
        if (!loaded.has(name)) {
            const text = await read(name);
            if (typeof text !== "string") throw new Error(`Missing source text: ${name}`);
            loaded.set(name, text);
            used.set(name, sha256(Buffer.from(text)));
        }
        return loaded.get(name);
    }
    async function rewriteLinks(line, name) {
        const links = [];
        mapProse(line, part => {
            for (const match of part.matchAll(/\]\(([^()\s]+)\)/g)) {
                const target = match[1];
                if (!/^[a-z][a-z0-9+.-]*:|^#/i.test(target) || resolveLink && /^https?:/.test(target)) links.push(target);
            }
            return part;
        });
        const replacements = new Map();
        for (const target of links) {
            if (resolveLink) replacements.set(target, await resolveLink(name, target));
            else {
                const [file, fragment] = target.split("#");
                const resolved = logicalPath(name, file);
                if (file.endsWith(".md") && !outputMap[resolved]) throw new Error(`Unresolved publication file link: ${resolved}`);
                const destination = outputMap[resolved] ?? resolved;
                replacements.set(target, path.posix.relative(path.posix.dirname(outputMap[source] ?? source), destination) + (fragment ? "#" + fragment : ""));
            }
        }
        return mapProse(line, part => part.replace(/\]\(([^()\s]+)\)/g, (whole, target) => {
            if (!replacements.has(target)) return whole;
            const value = replacements.get(target);
            return typeof value === "string" ? `](${value})` : `](${value.href}) (canonical identity; [download local artifact](${value.artifactHref}))`;
        }));
    }
    async function expand(name, chain = []) {
        if (chain.includes(name)) throw new Error(`Include cycle: ${[...chain, name].join(" -> ")}`);
        if (chain.length >= 20) throw new Error("Include depth limit exceeded");
        let text = await load(name);
        text = text.replace(/\r\n/g, "\n");
        const lines = text.split("\n"), out = [];
        let fence = null, region = null;
        const regionNames = new Set();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i], f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (f) {
                if (!fence) {
                    if (f[2].trim() === "jsonc") throw new Error("JSONC requires an immediately preceding td-excerpt directive");
                    fence = f[1];
                } else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
                out.push(line); continue;
            }
            if (fence) { out.push(line); continue; }
            const excerpt = line.match(/^<!-- td-excerpt: (.+) -->$/);
            if (excerpt) {
                const metadata = parseTDExcerpt(excerpt[1]);
                const { target, pointer } = sourceTarget(metadata.source);
                const resolved = await resolveSource(name, target);
                if (lines[i + 1] !== "```jsonc") throw new Error("TD excerpt directive requires an adjacent jsonc fence");
                let end = i + 2;
                while (end < lines.length && lines[end] !== "```") end++;
                if (end === lines.length) throw new Error("Unclosed TD excerpt");
                const raw = assertTDExcerpt(lines.slice(i + 2, end).join("\n"), await load(resolved), pointer, metadata.retain);
                regions.push({ source: name, kind: "TD-EXCERPT", input: resolved, pointer, retain: metadata.retain, sha256: sha256(raw) });
                out.push(`\`\`\`jsonc\n${raw}\n\`\`\``);
                i = end;
                continue;
            }
            const marker = line.match(/^<!-- (BEGIN|END) (GENERATED|EXAMPLE): (.+?) -->$/);
            if (marker) {
                if (marker[1] === "BEGIN") {
                    if (region) throw new Error("Nested generated region");
                    const key = marker[2] + ":" + marker[3];
                    if (regionNames.has(key)) throw new Error("Duplicate source region");
                    regionNames.add(key);
                    region = { kind: marker[2], name: marker[3], start: i + 1, output: out.length };
                } else {
                    if (!region || region.kind !== marker[2] || region.name !== marker[3]) throw new Error("Unpaired generated region");
                    const raw = lines.slice(region.start, i).join("\n");
                    const record = { source: name, kind: region.kind, marker: region.name, sha256: sha256(raw) };
                    regions.push(record);
                    if (region.kind === "GENERATED") {
                        const visible = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
                        if (!visible || /^\s*(?:[*_> -]+\s*)?(?:TODO|TBD|GENERATE)\b|<!--\s*(?:TODO|GENERATE)\b|to be generated|placeholder (?:for|until)|(?:injection|placeholder) point/im.test(raw)) {
                            throw new Error(`Unassembled normative region: ${name}: ${region.name}`);
                        }
                        if (/\.json(?:ld)?(?:#|$)/.test(region.name)) {
                            const { target, pointer } = sourceTarget(region.name);
                            record.input = await resolveSource(name, target);
                            formatJSON(await load(record.input), pointer);
                        }
                    }
                    if (region.kind === "EXAMPLE") {
                        const { target, pointer } = sourceTarget(region.name);
                        const resolved = await resolveSource(name, target);
                        record.input = resolved;
                        const expected = formatJSON(await load(resolved), pointer);
                        const literal = raw.match(/^```json\n([\s\S]*?)\n```\s*$/);
                        if (!literal || formatJSON(literal[1]) !== expected) throw new Error(`Source example differs: ${resolved}${pointer ? "#" + pointer : ""}`);
                    }
                    region = null;
                }
            }
            const include = line.match(/^<!-- (include|example): ([^>]+?) -->$/i);
            if (include) {
                const { target, pointer: fragment } = sourceTarget(include[2]);
                const resolved = await resolveSource(name, target);
                if (include[1].toLowerCase() === "include") {
                    if (fragment) throw new Error("Markdown includes do not accept fragments");
                    out.push(await expand(resolved, [...chain, name]));
                } else {
                    const json = formatJSON(await load(resolved), fragment);
                    if (lines[i + 1]?.startsWith("```json")) {
                        let end = i + 2;
                        while (end < lines.length && lines[end] !== "```") end++;
                        if (end === lines.length) throw new Error(`Unclosed example fence: ${name}`);
                        const literal = lines.slice(i + 2, end).join("\n");
                        if (formatJSON(literal) !== json) throw new Error(`Source example differs: ${resolved}`);
                        i = end;
                    }
                    out.push(`\n\`\`\`json\n${json}\n\`\`\`\n`);
                }
                continue;
            }
            if (/^<!--\s*(?:include|example|td-excerpt|GENERATE)\b/i.test(line) && !/^<!--\s*(?:BEGIN|END)\b/.test(line)) throw new Error(`Unknown assembly directive: ${line}`);
            out.push(await rewriteLinks(line, name));
        }
        if (fence || region) throw new Error("Unclosed source fence or generated region");
        return out.join("\n");
    }
    let markdown = await expand(source);
    let metadata = {};
    const meta = markdown.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
    if (meta) {
        metadata = parseJSON(meta[1]).value;
        const allowed = new Set(["title", "shortName", "specStatus", "publicationStatus", "draftDate", "vocabularyRelease", "namespace", "contextIdentifier", "editors", "editorIdentityStatus", "authoritativeFormat", "intendedDestination", "generatedPublication", "rightsMetadata", "bibliography", "sourceVersion", "normativeManifest"]);
        for (const key of Object.keys(metadata)) if (!allowed.has(key)) throw new Error(`Unknown metadata: ${key}`);
        if (metadata.specStatus && metadata.specStatus !== "unofficial") throw new Error("Only independent unofficial status is allowed");
        markdown = markdown.slice(meta[0].length);
    }
    const localBiblio = bibliography(refs);
    const codes = [], diagrams = [], literals = [];
    function fenced(info, body) {
        const language = info.trim();
        if (!/^[a-zA-Z0-9_+-]*$/.test(language)) throw new Error(`Unsupported fence metadata: ${language}`);
        const json = ["json", "jsonld", "json-ld"].includes(language);
        const raw = json ? formatJSON(body) : body.replace(/\n$/, "");
        if (language === "mermaid") {
            const id = `diagram-${diagrams.length + 1}`;
            diagrams.push({ id, raw, renderInput: mermaidInput(raw) });
            literals.push(`<figure id="${id}" class="diagram"><div class="diagram-panel" tabindex="0" role="region" aria-label="Scrollable diagram ${diagrams.length}"><pre class="mermaid-source">${escapeHTML(raw)}</pre></div><figcaption>Diagram ${diagrams.length}: explanatory view of the surrounding normative text.</figcaption></figure>`);
        } else {
            const id = `source-code-${codes.length + 1}`;
            codes.push({ id, raw, language });
            const highlight = json ? "json" : language === "jsonc" ? "javascript" : ["text", "html", "xml", "javascript", "js", "css"].includes(language) ? language : "text";
            literals.push(`<pre id="${id}" tabindex="0" role="region" aria-label="Code example ${codes.length}"><code class="${highlight}">${escapeHTML(raw)}</code></pre>`);
        }
        return `\n<!-- PUBLICATION-LITERAL: ${literals.length - 1} -->\n`;
    }
    const lines = markdown.split("\n"), protectedLines = [];
    for (let index = 0; index < lines.length; index++) {
        const open = lines[index].match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
        if (!open) { protectedLines.push(lines[index]); continue; }
        const close = new RegExp("^ {0,3}" + open[2][0] + "{" + open[2].length + ",}[ \\t]*$");
        const body = [];
        const indent = new RegExp("^ {0," + open[1].length + "}");
        while (++index < lines.length && !close.test(lines[index])) body.push(lines[index].replace(indent, ""));
        if (index === lines.length) throw new Error("Unclosed source fence");
        protectedLines.push(fenced(open[3], body.join("\n") + "\n"));
    }
    markdown = protectedLines.join("\n");
    const titles = [...markdown.matchAll(/^# ([^\n]+)$/gm)];
    if (titles.length !== 1) throw new Error("Exactly one source H1 is required");
    const title = titles[0][1];
    if (metadata.title && metadata.title !== title) throw new Error("Metadata/title mismatch");
    markdown = markdown.replace(/^# [^\n]+(?:\n|$)/m, "");
    const footnotes = new Map(), definitions = [];
    markdown = mapProse(markdown, part => part.replace(/^\[\^([^\]]+)\]: ([^\n]*(?:\n(?: {4}|\t)[^\n]*)*)$/gm, (_, key, raw) => {
        if (footnotes.has(key)) throw new Error(`Duplicate footnote: ${key}`);
        if (refs.footnotes[key] !== raw) throw new Error(`Footnote source drift: ${key}`);
        footnotes.set(key, raw); return "";
    }));
    const referenceLinks = new Map();
    markdown = mapProse(markdown, part => part.replace(/^\[([^\]^]+)\]:\s*(https:\/\/\S+)\s*$/gm, (_, label, href) => {
        const key = label.toLowerCase();
        if (referenceLinks.has(key)) throw new Error(`Duplicate reference definition: ${label}`);
        referenceLinks.set(key, href);
        return "";
    }));
    const referenceRewrites = [];
    markdown = mapProse(markdown, part => part.replace(/\[([^\]\n]+)\]\[([^\]\n]+)\]/g, (_, label, reference) => {
        const href = referenceLinks.get(reference.toLowerCase());
        if (!href) throw new Error(`Missing document-wide reference: ${reference}`);
        const key = refs.aliases[reference] ?? refs.aliases[reference.toLowerCase()] ?? (refs.entries[reference.toUpperCase()] ? reference.toUpperCase() : undefined);
        const canonical = refs.hrefAliases?.[href] ?? href;
        if (!key || !refs.entries[key] || refs.entries[key].href !== canonical) throw new Error(`Uncurated reference definition: ${reference}`);
        if (canonical !== href && !referenceRewrites.some(item => item.sourceHref === href)) referenceRewrites.push({ reference, key, sourceHref: href, href: canonical });
        return `[${label}](${canonical}) [[${refs.classification[key] === "normative" ? "!" : ""}${key}]]`;
    }));
    // Fences have already been protected; code examples cannot become active HTML.
    mapProse(markdown, part => {
        if (/<(?:script|iframe|object|embed|base|link|style|form)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=\s*["']\s*(?:javascript|file):|\]\(\s*(?:javascript|file|vbscript):/i.test(part)) throw new Error("Active HTML is not allowed in Markdown input");
        return part;
    });
    markdown = mapProse(markdown, part => part.replace(/\[\^([^\]]+)\]/g, (_, key) => {
        if (!footnotes.has(key)) throw new Error(`Missing footnote: ${key}`);
        const id = slug(key), refid = `fnref-${id}-${definitions.filter(k => k === key).length + 1}`;
        definitions.push(key);
        return `<sup id="${refid}"><a href="#fn-${id}" aria-label="Source note ${escapeHTML(key)}">${escapeHTML(key)}</a></sup>`;
    }));
    if (footnotes.size) markdown += '\n\n## Source notes {#source-notes}\n\n' + [...footnotes].map(([key, raw]) => `<a id="fn-${slug(key)}"></a>\n\n**${key}.** ${raw} [Back to citation](#fnref-${slug(key)}-1)\n`).join("\n");
    const ids = new Set();
    for (const m of markdown.matchAll(/<[A-Za-z][^>]*\bid="([^"]+)"/g)) {
        if (ids.has(m[1])) throw new Error(`Duplicate explicit ID: ${m[1]}`);
        ids.add(m[1]);
    }
    let sectionCounter = 0;
    markdown = markdown.replace(/((?:<a id="[^"]+"><\/a>\n)+)(#{2,6}) ([^\n]+)/g, (_, anchors, hashes, heading) => {
        const first = anchors.match(/id="([^"]+)"/)[1];
        return `${anchors.replace(`<a id="${first}"></a>\n`, "")}${hashes} ${heading} {#${first}}\n`;
    });
    markdown = markdown.replace(/^(#{2,6}) ([^\n]+)$/gm, (_, hashes, text) => {
        if (/\{#[\w-]+\}$/.test(text)) return `${hashes} ${text}`;
        let id = `chapter-${slug(text) || ++sectionCounter}-${sha256(text).slice(0, 10)}`;
        if (ids.has(id)) throw new Error(`Ambiguous generated heading ID: ${id}`);
        ids.add(id);
        return `${hashes} ${text} {#${id}}`;
    });
    markdown = markdown.replace(/<a id="([^"]+)"><\/a>/g, '<span id="$1" class="source-alias"></span>');
    const finalIds = new Set();
    for (const m of markdown.matchAll(/<[A-Za-z][^>]*\bid="([^"]+)"|^#{2,6} .+ \{#([\w-]+)\}$/gm)) {
        const id = m[1] ?? m[2];
        if (finalIds.has(id)) throw new Error(`Duplicate final source ID: ${id}`);
        finalIds.add(id);
    }
    const citations = new Map();
    mapProse(markdown, part => {
        for (const m of part.matchAll(/\[\[(!?)([A-Za-z0-9.-]+)\]\]/g)) {
            const name = m[2].toUpperCase(), entry = localBiblio[name];
            if (!entry) throw new Error(`Unresolved citation: ${m[2]}`);
            const key = entry.aliasOf ?? name;
            if (m[1] && refs.classification[key] !== "normative") throw new Error(`Informative source used normatively: ${key}`);
            citations.set(key, (citations.get(key) ?? 0) + 1);
        }
        return part;
    });
    markdown = markdown.replace(/<!-- PUBLICATION-LITERAL: (\d+) -->/g, (_, index) => literals[Number(index)]);
    return { source, title, metadata, markdown, localBiblio, codes, diagrams, diagnostics, regions, inputs: Object.fromEntries(used), originalIds: [...finalIds], citations: Object.fromEntries(citations), referenceRewrites };
}
