import { randomInt } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { OnvifError, type ExecutionCertainty, type OnvifErrorCode } from "../binding/errors.js";
import type { CanonicalValue } from "../xml/types.js";
import { Deferred, mediaAborted, mediaError } from "./async.js";
import { decodeControl, encodeEnvelope, IpcFrameDecoder, IpcKind, MEDIA_CONTROL_MAX, type IpcFrame } from "./ipc.js";
import { validateReplayRange } from "./policy.js";
import {
    backchannelChunk, decodeMediaData, encodeBackchannel, encodeOpen, encodeSecurity, nativeSessionId,
    parseClose, parseReady, parseSupport, requireMediaSupport,
    type MediaOpenDescriptor, type NativeCloseReceipt
} from "./protocol.js";
import { BoundedMediaQueue } from "./queue.js";
import type {
    MediaCloseResult, MediaControlReceipt, MediaDecodedFrame, MediaDiagnostic, MediaExecutionSelection,
    MediaFrameReadable, MediaMetadata, MediaPacket, MediaReplayRange, MediaSecurityMaterial, MediaSession,
    MediaSenderReport, MediaSessionState, MediaSupport, MediaTrack, MediaWorkerExit, NativeMediaProcess, NativeMediaUnit
} from "./types.js";

export class MediaNativeError extends OnvifError {
    constructor(code: OnvifErrorCode, readonly nativeCode: string, execution: ExecutionCertainty) {
        super(code, "Native media rejected the operation", execution);
        this.name = "MediaNativeError";
    }
}

export class MediaOpenError extends OnvifError {
    readonly nativeCode?: string;
    constructor(error: OnvifError, readonly cleanup: MediaCloseResult) {
        super(error.code, error.message, error.execution);
        this.name = "MediaOpenError";
        if (error instanceof MediaNativeError) this.nativeCode = error.nativeCode;
    }
}

export interface NativeSessionOptions {
    readonly process: NativeMediaProcess;
    readonly descriptor: MediaOpenDescriptor;
    readonly selection: MediaExecutionSelection;
    readonly material: MediaSecurityMaterial;
    readonly decodeMetadata: (bytes: Uint8Array) => CanonicalValue;
    readonly signal: AbortSignal;
}

class FrameReadable extends Readable implements MediaFrameReadable {
    private reading = false;
    constructor(private readonly sourceIterator: AsyncIterableIterator<MediaDecodedFrame>, private readonly released: () => void) {
        super({ objectMode: true, highWaterMark: 1, autoDestroy: true });
    }
    override _read(): void {
        if (this.reading || this.destroyed) return;
        this.reading = true;
        void this.sourceIterator.next().then((next) => {
            this.reading = false;
            if (!this.destroyed) this.push(next.done ? null : next.value);
        }, (error: unknown) => {
            this.reading = false;
            this.destroy(mediaError(error, "Decoded frame subscriber failed"));
        });
    }
    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.released();
        if (this.sourceIterator.return === undefined) { callback(error); return; }
        void this.sourceIterator.return().then(() => callback(error), (reason: unknown) =>
            callback(mediaError(reason, "Decoded frame subscriber cleanup failed")));
    }
    override [Symbol.asyncIterator](): NodeJS.AsyncIterator<MediaDecodedFrame> { return super[Symbol.asyncIterator](); }
}

class BackchannelWritable extends Writable {
    private samples = 0n;
    private sequence = 0;
    private timer: NodeJS.Timeout | undefined;
    private writing: ((error?: Error | null) => void) | undefined;

    constructor(
        private readonly inputPipe: Writable,
        private readonly transmit: (sequence: number, payload: Buffer) => Promise<void>,
        private readonly canWrite: () => boolean
    ) {
        super({ objectMode: true, highWaterMark: 1, autoDestroy: true });
    }

    override write(chunk: unknown, callback?: (error?: Error | null) => void): boolean;
    override write(chunk: unknown, encoding: BufferEncoding, callback?: (error?: Error | null) => void): boolean;
    override write(chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void): boolean {
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        try {
            if (this.writableLength >= 8) throw new OnvifError("InvalidValue", "Backchannel writable credit capacity exceeded");
            const value = backchannelChunk(chunk);
            return super.write(value, done);
        } catch (error) {
            const failure = mediaError(error, "Invalid backchannel input");
            if (done !== undefined) process.nextTick(done, failure);
            this.destroy(failure);
            return false;
        }
    }

    override end(callback?: () => void): this;
    override end(chunk: unknown, callback?: () => void): this;
    override end(chunk: unknown, encoding: BufferEncoding, callback?: () => void): this;
    override end(chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): this {
        const done = typeof chunk === "function" ? () => { chunk(); }
            : typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        if (chunk !== undefined && typeof chunk !== "function") this.write(chunk);
        return super.end(done);
    }

    override _write(value: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        try {
            if (!this.canWrite()) throw new OnvifError("InvalidValue", "Backchannel is not in an acknowledged playing generation");
            if (this.sequence === 0xffffffff) throw new OnvifError("InvalidValue", "Backchannel input sequence exhausted");
            const chunk = backchannelChunk(value), payload = encodeBackchannel(chunk, this.samples);
            const samples = chunk.bytes.byteLength / 2;
            this.writing = callback;
            void this.transmit(++this.sequence, payload).then(() => {
                if (this.destroyed) return;
                this.samples += BigInt(samples);
                // fd5 has no remote credit/ACK message. Pace input by its native sample clock.
                this.timer = setTimeout(() => this.complete(), samples / 8);
            }, (error: unknown) => this.complete(mediaError(error, "Native backchannel pipe write failed")));
        } catch (error) { callback(mediaError(error, "Invalid backchannel input")); }
    }

    private complete(error?: Error): void {
        const callback = this.writing;
        this.writing = undefined;
        clearTimeout(this.timer);
        callback?.(error);
    }

    override _final(callback: (error?: Error | null) => void): void {
        if (this.inputPipe.destroyed) { callback(new OnvifError("TransportError", "Native backchannel input closed before flush")); return; }
        this.inputPipe.end(callback);
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.complete(error ?? new OnvifError("RuntimeClosed", "Backchannel input is closed"));
        if (!this.inputPipe.destroyed && !this.inputPipe.writableEnded) this.inputPipe.end();
        callback(error);
    }
}

interface PendingControl {
    readonly kind: number;
    readonly sequence: number;
    readonly generation: number;
    readonly timer: NodeJS.Timeout;
    readonly result: Deferred<MediaControlReceipt>;
}
interface StagedUnit { readonly value: NativeMediaUnit; readonly bytes: number; readonly release: () => void; }

class NativeSession implements MediaSession {
    readonly id = randomInt(1, 0x100000000);
    readonly closed: Promise<MediaCloseResult>;
    readonly selection: MediaExecutionSelection;
    readonly packets: AsyncIterable<MediaPacket>;
    readonly metadata: AsyncIterable<MediaMetadata>;
    readonly diagnostics: AsyncIterable<MediaDiagnostic>;
    readonly ready = new Deferred<MediaSession>();
    private readonly completion = new Deferred<MediaCloseResult>();
    private readonly process: NativeMediaProcess;
    private readonly descriptor: MediaOpenDescriptor;
    private readonly decodeMetadata: (bytes: Uint8Array) => CanonicalValue;
    private readonly signal: AbortSignal;
    private readonly packetQueue: BoundedMediaQueue<MediaPacket>;
    private readonly metadataQueue: BoundedMediaQueue<MediaMetadata>;
    private readonly decodedQueue: BoundedMediaQueue<MediaDecodedFrame>;
    private readonly diagnosticQueue: BoundedMediaQueue<MediaDiagnostic>;
    private readonly readers = new Set<FrameReadable>();
    private readonly senderReports = new Map<number, MediaSenderReport>();
    private readonly controlDecoder = new IpcFrameDecoder("control");
    private readonly dataDecoder: IpcFrameDecoder;
    private readonly watchdog: NodeJS.Timeout;
    private readonly openTimer: NodeJS.Timeout;
    private material: MediaSecurityMaterial | undefined;
    private inventory: MediaSupport | undefined;
    private negotiated: readonly MediaTrack[] = [];
    private sending: BackchannelWritable | undefined;
    private nativeIdentity = "";
    private ending: { generation: number; watermark: number; observedAt: number; complete: boolean } | undefined;
    private currentState: MediaSessionState = "opening";
    private currentGeneration = 0;
    private expectedGeneration = 1;
    private commandSequence = 0;
    private openSequence = 0;
    private closeSequence = 0;
    private dataSequence = 0;
    private openSent = false;
    private failure: OnvifError | undefined;
    private receipt: NativeCloseReceipt | undefined;
    private pending: PendingControl | undefined;
    private abandoned: PendingControl | undefined;
    private staged: StagedUnit[] = [];
    private stagedBytes = 0;
    private creditBytes = 0;
    private creditUnits = 0;
    private creditWriting = false;
    private outstandingBytes = 0;
    private outstandingUnits = 0;
    private localDropped = 0;
    private diagnosticDropped = 0;
    private stderrCount = 0;
    private closeTimer: NodeJS.Timeout | undefined;
    private killTimer: NodeJS.Timeout | undefined;
    private terminated = false;

    constructor(options: NativeSessionOptions) {
        this.process = options.process;
        this.descriptor = options.descriptor;
        this.selection = Object.freeze(options.selection);
        this.material = options.material;
        this.decodeMetadata = options.decodeMetadata;
        this.signal = options.signal;
        this.closed = this.completion.promise;
        const limits = this.descriptor.limits;
        this.dataDecoder = new IpcFrameDecoder("data", Math.min(limits.queueBytes - 24,
            Math.max(limits.decodedBytes + 36, limits.inflatedBytes + 32, limits.wireBytes + 40)));
        this.diagnosticQueue = new BoundedMediaQueue({
            maxBytes: 65536, maxUnits: 128, maxSubscribers: limits.maxSubscribers,
            mode: "live", onGap: (units) => { this.diagnosticDropped += units; }
        });
        const queue = {
            maxBytes: limits.queueBytes, maxUnits: limits.queueUnits, maxSubscribers: limits.maxSubscribers,
            mode: this.selection.mode,
            onGap: (units: number): void => {
                this.localDropped += units;
                this.diagnostic({ kind: "gap", code: "ConsumerQueueOverflow", droppedUnits: units });
            }
        };
        this.packetQueue = new BoundedMediaQueue(queue);
        this.metadataQueue = new BoundedMediaQueue(queue);
        this.decodedQueue = new BoundedMediaQueue(queue);
        this.packets = this.packetQueue;
        this.metadata = this.metadataQueue;
        this.diagnostics = this.diagnosticQueue;
        this.openTimer = setTimeout(() => this.fail(new OnvifError("TransportError", "Native media readiness exceeded its deadline", "unknown")),
            this.descriptor.request.timeoutMs ?? 12000);
        this.watchdog = setInterval(() => {
            const now = Date.now();
            if ([this.controlDecoder, this.dataDecoder].some((decoder) =>
                decoder.incompleteSince !== undefined && now - decoder.incompleteSince > limits.partialFrameTimeoutMs)) {
                this.fail(new OnvifError("TransportError", "Incomplete native IPC frame exceeded its deadline", "unknown"));
            }
            if (this.ending !== undefined && !this.ending.complete
                && now - this.ending.observedAt > limits.controlTimeoutMs) {
                this.fail(new OnvifError("TransportError", "Native END data watermark did not arrive before its deadline", "unknown"));
            }
            try { this.flushCredits(); } catch (error) { this.fail(mediaError(error, "Native media credit accounting failed")); }
        }, Math.min(50, limits.partialFrameTimeoutMs));
        this.listen(this.process.control, this.controlDecoder, (frame) => this.control(frame), true);
        this.listen(this.process.data, this.dataDecoder, (frame) => this.data(frame), false);
        this.process.stderr.on("data", (chunk: unknown) => {
            if (!(chunk instanceof Uint8Array)) { this.fail(new OnvifError("InvalidValue", "Unexpected native stderr encoding")); return; }
            if (!this.stderrCount) this.diagnostic({ kind: "native", code: "NativeStderrReceived" });
            this.stderrCount += chunk.byteLength;
            if (this.stderrCount > limits.stderrBytes) {
                this.fail(new OnvifError("TransportError", "Native stderr exceeded its diagnostic byte budget", "unknown"));
            }
        });
        this.process.stderr.on("error", () => this.fail(new OnvifError("TransportError", "Native diagnostic pipe failed", "unknown")));
        for (const stream of [this.process.commands, this.process.secrets, this.process.audio]) {
            stream.on("error", () => {
                if (this.currentState !== "closing" && this.currentState !== "closed") {
                    this.fail(new OnvifError("TransportError", "Native private input pipe failed", this.openSent ? "unknown" : "not-sent"));
                }
            });
        }
        void this.process.exit.then((exit) => this.exited(exit), (error: unknown) => {
            this.fail(mediaError(error, "Native process exit could not be observed"));
        });
        this.signal.addEventListener("abort", this.aborted, { once: true });
        if (this.signal.aborted) this.aborted();
    }

    get state(): MediaSessionState { return this.currentState; }
    get generation(): number { return this.currentGeneration; }
    get nativeSessionId(): string { return this.nativeIdentity; }
    get backchannel(): Writable | undefined { return this.sending; }
    get support(): MediaSupport {
        if (this.inventory === undefined) throw new OnvifError("RuntimeClosed", "Native media inventory is not available");
        return this.inventory;
    }
    get tracks(): readonly MediaTrack[] { return this.negotiated; }
    private readonly aborted = (): void => { this.fail(mediaAborted(this.openSent ? "unknown" : "not-sent")); };

    private diagnostic(value: Omit<MediaDiagnostic, "generation">): void {
        this.diagnosticQueue.publish({ ...value, generation: this.currentGeneration }, 256);
    }

    private listen(stream: Readable, decoder: IpcFrameDecoder, accept: (frame: IpcFrame) => void, control: boolean): void {
        stream.on("data", (chunk: unknown) => {
            try {
                if (!(chunk instanceof Uint8Array)) throw new OnvifError("InvalidValue", "Native pipes require undecoded binary chunks");
                decoder.push(chunk, accept);
            } catch (error) { this.fail(mediaError(error, "Native media pipe parsing failed")); }
        });
        stream.on("end", () => {
            try {
                decoder.end();
                if (control && this.receipt === undefined && this.currentState !== "closed") {
                    this.fail(new OnvifError("OutcomeUnknown", "Native control pipe ended without a CLOSED receipt", this.openSent ? "unknown" : "not-sent"));
                } else if (!control && this.currentState !== "closing" && this.currentState !== "closed"
                    && this.ending?.complete !== true) {
                    this.fail(new OnvifError("TransportError", "Native data pipe ended before its END watermark", "unknown"));
                }
            } catch (error) { this.fail(mediaError(error, "Native media pipe ended with an incomplete frame")); }
        });
        stream.on("error", () => this.fail(new OnvifError("TransportError", "Native media output pipe failed", "unknown")));
    }

    private allocateSequence(): number {
        if (this.commandSequence === 0xffffffff) throw new OnvifError("InvalidValue", "Native media command sequence exhausted");
        return ++this.commandSequence;
    }

    private write(stream: Writable, bytes: Buffer, wipe = false): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let finished = false;
            const finish = (error?: OnvifError): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                stream.removeListener("error", failed);
                stream.removeListener("close", ended);
                if (wipe) bytes.fill(0);
                if (error === undefined) resolve(); else reject(error);
            };
            const failed = (): void => finish(new OnvifError("TransportError", "Native private pipe write failed", "unknown"));
            const ended = (): void => finish(new OnvifError("TransportError", "Native private pipe closed during a write", "unknown"));
            const timer = setTimeout(() => finish(new OnvifError("OutcomeUnknown", "Native private pipe write exceeded its deadline", "unknown")),
                this.descriptor.limits.controlTimeoutMs);
            stream.once("error", failed);
            stream.once("close", ended);
            if (stream.destroyed || stream.writableEnded || stream.writableLength + bytes.length > MEDIA_CONTROL_MAX + 24) {
                finish(new OnvifError("TransportError", "Native private input is closed or over its bounded write capacity", "unknown"));
                return;
            }
            try { stream.write(bytes, (error) => error ? failed() : finish()); } catch (error) {
                finish(mediaError(error, "Native private pipe write failed"));
            }
        });
    }

    private send(kind: number, sequence: number, payload: Buffer = Buffer.alloc(0), generation = this.currentGeneration): Promise<void> {
        return this.write(this.process.commands, encodeEnvelope(kind, this.id, generation, sequence, payload));
    }

    private async beginOpen(): Promise<void> {
        requireMediaSupport(this.support, this.descriptor.request);
        if (this.currentState !== "opening" || this.signal.aborted) throw mediaAborted();
        const material = this.material;
        this.material = undefined;
        if (material === undefined) throw new OnvifError("InvalidSecurity", "Native media security material is unavailable");
        const payload = encodeSecurity(this.descriptor, material);
        const envelope = encodeEnvelope(IpcKind.SECURITY, this.id, 0, 1, payload);
        payload.fill(0);
        await this.write(this.process.secrets, envelope, true);
        this.process.secrets.end();
        if (this.currentState !== "opening" || this.signal.aborted) throw mediaAborted();
        const open = encodeOpen(this.descriptor);
        this.openSequence = this.allocateSequence();
        this.openSent = true;
        await this.send(IpcKind.OPEN, this.openSequence, open, 0);
    }

    private control(frame: IpcFrame): void {
        const value = decodeControl(frame);
        if (frame.kind === IpcKind.HELLO) {
            if (this.inventory !== undefined || frame.session || frame.generation || frame.sequence || this.openSent) {
                throw new OnvifError("InvalidValue", "Invalid or duplicate native media HELLO");
            }
            this.inventory = parseSupport(value);
            if (this.currentState === "opening") void this.beginOpen().catch((error: unknown) =>
                this.fail(mediaError(error, "Native media OPEN failed", this.openSent ? "unknown" : "not-sent")));
            return;
        }
        const startup = !this.openSent && frame.session === 0 && frame.generation === 0 && frame.sequence === 0;
        if (!startup && (frame.session !== this.id || frame.generation > this.expectedGeneration
            || frame.sequence > this.commandSequence)) {
            throw new OnvifError("InvalidValue", "Native control session, generation or correlation does not belong to this owner");
        }
        if (frame.kind === IpcKind.ERROR) {
            if (typeof value.code !== "string" || !/^[A-Za-z][A-Za-z0-9:_.-]{0,127}$/u.test(value.code)) {
                throw new OnvifError("InvalidValue", "Invalid native error code");
            }
            const code = value.code === "TlsCertificateRejected" ? "InvalidSecurity"
                : /^(?:Unsupported|NoDecoder|MissingRequiredTrack|NoTlsBackend)/u.test(value.code) ? "UnsupportedCapability"
                : /^(?:Forbidden|InvalidOrUnauthorizedOpen|InvalidScopeOrNativeOpen)/u.test(value.code) ? "PolicyDenied" : "TransportError";
            this.fail(new MediaNativeError(code, value.code, this.openSent ? "unknown" : "not-sent"));
        } else if (frame.kind === IpcKind.READY) {
            if (this.currentState === "closing" && this.openSent && frame.generation === 1 && frame.sequence === this.openSequence) {
                parseReady(value, this.descriptor.request, this.support);
                this.diagnostic({ kind: "lifecycle", code: "ReadyAfterCancellation" });
                return;
            }
            if (this.currentState !== "opening" || !this.openSent || frame.generation !== 1 || frame.sequence !== this.openSequence) {
                throw new OnvifError("InvalidValue", "Unexpected native READY correlation or generation");
            }
            this.negotiated = parseReady(value, this.descriptor.request, this.support);
            this.nativeIdentity = nativeSessionId(value);
            clearTimeout(this.openTimer);
            this.currentGeneration = 1;
            this.currentState = "playing";
            if (this.negotiated.some((track) => track.id === 4)) {
                this.sending = new BackchannelWritable(this.process.audio,
                    (sequence, payload) => this.write(this.process.audio,
                        encodeEnvelope(IpcKind.BACKCHANNEL, this.id, this.currentGeneration, sequence, payload)),
                    () => this.currentState === "playing" && this.pending === undefined);
                this.sending.on("error", () => this.diagnostic({ kind: "lifecycle", code: "BackchannelInputClosed" }));
            } else this.process.audio.end();
            this.flushStaged();
            this.ready.resolve(this);
        } else if (frame.kind === IpcKind.CONTROL) {
            const pending = this.pending ?? (this.currentState === "closing" ? this.abandoned : undefined);
            if (pending === undefined || frame.sequence !== pending.sequence || frame.generation !== pending.generation
                || value.acknowledged !== true || value.command !== pending.kind
                || value.state !== (pending.kind === IpcKind.PAUSE ? "paused" : "playing")) {
                throw new OnvifError("InvalidValue", "Native control acknowledgement does not match the pending command");
            }
            if (this.currentState === "closing") {
                this.abandoned = undefined;
                this.diagnostic({ kind: "lifecycle", code: "ControlAcknowledgedDuringClose" });
                return;
            }
            clearTimeout(pending.timer);
            const state = pending.kind === IpcKind.PAUSE ? "paused" : "playing";
            this.currentGeneration = frame.generation;
            this.currentState = state;
            this.flushStaged();
            this.pending = undefined;
            this.finishGeneration();
            pending.result.resolve({ state, generation: frame.generation, acknowledged: true });
        } else if (frame.kind === IpcKind.CLOSED) {
            if (this.receipt !== undefined || frame.generation < this.currentGeneration
                || frame.sequence !== 0 && frame.sequence !== this.closeSequence) {
                throw new OnvifError("InvalidValue", "Invalid native CLOSED correlation");
            }
            this.receipt = parseClose(value);
            if (this.currentState !== "closing" && this.currentState !== "closed") {
                this.failure ??= new OnvifError("TransportError", "Native media ended before an owned CLOSE request", "unknown");
                this.beginClose();
            }
        } else if (frame.kind === IpcKind.RESPONSE) {
            if (typeof value.method !== "string" || !/^[A-Z_]{1,32}$/u.test(value.method)
                || typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 100 || value.status > 599
                || typeof value.cseq !== "number" || !Number.isSafeInteger(value.cseq) || value.cseq <= 0 || value.cseq > 0xffffffff
                || typeof value.range !== "string" || value.range.length > 160) {
                throw new OnvifError("InvalidValue", "Invalid native RTSP response observation");
            }
            this.diagnostic({ kind: "native", code: "RtspResponse", method: value.method, status: value.status });
        } else if (frame.kind === IpcKind.GAP) {
            if (typeof value.code !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u.test(value.code)
                || value.track !== undefined && (typeof value.track !== "number" || !Number.isInteger(value.track) || value.track < 0 || value.track > 4)
                || value.wholeFramesDropped !== undefined && (typeof value.wholeFramesDropped !== "number"
                    || !Number.isSafeInteger(value.wholeFramesDropped) || value.wholeFramesDropped < 1 || value.wholeFramesDropped > 0xffffffff)) {
                throw new OnvifError("InvalidValue", "Invalid native gap observation");
            }
            this.diagnostic({ kind: "gap", code: value.code,
                ...(value.track === undefined ? {} : { track: value.track }),
                ...(value.wholeFramesDropped === undefined ? {} : { droppedUnits: value.wholeFramesDropped }) });
        } else if (frame.kind === IpcKind.DIAGNOSTIC) {
            if (typeof value.code === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u.test(value.code)) {
                if (value.certificateErrors !== undefined && (typeof value.certificateErrors !== "number"
                    || !Number.isSafeInteger(value.certificateErrors) || value.certificateErrors < 0 || value.certificateErrors > 0xffffffff)) {
                    throw new OnvifError("InvalidValue", "Invalid native certificate diagnostic flags");
                }
                this.diagnostic({ kind: "native", code: value.code,
                    ...(value.certificateErrors === undefined ? {} : { certificateErrors: value.certificateErrors }) });
            } else if (typeof value.domain === "string" && typeof value.code === "number" && Number.isSafeInteger(value.code)) {
                this.diagnostic({ kind: "native", code: "NativePipelineDiagnostic" });
            } else throw new OnvifError("InvalidValue", "Invalid native diagnostic observation");
        } else if (frame.kind === IpcKind.END) {
            if (value.reason !== "native-eos" || typeof value.lastDataSequence !== "number"
                || !Number.isSafeInteger(value.lastDataSequence) || value.lastDataSequence < 0
                || value.lastDataSequence > 0xffffffff || !frame.generation) {
                throw new OnvifError("InvalidValue", "Invalid native END watermark");
            }
            if (frame.generation < this.currentGeneration
                || this.currentState === "closing" || this.currentState === "closed"
                || this.pending !== undefined && frame.generation === this.currentGeneration) return;
            if (this.ending !== undefined) throw new OnvifError("InvalidValue", "Duplicate native END watermark");
            this.ending = { generation: frame.generation, watermark: value.lastDataSequence, observedAt: Date.now(), complete: false };
            this.finishGeneration();
        } else throw new OnvifError("UnsupportedCapability", "Unknown native control message");
    }

    private credit(bytes: number): void {
        if (this.currentState === "closing" || this.currentState === "closed") return;
        this.creditBytes += bytes;
        this.creditUnits++;
    }
    private flushCredits(): void {
        if (!this.creditUnits || this.creditWriting || this.currentState === "closing" || this.currentState === "closed") return;
        const payload = Buffer.alloc(8);
        if (this.creditBytes > this.outstandingBytes || this.creditUnits > this.outstandingUnits) {
            throw new OnvifError("InvalidValue", "Native media credit was released more than once");
        }
        payload.writeUInt32BE(this.creditBytes, 0);
        payload.writeUInt32BE(this.creditUnits, 4);
        this.outstandingBytes -= this.creditBytes;
        this.outstandingUnits -= this.creditUnits;
        this.creditBytes = this.creditUnits = 0;
        this.creditWriting = true;
        void this.send(IpcKind.CREDIT, this.allocateSequence(), payload).then(() => { this.creditWriting = false; }, (error: unknown) => {
            this.creditWriting = false;
            if (this.currentState !== "closing" && this.currentState !== "closed") this.fail(mediaError(error, "Native media credit write failed"));
        });
    }

    private data(frame: IpcFrame): void {
        if (this.currentState === "closing" || this.currentState === "closed") { this.localDropped++; return; }
        if (!this.openSent || frame.session !== this.id || !frame.generation || frame.generation > this.expectedGeneration
            || frame.sequence <= this.dataSequence) throw new OnvifError("InvalidValue", "Native data session, generation or sequence mismatch");
        if (this.ending?.generation === frame.generation && frame.sequence > this.ending.watermark) {
            throw new OnvifError("InvalidValue", "Native data exceeded its END watermark");
        }
        if (this.dataSequence && frame.sequence > this.dataSequence + 1) {
            this.diagnostic({ kind: "gap", code: "NativeDataSequenceGap", droppedUnits: frame.sequence - this.dataSequence - 1 });
        }
        this.dataSequence = frame.sequence;
        const value = decodeMediaData(frame, this.descriptor.limits), bytes = frame.payload.length + 24;
        this.outstandingBytes += bytes;
        this.outstandingUnits++;
        if (this.outstandingBytes > this.descriptor.limits.queueBytes || this.outstandingUnits > this.descriptor.limits.queueUnits) {
            throw new OnvifError("InvalidValue", "Native media exceeded its outstanding IPC credits");
        }
        const item: StagedUnit = { value, bytes, release: () => this.credit(bytes) };
        if (frame.generation < this.currentGeneration || this.pending !== undefined && frame.generation === this.currentGeneration) {
            this.localDropped++;
            this.diagnostic({ kind: "gap", code: "ControlBoundaryDiscard", track: value.track, droppedUnits: 1 });
            item.release();
        } else if (this.currentState === "opening" || frame.generation !== this.currentGeneration) {
            while (this.staged.length >= this.descriptor.limits.queueUnits || this.stagedBytes + bytes > this.descriptor.limits.queueBytes) {
                if (this.selection.mode === "recorded") throw new OnvifError("InvalidValue", "Unacknowledged media generation exceeded its bounded queue");
                const dropped = this.staged.shift();
                if (dropped === undefined) {
                    this.localDropped++;
                    this.diagnostic({ kind: "gap", code: "GenerationQueueOverflow", droppedUnits: 1 });
                    item.release();
                    return;
                }
                this.stagedBytes -= dropped.bytes;
                dropped.release();
                this.localDropped++;
                this.diagnostic({ kind: "gap", code: "GenerationQueueOverflow", droppedUnits: 1 });
            }
            this.staged.push(item);
            this.stagedBytes += bytes;
        } else this.deliver(item);
        this.finishGeneration();
    }

    private deliver(item: StagedUnit): void {
        const value = item.value, track = this.negotiated.find((entry) => entry.id === value.track);
        if (track === undefined || track.direction !== "receive"
            || value.kind === "rtp" && value.payloadType !== track.payloadType
            || value.kind === "sender-report" && value.clockRate !== track.clockRate) {
            throw new OnvifError("InvalidValue", "Native data disagrees with its negotiated track");
        }
        if (value.kind === "metadata") {
            let canonical: CanonicalValue;
            try { canonical = this.decodeMetadata(value.xml); } catch (error) {
                if (error instanceof OnvifError && ["InvalidXml", "InvalidValue", "XmlLimit"].includes(error.code)) {
                    this.localDropped++;
                    this.diagnostic({ kind: "gap", code: "CanonicalMetadataRejected", track: 3, droppedUnits: 1 });
                    item.release();
                    return;
                }
                throw error;
            }
            if (canonical === undefined) throw new OnvifError("UnsupportedCapability", "Canonical metadata decoder did not return a finite document");
            const report = this.senderReports.get(value.track);
            this.metadataQueue.publish({ ...value, value: canonical,
                originalSource: Object.freeze({ thingId: this.selection.thingId, targetRef: this.selection.targetRef,
                    uri: this.selection.uri, nativeSessionId: this.nativeIdentity, track: value.track, ssrc: value.ssrc }),
                clock: Object.freeze({ rate: track.clockRate, firstRtpTimestamp: value.firstRtpTimestamp,
                    lastRtpTimestamp: value.lastRtpTimestamp, receiptMonoNs: value.receiptMonoNs,
                    ...(report?.ssrc === value.ssrc && report.generation === value.generation ? { senderReport: report } : {}) })
            }, item.bytes, item.release);
        } else if (value.kind === "decoded") this.decodedQueue.publish(value, item.bytes, item.release);
        else {
            if (value.kind === "sender-report") this.senderReports.set(value.track, Object.freeze(value));
            if (this.descriptor.request.packetOutput) this.packetQueue.publish(value, item.bytes, item.release);
            else item.release();
        }
    }

    private flushStaged(): void {
        const pending = this.staged;
        this.staged = [];
        this.stagedBytes = 0;
        for (const item of pending) this.deliver(item);
        this.finishGeneration();
    }

    private finishGeneration(): void {
        const end = this.ending;
        if (end === undefined || end.generation !== this.currentGeneration || this.pending !== undefined
            || this.currentState === "opening") return;
        if (this.dataSequence > end.watermark) throw new OnvifError("InvalidValue", "Native data exceeded its END watermark");
        if (this.dataSequence !== end.watermark || end.complete) return;
        end.complete = true;
        this.packetQueue.end();
        this.metadataQueue.end();
        this.decodedQueue.end();
        this.diagnostic({ kind: "lifecycle", code: "NativeEnd", lastDataSequence: end.watermark });
    }

    frames(): MediaFrameReadable {
        if (this.currentState !== "playing" && this.currentState !== "paused") {
            throw new OnvifError("RuntimeClosed", "Media session is not open");
        }
        if (!this.negotiated.some((track) => track.id === 1 || track.id === 2)) {
            throw new OnvifError("UnsupportedCapability", "No decoded track was requested");
        }
        const stream = new FrameReadable(this.decodedQueue[Symbol.asyncIterator](), () => this.readers.delete(stream));
        stream.on("error", () => this.diagnostic({ kind: "lifecycle", code: "FrameSubscriberClosed" }));
        this.readers.add(stream);
        return stream;
    }

    private command(kind: number, range?: MediaReplayRange): Promise<MediaControlReceipt> {
        const name = kind === IpcKind.PAUSE ? "pause" : kind === IpcKind.SEEK ? "seek" : "play";
        if (this.currentState !== "playing" && this.currentState !== "paused") return Promise.reject(new OnvifError("RuntimeClosed", "Media session is not open"));
        if (!this.support.controls.includes(name) || kind === IpcKind.SEEK && this.selection.mode !== "recorded") {
            return Promise.reject(new OnvifError("UnsupportedCapability", "Requested native media control is not supported"));
        }
        if (this.pending !== undefined || kind === IpcKind.PAUSE && this.currentState === "paused") {
            return Promise.reject(new OnvifError("InvalidValue", "Native media control is already pending or the session is already paused"));
        }
        if (this.sending !== undefined && this.sending.writableLength > 0) {
            return Promise.reject(new OnvifError("InvalidValue", "Drain backchannel writes before a native media control"));
        }
        let payload = Buffer.alloc(0);
        if (range !== undefined) {
            const validated = validateReplayRange(range);
            payload = Buffer.alloc(16);
            payload.writeBigUInt64BE(validated.startNtpNs, 0);
            payload.writeBigUInt64BE(validated.endNtpNs, 8);
        }
        if (kind !== IpcKind.PAUSE && this.currentGeneration === 0xffffffff) {
            return Promise.reject(new OnvifError("InvalidValue", "Native media generation exhausted"));
        }
        const generation = this.currentGeneration + (kind === IpcKind.PAUSE ? 0 : 1);
        this.senderReports.clear();
        const result = new Deferred<MediaControlReceipt>(), sequence = this.allocateSequence();
        this.expectedGeneration = generation;
        const timer = setTimeout(() => this.fail(new OnvifError("OutcomeUnknown", "Native control acknowledgement exceeded its deadline", "unknown")),
            this.descriptor.limits.controlTimeoutMs);
        this.pending = { kind, sequence, generation, result, timer };
        const discarded = this.packetQueue.discard() + this.metadataQueue.discard() + this.decodedQueue.discard();
        if (discarded) {
            this.localDropped += discarded;
            this.diagnostic({ kind: "gap", code: "ControlBoundaryDiscard", droppedUnits: discarded });
        }
        if (kind !== IpcKind.PAUSE) {
            this.ending = undefined;
            this.packetQueue.resume();
            this.metadataQueue.resume();
            this.decodedQueue.resume();
        }
        void this.send(kind, sequence, payload).catch((error: unknown) => {
            if (this.pending?.sequence === sequence) this.fail(mediaError(error, "Native media control write failed"));
        });
        return result.promise;
    }
    play(): Promise<MediaControlReceipt> { return this.command(IpcKind.PLAY); }
    pause(): Promise<MediaControlReceipt> { return this.command(IpcKind.PAUSE); }
    seek(range: MediaReplayRange): Promise<MediaControlReceipt> { return this.command(IpcKind.SEEK, range); }

    close(): Promise<MediaCloseResult> { this.beginClose(); return this.closed; }

    private fail(error: OnvifError): void {
        if (this.currentState === "closed") return;
        this.failure ??= error;
        this.ready.reject(this.failure);
        this.beginClose();
    }

    private finishReaders(): void {
        this.material = undefined;
        for (const item of this.staged) { this.localDropped++; item.release(); }
        this.staged = [];
        this.stagedBytes = 0;
        this.localDropped += this.packetQueue.queuedUnits + this.metadataQueue.queuedUnits + this.decodedQueue.queuedUnits;
        this.packetQueue.finish(this.failure);
        this.metadataQueue.finish(this.failure);
        this.decodedQueue.finish(this.failure);
        for (const reader of this.readers) reader.destroy(this.failure);
        this.sending?.destroy(this.failure);
        this.creditBytes = this.creditUnits = 0;
    }

    private beginClose(): void {
        if (this.currentState === "closing" || this.currentState === "closed") return;
        const acknowledged = this.openSent && this.receipt === undefined;
        this.currentState = "closing";
        this.ending = undefined;
        clearTimeout(this.openTimer);
        this.ready.reject(this.failure ?? new OnvifError("RuntimeClosed", "Media closed before READY"));
        if (this.pending !== undefined) {
            this.abandoned = this.pending;
            clearTimeout(this.pending.timer);
            this.pending.result.reject(this.failure ?? new OnvifError("OutcomeUnknown", "Media closed before control acknowledgement", "unknown"));
            this.pending = undefined;
        }
        this.finishReaders();
        this.process.secrets.destroy();
        this.process.audio.destroy();
        this.closeTimer = setTimeout(() => {
            this.failure ??= new OnvifError("OutcomeUnknown", "Owned media worker missed its close deadline; terminating only its PID", "unknown");
            this.diagnostic({ kind: "lifecycle", code: "OwnedWorkerTermination" });
            try { this.terminated = this.process.terminate(); } catch (error) {
                this.failure = mediaError(error, "Owned media worker termination failed");
            }
            this.process.commands.destroy();
            this.killTimer = setTimeout(() => this.exited({ observed: false, code: null, signal: null }), this.descriptor.limits.killTimeoutMs);
        }, this.descriptor.limits.closeTimeoutMs);
        if (acknowledged) {
            this.closeSequence = this.allocateSequence();
            void this.send(IpcKind.CLOSE, this.closeSequence).catch((error: unknown) => {
                if (this.receipt === undefined) this.fail(mediaError(error, "Native CLOSE write was not acknowledged"));
            });
        } else this.process.commands.destroy();
    }

    private exited(exit: MediaWorkerExit): void {
        if (this.currentState === "closed") return;
        if (!exit.observed || exit.code !== 0 || exit.signal !== null || exit.spawnFailed) {
            this.failure ??= new OnvifError("TransportError", exit.observed ? "Native media worker exited unsuccessfully" : "Owned media worker exit remains unconfirmed",
                this.openSent ? "unknown" : "not-sent");
        }
        const remote = this.receipt?.remote ?? (this.openSent ? "uncertain" : "not-created");
        if (remote === "uncertain") this.failure ??= new OnvifError("OutcomeUnknown", "Remote native teardown was not acknowledged", "unknown");
        if (this.currentState !== "closing") this.beginClose();
        this.currentState = "closed";
        clearInterval(this.watchdog);
        clearTimeout(this.openTimer);
        clearTimeout(this.closeTimer);
        clearTimeout(this.killTimer);
        this.signal.removeEventListener("abort", this.aborted);
        this.finishReaders();
        this.process.commands.destroy();
        this.process.secrets.destroy();
        this.process.audio.destroy();
        this.diagnostic({ kind: "lifecycle", code: exit.observed ? "WorkerExited" : "WorkerExitUnconfirmed" });
        this.diagnosticQueue.finish();
        this.completion.resolve(Object.freeze({
            remote, localCleanup: this.receipt?.localCleanup === true && exit.observed && exit.code === 0 && exit.signal === null && !this.terminated,
            teardownStatus: this.receipt?.teardownStatus ?? 0, workerExit: Object.freeze(exit), terminated: this.terminated,
            droppedUnits: this.localDropped + (this.receipt?.dataDiscardedFrames ?? 0), stderrBytes: this.stderrCount,
            droppedDiagnostics: this.diagnosticDropped,
            ...(this.receipt === undefined ? {} : {
                backchannelPackets: this.receipt.backchannelPackets, backchannelSamples: this.receipt.backchannelSamples
            }),
            ...(this.failure === undefined ? {} : { failure: this.failure })
        }));
    }
}

export async function startMediaSession(options: NativeSessionOptions): Promise<MediaSession> {
    const session = new NativeSession(options);
    try { return await session.ready.promise; } catch (error) {
        const cleanup = await session.close();
        throw new MediaOpenError(mediaError(error, "Native media session did not become ready"), cleanup);
    }
}
