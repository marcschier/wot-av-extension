import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import type { Form, ProtocolClient, ProtocolClientFactory, SecurityScheme } from "@node-wot/core";
import { HttpClient } from "@node-wot/binding-http";
import fetch, { type Request, type Response } from "node-fetch";
import type { Subscription } from "rxjs/Subscription";
import { OnvifError } from "./errors.js";
import { isNativeForm, validateNativeForm } from "./forms.js";
import type { NativeExecutor } from "./executor.js";
import type { NativeInvokeOptions } from "./request.js";
import { authorizeTarget, credentialFor, selectSecurity, type SecurityContext, type TrustPolicy } from "../security/policy.js";
import type { NativeEventClient } from "../events/consumer.js";

export type TrackInteraction = <T>(work: () => Promise<T>, cleanup?: boolean) => Promise<T>;

class ScopedHttpClient extends HttpClient {
    private readonly scopedAgent: http.Agent | https.Agent;

    constructor(private readonly trust: TrustPolicy, secure: boolean, private readonly timeoutMs: number, private readonly principal: string) {
        super(null, secure);
        this.scopedAgent = secure
            ? new https.Agent({ ...trust.tls, minVersion: trust.tls?.minVersion ?? "TLSv1.2", rejectUnauthorized: true })
            : new http.Agent();
    }

    protected override async _fetch(request: Request): Promise<Response> {
        authorizeTarget(request.url, this.trust, this.principal);
        const result = await fetch(request, { body: request.body, redirect: "manual", agent: this.scopedAgent, timeout: this.timeoutMs });
        if (result.status >= 300 && result.status < 400) {
            if (result.body instanceof Readable) result.body.destroy();
            throw new OnvifError("PolicyDenied", "HTTP redirects require explicit target selection; credentials were not forwarded");
        }
        return result;
    }

    override async stop(): Promise<void> {
        await super.stop();
        this.scopedAgent.destroy();
    }
}

export class MultiplexFactory implements ProtocolClientFactory {
    private readonly clients = new Set<ScopedHttpClient>();
    private readonly subscriptions = new Map<string, { client: ScopedHttpClient; form: Form }>();
    private closing: Promise<void> | undefined;
    private closed = false;

    constructor(
        readonly scheme: "http" | "https",
        private readonly executor: NativeExecutor,
        private readonly context: SecurityContext,
        private readonly track: TrackInteraction,
        private readonly invocation: () => NativeInvokeOptions | undefined = () => undefined,
        private readonly events?: NativeEventClient
    ) {}

    init(): boolean { return !this.closed; }

    // Servient.destroy is synchronous; runtime.close owns and awaits close() first.
    destroy(): boolean { return this.closed; }

    private async plain(form: Form): Promise<ScopedHttpClient> {
        if (this.closing !== undefined) throw new OnvifError("RuntimeClosed", "HTTP client factory is closed");
        const { trust, credentials, timeoutMs } = this.executor.options;
        const target = authorizeTarget(form.href, trust, this.context.principal);
        if (trust.tls?.cert !== undefined) throw new OnvifError("UnsupportedCapability", "Ordinary HTTP client identities need a separately scoped adapter; native mTLS is not a nosec fallback");
        const selected = selectSecurity(this.context, form.security, false);
        const security = selected[0];
        if (security === undefined) throw new OnvifError("InvalidSecurity", "HTTP security is not defined");
        if (security.definition.proxy !== undefined) {
            throw new OnvifError("UnsupportedCapability", "Credential-bearing TD security proxies are not qualified");
        }
        for (const key of ["token", "authorization", "baseUri"]) {
            const value = security.definition[key];
            if (typeof value !== "string") continue;
            const authenticationTarget = authorizeTarget(value, trust, this.context.principal);
            if (authenticationTarget.origin !== target.origin) {
                throw new OnvifError("PolicyDenied", "Cross-origin HTTP authentication endpoints need a separately qualified authorization adapter");
            }
        }
        let material: unknown;
        if (security.definition.scheme !== "nosec") {
            const credential = await credentialFor(credentials, this.context, target, security);
            if (credential.kind === "tls") throw new OnvifError("InvalidSecurity", "TLS identity is not stock HTTP password/token material");
            material = credential.kind === "http" ? credential.value : { username: credential.username, password: credential.password };
        }
        const client = new ScopedHttpClient(trust, this.scheme === "https", timeoutMs, this.context.principal);
        this.clients.add(client);
        await client.start();
        if (!client.setSecurity(selected.map((entry) => entry.definition), material)) {
            throw new OnvifError("UnsupportedCapability", "Stock HTTP client rejected the requested security metadata");
        }
        return client;
    }

    getClient(): ProtocolClient {
        if (this.closing !== undefined) throw new OnvifError("RuntimeClosed", "Client factory is closed");
        const nativeUnsupported = async (): Promise<never> => {
            throw new OnvifError("UnsupportedCapability", "This native interaction requires a qualified operation/lifecycle mapping");
        };
        return {
            readResource: (form) => this.track(async () => isNativeForm(form)
                ? nativeUnsupported() : (await this.plain(form)).readResource(form)),
            writeResource: (form, content) => this.track(async () => isNativeForm(form)
                ? nativeUnsupported() : (await this.plain(form)).writeResource(form, content)),
            invokeResource: (form, content) => this.track(async () => {
                if (isNativeForm(form)) {
                    validateNativeForm(form, this.executor.options.registry);
                    return this.executor.invoke(this.context, form, content, this.invocation());
                }
                return (await this.plain(form)).invokeResource(form, content);
            }),
            unlinkResource: (form) => {
                if (isNativeForm(form)) return this.events?.unlink(form) ?? nativeUnsupported();
                return this.track(async () => {
                const entry = this.subscriptions.get(form.href);
                const client = entry?.client ?? await this.plain(form);
                await client.unlinkResource(form);
                this.subscriptions.delete(form.href);
                });
            },
            subscribeResource: (form, next, error, complete) => this.track(async (): Promise<Subscription> => {
                if (isNativeForm(form)) return this.events?.subscribe(form, next, error) ?? nativeUnsupported();
                const client = await this.plain(form);
                const subscription = await client.subscribeResource(form, next, error, complete);
                this.subscriptions.set(form.href, { client, form });
                return subscription;
            }),
            requestThingDescription: (uri) => this.track(async () => {
                authorizeTarget(uri, this.executor.options.trust, this.context.principal);
                const client = new ScopedHttpClient(this.executor.options.trust, this.scheme === "https", this.executor.options.timeoutMs, this.context.principal);
                this.clients.add(client);
                await client.start();
                if (!client.setSecurity([{ scheme: "nosec" }])) throw new OnvifError("InvalidSecurity", "HTTP TD retrieval security failed");
                return client.requestThingDescription(uri);
            }),
            start: async () => {
                if (this.closing !== undefined) throw new OnvifError("RuntimeClosed", "Client factory is closed");
            },
            stop: () => this.close(),
            setSecurity: (metadata: SecurityScheme[], credentials?: unknown) => {
                if (credentials !== undefined || metadata.length === 0) {
                    throw new OnvifError("InvalidSecurity", "Use out-of-band per-request credentials, not the scheme initialization cache");
                }
                // The selected Form and captured TD context, not this cached initialization, authorize each request.
                return true;
            }
        };
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            const events = await Promise.allSettled(this.events === undefined ? [] : [this.events.close()]);
            const unlinks = await Promise.allSettled([...this.subscriptions.values()].map(({ client, form }) => client.unlinkResource(form)));
            const stops = await Promise.allSettled([...this.clients].map((client) => client.stop()));
            this.subscriptions.clear();
            this.clients.clear();
            this.closed = true;
            const errors = [...events, ...unlinks, ...stops].filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "HTTP delegation cleanup failed");
        })();
        return this.closing;
    }
}
