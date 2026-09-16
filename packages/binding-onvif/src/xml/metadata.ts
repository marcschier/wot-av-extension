import { OnvifError } from "../binding/errors.js";
import { decodeElement } from "./mapper.js";
import { parseXml, type XmlLimits } from "./parser.js";
import type { CanonicalValue, XmlRegistry } from "./types.js";

export const METADATA_STREAM = "{http://www.onvif.org/ver10/schema}MetadataStream";

export function decodeMetadata(
    content: string | Uint8Array, registry: XmlRegistry, limits: Partial<XmlLimits> = {}
): CanonicalValue {
    const descriptor = registry.elements[METADATA_STREAM];
    if (descriptor === undefined) throw new OnvifError("UnsupportedCapability", "The local XmlRegistry has no MetadataStream global root");
    return decodeElement(descriptor, parseXml(content, limits), registry);
}
