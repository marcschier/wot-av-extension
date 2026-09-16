import { createHash, randomBytes } from "node:crypto";
import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";
import { serializeXml } from "../xml/parser.js";
import { type XmlElement } from "../xml/types.js";

export type Clock = () => Date;
export type NonceSource = () => Uint8Array;
export interface UsernameTokenPolicy {
    offsetMs?: number;
    maxOffsetMs?: number;
}
export interface UsernameTokenInput extends UsernameTokenPolicy {
    username: string;
    password: string;
    clock?: Clock;
    nonce?: NonceSource;
}

export const WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
export const WSU_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const TOKEN_PROFILE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0";
const MESSAGE_PROFILE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0";

export function validateUsernameTokenPolicy(policy: UsernameTokenPolicy = {}): { offsetMs: number; maxOffsetMs: number } {
    if (!isRecord(policy) || Object.keys(policy).some((key) => key !== "offsetMs" && key !== "maxOffsetMs")) {
        throw new OnvifError("InvalidConfiguration", "Unknown UsernameToken policy option");
    }
    const offsetMs = policy.offsetMs ?? 0;
    const maximum = policy.maxOffsetMs ?? 300000;
    if (typeof offsetMs !== "number" || typeof maximum !== "number") {
        throw new OnvifError("InvalidConfiguration", "Device clock offsets must be finite integer milliseconds");
    }
    const maxOffsetMs = positiveInteger(maximum, "maxOffsetMs");
    if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > maxOffsetMs) {
        throw new OnvifError("InvalidConfiguration", "Device clock offset exceeds the configured bound");
    }
    return { offsetMs, maxOffsetMs };
}

export function validatedNonce(source: NonceSource = () => randomBytes(16)): Buffer {
    const value = source();
    if (!(value instanceof Uint8Array) || value.length < 16 || value.length > 64) {
        throw new OnvifError("InvalidConfiguration", "Nonce source must return 16 to 64 fresh octets");
    }
    return Buffer.from(value);
}

export function createUsernameToken(input: UsernameTokenInput): string {
    const { offsetMs } = validateUsernameTokenPolicy({
        ...(input.offsetMs === undefined ? {} : { offsetMs: input.offsetMs }),
        ...(input.maxOffsetMs === undefined ? {} : { maxOffsetMs: input.maxOffsetMs })
    });
    const now = (input.clock ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new OnvifError("InvalidConfiguration", "Clock did not provide a valid instant");
    }
    const adjusted = new Date(now.getTime() + offsetMs);
    if (!Number.isFinite(adjusted.getTime())) throw new OnvifError("InvalidConfiguration", "Clock offset overflow");
    const created = adjusted.toISOString();
    const nonce = validatedNonce(input.nonce);
    const digest = createHash("sha1").update(nonce).update(created, "utf8").update(input.password, "utf8").digest("base64");
    const text = (namespace: string, prefix: string, localName: string, value: string): XmlElement => ({
        kind: "element", name: { namespace, localName }, prefix, namespaces: {}, attributes: [],
        children: [{ kind: "text", value }]
    });
    const password = text(WSSE_NS, "wsse", "Password", digest);
    password.attributes.push({ name: { namespace: "", localName: "Type" }, value: `${TOKEN_PROFILE}#PasswordDigest` });
    const nonceElement = text(WSSE_NS, "wsse", "Nonce", nonce.toString("base64"));
    nonceElement.attributes.push({ name: { namespace: "", localName: "EncodingType" }, value: `${MESSAGE_PROFILE}#Base64Binary` });
    const token: XmlElement = {
        kind: "element", name: { namespace: WSSE_NS, localName: "UsernameToken" }, prefix: "wsse",
        namespaces: {}, attributes: [],
        children: [text(WSSE_NS, "wsse", "Username", input.username), password, nonceElement, text(WSU_NS, "wsu", "Created", created)]
    };
    return serializeXml({
        kind: "element", name: { namespace: WSSE_NS, localName: "Security" }, prefix: "wsse",
        namespaces: { wsse: WSSE_NS, wsu: WSU_NS }, attributes: [], children: [token]
    });
}
