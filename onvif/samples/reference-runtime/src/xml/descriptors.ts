import { isRecord, OnvifError } from "../binding/errors.js";
import {
    EMPTY_XML_REGISTRY, isQName, type ElementDescriptor, type Occurrences, type Particle,
    type TypeDescriptor, type XmlRegistry
} from "./types.js";
import { assertSupportedXsdPattern } from "./xsd-patterns.js";

const scalars = new Set([
    "string", "boolean", "int32", "uint32", "int64", "uint64", "integer", "decimal",
    "hexBinary", "base64Binary", "dateTime", "QName", "float", "double", "duration",
    "date", "time", "gYearMonth", "gYear", "gMonthDay", "gDay", "gMonth",
    "normalizedString", "token", "language", "Name", "NCName", "NMTOKEN", "ID", "anyURI"
]);

function fail(): never {
    throw new OnvifError("InvalidRegistry", "Invalid or unsupported canonical XML descriptor");
}

function knownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
    if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
}

export function occurs(particle: Occurrences): { min: number; max: number; repeated: boolean } {
    const min = particle.minOccurs ?? 1;
    const max = particle.maxOccurs === "unbounded" ? Infinity : (particle.maxOccurs ?? 1);
    if (!Number.isSafeInteger(min) || min < 0 || (max !== Infinity && (!Number.isSafeInteger(max) || max < min))) fail();
    return { min, max, repeated: max > 1 };
}

export function assertElementDescriptor(value: unknown, depth = 0): asserts value is ElementDescriptor {
    if (depth > 64 || !isRecord(value) || !isQName(value.name)) fail();
    knownKeys(value, ["name", "type", "nillable", "types", "typeQName", "defaultLexical",
        "defaultNamespaces", "fixedLexical", "unsupported", "unique"]);
    if (value.nillable !== undefined && typeof value.nillable !== "boolean") fail();
    if (value.typeQName !== undefined && !isQName(value.typeQName)) fail();
    if (value.defaultLexical !== undefined && typeof value.defaultLexical !== "string") fail();
    if (value.fixedLexical !== undefined && typeof value.fixedLexical !== "string") fail();
    if (value.defaultNamespaces !== undefined && (!isRecord(value.defaultNamespaces)
        || Object.values(value.defaultNamespaces).some((namespace) => typeof namespace !== "string"))) fail();
    if (value.unsupported !== undefined && (!Array.isArray(value.unsupported)
        || value.unsupported.some((feature: unknown) => typeof feature !== "string" || !feature))) fail();
    assertType(value.type, depth);
    if (value.unique !== undefined) {
        if (!Array.isArray(value.unique) || value.unique.length > 128) fail();
        const nameTest = (test: unknown): void => {
            if (!isRecord(test)) fail();
            knownKeys(test, ["namespace", "localName"]);
            if (test.namespace !== null && typeof test.namespace !== "string") fail();
            if (test.localName !== null && !isQName({ namespace: "", localName: test.localName })) fail();
        };
        const paths = (list: unknown, selector: boolean): void => {
            if (!Array.isArray(list) || list.length === 0 || list.length > 128) fail();
            for (const path of list) {
                if (!isRecord(path) || typeof path.descendant !== "boolean" || !Array.isArray(path.elements)
                    || path.elements.length > 64) fail();
                knownKeys(path, ["descendant", "elements", "attribute"]);
                for (const step of path.elements) nameTest(step);
                if (path.attribute !== undefined) {
                    if (selector) fail();
                    nameTest(path.attribute);
                }
            }
        };
        for (const unique of value.unique) {
            if (!isRecord(unique) || !isQName(unique.name) || !Array.isArray(unique.fields)
                || unique.fields.length === 0 || unique.fields.length > 128) fail();
            knownKeys(unique, ["name", "selector", "fields"]);
            paths(unique.selector, true);
            for (const field of unique.fields) paths(field, false);
        }
    }
    if (value.types !== undefined) {
        if (!Array.isArray(value.types)) fail();
        const names = new Set<string>();
        for (const entry of value.types) {
            if (!isRecord(entry) || !isQName(entry.name)) fail();
            knownKeys(entry, ["name", "type"]);
            const key = JSON.stringify(entry.name);
            if (names.has(key)) fail();
            names.add(key);
            assertType(entry.type, depth + 1);
        }
    }
}

function assertSimple(value: unknown, depth = 0): void {
    if (depth > 64 || !isRecord(value)) fail();
    if (value.kind === "scalar" && scalars.has(String(value.type))) {
        knownKeys(value, ["kind", "type"]);
        return;
    }
    if (value.kind === "list") {
        knownKeys(value, ["kind", "item"]);
        assertSimple(value.item, depth + 1);
        return;
    }
    if (value.kind === "union" && Array.isArray(value.members) && value.members.length > 0) {
        knownKeys(value, ["kind", "members"]);
        const names = new Set<string>();
        for (const member of value.members) {
            if (!isRecord(member) || typeof member.name !== "string" || !member.name
                || names.has(member.name)) fail();
            names.add(member.name);
            knownKeys(member, ["name", "type"]);
            assertSimple(member.type, depth + 1);
        }
        return;
    }
    if (value.kind === "restriction") {
        knownKeys(value, ["kind", "base", "facets"]);
        assertSimple(value.base, depth + 1);
        if (!isRecord(value.facets)) fail();
        knownKeys(value.facets, ["enumeration", "minInclusive", "maxInclusive", "minExclusive",
            "maxExclusive", "length", "minLength", "maxLength", "whiteSpace", "patterns"]);
        if (value.facets.patterns !== undefined) {
            if (!Array.isArray(value.facets.patterns) || value.facets.patterns.length === 0) fail();
            for (const pattern of value.facets.patterns) {
                if (typeof pattern !== "string") fail();
                assertSupportedXsdPattern(pattern);
            }
        }
        for (const name of ["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"]) {
            if (value.facets[name] !== undefined && typeof value.facets[name] !== "string") fail();
        }
        for (const name of ["length", "minLength", "maxLength"]) {
            const bound = value.facets[name];
            if (bound !== undefined && (typeof bound !== "number" || !Number.isSafeInteger(bound) || bound < 0)) fail();
        }
        if (value.facets.whiteSpace !== undefined && !["preserve", "replace", "collapse"].includes(String(value.facets.whiteSpace))) fail();
        if (value.facets.enumeration !== undefined) {
            if (!Array.isArray(value.facets.enumeration) || value.facets.enumeration.length === 0) fail();
            for (const item of value.facets.enumeration) {
                if (!isRecord(item) || typeof item.lexical !== "string") fail();
                knownKeys(item, ["lexical", "namespaces"]);
                if (item.namespaces !== undefined && (!isRecord(item.namespaces)
                    || Object.values(item.namespaces).some((namespace) => typeof namespace !== "string"))) fail();
            }
        }
        return;
    }
    fail();
}

export function assertType(value: unknown, depth = 0): asserts value is TypeDescriptor {
    if (depth > 64 || !isRecord(value)) fail();
    if (value.kind === "unsupported") {
        knownKeys(value, ["kind", "feature"]);
        if (typeof value.feature !== "string" || !value.feature) fail();
        return;
    }
    if (value.kind === "opaque") { knownKeys(value, ["kind"]); return; }
    if (value.kind === "ref") {
        knownKeys(value, ["kind", "ref"]);
        if (typeof value.ref !== "string" || !value.ref || value.ref.length > 2048) fail();
        return;
    }
    if (value.kind !== "complex") { assertSimple(value); return; }
    knownKeys(value, ["kind", "abstract", "mixed", "text", "attributes", "anyAttributes", "attributeWildcard", "sequence"]);
    if (value.abstract !== undefined && typeof value.abstract !== "boolean") fail();
    if (value.mixed !== undefined && typeof value.mixed !== "boolean") fail();
    if (value.text !== undefined) {
        if (value.sequence !== undefined || value.mixed) fail();
        assertSimple(value.text);
    }
    if (value.anyAttributes !== undefined && typeof value.anyAttributes !== "boolean") fail();
    if (value.attributeWildcard !== undefined) {
        if (value.anyAttributes !== true) fail();
        assertWildcard(value.attributeWildcard);
    }
    if (value.attributes !== undefined) {
        if (!Array.isArray(value.attributes)) fail();
        const keys = new Set<string>();
        const names = new Set<string>();
        for (const attribute of value.attributes) {
            if (!isRecord(attribute) || typeof attribute.key !== "string" || !attribute.key
                || keys.has(attribute.key) || !isQName(attribute.name)) fail();
            knownKeys(attribute, ["key", "name", "type", "required", "defaultLexical", "fixedLexical"]);
            const name = JSON.stringify(attribute.name);
            if (names.has(name)) fail();
            names.add(name);
            keys.add(attribute.key);
            if (attribute.required !== undefined && typeof attribute.required !== "boolean") fail();
            if (attribute.defaultLexical !== undefined && typeof attribute.defaultLexical !== "string") fail();
            if (attribute.fixedLexical !== undefined && typeof attribute.fixedLexical !== "string") fail();
            if (isRecord(attribute.type) && attribute.type.kind === "unsupported") assertType(attribute.type, depth + 1);
            else assertSimple(attribute.type);
        }
    }
    if (value.sequence === undefined) return;
    assertSequence(value.sequence, depth);
}

function assertWildcard(value: unknown): void {
    if (!isRecord(value)) fail();
    knownKeys(value, ["namespaces", "notNamespaces", "processContents"]);
    for (const key of ["namespaces", "notNamespaces"]) {
        const namespaces = value[key];
        if (namespaces !== undefined && (!Array.isArray(namespaces)
            || namespaces.some((namespace: unknown) => typeof namespace !== "string"))) fail();
    }
    if (value.namespaces !== undefined && value.notNamespaces !== undefined) fail();
    if (value.processContents !== undefined && !["skip", "lax", "strict"].includes(String(value.processContents))) fail();
}

function assertSequence(value: unknown, depth: number): void {
    if (depth > 64 || !Array.isArray(value)) fail();
    const keys = new Set(["$attributes", "$anyAttributes", "$namespaces", "$nil", "$type", "$value", "$children"]);
    for (const particle of value) {
        if (!isRecord(particle) || typeof particle.key !== "string" || !particle.key || keys.has(particle.key)) fail();
        if (Object.keys(particle).some((key) => !["kind", "key", "minOccurs", "maxOccurs",
            ...(particle.kind === "element" ? ["element"] : particle.kind === "choice" ? ["alternatives"]
                : particle.kind === "group" ? ["sequence"] : ["namespaces", "notNamespaces", "processContents"])].includes(key))) fail();
        keys.add(particle.key);
        if (particle.minOccurs !== undefined && (typeof particle.minOccurs !== "number"
            || !Number.isSafeInteger(particle.minOccurs) || particle.minOccurs < 0)) fail();
        if (particle.maxOccurs !== undefined && particle.maxOccurs !== "unbounded"
            && (typeof particle.maxOccurs !== "number" || !Number.isSafeInteger(particle.maxOccurs)
                || particle.maxOccurs < (typeof particle.minOccurs === "number" ? particle.minOccurs : 1))) fail();
        if (particle.kind === "element") assertElementDescriptor(particle.element, depth + 1);
        else if (particle.kind === "choice" && Array.isArray(particle.alternatives) && particle.alternatives.length > 0) {
            const alternatives = new Set<string>();
            const names = new Set<string>();
            for (const alternative of particle.alternatives) {
                if (!isRecord(alternative) || typeof alternative.key !== "string" || alternatives.has(alternative.key)) fail();
                if (Object.keys(alternative).some((key) => !["key", "element", "sequence", "any"].includes(key))
                    || [alternative.element, alternative.sequence, alternative.any].filter((entry) => entry !== undefined).length !== 1) fail();
                alternatives.add(alternative.key);
                if (alternative.sequence !== undefined) {
                    if (alternative.element !== undefined) fail();
                    assertSequence(alternative.sequence, depth + 1);
                } else if (alternative.any !== undefined) {
                    assertWildcard(alternative.any);
                } else {
                    assertElementDescriptor(alternative.element, depth + 1);
                    const name = JSON.stringify(alternative.element.name);
                    if (names.has(name)) fail();
                    names.add(name);
                }
            }
        } else if (particle.kind === "group") {
            assertSequence(particle.sequence, depth + 1);
        } else if (particle.kind === "any") {
            const { kind: _kind, key: _key, minOccurs: _min, maxOccurs: _max, ...wildcard } = particle;
            assertWildcard(wildcard);
        } else fail();
    }
}

export function resolveType(type: TypeDescriptor, registry: XmlRegistry = EMPTY_XML_REGISTRY): Exclude<TypeDescriptor, { kind: "ref" }> {
    const visited = new Set<string>();
    while (type.kind === "ref") {
        if (visited.has(type.ref) || visited.size > 64) throw new OnvifError("InvalidRegistry", "Cyclic XML type alias");
        visited.add(type.ref);
        const resolved = Object.hasOwn(registry.types, type.ref) ? registry.types[type.ref] : undefined;
        if (resolved === undefined) throw new OnvifError("InvalidRegistry", `Unresolved XML type reference ${type.ref}`);
        type = resolved;
    }
    return type;
}

export function assertXmlRegistry(value: unknown): asserts value is XmlRegistry {
    if (!isRecord(value) || !isRecord(value.types) || !isRecord(value.elements) || !isRecord(value.attributes)) fail();
    knownKeys(value, ["types", "elements", "attributes", "derivedTypes"]);
    if (Object.keys(value.types).length > 20000 || Object.keys(value.elements).length > 20000
        || Object.keys(value.attributes).length > 20000) fail();
    const types: Record<string, TypeDescriptor> = Object.create(null);
    const elements: Record<string, ElementDescriptor> = Object.create(null);
    for (const [key, type] of Object.entries(value.types)) { assertType(type); types[key] = type; }
    for (const [key, element] of Object.entries(value.elements)) { assertElementDescriptor(element); elements[key] = element; }
    for (const attribute of Object.values(value.attributes)) {
        assertType({ kind: "complex", attributes: [attribute] });
    }
    const registry: XmlRegistry = { types, elements, attributes: {} };
    const visitParticles = (sequence: readonly Particle[]): void => {
        for (const particle of sequence) {
            if (particle.kind === "element") visitElement(particle.element);
            else if (particle.kind === "group") visitParticles(particle.sequence);
            else if (particle.kind === "choice") {
                for (const option of particle.alternatives) {
                    if ("element" in option) visitElement(option.element);
                    else if ("sequence" in option) visitParticles(option.sequence);
                }
            }
        }
    };
    const visitType = (type: TypeDescriptor): void => {
        if (type.kind === "ref") { resolveType(type, registry); return; }
        if (type.kind === "complex") visitParticles(type.sequence ?? []);
    };
    const visitElement = (element: ElementDescriptor): void => {
        visitType(element.type);
        for (const alternative of element.types ?? []) visitType(alternative.type);
    };
    for (const type of Object.values(registry.types)) visitType(type);
    for (const element of Object.values(registry.elements)) visitElement(element);
    if (value.derivedTypes !== undefined) {
        if (!isRecord(value.derivedTypes) || Object.keys(value.derivedTypes).length > 20000) fail();
        for (const alternatives of Object.values(value.derivedTypes)) {
            assertElementDescriptor({ name: { namespace: "", localName: "Derived" },
                type: { kind: "opaque" }, types: alternatives });
            if (!Array.isArray(alternatives)) fail();
            for (const alternative of alternatives) {
                if (!isRecord(alternative)) fail();
                assertType(alternative.type);
                visitType(alternative.type);
            }
        }
    }
}

export function typeAlternatives(element: ElementDescriptor, registry: XmlRegistry) {
    return element.types ?? (element.typeQName === undefined ? []
        : registry.derivedTypes?.[`{${element.typeQName.namespace}}${element.typeQName.localName}`] ?? []);
}

export function requireImplemented(descriptor: ElementDescriptor, registry: XmlRegistry = EMPTY_XML_REGISTRY): void {
    assertElementDescriptor(descriptor);
    const visited = new Set<string>();
    const visitParticles = (sequence: readonly Particle[]): void => {
        for (const particle of sequence) {
            if (particle.kind === "element") visit(particle.element);
            else if (particle.kind === "group") visitParticles(particle.sequence);
            else if (particle.kind === "choice") {
                for (const alternative of particle.alternatives) {
                    if ("element" in alternative) visit(alternative.element);
                    else if ("sequence" in alternative) visitParticles(alternative.sequence);
                }
            }
        }
    };
    const visit = (element: ElementDescriptor): void => {
        if (element.unsupported?.length) {
            throw new OnvifError("UnsupportedCapability", `Unsupported XML feature: ${element.unsupported.join("; ")}`);
        }
        const types = [element.type, ...typeAlternatives(element, registry).map((entry) => entry.type)];
        for (const type of types) {
            if (type.kind === "ref") {
                if (visited.has(type.ref)) continue;
                visited.add(type.ref);
            }
            const resolved = resolveType(type, registry);
            if (resolved.kind === "unsupported") {
                throw new OnvifError("UnsupportedCapability", `Unsupported XML feature: ${resolved.feature}`);
            }
            if (resolved.kind === "complex") {
                for (const attribute of resolved.attributes ?? []) {
                    if (attribute.type.kind === "unsupported") {
                        throw new OnvifError("UnsupportedCapability", `Unsupported XML attribute: ${attribute.type.feature}`);
                    }
                }
                visitParticles(resolved.sequence ?? []);
            }
        }
    };
    visit(descriptor);
}
