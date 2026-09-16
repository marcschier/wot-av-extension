"use strict";

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { SourceFault, CODES, asFault, demand } = require("./fault.cjs");

const DEFAULT_LIMITS = Object.freeze({
    maxWidth: 4096, maxHeight: 4096, maxNativePayloadBytes: 33554432, maxFrameBytes: 16777216,
    maxQueuedFrames: 2, maxQueuedBytes: 33554432, maxSubscribers: 2,
    maxInFlightFramesPerSubscriber: 1, maxCachedJpegs: 1,
    openDeadlineMs: 5000, readDeadlineMs: 2000, closeDeadlineMs: 2000, maxSnapshotAgeMs: 2000
});
const UINT64_MAX = 18446744073709551615n;
const BACKEND_SCOPES = Object.freeze({
    "windows-mf": "windows-instance-and-container", "mf-memory": "synthetic-memory",
    "linux-v4l2": "linux-device-node", "aravis-gige": "aravis-gige-endpoint",
    "aravis-usb3": "aravis-usb-identity", "aravis-fake": "synthetic-aravis"
});
const modeIdValid = value => typeof value === "string" && /^(mf|v4l2|arv)-[0-9a-f]{32}$/.test(value);
const hash = value => createHash("sha256").update(value).digest("hex");
const hex64 = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const opaqueKey = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

function normalizeLimits(input = {}) {
    demand(record(input), "ResourceLimit", "open");
    for (const key of Object.keys(input)) demand(Object.hasOwn(DEFAULT_LIMITS, key), "ResourceLimit", "open");
    const result = { ...DEFAULT_LIMITS, ...input };
    for (const [key, maximum] of Object.entries(DEFAULT_LIMITS)) {
        demand(Number.isSafeInteger(result[key]) && result[key] > 0 && result[key] <= maximum, "ResourceLimit", "open");
    }
    return Object.freeze(result);
}

function validateTarget(target, operation = "open") {
    demand(record(target) && Object.hasOwn(BACKEND_SCOPES, target.backend)
        && opaqueKey(target.adapterDeviceKey) && typeof target.privateSelector === "string"
        && Buffer.byteLength(target.privateSelector, "utf8") <= 8192
        && !/[\u0000-\u001f]/.test(target.privateSelector)
        && record(target.expectedIdentity) && hex64(target.expectedIdentity.fingerprint),
    "InvalidSelection", operation);
    demand(target.expectedIdentity.scope === BACKEND_SCOPES[target.backend], "InvalidSelection", operation);
    if (target.backend === "mf-memory") {
        demand(target.privateSelector === "memory:color-grid", "InvalidSelection", operation);
    } else if (target.backend === "windows-mf") {
        demand(target.privateSelector.startsWith("\\\\?\\") && target.privateSelector.length > 8, "InvalidSelection", operation);
    } else if (target.backend === "linux-v4l2") {
        demand(target.privateSelector.startsWith("/dev/") && !/[*?[\]{}]/.test(target.privateSelector)
            && !target.privateSelector.split("/").includes(".."), "InvalidSelection", operation);
    } else {
        let selector;
        try { selector = JSON.parse(target.privateSelector); }
        catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            throw new SourceFault("InvalidSelection", operation);
        }
        const allowed = ["vendor", "model", "serial", "pixelFormat", "width", "height", "x", "y",
            ...(target.backend === "aravis-gige" ? ["localAddress", "cameraAddress"] : []),
            ...(target.backend === "aravis-usb3" ? ["permitLibraryEnumeration", "permitDriverDetach"] : [])];
        demand(record(selector) && Object.keys(selector).length === allowed.length
            && allowed.every(key => typeof selector[key] === "string" && selector[key].length > 0
                && selector[key].length <= 512 && !/[\u0000-\u001f]/.test(selector[key])),
        "InvalidSelection", operation);
        if (target.backend === "aravis-usb3") {
            demand(selector.permitLibraryEnumeration === "yes" && selector.permitDriverDetach === "yes",
                "PolicyDenied", operation);
        }
    }
    return structuredClone(target);
}

function targetDigest(target) {
    return hash(JSON.stringify([target.backend, target.adapterDeviceKey, target.privateSelector,
        target.expectedIdentity.fingerprint, target.expectedIdentity.scope]));
}

function configuredCapturePermission({ target, modeId, capabilityEvidenceDigest, durationMs, output = "JPEG", limits = {},
    permitAcquisition = false }) {
    const approved = validateTarget(target);
    demand(permitAcquisition === true, "PolicyDenied", "open");
    demand(modeIdValid(modeId) && hex64(capabilityEvidenceDigest), "InvalidSelection", "open");
    demand(["JPEG", "I420"].includes(output), "UnsupportedFormat", "open");
    demand(Number.isInteger(durationMs) && durationMs > 0 && durationMs <= 30000, "ResourceLimit", "open");
    const approvedDigest = targetDigest(approved), approvedLimits = normalizeLimits(limits);
    return request => targetDigest(request.target) === approvedDigest && request.modeId === modeId
        && request.capabilityEvidenceDigest === capabilityEvidenceDigest && request.output === output
        && request.durationMs <= durationMs
        && Object.keys(approvedLimits).every(key => request.limits[key] <= approvedLimits[key]);
}

function memoryTarget(adapterDeviceKey = "software-camera") {
    return {
        backend: "mf-memory", privateSelector: "memory:color-grid", adapterDeviceKey,
        expectedIdentity: {
            fingerprint: hash("capture-v1:mf-memory:color-grid"), scope: "synthetic-memory",
            serial: null, transport: "unknown"
        }
    };
}

function u64(value) {
    return typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= UINT64_MAX;
}

class PacketDecoder {
    constructor(onPacket, maxFrameBytes = DEFAULT_LIMITS.maxFrameBytes) {
        this.onPacket = onPacket;
        this.maxFrameBytes = maxFrameBytes;
        this.header = Buffer.alloc(8);
        this.offset = 0;
        this.body = null;
        this.jsonLength = 0;
        this.payloadLength = 0;
    }
    push(chunk) {
        let at = 0;
        while (at < chunk.length) {
            const destination = this.body ?? this.header;
            const size = Math.min(chunk.length - at, destination.length - this.offset);
            chunk.copy(destination, this.offset, at, at + size);
            at += size;
            this.offset += size;
            if (this.offset !== destination.length) continue;
            this.offset = 0;
            if (!this.body) {
                this.jsonLength = this.header.readUInt32LE(0);
                this.payloadLength = this.header.readUInt32LE(4);
                demand(this.jsonLength >= 2 && this.jsonLength <= 65536
                    && this.payloadLength <= this.maxFrameBytes, "ResourceLimit", "next");
                this.body = Buffer.alloc(this.jsonLength + this.payloadLength);
            } else {
                let metadata;
                try {
                    metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true })
                        .decode(this.body.subarray(0, this.jsonLength)));
                } catch (error) {
                    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
                    throw new SourceFault("ProtocolError", "next");
                }
                demand(record(metadata) && typeof metadata.kind === "string"
                    && (metadata.kind === "frame" || this.payloadLength === 0), "ProtocolError", "next");
                const data = this.body.subarray(this.jsonLength);
                this.body = null;
                this.onPacket(metadata, data);
            }
        }
    }
    finish() {
        demand(!this.body && this.offset === 0, "ProtocolError", "close");
    }
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class NativeWorker {
    constructor({ executable, args = ["--stdio"], limits = DEFAULT_LIMITS }) {
        this.limits = limits;
        this.pending = [];
        this.faults = [];
        this.hello = deferred();
        this.done = deferred();
        this.closed = this.done.promise;
        this.closeReceipt = null;
        this.closing = false;
        this.finished = false;
        this.killed = false;
        this.helloSeen = false;
        this.hello.promise.catch(() => {});
        this.child = spawn(executable, args, {
            windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"]
        });
        this.decoder = new PacketDecoder((metadata, data) => this.receive(metadata, data), limits.maxFrameBytes);
        this.startTimer = setTimeout(() => this.fail(new SourceFault("Timeout", "open")), limits.openDeadlineMs);
        this.child.stdout.on("data", chunk => {
            if (this.killed || this.finished) return;
            try { this.decoder.push(chunk); }
            catch (error) { this.fail(asFault(error, "next")); }
        });
        this.child.stdout.on("error", () => this.fail(new SourceFault("ProtocolError", "next")));
        this.child.stdin.on("error", () => {
            if (!this.closing) this.fail(new SourceFault("ProtocolError", "open"));
        });
        this.child.stderr.on("data", () => this.fail(new SourceFault("ProtocolError", "open")));
        this.child.on("error", error => {
            this.fail(new SourceFault(error.code === "ENOENT" ? "MissingDependency" : "SourceFailure", "open"));
        });
        this.child.on("close", (code, signal) => this.finish(code, signal));
    }
    receive(metadata, data) {
        if (metadata.kind === "hello") {
            demand(!this.helloSeen && metadata.protocol === "capture-v1" && metadata.automaticDiscovery === false,
                "ProtocolError", "open");
            this.helloSeen = true;
            clearTimeout(this.startTimer);
            this.hello.resolve();
            return;
        }
        demand(this.helloSeen, "ProtocolError", "open");
        if (metadata.kind === "closed") {
            demand(["closed", "failed", "forced"].includes(metadata.status)
                && ["not-started", "acknowledged", "failed", "unknown"].includes(metadata.acquisitionStop)
                && ["released", "unknown"].includes(metadata.resources) && Array.isArray(metadata.faults)
                && metadata.faults.length <= 4, "ProtocolError", "close");
            this.closeReceipt = {
                status: metadata.status, acquisitionStop: metadata.acquisitionStop, resources: metadata.resources,
                faults: metadata.faults.map(value => this.nativeFault(value, "close").toJSON())
            };
            const pending = this.pending.find(value => value.operation === "close");
            if (pending) pending.resolve(metadata);
            return;
        }
        const pending = this.pending[0];
        demand(pending !== undefined, "ProtocolError", "next");
        if (metadata.kind === "fault") {
            const fault = this.nativeFault(metadata, pending.operation === "discover" ? "describe" : pending.operation);
            this.pending.shift();
            this.faults.push(fault.toJSON());
            pending.reject(fault);
        } else {
            demand(pending.kinds.includes(metadata.kind), "ProtocolError", pending.operation);
            this.pending.shift();
            pending.resolve({ metadata, data: Uint8Array.from(data) });
        }
    }
    nativeFault(value, operation) {
        demand(record(value) && CODES.has(value.code) && value.operation === operation,
            "ProtocolError", operation);
        return new SourceFault(value.code, operation, { nativeCode: value.nativeCode, nativeDomain: value.nativeDomain });
    }
    fail(fault) {
        if (this.finished || this.killed) return;
        this.faults.push(fault.toJSON());
        this.hello.reject(fault);
        for (const pending of this.pending) pending.reject(fault);
        this.kill();
    }
    kill() {
        this.killed = true;
        this.closing = true;
        this.child.kill();
    }
    finish(code, signal) {
        if (this.finished) return;
        this.finished = true;
        clearTimeout(this.startTimer);
        clearTimeout(this.closeTimer);
        try { this.decoder.finish(); }
        catch (error) { this.faults.push(asFault(error, "close").toJSON()); }
        const unavailable = new SourceFault("SourceUnavailable", "close");
        this.hello.reject(unavailable);
        for (const pending of this.pending) pending.reject(unavailable);
        this.pending = [];
        const receipt = this.closeReceipt;
        const cleanExit = code === 0 && signal === null && receipt !== null && !this.killed;
        this.done.resolve({
            status: cleanExit && receipt.status === "closed" && this.faults.length === 0 ? "closed"
                : this.killed || !receipt ? "forced" : "failed",
            acquisitionStop: this.killed ? "unknown" : receipt?.acquisitionStop ?? "unknown",
            resources: this.killed ? "unknown" : receipt?.resources ?? "unknown",
            faults: [...this.faults, ...(receipt?.faults ?? []),
                ...(!cleanExit && !receipt ? [new SourceFault("CleanupFailed", "close").toJSON()] : [])],
            workerExit: "observed"
        });
    }
    async request(operation, fields, kinds, signal) {
        const started = process.hrtime.bigint();
        if (signal?.aborted) throw new SourceFault("Cancelled", operation);
        await this.hello.promise;
        demand(!this.finished && !this.closing && this.pending.length === 0, "Busy", operation);
        const budget = operation === "next" ? this.limits.readDeadlineMs : this.limits.openDeadlineMs;
        const remaining = budget - Number((process.hrtime.bigint() - started) / 1000000n);
        if (remaining <= 0) {
            const fault = new SourceFault("Timeout", operation);
            this.fail(fault);
            throw fault;
        }
        return this.enqueue(operation, fields, kinds, signal, remaining);
    }
    enqueue(operation, fields, kinds, signal, timeout) {
        const message = [operation, ...fields].join("\t") + "\n";
        demand(Buffer.byteLength(message) <= 32769 && fields.every(value => !/[\r\n\t\0]/.test(value)),
            "ProtocolError", operation);
        const result = deferred();
        const pending = { operation, kinds, resolve: null, reject: null };
        const timer = setTimeout(() => this.fail(new SourceFault("Timeout", operation)), timeout);
        let settled = false;
        const settle = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", aborted);
            callback(value);
        };
        const aborted = () => {
            pending.reject(new SourceFault("Cancelled", operation));
            this.shutdown("cancelled");
        };
        pending.resolve = value => settle(result.resolve, value);
        pending.reject = error => settle(result.reject, error);
        this.pending.push(pending);
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
        this.child.stdin.write(message, error => {
            if (error && !this.closing) this.fail(new SourceFault("ProtocolError", operation));
        });
        return result.promise;
    }
    shutdown(reason = "operator") {
        if (this.finished || this.closing) return this.closed;
        this.closing = true;
        for (const pending of this.pending) pending.reject(new SourceFault("Cancelled", pending.operation));
        this.closeTimer = setTimeout(() => this.kill(), this.limits.closeDeadlineMs);
        this.child.stdin.end("close\n");
        return this.closed;
    }
}

function validateEvidence(metadata, target, operation = "describe", cached = false) {
    demand(record(metadata.identity) && metadata.identity.fingerprint === target.expectedIdentity.fingerprint
        && metadata.identity.scope === target.expectedIdentity.scope, "IdentityChanged", operation);
    demand(hex64(metadata.digest) && Array.isArray(metadata.modes) && metadata.modes.length <= 256
        && (metadata.evidenceKind === (["mf-memory", "aravis-fake"].includes(target.backend) ? "synthetic"
            : target.backend.startsWith("aravis-") ? "authorized-session-probe" : "native-read-only")
            || cached && metadata.evidenceKind === "operator-supplied"),
    "ProtocolError", operation);
    const seen = new Set();
    for (const mode of metadata.modes) {
        const windows = ["windows-mf", "mf-memory"].includes(target.backend);
        demand(record(mode) && modeIdValid(mode.modeId)
            && mode.modeId.startsWith(windows ? "mf-" : target.backend === "linux-v4l2" ? "v4l2-" : "arv-")
            && !seen.has(mode.modeId)
            && Number.isInteger(mode.width) && mode.width > 0 && mode.width <= 4096
            && Number.isInteger(mode.height) && mode.height > 0 && mode.height <= 4096
            && mode.nativeMediaType === "video"
            && typeof mode.nativeSubtype === "string" && (windows
                ? /^\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/i.test(mode.nativeSubtype)
                : target.backend === "linux-v4l2" ? ["V4L2:YUYV", "V4L2:MJPG"].includes(mode.nativeSubtype)
                    : ["Mono8", "RGB8"].includes(mode.nativeSubtype))
            && Number.isInteger(mode.stride) && (mode.stride !== 0 || mode.nativeSubtype === "V4L2:MJPG")
            && mode.stride >= (windows ? -2147483647 : 0) && mode.stride <= 2147483647
            && mode.interlace === "progressive" && typeof mode.evidenceLocator === "string"
            && (windows ? /^(MFCreate2DMediaBuffer\/software-mode|IMFSourceReader::GetNativeMediaType\/[0-9]{1,3})$/.test(mode.evidenceLocator)
                : mode.evidenceLocator.length <= 512 && !/[\u0000-\u001f]/.test(mode.evidenceLocator))
            && (windows || typeof mode.nativeDetails === "string" && mode.nativeDetails.length <= 4096),
        "ProtocolError", operation);
        if (mode.cadence !== null) {
            demand(record(mode.cadence) && Number.isInteger(mode.cadence.numerator)
                && mode.cadence.numerator > 0 && mode.cadence.numerator <= 4294967295
                && Number.isInteger(mode.cadence.denominator) && mode.cadence.denominator > 0
                && mode.cadence.denominator <= 4294967295, "ProtocolError", operation);
            let a = mode.cadence.numerator, b = mode.cadence.denominator;
            while (b) [a, b] = [b, a % b];
            demand(a === 1, "ProtocolError", operation);
        }
        seen.add(mode.modeId);
    }
    return {
        targetKey: target.adapterDeviceKey, evidenceKind: metadata.evidenceKind,
        identity: {
            fingerprint: metadata.identity.fingerprint, scope: metadata.identity.scope, serial: null, transport: "unknown"
        },
        modes: metadata.modes.map(mode => ({
            modeId: mode.modeId, nativeMediaType: mode.nativeMediaType, nativeSubtype: mode.nativeSubtype,
            width: mode.width, height: mode.height, cadence: structuredClone(mode.cadence),
            stride: mode.stride, interlace: mode.interlace, evidenceLocator: mode.evidenceLocator,
            ...(mode.nativeDetails === undefined ? {} : { nativeDetails: mode.nativeDetails })
        })), digest: metadata.digest
    };
}

function jpegDimensions(data) {
    demand(data.length >= 4 && data[0] === 0xff && data[1] === 0xd8
        && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9, "ProtocolError", "next");
    let at = 2;
    while (at < data.length - 2) {
        demand(data[at++] === 0xff, "ProtocolError", "next");
        while (at < data.length && data[at] === 0xff) at++;
        const marker = data[at++];
        demand(marker !== 0xda && at + 2 <= data.length, "ProtocolError", "next");
        const length = data[at] * 256 + data[at + 1];
        demand(length >= 2 && at + length <= data.length, "ProtocolError", "next");
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
            demand(length >= 8, "ProtocolError", "next");
            const dimensions = { width: data[at + 5] * 256 + data[at + 6], height: data[at + 3] * 256 + data[at + 4] };
            demand(dimensions.width > 0 && dimensions.height > 0, "ProtocolError", "next");
            return dimensions;
        }
        at += length;
    }
    throw new SourceFault("ProtocolError", "next");
}

class CaptureSession {
    constructor(worker, request, mode, durationMs) {
        this.worker = worker;
        this.request = request;
        this.mode = mode;
        this.reading = false;
        this.sequence = 0n;
        this.closing = false;
        this.closeReason = null;
        this.closed = worker.closed.then(result => {
            this.closing = true;
            clearTimeout(this.expiry);
            return result;
        });
        this.expiry = setTimeout(() => this.close("duration-expired"), durationMs);
    }
    async next(signal) {
        demand(!this.closing, "SourceUnavailable", "next");
        demand(!this.reading, "Busy", "next");
        this.reading = true;
        const origin = process.hrtime.bigint();
        try {
            const { metadata, data } = await this.worker.request("next", [], ["frame", "gap", "end"], signal);
            if (metadata.kind === "gap") {
                demand(metadata.generation === "1" && u64(metadata.dropped)
                    && ["overflow", "native-incomplete"].includes(metadata.reason), "ProtocolError", "next");
                return metadata;
            }
            if (metadata.kind === "end") {
                demand(metadata.reason === "eos", "ProtocolError", "next");
                this.closing = true;
                return metadata;
            }
            demand(metadata.generation === "1" && u64(metadata.sequence) && BigInt(metadata.sequence) > this.sequence
                && metadata.modeId === this.mode.modeId && metadata.width === this.mode.width
                && metadata.height === this.mode.height && metadata.format === this.request.output
                && metadata.payloadBytes === data.byteLength && data.byteLength > 0
                && data.byteLength <= this.request.limits.maxFrameBytes && record(metadata.timing)
                && u64(metadata.timing.hostReceiptMonotonicNs)
                && (metadata.timing.pipelinePtsNs === null || u64(metadata.timing.pipelinePtsNs))
                && metadata.timing.source === null, "ProtocolError", "next");
            for (const key of ["cameraTimestampNs", "sdkSystemTimestampNs", "nativeFrameId",
                "nativeTimestampNs", "nativeSequence"]) {
                demand(metadata.timing[key] === undefined || metadata.timing[key] === null || u64(metadata.timing[key]),
                    "ProtocolError", "next");
            }
            if (metadata.format === "JPEG") {
                const dimensions = jpegDimensions(data);
                demand(dimensions.width === metadata.width && dimensions.height === metadata.height, "ProtocolError", "next");
            } else {
                demand(data.byteLength === metadata.width * metadata.height
                    + 2 * Math.ceil(metadata.width / 2) * Math.ceil(metadata.height / 2), "ProtocolError", "next");
            }
            this.sequence = BigInt(metadata.sequence);
            return { ...metadata, data, freshnessOriginMonotonicNs: origin.toString() };
        } catch (error) {
            if (!(error instanceof SourceFault && error.code === "Busy")) this.close("source-fault");
            throw asFault(error, "next");
        } finally {
            this.reading = false;
        }
    }
    close(reason = "operator") {
        this.closeReason ??= reason;
        this.closing = true;
        clearTimeout(this.expiry);
        this.worker.shutdown(reason);
        return this.closed;
    }
}

class CaptureBackend {
    constructor({ workerPath, cachedEvidence = [], authorizeOpen = () => false }) {
        demand(typeof workerPath === "string" && path.isAbsolute(workerPath) && !workerPath.includes("\0"),
            "InvalidSelection", "open");
        demand(Array.isArray(cachedEvidence) && cachedEvidence.length <= 256, "ResourceLimit", "describe");
        this.workerPath = workerPath;
        demand(typeof authorizeOpen === "function", "PolicyDenied", "open");
        this.authorizeOpen = authorizeOpen;
        this.cache = new Map();
        this.active = new Set();
        for (const evidence of cachedEvidence) {
            demand(record(evidence) && opaqueKey(evidence.targetKey) && record(evidence.identity)
                && hex64(evidence.identity.fingerprint)
                && Object.values(BACKEND_SCOPES).includes(evidence.identity.scope),
            "InvalidSelection", "describe");
            const normalized = validateEvidence(evidence, {
                backend: Object.keys(BACKEND_SCOPES).find(key => BACKEND_SCOPES[key] === evidence.identity.scope),
                adapterDeviceKey: evidence.targetKey, expectedIdentity: evidence.identity
            }, "describe", true);
            normalized.evidenceKind = evidence.evidenceKind === "synthetic" ? "synthetic" : "operator-supplied";
            this.cache.set(evidence.targetKey, normalized);
        }
    }
    async describe(target, request = {}, signal) {
        const selection = validateTarget(target, "describe");
        if (signal?.aborted) throw new SourceFault("Cancelled", "describe");
        const refresh = request.refresh ?? "cached";
        if (refresh === "cached") {
            const evidence = this.cache.get(selection.adapterDeviceKey);
            demand(evidence !== undefined, "SourceUnavailable", "describe");
            demand(evidence.identity.fingerprint === selection.expectedIdentity.fingerprint
                && evidence.identity.scope === selection.expectedIdentity.scope, "IdentityChanged", "describe");
            return { ...structuredClone(evidence), evidenceKind: evidence.evidenceKind === "synthetic"
                ? "synthetic" : "operator-supplied", cached: true };
        }
        const controlProbe = refresh === "authorized-session-probe" && selection.backend.startsWith("aravis-");
        demand((refresh === "native-read-only" || controlProbe) && request.permitDeviceAccess === true
            && (!controlProbe || request.permitControlProbe === true), "PolicyDenied", "describe");
        demand(controlProbe || !selection.backend.startsWith("aravis-"), "PolicyDenied", "describe");
        demand(this.active.size === 0, "Busy", "describe");
        const limits = normalizeLimits({ openDeadlineMs: request.deadlineMs ?? 5000 });
        this.active.add(selection.adapterDeviceKey);
        const worker = new NativeWorker({ executable: this.workerPath, limits });
        let result, failure;
        try {
            const response = await worker.request("describe", [
                selection.backend, Buffer.from(selection.privateSelector).toString("hex"),
                selection.expectedIdentity.fingerprint,
                controlProbe ? "permit-control-probe" : selection.backend === "mf-memory" ? "permit-software-read" : "permit-native-read"
            ], ["evidence"], signal);
            result = validateEvidence(response.metadata, selection);
        } catch (error) {
            failure = asFault(error, "describe");
        }
        const closed = await worker.shutdown();
        this.active.delete(selection.adapterDeviceKey);
        if (failure) { failure.cleanup = closed; throw failure; }
        demand(closed.status === "closed", "CleanupFailed", "describe");
        this.cache.set(selection.adapterDeviceKey, structuredClone(result));
        return result;
    }
    async open(request, signal) {
        demand(record(request), "InvalidSelection", "open");
        const target = validateTarget(request.target);
        if (signal?.aborted) throw new SourceFault("Cancelled", "open");
        const limits = normalizeLimits(request.limits);
        demand(modeIdValid(request.modeId) && hex64(request.capabilityEvidenceDigest), "InvalidSelection", "open");
        demand(["JPEG", "I420"].includes(request.output), "UnsupportedFormat", "open");
        const durationMs = request.durationMs;
        demand(Number.isInteger(durationMs) && durationMs > 0 && durationMs <= 30000, "ResourceLimit", "open");
        demand(this.authorizeOpen(structuredClone({
            target, modeId: request.modeId, capabilityEvidenceDigest: request.capabilityEvidenceDigest,
            output: request.output, limits, durationMs
        })) === true, "PolicyDenied", "open");
        demand(this.active.size === 0, "Busy", "open");
        const evidence = this.cache.get(target.adapterDeviceKey);
        demand(evidence !== undefined && evidence.digest === request.capabilityEvidenceDigest
            && evidence.identity.fingerprint === target.expectedIdentity.fingerprint, "IdentityChanged", "open");
        const mode = evidence.modes.find(value => value.modeId === request.modeId);
        demand(mode !== undefined, "InvalidSelection", "open");
        demand(mode.width <= limits.maxWidth && mode.height <= limits.maxHeight, "ResourceLimit", "open");
        this.active.add(target.adapterDeviceKey);
        const started = process.hrtime.bigint();
        const worker = new NativeWorker({ executable: this.workerPath, limits });
        try {
            const { metadata } = await worker.request("open", [
                target.backend, Buffer.from(target.privateSelector).toString("hex"), target.expectedIdentity.fingerprint,
                evidence.digest, mode.modeId, request.output, String(limits.maxWidth), String(limits.maxHeight),
                String(limits.maxNativePayloadBytes), String(limits.maxFrameBytes), String(Math.max(1, limits.readDeadlineMs - 50)),
                String(durationMs), "permit-acquisition"
            ], ["opened"], signal);
            demand(metadata.generation === "1" && metadata.modeId === mode.modeId, "ProtocolError", "open");
            const elapsed = Number((process.hrtime.bigint() - started) / 1000000n);
            demand(elapsed < durationMs, "Timeout", "open");
            const session = new CaptureSession(worker, { output: request.output, limits }, mode, durationMs - elapsed);
            session.closed.then(() => this.active.delete(target.adapterDeviceKey));
            return session;
        } catch (error) {
            const failure = asFault(error, "open");
            failure.cleanup = await worker.shutdown("open-failed");
            this.active.delete(target.adapterDeviceKey);
            throw failure;
        }
    }
}

async function discover({ workerPath, permitDiscovery = false }, signal) {
    demand(permitDiscovery === true, "PolicyDenied", "describe");
    demand(path.isAbsolute(workerPath), "InvalidSelection", "describe");
    const worker = new NativeWorker({ executable: workerPath });
    let value, failure;
    try {
        value = (await worker.request("discover", ["permit-discovery"], ["discovery"], signal)).metadata;
        demand(Array.isArray(value.devices) && value.devices.length <= 64, "ProtocolError", "describe");
    } catch (error) { failure = asFault(error, "describe"); }
    const closed = await worker.shutdown();
    if (failure) { failure.cleanup = closed; throw failure; }
    demand(closed.status === "closed", "CleanupFailed", "describe");
    return value;
}

module.exports = {
    CaptureBackend, CaptureSession, configuredCapturePermission, discover, memoryTarget,
    DEFAULT_LIMITS, BACKEND_SCOPES, normalizeLimits, validateTarget, validateEvidence, modeIdValid,
    PacketDecoder, NativeWorker, jpegDimensions, u64
};
