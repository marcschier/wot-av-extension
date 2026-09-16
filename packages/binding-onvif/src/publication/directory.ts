import { setTimeout as delay } from "node:timers/promises";
import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord } from "../binding/errors.js";
import { assertJson } from "../discovery/policy.js";
import {
    assertThingDescription, boundedInteger, contextEntries, contextValue, DISCOVERY_CONTEXT, httpUrl, matchesProducer, PublicationError
} from "./common.js";
import {
    expectStatus, PublicationHttpClient, responseJson, type PublicationHttpOptions, type PublicationResponse
} from "./http.js";

export interface DirectoryContract {
    readonly verification: { readonly mode: "attested"; readonly evidence: string }
        | { readonly mode: "owned-roundtrip"; readonly id: string };
    readonly ownership: { readonly mode: "etag" | "single-writer"; readonly evidence: string };
    readonly list: {
        readonly format: "array";
        readonly pageSize?: number;
        readonly maxPages?: number;
        readonly maxItems?: number;
        readonly collectionRevision: "canonical-link" | "none";
        readonly maxRestarts?: number;
        readonly additionalParameters?: readonly string[];
    };
    readonly expiry: { readonly mode: "registration-ttl"; readonly ttlSeconds: number; readonly patch: boolean; readonly purgeAttestation: string }
        | { readonly mode: "bridge-delete"; readonly outageLimitation: string };
}

export interface DirectoryOptions {
    readonly collectionUrl: string;
    readonly contract: DirectoryContract;
    readonly http?: Omit<PublicationHttpOptions, "allowedOrigins">;
    readonly maxReadRetries?: number;
    readonly allowedReadRedirects?: readonly string[];
}

export interface DirectoryRecord {
    readonly td: ThingDescription;
    readonly etag?: string;
    readonly expiresAt?: number;
}

export type WriteCondition = { readonly create: true } | { readonly etag: string } | { readonly singleWriter: true };
export interface DirectoryFilter {
    readonly claimedProfile?: string;
    readonly observedService?: string;
    readonly registeredProfile?: string;
}

function nonempty(value: string, label: string): void {
    if (typeof value !== "string" || !value.trim() || value.length > 4096) {
        throw new PublicationError("InvalidConfiguration", `${label} must be explicitly documented`);
    }
}

interface Link { readonly href: string; readonly rel: string[]; readonly etag?: string; }
function links(value: string | undefined): Link[] {
    if (!value) return [];
    if (value.length > 16384) throw new PublicationError("PublicationLimit", "Directory Link headers exceed their bound");
    const result: Link[] = [];
    const parts = value.split(/,(?=\s*<)/u);
    for (const part of parts) {
        const match = /^\s*<([^<>]+)>((?:\s*;\s*[^;]+)*)\s*$/u.exec(part);
        if (!match?.[1] || match[2] === undefined) throw new PublicationError("InvalidDirectoryResponse", "Malformed Directory Link header");
        const parameters: Record<string, string> = {};
        for (const parameter of match[2].split(";").slice(1)) {
            const pair = /^\s*([a-z][a-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s";]+))\s*$/iu.exec(parameter);
            if (!pair?.[1]) throw new PublicationError("InvalidDirectoryResponse", "Unsupported Directory Link parameter");
            const name = pair[1].toLowerCase();
            if (Object.hasOwn(parameters, name)) throw new PublicationError("InvalidDirectoryResponse", "Duplicate Directory Link parameter");
            parameters[name] = (pair[2] ?? pair[3] ?? "").replace(/\\(.)/gu, "$1");
        }
        result.push({ href: match[1], rel: (parameters.rel ?? "").split(/\s+/u),
            ...(parameters.etag === undefined ? {} : { etag: parameters.etag }) });
    }
    return result;
}

function strongEtag(response: PublicationResponse): string | undefined {
    const value = response.headers.etag;
    if (value === undefined) return undefined;
    if (!/^"[^"\r\n]+"$/u.test(value)) throw new PublicationError("UnsupportedDirectory", "Resource CAS needs a strong HTTP ETag");
    return value;
}

function expires(td: ThingDescription): number | undefined {
    if (!isRecord(td.registration) || td.registration.expires === undefined) return undefined;
    const value = td.registration.expires;
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new PublicationError("InvalidDirectoryResponse", "Registration expiry must be an absolute RFC3339 timestamp");
    }
    return Date.parse(value);
}

function compareIds(a: string, b: string): number {
    const left = Array.from(a), right = Array.from(b);
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const difference = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
        if (difference) return difference;
    }
    return left.length - right.length;
}

export class DirectoryClient {
    readonly collectionUrl: string;
    readonly contract: DirectoryContract;
    private readonly http: PublicationHttpClient;
    private readonly stop = new AbortController();
    private readonly pending = new Set<Promise<unknown>>();
    private readonly readRetries: number;
    private closing: Promise<void> | undefined;

    constructor(private readonly options: DirectoryOptions) {
        const url = httpUrl(options.collectionUrl);
        if (options.collectionUrl.includes("?") || url.pathname.endsWith("/")) throw new PublicationError("InvalidConfiguration", "Directory collection URL must have no query or trailing slash");
        if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "[::1]"
            && !/^127(?:\.\d{1,3}){3}$/u.test(url.hostname)) {
            throw new PublicationError("PolicyDenied", "Non-loopback Directory origins require HTTPS");
        }
        this.collectionUrl = url.href;
        this.contract = structuredClone(options.contract);
        const { ownership, verification, list, expiry } = this.contract;
        if (!ownership || !["etag", "single-writer"].includes(ownership.mode)) throw new PublicationError("InvalidConfiguration", "Directory ownership/CAS must be explicit");
        nonempty(ownership.evidence, "Directory ACL and ownership contract");
        if (verification?.mode === "attested") nonempty(verification.evidence, "CRUDL capability and permission attestation");
        else if (verification?.mode === "owned-roundtrip") this.resourceUrl(verification.id);
        else throw new PublicationError("InvalidConfiguration", "Directory CRUDL preflight or attestation is required");
        if (list?.format !== "array") throw new PublicationError("UnsupportedDirectory", "Only the declared WoT Discovery array listing contract is implemented");
        if (!["canonical-link", "none"].includes(list.collectionRevision)) throw new PublicationError("InvalidConfiguration", "Collection revision behavior must be declared");
        boundedInteger(list.maxPages ?? 32, "list pages", 1024);
        boundedInteger(list.maxItems ?? 2000, "list items", 20000);
        if (list.pageSize !== undefined) boundedInteger(list.pageSize, "list page size", 2000);
        if (!Number.isSafeInteger(list.maxRestarts ?? 1) || (list.maxRestarts ?? 1) < 0 || (list.maxRestarts ?? 1) > 3) {
            throw new PublicationError("InvalidConfiguration", "Collection restart budget must be between zero and three");
        }
        if (expiry?.mode === "registration-ttl") {
            boundedInteger(expiry.ttlSeconds, "registration TTL", 604800);
            if (typeof expiry.patch !== "boolean") throw new PublicationError("InvalidConfiguration", "PATCH support must be explicitly configured");
            nonempty(expiry.purgeAttestation, "Directory expiry/purge contract");
        } else if (expiry?.mode === "bridge-delete") nonempty(expiry.outageLimitation, "No-server-expiry outage limitation");
        else throw new PublicationError("InvalidConfiguration", "Directory expiry behavior must be explicit");
        this.readRetries = options.maxReadRetries ?? 1;
        if (!Number.isSafeInteger(this.readRetries) || this.readRetries < 0 || this.readRetries > 3) {
            throw new PublicationError("InvalidConfiguration", "Directory read retries must be between zero and three");
        }
        for (const redirect of options.allowedReadRedirects ?? []) {
            if (httpUrl(redirect).origin !== url.origin) throw new PublicationError("PolicyDenied", "Directory read redirects cannot cross origins");
        }
        this.http = new PublicationHttpClient({ ...options.http, allowedOrigins: [url.origin] });
    }

    get pendingRequests(): number { return this.http.pendingRequests; }

    resourceUrl(id: string): string {
        if (typeof id !== "string" || !id || id.length > 8192 || /[\u0000-\u0020]/u.test(id)) {
            throw new PublicationError("InvalidConfiguration", "Directory TD ID must be a bounded absolute URI");
        }
        try { new URL(id); } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            throw new PublicationError("InvalidConfiguration", "Directory TD ID must be an absolute URI");
        }
        const encoded = encodeURIComponent(id).replace(/[!'()*]/gu, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
        return `${this.collectionUrl}/${encoded}`;
    }

    private track<T>(work: () => Promise<T>): Promise<T> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Directory client is closed"));
        const promise = Promise.resolve().then(work);
        this.pending.add(promise);
        void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
        return promise;
    }

    private async read(href: string): Promise<PublicationResponse> {
        let url = href, redirects = 0;
        for (let attempt = 0; ; attempt++) {
            try {
                const response = await this.http.request("GET", url);
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    const target = response.headers.location ? new URL(response.headers.location, url).href : "";
                    if (++redirects > 2 || !this.options.allowedReadRedirects?.includes(target)
                        || httpUrl(target).origin !== httpUrl(this.collectionUrl).origin) {
                        throw new PublicationError("DirectoryRedirect", "Directory redirect is outside its explicit same-origin allowance", response.status);
                    }
                    url = target;
                    attempt--;
                    continue;
                }
                if (response.status !== 404) expectStatus(response, [200]);
                return response;
            } catch (error) {
                if (!(error instanceof PublicationError) || !error.retryable || attempt >= this.readRetries || this.stop.signal.aborted) throw error;
                try { await delay(Math.min(250 * (2 ** attempt), 1000), undefined, { signal: this.stop.signal }); }
                catch (aborted) {
                    if (!(aborted instanceof Error && aborted.name === "AbortError")) throw aborted;
                    throw new PublicationError("RuntimeClosed", "Directory read retry was cancelled");
                }
            }
        }
    }

    get(id: string): Promise<DirectoryRecord | null> {
        return this.track(async () => {
            const response = await this.read(this.resourceUrl(id));
            if (response.status === 404) return null;
            const td = responseJson(response);
            assertThingDescription(td);
            if (td.id !== id) throw new PublicationError("InvalidDirectoryResponse", "Retrieved TD ID disagrees with its requested resource");
            const etag = strongEtag(response), expiresAt = expires(td);
            if (this.contract.ownership.mode === "etag" && etag === undefined) {
                throw new PublicationError("UnsupportedDirectory", "The configured Directory did not supply a resource ETag");
            }
            return { td, ...(etag === undefined ? {} : { etag }), ...(expiresAt === undefined ? {} : { expiresAt }) };
        });
    }

    private condition(value: WriteCondition): Record<string, string> {
        if ("create" in value) return this.contract.ownership.mode === "etag" ? { "If-None-Match": "*" } : {};
        if ("etag" in value) {
            if (this.contract.ownership.mode !== "etag" || !/^"[^"\r\n]+"$/u.test(value.etag)) throw new PublicationError("InvalidConfiguration", "Invalid resource conditional-write contract");
            return { "If-Match": value.etag };
        }
        if (this.contract.ownership.mode !== "single-writer") throw new PublicationError("InvalidConfiguration", "Cannot bypass configured resource CAS");
        return {};
    }

    put(td: ThingDescription, condition: WriteCondition, ttlSeconds?: number): Promise<void> {
        return this.track(async () => {
            assertThingDescription(td);
            const document = structuredClone(td);
            delete document.registration;
            if (ttlSeconds !== undefined) {
                if (this.contract.expiry.mode !== "registration-ttl") throw new PublicationError("UnsupportedDirectory", "TTL is not negotiated");
                boundedInteger(ttlSeconds, "registration TTL", this.contract.expiry.ttlSeconds);
                const contexts = contextEntries(document);
                document["@context"] = contextValue(contexts.includes(DISCOVERY_CONTEXT) ? contexts : [...contexts, DISCOVERY_CONTEXT]);
                document.registration = { ttl: ttlSeconds };
            }
            const response = await this.http.request("PUT", this.resourceUrl(String(document.id)), document, this.condition(condition));
            expectStatus(response, [201, 204]);
            if ("create" in condition && response.status !== 201) throw new PublicationError("DirectoryConflict", "Create returned replacement status; resource ownership is unconfirmed", response.status);
            if (!("create" in condition) && response.status !== 204) throw new PublicationError("DirectoryConflict", "Replacement returned creation status; resource ownership is unconfirmed", response.status);
        });
    }

    renew(id: string, condition: WriteCondition, ttlSeconds?: number): Promise<void> {
        return this.track(async () => {
            if (this.contract.expiry.mode !== "registration-ttl" || !this.contract.expiry.patch) {
                throw new PublicationError("UnsupportedDirectory", "TTL/PATCH renewal was not negotiated");
            }
            if (ttlSeconds !== undefined) boundedInteger(ttlSeconds, "renewal TTL", this.contract.expiry.ttlSeconds);
            const patch = ttlSeconds === undefined ? {} : { registration: { ttl: ttlSeconds } };
            const response = await this.http.request("PATCH", this.resourceUrl(id), patch,
                { ...this.condition(condition), "Content-Type": "application/merge-patch+json" });
            expectStatus(response, [204]);
        });
    }

    delete(id: string, condition: WriteCondition): Promise<void> {
        return this.track(async () => {
            const response = await this.http.request("DELETE", this.resourceUrl(id), undefined, this.condition(condition));
            expectStatus(response, [204, 404]);
        });
    }

    list(): Promise<readonly ThingDescription[]> {
        return this.track(async () => {
            const { list } = this.contract;
            for (let restart = 0; restart <= (list.maxRestarts ?? 1); restart++) {
                try { return await this.listPages(); }
                catch (error) {
                    if (!(error instanceof PublicationError) || error.code !== "CollectionChanged" || restart === (list.maxRestarts ?? 1)) throw error;
                }
            }
            throw new PublicationError("CollectionChanged", "Directory collection did not stabilize within the restart budget");
        });
    }

    private async listPages(): Promise<ThingDescription[]> {
        const policy = this.contract.list;
        const first = new URL(this.collectionUrl);
        if (policy.pageSize !== undefined) { first.searchParams.set("limit", String(policy.pageSize)); first.searchParams.set("offset", "0"); }
        let href: string | undefined = first.href, collectionRevision: string | undefined, previousId: string | undefined;
        const visited = new Set<string>(), results: ThingDescription[] = [], ids = new Set<string>();
        for (let page = 0; href !== undefined && page < (policy.maxPages ?? 32); page++) {
            if (visited.has(href)) throw new PublicationError("InvalidDirectoryResponse", "Directory pagination repeated a page");
            visited.add(href);
            const response = await this.read(href);
            expectStatus(response, [200]);
            const value = responseJson(response);
            assertJson(value, 1000000, 96, 64 * 1024 * 1024);
            if (!Array.isArray(value)) throw new PublicationError("InvalidDirectoryResponse", "Declared array listing did not return an array");
            if (policy.pageSize !== undefined && value.length > policy.pageSize) throw new PublicationError("PublicationLimit", "Directory ignored the negotiated page limit");
            const header = response.headers.link;
            const relations = links(Array.isArray(header) ? header.join(", ") : header);
            const canonical = relations.filter((link) => link.rel.includes("canonical"));
            if (policy.collectionRevision === "canonical-link") {
                if (canonical.length !== 1 || !canonical[0]?.etag) throw new PublicationError("InvalidDirectoryResponse", "Directory omitted its negotiated collection revision");
                if (collectionRevision !== undefined && collectionRevision !== canonical[0].etag) throw new PublicationError("CollectionChanged", "Directory collection changed during pagination");
                collectionRevision = canonical[0].etag;
            }
            for (const item of value) {
                assertThingDescription(item);
                const id = String(item.id);
                if (ids.has(id) || (previousId !== undefined && compareIds(previousId, id) >= 0)) {
                    throw new PublicationError("CollectionChanged", "Directory IDs are duplicated or out of the declared Unicode ordering");
                }
                ids.add(id); previousId = id; results.push(item);
                if (results.length > (policy.maxItems ?? 2000)) throw new PublicationError("PublicationLimit", "Directory item budget exceeded");
            }
            const next = relations.filter((link) => link.rel.includes("next"));
            if (next.length > 1) throw new PublicationError("InvalidDirectoryResponse", "Directory returned ambiguous next-page links");
            if (!next[0]) { href = undefined; break; }
            if (policy.pageSize === undefined || value.length === 0) throw new PublicationError("InvalidDirectoryResponse", "Unnegotiated or non-progressing pagination");
            const target = httpUrl(new URL(next[0].href, href).href);
            const collection = httpUrl(this.collectionUrl);
            const allowed = new Set(["limit", "offset", ...(policy.additionalParameters ?? [])]);
            const offset = Number(target.searchParams.get("offset"));
            if (target.origin !== collection.origin || target.pathname !== collection.pathname
                || target.searchParams.get("limit") !== String(policy.pageSize)
                || !Number.isSafeInteger(offset) || offset <= Number(new URL(href).searchParams.get("offset") ?? 0)
                || [...target.searchParams.keys()].some((key) => !allowed.has(key))
                || [...target.searchParams.keys()].some((key) => target.searchParams.getAll(key).length !== 1)) {
                throw new PublicationError("PolicyDenied", "Directory next link escaped the declared same-authority listing contract");
            }
            href = target.href;
        }
        if (href !== undefined) throw new PublicationError("PublicationLimit", "Directory page budget exhausted; list is incomplete");
        return results;
    }

    async find(filter: DirectoryFilter): Promise<readonly ThingDescription[]> {
        const values = await this.list();
        const contains = (value: unknown, predicate: (entry: Record<string, unknown>) => boolean): boolean =>
            Array.isArray(value) && value.some((entry: unknown) => isRecord(entry) && predicate(entry));
        return values.filter((td) => (filter.claimedProfile === undefined
            || contains(td["onvif:profileClaims"], (entry) => entry.profile === filter.claimedProfile))
            && (filter.observedService === undefined || contains(td["onvif:observedServices"], (entry) => entry.namespace === filter.observedService))
            && (filter.registeredProfile === undefined || contains(td["onvif:conformanceEvidence"], (entry) =>
                entry.profile === filter.registeredProfile && entry.matchesObservedFirmware === "true")));
    }

    async preflight(): Promise<void> {
        await this.list();
        const verification = this.contract.verification;
        if (verification.mode === "attested") return;
        const id = verification.id;
        if (await this.get(id)) throw new PublicationError("DirectoryConflict", "Owned preflight ID already exists; it will not be overwritten");
        const td: ThingDescription = {
            "@context": ["https://www.w3.org/2022/wot/td/v1.1"], id, title: "Owned ONVIF publication preflight",
            securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"]
        };
        let created = false, current: DirectoryRecord | null = null;
        let failed = false, failure: unknown;
        const condition = (record: DirectoryRecord): WriteCondition => this.contract.ownership.mode === "single-writer"
            ? { singleWriter: true } : { etag: record.etag! };
        const ttl = this.contract.expiry.mode === "registration-ttl" ? this.contract.expiry.ttlSeconds : undefined;
        try {
            await this.put(td, { create: true }, ttl);
            created = true;
            current = await this.get(id);
            // A confirmed create owns this probe; retain its initial Directory enrichment, not arbitrary later changes.
            if (!current || !matchesProducer(current.td, { ...current.td, ...td })) throw new PublicationError("InvalidDirectoryResponse", "Directory preflight did not retrieve the created TD");
            if (ttl !== undefined && (current.expiresAt === undefined || !isRecord(current.td.registration)
                || current.td.registration.ttl !== ttl)) throw new PublicationError("UnsupportedDirectory", "Directory did not demonstrate its advertised TTL representation");
            if (!(await this.list()).some((entry) => entry.id === id)) throw new PublicationError("UnsupportedDirectory", "Directory listing does not include its owned registration");
            const stale = this.contract.ownership.mode === "etag" ? current.etag : undefined;
            const changed = { ...current.td, title: "Owned ONVIF publication preflight update" };
            await this.put(changed, condition(current), ttl);
            current = await this.get(id);
            if (!current || !matchesProducer(current.td, changed)) throw new PublicationError("UnsupportedDirectory", "Directory did not replace the owned preflight TD");
            if (stale) {
                try {
                    await this.put(td, { etag: stale }, ttl);
                    throw new PublicationError("UnsupportedDirectory", "Directory ignored the demonstrated conditional-write contract");
                } catch (error) {
                    if (error instanceof PublicationError && error.status === 201) {
                        throw new PublicationError("UnsupportedDirectory", "Directory accepted a stale conditional write as a creation", error.status);
                    }
                    if (!(error instanceof PublicationError) || error.code !== "DirectoryConflict"
                        || (error.status !== 409 && error.status !== 412)) throw error;
                }
            }
            if (this.contract.expiry.mode === "registration-ttl" && this.contract.expiry.patch) {
                const before = current;
                await this.renew(id, condition(current));
                current = await this.get(id);
                if (!current) throw new PublicationError("UnsupportedDirectory", "Directory lost the owned preflight registration during renewal");
                const registration = current.td.registration;
                const retrieved = isRecord(registration) && typeof registration.retrieved === "string"
                    ? Date.parse(registration.retrieved) : NaN;
                if (!matchesProducer(current.td, changed) || !isRecord(registration) || registration.ttl !== ttl
                    || current.expiresAt === undefined || (before.expiresAt !== undefined && current.expiresAt < before.expiresAt)
                    || (before.etag !== undefined && current.etag === before.etag)
                    || (Number.isFinite(retrieved) && current.expiresAt < retrieved + this.contract.expiry.ttlSeconds * 1000 - 1000)
                    || (before.etag === undefined && current.expiresAt === before.expiresAt)) {
                    throw new PublicationError("UnsupportedDirectory", "Directory did not demonstrate the negotiated registration renewal");
                }
            }
        } catch (error) {
            failed = true;
            failure = error;
        }
        try {
            if (created && (current || this.contract.ownership.mode === "single-writer")) {
                await this.delete(id, current ? condition(current) : { singleWriter: true });
            }
        } catch (cleanupError) {
            if (failed) throw new AggregateError([failure, cleanupError], "Directory preflight and owned-probe cleanup failed");
            throw cleanupError;
        }
        if (failed) throw failure;
        if (await this.get(id)) throw new PublicationError("UnsupportedDirectory", "Directory did not delete the owned preflight TD");
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            this.stop.abort();
            await Promise.allSettled([...this.pending]);
            await this.http.close();
        })();
        return this.closing;
    }
}
