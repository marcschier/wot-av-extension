import { BINDING_NAME } from "../binding/forms.js";
import { defineOperationRegistry, operationKey } from "../binding/registry.js";
import { canonicalSubscription, EVENT_BINDING, resolveSubscription } from "../events/contracts.js";
import type { CanonicalCatalog, CompiledOperation } from "./compiler.js";
import { operationReferenceData, resourceKinds, safeReadAliases } from "./mappings.js";
import type { RequirementAtom, RequirementIndex } from "./requirements.js";
import {
    dataSchema, elementSchemaUri, ONVIF_BASE, ONVIF_CONTEXT, ONVIF_NAMESPACE, operationSchemaUri, TD_CONTEXT, type Schema
} from "./schemas.js";
import { digest } from "./sources.js";

export const OPERATION_MODEL = `${ONVIF_BASE}/models/operations.tm.json`;
export const DEVICE_MODEL = `${ONVIF_BASE}/models/DeviceThing.tm.json`;
export const RESOURCE_MODEL = `${ONVIF_BASE}/models/ResourceThing.tm.json`;
export const NATIVE_MODEL = `${ONVIF_BASE}/models/NativeThing.tm.json`;
export const PULLPOINT_MODEL = `${ONVIF_BASE}/models/events/PullPointSubscription.tm.json`;
export const context = (): [typeof TD_CONTEXT, string] => [TD_CONTEXT, ONVIF_CONTEXT];
export const profileModelId = (profile: string, edition: string): string =>
    `${ONVIF_BASE}/models/profiles/Profile-${encodeURIComponent(profile)}-${encodeURIComponent(edition)}.tm.json`;
export const clientManifestId = (profile: string, edition: string): string =>
    `${ONVIF_BASE}/models/clients/Profile-${encodeURIComponent(profile)}-${encodeURIComponent(edition)}.json`;
export const resourceModelId = (kind: string): string =>
    `${ONVIF_BASE}/models/resources/${encodeURIComponent(kind)}Thing.tm.json`;

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

export function operationImports(ids: readonly string[]): Record<string, Schema> {
    return Object.fromEntries([...new Set(ids)].sort().map((id) => [id, { "tm:ref": `${OPERATION_MODEL}#/actions/${id}` }]));
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
    output.set("models/NativeThing.tm.json", { ...model(NATIVE_MODEL, "Native ONVIF endpoint"),
        "onvif:registryDigest": catalog.registryDigest,
        "onvif:sourcePins": { lockDigest: catalog.sourcePins.lockDigest, baseline: catalog.sourcePins.baseline },
        "onvif:authorship": "Project-authored mapping of pinned ONVIF contracts; not an ONVIF publication or certification.",
        description: "Native HTTP(S) SOAP Forms are filled only with observed endpoint addresses and explicit caller security policy. This model starts no server or gateway." });
    output.set("models/DeviceThing.tm.json", { ...model(DEVICE_MODEL, "ONVIF device", NATIVE_MODEL),
        "onvif:modelClass": "onvif:DeviceThing",
        description: "An observed native device identity. Advertised profile claims, observed capabilities, registered evidence, and measured runtime support remain separate." });
    output.set("models/ResourceThing.tm.json", { ...model(RESOURCE_MODEL, "Native ONVIF resource", NATIVE_MODEL),
        "onvif:modelClass": "onvif:ResourceThing",
        "onvif:nativeIdentity": ["device EPR", "service namespace", "resource kind", "ordered parent-kind/token path", "native token"] });
    output.set("models/operations.tm.json", { ...model(OPERATION_MODEL, "Native ONVIF operation definitions", NATIVE_MODEL),
        actions: Object.fromEntries(catalog.operations.map((operation) => [operation.id, actionTemplate(operation, catalog, "{{xaddr}}")])),
        "tm:optional": catalog.operations.map((operation) => `/actions/${operation.id}`),
        description: "Each bindingQName/portTypeQName/operation definition occurs once. Other TMs import these affordances; no device is asserted to implement the complete library." });
    output.set("models/events/PullPointSubscription.tm.json", {
        ...model(PULLPOINT_MODEL, "Native ONVIF PullPoint Event", NATIVE_MODEL),
        events: { notifications: eventTemplate(catalog, "{{xaddr}}") },
        "tm:optional": ["/events/notifications"],
        description: "Opt-in lifecycle template, not evidence that a device supports event subscription, filters or WS-BaseNotification Renew."
    });
    for (const service of catalog.services) {
        output.set(`models/services/${service.id}.tm.json`, {
            ...model(`${ONVIF_BASE}/models/services/${service.id}.tm.json`, `${service.className} native service`, DEVICE_MODEL),
            actions: operationImports(service.operationIds), "tm:optional": service.operationIds.map((id) => `/actions/${id}`),
            "onvif:serviceNamespace": service.namespace, "onvif:source": { sourceId: service.sourceId, line: service.line, sha256: service.sha256 },
            "onvif:sourceGroup": service.group,
            "onvif:nativeIdentity": { bindingQName: service.bindingQName, portTypeQName: service.portTypeQName },
            description: "Source contract template, not a service-presence or optional-operation claim. A concrete wsdl:service is not required."
        });
    }
    for (const resource of resourceKinds(catalog)) {
        output.set(`models/resources/${resource.kind}Thing.tm.json`, {
            ...model(resourceModelId(resource.kind), `ONVIF ${resource.kind}`, RESOURCE_MODEL),
            "onvif:modelClass": `onvif:${resource.kind}Thing`, "onvif:resourceKind": resource.kind,
            "onvif:nativeIdentity": { nativeTypeIds: resource.nativeTypeIds, parentKinds: resource.parentKinds },
            description: resource.description
        });
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
        output.set(`models/features/${id}.tm.json`, {
            ...model(`${ONVIF_BASE}/models/features/${id}.tm.json`, key, DEVICE_MODEL),
            actions: operationImports(operations), "tm:optional": optionalActions(rows, index, operations),
            "onvif:requirements": rows.map((row) => row.id), "onvif:requirementsDigest": index.digest,
            "onvif:requirementSemantics": "Source requiredness, enclosing feature conditions, and alternative groups remain in the requirement index; runtime evidence is separate."
        });
    }
    for (const edition of index.profileEditions.filter((entry) => entry.publicationState === "released")) {
        const profile = String(edition.profileId), version = String(edition.edition);
        const rows = index.requirements.filter((row) => row.profile === profile && row.edition === version);
        const device = rows.filter((row) => row.role === "device"), client = rows.filter((row) => row.role === "client");
        const operations = idsFor(device, index);
        output.set(`models/profiles/Profile-${profile}-${version}.tm.json`, {
            ...model(profileModelId(profile, version), `ONVIF Profile ${profile} ${version} device requirements`, DEVICE_MODEL),
            actions: operationImports(operations), "tm:optional": optionalActions(device, index, operations),
            "onvif:profileEdition": edition, "onvif:requirements": device.map((row) => row.id),
            "onvif:requirementsDigest": index.digest, "onvif:clientRequirements": clientManifestId(profile, version),
            "onvif:obligationGroups": index.obligationGroups.filter((group) => group.profile === profile && group.edition === version && group.role === "device"),
            description: "A role-specific requirement wrapper, never automatically the immediate type of a partially inspected device. Conditional/alternative obligations require evidence; model derivation is not conformance."
        });
        output.set(`models/clients/Profile-${profile}-${version}.json`, {
            id: clientManifestId(profile, version), kind: "client-requirement-manifest", profile, edition: version, role: "client",
            source: edition, requirements: client.map((row) => row.id), requirementsDigest: index.digest,
            obligationGroups: index.obligationGroups.filter((group) => group.profile === profile && group.edition === version && group.role === "client"),
            runtimeGate: "Client consumption, decoding, concurrency, lifecycle, and process evidence are not established by a device TD.",
            createsClientThing: false
        });
    }
    const aliases = safeReadAliases(catalog);
    output.set("models/features/SafeReads.tm.json", {
        ...model(`${ONVIF_BASE}/models/features/SafeReads.tm.json`, "Explicit repeatable read Action aliases", DEVICE_MODEL),
        actions: Object.fromEntries(aliases.map((alias) => [alias.id, {
            "tm:ref": `${OPERATION_MODEL}#/actions/${alias.operationId}`, safe: true, idempotent: true, "onvif:safeRead": alias
        }])), "tm:optional": aliases.map((alias) => `/actions/${alias.id}`),
        description: "Opt-in invokable aliases from a fixed reviewed whitelist, not a Get-name heuristic or native Property implementation. Stateful search-result drains are excluded."
    });
    return output;
}

export function generateVocabulary(catalog: CanonicalCatalog): { terms: Schema; context: Schema; ontology: string } {
    const classes = ["NativeThing", "DeviceThing", "ResourceThing", "CanonicalXmlValue", "XMLQName", "UsernameTokenSecurityScheme", "MutualTlsSecurityScheme",
        ...resourceKinds(catalog).map((resource) => `${resource.kind}Thing`)];
    const jsonTerms = ["operation", "source", "sourcePins", "profileClaims", "profileEdition", "observedServices", "capabilityEvidence",
        "conformanceEvidence", "resourceIdentity", "nativeIdentity", "requirements", "obligationGroups", "safeRead", "xmlQName",
        "xmlTypeQName", "xmlFacets", "xmlWildcard", "nativeConstraints", "diagnostics", "profileAssessments", "inputBindings", "readOutcomes", "subscription"];
    const iriTerms = ["sourceDataSchema", "clientRequirements", "serviceModels", "profileModels", "modelClass"];
    const literalTerms = ["binding", "soapAction", "registryDigest", "requirementsDigest", "projectionDigest", "canonicalType",
        "xmlKind", "xmlDefault", "xmlFixed", "validation", "unsupported", "mappingSupport", "runtimeStatus", "sourceGroup",
        "serviceNamespace", "resourceKind", "authorship", "requirementSemantics", "claimSemantics"];
    const definitions: Record<string, unknown> = {
        "@version": 1.1, onvif: { "@id": ONVIF_NAMESPACE, "@prefix": true }
    };
    for (const term of jsonTerms) definitions[`onvif:${term}`] = { "@id": `${ONVIF_NAMESPACE}${term}`, "@type": "@json" };
    for (const term of iriTerms) definitions[`onvif:${term}`] = { "@id": `${ONVIF_NAMESPACE}${term}`, "@type": "@id" };
    for (const term of literalTerms) definitions[`onvif:${term}`] = `${ONVIF_NAMESPACE}${term}`;
    const terms = [
        ...classes.map((name) => ({ name, kind: "class", iri: `${ONVIF_NAMESPACE}${name}`,
            description: name === "XMLQName" ? "Expanded XML name, encoded exactly as namespace and localName, never a prefix-only string."
                : `Project mapping class ${name}; its use does not assert ONVIF certification.` })),
        ...[...jsonTerms, ...iriTerms, ...literalTerms].map((name) => ({ name, kind: "property", iri: `${ONVIF_NAMESPACE}${name}`,
            representation: jsonTerms.includes(name) ? "JSON literal" : iriTerms.includes(name) ? "IRI" : "literal",
            description: name === "sourceDataSchema" ? "IRI of the complete canonical JSON Schema definition; TD 1.1 alone cannot express recursive JSON Schema references."
                : name === "operation" ? "Complete bindingQName, portTypeQName and operation identity, resolved only in the pinned local registry."
                    : name === "xmlQName" ? "Exact expanded XML field name with namespace and localName."
                        : `Project-authored ${name} metadata. Native authorities and runtime evidence remain separate.` }))
    ];
    const ontology = [
        `@prefix onvif: <${ONVIF_NAMESPACE}> .`,
        "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "",
        ...terms.map((term) => `onvif:${term.name} a ${term.kind === "class" ? "rdfs:Class" : "rdf:Property"} ;\n    rdfs:label ${JSON.stringify(term.name)} ;\n    rdfs:comment ${JSON.stringify(term.description)} .\n`)
    ].join("\n");
    return { terms: { namespace: ONVIF_NAMESPACE, context: ONVIF_CONTEXT, version: "0.1", provisional: true,
        authorship: "Project-owned additive ONVIF binding vocabulary; AV 0.2 is unchanged.", terms },
    context: { "@context": definitions }, ontology };
}
