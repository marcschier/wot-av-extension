import { OnvifError } from "../binding/errors.js";
import { defineOperationRegistry, type OperationDescriptor, type OperationRegistry } from "../binding/registry.js";
import { loadPackagedCatalog } from "../catalog/packaged.js";

export type MediaResolverKind = "media1" | "media2" | "replay";
export function mediaResolverKind(operation: OperationDescriptor): MediaResolverKind {
    const namespace = operation.request.name.namespace;
    const kind = namespace === "http://www.onvif.org/ver10/media/wsdl" ? "media1"
        : namespace === "http://www.onvif.org/ver20/media/wsdl" ? "media2"
            : namespace === "http://www.onvif.org/ver10/replay/wsdl" ? "replay" : undefined;
    const name = kind === "replay" ? "GetReplayUri" : "GetStreamUri";
    if (kind === undefined || operation.source.kind !== "generated" || !operation.source.sha256
        || !/^[a-f0-9]{64}$/u.test(operation.source.sha256) || operation.operation !== name
        || operation.request.name.localName !== name || operation.response?.name.localName !== `${name}Response`
        || operation.response.name.namespace !== namespace || operation.portTypeQName.namespace !== namespace
        || operation.bindingQName.namespace !== namespace) {
        throw new OnvifError("UnsupportedCapability", "Media requires a declared, generated Media1, Media2 or Replay URI operation");
    }
    return kind;
}

export function loadMediaRegistry(): OperationRegistry {
    const catalog = loadPackagedCatalog();
    const registry = defineOperationRegistry(catalog.operations, catalog.xml);
    if (registry.digest !== catalog.registryDigest) throw new OnvifError("InvalidRegistry", "Packaged media authority digest mismatch");
    for (const namespace of [
        "http://www.onvif.org/ver10/media/wsdl", "http://www.onvif.org/ver20/media/wsdl", "http://www.onvif.org/ver10/replay/wsdl"
    ]) {
        const operations = catalog.operations.filter((operation) => operation.portTypeQName.namespace === namespace
            && operation.operation === (namespace.includes("/replay/") ? "GetReplayUri" : "GetStreamUri"));
        if (operations.length !== 1 || operations[0] === undefined) throw new OnvifError("InvalidRegistry", "Packaged media resolver is not uniquely compiled");
        mediaResolverKind(operations[0]);
    }
    return registry;
}
