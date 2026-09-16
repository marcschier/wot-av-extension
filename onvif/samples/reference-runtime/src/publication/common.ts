import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord } from "../binding/errors.js";
import { canonicalJson, digest } from "../catalog/sources.js";
import { assertJson } from "../discovery/policy.js";

export const DISCOVERY_CONTEXT = "https://www.w3.org/2022/wot/discovery";
type ContextEntry = Exclude<ThingDescription["@context"], string>[number];

export function contextEntries(td: ThingDescription): ContextEntry[] {
    return typeof td["@context"] === "string" ? [td["@context"]] : [...td["@context"]];
}

export function contextValue(entries: readonly ContextEntry[]): ThingDescription["@context"] {
    const [first, ...rest] = entries;
    if (first === "https://www.w3.org/2022/wot/td/v1.1") return [first, ...rest];
    if (first === "https://www.w3.org/2019/wot/td/v1") return [first, ...rest];
    throw new PublicationError("InvalidDirectoryResponse", "TD context must begin with a supported WoT Recommendation context");
}

export class PublicationError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status?: number,
        readonly retryable = false
    ) {
        super(message);
        this.name = "PublicationError";
    }
}

export function boundedInteger(value: number, name: string, maximum = 2147483647): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new PublicationError("InvalidConfiguration", `${name} must be a positive bounded integer`);
    }
    return value;
}

export function httpUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); }
    catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new PublicationError("InvalidConfiguration", "An absolute HTTP(S) publication URL is required");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || /[\s\u0000-\u0020\u007f\\#]/u.test(value)) {
        throw new PublicationError("PolicyDenied", "Publication URLs cannot contain credentials, fragments or whitespace");
    }
    return url;
}

export function assertThingDescription(value: unknown): asserts value is ThingDescription {
    assertJson(value, 1000000, 96, 64 * 1024 * 1024);
    if (!isRecord(value) || typeof value.id !== "string" || !value.id
        || typeof value.title !== "string" || value["@context"] === undefined
        || !isRecord(value.securityDefinitions)
        || !(typeof value.security === "string" || Array.isArray(value.security))) {
        throw new PublicationError("InvalidDirectoryResponse", "A complete identified TD, not a query fragment, is required");
    }
    try { new URL(value.id); }
    catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new PublicationError("InvalidDirectoryResponse", "TD identifiers must be absolute URIs");
    }
    const invalid: () => never = () => { throw new PublicationError("InvalidDirectoryResponse", "Malformed TD context, security or interaction affordance"); };
    const contexts: unknown[] = Array.isArray(value["@context"]) ? value["@context"] : [value["@context"]];
    if (!contexts.length || contexts.some((entry) => !(typeof entry === "string" && entry.length > 0) && !isRecord(entry))) invalid();
    contextValue(contexts as ContextEntry[]);
    const definitions = value.securityDefinitions;
    const security = (references: unknown): void => {
        const names = Array.isArray(references) ? references : [references];
        if (!names.length || names.some((name) => typeof name !== "string" || !name || !Object.hasOwn(definitions, name))) invalid();
    };
    for (const definition of Object.values(definitions)) {
        if (!isRecord(definition) || typeof definition.scheme !== "string" || !definition.scheme) invalid();
        if (definition.allOf !== undefined) security(definition.allOf);
        if (definition.oneOf !== undefined) security(definition.oneOf);
    }
    security(value.security);
    const forms = (entries: unknown): void => {
        if (!Array.isArray(entries) || !entries.length) invalid();
        for (const form of entries) {
            if (!isRecord(form) || typeof form.href !== "string" || !form.href) invalid();
            if (form.security !== undefined) security(form.security);
            if (form.op !== undefined) {
                const operations = Array.isArray(form.op) ? form.op : [form.op];
                if (!operations.length || operations.some((op) => typeof op !== "string" || !op)) invalid();
            }
        }
    };
    const schema = (entry: unknown): void => {
        if (!isRecord(entry)) invalid();
        if (entry.properties !== undefined) {
            if (!isRecord(entry.properties)) invalid();
            for (const property of Object.values(entry.properties)) schema(property);
        }
        if (entry.items !== undefined) {
            for (const item of Array.isArray(entry.items) ? entry.items : [entry.items]) schema(item);
        }
    };
    if (value.forms !== undefined) forms(value.forms);
    for (const kind of ["properties", "actions", "events"]) {
        const affordances = value[kind];
        if (affordances === undefined) continue;
        if (!isRecord(affordances)) invalid();
        for (const affordance of Object.values(affordances)) {
            if (!isRecord(affordance)) invalid();
            if (affordance.forms !== undefined) forms(affordance.forms);
            if (kind === "properties") schema(affordance);
            for (const key of ["input", "output", "data", "subscription", "cancellation", "dataResponse"]) {
                if (affordance[key] !== undefined) schema(affordance[key]);
            }
        }
    }
}

export function producerContent(td: ThingDescription): ThingDescription {
    const copy = structuredClone(td);
    delete copy.registration;
    if (Array.isArray(copy["@context"])) {
        copy["@context"] = contextValue(copy["@context"].filter((entry) => entry !== DISCOVERY_CONTEXT));
    }
    return copy;
}

export function producerDigest(td: ThingDescription): string { return digest(producerContent(td)); }

export function matchesProducer(actual: ThingDescription, expected: ThingDescription): boolean {
    const received = producerContent(actual), wanted = producerContent(expected);
    received["@context"] = contextValue(contextEntries(received));
    wanted["@context"] = contextValue(contextEntries(wanted));
    return canonicalJson(received) === canonicalJson(wanted);
}

export function mergeProducer(
    remote: ThingDescription | null, previous: ThingDescription | undefined, desired: ThingDescription
): ThingDescription {
    const merged = remote === null ? structuredClone(desired) : structuredClone(remote);
    for (const key of Object.keys(previous ?? {})) {
        if (!Object.hasOwn(desired, key)) delete merged[key];
    }
    const contexts = Array.isArray(remote?.["@context"]) ? remote["@context"] : [];
    Object.assign(merged, structuredClone(desired));
    if (Array.isArray(desired["@context"])) {
        const owned = Array.isArray(previous?.["@context"]) ? previous["@context"] : [];
        const desiredContexts = desired["@context"];
        const extra = contexts.filter((entry) => entry !== DISCOVERY_CONTEXT
            && !owned.some((item) => canonicalJson(item) === canonicalJson(entry))
            && !desiredContexts.some((item) => canonicalJson(item) === canonicalJson(entry)));
        merged["@context"] = contextValue([...desiredContexts, ...extra]);
    }
    delete merged.registration;
    return merged;
}

export function errorCode(error: unknown): string {
    return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "PublicationFailure";
}

export function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function assertOwner(value: string): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
        throw new PublicationError("InvalidConfiguration", "A bounded explicit publication owner is required");
    }
}
