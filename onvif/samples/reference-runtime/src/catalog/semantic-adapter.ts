import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "../binding/errors.js";
import { operationKey, operationReference, type OperationReference } from "../binding/registry.js";
import { encodeElement } from "../xml/mapper.js";
import type { CanonicalCatalog, CompiledOperation } from "./compiler.js";
import { isJsonValue } from "./conditions.js";
import {
    ABSTRACT_BASE, ABSTRACT_MODEL, ABSTRACT_OPERATION_MODEL, abstractActionTemplate, context, model, MODEL_EDITION
} from "./models.js";
import type { Schema } from "./schemas.js";
import { digest } from "./sources.js";

export interface SemanticAdapterEvidence {
    readonly sourceId: string;
    readonly detail?: string;
}

export interface SemanticAdapterModelOptions {
    readonly id?: string;
    readonly title: string;
    readonly operations: readonly OperationReference[];
    readonly evidence: readonly SemanticAdapterEvidence[];
    readonly claim?: "fragment";
}

export interface SemanticAdapterForm {
    readonly href: string;
    readonly op: "invokeaction";
    readonly contentType: "application/json";
    readonly "htv:methodName": "POST";
    readonly security?: readonly string[];
}

export interface SemanticAdapterBinding {
    readonly operation: OperationReference;
    readonly forms: readonly SemanticAdapterForm[];
}

export interface SemanticAdapterTdOptions {
    readonly id: string;
    readonly modelId?: string;
    readonly title: string;
    readonly operations: readonly OperationReference[];
    readonly evidence: readonly SemanticAdapterEvidence[];
    readonly bindingForms: readonly SemanticAdapterBinding[];
    readonly securityDefinitions: NonNullable<ThingDescription["securityDefinitions"]>;
    readonly security: readonly string[];
    readonly claim?: "fragment";
}

export interface SemanticAdapterProjection {
    readonly model: Schema;
    readonly td: ThingDescription;
}

function invalid(message: string): never {
    throw new OnvifError("InvalidValue", `Semantic adapter: ${message}`);
}

function fields(value: unknown, names: readonly string[], label: string): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !names.includes(key))) invalid(`invalid ${label} fields`);
    return value;
}

function text(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !value || value.length > 4096 || /[\u0000-\u001f]/u.test(value)) invalid(`invalid ${label}`);
}

function absolute(value: unknown, label: string, http = false): asserts value is string {
    text(value, label);
    let url: URL;
    try { url = new URL(value); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return invalid(`${label} must be an absolute URI`);
    }
    if (url.username || url.password || /\s/u.test(value) || (http && (!["http:", "https:"].includes(url.protocol) || url.hash))) {
        invalid(`${label} must not contain credentials, whitespace or an invalid HTTP target`);
    }
}

function operation(catalog: CanonicalCatalog, reference: OperationReference): CompiledOperation {
    if (!isRecord(catalog) || catalog.formatVersion !== 1 || !Array.isArray(catalog.operations)
        || !isRecord(catalog.xml) || typeof catalog.registryDigest !== "string" || !/^[a-f0-9]{64}$/u.test(catalog.registryDigest)) {
        throw new OnvifError("InvalidRegistry", "Semantic adapter requires an explicit compiled canonical catalog");
    }
    fields(reference, ["bindingQName", "portTypeQName", "operation"], "qualified operation");
    const resolved = operationReference(reference), key = operationKey(resolved);
    for (const name of [resolved.bindingQName, resolved.portTypeQName]) fields(name, ["namespace", "localName"], "QName");
    const matches = catalog.operations.filter((entry) => operationKey(entry) === key);
    const found = matches[0];
    if (matches.length !== 1 || found === undefined || found.mappingSupport !== "compiled") {
        throw new OnvifError("UnsupportedCapability", "Semantic adapter operation must resolve uniquely in the compiled catalog");
    }
    const media2 = "http://www.onvif.org/ver20/media/wsdl";
    if (found.bindingQName.namespace !== media2 || found.bindingQName.localName !== "Media2Binding"
        || found.portTypeQName.namespace !== media2 || found.portTypeQName.localName !== "Media2"
        || !["GetProfiles", "GetSnapshotUri"].includes(found.operation) || found.response === null) {
        throw new OnvifError("UnsupportedCapability", "This semantic adapter edition admits only the qualified Media2 GetProfiles and GetSnapshotUri fragments");
    }
    return found;
}

function selection(catalog: CanonicalCatalog, options: SemanticAdapterModelOptions): CompiledOperation[] {
    if (!isJsonValue(options)) invalid("model options must be finite public JSON metadata");
    fields(options, ["id", "title", "operations", "evidence", "claim"], "model options");
    text(options.title, "title");
    if (options.id !== undefined) absolute(options.id, "model ID");
    if (options.claim !== undefined && options.claim !== "fragment") invalid("only a fragment claim is supported; no full or native profile claim is inferred");
    if (!Array.isArray(options.operations) || options.operations.length < 1 || options.operations.length > 2) {
        invalid("select one or two explicit qualified operations");
    }
    if (!Array.isArray(options.evidence) || options.evidence.length < 1 || options.evidence.length > 128) invalid("public provenance is required");
    for (const item of options.evidence) {
        fields(item, ["sourceId", "detail"], "evidence");
        text(item.sourceId, "evidence sourceId");
        if (/^(?:[A-Za-z]:[\\/]|file:|[\\/]|\.\.?[\\/])/iu.test(item.sourceId)) invalid("evidence uses public source IDs, not private filesystem paths");
        if (item.detail !== undefined) text(item.detail, "evidence detail");
    }
    const operations = options.operations.map((entry) => operation(catalog, entry)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(operations.map((entry) => entry.id)).size !== operations.length) invalid("duplicate operation selection");
    return operations;
}

function projectionRecord(operations: readonly CompiledOperation[], evidence: readonly SemanticAdapterEvidence[]): Schema {
    return {
        category: "wotSemanticProfile", status: "declared-fragment", mappingEdition: MODEL_EDITION,
        role: "device", operationIds: operations.map((entry) => entry.id),
        nativeProtocol: false, fullProfile: false, evidence: structuredClone(evidence)
    };
}

export function semanticAdapterOperationId(catalog: CanonicalCatalog, reference: OperationReference): string {
    return operation(catalog, reference).id;
}

export function createSemanticAdapterModel(catalog: CanonicalCatalog, options: SemanticAdapterModelOptions): Schema {
    const operations = selection(catalog, options);
    const id = options.id ?? `${ABSTRACT_BASE}/composites/Adapter-${digest({
        registryDigest: catalog.registryDigest, operations: operations.map((entry) => operationKey(entry))
    })}.tm.json`;
    return {
        ...model(id, options.title, ABSTRACT_MODEL),
        actions: Object.fromEntries(operations.map((entry) => [entry.id, { "tm:ref": `${ABSTRACT_OPERATION_MODEL}#/actions/${entry.id}` }])),
        "onvif:modelClass": "onvif:SemanticThing", "onvif:registryDigest": catalog.registryDigest,
        "onvif:projection": projectionRecord(operations, options.evidence),
        description: "A selected canonical semantic fragment, without native SOAP, discovery or full-profile claims. Forms and authorization belong to the actual adapter interface."
    };
}

function nonempty<T>(values: readonly T[], label: string): [T, ...T[]] {
    const first = values[0];
    if (first === undefined) invalid(`${label} must not be empty`);
    return [first, ...values.slice(1)];
}

export function deriveAdapterTd(catalog: CanonicalCatalog, options: SemanticAdapterTdOptions): SemanticAdapterProjection {
    if (!isJsonValue(options)) invalid("TD options must be finite public JSON metadata");
    fields(options, ["id", "modelId", "title", "operations", "evidence", "bindingForms", "securityDefinitions", "security", "claim"], "TD options");
    absolute(options.id, "Thing ID");
    const composed = createSemanticAdapterModel(catalog, {
        ...(options.modelId === undefined ? {} : { id: options.modelId }), title: options.title,
        operations: options.operations, evidence: options.evidence, ...(options.claim === undefined ? {} : { claim: options.claim })
    });
    if (!isRecord(options.securityDefinitions) || Object.keys(options.securityDefinitions).length < 1) invalid("explicit adapter security definitions are required");
    for (const definition of Object.values(options.securityDefinitions)) {
        if (!isRecord(definition) || typeof definition.scheme !== "string"
            || !["nosec", "basic", "digest", "bearer", "apikey", "oauth2", "cert"].includes(definition.scheme)) {
            invalid("security must describe the real standard WoT adapter scheme, not native ONVIF authentication");
        }
        const publicSecurity = (value: unknown): void => {
            if (Array.isArray(value)) { value.forEach(publicSecurity); return; }
            if (!isRecord(value)) return;
            for (const [key, item] of Object.entries(value)) {
                if (/^(?:password|username|tokenValue|secret|clientSecret|privateKey|__runtime.*)$/iu.test(key)) {
                    invalid("credential values are private deployment data, not TD security metadata");
                }
                if (["proxy", "authorization", "token", "refresh"].includes(key) && typeof item === "string") {
                    absolute(item, "security endpoint", true);
                }
                publicSecurity(item);
            }
        };
        publicSecurity(definition);
    }
    const security = (value: readonly string[]): [string, ...string[]] => {
        if (!Array.isArray(value) || value.length > 16) invalid("invalid security selection");
        for (const name of value) {
            text(name, "security definition name");
            if (!Object.hasOwn(options.securityDefinitions, name)) invalid("selected security definition is absent");
        }
        if (new Set(value).size !== value.length || (value.length > 1
            && value.some((name) => options.securityDefinitions[name]?.scheme === "nosec"))) {
            invalid("security is a complete conjunction, never duplicate names or nosec mixed with authentication");
        }
        return nonempty(value, "security selection");
    };
    const selectedSecurity = security(options.security);
    if (!Array.isArray(options.bindingForms) || options.bindingForms.length !== options.operations.length) invalid("every selected operation needs exactly one binding record");
    const selected = new Set(options.operations.map((entry) => operation(catalog, entry).id));
    const actions: NonNullable<ThingDescription["actions"]> = {};
    for (const binding of options.bindingForms) {
        fields(binding, ["operation", "forms"], "binding record");
        const entry = operation(catalog, binding.operation);
        if (!selected.delete(entry.id)) invalid("duplicate or unselected binding operation");
        if (!Array.isArray(binding.forms) || binding.forms.length < 1 || binding.forms.length > 16) invalid("one or more actual Forms are required");
        const forms = binding.forms.map((form: SemanticAdapterForm) => {
            fields(form, ["href", "op", "contentType", "htv:methodName", "security"], "adapter Form");
            absolute(form.href, "Form href", true);
            if (form.href.includes("{{") || form.op !== "invokeaction" || form.contentType !== "application/json" || form["htv:methodName"] !== "POST") {
                invalid("adapter Forms must be concrete HTTP(S) POST application/json Actions");
            }
            return { ...form, security: security(form.security ?? selectedSecurity) };
        });
        actions[entry.id] = { ...abstractActionTemplate(entry, catalog), forms: nonempty(forms, "Forms") };
    }
    if (selected.size !== 0) invalid("a selected operation has no actual binding");
    const td: ThingDescription = {
        "@context": context(), "@type": "onvif:SemanticThing", id: options.id, title: options.title,
        securityDefinitions: structuredClone(options.securityDefinitions), security: selectedSecurity,
        links: [{ rel: "type", href: String(composed.id), type: "application/tm+json" }], actions,
        "onvif:registryDigest": catalog.registryDigest,
        "onvif:projection": projectionRecord(options.operations.map((entry) => operation(catalog, entry)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), options.evidence),
        "onvif:claimSemantics": "Declared semantic fragments only. Neither a source prefix, a model link nor this record authenticates a publisher or certifies a native ONVIF device."
    };
    const revision = digest(td);
    return { model: structuredClone(composed), td: structuredClone({ ...td, version: { instance: revision }, "onvif:projectionDigest": revision }) };
}

export function assertSemanticAdapterValue(
    catalog: CanonicalCatalog, reference: OperationReference, direction: "input" | "output", value: unknown
): void {
    if (direction !== "input" && direction !== "output") invalid("value direction must be input or output");
    const selected = operation(catalog, reference);
    const descriptor = direction === "input" ? selected.request : selected.response;
    if (descriptor === null) invalid("the selected operation has no output contract");
    encodeElement(descriptor, value, catalog.xml);
}
