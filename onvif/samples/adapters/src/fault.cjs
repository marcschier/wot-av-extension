"use strict";

const { randomUUID } = require("node:crypto");

const CODES = new Set([
    "InvalidSelection", "UnknownProfileToken", "IdentityChanged", "PermissionDenied", "PolicyDenied",
    "Busy", "MissingDependency", "UnsupportedFormat", "Timeout", "DeviceLost", "SourceUnavailable",
    "StaleFrame", "SourceFailure", "ResourceLimit", "Cancelled", "ProtocolError", "CleanupFailed"
]);
const HTTP_STATUS = Object.freeze({
    InvalidSelection: 400, UnknownProfileToken: 404, IdentityChanged: 409, PermissionDenied: 403,
    PolicyDenied: 403, Busy: 409, MissingDependency: 503, UnsupportedFormat: 422, Timeout: 504,
    DeviceLost: 503, SourceUnavailable: 503, StaleFrame: 503, SourceFailure: 502, ResourceLimit: 413,
    Cancelled: 503, ProtocolError: 502, CleanupFailed: 502
});

class SourceFault extends Error {
    constructor(code, operation, options = {}) {
        super(CODES.has(code) ? code : "SourceFailure");
        this.name = "SourceFault";
        this.code = this.message;
        this.operation = operation;
        this.retryable = options.retryable === true;
        this.diagnosticId = randomUUID();
        if (/^0x[0-9a-f]{8}$/i.test(options.nativeCode ?? "")) {
            this.nativeDomain = "HRESULT";
            this.nativeCode = options.nativeCode;
        } else if (["errno", "Aravis", "libjpeg"].includes(options.nativeDomain)
            && typeof options.nativeCode === "string" && /^-?(0|[1-9][0-9]{0,9})$/.test(options.nativeCode)) {
            this.nativeDomain = options.nativeDomain;
            this.nativeCode = options.nativeCode;
        }
        if (options.cleanup) this.cleanup = options.cleanup;
    }
    toJSON() {
        return {
            code: this.code, operation: this.operation, retryable: this.retryable,
            diagnosticId: this.diagnosticId,
            ...(this.nativeCode ? { nativeDomain: this.nativeDomain, nativeCode: this.nativeCode } : {}),
            ...(this.cleanup ? { cleanup: this.cleanup } : {})
        };
    }
}

function asFault(error, operation) {
    return error instanceof SourceFault ? error : new SourceFault("SourceFailure", operation);
}

function demand(condition, code, operation) {
    if (!condition) throw new SourceFault(code, operation);
}

module.exports = { SourceFault, HTTP_STATUS, CODES, asFault, demand };
