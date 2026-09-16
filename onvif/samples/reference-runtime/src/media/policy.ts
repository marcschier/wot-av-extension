import { isIP } from "node:net";
import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";
import type {
    MediaAuthentication, MediaCodec, MediaLimits, MediaReplayRange, MediaScopedPassword,
    MediaSecurityMaterial, MediaSecurityScope, MediaTransport, MediaTrustPolicy, OpenMediaRequest
} from "./types.js";

export const MEDIA_TRANSPORTS: readonly MediaTransport[] = Object.freeze([
    "tcp-interleaved", "udp-unicast", "http-tunnel", "https-tunnel", "tls-interleaved"
]);
export const MEDIA_CODECS: Readonly<Record<MediaCodec, number>> = Object.freeze({
    JPEG: 1, H264: 2, H265: 4, "MP4V-ES": 8, PCMU: 16, "MPEG4-GENERIC": 32
});

export function isMediaCodec(value: unknown): value is MediaCodec {
    return typeof value === "string" && Object.hasOwn(MEDIA_CODECS, value);
}

export function mediaText(value: unknown, maximum: number, label: string, empty = false): string {
    if (typeof value !== "string" || !empty && !value || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new OnvifError("InvalidConfiguration", `Invalid ${label}`);
    }
    const bytes = Buffer.from(value, "utf8");
    const valid = bytes.length <= maximum && bytes.toString("utf8") === value;
    bytes.fill(0);
    if (!valid) throw new OnvifError("InvalidConfiguration", `Invalid UTF-8 or excessive ${label}`);
    return value;
}

function keys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new OnvifError("InvalidConfiguration", `Unknown or invalid ${label} option`);
    }
}

export function nativeMediaUrl(uri: string): { readonly url: URL; readonly origin: string } {
    if (typeof uri !== "string" || Buffer.byteLength(uri, "utf8") > 2048
        || /[\u0000-\u0020\u007f\\#]/u.test(uri) || !/^rtsps?:\/\/[^/?#@]+(?:[/?]|$)/u.test(uri)) {
        throw new OnvifError("PolicyDenied", "Invalid native media URI");
    }
    let url: URL;
    try { url = new URL(uri); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new OnvifError("PolicyDenied", "Native media URI must be absolute");
    }
    if (!["rtsp:", "rtsps:"].includes(url.protocol) || url.username || url.password || url.hash
        || !url.hostname || !url.port || /[%\s]/u.test(url.hostname)
        || Number(url.port) < 1 || Number(url.port) > 65535) {
        throw new OnvifError("PolicyDenied", "Native media requires an explicit port and no userinfo or fragment");
    }
    return { url, origin: `${url.protocol}//${url.hostname}:${url.port}` };
}

export function mediaServiceTarget(href: string): string {
    if (typeof href !== "string" || /[\u0000-\u0020\u007f\\#]/u.test(href)) {
        throw new OnvifError("PolicyDenied", "Invalid native URI resolver service target");
    }
    let url: URL;
    try { url = new URL(href); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new OnvifError("PolicyDenied", "URI resolver service must be absolute HTTP(S)");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || !url.hostname || /^[a-z]+:\/\/[^/?]*@/u.test(href)) {
        throw new OnvifError("PolicyDenied", "Invalid URI resolver service scheme or userinfo");
    }
    return url.href;
}

function list<T>(value: readonly T[], maximum: number, check: (entry: T) => T): readonly T[] {
    if (!Array.isArray(value) || !value.length || value.length > maximum) {
        throw new OnvifError("InvalidConfiguration", "Media policy requires a bounded nonempty allowlist");
    }
    const result = value.map(check);
    if (new Set(result).size !== result.length) throw new OnvifError("InvalidConfiguration", "Duplicate media policy entry");
    return Object.freeze(result);
}

function authentication(value: MediaAuthentication): MediaAuthentication {
    keys(value, ["kind", "realm", "allowLegacyMd5"], "media authentication");
    if (value.kind === "none" && Object.keys(value).length === 1) return Object.freeze({ kind: "none" });
    if (value.kind !== "digest" || value.allowLegacyMd5 !== undefined && typeof value.allowLegacyMd5 !== "boolean") {
        throw new OnvifError("UnsupportedCapability", "Media requires explicit no-auth or realm-scoped Digest");
    }
    return Object.freeze({ kind: "digest", realm: mediaText(value.realm, 1024, "media realm"),
        ...(value.allowLegacyMd5 === undefined ? {} : { allowLegacyMd5: value.allowLegacyMd5 }) });
}

export function validateMediaTrust(value: MediaTrustPolicy): MediaTrustPolicy {
    keys(value, ["serviceTargets", "allowedOrigins", "allowedTargets", "allowedRedirectOrigins",
        "transports", "authentication", "tunnelAuthentication"], "media trust");
    const origins = list(value.allowedOrigins, 16, (entry) => {
        if (nativeMediaUrl(entry).origin !== entry) throw new OnvifError("InvalidConfiguration", "Media origin must be exact, without path");
        return entry;
    });
    if (value.allowedRedirectOrigins !== undefined && !Array.isArray(value.allowedRedirectOrigins)) {
        throw new OnvifError("InvalidConfiguration", "Invalid media redirect allowlist");
    }
    const redirects = value.allowedRedirectOrigins === undefined || value.allowedRedirectOrigins.length === 0 ? []
        : list(value.allowedRedirectOrigins, 16, (entry) => {
            if (!origins.includes(entry)) throw new OnvifError("PolicyDenied", "Media redirect origin is not explicitly authorized");
            return entry;
        });
    const auth = authentication(value.authentication);
    const tunnel = value.tunnelAuthentication === undefined ? undefined : authentication(value.tunnelAuthentication);
    if (auth.kind === "digest" && tunnel?.kind === "digest" && !!auth.allowLegacyMd5 !== !!tunnel.allowLegacyMd5) {
        throw new OnvifError("UnsupportedCapability", "Native v2 requires the same explicit legacy-MD5 policy in both authentication layers");
    }
    return Object.freeze({
        serviceTargets: list(value.serviceTargets, 64, mediaServiceTarget),
        allowedOrigins: origins, allowedRedirectOrigins: Object.freeze(redirects),
        ...(value.allowedTargets === undefined ? {} : { allowedTargets: list(value.allowedTargets, 256, (entry) => {
            if (!origins.includes(nativeMediaUrl(entry).origin)) throw new OnvifError("PolicyDenied", "Exact media target is outside its origin policy");
            return entry;
        }) }),
        transports: list(value.transports, 5, (entry) => {
            if (!MEDIA_TRANSPORTS.includes(entry)) throw new OnvifError("UnsupportedCapability", "Unsupported native media transport");
            return entry;
        }),
        authentication: auth, ...(tunnel === undefined ? {} : { tunnelAuthentication: tunnel })
    });
}

export function authorizeMediaTarget(
    uri: string, transport: MediaTransport, trust: MediaTrustPolicy
): { readonly origin: string; readonly tunnelOrigin?: string } {
    const { url, origin } = nativeMediaUrl(uri);
    if (!trust.allowedOrigins.includes(origin) || !trust.transports.includes(transport)
        || trust.allowedTargets !== undefined && !trust.allowedTargets.includes(uri)) {
        throw new OnvifError("PolicyDenied", "Native media target or transport is not independently authorized");
    }
    if ((transport === "tls-interleaved") !== (url.protocol === "rtsps:")) {
        throw new OnvifError("PolicyDenied", "Native URI scheme and requested transport disagree; no downgrade");
    }
    if (transport === "http-tunnel" || transport === "https-tunnel") {
        return { origin, tunnelOrigin: `${transport === "https-tunnel" ? "https" : "http"}://${url.hostname}:${url.port}` };
    }
    if (trust.tunnelAuthentication?.kind === "digest") {
        throw new OnvifError("PolicyDenied", "Tunnel credentials cannot be applied to a different media transport");
    }
    return { origin };
}

function password(value: MediaScopedPassword | undefined, scope: MediaSecurityScope,
    origin: string, auth: MediaAuthentication): MediaScopedPassword | undefined {
    if (auth.kind === "none") {
        if (value !== undefined) throw new OnvifError("PolicyDenied", "Unrequested native credential material");
        return undefined;
    }
    if (value === undefined) throw new OnvifError("AuthenticationFailed", "Media resolver supplied no scoped credentials", "rejected");
    keys(value, ["origin", "principal", "realm", "username", "password"], "media credential");
    if (value.origin !== origin || value.principal !== scope.principal || value.realm !== auth.realm) {
        throw new OnvifError("PolicyDenied", "Media credential origin, realm or principal disagrees with its independent scope", "rejected");
    }
    return Object.freeze({
        origin, principal: scope.principal, realm: auth.realm,
        username: mediaText(value.username, 1024, "media username"),
        password: mediaText(value.password, 1024, "media password", true)
    });
}

export function validateMediaSecurity(scope: MediaSecurityScope, value: MediaSecurityMaterial): MediaSecurityMaterial {
    keys(value, ["thingId", "targetRef", "principal", "origin", "native", "tunnel", "caPem"], "media security resolver");
    if (value.thingId !== scope.thingId || value.targetRef !== scope.targetRef
        || value.principal !== scope.principal || value.origin !== scope.origin) {
        throw new OnvifError("PolicyDenied", "Media security material is not scoped to this owned Thing, target and principal", "rejected");
    }
    const native = password(value.native, scope, scope.origin, scope.authentication);
    const tunnel = password(value.tunnel, scope, scope.tunnelOrigin ?? "",
        scope.tunnelAuthentication ?? { kind: "none" });
    let caPem: string | undefined;
    if (value.caPem !== undefined) {
        if (typeof value.caPem !== "string" || value.caPem.includes("\0")
            || Buffer.byteLength(value.caPem, "utf8") > 32768 || /[^\u0009\u000a\u000d\u0020-\u007e]/u.test(value.caPem)) {
            throw new OnvifError("InvalidSecurity", "Media CA material must be bounded PEM text");
        }
        caPem = value.caPem;
    }
    return Object.freeze({ thingId: scope.thingId, targetRef: scope.targetRef, principal: scope.principal, origin: scope.origin,
        ...(native === undefined ? {} : { native }), ...(tunnel === undefined ? {} : { tunnel }),
        ...(caPem === undefined ? {} : { caPem }) });
}

export function validateReplayRange(value: MediaReplayRange): MediaReplayRange {
    keys(value, ["startNtpNs", "endNtpNs"], "replay range");
    if (typeof value.startNtpNs !== "bigint" || typeof value.endNtpNs !== "bigint"
        || value.startNtpNs < 2208988800000000000n || value.endNtpNs <= value.startNtpNs
        || value.endNtpNs > 9223372036854775807n) {
        throw new OnvifError("InvalidValue", "Replay requires an increasing, signed-64-bit nanosecond range since 1900, at or after 1970");
    }
    return Object.freeze({ startNtpNs: value.startNtpNs, endNtpNs: value.endNtpNs });
}

const defaults: MediaLimits = Object.freeze({
    wireBytes: 2 * 1024 * 1024, inflatedBytes: 8 * 1024 * 1024, metadataDeadlineMs: 2000,
    queueBytes: 32 * 1024 * 1024, queueUnits: 64, maxSubscribers: 8,
    maxWidth: 4096, maxHeight: 2160, decodedBytes: 32 * 1024 * 1024,
    closeTimeoutMs: 6000, killTimeoutMs: 3000, controlTimeoutMs: 10000, partialFrameTimeoutMs: 2000,
    stderrBytes: 128 * 1024
});
const maxima: MediaLimits = {
    wireBytes: 8 * 1024 * 1024, inflatedBytes: 32 * 1024 * 1024, metadataDeadlineMs: 10000,
    queueBytes: 128 * 1024 * 1024, queueUnits: 256, maxSubscribers: 16,
    maxWidth: 8192, maxHeight: 8192, decodedBytes: 64 * 1024 * 1024,
    closeTimeoutMs: 60000, killTimeoutMs: 30000, controlTimeoutMs: 60000, partialFrameTimeoutMs: 30000,
    stderrBytes: 1024 * 1024
};
export function mediaLimits(input: Partial<MediaLimits> = {}): MediaLimits {
    keys(input, Object.keys(defaults), "media resource limit");
    const result = { ...defaults, ...input };
    for (const key of Object.keys(maxima) as (keyof MediaLimits)[]) positiveInteger(result[key], key, maxima[key]);
    if (result.queueBytes < 65536 || result.decodedBytes < 384) {
        throw new OnvifError("InvalidConfiguration", "Native queue or decoded-frame limit is below the v2 minimum");
    }
    return Object.freeze(result);
}

export function validateMediaRequest(request: OpenMediaRequest): { readonly limits: MediaLimits; readonly trackMask: number; readonly codecMask: number } {
    keys(request, ["action", "input", "formIndex", "formRef", "addressing", "transport", "tracks", "packetOutput",
        "localAddress", "replay", "signal", "timeoutMs", "limits"], "media request");
    mediaText(request.action, 1024, "declared media resolver action");
    if (request.formRef !== undefined) {
        keys(request.formRef, ["document", "form", "operation"], "media FormReference");
        mediaServiceTarget(request.formRef.document);
        const form = mediaText(request.formRef.form, 4096, "native Form identity");
        if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(form)
            || request.formRef.operation !== "https://www.w3.org/2019/wot/td#invokeAction") {
            throw new OnvifError("UnsupportedCapability", "FormReference requires an absolute native Form identity and standard invokeAction operation");
        }
    }
    if (!MEDIA_TRANSPORTS.includes(request.transport) || request.packetOutput !== undefined && typeof request.packetOutput !== "boolean"
        || request.formIndex !== undefined && (!Number.isSafeInteger(request.formIndex) || request.formIndex < 0)
        || request.signal !== undefined && !(request.signal instanceof AbortSignal)) {
        throw new OnvifError("InvalidConfiguration", "Invalid media request selection or cancellation signal");
    }
    positiveInteger(request.timeoutMs ?? 12000, "media open timeout", 60000);
    const address = request.localAddress;
    const ip = typeof address === "string" ? isIP(address) : 0;
    if (!ip || address.length > 64 || ip === 4 && (address.startsWith("0.") || Number(address.split(".")[0]) >= 224)
        || ip === 6 && (new URL(`http://[${address}]`).hostname === "[::]" || /^ff/iu.test(address))) {
        throw new OnvifError("PolicyDenied", "An explicit unicast local interface IP is required");
    }
    keys(request.tracks, ["video", "audio", "metadata", "backchannel"], "media tracks");
    let trackMask = 0, codecMask = 0;
    const video = request.tracks.video, audio = request.tracks.audio;
    if (video !== undefined) {
        if (!Array.isArray(video)) throw new OnvifError("InvalidConfiguration", "Video codecs must be an explicit list");
        list(video, 4, (codec: unknown) => {
            if (!isMediaCodec(codec) || MEDIA_CODECS[codec] >= 16) throw new OnvifError("UnsupportedCapability", "Unsupported video codec");
            codecMask |= MEDIA_CODECS[codec];
            return codec;
        });
        trackMask |= 1;
    }
    if (audio !== undefined) {
        if (!Array.isArray(audio)) throw new OnvifError("InvalidConfiguration", "Audio codecs must be an explicit list");
        list(audio, 2, (codec: unknown) => {
            if (!isMediaCodec(codec) || MEDIA_CODECS[codec] < 16) throw new OnvifError("UnsupportedCapability", "Unsupported audio codec");
            codecMask |= MEDIA_CODECS[codec];
            return codec;
        });
        trackMask |= 2;
    }
    if (request.tracks.metadata !== undefined && typeof request.tracks.metadata !== "boolean") {
        throw new OnvifError("InvalidConfiguration", "Metadata track selection must be explicit boolean");
    }
    if (request.tracks.metadata) trackMask |= 4;
    if (request.tracks.backchannel !== undefined) {
        if (request.tracks.backchannel !== "PCMU") throw new OnvifError("UnsupportedCapability", "Unsupported native backchannel codec");
        trackMask |= 8;
        codecMask |= MEDIA_CODECS.PCMU;
    }
    if (!trackMask) throw new OnvifError("InvalidConfiguration", "At least one required media track must be selected");
    if (request.replay !== undefined) {
        validateReplayRange(request.replay);
        if (request.transport === "udp-unicast" || request.tracks.backchannel !== undefined) {
            throw new OnvifError("UnsupportedCapability", "Recorded v2 media does not support UDP or backchannel");
        }
    }
    return { limits: mediaLimits(request.limits), trackMask, codecMask: codecMask || 1 };
}
