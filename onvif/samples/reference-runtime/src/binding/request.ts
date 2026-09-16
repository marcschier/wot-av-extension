import type { CanonicalValue, XmlElement } from "../xml/types.js";
import { isRecord, OnvifError } from "./errors.js";
import { assertXmlElement } from "../xml/parser.js";

export type AddressingNamespace = "http://www.w3.org/2005/08/addressing"
    | "http://schemas.xmlsoap.org/ws/2004/08/addressing";
export interface RequestAddressing {
    readonly namespace?: AddressingNamespace;
    readonly to?: string;
    readonly referenceParameters?: readonly XmlElement[];
    readonly referenceProperties?: readonly XmlElement[];
}
export type SoapHeaderMap = Readonly<Record<string, XmlElement>>;
export interface NativeInvokeOptions {
    readonly formIndex?: number;
    readonly target?: string;
    readonly addressing?: RequestAddressing;
    readonly headers?: SoapHeaderMap;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
}
export interface NativeExecutionResult {
    readonly value: CanonicalValue | undefined;
    readonly xml: XmlElement | undefined;
    readonly status: number;
    readonly outcome: "response" | "accepted-one-way";
}

export function assertNativeInvokeOptions(value: unknown): asserts value is NativeInvokeOptions {
    if (!isRecord(value) || Object.keys(value).some((key) =>
        !["formIndex", "target", "addressing", "headers", "signal", "timeoutMs", "maxResponseBytes"].includes(key))) {
        throw new OnvifError("InvalidConfiguration", "Unknown native invocation option; security cannot be overridden here");
    }
    for (const key of ["formIndex", "timeoutMs", "maxResponseBytes"]) {
        const number = value[key];
        if (number !== undefined && (typeof number !== "number" || !Number.isSafeInteger(number)
            || number < (key === "formIndex" ? 0 : 1) || number > 2147483647)) {
            throw new OnvifError("InvalidConfiguration", `Invalid native ${key}`);
        }
    }
    if (value.target !== undefined && typeof value.target !== "string"
        || value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
        throw new OnvifError("InvalidConfiguration", "Invalid native target or AbortSignal");
    }
    if (value.addressing !== undefined) {
        const addressing = value.addressing;
        if (!isRecord(addressing) || Object.keys(addressing).some((key) =>
            !["namespace", "to", "referenceParameters", "referenceProperties"].includes(key))
            || addressing.to !== undefined && typeof addressing.to !== "string"
            || addressing.namespace !== undefined && ![
                "http://www.w3.org/2005/08/addressing", "http://schemas.xmlsoap.org/ws/2004/08/addressing"
            ].includes(String(addressing.namespace))) {
            throw new OnvifError("InvalidConfiguration", "Invalid native addressing options");
        }
        for (const key of ["referenceParameters", "referenceProperties"]) {
            const headers = addressing[key];
            if (headers === undefined) continue;
            if (!Array.isArray(headers) || headers.length > 128) throw new OnvifError("XmlLimit", "EPR header count exceeds the bound");
            for (const header of headers) assertXmlElement(header);
        }
    }
    if (value.headers !== undefined) {
        if (!isRecord(value.headers) || Object.keys(value.headers).length > 128) throw new OnvifError("XmlLimit", "Invalid SOAP header map");
        for (const header of Object.values(value.headers)) assertXmlElement(header);
    }
}
