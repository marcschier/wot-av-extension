"""Offline validation of the thin draft; --core-only does not claim bundle integration."""

from __future__ import annotations

import argparse
import importlib.metadata
import io
import re
import sys
import unittest
from collections import Counter

sys.dont_write_bytecode = True


def reject_network(event, arguments):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
                 "socket.gethostbyaddr", "socket.sendto", "urllib.Request"}:
        raise RuntimeError("Offline validation prohibits network access: " + event)


sys.addaudithook(reject_network)

import jsonschema
from rdflib import Graph, Literal, URIRef
from rdflib.namespace import OWL, RDF, RDFS, SH

import check_docs
import check_examples
import check_shapes
import generate
import model
from archive_v01 import verify_snapshot
from common import (
    AV, AV_CONTEXT, ROOT, SCHEMA_SHA, TD_CONTEXT_SHA, Checks, graph_for,
    json_bytes, metadata, nodes, pointer, read, relative_file, sha, validate_av_keys,
)
from matching import validate_need, validate_offer

LIBRARIES = ("PyLD", "jsonschema", "rdflib", "pyshacl")


def audit_av_graph(graph, support=()):
    terms = model.TERMS
    classes = {AV[name] for name in terms["classes"]}
    properties = {AV[name] for name in terms["properties"]}
    individuals = {AV[name] for values in terms["enums"].values() if isinstance(values, dict) for name in values}
    known = classes | properties | individuals | set(support) | {URIRef(str(AV))}
    for subject, predicate, value in graph:
        for node in (subject, predicate, value):
            if isinstance(node, URIRef):
                if str(node).startswith("https://example.org/wot/av#"):
                    raise ValueError("Legacy v0.1 IRI is not an active 0.2 term: " + str(node))
                if str(node).startswith(str(AV)) and node not in known:
                    raise ValueError("Unknown AV IRI in this artifact scope: " + str(node))
        if str(predicate).startswith(str(AV)) and predicate not in properties:
            raise ValueError("Non-property used as an AV predicate: " + str(predicate))
        if predicate == RDF.type and str(value).startswith(str(AV)) and value not in classes:
            raise ValueError("Non-class used as an AV data type: " + str(value))


def migration_checks(checks):
    old = read(relative_file("archive/v0.1-proposed/vocabulary/terms.json"))
    migration = read(relative_file("vocabulary/migration-v0.2.json"))
    terms = model.TERMS
    for mapping, field in (
        ("class_mapping", "classes"), ("property_mapping", "properties"),
        ("external_property_mapping", "external_properties"),
        ("profile_mapping", "profiles"), ("enum_mapping", "enums"),
    ):
        names = [item["name"] for item in migration[mapping]]
        checks.check("Complete historical mapping: " + mapping,
                     len(names) == len(set(names)) and set(names) == set(old[field]))
    retained_classes = {item["name"] for item in migration["class_mapping"] if item["disposition"] == "keep"}
    retained_properties = {item["name"] for item in migration["property_mapping"] if item["disposition"] == "keep"}
    additions = {item["name"] for item in migration["new_properties"]}
    checks.check("Active class inventory equals the complete researched retention mapping",
                 set(terms["classes"]) == retained_classes)
    checks.check("Active properties equal retained names plus the three approved additions",
                 set(terms["properties"]) == retained_properties | additions
                 and additions == {"accepts", "result", "destination"})
    counts = migration["counts"]
    checks.check("Count assertions derive from the approved mapping, not old fixture totals",
                 len(retained_classes) == counts["classes"] == terms["expected_counts"]["classes"]
                 and len(terms["properties"]) == counts["av_properties"] == terms["expected_counts"]["av_properties"]
                 and len(old["classes"]) - len(retained_classes) == counts["current_classes_outside_core"]
                 and len(old["properties"]) - len(retained_properties) == counts["current_av_properties_outside_core"])
    checks.check("There are zero mandatory or retained AV profile families",
                 not terms["profiles"] and counts["mandatory_av_pinned_profiles"] == 0
                 and all(not item["required_by_core"] and not item["av_profile_retained"]
                         for item in migration["profile_mapping"]))
    checks.check("Only direct identifier reuse is a required external field",
                 all(name == "dcterms:identifier" and domain in {"av:Track", "av:InputRequirement"}
                     for name, prop in terms["external_properties"].items()
                     for domain, usage in prop["uses"].items() if usage["min"]))
    checks.check("All retained classes have no operational or PROV superclass prerequisite",
                 all(not entry["superclasses"] for entry in terms["classes"].values()))
    checks.check("Breaking version IRIs are explicit and distinct from v0.1",
                 terms["namespace"] == str(AV) == migration["to"]["namespace"]
                 and terms["context_url"] == AV_CONTEXT == migration["to"]["context"]
                 and terms["namespace"] != old["namespace"] and terms["context_url"] != old["context_url"])
    return {"classes": len(terms["classes"]), "avProperties": len(terms["properties"]),
            "reusedProperties": len(terms["external_properties"]),
            "retiredClasses": len(old["classes"]) - len(retained_classes),
            "retiredProperties": len(old["properties"]) - len(retained_properties),
            "mandatoryAvProfiles": len(terms["profiles"])}


def inventory_and_json(checks, *, core_only=False):
    terms = model.TERMS
    counts = migration_checks(checks)
    ontology = Graph().parse(relative_file("vocabulary/ontology.ttl"), format="turtle")
    shapes = Graph().parse(relative_file("shapes/av.shacl.ttl"), format="turtle")
    checks.check("Ontology classes equal only the active inventory",
                 set(ontology.subjects(RDF.type, RDFS.Class)) == {AV[name] for name in terms["classes"]})
    checks.check("Ontology predicates equal only the active inventory",
                 set(ontology.subjects(RDF.type, RDF.Property)) == {AV[name] for name in terms["properties"]})
    context = read(relative_file("vocabulary/context.jsonld"))
    checks.check("Context mappings are generated exactly", context == model.make_context())
    keys = set(context["@context"]) - {"@version", "@protected", "av", "prov", "dcterms"}
    checks.check("Context has no additional aliases or authoring metadata predicates",
                 keys == set(model.ALL_PROPERTIES))
    checks.check("accepts is explicitly coerced to an opaque JSON literal",
                 context["@context"]["av:accepts"] == {"@id": str(AV.accepts), "@type": "@json"})
    for predicate in (OWL.imports, OWL.sameAs, OWL.equivalentClass, OWL.equivalentProperty, RDFS.domain, RDFS.range):
        checks.check("No automatic imports/equivalences/intersecting domains: " + str(predicate),
                     not list(ontology.triples((None, predicate, None))))
    audit_av_graph(ontology)
    support = {node for node in shapes.subjects(RDF.type, SH.NodeShape) if isinstance(node, URIRef)}
    audit_av_graph(shapes, support)
    samples = read(relative_file("tests/fixtures/core.json"))
    documents = {name: samples[name] for name in ("source", "application", "need", "resultNeed")}
    if not core_only:
        manifest = read(relative_file("examples/manifest.json"))
        documents.update({item["path"]: read(relative_file(item["path"])) for item in manifest["graphs"].values()})
    seen = set()
    for name, document in documents.items():
        validate_av_keys(document)
        graph = graph_for(document)
        audit_av_graph(graph)
        original = {AV[key[3:]] for node in nodes(document) for key in node if key.startswith("av:")}
        checks.check("AV graph keys survive expansion, excluding schema literals: " + name,
                     original <= set(graph.predicates()))
        seen |= original
        for node in nodes(document):
            types = node.get("@type", [])
            types = [types] if isinstance(types, str) else types
            if "av:Offer" in types:
                validate_offer(node)
            if "av:Need" in types:
                validate_need(node)
        for _, predicate, value in graph:
            definition = terms["properties"].get(str(predicate)[len(str(AV)):]) if str(predicate).startswith(str(AV)) else None
            if definition and definition["value"] == "node":
                checks.check("IRI-valued AV property remains a node", not isinstance(value, Literal), str(predicate))
            if definition and definition["value"] == "json":
                checks.check("JSON Schema remains one rdf:JSON literal",
                             isinstance(value, Literal) and value.datatype == RDF.JSON)
    for name in ("Assignment", "DocumentPin", "EncodedVideo", "PositiveRationalShape"):
        invalid = Graph().add((URIRef("urn:fixture:invalid"), RDF.type, AV[name]))
        checks.negative("Unknown/retired/non-class AV type is rejected: " + name,
                        lambda graph=invalid: audit_av_graph(graph))
    checks.negative("Removed AV properties are rejected before expansion",
                    lambda: validate_av_keys({"av:resourceUses": []}))
    checks.negative("Known control IRI is not a property",
                    lambda: audit_av_graph(Graph().add((URIRef("urn:fixture:invalid"), AV.Live, URIRef("urn:fixture:value")))))
    return {**counts, "usedFixtureProperties": len(seen), "ontologyTriples": len(ontology)}


def native_dependencies(checks):
    manifest = read(relative_file("third_party/wot/manifest.json"))
    for item in manifest["files"]:
        actual = metadata("third_party/wot/" + item["path"])
        checks.check("Vendored exact bytes and notices: " + item["path"],
                     actual["sha256"] == item["sha256"] and actual["bytes"] == item["bytes"])
    for name, expected in (("td-context.jsonld", TD_CONTEXT_SHA), ("td-schema.json", SCHEMA_SHA)):
        checks.check("Fixed upstream artifact hash: " + name,
                     sha(relative_file("third_party/wot/" + name).read_bytes()) == expected)
    schema = read(relative_file("third_party/wot/td-schema.json"))
    jsonschema.Draft7Validator.check_schema(schema)
    refs = [node["$ref"] for node in nodes(schema, skip_literals=False) if "$ref" in node]
    checks.check("Native schema references are local only", all(ref.startswith("#/") for ref in refs))
    for ref in set(refs):
        pointer(schema, ref[1:])
    context = read(relative_file("third_party/wot/td-context.jsonld"))
    checks.check("Native context has no remote imports or nested remote contexts",
                 all("@import" not in node and ("@context" not in node or isinstance(node["@context"], dict))
                     for node in nodes(context, skip_literals=False)))
    native_operations = {value for key, value in context["@context"]["forms"]["@context"].items()
                         if key.islower() and isinstance(value, str) and value.startswith("td:")}
    checks.check("Controlled native operations exactly reuse the unchanged TD context",
                 native_operations == set(model.TERMS["enums"]["NativeOperation"]))
    import urllib.request
    checks.negative("Offline guard blocks before network transmission",
                    lambda: urllib.request.urlopen("https://invalid.example/offline-probe"), RuntimeError)
    return {"revision": manifest["upstreamRevision"], "localReferences": len(refs),
            "distinctLocalReferences": len(set(refs)),
            "draft7IgnoredPrefixItemsOccurrences": sum("prefixItems" in node for node in nodes(schema, skip_literals=False)),
            "formatAssertions": False}


def run_unit_tests(checks):
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=1).run(suite)
    checks.check("Focused core regression suite", result.wasSuccessful(), output.getvalue())
    return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-only", action="store_true", help="Validate owned core without claiming authored bundle integration")
    parser.add_argument("--report", help="Optional new repository-relative JSON report path")
    args = parser.parse_args()
    outputs = generate.expected_outputs(core_only=args.core_only)
    managed = set(generate.AUTHORED_FILES) | generate.GENERATED_FILES
    if args.report and (args.report in managed or relative_file(args.report).exists()):
        raise ValueError("Report output must be a new non-release file")
    checks = Checks()
    versions = {name: importlib.metadata.version(name) for name in LIBRARIES}
    checks.check("Dependency versions match the existing direct requirements",
                 relative_file("requirements-dev.txt").read_text(encoding="utf-8").splitlines()
                 == [f"{name}=={versions[name]}" for name in LIBRARIES], versions)
    archived_files = verify_snapshot()
    checks.check("Exact original snapshot remains intact", archived_files > 0, {"files": archived_files})
    generated_count = generate.check_generated(outputs)
    checks.check("Deterministic generated artifacts are current", generated_count == len(outputs))
    if not args.core_only:
        manifest = read(relative_file("release-manifest.json"))
        for item in manifest["files"]:
            checks.check("Release representation integrity: " + item["path"], metadata(item["path"]) == item)
        checks.check("Release manifest excludes its own digest",
                     all(item["path"] != "release-manifest.json" for item in manifest["files"]))
    for name in sorted(managed):
        if name.startswith(("archive/", "third_party/")) or not relative_file(name).is_file():
            continue
        checks.check("Active publication has no machine-specific runtime path: " + name,
                     not re.search(rb"(?i)(?:[a-z]:[\\/]+users[\\/]|site-packages[\\/])", relative_file(name).read_bytes()))
    dependencies = native_dependencies(checks)
    inventory = inventory_and_json(checks, core_only=args.core_only)
    documentation = check_docs.run(checks, core_only=args.core_only)
    unit_tests = run_unit_tests(checks)
    shapes = check_shapes.run(checks)
    examples = None if args.core_only else check_examples.run(checks)
    result = {
        "result": "passed",
        "scope": "owned core only; example integration not checked" if args.core_only else "assembled local draft and synthetic examples",
        "checks": len(checks.rows), "categories": dict(Counter(row["category"] for row in checks.rows)),
        "offline": True, "hardwareTests": False, "validationWrites": bool(args.report),
        "python": sys.version.split()[0], "libraries": versions,
        "generatedFilesChecked": generated_count, "archivedFilesVerified": archived_files,
        "inventory": inventory, "nativeDependencies": dependencies,
        "documentation": documentation, "unitTests": unit_tests, "shacl": shapes, "examples": examples,
        "limitations": [
            "Metadata compatibility is not authorization, availability, decoder/layout/transport qualification or runtime acceptance.",
            "No native camera, processor, routing, delivery or durability operation was performed.",
            "Schema matching is local JSON Schema 2020-12, with no external fetching, custom keywords or positional track contract.",
            "Defaults and format are annotations; exact Rational pairs do not provide a general rational-inequality/arithmetic language.",
            "Native URI template expansion is explicitly unsupported without an appropriate native implementation and required parameter values.",
            "Vendored native TD schema and its Draft-07 prefixItems limitation are unchanged.",
            "Publication hashes establish local consistency, not publisher authenticity or immutable runtime TDs.",
        ],
    }
    if args.report:
        target = relative_file(args.report)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(json_bytes({**result, "details": checks.rows}))
    print(json_bytes(result).decode("utf-8"), end="")


if __name__ == "__main__":
    main()
