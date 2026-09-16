import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isRecord, OnvifError } from "../binding/errors.js";
import { compileCatalog, type CanonicalCatalog } from "./compiler.js";
import { bindingSchema, formSchema, requirementsSchema, snapshotSchema } from "./contracts.js";
import { mappingSchema } from "./descriptor-schema.js";
import { assertModelImports, modelIndex } from "./model-resolver.js";
import { abstractModelId, generateModels, generateVocabulary, MODEL_EDITION } from "./models.js";
import { loadRequirementIndex, type RequirementIndex } from "./requirements.js";
import { generatePayloadSchema, ONVIF_BASE, ONVIF_CONTEXT } from "./schemas.js";
import { canonicalJson } from "./sources.js";

export const PACKAGE_ASSETS: Readonly<Record<string, string>> = Object.freeze({
    "catalog.json": "generated/catalog.json",
    "requirements-index.json": "generated/requirements-index.json",
    "models.json": "generated/models.json",
    "context.jsonld": "vocabulary/context.jsonld",
    "terms.json": "vocabulary/terms.json",
    "payloads.schema.json": "schemas/payloads.schema.json",
    "form.schema.json": "schemas/form.schema.json",
    "snapshot.schema.json": "schemas/snapshot.schema.json",
    "requirements.schema.json": "schemas/requirements.schema.json",
    "mapping.schema.json": "schemas/mapping.schema.json",
    "binding.schema.json": "schemas/binding.schema.json",
    "model-translation.json": "generated/model-translation.json",
    "topic-contracts.json": "generated/topic-contracts.json",
    "sources.lock.json": "sources.lock.json",
    "profile-editions.json": "catalog/profile-editions.json",
    "editorial-decisions.json": "catalog/editorial-decisions.json",
    "source-policy.json": "catalog/source-policy.json",
    "coverage.json": "coverage/coverage.json"
});

const PHYSICAL_ARTIFACT_SOURCES: Readonly<Record<string, string>> = Object.freeze({
    "models/events/PullPointSubscription.tm.json": "models/events/PullPointSubscription.tm.json",
    "catalog/editorial-decisions.json": "support/editorial/editorial-decisions.json",
    "catalog/profile-editions.json": "profile-editions.json",
    "catalog/source-policy.json": "support/upstream/source-policy.json",
    "coverage/coverage.json": "support/reports/coverage.json",
    "generated/catalog.json": "catalog.json",
    "generated/manifest.json": "model-manifest.json",
    "generated/mapping-reference.json": "support/reference/mapping-reference.json",
    "generated/models.json": "models.json",
    "generated/requirements-index.json": "requirements-index.json",
    "generated/model-translation.json": "model-translation.json",
    "generated/topic-contracts.json": "topic-contracts.json",
    "schemas/form.schema.json": "form.schema.json",
    "schemas/payloads.schema.json": "payloads.schema.json",
    "schemas/requirements.schema.json": "requirements.schema.json",
    "schemas/snapshot.schema.json": "snapshot.schema.json",
    "schemas/mapping.schema.json": "mapping.schema.json",
    "schemas/binding.schema.json": "binding.schema.json",
    "sources.lock.json": "sources.lock.json",
    "vocabulary/context.jsonld": "context.jsonld",
    "vocabulary/ontology.ttl": "ontology.ttl",
    "vocabulary/terms.json": "terms.json",
    "vocabulary/shapes.ttl": "vocabulary.shacl.ttl"
});

export function repositoryRoot(start: string): string {
    let root = resolve(start);
    while (!existsSync(join(root, "publication-ownership.json"))) {
        const parent = dirname(root);
        if (parent === root) throw new OnvifError("InvalidRegistry", "Cannot locate the specification repository");
        root = parent;
    }
    return root;
}

export function physicalArtifactPath(root: string, resource: string): string {
    const parts = resource.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\u0000]/u.test(part))) {
        throw new OnvifError("InvalidRegistry", "Unsafe logical ONVIF resource");
    }
    const physical = PHYSICAL_ARTIFACT_SOURCES[resource]
        ?? (/^models\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.json$/u.test(resource)
            ? resource.startsWith("models/abstract/") ? resource : resource.replace(/^models\//u, "models/native/") : undefined);
    if (physical === undefined) throw new OnvifError("InvalidRegistry", "Unmapped logical ONVIF resource");
    return join(resolve(root), "onvif", ...physical.split("/"));
}

export interface ArtifactEntry {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly physicalPath?: string;
}

export interface GenerationResult {
    readonly registryDigest: string;
    readonly requirementsDigest: string;
    readonly artifacts: number;
    readonly sources: number;
    readonly imports: number;
    readonly operations: number;
    readonly compiledOperations: number;
    readonly requirements: number;
    readonly stale: readonly string[];
    readonly check: boolean;
}

function bytes(value: unknown): Buffer {
    canonicalJson(value);
    return Buffer.from(`${JSON.stringify(value, null, 4)}\n`, "utf8");
}
function sha(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function entry(path: string, value: Buffer): ArtifactEntry { return { path, sha256: sha(value), bytes: value.length }; }

function documentMetadata(path: string, value: Buffer): { logicalId: string; dependencies: string[] } {
    const dependencies = new Set<string>();
    const json: unknown = path.endsWith(".json") || path.endsWith(".jsonld") ? JSON.parse(value.toString("utf8")) : undefined;
    const logicalId = path === "vocabulary/context.jsonld" ? ONVIF_CONTEXT
        : isRecord(json) && typeof json.id === "string" ? json.id
            : isRecord(json) && typeof json.$id === "string" ? json.$id : `${ONVIF_BASE}/${path}`;
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!isRecord(value)) return;
        for (const key of ["tm:ref", "onvif:sourceDataSchema", "onvif:clientRequirements"]) {
            if (typeof value[key] === "string") dependencies.add(value[key].split("#")[0] ?? value[key]);
        }
        if (typeof value["@context"] === "string") dependencies.add(value["@context"]);
        else if (Array.isArray(value["@context"])) {
            for (const context of value["@context"]) if (typeof context === "string") dependencies.add(context);
        }
        if (Array.isArray(value.links)) {
            for (const link of value.links) {
                if (isRecord(link) && link.rel === "tm:extends" && typeof link.href === "string") dependencies.add(link.href);
            }
        }
        Object.values(value).forEach(visit);
    };
    visit(json);
    dependencies.delete(logicalId);
    return { logicalId, dependencies: [...dependencies].sort() };
}

function ownedPath(root: string, resource: string): string {
    const parts = resource.split("/");
    if (!["schemas", "vocabulary", "models", "generated", "coverage"].includes(parts[0] ?? "")
        || parts.some((part) => !part || part === "." || part === ".." || /[\\:\u0000]/u.test(part))) {
        throw new OnvifError("InvalidRegistry", "Artifact path is outside the explicit ONVIF generation ownership");
    }
    return physicalArtifactPath(root, resource);
}

function coverage(catalog: CanonicalCatalog, index: RequirementIndex): Record<string, unknown> {
    const operationRequirements = new Map<string, string[]>();
    for (const resolution of index.resolutions) {
        for (const id of resolution.operationIds) {
            const rows = operationRequirements.get(id) ?? [];
            rows.push(resolution.requirementId);
            operationRequirements.set(id, rows);
        }
    }
    const statuses = catalog.operations.map((operation) => ({
        operationId: operation.id, serviceNamespace: operation.serviceNamespace,
        bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName, operation: operation.operation,
        sourceId: operation.sourceId, locator: operation.source.locator,
        status: operation.mappingSupport, unsupported: operation.issues,
        openContent: operation.openContent, reachableTypes: operation.reachableTypes,
        requirementIds: operationRequirements.get(operation.id) ?? [],
        runtimeGate: "Not established by compilation; independent operation/security/fault/workflow qualification is required."
    }));
    return {
        formatVersion: 1, registryDigest: catalog.registryDigest, requirementsDigest: index.digest,
        sourceClosure: {
            xmlDocuments: catalog.sourcePins.xmlDocuments, imports: catalog.sourcePins.imports,
            entryPoints: catalog.sourcePins.entryPoints, lockDigest: catalog.sourcePins.lockDigest,
            omittedSourceGroup: "The three fetch-only April-2005 discovery/addressing XML inputs are not part of this service compiler closure. The phase-1 tool and explicit cache remain their resolver."
        },
        counts: {
            serviceBindings: catalog.services.length, operations: catalog.operations.length,
            compiledOperations: catalog.operations.filter((operation) => operation.mappingSupport === "compiled").length,
            unsupportedOperations: catalog.operations.filter((operation) => operation.mappingSupport === "unsupported").length,
            typeContracts: catalog.types.length, requirements: index.requirements.length,
            deviceRequirements: index.requirements.filter((row) => row.role === "device").length,
            clientRequirements: index.requirements.filter((row) => row.role === "client").length,
            obligationGroups: index.obligationGroups.length
        },
        semantics: {
            compiled: "The operation's required request/response/declared-fault/derived-type descriptor graph has no recorded unsupported construct. This is not a runtime or profile conformance result.",
            jsonSchema: "JSON Schema describes canonical structure, typed references, occurrence counts and representable facets. Explicit nativeConstraints/whole-value checks also require the canonical codec; JSON Schema alone is not a complete XSD validator.",
            wildcards: "Only native source-declared wildcards/anyType preserve XML nodes. Known lax/strict content is checked against local declarations; unknown strict content is rejected. Open content is not proof of topic payload, vendor extension or transport support.",
            topics: "Profile-authored topic names and namespace evidence are retained. The locked topicns.xml is a placeholder; complete dynamic TopicSet payload validation is not claimed.",
            profiles: "Every input requirement retains a per-clause mapping rationale and evidence target. Input-ledger review/recursive-dependency limitations remain below; counts alone do not prove source completeness.",
            clients: "Client behavior, decoding, workflow and implementation choices are separate manifests, not client-hosted device Actions.",
            runtime: "The binding-gate and events suites qualify their specific loopback SOAP/security/lifecycle cases. Native media has separate evidence. Compilation never promotes these cases to all-operation, hardware, interoperability or profile support."
        },
        runtimeAdapters: {
            actions: "Native SOAP 1.2 invocation and explicit accepted-empty one-way policy; operation behavior requires separate evidence.",
            events: "Opt-in pullpoint-v1 Event TM: native Create, serialized Pull, conditional WS-N Renew, and awaited Unsubscribe. Device support, subscription authorization and continuity remain runtime evidence.",
            metadata: "Full canonical MetadataStream mapping, not proof of RTP transport, vendor payload semantics or media decoding.",
            properties: "No generic SOAP Property mapping. Stateful event/search result drains remain native Actions or owned controllers.",
            security: "Declared Digest, UsernameToken and principal-scoped mTLS; no native Basic/nosec fallback. Stock HTTP delegation is a separate per-request path."
        },
        operations: statuses,
        unsupportedTypes: catalog.issues,
        requirements: index.requirements.map((row) => {
            const resolution = index.resolutions.find((entry) => entry.requirementId === row.id);
            if (resolution === undefined) throw new OnvifError("InvalidRegistry", `Missing clause disposition ${row.id}`);
            return { id: row.id, profile: row.profile, edition: row.edition, role: row.role,
                source: row.source, requirementLevel: row.requirementLevel, condition: row.condition, classification: row.classification,
                mapping: row.mapping, resolution, evidenceTargets: row.evidenceTargets, editorialDecisionIds: row.editorialDecisionIds,
                ...(row.obligationGroupId === undefined ? {} : { obligationGroupId: row.obligationGroupId }),
                requiresRuntimeOrProcessEvidence: true };
        }),
        ledgerReviews: index.files,
        editorialDecisions: index.editorialDecisions,
        obligationGroups: index.obligationGroups,
        diagnostics: index.diagnostics,
        productConformanceEstablished: false,
        publicationClearanceEstablished: false
    };
}

export function compileArtifacts(root: string): {
    catalog: CanonicalCatalog; requirements: RequirementIndex; files: ReadonlyMap<string, Buffer>;
} {
    const catalog = compileCatalog({ root }), requirements = loadRequirementIndex(root, catalog);
    if (requirements.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new OnvifError("InvalidRegistry", `Requirement/native resolution failed: ${requirements.diagnostics
            .filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => `${diagnostic.requirementId ?? ""}: ${diagnostic.message}`).join("\n")}`);
    }
    const models = generateModels(catalog, requirements);
    const vocabulary = generateVocabulary(catalog, JSON.parse(readFileSync(join(root, "onvif", "terms.json"), "utf8")));
    const index = modelIndex(models.values());
    assertModelImports(index);
    const files = new Map<string, Buffer>();
    files.set("generated/catalog.json", bytes(catalog));
    files.set("generated/requirements-index.json", bytes(requirements));
    files.set("generated/models.json", bytes({ formatVersion: 1, models: [...index.values()] }));
    files.set("generated/model-translation.json", bytes({
        formatVersion: 1, mappingEdition: MODEL_EDITION, namespaceChanged: false,
        registryDigest: catalog.registryDigest, requirementsDigest: requirements.digest,
        entries: [...models].filter(([path, value]) => !path.startsWith("models/abstract/") && value["@type"] === "tm:ThingModel")
            .map(([path, value]) => {
                const id = String(value.id), semanticId = abstractModelId(id);
                const semanticPath = `models/abstract/${MODEL_EDITION}/${semanticId.split(`/abstract/${MODEL_EDITION}/`)[1]}`;
                return { nativeId: id, previousLogicalDocument: path,
                    nativePhysicalDocument: relative(join(root, "onvif"), physicalArtifactPath(root, path)).split("\\").join("/"),
                    abstractId: semanticId, abstractPhysicalDocument: semanticPath,
                    compatibility: "Native public ID, member IDs, canonical payloads and native Forms are preserved; the additive abstract base carries no transport requirement.",
                    immediateBase: semanticId };
            })
    }));
    files.set("generated/topic-contracts.json", bytes({
        formatVersion: 1, mappingEdition: MODEL_EDITION, registryDigest: catalog.registryDigest,
        contracts: requirements.editorialDecisions.filter((decision) => isRecord(decision.nativeTopic)).map((decision) => ({
            id: `${ONVIF_BASE}/topics/${String(decision.id)}`, decisionId: decision.id,
            topic: decision.nativeTopic, sourceFacts: decision.sourceFacts,
            sourceReferences: decision.sourceReferences ?? [],
            affectedRequirementIds: decision.affectedRequirementIds,
            releaseGate: "Named editorial and independent domain review is required before formal release; source-proven topic coordinates do not invent an ElementItem root.",
            payloadRule: "A source-declared named type validates the actual ElementItem content only after a trusted message description establishes its actual element root. An unknown root remains an explicit affected-scope limitation."
        }))
    }));
    files.set("generated/mapping-reference.json", bytes({
        id: `${ONVIF_BASE}/generated/mapping-reference.json`, registryDigest: catalog.registryDigest,
        authorship: "Project-authored canonical mapping; native annotations and locators retain ONVIF/W3C/OASIS source ownership.",
        sourcePins: catalog.sourcePins, services: catalog.services,
        operations: catalog.operations.map((operation) => ({
            id: operation.id, sourceId: operation.sourceId, nativeIdentity: {
                bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName, operation: operation.operation
            }, soapAction: operation.soapAction, addressingAction: operation.addressingAction,
            addressingActionBasis: operation.addressingActionBasis, input: operation.input, output: operation.output,
            request: operation.request, response: operation.response, faults: operation.faults ?? [],
            documentation: operation.documentation, safe: false, idempotent: false, access: operation.access,
            mappingSupport: operation.mappingSupport, issues: operation.issues
        })),
        types: catalog.types,
        defaultSemantics: "Attribute omission is preserved. An explicit empty defaulted element is {$default:true}; absence never fabricates a default or a capability. Native annotations that merely describe a default remain source documentation.",
        modelSemantics: "The form-free abstract library declares canonical operation semantics; preserved native overlays extend their abstract counterparts and supply source-derived SOAP Forms. Services/features/profile wrappers import fragments, and client obligations remain separate manifests.",
        runtimeBoundary: "Source compilation and canonical codec support are not behavioral/runtime qualification."
    }));
    files.set("vocabulary/terms.json", bytes(vocabulary.terms));
    files.set("vocabulary/context.jsonld", bytes(vocabulary.context));
    files.set("vocabulary/ontology.ttl", Buffer.from(vocabulary.ontology, "utf8"));
    files.set("vocabulary/shapes.ttl", Buffer.from(vocabulary.shapes, "utf8"));
    files.set("schemas/payloads.schema.json", bytes(generatePayloadSchema(catalog)));
    files.set("schemas/form.schema.json", bytes(formSchema()));
    files.set("schemas/snapshot.schema.json", bytes(snapshotSchema()));
    files.set("schemas/requirements.schema.json", bytes(requirementsSchema()));
    files.set("schemas/mapping.schema.json", bytes(mappingSchema()));
    files.set("schemas/binding.schema.json", bytes(bindingSchema()));
    for (const [path, value] of models) files.set(path, bytes(value));
    files.set("coverage/coverage.json", bytes(coverage(catalog, requirements)));
    const manifest = {
        formatVersion: 1, registryDigest: catalog.registryDigest, requirementsDigest: requirements.digest,
        sourceLockDigest: catalog.sourcePins.lockDigest, packageAssets: PACKAGE_ASSETS,
        artifacts: [...files].sort(([a], [b]) => a < b ? -1 : 1).map(([path, value]) => ({
            ...entry(path, value),
            ...documentMetadata(path, value),
            physicalPath: relative(resolve(root), ownedPath(root, path)).split("\\").join("/"),
            role: path.startsWith("coverage/") ? "informative-evidence"
                : path.startsWith("models/") ? path.includes("/clients/") ? "client-requirement-manifest" : "thing-model"
                    : path.startsWith("schemas/") ? "normative-schema" : path.startsWith("vocabulary/") ? "normative-vocabulary" : "normative-catalog",
            mappingEdition: MODEL_EDITION
        })),
        publication: "Local generation only. This private bundle is not distribution clearance, registration or certification."
    };
    files.set("generated/manifest.json", bytes(manifest));
    return { catalog, requirements, files };
}

function previousManifest(root: string): ArtifactEntry[] {
    const path = ownedPath(root, "generated/manifest.json");
    if (!existsSync(path)) return [];
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.artifacts)) {
        throw new OnvifError("InvalidRegistry", "Existing ONVIF generated manifest is invalid");
    }
    return value.artifacts.map((item: unknown) => {
        if (!isRecord(item) || typeof item.path !== "string" || typeof item.sha256 !== "string"
            || !/^[a-f0-9]{64}$/u.test(item.sha256) || typeof item.bytes !== "number") {
            throw new OnvifError("InvalidRegistry", "Invalid artifact entry in existing manifest");
        }
        ownedPath(root, item.path);
        if (item.physicalPath !== undefined && typeof item.physicalPath !== "string") {
            throw new OnvifError("InvalidRegistry", "Invalid previous physical artifact path");
        }
        return { path: item.path, sha256: item.sha256, bytes: item.bytes,
            ...(item.physicalPath === undefined ? {} : { physicalPath: item.physicalPath }) };
    });
}

function previousPath(root: string, item: ArtifactEntry): string {
    const current = ownedPath(root, item.path);
    if (item.physicalPath === undefined) return current;
    const normalized = item.physicalPath.split("\\").join("/");
    const expected = relative(resolve(root), current).split("\\").join("/");
    const originalModel = item.path.startsWith("models/") ? `onvif/${item.path}` : expected;
    const nativeModel = item.path.startsWith("models/") ? `onvif/${item.path.replace(/^models\//u, "models/native/")}` : expected;
    if (normalized !== expected && normalized !== originalModel && normalized !== nativeModel) {
        throw new OnvifError("InvalidRegistry", "Previous physical artifact path is not an owned declared model relocation");
    }
    return join(resolve(root), ...normalized.split("/"));
}

export function stagePackagedArtifacts(root: string): void {
    const destination = join(__dirname, "..", "catalog-data");
    const manifestBytes = readFileSync(physicalArtifactPath(root, "generated/manifest.json"));
    const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
    if (!isRecord(manifest) || typeof manifest.registryDigest !== "string" || typeof manifest.requirementsDigest !== "string") {
        throw new OnvifError("InvalidRegistry", "Generate ONVIF artifacts before building the packaged catalog");
    }
    const content = new Map<string, Buffer>();
    for (const [name, source] of Object.entries(PACKAGE_ASSETS)) content.set(name, readFileSync(physicalArtifactPath(root, source)));
    const entries = [...content].map(([name, data]) => entry(name, data));
    content.set("manifest.json", bytes({ formatVersion: 1, registryDigest: manifest.registryDigest,
        requirementsDigest: manifest.requirementsDigest, sourceLockDigest: manifest.sourceLockDigest,
        artifacts: entries, private: true }));
    mkdirSync(destination, { recursive: true });
    for (const [name, data] of content) {
        const path = join(destination, name);
        if (!existsSync(path) || !readFileSync(path).equals(data)) writeFileSync(path, data);
    }
}

export function generateOnvif(root: string, check = false): GenerationResult {
    root = resolve(root);
    const previous = previousManifest(root);
    const compiled = compileArtifacts(root), stale: string[] = [];
    for (const [resource, data] of compiled.files) {
        const path = ownedPath(root, resource);
        if (!existsSync(path) || !readFileSync(path).equals(data)) stale.push(resource);
    }
    const obsolete = previous.filter((item) => !compiled.files.has(item.path)
        || previousPath(root, item) !== ownedPath(root, item.path));
    stale.push(...obsolete.map((item) => item.path));
    if (!check) {
        for (const item of obsolete) {
            const path = previousPath(root, item);
            if (existsSync(path) && sha(readFileSync(path)) !== item.sha256) {
                throw new OnvifError("InvalidRegistry", `Obsolete generated artifact has local edits; refusing removal: ${item.path}`);
            }
        }
        for (const [resource, data] of compiled.files) {
            const path = ownedPath(root, resource), parent = resolve(path, "..");
            mkdirSync(parent, { recursive: true });
            if (!existsSync(path) || !readFileSync(path).equals(data)) writeFileSync(path, data);
        }
        for (const item of obsolete) {
            const path = previousPath(root, item);
            if (existsSync(path)) unlinkSync(path);
        }
    }
    if (!check || stale.length === 0) stagePackagedArtifacts(root);
    return {
        registryDigest: compiled.catalog.registryDigest, requirementsDigest: compiled.requirements.digest,
        artifacts: compiled.files.size, sources: compiled.catalog.sourcePins.xmlDocuments, imports: compiled.catalog.sourcePins.imports,
        operations: compiled.catalog.operations.length,
        compiledOperations: compiled.catalog.operations.filter((operation) => operation.mappingSupport === "compiled").length,
        requirements: compiled.requirements.requirements.length, stale: stale.sort(), check
    };
}
