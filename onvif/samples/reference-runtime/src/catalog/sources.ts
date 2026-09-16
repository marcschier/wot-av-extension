import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SaxesParser } from "saxes";
import { isRecord, OnvifError } from "../binding/errors.js";
import { isNCName, resolveQName, XML_NS, XMLNS_NS, type QName } from "../xml/types.js";

export const XSD = "http://www.w3.org/2001/XMLSchema";
export const WSDL = "http://schemas.xmlsoap.org/wsdl/";
export const SOAP12 = "http://schemas.xmlsoap.org/wsdl/soap12/";
export const WSAW = "http://www.w3.org/2006/05/addressing/wsdl";

export interface SourceImport {
    readonly kind: string;
    readonly namespace: string | null;
    readonly location: string;
    readonly declaringNamespace: string | null;
    readonly sourceId: string;
}

export interface LockedSource {
    readonly id: string;
    readonly kind: string;
    readonly url: string;
    readonly relativePath: string;
    readonly storage: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly targetNamespace?: string | null;
    readonly schemaVersions?: readonly string[];
    readonly imports?: readonly SourceImport[];
}

export interface SourceLock {
    readonly schemaVersion: number;
    readonly baseline: Readonly<Record<string, unknown>>;
    readonly sources: readonly LockedSource[];
    readonly sourceGroups: Readonly<Record<string, readonly string[]>>;
}

export interface SourceNode {
    readonly name: QName;
    readonly attributes: Readonly<Record<string, string>>;
    readonly namespaces: Readonly<Record<string, string>>;
    readonly children: SourceNode[];
    text: string;
    readonly sourceId: string;
    readonly line: number;
    readonly ordinal: number;
}

export interface SourceDocument {
    readonly source: LockedSource;
    readonly root: SourceNode;
}

export interface LockedClosure {
    readonly lock: SourceLock;
    readonly lockDigest: string;
    readonly entryPoints: readonly string[];
    readonly documents: ReadonlyMap<string, SourceDocument>;
    readonly importCount: number;
}

export interface LoadSourcesOptions {
    readonly root: string;
    readonly lockPath?: string;
    readonly cache?: string;
    readonly includeAddOns?: boolean;
    readonly sourceIds?: readonly string[];
}

export function qkey(name: QName): string {
    return `{${name.namespace}}${name.localName}`;
}

export function attr(node: SourceNode, name: string, namespace = ""): string | undefined {
    return node.attributes[namespace ? `{${namespace}}${name}` : name];
}

export function children(node: SourceNode, namespace: string, localName?: string): SourceNode[] {
    return node.children.filter((child) => child.name.namespace === namespace
        && (localName === undefined || child.name.localName === localName));
}

export function child(node: SourceNode, namespace: string, localName: string): SourceNode | undefined {
    const matches = children(node, namespace, localName);
    if (matches.length > 1) sourceError(node, `Expected at most one ${localName}`);
    return matches[0];
}

export function requiredAttr(node: SourceNode, name: string): string {
    const value = attr(node, name);
    if (value === undefined || value === "") sourceError(node, `Missing ${name}`);
    return value;
}

export function sourceQName(node: SourceNode, name: string): QName {
    return resolveQName(requiredAttr(node, name), node.namespaces);
}

export function sourceError(node: Pick<SourceNode, "sourceId" | "line">, message: string): never {
    throw new OnvifError("InvalidRegistry", `${node.sourceId}:${node.line}: ${message}`);
}

export function parseSource(bytes: Uint8Array, sourceId: string): SourceNode {
    if (bytes.byteLength > 2 * 1024 * 1024) sourceError({ sourceId, line: 1 }, "Source exceeds 2 MiB");
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return sourceError({ sourceId, line: 1 }, "Source is not UTF-8");
    }
    const parser = new SaxesParser({ xmlns: true, position: true });
    const stack: SourceNode[] = [];
    let root: SourceNode | undefined;
    let count = 0;
    parser.on("error", (error) => sourceError({ sourceId, line: parser.line }, error.message));
    parser.on("doctype", () => sourceError({ sourceId, line: parser.line }, "DTD/entity declarations are forbidden"));
    parser.on("xmldecl", (declaration) => {
        if (declaration.version !== "1.0" || (declaration.encoding !== undefined
            && declaration.encoding.toLowerCase() !== "utf-8")) {
            sourceError({ sourceId, line: parser.line }, "Only UTF-8 XML 1.0 is supported");
        }
    });
    parser.on("opentag", (tag) => {
        if (++count > 100000 || stack.length >= 64 || Object.keys(tag.attributes).length > 128) {
            sourceError({ sourceId, line: parser.line }, "Source XML structural bound exceeded");
        }
        const attributes: Record<string, string> = Object.create(null);
        for (const attribute of Object.values(tag.attributes)) {
            if (attribute.uri !== XMLNS_NS) {
                attributes[attribute.uri ? `{${attribute.uri}}${attribute.local}` : attribute.local] = attribute.value;
            }
        }
        const node: SourceNode = {
            name: { namespace: tag.uri, localName: tag.local },
            attributes,
            namespaces: { "": "", xml: XML_NS, ...stack.at(-1)?.namespaces, ...tag.ns },
            children: [],
            text: "",
            sourceId,
            line: parser.line,
            ordinal: count
        };
        stack.at(-1)?.children.push(node);
        root ??= node;
        stack.push(node);
    });
    parser.on("closetag", () => { stack.pop(); });
    const appendText = (value: string): void => {
        const node = stack.at(-1);
        if (node !== undefined) node.text += value;
    };
    parser.on("text", appendText);
    parser.on("cdata", appendText);
    parser.write(text).close();
    if (root === undefined) sourceError({ sourceId, line: 1 }, "Missing document element");
    return root;
}

export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    if (value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
    throw new OnvifError("InvalidRegistry", "Only finite JSON data is canonical");
}

export function digest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function readLock(path: string): { lock: SourceLock; digest: string } {
    const bytes = readFileSync(path);
    if (bytes.byteLength > 2 * 1024 * 1024) throw new OnvifError("InvalidRegistry", "Source lock exceeds 2 MiB");
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.baseline)
        || !Array.isArray(value.sources) || value.sources.length > 128 || !isRecord(value.sourceGroups)) {
        throw new OnvifError("InvalidRegistry", "Invalid source lock envelope");
    }
    const ids = new Set<string>();
    const sources: LockedSource[] = value.sources.map((source: unknown) => {
        if (!isRecord(source) || typeof source.id !== "string" || ids.has(source.id)
            || typeof source.kind !== "string" || typeof source.url !== "string"
            || typeof source.relativePath !== "string" || !["vendored", "fetch-only", "reference-only"].includes(String(source.storage))
            || typeof source.storage !== "string" || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.sha256)
            || typeof source.bytes !== "number" || !Number.isSafeInteger(source.bytes) || source.bytes < 0) {
            throw new OnvifError("InvalidRegistry", "Invalid or duplicate locked source");
        }
        ids.add(source.id);
        const imports: SourceImport[] = [];
        if (source.imports !== undefined) {
            if (!Array.isArray(source.imports)) throw new OnvifError("InvalidRegistry", "Invalid locked imports");
            for (const edge of source.imports) {
                if (!isRecord(edge) || typeof edge.kind !== "string" || typeof edge.location !== "string"
                    || typeof edge.sourceId !== "string" || (edge.namespace !== null && typeof edge.namespace !== "string")
                    || (edge.declaringNamespace !== null && typeof edge.declaringNamespace !== "string")) {
                    throw new OnvifError("InvalidRegistry", "Invalid locked import");
                }
                imports.push({ kind: edge.kind, namespace: edge.namespace, location: edge.location,
                    declaringNamespace: edge.declaringNamespace, sourceId: edge.sourceId });
            }
        }
        if (source.targetNamespace !== undefined && source.targetNamespace !== null && typeof source.targetNamespace !== "string") {
            throw new OnvifError("InvalidRegistry", "Invalid locked target namespace");
        }
        if (source.schemaVersions !== undefined && (!Array.isArray(source.schemaVersions)
            || source.schemaVersions.some((version: unknown) => typeof version !== "string"))) {
            throw new OnvifError("InvalidRegistry", "Invalid locked schema versions");
        }
        return { id: source.id, kind: source.kind, url: source.url, relativePath: source.relativePath,
            storage: source.storage, sha256: source.sha256, bytes: source.bytes, imports,
            ...(source.targetNamespace === undefined ? {} : { targetNamespace: source.targetNamespace }),
            ...(source.schemaVersions === undefined ? {} : { schemaVersions: source.schemaVersions as string[] }) };
    });
    const groups: Record<string, readonly string[]> = Object.create(null);
    for (const [name, members] of Object.entries(value.sourceGroups)) {
        if (!Array.isArray(members) || members.some((id: unknown) => typeof id !== "string" || !ids.has(id))) {
            throw new OnvifError("InvalidRegistry", `Unresolved source group ${name}`);
        }
        groups[name] = members;
    }
    return { lock: { schemaVersion: 1, baseline: value.baseline, sources, sourceGroups: groups },
        digest: createHash("sha256").update(bytes).digest("hex") };
}

function lockedPath(base: string, resource: string): string {
    const parts = resource.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\u0000]/u.test(part))) {
        throw new OnvifError("InvalidRegistry", "Unsafe locked resource path");
    }
    const resolved = realpathSync(join(base, ...parts));
    const parent = realpathSync(base);
    const within = relative(parent, resolved);
    if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) {
        throw new OnvifError("InvalidRegistry", "Locked resource escapes its root");
    }
    return resolved;
}

function actualImports(root: SourceNode): Omit<SourceImport, "sourceId">[] {
    const edges: Omit<SourceImport, "sourceId">[] = [];
    const visit = (node: SourceNode, declaringNamespace: string | null): void => {
        if ((node.name.namespace === XSD && node.name.localName === "schema")
            || (node.name.namespace === WSDL && node.name.localName === "definitions")) {
            declaringNamespace = attr(node, "targetNamespace") ?? null;
        }
        if ((node.name.namespace === XSD && ["import", "include", "redefine"].includes(node.name.localName))
            || (node.name.namespace === WSDL && node.name.localName === "import")) {
            const location = requiredAttr(node, node.name.namespace === WSDL ? "location" : "schemaLocation");
            edges.push({ kind: `${node.name.namespace === WSDL ? "wsdl" : "xsd"}:${node.name.localName}`,
                namespace: attr(node, "namespace") ?? null, location, declaringNamespace });
        }
        for (const next of node.children) visit(next, declaringNamespace);
    };
    visit(root, null);
    return edges;
}

export function loadLockedSources(options: LoadSourcesOptions): LockedClosure {
    const root = resolve(options.root);
    const loaded = readLock(options.lockPath ?? join(root, "onvif", "sources.lock.json"));
    const { lock } = loaded;
    const entries = options.sourceIds ?? [
        ...(lock.sourceGroups.canonicalServiceEntryPoints ?? []),
        ...(options.includeAddOns === false ? [] : lock.sourceGroups.separateConditionalOrAddOnServices ?? []),
        ...(lock.sourceGroups.supportingOnvifSchemas ?? [])
    ];
    if (entries.length === 0) throw new OnvifError("InvalidRegistry", "No locked entry points selected");
    const byId = new Map(lock.sources.map((source) => [source.id, source]));
    const documents = new Map<string, SourceDocument>();
    let importCount = 0;
    const visit = (id: string): void => {
        if (documents.has(id)) return;
        const source = byId.get(id);
        if (source === undefined) throw new OnvifError("InvalidRegistry", `Unresolved source ID ${id}`);
        if (!["wsdl", "xsd", "xml"].includes(source.kind)) {
            throw new OnvifError("InvalidRegistry", `Source ${id} is not a compilable XML input`);
        }
        const base = source.storage === "vendored" ? join(root, "onvif", "support", "upstream", "onvif") : options.cache;
        if (base === undefined) throw new OnvifError("InvalidRegistry",
            `Missing explicit source cache for ${id}; prepare it with the phase-1 source tool, never fetch during generation`);
        const bytes = readFileSync(lockedPath(base, source.relativePath));
        if (bytes.byteLength !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
            throw new OnvifError("InvalidRegistry", `Locked bytes/hash mismatch for ${id}`);
        }
        const xml = parseSource(bytes, id);
        const expectedRoot = source.kind === "wsdl" ? { namespace: WSDL, localName: "definitions" }
            : source.kind === "xsd" ? { namespace: XSD, localName: "schema" } : undefined;
        if (expectedRoot !== undefined && qkey(xml.name) !== qkey(expectedRoot)) sourceError(xml, "Wrong source document kind");
        if ((attr(xml, "targetNamespace") ?? null) !== (source.targetNamespace ?? null)) sourceError(xml, "Target namespace differs from lock");
        const actual = actualImports(xml);
        const pinned = source.imports ?? [];
        if (actual.length !== pinned.length || actual.some((edge, index) => {
            const locked = pinned[index];
            return locked === undefined || canonicalJson(edge) !== canonicalJson({
                kind: locked.kind, namespace: locked.namespace, location: locked.location, declaringNamespace: locked.declaringNamespace
            });
        })) sourceError(xml, "Actual import declarations differ from the ordered locked closure");
        documents.set(id, { source, root: xml });
        importCount += actual.length;
        for (const edge of pinned) {
            const target = byId.get(edge.sourceId);
            if (target === undefined || (edge.namespace !== null && edge.namespace !== target.targetNamespace)
                || (edge.kind.startsWith("xsd:") && target.kind !== "xsd")
                || (edge.kind.startsWith("wsdl:") && target.kind !== "wsdl")
                || (edge.kind === "xsd:include" && target.targetNamespace !== null && target.targetNamespace !== edge.declaringNamespace)) {
                sourceError(xml, `Import ${edge.location} does not resolve to its locked namespace/kind`);
            }
            visit(edge.sourceId);
        }
    };
    for (const id of [...new Set(entries)].sort()) visit(id);
    return { lock, lockDigest: loaded.digest, entryPoints: [...new Set(entries)].sort(), documents, importCount };
}

export function declaredName(node: SourceNode, namespace: string): QName {
    const name = requiredAttr(node, "name");
    if (!isNCName(name)) sourceError(node, "Declared name is not an NCName");
    return { namespace, localName: name };
}
