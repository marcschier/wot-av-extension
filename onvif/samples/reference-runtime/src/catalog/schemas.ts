import { occurs, resolveType, typeAlternatives } from "../xml/descriptors.js";
import { decodeSimple } from "../xml/simple-values.js";
import type {
    AttributeDescriptor, ComplexType, ElementDescriptor, Particle, SimpleType, TypeDescriptor, XmlRegistry
} from "../xml/types.js";
import type { CanonicalCatalog, CompiledOperation } from "./compiler.js";
import { digest } from "./sources.js";

export const ONVIF_NAMESPACE = "https://example.org/wot/onvif#";
export const ONVIF_BASE = "https://example.org/wot/onvif";
export const ONVIF_CONTEXT = `${ONVIF_BASE}/context/v0.1`;
export const TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1";
export const PAYLOAD_SCHEMA = `${ONVIF_BASE}/schemas/payloads.schema.json`;
export type Schema = Record<string, unknown>;

export function definitionKey(id: string): string { return `t_${digest(id).slice(0, 24)}`; }
export function typeSchemaUri(id: string): string { return `${PAYLOAD_SCHEMA}#/$defs/${definitionKey(id)}`; }
export function operationSchemaKey(operation: CompiledOperation, direction: "input" | "output"): string {
    return `${direction}_${operation.id}`;
}
export function operationSchemaUri(operation: CompiledOperation, direction: "input" | "output"): string {
    return `${PAYLOAD_SCHEMA}#/$defs/${operationSchemaKey(operation, direction)}`;
}
export function elementSchemaKey(element: ElementDescriptor): string {
    const { name: _name, ...shape } = element;
    return `e_${digest(shape).slice(0, 24)}`;
}
export function elementSchemaUri(element: ElementDescriptor): string {
    return `${PAYLOAD_SCHEMA}#/$defs/${elementSchemaKey(element)}`;
}

const unsupported = (reason: string): Schema => ({ not: true, "onvif:unsupported": reason });
const qnameSchema: Schema = {
    type: "object",
    properties: { namespace: { type: "string" }, localName: { type: "string", minLength: 1, pattern: "^[^\\s:]+$" } },
    required: ["namespace", "localName"],
    additionalProperties: false,
    "onvif:nativeConstraints": ["localName must be an XML NCName; the canonical codec validates Unicode XML name characters."]
};
const namespacesSchema: Schema = { type: "object", additionalProperties: { type: "string" } };
const xmlReference: Schema = { $ref: "#/$defs/xmlElement" };
interface SchemaGraph { readonly elements: Map<string, Schema>; }

function boundedDigits(max: string): string {
    const terms: string[] = ["0"];
    if (max.length > 1) terms.push(`[1-9][0-9]{0,${max.length - 2}}`);
    for (let index = 0; index < max.length; index++) {
        const digit = Number(max[index]);
        const lower = index === 0 ? 1 : 0;
        if (digit <= lower) continue;
        const prefix = max.slice(0, index);
        const interval = lower === digit - 1 ? String(lower) : `[${lower}-${digit - 1}]`;
        const suffix = max.length - index - 1;
        terms.push(`${prefix}${interval}${suffix ? `[0-9]{${suffix}}` : ""}`);
    }
    terms.push(max);
    return `(?:${terms.join("|")})`;
}

function scalarSchema(type: Extract<SimpleType, { kind: "scalar" }>): Schema {
    switch (type.type) {
        case "boolean": return { type: "boolean" };
        case "int32": return { type: "integer", minimum: -2147483648, maximum: 2147483647 };
        case "uint32": return { type: "integer", minimum: 0, maximum: 4294967295 };
        case "int64": return { type: "string", maxLength: 4096,
            pattern: `^(?:\\+?0*${boundedDigits("9223372036854775807")}|-0*${boundedDigits("9223372036854775808")})$` };
        case "uint64": return { type: "string", maxLength: 4096,
            pattern: `^(?:\\+?0*${boundedDigits("18446744073709551615")}|-0+)$` };
        case "integer": return { type: "string", pattern: "^[+-]?[0-9]+$", maxLength: 4096 };
        case "decimal": return { type: "string", pattern: "^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)$" };
        case "float": case "double": return { type: "string",
            pattern: "^(?:-?INF|NaN|[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$" };
        case "QName": return { ...qnameSchema, "onvif:canonicalType": "XMLQName" };
        case "hexBinary": return { type: "string", pattern: "^(?:[0-9a-fA-F]{2})*$", contentEncoding: "base16" };
        case "base64Binary": return { type: "string",
            pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
            contentEncoding: "base64", "onvif:nativeConstraints": ["Canonical base64 padding bits are checked by the codec."] };
        case "dateTime": return { type: "string",
            pattern: "^-?[0-9]{4,}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$",
            "onvif:nativeConstraints": ["XSD 1.0 calendar/year/timezone rules; timezone absence and sub-millisecond precision are preserved."] };
        case "duration": return { type: "string",
            pattern: "^-?P(?=[0-9]|T[0-9])(?:[0-9]+Y)?(?:[0-9]+M)?(?:[0-9]+D)?(?:T(?=[0-9])(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+(?:\\.[0-9]+)?S)?)?$" };
        case "date": case "time": case "gYearMonth": case "gYear": case "gMonthDay": case "gDay": case "gMonth":
            return { type: "string", minLength: 1, "onvif:nativeConstraints": [`XSD ${type.type} lexical/calendar rules are checked by the codec, not an RFC 3339 format coercion.`] };
        case "normalizedString": return { type: "string", pattern: "^[^\\t\\r\\n]*$" };
        case "token": return { type: "string", pattern: "^(?:[^ \\t\\r\\n]+(?: [^ \\t\\r\\n]+)*)?$" };
        case "language": return { type: "string", pattern: "^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$" };
        case "ID": return { type: "string", minLength: 1,
            "onvif:nativeConstraints": ["XML NCName and document-wide ID uniqueness are checked by the codec."] };
        case "Name": case "NCName": case "NMTOKEN": return { type: "string", minLength: 1,
            "onvif:nativeConstraints": [`Unicode XML ${type.type} validation is performed by the canonical codec.`] };
        default: return { type: "string" };
    }
}

function scalarBase(type: SimpleType): Extract<SimpleType, { kind: "scalar" }> | undefined {
    return type.kind === "restriction" ? scalarBase(type.base) : type.kind === "scalar" ? type : undefined;
}

export function simpleSchema(type: SimpleType): Schema {
    if (type.kind === "scalar") return scalarSchema(type);
    if (type.kind === "list") return { type: "array", items: simpleSchema(type.item) };
    if (type.kind === "union") return { oneOf: type.members.map((member) => ({
        type: "object", properties: { $member: { const: member.name }, $value: simpleSchema(member.type) },
        required: ["$member", "$value"], additionalProperties: false
    })), "onvif:nativeConstraints": ["Union selection must preserve XSD first-match semantics."] };
    const schema = simpleSchema(type.base), scalar = scalarBase(type.base);
    const facets = type.facets;
    const constraints: string[] = [];
    const result: Schema = { ...schema, "onvif:xmlFacets": facets };
    const numeric = schema.type === "integer" || schema.type === "number";
    if (facets.enumeration !== undefined) {
        if (scalar !== undefined && !["int64", "uint64", "integer", "decimal", "float", "double", "dateTime",
            "date", "time", "duration", "gYearMonth", "gYear", "gMonth", "gDay", "gMonthDay", "hexBinary"].includes(scalar.type)) {
            result.enum = facets.enumeration.map((entry) => decodeSimple(type.base, entry.lexical, {
                kind: "element", name: { namespace: "", localName: "Enumeration" },
                namespaces: { ...entry.namespaces }, attributes: [], children: []
            }));
        } else constraints.push("Enumeration equality is in the native XSD value space, not lexical string equality.");
    }
    for (const [facet, name] of [["minInclusive", "minimum"], ["maxInclusive", "maximum"],
        ["minExclusive", "exclusiveMinimum"], ["maxExclusive", "exclusiveMaximum"]] as const) {
        const bound = facets[facet];
        if (bound === undefined) continue;
        if (numeric && Number.isSafeInteger(Number(bound))) result[name] = Number(bound);
        else if (scalar?.type === "integer" && facet === "minInclusive" && ["0", "1"].includes(bound)) {
            result.pattern = bound === "0" ? "^(?:\\+?[0-9]+|-0+)$" : "^\\+?0*[1-9][0-9]*$";
        } else constraints.push(`${facet}=${bound} requires an exact native value-space comparison.`);
    }
    const list = schema.type === "array";
    const binary = scalar?.type === "hexBinary" || scalar?.type === "base64Binary";
    for (const [facet, min, max] of [["length", true, true], ["minLength", true, false], ["maxLength", false, true]] as const) {
        const length = facets[facet];
        if (length === undefined) continue;
        if (binary) { constraints.push(`${facet} counts decoded octets, not encoded characters.`); continue; }
        if (min) result[list ? "minItems" : "minLength"] = length;
        if (max) result[list ? "maxItems" : "maxLength"] = length;
    }
    if (facets.whiteSpace !== undefined) constraints.push(`Native whiteSpace=${facets.whiteSpace}; defaults are not fabricated from missing observations.`);
    if (facets.patterns !== undefined) constraints.push("The bounded source-qualified XSD pattern validator is required. XSD name-class subtraction, whole-value matching and '.' are not JavaScript regex substitution.");
    if (constraints.length) result["onvif:nativeConstraints"] = [...(Array.isArray(schema["onvif:nativeConstraints"])
        ? schema["onvif:nativeConstraints"] : []), ...constraints];
    return result;
}

function attributeSchema(attribute: AttributeDescriptor): Schema {
    return { ...(attribute.type.kind === "unsupported" ? unsupported(attribute.type.feature) : simpleSchema(attribute.type)),
        "onvif:xmlQName": attribute.name, "onvif:xmlKind": "attribute",
        ...(attribute.defaultLexical === undefined ? {} : { "onvif:xmlDefault": attribute.defaultLexical }),
        ...(attribute.fixedLexical === undefined ? {} : { "onvif:xmlFixed": attribute.fixedLexical }) };
}

function attributesSchema(type: ComplexType | undefined): { properties: Record<string, unknown>; required: string[] } {
    const properties: Record<string, unknown> = Object.create(null), required: string[] = [];
    if (type?.attributes?.length) {
        const fields = Object.fromEntries(type.attributes.map((attribute) => [attribute.key, attributeSchema(attribute)]));
        const needed = type.attributes.filter((attribute) => attribute.required).map((attribute) => attribute.key);
        properties.$attributes = { type: "object", properties: fields, additionalProperties: false,
            ...(needed.length ? { required: needed } : {}) };
        if (needed.length) required.push("$attributes");
    }
    if (type?.anyAttributes) {
        properties.$anyAttributes = { type: "array", items: { $ref: "#/$defs/xmlAttribute" },
            "onvif:xmlWildcard": type.attributeWildcard ?? {} };
        properties.$namespaces = namespacesSchema;
    }
    return { properties, required };
}

function typeConstraint(typeName: ElementDescriptor["typeQName"], required = false): Schema {
    return { properties: { $type: typeName === undefined ? unsupported("No declared xsi:type selection")
        : { const: typeName } }, ...(required ? { required: ["$type"] } : {}) };
}

export function elementSchema(element: ElementDescriptor, registry: XmlRegistry, graph?: SchemaGraph, shared = false): Schema {
    if (graph !== undefined && !shared) {
        const key = elementSchemaKey(element);
        if (!graph.elements.has(key)) {
            graph.elements.set(key, { not: true });
            graph.elements.set(key, elementSchema(element, registry, graph, true));
        }
        return { $ref: `#/$defs/${key}`, "onvif:xmlQName": element.name, "onvif:xmlKind": "element" };
    }
    if (element.unsupported?.length) return unsupported(element.unsupported.join("; "));
    const variants = [{ type: element.type, name: element.typeQName, selected: false },
        ...typeAlternatives(element, registry).map((entry) => ({ type: entry.type, name: entry.name, selected: true }))];
    const schemas: Schema[] = [];
    for (const variant of variants) {
        const type = resolveType(variant.type, registry);
        if (type.kind === "unsupported") { schemas.push(unsupported(type.feature)); continue; }
        const schema = typeSchema(variant.type, registry, graph);
        if (type.kind === "opaque") { schemas.push(schema); continue; }
        const annotation = typeConstraint(variant.name, variant.selected);
        if (type.kind === "complex") schemas.push({ allOf: [schema, annotation] });
        else {
            if (!variant.selected) schemas.push(schema);
            schemas.push({
                type: "object", properties: { $value: schema, $nil: { const: false },
                    $type: variant.name === undefined ? unsupported("Unknown xsi:type") : { const: variant.name } },
                required: ["$value", ...(variant.selected ? ["$type"] : [])],
                ...(variant.selected ? {} : { anyOf: [{ required: ["$nil"] }, { required: ["$type"] }] }),
                additionalProperties: false
            });
        }
        const attributes = attributesSchema(type.kind === "complex" ? type : undefined);
        const typeProperty = variant.name === undefined ? unsupported("Unknown xsi:type") : { const: variant.name };
        if (element.nillable) schemas.push({
            type: "object", properties: { ...attributes.properties, $type: typeProperty, $nil: { const: true } },
            required: ["$nil", ...attributes.required, ...(variant.selected ? ["$type"] : [])], additionalProperties: false
        });
        if (element.defaultLexical !== undefined) schemas.push({
            type: "object", properties: { ...attributes.properties, $type: typeProperty, $nil: { const: false }, $default: { const: true } },
            required: ["$default", ...attributes.required, ...(variant.selected ? ["$type"] : [])], additionalProperties: false,
            "onvif:xmlDefault": element.defaultLexical
        });
    }
    return { ...(schemas.length === 1 ? schemas[0] : { oneOf: schemas }), ...(shared ? {} : { "onvif:xmlQName": element.name }),
        "onvif:xmlKind": "element",
        ...(element.unique === undefined ? {} : {
            "onvif:nativeConstraints": [{ kind: "unique", constraints: element.unique,
                rule: "Namespace-aware xs:unique selectors, field value spaces and per-element scope are checked by the canonical value algorithm, not JSON Schema uniqueItems." }] }),
        ...(element.typeQName === undefined ? {} : { "onvif:xmlTypeQName": element.typeQName }),
        ...(element.type.kind === "ref" ? { "onvif:canonicalType": element.type.ref } : {}) };
}

function sequenceSchema(sequence: readonly Particle[], registry: XmlRegistry, graph?: SchemaGraph): { properties: Record<string, unknown>; required: string[] } {
    const properties: Record<string, unknown> = Object.create(null), required: string[] = [];
    for (const particle of sequence) {
        const { min, max, repeated } = occurs(particle);
        let schema: Schema;
        if (particle.kind === "element") schema = elementSchema(particle.element, registry, graph);
        else if (particle.kind === "choice") schema = { oneOf: particle.alternatives.map((option) => {
            const selected = "element" in option ? elementSchema(option.element, registry, graph)
                : "any" in option ? { ...xmlReference, "onvif:xmlWildcard": option.any,
                    "onvif:nativeConstraints": ["Explicit expanded element QNames take priority over compatible wildcard alternatives."] }
                    : { type: "object", ...sequenceSchema(option.sequence, registry, graph), additionalProperties: false };
            return { type: "object", properties: { $case: { const: option.key }, $value: selected },
                required: ["$case", "$value"], additionalProperties: false };
        }) };
        else if (particle.kind === "group") schema = { type: "object", ...sequenceSchema(particle.sequence, registry, graph), additionalProperties: false };
        else schema = { ...xmlReference, "onvif:xmlWildcard": {
            ...(particle.namespaces === undefined ? {} : { namespaces: particle.namespaces }),
            ...(particle.notNamespaces === undefined ? {} : { notNamespaces: particle.notNamespaces }),
            processContents: particle.processContents ?? "skip"
        } };
        if (particle.kind !== "element" || repeated) {
            schema = { type: "array", items: schema, minItems: min, ...(max === Infinity ? {} : { maxItems: max }) };
        }
        properties[particle.key] = schema;
        if (min > 0) required.push(particle.key);
    }
    return { properties, required };
}

export function typeSchema(type: TypeDescriptor, registry: XmlRegistry, graph?: SchemaGraph): Schema {
    if (type.kind === "ref") return { $ref: `#/$defs/${definitionKey(type.ref)}` };
    if (type.kind === "unsupported") return unsupported(type.feature);
    if (type.kind === "opaque") return { ...xmlReference,
        "onvif:nativeConstraints": ["Only source-declared xs:anyType is represented as a complete namespace-aware XML element."] };
    if (type.kind !== "complex") return simpleSchema(type);
    if (type.abstract) return unsupported("An abstract XML type requires a concrete declared xsi:type selection.");
    const attributes = attributesSchema(type), sequence = type.mixed ? { properties: {}, required: [] }
        : sequenceSchema(type.sequence ?? [], registry, graph);
    return { type: "object", properties: {
        ...attributes.properties, ...sequence.properties, $type: qnameSchema, $nil: { const: false },
        ...(type.mixed ? { $children: { type: "array", items: { $ref: "#/$defs/xmlNode" }, maxItems: 20000 },
            $namespaces: namespacesSchema } : {}),
        ...(type.text === undefined ? {} : { $value: simpleSchema(type.text) })
    }, required: [...attributes.required, ...sequence.required, ...(type.text === undefined ? [] : ["$value"]),
        ...(type.mixed ? ["$children", "$namespaces"] : [])],
    ...(type.mixed ? { "onvif:nativeConstraints": ["Ordered mixed $children retain text, comments, processing instructions and XML children; the codec validates the declared child content model and wildcard namespaces."] } : {}),
    additionalProperties: false };
}

export function generatePayloadSchema(catalog: CanonicalCatalog): Schema {
    const graph: SchemaGraph = { elements: new Map() };
    const definitions: Record<string, Schema> = {
        xmlQName: qnameSchema,
        xmlAttribute: {
            type: "object", properties: { name: { $ref: "#/$defs/xmlQName" }, value: { type: "string" }, prefix: { type: "string" } },
            required: ["name", "value"], additionalProperties: false
        },
        xmlElement: {
            type: "object", properties: { kind: { const: "element" }, name: { $ref: "#/$defs/xmlQName" },
                prefix: { type: "string" }, namespaces: namespacesSchema,
                attributes: { type: "array", items: { $ref: "#/$defs/xmlAttribute" }, maxItems: 128 },
                children: { type: "array", items: { $ref: "#/$defs/xmlNode" }, maxItems: 20000 } },
            required: ["kind", "name", "namespaces", "attributes", "children"], additionalProperties: false
        },
        xmlNode: { oneOf: [
            { $ref: "#/$defs/xmlElement" },
            { type: "object", properties: { kind: { enum: ["text", "comment"] }, value: { type: "string" } },
                required: ["kind", "value"], additionalProperties: false },
            { type: "object", properties: { kind: { const: "processing-instruction" }, target: { type: "string", minLength: 1 }, value: { type: "string" } },
                required: ["kind", "target", "value"], additionalProperties: false }
        ] }
    };
    for (const [id, type] of Object.entries(catalog.xml.types)) {
        const key = definitionKey(id);
        if (Object.hasOwn(definitions, key)) throw new Error(`Schema ID collision: ${id}`);
        definitions[key] = { ...typeSchema(type, catalog.xml, graph), "onvif:canonicalType": id };
    }
    for (const operation of catalog.operations) {
        for (const direction of ["input", "output"] as const) {
            const element = direction === "input" ? operation.request : operation.response;
            definitions[operationSchemaKey(operation, direction)] = {
                ...(operation.mappingSupport === "unsupported" ? unsupported(operation.issues.map((issue) => issue.message).join("; "))
                    : element === null ? unsupported("The native WSDL has no response message") : elementSchema(element, catalog.xml, graph)),
                title: direction === "input" ? operation.input.className : operation.output?.className ?? `${operation.operation} (one-way)`,
                "onvif:source": { sourceId: operation.sourceId, locator: operation.source.locator, sha256: operation.source.sha256 }
            };
        }
    }
    for (const element of Object.values(catalog.xml.elements)) elementSchema(element, catalog.xml, graph);
    for (const [key, schema] of graph.elements) definitions[key] = schema;
    return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: PAYLOAD_SCHEMA,
        title: "Canonical ONVIF payload definition library", not: true,
        $comment: "Select an operation or type definition by fragment. JSON Schema checks structure; the canonical codec also checks explicitly annotated native constraints.",
        "onvif:registryDigest": catalog.registryDigest, $defs: definitions };
}

function family(type: TypeDescriptor, registry: XmlRegistry): string | undefined {
    const resolved = resolveType(type, registry);
    if (resolved.kind === "unsupported") return undefined;
    if (resolved.kind === "restriction") return family(resolved.base, registry);
    if (resolved.kind === "list") return "array";
    if (resolved.kind !== "scalar") return "object";
    if (resolved.type === "boolean") return "boolean";
    if (resolved.type === "int32" || resolved.type === "uint32") return "integer";
    return resolved.type === "QName" ? "object" : "string";
}

/**
 * TD 1.1 has no JSON Schema $ref. The binding extension names the full schema
 * instead of expanding recursive graphs or pretending that an empty schema is complete.
 */
export function dataSchema(element: ElementDescriptor, registry: XmlRegistry, uri: string): Schema {
    const type = family(element.type, registry);
    const base: Schema = {
        "@type": "onvif:CanonicalXmlValue", "onvif:sourceDataSchema": uri,
        "onvif:xmlQName": element.name,
        ...(element.typeQName === undefined ? {} : { "onvif:xmlTypeQName": element.typeQName }),
        ...(element.type.kind === "ref" ? { "onvif:canonicalType": element.type.ref } : {}),
        "onvif:validation": "sourceDataSchema-and-canonical-codec"
    };
    if (type === undefined) return { ...base, "onvif:unsupported": "The required canonical XML graph is not implemented." };
    if (type !== "object") return { ...base, oneOf: [{ type }, { type: "object" }] };
    return { ...base, type };
}
