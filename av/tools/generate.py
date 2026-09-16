"""Generate the thin draft, readable reference, offline cache and publication hashes."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys

sys.dont_write_bytecode = True

from rdflib import BNode, Literal
from rdflib.compare import to_canonical_graph
from rdflib.namespace import OWL, RDF, SH

import model
from generated_regions import assemble
from diagnostics import AVError
from common import (
    AV_CONTEXT, ROOT, SCHEMA_SHA, SCHEMA_URL, TD_CONTEXT, TD_CONTEXT_SHA, TD_REVISION,
    canonical_dataset, json_bytes, loader_for, metadata, native_forms, nodes,
    pointer, read, relative_file, sha,
)

CORE_OUTPUTS = {
    "av/context.jsonld", "av/ontology.ttl",
    "av/av.shacl.ttl", "av/support/reference/terms.md", "av/spec.md",
}
GENERATED_FILES = CORE_OUTPUTS | {
    "av/tools/fixtures/examples/cache-policy.json", "av/tools/fixtures/examples/manifest.json", "av/examples/dataset.nq",
    "av/support/publication/release-manifest.json",
}


def authored_files():
    names = {".gitattributes", ".gitignore", "requirements-dev.txt", "av/support/publication/provenance.json",
             "av/support/repository-overview.md", "av/spec.md", "av/support/history/v0.1-proposed.index.md",
             "av/support/history/v0.1-proposed.original-manifest.json", "publication-ownership.json"}
    ownership = json.loads((ROOT / "publication-ownership.json").read_bytes())
    names.update({
        "readme.md", "av/readme.md", "av/terms.json", "av/support/migration-v0.2.json",
        "av/support/migration.md", "av/support/validation.md",
        "av/support/publication/relocation-plan.json",
        "av/support/publication/relocation-plan.md",
        "av/support/publication/redirect-index.json",
        "av/support/publication/relocation-implementation.md",
        "av/support/publication/integration.md",
        "av/support/publication/transformation-register.json",
    })
    excluded = set(ownership["excludedBuildDirectoryNames"])
    for folder in ("av/tools", "av/examples", "av/samples/queries", "av/support/reference", "av/support/migration"):
        for directory, directories, filenames in os.walk(ROOT / folder):
            directories[:] = [name for name in directories if name not in excluded]
            for filename in filenames:
                path = ROOT / directory / filename
                if path.suffix in {".py", ".json", ".jsonld", ".md", ".rq", ".ttl", ".txt"}:
                    names.add(path.relative_to(ROOT).as_posix())
    for path in (ROOT / "av" / "support" / "upstream" / "wot").iterdir():
        if path.is_file():
            names.add(path.relative_to(ROOT).as_posix())
    return tuple(sorted(names - GENERATED_FILES))


AUTHORED_FILES = authored_files()


def packed(value, readable=False):
    return json.dumps(value, ensure_ascii=True, allow_nan=False,
                      separators=(", ", ": ") if readable else (",", ":"))


def context_text(context):
    return json_bytes(context).decode("utf-8")


def compact_turtle(graph, header):
    terms = model.TERMS
    if any(isinstance(node, BNode) for triple in graph for node in triple):
        graph = to_canonical_graph(graph)
    nodes = sorted({node for triple in graph for node in triple if isinstance(node, BNode)}, key=str)
    blank_names = {node: f"_:b{index:04d}" for index, node in enumerate(nodes, 1)}
    prefixes = {**terms["prefixes"], "owl": str(OWL), "sh": str(SH)}
    used = set()

    def token(node):
        if isinstance(node, BNode):
            return blank_names[node]
        if isinstance(node, Literal):
            value = packed(str(node))
            if node.language:
                return value + "@" + node.language
            return value + "^^" + token(node.datatype) if node.datatype else value
        value = str(node)
        for prefix, namespace in prefixes.items():
            if value.startswith(namespace):
                local = value[len(namespace):]
                if not local or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", local):
                    used.add(prefix)
                    return prefix + ":" + local
        return "<" + value + ">"

    statements = []
    for subject in sorted(set(graph.subjects()), key=token):
        clauses = []
        for predicate in sorted(set(graph.predicates(subject)), key=lambda p: (p != RDF.type, str(p))):
            objects = ", ".join(sorted(token(obj) for obj in graph.objects(subject, predicate)))
            clauses.append(("a" if predicate == RDF.type else token(predicate)) + " " + objects)
        statements.append(token(subject) + " " + " ; ".join(clauses) + " .")
    declarations = [f"@prefix {prefix}: <{prefixes[prefix]}> ." for prefix in sorted(used)]
    return "\n".join([*header, *declarations, "", *statements, ""])


def escape(value):
    return html.escape(str(value), quote=False).replace("|", "&#124;").replace("\n", "<br>")


def code(value):
    return "`" + escape(value) + "`"


def catalogue_entries(terms=None):
    terms = model.TERMS if terms is None else terms
    for name, definition in terms["classes"].items():
        yield "class-" + name.lower(), "av:" + name, "class", definition
    for name, definition in model.ALL_PROPERTIES.items() if terms is model.TERMS else (
        {**{"av:" + name: item for name, item in terms["properties"].items()},
         **terms["external_properties"]}.items()
    ):
        yield "property-" + name.replace(":", "-").lower(), name, "property", definition
    for group, values in terms["enums"].items():
        for member in values:
            name = member if isinstance(values, list) else "av:" + member
            doc = terms["enum_documentation"][group][member]
            definition = {"meaning": doc["describes"], "documentation": doc,
                          "group": group, "property": doc["property"]}
            yield "value-" + group.lower() + "-" + member.replace(":", "-").lower(), name, "controlled value", definition


def documentation_example(doc):
    example = doc["example"]
    if "file" in example:
        return pointer(read(relative_file(example["file"])), example.get("pointer", ""))
    return example["value"]


def documentation_lines(doc):
    labels = (
        ("defined_by", "Defined by"), ("declared_by", "Declared by"),
        ("source_of_truth", "Source of truth"), ("describes", "Describes"),
        ("used_by", "Used by"), ("how", "How to specify"), ("boundary", "Boundary"),
    )
    lines = []
    for field, label in labels:
        lines.extend([f"**{label}:** {doc[field]}", ""])
    omission = doc["when_omitted"]
    lines.extend([f"**Defaults / omission ({omission['policy']}):** {omission['explanation']}", ""])
    sample = doc["example"]
    location = f" `{sample['file']}` at JSON Pointer `{sample.get('pointer', '')}`." if "file" in sample else ""
    lines.extend([f"**Example:** {sample['scope']}.{location}", "",
                  "```json", json_bytes(documentation_example(doc)).decode("utf-8").rstrip("\n"), "```", ""])
    return lines


def entry_section(anchor, name, kind, definition):
    lines = [f'<a id="{anchor}"></a>', f"## `{name}` ({kind})", "", definition["meaning"], ""]
    if kind == "class":
        bases = ", ".join(definition["superclasses"]) or "none required"
        lines.extend([f"**Value / identity:** `{definition['identity']}`. **Superclasses:** {bases}.", ""])
    elif kind == "property":
        container = "unordered array/set" if definition.get("container") == "set" else "one value when present"
        lines.extend([f"**Datatype / container:** `{definition['value']}`; {container}. "
                      f"**Unit:** {definition.get('unit', 'not an additional numeric unit')}.", ""])
        if "conditions" in definition:
            lines.extend(["**Conditions:** " + definition["conditions"], ""])
    else:
        lines.extend([f"**Datatype / use:** controlled IRI in `{definition['group']}`, used by `{definition['property']}`. "
                      "Cardinality and conditions are those of that property, not a second field.", ""])
    lines.extend(documentation_lines(definition["documentation"]))
    normative = definition["documentation"].get("specification", {}).get("normative_text")
    if normative:
        normative = re.sub(r"\]\(#", "](../../spec.md#", normative)
        lines.extend(["**Edition-specific definition and counterexample:**", "", normative, ""])
    if kind == "property":
        for domain, usage in definition["uses"].items():
            maximum = "*" if usage["max"] is None else usage["max"]
            lines.extend([f"### Use on `{domain}`", "",
                          f"**Range:** `{usage['range']}`. **Cardinality:** `{usage['min']}..{maximum}`.", ""])
            lines.extend(documentation_lines(usage["documentation"]))
    return "\n".join(lines).rstrip() + "\n"


def catalogue():
    terms = model.TERMS
    entries = list(catalogue_entries())
    lines = [
        "# WoT AV 0.2 - complete thin-core reference", "",
        f"**Local breaking draft; namespace unregistered and context unhosted.** "
        f"`av/terms.json` defines {len(terms['classes'])} classes, "
        f"{len(terms['properties'])} AV properties and {len(terms['external_properties'])} directly reused "
        "external mappings. Only `dcterms:identifier` adds a required external field on Tracks/inputs. "
        "There are **zero mandatory AV pinned-profile families**.", "",
        "Documentation metadata is authoring-only, not an AV payload. Domains are alternative uses, "
        "not global RDFS intersections. `*` is unbounded. Every per-use responsibility, absence "
        "rule and example is explicit below. A fragment is not a runnable camera request.", "",
        "Metadata matching does not establish authorization, availability, decoder qualification "
        "or runtime acceptance. Native controls and payload schemas remain authoritative.", "",
        "## Entry index", "",
    ]
    lines.extend(f"- [{name} - {kind}](#{anchor})" for anchor, name, kind, _ in entries)
    lines.append("")
    lines.extend(entry_section(*entry) for entry in entries)
    for section in ("conventions", "matching_rules", "native_form_rules", "processing_contract", "shape_coverage", "codec_publication"):
        lines.extend(["", "## " + section.replace("_", " ").capitalize(), ""])
        for name, value in terms[section].items():
            lines.extend(["### " + name.replace("_", " ").capitalize(), ""])
            if isinstance(value, str):
                lines.extend([value, ""])
            else:
                lines.extend(["```json", json_bytes(value).decode("utf-8").rstrip("\n"), "```", ""])
    lines.extend(["## Historical migration", "",
                  "The complete term/profile mapping is in `av/support/migration-v0.2.json`. "
                  "Original v0.1 bytes remain in `av/support/history/v0.1-proposed`; there are no silent IRI aliases.", "",
                  "## Specification baselines", ""])
    lines.extend("- " + url for url in terms["baseline"])
    return "\n".join(lines).rstrip() + "\n"


def expected_outputs(*, core_only=False):
    outputs = {
        "av/spec.md": assemble(relative_file("av/spec.md").read_text(encoding="utf-8"), model.TERMS).encode("utf-8"),
        "av/context.jsonld": context_text(model.make_context()).encode("utf-8"),
        "av/ontology.ttl": compact_turtle(model.make_ontology(), [
            "# GENERATED from av/terms.json by av/tools/generate.py.",
            "# Original unregistered proposal; not a deployed or W3C-endorsed standard.",
        ]).encode("utf-8"),
        "av/av.shacl.ttl": compact_turtle(model.make_shapes(), [
            "# GENERATED from av/terms.json and structural rules in av/tools/model.py.",
            "# Thin core only: essential representation facts, exact-rate signs and JSON schema literals.",
            "# SHACL Core subset only; run av/tools/validate.py for meta-SHACL and fixture checks.",
            "# Finite explicit graphs, inference=none, no imports; success is not runtime acceptance.",
        ]).encode("utf-8"),
        "av/support/reference/terms.md": catalogue().encode("utf-8"),
    }

    def content(name):
        return outputs[name] if name in outputs else relative_file(name).read_bytes()

    for name, expected in (
        ("av/support/upstream/wot/td-context.jsonld", TD_CONTEXT_SHA),
        ("av/support/upstream/wot/td-schema.json", SCHEMA_SHA),
    ):
        if sha(content(name)) != expected:
            raise ValueError("Immutable W3C native artifact changed: " + name)
    if core_only:
        return outputs
    documents = {name: read(relative_file(name)) for name in AUTHORED_FILES
                 if name.startswith("av/examples/") and name.endswith((".td.json", ".jsonld"))}
    tds = {name: doc for name, doc in documents.items() if name.endswith(".td.json")}
    locations = {}

    def register(location, name):
        if location in locations and locations[location] != name:
            raise ValueError("Ambiguous authored TD document location: " + location)
        locations[location] = name

    for name, doc in tds.items():
        for offer in doc.get("av:offer", []):
            if offer.get("av:source") != doc.get("id"):
                raise ValueError("Authored Offer source must identify its containing TD: " + name)
            register(offer["av:document"], name)
    for document in documents.values():
        for node in nodes(document):
            if node.get("@type") == "av:FormReference":
                location, form_id = node["av:document"], node["av:form"]
                candidates = [name for name, td in tds.items()
                              if any(form.get("@id") == form_id for form in native_forms(td))]
                if location in locations:
                    if locations[location] not in candidates:
                        raise ValueError("FormReference disagrees with its authored document location")
                elif len(candidates) == 1:
                    register(location, candidates[0])
                else:
                    raise ValueError("FormReference requires a uniquely supplied native TD document: " + location)
    policy = {
        "release": model.TERMS["release"],
        "scope": "Generated offline example-document locations only; not runtime pins, deployment configuration or a network retrieval policy.",
        "network": "No automatic retrieval; callers explicitly supply documents.",
        "documents": [{"document": location, "path": name} for location, name in sorted(locations.items())],
    }
    outputs["av/tools/fixtures/examples/cache-policy.json"] = json_bytes(policy)
    cache = {location: metadata(name, content(name)) for location, name in sorted(locations.items())}
    for location, name in ((AV_CONTEXT, "av/context.jsonld"),
                           (TD_CONTEXT, "av/support/upstream/wot/td-context.jsonld"),
                           (SCHEMA_URL, "av/support/upstream/wot/td-schema.json")):
        cache[location] = metadata(name, content(name))
    graphs = {"urn:example:av02:graph:" + name.removeprefix("av/examples/"): metadata(name)
              for name in sorted(documents)}
    outputs["av/tools/fixtures/examples/manifest.json"] = json_bytes({
        "release": model.TERMS["release"],
        "scope": "Publication/offline-cache integrity only. No AV DocumentPin, profile closure, authenticity or runtime acceptance claim.",
        "cache": cache, "graphs": graphs,
        "schemaRevision": "w3c/wot-thing-description@" + TD_REVISION,
    })
    outputs["av/examples/dataset.nq"] = canonical_dataset(
        {graph_id: documents[item["path"]] for graph_id, item in graphs.items()},
        loader_for(model.make_context()),
    )
    artifacts = {name: metadata(name, content(name)) for name in sorted(set(AUTHORED_FILES) | outputs.keys())}
    outputs["av/support/publication/release-manifest.json"] = json_bytes({
        "release": model.TERMS["release"],
        "scope": "Active local draft, authored documentation and separate archive index/manifest; no private content or deployment.",
        "hashAlgorithm": "SHA-256 of complete representation octets",
        "selfHash": "Deliberately excluded: no document or manifest embeds its own digest.",
        "generationCommand": "python -B av\\tools\\generate.py",
        "validationCommand": "python -B av\\tools\\validate.py",
        "historicalSnapshot": "av/support/history/v0.1-proposed; verify separately with av\\tools\\archive_v01.py --check",
        "files": list(artifacts.values()),
    })
    return outputs


def check_generated(outputs=None):
    outputs = expected_outputs() if outputs is None else outputs
    stale = [name for name, data in outputs.items()
             if not relative_file(name).is_file() or relative_file(name).read_bytes() != data]
    if stale:
        raise AVError("AV_EDITION_INCONSISTENT", "Generated artifacts or publication hashes are stale; review changes before running "
                      "python av\\tools\\generate.py: " + ", ".join(stale), stage="generation")
    return len(outputs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare exact bytes without writing")
    parser.add_argument("--core-only", action="store_true", help="Generate/check owned core and root Markdown without resealing examples/publication")
    args = parser.parse_args()
    outputs = expected_outputs(core_only=args.core_only)
    if args.check:
        check_generated(outputs)
        print(json.dumps({"result": "passed", "generatedFiles": len(outputs), "writes": False}))
    else:
        for name, data in outputs.items():
            target = relative_file(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(json.dumps({"result": "generated", "files": list(outputs),
                          "scope": "local draft only; no runtime pins or execution"}))


if __name__ == "__main__":
    main()
