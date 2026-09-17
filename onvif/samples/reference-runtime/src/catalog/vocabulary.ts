import { isRecord, OnvifError } from "../binding/errors.js";
import type { CanonicalCatalog } from "./compiler.js";
import { resourceKinds } from "./mappings.js";
import { ONVIF_BASE, ONVIF_CONTEXT, ONVIF_NAMESPACE, type Schema } from "./schemas.js";

export interface VocabularyTerm {
    readonly name: string;
    readonly kind: "class" | "property";
    readonly iri: string;
    readonly description: string;
    readonly representation: "class IRI" | "JSON literal" | "IRI" | "literal";
    readonly hosts: readonly string[];
    readonly producer: string;
    readonly consumer: string;
    readonly cardinality: string;
    readonly requiredness: string;
    readonly defaultBehavior: string;
    readonly validation: string;
    readonly securityPrivacy: string;
    readonly sourceReferences: readonly string[];
    readonly example: Schema;
    readonly exampleHost: "td" | "tm" | "action" | "form" | "event-form" | "data-schema" | "security";
    readonly counterexample: Schema;
    readonly counterexampleReason: string;
}

export interface VocabularyInventory {
    readonly namespace: string;
    readonly context: string;
    readonly version: string;
    readonly provisional: boolean;
    readonly authorship: string;
    readonly terms: readonly VocabularyTerm[];
}

export function assertVocabularyInventory(value: unknown, catalog: CanonicalCatalog): asserts value is VocabularyInventory {
    const fail = (message: string): never => { throw new OnvifError("InvalidRegistry", `Vocabulary inventory: ${message}`); };
    if (!isRecord(value) || value.namespace !== ONVIF_NAMESPACE || value.context !== ONVIF_CONTEXT
        || value.version !== "0.2-proposed" || value.provisional !== true || typeof value.authorship !== "string"
        || !Array.isArray(value.terms)) return fail("wrong namespace, context, edition or term array");
    const names = new Set<string>();
    for (const entry of value.terms) {
        if (!isRecord(entry) || typeof entry.name !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/u.test(entry.name)
            || names.has(entry.name) || entry.iri !== `${ONVIF_NAMESPACE}${entry.name}`
            || !["class", "property"].includes(String(entry.kind))
            || !["class IRI", "JSON literal", "IRI", "literal"].includes(String(entry.representation))) fail("invalid or duplicate term identity");
        for (const field of ["description", "producer", "consumer", "cardinality", "requiredness",
            "defaultBehavior", "validation", "securityPrivacy", "counterexampleReason"]) {
            if (typeof entry[field] !== "string" || !entry[field]) fail(`${entry.name}: missing ${field}`);
        }
        for (const field of ["hosts", "sourceReferences"]) {
            if (!Array.isArray(entry[field]) || entry[field].length === 0
                || entry[field].some((item: unknown) => typeof item !== "string" || !item)) fail(`${entry.name}: missing ${field}`);
        }
        if (!isRecord(entry.example) || !isRecord(entry.counterexample)) fail(`${entry.name}: complete example/counterexample objects are required`);
        if (!["td", "tm", "action", "form", "event-form", "data-schema", "security"].includes(String(entry.exampleHost))) fail(`${entry.name}: a declared TD/TM example host is required`);
        if (entry.kind === "class" && entry.name.endsWith("Thing")) fail(`${entry.name}: obsolete Thing-suffixed class IRI`);
        if (entry.kind === "class") {
            const host = ["CanonicalXmlValue", "XMLQName"].includes(entry.name) ? "data-schema"
                : entry.name.endsWith("SecurityScheme") ? "security" : "td";
            if (entry.exampleHost !== host || entry.example["@type"] !== `onvif:${entry.name}`) fail(`${entry.name}: class example has the wrong host or IRI`);
        } else if (!Object.hasOwn(entry.example, `onvif:${entry.name}`)) fail(`${entry.name}: example does not demonstrate its term`);
        const domains = (entry.hosts as string[]).join(" ");
        if ((entry.exampleHost === "data-schema" && !domains.includes("DataSchema"))
            || (entry.exampleHost === "form" && !domains.includes("Form"))
            || (entry.exampleHost === "event-form" && !domains.includes("Event Form"))) fail(`${entry.name}: example host contradicts its domain`);
        names.add(entry.name);
    }
    const requiredClasses = ["NativeContract", "Device", "Resource", "CanonicalXmlValue", "XMLQName",
        "UsernameTokenSecurityScheme", "MutualTlsSecurityScheme", "Semantic",
        ...resourceKinds(catalog).map((resource) => `${resource.kind}`)];
    for (const name of requiredClasses) if (!names.has(name)) fail(`missing source/model class ${name}`);
    for (const name of ["binding", "operation", "soapAction", "sourceDataSchema", "projection"]) {
        if (!names.has(name)) fail(`missing mapping term ${name}`);
    }
    for (const name of ["xml", "xmlRegistry", "xmlRegistryId", "xmlLimits", "xmlUnique", "input", "operationQName"]) {
        if (names.has(name)) fail(`${name} is private or an undeclared alias, not a public term`);
    }
}

export function renderVocabulary(inventory: VocabularyInventory, renderExample: (term: VocabularyTerm) => string): string {
    const cell = (value: string): string => value.replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
    return inventory.terms.map((term, index) => [
        `<a id="term-${term.name}"></a>`,
        `#### \`onvif:${term.name}\``,
        "",
        term.description,
        "",
        "| Field | Normative contract |",
        "| --- | --- |",
        `| IRI | \`${term.iri}\` |`,
        `| Kind and representation | ${term.kind}; ${term.representation} |`,
        `| Host | ${cell(term.hosts.join("; "))} |`,
        `| Producer and authority | ${cell(term.producer)} |`,
        `| Consumer | ${cell(term.consumer)} |`,
        `| Cardinality | ${cell(term.cardinality)} |`,
        `| Requiredness | ${cell(term.requiredness)} |`,
        `| Omission and default | ${cell(term.defaultBehavior)} |`,
        `| Validation and errors | ${cell(term.validation)} |`,
        `| Security and privacy | ${cell(term.securityPrivacy)} |`,
        `| Sources | ${term.sourceReferences.map((reference) => `[${reference}](${reference})`).join("; ")} |`,
        "",
        renderExample(term),
        "",
        `Invalid use at this host: ${term.counterexampleReason} [Rejected annotation](terms.json#/terms/${index}/counterexample).`,
        ""
    ].join("\n")).join("\n");
}

export function generateVocabulary(catalog: CanonicalCatalog, input: unknown): {
    terms: VocabularyInventory; context: Schema; ontology: string; shapes: string;
} {
    assertVocabularyInventory(input, catalog);
    const definitions: Record<string, unknown> = {
        "@version": 1.1, onvif: { "@id": ONVIF_NAMESPACE, "@prefix": true }
    };
    for (const term of input.terms.filter((entry) => entry.kind === "property")) {
        definitions[`onvif:${term.name}`] = term.representation === "JSON literal"
            ? { "@id": term.iri, "@type": "@json" } : term.representation === "IRI"
                ? { "@id": term.iri, "@type": "@id" } : term.iri;
    }
    const prefixes = [
        `@prefix onvif: <${ONVIF_NAMESPACE}> .`,
        "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> ."
    ];
    const ontology = [
        ...prefixes, "",
        ...input.terms.map((term) => `onvif:${term.name} a ${term.kind === "class" ? "rdfs:Class" : "rdf:Property"} ;\n`
            + `    rdfs:label ${JSON.stringify(term.name)} ;\n    rdfs:comment ${JSON.stringify(term.description)} ;\n`
            + `    rdfs:isDefinedBy <${ONVIF_BASE}/spec#term-${term.name}>`
            + (term.kind === "property" && term.representation !== "IRI"
                ? ` ;\n    rdfs:range ${term.representation === "JSON literal" ? "rdf:JSON" : "xsd:string"}` : "") + " .\n")
    ].join("\n");
    const shapes = [
        ...prefixes, "@prefix sh: <http://www.w3.org/ns/shacl#> .", "",
        ...input.terms.filter((term) => term.kind === "property").map((term) =>
            `onvif:${term.name}Shape a sh:PropertyShape ;\n    sh:targetSubjectsOf onvif:${term.name} ;\n`
            + `    sh:path onvif:${term.name} ;\n`
            + (term.cardinality.includes("set") || term.cardinality.includes("many") ? "" : "    sh:maxCount 1 ;\n")
            + (term.representation === "IRI" ? "    sh:nodeKind sh:IRI"
                : `    sh:datatype ${term.representation === "JSON literal" ? "rdf:JSON" : "xsd:string"}`) + " .\n"),
        "onvif:CanonicalDataShape a sh:NodeShape ;",
        "    sh:targetClass onvif:CanonicalXmlValue ;",
        "    sh:property [ sh:path onvif:sourceDataSchema ; sh:minCount 1 ; sh:maxCount 1 ; sh:nodeKind sh:IRI ] ;",
        '    sh:property [ sh:path onvif:validation ; sh:hasValue "sourceDataSchema-and-canonical-codec" ] .',
        "",
        "# Opaque rdf:JSON record members are validated by binding.schema.json, not invented RDF predicates.",
        ""
    ].join("\n");
    return { terms: input, context: { "@context": definitions }, ontology, shapes };
}
