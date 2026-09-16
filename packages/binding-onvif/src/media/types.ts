import type { Readable, Writable } from "node:stream";
import type { OnvifError } from "../binding/errors.js";
import type { OperationReference, OperationRegistry } from "../binding/registry.js";
import type { RequestAddressing } from "../binding/request.js";
import type { CanonicalValue } from "../xml/types.js";

export type MediaTransport = "tcp-interleaved" | "udp-unicast" | "http-tunnel" | "https-tunnel" | "tls-interleaved";
export type MediaVideoCodec = "JPEG" | "H264" | "H265" | "MP4V-ES";
export type MediaAudioCodec = "PCMU" | "MPEG4-GENERIC";
export type MediaCodec = MediaVideoCodec | MediaAudioCodec;
export type MediaControl = "open" | "close" | "pause" | "play" | "seek" | "credit";
export type MediaAuthentication = { readonly kind: "none" }
    | { readonly kind: "digest"; readonly realm: string; readonly allowLegacyMd5?: boolean };

export interface MediaTrustPolicy {
    readonly serviceTargets: readonly string[];
    readonly allowedOrigins: readonly string[];
    readonly allowedTargets?: readonly string[];
    readonly allowedRedirectOrigins?: readonly string[];
    readonly transports: readonly MediaTransport[];
    readonly authentication: MediaAuthentication;
    readonly tunnelAuthentication?: MediaAuthentication;
}

export interface MediaConsumerContext {
    readonly principal: string;
    readonly targetRef: string;
    readonly trust: MediaTrustPolicy;
    readonly document?: string;
}

export interface MediaSecurityScope {
    readonly thingId: string;
    readonly targetRef: string;
    readonly principal: string;
    readonly serviceTarget: string;
    readonly operation: OperationReference;
    readonly uri: string;
    readonly origin: string;
    readonly transport: MediaTransport;
    readonly authentication: MediaAuthentication;
    readonly tunnelOrigin?: string;
    readonly tunnelAuthentication?: MediaAuthentication;
}

export interface MediaScopedPassword {
    readonly origin: string;
    readonly principal: string;
    readonly realm: string;
    readonly username: string;
    readonly password: string;
}

export interface MediaSecurityMaterial {
    readonly thingId: string;
    readonly targetRef: string;
    readonly principal: string;
    readonly origin: string;
    readonly native?: MediaScopedPassword;
    readonly tunnel?: MediaScopedPassword;
    readonly caPem?: string;
}
export type MediaSecurityResolver = (scope: MediaSecurityScope, signal: AbortSignal) => Promise<MediaSecurityMaterial>;

export interface NativeWorkerOptions {
    readonly executable: string;
    readonly dllDirectory?: string;
}
export interface MediaWorkerExit {
    readonly observed: boolean;
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly spawnFailed?: boolean;
}
export interface NativeMediaProcess {
    readonly pid: number | undefined;
    readonly commands: Writable;
    readonly control: Readable;
    readonly stderr: Readable;
    readonly data: Readable;
    readonly secrets: Writable;
    readonly audio: Writable;
    readonly exit: Promise<MediaWorkerExit>;
    terminate(): boolean;
}
export type NativeMediaProcessFactory = (options: NativeWorkerOptions) => NativeMediaProcess;

export interface MediaExecutorOptions {
    readonly worker: NativeWorkerOptions;
    readonly security: MediaSecurityResolver;
    readonly registry?: OperationRegistry;
    readonly processFactory?: NativeMediaProcessFactory;
}
export interface MediaTrackRequest {
    readonly video?: readonly MediaVideoCodec[];
    readonly audio?: readonly MediaAudioCodec[];
    readonly metadata?: boolean;
    readonly backchannel?: "PCMU";
}
export interface MediaReplayRange {
    readonly startNtpNs: bigint;
    readonly endNtpNs: bigint;
}
export interface MediaLimits {
    readonly wireBytes: number;
    readonly inflatedBytes: number;
    readonly metadataDeadlineMs: number;
    readonly queueBytes: number;
    readonly queueUnits: number;
    readonly maxSubscribers: number;
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly decodedBytes: number;
    readonly closeTimeoutMs: number;
    readonly killTimeoutMs: number;
    readonly controlTimeoutMs: number;
    readonly partialFrameTimeoutMs: number;
    readonly stderrBytes: number;
}
export interface OpenMediaRequest {
    readonly action: string;
    readonly input: CanonicalValue;
    readonly formIndex?: number;
    readonly formRef?: MediaFormReference;
    readonly addressing?: RequestAddressing;
    readonly transport: MediaTransport;
    readonly tracks: MediaTrackRequest;
    readonly packetOutput?: boolean;
    readonly localAddress: string;
    readonly replay?: MediaReplayRange;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly limits?: Partial<MediaLimits>;
}
export interface MediaFormReference {
    readonly document: string;
    readonly form: string;
    readonly operation: "https://www.w3.org/2019/wot/td#invokeAction";
}
export interface MediaExecutionSelection {
    readonly thingId: string;
    readonly targetRef: string;
    readonly principal: string;
    readonly action: string;
    readonly formIndex: number;
    readonly operation: OperationReference;
    readonly serviceTarget: string;
    readonly uri: string;
    readonly transport: MediaTransport;
    readonly mode: "live" | "recorded";
}

export interface MediaTrack {
    readonly id: number;
    readonly kind: "video" | "audio" | "metadata";
    readonly direction: "receive" | "send";
    readonly encoding: string;
    readonly payloadType: number;
    readonly clockRate: number;
}
export interface MediaPlugin {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface MediaBackchannelFormat {
    readonly format: "S16LE";
    readonly sampleRate: 8000;
    readonly channels: 1;
    readonly maxBytes: number;
    readonly sampleBlock: 160;
}
export interface MediaBackchannelChunk {
    readonly format: "S16LE";
    readonly sampleRate: 8000;
    readonly channels: 1;
    readonly ptsNs: bigint;
    readonly bytes: Uint8Array;
}
export interface MediaSupport {
    readonly protocol: 2;
    readonly worker: string;
    readonly gstreamer: string;
    readonly nativeRevision: string;
    readonly decoders: readonly MediaCodec[];
    readonly transports: readonly MediaTransport[];
    readonly controls: readonly MediaControl[];
    readonly tls: boolean;
    readonly plugins: readonly MediaPlugin[];
    readonly backchannel?: MediaBackchannelFormat;
    readonly certification: false;
    readonly distributionApproved: false;
}
export interface MediaUnit {
    readonly track: number;
    readonly generation: number;
    readonly sequence: number;
}
export interface MediaRtpPacket extends MediaUnit {
    readonly kind: "rtp";
    readonly payloadType: number;
    readonly marker: boolean;
    readonly ssrc: number;
    readonly rtpSequence: number;
    readonly rtpTimestamp: number;
    readonly receiptMonoNs: bigint;
    readonly replayNtp: bigint;
    readonly replayFlags: number;
    readonly playCseqLow: number;
    readonly replayExtension: boolean;
    readonly jpegExtension: boolean;
    readonly bytes: Buffer;
}
export interface MediaSenderReport extends MediaUnit {
    readonly kind: "sender-report";
    readonly ssrc: number;
    readonly rtpTimestamp: number;
    readonly ntp: bigint;
    readonly receiptMonoNs: bigint;
    readonly clockRate: number;
    readonly incarnation: number;
}
export type MediaPacket = MediaRtpPacket | MediaSenderReport;
export interface MediaDecodedFrame extends MediaUnit {
    readonly kind: "decoded";
    readonly format: "I420" | "S16LE";
    readonly width: number;
    readonly height: number;
    readonly sampleRate: number;
    readonly channels: number;
    readonly count: number;
    readonly ptsNs: bigint | undefined;
    readonly bytes: Buffer;
}
export interface NativeMetadataDocument extends MediaUnit {
    readonly kind: "metadata";
    readonly firstRtpSequence: number;
    readonly lastRtpSequence: number;
    readonly ssrc: number;
    readonly firstRtpTimestamp: number;
    readonly lastRtpTimestamp: number;
    readonly receiptMonoNs: bigint;
    readonly xml: Buffer;
}
export interface MediaMetadata extends NativeMetadataDocument {
    readonly value: CanonicalValue;
    readonly originalSource: {
        readonly thingId: string;
        readonly targetRef: string;
        readonly uri: string;
        readonly nativeSessionId: string;
        readonly track: number;
        readonly ssrc: number;
    };
    readonly clock: {
        readonly rate: number;
        readonly firstRtpTimestamp: number;
        readonly lastRtpTimestamp: number;
        readonly receiptMonoNs: bigint;
        readonly senderReport?: MediaSenderReport;
    };
}
export type NativeMediaUnit = MediaPacket | MediaDecodedFrame | NativeMetadataDocument;
export interface MediaFrameReadable extends Readable {
    [Symbol.asyncIterator](): NodeJS.AsyncIterator<MediaDecodedFrame>;
}
export interface MediaDiagnostic {
    readonly kind: "gap" | "native" | "lifecycle";
    readonly code: string;
    readonly generation: number;
    readonly track?: number;
    readonly droppedUnits?: number;
    readonly status?: number;
    readonly method?: string;
    readonly lastDataSequence?: number;
    readonly certificateErrors?: number;
}
export type MediaSessionState = "opening" | "playing" | "paused" | "closing" | "closed";
export interface MediaControlReceipt {
    readonly state: "playing" | "paused";
    readonly generation: number;
    readonly acknowledged: true;
}
export interface MediaCloseResult {
    readonly remote: "acknowledged" | "already-ended" | "uncertain" | "not-created";
    readonly localCleanup: boolean;
    readonly teardownStatus: number;
    readonly workerExit: MediaWorkerExit;
    readonly terminated: boolean;
    readonly droppedUnits: number;
    readonly droppedDiagnostics: number;
    readonly stderrBytes: number;
    readonly backchannelPackets?: number;
    readonly backchannelSamples?: number;
    readonly failure?: OnvifError;
}
export interface MediaSession {
    readonly id: number;
    readonly nativeSessionId: string;
    readonly generation: number;
    readonly state: MediaSessionState;
    readonly selection: MediaExecutionSelection;
    readonly support: MediaSupport;
    readonly tracks: readonly MediaTrack[];
    readonly packets: AsyncIterable<MediaPacket>;
    readonly metadata: AsyncIterable<MediaMetadata>;
    readonly diagnostics: AsyncIterable<MediaDiagnostic>;
    readonly backchannel: Writable | undefined;
    readonly closed: Promise<MediaCloseResult>;
    frames(): MediaFrameReadable;
    play(): Promise<MediaControlReceipt>;
    pause(): Promise<MediaControlReceipt>;
    seek(range: MediaReplayRange): Promise<MediaControlReceipt>;
    close(): Promise<MediaCloseResult>;
}
