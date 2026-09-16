export type UInt64Decimal = string;
import type { SemanticAdapterProjection } from "../../reference-runtime/dist/catalog/semantic-adapter";
import type { ThingDescription } from "wot-typescript-definitions";

export type BackendName = "windows-mf" | "mf-memory" | "linux-v4l2" | "aravis-gige" | "aravis-usb3" | "aravis-fake";
export type OutputFormat = "JPEG" | "I420";
export type EvidenceKind = "native-read-only" | "operator-supplied" | "synthetic" | "authorized-session-probe";

export interface IdentityEvidence {
    fingerprint: string;
    scope: "windows-instance-and-container" | "synthetic-memory" | "linux-device-node"
        | "aravis-gige-endpoint" | "aravis-usb-identity" | "synthetic-aravis";
    serial: null;
    transport: "unknown";
}
export interface ConfiguredTarget {
    backend: BackendName;
    privateSelector: string;
    adapterDeviceKey: string;
    expectedIdentity: IdentityEvidence;
}
export interface Mode {
    modeId: string;
    nativeMediaType: "video";
    nativeSubtype: string;
    width: number;
    height: number;
    cadence: { numerator: number; denominator: number } | null;
    stride: number;
    interlace: "progressive";
    evidenceLocator: string;
    nativeDetails?: string;
}
export interface CapabilityEvidence {
    targetKey: string;
    evidenceKind: EvidenceKind;
    identity: IdentityEvidence;
    modes: Mode[];
    digest: string;
    cached?: boolean;
}
export interface Limits {
    maxWidth: number;
    maxHeight: number;
    maxNativePayloadBytes: number;
    maxFrameBytes: number;
    maxQueuedFrames: number;
    maxQueuedBytes: number;
    maxSubscribers: number;
    maxInFlightFramesPerSubscriber: number;
    maxCachedJpegs: number;
    openDeadlineMs: number;
    readDeadlineMs: number;
    closeDeadlineMs: number;
    maxSnapshotAgeMs: number;
}
export interface FaultRecord {
    code: string;
    operation: string;
    retryable: boolean;
    diagnosticId: string;
    nativeDomain?: "HRESULT" | "errno" | "Aravis" | "libjpeg";
    nativeCode?: string;
    cleanup?: CloseResult;
}
export interface CloseResult {
    status: "closed" | "failed" | "forced";
    acquisitionStop: "not-started" | "acknowledged" | "failed" | "unknown";
    resources: "released" | "unknown";
    faults: FaultRecord[];
    workerExit: "observed";
}
export interface OwnedFrame {
    kind: "frame";
    generation: UInt64Decimal;
    sequence: UInt64Decimal;
    modeId: string;
    format: OutputFormat;
    width: number;
    height: number;
    payloadBytes: number;
    data: Uint8Array;
    freshnessOriginMonotonicNs: UInt64Decimal;
    timing: {
        hostReceiptMonotonicNs: UInt64Decimal;
        source: null;
        pipelinePtsNs: UInt64Decimal | null;
        sdkSampleTime100ns?: string | null;
        sdkSampleDuration100ns?: string | null;
        cameraTimestampNs?: UInt64Decimal;
        sdkSystemTimestampNs?: UInt64Decimal;
        nativeFrameId?: UInt64Decimal;
        nativeTimestampNs?: UInt64Decimal | null;
        nativeTimestampClock?: "monotonic" | "copy" | "unknown";
        nativeTimestampPoint?: "start-of-exposure" | "end-of-frame";
        nativeSequence?: UInt64Decimal;
        sdkTimeProvenance: string;
    };
}
export type FrameResult = OwnedFrame
    | { kind: "gap"; generation: UInt64Decimal; dropped: UInt64Decimal; reason: "overflow" | "native-incomplete" }
    | { kind: "end"; reason: "eos" };
export interface CaptureOpenRequest {
    target: ConfiguredTarget;
    modeId: string;
    capabilityEvidenceDigest: string;
    output: OutputFormat;
    limits?: Partial<Limits>;
    durationMs: number;
}
export type CapturePermission = (request: CaptureOpenRequest & { limits: Readonly<Limits> }) => boolean;
export class CaptureSession {
    readonly closed: Promise<CloseResult>;
    next(signal?: AbortSignal): Promise<FrameResult>;
    close(reason?: string): Promise<CloseResult>;
}
export class CaptureBackend {
    constructor(options: { workerPath: string; cachedEvidence?: CapabilityEvidence[]; authorizeOpen?: CapturePermission });
    describe(target: ConfiguredTarget, request?: {
        refresh?: "cached" | "native-read-only" | "authorized-session-probe";
        permitDeviceAccess?: boolean;
        permitControlProbe?: boolean;
        deadlineMs?: number;
    }, signal?: AbortSignal): Promise<CapabilityEvidence>;
    open(request: CaptureOpenRequest, signal?: AbortSignal): Promise<CaptureSession>;
}
export function configuredCapturePermission(request: CaptureOpenRequest & { permitAcquisition: true }): CapturePermission;
export function discover(options: { workerPath: string; permitDiscovery: true }, signal?: AbortSignal): Promise<{
    kind: "discovery";
    devices: { privateSelector: string; expectedIdentity: IdentityEvidence | null }[];
}>;
export function memoryTarget(adapterDeviceKey?: string): ConfiguredTarget;
export const DEFAULT_LIMITS: Readonly<Limits>;
export function normalizeLimits(input?: Partial<Limits>): Readonly<Limits>;
export interface SemanticTdOptions {
    id: string;
    title: string;
    modelId: string;
    origin: string;
    evidence: readonly { sourceId: string; detail?: string }[];
}
export type CreateSemanticAdapterTd = (options: SemanticTdOptions) => SemanticAdapterProjection;
export interface CanonicalContracts {
    profiles: { input(value: unknown): Record<string, unknown>; output(value: unknown): Record<string, unknown> };
    snapshot: { input(value: unknown): Record<string, unknown>; output(value: unknown): Record<string, unknown> };
    createSemanticAdapterTd: CreateSemanticAdapterTd;
    readonly registryDigest: string;
    readonly operationCount: number;
    readonly schemaId: string;
}
export function loadCanonical(options?: { dependencyAnchor?: string; bindingEntry?: string }): CanonicalContracts;
export class SourceFault extends Error implements FaultRecord {
    constructor(code: string, operation: string, options?: Partial<FaultRecord>);
    code: string;
    operation: string;
    retryable: boolean;
    diagnosticId: string;
    cleanup?: CloseResult;
    toJSON(): FaultRecord;
}
export interface SnapshotCopy {
    data: Uint8Array;
    release(): void;
}
export class SemanticAdapter {
    constructor(options: {
        canonical: CanonicalContracts; thingId: string; profile: Record<string, unknown>; modeId: string;
        createSemanticAdapterTd: CreateSemanticAdapterTd; limits?: Partial<Limits>; clock?: () => bigint;
        title?: string; evidence?: readonly { sourceId: string; detail?: string }[];
    });
    getProfiles(value: unknown): Record<string, unknown>;
    getSnapshotUri(value: unknown): Record<string, unknown>;
    configureProfile(profile: Record<string, unknown>, modeId: string): void;
    accept(frame: OwnedFrame): { kind: "accepted" } | { kind: "gap"; generation: UInt64Decimal; dropped: UInt64Decimal; reason: "overflow" };
    unavailable(fault?: SourceFault): void;
    acquireSnapshot(subscriber: string): SnapshotCopy;
    tdTemplate(origin: string): ThingDescription;
}
export function pump(session: CaptureSession, adapter: SemanticAdapter, signal?: AbortSignal): Promise<{
    status: "failed" | "closed"; fault: FaultRecord | null; close: CloseResult;
}>;
export function startServer(options: {
    adapter: SemanticAdapter; canonical: CanonicalContracts; port: number; address?: "127.0.0.1";
    permitPublication: true; controlToken: string; snapshotTokens: string[];
}): Promise<{ td: ThingDescription; tdUri: string; snapshotUri: string; close(): Promise<void> }>;
