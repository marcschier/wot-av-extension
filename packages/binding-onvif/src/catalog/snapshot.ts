import type { OperationReference } from "../binding/registry.js";
import type { XmlElement } from "../xml/types.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ObservationState = "known" | "unsupported" | "denied" | "fault" | "timeout" | "truncated" | "unknown";

export interface ObservationEvidence {
    readonly sourceId: string;
    readonly observedAt?: string;
    readonly operation?: OperationReference;
    readonly detail?: string;
}

export type Observation<T> = {
    readonly state: "known";
    readonly value: T;
    readonly evidence: readonly ObservationEvidence[];
} | {
    readonly state: Exclude<ObservationState, "known">;
    readonly evidence: readonly ObservationEvidence[];
    readonly detail?: string;
};

export interface SnapshotOperation {
    readonly operation: string;
    readonly portType?: string;
    readonly binding?: string;
}

export interface NativeReadOutcome extends SnapshotOperation {
    readonly outcome: Observation<JsonValue>;
}

export interface ServiceSnapshot {
    readonly namespace: string;
    readonly xaddr: string;
    readonly version?: { readonly major: number; readonly minor: number };
    readonly evidence: readonly ObservationEvidence[];
    readonly capabilities: Observation<Readonly<Record<string, JsonValue>>>;
    readonly readOutcomes: readonly NativeReadOutcome[];
    readonly supportedOperations?: readonly (SnapshotOperation & {
        readonly support: Observation<boolean>;
    })[];
}

export interface ProfileClaim {
    readonly profile: string;
    readonly edition?: string;
    readonly role: "device" | "client";
    readonly evidence: readonly ObservationEvidence[];
}

export interface ResourceToken {
    readonly kind: string;
    readonly token: string;
}

export interface ResourceSnapshot {
    readonly serviceNamespace: string;
    readonly kind: string;
    readonly token: string;
    readonly parentTokens: readonly ResourceToken[];
    readonly evidence: readonly ObservationEvidence[];
    readonly facts?: Readonly<Record<string, Observation<JsonValue>>>;
    readonly operations?: readonly SnapshotOperation[];
}

export interface RegisteredConformanceEvidence {
    readonly issuer: string;
    readonly product: string;
    readonly firmware: string;
    readonly profile: string;
    readonly edition?: string;
    readonly source: string;
}

/**
 * Offline composition seam. "known" means an observation, not conformance.
 * Preserve native XAddrs and parent-scoped tokens; do not put credentials here.
 */
export interface DeviceSnapshot {
    readonly schemaVersion: 1;
    readonly epr: {
        readonly address: string;
        readonly referenceProperties: readonly XmlElement[];
        readonly referenceParameters?: readonly XmlElement[];
    };
    readonly identity?: Observation<{
        readonly manufacturer?: string;
        readonly model?: string;
        readonly firmwareVersion?: string;
        readonly serialNumber?: string;
        readonly hardwareId?: string;
    }>;
    readonly services: readonly ServiceSnapshot[];
    readonly profileClaims: readonly ProfileClaim[];
    readonly resources: readonly ResourceSnapshot[];
    readonly facts?: Readonly<Record<string, Observation<JsonValue>>>;
    readonly conformanceEvidence?: readonly RegisteredConformanceEvidence[];
}
