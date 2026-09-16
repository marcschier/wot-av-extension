import { isRecord, OnvifError } from "../binding/errors.js";
import type { Schema } from "./schemas.js";

function failure(message: string): never { throw new OnvifError("InvalidRegistry", message); }

export function modelIndex(models: Iterable<Schema>): ReadonlyMap<string, Schema> {
    const result = new Map<string, Schema>();
    for (const model of models) {
        if (typeof model.id !== "string" || !model.id || result.has(model.id)) failure("Missing or duplicate model ID");
        result.set(model.id, model);
    }
    return result;
}

function lookup(reference: string, models: ReadonlyMap<string, Schema>): unknown {
    const hash = reference.indexOf("#"), id = hash < 0 ? reference : reference.slice(0, hash);
    let current: unknown = models.get(id);
    if (current === undefined) failure(`Model import is absent from the offline bundle: ${id}`);
    if (hash < 0 || hash === reference.length - 1) return current;
    const pointer = reference.slice(hash + 1);
    if (!pointer.startsWith("/")) failure("Only JSON Pointer model fragments are supported");
    for (const encoded of pointer.slice(1).split("/")) {
        if (/~(?![01])/u.test(encoded)) failure("Malformed JSON Pointer model fragment");
        const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
        if (!isRecord(current) || !Object.hasOwn(current, key)) failure(`Unresolved model pointer: ${reference}`);
        current = current[key];
    }
    return current;
}

export function assertModelImports(models: ReadonlyMap<string, Schema>): void {
    const walk = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!isRecord(value)) return;
        if (value["tm:ref"] !== undefined) {
            if (typeof value["tm:ref"] !== "string") failure("tm:ref must be an IRI");
            lookup(value["tm:ref"], models);
        }
        if (value["@type"] === "tm:ThingModel") {
            const bases = Array.isArray(value.links) ? value.links.filter((link: unknown) => isRecord(link) && link.rel === "tm:extends") : [];
            if (bases.length > 1) failure("Generated TMs have exactly one immediate base at most");
            for (const link of bases) {
                if (!isRecord(link) || typeof link.href !== "string") failure("Invalid tm:extends link");
                lookup(link.href, models);
            }
        }
        Object.values(value).forEach(walk);
    };
    for (const value of models.values()) walk(value);
}

export function resolveModel(id: string, models: ReadonlyMap<string, Schema>): Schema {
    const pending = new Set<string>();
    const resolveReference = (reference: string): Schema => {
        if (pending.has(reference) || pending.size > 64) failure("Cyclic or excessive model import graph");
        const source = lookup(reference, models);
        if (!isRecord(source)) failure("A model import must address a JSON object");
        pending.add(reference);
        try { return expand(source); } finally { pending.delete(reference); }
    };
    const expandValue = (value: unknown): unknown => Array.isArray(value) ? value.map(expandValue)
        : isRecord(value) ? expand(value) : value;
    const expand = (source: Schema): Schema => {
        let result: Schema = {};
        const bases = Array.isArray(source.links) ? source.links.filter((link: unknown) => isRecord(link) && link.rel === "tm:extends") : [];
        if (bases.length > 1) failure("Multiple immediate base models are not generated");
        for (const base of bases) {
            if (!isRecord(base) || typeof base.href !== "string") failure("Invalid base model");
            result = resolveReference(base.href);
        }
        if (source["tm:ref"] !== undefined) {
            if (typeof source["tm:ref"] !== "string") failure("Invalid model reference");
            result = { ...result, ...resolveReference(source["tm:ref"]) };
        }
        for (const [key, value] of Object.entries(source)) {
            if (key === "tm:ref") continue;
            const expanded = expandValue(value);
            if (["actions", "properties", "events"].includes(key) && isRecord(result[key]) && isRecord(expanded)) {
                result[key] = { ...result[key], ...expanded };
            } else result[key] = expanded;
        }
        if (Array.isArray(result.links)) result.links = result.links.filter((link: unknown) => !isRecord(link) || link.rel !== "tm:extends");
        return result;
    };
    return resolveReference(id);
}
