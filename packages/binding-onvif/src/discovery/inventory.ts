import { createHash } from "node:crypto";
import { equalQName } from "../xml/types.js";
import { OnvifError } from "../binding/errors.js";
import { approveXAddr, assertJson } from "./policy.js";
import { endpointIdentity } from "./protocol.js";
import type {
    Bounds, Clock, CuratedConformanceEvidence, DeviceSnapshot, Diagnostic, DiscoveryEndpointReference,
    DiscoveryMatch, DiscoveryMessage, EndpointObservation, IdentityEvidence, InspectionReport, InspectionToken,
    InventorySnapshot, Observation, ProfileClaim, Provenance, ResourceInventory, SeedSnapshot, Timers
} from "./types.js";

function unknown<T>(at: number): Observation<T> {
    return { status: "unknown", code: "NotInspected", message: "No confirmed native observation", observedAt: at };
}

function retained<T>(previous: Observation<T>, next: Observation<T>): Observation<T> {
    if (next.status === "known") return structuredClone(next);
    const lastKnown = previous.status === "known" ? {
        value: previous.value, observedAt: previous.observedAt, ...(previous.source ? { source: previous.source } : {})
    } : previous.lastKnown;
    return lastKnown === undefined ? structuredClone(next) : { ...structuredClone(next), lastKnown: structuredClone(lastKnown) };
}

export function profileClaims(scopes: readonly string[], source: ProfileClaim["source"], at: number): ProfileClaim[] {
    const claims: ProfileClaim[] = [];
    for (const scope of scopes) {
        const match = /^onvif:\/\/www\.onvif\.org\/(?:Profile|profile)\/([^/?#]+)$/u.exec(scope);
        if (match?.[1]) claims.push({ scope, label: match[1], source, observedAt: at });
    }
    return claims;
}

function provenanceKey(value: Provenance): string {
    return JSON.stringify([value.interfaceId, value.segmentId, value.family, value.address, value.port]);
}

function inventoryKey(value: ResourceInventory): string {
    return JSON.stringify([value.namespace, value.xaddr, value.kind]);
}

export class Inventory {
    private readonly devices = new Map<string, DeviceSnapshot>();
    private readonly seeds = new Map<string, SeedSnapshot>();
    private readonly messages = new Map<string, { fingerprint: string; deviceIds: string[] }>();
    private diagnostics: Diagnostic[] = [];
    private revision = 0;
    private truncated = false;

    constructor(
        private readonly bounds: Readonly<Bounds>,
        private readonly timers: Readonly<Timers>,
        private readonly allowed: ReadonlySet<string>,
        private readonly clock: Clock
    ) {}

    restore(snapshot: InventorySnapshot): void {
        if (this.devices.size || this.seeds.size || this.revision) throw new OnvifError("InvalidValue", "Inventory restore is only valid before use");
        if (snapshot.devices.length > this.bounds.maxDevices || snapshot.seeds.length > this.bounds.maxDevices) {
            throw new OnvifError("InvalidValue", "Persisted inventory exceeds the configured device bound");
        }
        this.revision = snapshot.revision;
        this.truncated = snapshot.truncated;
        this.diagnostics = structuredClone(snapshot.diagnostics).slice(-this.bounds.maxDiagnostics);
        for (const original of snapshot.devices) {
            const device = structuredClone(original);
            device.inspectionGeneration++;
            for (const endpoint of device.endpoints) {
                endpoint.approval = approveXAddr(endpoint.xaddr, this.allowed) ? "approved" : "unapproved";
            }
            this.devices.set(device.id, device);
        }
        for (const seed of snapshot.seeds) this.seeds.set(seed.seedId, structuredClone(seed));
        this.revision++;
    }

    snapshot(): InventorySnapshot {
        return structuredClone(this.view());
    }

    private view(): InventorySnapshot {
        return {
            schemaVersion: 1, revision: this.revision, capturedAt: this.clock.now(),
            devices: [...this.devices.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
            seeds: [...this.seeds.values()].sort((a, b) => a.seedId < b.seedId ? -1 : a.seedId > b.seedId ? 1 : 0),
            diagnostics: this.diagnostics, truncated: this.truncated
        };
    }

    private fits(reserved = 0): boolean {
        try {
            assertJson(this.view(), Math.max(20000, this.bounds.maxStoreBytes), 64, this.bounds.maxStoreBytes - reserved);
            return true;
        } catch (error) {
            if (error instanceof OnvifError && error.code === "XmlLimit") return false;
            throw error;
        }
    }

    private fitsData(): boolean {
        return this.fits(Math.min(1024, Math.floor(this.bounds.maxStoreBytes / 4)));
    }

    device(id: string): DeviceSnapshot | undefined {
        const device = this.devices.get(id);
        return device ? structuredClone(device) : undefined;
    }

    diagnostic(code: string, message: string, deviceId?: string, truncated = false): void {
        const finding: Diagnostic = { code, message, at: this.clock.now(), ...(deviceId ? { deviceId } : {}) };
        this.diagnostics.push(finding);
        if (this.diagnostics.length > this.bounds.maxDiagnostics) this.diagnostics.shift();
        const device = deviceId ? this.devices.get(deviceId) : undefined;
        if (device) {
            device.diagnostics.push(finding);
            if (device.diagnostics.length > this.bounds.maxDiagnostics) device.diagnostics.shift();
        }
        this.truncated ||= truncated;
        this.revision++;
        while (!this.fits() && (this.diagnostics.length || device?.diagnostics.length)) {
            this.truncated = true;
            if (this.diagnostics.length) this.diagnostics.shift();
            if (device?.diagnostics.length) device.diagnostics.shift();
        }
    }

    private create(endpoint: DiscoveryEndpointReference): DeviceSnapshot | undefined {
        const id = endpointIdentity(endpoint);
        const existing = this.devices.get(id);
        if (existing) return existing;
        if (this.devices.size >= this.bounds.maxDevices) {
            this.diagnostic("CandidateLimit", "Additional identities were not admitted; inventory is incomplete", undefined, true);
            return undefined;
        }
        const now = this.clock.now();
        const device: DeviceSnapshot = {
            id, endpointReference: structuredClone(endpoint), state: "candidate", identityConflict: false, epoch: 0, inspectionGeneration: 0,
            ordering: { instanceId: null, sequences: [] }, metadataVersion: null, types: [], scopes: [], claims: [],
            endpoints: [], provenance: [], seenAt: now, verifiedAt: null, updatedAt: now, suspectSince: null,
            failedLivenessRounds: 0, lastLivenessRound: null, information: unknown(now), services: unknown(now),
            reads: [], resources: [], observedFeatures: [], identityEvidence: [], registryEvidence: [], diagnostics: []
        };
        this.devices.set(id, device);
        this.revision++;
        return device;
    }

    private mergeProvenance(list: Provenance[], incoming: Provenance): boolean {
        if (list.some((item) => provenanceKey(item) === provenanceKey(incoming))) return false;
        if (list.length >= this.bounds.maxProvenance) {
            this.diagnostic("ProvenanceLimit", "Additional interface provenance was not retained", undefined, true);
            return false;
        }
        list.push(structuredClone(incoming));
        return true;
    }

    private mergeEndpoints(device: DeviceSnapshot, xaddrs: readonly string[], provenance: Provenance): boolean {
        let changed = false;
        for (const xaddr of xaddrs) {
            let endpoint = device.endpoints.find((item) => item.xaddr === xaddr);
            if (!endpoint) {
                if (device.endpoints.length >= this.bounds.maxXAddrs) {
                    this.diagnostic("EndpointLimit", "Additional native endpoints were not admitted", device.id, true);
                    continue;
                }
                let approval: EndpointObservation["approval"];
                try { approval = approveXAddr(xaddr, this.allowed) ? "approved" : "unapproved"; }
                catch (error) {
                    if (!(error instanceof OnvifError)) throw error;
                    this.diagnostic("RejectedXAddr", "A discovery XAddr failed the native target policy", device.id);
                    continue;
                }
                endpoint = { xaddr, approval, provenance: [] };
                device.endpoints.push(endpoint);
                changed = true;
            }
            this.mergeProvenance(endpoint.provenance, provenance);
        }
        this.mergeProvenance(device.provenance, provenance);
        return changed;
    }

    private fingerprint(message: DiscoveryMessage): string {
        return createHash("sha256").update(JSON.stringify(message)).digest("hex");
    }

    observeDuplicate(message: DiscoveryMessage, provenance: Provenance): boolean {
        const prior = this.messages.get(message.messageId);
        if (!prior) return false;
        if (prior.fingerprint !== this.fingerprint(message)) {
            this.diagnostic("MessageIdCollision", "Repeated MessageID has contradictory content");
            return true;
        }
        for (const id of prior.deviceIds) {
            const device = this.devices.get(id);
            const match = message.matches.find((item) => endpointIdentity(item.endpointReference) === id);
            if (!device || !match) continue;
            let changed = this.mergeProvenance(device.provenance, provenance);
            for (const endpoint of device.endpoints) {
                if (match.xaddrs.includes(endpoint.xaddr)) changed = this.mergeProvenance(endpoint.provenance, provenance) || changed;
            }
            if (changed) this.revision++;
        }
        return true;
    }

    observe(message: DiscoveryMessage, provenance: Provenance, fingerprintSource = message): string[] {
        if (message.discoveryProxy) {
            this.diagnostic("DiscoveryProxyUnapproved", "Proxy announcement is separate from device discovery and does not suppress probes");
            return [];
        }
        if (this.observeDuplicate(message, provenance)) return [];
        const admitted: string[] = [];
        for (const match of message.matches) {
            const id = endpointIdentity(match.endpointReference);
            let device = this.devices.get(id);
            const prior = device ? structuredClone(device) : undefined;
            if (!device && message.kind === "Bye") continue;
            device ??= this.create(match.endpointReference);
            if (!device || !this.order(device, message)) continue;
            const changed = this.mergeMetadata(device, match, message, provenance);
            if (changed) {
                device.inspectionGeneration++;
                if (device.state === "verified") device.state = "candidate";
            }
            device.updatedAt = this.clock.now();
            if (!this.fitsData()) {
                if (prior) this.devices.set(id, prior);
                else this.devices.delete(id);
                this.diagnostic("InventoryByteLimit", "Additional discovery metadata was not admitted to the bounded inventory", undefined, true);
                continue;
            }
            admitted.push(id);
            this.revision++;
        }
        this.messages.set(message.messageId, { fingerprint: this.fingerprint(fingerprintSource), deviceIds: admitted });
        if (this.messages.size > this.bounds.maxMessageIds) {
            const first = this.messages.keys().next().value;
            if (first !== undefined) this.messages.delete(first);
        }
        return admitted;
    }

    private order(device: DeviceSnapshot, message: DiscoveryMessage): boolean {
        const sequence = message.sequence;
        if (!sequence) {
            this.diagnostic("UnsequencedCandidate", "Unsequenced compatibility traffic cannot replace ordered state", device.id);
            return device.ordering.instanceId === null && device.verifiedAt === null && message.kind !== "Bye";
        }
        const prior = device.ordering.instanceId;
        if (prior !== null && BigInt(sequence.instanceId) < BigInt(prior)) {
            this.diagnostic("OldInstance", "Delayed message from an older device epoch was ignored", device.id);
            return false;
        }
        if (prior === null || BigInt(sequence.instanceId) > BigInt(prior)) {
            device.ordering = { instanceId: sequence.instanceId, sequences: [] };
            device.epoch++;
            device.inspectionGeneration++;
            if (device.state !== "conflict") device.state = "candidate";
        }
        const watermark = device.ordering.sequences.find((item) => item.sequenceId === sequence.sequenceId);
        if (watermark && BigInt(sequence.messageNumber) <= BigInt(watermark.messageNumber)) {
            this.diagnostic("OldMessageNumber", "Duplicate or older message in the same sequence was ignored", device.id);
            return false;
        }
        if (!watermark && device.ordering.sequences.length >= this.bounds.maxSequenceIds) {
            this.diagnostic("SequenceLimit", "New incomparable sequence was not admitted; existing watermarks retained", device.id, true);
            return false;
        }
        const other = device.ordering.sequences.filter((item) => item.sequenceId !== sequence.sequenceId);
        if (other.some((item) => (item.kind === "Bye") !== (message.kind === "Bye"))) {
            device.state = "conflict";
            this.diagnostic("IncomparablePresence", "Different SequenceIds contradict presence; arrival time cannot resolve them", device.id);
        }
        if (watermark) {
            watermark.messageNumber = sequence.messageNumber;
            watermark.kind = message.kind;
        } else {
            device.ordering.sequences.push({
                sequenceId: sequence.sequenceId, messageNumber: sequence.messageNumber, kind: message.kind
            });
        }
        return true;
    }

    private mergeMetadata(device: DeviceSnapshot, match: DiscoveryMatch, message: DiscoveryMessage, provenance: Provenance): boolean {
        let changed = this.mergeEndpoints(device, match.xaddrs, provenance);
        if (match.metadataVersion !== null) {
            if (device.metadataVersion !== null && BigInt(match.metadataVersion) < BigInt(device.metadataVersion)) {
                this.diagnostic("MetadataRegression", "MetadataVersion decreased, including across restart; prior watermark retained", device.id);
            } else if (match.metadataVersion !== device.metadataVersion) {
                device.metadataVersion = match.metadataVersion;
                changed = true;
            }
        }
        for (const type of match.types) {
            if (device.types.some((item) => equalQName(item, type))) continue;
            if (device.types.length >= this.bounds.maxTypes) {
                this.diagnostic("TypeLimit", "Additional type claims were not retained", device.id, true);
                break;
            }
            device.types.push(structuredClone(type));
        }
        for (const scope of match.scopes) {
            if (device.scopes.includes(scope)) continue;
            if (device.scopes.length >= this.bounds.maxScopes) {
                this.diagnostic("ScopeLimit", "Additional scope claims were not retained", device.id, true);
                break;
            }
            device.scopes.push(scope);
        }
        for (const claim of profileClaims(match.scopes, "discovery-scope", this.clock.now())) {
            const index = device.claims.findIndex((existing) => existing.scope === claim.scope);
            if (index >= 0) device.claims[index] = claim;
            else if (device.claims.length < this.bounds.maxScopes) device.claims.push(claim);
        }
        if (message.kind === "Bye") {
            if (device.state !== "conflict") device.state = "suspect";
            device.suspectSince ??= this.clock.now();
            changed = true;
        } else {
            if (message.sequence) device.seenAt = this.clock.now();
            if (device.state === "departed") {
                device.state = "candidate";
                changed = true;
            }
        }
        return changed;
    }

    beginInspection(deviceId: string): InspectionToken {
        const device = this.devices.get(deviceId);
        if (!device) throw new OnvifError("InvalidValue", "Unknown inspection identity");
        device.inspectionGeneration++;
        this.revision++;
        return { deviceId, epoch: device.epoch, generation: device.inspectionGeneration };
    }

    commitInspection(token: InspectionToken, report: InspectionReport): boolean {
        const device = this.devices.get(token.deviceId);
        if (!device || token.epoch !== device.epoch || token.generation !== device.inspectionGeneration) {
            this.diagnostic("SupersededInspection", "Inspection belongs to a superseded device epoch or generation", token.deviceId);
            return false;
        }
        const previous = structuredClone(device);
        if (device.identityConflict) {
            this.diagnostic("IdentityQuarantined", "Identity conflict requires out-of-band reconciliation; a new arrival cannot auto-approve it", device.id);
            return false;
        }
        if (report.endpointReference.status === "known"
            && endpointIdentity(report.endpointReference.value) !== device.id) {
            device.state = "conflict";
            device.identityConflict = true;
            this.diagnostic("EndpointIdentityConflict", "Native inspection disagrees with the discovered endpoint identity", device.id);
            return false;
        }
        if (!this.addIdentityEvidence(device, report.identityEvidence)) return false;
        const priorServices = device.services.status === "known" ? device.services.value : device.services.lastKnown?.value;
        device.information = retained(device.information, report.information);
        device.services = retained(device.services, report.services);
        if (device.services.status === "known") {
            for (const service of device.services.value) {
                const previous = priorServices?.find((item) => item.namespace === service.namespace && item.xaddr === service.xaddr);
                if (previous) service.capabilities = retained(previous.capabilities, service.capabilities);
            }
        }
        device.reads = structuredClone(report.reads).slice(0, this.bounds.maxRequestsPerInspection);
        for (const incoming of report.resources) {
            const existing = device.resources.find((item) => inventoryKey(item) === inventoryKey(incoming));
            if (existing) existing.outcome = retained(existing.outcome, incoming.outcome);
            else if (device.resources.length < this.bounds.maxServices * 16) device.resources.push(structuredClone(incoming));
            else this.diagnostic("ResourceInventoryLimit", "Additional resource inventories were not retained", device.id, true);
        }
        device.observedFeatures = structuredClone(report.observedFeatures);
        if (report.scopes.status === "known") {
            device.scopes = report.scopes.value.slice(0, this.bounds.maxScopes);
            device.claims = profileClaims(device.scopes, "GetScopes", report.scopes.observedAt);
        }
        if (report.endpointReference.status === "known" && report.information.status === "known") {
            device.verifiedAt = report.completedAt;
            device.state = "verified";
            device.suspectSince = null;
        }
        if (report.responsive) device.failedLivenessRounds = 0;
        this.truncated ||= report.truncated;
        device.updatedAt = report.completedAt;
        this.updateRegistryEvidence(device);
        if (!this.fitsData()) {
            this.devices.set(device.id, previous);
            this.diagnostic("InventoryByteLimit", "Inspection did not replace confirmed data because the total inventory byte bound was reached", device.id, true);
            return false;
        }
        this.revision++;
        return true;
    }

    private addIdentityEvidence(device: DeviceSnapshot, incoming: readonly IdentityEvidence[]): boolean {
        let conflict = false;
        for (const evidence of incoming) {
            if (device.identityEvidence.some((prior) => prior.authority === evidence.authority && prior.subject !== evidence.subject)) {
                conflict = true;
            }
            if (!device.identityEvidence.some((prior) => prior.authority === evidence.authority
                && prior.subject === evidence.subject && prior.xaddr === evidence.xaddr)) {
                if (device.identityEvidence.length >= this.bounds.maxProvenance) {
                    this.diagnostic("IdentityEvidenceLimit", "Additional identity evidence requires operator reconciliation", device.id, true);
                    conflict = true;
                } else {
                    device.identityEvidence.push(structuredClone(evidence));
                    if (!this.fitsData()) {
                        device.identityEvidence.pop();
                        this.diagnostic("IdentityEvidenceLimit", "Identity evidence exceeded the total inventory byte bound", device.id, true);
                        conflict = true;
                    }
                }
            }
        }
        const priorConflict = device.identityEvidence.some((evidence) => device.identityEvidence.some((prior) =>
            prior.authority === evidence.authority && prior.subject !== evidence.subject));
        if (conflict || priorConflict) {
            device.state = "conflict";
            device.identityConflict = true;
            this.diagnostic("CloneIdentityConflict", "Contradictory authenticated or provisioned identities share this EPR", device.id);
            return false;
        }
        return true;
    }

    addRegistryEvidence(deviceId: string, evidence: Omit<CuratedConformanceEvidence, "status">): void {
        const device = this.devices.get(deviceId);
        if (!device || evidence.endpointAddress !== device.endpointReference.address || device.registryEvidence.length >= 32) {
            throw new OnvifError("InvalidValue", "Curated evidence must be bounded and identify an existing EPR");
        }
        device.registryEvidence.push({ ...structuredClone(evidence), status: "unverified" });
        this.updateRegistryEvidence(device);
        if (!this.fitsData()) {
            device.registryEvidence.pop();
            throw new OnvifError("XmlLimit", "Curated evidence exceeds the total inventory byte bound");
        }
        this.revision++;
    }

    private updateRegistryEvidence(device: DeviceSnapshot): void {
        for (const evidence of device.registryEvidence) {
            evidence.status = device.information.status !== "known" ? "unverified"
                : device.information.value.firmwareVersion === evidence.firmwareVersion ? "matched" : "firmware-mismatch";
        }
    }

    liveness(deviceId: string, round: number, responsive: boolean, confirmedTimeout: boolean): void {
        const device = this.devices.get(deviceId);
        if (!device || (device.lastLivenessRound !== null && round <= device.lastLivenessRound)) return;
        device.lastLivenessRound = round;
        if (responsive) device.failedLivenessRounds = 0;
        else if (confirmedTimeout) device.failedLivenessRounds++;
        this.revision++;
    }

    reconcile(): void {
        const now = this.clock.now();
        for (const device of this.devices.values()) {
            if (device.state === "conflict" || device.state === "departed") continue;
            const staleAt = (device.verifiedAt ?? device.seenAt) + this.timers.staleMs;
            if (now >= staleAt && device.state !== "suspect") {
                device.state = "stale";
                device.suspectSince ??= staleAt;
                this.revision++;
            }
            if (device.suspectSince !== null && now - device.suspectSince >= this.timers.departureGraceMs
                && device.failedLivenessRounds >= 2) {
                device.state = "departed";
                device.inspectionGeneration++;
                device.updatedAt = now;
                this.revision++;
            }
        }
    }

    addSeed(seed: Omit<SeedSnapshot, "resolvedDeviceId" | "outcome">): void {
        if (this.seeds.has(seed.seedId)) return;
        if (this.seeds.size >= this.bounds.maxDevices) throw new OnvifError("InvalidConfiguration", "Seed capacity exceeded");
        this.seeds.set(seed.seedId, { ...structuredClone(seed), resolvedDeviceId: null, outcome: unknown(this.clock.now()) });
        if (!this.fitsData()) {
            this.seeds.delete(seed.seedId);
            throw new OnvifError("XmlLimit", "Provisional seeds exceed the total inventory byte bound");
        }
        this.revision++;
    }

    inspectSeed(seedId: string, report: InspectionReport, provenance: Provenance): string | null {
        const seed = this.seeds.get(seedId);
        if (!seed) throw new OnvifError("InvalidValue", "Unknown provisional seed");
        const endpoint = report.endpointReference;
        if (endpoint.status !== "known") {
            seed.outcome = { status: endpoint.status, code: endpoint.code, message: endpoint.message, observedAt: endpoint.observedAt };
            this.revision++;
            return null;
        }
        if (seed.expectedEndpointAddress !== null && endpoint.value.address !== seed.expectedEndpointAddress) {
            seed.outcome = {
                status: "fault", code: "SeedIdentityMismatch", message: "Seed identity disagrees with explicit provisioning", observedAt: this.clock.now()
            };
            this.revision++;
            return null;
        }
        const device = this.create(endpoint.value);
        if (!device) return null;
        this.mergeEndpoints(device, [seed.xaddr], provenance);
        const token = this.beginInspection(device.id);
        if (!this.commitInspection(token, report)) return null;
        seed.resolvedDeviceId = device.id;
        seed.outcome = { status: "known", value: device.id, observedAt: this.clock.now() };
        this.revision++;
        return device.id;
    }
}
