"""One offline command for release consistency and synthetic positive/negative fixtures."""

from __future__ import annotations

import argparse
import copy
import importlib.metadata
import json
import re
import sys
from collections import Counter
from fractions import Fraction

sys.dont_write_bytecode = True


def reject_network(event, arguments):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
                 "socket.gethostbyaddr", "socket.sendto", "urllib.Request"}:
        raise RuntimeError("Offline validation prohibits network access: " + event)


sys.addaudithook(reject_network)

import jsonschema
from pyld import jsonld
from rdflib import Graph, Literal, URIRef
from rdflib.compare import isomorphic
from rdflib.namespace import OWL, RDF, RDFS, SH, XSD

import check_examples
import check_shapes
import generate
import model
from common import (
    AV, AV_CONTEXT, SCHEMA_SHA, TD_CONTEXT, TD_CONTEXT_SHA, Checks, exact_integer,
    expand, graph_for, json_bytes, metadata, nodes, pointer, ration, ratio,
    read, relative_file, sha, strict_json, validate_av_keys,
)

LIBRARIES = ("PyLD", "jsonschema", "rdflib", "pyshacl")


def audit_av_graph(graph, support=()):
    terms = model.TERMS
    classes = {AV[name] for name in terms["classes"]}
    properties = {AV[name] for name in terms["properties"]}
    individuals = {AV[name] for values in terms["enums"].values() if isinstance(values, dict) for name in values}
    known = classes | properties | individuals | set(support) | {URIRef(str(AV))}
    for subject, predicate, value in graph:
        for node in (subject, predicate, value):
            if isinstance(node, URIRef) and str(node).startswith(str(AV)) and node not in known:
                raise ValueError("Unknown AV IRI in this artifact scope: " + str(node))
        if str(predicate).startswith(str(AV)) and predicate not in properties:
            raise ValueError("Non-property used as an AV predicate: " + str(predicate))
        if predicate == RDF.type and str(value).startswith(str(AV)) and value not in classes:
            raise ValueError("Non-class used as an AV data type: " + str(value))


def inventory_and_json(checks):
    check, negative = checks.check, checks.negative
    terms = model.TERMS
    check("Canonical inventory counts", (len(terms["classes"]), len(terms["properties"]),
                                        len(terms["external_properties"])) == (38, 105, 17))
    ontology = Graph().parse(relative_file("vocabulary/ontology.ttl"), format="turtle")
    shapes = Graph().parse(relative_file("shapes/av.shacl.ttl"), format="turtle")
    check("Ontology class declarations equal authoritative inventory",
          set(ontology.subjects(RDF.type, RDFS.Class)) == {AV[name] for name in terms["classes"]})
    check("Ontology property declarations equal authoritative inventory",
          set(ontology.subjects(RDF.type, RDF.Property)) == {AV[name] for name in terms["properties"]})
    context = read(relative_file("vocabulary/context.jsonld"))
    check("Context is the exact generated semantic mapping", context == model.make_context())
    context_keys = set(context["@context"]) - {"@version", "@protected", "av", "prov", "dcterms"}
    check("Context covers only canonical properties and external reuse",
          context_keys == {"av:" + name for name in terms["properties"]} | set(terms["external_properties"]))
    check("No native TD aliases, vocab reset or invented classes",
          not ({"@vocab", "id", "type", "forms", "security", "DataSchema", "dataSchema"} & context_keys)
          and not ({"VideoTrack", "SubmitNeedAction", "PositiveRational", "NonNegativeRational",
                    "PositiveRationalShape", "NonNegativeRationalShape"} & terms["classes"].keys()))
    for predicate in (OWL.imports, OWL.sameAs, OWL.equivalentClass, OWL.equivalentProperty, RDFS.domain, RDFS.range):
        check("No inferred imports/equivalences/global domain or range: " + str(predicate),
              not list(ontology.triples((None, predicate, None))))
    audit_av_graph(ontology)
    named_shapes = {node for node in shapes.subjects(RDF.type, SH.NodeShape) if isinstance(node, URIRef)}
    audit_av_graph(shapes, named_shapes)
    check("AV helpers are scoped to the shapes artifact", True)
    check("Control binding alone is not a media Form target",
          (AV.MediaFormShape, SH.targetSubjectsOf, AV.mediaDirection) in shapes
          and (AV.MediaFormShape, SH.targetSubjectsOf, AV.binding) not in shapes)
    catalogue = relative_file("spec/terms.md").read_text(encoding="utf-8")
    for name, definition in terms["classes"].items():
        check("Full class meaning retained: " + name, generate.escape(definition["meaning"]) in catalogue)
    for name, definition in {**terms["properties"], **terms["external_properties"]}.items():
        check("Full property meaning retained: " + name, generate.escape(definition["meaning"]) in catalogue)
    for name, profile in terms["profiles"].items():
        check("Full profile contract retained: " + name, generate.escape(profile["required_meaning"]) in catalogue)
    native = read(relative_file("third_party/wot/td-context.jsonld"))
    form_context = native["@context"]["forms"]["@context"]
    operations = {value for key, value in form_context.items()
                  if isinstance(value, str) and value.startswith("td:") and key.islower()}
    check("Native operation enum matches the exact pinned TD context",
          operations == set(terms["enums"]["NativeOperation"]))
    expectations = read(relative_file("tests/fixtures/expectations.json"))
    raw_property_count = set()
    for name in expectations["structuralArtifacts"]:
        document = read(relative_file(name))
        validate_av_keys(document, terms)
        graph = graph_for(document)
        audit_av_graph(graph)
        keys = {AV[key[3:]] for node in nodes(document) for key in node if key.startswith("av:")}
        check("Every authored AV key survives expansion: " + name, keys <= set(graph.predicates()))
        raw_property_count |= keys
        for node in nodes(document):
            for key, value in node.items():
                definition = terms["properties"].get(key[3:]) if key.startswith("av:") else None
                if definition and definition["value"] == "integer":
                    for number in value if isinstance(value, list) else [value]:
                        exact_integer(number)
                if key == "@type":
                    for item in value if isinstance(value, list) else [value]:
                        if item.startswith("av:"):
                            check("Canonical data class: " + item, item[3:] in terms["classes"])
        for _, predicate, value in graph:
            definition = terms["properties"].get(str(predicate)[len(str(AV)):]) if str(predicate).startswith(str(AV)) else None
            if definition and definition["value"] == "node":
                check("Node-valued AV property does not become a literal", not isinstance(value, Literal), str(predicate))
    for invalid in ('{"a":1,"a":2}', '{"n":NaN}', '{"n":Infinity}', '{"n":1e999}'):
        negative("Strict JSON rejects " + invalid, lambda source=invalid: strict_json(source))
    negative("Legacy plural key is rejected before expansion", lambda: validate_av_keys({"av:offers": []}, terms))
    for name in ("VideoTrack", "SubmitNeedAction", "PositiveRationalShape", "EncodedVideo"):
        bad = Graph().add((URIRef("urn:fixture:bad"), RDF.type, AV[name]))
        negative("Non-domain-class data marker rejected: " + name, lambda graph=bad: audit_av_graph(graph))
    bad = Graph().add((URIRef("urn:fixture:bad"), AV.Live, URIRef("urn:fixture:value")))
    negative("Enum IRI is not a property", lambda: audit_av_graph(bad))
    negative("Unknown context cannot dereference the network",
             lambda: expand({"@context": "https://invalid.example/unregistered", "x": 1}), jsonld.JsonLdError)
    import urllib.request
    negative("Network guard rejects a request before transmission",
             lambda: urllib.request.urlopen("https://invalid.example/offline-probe"), RuntimeError)
    for value in (True, 30.0, "30", 9007199254740992, {"@value": "1", "@type": str(XSD.double)}):
        negative("Exact integer rejects an invalid token: " + str(value), lambda number=value: exact_integer(number))
    huge = 10 ** 40 + 7
    typed = {"@value": str(huge), "@type": str(XSD.integer)}
    check("Explicit typed lexical integer preserves arbitrary precision", exact_integer(typed) == huge)
    for numerator in (-1, 0, 30):
        check("Signed reduced Rational primitive", ratio(ration(numerator)) == Fraction(numerator))
    for value in (
        {"av:numerator": 60, "av:denominator": 2},
        {"av:numerator": 0, "av:denominator": 2},
        {"av:numerator": 30.0, "av:denominator": 1},
        {"av:numerator": 30, "av:denominator": 0},
        {"av:numerator": 30, "av:denominator": -1},
    ):
        negative("Rational exactness/reduction validation", lambda item=value: ratio(item))
    check("Exact rational comparison does not round 30000/1001 to 30",
          ratio(ration(30000, 1001)) != ratio(ration(30)))
    graph = graph_for({"@context": AV_CONTEXT, "@id": "urn:fixture:integer",
                       "av:numerator": 30, "av:denominator": 30.0})
    check("Observed PyLD native-integer versus integral-float typing",
          graph.value(URIRef("urn:fixture:integer"), AV.numerator).datatype == XSD.integer
          and graph.value(URIRef("urn:fixture:integer"), AV.denominator).datatype == XSD.double)
    document = read(relative_file("examples/need.jsonld"))
    absent, empty = copy.deepcopy(document), copy.deepcopy(document)
    absent.pop("av:allowedPreprocessing", None)
    empty["av:allowedPreprocessing"] = []
    check("RDF cannot distinguish omitted and empty unordered JSON arrays",
          isomorphic(graph_for(absent), graph_for(empty)),
          "Original JSON remains authoritative for presence/admission checks.", category="documented-limit")
    empty["av:preferences"] = []
    check("Empty ordered preferences retain rdf:nil",
          (URIRef(empty["@id"]), AV.preferences, RDF.nil) in graph_for(empty))
    fragments = graph_for(read(relative_file("tests/fixtures/codec-fragments.jsonld")))
    check("Every codec fragment configuration is explicitly unresolved",
          {str(value) for value in fragments.objects(None, AV.configuration)}
          == set(expectations["codecFragmentUnresolvedPins"]))
    check("Every codec fragment Form is explicitly unresolved",
          {str(value) for value in fragments.objects(None, AV.form)}
          == set(expectations["codecFragmentUnresolvedForms"]))
    check("Every fragment external identity is explicitly unqualified",
          {str(value) for predicate in (AV.source, AV.resource, AV.clock)
           for value in fragments.objects(None, predicate)}
          == set(expectations["codecFragmentUnqualifiedIdentities"]))
    return {"classes": 38, "avProperties": 105, "reusedProperties": 17,
            "fixtureAvProperties": len(raw_property_count), "ontologyTriples": len(ontology)}


def native_dependencies(checks):
    check = checks.check
    manifest = read(relative_file("third_party/wot/manifest.json"))
    for item in manifest["files"]:
        check("Vendored bytes and notices: " + item["path"],
              metadata("third_party/wot/" + item["path"])["sha256"] == item["sha256"]
              and relative_file("third_party/wot/" + item["path"]).stat().st_size == item["bytes"])
    for name, expected in (("td-context.jsonld", TD_CONTEXT_SHA), ("td-schema.json", SCHEMA_SHA)):
        check("Immutable W3C artifact pin: " + name,
              sha(relative_file("third_party/wot/" + name).read_bytes()) == expected)
    schema = read(relative_file("third_party/wot/td-schema.json"))
    jsonschema.Draft7Validator.check_schema(schema)
    refs = [node["$ref"] for node in nodes(schema) if "$ref" in node]
    check("Native schema refs are local only", len(refs) == 153 and all(ref.startswith("#/") for ref in refs))
    for ref in set(refs):
        pointer(schema, ref[1:])
    check("Every local native schema ref resolves", len(set(refs)) == 40)
    context = read(relative_file("third_party/wot/td-context.jsonld"))
    check("Native context has no imports or remote scoped contexts", all(
        "@import" not in node and ("@context" not in node or isinstance(node["@context"], dict))
        for node in nodes(context)))
    prefix_items = sum("prefixItems" in node for node in nodes(schema))
    check("Pinned schema dialect/version limitation is explicit",
          schema["$schema"] == "http://json-schema.org/draft-07/schema#" and prefix_items > 0,
          "Draft-07 ignores prefixItems; no patched schema or optional format-checker dependencies are substituted.",
          category="documented-limit")
    return {"revision": manifest["upstreamRevision"], "localRefs": len(refs),
            "distinctLocalRefs": len(set(refs)), "remoteContextImports": 0,
            "draft7IgnoredPrefixItemsOccurrences": prefix_items, "optionalFormatAssertions": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", help="Optional repository-relative JSON result; never overwrites a release artifact")
    args = parser.parse_args()
    outputs = generate.expected_outputs()
    managed = set(generate.AUTHORED_FILES) | outputs.keys()
    if args.report and (args.report in managed or relative_file(args.report).exists()):
        raise ValueError("Report output must be a new non-release file: " + args.report)
    checks = Checks()
    versions = {name: importlib.metadata.version(name) for name in LIBRARIES}
    expected_requirements = [f"{name}=={versions[name]}" for name in LIBRARIES]
    actual_requirements = relative_file("requirements-dev.txt").read_text(encoding="utf-8").splitlines()
    checks.check("Runtime dependency versions match the four used direct dependencies",
                 actual_requirements == expected_requirements, versions)
    generated_count = generate.check_generated(outputs)
    checks.check("Exact deterministic regeneration and resealed pins are current", generated_count == 8)
    manifest = read(relative_file("release-manifest.json"))
    for item in manifest["files"]:
        checks.check("Release file integrity: " + item["path"], metadata(item["path"]) == item)
    checks.check("Release manifest has no self hash", all(item["path"] != "release-manifest.json" for item in manifest["files"]))
    for name in sorted(managed):
        data = relative_file(name).read_bytes()
        if name.endswith((".json", ".jsonld")):
            strict_json(data)
        if name.endswith((".json", ".jsonld", ".ttl", ".py", ".md", ".txt", ".nq", ".rq")):
            checks.check("No machine-specific paths: " + name,
                         not re.search(rb"(?i)(?:[a-z]:[\\/]+users[\\/]|site-packages[\\/])", data))
    dependencies = native_dependencies(checks)
    inventory = inventory_and_json(checks)
    shapes = check_shapes.run(checks)
    example = check_examples.run(checks)
    result = {
        "result": "passed", "checks": len(checks.rows),
        "categories": dict(Counter(row["category"] for row in checks.rows)),
        "offline": True, "hardwareTests": False, "validationWrites": bool(args.report),
        "python": sys.version.split()[0], "libraries": versions,
        "generatedFilesChecked": generated_count, "inventory": inventory,
        "nativeSchema": dependencies, "shacl": shapes, "workedExample": example,
        "limitations": [
            "Schema, meta-SHACL and fixture success do not establish TD runtime conformance or AV admission.",
            "Pinned 2023 TD schema uses prefixItems despite Draft-07; no optional format assertion packages are used.",
            "Synthetic profile documents are not executable qualified operational profiles; unknown request fields need profile validation.",
            "No authenticated publisher, current head, clock, grant, capacity, codec, media, controller or hardware behavior was observed.",
            "Exact-byte hashes prove fixture consistency, not publisher authenticity. Request fingerprint is only the fixed ASCII/integer example.",
            "SHACL arithmetic, finiteness, reference and RDF-list limits are separately labelled; no full matcher is implemented.",
        ],
    }
    if args.report:
        target = relative_file(args.report)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(json_bytes({**result, "details": checks.rows}))
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
