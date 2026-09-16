"""Finite-graph AV projection and complete assertion preservation checks."""

from __future__ import annotations

import copy
from decimal import Decimal

from rdflib import BNode, Dataset, Graph, Literal, URIRef
from rdflib.namespace import RDF, XSD

from common import AV, absolute_iri, exact_integer, graph_for, iri_identity, strict_json
from diagnostics import AVError, diagnostic
from matching import compact_record, controlled, normalize_mode, record, validate_need, validate_offer
from model import ALL_PROPERTIES, TERMS, iri, uses_for


def same_json(left, right):
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    if isinstance(left, (int, Decimal)) and isinstance(right, (int, Decimal)):
        return left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(same_json(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same_json(a, b) for a, b in zip(left, right))
    return type(left) is type(right) and left == right


def semantic_iri(value):
    if isinstance(value, dict) and "@id" in value:
        value = value["@id"]
    if isinstance(value, str):
        for prefix, namespace in TERMS["prefixes"].items():
            if value.startswith(prefix + ":"):
                return URIRef(namespace + value[len(prefix) + 1:])
    return URIRef(absolute_iri(value))


@diagnostic("AV_INVALID_DESCRIPTION", "semantic-projection")
def assert_projection(document, graph=None):
    """Audit values per subject, including literal datatypes and complete cardinalities."""
    graph = graph_for(document) if graph is None else graph
    checked = set()

    def audit(node, subject=None):
        if not isinstance(node, dict):
            return
        node = compact_record(node, "Source record")
        identity = node.get("@id", node.get("id"))
        if identity is not None:
            subject = semantic_iri(identity)
        relevant = [(key, ALL_PROPERTIES[key], value) for key, value in node.items() if key in ALL_PROPERTIES]
        if relevant and subject is None:
            raise ValueError("Relevant AV assertions have no resolvable subject")
        if subject is not None:
            source_properties = {iri(key) for key, _, _ in relevant if key.startswith("av:")}
            actual_properties = {predicate for predicate in graph.predicates(subject) if str(predicate).startswith(str(AV))}
            if source_properties != actual_properties:
                raise ValueError("AV subject/property assertions changed during expansion: " + str(subject))
            types = node.get("@type", [])
            types = [types] if isinstance(types, str) else types
            for value in types:
                if value.startswith(("av:", str(AV))) and (subject, RDF.type, semantic_iri(value)) not in graph:
                    raise ValueError("AV subject/class assertion was lost: " + str(subject))
        for key, prop, source in relevant:
            predicate = iri(key)
            actual = list(graph.objects(subject, predicate))
            expected = source if prop.get("container") == "set" else [source]
            if not isinstance(expected, list) or len(actual) != len(expected):
                raise ValueError("AV assertion cardinality changed: " + str(subject) + " " + key)
            remaining = list(actual)
            for value in expected:
                candidates = []
                for target in remaining:
                    if prop["value"] == "node":
                        if isinstance(value, dict) and "@id" not in value:
                            good = isinstance(target, (BNode, URIRef))
                        else:
                            good = target == semantic_iri(value)
                    elif prop["value"] == "integer":
                        good = isinstance(target, Literal) and target.datatype == XSD.integer and target.toPython() == exact_integer(value)
                    elif prop["value"] == "json":
                        data = (value["@value"] if isinstance(value, dict) and value.get("@type") == "@json" else value)
                        good = (isinstance(target, Literal) and target.datatype == RDF.JSON
                                and same_json(strict_json(str(target)), data))
                    else:
                        datatype = XSD.dateTime if prop["value"] == "dateTime" else XSD.string
                        good = (isinstance(target, Literal) and not target.language
                                and target.datatype in ({None, XSD.string} if datatype == XSD.string else {datatype})
                                and (str(target) == value if datatype == XSD.string else target == Literal(value, datatype=datatype)))
                    if good:
                        candidates.append(target)
                if len(candidates) != 1:
                    raise ValueError("AV subject/value/datatype assertion changed: " + str(subject) + " " + key)
                target = candidates[0]
                remaining.remove(target)
                checked.add((subject, predicate, target))
                if prop["value"] == "node" and isinstance(value, dict) and set(value) != {"@id"}:
                    audit(value, target)
        for key, child in node.items():
            if key in ALL_PROPERTIES or key in {"@context", "@value"}:
                continue
            if isinstance(child, dict):
                audit(child)
            elif isinstance(child, list):
                for item in child:
                    if isinstance(item, dict):
                        audit(item)

    audit(document)
    return len(checked)


@diagnostic("AV_INVALID_DESCRIPTION", "semantic-projection")
def project_graph(graph, identity, *, graph_name=None):
    """Assemble a complete Offer/Need only within an explicitly selected finite graph."""
    if isinstance(graph, Dataset):
        if graph_name is None:
            raise ValueError("A dataset requires an explicit graph boundary; graph union is prohibited")
        graph = graph.graph(URIRef(absolute_iri(graph_name, "Graph identity")))
    elif graph_name is not None:
        raise ValueError("graph_name applies only to a dataset")
    if not isinstance(graph, Graph):
        raise ValueError("Semantic input must be a finite RDF graph")
    if len(graph) > 100000:
        raise AVError("AV_RESOURCE_LIMIT", "Graph triple budget exceeded", stage="semantic-projection",
                      limit="graph-triples", measured=len(graph))
    active, cache = set(), {}

    def assemble(subject, expected_class=None):
        if subject in active:
            raise ValueError("Cyclic containment cannot provide complete finite AV records")
        if subject in cache:
            result = copy.deepcopy(cache[subject])
            if expected_class is not None and result["@type"] != "av:" + expected_class:
                raise ValueError("One subject has conflicting AV classes")
            return result
        types = list(graph.objects(subject, RDF.type))
        classes = [str(value)[len(str(AV)):] for value in types if str(value).startswith(str(AV))]
        if any(value not in TERMS["classes"] for value in classes) or len(classes) > 1:
            raise ValueError("Unknown or conflicting AV subject class")
        name = classes[0] if classes else expected_class
        if name is None or name not in TERMS["classes"]:
            raise AVError("AV_UNRESOLVED_REFERENCE", "AV subject has no resolvable record class",
                          stage="semantic-projection", location=str(subject))
        if expected_class is not None and name != expected_class:
            raise ValueError("AV relationship target has the wrong class")
        if not classes and name not in {"Rational", "FormReference"}:
            raise ValueError("Identified AV record requires an explicit class")
        if not list(graph.predicate_objects(subject)):
            raise AVError("AV_UNRESOLVED_REFERENCE", "Required semantic record is absent",
                          stage="semantic-projection", location=str(subject))
        active.add(subject)
        result = {"@type": "av:" + name}
        if isinstance(subject, URIRef):
            result["@id"] = absolute_iri(str(subject))
        elif TERMS["classes"][name]["identity"] == "iri":
            raise ValueError("Identified AV record cannot be a blank node")
        uses = uses_for("av:" + name)
        allowed = {iri(key): (key, prop, usage) for key, (prop, usage) in uses.items()}
        for predicate in set(graph.predicates(subject)):
            if predicate == RDF.type:
                continue
            if predicate not in allowed:
                if str(predicate).startswith(str(AV)) or name in {"Rational", "FormReference"}:
                    raise ValueError("Undeclared predicate on semantic AV record: " + str(predicate))
                continue
            key, prop, usage = allowed[predicate]
            values = list(graph.objects(subject, predicate))
            if len(values) < usage["min"] or usage["max"] is not None and len(values) > usage["max"]:
                raise ValueError("Invalid semantic cardinality: " + key)
            converted = []
            for value in values:
                range_name = usage["range"]
                if prop["value"] == "node":
                    if not isinstance(value, (URIRef, BNode)):
                        raise ValueError("Node-valued AV assertion became a literal: " + key)
                    if isinstance(range_name, str) and range_name.startswith("av:") and range_name[3:] in TERMS["classes"]:
                        item = assemble(value, range_name[3:])
                    elif isinstance(value, URIRef):
                        item = str(value)
                    else:
                        raise ValueError("IRI-valued assertion is a blank node: " + key)
                elif prop["value"] == "integer":
                    if not isinstance(value, Literal) or value.datatype != XSD.integer or type(value.toPython()) is not int:
                        raise ValueError("Expected exact semantic xsd:integer: " + key)
                    item = {"@value": str(value.toPython()), "@type": str(XSD.integer)}
                elif prop["value"] == "json":
                    if not isinstance(value, Literal) or value.datatype != RDF.JSON:
                        raise ValueError("accepts must remain rdf:JSON")
                    item = strict_json(str(value))
                    if not isinstance(item, dict):
                        raise ValueError("accepts JSON literal must contain an object")
                else:
                    datatype = XSD.dateTime if prop["value"] == "dateTime" else XSD.string
                    if (not isinstance(value, Literal) or value.language
                            or value.datatype not in ({None, XSD.string} if datatype == XSD.string else {datatype})):
                        raise ValueError("Incorrect semantic literal datatype: " + key)
                    item = str(value)
                converted.append(item)
            result[key] = converted if prop.get("container") == "set" else converted[0]
        active.remove(subject)
        cache[subject] = copy.deepcopy(result)
        return result

    result = assemble(URIRef(absolute_iri(identity)))
    if result["@type"] == "av:Offer":
        validate_offer(result)
    elif result["@type"] == "av:Need":
        validate_need(result)
    else:
        raise ValueError("Semantic root must be an Offer or Need")
    return result


def normalize_semantic(graph, offer_identity, mode_identity, *, graph_name=None):
    return normalize_mode(project_graph(graph, offer_identity, graph_name=graph_name), mode_identity)
