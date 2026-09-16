import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";

export const MEDIA_PROTOCOL_VERSION = 2;
export const MEDIA_HEADER_BYTES = 24;
export const MEDIA_CONTROL_MAX = 65536;
export const MEDIA_DATA_MAX = 64 * 1024 * 1024 + 64;

export const IpcKind = Object.freeze({
    OPEN: 1, CLOSE: 2, PAUSE: 3, PLAY: 4, SEEK: 5, CREDIT: 6,
    SECURITY: 0x10, BACKCHANNEL: 0x1001,
    HELLO: 0x8001, READY: 0x8002, CLOSED: 0x8003, ERROR: 0x8004,
    RESPONSE: 0x8005, GAP: 0x8006, DIAGNOSTIC: 0x8007, CONTROL: 0x8008, END: 0x8009,
    RTP: 0x9001, DECODED: 0x9002, METADATA: 0x9003, RTCP: 0x9004
} as const);

export interface IpcFrame {
    readonly kind: number;
    readonly session: number;
    readonly generation: number;
    readonly sequence: number;
    readonly payload: Buffer;
}

function uint(value: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new OnvifError("InvalidValue", "Invalid native IPC integer");
    }
    return value;
}

export function encodeEnvelope(
    kind: number, session: number, generation: number, sequence: number, payload: Uint8Array = Buffer.alloc(0)
): Buffer {
    if (payload.byteLength > MEDIA_DATA_MAX) throw new OnvifError("InvalidValue", "Native IPC payload exceeds its bound");
    const output = Buffer.alloc(MEDIA_HEADER_BYTES + payload.byteLength);
    output.write("OMPG", 0, "ascii");
    output.writeUInt16BE(MEDIA_PROTOCOL_VERSION, 4);
    output.writeUInt16BE(uint(kind, 0xffff), 6);
    output.writeUInt32BE(uint(session, 0xffffffff), 8);
    output.writeUInt32BE(uint(generation, 0xffffffff), 12);
    output.writeUInt32BE(uint(sequence, 0xffffffff), 16);
    output.writeUInt32BE(payload.byteLength, 20);
    output.set(payload, MEDIA_HEADER_BYTES);
    return output;
}

export class IpcFrameDecoder {
    private readonly header = Buffer.alloc(MEDIA_HEADER_BYTES);
    private headerBytes = 0;
    private payload: Buffer | undefined;
    private payloadBytes = 0;
    private partialAt: number | undefined;
    private ended = false;
    readonly maximum: number;

    constructor(readonly channel: "control" | "data", maximum?: number) {
        this.maximum = positiveInteger(maximum ?? (channel === "control" ? MEDIA_CONTROL_MAX : MEDIA_DATA_MAX),
            "IPC payload limit", channel === "control" ? MEDIA_CONTROL_MAX : MEDIA_DATA_MAX);
    }

    get bufferedBytes(): number { return this.headerBytes + this.payloadBytes; }
    get incompleteSince(): number | undefined { return this.partialAt; }

    push(chunk: Uint8Array, accept: (frame: IpcFrame) => void): void {
        if (this.ended) throw new OnvifError("InvalidValue", "Native IPC data after EOF");
        let offset = 0;
        while (offset < chunk.byteLength) {
            this.partialAt ??= Date.now();
            if (this.headerBytes < MEDIA_HEADER_BYTES) {
                const count = Math.min(MEDIA_HEADER_BYTES - this.headerBytes, chunk.byteLength - offset);
                this.header.set(chunk.subarray(offset, offset + count), this.headerBytes);
                this.headerBytes += count;
                offset += count;
                if (this.headerBytes < MEDIA_HEADER_BYTES) continue;
                if (!this.header.subarray(0, 4).equals(Buffer.from("OMPG", "ascii"))) {
                    throw new OnvifError("InvalidValue", "Invalid native IPC magic");
                }
                if (this.header.readUInt16BE(4) !== MEDIA_PROTOCOL_VERSION) {
                    throw new OnvifError("UnsupportedCapability", "Native media requires IPC version 2; no legacy fallback");
                }
                const kind = this.header.readUInt16BE(6);
                if (this.channel === "control" ? kind < IpcKind.HELLO || kind > IpcKind.END
                    : kind < IpcKind.RTP || kind > IpcKind.RTCP) {
                    throw new OnvifError("UnsupportedCapability", "Unexpected native IPC message kind or channel");
                }
                const length = this.header.readUInt32BE(20);
                if (!length || length > this.maximum) throw new OnvifError("InvalidValue", "Invalid native IPC payload length");
                this.payload = Buffer.alloc(length);
            }
            const payload = this.payload;
            if (payload === undefined) throw new OnvifError("InvalidValue", "Native IPC parser lost its frame descriptor");
            const count = Math.min(payload.byteLength - this.payloadBytes, chunk.byteLength - offset);
            payload.set(chunk.subarray(offset, offset + count), this.payloadBytes);
            this.payloadBytes += count;
            offset += count;
            if (this.payloadBytes !== payload.byteLength) continue;
            const frame: IpcFrame = {
                kind: this.header.readUInt16BE(6), session: this.header.readUInt32BE(8),
                generation: this.header.readUInt32BE(12), sequence: this.header.readUInt32BE(16), payload
            };
            this.headerBytes = 0;
            this.payloadBytes = 0;
            this.payload = undefined;
            this.partialAt = undefined;
            accept(frame);
        }
    }

    end(): void {
        this.ended = true;
        if (this.bufferedBytes) throw new OnvifError("TransportError", "Truncated native IPC frame", "unknown");
    }
}

export function decodeControl(frame: IpcFrame): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.payload));
    } catch (error) {
        if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
        throw new OnvifError("InvalidValue", "Native control is not finite UTF-8 JSON");
    }
    if (!isRecord(value)) throw new OnvifError("InvalidValue", "Native control must be a JSON object");
    const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
        const item = pending.pop();
        if (item === undefined) break;
        if (++nodes > 20000 || item.depth > 128 || typeof item.value === "number" && !Number.isFinite(item.value)) {
            throw new OnvifError("InvalidValue", "Native control exceeds its finite JSON bounds");
        }
        if (Array.isArray(item.value) || isRecord(item.value)) {
            for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
        }
    }
    return value;
}

export function ipcString(value: string, maximum: number, label: string): Buffer {
    if (typeof value !== "string" || value.includes("\0")) throw new OnvifError("InvalidConfiguration", `Invalid ${label}`);
    const bytes = Buffer.from(value, "utf8");
    if (bytes.toString("utf8") !== value || bytes.length > Math.min(maximum, 65535)) {
        throw new OnvifError("InvalidConfiguration", `Invalid UTF-8 or excessive ${label}`);
    }
    const result = Buffer.alloc(2 + bytes.length);
    result.writeUInt16BE(bytes.length, 0);
    bytes.copy(result, 2);
    bytes.fill(0);
    return result;
}
