"""Build vocabulary graphs from the authoritative inventory and structural rules."""

from __future__ import annotations

from collections import defaultdict
from itertools import count

from rdflib import BNode, Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, OWL, RDF, RDFS, SH, XSD

from common import read, relative_file

TERMS = read(relative_file("vocabulary/terms.json"))
AV = Namespace(TERMS["namespace"])
NS = TERMS["prefixes"]
ALL_PROPERTIES = {
    **{f"av:{name}": item for name, item in TERMS["properties"].items()},
    **TERMS["external_properties"],
}
VALUE_SHAPES = {
    "Rational", "IntegerConstraint", "RationalConstraint", "ChoiceConstraint",
    "Preference", "QueuePolicy", "TimingConstraint", "TimeSelector",
    "TimestampMapping", "Timestamp", "ResourceUse", "Condition", "Fault",
    "FormReference",
}
SIGN_SHAPES = {
    ("av:Track", "av:frameRate"): "PositiveRationalShape",
    ("av:RationalConstraint", "av:lowerRational"): "PositiveRationalShape",
    ("av:RationalConstraint", "av:upperRational"): "PositiveRationalShape",
    ("av:TimestampMapping", "av:timeBase"): "PositiveRationalShape",
    ("av:TimeSelector", "av:start"): "NonNegativeRationalShape",
    ("av:TimeSelector", "av:end"): "NonNegativeRationalShape",
}


def iri(name: str) -> URIRef:
    if name.startswith(("https:", "http:", "urn:")):
        return URIRef(name)
    prefix, local = name.split(":", 1)
    return URIRef(NS[prefix] + local)


def enum_values(name: str) -> list[URIRef]:
    values = TERMS["enums"][name]
    return [iri(value) for value in values] if isinstance(values, list) else [AV[value] for value in values]


def uses_for(class_name: str) -> dict:
    definition = TERMS["classes"].get(class_name.removeprefix("av:"), {})
    domains = [*definition.get("superclasses", []), class_name]
    result = {}
    for name, prop in ALL_PROPERTIES.items():
        for domain in domains:
            if domain in prop["uses"]:
                result[name] = (prop, prop["uses"][domain])
    return result


def make_context() -> dict:
    context = {"@version": 1.1, "@protected": True}
    for prefix in ("av", "prov", "dcterms"):
        context[prefix] = {"@id": NS[prefix], "@prefix": True}
    for name, prop in ALL_PROPERTIES.items():
        definition = {"@id": str(iri(name))}
        if prop["value"] == "node":
            definition["@type"] = "@id"
        elif prop["value"] == "dateTime":
            definition["@type"] = str(XSD.dateTime)
        elif prop["value"] == "string":
            definition["@type"] = str(XSD.string)
        if prop.get("container") in ("set", "list"):
            definition["@container"] = "@" + prop["container"]
        context[name] = definition
    return {"@context": context}


def bind(graph: Graph) -> None:
    for prefix, value in NS.items():
        graph.bind(prefix, Namespace(value))
    graph.bind("owl", OWL)
    graph.bind("sh", SH)


def label(name: str) -> str:
    return name.replace("Constraint", " constraint").replace("Requirement", " requirement")


def make_ontology() -> Graph:
    graph = Graph()
    bind(graph)
    ontology = URIRef(TERMS["namespace"])
    graph.add((ontology, RDF.type, OWL.Ontology))
    graph.add((ontology, DCTERMS.title, Literal("Proposed WoT AV vocabulary v0.1", lang="en")))
    graph.add((ontology, OWL.versionInfo, Literal(TERMS["release"])))
    graph.add((ontology, DCTERMS.description, Literal(TERMS["status"], lang="en")))
    graph.add((ontology, DCTERMS.created, Literal("2026-09-14", datatype=XSD.date)))
    for source in TERMS["baseline"]:
        graph.add((ontology, DCTERMS.references, URIRef(source)))
    for name, definition in TERMS["classes"].items():
        node = AV[name]
        graph.add((node, RDF.type, RDFS.Class))
        graph.add((node, RDFS.label, Literal(label(name), lang="en")))
        graph.add((node, RDFS.comment, Literal(definition["meaning"], lang="en")))
        graph.add((node, DCTERMS.isPartOf, URIRef("https://example.org/wot/av/module/" + definition["module"])))
        for superclass in definition["superclasses"]:
            graph.add((node, RDFS.subClassOf, iri(superclass)))
    for name, prop in TERMS["properties"].items():
        node = AV[name]
        graph.add((node, RDF.type, RDF.Property))
        graph.add((node, RDFS.label, Literal(name, lang="en")))
        description = prop["meaning"]
        if "unit" in prop:
            description += " Fixed unit: " + prop["unit"] + "."
        uses = []
        for domain, usage in prop["uses"].items():
            maximum = "*" if usage["max"] is None else usage["max"]
            uses.append(f'{domain} -> {usage["range"]} [{usage["min"]}..{maximum}]')
        description += " Profile uses (alternative domains, not RDFS intersections): " + "; ".join(uses) + "."
        graph.add((node, RDFS.comment, Literal(description, lang="en")))
        graph.add((node, DCTERMS.isPartOf, URIRef("https://example.org/wot/av/module/" + prop["module"])))
    descriptions = defaultdict(set)
    for values in TERMS["enums"].values():
        if isinstance(values, dict):
            for name, meaning in values.items():
                descriptions[name].add(meaning)
    for name, meanings in descriptions.items():
        if name in TERMS["classes"] or name in TERMS["properties"]:
            raise ValueError(f"Controlled individual collides with a class/property: {name}")
        graph.add((AV[name], RDF.type, RDFS.Resource))
        graph.add((AV[name], RDFS.label, Literal(name, lang="en")))
        for meaning in sorted(meanings):
            graph.add((AV[name], RDFS.comment, Literal(meaning, lang="en")))
    for name, definition in TERMS["codec_publication"]["additions"].items():
        for source in definition["sources"]:
            graph.add((AV[name], DCTERMS.references, URIRef(source)))
    return graph


class Shapes:
    def __init__(self) -> None:
        self.graph = Graph()
        bind(self.graph)
        self.numbers = count(1)
        self.extra_constraints = defaultdict(list)

    def blank(self) -> BNode:
        return BNode(f"avshape{next(self.numbers):05d}")

    def add(self, subject, predicate, value) -> None:
        self.graph.add((subject, predicate, value))

    def rdf_list(self, values) -> URIRef | BNode:
        values = list(values)
        if not values:
            return RDF.nil
        head = self.blank()
        current = head
        for index, value in enumerate(values):
            self.add(current, RDF.first, value)
            following = RDF.nil if index == len(values) - 1 else self.blank()
            self.add(current, RDF.rest, following)
            current = following
        return head

    def node(self) -> BNode:
        node = self.blank()
        self.add(node, RDF.type, SH.NodeShape)
        return node

    def property(self, node, path, minimum=None, maximum=None):
        prop = self.blank()
        self.add(node, SH.property, prop)
        self.add(prop, SH.path, path)
        if minimum is not None:
            self.add(prop, SH.minCount, Literal(minimum, datatype=XSD.integer))
        if maximum is not None:
            self.add(prop, SH.maxCount, Literal(maximum, datatype=XSD.integer))
        return prop

    def member_of(self, shape, values) -> None:
        self.add(shape, SH["in"], self.rdf_list(values))

    def count_property(self, path, minimum=None, maximum=None):
        node = self.node()
        self.property(node, path, minimum, maximum)
        return node

    def has_value(self, path, value):
        node = self.node()
        prop = self.property(node, path)
        self.add(prop, SH.hasValue, value)
        return node

    def implication(self, owner, antecedent, consequent) -> None:
        negated = self.node()
        self.add(negated, SH["not"], antecedent)
        constraint = self.node()
        self.add(constraint, SH["or"], self.rdf_list([negated, consequent]))
        self.extra_constraints[owner].append(constraint)

    def finish(self) -> None:
        for owner, constraints in self.extra_constraints.items():
            self.add(owner, SH["and"], self.rdf_list(constraints))

    def datatype(self, prop, range_name: str) -> None:
        if range_name == "number":
            variants = []
            for datatype in (XSD.integer, XSD.decimal, XSD.double):
                node = self.node()
                self.add(node, SH.datatype, datatype)
                variants.append(node)
            self.add(prop, SH["or"], self.rdf_list(variants))
        else:
            self.add(prop, SH.datatype, {"integer": XSD.integer, "string": XSD.string, "dateTime": XSD.dateTime}[range_name])

    def range(self, prop, range_name) -> None:
        if isinstance(range_name, list):
            if all(value.startswith("av:") and value[3:] in TERMS["classes"] for value in range_name):
                variants = []
                for value in range_name:
                    node = self.node()
                    self.add(node, SH["class"], iri(value))
                    if value[3:] in VALUE_SHAPES or value == "av:TrackRequirement":
                        self.add(node, SH.node, AV[value[3:] + "Shape"])
                    variants.append(node)
                self.add(prop, SH["or"], self.rdf_list(variants))
                self.add(prop, SH.nodeKind, SH.BlankNodeOrIRI)
            else:
                self.member_of(prop, [iri(value) for value in range_name])
                self.add(prop, SH.nodeKind, SH.IRI)
        elif range_name in ("integer", "number", "string", "dateTime"):
            self.datatype(prop, range_name)
        elif range_name.startswith("enum:"):
            self.member_of(prop, enum_values(range_name[5:]))
            self.add(prop, SH.nodeKind, SH.IRI)
        elif range_name.startswith("av:") and range_name[3:] in VALUE_SHAPES:
            self.add(prop, SH.nodeKind, SH.BlankNodeOrIRI)
            self.add(prop, SH.node, AV[range_name[3:] + "Shape"])
        else:
            # Named references need resolution; do not demand an imported type triple.
            self.add(prop, SH.nodeKind, SH.IRI)

    def basic_shape(self, class_name: str, shape_name: str | None = None, target=True) -> URIRef:
        shape = AV[shape_name or class_name.removeprefix("av:") + "Shape"]
        self.add(shape, RDF.type, SH.NodeShape)
        if target:
            self.add(shape, SH.targetClass, iri(class_name))
        definition = TERMS["classes"].get(class_name.removeprefix("av:"))
        if definition:
            self.add(shape, RDFS.comment, Literal("Structural subset only. " + definition["meaning"], lang="en"))
            self.add(shape, SH.nodeKind, SH.IRI if definition["identity"] == "iri" else SH.BlankNodeOrIRI)
        if class_name.removeprefix("av:") in TERMS["shape_coverage"]["closed_shapes"]:
            self.add(shape, SH.closed, Literal(True))
            self.add(shape, SH.ignoredProperties, self.rdf_list([RDF.type]))
        for name, (prop_def, usage) in uses_for(class_name).items():
            path = iri(name)
            if prop_def.get("container") == "list":
                wrapper = self.property(shape, path, 1 if usage["min"] else 0, 1)
                self.add(wrapper, SH.nodeKind, SH.BlankNodeOrIRI)
                rest = self.blank()
                self.add(rest, SH.zeroOrMorePath, RDF.rest)
                member_path = self.rdf_list([path, rest, RDF.first])
                member = self.property(shape, member_path)
                self.range(member, usage["range"])
                self.add(member, SH.node, AV.PreferenceShape)
                continue
            prop = self.property(shape, path, usage["min"], usage["max"])
            self.range(prop, usage["range"])
            sign_shape = SIGN_SHAPES.get((class_name, name))
            if sign_shape:
                if self.graph.value(prop, SH.node) != AV.RationalShape:
                    raise ValueError("Contextual sign rule no longer refers to a Rational: " + name)
                self.graph.set((prop, SH.node, AV[sign_shape]))
            if "minimum" in prop_def:
                self.add(prop, SH.minInclusive, Literal(prop_def["minimum"]))
            if "pattern" in prop_def:
                self.add(prop, SH.pattern, Literal(prop_def["pattern"]))
        return shape

    def extras(self) -> None:
        for name, comparison, description in (
            ("PositiveRationalShape", SH.minExclusive,
             "Positive rate or seconds-per-tick only; gcd and bound ordering remain external."),
            ("NonNegativeRationalShape", SH.minInclusive,
             "Nonnegative selector offset only; interval ordering remains external."),
        ):
            helper = AV[name]
            self.add(helper, RDF.type, SH.NodeShape)
            self.add(helper, RDFS.comment, Literal(description, lang="en"))
            self.add(helper, SH.node, AV.RationalShape)
            self.add(self.property(helper, AV.numerator), comparison, Literal(0))
        for name, low, high in (
            ("IntegerConstraint", AV.lowerInteger, AV.upperInteger),
            ("RationalConstraint", AV.lowerRational, AV.upperRational),
        ):
            self.add(AV[name + "Shape"], SH["or"], self.rdf_list([
                self.count_property(low, 1), self.count_property(high, 1)
            ]))
        bound = self.property(AV.IntegerConstraintShape, AV.lowerInteger)
        self.add(bound, SH.lessThanOrEquals, AV.upperInteger)
        evidence = self.count_property(AV.evidence, 1)
        self.implication(
            AV.ConditionShape, self.has_value(AV.conditionState, AV["True"]), evidence
        )
        queue_complete = self.node()
        self.property(queue_complete, AV.gapResponse, 1, 1)
        overflow = self.property(queue_complete, AV.overflow)
        self.member_of(overflow, [AV.BlockUpstream, AV.Fail])
        self.implication(
            AV.QueuePolicyShape, self.has_value(AV.coveragePolicy, AV.NoIntentionalDrop), queue_complete
        )
        selector_variants = []
        for value, has_end, has_tolerance in (
            (AV.AtInstant, False, False), (AV.ExactSamples, True, False),
            (AV.CoveringInterval, True, True),
        ):
            node = self.has_value(AV.selection, value)
            self.property(node, AV.end, 1 if has_end else 0, 1 if has_end else 0)
            self.property(node, AV.toleranceMs, 1 if has_tolerance else 0, 1 if has_tolerance else 0)
            selector_variants.append(node)
        self.add(AV.TimeSelectorShape, SH.xone, self.rdf_list(selector_variants))
        mapped = self.node()
        self.property(mapped, AV.configuration, 1, 1)
        self.property(mapped, AV.uncertaintyMs, 1, 1)
        self.implication(
            AV.TimestampMappingShape, self.count_property(AV.referenceClock, 1), mapped
        )
        self.track_variants()
        for shape, start in ((AV.LeaseGrantShape, AV.validFrom), (AV.AssignmentStatusShape, AV.observedAt)):
            prop = self.property(shape, start)
            self.add(prop, SH.lessThan, AV.validUntil)
        for condition in enum_values("ConditionName"):
            qualified = self.property(AV.AssignmentStatusShape, AV.conditions)
            self.add(qualified, SH.qualifiedValueShape, self.has_value(AV.condition, condition))
            self.add(qualified, SH.qualifiedMinCount, Literal(1))
            self.add(qualified, SH.qualifiedMaxCount, Literal(1))
        ready = self.node()
        qualified = self.property(ready, AV.conditions)
        application = self.has_value(AV.condition, AV.ApplicationReady)
        truth = self.property(application, AV.conditionState)
        self.add(truth, SH.hasValue, AV["True"])
        self.add(qualified, SH.qualifiedValueShape, application)
        self.add(qualified, SH.qualifiedMinCount, Literal(1))
        self.implication(AV.AssignmentStatusShape, self.has_value(AV.state, AV.Ready), ready)
        clip = self.count_property(AV.selector, 1, 1)
        self.implication(AV.ModeShape, self.has_value(AV.kind, AV.Clip), clip)
        for kind in (AV.Still, AV.Live):
            self.implication(AV.ModeShape, self.has_value(AV.kind, kind), self.count_property(AV.selector, 0, 0))
        still = self.node()
        track = self.property(still, AV.track, 1, 1)
        video = self.node()
        representation = self.property(video, AV.representation)
        self.member_of(representation, [AV.EncodedVideo, AV.RawVideo])
        self.property(video, AV.cadence, 0, 0)
        self.property(video, AV.frameRate, 0, 0)
        self.add(track, SH.node, video)
        self.implication(AV.ModeShape, self.has_value(AV.kind, AV.Still), still)
        self.implication(AV.MediaAssetShape, self.has_value(AV.kind, AV.Clip), self.count_property(AV.selector, 1, 1))
        self.implication(AV.MediaAssetShape, self.has_value(AV.kind, AV.Still), self.has_value(AV.state, AV.Complete))
        for state in (AV.Partial, AV.Error):
            self.implication(AV.ResultShape, self.has_value(AV.state, state), self.count_property(AV.issues, 1))
        live = self.node()
        for prop in (AV.source, AV.incarnation, AV.track, AV.sequence):
            self.property(live, prop, 1, 1)
        self.property(live, iri("prov:wasDerivedFrom"), 0, 0)
        retained = self.node()
        self.property(retained, iri("prov:wasDerivedFrom"), 1, 1)
        self.property(retained, AV.selector, 1, 1)
        for prop in (AV.source, AV.incarnation, AV.sequence):
            self.property(retained, prop, 0, 0)
        self.add(AV.MediaSampleShape, SH.xone, self.rdf_list([live, retained]))
        media = self.basic_shape("hctl:Form", "MediaFormShape", target=False)
        self.add(media, SH.nodeKind, SH.IRI)
        self.add(media, SH.targetSubjectsOf, AV.mediaDirection)
        for name in TERMS["native_form_rules"]["media_form_required"]:
            self.property(media, iri(name), 1, 1)
        self.implication(media, self.has_value(AV.locality, AV.HostLocal), self.count_property(AV.host, 1, 1))

    def track_variants(self) -> None:
        variants = []
        all_fields = {
            "width", "height", "codec", "pixelFormat", "cadence", "frameRate",
            "sampleRate", "channels", "channelLayout", "sampleFormat", "bufferLayout",
        }
        definitions = [
            ("EncodedVideo", {"width", "height", "codec"}, {"cadence", "frameRate"},
             {"codec": [iri(value) for value in TERMS["codec_publication"]["representation_codec_sets"]["av:EncodedVideo"]]}),
            ("RawVideo", {"width", "height", "pixelFormat", "bufferLayout"}, {"cadence", "frameRate"}, {"bufferLayout": [AV.Contiguous, AV.Strided]}),
            ("EncodedAudio", {"codec", "sampleRate", "channels", "channelLayout"}, set(),
             {"codec": [iri(value) for value in TERMS["codec_publication"]["representation_codec_sets"]["av:EncodedAudio"]]}),
            ("PCM", {"sampleRate", "channels", "channelLayout", "sampleFormat", "bufferLayout"}, set(), {"bufferLayout": [AV.Interleaved, AV.Planar]}),
        ]
        for representation, required, optional, choices in definitions:
            node = self.has_value(AV.representation, AV[representation])
            for name in sorted(required):
                self.property(node, AV[name], 1, 1)
            for name in sorted(all_fields - required - optional):
                self.property(node, AV[name], 0, 0)
            for name, values in choices.items():
                self.member_of(self.property(node, AV[name]), values)
            variants.append(node)
        self.add(AV.TrackShape, SH.xone, self.rdf_list(variants))
        self.implication(AV.TrackShape, self.has_value(AV.cadence, AV.Constant), self.count_property(AV.frameRate, 1, 1))
        constant = self.has_value(AV.cadence, AV.Constant)
        not_constant = self.node()
        self.add(not_constant, SH["not"], constant)
        self.implication(AV.TrackShape, not_constant, self.count_property(AV.frameRate, 0, 0))
        for layout, channels in ((AV.Mono, 1), (AV.StereoLR, 2)):
            expected = self.node()
            self.add(self.property(expected, AV.channels), SH.hasValue, Literal(channels))
            self.implication(AV.TrackShape, self.has_value(AV.channelLayout, layout), expected)


def make_shapes() -> Graph:
    shapes = Shapes()
    for name in TERMS["classes"]:
        shapes.basic_shape("av:" + name)
    shapes.extras()
    shapes.finish()
    return shapes.graph
