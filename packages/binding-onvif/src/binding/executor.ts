import { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import { Content, type Form } from "@node-wot/core";
import { OnvifError, positiveInteger } from "./errors.js";
import { type OperationDescriptor, type OperationRegistry, operationReference } from "./registry.js";
import { validateNativeForm } from "./forms.js";
import { assertNativeInvokeOptions, type NativeExecutionResult, type NativeInvokeOptions } from "./request.js";
import { NodeHttpTransport, TransportFailure, type SoapTransport } from "./transport.js";
import { soapEnvelope, soapResponse } from "./soap.js";
import {
    authorizeTarget, credentialFor, selectSecurity, USERNAME_TOKEN_SCHEME, MUTUAL_TLS_SCHEME,
    type CredentialProvider, type SecurityContext, type TrustPolicy, type TlsTrust
} from "../security/policy.js";
import { createDigestAuthorization, digestPolicy, selectDigestChallenge, type DigestChallenge, type DigestPolicy } from "../security/digest.js";
import { createUsernameToken, validatedNonce, type Clock, type NonceSource, type UsernameTokenPolicy } from "../security/username-token.js";
import { authorizeLogicalEndpoint } from "../security/logical-endpoint.js";
import { decodeElement, encodeElement } from "../xml/mapper.js";
import { parseXml, serializeXml, xmlLimits, type XmlLimits } from "../xml/parser.js";
import type { XmlElement } from "../xml/types.js";

export interface ExecutorOptions {
    registry: OperationRegistry;
    trust: TrustPolicy;
    credentials?: CredentialProvider;
    transport?: SoapTransport;
    clock?: Clock;
    nonce?: NonceSource;
    digest?: Partial<DigestPolicy>;
    usernameToken?: UsernameTokenPolicy;
    xml?: Partial<XmlLimits>;
    timeoutMs: number;
}

class InvocationBudget {
    private readonly deadline: number;
    readonly signal: AbortSignal | undefined;

    constructor(options: NativeInvokeOptions, timeoutMs: number) {
        assertNativeInvokeOptions(options);
        this.signal = options.signal;
        this.deadline = performance.now() + positiveInteger(options.timeoutMs ?? timeoutMs, "timeoutMs", 2147483647);
    }

    remaining(): number {
        if (this.signal?.aborted) throw new OnvifError("TransportError", "Native invocation was cancelled before send");
        const remaining = Math.ceil(this.deadline - performance.now());
        if (remaining <= 0) throw new OnvifError("TransportError", "Native invocation deadline expired before send");
        return remaining;
    }

    wait<T>(work: () => Promise<T>): Promise<T> {
        const remaining = this.remaining();
        return new Promise<T>((resolve, reject) => {
            const finish = (): void => { clearTimeout(timer); this.signal?.removeEventListener("abort", abort); };
            const abort = (): void => { finish(); reject(new OnvifError("TransportError", "Native credential lookup was cancelled before send")); };
            const timer = setTimeout(() => {
                finish();
                reject(new OnvifError("TransportError", "Native credential lookup exceeded the invocation deadline before send"));
            }, remaining);
            this.signal?.addEventListener("abort", abort, { once: true });
            Promise.resolve().then(() => { this.remaining(); return work(); }).then(
                (value) => { finish(); resolve(value); },
                (error: unknown) => { finish(); reject(error); }
            );
        });
    }
}

function boundedContent(content: Content, maxBytes: number, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0, settled = false;
        const timer = setTimeout(() => fail(new OnvifError("TransportError", "Native action input exceeded the invocation deadline before send")), timeoutMs);
        const abort = (): void => fail(new OnvifError("TransportError", "Native action input was cancelled before send"));
        const finish = (): void => {
            settled = true;
            clearTimeout(timer);
            content.body.removeListener("data", data);
            content.body.removeListener("error", fail);
            content.body.removeListener("end", end);
            signal?.removeEventListener("abort", abort);
        };
        const fail = (error: Error): void => {
            if (settled) return;
            finish();
            if (content.body instanceof Readable) content.body.destroy();
            reject(error);
        };
        const data = (chunk: unknown): void => {
            if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
                fail(new OnvifError("InvalidValue", "Native input must contain UTF-8 XML bytes"));
                return;
            }
            const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
            size += buffer.length;
            if (size > maxBytes) { fail(new OnvifError("XmlLimit", "Native action input exceeds the byte bound")); return; }
            chunks.push(buffer);
        };
        const end = (): void => {
            if (settled) return;
            finish();
            resolve(Buffer.concat(chunks));
        };
        content.body.on("data", data);
        content.body.once("error", fail);
        content.body.once("end", end);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
    });
}

export class NativeExecutor {
    readonly transport: SoapTransport;
    readonly limits: XmlLimits;
    private readonly digest: DigestPolicy;
    private readonly recentNonces = new Set<string>();

    constructor(readonly options: ExecutorOptions) {
        this.transport = options.transport ?? new NodeHttpTransport();
        this.limits = xmlLimits(options.xml);
        this.digest = digestPolicy(options.digest);
    }

    private readonly nonce = (): Buffer => {
        const nonce = validatedNonce(this.options.nonce);
        const key = nonce.toString("hex");
        if (this.recentNonces.has(key)) throw new OnvifError("InvalidConfiguration", "Nonce source reused a recent nonce");
        this.recentNonces.add(key);
        if (this.recentNonces.size > 1024) {
            const oldest = this.recentNonces.values().next().value;
            if (oldest !== undefined) this.recentNonces.delete(oldest);
        }
        return nonce;
    };

    async invoke(
        context: SecurityContext,
        form: Form,
        content?: Content,
        options: NativeInvokeOptions = {}
    ): Promise<Content> {
        const budget = new InvocationBudget(options, this.options.timeoutMs);
        const operation = validateNativeForm(form, this.options.registry);
        const payload = content === undefined ? encodeElement(operation.request, {}, this.options.registry.xml)
            : parseXml(await boundedContent(content, this.limits.maxBytes, budget.remaining(), budget.signal), this.limits);
        const result = await this.exchange(context, form, payload, options, budget);
        return new Content("application/soap+xml", Readable.from(result.xml === undefined ? []
            : [Buffer.from(serializeXml(result.xml, this.limits), "utf8")]));
    }

    execute(context: SecurityContext, form: Form, value: unknown = {}, options: NativeInvokeOptions = {}): Promise<NativeExecutionResult> {
        const budget = new InvocationBudget(options, this.options.timeoutMs);
        const operation = validateNativeForm(form, this.options.registry);
        return this.exchange(context, form, encodeElement(operation.request, value, this.options.registry.xml), options, budget);
    }

    private async exchange(
        context: SecurityContext, form: Form, payload: XmlElement, options: NativeInvokeOptions, budget: InvocationBudget
    ): Promise<NativeExecutionResult> {
        assertNativeInvokeOptions(options);
        options = { ...options,
            ...(options.addressing === undefined ? {} : { addressing: structuredClone(options.addressing) }),
            ...(options.headers === undefined ? {} : { headers: structuredClone(options.headers) }) };
        if (options.signal?.aborted) throw new OnvifError("TransportError", "Native invocation was cancelled before send");
        budget.remaining();
        const limits = { ...this.limits, maxBytes: Math.min(this.limits.maxBytes,
            positiveInteger(options.maxResponseBytes ?? this.limits.maxBytes, "maxResponseBytes", 16 * 1024 * 1024)) };
        const operation = validateNativeForm(form, this.options.registry);
        const target = authorizeTarget(options.target ?? form.href, this.options.trust, context.principal);
        authorizeLogicalEndpoint(context, form.href, target, operation, options.addressing, this.options.trust);
        const selections = selectSecurity(context, form.security, true);
        const digest = selections.find((entry) => entry.definition.scheme === "digest");
        const wsse = selections.find((entry) => entry.definition.scheme === USERNAME_TOKEN_SCHEME);
        const certificate = selections.find((entry) => ["cert", MUTUAL_TLS_SCHEME].includes(entry.definition.scheme));
        const trust = this.options.trust.tls;
        let tls: TlsTrust | undefined = trust === undefined ? undefined : {
            ...(trust.ca === undefined ? {} : { ca: trust.ca }), ...(trust.minVersion === undefined ? {} : { minVersion: trust.minVersion })
        };
        if (certificate !== undefined) {
            if (target.protocol !== "https:") throw new OnvifError("PolicyDenied", "Mutual TLS requires an HTTPS target");
            const material = await budget.wait(() => credentialFor(this.options.credentials, context, target, certificate));
            if (material.kind !== "tls") throw new OnvifError("InvalidSecurity", "Mutual TLS requires a principal-scoped client certificate and key");
            tls = { ...tls, cert: material.cert, key: material.key,
                ...(material.passphrase === undefined ? {} : { passphrase: material.passphrase }) };
        } else if (trust?.cert !== undefined || trust?.key !== undefined) {
            throw new OnvifError("InvalidSecurity", "A global trust certificate cannot silently become a cross-principal client identity");
        }
        decodeElement(operation.request, payload, this.options.registry.xml);
        let challenge: DigestChallenge | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            let usernameToken: string | undefined;
            if (wsse !== undefined) {
                const material = await budget.wait(() => credentialFor(this.options.credentials, context, target, wsse));
                if (material.kind !== "password") throw new OnvifError("InvalidSecurity", "UsernameToken requires username/password material");
                usernameToken = createUsernameToken({
                    username: material.username, password: material.password, nonce: this.nonce,
                    ...(this.options.clock === undefined ? {} : { clock: this.options.clock }),
                    ...this.options.usernameToken
                });
            }
            const body = soapEnvelope(operation, target, payload, {
                limits: this.limits, ...(options.addressing === undefined ? {} : { addressing: options.addressing }),
                ...(options.headers === undefined ? {} : { headers: options.headers }),
                ...(usernameToken === undefined ? {} : { usernameToken })
            });
            const headers: Record<string, string> = {
                "Content-Type": `application/soap+xml; charset=utf-8; action="${operation.soapAction}"`,
                Accept: "application/soap+xml"
            };
            if (digest !== undefined && challenge !== undefined) {
                const realm = challenge.realm;
                const material = await budget.wait(() => credentialFor(this.options.credentials, context, target, digest, realm));
                if (material.kind !== "password") throw new OnvifError("InvalidSecurity", "Digest requires username/password material");
                headers.Authorization = createDigestAuthorization({
                    challenge, username: material.username, password: material.password,
                    method: "POST", uri: target.pathname + target.search, body,
                    cnonce: this.nonce().toString("hex"), nonceCount: 1
                });
            }
            const response = await this.request(operation, {
                url: target, headers, body, timeoutMs: budget.remaining(), maxResponseBytes: limits.maxBytes,
                ...(tls === undefined ? {} : { tls }),
                ...(options.signal === undefined ? {} : { signal: options.signal })
            });
            if (response.status >= 300 && response.status < 400) {
                throw new OnvifError("PolicyDenied", "Native redirects are not followed", "unknown");
            }
            if (response.status === 401) {
                if (digest === undefined || attempt === 2) {
                    throw new OnvifError("AuthenticationFailed", "Native authentication was rejected", "rejected");
                }
                const next = selectDigestChallenge(response.headers["www-authenticate"] ?? [], this.digest);
                if (challenge !== undefined && (!next.stale || next.nonce === challenge.nonce
                    || next.realm !== challenge.realm || next.algorithm !== challenge.algorithm || next.qop !== challenge.qop)) {
                    throw new OnvifError("AuthenticationFailed", "Rejected Digest credentials are not replayed or downgraded", "rejected");
                }
                challenge = next;
                continue;
            }
            if (operation.response === null && [202, 204].includes(response.status) && response.body.byteLength === 0) {
                return { value: undefined, xml: undefined, status: response.status, outcome: "accepted-one-way" };
            }
            const contentType = response.headers["content-type"];
            const charset = /(?:^|;)\s*charset\s*=\s*"?([^;"\s]+)/iu.exec(contentType?.[0] ?? "")?.[1];
            if (contentType?.length !== 1 || !/^application\/soap\+xml(?:\s*;|$)/iu.test(contentType[0] ?? "")
                || (charset !== undefined && charset.toLowerCase().replace("-", "") !== "utf8")
                || response.headers["content-encoding"]?.some((value) => value.toLowerCase() !== "identity")) {
                throw new OnvifError("UnsupportedCapability", "Native response encoding is not qualified SOAP 1.2 UTF-8", "unknown");
            }
            let result: XmlElement;
            try {
                result = soapResponse(response.body, operation, response.status, limits, this.options.registry.xml, options.addressing?.namespace);
                if (operation.response === null) throw new OnvifError("InvalidXml", "A one-way native acknowledgement must not invent a response payload", "unknown");
                const value = decodeElement(operation.response, result, this.options.registry.xml);
                return { value, xml: result, status: response.status, outcome: "response" };
            } catch (error) {
                if (!(error instanceof OnvifError) || error.execution !== "not-sent") throw error;
                throw new OnvifError(error.code, error.message, "unknown");
            }
        }
        throw new OnvifError("AuthenticationFailed", "Native authentication exchange exhausted", "rejected");
    }

    private async request(operation: OperationDescriptor, request: Parameters<SoapTransport["request"]>[0]) {
        try {
            return await this.transport.request(request);
        } catch (error) {
            if (!(error instanceof TransportFailure)) throw error;
            if (error.execution === "not-sent") throw error;
            const failure = new OnvifError("OutcomeUnknown", "Native request may have executed; it was not replayed", "unknown");
            Object.defineProperty(failure, "operation", { value: operationReference(operation), enumerable: true });
            throw failure;
        }
    }
}
