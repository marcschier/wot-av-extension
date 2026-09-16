import type { OperationReference } from "../binding/registry.js";
import type { QName, XmlElement } from "../xml/types.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type OutcomeStatus = "known" | "unsupported" | "denied" | "fault" | "timeout" | "truncated" | "unknown";
export type ReadResult<T> =
    | { status: "known"; value: T }
    | { status: Exclude<OutcomeStatus, "known">; code: string; message: string; partial?: T };
export interface ObservationSource { operation: OperationReference; xaddr: string; }
export type Observation<T> = ReadResult<T> & {
    observedAt: number;
    source?: ObservationSource;
    lastKnown?: { value: T; observedAt: number; source?: ObservationSource };
};
export type DeviceState = "candidate" | "verified" | "suspect" | "stale" | "conflict" | "departed";

export interface Diagnostic {
    code: string;
    message: string;
    at: number;
    deviceId?: string;
}

export interface DiscoveryEndpointReference {
    address: string;
    referenceProperties: XmlElement[];
    referenceParameters: XmlElement[];
}

export interface AppSequence {
    instanceId: string;
    sequenceId: string | null;
    messageNumber: string;
}

export type AnnouncementKind = "Hello" | "Bye" | "ProbeMatches" | "ResolveMatches";
export interface DiscoveryMatch {
    endpointReference: DiscoveryEndpointReference;
    types: QName[];
    scopes: string[];
    scopeMatchBy: string | null;
    xaddrs: string[];
    metadataVersion: string | null;
}

export interface DiscoveryMessage {
    kind: AnnouncementKind;
    messageId: string;
    relatesTo: string | null;
    to: string;
    sequence: AppSequence | null;
    matches: DiscoveryMatch[];
    discoveryProxy: boolean;
}

export interface Provenance {
    interfaceId: string;
    segmentId: string;
    address: string;
    family: "IPv4" | "IPv6";
    port: number;
    receivedAt: number;
    messageId: string;
}

export interface EndpointObservation {
    xaddr: string;
    approval: "approved" | "unapproved";
    provenance: Provenance[];
}

export interface SequenceWatermark {
    sequenceId: string | null;
    messageNumber: string;
    kind: AnnouncementKind;
}

export interface ProfileClaim {
    scope: string;
    label: string;
    source: "discovery-scope" | "GetScopes";
    observedAt: number;
}

export interface DeviceInformation {
    manufacturer: string;
    model: string;
    firmwareVersion: string;
    serialNumber: string;
    hardwareId: string;
}

export interface ServiceSnapshot {
    namespace: string;
    xaddr: string;
    version: { major: number; minor: number } | null;
    capabilities: Observation<JsonValue>;
}

export type ResourceKind = "media-profile" | "video-source-configuration" | "video-encoder-configuration"
    | "metadata-configuration" | "recording" | "recording-job" | "track" | "access-point"
    | "door" | "access-profile" | "schedule" | "receiver" | "analytics-configuration"
    | "analytics-module" | "analytics-rule";

export interface NativeResource {
    token: string;
    parentTokens: string[];
    fixed: boolean | null;
    data: JsonObject;
}

export interface ResourceInventory {
    namespace: string;
    xaddr: string;
    kind: ResourceKind;
    outcome: Observation<NativeResource[]>;
}

export interface ReadObservation {
    operation: OperationReference;
    xaddr: string;
    args: JsonObject;
    outcome: Observation<JsonValue>;
    responded?: boolean;
}

export interface FeatureObservation {
    namespace: string;
    feature: string;
    operation: OperationReference;
    outcome: Observation<JsonValue>;
}

export interface IdentityEvidence {
    kind: "authenticated" | "provisioned";
    authority: string;
    subject: string;
    xaddr: string;
    observedAt: number;
}

export interface CuratedConformanceEvidence {
    endpointAddress: string;
    profile: "A" | "C" | "D" | "G" | "M" | "S" | "T";
    edition: string;
    product: string;
    firmwareVersion: string;
    authority: string;
    reference: string;
    status: "unverified" | "matched" | "firmware-mismatch";
}

export interface DeviceSnapshot {
    id: string;
    endpointReference: DiscoveryEndpointReference;
    state: DeviceState;
    identityConflict: boolean;
    epoch: number;
    inspectionGeneration: number;
    ordering: { instanceId: string | null; sequences: SequenceWatermark[] };
    metadataVersion: string | null;
    types: QName[];
    scopes: string[];
    claims: ProfileClaim[];
    endpoints: EndpointObservation[];
    provenance: Provenance[];
    seenAt: number;
    verifiedAt: number | null;
    updatedAt: number;
    suspectSince: number | null;
    failedLivenessRounds: number;
    lastLivenessRound: number | null;
    information: Observation<DeviceInformation>;
    services: Observation<ServiceSnapshot[]>;
    reads: ReadObservation[];
    resources: ResourceInventory[];
    observedFeatures: FeatureObservation[];
    identityEvidence: IdentityEvidence[];
    registryEvidence: CuratedConformanceEvidence[];
    diagnostics: Diagnostic[];
}

export interface SeedSnapshot {
    seedId: string;
    xaddr: string;
    interfaceId: string;
    segmentId: string;
    expectedEndpointAddress: string | null;
    resolvedDeviceId: string | null;
    outcome: Observation<string>;
}

export interface InventorySnapshot {
    schemaVersion: 1;
    revision: number;
    capturedAt: number;
    devices: DeviceSnapshot[];
    seeds: SeedSnapshot[];
    diagnostics: Diagnostic[];
    truncated: boolean;
}

export interface InspectionToken {
    deviceId: string;
    epoch: number;
    generation: number;
}

export interface InspectionReport {
    information: Observation<DeviceInformation>;
    services: Observation<ServiceSnapshot[]>;
    scopes: Observation<string[]>;
    endpointReference: Observation<DiscoveryEndpointReference>;
    reads: ReadObservation[];
    resources: ResourceInventory[];
    observedFeatures: FeatureObservation[];
    identityEvidence: IdentityEvidence[];
    completedAt: number;
    responsive: boolean;
    truncated: boolean;
}

export type TimerHandle = object;
export interface Clock {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): TimerHandle;
    clearTimeout(handle: TimerHandle): void;
}

export interface InterfaceRef {
    id: string;
    address: string;
    family: "IPv4" | "IPv6";
    zone?: string;
}

export interface Segment {
    id: string;
    interfaceId: string;
    cidr: string;
    destination: { address: string; port: number };
    listenPort: number;
    multicast: boolean;
}

export interface Datagram {
    data: Uint8Array;
    address: string;
    family: "IPv4" | "IPv6";
    port: number;
}

export interface DatagramChannel {
    send(data: Uint8Array, destination: { address: string; port: number }): Promise<void>;
    close(): Promise<void>;
}

export interface DatagramAdapter {
    open(
        local: InterfaceRef,
        segment: Segment,
        receive: (datagram: Datagram) => void,
        failure: (error: Error) => void
    ): Promise<DatagramChannel>;
}

export interface NativeTarget {
    xaddr: string;
    endpointReference: DiscoveryEndpointReference | null;
    interfaceId: string;
    segmentId: string;
}

export interface NativeReadRequest {
    signal: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
}

export type NativeReadResult = ReadResult<JsonValue> & { identityEvidence?: IdentityEvidence; responded?: boolean };
export interface NativeReadAdapter {
    executeReadonly(
        operationKey: string,
        args: JsonObject,
        target: NativeTarget,
        request: NativeReadRequest
    ): Promise<NativeReadResult>;
    close(): Promise<void>;
}

export interface InventoryPersistence {
    load(): Promise<InventorySnapshot | null>;
    save(snapshot: InventorySnapshot): Promise<void>;
    close(): Promise<void>;
}

export interface Bounds {
    maxDevices: number;
    maxDatagramBytes: number;
    maxDatagramsPerRound: number;
    maxPendingRequests: number;
    maxMessageIds: number;
    maxSequenceIds: number;
    maxXAddrs: number;
    maxProvenance: number;
    maxDiagnostics: number;
    maxScopes: number;
    maxTypes: number;
    maxMatches: number;
    maxConcurrentInspections: number;
    maxQueuedInspections: number;
    maxServices: number;
    maxRequestsPerInspection: number;
    maxPages: number;
    maxResources: number;
    maxReadBytes: number;
    maxInspectionBytes: number;
    maxStoreBytes: number;
}

export interface Timers {
    probeWindowMs: number;
    probeIntervalMs: number;
    retransmitMinMs: number;
    retransmitMaxMs: number;
    inspectionTimeoutMs: number;
    readTimeoutMs: number;
    refreshMs: number;
    staleMs: number;
    departureGraceMs: number;
}

export interface DiscoveryOptions {
    interfaces: readonly InterfaceRef[];
    segments: readonly Segment[];
    allowedXAddrs: readonly string[];
    scopes?: readonly string[];
    seeds?: readonly {
        seedId: string;
        xaddr: string;
        interfaceId: string;
        segmentId: string;
        expectedEndpointAddress?: string;
    }[];
    ipv6?: "disabled" | "bestEffort" | "required";
    untypedFallback?: { enabled: boolean; maxProbesPerRound: number };
    missingSequence?: "reject" | "candidate";
    retransmissions?: number;
    bounds?: Partial<Bounds>;
    timers?: Partial<Timers>;
}

export interface DiscoveryPorts {
    datagrams: DatagramAdapter;
    nativeRead: NativeReadAdapter;
    persistence: InventoryPersistence;
    clock?: Clock;
    random?: () => number;
    messageId?: () => string;
}

export interface DiscoveryEngine {
    start(options: DiscoveryOptions): Promise<void>;
    snapshot(): InventorySnapshot;
    probe(): Promise<void>;
    resolve(endpointReference: DiscoveryEndpointReference, segmentId: string): Promise<void>;
    inspect(deviceId: string): Promise<InspectionReport | null>;
    reconcile(): Promise<void>;
    whenIdle(): Promise<void>;
    close(): Promise<void>;
}
