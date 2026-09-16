export type ExecutionCertainty = "not-sent" | "rejected" | "unknown";

export type OnvifErrorCode =
    | "InvalidConfiguration" | "InvalidRegistry" | "InvalidValue" | "InvalidXml" | "XmlLimit"
    | "InvalidSecurity" | "AuthenticationFailed" | "PolicyDenied" | "UnsupportedCapability"
    | "TransportError" | "OutcomeUnknown" | "SoapFault" | "RuntimeClosed";

export class OnvifError extends Error {
    constructor(
        readonly code: OnvifErrorCode,
        message: string,
        readonly execution: ExecutionCertainty = "not-sent"
    ) {
        super(message);
        this.name = "OnvifError";
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function invalidValue(message: string): never {
    throw new OnvifError("InvalidValue", message);
}

export function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new OnvifError("InvalidConfiguration", `${name} must be a positive integer within its supported bound`);
    }
    return value;
}
