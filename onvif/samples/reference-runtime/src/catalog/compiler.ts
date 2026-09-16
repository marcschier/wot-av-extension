import { OnvifError } from "../binding/errors.js";
import { defineOperationRegistry, operationKey, type OperationDescriptor, type OperationReference } from "../binding/registry.js";
import { nativeOperationPolicy } from "../binding/operation-policy.js";
import { occurs, resolveType } from "../xml/descriptors.js";
import { parseIdentityXPath } from "../xml/identity.js";
import { assertSupportedXsdPattern } from "../xml/xsd-patterns.js";
import {
    type AttributeDescriptor, type ChoiceAlternative, type ComplexType, type ElementDescriptor,
    type Particle, type QName, type ScalarName, type SimpleFacets, type SimpleType, type TypeDescriptor,
    type WildcardConstraint, type XmlRegistry, type UniqueConstraint
} from "../xml/types.js";
import {
    attr, child, children, declaredName, digest, loadLockedSources, qkey, requiredAttr,
    SOAP12, sourceError, sourceQName, WSAW, WSDL, XSD, type LoadSourcesOptions,
    type LockedClosure, type LockedSource, type SourceNode
} from "./sources.js";

export interface SourceLocation {
    readonly sourceId: string;
    readonly line: number;
    readonly sha256?: string;
}

export interface CompilationIssue extends SourceLocation {
    readonly code: string;
    readonly component: string;
    readonly message: string;
}

export interface SourceField extends SourceLocation {
    readonly xmlKind: string;
    readonly xmlQName?: QName;
    readonly typeQName?: QName;
    readonly minOccurs?: number;
    readonly maxOccurs?: number | "unbounded";
    readonly use?: string;
    readonly defaultLexical?: string;
    readonly documentation: string;
}

export interface TypeContract extends SourceLocation {
    readonly id: string;
    readonly name?: QName;
    readonly className: string;
    readonly documentation: string;
    readonly baseType?: QName;
    readonly fields: readonly SourceField[];
}

export interface CompiledOperation extends OperationDescriptor {
    readonly id: string;
    readonly serviceNamespace: string;
    readonly sourceId: string;
    readonly portTypeSource: SourceLocation;
    readonly soapActionSource: SourceLocation;
    readonly addressingActionBasis: "wsaw:Action" | "soap12:operation/@soapAction";
    readonly input: {
        readonly messageQName: QName;
        readonly className: string;
        readonly elementSource: SourceLocation;
        readonly owner: "caller";
    };
    readonly output: {
        readonly messageQName: QName;
        readonly className: string;
        readonly elementSource: SourceLocation;
        readonly owner: "service";
    } | null;
    readonly documentation: string;
    readonly mappingSupport: "compiled" | "unsupported";
    readonly issues: readonly CompilationIssue[];
    readonly reachableTypes: readonly string[];
    readonly openContent: readonly string[];
}

export interface CompiledService extends SourceLocation {
    readonly id: string;
    readonly namespace: string;
    readonly bindingQName: QName;
    readonly portTypeQName: QName;
    readonly className: string;
    readonly group: "canonical" | "conditional-add-on";
    readonly operationIds: readonly string[];
    readonly hasConcreteService: boolean;
}

export interface CanonicalCatalog {
    readonly formatVersion: 1;
    readonly compilerVersion: "onvif-canonical-1";
    readonly registryDigest: string;
    readonly sourcePins: {
        readonly lockDigest: string;
        readonly baseline: Readonly<Record<string, unknown>>;
        readonly entryPoints: readonly string[];
        readonly sources: readonly LockedSource[];
        readonly xmlDocuments: number;
        readonly imports: number;
    };
    readonly xml: XmlRegistry;
    readonly types: readonly TypeContract[];
    readonly services: readonly CompiledService[];
    readonly operations: readonly CompiledOperation[];
    readonly issues: readonly CompilationIssue[];
}

interface SchemaContext {
    readonly namespace: string;
    readonly elementForm: string;
    readonly attributeForm: string;
}

interface Declaration {
    readonly node: SourceNode;
    readonly context: SchemaContext;
}

class UnsupportedSchema extends Error {
    constructor(readonly node: SourceNode, readonly feature: string) { super(feature); }
}

function unsupported(node: SourceNode, feature: string): never {
    throw new UnsupportedSchema(node, feature);
}

function documentation(node: SourceNode): string {
    const text = (value: SourceNode): string => [value.text, ...value.children.map(text)].join(" ");
    return node.children.filter((entry) =>
        (entry.name.namespace === XSD && entry.name.localName === "annotation")
        || (entry.name.namespace === WSDL && entry.name.localName === "documentation"))
        .map(text).join(" ").replace(/\s+/gu, " ").trim();
}

function bounds(node: SourceNode): { minOccurs: number; maxOccurs: number | "unbounded" } {
    const min = attr(node, "minOccurs") ?? "1", max = attr(node, "maxOccurs") ?? "1";
    if (!/^\d+$/u.test(min) || (max !== "unbounded" && !/^\d+$/u.test(max))) sourceError(node, "Invalid occurrence bound");
    const result: { minOccurs: number; maxOccurs: number | "unbounded" } = {
        minOccurs: Number(min), maxOccurs: max === "unbounded" ? "unbounded" : Number(max)
    };
    occurs(result);
    return result;
}

function wildcard(node: SourceNode, context: SchemaContext): WildcardConstraint {
    const value = attr(node, "namespace") ?? "##any";
    const process = attr(node, "processContents") ?? "strict";
    if (process !== "skip" && process !== "lax" && process !== "strict") sourceError(node, "Invalid wildcard processContents");
    if (value === "##any") return { processContents: process };
    if (value === "##other") return { notNamespaces: ["", context.namespace], processContents: process };
    const namespaces = value.trim().split(/\s+/u).map((name) => name === "##targetNamespace" ? context.namespace
        : name === "##local" ? "" : name);
    if (namespaces.some((name) => name.startsWith("##"))) sourceError(node, "Unknown wildcard namespace constraint");
    return { namespaces: [...new Set(namespaces)], processContents: process };
}

function isSimple(type: TypeDescriptor): type is SimpleType {
    return ["scalar", "list", "union", "restriction"].includes(type.kind);
}

function qnameSensitive(type: SimpleType): boolean {
    if (type.kind === "scalar") return type.type === "QName";
    if (type.kind === "restriction") return qnameSensitive(type.base);
    if (type.kind === "list") return qnameSensitive(type.item);
    return type.members.some((member) => qnameSensitive(member.type));
}

function primitive(name: string): TypeDescriptor | undefined {
    const scalars: Readonly<Record<string, ScalarName>> = {
        string: "string", boolean: "boolean", int: "int32", unsignedInt: "uint32",
        long: "int64", unsignedLong: "uint64", integer: "integer", decimal: "decimal",
        hexBinary: "hexBinary", base64Binary: "base64Binary", dateTime: "dateTime", QName: "QName",
        float: "float", double: "double", duration: "duration", date: "date", time: "time",
        gYearMonth: "gYearMonth", gYear: "gYear", gMonthDay: "gMonthDay", gDay: "gDay", gMonth: "gMonth",
        normalizedString: "normalizedString", token: "token", language: "language",
        Name: "Name", NCName: "NCName", NMTOKEN: "NMTOKEN", ID: "ID", anyURI: "anyURI", anySimpleType: "string"
    };
    if (Object.hasOwn(scalars, name)) {
        const type = scalars[name];
        if (type !== undefined) return { kind: "scalar", type };
    }
    if (name === "anyType") return { kind: "opaque" };
    const ranges: Readonly<Record<string, readonly [ScalarName, string | null, string | null]>> = {
        byte: ["int32", "-128", "127"], short: ["int32", "-32768", "32767"],
        unsignedByte: ["uint32", "0", "255"], unsignedShort: ["uint32", "0", "65535"],
        nonNegativeInteger: ["integer", "0", null], positiveInteger: ["integer", "1", null],
        nonPositiveInteger: ["integer", null, "0"], negativeInteger: ["integer", null, "-1"]
    };
    const range = Object.hasOwn(ranges, name) ? ranges[name] : undefined;
    if (range !== undefined) return { kind: "restriction", base: { kind: "scalar", type: range[0] },
        facets: { ...(range[1] === null ? {} : { minInclusive: range[1] }),
            ...(range[2] === null ? {} : { maxInclusive: range[2] }) } };
    if (name === "NMTOKENS") return { kind: "restriction",
        base: { kind: "list", item: { kind: "scalar", type: "NMTOKEN" } }, facets: { minLength: 1 } };
    if (["IDREF", "IDREFS", "ENTITY", "ENTITIES", "NOTATION"].includes(name)) {
        return { kind: "unsupported", feature: `XSD ${name} document-wide identity/declaration constraints` };
    }
    return undefined;
}

class Compiler {
    readonly definitions: Record<string, TypeDescriptor> = Object.create(null);
    readonly elements: Record<string, ElementDescriptor> = Object.create(null);
    readonly attributes: Record<string, AttributeDescriptor> = Object.create(null);
    readonly derivedTypes: Record<string, { name: QName; type: TypeDescriptor }[]> = Object.create(null);
    readonly contracts = new Map<string, TypeContract>();
    readonly issues: CompilationIssue[] = [];
    private readonly typeDeclarations = new Map<string, Declaration>();
    private readonly elementDeclarations = new Map<string, Declaration>();
    private readonly attributeDeclarations = new Map<string, Declaration>();
    private readonly attributeGroups = new Map<string, Declaration>();
    private readonly modelGroups = new Map<string, Declaration>();
    private readonly messages = new Map<string, SourceNode>();
    private readonly portTypes = new Map<string, SourceNode>();
    private readonly bindings: { node: SourceNode; namespace: string }[] = [];
    private readonly compiling = new Set<string>();
    private readonly anonymousIds = new WeakMap<SourceNode, string>();
    private readonly extensionBases = new Map<string, QName>();

    constructor(readonly closure: LockedClosure) { this.index(); }

    private location(node: SourceNode): SourceLocation {
        const sha256 = this.closure.documents.get(node.sourceId)?.source.sha256;
        return { sourceId: node.sourceId, line: node.line, ...(sha256 === undefined ? {} : { sha256 }) };
    }

    private register(map: Map<string, Declaration>, node: SourceNode, context: SchemaContext): void {
        const name = qkey(declaredName(node, context.namespace));
        const existing = map.get(name);
        if (existing !== undefined) sourceError(node, `Duplicate declaration ${name}; first at ${existing.node.sourceId}:${existing.node.line}`);
        map.set(name, { node, context });
    }

    private index(): void {
        for (const [, document] of [...this.closure.documents].sort(([a], [b]) => a.localeCompare(b, "en"))) {
            const root = document.root;
            if (root.name.namespace === WSDL && root.name.localName === "definitions") {
                const namespace = requiredAttr(root, "targetNamespace");
                for (const [kind, map] of [["message", this.messages], ["portType", this.portTypes]] as const) {
                    for (const entry of children(root, WSDL, kind)) {
                        const key = qkey(declaredName(entry, namespace));
                        if (map.has(key)) sourceError(entry, `Duplicate WSDL ${kind} ${key}`);
                        map.set(key, entry);
                    }
                }
                for (const binding of children(root, WSDL, "binding")) this.bindings.push({ node: binding, namespace });
            }
            const schemas = root.name.namespace === XSD && root.name.localName === "schema" ? [root]
                : children(root, WSDL, "types").flatMap((types) => children(types, XSD, "schema"));
            for (const schema of schemas) {
                const context: SchemaContext = {
                    namespace: attr(schema, "targetNamespace") ?? "",
                    elementForm: attr(schema, "elementFormDefault") ?? "unqualified",
                    attributeForm: attr(schema, "attributeFormDefault") ?? "unqualified"
                };
                for (const entry of children(schema, XSD)) {
                    switch (entry.name.localName) {
                        case "simpleType": case "complexType": this.register(this.typeDeclarations, entry, context); break;
                        case "element": this.register(this.elementDeclarations, entry, context); break;
                        case "attribute": this.register(this.attributeDeclarations, entry, context); break;
                        case "attributeGroup": this.register(this.attributeGroups, entry, context); break;
                        case "group": this.register(this.modelGroups, entry, context); break;
                        case "annotation": case "import": case "include": break;
                        default: sourceError(entry, `Unsupported schema-level construct ${entry.name.localName}`);
                    }
                }
            }
        }
    }

    private reference(name: QName, node: SourceNode): TypeDescriptor {
        const id = qkey(name);
        if (name.namespace === XSD && !Object.hasOwn(this.definitions, id)) {
            const type = primitive(name.localName);
            if (type === undefined) unsupported(node, `Unknown XML Schema builtin ${id}`);
            this.definitions[id] = type;
            this.contracts.set(id, { id, name, className: name.localName, sourceId: "builtin:xml-schema-1.0",
                line: 0, documentation: "XML Schema 1.0 builtin; lexical canonical representation, not JavaScript coercion.", fields: [] });
        } else if (name.namespace !== XSD && !this.typeDeclarations.has(id)) {
            unsupported(node, `Unresolved type QName ${id} in the locked import closure`);
        }
        return { kind: "ref", ref: id };
    }

    private concrete(name: QName, node: SourceNode): TypeDescriptor {
        const reference = this.reference(name, node);
        const id = qkey(name);
        const declaration = this.typeDeclarations.get(id);
        if (declaration !== undefined && !Object.hasOwn(this.definitions, id)) this.compileType(id, declaration);
        const type = resolveType(reference, this.xml());
        if (type.kind === "unsupported") unsupported(node, type.feature);
        return type;
    }

    private simpleReference(name: QName, node: SourceNode): SimpleType {
        const type = this.concrete(name, node);
        if (!isSimple(type)) unsupported(node, `Non-simple type ${qkey(name)} used in a simple value`);
        return type;
    }

    private typeUse(node: SourceNode, context: SchemaContext): TypeDescriptor {
        if (attr(node, "type") !== undefined) return this.reference(sourceQName(node, "type"), node);
        const inline = children(node, XSD).filter((entry) => ["simpleType", "complexType"].includes(entry.name.localName));
        if (inline.length > 1) sourceError(node, "More than one inline element type");
        const type = inline[0];
        if (type === undefined) return this.reference({ namespace: XSD, localName: "anyType" }, node);
        let id = this.anonymousIds.get(type);
        if (id === undefined) {
            id = `anonymous:${type.sourceId}#node-${type.ordinal}`;
            this.anonymousIds.set(type, id);
            this.compileType(id, { node: type, context }, attr(node, "name") ?? "Anonymous");
        }
        return { kind: "ref", ref: id };
    }

    private compileSimple(node: SourceNode, context: SchemaContext): SimpleType {
        const content = children(node, XSD).filter((entry) => entry.name.localName !== "annotation");
        if (content.length !== 1 || content[0] === undefined) unsupported(node, "Simple type must declare one restriction, list, or union");
        const spec = content[0];
        if (spec.name.localName === "list") {
            const item = attr(spec, "itemType") === undefined
                ? this.inlineSimple(spec, context) : this.simpleReference(sourceQName(spec, "itemType"), spec);
            if (item.kind === "list") unsupported(spec, "An XSD list cannot contain list items");
            return { kind: "list", item };
        }
        if (spec.name.localName === "union") {
            const members: { name: string; type: SimpleType }[] = [];
            for (const token of (attr(spec, "memberTypes") ?? "").trim().split(/\s+/u).filter(Boolean)) {
                const copy: SourceNode = { ...spec, attributes: { ...spec.attributes, member: token } };
                const name = sourceQName(copy, "member");
                members.push({ name: qkey(name), type: this.simpleReference(name, spec) });
            }
            for (const [index, inline] of children(spec, XSD, "simpleType").entries()) {
                members.push({ name: `inline-${index + 1}`, type: this.compileSimple(inline, context) });
            }
            if (members.length === 0) unsupported(spec, "Empty union");
            return { kind: "union", members };
        }
        if (spec.name.localName !== "restriction") unsupported(spec, `Unsupported simple type construct ${spec.name.localName}`);
        const base = attr(spec, "base") === undefined ? this.inlineSimple(spec, context)
            : this.simpleReference(sourceQName(spec, "base"), spec);
        const facets: SimpleFacets = {};
        const enumeration: { lexical: string; namespaces?: Readonly<Record<string, string>> }[] = [];
        const patterns: string[] = [];
        for (const facet of children(spec, XSD)) {
            const kind = facet.name.localName;
            if (kind === "annotation" || kind === "simpleType") continue;
            const value = attr(facet, "value");
            if (value === undefined) sourceError(facet, "Missing facet value");
            switch (kind) {
                case "enumeration":
                    enumeration.push({ lexical: value, ...(qnameSensitive(base) ? { namespaces: facet.namespaces } : {}) });
                    break;
                case "minInclusive": case "maxInclusive": case "minExclusive": case "maxExclusive": facets[kind] = value; break;
                case "length": case "minLength": case "maxLength":
                    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) sourceError(facet, "Invalid length facet");
                    facets[kind] = Number(value);
                    break;
                case "whiteSpace":
                    if (value !== "preserve" && value !== "replace" && value !== "collapse") sourceError(facet, "Invalid whiteSpace facet");
                    facets.whiteSpace = value;
                    break;
                case "pattern":
                    try { assertSupportedXsdPattern(value); }
                    catch (error) {
                        if (!(error instanceof OnvifError) || error.code !== "UnsupportedCapability") throw error;
                        unsupported(facet, error.message);
                    }
                    patterns.push(value);
                    break;
                default: unsupported(facet, `XSD ${kind} facet requires a qualified value-space validator (native value ${JSON.stringify(value)})`);
            }
        }
        if (enumeration.length) facets.enumeration = enumeration;
        if (patterns.length) facets.patterns = patterns;
        return Object.keys(facets).length ? { kind: "restriction", base, facets } : base;
    }

    private inlineSimple(node: SourceNode, context: SchemaContext): SimpleType {
        const inline = child(node, XSD, "simpleType");
        if (inline === undefined) unsupported(node, "Missing inline simple type");
        return this.compileSimple(inline, context);
    }

    private element(node: SourceNode, context: SchemaContext, global = false): ElementDescriptor {
        if (attr(node, "ref") !== undefined) {
            const name = sourceQName(node, "ref");
            const declaration = this.elementDeclarations.get(qkey(name));
            if (declaration === undefined) unsupported(node, `Unresolved element reference ${qkey(name)}`);
            return this.element(declaration.node, declaration.context, true);
        }
        const qualified = global || (attr(node, "form") ?? context.elementForm) === "qualified";
        const name = declaredName(node, qualified ? context.namespace : "");
        let type: TypeDescriptor;
        if (global) type = { kind: "ref", ref: `element:${qkey(name)}` };
        else type = this.typeUse(node, context);
        const nillable = attr(node, "nillable");
        const defaultLexical = attr(node, "default"), fixedLexical = attr(node, "fixed");
        const constraints = children(node, XSD).filter((entry) =>
            !["annotation", "simpleType", "complexType"].includes(entry.name.localName));
        const unique: UniqueConstraint[] = constraints.map((entry) => {
            if (entry.name.localName !== "unique") unsupported(entry, `XSD ${entry.name.localName} identity constraint is not qualified`);
            const selector = child(entry, XSD, "selector"), fields = children(entry, XSD, "field");
            if (selector === undefined || fields.length === 0) sourceError(entry, "Unique constraint lacks a selector or fields");
            try {
                return { name: declaredName(entry, context.namespace),
                    selector: parseIdentityXPath(requiredAttr(selector, "xpath"), selector.namespaces, true),
                    fields: fields.map((field) => parseIdentityXPath(requiredAttr(field, "xpath"), field.namespaces, false)) };
            } catch (error) {
                if (!(error instanceof OnvifError) || error.code !== "UnsupportedCapability") throw error;
                unsupported(entry, error.message);
            }
        });
        return {
            name, type,
            ...(nillable === undefined ? {} : { nillable: nillable === "true" || nillable === "1" }),
            ...(attr(node, "type") === undefined ? {} : { typeQName: sourceQName(node, "type") }),
            ...(defaultLexical === undefined ? {} : { defaultLexical, defaultNamespaces: node.namespaces }),
            ...(fixedLexical === undefined ? {} : { fixedLexical }),
            ...(unique.length ? { unique } : {})
        };
    }

    private attribute(node: SourceNode, context: SchemaContext, global = false): AttributeDescriptor {
        if (attr(node, "ref") !== undefined) {
            const name = sourceQName(node, "ref");
            const declaration = this.attributeDeclarations.get(qkey(name));
            if (declaration === undefined) unsupported(node, `Unresolved attribute reference ${qkey(name)}`);
            const value = this.attribute(declaration.node, declaration.context, true);
            return { ...value, ...(attr(node, "use") === "required" ? { required: true } : {}) };
        }
        const name = declaredName(node, global || (attr(node, "form") ?? context.attributeForm) === "qualified" ? context.namespace : "");
        const type = attr(node, "type") === undefined ? child(node, XSD, "simpleType") === undefined
            ? { kind: "scalar", type: "string" } as const : this.inlineSimple(node, context)
            : this.simpleReference(sourceQName(node, "type"), node);
        const defaultLexical = attr(node, "default"), fixedLexical = attr(node, "fixed");
        return { key: name.namespace ? qkey(name) : name.localName, name, type,
            ...(attr(node, "use") === "required" ? { required: true } : {}),
            ...(defaultLexical === undefined ? {} : { defaultLexical }),
            ...(fixedLexical === undefined ? {} : { fixedLexical }) };
    }

    private particles(nodes: readonly SourceNode[], context: SchemaContext, path = ""): Particle[] {
        const result: Particle[] = [];
        const keys = new Set<string>();
        const add = (particle: Particle, node: SourceNode): void => {
            if (keys.has(particle.key)) unsupported(node, `Repeated particle key ${particle.key} needs explicit model-group disambiguation`);
            keys.add(particle.key);
            result.push(particle);
        };
        for (const [index, node] of nodes.entries()) {
            if (node.name.namespace !== XSD || node.name.localName === "annotation") continue;
            const occurrence = bounds(node);
            const key = `${path}${index + 1}`;
            switch (node.name.localName) {
                case "element": {
                    const element = this.element(node, context);
                    const localKey = nodes.filter((entry) => entry.name.localName === "element"
                        && (attr(entry, "name") ?? attr(entry, "ref")?.split(":").at(-1)) === element.name.localName).length > 1
                        ? qkey(element.name) : element.name.localName;
                    add({ kind: "element", key: localKey, element, ...occurrence }, node);
                    break;
                }
                case "sequence": {
                    const sequence = this.particles(children(node, XSD), context, `${key}_`);
                    if (occurrence.maxOccurs === 1 && (occurrence.minOccurs === 1
                        || sequence.every((entry) => occurs(entry).min === 0))) {
                        for (const particle of sequence) add(particle, node);
                    } else {
                        if (sequence.every((entry) => occurs(entry).min === 0)) unsupported(node, "Nullable repeated/optional sequence has no observable grouping boundary");
                        add({ kind: "group", key: `$sequence${key}`, sequence, ...occurrence }, node);
                    }
                    break;
                }
                case "group": {
                    const name = sourceQName(node, "ref"), group = this.modelGroups.get(qkey(name));
                    if (group === undefined) unsupported(node, `Unresolved model group ${qkey(name)}`);
                    if (path.length > 128) unsupported(node, "Recursive model group");
                    add({ kind: "group", key: `$group${key}`,
                        sequence: this.particles(children(group.node, XSD), group.context, `${key}_`), ...occurrence }, node);
                    break;
                }
                case "choice": {
                    const alternatives: ChoiceAlternative[] = [];
                    let nullable = false;
                    const branches = children(node, XSD).filter((entry) => entry.name.localName !== "annotation");
                    for (const [branchIndex, branch] of branches.entries()) {
                        const count = bounds(branch);
                        nullable ||= count.minOccurs === 0;
                        const leaf = count.minOccurs === 1 && count.maxOccurs === 1
                            || occurrence.maxOccurs === "unbounded" && count.minOccurs <= 1 && count.maxOccurs !== 0;
                        if (branch.name.localName === "element" && leaf) {
                            const element = this.element(branch, context);
                            alternatives.push({ key: element.name.localName, element });
                        } else if (branch.name.localName === "any" && leaf) {
                            alternatives.push({ key: `$any${branchIndex + 1}`, any: wildcard(branch, context) });
                        } else {
                            alternatives.push({ key: attr(branch, "name") ?? `$branch${branchIndex + 1}`,
                                sequence: this.particles([branch], context, `${key}_${branchIndex + 1}_`) });
                        }
                    }
                    if (alternatives.length === 0) unsupported(node, "Empty XML choice");
                    add({ kind: "choice", key: `$choice${key}`, alternatives, ...occurrence,
                        ...(nullable ? { minOccurs: 0 } : {}) }, node);
                    break;
                }
                case "any": add({ kind: "any", key: `$any${key}`, ...occurrence, ...wildcard(node, context) }, node); break;
                default: unsupported(node, `Unsupported model particle ${node.name.localName}`);
            }
        }
        return result;
    }

    private attributesOf(node: SourceNode, context: SchemaContext, depth = 0): {
        attributes: AttributeDescriptor[]; wildcard?: WildcardConstraint;
    } {
        if (depth > 64) unsupported(node, "Recursive attribute group");
        const attributes: AttributeDescriptor[] = [];
        let any: WildcardConstraint | undefined;
        for (const entry of children(node, XSD)) {
            if (entry.name.localName === "attribute") {
                if (attr(entry, "use") === "prohibited") continue;
                attributes.push(this.attribute(entry, context));
            } else if (entry.name.localName === "attributeGroup") {
                const name = sourceQName(entry, "ref"), group = this.attributeGroups.get(qkey(name));
                if (group === undefined) unsupported(entry, `Unresolved attribute group ${qkey(name)}`);
                const expanded = this.attributesOf(group.node, group.context, depth + 1);
                attributes.push(...expanded.attributes);
                if (expanded.wildcard !== undefined) {
                    if (any !== undefined) unsupported(entry, "Intersection of attribute-group wildcards");
                    any = expanded.wildcard;
                }
            } else if (entry.name.localName === "anyAttribute") {
                if (any !== undefined) unsupported(entry, "Multiple attribute wildcards");
                any = wildcard(entry, context);
            }
        }
        return { attributes, ...(any === undefined ? {} : { wildcard: any }) };
    }

    private compileComplex(node: SourceNode, context: SchemaContext): ComplexType {
        let body = node;
        let base: ComplexType = { kind: "complex" };
        const complexContent = child(node, XSD, "complexContent"), simpleContent = child(node, XSD, "simpleContent");
        if (complexContent !== undefined && simpleContent !== undefined) sourceError(node, "Conflicting complex/simple content");
        const content = complexContent ?? simpleContent;
        if (content !== undefined) {
            const extension = child(content, XSD, "extension");
            if (extension === undefined) unsupported(content, "Complex/simple content restriction is not implemented");
            body = extension;
            const name = sourceQName(extension, "base");
            const compiled = this.concrete(name, extension);
            if (simpleContent !== undefined) {
                if (isSimple(compiled)) base = { kind: "complex", text: compiled };
                else if (compiled.kind === "complex" && compiled.text !== undefined) base = compiled;
                else unsupported(extension, "Simple-content extension has a non-simple base");
            } else {
                if (compiled.kind === "opaque" && name.namespace === XSD && name.localName === "anyType") {
                    base = { kind: "complex", mixed: true, anyAttributes: true,
                        attributeWildcard: { processContents: "lax" },
                        sequence: [{ kind: "any", key: "$anyType", minOccurs: 0, maxOccurs: "unbounded", processContents: "lax" }] };
                } else {
                    if (compiled.kind !== "complex") unsupported(extension, "Complex-content extension has a non-complex base");
                    base = compiled;
                }
            }
        }
        const supported = new Set(["annotation", "sequence", "choice", "group", "attribute", "attributeGroup", "anyAttribute"]);
        for (const entry of children(body, XSD)) {
            if (!supported.has(entry.name.localName)) unsupported(entry, `Unsupported complex-type construct ${entry.name.localName}`);
        }
        const attributes = this.attributesOf(body, context);
        const merged = [...base.attributes ?? [], ...attributes.attributes];
        if (new Set(merged.map((entry) => qkey(entry.name))).size !== merged.length) unsupported(body, "Duplicate inherited XML attribute");
        let attributeWildcard = attributes.wildcard ?? base.attributeWildcard;
        if (attributes.wildcard !== undefined && base.attributeWildcard !== undefined) {
            const a = attributes.wildcard, b = base.attributeWildcard;
            if (digest(a) !== digest(b)) unsupported(body, "Extension union of different attribute wildcards");
            attributeWildcard = a;
        }
        const particles = this.particles(children(body, XSD).filter((entry) => ["sequence", "choice", "group", "all"].includes(entry.name.localName)), context);
        if (base.text !== undefined && particles.length > 0) unsupported(body, "Simple content cannot add child particles");
        const sequence = [...base.sequence ?? [], ...particles];
        if (new Set(sequence.map((entry) => entry.key)).size !== sequence.length) {
            unsupported(body, "Inherited content particles have colliding canonical field names");
        }
        return { kind: "complex",
            ...(attr(node, "abstract") === "true" || attr(node, "abstract") === "1" ? { abstract: true } : {}),
            ...(["true", "1"].includes(attr(content ?? node, "mixed") ?? attr(node, "mixed") ?? String(base.mixed ?? false))
                ? { mixed: true } : {}),
            ...(merged.length ? { attributes: merged } : {}),
            ...(attributeWildcard === undefined ? {} : { anyAttributes: true, attributeWildcard }),
            ...(base.text === undefined ? { sequence } : { text: base.text }) };
    }

    private fieldContracts(node: SourceNode, context: SchemaContext): SourceField[] {
        const result: SourceField[] = [];
        const visit = (entry: SourceNode): void => {
            if (entry !== node && ["simpleType", "complexType"].includes(entry.name.localName)) return;
            if (entry.name.namespace === XSD && ["element", "attribute"].includes(entry.name.localName)) {
                const isElement = entry.name.localName === "element";
                const qualified = (attr(entry, "form") ?? (isElement ? context.elementForm : context.attributeForm)) === "qualified";
                const name = attr(entry, "ref") === undefined
                    ? declaredName(entry, qualified ? context.namespace : "") : sourceQName(entry, "ref");
                const use = attr(entry, "use"), defaultLexical = attr(entry, "default");
                result.push({ ...this.location(entry), xmlKind: entry.name.localName, xmlQName: name,
                    ...(attr(entry, "type") === undefined ? {} : { typeQName: sourceQName(entry, "type") }),
                    ...(isElement ? bounds(entry) : {}),
                    ...(use === undefined ? {} : { use }),
                    ...(defaultLexical === undefined ? {} : { defaultLexical }),
                    documentation: documentation(entry) });
            }
            for (const next of entry.children) visit(next);
        };
        visit(node);
        return result;
    }

    private compileType(id: string, declaration: Declaration, anonymousName?: string): void {
        if (this.compiling.has(id)) unsupported(declaration.node, `Cyclic type derivation/alias ${id}`);
        if (Object.hasOwn(this.definitions, id)) return;
        const { node, context } = declaration;
        this.compiling.add(id);
        const nativeName = attr(node, "name") === undefined ? undefined : declaredName(node, context.namespace);
        const content = child(node, XSD, "complexContent") ?? child(node, XSD, "simpleContent");
        const derivation = content === undefined ? child(node, XSD, "restriction")
            : child(content, XSD, "extension") ?? child(content, XSD, "restriction");
        const base = derivation === undefined || attr(derivation, "base") === undefined ? undefined : sourceQName(derivation, "base");
        if (nativeName !== undefined && base !== undefined) this.extensionBases.set(qkey(nativeName), base);
        this.contracts.set(id, { id, ...this.location(node), ...(nativeName === undefined ? {} : { name: nativeName }),
            className: nativeName?.localName ?? anonymousName ?? "Anonymous",
            documentation: documentation(node), ...(base === undefined ? {} : { baseType: base }),
            fields: this.fieldContracts(node, context) });
        try {
            this.definitions[id] = node.name.localName === "simpleType"
                ? this.compileSimple(node, context) : this.compileComplex(node, context);
        } catch (error) {
            if (!(error instanceof UnsupportedSchema)) throw error;
            this.definitions[id] = { kind: "unsupported", feature: `${error.node.sourceId}:${error.node.line}: ${error.feature}` };
            this.issues.push({ code: "unsupported-xsd", component: id, ...this.location(error.node), message: error.feature });
        } finally {
            this.compiling.delete(id);
        }
    }

    private xml(): XmlRegistry {
        return { types: this.definitions, elements: this.elements, attributes: this.attributes, derivedTypes: this.derivedTypes };
    }

    private compileElements(): void {
        for (const [key, declaration] of [...this.elementDeclarations].sort(([a], [b]) => a.localeCompare(b, "en"))) {
            const { node, context } = declaration;
            const id = `element:${key}`;
            this.contracts.set(id, { id, ...this.location(node), name: declaredName(node, context.namespace),
                className: requiredAttr(node, "name"), documentation: documentation(node), fields: this.fieldContracts(node, context) });
            try {
                this.definitions[id] = this.typeUse(node, context);
                this.elements[key] = this.element(node, context, true);
            } catch (error) {
                if (!(error instanceof UnsupportedSchema)) throw error;
                this.definitions[id] = { kind: "unsupported", feature: `${error.node.sourceId}:${error.node.line}: ${error.feature}` };
                this.elements[key] = { name: declaredName(node, context.namespace), type: { kind: "ref", ref: id } };
                this.issues.push({ code: "unsupported-xsd", component: id, ...this.location(error.node), message: error.feature });
            }
        }
        for (const [key, declaration] of [...this.attributeDeclarations].sort(([a], [b]) => a.localeCompare(b, "en"))) {
            try {
                this.attributes[key] = this.attribute(declaration.node, declaration.context, true);
            } catch (error) {
                if (!(error instanceof UnsupportedSchema)) throw error;
                const name = declaredName(declaration.node, declaration.context.namespace);
                this.attributes[key] = { key, name, type: { kind: "unsupported", feature: error.feature } };
                this.issues.push({ code: "unsupported-global-attribute", component: key, ...this.location(error.node), message: error.feature });
            }
        }
    }

    private typeAlternatives(): void {
        for (const [name, parent] of this.extensionBases) {
                let base: QName | undefined = parent;
                const seen = new Set<string>();
                while (base !== undefined && !seen.has(qkey(base))) {
                    const key = qkey(base);
                    const contract = this.contracts.get(name);
                    if (contract?.name !== undefined) {
                        (this.derivedTypes[key] ??= []).push({ name: contract.name, type: { kind: "ref", ref: name } });
                    }
                    seen.add(key);
                    base = this.extensionBases.get(key);
                }
        }
        for (const alternatives of Object.values(this.derivedTypes)) alternatives.sort((a, b) => qkey(a.name).localeCompare(qkey(b.name), "en"));
    }

    private message(name: QName, at: SourceNode): {
        element: ElementDescriptor; messageQName: QName; className: string; elementSource: SourceLocation;
    } {
        const message = this.messages.get(qkey(name));
        if (message === undefined) sourceError(at, `Unresolved WSDL message ${qkey(name)}`);
        const parts = children(message, WSDL, "part");
        if (parts.length !== 1 || parts[0] === undefined || attr(parts[0], "element") === undefined) {
            sourceError(message, "Only a single document/literal element message part is supported");
        }
        const elementName = sourceQName(parts[0], "element"), element = this.elements[qkey(elementName)];
        const declaration = this.elementDeclarations.get(qkey(elementName));
        if (element === undefined || declaration === undefined) sourceError(message, `Unresolved message element ${qkey(elementName)}`);
        return { element, messageQName: name, className: name.localName, elementSource: this.location(declaration.node) };
    }

    private reachability(elements: readonly ElementDescriptor[]): {
        issues: CompilationIssue[]; reachableTypes: string[]; openContent: string[];
    } {
        const issues = new Map<string, CompilationIssue>(), visited = new Set<string>(), open = new Set<string>();
        const visitType = (type: TypeDescriptor, component: string): void => {
            if (type.kind === "ref") {
                if (visited.has(type.ref)) return;
                visited.add(type.ref);
                const target = this.definitions[type.ref];
                if (target === undefined) throw new OnvifError("InvalidRegistry", `Dangling compiled type ${type.ref}`);
                visitType(target, type.ref);
            } else if (type.kind === "unsupported") {
                const location = this.contracts.get(component);
                const issue = { code: "unsupported-xsd", component, sourceId: location?.sourceId ?? "compiler",
                    line: location?.line ?? 0, message: type.feature };
                issues.set(`${component}:${type.feature}`, issue);
            } else if (type.kind === "opaque") open.add(`${component}:source-declared-anyType`);
            else if (type.kind === "complex") {
                if (type.anyAttributes) open.add(`${component}:attribute-wildcard:${type.attributeWildcard?.processContents ?? "skip"}`);
                for (const attribute of type.attributes ?? []) {
                    if (attribute.type.kind === "unsupported") visitType(attribute.type, `${component}/@${attribute.key}`);
                }
                for (const particle of type.sequence ?? []) visitParticle(particle, component);
            }
        };
        const visitParticle = (particle: Particle, component: string): void => {
            if (particle.kind === "element") visitElement(particle.element, component);
            else if (particle.kind === "group") particle.sequence.forEach((entry) => visitParticle(entry, component));
            else if (particle.kind === "choice") {
                for (const option of particle.alternatives) {
                    if ("element" in option) visitElement(option.element, component);
                    else if ("sequence" in option) option.sequence.forEach((entry) => visitParticle(entry, component));
                    else open.add(`${component}:choice-wildcard:${option.any.processContents ?? "skip"}`);
                }
            } else open.add(`${component}:element-wildcard:${particle.processContents ?? "skip"}`);
        };
        const visitElement = (element: ElementDescriptor, component: string): void => {
            for (const feature of element.unsupported ?? []) {
                issues.set(feature, { code: "unsupported-element", component, sourceId: this.contracts.get(component)?.sourceId ?? "compiler",
                    line: this.contracts.get(component)?.line ?? 0, message: feature });
            }
            visitType(element.type, component);
            const alternatives = element.types ?? (element.typeQName === undefined ? [] : this.derivedTypes[qkey(element.typeQName)] ?? []);
            for (const alternative of alternatives) visitType(alternative.type, component);
        };
        for (const element of elements) visitElement(element, `element:${qkey(element.name)}`);
        return { issues: [...issues.values()].sort((a, b) => a.component.localeCompare(b.component, "en")),
            reachableTypes: [...visited].sort(), openContent: [...open].sort() };
    }

    compile(): CanonicalCatalog {
        for (const [id, declaration] of [...this.typeDeclarations].sort(([a], [b]) => a.localeCompare(b, "en"))) this.compileType(id, declaration);
        this.compileElements();
        this.typeAlternatives();
        const canonical = new Set(this.closure.lock.sourceGroups.canonicalServiceEntryPoints ?? []);
        const addOns = new Set(this.closure.lock.sourceGroups.separateConditionalOrAddOnServices ?? []);
        const operations: CompiledOperation[] = [];
        const services: CompiledService[] = [];
        for (const { node, namespace } of this.bindings) {
            if (!canonical.has(node.sourceId) && !addOns.has(node.sourceId) && !this.closure.entryPoints.includes(node.sourceId)) continue;
            const bindingQName = declaredName(node, namespace), portTypeQName = sourceQName(node, "type");
            const portType = this.portTypes.get(qkey(portTypeQName));
            if (portType === undefined) sourceError(node, `Unresolved portType ${qkey(portTypeQName)}`);
            const soap = child(node, SOAP12, "binding");
            if (soap === undefined || attr(soap, "style") !== "document"
                || attr(soap, "transport") !== "http://schemas.xmlsoap.org/soap/http") {
                sourceError(node, "Only native SOAP 1.2 document/literal HTTP bindings are supported");
            }
            const operationIds: string[] = [];
            for (const bindingOperation of children(node, WSDL, "operation")) {
                const operationName = requiredAttr(bindingOperation, "name");
                const abstract = children(portType, WSDL, "operation").find((entry) => attr(entry, "name") === operationName);
                if (abstract === undefined) sourceError(bindingOperation, `Operation ${operationName} is absent from its qualified portType`);
                const action = child(bindingOperation, SOAP12, "operation");
                if (action === undefined) sourceError(bindingOperation, "Missing native SOAPAction");
                const soapAction = requiredAttr(action, "soapAction");
                for (const direction of ["input", "output"]) {
                    const io = child(bindingOperation, WSDL, direction);
                    if (io === undefined && direction === "output") continue;
                    const body = io === undefined ? undefined : child(io, SOAP12, "body");
                    if (body === undefined || attr(body, "use") !== "literal"
                        || attr(body, "encodingStyle") !== undefined || children(io ?? bindingOperation, SOAP12, "header").length) {
                        sourceError(bindingOperation, "SOAP body/header binding is not qualified document/literal");
                    }
                }
                const requestNode = child(abstract, WSDL, "input"), responseNode = child(abstract, WSDL, "output");
                if (requestNode === undefined) sourceError(abstract, "Solicit-response/output-only WSDL operations are unsupported");
                const input = this.message(sourceQName(requestNode, "message"), requestNode);
                const output = responseNode === undefined ? null : this.message(sourceQName(responseNode, "message"), responseNode);
                const addressingAction = attr(requestNode, "Action", WSAW) ?? soapAction;
                if (addressingAction !== soapAction) sourceError(requestNode, "Explicit WS-Addressing Action conflicts with native SOAPAction");
                const responseAction = responseNode === undefined ? undefined : attr(responseNode, "Action", WSAW);
                const faults = children(abstract, WSDL, "fault").map((fault) => {
                    const messageQName = sourceQName(fault, "message"), message = this.message(messageQName, fault);
                    const faultAction = attr(fault, "Action", WSAW);
                    return { name: requiredAttr(fault, "name"), messageQName, element: message.element,
                        sourceId: message.elementSource.sourceId, ...(faultAction === undefined ? {} : { action: faultAction }) };
                });
                const reference: OperationReference = { bindingQName, portTypeQName, operation: operationName };
                const id = `${bindingQName.localName}_${operationName}_${digest(reference).slice(0, 12)}`;
                const source = this.closure.documents.get(node.sourceId)?.source;
                if (source === undefined) sourceError(node, "Operation lost its source identity");
                const reach = this.reachability([input.element, ...(output === null ? [] : [output.element]), ...faults.map((fault) => fault.element)]);
                operations.push({
                    ...reference, id, serviceNamespace: namespace, sourceId: node.sourceId,
                    soapAction, addressingAction, ...(responseAction === undefined ? {} : { responseAction }),
                    request: input.element, response: output?.element ?? null, faults, ...nativeOperationPolicy(reference, output === null),
                    source: { kind: "generated", document: source.url, locator: `L${bindingOperation.line}`, sha256: source.sha256 },
                    portTypeSource: this.location(abstract), soapActionSource: this.location(action),
                    addressingActionBasis: attr(requestNode, "Action", WSAW) === undefined ? "soap12:operation/@soapAction" : "wsaw:Action",
                    input: { messageQName: input.messageQName, className: input.className, elementSource: input.elementSource, owner: "caller" },
                    output: output === null ? null : { messageQName: output.messageQName, className: output.className,
                        elementSource: output.elementSource, owner: "service" },
                    documentation: documentation(abstract),
                    mappingSupport: reach.issues.length ? "unsupported" : "compiled", ...reach
                });
                operationIds.push(id);
            }
            services.push({
                id: `${bindingQName.localName}_${digest({ bindingQName, portTypeQName }).slice(0, 12)}`,
                namespace, bindingQName, portTypeQName, ...this.location(node), className: portTypeQName.localName,
                group: addOns.has(node.sourceId) ? "conditional-add-on" : "canonical",
                operationIds: operationIds.sort(),
                hasConcreteService: children(this.closure.documents.get(node.sourceId)?.root ?? node, WSDL, "service").length > 0
            });
        }
        operations.sort((a, b) => operationKey(a).localeCompare(operationKey(b), "en"));
        services.sort((a, b) => a.id.localeCompare(b.id, "en"));
        const xml: XmlRegistry = {
            types: Object.fromEntries(Object.entries(this.definitions).sort(([a], [b]) => a.localeCompare(b, "en"))),
            elements: Object.fromEntries(Object.entries(this.elements).sort(([a], [b]) => a.localeCompare(b, "en"))),
            attributes: Object.fromEntries(Object.entries(this.attributes).sort(([a], [b]) => a.localeCompare(b, "en"))),
            derivedTypes: Object.fromEntries(Object.entries(this.derivedTypes).sort(([a], [b]) => a.localeCompare(b, "en")))
        };
        const registry = defineOperationRegistry(operations, xml);
        return {
            formatVersion: 1, compilerVersion: "onvif-canonical-1", registryDigest: registry.digest,
            sourcePins: { lockDigest: this.closure.lockDigest, baseline: this.closure.lock.baseline,
                entryPoints: this.closure.entryPoints,
                sources: [...this.closure.documents.values()].map((document) => document.source).sort((a, b) => a.id.localeCompare(b.id, "en")),
                xmlDocuments: this.closure.documents.size, imports: this.closure.importCount },
            xml, types: [...this.contracts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")), services, operations,
            issues: this.issues.sort((a, b) => `${a.component}:${a.message}`.localeCompare(`${b.component}:${b.message}`, "en"))
        };
    }
}

export function compileClosure(closure: LockedClosure): CanonicalCatalog {
    return new Compiler(closure).compile();
}

export function compileCatalog(options: LoadSourcesOptions): CanonicalCatalog {
    return compileClosure(loadLockedSources(options));
}
