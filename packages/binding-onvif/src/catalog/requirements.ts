import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, OnvifError } from "../binding/errors.js";
import { isQName, type QName } from "../xml/types.js";
import { condition, isJsonValue, type Condition } from "./conditions.js";
import type { CanonicalCatalog } from "./compiler.js";
import type { JsonValue } from "./snapshot.js";
import { digest, qkey } from "./sources.js";

export type RequirementRole = "device" | "client";
export type RequirementLevel = "mandatory" | "conditional" | "optional";
export type RequirementClassification = "protocol" | "schema" | "capability" | "behavior" | "process" | "notRepresentableTd";

export interface RequirementSource {
    readonly sourceId: string;
    readonly pdfPage: number;
    readonly printedPage: string | number | null;
    readonly clause: string;
    readonly table?: string;
    readonly row?: string;
}

export interface NativeRequirementReference {
    readonly serviceNamespace: string;
    readonly portType?: string;
    readonly operation?: string;
    readonly typeQName?: QName;
    readonly topic?: string;
}

export interface RequirementAtom {
    readonly id: string;
    readonly profile: string;
    readonly edition: string;
    readonly role: RequirementRole;
    readonly source: RequirementSource;
    readonly requirementLevel: RequirementLevel;
    readonly feature: string;
    readonly condition: Condition | null;
    readonly classification: RequirementClassification;
    readonly native: readonly NativeRequirementReference[];
    readonly mapping: { readonly kind: string; readonly reason?: string };
    readonly evidenceTargets: readonly string[];
    readonly editorialDecisionIds: readonly string[];
    readonly obligationGroupId?: string;
    readonly raw: Readonly<Record<string, JsonValue>>;
}

export interface RequirementResolution {
    readonly requirementId: string;
    readonly operationIds: readonly string[];
    readonly typeIds: readonly string[];
    readonly topics: readonly string[];
    readonly disposition: "mapped" | "native-unresolved" | "behavioral-or-process" | "schema-or-capability";
    readonly runtimeGate: "not-established-by-a-model";
    readonly rationale: string;
}

export interface LedgerDiagnostic {
    readonly severity: "error" | "warning";
    readonly code: string;
    readonly requirementId?: string;
    readonly message: string;
}

export interface RequirementIndex {
    readonly formatVersion: 1;
    readonly digest: string;
    readonly files: readonly { readonly path: string; readonly digest: string; readonly coverage: JsonValue }[];
    readonly profileEditions: readonly Readonly<Record<string, JsonValue>>[];
    readonly requirements: readonly RequirementAtom[];
    readonly resolutions: readonly RequirementResolution[];
    readonly obligationGroups: readonly Readonly<Record<string, JsonValue>>[];
    readonly conditionFacts: Readonly<Record<string, readonly JsonValue[]>>;
    readonly editorialDecisions: readonly Readonly<Record<string, JsonValue>>[];
    readonly diagnostics: readonly LedgerDiagnostic[];
}

function invalid(message: string): never { throw new OnvifError("InvalidRegistry", message); }
function nonempty(value: unknown, description: string): string {
    if (typeof value !== "string" || !value) invalid(`${description} must be a nonempty string`);
    return value;
}
function strings(value: unknown, description: string, allowEmpty = true): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) invalid(`${description} must be an array`);
    return value.map((entry: unknown) => nonempty(entry, description));
}
function record(value: unknown, description: string): Record<string, JsonValue> {
    if (!isRecord(value) || !isJsonValue(value)) invalid(`${description} must be a finite JSON object`);
    return value;
}

function nativeQName(value: unknown, description: string): QName {
    if (isQName(value)) return value;
    if (typeof value === "string") {
        const match = /^\{([^}]*)\}(.+)$/u.exec(value);
        const name = match === null ? undefined : { namespace: match[1], localName: match[2] };
        if (isQName(name)) return name;
    }
    return invalid(`${description} must be an expanded QName, not an unresolved lexical prefix`);
}

export function parseRequirement(input: unknown): RequirementAtom {
    const value = record(input, "Requirement row"), id = nonempty(value.id, "Requirement ID");
    const role = value.role === "device" || value.role === "client" ? value.role : invalid(`${id}: invalid role`);
    const level = (["mandatory", "conditional", "optional"] as const).find((entry) => entry === value.requirementLevel);
    const classification = (["protocol", "schema", "capability", "behavior", "process", "notRepresentableTd"] as const)
        .find((entry) => entry === value.classification);
    if (level === undefined || classification === undefined) invalid(`${id}: unknown requirement level/classification`);
    const source = record(value.source, `${id} source`);
    if (typeof source.pdfPage !== "number" || !Number.isSafeInteger(source.pdfPage) || source.pdfPage < 1
        || (source.printedPage !== null && typeof source.printedPage !== "string" && typeof source.printedPage !== "number")) {
        invalid(`${id}: physical and printed page locators must be explicit`);
    }
    const mapping = record(value.mapping, `${id} mapping`);
    const references = value.native;
    if (!Array.isArray(references)) invalid(`${id}: native references must be an array`);
    const native = references.map((entry: unknown): NativeRequirementReference => {
        const ref = record(entry, `${id} native reference`);
        const topic = ref.topic === undefined ? undefined : nonempty(ref.topic, `${id} topic`);
        const expandedTopic = topic !== undefined && !topic.startsWith("{") && typeof ref.topicNamespace === "string"
            ? `{${nonempty(ref.topicNamespace, `${id} explicit topic namespace`)}}${topic}` : topic;
        return { serviceNamespace: nonempty(ref.serviceNamespace, `${id} service namespace`),
            ...(ref.portType === undefined ? {} : { portType: nonempty(ref.portType, `${id} portType`) }),
            ...(ref.operation === undefined ? {} : { operation: nonempty(ref.operation, `${id} operation`) }),
            ...(ref.typeQName === undefined ? {} : { typeQName: nativeQName(ref.typeQName, `${id} native type`) }),
            ...(expandedTopic === undefined ? {} : { topic: expandedTopic }) };
    });
    if (value.condition === undefined) invalid(`${id}: missing explicit condition (use null when unconditional)`);
    const membership = value.obligationGroup === undefined ? undefined : record(value.obligationGroup, `${id} obligation group`);
    const groupId = value.obligationGroupId ?? membership?.id
        ?? (Array.isArray(membership?.alternatives) ? `group-${id}` : undefined);
    return { id, profile: nonempty(value.profile, `${id} profile`), edition: nonempty(value.edition, `${id} edition`),
        role, source: { sourceId: nonempty(source.sourceId, `${id} sourceId`), pdfPage: source.pdfPage,
            printedPage: source.printedPage, clause: nonempty(source.clause, `${id} clause`),
            ...(source.table === undefined ? {} : { table: nonempty(source.table, `${id} table`) }),
            ...(source.row === undefined ? {} : { row: nonempty(source.row, `${id} row`) }) },
        requirementLevel: level, feature: nonempty(value.feature, `${id} feature`),
        condition: value.condition === null ? null : condition(value.condition),
        classification, native,
        mapping: { kind: nonempty(mapping.kind, `${id} mapping kind`),
            ...(mapping.reason === undefined ? {} : { reason: nonempty(mapping.reason, `${id} mapping reason`) }) },
        evidenceTargets: strings(value.evidenceTargets, `${id} evidence targets`, false),
        editorialDecisionIds: strings(value.editorialDecisionIds, `${id} editorial decisions`),
        ...(groupId === undefined ? {} : { obligationGroupId: nonempty(groupId, `${id} obligation group`) }),
        raw: value };
}

export function resolveRequirements(requirements: readonly RequirementAtom[], catalog: CanonicalCatalog): {
    resolutions: RequirementResolution[]; diagnostics: LedgerDiagnostic[];
} {
    const diagnostics: LedgerDiagnostic[] = [], resolutions: RequirementResolution[] = [];
    const ids = new Set<string>();
    for (const requirement of requirements) {
        if (ids.has(requirement.id)) invalid(`Duplicate requirement ${requirement.id}`);
        ids.add(requirement.id);
        const operations = new Set<string>(), types = new Set<string>(), topics = new Set<string>();
        let unresolved = false;
        const fail = (code: string, message: string): void => {
            unresolved = true;
            diagnostics.push({ severity: "error", code, requirementId: requirement.id, message });
        };
        for (const reference of requirement.native) {
            if (reference.operation !== undefined) {
                const matches = catalog.operations.filter((operation) =>
                    (operation.serviceNamespace === reference.serviceNamespace || operation.portTypeQName.namespace === reference.serviceNamespace)
                    && operation.operation === reference.operation && (reference.portType === undefined
                        || operation.portTypeQName.localName === reference.portType || qkey(operation.portTypeQName) === reference.portType));
                if (matches.length === 0) fail("unresolved-native-operation",
                    `No locked operation matches ${reference.serviceNamespace} / ${reference.portType ?? "(unspecified portType)"} / ${reference.operation}.`);
                else {
                    for (const operation of matches) operations.add(operation.id);
                    if (new Set(matches.map((operation) => qkey(operation.portTypeQName))).size > 1) {
                        fail("ambiguous-native-portType", `Multiple qualified portTypes match ${reference.operation}; the source reference must retain that alternative explicitly.`);
                    }
                }
            }
            if (reference.typeQName !== undefined) {
                const id = qkey(reference.typeQName);
                if (Object.hasOwn(catalog.xml.types, id)) types.add(id);
                else if (Object.hasOwn(catalog.xml.elements, id)) types.add(`element:${id}`);
                else fail("unresolved-native-type", `No locked native type/element matches ${id}.`);
            }
            if (reference.topic !== undefined) {
                if (!/^\{[^}]+\}[^/]+(?:\/[^/]+)*$/u.test(reference.topic)) fail("unresolved-topic-namespace", `Topic is not an expanded namespace/path: ${reference.topic}`);
                topics.add(reference.topic);
            }
        }
        const nonAffordance = ["behavior", "process", "notRepresentableTd"].includes(requirement.classification);
        if (nonAffordance && requirement.mapping.reason === undefined) fail("missing-non-td-rationale",
            "A behavior/process/non-TD requirement needs a per-clause rationale; a coverage counter is not a disposition.");
        if (requirement.condition !== null && "unresolved" in requirement.condition) diagnostics.push({
            severity: "warning", code: "unresolved-condition", requirementId: requirement.id, message: requirement.condition.reason
        });
        resolutions.push({ requirementId: requirement.id, operationIds: [...operations].sort(), typeIds: [...types].sort(), topics: [...topics].sort(),
            disposition: unresolved ? "native-unresolved" : nonAffordance ? "behavioral-or-process"
                : operations.size ? "mapped" : "schema-or-capability",
            runtimeGate: "not-established-by-a-model",
            rationale: requirement.mapping.reason ?? "The cited native contract is retained as a model reference; runtime and role-specific behavioral evidence remain separate." });
    }
    return { resolutions, diagnostics };
}

function readJson(path: string): Record<string, JsonValue> {
    const bytes = readFileSync(path);
    if (bytes.length > 32 * 1024 * 1024) invalid("Requirement input exceeds 32 MiB");
    return record(JSON.parse(bytes.toString("utf8")), path);
}

function normalizeGroup(group: Record<string, JsonValue>): Record<string, JsonValue> {
    const threshold = group.atLeast ?? group.atLeastN;
    const branches = group.branches ?? group.alternatives;
    if (!Array.isArray(branches)) return { ...group, raw: group };
    return { ...group, operator: "atLeastN", atLeast: threshold ?? null, branches: branches.map((entry) => {
        const branch = record(entry, "Obligation branch");
        return { ...branch, ...(branch.requirementIds !== undefined || branch.allRequirementIds !== undefined
            ? { requirementIds: branch.requirementIds ?? branch.allRequirementIds ?? [] } : {}) };
    }), raw: group };
}

export function loadRequirementIndex(root: string, catalog: CanonicalCatalog): RequirementIndex {
    const base = join(root, "bindings", "onvif", "catalog");
    const profiles = readJson(join(base, "profile-editions.json"));
    if (!Array.isArray(profiles.profiles)) invalid("Profile edition catalog has no profiles");
    const profileEditions = profiles.profiles.map((entry) => record(entry, "Profile edition"));
    const editorials = readJson(join(base, "editorial-decisions.json"));
    const editorialRows = editorials.decisions ?? editorials.editorialDecisions;
    if (!Array.isArray(editorialRows)) invalid("Editorial decision register has no decision array");
    const editorialDecisions = editorialRows.map((entry) => record(entry, "Editorial decision"));
    const requirements: RequirementAtom[] = [], obligationGroups: Record<string, JsonValue>[] = [];
    const conditionFacts: Record<string, JsonValue[]> = Object.create(null);
    const files = ["requirements-st.json", "requirements-gm.json", "requirements-acd.json"].map((name) => {
        const value = readJson(join(base, name));
        if (!Array.isArray(value.requirements) || value.requirements.length === 0) invalid(`${name}: no authored requirement rows`);
        requirements.push(...value.requirements.map(parseRequirement));
        if (value.obligationGroups !== undefined) {
            if (!Array.isArray(value.obligationGroups)) invalid(`${name}: obligationGroups must be an array`);
            obligationGroups.push(...value.obligationGroups.map((entry) => normalizeGroup(record(entry, `${name} obligation group`))));
        }
        if (value.conditionFacts !== undefined) {
            for (const [id, fact] of Object.entries(record(value.conditionFacts, `${name} condition facts`))) {
                (conditionFacts[id] ??= []).push(fact);
            }
            const definitions = value.factDefinitions;
            const coverage = isRecord(value.coverage) ? value.coverage : undefined;
            const factLists = [definitions, coverage?.facts];
            for (const list of factLists) {
                if (list === undefined) continue;
                if (!Array.isArray(list)) invalid(`${name}: fact definitions must be a list`);
                for (const entry of list) {
                    const fact = record(entry, `${name} fact definition`);
                    const id = nonempty(fact.fact ?? fact.id, `${name} fact ID`);
                    (conditionFacts[id] ??= []).push(fact);
                }
            }
        }
        return { path: `bindings/onvif/catalog/${name}`, digest: digest(value), coverage: value.coverage ?? null };
    });
    requirements.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const row of requirements) {
        const group = row.raw.obligationGroup;
        if (isRecord(group) && Array.isArray(group.alternatives) && row.obligationGroupId !== undefined) {
            obligationGroups.push(normalizeGroup({ ...group, id: row.obligationGroupId,
                profile: row.profile, edition: row.edition, role: row.role, source: row.raw.source ?? null,
                condition: row.raw.condition ?? null, ownerRequirementId: row.id }));
        }
    }
    const result = resolveRequirements(requirements, catalog);
    const editionMap = new Map(profileEditions.map((edition) => [`${edition.profileId}:${edition.edition}`, edition]));
    const editorialIds = new Set(editorialDecisions.map((decision) => decision.id));
    const groupIds = new Set<string>(), requirementIds = new Set(requirements.map((row) => row.id));
    for (const group of obligationGroups) {
        const id = nonempty(group.id, "Obligation group id");
        if (groupIds.has(id)) invalid(`Duplicate obligation group ${id}`);
        groupIds.add(id);
        if (group.operator !== "atLeastN" || typeof group.atLeast !== "number" || !Number.isSafeInteger(group.atLeast)
            || !Array.isArray(group.branches) || group.atLeast < 1 || group.atLeast > group.branches.length) {
            result.diagnostics.push({ severity: "warning", code: "unresolved-obligation-group",
                message: `Group ${id} has no supported atLeastN evaluator; its member obligations must not be flattened into universal requirements.` });
        } else {
            for (const branch of group.branches) {
                const value = record(branch, `${id} branch`);
                if (value.requirementIds !== undefined) {
                    for (const member of strings(value.requirementIds, `${id} branch requirement IDs`, false)) {
                        if (!requirementIds.has(member)) invalid(`${id}: unresolved alternative member ${member}`);
                    }
                } else strings(value.evidenceTargets, `${id} branch evidence targets`, false);
            }
        }
    }
    for (const row of requirements) {
        const edition = editionMap.get(`${row.profile}:${row.edition}`);
        if (edition === undefined || edition.documentSourceId !== row.source.sourceId
            || typeof edition.pageCount !== "number" || row.source.pdfPage > edition.pageCount) {
            invalid(`${row.id}: profile edition/source/page does not match the locked edition catalog`);
        }
        for (const id of row.editorialDecisionIds) {
            if (!editorialIds.has(id)) invalid(`${row.id}: unknown editorial decision ${id}`);
        }
        if (row.obligationGroupId !== undefined && !groupIds.has(row.obligationGroupId)) invalid(`${row.id}: unresolved obligation group`);
    }
    const index = { formatVersion: 1 as const, files, profileEditions, requirements, resolutions: result.resolutions,
        obligationGroups, conditionFacts, editorialDecisions, diagnostics: result.diagnostics };
    return { ...index, digest: digest(index) };
}

export function assertRequirementIndex(value: unknown): asserts value is RequirementIndex {
    if (!isRecord(value) || value.formatVersion !== 1 || typeof value.digest !== "string"
        || !/^[a-f0-9]{64}$/u.test(value.digest) || !Array.isArray(value.requirements)
        || !Array.isArray(value.resolutions) || !Array.isArray(value.obligationGroups)
        || !Array.isArray(value.diagnostics) || !Array.isArray(value.editorialDecisions)
        || !Array.isArray(value.profileEditions) || !Array.isArray(value.files) || !isRecord(value.conditionFacts)) {
        invalid("Invalid requirement index envelope");
    }
    const { digest: expected, ...content } = value;
    if (digest(content) !== expected) invalid("Requirement index content disagrees with its digest");
    const ids = new Set<string>();
    for (const entry of value.requirements) {
        if (!isRecord(entry)) invalid("Invalid normalized requirement row");
        const parsed = parseRequirement(entry.raw);
        if (ids.has(parsed.id) || digest(parsed) !== digest(entry)) invalid("Normalized requirement disagrees with its authored row");
        ids.add(parsed.id);
    }
    const resolutions = new Set<string>();
    for (const entry of value.resolutions) {
        if (!isRecord(entry) || typeof entry.requirementId !== "string" || !ids.has(entry.requirementId)
            || resolutions.has(entry.requirementId) || !Array.isArray(entry.operationIds) || !Array.isArray(entry.typeIds)
            || !Array.isArray(entry.topics) || typeof entry.rationale !== "string") invalid("Invalid requirement disposition");
        resolutions.add(entry.requirementId);
    }
    if (resolutions.size !== ids.size) invalid("Some requirements have no disposition");
}
