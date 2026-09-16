import { invalidValue, isRecord, OnvifError } from "../binding/errors.js";
import { assertElementDescriptor, occurs, requireImplemented, resolveType, typeAlternatives } from "./descriptors.js";
import { IdentityValidation } from "./identity.js";
import { assertXmlElement, DEFAULT_XML_LIMITS } from "./parser.js";
import { decodeSimple, encodeSimple, qnameText } from "./simple-values.js";
import {
    childElements, EMPTY_XML_REGISTRY, equalQName, isQName, resolveQName, textContent, XSI_NS,
    type CanonicalValue, type ChoiceAlternative, type ChoiceField, type ComplexType, type ElementDescriptor, type Particle,
    type QName, type TypeDescriptor, type WildcardConstraint, type XmlAttribute, type XmlElement, type XmlRegistry
} from "./types.js";

function put(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function keysOnly(record: Record<string, unknown>, keys: ReadonlySet<string>): void {
    if (Object.keys(record).some((key) => !keys.has(key))) invalidValue("Unexpected canonical field would be lost");
}

function namedType(descriptor: ElementDescriptor, name: QName | undefined, registry: XmlRegistry): Exclude<TypeDescriptor, { kind: "ref" }> {
    if (name === undefined || (descriptor.typeQName !== undefined && equalQName(descriptor.typeQName, name))) {
        return resolveType(descriptor.type, registry);
    }
    const selected = typeAlternatives(descriptor, registry).find((entry) => equalQName(entry.name, name));
    if (selected === undefined) throw new OnvifError("UnsupportedCapability", "xsi:type is not in the local descriptor");
    requireImplemented({ ...descriptor, type: selected.type, types: [] }, registry);
    return resolveType(selected.type, registry);
}

function acceptedNamespace(field: WildcardConstraint, name: QName): boolean {
    return (field.namespaces === undefined || field.namespaces.includes(name.namespace))
        && (field.notNamespaces === undefined || !field.notNamespaces.includes(name.namespace));
}

function wildcardElement(field: WildcardConstraint, node: XmlElement, registry: XmlRegistry, identity?: IdentityValidation): void {
    if (!acceptedNamespace(field, node.name)) invalidValue("Wildcard namespace is not permitted");
    if (field.processContents === undefined || field.processContents === "skip") return;
    const declaration = registry.elements[`{${node.name.namespace}}${node.name.localName}`];
    if (declaration === undefined) {
        if (field.processContents === "strict") invalidValue("Strict wildcard element has no local declaration");
    } else if (identity === undefined) decodeElement(declaration, node, registry);
    else {
        requireImplemented(declaration, registry);
        decode(declaration, node, registry, identity);
    }
}

function wildcardAttribute(field: WildcardConstraint, attribute: XmlAttribute, node: XmlElement, registry: XmlRegistry, identity?: IdentityValidation): void {
    if (!acceptedNamespace(field, attribute.name)) invalidValue("Wildcard attribute namespace is not permitted");
    if (field.processContents === undefined || field.processContents === "skip") return;
    const declaration = registry.attributes[`{${attribute.name.namespace}}${attribute.name.localName}`];
    if (declaration === undefined) {
        if (field.processContents === "strict") invalidValue("Strict wildcard attribute has no local declaration");
    } else {
        if (declaration.type.kind === "unsupported") throw new OnvifError("UnsupportedCapability", declaration.type.feature);
        const value = decodeSimple(declaration.type, attribute.value, node);
        identity?.record(attribute, declaration.type, value);
    }
}

function decodedAttributes(type: ComplexType | undefined, node: XmlElement, result: Record<string, unknown>, registry: XmlRegistry, identity: IdentityValidation): void {
    const attributes: Record<string, unknown> = {};
    const extras: XmlAttribute[] = [];
    for (const attribute of node.attributes) {
        if (attribute.name.namespace === XSI_NS && ["nil", "type"].includes(attribute.name.localName)) continue;
        const field = type?.attributes?.find((entry) => equalQName(entry.name, attribute.name));
        if (field) {
            if (field.type.kind === "unsupported") throw new OnvifError("UnsupportedCapability", field.type.feature);
            if (field.fixedLexical !== undefined && attribute.value !== field.fixedLexical) invalidValue("Fixed XML attribute differs");
            const value = decodeSimple(field.type, attribute.value, node);
            put(attributes, field.key, value);
            identity.record(attribute, field.type, value);
        } else if (type?.anyAttributes) {
            wildcardAttribute(type.attributeWildcard ?? {}, attribute, node, registry, identity);
            extras.push(structuredClone(attribute));
        } else invalidValue("Attribute is not declared by the XML content model");
    }
    for (const attribute of type?.attributes ?? []) {
        if (attribute.required && !Object.hasOwn(attributes, attribute.key)) invalidValue("Missing required XML attribute");
        const defaultValue = attribute.fixedLexical ?? attribute.defaultLexical;
        if (!Object.hasOwn(attributes, attribute.key) && defaultValue !== undefined && attribute.type.kind !== "unsupported") {
            const synthetic = { name: attribute.name, value: defaultValue };
            identity.defaultAttribute(node, synthetic, attribute.type, decodeSimple(attribute.type, defaultValue, node));
        }
    }
    if (Object.keys(attributes).length) result.$attributes = attributes;
    if (type?.anyAttributes) {
        result.$anyAttributes = extras;
        result.$namespaces = structuredClone(node.namespaces);
    }
}

function decode(descriptor: ElementDescriptor, node: XmlElement, registry: XmlRegistry, identity: IdentityValidation): CanonicalValue {
    if (!equalQName(descriptor.name, node.name)) invalidValue("Unexpected expanded XML element name");
    identity.scope(descriptor, node);
    if (descriptor.type.kind === "opaque") return structuredClone(node);
    const xsiType = node.attributes.find((attribute) => attribute.name.namespace === XSI_NS && attribute.name.localName === "type");
    const typeName = xsiType === undefined ? undefined : resolveQName(xsiType.value, node.namespaces);
    const type = namedType(descriptor, typeName, registry);
    if (type.kind === "unsupported") throw new OnvifError("UnsupportedCapability", "Unimplemented XML content model");
    if (type.kind === "opaque") return structuredClone(node);
    if (type.kind === "complex" && type.abstract) invalidValue("Abstract XML type requires a concrete declared xsi:type");
    const result: Record<string, unknown> = {};
    if (typeName !== undefined) result.$type = typeName;
    const nil = node.attributes.find((attribute) => attribute.name.namespace === XSI_NS && attribute.name.localName === "nil");
    if (nil !== undefined) {
        const value = decodeSimple({ kind: "scalar", type: "boolean" }, nil.value, node);
        result.$nil = value;
        if (value === true && !descriptor.nillable) invalidValue("xsi:nil is not permitted by this element declaration");
    }
    decodedAttributes(type.kind === "complex" ? type : undefined, node, result, registry, identity);
    if (result.$nil === true) {
        if (node.children.some((child) => child.kind === "element" || (child.kind === "text" && child.value.length > 0))) {
            invalidValue("A nil element must be empty");
        }
        return result;
    }
    const simple = type.kind === "complex" ? type.text : type;
    if (simple !== undefined && descriptor.defaultLexical !== undefined
        && !node.children.some((entry) => entry.kind === "element" || (entry.kind === "text" && entry.value !== ""))) {
        const value = decodeSimple(simple, descriptor.defaultLexical,
            { ...node, namespaces: { ...node.namespaces, ...descriptor.defaultNamespaces } });
        identity.record(node, simple, value);
        return { ...result, $default: true };
    }
    if (simple !== undefined && descriptor.fixedLexical !== undefined
        && textContent(node) !== descriptor.fixedLexical) invalidValue("Fixed XML element differs");
    if (type.kind !== "complex") {
        const value = decodeSimple(type, textContent(node), node);
        identity.record(node, type, value);
        return Object.keys(result).length ? { ...result, $value: value } : value;
    }
    if (type.text !== undefined) {
        const value = decodeSimple(type.text, textContent(node), node);
        result.$value = value;
        identity.record(node, type.text, value);
        return result;
    }
    if (!type.mixed && node.children.some((child) => child.kind === "text" && child.value.trim() !== "")) {
        invalidValue("Mixed content requires an explicitly opaque or supported mixed-content descriptor");
    }
    const children = childElements(node);
    const cursor = decodeSequence(type.sequence ?? [], children, 0, type.mixed ? {} : result, registry, identity);
    if (cursor !== children.length) invalidValue("Unexpected, repeated or out-of-order XML element");
    if (type.mixed) {
        result.$namespaces = structuredClone(node.namespaces);
        result.$children = structuredClone(node.children);
    }
    return result;
}

function starts(sequence: readonly Particle[], node: XmlElement): number {
    let priority = 0;
    for (const particle of sequence) {
        priority = Math.max(priority, matches(particle, node));
        if (occurs(particle).min > 0) break;
    }
    return priority;
}

function wildcardPriority(field: WildcardConstraint, node: XmlElement): number {
    if (!acceptedNamespace(field, node.name)) return 0;
    return field.namespaces !== undefined || field.notNamespaces !== undefined ? 2 : 1;
}

function alternativePriority(option: ChoiceAlternative, node: XmlElement): number {
    if ("element" in option) return equalQName(option.element.name, node.name) ? 3 : 0;
    if ("any" in option) return wildcardPriority(option.any, node);
    return starts(option.sequence, node);
}

function selectAlternative(particle: ChoiceField, node: XmlElement): ChoiceAlternative | undefined {
    const priorities = particle.alternatives.map((entry) => alternativePriority(entry, node));
    const priority = Math.max(...priorities);
    if (priority === 0) return undefined;
    const alternatives = particle.alternatives.filter((_entry, index) => priorities[index] === priority);
    if (alternatives.length !== 1) invalidValue("Ambiguous XML choice between equally specific expanded-name alternatives");
    return alternatives[0];
}

function matches(particle: Particle, node: XmlElement): number {
    if (occurs(particle).max === 0) return 0;
    switch (particle.kind) {
        case "element": return equalQName(particle.element.name, node.name) ? 3 : 0;
        case "any": return wildcardPriority(particle, node);
        case "group": return starts(particle.sequence, node);
        case "choice": return Math.max(...particle.alternatives.map((option) => alternativePriority(option, node)));
    }
}

function decodeSequence(
    sequence: readonly Particle[], children: readonly XmlElement[], cursor: number,
    result: Record<string, unknown>, registry: XmlRegistry, identity: IdentityValidation
): number {
    for (const [index, particle] of sequence.entries()) {
        const { min, max, repeated } = occurs(particle);
        const values: CanonicalValue[] = [];
        while (cursor < children.length && values.length < max) {
            const child = children[cursor];
            if (child === undefined || !matches(particle, child)) break;
            if (values.length >= min && matches(particle, child) < starts(sequence.slice(index + 1), child)) break;
            if (particle.kind === "element") {
                values.push(decode(particle.element, child, registry, identity));
                cursor++;
            } else if (particle.kind === "choice") {
                const alternative = selectAlternative(particle, child);
                if (alternative === undefined) break;
                if ("element" in alternative) {
                    values.push({ $case: alternative.key, $value: decode(alternative.element, child, registry, identity) });
                    cursor++;
                } else if ("any" in alternative) {
                    wildcardElement(alternative.any, child, registry, identity);
                    values.push({ $case: alternative.key, $value: structuredClone(child) });
                    cursor++;
                } else {
                    const value: Record<string, unknown> = {};
                    const next = decodeSequence(alternative.sequence, children, cursor, value, registry, identity);
                    if (next === cursor) invalidValue("Nullable choice cannot consume an occurrence");
                    cursor = next;
                    values.push({ $case: alternative.key, $value: value });
                }
            } else if (particle.kind === "group") {
                const value: Record<string, unknown> = {};
                const next = decodeSequence(particle.sequence, children, cursor, value, registry, identity);
                if (next === cursor) invalidValue("Nullable group cannot consume an occurrence");
                cursor = next;
                values.push(value);
            } else {
                wildcardElement(particle, child, registry, identity);
                values.push(structuredClone(child));
                cursor++;
            }
        }
        if (values.length < min) invalidValue("Required XML sequence or choice occurrence missing");
        if (particle.kind !== "element" || repeated) put(result, particle.key, values);
        else if (values.length === 1) put(result, particle.key, values[0]);
    }
    return cursor;
}

function encodeAttributes(type: ComplexType | undefined, value: Record<string, unknown>, node: XmlElement, registry: XmlRegistry): void {
    const attributes = value.$attributes ?? {};
    if (!isRecord(attributes)) invalidValue("$attributes must be an object");
    keysOnly(attributes, new Set((type?.attributes ?? []).map((entry) => entry.key)));
    for (const attribute of type?.attributes ?? []) {
        if (!Object.hasOwn(attributes, attribute.key)) {
            if (attribute.required) invalidValue("Missing required canonical attribute");
            continue;
        }
        if (attribute.type.kind === "unsupported") throw new OnvifError("UnsupportedCapability", attribute.type.feature);
        const text = encodeSimple(attribute.type, attributes[attribute.key], node);
        if (attribute.fixedLexical !== undefined && text !== attribute.fixedLexical) invalidValue("Fixed XML attribute differs");
        node.attributes.push({ name: attribute.name, value: text });
    }
    if (value.$anyAttributes !== undefined) {
        if (!type?.anyAttributes || !Array.isArray(value.$anyAttributes)) invalidValue("Undeclared wildcard attributes");
        const candidate = { ...node, attributes: value.$anyAttributes, children: [] };
        assertXmlElement(candidate);
        for (const attribute of candidate.attributes) {
            if (attribute.name.namespace === XSI_NS
                || node.attributes.some((existing) => equalQName(existing.name, attribute.name))) {
                invalidValue("Wildcard attribute conflicts with a declared attribute");
            }
            wildcardAttribute(type.attributeWildcard ?? {}, attribute, node, registry);
            node.attributes.push(structuredClone(attribute));
        }
    }
}

export function decodeElement(descriptor: ElementDescriptor, node: XmlElement, registry: XmlRegistry = EMPTY_XML_REGISTRY): CanonicalValue {
    requireImplemented(descriptor, registry);
    assertXmlElement(node);
    const identity = new IdentityValidation(node);
    const value = decode(descriptor, node, registry, identity);
    identity.validate();
    return value;
}

export function encodeElement(descriptor: ElementDescriptor, value: unknown, registry: XmlRegistry = EMPTY_XML_REGISTRY): XmlElement {
    requireImplemented(descriptor, registry);
    let count = 0;
    const ancestors = new Set<object>();
    const encode = (element: ElementDescriptor, input: unknown, depth: number): XmlElement => {
        if (depth > DEFAULT_XML_LIMITS.maxDepth || ++count > DEFAULT_XML_LIMITS.maxNodes) {
            throw new OnvifError("XmlLimit", "Canonical input exceeds XML structural bounds");
        }
        if (typeof input === "object" && input !== null) {
            if (ancestors.has(input)) invalidValue("Cyclic canonical XML input");
            ancestors.add(input);
        }
        try {
            return build(element, input, depth);
        } finally {
            if (typeof input === "object" && input !== null) ancestors.delete(input);
        }
    };
    const build = (element: ElementDescriptor, input: unknown, depth: number): XmlElement => {
        if (element.type.kind === "opaque") {
            assertXmlElement(input);
            if (!equalQName(element.name, input.name)) invalidValue("Opaque element has the wrong expanded name");
            return structuredClone(input);
        }
        const record = isRecord(input) ? input : {};
        const typeName = record.$type;
        if (typeName !== undefined && !isQName(typeName)) invalidValue("xsi:type must be an expanded QName");
        const type = namedType(element, typeName, registry);
        if (type.kind === "unsupported") throw new OnvifError("UnsupportedCapability", "Unimplemented XML descriptor");
        if (type.kind === "opaque") {
            assertXmlElement(input);
            if (!equalQName(element.name, input.name)) invalidValue("Opaque element has the wrong expanded name");
            return structuredClone(input);
        }
        if (type.kind === "complex" && type.abstract) invalidValue("Abstract XML type requires a concrete declared xsi:type");
        const node: XmlElement = { kind: "element", name: element.name, namespaces: {}, attributes: [], children: [] };
        if (type.kind === "complex" && (type.anyAttributes || type.mixed)
            && (type.mixed || record.$namespaces !== undefined || (Array.isArray(record.$anyAttributes) && record.$anyAttributes.length > 0))) {
            if (!isRecord(record.$namespaces) || typeof record.$namespaces[""] !== "string") {
                invalidValue("Wildcard attributes require their retained $namespaces, including the default namespace");
            }
            for (const [prefix, namespace] of Object.entries(record.$namespaces)) {
                if (typeof namespace !== "string") invalidValue("Invalid wildcard attribute namespace context");
                put(node.namespaces, prefix, namespace);
            }
        }
        if (typeName !== undefined) {
            node.attributes.push({ name: { namespace: XSI_NS, localName: "type" }, value: qnameText(typeName, node) });
        }
        if (record.$nil !== undefined) {
            if (typeof record.$nil !== "boolean") invalidValue("$nil must be a boolean");
            if (record.$nil && !element.nillable) invalidValue("Element is not nillable");
            node.attributes.push({ name: { namespace: XSI_NS, localName: "nil" }, value: String(record.$nil) });
        }
        encodeAttributes(type.kind === "complex" ? type : undefined, record, node, registry);
        const special = new Set(["$type", "$nil", "$attributes", "$anyAttributes",
            ...(type.kind === "complex" && (type.anyAttributes || type.mixed) ? ["$namespaces"] : [])]);
        if (record.$nil === true) {
            keysOnly(record, special);
            return node;
        }
        if (record.$default !== undefined) {
            if (record.$default !== true || element.defaultLexical === undefined) invalidValue("No declared XML element default");
            keysOnly(record, new Set([...special, "$default"]));
            const simple = type.kind === "complex" ? type.text : type;
            if (simple === undefined) invalidValue("Complex content has no scalar default");
            decodeSimple(simple, element.defaultLexical,
                { ...node, namespaces: { ...node.namespaces, ...element.defaultNamespaces } });
            return node;
        }
        if (type.kind !== "complex") {
            const wrapped = record.$type !== undefined || record.$nil !== undefined;
            if (wrapped) keysOnly(record, new Set([...special, "$value"]));
            const text = encodeSimple(type, wrapped ? record.$value : input, node);
            if (element.fixedLexical !== undefined && text !== element.fixedLexical) invalidValue("Fixed XML element differs");
            node.children.push({ kind: "text", value: text });
            return node;
        }
        if (!isRecord(input)) invalidValue("Complex content requires a canonical object");
        if (type.mixed) {
            keysOnly(record, new Set([...special, "$children"]));
            if (!Array.isArray(record.$children)) invalidValue("Mixed XML requires ordered $children");
            const candidate = { ...node, children: record.$children };
            assertXmlElement(candidate);
            node.children = structuredClone(candidate.children);
            return node;
        }
        if (type.text !== undefined) {
            keysOnly(record, new Set([...special, "$value"]));
            node.children.push({ kind: "text", value: encodeSimple(type.text, record.$value, node) });
            return node;
        }
        keysOnly(record, new Set([...special, ...(type.sequence ?? []).map((particle) => particle.key)]));
        encodeSequence(type.sequence ?? [], record, node, depth);
        return node;
    };
    const encodeSequence = (sequence: readonly Particle[], record: Record<string, unknown>, node: XmlElement, depth: number): void => {
        if (depth > DEFAULT_XML_LIMITS.maxDepth) throw new OnvifError("XmlLimit", "Canonical group depth exceeded");
        for (const particle of sequence) {
            const { min, max, repeated } = occurs(particle);
            const item = record[particle.key];
            let values: unknown[];
            if (particle.kind !== "element" || repeated) {
                if (item === undefined) {
                    if (min > 0) invalidValue("Missing required repeated canonical field");
                    values = [];
                } else {
                    if (!Array.isArray(item)) invalidValue("Repeated elements and ordered choices require arrays");
                    values = item;
                }
            } else values = item === undefined ? [] : [item];
            if (values.length < min || values.length > max) invalidValue("Canonical occurrence count is out of bounds");
            if (values.length > DEFAULT_XML_LIMITS.maxNodes) throw new OnvifError("XmlLimit", "Canonical array bound exceeded");
            for (const child of values) {
                if (particle.kind === "element") node.children.push(encode(particle.element, child, depth + 1));
                else if (particle.kind === "choice") {
                    if (!isRecord(child)) invalidValue("A choice must identify its branch");
                    keysOnly(child, new Set(["$case", "$value"]));
                    const alternative = particle.alternatives.find((entry) => entry.key === child.$case);
                    if (alternative === undefined) invalidValue("Unknown XML choice branch");
                    const before = node.children.length;
                    if ("element" in alternative) node.children.push(encode(alternative.element, child.$value, depth + 1));
                    else if ("any" in alternative) {
                        assertXmlElement(child.$value);
                        wildcardElement(alternative.any, child.$value, registry);
                        node.children.push(structuredClone(child.$value));
                    }
                    else {
                        if (!isRecord(child.$value)) invalidValue("A sequence choice requires an object");
                        keysOnly(child.$value, new Set(alternative.sequence.map((field) => field.key)));
                        encodeSequence(alternative.sequence, child.$value, node, depth + 1);
                    }
                    const first = node.children[before];
                    if (first?.kind !== "element" || selectAlternative(particle, first)?.key !== alternative.key) {
                        invalidValue("Canonical choice conflicts with expanded-QName/namespace attribution priority");
                    }
                } else if (particle.kind === "group") {
                    if (!isRecord(child)) invalidValue("A model group requires an object");
                    keysOnly(child, new Set(particle.sequence.map((field) => field.key)));
                    encodeSequence(particle.sequence, child, node, depth + 1);
                } else {
                    assertXmlElement(child);
                    wildcardElement(particle, child, registry);
                    node.children.push(structuredClone(child));
                }
            }
        }
    };
    assertElementDescriptor(descriptor);
    const encoded = encode(descriptor, value, 1);
    decodeElement(descriptor, encoded, registry);
    return encoded;
}
