import * as http from "node:http";
import * as https from "node:https";
import type { TlsTrust } from "../security/policy.js";
import { boundedInteger, httpUrl, PublicationError } from "./common.js";

export interface PublicationHttpOptions {
    readonly allowedOrigins: readonly string[];
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
    readonly maxRequestBytes?: number;
    readonly maxPending?: number;
    readonly tls?: TlsTrust;
    readonly authorization?: {
        readonly origin: string;
        readonly principal: string;
        readonly bearer: () => Promise<string>;
    };
}

export interface PublicationResponse {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
    readonly body: Buffer;
}

/** Finite document transport. Redirects are returned, never automatically followed. */
export class PublicationHttpClient {
    private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, maxTotalSockets: 8 });
    private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, maxTotalSockets: 8 });
    private readonly pending = new Set<Promise<PublicationResponse>>();
    private readonly requests = new Set<http.ClientRequest>();
    private readonly timeoutMs: number;
    private readonly maxResponseBytes: number;
    private readonly maxRequestBytes: number;
    private readonly maxPending: number;
    private readonly origins: ReadonlySet<string>;
    private closing: Promise<void> | undefined;

    constructor(private readonly options: PublicationHttpOptions) {
        if (!options.allowedOrigins.length) throw new PublicationError("InvalidConfiguration", "Document origins must be explicitly allowed");
        this.origins = new Set(options.allowedOrigins.map((value) => {
            const url = httpUrl(value);
            if (url.pathname !== "/" || url.search) throw new PublicationError("InvalidConfiguration", "Document allowlist entries must be origins");
            return url.origin;
        }));
        this.timeoutMs = boundedInteger(options.timeoutMs ?? 5000, "document timeout", 120000);
        this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 4 * 1024 * 1024, "response bytes", 64 * 1024 * 1024);
        this.maxRequestBytes = boundedInteger(options.maxRequestBytes ?? 4 * 1024 * 1024, "request bytes", 64 * 1024 * 1024);
        this.maxPending = boundedInteger(options.maxPending ?? 16, "pending documents", 128);
        if (options.authorization && (!options.authorization.principal
            || !this.origins.has(httpUrl(options.authorization.origin).origin))) {
            throw new PublicationError("InvalidConfiguration", "Directory authorization requires a separately scoped principal and origin");
        }
        if (options.tls && (Object.keys(options.tls).some((key) => !["ca", "cert", "key", "passphrase", "minVersion"].includes(key))
            || (options.tls.minVersion !== undefined && !["TLSv1.2", "TLSv1.3"].includes(options.tls.minVersion)))) {
            throw new PublicationError("InvalidConfiguration", "TLS verification cannot be disabled for publication");
        }
    }

    get pendingRequests(): number { return this.pending.size; }

    request(method: "GET" | "HEAD" | "PUT" | "PATCH" | "DELETE" | "OPTIONS", href: string,
        body?: unknown, headers: Readonly<Record<string, string>> = {}): Promise<PublicationResponse> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Document transport is closed"));
        if (this.pending.size >= this.maxPending) return Promise.reject(new PublicationError("PublicationLimit", "Document request queue is full"));
        const work = this.perform(method, href, body, headers);
        this.pending.add(work);
        void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
        return work;
    }

    private perform(method: string, href: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<PublicationResponse> {
        return new Promise<PublicationResponse>((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                const error = new PublicationError("DirectoryTimeout", "Document request deadline exceeded", undefined, method === "GET");
                reject(error);
                controller.abort(error);
            }, this.timeoutMs);
            void this.performWithinDeadline(method, href, body, headers, controller.signal).then(
                (response) => { clearTimeout(timer); resolve(response); },
                (error: unknown) => { clearTimeout(timer); reject(error); }
            );
        });
    }

    private async performWithinDeadline(method: string, href: string, body: unknown,
        headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<PublicationResponse> {
        const url = httpUrl(href);
        if (!this.origins.has(url.origin)) throw new PublicationError("PolicyDenied", "Document origin is not authorized");
        if (Object.keys(headers).some((name) => /^(authorization|host|content-length|connection)$/iu.test(name))) {
            throw new PublicationError("PolicyDenied", "Transport-owned HTTP headers cannot be overridden");
        }
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
        if (bytes && bytes.length > this.maxRequestBytes) throw new PublicationError("PublicationLimit", "Publication request exceeds its byte bound");
        const outgoing: Record<string, string> = { Accept: "application/td+json, application/ld+json, application/json",
            "Accept-Encoding": "identity", ...headers };
        if (bytes) {
            outgoing["Content-Length"] = String(bytes.length);
            outgoing["Content-Type"] ??= "application/td+json";
        }
        if (this.options.authorization) {
            if (url.origin !== this.options.authorization.origin) throw new PublicationError("PolicyDenied", "Directory credentials cannot cross origins");
            const token = await this.options.authorization.bearer();
            if (typeof token !== "string" || !token || token.length > 16384 || /[\u0000-\u0020\u007f]/u.test(token)) {
                throw new PublicationError("InvalidCredential", "Directory credential lookup did not return a valid bearer value");
            }
            outgoing.Authorization = `Bearer ${token}`;
        }
        signal.throwIfAborted();
        if (this.closing) throw new PublicationError("RuntimeClosed", "Document transport is closing");
        return new Promise<PublicationResponse>((resolve, reject) => {
            const secure = url.protocol === "https:";
            const request = (secure ? https.request : http.request)(url, {
                ...this.options.tls, method, headers: outgoing, signal,
                agent: secure ? this.httpsAgent : this.httpAgent, maxHeaderSize: 16384,
                minVersion: this.options.tls?.minVersion ?? "TLSv1.2", rejectUnauthorized: true
            });
            this.requests.add(request);
            let settled = false;
            const finish = (): void => {
                settled = true;
                this.requests.delete(request);
            };
            const fail = (error: Error): void => {
                if (settled) return;
                finish();
                request.destroy();
                reject(error);
            };
            request.on("error", () => fail(new PublicationError("DirectoryTransport", "Document transport failed; write outcome may be unknown", undefined, method === "GET")));
            request.on("response", (response) => {
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > this.maxResponseBytes) {
                        fail(new PublicationError("PublicationLimit", "Document response exceeds its byte bound"));
                        response.destroy();
                    } else chunks.push(chunk);
                });
                response.on("aborted", () => fail(new PublicationError("DirectoryTransport", "Document response was incomplete")));
                response.on("error", () => fail(new PublicationError("DirectoryTransport", "Document response failed")));
                response.on("end", () => {
                    if (settled) return;
                    finish();
                    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
                        reject(new PublicationError("UnsupportedDirectory", "Compressed document responses have not been negotiated"));
                        return;
                    }
                    resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
                });
            });
            request.end(bytes);
        });
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            await Promise.allSettled([...this.pending]);
            this.httpAgent.destroy();
            this.httpsAgent.destroy();
        })();
        return this.closing;
    }
}

export function responseJson(response: PublicationResponse): unknown {
    const type = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (!type || !["application/json", "application/ld+json", "application/td+json", "application/tm+json", "application/schema+json"].includes(type)) {
        throw new PublicationError("InvalidDirectoryResponse", "The Directory did not return the negotiated JSON representation", response.status);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); }
    catch (error) {
        if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
        throw new PublicationError("InvalidDirectoryResponse", "Invalid or non-UTF-8 JSON response", response.status);
    }
}

export function expectStatus(response: PublicationResponse, expected: readonly number[]): void {
    if (expected.includes(response.status)) return;
    const code = response.status === 401 || response.status === 403 ? "DirectoryDenied"
        : response.status === 409 || response.status === 412 ? "DirectoryConflict"
            : [404, 405, 501].includes(response.status) ? "UnsupportedDirectory"
                : response.status >= 300 && response.status < 400 ? "DirectoryRedirect" : "DirectoryResponse";
    throw new PublicationError(code, `Directory returned HTTP ${response.status}; no output-mode fallback`, response.status,
        [429, 502, 503, 504].includes(response.status));
}
