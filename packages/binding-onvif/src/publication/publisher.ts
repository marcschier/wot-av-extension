import type { ThingDescription } from "wot-typescript-definitions";
import {
    assertOwner, boundedInteger, errorCode, matchesProducer, mergeProducer, producerDigest, PublicationError
} from "./common.js";
import { DirectoryClient, type DirectoryRecord, type WriteCondition } from "./directory.js";
import { versionedThing, type ModelPublisher, type PreparedPublication, type PublicationThing } from "./models.js";
import type { PublicationState, PublicationStore, RegistrationState } from "./state.js";

export interface PublicationPolicy {
    readonly freshMs: number;
    readonly graceMs: number;
    readonly renewBeforeMs: number;
}

export interface PublicationChange {
    readonly id: string;
    readonly action: "created" | "updated" | "renewed" | "unchanged" | "stale" | "retired" | "quarantined" | "failed" | "conflict";
    readonly code?: string;
}
export interface PublicationReport {
    readonly inventoryRevision: number;
    readonly publicationRevision: number;
    readonly changes: readonly PublicationChange[];
}
export class PublicationBatchError extends AggregateError {
    readonly code = "PublicationBatchFailed";
    constructor(readonly report: PublicationReport, errors: readonly unknown[]) {
        super(errors, "One or more owned publications failed; no local-output fallback or conflict overwrite");
    }
}

export interface DirectoryPublisherOptions {
    readonly owner: string;
    readonly directory: DirectoryClient;
    readonly models: ModelPublisher;
    readonly state: PublicationStore;
    readonly policy: PublicationPolicy;
    readonly now?: () => number;
}

export class DirectoryPublisher {
    private state: PublicationState | undefined;
    private starting: Promise<void> | undefined;
    private pending: Promise<PublicationReport> | undefined;
    private closing: Promise<void> | undefined;
    private readonly now: () => number;

    constructor(private readonly options: DirectoryPublisherOptions) {
        assertOwner(options.owner);
        boundedInteger(options.policy.freshMs, "publication freshness");
        boundedInteger(options.policy.graceMs, "publication grace");
        boundedInteger(options.policy.renewBeforeMs, "registration renewal window");
        this.now = options.now ?? Date.now;
    }

    start(): Promise<void> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Publisher is closed"));
        this.starting ??= (async () => {
            const previous = await this.options.state.load();
            if (previous && previous.owner !== this.options.owner) throw new PublicationError("PublicationConflict", "Durable state belongs to a different publisher");
            this.state = previous ?? { schemaVersion: 1, owner: this.options.owner, revision: 0, inventoryRevision: -1, registrations: {} };
            await this.options.directory.preflight();
        })();
        return this.starting;
    }

    snapshot(): PublicationState | null { return this.state ? structuredClone(this.state) : null; }

    reconcile(publication: PreparedPublication): Promise<PublicationReport> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Publisher is closed"));
        if (this.pending) return Promise.reject(new PublicationError("PublicationBusy", "Publication reconciliation must be serialized"));
        const work = this.reconcileOwned(publication);
        this.pending = work;
        void work.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
        return work;
    }

    private async persist(): Promise<void> {
        if (!this.state) throw new PublicationError("InvalidPublicationState", "Publisher state is not initialized");
        this.state.revision++;
        await this.options.state.save(this.state);
    }

    private async reconcileOwned(publication: PreparedPublication): Promise<PublicationReport> {
        await this.start();
        const state = this.state;
        if (!state) throw new PublicationError("InvalidPublicationState", "Publisher state is not initialized");
        if (publication.inventoryRevision < state.inventoryRevision) throw new PublicationError("PublicationConflict", "Refusing a superseded inventory revision");
        if (new Set(publication.things.map((thing) => thing.td.id)).size !== publication.things.length
            || publication.things.length > 20000) throw new PublicationError("PublicationLimit", "Duplicate IDs or publication size limit");
        await this.options.models.publish(publication);
        const changes: PublicationChange[] = [], failures: unknown[] = [];
        const desired = new Map(publication.things.map((thing) => [String(thing.td.id), thing]));
        const deviceSummaries = new Map(publication.things.map((thing) => [thing.deviceId, thing.td["onvif:discovery"]]));
        const ids = [...new Set([...desired.keys(), ...Object.keys(state.registrations)])].sort();
        for (const id of ids) {
            const candidate = desired.get(id);
            const previous = state.registrations[id];
            try {
                if (candidate?.quarantined || previous?.status === "conflict") {
                    changes.push({ id, action: "quarantined", code: "IdentityOrPublicationConflict" });
                    continue;
                }
                if (!candidate && (!previous || previous.status === "retired")) continue;
                const summary = previous ? deviceSummaries.get(previous.deviceId) : undefined;
                const change = await this.reconcileThing(id, candidate, previous, summary);
                changes.push(change);
            } catch (error) {
                const code = errorCode(error), record = state.registrations[id];
                if (record) {
                    record.failure = { code, at: this.now() };
                    if (code === "DirectoryConflict" || code === "PublicationConflict") record.status = "conflict";
                    await this.persist();
                }
                changes.push({ id, action: code === "DirectoryConflict" || code === "PublicationConflict" ? "conflict" : "failed", code });
                failures.push(error);
            }
        }
        state.inventoryRevision = publication.inventoryRevision;
        await this.persist();
        const report: PublicationReport = { inventoryRevision: publication.inventoryRevision, publicationRevision: state.revision, changes };
        if (failures.length) throw new PublicationBatchError(report, failures);
        return report;
    }

    private condition(record: DirectoryRecord): WriteCondition {
        if (this.options.directory.contract.ownership.mode === "single-writer") return { singleWriter: true };
        if (!record.etag) throw new PublicationError("UnsupportedDirectory", "Owned update/delete has no resource CAS tag");
        return { etag: record.etag };
    }

    private assertOwned(remote: DirectoryRecord, previous: RegistrationState | undefined): void {
        if (!previous || (!matchesProducer(remote.td, previous.producer)
            && !(previous.intent && matchesProducer(remote.td, previous.intent.producer)))) {
            throw new PublicationError("DirectoryConflict", "Remote producer content is not this publisher's durable owned revision");
        }
    }

    private async reconcileThing(id: string, candidate: PublicationThing | undefined,
        previous: RegistrationState | undefined, summary: unknown): Promise<PublicationChange> {
        const now = this.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new PublicationError("InvalidConfiguration", "Publication clock must return epoch milliseconds");
        if (candidate?.observedAt !== null && candidate?.observedAt !== undefined && candidate.observedAt > now) {
            throw new PublicationError("InvalidSnapshot", "Future observation timestamps cannot prolong registration TTL");
        }
        let remote = await this.options.directory.get(id);
        if (remote) this.assertOwned(remote, previous);
        if (previous?.intent && remote && matchesProducer(remote.td, previous.intent.producer)) {
            if (this.options.directory.contract.expiry.mode === "registration-ttl"
                && (remote.expiresAt === undefined || remote.expiresAt > previous.intent.retainUntil + 1000
                    || remote.expiresAt <= now)) {
                throw new PublicationError("UnsupportedDirectory", "Recovered Directory expiry does not honor the durable observation lease");
            }
            previous.producer = previous.intent.producer;
            previous.digest = previous.intent.digest;
            previous.freshUntil = previous.intent.freshUntil;
            previous.retainUntil = previous.intent.retainUntil;
            previous.publishedAt = previous.intent.at;
            delete previous.intent;
            delete previous.failure;
            previous.status = now < previous.freshUntil ? "active" : "stale";
            if (remote.etag) previous.etag = remote.etag;
            if (remote.expiresAt !== undefined) previous.expiresAt = remote.expiresAt;
            await this.persist();
        }
        const confirmed = candidate?.observedAt !== null && candidate?.observedAt !== undefined;
        const observedAt = confirmed ? candidate.observedAt : null;
        const freshUntil = observedAt === null ? previous?.freshUntil ?? 0 : observedAt + this.options.policy.freshMs;
        const retainUntil = observedAt === null ? previous?.retainUntil ?? 0 : freshUntil + this.options.policy.graceMs;
        if (!previous && observedAt === null) return { id, action: "stale", code: "NoConfirmedNativeObservation" };
        if (now >= retainUntil || (!candidate && !previous)) return this.retire(id, remote, previous);
        const stale = !confirmed || now >= freshUntil;
        const native = confirmed && candidate ? candidate.td : previous?.producer ?? candidate?.td;
        if (!native) throw new PublicationError("InvalidPublicationState", "Missing current or retained producer TD");
        const td: ThingDescription = structuredClone(native);
        if (stale) {
            const currentSummary = candidate?.td["onvif:discovery"] ?? summary;
            if (currentSummary !== undefined) td["onvif:discovery"] = currentSummary;
        }
        td["onvif:publication"] = {
            state: stale ? "stale" : "current", freshUntil, retainUntil,
            lastConfirmedAt: observedAt ?? freshUntil - this.options.policy.freshMs,
            semantics: stale ? "Last-known native Forms, not a fresh observation or absence claim." : "Inspection freshness is separate from registration liveness."
        };
        const producer = versionedThing(td), hash = producerDigest(producer);
        const expiry = this.options.directory.contract.expiry;
        const ttl = expiry.mode === "registration-ttl" ? Math.min(expiry.ttlSeconds, Math.floor((retainUntil - now) / 1000)) : undefined;
        if (ttl !== undefined && ttl < 1) {
            if (previous && remote?.expiresAt !== undefined && remote.expiresAt >= retainUntil
                && remote.expiresAt <= retainUntil + 1000) {
                previous.status = stale ? "stale" : "active";
                return { id, action: stale ? "stale" : "unchanged" };
            }
            throw new PublicationError("UnsupportedDirectory", "Remaining observation lease cannot be represented by a positive whole-second TTL");
        }
        const needsContent = !remote || !previous || hash !== previous.digest || previous.status === "pending" || previous.status === "retired";
        const needsRenewal = remote && expiry.mode === "registration-ttl"
            && (remote.expiresAt === undefined || remote.expiresAt <= now + this.options.policy.renewBeforeMs);
        if (!needsContent && !needsRenewal) {
            if (previous) {
                previous.status = stale ? "stale" : "active";
                if (remote?.etag) previous.etag = remote.etag;
                if (remote?.expiresAt !== undefined) previous.expiresAt = remote.expiresAt;
                delete previous.failure;
            }
            return { id, action: stale ? "stale" : "unchanged" };
        }
        const record: RegistrationState = previous ?? {
            deviceId: candidate?.deviceId ?? "", producer, digest: hash, publishedAt: 0,
            freshUntil, retainUntil, status: "pending"
        };
        record.intent = { producer, digest: hash, at: now, freshUntil, retainUntil };
        if (!this.state) throw new PublicationError("InvalidPublicationState", "Publisher is not initialized");
        this.state.registrations[id] = record;
        await this.persist();
        if (needsContent || expiry.mode !== "registration-ttl" || !expiry.patch || !remote) {
            await this.options.directory.put(mergeProducer(remote?.td ?? null, previous?.producer, producer),
                remote ? this.condition(remote) : { create: true }, ttl);
        } else {
            await this.options.directory.renew(id, this.condition(remote), ttl);
        }
        const created = remote === null;
        remote = await this.options.directory.get(id);
        if (!remote || !matchesProducer(remote.td, producer)) throw new PublicationError("DirectoryConflict", "Directory did not retain the confirmed producer revision after write");
        if (expiry.mode === "registration-ttl" && (remote.expiresAt === undefined || remote.expiresAt > retainUntil + 1000
            || remote.expiresAt <= now)) {
            throw new PublicationError("UnsupportedDirectory", "Directory expiry does not honor the bounded observation lease");
        }
        record.producer = producer;
        record.digest = hash;
        record.publishedAt = now;
        record.freshUntil = freshUntil;
        record.retainUntil = retainUntil;
        record.status = stale ? "stale" : "active";
        if (remote.etag) record.etag = remote.etag;
        if (remote.expiresAt !== undefined) record.expiresAt = remote.expiresAt;
        delete record.intent; delete record.failure;
        await this.persist();
        return { id, action: created ? "created" : stale ? "stale" : needsContent ? "updated" : "renewed" };
    }

    private async retire(id: string, remote: DirectoryRecord | null, previous: RegistrationState | undefined): Promise<PublicationChange> {
        if (remote) {
            this.assertOwned(remote, previous);
            await this.options.directory.delete(id, this.condition(remote));
        }
        if (previous) {
            previous.status = "retired";
            delete previous.failure; delete previous.intent;
            await this.persist();
        }
        return { id, action: "retired" };
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            await Promise.allSettled([...(this.starting ? [this.starting] : []), ...(this.pending ? [this.pending] : [])]);
            const results = await Promise.allSettled([this.options.directory.close(), this.options.models.close(), this.options.state.close()]);
            const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "Publisher cleanup failed");
        })();
        return this.closing;
    }
}
