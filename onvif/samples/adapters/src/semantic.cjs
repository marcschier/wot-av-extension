"use strict";

const { SourceFault, asFault, demand } = require("./fault.cjs");
const { normalizeLimits, jpegDimensions, u64, modeIdValid } = require("./backend.cjs");

class SemanticAdapter {
    constructor({ canonical, thingId, profile, modeId, createSemanticAdapterTd,
        evidence = [{ sourceId: "operator-configuration", detail: "Configured adapter semantics; not hardware qualification." }],
        title = "Native camera semantic adapter", limits = {}, clock = () => process.hrtime.bigint() }) {
        demand(typeof thingId === "string" && /^urn:[A-Za-z0-9:._-]{1,160}$/.test(thingId), "InvalidSelection", "open");
        this.canonical = canonical;
        demand(typeof createSemanticAdapterTd === "function", "MissingDependency", "open");
        this.createSemanticAdapterTd = createSemanticAdapterTd;
        this.evidence = structuredClone(evidence);
        this.title = title;
        this.thingId = thingId;
        this.clock = clock;
        this.limits = normalizeLimits(limits);
        this.cache = null;
        this.unavailableFault = new SourceFault("SourceUnavailable", "snapshot");
        this.uri = null;
        this.inFlight = new Map();
        this.inFlightBytes = 0;
        this.dropped = 0n;
        this.configureProfile(profile, modeId);
    }
    configureProfile(profile, modeId) {
        demand(Buffer.byteLength(JSON.stringify(profile)) <= 32768, "ResourceLimit", "GetProfiles");
        this.canonical.profiles.output({ Profiles: [profile] });
        demand(modeIdValid(modeId), "InvalidSelection", "open");
        if (this.profile) {
            demand(this.profile.$attributes.token === profile.$attributes.token, "IdentityChanged", "open");
        }
        this.profile = structuredClone(profile);
        this.modeId = modeId;
        this.unavailable(new SourceFault("SourceUnavailable", "snapshot"));
    }
    getProfiles(input) {
        const request = this.canonical.profiles.input(input);
        demand(request.Token === undefined || request.Token === this.profile.$attributes.token,
            "UnknownProfileToken", "GetProfiles");
        const profile = structuredClone(this.profile);
        const requested = request.Type ?? [];
        if (!requested.length) delete profile.Configurations;
        else if (!(requested.length === 1 && requested[0] === "All") && profile.Configurations) {
            profile.Configurations = Object.fromEntries(Object.entries(profile.Configurations)
                .filter(([name]) => requested.includes(name)));
        }
        return this.canonical.profiles.output({ Profiles: [profile] });
    }
    setSnapshotUri(uri) {
        const parsed = new URL(uri);
        demand(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"
            && !parsed.username && !parsed.password && !parsed.search && !parsed.hash, "PolicyDenied", "GetSnapshotUri");
        demand(this.uri === null || this.uri === uri, "IdentityChanged", "GetSnapshotUri");
        this.canonical.snapshot.output({ Uri: uri });
        this.uri = uri;
    }
    getSnapshotUri(input) {
        const request = this.canonical.snapshot.input(input);
        demand(request.ProfileToken === this.profile.$attributes.token, "UnknownProfileToken", "GetSnapshotUri");
        demand(this.uri !== null, "SourceUnavailable", "GetSnapshotUri");
        return this.canonical.snapshot.output({ Uri: this.uri });
    }
    accept(frame) {
        demand(frame.kind === "frame" && frame.modeId === this.modeId && frame.format === "JPEG"
            && frame.data instanceof Uint8Array && frame.payloadBytes === frame.data.byteLength
            && frame.payloadBytes <= this.limits.maxFrameBytes && u64(frame.freshnessOriginMonotonicNs),
        "UnsupportedFormat", "snapshot");
        const dimensions = jpegDimensions(frame.data);
        demand(dimensions.width === frame.width && dimensions.height === frame.height
            && frame.width <= this.limits.maxWidth && frame.height <= this.limits.maxHeight,
        "ResourceLimit", "snapshot");
        demand(BigInt(frame.freshnessOriginMonotonicNs) <= this.clock(), "ProtocolError", "snapshot");
        if (frame.payloadBytes + this.inFlightBytes > this.limits.maxQueuedBytes) {
            this.dropped++;
            return { kind: "gap", generation: frame.generation, dropped: this.dropped.toString(), reason: "overflow" };
        }
        this.cache = { data: Uint8Array.from(frame.data), origin: BigInt(frame.freshnessOriginMonotonicNs) };
        this.unavailableFault = null;
        return { kind: "accepted" };
    }
    unavailable(fault = new SourceFault("SourceUnavailable", "snapshot")) {
        this.cache = null;
        this.unavailableFault = asFault(fault, "snapshot");
    }
    acquireSnapshot(subscriber) {
        demand(typeof subscriber === "string" && subscriber.length <= 64, "PermissionDenied", "snapshot");
        if (!this.cache) throw new SourceFault(this.unavailableFault?.code ?? "SourceUnavailable", "snapshot");
        const age = this.clock() - this.cache.origin;
        demand(age >= 0n && age <= BigInt(this.limits.maxSnapshotAgeMs) * 1000000n, "StaleFrame", "snapshot");
        demand(!this.inFlight.has(subscriber)
            && this.inFlight.size < Math.min(this.limits.maxSubscribers, this.limits.maxQueuedFrames),
        "Busy", "snapshot");
        const size = this.cache.data.byteLength;
        demand(this.inFlightBytes + size + size <= this.limits.maxQueuedBytes, "ResourceLimit", "snapshot");
        const data = Uint8Array.from(this.cache.data);
        this.inFlight.set(subscriber, size);
        this.inFlightBytes += size;
        let released = false;
        return {
            data,
            release: () => {
                if (released) return;
                released = true;
                this.inFlight.delete(subscriber);
                this.inFlightBytes -= size;
            }
        };
    }
    tdTemplate(origin) {
        const base = origin + "/" + encodeURIComponent(this.thingId);
        const projection = this.createSemanticAdapterTd({
            id: this.thingId, title: this.title, modelId: origin + "/models/" + encodeURIComponent(this.thingId) + ".tm.json",
            origin, evidence: this.evidence
        });
        demand(projection?.td?.links?.filter(link => link.rel === "type").length === 1
            && projection.model?.id === projection.td.links.find(link => link.rel === "type").href,
        "ProtocolError", "open");
        this.model = structuredClone(projection.model);
        const td = {
            ...structuredClone(projection.td),
            properties: {
                snapshot: {
                    type: "string", readOnly: true, observable: false,
                    description: "Latest already-acquired JPEG. Reads never open or trigger a camera; stale or unavailable frames fail.",
                    security: ["image"],
                    forms: [{
                        href: base + "/properties/snapshot", contentType: "image/jpeg",
                        op: "readproperty", "htv:methodName": "GET", security: ["image"]
                    }]
                }
            }
        };
        delete td["onvif:projectionDigest"];
        delete td.version;
        return td;
    }
}

async function pump(session, adapter, signal) {
    let fault = null;
    try {
        while (!signal?.aborted) {
            const result = await session.next(signal);
            if (result.kind === "end") {
                adapter.unavailable(new SourceFault("SourceUnavailable", "snapshot"));
                break;
            }
            if (result.kind === "gap") { adapter.dropped++; continue; }
            adapter.accept(result);
        }
    } catch (error) {
        fault = asFault(error, "next");
        adapter.unavailable(fault);
    } finally {
        adapter.unavailable(fault ?? new SourceFault("SourceUnavailable", "snapshot"));
    }
    const close = await session.close(signal?.aborted ? "cancelled" : "pump-ended");
    const expectedCancellation = fault?.code === "Cancelled"
        && (signal?.aborted || session.closeReason === "duration-expired");
    return {
        status: close.status !== "closed" || fault && !expectedCancellation ? "failed" : "closed",
        fault: fault?.toJSON() ?? null, close
    };
}

module.exports = { SemanticAdapter, pump };
