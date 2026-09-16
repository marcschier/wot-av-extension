import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord } from "../binding/errors.js";
import { assertJson } from "../discovery/policy.js";
import { assertOwner, assertThingDescription, producerDigest, PublicationError } from "./common.js";
import { OwnedJsonFile } from "./files.js";

export interface RegistrationState {
    deviceId: string;
    producer: ThingDescription;
    digest: string;
    etag?: string;
    publishedAt: number;
    freshUntil: number;
    retainUntil: number;
    expiresAt?: number;
    status: "pending" | "active" | "stale" | "retired" | "conflict";
    failure?: { code: string; at: number };
    intent?: { producer: ThingDescription; digest: string; at: number; freshUntil: number; retainUntil: number };
}

export interface PublicationState {
    schemaVersion: 1;
    owner: string;
    revision: number;
    inventoryRevision: number;
    registrations: Record<string, RegistrationState>;
}

export interface PublicationStore {
    load(): Promise<PublicationState | null>;
    save(state: PublicationState): Promise<void>;
    close(): Promise<void>;
}

function validateState(value: unknown, owner: string): asserts value is PublicationState {
    assertJson(value, 2000000, 96, 64 * 1024 * 1024);
    if (!isRecord(value) || value.schemaVersion !== 1 || value.owner !== owner
        || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
        || !Number.isSafeInteger(value.inventoryRevision) || Number(value.inventoryRevision) < -1
        || !isRecord(value.registrations) || Object.keys(value.registrations).length > 20000) {
        throw new PublicationError("InvalidPublicationState", "Invalid publication state, revision or owner");
    }
    for (const [id, entry] of Object.entries(value.registrations)) {
        if (!isRecord(entry) || typeof entry.deviceId !== "string"
            || !["pending", "active", "stale", "retired", "conflict"].includes(String(entry.status))) {
            throw new PublicationError("InvalidPublicationState", "Invalid owned registration state");
        }
        assertThingDescription(entry.producer);
        if (entry.producer.id !== id || entry.digest !== producerDigest(entry.producer)) {
            throw new PublicationError("InvalidPublicationState", "Publication producer identity or digest does not match");
        }
        for (const key of ["publishedAt", "freshUntil", "retainUntil"]) {
            if (!Number.isSafeInteger(entry[key]) || Number(entry[key]) < 0) throw new PublicationError("InvalidPublicationState", "Invalid publication timestamp");
        }
        if (entry.expiresAt !== undefined && (!Number.isSafeInteger(entry.expiresAt) || Number(entry.expiresAt) < 0)) {
            throw new PublicationError("InvalidPublicationState", "Invalid expiry timestamp");
        }
        if (entry.etag !== undefined && (typeof entry.etag !== "string" || !/^"[^"\r\n]+"$/u.test(entry.etag))) {
            throw new PublicationError("InvalidPublicationState", "A resource ETag must be a strong HTTP entity tag");
        }
        if (entry.failure !== undefined && (!isRecord(entry.failure) || typeof entry.failure.code !== "string"
            || !Number.isSafeInteger(entry.failure.at) || Number(entry.failure.at) < 0)) throw new PublicationError("InvalidPublicationState", "Invalid stored failure");
        if (entry.intent !== undefined) {
            if (!isRecord(entry.intent)) throw new PublicationError("InvalidPublicationState", "Invalid durable publication intent");
            const intent = entry.intent;
            assertThingDescription(intent.producer);
            if (intent.producer.id !== id || intent.digest !== producerDigest(intent.producer)
                || ["at", "freshUntil", "retainUntil"].some((key) => !Number.isSafeInteger(intent[key])
                    || Number(intent[key]) < 0)) {
                throw new PublicationError("InvalidPublicationState", "Invalid durable publication intent digest or time");
            }
        }
    }
}

function assertNext(previous: PublicationState | null, next: PublicationState): void {
    if (previous && next.revision <= previous.revision) {
        throw new PublicationError("PublicationConflict", "Refusing a stale or repeated publication-state revision");
    }
}

export class MemoryPublicationStore implements PublicationStore {
    private value: PublicationState | null;
    private closed = false;
    constructor(readonly owner: string, initial: PublicationState | null = null) {
        assertOwner(owner);
        if (initial) validateState(initial, owner);
        this.value = structuredClone(initial);
    }
    async load(): Promise<PublicationState | null> {
        if (this.closed) throw new PublicationError("RuntimeClosed", "Publication store is closed");
        return structuredClone(this.value);
    }
    async save(state: PublicationState): Promise<void> {
        if (this.closed) throw new PublicationError("RuntimeClosed", "Publication store is closed");
        validateState(state, this.owner);
        assertNext(this.value, state);
        this.value = structuredClone(state);
    }
    async close(): Promise<void> { this.closed = true; }
}

export class JsonFilePublicationStore implements PublicationStore {
    private readonly file: OwnedJsonFile<PublicationState>;
    private previous: PublicationState | null | undefined;
    private closed = false;
    constructor(readonly owner: string, path: string, maxBytes = 64 * 1024 * 1024) {
        assertOwner(owner);
        this.file = new OwnedJsonFile(path, (value: unknown): asserts value is PublicationState => validateState(value, owner), maxBytes);
    }
    async load(): Promise<PublicationState | null> {
        if (this.closed) throw new PublicationError("RuntimeClosed", "Publication store is closed");
        this.previous ??= await this.file.load();
        return structuredClone(this.previous);
    }
    async save(state: PublicationState): Promise<void> {
        if (this.closed) throw new PublicationError("RuntimeClosed", "Publication store is closed");
        validateState(state, this.owner);
        if (this.previous === undefined) await this.load();
        assertNext(this.previous ?? null, state);
        await this.file.save(state);
        this.previous = structuredClone(state);
    }
    close(): Promise<void> { this.closed = true; return this.file.close(); }
}
