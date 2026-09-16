import { invalidValue, OnvifError } from "../binding/errors.js";
import { identityValueKey } from "./simple-values.js";
import {
    childElements, equalQName, isNCName, XML_NS, type CanonicalValue, type ElementDescriptor,
    type IdentityPath, type SimpleType, type UniqueConstraint, type XmlAttribute, type XmlElement, type XmlNameTest
} from "./types.js";

export function parseIdentityXPath(
    expression: string, namespaces: Readonly<Record<string, string>>, selector: boolean
): IdentityPath[] {
    if (!expression || expression.length > 4096) throw new OnvifError("UnsupportedCapability", "Identity XPath exceeds the supported bound");
    const name = (value: string): XmlNameTest => {
        if (value === "*") return { namespace: null, localName: null };
        const components = value.split(":");
        const localName = components.at(-1);
        if (components.length > 2 || (localName !== "*" && !isNCName(localName))) {
            throw new OnvifError("UnsupportedCapability", "Identity XPath requires QName child/attribute steps");
        }
        if (components.length === 1) return { namespace: "", localName: localName === "*" ? null : localName };
        const prefix = components[0];
        if (!isNCName(prefix) || !Object.hasOwn(namespaces, prefix)) {
            throw new OnvifError("UnsupportedCapability", "Identity XPath has an unbound namespace prefix");
        }
        return { namespace: namespaces[prefix] ?? "", localName: localName === "*" ? null : localName };
    };
    return expression.split("|").map((alternative) => {
        let path = alternative.trim();
        const descendant = path.startsWith(".//");
        if (descendant) path = path.slice(3);
        else if (path.startsWith("./")) path = path.slice(2);
        if (path === ".") return { descendant, elements: [] };
        const steps = path.split("/");
        if (steps.length > 64 || steps.some((step) => !step || step !== step.trim())) {
            throw new OnvifError("UnsupportedCapability", "Identity XPath path is not in the checked child/descendant subset");
        }
        const last = steps.at(-1);
        let attribute: XmlNameTest | undefined;
        if (last?.startsWith("@")) {
            if (selector) throw new OnvifError("UnsupportedCapability", "An identity selector cannot select attributes");
            attribute = name(last.slice(1));
            steps.pop();
        }
        return { descendant, elements: steps.map(name), ...(attribute === undefined ? {} : { attribute }) };
    });
}

type TypedValue = { type: SimpleType; value: CanonicalValue };
type Target = XmlElement | XmlAttribute;

export class IdentityValidation {
    private readonly ids = new Map<string, Target>();
    private readonly values = new WeakMap<Target, TypedValue>();
    private readonly attributes = new WeakMap<XmlElement, XmlAttribute[]>();
    private readonly constraints: { node: XmlElement; constraint: UniqueConstraint }[] = [];
    private work = 0;

    constructor(root: XmlElement) {
        const visit = (node: XmlElement): void => {
            this.bound();
            for (const attribute of node.attributes) {
                if (!equalQName(attribute.name, { namespace: XML_NS, localName: "id" })) continue;
                const id = attribute.value.replace(/[\t\r\n]/gu, " ").trim().replace(/ +/gu, " ");
                if (!isNCName(id)) invalidValue("xml:id must be an XML NCName");
                this.addId(id, attribute);
                this.values.set(attribute, { type: { kind: "scalar", type: "ID" }, value: id });
            }
            for (const child of childElements(node)) visit(child);
        };
        visit(root);
    }

    private bound(): void {
        if (++this.work > 2000000) throw new OnvifError("XmlLimit", "XML identity-constraint work bound exceeded");
    }

    private addId(id: string, target: Target): void {
        const existing = this.ids.get(id);
        if (existing !== undefined && existing !== target) invalidValue("Duplicate document-wide XML ID");
        this.ids.set(id, target);
    }

    record(target: Target, type: SimpleType, value: CanonicalValue): void {
        this.values.set(target, { type, value });
        const id = (current: SimpleType, input: CanonicalValue): void => {
            if (current.kind === "restriction") id(current.base, input);
            else if (current.kind === "scalar" && current.type === "ID") this.addId(String(input), target);
            else if (current.kind === "union" && input !== null && typeof input === "object"
                && "$member" in input && "$value" in input) {
                const selected = current.members.find((member) => member.name === input.$member);
                if (selected !== undefined) id(selected.type, input.$value as CanonicalValue);
            }
        };
        id(type, value);
    }

    defaultAttribute(node: XmlElement, attribute: XmlAttribute, type: SimpleType, value: CanonicalValue): void {
        const attributes = this.attributes.get(node) ?? [...node.attributes];
        attributes.push(attribute);
        this.attributes.set(node, attributes);
        this.record(attribute, type, value);
    }

    scope(descriptor: ElementDescriptor, node: XmlElement): void {
        for (const constraint of descriptor.unique ?? []) this.constraints.push({ node, constraint });
    }

    private select(context: XmlElement, paths: readonly IdentityPath[]): Target[] {
        const result = new Set<Target>();
        const matches = (test: XmlNameTest, node: Target): boolean =>
            (test.namespace === null || test.namespace === node.name.namespace)
            && (test.localName === null || test.localName === node.name.localName);
        for (const path of paths) {
            let current: XmlElement[] = [context];
            if (path.descendant) {
                const collect = (node: XmlElement): void => {
                    for (const child of childElements(node)) { this.bound(); current.push(child); collect(child); }
                };
                collect(context);
            }
            for (const step of path.elements) {
                current = current.flatMap((node) => childElements(node).filter((child) => {
                    this.bound();
                    return matches(step, child);
                }));
            }
            if (path.attribute === undefined) for (const node of current) result.add(node);
            else for (const node of current) {
                for (const attribute of this.attributes.get(node) ?? node.attributes) {
                    this.bound();
                    if (matches(path.attribute, attribute)) result.add(attribute);
                }
            }
        }
        return [...result];
    }

    validate(): void {
        for (const { node, constraint } of this.constraints) {
            const tuples = new Set<string>();
            for (const selected of this.select(node, constraint.selector)) {
                if (!("kind" in selected)) invalidValue("Identity selector did not select an element");
                const tuple: string[] = [];
                let complete = true;
                for (const paths of constraint.fields) {
                    const fields = this.select(selected, paths);
                    if (fields.length > 1) invalidValue("An xs:unique field selected multiple values");
                    const field = fields[0];
                    if (field === undefined) { complete = false; continue; }
                    const typed = this.values.get(field);
                    if (typed === undefined) {
                        if ("kind" in field && field.attributes.some((attribute) =>
                            attribute.name.namespace === "http://www.w3.org/2001/XMLSchema-instance"
                            && attribute.name.localName === "nil" && ["true", "1"].includes(attribute.value))) {
                            complete = false;
                            continue;
                        }
                        throw new OnvifError("UnsupportedCapability", "Identity field requires a schema-typed simple value");
                    }
                    tuple.push(identityValueKey(typed.type, typed.value));
                }
                if (!complete) continue;
                const key = JSON.stringify(tuple);
                if (tuples.has(key)) invalidValue(`Duplicate xs:unique tuple in {${constraint.name.namespace}}${constraint.name.localName}`);
                tuples.add(key);
            }
        }
    }
}

export function validateXmlIds(root: XmlElement): void { new IdentityValidation(root); }
