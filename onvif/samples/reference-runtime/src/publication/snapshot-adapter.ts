import { isRecord } from "../binding/errors.js";
import { defineOperationRegistry, operationKey, type OperationReference, type OperationRegistry } from "../binding/registry.js";
import type { CanonicalCatalog } from "../catalog/compiler.js";
import { eventTemplate, PULLPOINT_MODEL } from "../catalog/models.js";
import { ONVIF_BASE } from "../catalog/schemas.js";
import { digest, qkey } from "../catalog/sources.js";
import type {
    DeviceSnapshot, JsonValue, Observation, ObservationEvidence, ProfileClaim, ResourceSnapshot, ServiceSnapshot
} from "../catalog/snapshot.js";
import { NAMESPACES, READ_CONTRACTS } from "../discovery/operations.js";
import { ADDRESSING } from "../discovery/protocol.js";
import { assertSnapshot } from "../discovery/snapshot.js";
import type {
    DeviceSnapshot as InventoryDevice, InventorySnapshot, Observation as NativeObservation,
    ObservationSource, ResourceKind
} from "../discovery/types.js";
import { assertDeviceSnapshot, project, type ProjectionCatalog, type ProjectionPolicy, type ProjectionSet } from "../projection/project.js";
import { assertThingDescription, PublicationError } from "./common.js";

export interface PrincipalBinding {
    readonly xaddr: string;
    readonly principal: string;
    readonly security: readonly string[];
}

export interface FeatureFactMapping {
    readonly fact: string;
    readonly namespace: string;
    readonly operation?: string;
    readonly pointer: string;
}

export interface SnapshotAdapterOptions {
    readonly principals?: readonly PrincipalBinding[];
    readonly claims?: Readonly<Record<string, readonly ProfileClaim[]>>;
    readonly factMappings?: readonly FeatureFactMapping[];
    readonly eventSubscriptions?: readonly { readonly xaddr: string; readonly evidence: readonly ObservationEvidence[] }[];
}

export interface AdaptedDevice {
    readonly inventoryId: string;
    readonly snapshot: DeviceSnapshot;
    readonly observationEnvelope: InventoryDevice;
    readonly principals: readonly PrincipalBinding[];
    readonly diagnostics: readonly string[];
}

export interface InventoryProjection {
    readonly schemaVersion: 1;
    readonly inventory: InventorySnapshot;
    readonly devices: readonly (AdaptedDevice & { readonly projection: ProjectionSet })[];
}

const kinds: Readonly<Record<ResourceKind, string>> = Object.freeze({
    "media-profile": "MediaProfile", "video-source-configuration": "VideoSourceConfiguration",
    "video-encoder-configuration": "VideoEncoderConfiguration", "metadata-configuration": "MetadataConfiguration",
    recording: "Recording", "recording-job": "RecordingJob", track: "RecordingTrack",
    "access-point": "AccessPoint", door: "Door", "access-profile": "AccessProfile", schedule: "Schedule",
    receiver: "Receiver", "analytics-configuration": "AnalyticsConfiguration",
    "analytics-module": "AnalyticsModule", "analytics-rule": "AnalyticsRule"
});

function evidence<T>(value: NativeObservation<T>, fallback: string): ObservationEvidence[] {
    return [{
        sourceId: value.source ? `native-read:${operationKey(value.source.operation)}` : fallback,
        observedAt: new Date(value.observedAt).toISOString(),
        ...(value.source ? { operation: value.source.operation, detail: `Exact observed XAddr: ${value.source.xaddr}` } : {})
    }];
}

function observation<T, U>(value: NativeObservation<T>, fallback: string, convert: (input: T) => U): Observation<U> {
    const proof = evidence(value, fallback);
    return value.status === "known" ? { state: "known", value: convert(value.value), evidence: proof }
        : { state: value.status, evidence: proof, detail: `${value.code}: ${value.message}` };
}

function reference(value: OperationReference): { operation: string; portType: string; binding: string } {
    return { operation: value.operation, portType: qkey(value.portTypeQName), binding: qkey(value.bindingQName) };
}

function jsonPointer(value: JsonValue, pointer: string): JsonValue | undefined {
    if (pointer === "") return value;
    if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer) || pointer.length > 2048) {
        throw new PublicationError("InvalidConfiguration", "Capability fact mappings require bounded RFC6901 pointers");
    }
    let selected: JsonValue | undefined = value;
    for (const part of pointer.slice(1).split("/").map((item) => item.replace(/~1/gu, "/").replace(/~0/gu, "~"))) {
        if (Array.isArray(selected)) {
            selected = /^(0|[1-9][0-9]*)$/u.test(part) ? selected[Number(part)] : undefined;
        } else selected = isRecord(selected) && Object.hasOwn(selected, part) ? selected[part] : undefined;
    }
    return selected;
}

export function adaptInventory(snapshot: InventorySnapshot, options: SnapshotAdapterOptions = {}): readonly AdaptedDevice[] {
    assertSnapshot(snapshot);
    return snapshot.devices.map((device) => {
        const diagnostics: string[] = [];
        const fallback = `discovery:${device.id}`;
        const currentServices = device.services.status === "known" ? device.services.value : [];
        if (device.services.status !== "known") diagnostics.push("Service inventory is not currently complete; partial/last-known values remain in the observation envelope.");
        const services: ServiceSnapshot[] = currentServices.map((service) => {
            const source = evidence(device.services, fallback);
            const capabilities: Observation<Readonly<Record<string, JsonValue>>> = service.capabilities.status === "known"
                && !isRecord(service.capabilities.value)
                ? { state: "fault", evidence: evidence(service.capabilities, fallback), detail: "Capabilities are not a canonical object; original value is retained in the observation envelope." }
                : observation(service.capabilities, fallback, (value) => {
                    if (!isRecord(value)) throw new PublicationError("InvalidSnapshot", "Native capabilities must be an object");
                    return value;
                });
            return {
                namespace: service.namespace, xaddr: service.xaddr,
                ...(service.version === null ? {} : { version: service.version }), evidence: source, capabilities,
                readOutcomes: device.reads.filter((read) => read.xaddr === service.xaddr
                    && read.operation.bindingQName.namespace === service.namespace).map((read) => ({
                    ...reference(read.operation), outcome: observation(read.outcome, fallback, (value) => value)
                }))
            };
        });
        const resources: ResourceSnapshot[] = [];
        const resourceEndpoints = new Map<string, string>();
        for (const inventory of device.resources) {
            if (inventory.outcome.status !== "known") {
                diagnostics.push(`${inventory.kind}: ${inventory.outcome.status}; incomplete and last-known members are not promoted to current inventory.`);
                continue;
            }
            for (const item of inventory.outcome.value) {
                const parentKind = inventory.kind === "track" ? "Recording"
                    : ["analytics-module", "analytics-rule"].includes(inventory.kind) ? "AnalyticsConfiguration" : undefined;
                if (item.parentTokens.length && (parentKind === undefined || item.parentTokens.length !== 1)) {
                    diagnostics.push(`${inventory.kind}: unrepresented parent-kind path retained without inventing ancestry.`);
                    continue;
                }
                const parentTokens = item.parentTokens.map((token) => ({ kind: parentKind ?? "", token }));
                const identity = JSON.stringify([inventory.namespace, inventory.kind, parentTokens, item.token]);
                const previous = resourceEndpoints.get(identity);
                if (previous !== undefined) {
                    throw new PublicationError("ResourceIdentityConflict", "One parent-scoped native resource was reported more than once; endpoint identities cannot be silently merged");
                }
                resourceEndpoints.set(identity, inventory.xaddr);
                const proof = evidence(inventory.outcome, fallback);
                const references: JsonValue[] = [];
                const entity = (token: JsonValue | undefined, type: JsonValue | undefined, defaultNamespace: string, defaultKind: string): void => {
                    if (typeof token !== "string") return;
                    if (type === undefined) references.push({ serviceNamespace: defaultNamespace, kind: defaultKind, token, typeBasis: "native-declared-default" });
                    else if (isRecord(type) && typeof type.namespace === "string" && typeof type.localName === "string") {
                        references.push({ serviceNamespace: type.namespace, kind: type.localName, token, typeBasis: "native-explicit-QName" });
                    }
                };
                if (inventory.kind === "access-point") entity(item.data.Entity, item.data.EntityType, NAMESPACES.door, "Door");
                if (inventory.kind === "access-profile" && Array.isArray(item.data.AccessPolicy)) {
                    for (const policy of item.data.AccessPolicy) {
                        if (!isRecord(policy)) continue;
                        entity(policy.Entity, policy.EntityType, NAMESPACES.access, "AccessPoint");
                        if (typeof policy.ScheduleToken === "string") references.push({
                            serviceNamespace: NAMESPACES.schedule, kind: "Schedule", token: policy.ScheduleToken, typeBasis: "native-ScheduleToken"
                        });
                    }
                }
                resources.push({
                    serviceNamespace: inventory.namespace, kind: kinds[inventory.kind], token: item.token, parentTokens,
                    evidence: proof,
                    facts: {
                        nativeEndpoint: { state: "known", value: inventory.xaddr, evidence: proof },
                        ...(item.fixed === null ? {} : { fixed: { state: "known" as const, value: item.fixed, evidence: proof } }),
                        ...(item.data.Capabilities === undefined ? {} : { capabilities: { state: "known" as const, value: item.data.Capabilities, evidence: proof } }),
                        ...(references.length ? { nativeReferences: { state: "known" as const, value: references, evidence: proof } } : {})
                    }
                });
            }
        }
        const facts: Record<string, Observation<JsonValue>> = {};
        for (const feature of device.observedFeatures) {
            const key = `${feature.namespace}#${feature.feature}`;
            if (facts[key] !== undefined) {
                facts[key] = { state: "unknown", evidence: [], detail: "Multiple native endpoints supply this feature; a scoped fact mapping is required." };
            } else facts[key] = observation(feature.outcome, fallback, (value) => value);
        }
        for (const mapping of options.factMappings ?? []) {
            if (!mapping.fact || Object.hasOwn(facts, mapping.fact)) throw new PublicationError("InvalidConfiguration", "Duplicate or empty capability fact mapping");
            const outcomes = mapping.operation === undefined
                ? currentServices.filter((service) => service.namespace === mapping.namespace).map((service) => service.capabilities)
                : device.reads.filter((read) => read.operation.bindingQName.namespace === mapping.namespace
                    && read.operation.operation === mapping.operation).map((read) => read.outcome);
            const outcome = outcomes.length === 1 ? outcomes[0] : undefined;
            if (!outcome) {
                facts[mapping.fact] = { state: "unknown", evidence: [], detail: "No unique current native source for this fact." };
            } else if (outcome.status !== "known") {
                facts[mapping.fact] = observation(outcome, fallback, (value) => value);
            } else {
                const selected = jsonPointer(outcome.value, mapping.pointer);
                facts[mapping.fact] = selected === undefined
                    ? { state: "unknown", evidence: evidence(outcome, fallback), detail: "The native field was omitted, not observed false." }
                    : { state: "known", value: selected, evidence: evidence(outcome, fallback) };
            }
        }
        const claims: ProfileClaim[] = device.claims.map((claim) => ({
            profile: claim.label, role: "device", evidence: [{ sourceId: claim.source,
                observedAt: new Date(claim.observedAt).toISOString(), detail: claim.scope }]
        }));
        claims.push(...structuredClone(options.claims?.[device.endpointReference.address] ?? []));
        const mapped: DeviceSnapshot = {
            schemaVersion: 1, epr: structuredClone(device.endpointReference),
            identity: observation(device.information, fallback, (value) => value), services, profileClaims: claims, resources, facts,
            conformanceEvidence: device.registryEvidence.filter((entry) => entry.endpointAddress === device.endpointReference.address)
                .map((entry) => ({
                    issuer: entry.authority, product: entry.product, firmware: entry.firmwareVersion,
                    profile: entry.profile, edition: entry.edition, source: entry.reference
                }))
        };
        if (device.registryEvidence.some((entry) => entry.endpointAddress !== device.endpointReference.address)) {
            diagnostics.push("Curated evidence for another EPR remains separate and is not associated with this device.");
        }
        assertDeviceSnapshot(mapped);
        return {
            inventoryId: device.id, snapshot: mapped, observationEnvelope: structuredClone(device),
            principals: structuredClone(options.principals?.filter((entry) =>
                device.endpoints.some((endpoint) => endpoint.xaddr === entry.xaddr)
                || currentServices.some((service) => service.xaddr === entry.xaddr)) ?? []),
            diagnostics
        };
    });
}

export function projectInventory(inventory: InventorySnapshot, catalog: ProjectionCatalog,
    policy: ProjectionPolicy, options: SnapshotAdapterOptions = {}): InventoryProjection {
    const events = options.eventSubscriptions ?? [];
    if (events.length > 64 || new Set(events.map((entry) => entry.xaddr)).size !== events.length
        || events.some((entry) => !entry.evidence.length || entry.evidence.some((proof) => !proof.sourceId))) {
        throw new PublicationError("InvalidConfiguration", "Event publication needs unique bounded XAddrs and explicit policy evidence");
    }
    return {
        schemaVersion: 1, inventory: structuredClone(inventory),
        devices: adaptInventory(inventory, options).map((device) => {
            const projection = project(device.snapshot, catalog, policy);
            for (const td of projection.tds) {
                for (const form of Object.values(td.actions ?? {}).flatMap((action) => action.forms)) {
                    const principal = device.principals.find((entry) => entry.xaddr === form.href);
                    const selected = typeof form.security === "string" ? [form.security] : form.security ?? policy.security;
                    if (principal && JSON.stringify([...principal.security].sort()) !== JSON.stringify([...selected].sort())) {
                        throw new PublicationError("InvalidConfiguration", "Published native Form security differs from its exact inspection target binding");
                    }
                }
            }
            const selected = events.filter((entry) => device.snapshot.services.some((service) =>
                service.namespace === NAMESPACES.events && service.xaddr === entry.xaddr));
            if (!selected.length) return { ...device, projection };
            const models = [...projection.models];
            const tds = projection.tds.map((td) => {
                if (td["@type"] !== "onvif:Device") return td;
                const affordances: Record<string, unknown> = {};
                for (const entry of selected) {
                    const service = device.snapshot.services.find((candidate) => candidate.namespace === NAMESPACES.events
                        && candidate.xaddr === entry.xaddr);
                    const attributes = service?.capabilities.state === "known" ? service.capabilities.value.$attributes : undefined;
                    const properties = service?.readOutcomes.find((read) => read.operation === "GetEventProperties");
                    if (!isRecord(attributes) || typeof attributes.MaxPullPoints !== "number"
                        || !Number.isSafeInteger(attributes.MaxPullPoints) || attributes.MaxPullPoints <= 0
                        || properties?.outcome.state !== "known") {
                        throw new PublicationError("UnsupportedCapability", "Event publication requires current native PullPoint support and Event properties, not a profile claim");
                    }
                    const observedForm = Object.values(td.actions ?? {}).flatMap((action) => action.forms).find((form) =>
                        form.href === entry.xaddr && isRecord(form["onvif:operation"])
                        && form["onvif:operation"].operation === "GetEventProperties");
                    const template = eventTemplate(catalog.registry, entry.xaddr);
                    const form = Array.isArray(template.forms) ? template.forms[0] : undefined;
                    if (!observedForm || !isRecord(form)) {
                        throw new PublicationError("UnsupportedCapability", "Event properties have no qualified native Form and security selection");
                    }
                    affordances[`notifications-${digest(entry.xaddr).slice(0, 12)}`] = {
                        ...template, forms: [{ ...form, security: observedForm.security }]
                    };
                }
                const original = models.find((model) => model.id === td.links?.find((link) => link.rel === "type")?.href);
                if (!original) throw new PublicationError("InvalidModel", "Observed Event needs its real composite model");
                const imports = Object.fromEntries(Object.keys(affordances).map((name) => [name, { "tm:ref": `${PULLPOINT_MODEL}#/events/notifications` }]));
                const id = `${ONVIF_BASE}/models/composites/Observed-${digest({ base: original.id, events: imports })}.tm.json`;
                models.push({ ...original, id, events: imports });
                const candidate: unknown = { ...td, events: affordances,
                    links: td.links?.map((link) => link.rel === "type" ? { ...link, href: id } : link),
                    "onvif:eventPolicyEvidence": selected };
                assertThingDescription(candidate);
                const instance = digest(candidate);
                return { ...candidate, version: { ...candidate.version, instance }, "onvif:projectionDigest": instance };
            });
            return { ...device, projection: { ...projection, models, tds,
                projectionDigest: digest({ source: projection.projectionDigest, models, tds }) } };
        })
    };
}

/**
 * Inspection authorization, not a guessed native access class. The caller's
 * canonical consumer registry and its digest remain unchanged.
 */
export function createInspectionRegistry(catalog: CanonicalCatalog): OperationRegistry {
    const reads = new Map(READ_CONTRACTS.map((contract) => [operationKey(contract.reference), contract]));
    return defineOperationRegistry(catalog.operations.map((operation) => {
        const contract = reads.get(operationKey(operation));
        if (!contract) return operation;
        if (operation.soapAction !== contract.soapAction || operation.addressingAction !== contract.soapAction
            || operation.request.name.namespace !== contract.reference.bindingQName.namespace
            || operation.request.name.localName !== operation.operation || operation.response === null
            || operation.response.name.namespace !== contract.reference.bindingQName.namespace
            || operation.response.name.localName !== `${operation.operation}Response`) {
            throw new PublicationError("InspectionRegistryMismatch", "Pinned native registry disagrees with the reviewed read-only wire contract");
        }
        return { ...operation, access: "read" as const };
    }), catalog.xml);
}

export function observationSummary(device: InventoryDevice): Record<string, unknown> {
    const summary = <T>(value: NativeObservation<T>): Record<string, unknown> => ({
        status: value.status, observedAt: value.observedAt,
        ...(value.source ? { source: value.source } : {}),
        ...(value.status === "known" ? {} : { code: value.code, partial: value.partial !== undefined }),
        ...(value.lastKnown ? { lastKnown: { observedAt: value.lastKnown.observedAt,
            ...(value.lastKnown.source ? { source: value.lastKnown.source } : {}) } } : {})
    });
    return {
        deviceId: device.id, state: device.state, epoch: device.epoch, inspectionGeneration: device.inspectionGeneration,
        endpointReference: structuredClone(device.endpointReference), addressingNamespace: ADDRESSING,
        metadataVersion: device.metadataVersion, seenAt: device.seenAt, verifiedAt: device.verifiedAt,
        identityConflict: device.identityConflict, information: summary(device.information), services: summary(device.services),
        reads: device.reads.map((read) => ({ operation: read.operation, xaddr: read.xaddr, ...summary(read.outcome) })),
        resources: device.resources.map((resource) => ({
            namespace: resource.namespace, xaddr: resource.xaddr, kind: kinds[resource.kind], ...summary(resource.outcome)
        })),
        endpointProvenance: device.endpoints, curatedEvidence: device.registryEvidence,
        diagnostics: device.diagnostics,
        semantics: "Current outcomes and prior observation times are distinct. No inferred profile edition, client qualification, or certification."
    };
}

export function currentObservationTime(device: InventoryDevice, resource?: {
    serviceNamespace: string; kind: string; token: string; parentTokens: readonly { token: string }[];
}): number | null {
    if (resource) {
        const inventory = device.resources.find((entry) => entry.namespace === resource.serviceNamespace && kinds[entry.kind] === resource.kind
            && entry.outcome.status === "known" && entry.outcome.value.some((value) => value.token === resource.token
                && JSON.stringify(value.parentTokens) === JSON.stringify(resource.parentTokens.map((parent) => parent.token))));
        return inventory?.outcome.status === "known" ? inventory.outcome.observedAt : null;
    }
    const known = device.reads.filter((read) => read.outcome.status === "known").map((read) => read.outcome.observedAt);
    if (device.services.status !== "known" || !known.length) return null;
    return Math.min(device.services.observedAt, ...known);
}

export type { ObservationSource };
