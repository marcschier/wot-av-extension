import { isIP } from "node:net";
import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";
import type { Bounds, DiscoveryOptions, InterfaceRef, JsonValue, Segment, Timers } from "./types.js";

export function assertJson(value: unknown, maxNodes = 20000, maxDepth = 64, maxBytes = 16 * 1024 * 1024): asserts value is JsonValue {
    let nodes = 0;
    let bytes = 0;
    const add = (count: number): void => {
        bytes += count;
        if (bytes > maxBytes) throw new OnvifError("XmlLimit", "Canonical JSON exceeds its byte bound");
    };
    const text = (value: string): void => {
        if (value.length > maxBytes - bytes) throw new OnvifError("XmlLimit", "Canonical string exceeds its byte bound");
        add(Buffer.byteLength(JSON.stringify(value)));
    };
    const visit = (item: unknown, depth: number): void => {
        if (++nodes > maxNodes || depth > maxDepth) throw new OnvifError("XmlLimit", "Canonical JSON exceeds its structural bound");
        if (item === null) { add(4); return; }
        if (typeof item === "string") { text(item); return; }
        if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) { add(JSON.stringify(item).length); return; }
        if (Array.isArray(item)) {
            add(2 + Math.max(0, item.length - 1));
            for (const child of item) visit(child, depth + 1);
            return;
        }
        if (isRecord(item) && Object.getPrototypeOf(item) === Object.prototype && !Object.getOwnPropertySymbols(item).length) {
            const keys = Object.keys(item);
            add(2 + Math.max(0, keys.length - 1));
            for (const key of keys) { text(key); add(1); visit(item[key], depth + 1); }
            return;
        }
        throw new OnvifError("InvalidValue", "Inspection data must be finite canonical JSON, not opaque runtime handles");
    };
    visit(value, 0);
}

export const DEFAULT_BOUNDS: Readonly<Bounds> = Object.freeze({
    maxDevices: 128, maxDatagramBytes: 32768, maxDatagramsPerRound: 1024,
    maxPendingRequests: 64, maxMessageIds: 1024, maxSequenceIds: 16,
    maxXAddrs: 16, maxProvenance: 32, maxDiagnostics: 128, maxScopes: 64,
    maxTypes: 16, maxMatches: 32, maxConcurrentInspections: 4,
    maxQueuedInspections: 128, maxServices: 32, maxRequestsPerInspection: 48,
    maxPages: 4, maxResources: 256, maxReadBytes: 1024 * 1024,
    maxInspectionBytes: 4 * 1024 * 1024, maxStoreBytes: 8 * 1024 * 1024
});

export const DEFAULT_TIMERS: Readonly<Timers> = Object.freeze({
    probeWindowMs: 3000, probeIntervalMs: 30000, retransmitMinMs: 50,
    retransmitMaxMs: 250, inspectionTimeoutMs: 15000, readTimeoutMs: 3000,
    refreshMs: 60000, staleMs: 180000, departureGraceMs: 60000
});

function configuration(message: string): never {
    throw new OnvifError("InvalidConfiguration", message);
}

export function boundedOptions(options: Partial<Bounds> = {}): Bounds {
    for (const key of Object.keys(options)) {
        if (!Object.hasOwn(DEFAULT_BOUNDS, key)) configuration("Unknown discovery bound");
    }
    const result = { ...DEFAULT_BOUNDS, ...options };
    for (const key of Object.keys(DEFAULT_BOUNDS) as (keyof Bounds)[]) {
        positiveInteger(result[key], key, Math.max(DEFAULT_BOUNDS[key] * 16, 64));
    }
    positiveInteger(result.maxDatagramBytes, "maxDatagramBytes", 65507);
    positiveInteger(result.maxReadBytes, "maxReadBytes", 16 * 1024 * 1024);
    positiveInteger(result.maxConcurrentInspections, "maxConcurrentInspections", 32);
    positiveInteger(result.maxStoreBytes, "maxStoreBytes", 64 * 1024 * 1024);
    return result;
}

export function timerOptions(options: Partial<Timers> = {}): Timers {
    for (const key of Object.keys(options)) {
        if (!Object.hasOwn(DEFAULT_TIMERS, key)) configuration("Unknown discovery timer");
    }
    const result = { ...DEFAULT_TIMERS, ...options };
    for (const key of Object.keys(DEFAULT_TIMERS) as (keyof Timers)[]) {
        positiveInteger(result[key], key, 2147483647);
    }
    if (result.retransmitMinMs > result.retransmitMaxMs
        || result.probeWindowMs > result.probeIntervalMs
        || result.readTimeoutMs > result.inspectionTimeoutMs
        || result.refreshMs > result.staleMs) configuration("Inconsistent discovery timers");
    return result;
}

export function uriReference(value: string): boolean {
    return value.length <= 4096 && !/[\u0000-\u0020\\"<>^`{|}]/u.test(value)
        && !/%(?![0-9a-f]{2})/iu.test(value);
}

export function absoluteUri(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/iu.test(value) && uriReference(value);
}

export function validateXAddr(value: string): string {
    if (typeof value !== "string" || !absoluteUri(value)) {
        throw new OnvifError("InvalidValue", "Native XAddr must be a bounded absolute HTTP(S) URI");
    }
    let url: URL;
    try { url = new URL(value); } catch {
        throw new OnvifError("InvalidValue", "Invalid native XAddr");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
        || !url.hostname || /%0[ad]/iu.test(value)) {
        throw new OnvifError("PolicyDenied", "XAddr contains a prohibited scheme, credential, fragment or control escape");
    }
    return value;
}

export function approveXAddr(value: string, allowed: ReadonlySet<string>): boolean {
    validateXAddr(value);
    return allowed.has(value);
}

function ipNumber(input: string): { bits: number; value: bigint } {
    const address = input.split("%")[0] ?? "";
    const family = isIP(address);
    if (family === 4) {
        return { bits: 32, value: address.split(".").reduce((value, octet) => (value << 8n) | BigInt(octet), 0n) };
    }
    if (family !== 6) configuration("A numeric IP address is required");
    let expanded = address;
    if (expanded.includes(".")) {
        const lastColon = expanded.lastIndexOf(":");
        const v4 = ipNumber(expanded.slice(lastColon + 1)).value;
        expanded = `${expanded.slice(0, lastColon)}:${(v4 >> 16n).toString(16)}:${(v4 & 65535n).toString(16)}`;
    }
    const halves = expanded.split("::");
    const left = (halves[0] ?? "").split(":").filter(Boolean);
    const right = (halves[1] ?? "").split(":").filter(Boolean);
    const words = halves.length === 1 ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
    return { bits: 128, value: words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n) };
}

export function inCidr(address: string, cidr: string): boolean {
    const parts = cidr.split("/");
    if (parts.length !== 2 || !/^\d+$/u.test(parts[1] ?? "")) configuration("Explicit numeric CIDR is required");
    const network = ipNumber(parts[0] ?? "");
    const prefix = Number(parts[1]);
    if (prefix <= 0 || prefix > network.bits) configuration("CIDR must confine a nonzero network prefix");
    const input = ipNumber(address);
    if (input.bits !== network.bits) return false;
    const shift = BigInt(network.bits - prefix);
    if ((network.value >> shift) << shift !== network.value) configuration("CIDR must use its canonical network address");
    return input.value >> shift === network.value >> shift;
}

export function sameIp(a: string, b: string): boolean {
    const left = ipNumber(a);
    const right = ipNumber(b);
    return left.bits === right.bits && left.value === right.value;
}

function validateSegment(local: InterfaceRef, segment: Segment): void {
    if (!inCidr(local.address, segment.cidr)) configuration("Interface is outside its configured segment");
    if (!Number.isInteger(segment.listenPort) || segment.listenPort < 0 || segment.listenPort > 65535) {
        configuration("Invalid UDP listen port");
    }
    positiveInteger(segment.destination.port, "discovery destination port", 65535);
    if (segment.multicast) {
        const expected = local.family === "IPv4" ? "239.255.255.250" : "ff02::c";
        if (!sameIp(segment.destination.address, expected) || segment.destination.port !== 3702 || segment.listenPort !== 3702) {
            configuration("Only native WS-Discovery multicast destinations are allowed");
        }
    } else if (!inCidr(segment.destination.address, segment.cidr)) {
        configuration("Unicast discovery destination is outside the configured segment");
    }
    if (segment.destination.address.includes("%")) configuration("Destination zones are resolved from the configured interface");
}

export interface ValidatedOptions {
    options: DiscoveryOptions;
    bounds: Bounds;
    timers: Timers;
    allowed: ReadonlySet<string>;
}

export function validateOptions(input: DiscoveryOptions): ValidatedOptions {
    const options = structuredClone(input);
    if (!options || !Array.isArray(options.interfaces) || !options.interfaces.length
        || options.interfaces.length > 32 || !Array.isArray(options.segments) || !options.segments.length
        || options.segments.length > 64 || !Array.isArray(options.allowedXAddrs)
        || options.allowedXAddrs.length > 4096) configuration("Explicit bounded interfaces, segments and XAddr allowlist are required");
    const keys = ["interfaces", "segments", "allowedXAddrs", "scopes", "seeds", "ipv6",
        "untypedFallback", "missingSequence", "retransmissions", "bounds", "timers"];
    if (Object.keys(options).some((key) => !keys.includes(key))) configuration("Unknown discovery option");
    const bounds = boundedOptions(options.bounds);
    const timers = timerOptions(options.timers);
    const ids = new Set<string>();
    for (const local of options.interfaces) {
        if (!local.id || ids.has(local.id) || local.address.includes("%")
            || isIP(local.address) !== (local.family === "IPv4" ? 4 : local.family === "IPv6" ? 6 : 0)
            || ["0.0.0.0", "::"].includes(local.address)
            || (local.zone !== undefined && !/^[a-z0-9_.-]+$/iu.test(local.zone))) {
            configuration("Interfaces must have unique IDs and exact non-wildcard numeric addresses");
        }
        ids.add(local.id);
    }
    const segments = new Set<string>();
    for (const segment of options.segments) {
        const local = options.interfaces.find((item) => item.id === segment.interfaceId);
        if (!segment.id || segments.has(segment.id) || !local || typeof segment.multicast !== "boolean") {
            configuration("Segments must reference a configured interface and have unique IDs");
        }
        validateSegment(local, segment);
        segments.add(segment.id);
    }
    if (options.ipv6 !== undefined && !["disabled", "bestEffort", "required"].includes(options.ipv6)) configuration("Invalid IPv6 policy");
    if (options.missingSequence !== undefined && !["reject", "candidate"].includes(options.missingSequence)) configuration("Invalid sequence policy");
    if (options.ipv6 === "required" && !options.interfaces.some((local) => local.family === "IPv6")) configuration("Required IPv6 needs a configured IPv6 interface");
    if (options.retransmissions !== undefined) positiveInteger(options.retransmissions, "retransmissions", 4);
    if (options.untypedFallback !== undefined) {
        if (typeof options.untypedFallback.enabled !== "boolean") configuration("Invalid untyped fallback policy");
        positiveInteger(options.untypedFallback.maxProbesPerRound, "maxProbesPerRound", 64);
    }
    if ((options.scopes?.length ?? 0) > bounds.maxScopes
        || options.scopes?.some((scope) => !absoluteUri(scope))) configuration("Invalid or excessive discovery scopes");
    const allowed = new Set(options.allowedXAddrs.map(validateXAddr));
    const seeds = new Set<string>();
    if ((options.seeds?.length ?? 0) > bounds.maxDevices) configuration("Too many provisional seeds");
    for (const seed of options.seeds ?? []) {
        const segment = options.segments.find((item) => item.id === seed.segmentId);
        if (!seed.seedId || seeds.has(seed.seedId) || segment?.interfaceId !== seed.interfaceId
            || !approveXAddr(seed.xaddr, allowed)
            || (seed.expectedEndpointAddress !== undefined && !absoluteUri(seed.expectedEndpointAddress))) {
            configuration("Seeds require unique explicit IDs, configured provenance and an approved exact XAddr");
        }
        seeds.add(seed.seedId);
    }
    return { options, bounds, timers, allowed };
}
