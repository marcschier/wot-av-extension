"""Deterministically generate canonical artifacts and explicitly reseal fixture pins."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys

sys.dont_write_bytecode = True

from rdflib import BNode, Literal
from rdflib.compare import to_canonical_graph
from rdflib.namespace import OWL, RDF, SH

import model
from common import (
    AV_CONTEXT, SCHEMA_SHA, TD_CONTEXT_SHA, TD_REVISION, U, canonical_dataset,
    json_bytes, loader_for, metadata, read, relative_file, sha,
)

AUTHORED_FILES = (
    ".gitattributes", "requirements-dev.txt", "provenance.json",
    "vocabulary/terms.json", "spec/validation.md",
    "examples/NOTES.md", "examples/cache-policy.json",
    "examples/source.td.json", "examples/controller.td.json",
    "examples/need.jsonld", "examples/assignment.jsonld",
    "examples/query.rq", "examples/live.query.rq",
    "examples/profiles/http-profile.json", "examples/profiles/control-profile.json",
    "examples/profiles/acquisition.json", "examples/profiles/resource.json",
    "examples/profiles/codec.json", "examples/profiles/adapter.json",
    "tests/fixtures/live.td.json", "tests/fixtures/controller.json",
    "tests/fixtures/codec-fragments.jsonld", "tests/fixtures/expectations.json",
    "tools/common.py", "tools/model.py", "tools/generate.py",
    "tools/check_examples.py", "tools/check_shapes.py", "tools/validate.py",
    "third_party/wot/td-context.jsonld", "third_party/wot/td-schema.json",
    "third_party/wot/LICENSE.md", "third_party/wot/LICENSE-W3C-2023.txt",
    "third_party/wot/NOTICE-W3C.txt", "third_party/wot/manifest.json",
)


def packed(value, readable=False):
    return json.dumps(value, ensure_ascii=True, allow_nan=False,
                      separators=(", ", ": ") if readable else (",", ":"))


def context_text(context):
    entries = list(context["@context"].items())
    lines = ["{", '  "@context": {']
    for index, (key, value) in enumerate(entries):
        comma = "," if index + 1 < len(entries) else ""
        lines.append("    " + packed(key) + ": " + packed(value, True) + comma)
    return "\n".join([*lines, "  }", "}", ""])


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


def catalogue():
    terms = model.TERMS
    lines = [
        "# WoT AV v0.1 - complete term catalogue",
        "",
        "**Original, unregistered proposal; external context unhosted.** "
        "The sole authored term authority is `vocabulary/terms.json`: "
        "38 classes, 105 AV properties and 17 reused external properties.",
        "",
        "Domains are alternatives, not global RDFS intersections. More-specific class uses "
        "override inherited uses. Cardinalities count RDF values, except preferences count "
        "list items; * is unbounded. Set labels and SHACL helper names are not domain classes. "
        "Default JSON containers do not imply scalar-only values. Structural validity never "
        "establishes admission, qualification or present availability.",
        "",
        "## Classes and glossary",
        "| Class | Module | Identity | Superclasses | Complete meaning |",
        "|---|---|---|---|---|",
    ]
    for name, definition in terms["classes"].items():
        bases = ", ".join(code(base) for base in definition["superclasses"]) or "-"
        lines.append(f"| {code('av:' + name)} | {definition['module']} | "
                     f"{definition['identity']} | {bases} | {escape(definition['meaning'])} |")
    lines.extend([
        "", "## Property uses by domain",
        "| Property | Module | Domain | Range | Cardinality | Units | JSON value/container; lexical limits | Complete meaning |",
        "|---|---|---|---|---|---|---|---|",
    ])
    properties = {**{"av:" + key: item for key, item in terms["properties"].items()},
                  **terms["external_properties"]}
    for name, prop in properties.items():
        domains, ranges, cards = [], [], []
        for domain, usage in prop["uses"].items():
            domains.append(code(domain))
            values = usage["range"] if isinstance(usage["range"], list) else [usage["range"]]
            ranges.append(" OR ".join(code(value) for value in values))
            maximum = "*" if usage["max"] is None else str(usage["max"])
            cards.append(f"{usage['min']}..{maximum}")
        lexical = prop["value"] + "/" + prop.get("container", "default")
        for key in ("minimum", "pattern"):
            if key in prop:
                lexical += "; " + key + "=" + str(prop[key])
        lines.append(
            f"| {code(name)} | {prop.get('module', 'external reuse')} | {'<br>'.join(domains)} | "
            f"{'<br>'.join(ranges)} | {'<br>'.join(cards)} | {escape(prop.get('unit', '-'))} | "
            f"{escape(lexical)} | {escape(prop['meaning'])} |")
    lines.extend(["", "## Controlled IRI glossary", "| Set label | Complete members and meanings |", "|---|---|"])
    for name, values in terms["enums"].items():
        members = ([code("av:" + key) + ": " + escape(value) for key, value in values.items()]
                   if isinstance(values, dict) else [code(value) for value in values])
        lines.append("| " + code(name) + " | " + "<br>".join(members) + " |")
    lines.extend([
        "", "## Required pinned-profile contracts",
        "| Profile IRI | Document kind; profile-owned labels | Complete required meaning |",
        "|---|---|---|",
    ])
    for definition in terms["profiles"].values():
        labels = "; ".join(key + ": " + value for key, value in definition.get("controlled_values", {}).items())
        kind = code("av:" + definition["kind"]) + ("; " + escape(labels) if labels else "")
        lines.append(f"| {code(definition['iri'])} | {kind} | {escape(definition['required_meaning'])} |")
    for section in (
        "modules", "conventions", "native_form_rules", "admission_rules",
        "lifecycle_rules", "shape_coverage", "codec_publication",
    ):
        lines.extend(["", "## " + section.replace("_", " ").capitalize()])
        for name, value in terms[section].items():
            lines.extend(["", "### " + name.replace("_", " ").capitalize(), ""])
            if isinstance(value, str):
                lines.append(value)
            else:
                lines.extend(["```json", json.dumps(value, ensure_ascii=True, indent=2), "```"])
    lines.extend(["", "## Specification baselines", ""])
    lines.extend("- " + url for url in terms["baseline"])
    return "\n".join(lines) + "\n"


def expected_outputs():
    outputs = {
        "vocabulary/context.jsonld": context_text(model.make_context()).encode("utf-8"),
        "vocabulary/ontology.ttl": compact_turtle(model.make_ontology(), [
            "# GENERATED from vocabulary/terms.json by tools/generate.py.",
            "# Original unregistered proposal; not a deployed or W3C-endorsed standard.",
        ]).encode("utf-8"),
        "shapes/av.shacl.ttl": compact_turtle(model.make_shapes(), [
            "# GENERATED from vocabulary/terms.json and structural rules in tools/model.py.",
            "# Includes reviewed contextual Rational signs and all three H265/Opus codec lists.",
            "# SHACL Core subset only; run tools/validate.py for meta-SHACL and fixture checks.",
            "# Finite explicit graphs, inference=none, no imports; success is not admission.",
        ]).encode("utf-8"),
        "spec/terms.md": catalogue().encode("utf-8"),
    }

    def content(name):
        return outputs[name] if name in outputs else relative_file(name).read_bytes()

    for name, expected in (
        ("third_party/wot/td-context.jsonld", TD_CONTEXT_SHA),
        ("third_party/wot/td-schema.json", SCHEMA_SHA),
    ):
        if sha(content(name)) != expected:
            raise ValueError("Immutable W3C native artifact changed: " + name)
    policy = read(relative_file("examples/cache-policy.json"))
    pins, cache, names = [], {}, set()
    for item in policy["pins"]:
        name = item["name"]
        document = item.get("document", U + "document:" + name)
        if name in names or document in cache:
            raise ValueError("Duplicate pin name or document in the cache policy: " + name)
        names.add(name)
        record = {
            "@id": U + "pin:" + name, "@type": "av:DocumentPin",
            "av:document": document, "av:documentKind": "av:" + item["kind"],
            "av:hexDigest": sha(content(item["path"])), "dcterms:format": item["mediaType"],
        }
        if item.get("dependencies"):
            record["av:pin"] = [U + "pin:" + dep for dep in item["dependencies"]]
        if "expectedThing" in item:
            record["av:expectedThing"] = item["expectedThing"]
        pins.append(record)
        cache[document] = metadata(item["path"], content(item["path"]))
    unresolved_id = U + "pin:qualification-missing"
    if set(policy["unresolvedPins"]) != {unresolved_id}:
        raise ValueError("Unexpected unresolved-pin policy; review it explicitly before resealing")
    pins.append({
        "@id": unresolved_id, "@type": "av:DocumentPin",
        "av:document": U + "unresolved:adapter-qualification",
        "av:documentKind": "av:ProfileDocument", "av:hexDigest": "0" * 64,
        "dcterms:format": "application/json",
        "dcterms:description": "UNRESOLVED NEGATIVE FIXTURE: " + policy["unresolvedPins"][unresolved_id],
    })
    identifiers = {pin["@id"] for pin in pins}
    if any(set(pin.get("av:pin", [])) - identifiers for pin in pins):
        raise ValueError("Pin dependency points outside the explicit finite pin set")
    fault = {
        "@id": U + "fault:qualification", "@type": "av:Fault",
        "av:code": "av:UnknownRequiredFact",
        "dcterms:description": "Synthetic negative receipt: adapter qualification and current external authority have not been established.",
    }
    outputs["examples/pins.jsonld"] = json_bytes({"@context": AV_CONTEXT, "@graph": pins + [fault]})
    manifest = {key: value for key, value in policy.items() if key != "pins"}
    manifest["cache"] = cache
    manifest["queryOnlyGraphs"] = {key: metadata(name) for key, name in policy["queryOnlyGraphs"].items()}
    manifest["schemaRevision"] = "w3c/wot-thing-description@" + TD_REVISION
    outputs["examples/manifest.json"] = json_bytes(manifest)
    graph_documents = {
        graph_id: read(relative_file(next(item["path"] for item in policy["pins"]
                                        if U + "pin:" + item["name"] == pin_id)))
        for graph_id, pin_id in policy["graphToPin"].items()
    }
    graph_documents.update({key: read(relative_file(name)) for key, name in policy["queryOnlyGraphs"].items()})
    outputs["examples/dataset.nq"] = canonical_dataset(graph_documents, loader_for(model.make_context()))
    artifacts = {name: metadata(name, content(name)) for name in sorted(set(AUTHORED_FILES) | outputs.keys())}
    outputs["release-manifest.json"] = json_bytes({
        "release": model.TERMS["release"],
        "scope": "Portable canonical release-owned files only; no root README, main specification, history or deployment.",
        "hashAlgorithm": "SHA-256 of complete representation octets",
        "selfHash": "Deliberately excluded: no document or manifest embeds its own digest.",
        "generationCommand": "python tools\\generate.py",
        "validationCommand": "python tools\\validate.py",
        "files": list(artifacts.values()),
    })
    return outputs


def check_generated(outputs=None):
    outputs = expected_outputs() if outputs is None else outputs
    stale = [name for name, data in outputs.items()
             if not relative_file(name).is_file() or relative_file(name).read_bytes() != data]
    if stale:
        raise ValueError("Generated artifacts or pins are stale; review changes before running "
                         "python tools\\generate.py: " + ", ".join(stale))
    return len(outputs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare exact bytes without writing or resealing")
    args = parser.parse_args()
    outputs = expected_outputs()
    if args.check:
        check_generated(outputs)
        print(json.dumps({"result": "passed", "generatedFiles": len(outputs), "writes": False}))
    else:
        for name, data in outputs.items():
            target = relative_file(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(json.dumps({"result": "generated", "files": list(outputs),
                          "pins": "explicitly resealed; assignment remains NOT ADMITTED"}))


if __name__ == "__main__":
    main()
