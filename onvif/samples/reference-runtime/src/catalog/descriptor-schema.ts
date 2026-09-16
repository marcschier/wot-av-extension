import { ONVIF_BASE, type Schema } from "./schemas.js";

const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const string: Schema = { type: "string" };
const name: Schema = { type: "string", minLength: 1 };
const count: Schema = { type: "integer", minimum: 0, maximum: 9007199254740991 };
const flag: Schema = { type: "boolean", default: false };
const hash: Schema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const array = (items: Schema, minItems = 0): Schema => ({ type: "array", items, minItems });
const map = (values: Schema): Schema => ({ type: "object", additionalProperties: values });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
    ({ type: "object", properties, required, additionalProperties: false });
const tag = (kind: string): Schema => ({ const: kind });

export function mappingSchema(): Schema {
    const namespaces = map(string);
    const location = { sourceId: name, line: { ...count,
        $comment: "Zero denotes a synthesized XML Schema built-in source component, not an observed file line." }, sha256: hash };
    const occurrences = { minOccurs: { ...count, default: 1 },
        maxOccurs: { oneOf: [count, { const: "unbounded" }], default: 1 } };
    const wildcard = { namespaces: array(string), notNamespaces: array(string),
        processContents: { enum: ["strict", "lax", "skip"] } };
    const wildcardConstraint = {
        ...object(wildcard, ["processContents"]),
        not: { required: ["namespaces", "notNamespaces"] }
    };
    const operationReference = { bindingQName: ref("QName"), portTypeQName: ref("QName"), operation: name };
    const typeAlternative = object({ name: ref("QName"), type: ref("TypeDescriptor") });
    const defs: Record<string, Schema> = {
        QName: object({ namespace: string, localName: { ...name, pattern: "^[^\\s:]+$",
            $comment: "The XML-NCName algorithm, including Unicode name characters, is additionally required." } }),
        OperationReference: object(operationReference),
        NamespaceMap: namespaces,
        XmlAttribute: object({ name: ref("QName"), value: string, prefix: string }, ["name", "value"]),
        XmlElement: object({ kind: tag("element"), name: ref("QName"), prefix: string, namespaces,
            attributes: array(ref("XmlAttribute")), children: array(ref("XmlNode")) },
        ["kind", "name", "namespaces", "attributes", "children"]),
        XmlNode: { oneOf: [
            ref("XmlElement"),
            object({ kind: { enum: ["text", "comment"] }, value: string }),
            object({ kind: tag("processing-instruction"), target: name, value: string })
        ] },
        ScalarType: object({ kind: tag("scalar"), type: { enum: [
            "string", "boolean", "int32", "uint32", "int64", "uint64", "integer", "decimal", "float", "double",
            "hexBinary", "base64Binary", "QName", "dateTime", "date", "time", "duration", "gYearMonth", "gYear",
            "gMonthDay", "gDay", "gMonth", "normalizedString", "token", "language", "Name", "NCName", "NMTOKEN", "ID", "anyURI"
        ] } }),
        SimpleFacets: object({
            enumeration: array(object({ lexical: string, namespaces }, ["lexical"]), 1),
            minInclusive: string, maxInclusive: string, minExclusive: string, maxExclusive: string,
            length: count, minLength: count, maxLength: count,
            whiteSpace: { enum: ["preserve", "replace", "collapse"] }, patterns: array(string, 1)
        }, []),
        SimpleType: { oneOf: [
            ref("ScalarType"),
            object({ kind: tag("list"), item: ref("SimpleType") }),
            object({ kind: tag("union"), members: array(object({ name, type: ref("SimpleType") }), 1) }),
            object({ kind: tag("restriction"), base: ref("SimpleType"), facets: ref("SimpleFacets") })
        ] },
        UnsupportedType: object({ kind: tag("unsupported"), feature: name }),
        AttributeDescriptor: object({ key: name, name: ref("QName"),
            type: { oneOf: [ref("SimpleType"), ref("UnsupportedType")] },
            required: flag, defaultLexical: string, fixedLexical: string }, ["key", "name", "type"]),
        WildcardConstraint: wildcardConstraint,
        ChoiceAlternative: { oneOf: [
            object({ key: name, element: ref("ElementDescriptor") }),
            object({ key: name, sequence: array(ref("Particle")) }),
            object({ key: name, any: ref("WildcardConstraint") })
        ] },
        Particle: { oneOf: [
            object({ kind: tag("element"), key: name, element: ref("ElementDescriptor"), ...occurrences }, ["kind", "key", "element"]),
            object({ kind: tag("choice"), key: name, alternatives: array(ref("ChoiceAlternative"), 1), ...occurrences }, ["kind", "key", "alternatives"]),
            object({ kind: tag("group"), key: name, sequence: array(ref("Particle")), ...occurrences }, ["kind", "key", "sequence"]),
            { ...object({ kind: tag("any"), key: name, ...wildcard, ...occurrences }, ["kind", "key", "processContents"]),
                not: { required: ["namespaces", "notNamespaces"] } }
        ] },
        ComplexType: {
            ...object({ kind: tag("complex"), abstract: flag, mixed: flag, attributes: array(ref("AttributeDescriptor")),
                anyAttributes: flag, attributeWildcard: ref("WildcardConstraint"), text: ref("SimpleType"),
                sequence: array(ref("Particle")) }, ["kind"]),
            allOf: [
                { if: { required: ["text"] }, then: { not: { anyOf: [
                    { required: ["sequence"] }, { required: ["mixed"], properties: { mixed: { const: true } } }
                ] } } },
                { if: { required: ["attributeWildcard"] }, then: { required: ["anyAttributes"], properties: { anyAttributes: { const: true } } } }
            ]
        },
        TypeDescriptor: { oneOf: [
            ref("SimpleType"), ref("ComplexType"), object({ kind: tag("ref"), ref: name }),
            object({ kind: tag("opaque") }), ref("UnsupportedType")
        ] },
        XmlNameTest: object({ namespace: { type: ["string", "null"] }, localName: { type: ["string", "null"] } }),
        IdentityPath: object({ descendant: { type: "boolean" }, elements: array(ref("XmlNameTest")), attribute: ref("XmlNameTest") },
        ["descendant", "elements"]),
        UniqueConstraint: object({ name: ref("QName"), selector: array(ref("IdentityPath"), 1),
            fields: array(array(ref("IdentityPath"), 1), 1) }),
        ElementDescriptor: object({
            name: ref("QName"), type: ref("TypeDescriptor"), nillable: flag, typeQName: ref("QName"),
            defaultLexical: string, defaultNamespaces: namespaces, fixedLexical: string,
            unsupported: array(name), unique: array(ref("UniqueConstraint")), types: array(typeAlternative)
        }, ["name", "type"]),
        XmlRegistry: object({
            types: map(ref("TypeDescriptor")), elements: map(ref("ElementDescriptor")), attributes: map(ref("AttributeDescriptor")),
            derivedTypes: map(array(typeAlternative))
        }, ["types", "elements", "attributes"]),
        SourceLocation: object(location, ["sourceId", "line"]),
        NativeSource: object({ kind: { enum: ["generated", "fixture"] }, document: name, locator: name, sha256: hash },
        ["kind", "document", "locator"]),
        SourceImport: object({ kind: name, namespace: { type: ["string", "null"] }, location: string,
            declaringNamespace: { type: ["string", "null"] }, sourceId: name }),
        LockedSource: object({
            id: name, kind: name, url: name, relativePath: name, storage: name, sha256: hash, bytes: count,
            targetNamespace: { type: ["string", "null"] }, schemaVersions: array(string), imports: array(ref("SourceImport"))
        }, ["id", "kind", "url", "relativePath", "storage", "sha256", "bytes"]),
        SourcePins: object({ lockDigest: hash, baseline: { type: "object" }, entryPoints: array(name, 1),
            sources: array(ref("LockedSource"), 1), xmlDocuments: count, imports: count }),
        CompilationIssue: object({ ...location, code: name, component: string, message: string },
        ["sourceId", "line", "code", "component", "message"]),
        MessageContract: object({ messageQName: ref("QName"), className: name,
            elementSource: ref("SourceLocation"), owner: { enum: ["caller", "service"] } }),
        FaultDescriptor: object({ name, messageQName: ref("QName"), element: ref("ElementDescriptor"), action: name, sourceId: name },
        ["name", "messageQName", "element", "sourceId"]),
        SourceField: object({
            ...location, xmlKind: name, xmlQName: ref("QName"), typeQName: ref("QName"), ...occurrences,
            use: string, defaultLexical: string, documentation: string
        }, ["sourceId", "line", "xmlKind", "documentation"]),
        TypeContract: object({
            ...location, id: name, name: ref("QName"), className: name, documentation: string,
            baseType: ref("QName"), fields: array(ref("SourceField"))
        }, ["sourceId", "line", "id", "className", "documentation", "fields"]),
        CompiledService: object({
            ...location, id: name, namespace: string, bindingQName: ref("QName"), portTypeQName: ref("QName"),
            className: name, group: { enum: ["canonical", "conditional-add-on"] },
            operationIds: array(name), hasConcreteService: { type: "boolean" }
        }, ["sourceId", "line", "id", "namespace", "bindingQName", "portTypeQName", "className", "group", "operationIds", "hasConcreteService"]),
        CompiledOperation: {
            ...object({
                ...operationReference, id: name, serviceNamespace: string, sourceId: name,
                portTypeSource: ref("SourceLocation"), soapActionSource: ref("SourceLocation"),
                soapAction: name, addressingAction: name, responseAction: name,
                addressingActionBasis: { enum: ["wsaw:Action", "soap12:operation/@soapAction"] },
                request: ref("ElementDescriptor"), response: { oneOf: [ref("ElementDescriptor"), { type: "null" }] },
                faults: array(ref("FaultDescriptor")),
                execution: object({ mode: { enum: ["request-response", "one-way"] }, safe: { type: "boolean" }, idempotent: { type: "boolean" } }),
                access: { enum: ["preauth", "read", "write", "actuate", "stateful", "unclassified"] },
                source: ref("NativeSource"), input: ref("MessageContract"),
                output: { oneOf: [ref("MessageContract"), { type: "null" }] },
                documentation: string, mappingSupport: { enum: ["compiled", "unsupported"] },
                reachableTypes: array(name), openContent: array(name), issues: array(ref("CompilationIssue"))
            }, ["bindingQName", "portTypeQName", "operation", "id", "serviceNamespace", "sourceId", "portTypeSource", "soapActionSource",
                "soapAction", "addressingAction", "addressingActionBasis", "request", "response", "execution", "access",
                "source", "input", "output", "documentation", "mappingSupport", "reachableTypes", "openContent", "issues"]),
            allOf: [
                { properties: { input: { properties: { owner: { const: "caller" } } } } },
                { if: { properties: { response: { type: "null" } } },
                    then: { properties: { output: { type: "null" }, execution: { properties: {
                        mode: { const: "one-way" }, safe: { const: false }, idempotent: { const: false }
                    } } } },
                    else: { properties: { output: { allOf: [ref("MessageContract"), { properties: { owner: { const: "service" } } }] },
                        execution: { properties: { mode: { const: "request-response" } } } } } }
            ]
        },
        Catalog: object({
            formatVersion: { const: 1 }, compilerVersion: { const: "onvif-canonical-1" }, registryDigest: hash,
            sourcePins: ref("SourcePins"), xml: ref("XmlRegistry"), types: array(ref("TypeContract")),
            services: array(ref("CompiledService")), operations: array(ref("CompiledOperation")), issues: array(ref("CompilationIssue"))
        })
    };
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema", $id: `${ONVIF_BASE}/schemas/mapping.schema.json`,
        title: "Public ONVIF canonical descriptor and source-catalog grammar, format 1",
        $ref: "#/$defs/Catalog", $defs: defs,
        $comment: "This is a public declarative grammar, not a private SourceType, SourceNode, XML codec handle or executable registry interface. Chapter 8 and Annex B additionally require graph closure, source pin agreement, occurrence comparisons, exact QName/value-space rules, derivation validity, work bounds and canonical digest checks. Unknown semantic descriptor fields are rejected."
    };
}
