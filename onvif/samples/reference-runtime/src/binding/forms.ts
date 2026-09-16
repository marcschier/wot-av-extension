import { ContentSerdes, type ContentCodec, type Form } from "@node-wot/core";
import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "./errors.js";
import { operationKey, operationReference, type OperationDescriptor, type OperationRegistry } from "./registry.js";
import {
    authorizeTarget, securityNames, selectSecurity,
    type SecurityContext, type SecurityScheme, type TrustPolicy
} from "../security/policy.js";
import { assertElementDescriptor, assertXmlRegistry, requireImplemented, resolveType } from "../xml/descriptors.js";
import { decodeElement, encodeElement } from "../xml/mapper.js";
import { parseXml, serializeXml, xmlLimits, type XmlLimits } from "../xml/parser.js";
import { EMPTY_XML_REGISTRY, type CanonicalValue, type ElementDescriptor, type XmlRegistry } from "../xml/types.js";
import { EVENT_BINDING, resolveSubscription, type ResolvedSubscription } from "../events/contracts.js";

export const BINDING_NAME = "soap12-http-v1";

export function isNativeForm(form: Form): boolean {
    return Object.keys(form).some((key) => key.startsWith("onvif:"));
}

export function validateNativeForm(form: Form, registry: OperationRegistry): OperationDescriptor {
    if (form["onvif:binding"] !== BINDING_NAME
        || Object.keys(form).some((key) => key.startsWith("onvif:")
            && !["onvif:binding", "onvif:operation", "onvif:soapAction", "onvif:input"].includes(key))) {
        throw new OnvifError("UnsupportedCapability", "Native Form binding metadata is not implemented");
    }
    const operation = registry.resolve(operationReference(form["onvif:operation"]));
    if (operation.response === null && operation.execution?.mode !== "one-way") {
        throw new OnvifError("UnsupportedCapability", "One-way WSDL execution requires an explicit accepted-empty execution policy");
    }
    requireImplemented(operation.request, registry.xml);
    if (operation.response !== null) requireImplemented(operation.response, registry.xml);
    for (const fault of operation.faults ?? []) requireImplemented(fault.element, registry.xml);
    if ((form["onvif:soapAction"] !== undefined && form["onvif:soapAction"] !== operation.soapAction)
        || (form["htv:methodName"] !== undefined && form["htv:methodName"] !== "POST")) {
        throw new OnvifError("InvalidRegistry", "Form conflicts with its registered native SOAP operation");
    }
    if (form.contentCoding !== undefined && form.contentCoding !== "identity") {
        throw new OnvifError("UnsupportedCapability", "Native content coding is not implemented");
    }
    if (form.subprotocol !== undefined || form["htv:headers"] !== undefined || form.scopes !== undefined
        || form.additionalResponses !== undefined) {
        throw new OnvifError("UnsupportedCapability", "Native Form option has no qualified implementation");
    }
    const contentType = form.contentType ?? "application/soap+xml";
    const parameters = ContentSerdes.getMediaTypeParameters(contentType);
    if (ContentSerdes.getMediaType(contentType) !== "application/soap+xml"
        || (parameters.charset !== undefined && parameters.charset.toLowerCase().replace("-", "") !== "utf8")
        || (parameters.action !== undefined && parameters.action !== operation.soapAction)
        || Object.keys(parameters).some((key) => key !== "charset" && key !== "action")
        || (form.response !== undefined && ContentSerdes.getMediaType(form.response.contentType) !== "application/soap+xml")) {
        throw new OnvifError("UnsupportedCapability", "Form must use document/literal SOAP 1.2 UTF-8");
    }
    return operation;
}

export function validateEventForm(form: Form, registry: OperationRegistry): ResolvedSubscription {
    if (form["onvif:binding"] !== EVENT_BINDING || Object.keys(form).some((key) =>
        key.startsWith("onvif:") && !["onvif:binding", "onvif:subscription"].includes(key))) {
        throw new OnvifError("UnsupportedCapability", "Native Events require an explicit PullPoint binding descriptor");
    }
    const operations = typeof form.op === "string" ? [form.op] : form.op;
    if (operations?.some((op) => !["subscribeevent", "unsubscribeevent"].includes(op))
        || /[{}]/u.test(form.href) || form.contentType !== undefined && form.contentType !== "application/soap+xml"
        || form.contentCoding !== undefined && form.contentCoding !== "identity"
        || form["htv:methodName"] !== undefined && form["htv:methodName"] !== "POST"
        || form.subprotocol !== undefined || form["htv:headers"] !== undefined || form.scopes !== undefined
        || form.additionalResponses !== undefined || form.response !== undefined) {
        throw new OnvifError("UnsupportedCapability", "Native Event Forms require a fixed SOAP endpoint and owned subscription lifecycle");
    }
    return resolveSubscription(form["onvif:subscription"], registry);
}

function schemaType(element: ElementDescriptor, registry: XmlRegistry): string {
    let type = resolveType(element.type, registry);
    while (type.kind === "restriction") type = type.base;
    if (type.kind === "list") return "array";
    if (type.kind !== "scalar") return "object";
    if (type.type === "int32" || type.type === "uint32") return "integer";
    if (type.type === "QName") return "object";
    if (type.type === "boolean") return "boolean";
    return "string";
}

export function canonicalDataSchema(element: ElementDescriptor, existing: unknown, limits: XmlLimits, registry: OperationRegistry): Record<string, unknown> {
    const result = { ...(isRecord(existing) ? existing : {}), "onvif:xml": element,
        "onvif:xmlRegistryId": registry.digest, "onvif:xmlLimits": limits };
    return { ...(isRecord(existing) && (existing.type !== undefined || existing.oneOf !== undefined)
        ? {} : { type: schemaType(element, registry.xml) }), ...result };
}

export function prepareDescription(
    description: ThingDescription, principal: string, registry: OperationRegistry, trust: TrustPolicy, limits: XmlLimits
): { description: ThingDescription; context: SecurityContext } {
    const copy = structuredClone(description);
    if (!isRecord(copy.securityDefinitions) || typeof copy.id !== "string" || !copy.id
        || typeof principal !== "string" || !principal) {
        throw new OnvifError("InvalidSecurity", "Consumed TD requires an ID, security definitions and an out-of-band principal");
    }
    if (copy["onvif:registryDigest"] !== undefined && copy["onvif:registryDigest"] !== registry.digest) {
        throw new OnvifError("InvalidRegistry", "TD registry digest does not match the local operation authority");
    }
    const definitions: Record<string, SecurityScheme> = {};
    for (const [name, value] of Object.entries(copy.securityDefinitions)) {
        if (!isRecord(value) || typeof value.scheme !== "string"
            || Object.keys(value).some((key) => ["password", "username", "tokenValue", "clientSecret", "secret", "value"].includes(key))) {
            throw new OnvifError("InvalidSecurity", "TD security metadata must not contain credential material");
        }
        Object.defineProperty(definitions, name, { value: { ...value, scheme: value.scheme }, enumerable: true });
    }
    const context: SecurityContext = Object.freeze({
        thingId: copy.id, principal, definitions: Object.freeze(definitions), security: Object.freeze(securityNames(copy.security))
    });
    const prepareForm = (form: Form): void => {
        if (copy.base !== undefined) {
            try {
                form.href = new URL(form.href, copy.base).href;
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                throw new OnvifError("PolicyDenied", "Form cannot be resolved against TD base");
            }
        }
        authorizeTarget(form.href, trust, context.principal);
        selectSecurity(context, form.security, isNativeForm(form));
        const headers = form["htv:headers"];
        const values: unknown[] = Array.isArray(headers) ? headers : headers === undefined ? [] : [headers];
        if (values.some((header) => isRecord(header) && typeof header["htv:fieldName"] === "string"
            && ["authorization", "proxy-authorization", "cookie"].includes(header["htv:fieldName"].toLowerCase()))) {
            throw new OnvifError("InvalidSecurity", "Credential-bearing HTTP headers must not be embedded in TD Forms");
        }
        if (!isNativeForm(form) && form.subprotocol === "sse") {
            throw new OnvifError("UnsupportedCapability", "Stock SSE bypasses the scoped HTTP transport and is not qualified");
        }
    };
    for (const action of Object.values(copy.actions ?? {})) {
        let descriptor: OperationDescriptor | undefined;
        for (const form of action.forms ?? []) {
            prepareForm(form);
            if (!isNativeForm(form)) continue;
            const operation = validateNativeForm(form, registry);
            if (descriptor !== undefined && operationKey(descriptor) !== operationKey(operation)) {
                throw new OnvifError("UnsupportedCapability", "One Action cannot select different native schema contracts by Form");
            }
            descriptor = operation;
            form.contentType ??= "application/soap+xml";
        }
        if (descriptor !== undefined) {
            action.input = canonicalDataSchema(descriptor.request, action.input, limits, registry);
            if (descriptor.response !== null) action.output = canonicalDataSchema(descriptor.response, action.output, limits, registry);
            else if (action.output !== undefined) throw new OnvifError("InvalidRegistry", "One-way native Actions cannot declare a JSON output");
        }
    }
    for (const affordance of Object.values(copy.properties ?? {})) {
        for (const form of affordance.forms ?? []) {
            prepareForm(form);
            if (isNativeForm(form)) {
                throw new OnvifError("UnsupportedCapability", "Native Properties require an explicit qualified mapping; stateful drains remain Actions");
            }
        }
    }
    for (const event of Object.values(copy.events ?? {})) {
        let contract: ResolvedSubscription | undefined;
        for (const form of event.forms ?? []) {
            prepareForm(form);
            if (!isNativeForm(form)) continue;
            const resolved = validateEventForm(form, registry);
            if (contract !== undefined && JSON.stringify(contract.descriptor) !== JSON.stringify(resolved.descriptor)) {
                throw new OnvifError("InvalidRegistry", "One native Event cannot select different lifecycle contracts by Form");
            }
            contract = resolved;
            form.contentType ??= "application/soap+xml";
        }
        if (contract !== undefined) {
            if (event.forms.some((form) => !isNativeForm(form))) {
                throw new OnvifError("UnsupportedCapability", "Native and ordinary Event Forms need separate affordances");
            }
            event.data = canonicalDataSchema(contract.notification, event.data, limits, registry);
            event.subscription = canonicalDataSchema(contract.create.request, event.subscription, limits, registry);
            event.cancellation = canonicalDataSchema(contract.unsubscribe.request, event.cancellation, limits, registry);
        }
    }
    for (const form of copy.forms ?? []) {
        prepareForm(form);
        if (isNativeForm(form)) throw new OnvifError("UnsupportedCapability", "Native aggregate Forms are not implemented");
    }
    return { description: copy, context };
}

const codecRegistries = new Map<string, { registry: XmlRegistry; owners: number }>();

function codecSchema(schema: Record<string, unknown> | undefined): { element: ElementDescriptor; limits: XmlLimits; registry: XmlRegistry } {
    const element = schema?.["onvif:xml"];
    if (element === undefined) throw new OnvifError("UnsupportedCapability", "SOAP codec requires a locally bound XML descriptor");
    assertElementDescriptor(element);
    const id = schema?.["onvif:xmlRegistryId"];
    const registered = typeof id === "string" ? codecRegistries.get(id) : undefined;
    if (id !== undefined && registered === undefined) throw new OnvifError("RuntimeClosed", "Canonical XML authority is not owned by a live runtime");
    let registry: XmlRegistry;
    if (registered !== undefined) registry = registered.registry;
    else {
        const inline = schema?.["onvif:xmlRegistry"] ?? EMPTY_XML_REGISTRY;
        assertXmlRegistry(inline);
        registry = inline;
    }
    const raw = schema?.["onvif:xmlLimits"];
    if (!isRecord(raw) || typeof raw.maxBytes !== "number" || typeof raw.maxDepth !== "number"
        || typeof raw.maxNodes !== "number" || typeof raw.maxAttributes !== "number") {
        throw new OnvifError("InvalidConfiguration", "SOAP codec requires explicit XML bounds");
    }
    return { element, registry, limits: xmlLimits({
        maxBytes: raw.maxBytes, maxDepth: raw.maxDepth, maxNodes: raw.maxNodes, maxAttributes: raw.maxAttributes
    }) };
}

export class CanonicalSoapCodec implements ContentCodec {
    private released = false;
    constructor(private readonly authority?: OperationRegistry) {
        if (authority === undefined) return;
        const existing = codecRegistries.get(authority.digest);
        if (existing !== undefined) existing.owners++;
        else {
            if (codecRegistries.size >= 256) throw new OnvifError("XmlLimit", "Too many live canonical XML authorities");
            assertXmlRegistry(authority.xml);
            codecRegistries.set(authority.digest, { registry: authority.xml, owners: 1 });
        }
    }

    close(): void {
        if (this.released || this.authority === undefined) return;
        this.released = true;
        const existing = codecRegistries.get(this.authority.digest);
        if (existing !== undefined && --existing.owners === 0) codecRegistries.delete(this.authority.digest);
    }

    getMediaType(): string { return "application/soap+xml"; }

    bytesToValue(bytes: Buffer, schema?: Record<string, unknown>): CanonicalValue {
        const { element, limits, registry } = codecSchema(schema);
        return decodeElement(element, parseXml(bytes, limits), registry);
    }

    valueToBytes(value: unknown, schema?: Record<string, unknown>): Buffer {
        const { element, limits, registry } = codecSchema(schema);
        return Buffer.from(serializeXml(encodeElement(element, value, registry), limits), "utf8");
    }
}
