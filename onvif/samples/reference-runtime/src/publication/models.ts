import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord } from "../binding/errors.js";
import { readPackagedArtifact } from "../catalog/packaged.js";
import { ONVIF_BASE, ONVIF_CONTEXT, ONVIF_NAMESPACE, type Schema } from "../catalog/schemas.js";
import { digest } from "../catalog/sources.js";
import { resourceThingId } from "../projection/project.js";
import type { InventoryProjection } from "./snapshot-adapter.js";
import { observationSummary, currentObservationTime } from "./snapshot-adapter.js";
import { assertThingDescription, contextEntries, contextValue, httpUrl, PublicationError } from "./common.js";
import { OwnedDocumentBundle, type BundleDocument } from "./files.js";
import { expectStatus, PublicationHttpClient, responseJson } from "./http.js";

export interface PublicationThing {
    readonly deviceId: string;
    readonly td: ThingDescription;
    readonly observedAt: number | null;
    readonly quarantined: boolean;
}
export interface PreparedPublication {
    readonly inventoryRevision: number;
    readonly capturedAt: number;
    readonly things: readonly PublicationThing[];
    readonly documents: readonly BundleDocument[];
    readonly modelUrls: readonly string[];
}
export interface ModelPublisher {
    readonly baseUrl: string;
    publish(publication: PreparedPublication): Promise<void>;
    close(): Promise<void>;
}

function base(value: string): string {
    const url = httpUrl(value);
    if (url.search || !url.pathname.endsWith("/")) throw new PublicationError("InvalidConfiguration", "Model base URL must end with / and have no query");
    return url.href;
}

function relocate(value: unknown, baseUrl: string, key = ""): unknown {
    if (typeof value === "string" && ["id", "$id", "href", "tm:ref", "@context",
        "onvif:sourceDataSchema", "onvif:profileModels", "onvif:clientRequirements"].includes(key)) {
        if (value === ONVIF_CONTEXT) return `${baseUrl}context/v0.1`;
        if (value.startsWith(`${ONVIF_BASE}/models/`) || value.startsWith(`${ONVIF_BASE}/schemas/`)) {
            return baseUrl + value.slice(ONVIF_BASE.length + 1);
        }
    }
    if (Array.isArray(value)) return value.map((entry) => relocate(entry, baseUrl, key));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, relocate(entry, baseUrl, name)]));
    return value;
}

function modelPath(id: string, baseUrl: string): string {
    if (!id.startsWith(baseUrl) || id.includes("#") || id.includes("?")) throw new PublicationError("InvalidModel", "Model document has no owned publication path");
    return id.slice(baseUrl.length);
}

function resourceIdentity(value: unknown): {
    serviceNamespace: string; kind: string; token: string; parentTokens: { token: string }[];
} | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || typeof value.serviceNamespace !== "string" || typeof value.kind !== "string"
        || typeof value.token !== "string" || !Array.isArray(value.parentTokens)) {
        throw new PublicationError("InvalidModel", "Projected resource identity is malformed");
    }
    const parents = value.parentTokens.map((entry: unknown) => {
        if (!isRecord(entry) || typeof entry.token !== "string") throw new PublicationError("InvalidModel", "Projected parent identity is malformed");
        return { token: entry.token };
    });
    return { serviceNamespace: value.serviceNamespace, kind: value.kind, token: value.token, parentTokens: parents };
}

export function versionedThing(td: ThingDescription): ThingDescription {
    const copy = structuredClone(td);
    const modelVersion = `${String(copy["onvif:registryDigest"])}.${String(copy["onvif:requirementsDigest"])}`;
    delete copy.version;
    delete copy["onvif:projectionDigest"];
    const instance = digest(copy);
    return { ...copy, version: { model: modelVersion, instance }, "onvif:projectionDigest": instance };
}

export function preparePublication(projection: InventoryProjection, modelBaseUrl: string): PreparedPublication {
    const baseUrl = base(modelBaseUrl);
    const documents = new Map<string, BundleDocument>();
    const packaged = readPackagedArtifact("models.json");
    if (!isRecord(packaged) || !Array.isArray(packaged.models)) throw new PublicationError("InvalidModel", "Packaged model library is malformed");
    const models = [...packaged.models, ...projection.devices.flatMap((device) => device.projection.models)];
    for (const model of models) {
        const relocated = relocate(model, baseUrl);
        if (!isRecord(relocated) || typeof relocated.id !== "string") throw new PublicationError("InvalidModel", "A model document needs its persistent ID");
        const path = modelPath(relocated.id, baseUrl);
        const previous = documents.get(path);
        if (previous && digest(previous.value) !== digest(relocated)) throw new PublicationError("ModelConflict", "Different model documents share an ID");
        documents.set(path, { path, value: relocated });
    }
    for (const [path, name] of [
        ["context/v0.1", "context.jsonld"], ["schemas/payloads.schema.json", "payloads.schema.json"],
        ["schemas/form.schema.json", "form.schema.json"], ["schemas/snapshot.schema.json", "snapshot.schema.json"],
        ["schemas/requirements.schema.json", "requirements.schema.json"]
    ] as const) {
        documents.set(path, { path, value: relocate(readPackagedArtifact(name), baseUrl) });
    }
    documents.set("context/publication/v1", { path: "context/publication/v1", value: { "@context": {
        "@version": 1.1,
        "onvif:discovery": { "@id": `${ONVIF_NAMESPACE}discovery`, "@type": "@json" },
        "onvif:publication": { "@id": `${ONVIF_NAMESPACE}publication`, "@type": "@json" },
        "onvif:eventPolicyEvidence": { "@id": `${ONVIF_NAMESPACE}eventPolicyEvidence`, "@type": "@json" }
    } } });
    const things = projection.devices.flatMap<PublicationThing>((device) => device.projection.tds.map((td) => {
        const candidate = relocate(td, baseUrl);
        assertThingDescription(candidate);
        candidate["@context"] = contextValue([...contextEntries(candidate), `${baseUrl}context/publication/v1`]);
        candidate["onvif:discovery"] = observationSummary(device.observationEnvelope);
        const identity = resourceIdentity(candidate["onvif:resourceIdentity"]);
        if (identity) {
            const resource = device.snapshot.resources.find((item) => item.serviceNamespace === identity.serviceNamespace
                && item.kind === identity.kind && item.token === identity.token
                && JSON.stringify(item.parentTokens.map((parent) => parent.token)) === JSON.stringify(identity.parentTokens.map((parent) => parent.token)));
            const references = resource?.facts?.nativeReferences;
            if (references?.state === "known" && Array.isArray(references.value)) {
                for (const reference of references.value) {
                    if (!isRecord(reference)) continue;
                    const target = device.snapshot.resources.find((item) => item.serviceNamespace === reference.serviceNamespace
                        && item.kind === reference.kind && item.token === reference.token && item.parentTokens.length === 0);
                    if (target) {
                        const href = resourceThingId(device.snapshot, target);
                        if (!candidate.links?.some((link) => link.rel === "related" && link.href === href)) {
                            candidate.links = [...candidate.links ?? [], { rel: "related", href, type: "application/td+json" }];
                        }
                    }
                }
            }
        }
        const links = candidate.links?.filter((link) => link.rel === "type") ?? [];
        if (links.length !== 1 || !links[0]?.href.startsWith(baseUrl)) throw new PublicationError("InvalidModel", "An observed TD needs exactly one hosted composite type");
        if (candidate.profile !== undefined) throw new PublicationError("InvalidModel", "An ONVIF claim cannot be published as a WoT profile badge");
        return {
            deviceId: device.inventoryId, td: versionedThing(candidate),
            observedAt: currentObservationTime(device.observationEnvelope, identity),
            quarantined: device.observationEnvelope.identityConflict || device.observationEnvelope.state === "conflict"
        };
    }));
    return {
        inventoryRevision: projection.inventory.revision, capturedAt: projection.inventory.capturedAt, things,
        documents: [...documents.values()].sort((a, b) => a.path < b.path ? -1 : 1),
        modelUrls: [...new Set(things.flatMap((thing) => thing.td.links?.filter((link) => link.rel === "type").map((link) => link.href) ?? []))]
    };
}

export interface StaticModelPublisherOptions {
    readonly directory: string;
    readonly owner: string;
    readonly baseUrl: string;
    readonly verification: "http" | "file-only";
    readonly http?: Omit<ConstructorParameters<typeof PublicationHttpClient>[0], "allowedOrigins" | "authorization">;
}

export class StaticModelPublisher implements ModelPublisher {
    readonly baseUrl: string;
    private readonly bundle: OwnedDocumentBundle;
    private readonly client: PublicationHttpClient | undefined;
    private readonly pending = new Set<Promise<void>>();
    private closing: Promise<void> | undefined;

    constructor(options: StaticModelPublisherOptions) {
        this.baseUrl = base(options.baseUrl);
        this.bundle = new OwnedDocumentBundle(options.directory, options.owner);
        if (options.verification !== "http" && options.verification !== "file-only") {
            throw new PublicationError("InvalidConfiguration", "Model reachability verification must be explicit");
        }
        this.client = options.verification === "http" ? new PublicationHttpClient({
            ...options.http, allowedOrigins: [httpUrl(this.baseUrl).origin], maxResponseBytes: 64 * 1024 * 1024
        }) : undefined;
    }

    publish(publication: PreparedPublication): Promise<void> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Model publisher is closed"));
        const work = this.publishOwned(publication);
        this.pending.add(work);
        void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
        return work;
    }

    private async publishOwned(publication: PreparedPublication): Promise<void> {
        await this.bundle.write(publication.documents);
        if (!this.client) return;
        const required = new Set(publication.modelUrls.map((url) => modelPath(url, this.baseUrl)));
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
            if (!isRecord(value)) return;
            for (const [key, entry] of Object.entries(value)) {
                if (typeof entry === "string" && ["href", "tm:ref", "onvif:sourceDataSchema"].includes(key)
                    && entry.startsWith(this.baseUrl)) required.add(entry.slice(this.baseUrl.length).split("#")[0] ?? "");
                else visit(entry);
            }
        };
        required.add("context/v0.1");
        required.add("context/publication/v1");
        for (const path of required) {
            const document = publication.documents.find((entry) => entry.path === path);
            if (!document) throw new PublicationError("InvalidModel", "The generated model import graph has a missing document");
            visit(document.value);
        }
        for (const path of required) {
            const document = publication.documents.find((entry) => entry.path === path);
            if (!document) throw new PublicationError("InvalidModel", "A required model document is absent");
            const hash = digest(document.value);
            const response = await this.client.request("GET", this.baseUrl + path);
            expectStatus(response, [200]);
            if (digest(responseJson(response)) !== hash) throw new PublicationError("ModelNotReachable", "Hosted model bytes do not match the owned generated document");
        }
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            const pending = await Promise.allSettled([...this.pending]);
            const results = await Promise.allSettled([this.bundle.close(), ...(this.client ? [this.client.close()] : [])]);
            const errors = [...pending, ...results].filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "Model publisher cleanup failed");
        })();
        return this.closing;
    }
}

export class FilePublication {
    private readonly bundle: OwnedDocumentBundle;
    private readonly pending = new Set<Promise<void>>();
    private closing: Promise<void> | undefined;
    constructor(readonly models: ModelPublisher, directory: string, owner: string) {
        this.bundle = new OwnedDocumentBundle(directory, owner);
    }
    publish(publication: PreparedPublication): Promise<void> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "File publisher is closed"));
        const work = this.publishOwned(publication);
        this.pending.add(work);
        void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
        return work;
    }
    private async publishOwned(publication: PreparedPublication): Promise<void> {
        await this.models.publish(publication);
        await this.bundle.write([
            ...publication.things.filter((thing) => !thing.quarantined).map((thing) => ({
                path: `things/${digest(String(thing.td.id))}.td.json`, value: thing.td
            })),
            { path: "inventory-publication.json", value: { schemaVersion: 1, inventoryRevision: publication.inventoryRevision,
                capturedAt: publication.capturedAt, things: publication.things.filter((thing) => !thing.quarantined)
                    .map((thing) => ({ id: thing.td.id, path: `things/${digest(String(thing.td.id))}.td.json` })) } }
        ]);
    }
    close(): Promise<void> {
        this.closing ??= (async () => {
            const pending = await Promise.allSettled([...this.pending]);
            const results = await Promise.allSettled([this.bundle.close(), this.models.close()]);
            const errors = [...pending, ...results].filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "File publication cleanup failed");
        })();
        return this.closing;
    }
}

export type { Schema };
