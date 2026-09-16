import { isRecord, OnvifError } from "../binding/errors.js";
import { operationKey, operationReference } from "../binding/registry.js";
import { assertXmlElement } from "../xml/parser.js";
import { isQName } from "../xml/types.js";
import { absoluteUri, assertJson, DEFAULT_BOUNDS, uriReference, validateXAddr } from "./policy.js";
import { endpointIdentity, protocolCounter } from "./protocol.js";
import { readonlyContract } from "./operations.js";
import type { Bounds, DiscoveryEndpointReference, InventorySnapshot } from "./types.js";

function expect(condition: unknown, message: string): asserts condition {
    if (!condition) throw new OnvifError("InvalidValue", `Invalid discovery snapshot: ${message}`);
}
function record(value: unknown): Record<string, unknown> {
    expect(isRecord(value), "object required");
    return value;
}
function text(value: unknown, maximum = 4096): asserts value is string {
    expect(typeof value === "string" && value.length <= maximum, "bounded string required");
}
function number(value: unknown): asserts value is number {
    expect(Number.isSafeInteger(value) && typeof value === "number" && value >= 0, "nonnegative finite integer required");
}
function optionalNumber(value: unknown): void { if (value !== null) number(value); }
function list(value: unknown, maximum: number, each: (item: unknown) => void): void {
    expect(Array.isArray(value) && value.length <= maximum, "bounded array required");
    for (const item of value) each(item);
}
function diagnostic(value: unknown): void {
    const item = record(value);
    text(item.code); text(item.message); number(item.at);
    if (item.deviceId !== undefined) text(item.deviceId);
}
function endpoint(value: unknown): asserts value is DiscoveryEndpointReference {
    const item = record(value);
    text(item.address);
    expect(absoluteUri(item.address), "absolute EPR address required");
    list(item.referenceProperties, 128, assertXmlElement);
    list(item.referenceParameters, 128, assertXmlElement);
}
function provenance(value: unknown): void {
    const item = record(value);
    text(item.interfaceId); text(item.segmentId); text(item.address); text(item.messageId);
    expect(item.family === "IPv4" || item.family === "IPv6", "IP family required");
    number(item.port); expect(item.port <= 65535, "UDP port outside range");
    number(item.receivedAt);
}
function observation(value: unknown, validate: (item: unknown) => void): void {
    const item = record(value);
    number(item.observedAt);
    const source = (value: unknown): void => {
        const data = record(value);
        operation(data.operation); text(data.xaddr); validateXAddr(data.xaddr);
    };
    if (item.source !== undefined) source(item.source);
    if (item.lastKnown !== undefined) {
        const prior = record(item.lastKnown);
        number(prior.observedAt);
        validate(prior.value);
        if (prior.source !== undefined) source(prior.source);
    }
    if (item.status === "known") validate(item.value);
    else {
        expect(["unsupported", "denied", "fault", "timeout", "truncated", "unknown"].includes(String(item.status)), "unknown observation status");
        text(item.code); text(item.message);
        if (item.partial !== undefined) validate(item.partial);
    }
}
function nativeJson(value: unknown): void { assertJson(value); }
function information(value: unknown): void {
    const item = record(value);
    for (const key of ["manufacturer", "model", "firmwareVersion", "serialNumber", "hardwareId"]) text(item[key]);
}
function service(value: unknown): void {
    const item = record(value);
    text(item.namespace); text(item.xaddr); validateXAddr(item.xaddr);
    expect(absoluteUri(item.namespace), "absolute service namespace required");
    if (item.version !== null) {
        const version = record(item.version);
        number(version.major); number(version.minor);
    }
    observation(item.capabilities, nativeJson);
}
function resource(value: unknown): void {
    const item = record(value);
    text(item.token);
    list(item.parentTokens, 32, (token) => text(token));
    expect(item.fixed === null || typeof item.fixed === "boolean", "native fixed flag required");
    record(item.data); nativeJson(item.data);
}
function operation(value: unknown): void { readonlyContract(operationKey(operationReference(value))); }
function identity(value: unknown): void {
    const item = record(value);
    expect(item.kind === "authenticated" || item.kind === "provisioned", "identity evidence authority required");
    text(item.authority); text(item.subject); text(item.xaddr); validateXAddr(item.xaddr); number(item.observedAt);
}

export function assertSnapshot(value: unknown, bounds: Readonly<Bounds> = DEFAULT_BOUNDS): asserts value is InventorySnapshot {
    try { assertJson(value, Math.max(20000, bounds.maxStoreBytes), 64, bounds.maxStoreBytes); }
    catch (error) {
        if (error instanceof OnvifError && error.code === "XmlLimit") {
            throw new OnvifError("InvalidValue", "Discovery snapshot exceeds its byte or structural bound");
        }
        throw error;
    }
    expect(Buffer.byteLength(JSON.stringify(value)) <= bounds.maxStoreBytes, "snapshot byte limit exceeded");
    const snapshot = record(value);
    expect(snapshot.schemaVersion === 1, "unsupported schema version");
    number(snapshot.revision); number(snapshot.capturedAt);
    expect(typeof snapshot.truncated === "boolean", "truncation flag required");
    list(snapshot.diagnostics, bounds.maxDiagnostics, diagnostic);
    const ids = new Set<string>();
    list(snapshot.devices, bounds.maxDevices, (value) => {
        const device = record(value);
        text(device.id);
        expect(!ids.has(device.id), "duplicate EPR identity");
        ids.add(device.id);
        endpoint(device.endpointReference);
        expect(device.id === endpointIdentity(device.endpointReference), "EPR-derived identity mismatch");
        expect(["candidate", "verified", "suspect", "stale", "conflict", "departed"].includes(String(device.state)), "unknown lifecycle state");
        expect(typeof device.identityConflict === "boolean" && (!device.identityConflict || device.state === "conflict"), "identity quarantine must remain explicit");
        number(device.epoch); number(device.inspectionGeneration);
        const order = record(device.ordering);
        if (order.instanceId !== null) { text(order.instanceId); protocolCounter(order.instanceId); }
        const sequences = new Set<unknown>();
        list(order.sequences, bounds.maxSequenceIds, (value) => {
            const sequence = record(value);
            if (sequence.sequenceId !== null) { text(sequence.sequenceId); expect(uriReference(sequence.sequenceId), "invalid SequenceId"); }
            expect(!sequences.has(sequence.sequenceId), "duplicate sequence watermark");
            sequences.add(sequence.sequenceId);
            text(sequence.messageNumber); protocolCounter(sequence.messageNumber);
            expect(["Hello", "Bye", "ProbeMatches", "ResolveMatches"].includes(String(sequence.kind)), "unknown announcement kind");
        });
        if (device.metadataVersion !== null) { text(device.metadataVersion); protocolCounter(device.metadataVersion); }
        list(device.types, bounds.maxTypes, (type) => expect(isQName(type), "expanded QName required"));
        list(device.scopes, bounds.maxScopes, (scope) => { text(scope); expect(absoluteUri(scope), "absolute scope required"); });
        list(device.claims, bounds.maxScopes, (value) => {
            const claim = record(value); text(claim.scope); text(claim.label); number(claim.observedAt);
            expect(claim.source === "discovery-scope" || claim.source === "GetScopes", "claim provenance required");
        });
        list(device.endpoints, bounds.maxXAddrs, (value) => {
            const item = record(value); text(item.xaddr); validateXAddr(item.xaddr);
            expect(item.approval === "approved" || item.approval === "unapproved", "explicit endpoint approval required");
            list(item.provenance, bounds.maxProvenance, provenance);
        });
        list(device.provenance, bounds.maxProvenance, provenance);
        number(device.seenAt); number(device.updatedAt); optionalNumber(device.verifiedAt); optionalNumber(device.suspectSince);
        number(device.failedLivenessRounds); optionalNumber(device.lastLivenessRound);
        observation(device.information, information);
        observation(device.services, (services) => list(services, bounds.maxServices, service));
        list(device.reads, bounds.maxRequestsPerInspection, (value) => {
            const item = record(value); operation(item.operation); text(item.xaddr); validateXAddr(item.xaddr);
            record(item.args); nativeJson(item.args); observation(item.outcome, nativeJson);
        });
        list(device.resources, bounds.maxServices * 16, (value) => {
            const item = record(value); text(item.namespace); text(item.xaddr); validateXAddr(item.xaddr);
            expect(["media-profile", "video-source-configuration", "video-encoder-configuration", "metadata-configuration",
                "recording", "recording-job", "track", "access-point", "door", "access-profile", "schedule", "receiver",
                "analytics-configuration", "analytics-module", "analytics-rule"].includes(String(item.kind)), "native resource kind required");
            observation(item.outcome, (values) => list(values, bounds.maxResources, resource));
        });
        list(device.observedFeatures, bounds.maxRequestsPerInspection * 2, (value) => {
            const item = record(value); text(item.namespace); text(item.feature); operation(item.operation); observation(item.outcome, nativeJson);
        });
        list(device.identityEvidence, bounds.maxProvenance, identity);
        list(device.registryEvidence, 32, (value) => {
            const item = record(value);
            for (const key of ["endpointAddress", "edition", "product", "firmwareVersion", "authority", "reference"]) text(item[key]);
            expect(["A", "C", "D", "G", "M", "S", "T"].includes(String(item.profile)), "released profile required");
            expect(["unverified", "matched", "firmware-mismatch"].includes(String(item.status)), "curated firmware association status required");
        });
        list(device.diagnostics, bounds.maxDiagnostics, diagnostic);
    });
    const seeds = new Set<string>();
    list(snapshot.seeds, bounds.maxDevices, (value) => {
        const seed = record(value);
        text(seed.seedId); text(seed.xaddr); validateXAddr(seed.xaddr); text(seed.interfaceId); text(seed.segmentId);
        expect(!seeds.has(seed.seedId), "duplicate provisional seed ID"); seeds.add(seed.seedId);
        if (seed.expectedEndpointAddress !== null) text(seed.expectedEndpointAddress);
        if (seed.resolvedDeviceId !== null) { text(seed.resolvedDeviceId); expect(ids.has(seed.resolvedDeviceId), "seed resolves to absent device"); }
        observation(seed.outcome, (id) => text(id));
    });
}
