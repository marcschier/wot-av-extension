import { createHash } from "node:crypto";
import { isRecord, OnvifError } from "../binding/errors.js";

export type DigestAlgorithm = "MD5" | "MD5-sess" | "SHA-256" | "SHA-256-sess";
export type DigestQop = "auth" | "auth-int";
export interface DigestPolicy {
    algorithms: readonly DigestAlgorithm[];
    qops: readonly DigestQop[];
}
export interface DigestChallenge {
    readonly realm: string;
    readonly nonce: string;
    readonly algorithm: DigestAlgorithm;
    readonly qop?: DigestQop;
    readonly opaque?: string;
    readonly stale: boolean;
    readonly charset: "UTF-8" | "ISO-8859-1";
    readonly userhash: boolean;
}

export const DEFAULT_DIGEST_POLICY: Readonly<DigestPolicy> = Object.freeze({
    algorithms: Object.freeze(["SHA-256"] satisfies DigestAlgorithm[]),
    qops: Object.freeze(["auth-int", "auth"] satisfies DigestQop[])
});

function authFailed(message: string): never {
    throw new OnvifError("AuthenticationFailed", message, "rejected");
}

function splitFields(header: string): string[] {
    if (header.length > 16384 || /[\u0000-\u001f\u007f]/u.test(header)) authFailed("Invalid authentication challenge");
    let quoted = false, escaped = false, start = 0;
    const result: string[] = [];
    for (let index = 0; index < header.length; index++) {
        const char = header[index];
        if (escaped) { escaped = false; continue; }
        if (quoted && char === "\\") { escaped = true; continue; }
        if (char === '"') quoted = !quoted;
        if (!quoted && char === ",") {
            result.push(header.slice(start, index).trim());
            start = index + 1;
        }
    }
    if (quoted || escaped) authFailed("Unterminated authentication challenge");
    result.push(header.slice(start).trim());
    return result;
}

function challenges(headers: readonly string[]): Map<string, string>[] {
    if (headers.length > 32) authFailed("Too many authentication challenges");
    const result: Map<string, string>[] = [];
    for (const header of headers) {
        let current: Map<string, string> | undefined;
        for (let part of splitFields(header)) {
            if (!/^[!#$%&'*+.^_`|~\w-]+\s*=/u.test(part)) {
                const scheme = /^([!#$%&'*+.^_`|~\w-]+)(?:\s+(.*))?$/u.exec(part);
                if (!scheme) authFailed("Malformed authentication scheme");
                current = scheme[1]?.toLowerCase() === "digest" ? new Map() : undefined;
                if (current !== undefined) result.push(current);
                part = scheme[2] ?? "";
            }
            if (!current || !part) continue;
            const parameter = /^([!#$%&'*+.^_`|~\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([!#$%&'*+.^_`|~\w-]+))$/u.exec(part);
            if (!parameter || parameter[1] === undefined) authFailed("Malformed Digest parameter");
            const key = parameter[1].toLowerCase();
            if (current.has(key)) authFailed("Duplicate Digest parameter");
            current.set(key, (parameter[2] ?? parameter[3] ?? "").replace(/\\(.)/gu, "$1"));
        }
    }
    return result;
}

const strength: Record<DigestAlgorithm, number> = { "MD5": 1, "MD5-sess": 2, "SHA-256": 3, "SHA-256-sess": 4 };
const algorithms = Object.keys(strength) as DigestAlgorithm[];

export function digestPolicy(options: Partial<DigestPolicy> = {}): DigestPolicy {
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "algorithms" && key !== "qops")) {
        throw new OnvifError("InvalidConfiguration", "Unknown Digest policy option");
    }
    const policy = { ...DEFAULT_DIGEST_POLICY, ...options };
    if (!Array.isArray(policy.algorithms) || policy.algorithms.length === 0
        || policy.algorithms.some((algorithm) => !algorithms.includes(algorithm))
        || !Array.isArray(policy.qops) || policy.qops.length === 0
        || policy.qops.some((qop) => qop !== "auth" && qop !== "auth-int")) {
        throw new OnvifError("InvalidConfiguration", "Unsupported Digest policy");
    }
    return { algorithms: [...policy.algorithms], qops: [...policy.qops] };
}

export function selectDigestChallenge(headers: readonly string[], options: Partial<DigestPolicy> = {}): DigestChallenge {
    const policy = digestPolicy(options);
    const supported: DigestChallenge[] = [];
    for (const values of challenges(headers)) {
        const algorithmText = values.get("algorithm") ?? "MD5";
        const algorithm = algorithms.find((entry) => entry.toLowerCase() === algorithmText.toLowerCase());
        if (algorithm === undefined || !policy.algorithms.includes(algorithm)) continue;
        const realm = values.get("realm"), nonce = values.get("nonce");
        if (realm === undefined || !nonce) authFailed("Digest requires realm and nonce");
        const offeredQops = values.get("qop")?.split(",").map((value) => value.trim());
        const qop = policy.qops.find((value) => offeredQops?.includes(value));
        if (offeredQops !== undefined && qop === undefined) continue;
        const charset = values.get("charset");
        if (charset !== undefined && charset.toUpperCase() !== "UTF-8") continue;
        const stale = values.get("stale");
        const userhash = values.get("userhash");
        if ((stale !== undefined && stale !== "true" && stale !== "false")
            || (userhash !== undefined && userhash !== "true" && userhash !== "false")) authFailed("Invalid Digest boolean");
        supported.push({
            realm, nonce, algorithm,
            ...(qop === undefined ? {} : { qop }),
            ...(values.has("opaque") ? { opaque: values.get("opaque") ?? "" } : {}),
            stale: stale === "true",
            charset: charset === undefined ? "ISO-8859-1" : "UTF-8",
            userhash: userhash === "true"
        });
    }
    const selected = supported.sort((a, b) => strength[b.algorithm] - strength[a.algorithm])[0];
    if (selected === undefined) authFailed("No permitted Digest algorithm and qop were offered; no downgrade performed");
    return selected;
}

export interface DigestAuthorizationInput {
    challenge: DigestChallenge;
    username: string;
    password: string;
    method: string;
    uri: string;
    body: Uint8Array;
    cnonce: string;
    nonceCount: number;
}

function quoted(value: string): string {
    if (/[\u0000-\u001f\u007f]/u.test(value)) authFailed("Invalid authentication header value");
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function createDigestAuthorization(input: DigestAuthorizationInput): string {
    const { challenge, username, password, method, uri, body, cnonce, nonceCount } = input;
    if (!Number.isInteger(nonceCount) || nonceCount < 1 || nonceCount > 0xffffffff || !cnonce) {
        authFailed("Invalid Digest nonce state");
    }
    const hash = challenge.algorithm.startsWith("MD5") ? "md5" : "sha256";
    const encoding = challenge.charset === "UTF-8" ? "utf8" : "latin1";
    if (encoding === "latin1" && /[^\u0000-\u00ff]/u.test(username + password + challenge.realm)) {
        authFailed("Digest challenge did not permit UTF-8 credentials");
    }
    const h = (value: string): string => createHash(hash).update(value, encoding).digest("hex");
    const nc = nonceCount.toString(16).padStart(8, "0");
    let ha1 = h(`${username}:${challenge.realm}:${password}`);
    if (challenge.algorithm.endsWith("-sess")) ha1 = h(`${ha1}:${challenge.nonce}:${cnonce}`);
    const ha2 = h(`${method}:${uri}${challenge.qop === "auth-int" ? `:${createHash(hash).update(body).digest("hex")}` : ""}`);
    const response = h(`${ha1}:${challenge.nonce}:${challenge.qop ? `${nc}:${cnonce}:${challenge.qop}:` : ""}${ha2}`);
    const user = challenge.userhash ? `username=${quoted(h(`${username}:${challenge.realm}`))}, userhash=true`
        : /[^\u0020-\u007e]/u.test(username) && encoding === "utf8"
            ? `username*=UTF-8''${encodeURIComponent(username).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`
            : `username=${quoted(username)}`;
    const fields = [
        user, `realm=${quoted(challenge.realm)}`, `nonce=${quoted(challenge.nonce)}`,
        `uri=${quoted(uri)}`, `algorithm=${challenge.algorithm}`, `response=${quoted(response)}`
    ];
    if (challenge.opaque !== undefined) fields.push(`opaque=${quoted(challenge.opaque)}`);
    if (challenge.qop) fields.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce=${quoted(cnonce)}`);
    else if (challenge.algorithm.endsWith("-sess")) fields.push(`cnonce=${quoted(cnonce)}`);
    return `Digest ${fields.join(", ")}`;
}
