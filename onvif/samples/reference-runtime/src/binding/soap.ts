import { randomUUID } from "node:crypto";
import { OnvifError } from "./errors.js";
import { operationReference, type OperationDescriptor, type OperationReference } from "./registry.js";
import type { AddressingNamespace, RequestAddressing, SoapHeaderMap } from "./request.js";
import { assertXmlElement, parseXml, serializeXml, type XmlLimits } from "../xml/parser.js";
import { childElements, EMPTY_XML_REGISTRY, equalQName, resolveQName, textContent, XML_NS,
    type CanonicalValue, type QName, type XmlElement, type XmlRegistry } from "../xml/types.js";
import { decodeElement } from "../xml/mapper.js";

export const SOAP_NS = "http://www.w3.org/2003/05/soap-envelope";
export const WSA_NS = "http://www.w3.org/2005/08/addressing";
export const WSA_2004_NS = "http://schemas.xmlsoap.org/ws/2004/08/addressing";

export interface EndpointReference {
    readonly address: string;
    readonly referenceParameters: readonly XmlElement[];
    readonly referenceProperties: readonly XmlElement[];
    readonly addressingNamespace: AddressingNamespace;
    readonly xml: XmlElement;
}
export interface NativeFault {
    readonly code: QName;
    readonly subcodes: readonly QName[];
    readonly reasons: readonly { language: string; text: string }[];
    readonly detail?: XmlElement;
    readonly node?: string;
    readonly role?: string;
    readonly typedDetails?: readonly {
        readonly name: QName;
        readonly faultName?: string;
        readonly value: CanonicalValue;
    }[];
}

export class SoapFaultError extends OnvifError {
    readonly operation: OperationReference;
    constructor(readonly fault: NativeFault, operation: OperationDescriptor, readonly status: number) {
        super("SoapFault", "Native SOAP fault", equalQName(fault.code, { namespace: SOAP_NS, localName: "Sender" }) ? "rejected" : "unknown");
        this.name = "SoapFaultError";
        this.operation = operationReference(operation);
    }
}

function one(parent: XmlElement, namespace: string, localName: string, required = true): XmlElement | undefined {
    const values = childElements(parent).filter((child) => equalQName(child.name, { namespace, localName }));
    if (values.length > 1 || (required && values.length !== 1)) {
        throw new OnvifError("InvalidXml", "Missing or duplicate required SOAP/EPR element", "unknown");
    }
    return values[0];
}

function required(parent: XmlElement, namespace: string, localName: string): XmlElement {
    const result = one(parent, namespace, localName);
    if (result === undefined) throw new OnvifError("InvalidXml", "Missing SOAP/EPR element", "unknown");
    return result;
}

export function readEndpointReference(value: XmlElement): EndpointReference {
    assertXmlElement(value);
    const addresses = childElements(value).filter((child) => child.name.localName === "Address"
        && [WSA_NS, WSA_2004_NS].includes(child.name.namespace));
    const addressNode = addresses[0];
    if (addresses.length !== 1 || addressNode === undefined) throw new OnvifError("InvalidValue", "EPR requires exactly one qualified Address");
    const namespace = addressNode.name.namespace === WSA_NS ? WSA_NS : WSA_2004_NS;
    const address = textContent(addressNode).trim();
    if (!address) throw new OnvifError("InvalidValue", "Endpoint reference has an empty Address");
    const parameters = one(value, namespace, "ReferenceParameters", false);
    const properties = one(value, namespace, "ReferenceProperties", false);
    if (namespace === WSA_NS && properties !== undefined) throw new OnvifError("InvalidValue", "WS-Addressing 2005 has no ReferenceProperties");
    for (const container of [parameters, properties]) {
        if (container?.children.some((child) => child.kind === "text" && child.value.trim())) {
            throw new OnvifError("InvalidValue", "EPR reference headers must contain XML elements");
        }
    }
    if (childElements(value).some((child) => ["ReferenceParameters", "ReferenceProperties", "Address"].includes(child.name.localName)
        && [WSA_NS, WSA_2004_NS].includes(child.name.namespace) && child.name.namespace !== namespace)) {
        throw new OnvifError("InvalidValue", "EPR mixes WS-Addressing versions");
    }
    return Object.freeze({
        address,
        referenceParameters: Object.freeze(parameters === undefined ? [] : structuredClone(childElements(parameters))),
        referenceProperties: Object.freeze(properties === undefined ? [] : structuredClone(childElements(properties))),
        addressingNamespace: namespace,
        xml: structuredClone(value)
    });
}

function assertHeader(parameter: XmlElement): void {
    assertXmlElement(parameter);
    if ([SOAP_NS, WSA_NS, WSA_2004_NS,
        "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"].includes(parameter.name.namespace)) {
        throw new OnvifError("InvalidSecurity", "A custom/reference header cannot replace SOAP, addressing or security headers");
    }
}

function referenceHeader(parameter: XmlElement, namespace: AddressingNamespace): XmlElement {
    assertHeader(parameter);
    const node = structuredClone(parameter);
    if (namespace === WSA_2004_NS) return node;
    node.attributes = node.attributes.filter((attribute) => !equalQName(attribute.name, { namespace: WSA_NS, localName: "IsReferenceParameter" }));
    const existing = Object.keys(node.namespaces).find((prefix) => prefix !== "" && node.namespaces[prefix] === WSA_NS);
    let prefix = existing ?? "wsa";
    while (node.namespaces[prefix] !== undefined && node.namespaces[prefix] !== WSA_NS) prefix += "Ref";
    node.namespaces[prefix] = WSA_NS;
    node.attributes.push({ name: { namespace: WSA_NS, localName: "IsReferenceParameter" }, prefix, value: "true" });
    return node;
}

function node(namespace: string, prefix: string, localName: string, children: XmlElement[] = []): XmlElement {
    return { kind: "element", name: { namespace, localName }, prefix, namespaces: {}, attributes: [], children };
}

export function soapEnvelope(
    operation: OperationDescriptor,
    target: URL,
    payload: XmlElement,
    options: { usernameToken?: string; referenceParameters?: readonly XmlElement[]; addressing?: RequestAddressing;
        headers?: SoapHeaderMap; limits?: Partial<XmlLimits> } = {}
): Buffer {
    const namespace = options.addressing?.namespace ?? WSA_NS;
    if (![WSA_NS, WSA_2004_NS].includes(namespace)) throw new OnvifError("UnsupportedCapability", "Unqualified WS-Addressing namespace");
    if (namespace === WSA_NS && options.addressing?.referenceProperties?.length) {
        throw new OnvifError("InvalidValue", "ReferenceProperties require WS-Addressing 2004");
    }
    const addressing = (localName: string, value: string): XmlElement => ({
        ...node(namespace, "wsa", localName), children: [{ kind: "text", value }]
    });
    const action = addressing("Action", operation.addressingAction);
    action.attributes.push({ name: { namespace: SOAP_NS, localName: "mustUnderstand" }, prefix: "s", value: "true" });
    const headers = [
        action, addressing("To", options.addressing?.to ?? target.href), addressing("MessageID", `urn:uuid:${randomUUID()}`),
        node(namespace, "wsa", "ReplyTo", [addressing("Address", namespace === WSA_2004_NS
            ? `${namespace}/role/anonymous` : `${namespace}/${operation.response === null ? "none" : "anonymous"}`)]),
        ...(options.addressing?.referenceProperties ?? []).map((parameter) => referenceHeader(parameter, WSA_2004_NS)),
        ...(options.addressing?.referenceParameters ?? options.referenceParameters ?? []).map((parameter) => referenceHeader(parameter, namespace))
    ];
    for (const [key, header] of Object.entries(options.headers ?? {})) {
        assertHeader(header);
        if (key !== `{${header.name.namespace}}${header.name.localName}`) throw new OnvifError("InvalidValue", "SOAP header map key must be its expanded QName");
        if (headers.some((existing) => equalQName(existing.name, header.name))) throw new OnvifError("InvalidValue", "Duplicate custom/reference SOAP header");
        headers.push(structuredClone(header));
    }
    if (options.usernameToken !== undefined) {
        const security = parseXml(options.usernameToken, options.limits);
        security.attributes.push({ name: { namespace: SOAP_NS, localName: "mustUnderstand" }, prefix: "s", value: "true" });
        headers.push(security);
    }
    const envelope = node(SOAP_NS, "s", "Envelope", [
        node(SOAP_NS, "s", "Header", headers), node(SOAP_NS, "s", "Body", [payload])
    ]);
    envelope.namespaces = { s: SOAP_NS, wsa: namespace };
    return Buffer.from(serializeXml(envelope, options.limits), "utf8");
}

function parseFault(root: XmlElement): NativeFault {
    const codeNode = required(root, SOAP_NS, "Code");
    const valueNode = required(codeNode, SOAP_NS, "Value");
    const code = resolveQName(textContent(valueNode), valueNode.namespaces);
    const subcodes: QName[] = [];
    let current = one(codeNode, SOAP_NS, "Subcode", false);
    while (current !== undefined) {
        const value = required(current, SOAP_NS, "Value");
        subcodes.push(resolveQName(textContent(value), value.namespaces));
        current = one(current, SOAP_NS, "Subcode", false);
    }
    const reason = required(root, SOAP_NS, "Reason");
    const reasons = childElements(reason).map((text) => {
        if (!equalQName(text.name, { namespace: SOAP_NS, localName: "Text" })) {
            throw new OnvifError("InvalidXml", "Unexpected SOAP fault reason", "unknown");
        }
        const language = text.attributes.find((attribute) => equalQName(attribute.name, { namespace: XML_NS, localName: "lang" }))?.value;
        if (!language) throw new OnvifError("InvalidXml", "SOAP fault Reason requires xml:lang", "unknown");
        return { language, text: textContent(text) };
    });
    if (reasons.length === 0) throw new OnvifError("InvalidXml", "SOAP fault has no reason", "unknown");
    const detail = one(root, SOAP_NS, "Detail", false);
    const faultNode = one(root, SOAP_NS, "Node", false);
    const role = one(root, SOAP_NS, "Role", false);
    return {
        code, subcodes, reasons,
        ...(detail === undefined ? {} : { detail: structuredClone(detail) }),
        ...(faultNode === undefined ? {} : { node: textContent(faultNode) }),
        ...(role === undefined ? {} : { role: textContent(role) })
    };
}

export function soapResponse(
    bytes: Uint8Array, operation: OperationDescriptor, status: number, limits: Partial<XmlLimits> = {},
    registry: XmlRegistry = EMPTY_XML_REGISTRY, addressingNamespace: AddressingNamespace = WSA_NS
): XmlElement {
    const root = parseXml(bytes, limits);
    if (!equalQName(root.name, { namespace: SOAP_NS, localName: "Envelope" })) {
        throw new OnvifError("InvalidXml", "Expected a SOAP 1.2 Envelope", "unknown");
    }
    const header = one(root, SOAP_NS, "Header", false);
    const body = required(root, SOAP_NS, "Body");
    if (childElements(root).some((child) => child !== header && child !== body)) {
        throw new OnvifError("InvalidXml", "Unexpected SOAP envelope content", "unknown");
    }
    if (header !== undefined) {
        for (const entry of childElements(header)) {
            const mustUnderstand = entry.attributes.find((attribute) =>
                equalQName(attribute.name, { namespace: SOAP_NS, localName: "mustUnderstand" }))?.value;
            if ((mustUnderstand === "true" || mustUnderstand === "1")
                && (entry.name.namespace !== addressingNamespace || !["Action", "To", "RelatesTo", "MessageID"].includes(entry.name.localName))) {
                throw new OnvifError("UnsupportedCapability", "Required SOAP response header is not implemented", "unknown");
            }
        }
    }
    const children = childElements(body);
    if (children.length !== 1 || children[0] === undefined) {
        throw new OnvifError("InvalidXml", "Document/literal SOAP Body requires one message element", "unknown");
    }
    const payload = children[0];
    if (equalQName(payload.name, { namespace: SOAP_NS, localName: "Fault" })) {
        const fault = parseFault(payload);
        const typedDetails: NonNullable<NativeFault["typedDetails"]>[number][] = [];
        for (const detail of fault.detail === undefined ? [] : childElements(fault.detail)) {
            const declared = operation.faults?.find((entry) => equalQName(entry.element.name, detail.name));
            const element = declared?.element ?? registry.elements[`{${detail.name.namespace}}${detail.name.localName}`];
            if (element !== undefined) {
                typedDetails.push({ name: detail.name, value: decodeElement(element, detail, registry),
                    ...(declared === undefined ? {} : { faultName: declared.name }) });
                const action = header === undefined ? undefined : one(header, addressingNamespace, "Action", false);
                if (declared?.action !== undefined && action !== undefined && textContent(action) !== declared.action) {
                    throw new OnvifError("InvalidXml", "WS-Addressing fault Action differs from the declared fault", "unknown");
                }
            }
        }
        throw new SoapFaultError({ ...fault, typedDetails }, operation, status);
    }
    if (status < 200 || status >= 300) throw new OnvifError("TransportError", "HTTP failure without a native SOAP fault", "unknown");
    if (operation.responseAction !== undefined) {
        const responseAction = header === undefined ? undefined : one(header, addressingNamespace, "Action");
        if (responseAction === undefined || textContent(responseAction) !== operation.responseAction) {
            throw new OnvifError("InvalidXml", "WS-Addressing response Action does not match the local registry", "unknown");
        }
    }
    return payload;
}
