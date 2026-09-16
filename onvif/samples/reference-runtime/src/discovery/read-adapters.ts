import { createOnvifRuntime, type OnvifRuntime, type OnvifRuntimeOptions } from "../binding/runtime.js";
import { isRecord, OnvifError } from "../binding/errors.js";
import { operationKey } from "../binding/registry.js";
import type { ThingDescription } from "wot-typescript-definitions";
import type { ConsumedThing } from "@node-wot/core";
import { readonlyContract } from "./operations.js";
import { assertJson, validateXAddr } from "./policy.js";
import type { JsonObject, NativeReadAdapter, NativeReadRequest, NativeReadResult, NativeTarget } from "./types.js";

export function nativeFailure(error: unknown, aborted = false): NativeReadResult {
    if (aborted) return { status: "timeout", code: "ReadAborted", message: "Native read deadline or cancellation reached" };
    if (error instanceof OnvifError) {
        if (error.code === "AuthenticationFailed" || error.code === "PolicyDenied" || error.code === "InvalidSecurity") {
            return { status: "denied", code: error.code, message: "Native read was denied by authentication or target policy",
                responded: error.code === "AuthenticationFailed" };
        }
        if (error.code === "UnsupportedCapability") {
            return { status: "unsupported", code: error.code, message: "The selected native contract is not supported by this adapter" };
        }
        if (error.code === "SoapFault") {
            const fault = "fault" in error && isRecord(error.fault) ? error.fault : undefined;
            const unsupported = Array.isArray(fault?.subcodes) && fault.subcodes.some((code: unknown) =>
                isRecord(code) && code.namespace === "http://www.onvif.org/ver10/error" && code.localName === "ActionNotSupported");
            return { status: unsupported ? "unsupported" : "fault", code: "SoapFault",
                message: "Native SOAP fault returned; no feature-false inference", responded: true };
        }
        if (error.code === "XmlLimit") return { status: "truncated", code: error.code, message: "Native read exceeded its bounded representation" };
        if (["InvalidValue", "InvalidXml", "InvalidRegistry"].includes(error.code)) {
            return { status: "fault", code: error.code, message: "Native response or operation contract could not be interpreted faithfully" };
        }
        return { status: "unknown", code: error.code, message: "Native read did not establish a confirmed observation" };
    }
    return { status: "unknown", code: "AdapterFailure", message: "Native adapter failed without a typed ONVIF result" };
}

export interface RuntimeReadOptions {
    runtimeOptions: (target: NativeTarget, request: NativeReadRequest) => OnvifRuntimeOptions;
    security: (target: NativeTarget) => Pick<ThingDescription, "security" | "securityDefinitions">;
    principal?: (target: NativeTarget) => string;
    execute?: (runtime: OnvifRuntime, thing: ConsumedThing, args: JsonObject,
        target: NativeTarget, request: NativeReadRequest) => Promise<unknown>;
}

export class RuntimeReadAdapter implements NativeReadAdapter {
    private accepting = true;
    private readonly runtimes = new Set<OnvifRuntime>();
    private readonly pending = new Set<Promise<NativeReadResult>>();
    private closing: Promise<void> | undefined;

    constructor(private readonly options: RuntimeReadOptions) {}

    executeReadonly(key: string, args: JsonObject, target: NativeTarget, request: NativeReadRequest): Promise<NativeReadResult> {
        if (!this.accepting) return Promise.reject(new OnvifError("RuntimeClosed", "Read adapter is closed"));
        if (this.pending.size >= 32) return Promise.resolve({
            status: "truncated", code: "RuntimeReadConcurrency", message: "Native runtime read concurrency bound reached"
        });
        const work = this.execute(key, args, target, request);
        this.pending.add(work);
        void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
        return work;
    }

    private async execute(key: string, args: JsonObject, target: NativeTarget, request: NativeReadRequest): Promise<NativeReadResult> {
        const contract = readonlyContract(key);
        validateXAddr(target.xaddr);
        if (request.signal.aborted) return nativeFailure(request.signal.reason, true);
        if (!this.options.execute && target.endpointReference && (target.endpointReference.referenceProperties.length
            || target.endpointReference.referenceParameters.length)) {
            return { status: "unsupported", code: "AddressedReadHeaders",
                message: "Current runtime read integration cannot silently drop EPR reference headers" };
        }
        const options = this.options.runtimeOptions(target, request);
        const descriptor = options.registry.resolve(contract.reference);
        if (descriptor.access !== "read" && descriptor.access !== "preauth") {
            throw new OnvifError("PolicyDenied", "Registry access classification does not authorize this inspection read");
        }
        if (operationKey(descriptor) !== key || descriptor.soapAction !== contract.soapAction
            || descriptor.addressingAction !== contract.soapAction
            || descriptor.request.name.namespace !== contract.reference.bindingQName.namespace
            || descriptor.request.name.localName !== contract.reference.operation
            || descriptor.response === null
            || descriptor.response.name.namespace !== contract.reference.bindingQName.namespace
            || descriptor.response.name.localName !== `${contract.reference.operation}Response`) {
            throw new OnvifError("PolicyDenied", "Registry request, response or action disagrees with the pinned read-only wire contract");
        }
        const runtime = await createOnvifRuntime({
            ...options, timeoutMs: Math.min(request.timeoutMs, options.timeoutMs ?? request.timeoutMs),
            xml: { ...options.xml, maxBytes: Math.min(request.maxBytes, options.xml?.maxBytes ?? request.maxBytes) }
        });
        this.runtimes.add(runtime);
        try {
            if (request.signal.aborted) return nativeFailure(request.signal.reason, true);
            const description: ThingDescription = {
                "@context": ["https://www.w3.org/2022/wot/td/v1.1"],
                id: target.endpointReference?.address ?? "urn:wot-av:onvif:provisional-read",
                title: "Approved native inspection read", ...this.options.security(target),
                actions: { inspect: {
                    input: { type: "object" }, output: { type: "object" },
                    forms: [{
                        href: target.xaddr, op: "invokeaction", contentType: "application/soap+xml",
                        "htv:methodName": "POST", "onvif:binding": "soap12-http-v1", "onvif:operation": contract.reference
                    }]
                } }
            };
            const principal = this.options.principal?.(target);
            const thing = await runtime.consume(description, principal === undefined ? {} : { principal });
            const value: unknown = this.options.execute
                ? await this.options.execute(runtime, thing, args, target, request)
                : await (await thing.invokeAction("inspect", args)).value();
            assertJson(value, 20000, 64, request.maxBytes);
            if (request.signal.aborted) return nativeFailure(request.signal.reason, true);
            if (Buffer.byteLength(JSON.stringify(value)) > request.maxBytes) {
                return { status: "truncated", code: "ReadBytes", message: "Native result exceeds the inspection byte bound" };
            }
            return { status: "known", value };
        } catch (error) {
            return nativeFailure(error, request.signal.aborted);
        } finally {
            await runtime.close();
            this.runtimes.delete(runtime);
        }
    }

    close(): Promise<void> {
        if (!this.closing) {
            this.accepting = false;
            this.closing = (async () => {
                const results = await Promise.allSettled([...this.runtimes].map((runtime) => runtime.close()));
                const pending = await Promise.allSettled([...this.pending]);
                const errors = [...results, ...pending].filter((result) => result.status === "rejected").map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "Read adapter cleanup did not complete successfully");
            })();
        }
        return this.closing;
    }
}

export class FixtureReadAdapter implements NativeReadAdapter {
    readonly calls: { key: string; args: JsonObject; target: NativeTarget }[] = [];
    closed = false;
    constructor(private readonly handler: (key: string, args: JsonObject, target: NativeTarget, request: NativeReadRequest) => Promise<NativeReadResult> | NativeReadResult) {}
    async executeReadonly(key: string, args: JsonObject, target: NativeTarget, request: NativeReadRequest): Promise<NativeReadResult> {
        readonlyContract(key);
        if (this.closed) throw new OnvifError("RuntimeClosed", "Fixture read adapter is closed");
        this.calls.push({ key, args: structuredClone(args), target: structuredClone(target) });
        return this.handler(key, args, target, request);
    }
    async close(): Promise<void> { this.closed = true; }
}
