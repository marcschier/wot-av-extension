"use strict";

const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join, resolve, relative } = require("node:path");
const { root } = require("./paths.cjs");
const { generateVocabulary } = require("../samples/reference-runtime/dist/catalog/vocabulary.js");
const base = join(root, "onvif");
const read = (name) => JSON.parse(readFileSync(join(base, ...name.split("/")), "utf8"));
const nativeProse = Object.freeze({
    "AccessControl.xml": "32e2dee49155baacf65cfb687f16389f5bc233d0",
    "AccessRules.xml": "7153a82fd6aeac70e5787356ade3333d59dc96f2",
    "Analytics.xml": "dda9216fbd06e27a8df8b22fa4be85709556f44b",
    "AuthenticationBehavior.xml": "38246c1ac4d059cc1b91631bfe4c3ec9d2a380e7",
    "Core.xml": "cc94dcfd9c2282c9178a7f53a087184c87aeab38",
    "Credential.xml": "be772faf573294faaecd57326efbd472eaf47b1e",
    "DeviceIo.xml": "738c64de5df0818a15c3199b51af6a0ccec520a8",
    "DoorControl.xml": "bec1b7b1588a7093d92be4932b2711982eb5c55f",
    "Imaging.xml": "64aefbb5782c2f5807721a91aeb342c1343bb157",
    "Media.xml": "ddf7c0401d2b966870b2242245fc5c51abd7af59",
    "Media2.xml": "cd4d822f330dffe738c3666531966867be896559",
    "PTZ.xml": "644fceb9f9d3a1671d650dcc3959557817a37a4b",
    "Receiver.xml": "3779f4db97b38c65dc6ef251969f5c2eee8b0a07",
    "RecordingControl.xml": "ef310bf02434fc5b018eb77fdd08503ad2958528",
    "RecordingSearch.xml": "86169409a9394259772adaf354008e03074ef4b1",
    "Replay.xml": "b21e0a54c9088a55f2dda0c592689775e7845782",
    "Schedule.xml": "2c378195b6fa5f37b88786522e80cd687b5f6d16",
    "Security.xml": "807cda1bfed41aa58e69d65d6c599d97f44a50e8",
    "Streaming.xml": "36f61704abccc3cd25c155d6d5cef8ed5090d77f"
});

function replaceRegion(text, key, content) {
    const start = `<!-- BEGIN GENERATED: ${key} -->`, end = `<!-- END GENERATED: ${key} -->`;
    if (text.split(start).length !== 2 || text.split(end).length !== 2) throw new Error(`Exactly one generated region is required: ${key}`);
    const first = text.indexOf(start), last = text.indexOf(end);
    if (last < first) throw new Error(`Reversed generated region: ${key}`);
    return text.slice(0, first + start.length) + "\n" + content.trim() + "\n" + text.slice(last);
}

function schemaShape(schema) {
    if (schema.$ref) return `[\`${schema.$ref.split("/").at(-1)}\`](mapping.schema.json${schema.$ref})`;
    if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
    if (schema.enum) return schema.enum.map((value) => `\`${value}\``).join(", ");
    if (schema.oneOf) return schema.oneOf.map(schemaShape).join(" or ");
    if (schema.type === "array") return `ordered array of ${schemaShape(schema.items)}`;
    if (schema.type === "object" && schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `map of ${schemaShape(schema.additionalProperties)}`;
    }
    return Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type ?? "declared constrained value";
}

function descriptorReference(schema) {
    return [
        "Every record below is a public data contract. The linked definition supplies its complete JSON Schema, including closed fields, alternatives and conditional constraints. Cross-field, graph and native value-space checks in Chapter 8 and Annex B remain mandatory; no private runtime object supplies missing semantics.",
        "",
        ...Object.entries(schema.$defs).map(([name, definition]) => [
            `<a id="descriptor-${name}"></a>`,
            `#### ${name}`,
            "",
            `Definition: [\`mapping.schema.json#/$defs/${name}\`](mapping.schema.json#/$defs/${name}).`,
            "",
            ...(definition.properties ? [
                "| Member | Requiredness and value |",
                "| --- | --- |",
                ...Object.entries(definition.properties).map(([key, value]) =>
                    `| \`${key}\` | ${(definition.required ?? []).includes(key) ? "Required" : "Optional"}; ${schemaShape(value)}${value.default === undefined ? "" : `; descriptor default \`${JSON.stringify(value.default)}\``} |`),
                "",
                definition.additionalProperties === false ? "Undeclared members are forbidden." : "Extension handling follows the linked schema."
            ] : [schemaShape(definition)]),
            ""
        ].join("\n"))
    ].join("\n");
}

function closureReference(catalog, requirements, models, manifest, terms) {
    const documents = models.models;
    const tm = documents.filter((entry) => entry["@type"] === "tm:ThingModel");
    const semantic = tm.filter((entry) => entry.id.includes("/models/abstract/"));
    return [
        "The following inventory is generated from this edition's actual normative annexes. These are source/model counts, not operation execution, hardware qualification, runtime support, publication clearance or product conformance.",
        "",
        "| Coordinate | Current value |",
        "| --- | --- |",
        `| Registry digest | \`${catalog.registryDigest}\` |`,
        `| Requirements digest | \`${requirements.digest}\` |`,
        `| Source lock digest | \`${catalog.sourcePins.lockDigest}\` |`,
        `| Qualified source operations | ${catalog.operations.length} |`,
        `| Source type contracts | ${catalog.types.length} |`,
        `| Native overlays with preserved IDs | ${tm.length - semantic.length} |`,
        `| Additive form-free abstract TMs | ${semantic.length} |`,
        `| Separate client manifests | ${documents.filter((entry) => entry.kind === "client-requirement-manifest").length} |`,
        `| Original requirement atoms / source groups | ${requirements.requirements.length} / ${requirements.obligationGroups.length} |`,
        `| Vocabulary entries | ${terms.terms.length}; ${terms.originalTerms.length} preserved plus ${terms.terms.length - terms.originalTerms.length} declared model terms |`,
        `| Manifest-owned generated artifacts, including manifest | ${manifest.artifacts.length + 1} |`,
        "",
        "Native public document IDs are unchanged. The [translation map](model-translation.json) gives each native physical path and versioned abstract counterpart; the [manifest](model-manifest.json) gives byte hashes, roles and physical paths. The complete [model index](models.json), [descriptor catalog](catalog.json), [public descriptor grammar](mapping.schema.json), [canonical value library](payloads.schema.json), [typed binding declarations](binding.schema.json), and [topic contracts](topic-contracts.json) are incorporated, not replaced by this table.",
        "",
        "| Native binding | PortType namespace and local name | Operations / source group |",
        "| --- | --- | --- |",
        ...catalog.services.map((service) =>
            `| \`{${service.bindingQName.namespace}}${service.bindingQName.localName}\` | \`{${service.portTypeQName.namespace}}${service.portTypeQName.localName}\` | ${service.operationIds.length}; ${service.group} |`),
        "",
        "The binding and portType namespaces above need not be equal. Every concrete action's SOAP action is the catalog's source literal, not a concatenation of a displayed service/operation name."
    ].join("\n");
}

function referenceDefinitions(markdown) {
    const result = new Map();
    for (const match of markdown.matchAll(/^\[([^\]]+)\]:\s+(\S+)\s*$/gm)) {
        const key = match[1].toLowerCase();
        if (result.has(key)) throw new Error(`Duplicate bibliography definition: ${key}`);
        let url;
        try { url = new URL(match[2]); } catch (error) { throw new Error(`Invalid bibliography URL for ${key}`, { cause: error }); }
        if (url.protocol !== "https:" || url.username || url.password) throw new Error(`Unapproved bibliography URL: ${key}`);
        result.set(key, url.href);
    }
    return result;
}

function checkReferences(markdown, directory = base) {
    const definitions = referenceDefinitions(markdown);
    const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");
    for (const match of prose.matchAll(/\[[^\]\n]+\]\[([^\]\n]+)\]/g)) {
        if (!definitions.has(match[1].toLowerCase())) throw new Error(`Unresolved bibliography reference: ${match[1]}`);
    }
    const anchors = new Set();
    for (const match of prose.matchAll(/<a id="([^"]+)"><\/a>/g)) {
        if (anchors.has(match[1])) throw new Error(`Duplicate explicit anchor: ${match[1]}`);
        anchors.add(match[1]);
    }
    for (const match of prose.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^https:\/\//.test(target)) { new URL(target); continue; }
        if (target.startsWith("#")) {
            if (!anchors.has(target.slice(1))) throw new Error(`Unresolved local anchor: ${target}`);
            continue;
        }
        const [path, fragment] = target.split("#");
        const resolved = resolve(directory, ...decodeURIComponent(path).split("/"));
        const inside = relative(directory, resolved);
        if (!inside || inside.startsWith("..") || !existsSync(resolved)) throw new Error(`Unresolved local normative document: ${target}`);
        if (fragment && /\.json(?:ld)?$/i.test(path)) {
            if (!fragment.startsWith("/")) throw new Error(`Unsupported JSON reference: ${target}`);
            let value = JSON.parse(readFileSync(resolved, "utf8"));
            for (const part of fragment.slice(1).split("/")) {
                if (/~(?![01])/.test(part)) throw new Error(`Malformed JSON Pointer: ${target}`);
                const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
                if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Unresolved JSON Pointer: ${target}`);
                value = value[key];
            }
        }
    }
    return { references: definitions.size, anchors: anchors.size };
}

function bibliography(markdown, catalog, lock) {
    const definitions = referenceDefinitions(markdown);
    const normativeReferences = [...definitions].map(([key, href]) => {
        const native = /\/onvif\/specs\/blob\/([a-f0-9]+)\/doc\/([^/#]+\.xml)$/.exec(href);
        if (native && (native[1] !== catalog.sourcePins.baseline.commit || !Object.hasOwn(nativeProse, native[2]))) {
            throw new Error(`Native normative URL lacks verified pinned document identity: ${href}`);
        }
        const source = lock.sources.find((entry) => entry.url === href);
        const title = native ? `ONVIF ${native[2].replace(/\.xml$/, "")}, specification set ${catalog.sourcePins.baseline.release}`
            : key.startsWith("profile-") ? `ONVIF Profile ${key.at(-1).toUpperCase()}, selected published edition` : key;
        return { key, title, href, normative: true,
            ...(native ? { sourceId: `onvif:doc/${native[2]}`, repository: "onvif/specs",
                commit: native[1], path: `doc/${native[2]}`, gitBlobSha1: nativeProse[native[2]],
                verification: "Document path and blob identity verified against the immutable Git tree on 2026-09-16; incorporation is by reference, not a redistribution grant." } : {}),
            ...(source ? { sourceId: source.id, sha256: source.sha256, storage: source.storage } : {}),
            rights: "The referenced standard retains its original rights and notices. This mapping assigns no license or endorsement."
        };
    });
    return { formatVersion: 1, specification: "onvif/spec.md", mappingEdition: "0.2-proposed",
        status: "Independent original working draft; identifiers are not W3C or ONVIF endorsement.",
        verificationScope: "Offline citation, pointer and immutable native-document identity closure. Network reachability, formal publication and process-edition clearance remain separate gates.",
        normativeReferences,
        localBiblio: Object.fromEntries(normativeReferences.map((entry) => [entry.key, { title: entry.title, href: entry.href }])) };
}

function readableCoverage(requirements) {
    return [
        "# ONVIF draft coverage and interpretation status",
        "",
        "Generated for 0.2-proposed, 2026-09-16. This is an informative readable index, not native certification, hardware qualification or named editorial approval. Original source rows and dated historical notes remain evidence; the current normative authority is [the root specification](../../spec.md) and its declared annexes.",
        "",
        "| Profile / edition | Device atoms | Client atoms | Role boundary |",
        "| --- | ---: | ---: | --- |",
        ...requirements.profileEditions.filter((entry) => entry.publicationState === "released").map((edition) => {
            const rows = requirements.requirements.filter((row) => row.profile === edition.profileId && row.edition === edition.edition);
            return `| ${edition.profileId} ${edition.edition} | ${rows.filter((row) => row.role === "device").length} | ${rows.filter((row) => row.role === "client").length} | Source, native/proprietary feature, client implementation and resource scope remain distinct |`;
        }),
        "",
        `${requirements.requirements.length} original atoms and ${requirements.obligationGroups.length} original at-least-N groups are retained. Every atom keeps its raw source record, original local level, effective draft level and complete condition/native resolution. Conditions with missing or denied typed evidence remain unknown; applicability is never satisfaction.`,
        "",
        "NP-S1 uses the existing nonexclusive PTZ retrieval group with both table/prose assertions in the complete branch. NP-G1 separates mandatory SetTrackConfiguration interface availability from conditional dynamic-track update behavior. NP-G2 requires the complete interface only within each actual native/proprietary on-board feature. NP-A1 keeps client attestation separate from the peer Schedule flag.",
        "",
        "NP-G3's exact RecordingConfig/RecordingJobConfiguration topic is source-verified. RecordingControl 5.29.2 and Core 9.4.3 are both cited. Source RecordingJobToken and typed Configuration ElementItem are retained, with no invented same-named global element. The actual payload root still requires its trusted native message description. This is an affected payload/qualification boundary, not an unresolved topic-name guess.",
        "",
        "All named interpretations are deterministic draft rules. Their current decision records have empty reviewer lists, formalReleaseApproved=false, exact affected IDs and a before-formal-release named-editor/independent-domain-review gate. No external approval is fabricated.",
        "",
        "Historical pre-relocation/qualification notes do not re-open a resolved EPR-routing implementation issue or override this standard. Logical-route authorization, physical target authorization and publisher trust remain independent required decisions; a matching ID or source prefix is never an authorizer.",
        ""
    ].join("\n");
}

function assemble(check = false) {
    const catalog = read("catalog.json"), requirements = read("requirements-index.json"), terms = read("terms.json");
    const vocabulary = generateVocabulary(catalog, terms);
    let markdown = readFileSync(join(base, "spec.md"), "utf8").replaceAll("\r\n", "\n");
    markdown = replaceRegion(markdown, "terms.json#/terms", vocabulary.markdown);
    markdown = replaceRegion(markdown, "mapping.schema.json#/$defs", descriptorReference(read("mapping.schema.json")));
    markdown = replaceRegion(markdown, "model-manifest.json", closureReference(catalog, requirements, read("models.json"), read("model-manifest.json"), terms));
    for (const match of [...markdown.matchAll(/<!-- BEGIN EXAMPLE: ([^#\s]+)# -->[\s\S]*?<!-- END EXAMPLE: \1# -->/g)]) {
        const path = match[1], value = read(path);
        const replacement = `<!-- BEGIN EXAMPLE: ${path}# -->\n\`\`\`json\n${JSON.stringify(value, null, 4)}\n\`\`\`\n<!-- END EXAMPLE: ${path}# -->`;
        markdown = markdown.replace(match[0], replacement);
    }
    const citations = checkReferences(markdown);
    const outputs = new Map([
        [join(base, "spec.md"), markdown],
        [join(base, "support", "notes", "standards-list.json"), JSON.stringify(bibliography(markdown, catalog, read("sources.lock.json")), null, 4) + "\n"],
        [join(base, "support", "notes", "readable-coverage.md"), readableCoverage(requirements)]
    ]);
    const stale = [...outputs].filter(([path, value]) => !existsSync(path) || readFileSync(path, "utf8") !== value).map(([path]) => path);
    if (!check) for (const [path, value] of outputs) if (stale.includes(path)) writeFileSync(path, value);
    return { stale, check, ...citations, terms: terms.terms.length,
        words: markdown.split(/\s+/u).filter(Boolean).length, diagrams: (markdown.match(/```mermaid/g) ?? []).length };
}

module.exports = { assemble, checkReferences, bibliography, replaceRegion };
if (require.main === module) {
    try {
        if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node generate-spec-annexes.cjs [--check]");
        const result = assemble(process.argv.includes("--check"));
        if (result.check && result.stale.length) {
            console.error(`Stale ONVIF specification annexes:\n${result.stale.join("\n")}`);
            process.exitCode = 1;
        } else console.log(JSON.stringify({ ...result, stale: result.check ? result.stale : [], sourceBytes: "No remote standards bodies or private runtime fields are incorporated by this generator." }));
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Specification annex assembly failed");
        process.exitCode = 2;
    }
}
