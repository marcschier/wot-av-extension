"""Offline structural probes and a separate, narrowly corrected SHACL copy.

Run with the isolated review venv. --emit-copy creates only the sibling
.shacl.ttl after every expectation and both meta-SHACL runs succeed.
No original generator, verifier, fixtures archive, or repository file is read.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from pyld import jsonld
from pyshacl import validate
from rdflib import BNode, Graph, Literal, Namespace, RDF, RDFS, SH, URIRef, XSD
from rdflib.collection import Collection
from rdflib.compare import isomorphic


ROOT = Path(r"media-research")
BASE = ROOT / "wot-av-formal-v0.1"
OUT = ROOT / "wot-av-shacl-reviewed-64c41574-c0b3ae29.shacl.ttl"
AV = Namespace("https://example.org/wot/av#")
TD = Namespace("https://www.w3.org/2019/wot/td#")
HCTL = Namespace("https://www.w3.org/2019/wot/hypermedia#")
PROV = Namespace("http://www.w3.org/ns/prov#")
DCT = Namespace("http://purl.org/dc/terms/")
EX = Namespace("urn:review:")
SUFFIXES = (
    ".shacl.ttl", ".ttl", ".terms.json", ".camera.td.json", ".need.jsonld",
    ".records.jsonld", ".checks.json", ".coverage.json", ".context.jsonld",
    ".native-td-context.jsonld",
)
PREFIXES = """
@prefix av: <https://example.org/wot/av#> .
@prefix td: <https://www.w3.org/2019/wot/td#> .
@prefix hctl: <https://www.w3.org/2019/wot/hypermedia#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <urn:review:> .
"""


def path(suffix: str) -> Path:
    return Path(str(BASE) + suffix)


def read_json(suffix: str):
    return json.loads(path(suffix).read_text(encoding="utf-8-sig"))


def fingerprints() -> dict[str, str]:
    return {s: hashlib.sha256(path(s).read_bytes()).hexdigest() for s in SUFFIXES}


CONTEXTS = {
    "https://example.org/wot/av/context/v0.1": read_json(".context.jsonld"),
    "https://www.w3.org/2022/wot/td/v1.1": read_json(".native-td-context.jsonld"),
}
LOADS: set[str] = set()


def loader(url, options=None):
    if url not in CONTEXTS:
        raise ValueError("Unregistered context; network prohibited: " + url)
    LOADS.add(url)
    return {
        "contextUrl": None,
        "documentUrl": url,
        "document": copy.deepcopy(CONTEXTS[url]),
    }


def expand_graph(document) -> tuple[Graph, int]:
    expanded = jsonld.expand(document, options={"documentLoader": loader})
    nquads = jsonld.to_rdf(
        expanded, options={"documentLoader": loader, "format": "application/n-quads"}
    )
    # These fixtures use only the default graph; a named quad must fail parsing.
    return Graph().parse(data=nquads, format="nt"), len(nquads.splitlines())


def ttl(body: str) -> Graph:
    return Graph().parse(data=PREFIXES + body, format="turtle")


def clone(graph: Graph) -> Graph:
    result = Graph()
    for triple in graph:
        result.add(triple)
    return result


def changed(graph: Graph, subject, predicate, value=None) -> Graph:
    result = clone(graph)
    result.remove((subject, predicate, None))
    if value is not None:
        result.add((subject, predicate, value))
    return result


def added(graph: Graph, *triples) -> Graph:
    result = clone(graph)
    for triple in triples:
        result.add(triple)
    return result


def without_subject(graph: Graph, subject) -> Graph:
    result = clone(graph)
    result.remove((subject, None, None))
    return result


def run_validation(data: Graph, shapes: Graph, *, meta=False):
    return validate(
        clone(data), shacl_graph=clone(shapes), inference="none",
        meta_shacl=meta, do_owl_imports=False, advanced=False, js=False,
        abort_on_first=False, allow_infos=False, allow_warnings=False,
    )


def corrected_text(original: str) -> str:
    changes = {
        "TrackShape": ("PositiveRationalShape", 1),
        "RationalConstraintShape": ("PositiveRationalShape", 2),
        "TimestampMappingShape": ("PositiveRationalShape", 1),
        "TimeSelectorShape": ("NonNegativeRationalShape", 2),
    }
    text = original
    for name, (replacement, count) in changes.items():
        start = text.index("av:" + name + " a sh:NodeShape")
        end = text.find("\nav:", start + 1)
        if end < 0:
            end = len(text)
        section = text[start:end]
        old = "sh:node av:RationalShape ;"
        if section.count(old) != count:
            raise ValueError(f"Unexpected original structure in {name}")
        text = text[:start] + section.replace(
            old, "sh:node av:" + replacement + " ;"
        ) + text[end:]
    old_header = (
        "# Structural subset only. No SHACL engine or full SHACL syntax validator was run."
    )
    if text.count(old_header) != 1:
        raise ValueError("Unexpected original verification header")
    text = text.replace(
        old_header,
        "# REVIEW COPY: six contextual Rational sign checks; original remains unchanged.\n"
        "# Executed with pySHACL, inference=none and meta-SHACL; not full domain admission.",
    )
    return text.rstrip() + """

av:PositiveRationalShape a sh:NodeShape ;
    rdfs:comment "Positive rate or seconds-per-tick only; gcd and bound ordering remain external."@en ;
    sh:node av:RationalShape ;
    sh:property [
        sh:path av:numerator ;
        sh:minExclusive 0
    ] .

av:NonNegativeRationalShape a sh:NodeShape ;
    rdfs:comment "Nonnegative selector offset only; interval ordering remains external."@en ;
    sh:node av:RationalShape ;
    sh:property [
        sh:path av:numerator ;
        sh:minInclusive 0
    ] .
"""


@dataclass
class Case:
    name: str
    graph: Graph
    original: bool
    reviewed: bool
    category: str


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit-copy", action="store_true")
    args = parser.parse_args()
    before = fingerprints()
    original_text = path(".shacl.ttl").read_text(encoding="utf-8-sig")
    review_text = corrected_text(original_text)
    original = Graph().parse(data=original_text, format="turtle")
    reviewed = Graph().parse(data=review_text, format="turtle")
    ontology = Graph().parse(path(".ttl"), format="turtle")
    cases: list[Case] = []

    def case(name, graph, expected=True, *, review=None, category="positive"):
        cases.append(Case(
            name, graph, expected, expected if review is None else review, category
        ))

    corpus = {}
    corpus_counts = {}
    for suffix in (".camera.td.json", ".need.jsonld", ".records.jsonld"):
        graph, lines = expand_graph(read_json(suffix))
        corpus[suffix] = graph
        corpus_counts[suffix] = {"rdf_triples": len(graph), "nquads_lines": lines}
        case("corpus" + suffix, graph, category="lookup-surface")
    supplied = Graph()
    for graph in corpus.values():
        supplied += graph
    case("supplied-union-not-admission", supplied, category="lookup-surface")
    resolved_union = added(
        supplied,
        (URIRef("urn:example:processor:opencv"), RDF.type, AV.Processor),
        (URIRef("urn:example:processor:opencv"), RDF.type, TD.Thing),
    )
    case("supplied-union-plus-explicit-processor", resolved_union)

    need = ttl("""
ex:need a av:Need ; dcterms:isVersionOf ex:need-series ;
    av:generation 0 ; av:state av:Active ; av:processor ex:processor ; av:input ex:input .
ex:processor a av:Processor, td:Thing .
ex:input a av:InputRequirement ; dcterms:identifier "inspection" ;
    av:presence av:Required ; av:alternative ex:alternative .
ex:alternative a av:InputAlternative ; av:kind av:Live ;
    av:captureIntent av:Observe ; av:deliveredTracks ex:track-requirement .
ex:track-requirement a av:TrackRequirement ; dcterms:identifier "picture" ;
    av:representation av:RawVideo ; av:presence av:Required .
""")
    for subject, predicate, expected_class in (
        (EX.need, AV.processor, AV.Processor),
        (EX.need, AV.input, AV.InputRequirement),
        (EX.input, AV.alternative, AV.InputAlternative),
        (EX.alternative, AV.deliveredTracks, AV.TrackRequirement),
    ):
        target = need.value(subject, predicate)
        assert (target, RDF.type, expected_class) in need
        assert any(p != RDF.type for _, p, _ in need.triples((target, None, None))) or (
            expected_class == AV.Processor
        )
    case("small-need-all-class-references-explicitly-described", need)
    case("need-missing-input", changed(need, EX.need, AV.input), False, category="negative")
    dangling = changed(need, EX.need, AV.input, EX.missing)
    dangling = without_subject(dangling, EX.input)
    case("lookup-only-dangling-input-not-full-positive", dangling, category="documented-limit")
    case("asserted-input-missing-identifier",
         changed(need, EX.input, DCT.identifier), False, category="negative")
    case("thing-native-and-unrelated-properties-remain-open",
         need + ttl('ex:processor td:title "Processor" ; ex:vendorExtension "allowed" .'))
    case("need-without-prov-supertype-axioms", need)
    case("prov-class-axiom-is-not-role-validation",
         need + ttl("ex:need a prov:Activity . av:Need rdfs:subClassOf prov:Entity ."),
         category="documented-limit")

    preferences = need + ttl("""
ex:need av:preferences ( ex:preference ) .
ex:preference av:input ex:input ; av:goal ex:goal .
ex:goal a av:ChoiceConstraint ; av:field av:host ; av:allowedValues ex:host .
""")
    case("untyped-intrinsic-preference-through-list-sh-node", preferences)
    case("preference-missing-goal",
         changed(preferences, EX.preference, AV.goal), False, category="negative")
    case("polymorphic-goal-needs-explicit-av-type",
         changed(preferences, EX.goal, RDF.type), False, category="negative")
    case("empty-rdf-list-preferences", need + ttl("ex:need av:preferences rdf:nil ."))
    repeated = changed(preferences, EX.need, AV.preferences)
    head = BNode()
    Collection(repeated, head, [EX.preference, EX.preference])
    repeated.add((EX.need, AV.preferences, head))
    case("ordered-preferences-allow-repeated-member", repeated)
    case("dangling-preference-list-head-not-topology-validation",
         need + ttl("ex:need av:preferences ex:missing-list ."), category="documented-limit")
    list_head = preferences.value(EX.need, AV.preferences)
    case("cyclic-preference-list-is-documented-gap",
         changed(preferences, list_head, RDF.rest, list_head), category="documented-limit")
    case("two-preference-list-heads",
         added(preferences, (EX.need, AV.preferences, RDF.nil)), False, category="negative")
    case("literal-preference-list-head",
         need + ttl('ex:need av:preferences "not a list" .'), False, category="negative")

    rational = ttl("ex:r a av:Rational ; av:numerator 30 ; av:denominator 1 .")
    case("rational-30-over-1", rational)
    case("rational-signed-primitive", changed(rational, EX.r, AV.numerator, Literal(-1)))
    case("rational-zero-primitive", changed(rational, EX.r, AV.numerator, Literal(0)))
    case("rational-arbitrary-precision-integer",
         changed(rational, EX.r, AV.numerator, Literal(10 ** 40 + 7)))
    for name, graph in (
        ("missing-numerator", changed(rational, EX.r, AV.numerator)),
        ("missing-denominator", changed(rational, EX.r, AV.denominator)),
        ("two-numerators", added(rational, (EX.r, AV.numerator, Literal(31)))),
        ("two-denominators", added(rational, (EX.r, AV.denominator, Literal(2)))),
        ("zero-denominator", changed(rational, EX.r, AV.denominator, Literal(0))),
        ("negative-denominator", changed(rational, EX.r, AV.denominator, Literal(-1))),
        ("numeric-string", changed(rational, EX.r, AV.numerator, Literal("30"))),
        ("double-integer-value", changed(rational, EX.r, AV.numerator, Literal(30.0))),
        ("wrong-property", added(rational, (EX.r, AV.n, Literal(30)))),
        ("extra-external-property", added(rational, (EX.r, DCT.description, Literal("x")))),
    ):
        case("rational-" + name, graph, False, category="negative")
    unreduced = changed(changed(rational, EX.r, AV.numerator, Literal(60)),
                        EX.r, AV.denominator, Literal(2))
    assert math.gcd(60, 2) != 1
    case("rational-unreduced-needs-external-gcd", unreduced, category="documented-limit")

    camera = corpus[".camera.td.json"]
    video = URIRef("urn:example:track:camera7:v0")
    audio = URIRef("urn:example:track:camera7:a0")
    rate = camera.value(video, AV.frameRate)
    case("untyped-intrinsic-rational-through-sh-node", changed(camera, rate, RDF.type))
    case("untyped-intrinsic-rational-still-rejects-zero-denominator",
         changed(changed(camera, rate, RDF.type), rate, AV.denominator, Literal(0)),
         False, category="negative")
    for value in (0, -1):
        case(f"frame-rate-numerator-{value}",
             changed(camera, rate, AV.numerator, Literal(value)),
             True, review=False, category="correction")
    case("frame-rate-missing-for-constant", changed(camera, video, AV.frameRate),
         False, category="negative")
    case("video-forbids-audio-sample-rate", added(camera, (video, AV.sampleRate, Literal(48000))),
         False, category="negative")
    case("mono-rejects-two-channels", changed(camera, audio, AV.channels, Literal(2)),
         False, category="negative")

    mapping = ttl("""
ex:m a av:TimestampMapping ; av:clock ex:clock ; av:basis av:PresentationTime ;
    av:timeBase ex:r .
ex:r av:numerator 1 ; av:denominator 90000 .
""")
    case("timestamp-mapping-no-reference-clock-optional-props", mapping)
    for value in (0, -1):
        case(f"time-base-numerator-{value}",
             changed(mapping, EX.r, AV.numerator, Literal(value)),
             True, review=False, category="correction")
    case("reference-clock-needs-config-and-uncertainty",
         added(mapping, (EX.m, AV.referenceClock, EX.reference)),
         False, category="negative")
    case("reference-clock-with-required-companions",
         mapping + ttl("ex:m av:referenceClock ex:reference ; av:configuration ex:pin ; av:uncertaintyMs 0 ."),
         category="lookup-surface")

    bounds = ttl("""
ex:bounds a av:RationalConstraint ; av:field av:frameRate ; av:lowerRational ex:r .
ex:r av:numerator 30 ; av:denominator 1 .
""")
    case("rational-constraint-lower-only", bounds)
    upper_only = changed(bounds, EX.bounds, AV.lowerRational)
    upper_only.add((EX.bounds, AV.upperRational, EX.r))
    case("rational-constraint-upper-only", upper_only)
    case("rational-constraint-neither-bound",
         changed(bounds, EX.bounds, AV.lowerRational), False, category="negative")
    case("lower-rate-bound-negative", changed(bounds, EX.r, AV.numerator, Literal(-1)),
         True, review=False, category="correction")
    case("upper-rate-bound-zero", changed(upper_only, EX.r, AV.numerator, Literal(0)),
         True, review=False, category="correction")
    case("rational-bound-order-is-external",
         bounds + ttl("ex:bounds av:upperRational [ av:numerator 1 ; av:denominator 1 ] ."),
         category="documented-limit")
    integers = ttl("ex:c a av:IntegerConstraint ; av:field av:width ; av:lowerInteger 10 .")
    case("integer-constraint-lower-only", integers)
    case("integer-constraint-upper-only",
         ttl("ex:c a av:IntegerConstraint ; av:field av:width ; av:upperInteger 10 ."))
    case("integer-bounds-reversed", integers + ttl("ex:c av:upperInteger 5 ."),
         False, category="negative")

    selector = ttl("""
ex:s a av:TimeSelector ; av:clock ex:clock ; av:selection av:AtInstant ; av:start ex:r .
ex:r av:numerator 0 ; av:denominator 1 .
""")
    case("at-instant-zero-offset", selector)
    case("selector-negative-start", changed(selector, EX.r, AV.numerator, Literal(-1)),
         True, review=False, category="correction")
    interval = changed(selector, EX.s, AV.selection, AV.ExactSamples)
    interval += ttl("ex:s av:end ex:end . ex:end av:numerator 1 ; av:denominator 1 .")
    case("exact-interval", interval)
    case("selector-negative-end", changed(interval, EX.end, AV.numerator, Literal(-1)),
         True, review=False, category="correction")
    case("selector-equal-ends-needs-external-ordering",
         changed(interval, EX.end, AV.numerator, Literal(0)), category="documented-limit")
    case("instant-forbids-end", selector + ttl("ex:s av:end ex:r ."),
         False, category="negative")
    case("interval-requires-end", changed(interval, EX.s, AV.end), False, category="negative")
    signed_timestamp = ttl("""
ex:t a av:Timestamp ; av:clock ex:clock ; av:basis av:PresentationTime ;
    av:time [ av:numerator -1 ; av:denominator 2 ] ; av:evidence ex:evidence .
""")
    case("signed-observed-timestamp-remains-valid", signed_timestamp, category="lookup-surface")

    form = URIRef("urn:example:form:camera7:media")
    assert not list(camera.objects(form, RDF.type))
    assert list(camera.objects(form, HCTL.hasOperationType)) == [TD.readProperty]
    assert any(camera.subjects(TD.hasForm, form))
    assert camera.value(form, HCTL.hasTarget).datatype == XSD.anyURI
    case("native-form-untyped-exact-readProperty-iri", camera)
    case("media-form-missing-binding", changed(camera, form, AV.binding), False, category="negative")
    case("media-form-missing-locality", changed(camera, form, AV.locality), False, category="negative")
    case("hostlocal-form-missing-host", changed(camera, form, AV.locality, AV.HostLocal),
         False, category="negative")
    case("hostlocal-form-with-host",
         added(changed(camera, form, AV.locality, AV.HostLocal), (form, AV.host, EX.host)))
    no_direction = changed(camera, form, AV.mediaDirection)
    case("selected-form-missing-direction-needs-resolved-profile",
         no_direction, category="documented-limit")
    control = ttl("""
ex:property td:hasForm ex:form .
ex:form hctl:hasTarget "https://example.org/control"^^xsd:anyURI ;
    hctl:hasOperationType td:invokeAction ; av:binding ex:control-binding .
""")
    case("control-binding-alone-not-targeted-as-media", control, category="target-policy")

    status = ttl("""
ex:status a av:AssignmentStatus ; av:assignment ex:assignment ; av:generation 0 ;
    av:clock ex:clock ; av:incarnation ex:incarnation ; av:sequence 1 ;
    av:observedAt "2026-09-14T10:00:00Z"^^xsd:dateTime ;
    av:validUntil "2026-09-14T10:01:00Z"^^xsd:dateTime ;
    av:lease ex:lease ; prov:wasAttributedTo ex:observer ; av:state av:Applying ;
    av:conditions ex:media, ex:application, ex:model, ex:result .
ex:media av:condition av:MediaObserved ; av:conditionState av:False .
ex:application av:condition av:ApplicationReady ; av:conditionState av:Unknown .
ex:model av:condition av:ModelLoaded ; av:conditionState av:NotApplicable .
ex:result av:condition av:ResultCommitted ; av:conditionState av:NotApplicable .
""")
    case("four-exact-conditions-untyped-through-sh-node", status, category="lookup-surface")
    missing_condition = clone(status)
    missing_condition.remove((EX.status, AV.conditions, EX.result))
    case("status-three-conditions", missing_condition, False, category="negative")
    case("four-nodes-but-duplicate-condition-name",
         changed(status, EX.result, AV.condition, AV.ModelLoaded), False, category="negative")
    case("one-condition-with-two-names", added(status, (EX.result, AV.condition, AV.ModelLoaded)),
         False, category="negative")
    case("status-fifth-condition", status + ttl("""
ex:status av:conditions ex:fifth .
ex:fifth av:condition av:ModelLoaded ; av:conditionState av:Unknown .
"""), False, category="negative")
    ready = changed(status, EX.status, AV.state, AV.Ready)
    case("ready-with-application-unknown", ready, False, category="negative")
    ready = changed(ready, EX.application, AV.conditionState, AV["True"])
    case("application-true-without-evidence", ready, False, category="negative")
    ready = added(ready, (EX.application, AV.evidence, EX.applicationEvidence))
    case("ready-application-true-evidenced-model-not-applicable",
         ready, category="lookup-surface")
    case("ready-does-not-entail-model-loaded",
         changed(ready, EX.model, AV.conditionState, AV.Unknown), category="documented-limit")
    case("not-applicable-media-condition-needs-lifecycle-check",
         changed(status, EX.media, AV.conditionState, AV.NotApplicable), category="documented-limit")
    case("not-applicable-application-condition-needs-lifecycle-check",
         changed(status, EX.application, AV.conditionState, AV.NotApplicable), category="documented-limit")
    loaded = changed(ready, EX.model, AV.conditionState, AV["True"])
    case("model-loaded-true-without-evidence", loaded, False, category="negative")
    case("model-loaded-evidence-iri-not-authenticity-or-exact-scope",
         added(loaded, (EX.model, AV.evidence, EX.unverifiedEvidence)), category="documented-limit")
    case("condition-truth-cannot-be-json-boolean",
         changed(status, EX.media, AV.conditionState, Literal(False)), False, category="negative")
    case("condition-evidence-cannot-be-digest-literal",
         added(loaded, (EX.model, AV.evidence, Literal("a" * 64))), False, category="negative")
    case("lease-scope-property-does-not-belong-on-condition",
         added(status, (EX.model, AV.scope, EX.scope)), False, category="negative")
    case("status-interval-equal-ends",
         changed(status, EX.status, AV.validUntil, status.value(EX.status, AV.observedAt)),
         False, category="negative")

    run = resolved_union + ttl("""
ex:run a av:ProcessingRun ; av:configuration <urn:example:pin:adapter> ;
    av:holder <urn:example:instance:processor:boot2> ;
    av:assignment <urn:example:assignment:a1> ; av:state av:Running ;
    av:lease <urn:example:grant:g0> ; prov:used <urn:example:need:opencv-media:7> ;
    prov:wasAssociatedWith <urn:example:agent:controller> .
""")
    case("processing-run-without-prov-imports-or-supertype-materialization", run)
    case("processing-run-missing-prov-used", changed(run, EX.run, PROV.used),
         False, category="negative")
    assert (AV.ProcessingRun, RDFS.subClassOf, PROV.Activity) in ontology
    assert (AV.Need, RDFS.subClassOf, PROV.Entity) in ontology
    assert (EX.run, RDF.type, PROV.Activity) not in run

    choice = ttl("ex:c a av:ChoiceConstraint ; av:field av:codec ; av:allowedValues av:NotACodec .")
    case("choice-value-enum-applicability-is-external", choice, category="documented-limit")
    case("choice-empty-set-rejected", changed(choice, EX.c, AV.allowedValues),
         False, category="negative")
    queue = ttl("""
ex:q a av:QueuePolicy ; av:stage av:DecodedDelivery ; av:capacity 1 ;
    av:unit av:Frame ; av:overflow av:DropOldest ; av:coveragePolicy av:BestEffort .
""")
    case("queue-with-optional-properties-absent", queue)
    case("no-intentional-drop-rejects-dropping-overflow",
         queue + ttl("ex:q av:gapResponse av:Report .") -
         ttl("ex:q av:coveragePolicy av:BestEffort .") +
         ttl("ex:q av:coveragePolicy av:NoIntentionalDrop ."), False, category="negative")
    case("positive-infinite-ms-is-documented-finiteness-gap",
         queue + ttl('ex:q av:limitMs "INF"^^xsd:double .'), category="documented-limit")

    for codec, subject in ((AV.H265, video), (AV.Opus, audio)):
        case("original-enum-rejects-" + str(codec).split("#")[-1],
             changed(camera, subject, AV.codec, codec), False, category="negative")

    meta_results = {}
    for label, shapes in (("original", original), ("reviewed", reviewed)):
        conforms, _, report = run_validation(need, shapes, meta=True)
        assert conforms, report
        meta_results[label] = True

    observations = []
    for item in cases:
        row = {"case": item.name, "category": item.category}
        for label, shapes, expected in (
            ("original", original, item.original),
            ("reviewed", reviewed, item.reviewed),
        ):
            conforms, report_graph, report_text = run_validation(item.graph, shapes)
            if conforms != expected:
                raise AssertionError(f"{item.name}: {label} expected {expected}\n{report_text}")
            row[label] = bool(conforms)
            row[label + "_components"] = sorted({
                str(component).split("#")[-1]
                for component in report_graph.objects(None, SH.sourceConstraintComponent)
            })
        observations.append(row)

    unsafe_form_typing = original + ttl("""
ex:IncorrectFormClassRequirement a sh:NodeShape ;
    sh:targetSubjectsOf av:mediaDirection ; sh:class hctl:Form .
""")
    conforms, _, report = run_validation(camera, unsafe_form_typing)
    assert not conforms and "ClassConstraintComponent" in report
    resolved_media_profile = original + ttl("""
ex:ResolvedMediaModeShape a sh:NodeShape ; sh:targetClass av:Mode ;
    sh:property [ sh:path av:form ; sh:node av:MediaFormShape ] .
""")
    assert run_validation(camera, resolved_media_profile)[0]
    assert not run_validation(no_direction, resolved_media_profile)[0]
    resolved_need_profile = original + ttl("""
ex:ResolvedNeedShape a sh:NodeShape ; sh:targetClass av:Need ;
    sh:property [ sh:path av:input ; sh:node av:InputRequirementShape ] .
""")
    assert run_validation(need, resolved_need_profile)[0]
    assert not run_validation(dangling, resolved_need_profile)[0]

    extension = clone(reviewed)
    enum_lists = 0
    for prop in list(extension.subjects(SH.path, AV.codec)):
        for head in list(extension.objects(prop, SH["in"])):
            old_values = list(Collection(extension, head))
            additions = [AV.H265] if AV.H264 in old_values else []
            if AV.AAC in old_values:
                additions.append(AV.Opus)
            if additions:
                for value in additions:
                    Collection(extension, head).append(value)
                enum_lists += 1
    assert enum_lists == 3
    for subject, codec, expected in (
        (video, AV.H265, True), (audio, AV.Opus, True),
        (video, AV.Opus, False), (audio, AV.H265, False),
    ):
        assert run_validation(changed(camera, subject, AV.codec, codec), extension)[0] == expected
    assert run_validation(camera, extension, meta=True)[0]
    meta_results["in_memory_codec_extension"] = True

    document = read_json(".need.jsonld")
    absent = copy.deepcopy(document)
    empty = copy.deepcopy(document)
    absent.pop("av:allowedPreprocessing", None)
    empty["av:allowedPreprocessing"] = []
    assert isomorphic(expand_graph(absent)[0], expand_graph(empty)[0])
    compacted = jsonld.compact(
        jsonld.expand(empty, options={"documentLoader": loader}),
        CONTEXTS["https://example.org/wot/av/context/v0.1"]["@context"],
        options={"documentLoader": loader},
    )
    assert isinstance(compacted.get("av:pin"), list)
    assert "av:allowedPreprocessing" in empty and "av:allowedPreprocessing" not in absent
    from_rdf = jsonld.from_rdf(
        expand_graph(empty)[0].serialize(format="nt"),
        options={"format": "application/n-quads"},
    )
    compacted_from_rdf = jsonld.compact(
        from_rdf, CONTEXTS["https://example.org/wot/av/context/v0.1"]["@context"],
        options={"documentLoader": loader},
    )
    need_after_rdf = next(
        node for node in compacted_from_rdf.get("@graph", [compacted_from_rdf])
        if node.get("@id") == "urn:example:need:opencv-media:7"
    )
    assert "av:allowedPreprocessing" not in need_after_rdf
    empty_preferences = copy.deepcopy(document)
    empty_preferences["av:preferences"] = []
    assert (
        URIRef("urn:example:need:opencv-media:7"), AV.preferences, RDF.nil
    ) in expand_graph(empty_preferences)[0]
    assignment_json = next(
        node for node in read_json(".records.jsonld")["@graph"]
        if node.get("@id") == "urn:example:assignment:a1"
    )
    assert "av:omitted" in assignment_json and assignment_json["av:omitted"] == []
    assert not list(supplied.objects(URIRef("urn:example:assignment:a1"), AV.omitted))
    try:
        jsonld.expand({"@context": "https://example.org/unregistered"},
                      options={"documentLoader": loader})
    except jsonld.JsonLdError:
        pass
    else:
        raise AssertionError("Unregistered context was not rejected")

    expected_closed = {AV[name + "Shape"] for name in (
        "Rational", "IntegerConstraint", "RationalConstraint", "ChoiceConstraint",
        "QueuePolicy", "TimingConstraint", "TimeSelector", "Condition",
    )}
    assert set(original.subjects(SH.closed, Literal(True))) == expected_closed
    assert set(reviewed.subjects(SH.closed, Literal(True))) == expected_closed
    assert before == fingerprints(), "Original artifacts changed during the verification run"
    if args.emit_copy:
        if OUT.exists():
            if OUT.read_text(encoding="utf-8") != review_text:
                raise FileExistsError("Refusing to overwrite a different reviewed copy")
        else:
            with OUT.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(review_text)
        assert isomorphic(Graph().parse(OUT, format="turtle"), reviewed)

    result = {
        "versions": {name: importlib.metadata.version(name) for name in ("pyshacl", "rdflib", "PyLD")},
        "policy": "inference=none; meta_shacl=True for original/reviewed/enum extension; no imports/JS/advanced",
        "meta_shacl": meta_results,
        "source_sha256": before,
        "corpus_counts": corpus_counts,
        "supplied_union_triples": len(supplied),
        "resolved_union_triples": len(resolved_union),
        "small_closed_description_need_triples": len(need),
        "original_shape_triples": len(original),
        "reviewed_shape_triples": len(reviewed),
        "original_shape_lines": len(original_text.splitlines()),
        "reviewed_shape_lines": len(review_text.splitlines()),
        "reviewed_shape_sha256": hashlib.sha256(review_text.encode("utf-8")).hexdigest(),
        "reviewed_copy": str(OUT) if args.emit_copy else "not emitted",
        "cases": len(cases),
        "case_categories": dict(Counter(item.category for item in cases)),
        "conforming_original": sum(item.original for item in cases),
        "conforming_reviewed": sum(item.reviewed for item in cases),
        "context_urls_loaded": sorted(LOADS),
        "json_empty_set_rdf_equal_to_absence": True,
        "json_compacted_empty_set_before_rdf": compacted.get("av:allowedPreprocessing", "<omitted>"),
        "json_compacted_empty_set_after_rdf": need_after_rdf.get("av:allowedPreprocessing", "<omitted>"),
        "empty_preferences_list_preserves_rdf_nil": True,
        "native_form_explicit_types": list(camera.objects(form, RDF.type)),
        "native_operation": str(camera.value(form, HCTL.hasOperationType)),
        "additional_overlay_probes": 10,
        "release_enum_lists_extended_only_in_memory": enum_lists,
        "observations": observations,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
