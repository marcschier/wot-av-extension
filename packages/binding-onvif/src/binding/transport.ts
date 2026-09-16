import * as http from "node:http";
import * as https from "node:https";
import { TLSSocket } from "node:tls";
import { OnvifError, positiveInteger, type ExecutionCertainty } from "./errors.js";
import type { TlsTrust } from "../security/policy.js";

export interface SoapRequest {
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    readonly tls?: TlsTrust;
    readonly signal?: AbortSignal;
}
export interface SoapResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, readonly string[]>>;
    readonly body: Buffer;
}
export interface SoapTransport {
    request(request: SoapRequest): Promise<SoapResponse>;
    close(): Promise<void>;
}

export class TransportFailure extends OnvifError {
    constructor(readonly transportCode: string, execution: ExecutionCertainty) {
        super("TransportError", "Native HTTP transport failed", execution);
        this.name = "TransportFailure";
    }
}

export class NodeHttpTransport implements SoapTransport {
    private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8, maxTotalSockets: 32 });
    private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, maxTotalSockets: 32 });
    private readonly pending = new Set<Promise<SoapResponse>>();
    private closing: Promise<void> | undefined;

    request(input: SoapRequest): Promise<SoapResponse> {
        if (this.closing !== undefined) return Promise.reject(new OnvifError("RuntimeClosed", "Transport is closed"));
        positiveInteger(input.timeoutMs, "timeoutMs", 2147483647);
        positiveInteger(input.maxResponseBytes, "maxResponseBytes");
        if (!["http:", "https:"].includes(input.url.protocol) || input.url.username || input.url.password || input.url.hash) {
            return Promise.reject(new OnvifError("PolicyDenied", "Invalid native transport target"));
        }
        const promise = new Promise<SoapResponse>((resolve, reject) => {
            let connected = false, settled = false;
            const secure = input.url.protocol === "https:";
            const options: https.RequestOptions = {
                ...input.tls,
                method: "POST",
                headers: { ...input.headers, "Content-Length": String(input.body.byteLength) },
                agent: secure ? this.httpsAgent : this.httpAgent,
                maxHeaderSize: 16384,
                minVersion: input.tls?.minVersion ?? "TLSv1.2",
                rejectUnauthorized: true
            };
            const request = (secure ? https.request : http.request)(input.url, options);
            const timer = setTimeout(() => fail(new TransportFailure("TIMEOUT", connected ? "unknown" : "not-sent")), input.timeoutMs);
            const abort = (): void => fail(new TransportFailure("ABORT_ERR", connected ? "unknown" : "not-sent"));
            const finish = (): void => {
                settled = true;
                clearTimeout(timer);
                input.signal?.removeEventListener("abort", abort);
            };
            const fail = (error: Error): void => {
                if (settled) return;
                finish();
                request.destroy();
                reject(error);
            };
            request.on("socket", (socket) => {
                if (socket instanceof TLSSocket) {
                    connected = !socket.connecting && socket.authorized;
                    if (!connected) socket.once("secureConnect", () => { connected = true; });
                } else {
                    connected = !socket.connecting;
                    if (!connected) socket.once("connect", () => { connected = true; });
                }
            });
            request.on("error", (error: NodeJS.ErrnoException) => {
                const code = error.code && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : "NETWORK_ERROR";
                fail(new TransportFailure(code, connected ? "unknown" : "not-sent"));
            });
            request.on("response", (response) => {
                connected = true;
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > input.maxResponseBytes) {
                        fail(new OnvifError("XmlLimit", "Native response exceeds the byte bound", "unknown"));
                        response.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("aborted", () => fail(new TransportFailure("RESPONSE_ABORTED", "unknown")));
                response.on("error", () => fail(new TransportFailure("RESPONSE_ERROR", "unknown")));
                response.on("end", () => {
                    if (settled) return;
                    const headers: Record<string, string[]> = {};
                    for (let index = 0; index < response.rawHeaders.length; index += 2) {
                        const name = response.rawHeaders[index]?.toLowerCase();
                        const value = response.rawHeaders[index + 1];
                        if (name === undefined || value === undefined) continue;
                        const values = headers[name] ?? [];
                        values.push(value);
                        Object.defineProperty(headers, name, { value: values, enumerable: true, configurable: true });
                    }
                    finish();
                    resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
                });
            });
            if (input.signal?.aborted) { abort(); return; }
            input.signal?.addEventListener("abort", abort, { once: true });
            request.end(input.body);
        });
        this.pending.add(promise);
        void promise.then(() => { this.pending.delete(promise); }, () => { this.pending.delete(promise); });
        return promise;
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            const results = await Promise.allSettled([...this.pending]);
            this.httpAgent.destroy();
            this.httpsAgent.destroy();
            const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "Native transport shutdown observed failed requests");
        })();
        return this.closing;
    }
}
