import { isRecord, OnvifError } from "../binding/errors.js";
import { operationKey } from "../binding/registry.js";
import { nativeFailure } from "./read-adapters.js";
import { NAMESPACES, readContract, readonlyContract, READ_CONTRACTS, type ReadContract } from "./operations.js";
import { absoluteUri, approveXAddr, assertJson } from "./policy.js";
import { withDeadline } from "./clock.js";
import type {
    Bounds, Clock, DeviceInformation, DiscoveryEndpointReference, FeatureObservation, IdentityEvidence,
    InspectionReport, JsonObject, JsonValue, NativeReadAdapter, NativeReadResult, NativeResource,
    NativeTarget, Observation, ReadObservation, ResourceInventory, ServiceSnapshot, Timers
} from "./types.js";

function object(value: JsonValue): JsonObject {
    if (!isRecord(value)) throw new OnvifError("InvalidValue", "Expected a structured native result");
    return value;
}
function string(value: JsonValue | undefined): string {
    if (typeof value !== "string" || value.length > 4096) throw new OnvifError("InvalidValue", "Expected a bounded native string");
    return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new OnvifError("InvalidValue", "Native repeated fields must be canonical arrays");
    return value;
}
function mapped<T>(outcome: Observation<JsonValue>, mapper: (value: JsonValue) => T): Observation<T> {
    const provenance = { observedAt: outcome.observedAt, ...(outcome.source ? { source: outcome.source } : {}) };
    if (outcome.status !== "known") return {
        status: outcome.status, code: outcome.code, message: outcome.message, ...provenance
    };
    try { return { status: "known", value: mapper(outcome.value), ...provenance }; }
    catch (error) {
        if (!(error instanceof OnvifError)) throw error;
        return { status: error.code === "XmlLimit" ? "truncated" : "fault", code: "NativeShape",
            message: "Native response does not match the pinned source contract or its bound", ...provenance };
    }
}

function information(value: JsonValue): DeviceInformation {
    const data = object(value);
    return {
        manufacturer: string(data.Manufacturer), model: string(data.Model), firmwareVersion: string(data.FirmwareVersion),
        serialNumber: string(data.SerialNumber), hardwareId: string(data.HardwareId)
    };
}

function endpoint(value: JsonValue, target: NativeTarget): DiscoveryEndpointReference {
    const address = string(object(value).GUID);
    if (!absoluteUri(address)) throw new OnvifError("InvalidValue", "GetEndpointReference GUID is not an absolute endpoint identity");
    return target.endpointReference?.address === address ? structuredClone(target.endpointReference)
        : { address, referenceProperties: [], referenceParameters: [] };
}

function resource(item: JsonValue, tokenField?: string, parentTokens: string[] = []): NativeResource {
    const data = object(item);
    const attributes = data.$attributes === undefined ? {} : object(data.$attributes);
    const token = string(tokenField ? data[tokenField] : attributes.token);
    const fixed = attributes.fixed;
    if (fixed !== undefined && typeof fixed !== "boolean") throw new OnvifError("InvalidValue", "Profile fixed flag must be a native boolean");
    return { token, parentTokens, fixed: fixed ?? null, data };
}

export class ReadonlyInspector {
    private readonly pending = new Set<Promise<NativeReadResult>>();
    private readonly controllers = new Set<AbortController>();
    private accepting = true;
    private closing: Promise<void> | undefined;

    constructor(
        private readonly adapter: NativeReadAdapter,
        private readonly clock: Clock,
        private readonly bounds: Readonly<Bounds>,
        private readonly timers: Readonly<Timers>,
        private readonly allowed: ReadonlySet<string>
    ) {}

    get pendingReads(): number { return this.pending.size; }

    async executeReadonly(key: string, args: JsonObject, target: NativeTarget, signal: AbortSignal): Promise<NativeReadResult> {
        readonlyContract(key);
        if (!this.accepting) throw new OnvifError("RuntimeClosed", "Inspector is closed");
        assertJson(args, 20000, 64, this.bounds.maxReadBytes);
        if (!approveXAddr(target.xaddr, this.allowed)) {
            return { status: "denied", code: "UnapprovedXAddr", message: "Exact native XAddr is not approved for inspection" };
        }
        if (this.pending.size >= this.bounds.maxConcurrentInspections) {
            return { status: "truncated", code: "ReadConcurrency", message: "Outstanding native reads have reached the concurrency bound" };
        }
        const controller = new AbortController();
        this.controllers.add(controller);
        let expired = false;
        const abort = (): void => controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        const timer = this.clock.setTimeout(() => {
            expired = true;
            controller.abort(new Error("Native read deadline reached"));
        }, this.timers.readTimeoutMs);
        const aborted = new Promise<NativeReadResult>((resolve) => {
            const onAbort = (): void => resolve({
                status: "timeout", code: expired ? "ReadDeadline" : "ReadCancelled",
                message: "Native read did not complete within its active inspection window"
            });
            controller.signal.addEventListener("abort", onAbort, { once: true });
            if (controller.signal.aborted) onAbort();
        });
        const work = Promise.resolve().then(() => {
            if (controller.signal.aborted) return nativeFailure(controller.signal.reason, true);
            return this.adapter.executeReadonly(key, args, target, {
                signal: controller.signal, timeoutMs: this.timers.readTimeoutMs, maxBytes: this.bounds.maxReadBytes
            });
        }).then((result) => {
            assertJson(result, 20000, 64, this.bounds.maxReadBytes);
            if (Buffer.byteLength(JSON.stringify(result)) > this.bounds.maxReadBytes) {
                return { status: "truncated", code: "ReadBytes", message: "Native read result exceeded its byte bound" } as const;
            }
            if (!["known", "unsupported", "denied", "fault", "timeout", "truncated", "unknown"].includes(result.status)) {
                throw new OnvifError("InvalidValue", "Adapter returned an invalid inspection outcome");
            }
            if (result.status === "known") {
                assertJson(result.value);
                if (Buffer.byteLength(JSON.stringify(result.value)) > this.bounds.maxReadBytes) {
                    return { status: "truncated", code: "ReadBytes", message: "Native read result exceeded its byte bound" } as const;
                }
            } else if (!result.code || !result.message) {
                throw new OnvifError("InvalidValue", "Non-known native outcomes require explicit diagnostics");
            }
            return result;
        }).catch((error: unknown) => nativeFailure(error, controller.signal.aborted));
        this.pending.add(work);
        void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
        try { return await Promise.race([work, aborted]); }
        finally {
            this.clock.clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            this.controllers.delete(controller);
        }
    }

    async inspect(target: NativeTarget, parentSignal: AbortSignal): Promise<InspectionReport> {
        const controller = new AbortController();
        const abort = (): void => controller.abort(parentSignal.reason);
        parentSignal.addEventListener("abort", abort, { once: true });
        if (parentSignal.aborted) abort();
        const deadline = this.clock.now() + this.timers.inspectionTimeoutMs;
        const timer = this.clock.setTimeout(() => controller.abort(new Error("Inspection deadline reached")), this.timers.inspectionTimeoutMs);
        const reads: ReadObservation[] = [];
        const resources: ResourceInventory[] = [];
        const features: FeatureObservation[] = [];
        const identities: IdentityEvidence[] = [];
        let bytes = 0;
        let truncated = false;
        let responsive = false;
        const read = async (contract: Readonly<ReadContract>, args: JsonObject, selected = target): Promise<Observation<JsonValue>> => {
            const at = this.clock.now();
            if (reads.length >= this.bounds.maxRequestsPerInspection || bytes >= this.bounds.maxInspectionBytes
                || controller.signal.aborted || at >= deadline) {
                truncated = true;
                return { status: "truncated", code: "InspectionBudget", message: "Inspection request, byte or deadline budget exhausted", observedAt: at };
            }
            const result = await this.executeReadonly(operationKey(contract.reference), args, selected, controller.signal);
            bytes += Buffer.byteLength(JSON.stringify(result));
            if (result.status === "known") {
                responsive = true;
            } else if (result.responded === true) responsive = true;
            const { identityEvidence, responded: _responded, ...readResult } = result;
            if (identityEvidence && bytes <= this.bounds.maxInspectionBytes) identities.push(structuredClone(identityEvidence));
            let outcome: Observation<JsonValue> = { ...readResult, observedAt: this.clock.now(),
                source: { operation: contract.reference, xaddr: selected.xaddr } };
            if (bytes > this.bounds.maxInspectionBytes) {
                outcome = { status: "truncated", code: "InspectionBytes", message: "Total native inspection byte budget exhausted", observedAt: this.clock.now() };
            }
            truncated ||= outcome.status === "truncated";
            reads.push({ operation: contract.reference, args: structuredClone(args), xaddr: selected.xaddr, outcome,
                responded: result.status === "known" || result.responded === true });
            return outcome;
        };
        try {
            const servicesRead = await read(readContract(NAMESPACES.device, "GetServices"), { IncludeCapability: true });
            const info = mapped(await read(readContract(NAMESPACES.device, "GetDeviceInformation"), {}), information);
            const scopes = mapped(await read(readContract(NAMESPACES.device, "GetScopes"), {}),
                (value) => {
                    const values = array(object(value).Scopes);
                    if (values.length > this.bounds.maxScopes) throw new OnvifError("XmlLimit", "Native scopes exceed their bound");
                    return values.map((item) => {
                    const scope = string(object(item).ScopeItem);
                    if (!absoluteUri(scope)) throw new OnvifError("InvalidValue", "Invalid native scope");
                    return scope;
                    });
                });
            const epr = mapped(await read(readContract(NAMESPACES.device, "GetEndpointReference"), {}), (value) => endpoint(value, target));
            let services = this.services(servicesRead);
            if (servicesRead.status === "unsupported" && reads[0]?.responded === true) {
                const legacy = await read(readContract(NAMESPACES.device, "GetCapabilities"), { Category: ["All"] });
                services = this.legacyServices(legacy);
            }
            truncated ||= [services.status, scopes.status, info.status, epr.status].includes("truncated");
            if (services.status === "known") {
                const ordered = [...services.value].sort((a, b) =>
                    Number(a.namespace === NAMESPACES.analytics) - Number(b.namespace === NAMESPACES.analytics));
                for (const service of ordered) {
                    const selected = { ...target, xaddr: service.xaddr };
                    const knownContracts = READ_CONTRACTS.filter((contract) => contract.reference.bindingQName.namespace === service.namespace);
                    const capabilities = knownContracts.find((contract) => contract.reference.operation === "GetServiceCapabilities");
                    if (capabilities && service.capabilities.status !== "known") {
                        service.capabilities = mapped(await read(capabilities, {}, selected), (value) => {
                            const data = object(value).Capabilities;
                            if (data === undefined) throw new OnvifError("InvalidValue", "Missing service capabilities");
                            return data;
                        });
                    }
                    if (capabilities) features.push({
                        namespace: service.namespace, feature: "service-capabilities",
                        operation: service.capabilities.source?.operation ?? capabilities.reference, outcome: structuredClone(service.capabilities)
                    });
                    for (const contract of knownContracts.filter((item) => item.list)) {
                        const inventory = await this.list(contract, selected, read);
                        resources.push(inventory);
                        truncated ||= inventory.outcome.status === "truncated";
                        if (inventory.kind === "recording" && inventory.outcome.status === "known") {
                            const tracks = this.tracks(inventory);
                            resources.push(tracks);
                            truncated ||= tracks.outcome.status === "truncated";
                        }
                        if (inventory.kind === "recording-job" && inventory.outcome.status === "known") {
                            for (const job of inventory.outcome.value) {
                                await read(readContract(NAMESPACES.recording, "GetRecordingJobConfiguration"), { JobToken: job.token }, selected);
                                await read(readContract(NAMESPACES.recording, "GetRecordingJobState"), { JobToken: job.token }, selected);
                            }
                        }
                    }
                    if (service.namespace === NAMESPACES.events) {
                        const contract = readContract(NAMESPACES.events, "GetEventProperties");
                        features.push({ namespace: service.namespace, feature: "event-properties", operation: contract.reference,
                            outcome: await read(contract, {}, selected) });
                    }
                    if (service.namespace === NAMESPACES.analytics) {
                        const configurations = resources.filter((item) => item.kind === "analytics-configuration" && item.outcome.status === "known");
                        for (const configuration of configurations) {
                            if (configuration.outcome.status !== "known") continue;
                            for (const item of configuration.outcome.value) {
                                for (const operation of ["GetSupportedAnalyticsModules", "GetSupportedRules"]) {
                                    const contract = readContract(service.namespace, operation);
                                    if (features.length >= this.bounds.maxRequestsPerInspection * 2) {
                                        truncated = true;
                                        break;
                                    }
                                    features.push({ namespace: service.namespace, feature: `${operation}:${item.token}`,
                                        operation: contract.reference, outcome: await read(contract, { ConfigurationToken: item.token }, selected) });
                                }
                            }
                        }
                    }
                }
            }
            return {
                information: info, services, scopes, endpointReference: epr, reads, resources,
                observedFeatures: features, identityEvidence: identities, completedAt: this.clock.now(), responsive, truncated
            };
        } finally {
            this.clock.clearTimeout(timer);
            parentSignal.removeEventListener("abort", abort);
        }
    }

    private services(outcome: Observation<JsonValue>): Observation<ServiceSnapshot[]> {
        return mapped(outcome, (value) => {
            const data = object(value);
            if (!Array.isArray(data.Service) || !data.Service.length) throw new OnvifError("InvalidValue", "GetServices requires a nonempty service array");
            if (data.Service.length > this.bounds.maxServices) throw new OnvifError("XmlLimit", "Service inventory exceeds its bound");
            return data.Service.map((item) => {
                const service = object(item);
                const namespace = string(service.Namespace);
                const xaddr = string(service.XAddr);
                const version = object(service.Version ?? null);
                if (!absoluteUri(namespace) || !Number.isSafeInteger(version.Major) || !Number.isSafeInteger(version.Minor)
                    || typeof version.Major !== "number" || typeof version.Minor !== "number" || version.Major < 0 || version.Minor < 0) {
                    throw new OnvifError("InvalidValue", "Invalid service identity or native specification version");
                }
                approveXAddr(xaddr, this.allowed);
                const capabilities: Observation<JsonValue> = service.Capabilities === undefined
                    ? { status: "unknown", code: "CapabilitiesOmitted", message: "Service did not include capabilities", observedAt: outcome.observedAt }
                    : { status: "known", value: service.Capabilities, observedAt: outcome.observedAt,
                        ...(outcome.source ? { source: outcome.source } : {}) };
                return { namespace, xaddr, version: { major: version.Major, minor: version.Minor }, capabilities };
            });
        });
    }

    private legacyServices(outcome: Observation<JsonValue>): Observation<ServiceSnapshot[]> {
        return mapped(outcome, (value) => {
            const data = object(object(value).Capabilities ?? null);
            const categories: [string, string][] = [
                ["Device", NAMESPACES.device], ["Media", NAMESPACES.media1], ["Events", NAMESPACES.events],
                ["Analytics", NAMESPACES.analytics], ["PTZ", "http://www.onvif.org/ver20/ptz/wsdl"],
                ["Imaging", "http://www.onvif.org/ver20/imaging/wsdl"]
            ];
            const services: ServiceSnapshot[] = [];
            for (const [category, namespace] of categories) {
                if (data[category] === undefined) continue;
                const capabilities = object(data[category]);
                const xaddr = string(capabilities.XAddr);
                approveXAddr(xaddr, this.allowed);
                services.push({ namespace, xaddr, version: null,
                    capabilities: { status: "known", value: capabilities, observedAt: outcome.observedAt,
                        ...(outcome.source ? { source: outcome.source } : {}) } });
            }
            return services;
        });
    }

    private async list(
        contract: Readonly<ReadContract>,
        target: NativeTarget,
        read: (contract: Readonly<ReadContract>, args: JsonObject, selected: NativeTarget) => Promise<Observation<JsonValue>>
    ): Promise<ResourceInventory> {
        const spec = contract.list;
        if (!spec) throw new OnvifError("InvalidValue", "Missing read inventory contract");
        const values: NativeResource[] = [];
        const nextReferences = new Set<string>();
        const keys = new Map<string, string>();
        let next: string | undefined;
        const result = (outcome: Observation<NativeResource[]>): ResourceInventory => ({
            namespace: contract.reference.bindingQName.namespace, xaddr: target.xaddr, kind: spec.kind,
            outcome: { ...outcome, source: { operation: contract.reference, xaddr: target.xaddr } }
        });
        for (let page = 0; page < this.bounds.maxPages; page++) {
            const args: JsonObject = spec.pagination ? { Limit: Math.min(this.bounds.maxResources, 128) } : {};
            if (next !== undefined) args.StartReference = next;
            const outcome = await read(contract, args, target);
            if (outcome.status !== "known") return result({
                status: outcome.status, code: outcome.code, message: outcome.message, observedAt: outcome.observedAt, partial: values
            });
            try {
                const data = object(outcome.value);
                for (const item of array(data[spec.field])) {
                    if (values.length >= this.bounds.maxResources) return result({
                        status: "truncated", code: "ResourceLimit", message: "Native resource inventory is incomplete",
                        observedAt: outcome.observedAt, partial: values
                    });
                    const value = resource(item, spec.tokenField);
                    const key = JSON.stringify([value.parentTokens, value.token]);
                    const previous = keys.get(key);
                    if (previous !== undefined) {
                        if (previous !== JSON.stringify(value)) throw new OnvifError("InvalidValue", "Paged native token changed within an inventory read");
                        continue;
                    }
                    keys.set(key, JSON.stringify(value));
                    values.push(value);
                }
                if (!spec.pagination || data.NextStartReference === undefined) {
                    return result({ status: "known", value: values, observedAt: outcome.observedAt });
                }
                next = string(data.NextStartReference);
                if (nextReferences.has(next)) throw new OnvifError("InvalidValue", "Native pagination repeated a continuation reference");
                nextReferences.add(next);
            } catch (error) {
                if (!(error instanceof OnvifError)) throw error;
                return result({ status: "fault", code: "InventoryShape", message: "Native token or pagination contract is inconsistent",
                    observedAt: outcome.observedAt, partial: values });
            }
        }
        return result({ status: "truncated", code: "PageLimit", message: "Native inventory pagination budget exhausted",
            observedAt: this.clock.now(), partial: values });
    }

    private tracks(recordings: ResourceInventory): ResourceInventory {
        const values: NativeResource[] = [];
        if (recordings.outcome.status !== "known") throw new OnvifError("InvalidValue", "Tracks require a confirmed recording inventory");
        try {
            for (const recording of recordings.outcome.value) {
                const tracks = object(recording.data.Tracks ?? null);
                for (const track of array(tracks.Track)) {
                    if (values.length >= this.bounds.maxResources) return {
                        ...recordings, kind: "track", outcome: { status: "truncated", code: "TrackLimit",
                            message: "Recording track inventory exceeds its bound", observedAt: this.clock.now(), partial: values }
                    };
                    values.push(resource(track, "TrackToken", [recording.token]));
                }
            }
            return { ...recordings, kind: "track", outcome: { status: "known", value: values, observedAt: this.clock.now(),
                ...(recordings.outcome.source ? { source: recordings.outcome.source } : {}) } };
        } catch (error) {
            if (!(error instanceof OnvifError)) throw error;
            return { ...recordings, kind: "track", outcome: { status: "fault", code: "TrackShape",
                message: "Recording tracks do not match their parent-token contract", observedAt: this.clock.now(), partial: values } };
        }
    }

    close(): Promise<void> {
        if (!this.closing) {
            this.accepting = false;
            for (const controller of this.controllers) controller.abort(new Error("Inspector closed"));
            const cleanup = (async () => {
                await this.adapter.close();
                await Promise.all(this.pending);
            })();
            this.closing = withDeadline(this.clock, cleanup, this.timers.readTimeoutMs,
                new OnvifError("OutcomeUnknown", "Native read adapter did not confirm bounded shutdown"));
        }
        return this.closing;
    }
}
