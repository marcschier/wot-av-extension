"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");
const { SourceFault, demand } = require("./fault.cjs");

const OPERATIONS = Object.freeze({
    profiles: "Media2Binding_GetProfiles_95aacf693b24",
    snapshot: "Media2Binding_GetSnapshotUri_c14d66eeeeff"
});
const REGISTRY_DIGEST = "3410bc34844a3f718cde6964365b2f8e9e617f8f30e13b224e93a7768ab3defd";
const WSDL_SHA256 = "61af80d4056a9bd0d98b024a8f5601e8c4d4cfa8a3fe2a9abb182c1e026cc305";

function loadCanonical({ dependencyAnchor, bindingEntry } = {}) {
    const load = dependencyAnchor ? createRequire(path.resolve(dependencyAnchor)) : require;
    let binding, modelApi, core, http, streams, Ajv, addFormats;
    try {
        binding = load(bindingEntry ?? path.resolve(__dirname, "..", "..", "reference-runtime", "dist", "index.js"));
        modelApi = load(path.join(path.dirname(bindingEntry
            ? path.resolve(bindingEntry) : path.resolve(__dirname, "..", "..", "reference-runtime", "dist", "index.js")),
        "catalog", "semantic-adapter.js"));
        core = load("@node-wot/core");
        http = load("@node-wot/binding-http");
        streams = createRequire(load.resolve("@node-wot/core"))("web-streams-polyfill");
        Ajv = load("ajv/dist/2020").default;
        addFormats = load("ajv-formats");
        demand(load("@node-wot/core/package.json").version === "0.9.2"
            && load("@node-wot/binding-http/package.json").version === "0.9.2",
        "MissingDependency", "GetProfiles");
    } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
        throw new SourceFault("MissingDependency", "GetProfiles");
    }
    const catalog = binding.loadPackagedCatalog();
    const schema = binding.readPackagedArtifact("payloads.schema.json");
    demand(catalog.operations.length === 579 && catalog.registryDigest === REGISTRY_DIGEST,
        "IdentityChanged", "GetProfiles");
    const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: true });
    addFormats(ajv);
    const contracts = {};
    for (const [name, id] of Object.entries(OPERATIONS)) {
        const descriptor = catalog.operations.find(value => value.id === id);
        demand(descriptor?.source.sha256 === WSDL_SHA256 && descriptor.mappingSupport === "compiled",
            "IdentityChanged", name === "profiles" ? "GetProfiles" : "GetSnapshotUri");
        const validators = {};
        for (const direction of ["input", "output"]) {
            const definition = `${direction}_${id}`;
            demand(schema.$defs[definition]?.["onvif:source"]?.sha256 === WSDL_SHA256,
                "IdentityChanged", descriptor.operation);
            const validate = ajv.compile({
                $schema: "https://json-schema.org/draft/2020-12/schema",
                $defs: schema.$defs, $ref: `#/$defs/${definition}`
            });
            validators[direction] = value => {
                demand(validate(value), direction === "input" ? "InvalidSelection" : "SourceFailure", descriptor.operation);
                try { binding.encodeElement(direction === "input" ? descriptor.request : descriptor.response, value, catalog.xml); }
                catch (error) {
                    if (error?.name !== "OnvifError") throw error;
                    throw new SourceFault(direction === "input" ? "InvalidSelection" : "SourceFailure", descriptor.operation);
                }
                return value;
            };
        }
        contracts[name] = { ...validators, descriptor };
    }
    return {
        ...contracts, ...core, ...http, ReadableStream: streams.ReadableStream,
        createSemanticAdapterTd({ id, title, modelId, origin, evidence }) {
            const operations = Object.values(contracts).map(({ descriptor }) => ({
                bindingQName: descriptor.bindingQName, portTypeQName: descriptor.portTypeQName,
                operation: descriptor.operation
            }));
            return modelApi.deriveAdapterTd(catalog, {
                id, modelId, title, operations, evidence,
                bindingForms: operations.map((operation, index) => ({
                    operation,
                    forms: [{
                        href: origin + "/" + encodeURIComponent(id) + "/actions/" + Object.values(OPERATIONS)[index],
                        op: "invokeaction", contentType: "application/json", "htv:methodName": "POST",
                        security: ["control"]
                    }]
                })),
                securityDefinitions: {
                    control: { scheme: "bearer", in: "header" }, image: { scheme: "bearer", in: "header" }
                },
                security: ["control"]
            });
        },
        registryDigest: catalog.registryDigest, operationCount: catalog.operations.length, schemaId: schema.$id,
        sourcePin: { sha256: WSDL_SHA256, commit: catalog.sourcePins.baseline.commit }
    };
}

module.exports = { loadCanonical, OPERATIONS, REGISTRY_DIGEST, WSDL_SHA256 };
