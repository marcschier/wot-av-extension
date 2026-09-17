import { BINDING_NAME } from "../binding/forms.js";
import { defineOperationRegistry, operationKey } from "../binding/registry.js";
import { canonicalSubscription, EVENT_BINDING, resolveSubscription } from "../events/contracts.js";
import type { CanonicalCatalog, CompiledOperation } from "./compiler.js";
import { operationReferenceData, resourceKinds, safeReadAliases } from "./mappings.js";
import type { RequirementAtom, RequirementIndex } from "./requirements.js";
import {
    dataSchema, elementSchemaUri, ONVIF_BASE, ONVIF_CONTEXT, operationSchemaUri, TD_CONTEXT, type Schema
} from "./schemas.js";
import { digest } from "./sources.js";

export const OPERATION_MODEL = `${ONVIF_BASE}/models/operations.tm.json`;
export const DEVICE_MODEL = `${ONVIF_BASE}/models/DeviceThing.tm.json`;
export const RESOURCE_MODEL = `${ONVIF_BASE}/models/ResourceThing.tm.json`;
export const NATIVE_MODEL = `${ONVIF_BASE}/models/NativeThing.tm.json`;
export const PULLPOINT_MODEL = `${ONVIF_BASE}/models/events/PullPointSubscription.tm.json`;
export const MODEL_EDITION = "0.2-proposed";
export const ABSTRACT_BASE = `${ONVIF_BASE}/models/abstract/${MODEL_EDITION}`;
export const ABSTRACT_MODEL = `${ABSTRACT_BASE}/SemanticThing.tm.json`;
export const ABSTRACT_OPERATION_MODEL = `${ABSTRACT_BASE}/operations.tm.json`;
export const ABSTRACT_DEVICE_MODEL = `${ABSTRACT_BASE}/DeviceThing.tm.json`;
export const ABSTRACT_RESOURCE_MODEL = `${ABSTRACT_BASE}/ResourceThing.tm.json`;
export const context = (): [typeof TD_CONTEXT, string] => [TD_CONTEXT, ONVIF_CONTEXT];
export const profileModelId = (profile: string, edition: string): string =>
    `${ONVIF_BASE}/models/profiles/Profile-${encodeURIComponent(profile)}-${encodeURIComponent(edition)}.tm.json`;
export const clientManifestId = (profile: string, edition: string): string =>
    `${ONVIF_BASE}/models/clients/Profile-${encodeURIComponent(profile)}-${encodeURIComponent(edition)}.json`;
export const resourceModelId = (kind: string): string =>
    `${ONVIF_BASE}/models/resources/${encodeURIComponent(kind)}Thing.tm.json`;

export function abstractActionTemplate(operation: CompiledOperation, catalog: CanonicalCatalog): Schema {
    return {
        title: operation.operation,
        description: operation.documentation || `Canonical ${operation.portTypeQName.localName}.${operation.operation}; see its pinned source contract.`,
        safe: false,
        idempotent: false,
        input: dataSchema(operation.request, catalog.xml, operationSchemaUri(operation, "input")),
        ...(operation.response === null ? {} : { output: dataSchema(operation.response, catalog.xml, operationSchemaUri(operation, "output")) }),
        "onvif:source": {
            sourceId: operation.sourceId, locator: operation.source.locator, sha256: operation.source.sha256,
            operation: operationReferenceData(operation), operationKey: operationKey(operation),
            inputClass: operation.input.className, outputClass: operation.output?.className ?? null,
            inputOwner: operation.input.owner, outputOwner: operation.output?.owner ?? null,
            semantics: "The identified native source defines the request, result, effects, faults and resource scope. This abstract contract imposes no SOAP endpoint, native authentication or discovery interface."
        },
        "onvif:mappingSupport": operation.mappingSupport,
        "onvif:runtimeStatus": "semantic-contract-not-implementation-evidence"
    };
}

export function actionTemplate(operation: CompiledOperation, catalog: CanonicalCatalog, href: string): Schema {
    return {
        title: operation.operation,
        description: operation.documentation || `Native ${operation.portTypeQName.localName}.${operation.operation}; see the pinned WSDL contract.`,
        safe: false,
        idempotent: false,
        input: dataSchema(operation.request, catalog.xml, operationSchemaUri(operation, "input")),
        ...(operation.response === null ? {} : { output: dataSchema(operation.response, catalog.xml, operationSchemaUri(operation, "output")) }),
        forms: [{
            href, op: "invokeaction", contentType: "application/soap+xml", "htv:methodName": "POST",
            "onvif:binding": BINDING_NAME, "onvif:operation": operationReferenceData(operation), "onvif:soapAction": operation.soapAction
        }],
        "onvif:source": { sourceId: operation.sourceId, locator: operation.source.locator, sha256: operation.source.sha256,
            inputClass: operation.input.className, outputClass: operation.output?.className ?? null,
            inputOwner: operation.input.owner, outputOwner: operation.output?.owner ?? null },
        "onvif:mappingSupport": operation.mappingSupport,
        "onvif:runtimeStatus": "schema-compiled-not-operation-qualified"
    };
}

export function eventTemplate(catalog: CanonicalCatalog, href: string): Schema {
    const registry = defineOperationRegistry(catalog.operations, catalog.xml);
    const descriptor = canonicalSubscription(registry), contract = resolveSubscription(descriptor, registry);
    const operation = (reference: typeof descriptor.create): CompiledOperation => {
        const result = catalog.operations.find((entry) => operationKey(entry) === operationKey(reference));
        if (result === undefined) throw new Error("Canonical Event references an operation outside its catalog");
        return result;
    };
    const create = operation(descriptor.create), unsubscribe = operation(descriptor.unsubscribe);
    return {
        title: "Native PullPoint notifications",
        description: "An explicitly selected native PullPoint lifecycle. Creation data is the canonical WSDL input; Renew remains conditional on runtime evidence. Subscription state and gaps are controller state, not device properties.",
        subscription: dataSchema(create.request, catalog.xml, operationSchemaUri(create, "input")),
        data: dataSchema(contract.notification, catalog.xml, elementSchemaUri(contract.notification)),
        cancellation: dataSchema(unsubscribe.request, catalog.xml, operationSchemaUri(unsubscribe, "input")),
        forms: [{ href, op: ["subscribeevent", "unsubscribeevent"], contentType: "application/soap+xml",
            "htv:methodName": "POST", "onvif:binding": EVENT_BINDING, "onvif:subscription": descriptor }],
        "onvif:runtimeStatus": "native-pullpoint-adapter-requires-device-support-and-policy"
    };
}

export function model(id: string, title: string, base?: string): Schema {
    return { "@context": context(), "@type": "tm:ThingModel", id, title,
        ...(base === undefined ? {} : { links: [{ rel: "tm:extends", href: base, type: "application/tm+json" }] }) };
}

export function operationImports(ids: readonly string[], library = OPERATION_MODEL): Record<string, Schema> {
    return Object.fromEntries([...new Set(ids)].sort().map((id) => [id, { "tm:ref": `${library}#/actions/${id}` }]));
}

export function abstractModelId(nativeId: string): string {
    if (nativeId === NATIVE_MODEL) return ABSTRACT_MODEL;
    const prefix = `${ONVIF_BASE}/models/`;
    if (!nativeId.startsWith(prefix) || nativeId.startsWith(`${prefix}abstract/`)) {
        throw new Error("An abstract counterpart requires an existing native model identity");
    }
    return `${ABSTRACT_BASE}/${nativeId.slice(prefix.length)}`;
}

function idsFor(requirements: readonly RequirementAtom[], index: RequirementIndex): string[] {
    const ids = new Set(requirements.map((row) => row.id));
    return [...new Set(index.resolutions.filter((row) => ids.has(row.requirementId)).flatMap((row) => row.operationIds))].sort();
}

function optionalActions(requirements: readonly RequirementAtom[], index: RequirementIndex, ids: readonly string[]): string[] {
    const unconditional = new Set(requirements.filter((row) => row.requirementLevel === "mandatory"
        && row.condition === null && row.obligationGroupId === undefined).flatMap((row) =>
        index.resolutions.find((resolution) => resolution.requirementId === row.id)?.operationIds ?? []));
    return ids.filter((id) => !unconditional.has(id)).map((id) => `/actions/${id}`);
}

export function generateModels(catalog: CanonicalCatalog, index: RequirementIndex): Map<string, Schema> {
    const output = new Map<string, Schema>();
    const pins = {
        "onvif:registryDigest": catalog.registryDigest, "onvif:requirementsDigest": index.digest,
        "onvif:sourcePins": { lockDigest: catalog.sourcePins.lockDigest, baseline: catalog.sourcePins.baseline },
        "onvif:authorship": "Project-authored mapping of pinned ONVIF contracts; source documentation retains its original ownership. Not an ONVIF publication or certification."
    };
    const paired = (path: string, native: Schema, semantic: Schema): void => {
        const id = String(native.id), abstractId = abstractModelId(id);
        output.set(`models/abstract/${MODEL_EDITION}/${abstractId.slice(ABSTRACT_BASE.length + 1)}`, {
            ...semantic, ...pins, id: abstractId,
            "onvif:projection": { category: "wotSemanticProfile", status: "template", mappingEdition: MODEL_EDITION,
                nativeProtocol: false, fullProfile: false, evidence: [{ sourceId: "catalog:source-contracts" }] }
        });
        output.set(path, {
            ...native, ...pins,
            "onvif:modelClass": native["onvif:modelClass"] ?? "onvif:NativeContract",
            links: [{ rel: "tm:extends", href: abstractId, type: "application/tm+json" }],
            "onvif:projection": { category: "nativeMapping", status: "template", mappingEdition: MODEL_EDITION,
                nativeProtocol: true, fullProfile: false, evidence: [{ sourceId: "catalog:source-contracts" }] }
        });
    };
    paired("models/NativeThing.tm.json", { ...model(NATIVE_MODEL, "Native ONVIF contract"),
        description: "Native HTTP(S) SOAP Forms are filled only with observed endpoint addresses and explicit caller security policy. This model starts no server or gateway." },
    { ...model(ABSTRACT_MODEL, "Canonical semantic Thing"),
        "onvif:modelClass": "onvif:Semantic",
        description: "Transport-independent source semantics and canonical values. An implementation identifies its actual binding, physical role, provenance and supported fragments; no native endpoint or full profile is implied." });
    paired("models/DeviceThing.tm.json", { ...model(DEVICE_MODEL, "ONVIF device"),
        "onvif:modelClass": "onvif:Device",
        description: "An observed native device identity. Advertised profile claims, observed capabilities, registered evidence, and measured runtime support remain separate." },
    { ...model(ABSTRACT_DEVICE_MODEL, "Canonical device-role semantics", ABSTRACT_MODEL),
        description: "Abstract device-side behavior, not client behavior, a discovery EPR, a native protocol or a camera-hardware assertion." });
    paired("models/ResourceThing.tm.json", { ...model(RESOURCE_MODEL, "Native ONVIF resource"),
        "onvif:modelClass": "onvif:Resource",
        "onvif:nativeIdentity": ["device EPR", "service namespace", "resource kind", "ordered parent-kind/token path", "native token"] },
    { ...model(ABSTRACT_RESOURCE_MODEL, "Canonical resource semantics", ABSTRACT_MODEL),
        description: "Stable, parent-scoped resources. Native tokens or adapter-assigned keys require an explicit source association; model metadata never supplies Action arguments." });
    const requirementIds = new Map<string, string[]>();
    for (const resolution of index.resolutions) {
        for (const id of resolution.operationIds) {
            const rows = requirementIds.get(id) ?? [];
            rows.push(resolution.requirementId);
            requirementIds.set(id, rows);
        }
    }
    paired("models/operations.tm.json", { ...model(OPERATION_MODEL, "Native ONVIF operation definitions"),
        actions: Object.fromEntries(catalog.operations.map((operation) => [operation.id, actionTemplate(operation, catalog, "{{xaddr}}")])),
        "tm:optional": catalog.operations.map((operation) => `/actions/${operation.id}`),
        description: "Each native overlay preserves its exact bindingQName/portTypeQName/operation, source-derived SOAP action and canonical values. Substitute only an observed authorized service XAddr and selected security at instantiation." },
    { ...model(ABSTRACT_OPERATION_MODEL, "Canonical operation and value library", ABSTRACT_MODEL),
        actions: Object.fromEntries(catalog.operations.map((operation) => [operation.id, {
            ...abstractActionTemplate(operation, catalog), "onvif:requirements": requirementIds.get(operation.id) ?? []
        }])),
        "tm:optional": catalog.operations.map((operation) => `/actions/${operation.id}`),
        description: "Complete semantic operation contracts, canonical input/result schemas, caller/service ownership and source-profile obligations. Source tuple provenance does not impose a native transport or security interface." });
    const { forms: _eventForms, ...abstractEvent } = eventTemplate(catalog, "{{xaddr}}");
    paired("models/events/PullPointSubscription.tm.json", {
        ...model(PULLPOINT_MODEL, "Native ONVIF PullPoint Event"),
        events: { notifications: eventTemplate(catalog, "{{xaddr}}") },
        "tm:optional": ["/events/notifications"],
        description: "Opt-in lifecycle template, not evidence that a device supports event subscription, filters or WS-BaseNotification Renew."
    }, { ...model(abstractModelId(PULLPOINT_MODEL), "Canonical owned notification lifecycle", ABSTRACT_MODEL),
        events: { notifications: { ...abstractEvent,
            description: "Explicit owned notification creation, delivery, cancellation and loss reporting with the canonical payloads. A non-native implementation must supply equivalent lifecycle semantics through its actual binding." } },
        "tm:optional": ["/events/notifications"] });
    for (const service of catalog.services) {
        const id = `${ONVIF_BASE}/models/services/${service.id}.tm.json`;
        const source = { sourceId: service.sourceId, line: service.line, sha256: service.sha256,
            bindingQName: service.bindingQName, portTypeQName: service.portTypeQName };
        paired(`models/services/${service.id}.tm.json`, {
            ...model(id, `${service.className} native service`), "onvif:modelClass": "onvif:Device",
            actions: operationImports(service.operationIds), "tm:optional": service.operationIds.map((id) => `/actions/${id}`),
            "onvif:serviceNamespace": service.namespace, "onvif:source": source,
            "onvif:sourceGroup": service.group,
            "onvif:nativeIdentity": { bindingQName: service.bindingQName, portTypeQName: service.portTypeQName },
            description: "Source contract template, not a service-presence or optional-operation claim. A concrete wsdl:service is not required."
        }, { ...model(abstractModelId(id), `${service.className} semantic service`, ABSTRACT_DEVICE_MODEL),
            actions: operationImports(service.operationIds, ABSTRACT_OPERATION_MODEL),
            "tm:optional": service.operationIds.map((id) => `/actions/${id}`),
            "onvif:source": source, "onvif:sourceGroup": service.group,
            description: "Independent canonical service operations, including imported portType coordinates as provenance. No endpoint, SOAP Form, authentication scheme or service-presence claim is inherited." });
    }
    for (const resource of resourceKinds(catalog)) {
        paired(`models/resources/${resource.kind}Thing.tm.json`, {
            ...model(resourceModelId(resource.kind), `ONVIF ${resource.kind}`),
            "onvif:modelClass": `onvif:${resource.kind}`, "onvif:resourceKind": resource.kind,
            "onvif:nativeIdentity": { nativeTypeIds: resource.nativeTypeIds, parentKinds: resource.parentKinds },
            description: resource.description
        }, { ...model(abstractModelId(resourceModelId(resource.kind)), `Canonical ${resource.kind}`, ABSTRACT_RESOURCE_MODEL),
            "onvif:resourceKind": resource.kind,
            "onvif:source": { nativeTypeIds: resource.nativeTypeIds, parentKinds: resource.parentKinds },
            description: `${resource.kind} has the canonical source data and ordered parent scope. An adapter defines its genuine key/source association without fabricating a native EPR or silently filling input tokens.` });
    }
    const features = new Map<string, RequirementAtom[]>();
    for (const row of index.requirements.filter((requirement) => requirement.role === "device")) {
        const id = `${row.profile}-${row.edition}-${row.feature}`;
        const rows = features.get(id) ?? [];
        rows.push(row);
        features.set(id, rows);
    }
    for (const [key, rows] of [...features].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const id = `Feature-${digest(key).slice(0, 20)}`, operations = idsFor(rows, index);
        const nativeId = `${ONVIF_BASE}/models/features/${id}.tm.json`;
        const obligations = {
            "onvif:requirements": rows.map((row) => row.id), "onvif:requirementsDigest": index.digest,
            "onvif:requirementSemantics": "Complete source atoms are retained, including interface, data, behavior, protocol and process obligations. Applicability, semantic implementation and native conformity are evaluated separately."
        };
        paired(`models/features/${id}.tm.json`, {
            ...model(nativeId, key), "onvif:modelClass": "onvif:Device", ...obligations,
            actions: operationImports(operations), "tm:optional": optionalActions(rows, index, operations),
        }, { ...model(abstractModelId(nativeId), `${key} semantic feature`, ABSTRACT_DEVICE_MODEL), ...obligations,
            actions: operationImports(operations, ABSTRACT_OPERATION_MODEL), "tm:optional": optionalActions(rows, index, operations) });
    }
    for (const edition of index.profileEditions.filter((entry) => entry.publicationState === "released")) {
        const profile = String(edition.profileId), version = String(edition.edition);
        const rows = index.requirements.filter((row) => row.profile === profile && row.edition === version);
        const device = rows.filter((row) => row.role === "device"), client = rows.filter((row) => row.role === "client");
        const operations = idsFor(device, index);
        const obligations = {
            "onvif:profileEdition": edition, "onvif:requirements": device.map((row) => row.id),
            "onvif:requirementsDigest": index.digest, "onvif:clientRequirements": clientManifestId(profile, version),
            "onvif:obligationGroups": index.obligationGroups.filter((group) => group.profile === profile && group.edition === version && group.role === "device"),
            description: "A role-specific requirement wrapper, never automatically the immediate type of a partially inspected device. Conditional/alternative obligations require evidence; model derivation is not conformance."
        };
        paired(`models/profiles/Profile-${profile}-${version}.tm.json`, {
            ...model(profileModelId(profile, version), `ONVIF Profile ${profile} ${version} device requirements`),
            ...obligations, "onvif:modelClass": "onvif:Device",
            actions: operationImports(operations), "tm:optional": optionalActions(device, index, operations)
        }, { ...model(abstractModelId(profileModelId(profile, version)), `Profile ${profile} ${version} canonical semantic requirements`, ABSTRACT_DEVICE_MODEL),
            ...obligations, actions: operationImports(operations, ABSTRACT_OPERATION_MODEL), "tm:optional": optionalActions(device, index, operations) });
        output.set(`models/clients/Profile-${profile}-${version}.json`, {
            id: clientManifestId(profile, version), kind: "client-requirement-manifest", profile, edition: version, role: "client",
            source: edition, requirements: client.map((row) => row.id), requirementsDigest: index.digest,
            obligationGroups: index.obligationGroups.filter((group) => group.profile === profile && group.edition === version && group.role === "client"),
            runtimeGate: "Client consumption, decoding, concurrency, lifecycle, and process evidence are not established by a device TD.",
            createsClientThing: false
        });
    }
    const aliases = safeReadAliases(catalog);
    const safeReadsId = `${ONVIF_BASE}/models/features/SafeReads.tm.json`;
    paired("models/features/SafeReads.tm.json", {
        ...model(safeReadsId, "Explicit repeatable read Action aliases"), "onvif:modelClass": "onvif:Device",
        actions: Object.fromEntries(aliases.map((alias) => [alias.id, {
            "tm:ref": `${OPERATION_MODEL}#/actions/${alias.operationId}`, safe: true, idempotent: true, "onvif:safeRead": alias
        }])), "tm:optional": aliases.map((alias) => `/actions/${alias.id}`),
        description: "Opt-in invokable aliases from a fixed reviewed whitelist, not a Get-name heuristic or native Property implementation. Stateful search-result drains are excluded."
    }, { ...model(abstractModelId(safeReadsId), "Canonical repeatable read Action aliases", ABSTRACT_DEVICE_MODEL),
        actions: Object.fromEntries(aliases.map((alias) => [alias.id, {
            "tm:ref": `${ABSTRACT_OPERATION_MODEL}#/actions/${alias.operationId}`, safe: true, idempotent: true, "onvif:safeRead": alias
        }])), "tm:optional": aliases.map((alias) => `/actions/${alias.id}`),
        description: "Opt-in semantic aliases require the same finite, repeatable, non-consuming behavior as the cited source. They are Actions, not Properties, authorization or automatically scheduled reads." });
    const cameraFragments = catalog.operations.filter((operation) =>
        operation.bindingQName.namespace === "http://www.onvif.org/ver20/media/wsdl"
        && operation.bindingQName.localName === "Media2Binding" && operation.portTypeQName.localName === "Media2"
        && ["GetProfiles", "GetSnapshotUri"].includes(operation.operation));
    if (cameraFragments.length !== 2) throw new Error("The initial adapter fragments do not resolve to the pinned Media2 contracts");
    output.set(`models/abstract/${MODEL_EDITION}/features/CameraInventorySnapshot.tm.json`, {
        ...model(`${ABSTRACT_BASE}/features/CameraInventorySnapshot.tm.json`, "Camera inventory and finite snapshot-URI semantic fragments", ABSTRACT_MODEL),
        ...pins, actions: operationImports(cameraFragments.map((entry) => entry.id), ABSTRACT_OPERATION_MODEL),
        "onvif:projection": { category: "wotSemanticProfile", status: "template", mappingEdition: MODEL_EDITION,
            role: "device", operationIds: cameraFragments.map((entry) => entry.id), nativeProtocol: false, fullProfile: false,
            evidence: [{ sourceId: "onvif:wsdl/ver20/media/wsdl/media.wsdl" }] },
        description: "Only canonical Media2 profile inventory and snapshot-URI semantics. An actual adapter must implement token filtering, requested configuration types, finite image targets and explicit authorization. This is not a Profile T, M or native-device wrapper."
    });
    return output;
}

export { generateVocabulary } from "./vocabulary.js";
