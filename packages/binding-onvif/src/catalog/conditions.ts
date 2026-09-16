import { isRecord } from "../binding/errors.js";
import type { JsonValue, Observation } from "./snapshot.js";
import { canonicalJson } from "./sources.js";

export type Truth = "true" | "false" | "unknown";
export type Condition = { readonly all: readonly Condition[] }
    | { readonly any: readonly Condition[] }
    | { readonly not: Condition }
    | { readonly fact: string; readonly equals: JsonValue }
    | { readonly atLeast: number; readonly of: readonly Condition[] }
    | { readonly constant: boolean }
    | { readonly unresolved: JsonValue; readonly reason: string };

export interface ConditionDiagnostic {
    readonly code: "unknown-fact" | "fact-type-mismatch" | "unresolved-condition";
    readonly fact?: string;
    readonly message: string;
}

export interface ConditionResult {
    readonly value: Truth;
    readonly facts: readonly string[];
    readonly diagnostics: readonly ConditionDiagnostic[];
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
    if (depth > 64) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 20000 && Object.keys(value).length === value.length
        && value.every((item: unknown) => isJsonValue(item, depth + 1));
    return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
        && Object.keys(value).length <= 20000
        && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function condition(value: JsonValue, depth = 0): Condition {
    const unresolved = (reason: string): Condition => ({ unresolved: value, reason });
    if (depth > 64) return unresolved("Condition nesting exceeds the supported bound.");
    if (!isRecord(value)) return unresolved("An explicit typed condition expression is required.");
    const keys = Object.keys(value);
    for (const operator of ["all", "any"] as const) {
        const terms = value[operator];
        if (keys.length === 1 && Array.isArray(terms) && terms.length > 0) {
            const parsed = terms.map((term: JsonValue) => condition(term, depth + 1));
            return operator === "all" ? { all: parsed } : { any: parsed };
        }
    }
    if (keys.length === 1 && Object.hasOwn(value, "not") && isJsonValue(value.not)) return { not: condition(value.not, depth + 1) };
    if (keys.length === 1 && typeof value.constant === "boolean") return { constant: value.constant };
    if (typeof value.fact === "string" && value.fact
        && keys.every((key) => key === "fact" || key === "equals")
        && (value.equals === undefined || isJsonValue(value.equals))) {
        return { fact: value.fact, equals: value.equals === undefined ? true : value.equals };
    }
    if (keys.length === 2 && Number.isSafeInteger(value.atLeast) && typeof value.atLeast === "number"
        && Array.isArray(value.of) && value.atLeast >= 1 && value.atLeast <= value.of.length) {
        return { atLeast: value.atLeast, of: value.of.map((term: JsonValue) => condition(term, depth + 1)) };
    }
    return unresolved("Condition operator, operands, or annotations have no declared evaluator; no false default is inferred.");
}

function valueKind(value: JsonValue): string {
    return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

export function evaluateCondition(
    expression: Condition | null, facts: Readonly<Record<string, Observation<JsonValue>>>
): ConditionResult {
    if (expression === null) return { value: "true", facts: [], diagnostics: [] };
    if ("constant" in expression) return { value: expression.constant ? "true" : "false", facts: [], diagnostics: [] };
    if ("unresolved" in expression) return { value: "unknown", facts: [],
        diagnostics: [{ code: "unresolved-condition", message: expression.reason }] };
    if ("fact" in expression) {
        const observation = Object.hasOwn(facts, expression.fact) ? facts[expression.fact] : undefined;
        if (observation === undefined || observation.state !== "known" || observation.evidence.length === 0) {
            return { value: "unknown", facts: [expression.fact], diagnostics: [{ code: "unknown-fact", fact: expression.fact,
                message: `Fact ${expression.fact} has no known, evidenced value (${observation?.state ?? "unobserved"}).` }] };
        }
        if (valueKind(observation.value) !== valueKind(expression.equals)) {
            return { value: "unknown", facts: [expression.fact], diagnostics: [{ code: "fact-type-mismatch", fact: expression.fact,
                message: `Fact ${expression.fact} is ${valueKind(observation.value)}, not ${valueKind(expression.equals)}; coercion is forbidden.` }] };
        }
        return { value: canonicalJson(observation.value) === canonicalJson(expression.equals) ? "true" : "false",
            facts: [expression.fact], diagnostics: [] };
    }
    if ("not" in expression) {
        const result = evaluateCondition(expression.not, facts);
        return { ...result, value: result.value === "unknown" ? "unknown" : result.value === "true" ? "false" : "true" };
    }
    const terms = "all" in expression ? expression.all : "any" in expression ? expression.any : expression.of;
    const results = terms.map((term) => evaluateCondition(term, facts));
    const positive = results.filter((result) => result.value === "true").length;
    const unknown = results.filter((result) => result.value === "unknown").length;
    const threshold = "all" in expression ? terms.length : "any" in expression ? 1 : expression.atLeast;
    return { value: positive >= threshold ? "true" : positive + unknown < threshold ? "false" : "unknown",
        facts: [...new Set(results.flatMap((result) => result.facts))].sort(),
        diagnostics: results.flatMap((result) => result.diagnostics) };
}
