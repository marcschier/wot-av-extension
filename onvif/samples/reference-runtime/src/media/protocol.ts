import { isRecord, OnvifError } from "../binding/errors.js";
import { ipcString, IpcKind, MEDIA_CONTROL_MAX, type IpcFrame } from "./ipc.js";
import { isMediaCodec, MEDIA_TRANSPORTS } from "./policy.js";
import type {
    MediaBackchannelChunk, MediaBackchannelFormat, MediaCodec, MediaControl, MediaLimits, MediaPlugin, MediaSecurityMaterial,
    MediaSecurityScope, MediaSupport, MediaTrack, MediaTransport, MediaTrustPolicy, NativeMediaUnit, OpenMediaRequest
} from "./types.js";

function invalid(message = "Invalid native media descriptor"): never { throw new OnvifError("InvalidValue", message); }
function uint(value: unknown, maximum = 0xffffffff, minimum = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
    return value;
}
function text(value: unknown, maximum = 256): string {
    if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/u.test(value)
        || Buffer.byteLength(value, "utf8") > maximum) invalid();
    return value;
}
function array<T>(value: unknown, maximum: number, check: (item: unknown) => T): readonly T[] {
    if (!Array.isArray(value) || value.length > maximum) invalid();
    const items = value.map(check);
    if (new Set(items).size !== items.length) invalid("Duplicate native capability");
    return Object.freeze(items);
}
function transport(value: unknown): MediaTransport {
    for (const name of MEDIA_TRANSPORTS) if (name === value) return name;
    return invalid("Unknown native transport capability");
}
function control(value: unknown): MediaControl {
    for (const name of ["open", "close", "pause", "play", "seek", "credit"] as const) if (name === value) return name;
    return invalid("Unknown native control capability");
}
function codec(value: unknown): MediaCodec {
    if (!isMediaCodec(value)) invalid("Unknown native decoder capability");
    return value;
}

export function parseSupport(value: Record<string, unknown>): MediaSupport {
    const revision = typeof value.nativeRevision === "string"
        ? /^classic-media-v2-scoped-auth-([1-9][0-9]*)$/u.exec(value.nativeRevision) : null;
    if (value.protocol !== 2 || revision === null || !Number.isSafeInteger(Number(revision[1])) || Number(revision[1]) < 2
        || value.nativeCredentialInput !== true || value.worker !== "onvif-media-reference"
        || value.scope !== "explicit-native-origin-interface-principal-policy"
        || value.metadataGuard !== "bounded-xml-root-not-canonical-validation"
        || value.certification !== false || value.distributionApproved !== false) {
        throw new OnvifError("UnsupportedCapability", "Worker does not implement the scoped native media v2 contract");
    }
    if (typeof value.tlsBackend !== "boolean") invalid("Invalid native TLS capability");
    const plugins = array<MediaPlugin>(value.plugins, 128, (entry) => {
        if (!isRecord(entry)) invalid("Invalid native plugin inventory");
        const sha256 = text(entry.sha256, 64);
        if (!/^[a-f0-9]{64}$/u.test(sha256)) invalid("Invalid native plugin digest");
        return Object.freeze({ name: text(entry.name), version: text(entry.version, 64), license: text(entry.license),
            bytes: uint(entry.bytes, 0xffffffff, 1), sha256 });
    });
    if (new Set(plugins.map((plugin) => plugin.name)).size !== plugins.length) invalid("Duplicate native plugin identity");
    let backchannel: MediaBackchannelFormat | undefined;
    if (value.backchannelInput !== undefined) {
        if (value.backchannelInput !== "PCMU-from-S16LE-8000-mono-private-fd5") {
            throw new OnvifError("UnsupportedCapability", "Unsupported native backchannel input contract");
        }
        backchannel = Object.freeze({ format: "S16LE", sampleRate: 8000, channels: 1, maxBytes: 1600, sampleBlock: 160 });
    }
    return Object.freeze({
        protocol: 2, worker: value.worker, gstreamer: text(value.gstreamer, 64), nativeRevision: text(value.nativeRevision, 128),
        decoders: array(value.availableDecoders, 6, codec), transports: array(value.transports, 5, transport),
        controls: array(value.controls, 6, control), tls: value.tlsBackend, plugins,
        ...(backchannel === undefined ? {} : { backchannel }), certification: false, distributionApproved: false
    });
}

export function requireMediaSupport(support: MediaSupport, request: OpenMediaRequest): void {
    if (!support.transports.includes(request.transport)
        || !["open", "close", "credit"].every((name) => support.controls.some((value) => value === name))
        || (request.transport === "https-tunnel" || request.transport === "tls-interleaved") && !support.tls) {
        throw new OnvifError("UnsupportedCapability", "Required native transport, TLS or lifecycle capability is unavailable");
    }
    for (const codecs of [request.tracks.video, request.tracks.audio]) {
        if (codecs !== undefined && !codecs.some((value) => support.decoders.includes(value))) {
            throw new OnvifError("UnsupportedCapability", "No installed native decoder meets the requested track");
        }
    }
    if (request.tracks.backchannel !== undefined && (support.backchannel === undefined || !support.decoders.includes("PCMU"))) {
        throw new OnvifError("UnsupportedCapability", "Native worker has no qualified backchannel input");
    }
}

export function parseReady(value: Record<string, unknown>, request: OpenMediaRequest, support: MediaSupport): readonly MediaTrack[] {
    nativeSessionId(value);
    if (value.state !== "playing" || value.protocolReady !== true || value.receivingIsSeparate !== true) {
        invalid("Native READY did not acknowledge protocol and sink readiness");
    }
    const tracks = array<MediaTrack>(value.tracks, 4, (entry) => {
        if (!isRecord(entry)) invalid("Invalid negotiated native track");
        const id = uint(entry.id, 4, 1), encoding = text(entry.encoding, 128);
        const kind = id === 1 ? "video" : id === 3 ? "metadata" : "audio";
        const direction = id === 4 ? "send" : "receive";
        if (entry.kind !== kind || entry.direction !== direction) invalid("Native track identity or direction mismatch");
        if (id === 3) {
            if (!request.tracks.metadata || !["VND.ONVIF.METADATA", "VND.ONVIF.METADATA.GZIP"].includes(encoding.toUpperCase())) {
                throw new OnvifError("UnsupportedCapability", "Required XML metadata track is not negotiated");
            }
        } else {
            const selected: readonly string[] | undefined = id === 1 ? request.tracks.video
                : id === 2 ? request.tracks.audio : request.tracks.backchannel === undefined ? undefined : ["PCMU"];
            if (!isMediaCodec(encoding) || !selected?.includes(encoding) || !support.decoders.includes(encoding)
                || id === 4 && (support.backchannel === undefined || entry.clockRate !== 8000)) {
                throw new OnvifError("UnsupportedCapability", "Negotiated native codec is not supported and explicitly requested");
            }
        }
        return Object.freeze({ id, kind, direction, encoding, payloadType: uint(entry.payloadType, 127),
            clockRate: uint(entry.clockRate, 192000, 1) });
    });
    const ids = new Set(tracks.map((track) => track.id));
    if (ids.size !== tracks.length || (request.tracks.video !== undefined) !== ids.has(1)
        || (request.tracks.audio !== undefined) !== ids.has(2) || !!request.tracks.metadata !== ids.has(3)
        || (request.tracks.backchannel !== undefined) !== ids.has(4)) {
        throw new OnvifError("UnsupportedCapability", "A required native media track is missing or duplicated");
    }
    return tracks;
}

export function nativeSessionId(value: Record<string, unknown>): string { return text(value.nativeSessionId, 256); }

export function backchannelChunk(value: unknown): MediaBackchannelChunk {
    if (!isRecord(value) || Object.keys(value).some((key) => !["format", "sampleRate", "channels", "ptsNs", "bytes"].includes(key))
        || value.format !== "S16LE" || value.sampleRate !== 8000 || value.channels !== 1
        || typeof value.ptsNs !== "bigint" || value.ptsNs < 0n || value.ptsNs > 0xffffffffffffffffn
        || !(value.bytes instanceof Uint8Array) || !value.bytes.byteLength
        || value.bytes.byteLength > 1600 || value.bytes.byteLength % 320) {
        invalid("Backchannel requires bounded 20ms blocks of S16LE/8000Hz/mono PCM and an exact bigint timestamp");
    }
    return { format: "S16LE", sampleRate: 8000, channels: 1, ptsNs: value.ptsNs, bytes: Buffer.from(value.bytes) };
}

export function encodeBackchannel(chunk: MediaBackchannelChunk, samples: bigint): Buffer {
    if (chunk.ptsNs !== samples * 125000n) invalid("Backchannel timestamp must match the contiguous native sample clock");
    const payload = Buffer.alloc(16 + chunk.bytes.byteLength);
    payload.writeUInt16BE(4, 0);
    payload.writeUInt16BE(2, 2);
    payload.writeUInt32BE(8000, 4);
    payload.writeUInt16BE(1, 8);
    payload.writeUInt32BE(chunk.bytes.byteLength / 2, 12);
    payload.set(chunk.bytes, 16);
    return payload;
}

export interface MediaOpenDescriptor {
    readonly request: OpenMediaRequest;
    readonly scope: MediaSecurityScope;
    readonly trust: MediaTrustPolicy;
    readonly limits: MediaLimits;
    readonly trackMask: number;
    readonly codecMask: number;
    readonly credentialHandle: number;
    readonly trustHandle: number;
}

function strings(values: readonly string[]): Buffer {
    const count = Buffer.alloc(2);
    count.writeUInt16BE(uint(values.length, 16), 0);
    return Buffer.concat([count, ...values.map((value) => ipcString(value, 2048, "native origin"))]);
}
export function encodeOpen(descriptor: MediaOpenDescriptor): Buffer {
    const { request, scope, limits } = descriptor;
    const fixed = Buffer.alloc(64);
    fixed[0] = request.replay === undefined ? 0 : 1;
    fixed[1] = MEDIA_TRANSPORTS.indexOf(request.transport) + 1;
    fixed[2] = uint(descriptor.trackMask, 15, 1);
    fixed[3] = (request.packetOutput ? 1 : 0) | (scope.authentication.kind === "none" ? 2 : 0);
    fixed.writeUInt32BE(uint(descriptor.credentialHandle), 4);
    fixed.writeUInt32BE(uint(descriptor.trustHandle, 0xffffffff, 1), 8);
    fixed.writeBigUInt64BE(request.replay?.startNtpNs ?? 0n, 12);
    fixed.writeBigUInt64BE(request.replay?.endNtpNs ?? 0n, 20);
    [limits.wireBytes, limits.inflatedBytes, limits.metadataDeadlineMs, limits.queueBytes, limits.queueUnits,
        limits.maxWidth, limits.maxHeight, limits.decodedBytes, descriptor.codecMask]
        .forEach((value, index) => fixed.writeUInt32BE(uint(value), 28 + index * 4));
    const result = Buffer.concat([fixed,
        ipcString(scope.uri, 2048, "native URI"), ipcString(scope.targetRef, 256, "target reference"),
        ipcString(scope.principal, 256, "principal"), ipcString(request.localAddress, 64, "local interface"),
        strings(descriptor.trust.allowedOrigins), strings(descriptor.trust.allowedRedirectOrigins ?? [])]);
    if (result.length > MEDIA_CONTROL_MAX) invalid("Native OPEN exceeds its bound");
    return result;
}

export function encodeSecurity(descriptor: MediaOpenDescriptor, material: MediaSecurityMaterial): Buffer {
    const { scope } = descriptor;
    const fixed = Buffer.alloc(12);
    fixed.writeUInt32BE(uint(descriptor.credentialHandle), 0);
    fixed.writeUInt32BE(uint(descriptor.trustHandle, 0xffffffff, 1), 4);
    fixed[8] = scope.authentication.kind === "digest" && scope.authentication.allowLegacyMd5
        || scope.tunnelAuthentication?.kind === "digest" && scope.tunnelAuthentication.allowLegacyMd5 ? 1 : 0;
    const values = [
        ipcString(scope.targetRef, 256, "target reference"), ipcString(scope.principal, 256, "principal"),
        ipcString(scope.origin, 2048, "native origin"), ipcString(material.native?.realm ?? "", 1024, "native realm"),
        ipcString(material.native?.username ?? "", 1024, "native username"),
        ipcString(material.native?.password ?? "", 1024, "native password"),
        ipcString(material.tunnel?.origin ?? "", 2048, "outer origin"),
        ipcString(material.tunnel?.realm ?? "", 1024, "outer realm"),
        ipcString(material.tunnel?.username ?? "", 1024, "outer username"),
        ipcString(material.tunnel?.password ?? "", 1024, "outer password"),
        ipcString(material.caPem ?? "", 32768, "CA PEM")
    ];
    try {
        const result = Buffer.concat([fixed, ...values]);
        if (result.length > MEDIA_CONTROL_MAX) {
            result.fill(0);
            invalid("Native security descriptor exceeds its bound");
        }
        return result;
    } finally { for (const value of values) value.fill(0); }
}

function descriptor(frame: IpcFrame, prefix: number, lengthAt?: number, maximum?: number): Buffer {
    const payload = frame.payload;
    if (!frame.session || !frame.generation || !frame.sequence || payload.length < prefix
        || lengthAt === undefined && payload.length !== prefix) invalid();
    if (lengthAt !== undefined) {
        const length = payload.readUInt32BE(lengthAt);
        if (!length || length !== payload.length - prefix || maximum !== undefined && length > maximum) invalid();
    }
    return payload;
}

function checkRtp(payload: Buffer, packet: Buffer): void {
    if (packet.length < 12 || packet[0] === undefined || packet[1] === undefined
        || packet[0] >>> 6 !== 2 || payload[3] === undefined || payload[3] > 1
        || (packet[1] & 127) !== payload[2] || (packet[1] >>> 7) !== payload[3]
        || packet.readUInt16BE(2) !== payload.readUInt16BE(8)
        || packet.readUInt32BE(4) !== payload.readUInt32BE(12) || packet.readUInt32BE(8) !== payload.readUInt32BE(4)) {
        invalid("RTP descriptor disagrees with the native packet");
    }
    let offset = 12 + 4 * (packet[0] & 15), replay = false, jpeg = false;
    if (offset > packet.length) invalid("Truncated RTP source list");
    if (packet[0] & 16) {
        if (offset + 4 > packet.length) invalid("Truncated RTP extension");
        let profile = packet.readUInt16BE(offset);
        const words = packet.readUInt16BE(offset + 2), end = offset + 4 + words * 4;
        offset += 4;
        if (end > packet.length) invalid("Truncated RTP extension length");
        if (profile === 0xabac) {
            replay = true;
            if (words < 3 || packet.readBigUInt64BE(offset) !== payload.readBigUInt64BE(24)
                || packet[offset + 8] !== payload[10] || packet[offset + 9] !== payload[11]
                || packet.readUInt16BE(offset + 10) !== 0 || (packet[offset + 8] ?? 0) & 15) {
                invalid("ONVIF replay descriptor disagrees with its native extension");
            }
            if (words > 3) {
                if (words < 4 || words !== 4 + packet.readUInt16BE(offset + 14)) invalid("Invalid nested JPEG extension");
                profile = packet.readUInt16BE(offset + 12);
            }
        }
        jpeg = profile === 0xffd8 || profile === 0xffff;
        offset = end;
    }
    const options = payload.readUInt32BE(32);
    if (options > 3 || !!(options & 1) !== replay || !!(options & 2) !== jpeg
        || !replay && (payload.readBigUInt64BE(24) !== 0n || payload[10] !== 0 || payload[11] !== 0)) {
        invalid("Invalid native RTP extension flags");
    }
    if (packet[0] & 32) {
        const padding = packet[packet.length - 1] ?? 0;
        if (!padding || padding > packet.length - offset) invalid("Invalid RTP padding");
    }
}

export function decodeMediaData(frame: IpcFrame, limits: MediaLimits): NativeMediaUnit {
    let payload: Buffer;
    if (frame.kind === IpcKind.RTP) {
        payload = descriptor(frame, 40, 36, limits.wireBytes);
        const track = uint(payload.readUInt16BE(0), 3, 1), packet = payload.subarray(40);
        checkRtp(payload, packet);
        return { kind: "rtp", track, generation: frame.generation, sequence: frame.sequence,
            payloadType: payload[2] ?? invalid(), marker: payload[3] === 1, ssrc: payload.readUInt32BE(4),
            rtpSequence: payload.readUInt16BE(8), rtpTimestamp: payload.readUInt32BE(12),
            receiptMonoNs: payload.readBigUInt64BE(16), replayNtp: payload.readBigUInt64BE(24),
            replayFlags: payload[10] ?? invalid(), playCseqLow: payload[11] ?? invalid(),
            replayExtension: !!(payload.readUInt32BE(32) & 1), jpegExtension: !!(payload.readUInt32BE(32) & 2), bytes: packet };
    }
    if (frame.kind === IpcKind.DECODED) {
        payload = descriptor(frame, 36, 32, limits.decodedBytes);
        const track = uint(payload.readUInt16BE(0), 2, 1), format = payload.readUInt16BE(2);
        const width = payload.readUInt32BE(4), height = payload.readUInt32BE(8), sampleRate = payload.readUInt32BE(12);
        const channels = payload.readUInt16BE(16), count = payload.readUInt32BE(20), bytes = payload.subarray(36);
        if (format !== track || payload.readUInt16BE(18) !== 0 || !count) invalid("Invalid decoded frame format");
        if (format === 1) {
            if (!width || !height || width > limits.maxWidth || height > limits.maxHeight
                || sampleRate || channels || count !== 1
                || bytes.length !== width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2)) {
                invalid("Invalid decoded I420 dimensions or byte count");
            }
        } else if (width || height || !sampleRate || sampleRate > 96000 || !channels || channels > 8
            || bytes.length !== count * channels * 2) invalid("Invalid decoded PCM dimensions or byte count");
        const pts = payload.readBigUInt64BE(24);
        return { kind: "decoded", track, generation: frame.generation, sequence: frame.sequence,
            format: format === 1 ? "I420" : "S16LE", width, height, sampleRate, channels, count,
            ptsNs: pts === 0xffffffffffffffffn ? undefined : pts, bytes };
    }
    if (frame.kind === IpcKind.METADATA) {
        payload = descriptor(frame, 32, 28, limits.inflatedBytes);
        if (payload.readUInt16BE(0) !== 3 || payload.readUInt16BE(2) !== 0) invalid("Invalid metadata track descriptor");
        return { kind: "metadata", track: 3, generation: frame.generation, sequence: frame.sequence,
            firstRtpSequence: payload.readUInt16BE(4), lastRtpSequence: payload.readUInt16BE(6),
            ssrc: payload.readUInt32BE(8), firstRtpTimestamp: payload.readUInt32BE(12), lastRtpTimestamp: payload.readUInt32BE(16),
            receiptMonoNs: payload.readBigUInt64BE(20), xml: payload.subarray(32) };
    }
    if (frame.kind === IpcKind.RTCP) {
        payload = descriptor(frame, 36);
        if (payload.readUInt16BE(2) !== 0) invalid("Invalid RTCP reserved field");
        return { kind: "sender-report", track: uint(payload.readUInt16BE(0), 3, 1), generation: frame.generation,
            sequence: frame.sequence, ssrc: payload.readUInt32BE(4), rtpTimestamp: payload.readUInt32BE(8),
            ntp: payload.readBigUInt64BE(12), receiptMonoNs: payload.readBigUInt64BE(20),
            clockRate: uint(payload.readUInt32BE(28), 192000, 1), incarnation: uint(payload.readUInt32BE(32), 0xffffffff, 1) };
    }
    return invalid("Unknown native data descriptor");
}

export interface NativeCloseReceipt {
    readonly localCleanup: boolean;
    readonly remote: "acknowledged" | "already-ended" | "uncertain" | "not-created";
    readonly teardownStatus: number;
    readonly dataDiscardedFrames: number;
    readonly dataQueuePeakBytes: number;
    readonly backchannelPackets: number;
    readonly backchannelSamples: number;
}
export function parseClose(value: Record<string, unknown>): NativeCloseReceipt {
    const remote = value.remote;
    if (typeof value.localCleanup !== "boolean" || value.awaitWorkerExit !== true
        || remote !== "acknowledged" && remote !== "already-ended" && remote !== "uncertain" && remote !== "not-created") {
        invalid("Invalid native CLOSED receipt");
    }
    const status = uint(value.teardownStatus, 599);
    if (remote === "acknowledged" && (status < 200 || status >= 300)
        || remote === "already-ended" && status !== 454 || remote === "not-created" && status !== 0
        || remote === "uncertain" && (status >= 200 && status < 300 || status === 454)) {
        invalid("Native CLOSED remote outcome disagrees with its RTSP status");
    }
    const backchannelPackets = uint(value.backchannelPackets), backchannelSamples = uint(value.backchannelSamples);
    if (backchannelSamples < backchannelPackets || backchannelSamples > backchannelPackets * 160) {
        invalid("Native CLOSED backchannel packet and sample counts disagree");
    }
    return { localCleanup: value.localCleanup, remote, teardownStatus: status,
        dataDiscardedFrames: uint(value.dataDiscardedFrames), dataQueuePeakBytes: uint(value.dataQueuePeakBytes, 128 * 1024 * 1024),
        backchannelPackets, backchannelSamples };
}
