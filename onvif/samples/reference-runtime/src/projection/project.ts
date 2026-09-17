import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "../binding/errors.js";
import { operationReference } from "../binding/registry.js";
import { encodeElement } from "../xml/mapper.js";
import { assertXmlElement } from "../xml/parser.js";
import type { CanonicalCatalog, CompiledOperation } from "../catalog/compiler.js";
import { condition, evaluateCondition, isJsonValue, type ConditionResult, type Truth } from "../catalog/conditions.js";
import { resourceKinds, safeReadAliases, type SafeReadAlias } from "../catalog/mappings.js";
import {
    abstractModelId, ABSTRACT_OPERATION_MODEL, actionTemplate, clientManifestId, context, DEVICE_MODEL, model, MODEL_EDITION, OPERATION_MODEL,
    profileModelId, RESOURCE_MODEL, resourceModelId
} from "../catalog/models.js";
import type { RequirementAtom, RequirementIndex } from "../catalog/requirements.js";
import { ONVIF_BASE, type Schema } from "../catalog/schemas.js";
import type {
    DeviceSnapshot, JsonValue, Observation, ProfileClaim, ResourceSnapshot, ServiceSnapshot, SnapshotOperation
} from "../catalog/snapshot.js";
import { canonicalJson, digest, qkey } from "../catalog/sources.js";

export interface ProjectionCatalog {
    readonly registry: CanonicalCatalog;
    readonly requirements: RequirementIndex;
}

export interface ProjectionPolicy {
    readonly securityDefinitions: NonNullable<ThingDescription["securityDefinitions"]>;
    readonly security: readonly string[];
    readonly serviceSecurity?: readonly { readonly namespace: string; readonly xaddr?: string; readonly security: readonly string[] }[];
    readonly includeSafeReadAliases?: boolean;
    readonly includeAddOns?: boolean;
}

export interface ProjectionDiagnostic {
    readonly code: string;
    readonly severity: "info" | "warning" | "error";
    readonly message: string;
    readonly serviceNamespace?: string;
    readonly operationId?: string;
    readonly requirementId?: string;
    readonly resourceId?: string;
}

export interface RequirementAssessment {
    readonly requirementId: string;
    readonly profile: string;
    readonly edition: string;
    readonly role: "device" | "client";
    readonly applicability: Truth;
    readonly condition: ConditionResult;
    readonly requirementLevel: string;
    readonly source: RequirementAtom["source"];
    readonly representation: string;
    readonly rationale: string;
    readonly observedOperationIds: readonly string[];
    readonly runtimeEvidence: "not-established-by-projection";
    readonly obligationGroupId?: string;
    readonly unresolvedEditorialDecisionIds: readonly string[];
    readonly interpretation?: RequirementAtom["interpretation"];
}

export interface ProjectionSet {
    readonly formatVersion: 1;
    readonly registryDigest: string;
    readonly requirementsDigest: string;
    readonly projectionDigest: string;
    readonly models: readonly Schema[];
    readonly tds: readonly ThingDescription[];
    readonly clientManifests: readonly Schema[];
    readonly assessments: readonly RequirementAssessment[];
    readonly diagnostics: readonly ProjectionDiagnostic[];
}

function invalid(message: string): never { throw new OnvifError("InvalidValue", `DeviceSnapshot: ${message}`); }
function keys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid(`invalid ${label} fields`);
    return value;
}
function text(value: unknown, label: string, max = 4096): asserts value is string {
    if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f]/u.test(value)) invalid(`invalid ${label}`);
}
function list(value: unknown, label: string, max: number): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > max) invalid(`invalid/bounded ${label} array`);
}
function evidence(value: unknown): void {
    list(value, "evidence", 128);
    for (const item of value) {
        const entry = keys(item, ["sourceId", "observedAt", "operation", "detail"], "evidence");
        text(entry.sourceId, "evidence sourceId");
        if (entry.observedAt !== undefined) text(entry.observedAt, "evidence observedAt", 128);
        if (entry.detail !== undefined) text(entry.detail, "evidence detail", 16384);
        if (entry.operation !== undefined) operationReference(entry.operation);
    }
}
function observation(value: unknown): asserts value is Observation<JsonValue> {
    const item = keys(value, ["state", "value", "evidence", "detail"], "observation");
    if (!["known", "unsupported", "denied", "fault", "timeout", "truncated", "unknown"].includes(String(item.state))) invalid("unknown observation state");
    evidence(item.evidence);
    if (item.state === "known") {
        if (!isJsonValue(item.value) || !Array.isArray(item.evidence) || item.evidence.length === 0) invalid("known observation needs a JSON value and evidence");
    } else if (item.value !== undefined) invalid("non-known observation must not carry a success-shaped value");
    if (item.detail !== undefined) text(item.detail, "observation detail", 16384);
}
function facts(value: unknown): void {
    if (!isRecord(value) || Object.keys(value).length > 10000) invalid("invalid/bounded facts object");
    for (const [name, item] of Object.entries(value)) { text(name, "fact name"); observation(item); }
}
function nativeReference(value: unknown, extra: readonly string[] = []): Record<string, unknown> {
    const item = keys(value, ["operation", "portType", "binding", ...extra], "operation observation");
    text(item.operation, "operation name");
    if (item.portType !== undefined) text(item.portType, "portType");
    if (item.binding !== undefined) text(item.binding, "binding");
    return item;
}
function xaddr(value: unknown): asserts value is string {
    text(value, "native XAddr", 16384);
    let url: URL;
    try { url = new URL(value); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return invalid("native XAddr must be an absolute HTTP(S) URI");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || value.includes("#")
        || /\s/u.test(value)) invalid("native XAddr must be HTTP(S), without userinfo, fragments or whitespace");
}

export function assertDeviceSnapshot(value: unknown): asserts value is DeviceSnapshot {
    if (!isJsonValue(value)) invalid("snapshot must contain finite, bounded JSON data");
    const snapshot = keys(value, ["schemaVersion", "epr", "identity", "services", "profileClaims",
        "resources", "facts", "conformanceEvidence"], "snapshot");
    if (snapshot.schemaVersion !== 1) invalid("unsupported schemaVersion");
    const endpoint = keys(snapshot.epr, ["address", "referenceProperties", "referenceParameters"], "EPR");
    text(endpoint.address, "EPR address");
    try { new URL(endpoint.address); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return invalid("EPR Address must be an absolute URI");
    }
    for (const key of ["referenceProperties", "referenceParameters"]) {
        if (endpoint[key] === undefined && key === "referenceParameters") continue;
        list(endpoint[key], key, 64);
        for (const element of endpoint[key]) assertXmlElement(element);
    }
    if (snapshot.identity !== undefined) {
        observation(snapshot.identity);
        if (snapshot.identity.state === "known") {
            const identity = keys(snapshot.identity.value, ["manufacturer", "model", "firmwareVersion", "serialNumber", "hardwareId"], "native identity");
            for (const entry of Object.values(identity)) {
                if (typeof entry !== "string" || entry.length > 4096) invalid("native identity fields must remain strings");
            }
        }
    }
    list(snapshot.services, "services", 128);
    const serviceIds = new Set<string>();
    for (const candidate of snapshot.services) {
        const service = keys(candidate, ["namespace", "xaddr", "version", "evidence", "capabilities", "readOutcomes", "supportedOperations"], "service");
        text(service.namespace, "service namespace"); xaddr(service.xaddr); evidence(service.evidence);
        if (!Array.isArray(service.evidence) || service.evidence.length === 0) invalid("an observed service needs evidence");
        const key = canonicalJson([service.namespace, service.xaddr]);
        if (serviceIds.has(key)) invalid("duplicate namespace/XAddr service observations must be reconciled before projection");
        serviceIds.add(key);
        if (service.version !== undefined) {
            const version = keys(service.version, ["major", "minor"], "service version");
            for (const part of [version.major, version.minor]) {
                if (typeof part !== "number" || !Number.isSafeInteger(part) || part < 0) invalid("service version is not a nonnegative integer pair");
            }
        }
        observation(service.capabilities);
        if (service.capabilities.state === "known" && !isRecord(service.capabilities.value)) invalid("known service capabilities must be an object");
        list(service.readOutcomes, "read outcomes", 2048);
        for (const outcome of service.readOutcomes) observation(nativeReference(outcome, ["outcome"]).outcome);
        if (service.supportedOperations !== undefined) {
            list(service.supportedOperations, "supported operations", 2048);
            for (const entry of service.supportedOperations) {
                const support = nativeReference(entry, ["support"]).support;
                observation(support);
                if (support.state === "known" && typeof support.value !== "boolean") invalid("operation support must be a typed boolean");
            }
        }
    }
    list(snapshot.profileClaims, "profile claims", 64);
    for (const entry of snapshot.profileClaims) {
        const claim = keys(entry, ["profile", "edition", "role", "evidence"], "profile claim");
        text(claim.profile, "profile");
        if (claim.edition !== undefined) text(claim.edition, "profile edition", 64);
        if (claim.role !== "device" && claim.role !== "client") invalid("claim role must be device or client");
        evidence(claim.evidence);
        if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) invalid("a profile claim needs provenance");
    }
    list(snapshot.resources, "resources", 20000);
    for (const entry of snapshot.resources) {
        const resource = keys(entry, ["serviceNamespace", "kind", "token", "parentTokens", "evidence", "facts", "operations"], "resource");
        text(resource.serviceNamespace, "resource namespace"); text(resource.kind, "resource kind", 128); text(resource.token, "resource token");
        evidence(resource.evidence);
        if (!Array.isArray(resource.evidence) || resource.evidence.length === 0) invalid("a resource needs observation evidence");
        list(resource.parentTokens, "parent tokens", 64);
        for (const token of resource.parentTokens) {
            const parent = keys(token, ["kind", "token"], "parent token");
            text(parent.kind, "parent kind", 128); text(parent.token, "parent token");
        }
        if (resource.facts !== undefined) facts(resource.facts);
        if (resource.operations !== undefined) {
            list(resource.operations, "resource operations", 2048);
            for (const operation of resource.operations) nativeReference(operation);
        }
    }
    if (snapshot.facts !== undefined) facts(snapshot.facts);
    if (snapshot.conformanceEvidence !== undefined) {
        list(snapshot.conformanceEvidence, "registered evidence", 64);
        for (const record of snapshot.conformanceEvidence) {
            const item = keys(record, ["issuer", "product", "firmware", "profile", "edition", "source"], "registered evidence");
            for (const key of ["issuer", "product", "firmware", "profile", "source"]) text(item[key], `registered ${key}`);
            if (item.edition !== undefined) text(item.edition, "registered edition", 64);
        }
    }
}

function validatePolicy(policy: ProjectionPolicy): void {
    if (!isJsonValue(policy)) invalid("projection policy must be finite JSON metadata, not credentials or executable values");
    const candidate = keys(policy, ["securityDefinitions", "security", "serviceSecurity", "includeSafeReadAliases", "includeAddOns"], "projection policy");
    if (!isRecord(candidate.securityDefinitions) || Object.keys(candidate.securityDefinitions).length === 0) invalid("explicit security definitions are required");
    for (const definition of Object.values(candidate.securityDefinitions)) {
        if (!isRecord(definition) || !["nosec", "digest", "cert", "onvif:MutualTlsSecurityScheme", "onvif:UsernameTokenSecurityScheme"].includes(String(definition.scheme))
            || Object.keys(definition).some((key) => ["password", "username", "tokenValue", "secret", "clientSecret", "privateKey"].includes(key))) {
            invalid("only explicitly configured native security metadata, never credential material, belongs in a TD");
        }
    }
    const selection = (value: unknown): void => {
        list(value, "security selection", 16);
        if (value.length === 0) invalid("security selection cannot be empty");
        for (const name of value) {
            text(name, "security definition name");
            if (!Object.hasOwn(policy.securityDefinitions, name)) invalid("selected security definition does not exist");
        }
    };
    selection(candidate.security);
    if (candidate.serviceSecurity !== undefined) {
        list(candidate.serviceSecurity, "service security overrides", 256);
        for (const entry of candidate.serviceSecurity) {
            const override = keys(entry, ["namespace", "xaddr", "security"], "service security override");
            text(override.namespace, "override namespace");
            if (override.xaddr !== undefined) xaddr(override.xaddr);
            selection(override.security);
        }
    }
    for (const name of ["includeSafeReadAliases", "includeAddOns"]) {
        if (candidate[name] !== undefined && typeof candidate[name] !== "boolean") invalid(`invalid ${name} policy flag`);
    }
}

export function deviceThingId(snapshot: DeviceSnapshot): string {
    return `urn:onvif:device:${digest([snapshot.epr.address, snapshot.epr.referenceProperties])}`;
}
export function resourceThingId(snapshot: DeviceSnapshot, resource: Pick<ResourceSnapshot, "serviceNamespace" | "kind" | "parentTokens" | "token">): string {
    return `urn:onvif:resource:${digest([snapshot.epr.address, snapshot.epr.referenceProperties,
        resource.serviceNamespace, resource.kind, resource.parentTokens, resource.token])}`;
}

function nonemptyArray<T>(values: readonly T[], label: string): [T, ...T[]] {
    const first = values[0];
    if (first === undefined) invalid(`${label} must not be empty`);
    return [first, ...values.slice(1)];
}

function selectedSecurity(service: ServiceSnapshot, policy: ProjectionPolicy): [string, ...string[]] {
    const matching = policy.serviceSecurity?.filter((entry) => entry.namespace === service.namespace
        && (entry.xaddr === undefined || entry.xaddr === service.xaddr)) ?? [];
    const exact = matching.filter((entry) => entry.xaddr !== undefined), candidates = exact.length ? exact : matching;
    if (candidates.length > 1) invalid("ambiguous security policy for an observed service");
    return nonemptyArray(candidates[0]?.security ?? policy.security, "security selection");
}

function matches(operation: CompiledOperation, namespace: string, reference: SnapshotOperation): boolean {
    return operation.serviceNamespace === namespace && operation.operation === reference.operation
        && (reference.portType === undefined || operation.portTypeQName.localName === reference.portType || qkey(operation.portTypeQName) === reference.portType)
        && (reference.binding === undefined || operation.bindingQName.localName === reference.binding || qkey(operation.bindingQName) === reference.binding);
}

type Action = NonNullable<ThingDescription["actions"]>[string];
type Actions = NonNullable<ThingDescription["actions"]>;
interface ExposedOperation { readonly operation: CompiledOperation; readonly services: ServiceSnapshot[]; readonly alias?: SafeReadAlias; }

function exposedActions(entries: ReadonlyMap<string, ExposedOperation>, catalog: CanonicalCatalog, policy: ProjectionPolicy): Actions {
    const actions: Actions = {};
    for (const [id, entry] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const template = actionTemplate(entry.operation, catalog, "{{unbound}}");
        const forms: Action["forms"] = nonemptyArray(entry.services.map<Action["forms"][number]>((service) => ({
            href: service.xaddr, op: "invokeaction", contentType: "application/soap+xml", "htv:methodName": "POST",
            "onvif:binding": "soap12-http-v1",
            "onvif:operation": { bindingQName: entry.operation.bindingQName, portTypeQName: entry.operation.portTypeQName,
                operation: entry.operation.operation },
            "onvif:soapAction": entry.operation.soapAction, security: selectedSecurity(service, policy)
        })).sort((a, b) => a.href < b.href ? -1 : a.href > b.href ? 1 : 0), "native Forms");
        actions[id] = { ...template, safe: entry.alias !== undefined, idempotent: entry.alias !== undefined, forms,
            ...(entry.alias === undefined ? {} : { "onvif:safeRead": entry.alias }) };
    }
    return actions;
}

function observedOperations(
    snapshot: DeviceSnapshot, catalog: CanonicalCatalog, policy: ProjectionPolicy, diagnostics: ProjectionDiagnostic[]
): Map<string, ExposedOperation> {
    const exposed = new Map<string, ExposedOperation>();
    for (const service of snapshot.services) {
        const definitions = catalog.services.filter((entry) => entry.namespace === service.namespace);
        if (definitions.length === 0) {
            diagnostics.push({ code: "unmapped-service", severity: "warning", serviceNamespace: service.namespace,
                message: "Observed service is outside the locked catalog; no operation is invented." });
            continue;
        }
        if (!policy.includeAddOns && definitions.every((entry) => entry.group === "conditional-add-on")) {
            diagnostics.push({ code: "add-on-policy", severity: "info", serviceNamespace: service.namespace,
                message: "Optional/add-on service remains observed but its Actions require explicit projection policy." });
            continue;
        }
        const evidenceEntries: { reference: SnapshotOperation; state: string; value?: JsonValue; read: boolean }[] = [
            ...service.readOutcomes.map((read) => ({ reference: read, state: read.outcome.state, read: true,
                ...(read.outcome.state === "known" ? { value: read.outcome.value } : {}) })),
            ...(service.supportedOperations ?? []).map((entry) => ({ reference: entry, state: entry.support.state, read: false,
                ...(entry.support.state === "known" ? { value: entry.support.value } : {}) }))
        ];
        for (const entry of evidenceEntries) {
            if (entry.state !== "known") {
                diagnostics.push({ code: `read-${entry.state}`, severity: "info", serviceNamespace: service.namespace,
                    message: `${entry.reference.operation}: ${entry.state} is retained, not converted into a false capability fact.` });
                continue;
            }
            if (!entry.read && entry.value !== true) continue;
            const candidates = catalog.operations.filter((operation) => matches(operation, service.namespace, entry.reference));
            if (candidates.length !== 1) {
                diagnostics.push({ code: candidates.length ? "ambiguous-operation" : "unmapped-operation", severity: "warning",
                    serviceNamespace: service.namespace, message: `${entry.reference.operation}: a unique qualified native operation is required.` });
                continue;
            }
            const operation = candidates[0];
            if (operation === undefined) continue;
            if (operation.mappingSupport !== "compiled" || operation.response === null) {
                diagnostics.push({ code: "unsupported-operation-schema", severity: "warning", operationId: operation.id,
                    serviceNamespace: service.namespace, message: operation.issues.map((issue) => issue.message).join("; ") });
                continue;
            }
            if (entry.read) {
                try { encodeElement(operation.response, entry.value, catalog.xml); } catch (error) {
                    if (!(error instanceof OnvifError)) throw error;
                    diagnostics.push({ code: "invalid-read-result", severity: "error", operationId: operation.id,
                        serviceNamespace: service.namespace, message: `Known read does not match its canonical source contract: ${error.message}` });
                    continue;
                }
            }
            const found = exposed.get(operation.id);
            if (found === undefined) exposed.set(operation.id, { operation, services: [service] });
            else if (!found.services.some((existing) => existing.xaddr === service.xaddr)) found.services.push(service);
        }
    }
    return exposed;
}

function addAliases(entries: Map<string, ExposedOperation>, aliases: readonly SafeReadAlias[], policy: ProjectionPolicy): void {
    if (!policy.includeSafeReadAliases) return;
    for (const alias of aliases) {
        const existing = entries.get(alias.operationId);
        if (existing !== undefined) entries.set(alias.id, { ...existing, alias });
    }
}

function claimRows(claim: ProfileClaim, index: RequirementIndex, diagnostics: ProjectionDiagnostic[]): RequirementAtom[] {
    if (claim.edition === undefined) {
        diagnostics.push({ code: "unversioned-profile-claim", severity: "info",
            message: `Profile ${claim.profile} ${claim.role} claim has no edition; scopes and service versions do not supply one.` });
        return [];
    }
    const rows = index.requirements.filter((row) => row.profile === claim.profile && row.edition === claim.edition && row.role === claim.role);
    if (rows.length === 0) diagnostics.push({ code: "unmapped-profile-edition", severity: "warning",
        message: `No released requirement contract for ${claim.profile} ${claim.edition} ${claim.role}; no retired/RC profile is silently promoted.` });
    return rows;
}

function assessments(
    rows: readonly RequirementAtom[], index: RequirementIndex, snapshot: DeviceSnapshot,
    exposed: ReadonlyMap<string, ExposedOperation>, diagnostics: ProjectionDiagnostic[]
): RequirementAssessment[] {
    const facts = snapshot.facts ?? {}, result: RequirementAssessment[] = [];
    for (const row of rows) {
        const evaluated = evaluateCondition(row.condition, facts);
        const editorial = row.editorialDecisionIds.filter((id) => index.editorialDecisions.some((decision) =>
            decision.id === id && String(decision.status).includes("unresolved")));
        const applicability = editorial.length ? "unknown" : evaluated.value;
        if (applicability === "unknown") diagnostics.push({
            code: editorial.length ? "unresolved-editorial-condition" : "unknown-requirement-condition",
            severity: "info", requirementId: row.id,
            message: editorial.length ? `Normative interpretation remains unresolved: ${editorial.join(", ")}.`
                : evaluated.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
        });
        const resolution = index.resolutions.find((entry) => entry.requirementId === row.id);
        if (resolution === undefined) throw new OnvifError("InvalidRegistry", `No disposition for ${row.id}`);
        result.push({ requirementId: row.id, profile: row.profile, edition: row.edition, role: row.role,
            applicability, condition: evaluated, requirementLevel: row.requirementLevel, source: row.source,
            representation: resolution.disposition, rationale: resolution.rationale,
            observedOperationIds: resolution.operationIds.filter((id) => exposed.has(id)),
            runtimeEvidence: "not-established-by-projection",
            ...(row.obligationGroupId === undefined ? {} : { obligationGroupId: row.obligationGroupId }),
            unresolvedEditorialDecisionIds: editorial,
            ...(row.interpretation === undefined ? {} : { interpretation: row.interpretation }) });
    }
    return result;
}

function groupAssessments(
    groups: readonly Readonly<Record<string, JsonValue>>[], index: RequirementIndex,
    snapshot: DeviceSnapshot
): Schema[] {
    const facts = snapshot.facts ?? {};
    return groups.map((group) => {
        const trigger = group.condition === null || group.condition === undefined ? null : condition(group.condition);
        const applicability = evaluateCondition(trigger, facts);
        if (group.operator !== "atLeastN" || !Array.isArray(group.branches) || typeof group.atLeast !== "number") {
            return { id: group.id, applicability: applicability.value, implementationEvidence: "unknown",
                reason: "The group interpretation is not implemented; its members are not independent universal requirements.", source: group };
        }
        const branches = group.branches.map((entry) => {
            if (!isRecord(entry)) throw new OnvifError("InvalidRegistry", "Malformed normalized obligation branch");
            const conditions = [];
            if (Array.isArray(entry.requirementIds)) {
                for (const id of entry.requirementIds) {
                    const row = index.requirements.find((candidate) => candidate.id === id);
                    if (row === undefined) throw new OnvifError("InvalidRegistry", "Dangling obligation member");
                    conditions.push({ all: [row.condition ?? { constant: true },
                        { fact: `requirement:${row.id}`, equals: true }] });
                }
            } else if (Array.isArray(entry.evidenceTargets)) {
                for (const target of entry.evidenceTargets) conditions.push({ fact: `evidence:${String(target)}`, equals: true });
            }
            const result = conditions.length ? evaluateCondition({ all: conditions }, facts)
                : { value: "unknown" as const, facts: [], diagnostics: [] };
            return { id: entry.id, implementationEvidence: result.value, diagnostics: result.diagnostics };
        });
        const passed = branches.filter((branch) => branch.implementationEvidence === "true").length;
        const unknown = branches.filter((branch) => branch.implementationEvidence === "unknown").length;
        const state = passed >= group.atLeast ? "true" : passed + unknown < group.atLeast ? "false" : "unknown";
        return { id: group.id, atLeast: group.atLeast, applicability: applicability.value,
            implementationEvidence: applicability.value === "true" ? state : "unknown", branches,
            isProfileConformanceResult: false, source: group };
    });
}

function composite(
    base: string, entries: ReadonlyMap<string, ExposedOperation>, index: RequirementIndex, catalog: CanonicalCatalog
): { native: Schema; semantic: Schema } {
    const imports = Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, entry]) => [
        id, { "tm:ref": entry.alias === undefined ? `${OPERATION_MODEL}#/actions/${entry.operation.id}`
            : `${ONVIF_BASE}/models/features/SafeReads.tm.json#/actions/${entry.alias.id}` }
    ]));
    const hash = digest({ base, imports, registryDigest: catalog.registryDigest, requirementsDigest: index.digest });
    const nativeId = `${ONVIF_BASE}/models/composites/Observed-${hash}.tm.json`, semanticId = abstractModelId(nativeId);
    const semanticImports = Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, entry]) => [
        id, { "tm:ref": entry.alias === undefined ? `${ABSTRACT_OPERATION_MODEL}#/actions/${entry.operation.id}`
            : `${abstractModelId(`${ONVIF_BASE}/models/features/SafeReads.tm.json`)}#/actions/${entry.alias.id}` }
    ]));
    return { native: { ...model(nativeId, "Observed native ONVIF interface", semanticId),
        actions: imports, "onvif:registryDigest": catalog.registryDigest, "onvif:requirementsDigest": index.digest,
        description: "One abstract composite base and imported observed native overlays. This is not a complete profile-wrapper instance or a certification statement." },
    semantic: { ...model(semanticId, "Observed canonical semantic interface", abstractModelId(base)),
        actions: semanticImports, "onvif:registryDigest": catalog.registryDigest, "onvif:requirementsDigest": index.digest,
        description: "Only the evidenced canonical operation fragments, without transport Forms, native security requirements or a full-profile claim." } };
}

function observedProjection(entries: ReadonlyMap<string, ExposedOperation>, evidence: readonly unknown[]): Schema {
    const sources = [...new Map(evidence.map((item) => [canonicalJson(item), item])).entries()]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item);
    return { category: "nativeMapping", status: "observed-interface", mappingEdition: MODEL_EDITION, role: "device",
        nativeProtocol: true, fullProfile: false,
        operationIds: [...new Set([...entries.values()].map((entry) => entry.operation.id))].sort(),
        evidence: sources.length <= 128 ? sources : [{ sourceId: `urn:onvif:observation-set:${digest(sources)}`,
            detail: "Summary of the supplied evidence set; complete records remain in the projection's native observation/resource metadata. This digest is not authentication or conformance." }] };
}

function finishTd(td: ThingDescription): ThingDescription {
    const version = digest(td);
    return structuredClone({ ...td, version: { instance: version }, "onvif:projectionDigest": version });
}

export function project(snapshot: DeviceSnapshot, catalog: ProjectionCatalog, policy: ProjectionPolicy): ProjectionSet {
    assertDeviceSnapshot(snapshot);
    validatePolicy(policy);
    if (!isRecord(catalog) || !isRecord(catalog.registry) || !isRecord(catalog.requirements)
        || catalog.registry.formatVersion !== 1 || catalog.requirements.formatVersion !== 1
        || !/^[a-f0-9]{64}$/u.test(catalog.registry.registryDigest) || !/^[a-f0-9]{64}$/u.test(catalog.requirements.digest)) {
        throw new OnvifError("InvalidRegistry", "Projection requires a locally compiled registry and requirement index");
    }
    const diagnostics: ProjectionDiagnostic[] = catalog.requirements.diagnostics.map((entry) => ({
        ...entry, severity: entry.severity
    }));
    const observed = observedOperations(snapshot, catalog.registry, policy, diagnostics);
    const aliases = safeReadAliases(catalog.registry);
    addAliases(observed, aliases, policy);
    const claimIndex = new Map<string, ProfileClaim>();
    for (const claim of snapshot.profileClaims) {
        const key = canonicalJson([claim.profile, claim.edition ?? null, claim.role]);
        const previous = claimIndex.get(key);
        const evidence = [...(previous?.evidence ?? []), ...claim.evidence];
        const unique = [...new Map(evidence.map((entry) => [canonicalJson(entry), entry])).entries()]
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, entry]) => entry);
        claimIndex.set(key, { ...claim, evidence: unique });
    }
    const claims = [...claimIndex.values()].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
    const rowsByClaim = claims.map((claim) => ({ claim, rows: claimRows(claim, catalog.requirements, diagnostics) }));
    const rowIds = new Set<string>();
    const rows = rowsByClaim.flatMap((entry) => entry.rows).filter((row) => {
        if (rowIds.has(row.id)) return false;
        rowIds.add(row.id);
        return true;
    });
    const assessed = assessments(rows, catalog.requirements, snapshot, observed, diagnostics);
    const clientManifests: Schema[] = rowsByClaim.filter((entry) => entry.claim.role === "client").map(({ claim, rows }) => ({
        id: claim.edition === undefined ? `${ONVIF_BASE}/models/clients/Unversioned-${encodeURIComponent(claim.profile)}.json`
            : clientManifestId(claim.profile, claim.edition),
        kind: "observed-client-requirement-manifest", claim, createsClientThing: false,
        requirements: assessed.filter((entry) => rows.some((row) => row.id === entry.requirementId)),
        obligationGroups: groupAssessments(catalog.requirements.obligationGroups.filter((group) =>
            group.profile === claim.profile && group.edition === claim.edition && group.role === "client"), catalog.requirements, snapshot),
        runtimeGate: "Explicit client implementation/build evidence is required; remote device reads do not implement client behavior."
    }));
    const models = new Map<string, Schema>(), tds: ThingDescription[] = [];
    const deviceId = deviceThingId(snapshot);
    const resourceMap = new Map<string, ResourceSnapshot>();
    for (const resource of snapshot.resources) {
        const id = resourceThingId(snapshot, resource);
        if (resourceMap.has(id)) invalid("duplicate parent-scoped resource identity");
        resourceMap.set(id, resource);
    }
    const common = {
        "@context": context(), securityDefinitions: structuredClone(policy.securityDefinitions), security: nonemptyArray(policy.security, "TD security"),
        "onvif:registryDigest": catalog.registry.registryDigest, "onvif:requirementsDigest": catalog.requirements.digest,
        "onvif:claimSemantics": "Advertised claims, observations, registered firmware evidence and runtime qualification are distinct. No profile conformance is inferred."
    };
    const profileModels = rowsByClaim.filter((entry) => entry.claim.role === "device" && entry.rows.length && entry.claim.edition !== undefined)
        .map((entry) => profileModelId(entry.claim.profile, entry.claim.edition ?? ""));
    if (snapshot.services.length || snapshot.resources.length || claims.some((claim) => claim.role === "device")) {
        const composed = composite(DEVICE_MODEL, observed, catalog.requirements, catalog.registry);
        const id = String(composed.native.id);
        models.set(id, composed.native); models.set(String(composed.semantic.id), composed.semantic);
        const identity = snapshot.identity?.state === "known" ? snapshot.identity.value : undefined;
        const title = [identity?.manufacturer, identity?.model].filter(Boolean).join(" ") || "ONVIF device";
        const registered = (snapshot.conformanceEvidence ?? []).map((record) => {
            const matched = identity?.firmwareVersion === undefined ? "unknown" : identity.firmwareVersion === record.firmware ? "true" : "false";
            if (matched === "false") diagnostics.push({ code: "registered-firmware-mismatch", severity: "warning",
                message: "Provided registered evidence is for another firmware; it does not attest the observed device." });
            return { ...record, matchesObservedFirmware: matched, independentlyVerified: false };
        });
        const td: ThingDescription = {
            ...common, id: deviceId, title, "@type": "onvif:Device",
            actions: exposedActions(observed, catalog.registry, policy),
            links: [{ rel: "type", href: id, type: "application/tm+json" }],
            "onvif:profileClaims": claims.filter((claim) => claim.role === "device"),
            "onvif:profileModels": [...new Set(profileModels)].sort(),
            "onvif:observedServices": [...snapshot.services].sort((a, b) => canonicalJson([a.namespace, a.xaddr]) < canonicalJson([b.namespace, b.xaddr]) ? -1 : 1)
                .map((service) => ({ namespace: service.namespace, xaddr: service.xaddr, ...(service.version === undefined ? {} : { version: service.version }),
                    evidence: service.evidence, capabilities: service.capabilities,
                    readOutcomes: service.readOutcomes.map((entry) => ({
                        operation: entry.operation, ...(entry.portType === undefined ? {} : { portType: entry.portType }),
                        ...(entry.binding === undefined ? {} : { binding: entry.binding }), state: entry.outcome.state, evidence: entry.outcome.evidence
                    })) })),
            "onvif:capabilityEvidence": snapshot.facts ?? {}, "onvif:conformanceEvidence": registered,
            "onvif:profileAssessments": assessed.filter((entry) => entry.role === "device"),
            "onvif:projection": observedProjection(observed, [
                ...snapshot.services.flatMap((service) => service.evidence),
                ...snapshot.resources.flatMap((resource) => resource.evidence),
                ...claims.flatMap((claim) => claim.evidence)
            ])
        };
        tds.push(td);
    }
    const knownKinds = new Set(resourceKinds(catalog.registry).map((entry) => entry.kind));
    for (const [id, resource] of [...resourceMap].sort(([a], [b]) => a < b ? -1 : 1)) {
        const services = snapshot.services.filter((service) => service.namespace === resource.serviceNamespace);
        if (services.length === 0) {
            diagnostics.push({ code: "resource-service-unobserved", severity: "warning", resourceId: id,
                serviceNamespace: resource.serviceNamespace, message: "Resource has no observed service XAddr; no endpoint is fabricated." });
        }
        const resourceOperations = new Map<string, ExposedOperation>();
        for (const reference of resource.operations ?? []) {
            const candidates = catalog.registry.operations.filter((entry) => matches(entry, resource.serviceNamespace, reference));
            if (candidates.length !== 1) {
                diagnostics.push({ code: "resource-operation-unresolved", severity: "warning", resourceId: id,
                    message: `${reference.operation} requires a unique qualified native contract.` });
                continue;
            }
            const operation = candidates[0];
            if (operation === undefined) continue;
            if (operation.mappingSupport !== "compiled") {
                diagnostics.push({ code: "unsupported-resource-operation", severity: "warning", resourceId: id,
                    operationId: operation.id, message: "The required canonical source graph is not implemented." });
                continue;
            }
            const fixed = resource.facts?.fixed;
            if (resource.kind === "MediaProfile" && operation.operation === "DeleteProfile"
                && fixed?.state === "known" && fixed.value === true) {
                diagnostics.push({ code: "fixed-profile-nondeletable", severity: "info", resourceId: id,
                    operationId: operation.id, message: "A fixed media profile is non-deletable, not immutable; other explicit native operations are retained." });
                continue;
            }
            const addOn = catalog.registry.services.find((service) => service.operationIds.includes(operation.id))?.group === "conditional-add-on";
            if (services.length && (!addOn || policy.includeAddOns)) resourceOperations.set(operation.id, { operation, services });
        }
        addAliases(resourceOperations, aliases, policy);
        const knownKind = knownKinds.has(resource.kind);
        if (!knownKind) diagnostics.push({ code: "unmapped-resource-kind", severity: "info", resourceId: id,
            message: "Native resource identity is retained with the generic resource TM; an undeclared resource class is not invented." });
        const composed = composite(knownKind ? resourceModelId(resource.kind) : RESOURCE_MODEL,
            resourceOperations, catalog.requirements, catalog.registry);
        const modelId = String(composed.native.id);
        models.set(modelId, composed.native); models.set(String(composed.semantic.id), composed.semantic);
        const parent = resource.parentTokens.at(-1);
        const parentId = parent === undefined ? deviceId : resourceThingId(snapshot, {
            serviceNamespace: resource.serviceNamespace, kind: parent.kind, token: parent.token, parentTokens: resource.parentTokens.slice(0, -1)
        });
        if (parent !== undefined && !resourceMap.has(parentId)) diagnostics.push({
            code: "parent-resource-unobserved", severity: "info", resourceId: id,
            message: "Parent token remains part of the native identity, but no parent TD is invented."
        });
        const resourceTd: ThingDescription = {
            ...common, id, title: `${resource.kind} ${resource.token}`, "@type": knownKind ? `onvif:${resource.kind}` : "onvif:Resource",
            actions: exposedActions(resourceOperations, catalog.registry, policy),
            links: [{ rel: "type", href: modelId, type: "application/tm+json" },
                { rel: "up", href: parent === undefined || !resourceMap.has(parentId) ? deviceId : parentId, type: "application/td+json" }],
            "onvif:resourceIdentity": { epr: snapshot.epr.address, serviceNamespace: resource.serviceNamespace,
                kind: resource.kind, parentTokens: resource.parentTokens, token: resource.token, evidence: resource.evidence },
            "onvif:capabilityEvidence": resource.facts ?? {},
            "onvif:projection": observedProjection(resourceOperations, resource.evidence),
            description: "Observed native resource. Its token and parent path are identity metadata, not automatically applied operation arguments. Full canonical native Action input remains required."
        };
        tds.push(resourceTd);
    }
    const orderedDiagnostics = diagnostics.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
    const orderedTds = tds.sort((a, b) => String(a.id) < String(b.id) ? -1 : 1).map(finishTd);
    const result = { formatVersion: 1 as const, registryDigest: catalog.registry.registryDigest,
        requirementsDigest: catalog.requirements.digest,
        models: [...models.values()].sort((a, b) => String(a.id) < String(b.id) ? -1 : 1),
        tds: orderedTds, clientManifests, assessments: assessed, diagnostics: orderedDiagnostics };
    return structuredClone({ ...result, projectionDigest: digest(result) });
}
