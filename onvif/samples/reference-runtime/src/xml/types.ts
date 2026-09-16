import { isRecord, OnvifError } from "../binding/errors.js";

export type QName = { namespace: string; localName: string };
export type XmlAttribute = { name: QName; value: string; prefix?: string };
export type XmlElement = {
    kind: "element";
    name: QName;
    prefix?: string;
    namespaces: Record<string, string>;
    attributes: XmlAttribute[];
    children: XmlNode[];
};
export type XmlNode = XmlElement
    | { kind: "text"; value: string }
    | { kind: "comment"; value: string }
    | { kind: "processing-instruction"; target: string; value: string };

export type CanonicalValue = null | boolean | number | string | object | CanonicalValue[];
export type ScalarName = "string" | "boolean" | "int32" | "uint32" | "int64" | "uint64"
    | "integer" | "decimal" | "hexBinary" | "base64Binary" | "dateTime" | "QName"
    | "float" | "double" | "duration" | "date" | "time" | "gYearMonth" | "gYear" | "gMonthDay" | "gDay" | "gMonth"
    | "normalizedString" | "token" | "language" | "Name" | "NCName" | "NMTOKEN" | "ID" | "anyURI";
export type ScalarType = { kind: "scalar"; type: ScalarName };
export type SimpleFacets = {
    enumeration?: readonly { lexical: string; namespaces?: Readonly<Record<string, string>> }[];
    minInclusive?: string;
    maxInclusive?: string;
    minExclusive?: string;
    maxExclusive?: string;
    length?: number;
    minLength?: number;
    maxLength?: number;
    whiteSpace?: "preserve" | "replace" | "collapse";
    patterns?: readonly string[];
};
export type SimpleType = ScalarType
    | { kind: "list"; item: SimpleType }
    | { kind: "union"; members: readonly { name: string; type: SimpleType }[] }
    | { kind: "restriction"; base: SimpleType; facets: SimpleFacets };
export type AttributeDescriptor = {
    key: string;
    name: QName;
    type: SimpleType | { kind: "unsupported"; feature: string };
    required?: boolean;
    defaultLexical?: string;
    fixedLexical?: string;
};
export type Occurrences = { minOccurs?: number; maxOccurs?: number | "unbounded" };
export type ElementField = Occurrences & { kind: "element"; key: string; element: ElementDescriptor };
export type ChoiceAlternative = { key: string; element: ElementDescriptor }
    | { key: string; any: WildcardConstraint }
    | { key: string; sequence: readonly Particle[] };
export type ChoiceField = Occurrences & {
    kind: "choice";
    key: string;
    alternatives: readonly ChoiceAlternative[];
};
export type WildcardConstraint = {
    namespaces?: readonly string[];
    notNamespaces?: readonly string[];
    processContents?: "skip" | "lax" | "strict";
};
export type AnyField = Occurrences & WildcardConstraint & {
    kind: "any";
    key: string;
};
export type GroupField = Occurrences & {
    kind: "group";
    key: string;
    sequence: readonly Particle[];
};
export type Particle = ElementField | ChoiceField | AnyField | GroupField;
export type ComplexType = {
    kind: "complex";
    abstract?: boolean;
    mixed?: boolean;
    attributes?: readonly AttributeDescriptor[];
    anyAttributes?: boolean;
    attributeWildcard?: WildcardConstraint;
    text?: SimpleType;
    sequence?: readonly Particle[];
};
export type TypeDescriptor = SimpleType | ComplexType | { kind: "opaque" }
    | { kind: "ref"; ref: string }
    | { kind: "unsupported"; feature: string };
export type XmlNameTest = { namespace: string | null; localName: string | null };
export type IdentityPath = {
    descendant: boolean;
    elements: readonly XmlNameTest[];
    attribute?: XmlNameTest;
};
export type UniqueConstraint = {
    name: QName;
    selector: readonly IdentityPath[];
    fields: readonly (readonly IdentityPath[])[];
};
export type ElementDescriptor = {
    name: QName;
    type: TypeDescriptor;
    nillable?: boolean;
    typeQName?: QName;
    defaultLexical?: string;
    defaultNamespaces?: Readonly<Record<string, string>>;
    fixedLexical?: string;
    unsupported?: readonly string[];
    unique?: readonly UniqueConstraint[];
    types?: readonly { name: QName; type: TypeDescriptor }[];
};

export interface XmlRegistry {
    readonly types: Readonly<Record<string, TypeDescriptor>>;
    readonly elements: Readonly<Record<string, ElementDescriptor>>;
    readonly attributes: Readonly<Record<string, AttributeDescriptor>>;
    readonly derivedTypes?: Readonly<Record<string, readonly { name: QName; type: TypeDescriptor }[]>>;
}

export const EMPTY_XML_REGISTRY: XmlRegistry = Object.freeze({
    types: Object.freeze({}),
    elements: Object.freeze({}),
    attributes: Object.freeze({})
});

export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
export const XML_NAME_START = "A-Z_a-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02ff\\u0370-\\u037d"
    + "\\u037f-\\u1fff\\u200c-\\u200d\\u2070-\\u218f\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf"
    + "\\ufdf0-\\ufffd\\u{10000}-\\u{effff}";
export const XML_NAME_CHAR = `${XML_NAME_START}\\-\\.0-9\\u00b7\\u0300-\\u036f\\u203f-\\u2040`;
const ncName = new RegExp(`^[${XML_NAME_START}][${XML_NAME_CHAR}]*$`, "u");

export function equalQName(a: QName, b: QName): boolean {
    return a.namespace === b.namespace && a.localName === b.localName;
}

export function isNCName(value: unknown): value is string {
    return typeof value === "string" && ncName.test(value);
}

export function isQName(value: unknown): value is QName {
    return isRecord(value) && typeof value.namespace === "string" && isNCName(value.localName)
        && Object.keys(value).every((key) => key === "namespace" || key === "localName");
}

export function childElements(node: XmlElement): XmlElement[] {
    return node.children.filter((child): child is XmlElement => child.kind === "element");
}

export function textContent(node: XmlElement): string {
    if (node.children.some((child) => child.kind === "element")) {
        throw new OnvifError("InvalidValue", "Simple content contains child elements");
    }
    return node.children.filter((child) => child.kind === "text").map((child) => child.value).join("");
}

export function resolveQName(value: string, namespaces: Readonly<Record<string, string>>): QName {
    const parts = value.trim().split(":");
    const localName = parts.at(-1);
    if (parts.length > 2 || !isNCName(localName) || (parts.length === 2 && !isNCName(parts[0]))) {
        throw new OnvifError("InvalidValue", "Invalid lexical QName");
    }
    const prefix = parts.length === 2 ? parts[0] : "";
    const namespace = prefix === undefined ? undefined : namespaces[prefix];
    if (parts.length === 2 && namespace === undefined) {
        throw new OnvifError("InvalidValue", "Unbound QName prefix");
    }
    return { namespace: namespace ?? "", localName };
}
