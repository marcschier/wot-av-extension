import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { OnvifError } from "../binding/errors.js";
import { abortable, NodeClock, sleep } from "./clock.js";
import { Inventory } from "./inventory.js";
import { ReadonlyInspector } from "./inspect.js";
import { absoluteUri, inCidr, validateOptions, type ValidatedOptions } from "./policy.js";
import { DEVICE, LEGACY_DEVICE, encodeProbe, encodeResolve, endpointIdentity, matchesProbe, parseDiscovery } from "./protocol.js";
import { assertSnapshot } from "./snapshot.js";
import type {
    Clock, Datagram, DatagramChannel, DiscoveryEndpointReference, DiscoveryEngine, DiscoveryOptions, DiscoveryPorts,
    InspectionReport, InterfaceRef, InventorySnapshot, NativeTarget, Provenance, Segment, TimerHandle
} from "./types.js";
import type { QName } from "../xml/types.js";

interface Binding {
    local: InterfaceRef;
    segment: Segment;
    channel: DatagramChannel;
}
interface Request {
    id: string;
    kind: "Probe" | "Resolve";
    binding: Binding;
    deadline: number;
    types: readonly QName[];
    scopes: readonly string[];
    endpointId: string | null;
    matches: number;
}
interface InspectionJob {
    key: string;
    deviceId: string | null;
    seedId: string | null;
    promise: Promise<InspectionReport | null>;
    resolve: (report: InspectionReport | null) => void;
    reject: (error: unknown) => void;
    generation?: number;
    requeue?: boolean;
}

class Engine implements DiscoveryEngine {
    private readonly clock: Clock;
    private readonly stop = new AbortController();
    private state: "new" | "starting" | "running" | "closing" | "closed" = "new";
    private config: ValidatedOptions | undefined;
    private inventory: Inventory | undefined;
    private inspector: ReadonlyInspector | undefined;
    private readonly bindings = new Map<string, Binding>();
    private readonly requests = new Map<string, Request>();
    private readonly sending = new Set<Promise<void>>();
    private readonly work = new Set<Promise<unknown>>();
    private readonly jobs = new Map<string, InspectionJob>();
    private readonly queue: InspectionJob[] = [];
    private workers = 0;
    private round = 0;
    private rateWindow = -1;
    private datagrams = 0;
    private scheduled: TimerHandle | undefined;
    private starting: Promise<void> | undefined;
    private closing: Promise<void> | undefined;
    private probing: Promise<void> | undefined;
    private saving: Promise<void> | undefined;
    private savedRevision = -1;
    private readonly endpointCursor = new Map<string, number>();

    constructor(private readonly ports: DiscoveryPorts) {
        this.clock = ports.clock ?? new NodeClock();
    }

    start(options: DiscoveryOptions): Promise<void> {
        if (this.state !== "new") return Promise.reject(new OnvifError("InvalidConfiguration", "Discovery can be started exactly once"));
        this.config = validateOptions(options);
        if (encodeProbe("urn:uuid:00000000-0000-4000-8000-000000000000", "device", this.config.options.scopes).byteLength > this.config.bounds.maxDatagramBytes) {
            throw new OnvifError("InvalidConfiguration", "Configured scopes exceed the outgoing discovery datagram byte bound");
        }
        setMaxListeners(this.config.bounds.maxPendingRequests + this.config.bounds.maxConcurrentInspections + 4, this.stop.signal);
        this.state = "starting";
        this.inventory = new Inventory(this.config.bounds, this.config.timers, this.config.allowed, this.clock);
        this.inspector = new ReadonlyInspector(this.ports.nativeRead, this.clock, this.config.bounds, this.config.timers, this.config.allowed);
        this.starting = this.initialize().catch(async (error: unknown) => {
            this.inventory?.diagnostic("StartupFailed", "Discovery did not establish its configured transport and persistence contract");
            if (!this.closing) {
                this.closing = this.shutdown(false);
                try { await this.closing; }
                catch (cleanup) { throw new AggregateError([error, cleanup], "Discovery startup and cleanup failed"); }
            }
            throw error;
        });
        return this.starting;
    }

    private async initialize(): Promise<void> {
        const { options, bounds } = this.settings();
        const snapshot = await this.ports.persistence.load();
        if (snapshot) {
            assertSnapshot(snapshot, bounds);
            this.current().restore(snapshot);
            this.savedRevision = snapshot.revision;
            this.round = Math.max(0, ...snapshot.devices.map((device) => device.lastLivenessRound ?? 0));
        }
        for (const segment of options.segments) {
            if (this.stop.signal.aborted) throw new OnvifError("RuntimeClosed", "Discovery start was cancelled");
            const local = options.interfaces.find((item) => item.id === segment.interfaceId);
            if (!local) throw new OnvifError("InvalidConfiguration", "Segment interface is not configured");
            if (local.family === "IPv6" && (options.ipv6 ?? "disabled") === "disabled") {
                this.current().diagnostic("Ipv6Disabled", "Configured IPv6 segment was explicitly disabled");
                continue;
            }
            try {
                const channel = await this.ports.datagrams.open(local, segment,
                    (datagram) => this.receive(local, segment, datagram),
                    () => this.current().diagnostic("DatagramTransportFailure", "Configured discovery channel reported a transport error"));
                if (this.stop.signal.aborted) {
                    await channel.close();
                    throw new OnvifError("RuntimeClosed", "Discovery start was cancelled");
                }
                this.bindings.set(segment.id, { local, segment, channel });
            } catch (error) {
                const unsupported = error instanceof OnvifError && error.code === "UnsupportedCapability";
                if (local.family === "IPv6" && options.ipv6 === "bestEffort" && unsupported) {
                    this.current().diagnostic("Ipv6Unavailable", "IPv6 confinement is unavailable; optional segment was not opened");
                } else throw error;
            }
        }
        if (!this.bindings.size) throw new OnvifError("UnsupportedCapability", "No configured discovery segment could be opened");
        for (const seed of options.seeds ?? []) {
            if (!this.bindings.has(seed.segmentId)) {
                throw new OnvifError("InvalidConfiguration", "A seed's configured transport segment is unavailable");
            }
            this.current().addSeed({
                ...seed, expectedEndpointAddress: seed.expectedEndpointAddress ?? null
            });
        }
        this.state = "running";
        await this.persist();
        for (const device of this.current().snapshot().devices) {
            if (device.state !== "departed") this.launch(this.enqueue(device.id, null));
        }
        for (const seed of options.seeds ?? []) this.launch(this.enqueue(null, seed.seedId));
        this.launch(this.probe());
        this.schedule();
    }

    private settings(): ValidatedOptions {
        if (!this.config) throw new OnvifError("InvalidConfiguration", "Discovery has not been configured");
        return this.config;
    }
    private current(): Inventory {
        if (!this.inventory) throw new OnvifError("InvalidConfiguration", "Discovery has not been started");
        return this.inventory;
    }
    private running(): void {
        if (this.state !== "running") throw new OnvifError("RuntimeClosed", "Discovery is not running");
    }

    snapshot(): InventorySnapshot {
        return this.inventory?.snapshot() ?? {
            schemaVersion: 1, revision: 0, capturedAt: this.clock.now(), devices: [], seeds: [], diagnostics: [], truncated: false
        };
    }

    private receive(local: InterfaceRef, segment: Segment, datagram: Datagram): void {
        if (this.state !== "running" && this.state !== "starting") return;
        const { bounds, timers, options } = this.settings();
        const window = Math.floor(this.clock.now() / timers.probeIntervalMs);
        if (window !== this.rateWindow) { this.rateWindow = window; this.datagrams = 0; }
        if (++this.datagrams > bounds.maxDatagramsPerRound) {
            if (this.datagrams === bounds.maxDatagramsPerRound + 1) this.current().diagnostic("DatagramRateLimit", "Additional datagrams were dropped for this bounded interval", undefined, true);
            return;
        }
        try {
            if (datagram.family !== local.family || !inCidr(datagram.address, segment.cidr)
                || !Number.isInteger(datagram.port) || datagram.port < 1 || datagram.port > 65535) {
                this.current().diagnostic("SourceOutsideSegment", "Datagram source is outside the configured receiving segment");
                return;
            }
            const message = parseDiscovery(datagram.data, bounds, options.missingSequence === "candidate");
            const provenance: Provenance = {
                interfaceId: local.id, segmentId: segment.id, address: datagram.address, family: datagram.family,
                port: datagram.port, receivedAt: this.clock.now(), messageId: message.messageId
            };
            if (message.discoveryProxy) {
                this.current().observe(message, provenance);
                return;
            }
            if (this.current().observeDuplicate(message, provenance)) return;
            const fingerprintSource = structuredClone(message);
            if (message.kind === "ProbeMatches" || message.kind === "ResolveMatches") {
                const request = message.relatesTo ? this.requests.get(message.relatesTo) : undefined;
                if (!request || request.deadline <= this.clock.now()
                    || request.binding.local.id !== local.id || request.binding.segment.id !== segment.id
                    || (request.kind === "Probe") !== (message.kind === "ProbeMatches")) {
                    this.current().diagnostic("UncorrelatedResponse", "Discovery response has no live request on this interface/segment");
                    return;
                }
                message.matches = message.matches.filter((match) => request.kind === "Resolve"
                    ? endpointIdentity(match.endpointReference) === request.endpointId
                    : matchesProbe(match, request.types, request.scopes));
                request.matches += message.matches.length;
            } else if (message.kind === "Hello") {
                message.matches = message.matches.filter((match) =>
                    (matchesProbe(match, [DEVICE], options.scopes ?? []) || matchesProbe(match, [LEGACY_DEVICE], options.scopes ?? [])));
            }
            for (const id of this.current().observe(message, provenance, fingerprintSource)) {
                const device = this.current().device(id);
                if (device && (device.state !== "verified" || device.verifiedAt === null
                    || this.clock.now() - device.verifiedAt >= timers.refreshMs)) this.launch(this.enqueue(id, null));
            }
        } catch (error) {
            if (!(error instanceof OnvifError)) throw error;
            this.current().diagnostic(error.code, "Discovery datagram failed protocol, bounds or source-policy validation",
                undefined, error.code === "XmlLimit");
        }
    }

    private nextId(): string {
        const id = this.ports.messageId?.() ?? `urn:uuid:${randomUUID()}`;
        if (!absoluteUri(id) || this.requests.has(id)) throw new OnvifError("InvalidConfiguration", "MessageID source did not provide a unique absolute URI");
        return id;
    }

    private async request(binding: Binding, kind: "device" | "legacy" | "untyped" | DiscoveryEndpointReference): Promise<number> {
        const { bounds, timers, options } = this.settings();
        if (this.requests.size >= bounds.maxPendingRequests || this.sending.size >= bounds.maxPendingRequests) {
            this.current().diagnostic("RequestLimit", "Additional discovery requests were not admitted", undefined, true);
            return 0;
        }
        const id = this.nextId();
        const resolve = typeof kind !== "string";
        const request: Request = {
            id, kind: resolve ? "Resolve" : "Probe", binding, deadline: this.clock.now() + timers.probeWindowMs,
            types: kind === "device" ? [DEVICE] : kind === "legacy" ? [LEGACY_DEVICE] : [],
            scopes: options.scopes ?? [], endpointId: resolve ? endpointIdentity(kind) : null, matches: 0
        };
        const data = resolve ? encodeResolve(id, kind) : encodeProbe(id, kind, options.scopes);
        if (data.byteLength > bounds.maxDatagramBytes) throw new OnvifError("XmlLimit", "Outgoing discovery request exceeds its datagram bound");
        this.requests.set(id, request);
        const controller = new AbortController();
        const abort = (): void => controller.abort(this.stop.signal.reason);
        this.stop.signal.addEventListener("abort", abort, { once: true });
        if (this.stop.signal.aborted) abort();
        let expired = false;
        const expiry = this.clock.setTimeout(() => {
            expired = true;
            controller.abort(new Error("Discovery request window elapsed"));
        }, timers.probeWindowMs);
        try {
            for (let attempt = 0; attempt < (options.retransmissions ?? 3); attempt++) {
                if (request.deadline <= this.clock.now() || controller.signal.aborted) break;
                const sending = binding.channel.send(data, binding.segment.destination);
                this.sending.add(sending);
                void sending.then(() => this.sending.delete(sending), () => this.sending.delete(sending));
                await abortable(sending, controller.signal);
                if (attempt + 1 < (options.retransmissions ?? 3)) {
                    const random = this.ports.random?.() ?? Math.random();
                    if (!Number.isFinite(random) || random < 0 || random >= 1) throw new OnvifError("InvalidConfiguration", "Jitter source must return a number in [0,1)");
                    const delay = Math.min(500, (timers.retransmitMinMs + random * (timers.retransmitMaxMs - timers.retransmitMinMs)) * (2 ** attempt));
                    await sleep(this.clock, Math.max(0, Math.min(delay, request.deadline - this.clock.now())), controller.signal);
                }
            }
            const remaining = request.deadline - this.clock.now();
            if (remaining > 0) await sleep(this.clock, remaining, controller.signal);
            return request.matches;
        } catch (error) {
            if (expired && !this.stop.signal.aborted) return request.matches;
            throw error;
        } finally {
            this.clock.clearTimeout(expiry);
            this.stop.signal.removeEventListener("abort", abort);
            this.requests.delete(id);
        }
    }

    probe(): Promise<void> {
        this.running();
        if (!this.probing) {
            this.round = Math.max(this.clock.now(), this.round + 1);
            const work = (async () => {
                const matches = await Promise.all([...this.bindings.values()].map(async (binding) => {
                    const counts = await Promise.all([this.request(binding, "device"), this.request(binding, "legacy")]);
                    return { binding, count: counts.reduce((sum, count) => sum + count, 0) };
                }));
                const fallback = this.settings().options.untypedFallback;
                if (fallback?.enabled && !this.stop.signal.aborted) {
                    await Promise.all(matches.filter((item) => item.count === 0).slice(0, fallback.maxProbesPerRound)
                        .map((item) => this.request(item.binding, "untyped")));
                }
            })();
            this.probing = work;
            this.launch(work);
            void work.then(() => { this.probing = undefined; }, () => { this.probing = undefined; });
        }
        return this.probing;
    }

    async resolve(endpoint: DiscoveryEndpointReference, segmentId: string): Promise<void> {
        this.running();
        const binding = this.bindings.get(segmentId);
        if (!binding) throw new OnvifError("InvalidConfiguration", "Resolve requires an opened configured segment");
        const work = this.request(binding, endpoint);
        this.launch(work);
        await work;
    }

    inspect(deviceId: string): Promise<InspectionReport | null> {
        this.running();
        if (!this.current().device(deviceId)) throw new OnvifError("InvalidValue", "Unknown discovery identity");
        return this.enqueue(deviceId, null);
    }

    private enqueue(deviceId: string | null, seedId: string | null): Promise<InspectionReport | null> {
        const key = deviceId ? `device:${deviceId}` : `seed:${seedId}`;
        const existing = this.jobs.get(key);
        if (existing) {
            if (deviceId && existing.generation !== undefined
                && this.current().device(deviceId)?.inspectionGeneration !== existing.generation) existing.requeue = true;
            return existing.promise;
        }
        if (this.state !== "running") return Promise.resolve(null);
        if (this.queue.length >= this.settings().bounds.maxQueuedInspections) {
            this.current().diagnostic("InspectionQueueLimit", "Inspection work was not admitted to the bounded queue", deviceId ?? undefined, true);
            return Promise.resolve(null);
        }
        let resolve!: InspectionJob["resolve"];
        let reject!: InspectionJob["reject"];
        const promise = new Promise<InspectionReport | null>((done, fail) => { resolve = done; reject = fail; });
        const job: InspectionJob = { key, deviceId, seedId, promise, resolve, reject };
        this.jobs.set(key, job);
        this.queue.push(job);
        this.pump();
        return promise;
    }

    private pump(): void {
        while (this.state === "running" && this.workers < this.settings().bounds.maxConcurrentInspections && this.queue.length) {
            const job = this.queue.shift();
            if (!job) break;
            this.workers++;
            const work = this.runInspection(job).then(job.resolve, job.reject).finally(() => {
                this.jobs.delete(job.key);
                this.workers--;
                if (job.requeue && this.state === "running") this.launch(this.enqueue(job.deviceId, job.seedId));
                this.pump();
            });
            this.launch(work);
        }
    }

    private target(deviceId: string): NativeTarget | null {
        const device = this.current().device(deviceId);
        if (!device) return null;
        const endpoints = device.endpoints.filter((endpoint) => endpoint.approval === "approved"
            && endpoint.provenance.some((provenance) => this.bindings.has(provenance.segmentId)));
        if (!endpoints.length) {
            this.current().diagnostic("NoApprovedXAddr", "Device has no exact approved native endpoint on an opened segment", deviceId);
            return null;
        }
        const index = this.endpointCursor.get(deviceId) ?? 0;
        const selected = endpoints[index % endpoints.length];
        this.endpointCursor.set(deviceId, index + 1);
        const provenance = selected?.provenance.find((item) => this.bindings.has(item.segmentId));
        if (!selected || !provenance) throw new OnvifError("InvalidValue", "Approved endpoint has no configured provenance");
        return {
            xaddr: selected.xaddr, endpointReference: device.endpointReference,
            interfaceId: provenance.interfaceId, segmentId: provenance.segmentId
        };
    }

    private async runInspection(job: InspectionJob): Promise<InspectionReport | null> {
        const inspector = this.inspector;
        if (!inspector) throw new OnvifError("InvalidConfiguration", "Inspector is not initialized");
        const round = this.round;
        if (job.deviceId) {
            const target = this.target(job.deviceId);
            if (!target) { await this.persist(); return null; }
            const token = this.current().beginInspection(job.deviceId);
            job.generation = token.generation;
            const report = await inspector.inspect(target, this.stop.signal);
            if (this.stop.signal.aborted) return report;
            if (this.current().commitInspection(token, report)) {
                this.current().liveness(job.deviceId, round, report.responsive, report.reads.some((read) =>
                    read.outcome.status === "timeout" && read.outcome.code !== "ReadCancelled"));
            }
            this.current().reconcile();
            await this.persist();
            return report;
        }
        const seed = this.settings().options.seeds?.find((item) => item.seedId === job.seedId);
        const binding = seed ? this.bindings.get(seed.segmentId) : undefined;
        if (!seed || !binding) throw new OnvifError("InvalidConfiguration", "Seed is not explicitly configured on an open segment");
        const report = await inspector.inspect({
            xaddr: seed.xaddr, endpointReference: null, interfaceId: seed.interfaceId, segmentId: seed.segmentId
        }, this.stop.signal);
        if (!this.stop.signal.aborted) {
            this.current().inspectSeed(seed.seedId, report, {
                interfaceId: seed.interfaceId, segmentId: seed.segmentId, address: new URL(seed.xaddr).hostname,
                family: binding.local.family, port: 0, receivedAt: this.clock.now(), messageId: `urn:wot-av:seed:${encodeURIComponent(seed.seedId)}`
            });
            await this.persist();
        }
        return report;
    }

    private launch<T>(promise: Promise<T>): void {
        if (this.work.has(promise)) return;
        this.work.add(promise);
        void promise.then(() => { this.work.delete(promise); }, () => {
            this.work.delete(promise);
            if (!this.stop.signal.aborted) this.inventory?.diagnostic("BackgroundOperationFailed", "Discovery background operation failed; current inventory is retained");
        });
    }

    private schedule(): void {
        if (this.state !== "running") return;
        this.scheduled = this.clock.setTimeout(() => {
            this.scheduled = undefined;
            const work = (async () => {
                try { await this.probe(); await this.reconcile(); }
                finally { this.schedule(); }
            })();
            this.launch(work);
        }, this.settings().timers.probeIntervalMs);
    }

    async reconcile(): Promise<void> {
        this.running();
        this.round = Math.max(this.clock.now(), this.round + 1);
        this.current().reconcile();
        for (const device of this.current().snapshot().devices) {
            if (device.state !== "departed" && (device.verifiedAt === null
                || this.clock.now() - device.verifiedAt >= this.settings().timers.refreshMs || device.state !== "verified")) {
                this.launch(this.enqueue(device.id, null));
            }
        }
        for (const seed of this.current().snapshot().seeds) {
            if (!seed.resolvedDeviceId && this.settings().options.seeds?.some((item) => item.seedId === seed.seedId)) {
                this.launch(this.enqueue(null, seed.seedId));
            }
        }
        await this.persist();
    }

    private persist(): Promise<void> {
        if (!this.inventory) return Promise.resolve();
        if (!this.saving) {
            const work = (async () => {
                for (;;) {
                    const snapshot = this.current().snapshot();
                    if (snapshot.revision === this.savedRevision) return;
                    assertSnapshot(snapshot, this.settings().bounds);
                    await this.ports.persistence.save(snapshot);
                    this.savedRevision = snapshot.revision;
                }
            })();
            this.saving = work;
            void work.then(() => { this.saving = undefined; }, () => { this.saving = undefined; });
        }
        return this.saving;
    }

    async whenIdle(): Promise<void> {
        while (this.work.size || this.jobs.size) await Promise.all([...this.work, ...[...this.jobs.values()].map((job) => job.promise)]);
        if (this.saving) await this.saving;
    }

    close(): Promise<void> {
        this.closing ??= this.shutdown(true);
        return this.closing;
    }

    private async shutdown(waitForStart: boolean): Promise<void> {
        this.state = "closing";
        this.stop.abort(new Error("Discovery closed"));
        if (this.scheduled) { this.clock.clearTimeout(this.scheduled); this.scheduled = undefined; }
        for (const job of this.queue.splice(0)) { this.jobs.delete(job.key); job.resolve(null); }
        const results = await Promise.allSettled([
            ...[...this.bindings.values()].map((binding) => binding.channel.close()),
            this.inspector ? this.inspector.close() : this.ports.nativeRead.close()
        ]);
        if (waitForStart && this.starting) await Promise.allSettled([this.starting]);
        const work = await Promise.allSettled([...this.work]);
        if (this.sending.size) {
            results.push({ status: "rejected", reason: new OnvifError("OutcomeUnknown", "Datagram adapter closed without confirming pending sends") });
        }
        this.requests.clear();
        const storage = await Promise.allSettled([this.persist()]);
        const closed = await Promise.allSettled([this.ports.persistence.close()]);
        this.bindings.clear();
        this.state = "closed";
        const errors = [...results, ...work, ...storage, ...closed].filter((item) => item.status === "rejected")
            .map((item) => item.reason).filter((error: unknown) => error !== this.stop.signal.reason);
        if (errors.length) throw new AggregateError(errors, "Discovery shutdown could not confirm all owned cleanup and durable inventory");
    }
}

export function createDiscoveryEngine(ports: DiscoveryPorts): DiscoveryEngine {
    return new Engine(ports);
}
