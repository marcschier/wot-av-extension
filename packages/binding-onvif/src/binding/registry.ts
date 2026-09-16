import { createHash } from "node:crypto";
import { isRecord, OnvifError } from "./errors.js";
import { assertElementDescriptor, assertXmlRegistry } from "../xml/descriptors.js";
import { EMPTY_XML_REGISTRY, isQName, type ElementDescriptor, type QName, type XmlRegistry } from "../xml/types.js";

export interface OperationReference {
    readonly bindingQName: QName;
    readonly portTypeQName: QName;
    readonly operation: string;
}

export interface OperationDescriptor extends OperationReference {
    readonly execution?: {
        readonly mode: "request-response" | "one-way";
        readonly safe: boolean;
        readonly idempotent: boolean;
    };
    readonly soapAction: string;
    readonly addressingAction: string;
    readonly responseAction?: string;
    readonly request: ElementDescriptor;
    readonly response: ElementDescriptor | null;
    readonly faults?: readonly {
        readonly name: string;
        readonly messageQName: QName;
        readonly element: ElementDescriptor;
        readonly action?: string;
        readonly sourceId: string;
    }[];
    readonly access: "preauth" | "read" | "write" | "actuate" | "stateful" | "unclassified";
    readonly source: {
        readonly kind: "fixture" | "generated";
        readonly document: string;
        readonly locator: string;
        readonly sha256?: string;
    };
}

export interface OperationRegistry {
    readonly digest: string;
    readonly xml: XmlRegistry;
    readonly operations?: readonly OperationDescriptor[];
    resolve(reference: OperationReference): OperationDescriptor;
}

export function operationReference(value: unknown): OperationReference {
    if (!isRecord(value) || !isQName(value.bindingQName) || !isQName(value.portTypeQName)
        || typeof value.operation !== "string" || !value.operation) {
        throw new OnvifError("InvalidRegistry", "Operation identity requires bindingQName, portTypeQName and operation");
    }
    return { bindingQName: value.bindingQName, portTypeQName: value.portTypeQName, operation: value.operation };
}

export function operationKey(reference: OperationReference): string {
    return JSON.stringify([
        reference.bindingQName.namespace, reference.bindingQName.localName,
        reference.portTypeQName.namespace, reference.portTypeQName.localName, reference.operation
    ]);
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
    throw new OnvifError("InvalidRegistry", "Registry must contain only finite JSON data");
}

function freeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

export function defineOperationRegistry(
    descriptors: readonly OperationDescriptor[], definitions: XmlRegistry = EMPTY_XML_REGISTRY
): OperationRegistry {
    if (!Array.isArray(descriptors) || descriptors.length > 10000) {
        throw new OnvifError("InvalidRegistry", "Registry must be a bounded operation array");
    }
    assertXmlRegistry(definitions);
    const entries = new Map<string, OperationDescriptor>();
    const elements: Record<string, ElementDescriptor> = { ...definitions.elements };
    for (const input of descriptors) {
        assertOperationDescriptor(input);
        const reference = operationReference(input);
        if (input.faults !== undefined) {
            for (const fault of input.faults) {
                elements[`fault:${operationKey(reference)}:${fault.name}`] = fault.element;
            }
        }
        const key = operationKey(reference);
        if (entries.has(key)) throw new OnvifError("InvalidRegistry", "Duplicate qualified operation");
        canonical(input);
        entries.set(key, freeze(structuredClone(input)));
        elements[`request:${key}`] = input.request;
        if (input.response !== null) elements[`response:${key}`] = input.response;
    }
    assertXmlRegistry({ ...definitions, elements });
    const xml = freeze(structuredClone(definitions));
    const ordered = [...entries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
    const digest = createHash("sha256").update(canonical({ operations: ordered, xml })).digest("hex");
    return Object.freeze({
        digest,
        xml,
        operations: Object.freeze(ordered),
        resolve(reference: OperationReference): OperationDescriptor {
            const result = entries.get(operationKey(operationReference(reference)));
            if (result === undefined) throw new OnvifError("UnsupportedCapability", "Operation is not in the local qualified registry");
            return result;
        }
    });
}

export function assertOperationDescriptor(input: unknown): asserts input is OperationDescriptor {
    operationReference(input);
    if (!isRecord(input) || typeof input.soapAction !== "string" || !input.soapAction
        || /[\u0000-\u0020"\\]/u.test(input.soapAction)
        || input.addressingAction !== input.soapAction
        || typeof input.access !== "string"
        || !["preauth", "read", "write", "actuate", "stateful", "unclassified"].includes(input.access)
        || !isRecord(input.source) || !["fixture", "generated"].includes(String(input.source.kind))
        || typeof input.source.document !== "string" || typeof input.source.locator !== "string"
        || (input.source.sha256 !== undefined && (typeof input.source.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.source.sha256)))
        || (input.responseAction !== undefined && (typeof input.responseAction !== "string" || !input.responseAction
            || /[\u0000-\u0020"\\]/u.test(input.responseAction)))) {
        throw new OnvifError("InvalidRegistry", "Invalid document/literal SOAP 1.2 operation descriptor");
    }
    assertElementDescriptor(input.request);
    if (input.response !== null) assertElementDescriptor(input.response);
    if (input.execution !== undefined && (!isRecord(input.execution)
        || typeof input.execution.safe !== "boolean" || typeof input.execution.idempotent !== "boolean"
        || input.execution.mode !== (input.response === null ? "one-way" : "request-response")
        || (input.response === null && (input.execution.safe || input.execution.idempotent))
        || Object.keys(input.execution).some((key) => !["mode", "safe", "idempotent"].includes(key)))) {
        throw new OnvifError("InvalidRegistry", "Native execution policy disagrees with its WSDL message exchange");
    }
    if (input.faults !== undefined) {
        if (!Array.isArray(input.faults)) throw new OnvifError("InvalidRegistry", "Invalid native fault definitions");
        const names = new Set<string>();
        for (const fault of input.faults) {
            if (!isRecord(fault) || typeof fault.name !== "string" || !fault.name || names.has(fault.name)
                || !isQName(fault.messageQName) || typeof fault.sourceId !== "string"
                || (fault.action !== undefined && typeof fault.action !== "string")) {
                throw new OnvifError("InvalidRegistry", "Invalid native fault definition");
            }
            names.add(fault.name);
            assertElementDescriptor(fault.element);
        }
    }
}
