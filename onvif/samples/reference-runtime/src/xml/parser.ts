import { SaxesParser } from "saxes";
import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";
import { isNCName, isQName, XML_NS, XMLNS_NS, type XmlElement, type XmlNode } from "./types.js";
import { validateXmlIds } from "./identity.js";

export interface XmlLimits {
    maxBytes: number;
    maxDepth: number;
    maxNodes: number;
    maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: Readonly<XmlLimits> = Object.freeze({
    maxBytes: 1024 * 1024,
    maxDepth: 64,
    maxNodes: 20000,
    maxAttributes: 128
});

export function xmlLimits(options: Partial<XmlLimits> = {}): XmlLimits {
    if (!isRecord(options) || Object.keys(options).some((key) => !Object.hasOwn(DEFAULT_XML_LIMITS, key))) {
        throw new OnvifError("InvalidConfiguration", "Unknown XML limit option");
    }
    const limits = { ...DEFAULT_XML_LIMITS, ...options };
    positiveInteger(limits.maxBytes, "maxBytes", 16 * 1024 * 1024);
    positiveInteger(limits.maxDepth, "maxDepth", DEFAULT_XML_LIMITS.maxDepth);
    positiveInteger(limits.maxNodes, "maxNodes", DEFAULT_XML_LIMITS.maxNodes);
    positiveInteger(limits.maxAttributes, "maxAttributes", DEFAULT_XML_LIMITS.maxAttributes);
    return limits;
}

export function parseXml(input: string | Uint8Array, options: Partial<XmlLimits> = {}): XmlElement {
    const limits = xmlLimits(options);
    const bytes = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength;
    if (bytes > limits.maxBytes) throw new OnvifError("XmlLimit", "XML byte limit exceeded");
    let xml: string;
    if (typeof input === "string") {
        xml = input;
    } else {
        try {
            xml = new TextDecoder("utf-8", { fatal: true }).decode(input);
        } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            throw new OnvifError("InvalidXml", "XML is not valid UTF-8");
        }
    }
    const parser = new SaxesParser({ xmlns: true });
    const stack: XmlElement[] = [];
    let root: XmlElement | undefined;
    let count = 0;
    const append = (node: XmlNode): void => {
        if (++count > limits.maxNodes) throw new OnvifError("XmlLimit", "XML node limit exceeded");
        stack.at(-1)?.children.push(node);
    };
    parser.on("error", () => { throw new OnvifError("InvalidXml", "Malformed namespace-aware XML"); });
    parser.on("doctype", () => { throw new OnvifError("InvalidXml", "DTD and entity declarations are disabled"); });
    parser.on("xmldecl", (declaration) => {
        if (declaration.version !== "1.0"
            || (declaration.encoding !== undefined && declaration.encoding.toLowerCase() !== "utf-8")) {
            throw new OnvifError("InvalidXml", "Only XML 1.0 encoded as UTF-8 is supported");
        }
    });
    parser.on("opentag", (tag) => {
        if (stack.length >= limits.maxDepth) throw new OnvifError("XmlLimit", "XML depth limit exceeded");
        if (Object.keys(tag.attributes).length > limits.maxAttributes) {
            throw new OnvifError("XmlLimit", "XML attribute limit exceeded");
        }
        const node: XmlElement = {
            kind: "element",
            name: { namespace: tag.uri, localName: tag.local },
            prefix: tag.prefix,
            namespaces: { "": "", xml: XML_NS, ...stack.at(-1)?.namespaces, ...tag.ns },
            attributes: Object.values(tag.attributes).filter((attribute) => attribute.uri !== XMLNS_NS)
                .map((attribute) => ({
                    name: { namespace: attribute.uri, localName: attribute.local },
                    prefix: attribute.prefix,
                    value: attribute.value
                })),
            children: []
        };
        append(node);
        root ??= node;
        stack.push(node);
    });
    parser.on("closetag", () => { stack.pop(); });
    const addText = (value: string): void => {
        if (stack.length === 0) return;
        const previous = stack.at(-1)?.children.at(-1);
        if (previous?.kind === "text") previous.value += value;
        else append({ kind: "text", value });
    };
    parser.on("text", addText);
    parser.on("cdata", addText);
    parser.on("comment", (value) => { append({ kind: "comment", value }); });
    parser.on("processinginstruction", ({ target, body }) => {
        append({ kind: "processing-instruction", target, value: body });
    });
    parser.write(xml).close();
    if (root === undefined) throw new OnvifError("InvalidXml", "XML document has no root element");
    validateXmlIds(root);
    return root;
}

function escaped(value: string, attribute = false): string {
    if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(value)) {
        throw new OnvifError("InvalidXml", "XML contains an invalid character");
    }
    let result = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll("\r", "&#13;");
    if (attribute) result = result.replaceAll('"', "&quot;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;");
    return result;
}

export function serializeXml(root: XmlElement, options: Partial<XmlLimits> = {}): string {
    const limits = xmlLimits(options);
    assertXmlElement(root);
    validateXmlIds(root);
    let nodes = 0;
    let bytes = 0;
    const chunks: string[] = [];
    const emit = (value: string): void => {
        bytes += Buffer.byteLength(value, "utf8");
        if (bytes > limits.maxBytes) throw new OnvifError("XmlLimit", "XML byte limit exceeded");
        chunks.push(value);
    };
    const visit = (node: XmlNode, inherited: Record<string, string>, depth: number): void => {
        if (++nodes > limits.maxNodes) throw new OnvifError("XmlLimit", "XML node limit exceeded");
        if (node.kind === "text") { emit(escaped(node.value)); return; }
        if (node.kind === "comment") {
            if (node.value.includes("--") || node.value.endsWith("-")) {
                throw new OnvifError("InvalidXml", "Invalid XML comment");
            }
            escaped(node.value);
            emit(`<!--${node.value}-->`);
            return;
        }
        if (node.kind === "processing-instruction") {
            if (!isNCName(node.target) || node.target.toLowerCase() === "xml" || node.value.includes("?>")) {
                throw new OnvifError("InvalidXml", "Invalid XML processing instruction");
            }
            escaped(node.value);
            emit(`<?${node.target}${node.value ? ` ${node.value}` : ""}?>`);
            return;
        }
        if (depth > limits.maxDepth) throw new OnvifError("XmlLimit", "XML depth limit exceeded");
        if (!isQName(node.name)) throw new OnvifError("InvalidXml", "Invalid element QName");
        const namespaces = { ...inherited, ...node.namespaces };
        const declarations = new Map<string, string>();
        const bind = (prefix: string, namespace: string): void => {
            if ((prefix && !isNCName(prefix)) || prefix === "xmlns" || namespace === XMLNS_NS
                || (prefix === "xml") !== (namespace === XML_NS)
                || (prefix !== "" && namespace === "")) {
                throw new OnvifError("InvalidXml", "Invalid XML namespace binding");
            }
            namespaces[prefix] = namespace;
            if (namespace !== (inherited[prefix] ?? (prefix === "" ? "" : undefined))) {
                declarations.set(prefix, namespace);
            }
        };
        for (const [prefix, namespace] of Object.entries(node.namespaces)) bind(prefix, namespace);
        const prefixFor = (namespace: string, preferred: string | undefined, attribute: boolean): string => {
            if (!namespace) {
                if (!attribute) bind("", "");
                return "";
            }
            if (namespace === XML_NS) return "xml";
            if (preferred !== undefined && (!attribute || preferred !== "")) {
                if (node.namespaces[preferred] !== undefined && node.namespaces[preferred] !== namespace) {
                    throw new OnvifError("InvalidXml", "QName prefix conflicts with retained namespace context");
                }
                bind(preferred, namespace);
                return preferred;
            }
            if (!attribute && node.namespaces[""] === undefined) { bind("", namespace); return ""; }
            const found = Object.keys(namespaces).find((prefix) => (!attribute || prefix !== "")
                && namespaces[prefix] === namespace);
            if (found !== undefined) return found;
            let index = 0;
            while (namespaces[`n${index}`] !== undefined) index++;
            const prefix = `n${index}`;
            bind(prefix, namespace);
            return prefix;
        };
        const name = (prefix: string, localName: string): string => prefix ? `${prefix}:${localName}` : localName;
        const tag = name(prefixFor(node.name.namespace, node.prefix, false), node.name.localName);
        const seen = new Set<string>();
        const attributes = node.attributes.map((attribute) => {
            if (!isQName(attribute.name) || typeof attribute.value !== "string") {
                throw new OnvifError("InvalidXml", "Invalid XML attribute");
            }
            const key = JSON.stringify(attribute.name);
            if (seen.has(key)) throw new OnvifError("InvalidXml", "Duplicate expanded attribute name");
            seen.add(key);
            return ` ${name(prefixFor(attribute.name.namespace, attribute.prefix, true), attribute.name.localName)}="${escaped(attribute.value, true)}"`;
        });
        if (attributes.length + declarations.size > limits.maxAttributes) {
            throw new OnvifError("XmlLimit", "XML attribute limit exceeded");
        }
        emit(`<${tag}`);
        for (const [prefix, namespace] of declarations) {
            emit(` xmlns${prefix ? `:${prefix}` : ""}="${escaped(namespace, true)}"`);
        }
        for (const attribute of attributes) emit(attribute);
        if (node.children.length === 0) { emit("/>"); return; }
        emit(">");
        for (const child of node.children) visit(child, namespaces, depth + 1);
        emit(`</${tag}>`);
    };
    visit(root, { xml: XML_NS }, 1);
    return chunks.join("");
}

export function assertXmlElement(value: unknown, depth = 0): asserts value is XmlElement {
    if (depth >= DEFAULT_XML_LIMITS.maxDepth) throw new OnvifError("XmlLimit", "XML depth limit exceeded");
    if (!isRecord(value) || value.kind !== "element" || !isQName(value.name)
        || !isRecord(value.namespaces) || !Array.isArray(value.attributes) || !Array.isArray(value.children)
        || (value.prefix !== undefined && value.prefix !== "" && !isNCName(value.prefix))) {
        throw new OnvifError("InvalidValue", "An opaque XML element requires its complete namespace-aware representation");
    }
    for (const namespace of Object.values(value.namespaces)) {
        if (typeof namespace !== "string") throw new OnvifError("InvalidValue", "Invalid namespace context");
    }
    for (const attribute of value.attributes) {
        if (!isRecord(attribute) || !isQName(attribute.name) || typeof attribute.value !== "string"
            || (attribute.prefix !== undefined && attribute.prefix !== "" && !isNCName(attribute.prefix))) {
            throw new OnvifError("InvalidValue", "Invalid opaque attribute");
        }
    }
    for (const child of value.children) {
        if (!isRecord(child)) throw new OnvifError("InvalidValue", "Invalid opaque XML content");
        if (child.kind === "element") assertXmlElement(child, depth + 1);
        else if (!["text", "comment", "processing-instruction"].includes(String(child.kind))
            || typeof child.value !== "string"
            || (child.kind === "processing-instruction" && !isNCName(child.target))) {
            throw new OnvifError("InvalidValue", "Invalid opaque XML content");
        }
    }
}
