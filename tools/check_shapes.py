"""Finite thin-core SHACL cases, with JSON/arithmetic/reference limits explicit."""

from __future__ import annotations

import copy
from collections import Counter

from pyshacl import validate
from rdflib import Graph, Literal, URIRef
from rdflib.namespace import RDF, RDFS, SH, XSD

import model
from common import AV, AV_CONTEXT, graph_for, loader_for, read, relative_file


def clone(graph):
    result = Graph()
    result += graph
    return result


def shacl(data, shapes, meta=False):
    return validate(
        clone(data), shacl_graph=clone(shapes), inference="none", do_owl_imports=False,
        meta_shacl=meta, advanced=False, js=False, abort_on_first=False,
        allow_infos=False, allow_warnings=False,
    )


def run(checks):
    shapes = Graph().parse(relative_file("shapes/av.shacl.ttl"), format="turtle")
    conforms, _, report = shacl(Graph(), shapes, meta=True)
    checks.check("Meta-SHACL validates the thin shape graph", bool(conforms), report)
    checks.check("Every and only active AV class is targeted",
                 set(shapes.objects(None, SH.targetClass)) == {AV[name] for name in model.TERMS["classes"]})
    checks.check("Closed intrinsic shapes derive from the inventory",
                 set(shapes.subjects(SH.closed, Literal(True))) == {
                     AV[name + "Shape"] for name in model.TERMS["shape_coverage"]["closed_shapes"]})
    checks.check("Positive rate helper is not a vocabulary class",
                 (AV.PositiveRationalShape, RDF.type, SH.NodeShape) in shapes
                 and (AV.PositiveRationalShape, RDF.type, RDFS.Class) not in shapes
                 and not list(shapes.objects(AV.PositiveRationalShape, SH.targetClass)))
    json_properties = [node for node in shapes.subjects(SH.path, AV.accepts)]
    checks.check("accepts is an opaque RDF JSON literal",
                 len(json_properties) == 1 and shapes.value(json_properties[0], SH.datatype) == RDF.JSON)
    fixtures = read(relative_file("tests/fixtures/core.json"))
    cases = []
    loader = loader_for(model.make_context())

    def case(name, document, expected=True, category=None):
        if isinstance(document, Graph):
            graph = document
        else:
            document = copy.deepcopy(document)
            document.setdefault("@context", AV_CONTEXT)
            graph = graph_for(document, loader)
        cases.append((name, graph, expected,
                      category or ("structural-positive" if expected else "expected-structural-failure")))

    for name in ("source", "need", "resultNeed", "application"):
        case("self-contained-core-" + name, fixtures[name])
    for name in ("mode", "liveMode", "clipMode"):
        case("complete-" + name, {**fixtures["offer"], "av:mode": [fixtures[name]]})
    for name, track in fixtures["tracks"].items():
        case("complete-track-" + name, track)
    representation_samples = {
        "EncodedVideo": "encodedVideo", "RawVideo": "rawVideo",
        "EncodedAudio": "encodedAudio", "PCM": "pcm",
    }
    for representation, name in representation_samples.items():
        for field in model.TERMS["representation_rules"][representation]["required"]:
            track = copy.deepcopy(fixtures["tracks"][name])
            del track["av:" + field]
            case(representation + "-missing-" + field, track, False)
    for name, field, value in (
        ("rawVideo", "av:codec", "av:JPEG"),
        ("pcm", "av:codec", "av:Opus"),
        ("encodedVideo", "av:codec", "av:Opus"),
        ("encodedAudio", "av:codec", "av:H265"),
        ("encodedVideo", "av:sampleRate", 48000),
        ("encodedAudio", "av:channels", 1),
        ("rawVideo", "av:bufferLayout", "av:Planar"),
    ):
        case(name + "-invalid-" + field, {**fixtures["tracks"][name], field: value}, False)
    for numerator in (-1, 0, 30):
        case("signed-generic-rational-" + str(numerator),
             {**fixtures["rational"], "av:numerator": numerator, "av:denominator": 1})
        rate = {**fixtures["rational"], "av:numerator": numerator, "av:denominator": 1}
        case("contextual-frame-rate-" + str(numerator),
             {**fixtures["tracks"]["constantVideo"], "av:frameRate": rate}, numerator > 0)
    for field in ("av:numerator", "av:denominator"):
        rational = copy.deepcopy(fixtures["rational"])
        del rational[field]
        case("rational-missing-" + field, rational, False)
    for denominator in (0, -1):
        case("rational-invalid-denominator-" + str(denominator),
             {**fixtures["rational"], "av:denominator": denominator}, False)
    for value in ("30", 30.0, True):
        case("rational-invalid-numeric-token-" + str(value),
             {**fixtures["rational"], "av:numerator": value}, False)
    unreduced = {**fixtures["rational"], "av:numerator": 60, "av:denominator": 2}
    case("gcd-is-separately-checked-by-normalization", unreduced, category="documented-limit")
    rational = graph_for({"@context": AV_CONTEXT, "@id": "urn:fixture:r", **fixtures["rational"]}, loader)
    rational.add((URIRef("urn:fixture:r"), URIRef("urn:fixture:extra"), Literal("not allowed")))
    case("intrinsic-rational-rejects-undeclared-property", rational, False)
    for kind in ("av:Still", "av:Live", "av:Clip"):
        mode = {**fixtures["mode"], "av:kind": kind, "av:track": [fixtures["tracks"]["constantVideo"]]}
        case(kind + "-constant-video", mode, kind != "av:Still")
    track = copy.deepcopy(fixtures["tracks"]["constantVideo"])
    del track["av:frameRate"]
    case("constant-cadence-requires-frameRate", track, False)
    track = {**fixtures["tracks"]["constantVideo"], "av:cadence": "av:Variable"}
    case("nonconstant-forbids-frameRate", track, False)
    for field in ("av:presence", "av:accepts"):
        requirement = copy.deepcopy(fixtures["input"])
        del requirement[field]
        case("input-missing-" + field, requirement, False)
    requirement = {**fixtures["input"], "av:accepts": "not a schema object"}
    case("rdf-json-typing-does-not-validate-schema-content", requirement, category="documented-limit")
    need = copy.deepcopy(fixtures["resultNeed"])
    del need["av:result"]
    case("destination-requires-result", need, False)
    for field in ("av:document", "av:form", "av:operation"):
        reference = copy.deepcopy(fixtures["formReference"])
        del reference[field]
        case("FormReference-missing-" + field, reference, False)
    case("native-operation-is-an-IRI-not-a-lowercase-token",
         {**fixtures["formReference"], "av:operation": "readproperty"}, False)
    for name, graph, expected, category in cases:
        conforms, _, report = shacl(graph, shapes)
        checks.check(name, bool(conforms) == expected, None if bool(conforms) == expected else report, category)
    return {
        "targets": len(model.TERMS["classes"]), "cases": len(cases),
        "categories": dict(Counter(case[3] for case in cases)),
        "limits": model.TERMS["shape_coverage"]["not_covered"],
    }
