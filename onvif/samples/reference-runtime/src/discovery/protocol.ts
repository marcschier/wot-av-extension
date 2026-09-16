import { createHash } from "node:crypto";
import { OnvifError } from "../binding/errors.js";
import { parseXml, serializeXml } from "../xml/parser.js";
import { childElements, equalQName, resolveQName, textContent, type QName, type XmlElement } from "../xml/types.js";
import { absoluteUri, assertJson, DEFAULT_BOUNDS, uriReference } from "./policy.js";
import type { AnnouncementKind, AppSequence, Bounds, DiscoveryEndpointReference, DiscoveryMatch, DiscoveryMessage } from "./types.js";

export const SOAP = "http://www.w3.org/2003/05/soap-envelope";
export const ADDRESSING = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
export const DISCOVERY = "http://schemas.xmlsoap.org/ws/2005/04/discovery";
export const DISCOVERY_TO = "urn:schemas-xmlsoap-org:ws:2005:04:discovery";
export const ANONYMOUS = `${ADDRESSING}/role/anonymous`;
export const RFC3986 = `${DISCOVERY}/rfc3986`;
export const DEVICE: Readonly<QName> = Object.freeze({ namespace: "http://www.onvif.org/ver10/device/wsdl", localName: "Device" });
export const LEGACY_DEVICE: Readonly<QName> = Object.freeze({ namespace: "http://www.onvif.org/ver10/network/wsdl", localName: "NetworkVideoTransmitter" });

function invalid(message: string): never { throw new OnvifError("InvalidXml", message); }
function one(parent: XmlElement, namespace: string, name: string, required = true): XmlElement | undefined {
    const nodes = childElements(parent).filter((node) => node.name.namespace === namespace && node.name.localName === name);
    if (nodes.length > 1 || (required && !nodes.length)) invalid(`Discovery requires a single ${name}`);
    return nodes[0];
}
function required(parent: XmlElement, namespace: string, name: string): XmlElement {
    return one(parent, namespace, name) ?? invalid(`Missing ${name}`);
}
function value(parent: XmlElement, namespace: string, name: string): string {
    return textContent(required(parent, namespace, name)).trim();
}
function uri(input: string): string {
    if (!absoluteUri(input)) invalid("Discovery URI must be absolute and bounded");
    return input;
}
function list(node: XmlElement | undefined, limit: number): string[] {
    const items = node ? textContent(node).trim().split(/\s+/u).filter(Boolean) : [];
    if (items.length > limit) throw new OnvifError("XmlLimit", "Discovery list exceeds its bound");
    return items;
}
function attribute(node: XmlElement, name: string): string | undefined {
    return node.attributes.find((item) => item.name.namespace === "" && item.name.localName === name)?.value;
}
export function protocolCounter(input: string): string {
    if (!/^\+?\d{1,64}$/u.test(input) || BigInt(input) > 4294967295n) invalid("Invalid unsigned discovery counter");
    return BigInt(input).toString();
}
function parseSequence(header: XmlElement, allowMissing: boolean): AppSequence | null {
    const node = one(header, DISCOVERY, "AppSequence", false);
    if (!node) {
        if (!allowMissing) invalid("Missing discovery AppSequence");
        return null;
    }
    const instanceId = attribute(node, "InstanceId");
    const messageNumber = attribute(node, "MessageNumber");
    if (instanceId === undefined || messageNumber === undefined) invalid("Incomplete discovery AppSequence");
    const sequenceId = attribute(node, "SequenceId");
    if (sequenceId !== undefined && !uriReference(sequenceId)) invalid("Invalid bounded SequenceId URI reference");
    return {
        instanceId: protocolCounter(instanceId), messageNumber: protocolCounter(messageNumber),
        sequenceId: sequenceId ?? null
    };
}

export function parseEndpointReference(node: XmlElement): DiscoveryEndpointReference {
    if (node.name.namespace !== ADDRESSING || node.name.localName !== "EndpointReference") invalid("Expected a 2004 EndpointReference");
    const address = uri(value(node, ADDRESSING, "Address"));
    const properties = one(node, ADDRESSING, "ReferenceProperties", false);
    const parameters = one(node, ADDRESSING, "ReferenceParameters", false);
    return {
        address,
        referenceProperties: properties ? childElements(properties) : [],
        referenceParameters: parameters ? childElements(parameters) : []
    };
}

function parseMatch(node: XmlElement, kind: AnnouncementKind, bounds: Readonly<Bounds>): DiscoveryMatch {
    const endpointReference = parseEndpointReference(required(node, ADDRESSING, "EndpointReference"));
    const typeNode = one(node, DISCOVERY, "Types", false);
    const types = list(typeNode, bounds.maxTypes).map((name) => resolveQName(name, typeNode?.namespaces ?? {}));
    const scopeNode = one(node, DISCOVERY, "Scopes", false);
    const scopes = list(scopeNode, bounds.maxScopes).map(uri);
    const metadata = one(node, DISCOVERY, "MetadataVersion", kind !== "Bye");
    return {
        endpointReference, types, scopes,
        scopeMatchBy: scopeNode ? attribute(scopeNode, "MatchBy") ?? null : null,
        xaddrs: list(one(node, DISCOVERY, "XAddrs", false), bounds.maxXAddrs).map(uri),
        metadataVersion: metadata ? protocolCounter(textContent(metadata).trim()) : null
    };
}

export function parseDiscovery(
    input: string | Uint8Array,
    bounds: Readonly<Bounds> = DEFAULT_BOUNDS,
    allowMissingSequence = false
): DiscoveryMessage {
    const root = parseXml(input, { maxBytes: bounds.maxDatagramBytes, maxDepth: 32, maxNodes: 2048, maxAttributes: 32 });
    if (root.name.namespace !== SOAP || root.name.localName !== "Envelope") invalid("Expected SOAP 1.2 discovery envelope");
    const header = required(root, SOAP, "Header");
    const body = required(root, SOAP, "Body");
    if (childElements(root).length !== 2 || childElements(body).length !== 1) invalid("Ambiguous SOAP discovery envelope");
    const action = value(header, ADDRESSING, "Action");
    const supported: AnnouncementKind[] = ["Hello", "Bye", "ProbeMatches", "ResolveMatches"];
    const kind = supported.find((item) => action === `${DISCOVERY}/${item}`);
    if (!kind) invalid("Only April 2005 discovery announcement and response actions are accepted");
    const content = required(body, DISCOVERY, kind);
    const messageId = uri(value(header, ADDRESSING, "MessageID"));
    const to = uri(value(header, ADDRESSING, "To"));
    const reply = one(header, ADDRESSING, "RelatesTo", false);
    const relatesTo = reply ? uri(textContent(reply).trim()) : null;
    let suppression = false;
    if (reply) {
        const relationship = attribute(reply, "RelationshipType");
        const qualified = relationship === undefined ? { namespace: ADDRESSING, localName: "Reply" }
            : resolveQName(relationship, reply.namespaces);
        suppression = equalQName(qualified, { namespace: DISCOVERY, localName: "Suppression" });
        if (!suppression && !equalQName(qualified, { namespace: ADDRESSING, localName: "Reply" })) invalid("Unsupported discovery response relationship");
    }
    const response = kind === "ProbeMatches" || kind === "ResolveMatches";
    let entries: XmlElement[];
    if (kind === "ProbeMatches") {
        entries = childElements(content).filter((node) => node.name.namespace === DISCOVERY && node.name.localName === "ProbeMatch");
        if (entries.length !== childElements(content).length) invalid("Unexpected ProbeMatches content");
    } else if (kind === "ResolveMatches") {
        entries = [required(content, DISCOVERY, "ResolveMatch")];
        if (childElements(content).length !== 1) invalid("Unexpected ResolveMatches content");
    } else entries = [content];
    if (entries.length > bounds.maxMatches) throw new OnvifError("XmlLimit", "Too many discovery matches");
    const matches = entries.map((entry) => parseMatch(entry, kind, bounds));
    const discoveryProxy = matches.some((match) => match.types.some((type) =>
        type.namespace === DISCOVERY && type.localName === "DiscoveryProxy"));
    if ((response && (!relatesTo || suppression || to !== ANONYMOUS))
        || (!response && to !== DISCOVERY_TO)
        || (!response && relatesTo !== null && !(kind === "Hello" && discoveryProxy && suppression))
        || (suppression && !(kind === "Hello" && discoveryProxy))) invalid("Discovery addressing does not match its message kind");
    if (discoveryProxy && matches.some((match) => !match.types.some((type) =>
        type.namespace === DISCOVERY && type.localName === "TargetService"))) invalid("DiscoveryProxy must declare its TargetService type");
    const message: DiscoveryMessage = {
        kind, messageId, relatesTo, to, sequence: parseSequence(header, allowMissingSequence), matches,
        discoveryProxy
    };
    assertJson(message, 20000, 64, Math.min(bounds.maxStoreBytes, bounds.maxDatagramBytes * 16));
    return message;
}

function normalizedEscapes(value: string): string {
    return value.replace(/%([0-9a-f]{2})/giu, (_, hex: string) => {
        const character = String.fromCharCode(Number.parseInt(hex, 16));
        return /^[a-z0-9._~-]$/iu.test(character) ? character : `%${hex.toUpperCase()}`;
    });
}
function scopeParts(input: string): { scheme: string; authority: string; path: string[]; validSegments: boolean } {
    uri(input);
    const parts = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/iu.exec(input);
    if (!parts) invalid("Malformed scope URI");
    const authority = normalizedEscapes(parts[2] ?? "");
    const normalizedPath = normalizedEscapes(parts[3] ?? "").replace(/^\//u, "");
    const path = normalizedPath === "" ? [] : normalizedPath.split("/");
    return {
        scheme: (parts[1] ?? "").toLowerCase(),
        authority: authority.toLowerCase(), path,
        validSegments: !path.includes(".") && !path.includes("..")
    };
}

export function scopeMatches(requested: string, advertised: string): boolean {
    const a = scopeParts(requested);
    const b = scopeParts(advertised);
    return a.validSegments && b.validSegments && a.scheme === b.scheme && a.authority === b.authority
        && a.path.length <= b.path.length && a.path.every((segment, index) => segment === b.path[index]);
}

export function matchesProbe(match: DiscoveryMatch, types: readonly QName[], scopes: readonly string[]): boolean {
    return types.every((type) => match.types.some((candidate) => equalQName(type, candidate)))
        && scopes.every((scope) => match.scopes.some((candidate) => scopeMatches(scope, candidate)));
}

function canonicalProperty(node: XmlElement): unknown {
    const text = node.children.filter((child) => child.kind === "text").map((child) => child.value).join("");
    const values = [text, ...node.attributes.map((attribute) => attribute.value)].join(" ");
    const namespaces = Object.entries(node.namespaces).filter(([prefix]) => prefix !== "" && values.includes(`${prefix}:`)).sort();
    return [
        node.name.namespace, node.name.localName,
        [...node.attributes].sort((a, b) => JSON.stringify(a.name) < JSON.stringify(b.name) ? -1 : JSON.stringify(a.name) > JSON.stringify(b.name) ? 1 : 0)
            .map((item) => [item.name.namespace, item.name.localName, item.value]),
        namespaces,
        node.children.flatMap((child): unknown[] => child.kind === "element" ? [canonicalProperty(child)]
            : child.kind === "text" ? [child.value] : [])
    ];
}

export function endpointIdentity(endpoint: DiscoveryEndpointReference): string {
    uri(endpoint.address);
    const key = JSON.stringify([endpoint.address, endpoint.referenceProperties.map(canonicalProperty)]);
    return `urn:wot-av:onvif:epr:${createHash("sha256").update(key).digest("hex")}`;
}

function escaped(input: string): string {
    return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function envelope(kind: string, messageId: string, content: string): string {
    return `<s:Envelope xmlns:s="${SOAP}" xmlns:a="${ADDRESSING}" xmlns:d="${DISCOVERY}" xmlns:tds="${DEVICE.namespace}" xmlns:dn="${LEGACY_DEVICE.namespace}"><s:Header><a:Action>${DISCOVERY}/${kind}</a:Action><a:MessageID>${escaped(uri(messageId))}</a:MessageID><a:ReplyTo><a:Address>${ANONYMOUS}</a:Address></a:ReplyTo><a:To>${DISCOVERY_TO}</a:To></s:Header><s:Body><d:${kind}>${content}</d:${kind}></s:Body></s:Envelope>`;
}

export function encodeProbe(messageId: string, type: "device" | "legacy" | "untyped", scopes: readonly string[] = []): Uint8Array {
    const types = type === "untyped" ? "" : `<d:Types>${type === "device" ? "tds:Device" : "dn:NetworkVideoTransmitter"}</d:Types>`;
    const scopeXml = scopes.length ? `<d:Scopes MatchBy="${RFC3986}">${scopes.map((scope) => escaped(uri(scope))).join(" ")}</d:Scopes>` : "";
    return Buffer.from(envelope("Probe", messageId, types + scopeXml));
}

export function encodeResolve(messageId: string, endpoint: DiscoveryEndpointReference): Uint8Array {
    const properties = endpoint.referenceProperties.length
        ? `<a:ReferenceProperties>${endpoint.referenceProperties.map((property) => serializeXml(property)).join("")}</a:ReferenceProperties>` : "";
    const parameters = endpoint.referenceParameters.length
        ? `<a:ReferenceParameters>${endpoint.referenceParameters.map((parameter) => serializeXml(parameter)).join("")}</a:ReferenceParameters>` : "";
    return Buffer.from(envelope("Resolve", messageId, `<a:EndpointReference><a:Address>${escaped(uri(endpoint.address))}</a:Address>${properties}${parameters}</a:EndpointReference>`));
}
