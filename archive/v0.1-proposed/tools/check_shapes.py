"""Explicit finite SHACL graphs, including expected failures and documented limits."""

from __future__ import annotations

from collections import Counter

from pyshacl import validate
from rdflib import BNode, Graph, Literal, Namespace, URIRef
from rdflib.collection import Collection
from rdflib.namespace import RDF, RDFS, SH, XSD

import model
from common import AV, HCTL, TD, graph_for, read, relative_file

EX = Namespace("urn:fixture:structural:")
PREFIXES = """
@prefix av: <https://example.org/wot/av#> .
@prefix td: <https://www.w3.org/2019/wot/td#> .
@prefix hctl: <https://www.w3.org/2019/wot/hypermedia#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <urn:fixture:structural:> .
"""


def ttl(body):
    return Graph().parse(data=PREFIXES + body, format="turtle")


def clone(graph):
    result = Graph()
    result += graph
    return result


def changed(graph, subject, predicate, value=None):
    result = clone(graph)
    result.remove((subject, predicate, None))
    if value is not None:
        result.add((subject, predicate, value))
    return result


def shacl(data, shapes, meta=False):
    return validate(
        clone(data), shacl_graph=clone(shapes), inference="none", do_owl_imports=False,
        meta_shacl=meta, advanced=False, js=False, abort_on_first=False,
        allow_infos=False, allow_warnings=False,
    )


def run(checks):
    check = checks.check
    shapes = Graph().parse(relative_file("shapes/av.shacl.ttl"), format="turtle")
    conforms, _, report = shacl(Graph(), shapes, meta=True)
    check("Meta-SHACL validates the complete shipped shape graph", bool(conforms), report)
    check("Every canonical class is explicitly targeted",
          set(shapes.objects(None, SH.targetClass)) == {AV[name] for name in model.TERMS["classes"]})
    check("Exactly the eight intended intrinsic value shapes are closed",
          set(shapes.subjects(SH.closed, Literal(True)))
          == {AV[name + "Shape"] for name in model.TERMS["shape_coverage"]["closed_shapes"]})
    for (owner, field), helper in model.SIGN_SHAPES.items():
        properties = [p for p in shapes.objects(AV[owner[3:] + "Shape"], SH.property)
                      if shapes.value(p, SH.path) == AV[field[3:]]]
        check("Contextual sign helper: " + owner + "." + field,
              len(properties) == 1 and shapes.value(properties[0], SH.node) == AV[helper])
    for helper in (AV.PositiveRationalShape, AV.NonNegativeRationalShape):
        check("Sign helpers are shapes, not domain classes or global targets",
              (helper, RDF.type, SH.NodeShape) in shapes
              and (helper, RDF.type, RDFS.Class) not in shapes
              and not list(shapes.objects(helper, SH.targetClass))
              and (helper, SH.node, AV.RationalShape) in shapes)
    codec_lists = [
        tuple(str(value).removeprefix(str(AV)) for value in shapes.items(head))
        for owner, head in shapes.subject_objects(SH["in"]) if (owner, SH.path, AV.codec) in shapes
    ]
    check("Exactly three codec lists, with representation-correct additions",
          len(codec_lists) == 3 and set(codec_lists) == {
              ("H264", "JPEG", "AAC", "H265", "Opus"), ("H264", "JPEG", "H265"), ("AAC", "Opus")})
    cases = []

    def case(name, graph, expected=True, category=None):
        cases.append((name, clone(graph), expected,
                      category or ("structural-positive" if expected else "expected-structural-failure")))

    expectations = read(relative_file("tests/fixtures/expectations.json"))
    corpus = {}
    union = Graph()
    for name in expectations["structuralArtifacts"]:
        graph = graph_for(read(relative_file(name)))
        corpus[name] = graph
        union += graph
        case("artifact-structure-only: " + name, graph)
    case("explicit-artifact-union-no-inferred-or-fetched-facts", union)
    camera = corpus["tests/fixtures/live.td.json"]
    video, audio = URIRef("urn:example:track:camera7:v0"), URIRef("urn:example:track:camera7:a0")
    rate = camera.value(video, AV.frameRate)
    check("Live fixture has exact selected video/audio/rate nodes",
          rate is not None and (audio, RDF.type, AV.Track) in camera)

    rational = ttl("ex:r a av:Rational ; av:numerator 30 ; av:denominator 1 .")
    for number in (30, 0, -1, 10 ** 40 + 7):
        case("signed-generic-rational-" + str(number),
             changed(rational, EX.r, AV.numerator, Literal(number)))
    for field in (AV.numerator, AV.denominator):
        case("rational-missing-" + str(field).split("#")[-1], changed(rational, EX.r, field), False)
        other = clone(rational)
        other.add((EX.r, field, Literal(7)))
        case("rational-duplicate-" + str(field).split("#")[-1], other, False)
    for denominator in (0, -1):
        case("rational-invalid-denominator-" + str(denominator),
             changed(rational, EX.r, AV.denominator, Literal(denominator)), False)
    for value in (Literal("30"), Literal(30.0), Literal(True)):
        case("rational-wrong-literal-" + str(value.datatype),
             changed(rational, EX.r, AV.numerator, value), False)
    case("rational-closed-value-shape", rational + ttl('ex:r ex:extra "not allowed" .'), False)
    unreduced = changed(changed(rational, EX.r, AV.numerator, Literal(60)), EX.r, AV.denominator, Literal(2))
    case("unreduced-rational-needs-external-gcd", unreduced, category="documented-limit")

    mapping = ttl("""
ex:m a av:TimestampMapping ; av:clock ex:clock ; av:basis av:PresentationTime ; av:timeBase ex:r .
ex:r av:numerator 1 ; av:denominator 90000 .
""")
    bounds = ttl("""
ex:c a av:RationalConstraint ; av:field av:frameRate ; av:lowerRational ex:r .
ex:r av:numerator 30 ; av:denominator 1 .
""")
    upper = changed(bounds, EX.c, AV.lowerRational)
    upper.add((EX.c, AV.upperRational, EX.r))
    selector = ttl("""
ex:s a av:TimeSelector ; av:clock ex:clock ; av:selection av:AtInstant ; av:start ex:r .
ex:r av:numerator 0 ; av:denominator 1 .
""")
    interval = changed(selector, EX.s, AV.selection, AV.ExactSamples)
    interval += ttl("ex:s av:end ex:end . ex:end av:numerator 1 ; av:denominator 1 .")
    for name, base, subject, positive in (
        ("Track.frameRate", camera, rate, True),
        ("RationalConstraint.lowerRational", bounds, EX.r, True),
        ("RationalConstraint.upperRational", upper, EX.r, True),
        ("TimestampMapping.timeBase", mapping, EX.r, True),
        ("TimeSelector.start", selector, EX.r, False),
        ("TimeSelector.end", interval, EX.end, False),
    ):
        for numerator in (-1, 0, 1):
            expected = numerator > 0 if positive else numerator >= 0
            category = "documented-limit" if name == "TimeSelector.end" and numerator == 0 else None
            case(f"{name}-numerator-{numerator}", changed(base, subject, AV.numerator, Literal(numerator)),
                 expected, category)
    case("untyped-intrinsic-rational-still-checked", changed(camera, rate, RDF.type))
    case("untyped-rational-invalid-denominator",
         changed(changed(camera, rate, RDF.type), rate, AV.denominator, Literal(0)), False)
    case("signed-observed-timestamp-remains-valid", ttl("""
ex:t a av:Timestamp ; av:clock ex:clock ; av:basis av:PresentationTime ;
    av:time [ av:numerator -1 ; av:denominator 2 ] ; av:evidence ex:evidence .
"""))
    case("rational-constraint-missing-both-bounds", changed(bounds, EX.c, AV.lowerRational), False)
    case("reversed-positive-rational-bounds-needs-external-ordering",
         bounds + ttl("ex:c av:upperRational [ av:numerator 1 ; av:denominator 1 ] ."),
         category="documented-limit")
    integers = ttl("ex:c a av:IntegerConstraint ; av:field av:width ; av:lowerInteger 10 .")
    case("integer-lower-only", integers)
    case("integer-upper-only", ttl("ex:c a av:IntegerConstraint ; av:field av:width ; av:upperInteger 10 ."))
    case("reversed-integer-bounds", integers + ttl("ex:c av:upperInteger 5 ."), False)
    case("instant-forbids-end", selector + ttl("ex:s av:end ex:r ."), False)
    case("interval-needs-end", changed(interval, EX.s, AV.end), False)
    case("reference-clock-needs-qualified-mapping-companions",
         mapping + ttl("ex:m av:referenceClock ex:reference ."), False)
    case("reference-clock-companions-structural-only", mapping + ttl("""
ex:m av:referenceClock ex:reference ; av:configuration ex:unresolvedPin ; av:uncertaintyMs 0 .
"""))

    for subject, family in ((video, "video"), (audio, "audio")):
        for codec in ("H264", "JPEG", "AAC", "H265", "Opus", "UnknownCodec"):
            expected = codec in ({"H264", "JPEG", "H265"} if family == "video" else {"AAC", "Opus"})
            case("codec-" + family + "-" + codec, changed(camera, subject, AV.codec, AV[codec]), expected)
    case("mono-rejects-two-channels", changed(camera, audio, AV.channels, Literal(2)), False)
    case("constant-video-requires-frame-rate", changed(camera, video, AV.frameRate), False)
    case("video-forbids-audio-sample-rate", camera + Graph().add((video, AV.sampleRate, Literal(48000))), False)
    raw = ttl("""
ex:raw a av:Track ; dcterms:identifier "picture" ; av:representation av:RawVideo ;
    av:width 1280 ; av:height 720 ; av:pixelFormat av:BGR8 ; av:bufferLayout av:Contiguous ;
    av:configuration ex:unresolvedPin .
""")
    pcm = ttl("""
ex:pcm a av:Track ; dcterms:identifier "sound" ; av:representation av:PCM ;
    av:sampleRate 48000 ; av:channels 2 ; av:channelLayout av:StereoLR ;
    av:sampleFormat av:S16LE ; av:bufferLayout av:Interleaved ; av:configuration ex:unresolvedPin .
""")
    case("raw-video-positive", raw)
    case("pcm-positive", pcm)
    case("raw-video-forbids-codec", raw + ttl("ex:raw av:codec av:H265 ."), False)
    case("pcm-forbids-codec", pcm + ttl("ex:pcm av:codec av:Opus ."), False)

    form = URIRef("urn:example:form:camera7:media")
    check("Native Form need not assert hctl:Form RDF type", not list(camera.objects(form, RDF.type))
          and (form, HCTL.hasOperationType, TD.readProperty) in camera
          and camera.value(form, HCTL.hasTarget).datatype == XSD.anyURI)
    case("media-form-missing-binding", changed(camera, form, AV.binding), False)
    case("media-form-missing-locality", changed(camera, form, AV.locality), False)
    hostlocal = changed(camera, form, AV.locality, AV.HostLocal)
    case("hostlocal-media-form-requires-host", hostlocal, False)
    hostlocal.add((form, AV.host, EX.host))
    case("hostlocal-media-form-with-host", hostlocal)
    no_direction = changed(camera, form, AV.mediaDirection)
    case("selected-form-without-direction-needs-resolved-profile", no_direction, category="documented-limit")
    case("control-binding-alone-is-not-a-media-target", ttl("""
ex:affordance td:hasForm ex:form .
ex:form hctl:hasTarget "https://example.org/control"^^xsd:anyURI ;
    hctl:hasOperationType td:invokeAction ; av:binding ex:controlBinding .
"""))

    need = ttl("""
ex:need a av:Need ; dcterms:isVersionOf ex:series ; av:generation 0 ; av:state av:Active ;
    av:processor ex:processor ; av:input ex:input .
ex:processor a av:Processor, td:Thing ; td:title "Processor" ; ex:vendor "allowed" .
ex:input a av:InputRequirement ; dcterms:identifier "inspection" ; av:presence av:Required ;
    av:alternative ex:alternative .
ex:alternative a av:InputAlternative ; av:kind av:Live ; av:captureIntent av:Observe ;
    av:deliveredTracks ex:requirement .
ex:requirement a av:TrackRequirement ; dcterms:identifier "picture" ;
    av:representation av:RawVideo ; av:presence av:Required .
""")
    case("fully-described-small-need-with-open-native-extension", need)
    case("need-missing-input", changed(need, EX.need, AV.input), False)
    dangling = changed(need, EX.need, AV.input, EX.missing)
    case("dangling-input-is-not-full-reference-validation", dangling, category="documented-limit")
    preferences = need + ttl("""
ex:need av:preferences ( ex:preference ) .
ex:preference av:input ex:input ; av:goal ex:goal .
ex:goal a av:ChoiceConstraint ; av:field av:host ; av:allowedValues ex:host .
""")
    case("ordered-untyped-preference", preferences)
    case("preference-needs-goal", changed(preferences, EX.preference, AV.goal), False)
    case("polymorphic-goal-requires-type", changed(preferences, EX.goal, RDF.type), False)
    case("empty-preference-list", need + ttl("ex:need av:preferences rdf:nil ."))
    case("dangling-list-head-is-not-topology-validation",
         need + ttl("ex:need av:preferences ex:missingList ."), category="documented-limit")
    repeated = changed(preferences, EX.need, AV.preferences)
    head = BNode()
    Collection(repeated, head, [EX.preference, EX.preference])
    repeated.add((EX.need, AV.preferences, head))
    case("repeated-preference-list-members-remain-ordered", repeated)

    queue = ttl("""
ex:q a av:QueuePolicy ; av:stage av:DecodedDelivery ; av:capacity 1 ; av:unit av:Frame ;
    av:overflow av:DropOldest ; av:coveragePolicy av:BestEffort .
""")
    case("bounded-queue", queue)
    no_drop = changed(queue, EX.q, AV.coveragePolicy, AV.NoIntentionalDrop)
    no_drop += ttl("ex:q av:gapResponse av:Report .")
    case("no-intentional-drop-forbids-dropping", no_drop, False)
    case("no-intentional-drop-blocking-structure-only", changed(no_drop, EX.q, AV.overflow, AV.BlockUpstream))
    case("infinite-rdf-ms-needs-separate-finiteness-check",
         queue + ttl('ex:q av:limitMs "INF"^^xsd:double .'), category="documented-limit")
    choice = ttl("ex:c a av:ChoiceConstraint ; av:field av:codec ; av:allowedValues av:Mono .")
    case("choice-value-applicability-is-external", choice, category="documented-limit")
    case("empty-choice-is-invalid", changed(choice, EX.c, AV.allowedValues), False)

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
    case("four-condition-status-structure-not-currentness", status)
    case("duplicate-condition-name", changed(status, EX.result, AV.condition, AV.ModelLoaded), False)
    ready = changed(status, EX.status, AV.state, AV.Ready)
    case("ready-needs-application-true", ready, False)
    ready = changed(ready, EX.application, AV.conditionState, AV["True"])
    case("application-true-needs-evidence", ready, False)
    ready += ttl("ex:application av:evidence ex:unverifiedEvidence .")
    case("evidence-iri-is-not-authenticity", ready, category="documented-limit")
    case("ready-does-not-entail-model-loaded",
         changed(ready, EX.model, AV.conditionState, AV.Unknown), category="documented-limit")
    case("condition-truth-is-not-a-boolean", changed(status, EX.media, AV.conditionState, Literal(False)), False)
    case("status-equal-interval-ends",
         changed(status, EX.status, AV.validUntil, status.value(EX.status, AV.observedAt)), False)
    run = ttl("""
ex:run a av:ProcessingRun ; av:configuration ex:configuration ; av:holder ex:holder ;
    av:assignment ex:assignment ; av:state av:Running ; av:lease ex:lease ;
    prov:used ex:actualInput ; prov:wasAssociatedWith ex:agent .
""")
    case("processing-run-needs-no-owl-imports-or-inferred-supertype", run)
    case("processing-run-requires-prov-used",
         changed(run, EX.run, URIRef("http://www.w3.org/ns/prov#used")), False)

    outcomes = []
    for name, graph, expected, category in cases:
        conforms, report_graph, report_text = shacl(graph, shapes)
        check("SHACL " + name, bool(conforms) == expected,
              {"expectedConforms": expected, "actualConforms": bool(conforms),
               "components": sorted({str(value).split("#")[-1] for value in report_graph.objects(None, SH.sourceConstraintComponent)}),
               "report": report_text if bool(conforms) != expected else None}, category)
        outcomes.append({"case": name, "category": category, "conforms": bool(conforms)})

    resolved_media = shapes + ttl("""
ex:ResolvedMediaModeShape a sh:NodeShape ; sh:targetClass av:Mode ;
    sh:property [ sh:path av:form ; sh:node av:MediaFormShape ] .
""")
    resolved_need = shapes + ttl("""
ex:ResolvedNeedShape a sh:NodeShape ; sh:targetClass av:Need ;
    sh:property [ sh:path av:input ; sh:node av:InputRequirementShape ] .
""")
    for label, profile, good, bad in (
        ("resolved-media", resolved_media, camera, no_direction),
        ("resolved-need", resolved_need, need, dangling),
    ):
        check(label + " finite opt-in profile positive", bool(shacl(good, profile, meta=True)[0]))
        check(label + " finite opt-in profile rejects missing description", not shacl(bad, profile)[0],
              category="expected-structural-failure")
    return {"metaShacl": True, "inference": "none", "owlImports": False,
            "shapeTriples": len(shapes), "cases": len(cases),
            "categories": dict(Counter(row["category"] for row in outcomes)),
            "structuralConformanceIsAdmission": False}
