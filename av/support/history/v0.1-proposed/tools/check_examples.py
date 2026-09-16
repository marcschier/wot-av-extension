"""Worked-example pin, native-TD, reference, payload and SPARQL fixtures; not admission."""

from __future__ import annotations

import copy
import json
from datetime import datetime

import jsonschema
from pyld import jsonld
from rdflib import Literal, Namespace, URIRef
from rdflib.namespace import RDF, XSD

from common import (
    AV, AV_CONTEXT, HCTL, TD, TD_CONTEXT, U, canonical_dataset, dataset_for, graph_for,
    json_bytes, metadata, native_forms, nodes, pointer, ration, read, relative_file,
    resolve_fixture_form, sha, verify_pin,
)

DC = Namespace("http://purl.org/dc/terms/")


def run(checks):
    check, negative = checks.check, checks.negative
    manifest = read(relative_file("examples/manifest.json"))
    records = read(relative_file("examples/pins.jsonld"))
    pins = {node["@id"]: node for node in records["@graph"] if node["@type"] == "av:DocumentPin"}
    check("Unique pin IDs", len(pins) == len(records["@graph"]) - 1)
    for item in [*manifest["cache"].values(), *manifest["queryOnlyGraphs"].values()]:
        check("Exact cache bytes: " + item["path"], metadata(item["path"]) == item)

    def resolve_bytes(identifier, seen=None):
        seen = set() if seen is None else seen
        if identifier in seen:
            return
        if identifier not in pins:
            raise ValueError("DependencyUnavailable: unknown pin " + identifier)
        if identifier in manifest["unresolvedPins"]:
            raise ValueError("DependencyUnavailable: explicitly unresolved pin " + identifier)
        seen.add(identifier)
        pin = pins[identifier]
        entry = manifest["cache"].get(pin["av:document"])
        if entry is None:
            raise ValueError("DependencyUnavailable: no controlled offline cache entry")
        verify_pin(pin, relative_file(entry["path"]).read_bytes())
        for dependency in pin.get("av:pin", []):
            resolve_bytes(dependency, seen)

    for identifier, pin in pins.items():
        check("Known dependency IDs: " + identifier, set(pin.get("av:pin", [])) <= pins.keys())
        if identifier not in manifest["unresolvedPins"]:
            verify_pin(pin, relative_file(manifest["cache"][pin["av:document"]]["path"]).read_bytes())
            check("Verified pin octets: " + identifier, True)
    for name in ("source", "controller", "need", "shapes", "ontology"):
        resolve_bytes(U + "pin:" + name)
    check("Finite dependency closure tolerates the explicit controller/profile cycle", True)
    negative("Unknown pin has no network fallback", lambda: resolve_bytes(U + "pin:absent"))
    negative("Representation whitespace invalidates exact pin octets",
             lambda: verify_pin(pins[U + "pin:need"], relative_file("examples/need.jsonld").read_bytes() + b"\n"))
    negative("Adapter qualification closure prevents admission", lambda: resolve_bytes(U + "pin:adapter"),
             category="expected-admission-rejection")
    negative("Assignment qualification closure prevents admission", lambda: resolve_bytes(U + "pin:assignment"),
             category="expected-admission-rejection")
    sentinel = pins[U + "pin:qualification-missing"]
    check("Missing qualification is visibly unresolved, not a valid zero hash",
          sentinel["av:hexDigest"] == "0" * 64
          and sentinel["av:document"] not in manifest["cache"]
          and "NEGATIVE FIXTURE" in sentinel["dcterms:description"])
    source, controller, need, assignment = [
        read(relative_file("examples/" + name))
        for name in ("source.td.json", "controller.td.json", "need.jsonld", "assignment.jsonld")
    ]
    profile = read(relative_file("examples/profiles/control-profile.json"))
    adapter = read(relative_file("examples/profiles/adapter.json"))
    schema = read(relative_file("third_party/wot/td-schema.json"))
    jsonschema.Draft7Validator.check_schema(schema)
    validator = jsonschema.Draft7Validator(schema)
    for name, td in (("source", source), ("controller", controller)):
        validator.validate(td)
        check("Pinned native TD schema: " + name, True)
        forms = list(native_forms(td))
        check("Unique named native Forms: " + name, len({f["@id"] for f in forms}) == len(forms))
        check("Native TD context retained first: " + name, td["@context"] == [TD_CONTEXT, AV_CONTEXT])
        check("Declared bearer configuration, not authentication evidence: " + name,
              td["security"] == ["bearer"] and td["securityDefinitions"]["bearer"] == {
                  "scheme": "bearer", "in": "header", "name": "Authorization", "format": "jwt", "alg": "ES256"})
        check("No unhosted standard conformance claim: " + name,
              "profile" not in td and all(link["rel"] == "describedby" for link in td["links"]))
    for field in ("security", "securityDefinitions", "title"):
        bad = copy.deepcopy(source)
        del bad[field]
        negative("Native TD required field: " + field, lambda doc=bad: validator.validate(doc), jsonschema.ValidationError)
    bad = copy.deepcopy(source)
    bad["properties"]["snapshot"]["forms"][0]["op"] = "publishmedia"
    negative("No invented native operation token", lambda: validator.validate(bad), jsonschema.ValidationError)
    check("Exactly three controller affordances", set(controller["properties"]) == {"status"}
          and set(controller["actions"]) == {"submitNeed", "release"} and "events" not in controller)
    check("Control Forms have no fictitious media direction",
          all("av:mediaDirection" not in f for f in native_forms(controller)))
    check("Read-only status property", controller["properties"]["status"]["readOnly"] is True)
    check("Raw JPEG payload is not invented JSON binary",
          "type" not in source["properties"]["snapshot"]
          and source["properties"]["snapshot"]["forms"][0]["contentType"] == "image/jpeg")

    graphs = [graph_for(doc) for doc in (source, controller, need, assignment, records)]
    union = graphs[0]
    for graph in graphs[1:]:
        union += graph
    for td in (source, controller):
        for form in native_forms(td):
            form_id = URIRef(form["@id"])
            check("Native Form membership and literal anyURI target",
                  bool(list(union.subjects(TD.hasForm, form_id)))
                  and (form_id, HCTL.hasTarget, Literal(form["href"], datatype=XSD.anyURI)) in union)

    def resolve_form(reference):
        td_pin = pins[reference["av:pin"][0]]
        resolve_bytes(td_pin["@id"])
        data = relative_file(manifest["cache"][td_pin["av:document"]]["path"]).read_bytes()
        return resolve_fixture_form(reference, td_pin, data)

    reference = assignment["av:selections"][0]["av:forms"][0]
    resolve_form(reference)
    check("Source FormReference resolves inside its exact PublisherTD pin", True)
    for operation in profile["operations"]:
        ref = {"av:pin": [profile["controllerPin"]], "av:form": operation["form"],
               "av:operation": operation["operation"], "av:jsonPointer": operation["formPointer"]}
        form = resolve_form(ref)
        affordance = controller[operation["affordanceKind"]][operation["affordanceName"]]
        check("Control mapping selects exact native Form and method",
              form == affordance["forms"][0] and form["htv:methodName"] == operation["method"])
        for field in ("inputPointer", "outputPointer"):
            if field in operation:
                check("Controller schema pointer resolves", isinstance(pointer(controller, operation[field]), dict))
    for label, field, value in (
        ("href is not a Form identity", "av:form", source["properties"]["snapshot"]["forms"][0]["href"]),
        ("wrong native operation", "av:operation", str(TD.invokeAction)),
        ("pointer must agree with named Form", "av:jsonPointer", "/properties/snapshot"),
        ("invalid pointer escape", "av:jsonPointer", "/properties/~2"),
        ("noncanonical array pointer", "av:jsonPointer", "/properties/snapshot/forms/00"),
        ("out-of-bounds array pointer", "av:jsonPointer", "/properties/snapshot/forms/8"),
    ):
        bad_reference = {**reference, field: value}
        negative(label, lambda ref=bad_reference: resolve_form(ref))
    td_pin = copy.deepcopy(pins[U + "pin:source"])
    source_bytes = relative_file("examples/source.td.json").read_bytes()
    td_pin["av:expectedThing"] = U + "other-source"
    negative("Pin expected-Thing identity mismatch", lambda: resolve_fixture_form(reference, td_pin, source_bytes))
    directory_pin = {**pins[U + "pin:source"], "av:documentKind": "av:DirectorySnapshot"}
    negative("Directory snapshot is not publisher provenance",
             lambda: verify_pin(directory_pin, source_bytes, {"av:PublisherTD"}))
    duplicate = copy.deepcopy(source)
    duplicate["properties"]["snapshot"]["forms"].append(copy.deepcopy(duplicate["properties"]["snapshot"]["forms"][0]))
    duplicate_bytes = json_bytes(duplicate)
    duplicate_pin = {**pins[U + "pin:source"], "av:hexDigest": sha(duplicate_bytes)}
    negative("Duplicate native Form IDs are ambiguous",
             lambda: resolve_fixture_form(reference, duplicate_pin, duplicate_bytes))
    for selector, expected in (("/a~1b/~0key/0", 7), ("", {"x": 1})):
        document = {"a/b": {"~key": [7]}} if selector else {"x": 1}
        check("RFC 6901 pointer positive", pointer(document, selector) == expected)

    alt = need["av:input"][0]["av:alternative"][0]
    mode = source["av:offer"][0]["av:mode"][0]
    track = mode["av:track"][0]
    selection = assignment["av:selections"][0]
    requirements = alt["av:wireTracks"] + alt["av:deliveredTracks"]
    check("One complete Still offer/mode/track",
          len(source["av:offer"]) == len(source["av:offer"][0]["av:mode"]) == len(mode["av:track"]) == 1
          and mode["av:kind"] == alt["av:kind"] == "av:Still")
    check("No invented Still cadence or freshness",
          not any(key in node for node in nodes(source) for key in ("av:cadence", "av:frameRate"))
          and not any(key in node for node in nodes(need) for key in ("av:maxAge", "av:maxSkew", "av:frameRate"))
          and all(node.get("av:field") != "av:frameRate" for node in nodes(need)))
    check("Both transformations are explicitly permitted",
          alt["av:transformPermissions"] == ["av:Decode", "av:ColorConvert"]
          and adapter["orderedTransforms"] == [str(AV.Decode), str(AV.ColorConvert)])
    check("Flat canonical Track representation", track["@type"] == "av:Track"
          and track["av:representation"] == "av:EncodedVideo")
    check("Current worked Need pin and generation",
          assignment["av:need"] == [need["@id"]] and assignment["av:generation"] == need["av:generation"] == 1
          and U + "pin:need" in assignment["av:pin"])
    check("Logical identity is an IRI; local identifiers are strings",
          (URIRef(need["@id"]), DC.isVersionOf, URIRef(need["dcterms:isVersionOf"])) in union
          and all(isinstance(obj, Literal) and obj.language is None and obj.datatype in (None, XSD.string)
                  for obj in union.objects(None, DC.identifier)))
    check("Exact mapping roles and boundary names",
          selection["av:requirement"] == [need["av:input"][0]["@id"]]
          and selection["av:alternative"] == [alt["@id"]]
          and selection["av:offer"] == [source["av:offer"][0]["@id"]]
          and selection["av:mode"] == [mode["@id"]]
          and selection["av:selections"][0]["av:track"] == [track["@id"]]
          and set(selection["av:selections"][0]["av:requirement"]) == {r["@id"] for r in requirements}
          and all(r["dcterms:identifier"] == track["dcterms:identifier"] for r in requirements))
    for requirement in requirements:
        fields = {constraint["av:field"]: constraint for constraint in requirement["av:constraints"]}
        for field, expected in (("av:width", 1280), ("av:height", 720)):
            constraint = fields[field]
            check("Exact integer boundary " + field, constraint["@type"] == "av:IntegerConstraint"
                  and type(constraint["av:lowerInteger"]) is int
                  and constraint["av:lowerInteger"] == constraint["av:upperInteger"] == expected)
        check("Nonempty typed choices", all(c["@type"] != "av:ChoiceConstraint"
              or isinstance(c["av:allowedValues"], list) and bool(c["av:allowedValues"]) for c in fields.values()))
    check("BGR delivery is not a tensor contract", adapter["delivered"]["shape"] == [720, 1280, 3]
          and adapter["delivered"]["rowStrideOctets"] == 3840 and adapter["delivered"]["totalOctets"] == 2764800
          and not any(key in need for key in ("av:model", "av:contract", "av:allowedPreprocessing")))
    expectations = read(relative_file("tests/fixtures/expectations.json"))
    evaluation_time = datetime.fromisoformat(expectations["evaluationTime"].replace("Z", "+00:00"))
    check("Grant expired at the fixed fixture evaluation instant",
          datetime.fromisoformat(assignment["av:lease"][0]["av:validUntil"].replace("Z", "+00:00")) < evaluation_time,
          category="expected-admission-rejection")
    check("Assignment is explicitly counterfactual, never an acceptance claim",
          "NEGATIVE ADMISSION FIXTURE" in assignment["dcterms:description"])

    forbidden = {"$ref", "$defs", "definitions", "allOf", "anyOf", "not", "if", "then", "else",
                 "additionalProperties", "patternProperties", "uniqueItems", "dependentRequired"}
    check("Controller uses TD DataSchema operators only", not any(
        key in forbidden for group in ("actions", "properties") for node in nodes(controller[group]) for key in node))
    fixtures = read(relative_file("tests/fixtures/controller.json"))

    def validate_payload(schema, value):
        jsonschema.Draft7Validator(schema).validate(value)

    submit, release = controller["actions"]["submitNeed"], controller["actions"]["release"]
    validate_payload(submit["input"], fixtures["submitRequest"])
    validate_payload(submit["output"], fixtures["submitRejectedReceipt"])
    check("Complete unsent request and negative receipt fit the native payload schemas", True)
    check("Fixed ASCII/integer request fingerprint, not a generic JCS implementation",
          fixtures["submitRejectedReceipt"]["requestDigest"] == sha(json.dumps(
              fixtures["submitRequest"], sort_keys=True, separators=(",", ":")).encode("ascii")))
    check("Receipt issues reference canonical Fault records",
          all((URIRef(value), RDF.type, AV.Fault) in union for value in fixtures["submitRejectedReceipt"]["issues"]))
    negative("Release requires expected current grant references", lambda: validate_payload(
        release["input"], {"clientKey": "missing-grants", "assignmentPin": U + "pin:assignment", "expectedGeneration": 1}),
        jsonschema.ValidationError)
    negative("Drain receipt cannot claim Released cleanup", lambda: validate_payload(
        release["output"], {"receipt": U + "receipt:negative", "requestDigest": "0" * 64,
                            "replayUntil": "2000-01-02T00:00:00Z", "outcome": "Released", "issues": []}),
        jsonschema.ValidationError)
    bad = {**fixtures["submitRejectedReceipt"], "assignmentPins": [U + "pin:assignment"]}
    negative("Rejected receipt cannot carry an Assignment",
             lambda: validate_payload(submit["output"], bad), jsonschema.ValidationError)
    bad = {**fixtures["submitRejectedReceipt"], "outcome": "accepted", "issues": []}
    negative("Accepted-envelope syntax requires an Assignment pin",
             lambda: validate_payload(submit["output"], bad), jsonschema.ValidationError)
    accepted_syntax_only = {**bad, "assignmentPins": [U + "pin:assignment"]}
    validate_payload(submit["output"], accepted_syntax_only)
    check("Counterfactual accepted-envelope SCHEMA ONLY; admission still blocked", True, category="structural-only")
    negative("Status envelope requires its Assignment pin", lambda: validate_payload(
        controller["properties"]["status"], {"statusPin": U + "pin:absent"}), jsonschema.ValidationError)
    unknown_member = {**fixtures["submitRequest"], "unrecognizedHardRequirement": True}
    validate_payload(submit["input"], unknown_member)
    check("Native payload schema cannot enforce the profile's unknown-member rule", True,
          "A deployment needs separate profile validation; this schema is intentionally not rewritten.",
          category="documented-limit")

    jpeg_query = relative_file("examples/query.rq").read_text(encoding="utf-8")
    live_query = relative_file("examples/live.query.rq").read_text(encoding="utf-8")
    source_dataset = dataset_for(source, U + "graph:source")
    rows = list(source_dataset.query(jpeg_query))
    check("JPEG query exact single candidate", len(rows) == 1 and str(rows[0].source) == source["id"]
          and str(rows[0].form) == mode["av:form"] and str(rows[0].mode) == mode["@id"]
          and str(rows[0].target) == source["properties"]["snapshot"]["forms"][0]["href"])
    negative_queries = {}
    negative_queries["live-need-versus-still"] = len(list(source_dataset.query(jpeg_query.replace(
        "VALUES ?wantedKind { av:Still }", "VALUES ?wantedKind { av:Live }"))))
    negative_queries["live-av-versus-still"] = len(list(source_dataset.query(live_query)))
    live = read(relative_file("tests/fixtures/live.td.json"))
    validator.validate(live)
    live_mode = live["av:offer"][0]["av:mode"][0]
    missing_live = {live_mode["av:configuration"]} | {
        node["av:configuration"] for node in live_mode["av:resourceUses"] + live_mode["av:track"]}
    check("Every query-only unresolved pin is explicitly listed",
          missing_live == set(manifest["queryOnlyUnresolvedPins"]))
    live_dataset = dataset_for(live, U + "graph:live-fixture")
    live_rows = list(live_dataset.query(live_query))
    check("Synthetic Live query positive, not streaming qualification", len(live_rows) == 1)
    bad = copy.deepcopy(live)
    bad_mode = bad["av:offer"][0]["av:mode"][0]
    bad_mode["av:kind"] = "av:Clip"
    bad_mode["av:selector"] = {"@type": "av:TimeSelector", "av:clock": U + "timeline:clip",
                             "av:selection": "av:ExactSamples", "av:start": ration(0), "av:end": ration(10)}
    negative_queries["finite-clip-versus-live"] = len(list(dataset_for(bad, U + "graph:clip").query(live_query)))
    bad = copy.deepcopy(live)
    modes = bad["av:offer"][0]["av:mode"]
    other = copy.deepcopy(modes[0])
    other["@id"] += ":other"
    other["av:track"] = [modes[0]["av:track"].pop()]
    modes.append(other)
    negative_queries["audio-in-another-mode"] = len(list(dataset_for(bad, U + "graph:split-mode").query(live_query)))
    split = dataset_for(live, U + "graph:video-only")
    video_graph = split.graph(URIRef(U + "graph:video-only"))
    audio_graph = split.graph(URIRef(U + "graph:audio-only"))
    audio_id = URIRef(live_mode["av:track"][1]["@id"])
    moved = set(video_graph.triples((None, AV.track, audio_id))) | set(video_graph.triples((audio_id, None, None)))
    for triple in moved:
        video_graph.remove(triple)
        audio_graph.add(triple)
    negative_queries["audio-in-another-graph"] = len(list(split.query(live_query)))
    bad = copy.deepcopy(source)
    ghost = bad["properties"].pop("snapshot")["forms"][0]
    bad["av:offer"][0]["av:mode"][0]["av:form"] = ghost
    negative_queries["form-outside-native-membership"] = len(list(dataset_for(bad, U + "graph:ghost").query(jpeg_query)))
    bad = copy.deepcopy(live)
    bad["av:offer"][0]["av:mode"][0]["av:track"][0]["av:frameRate"] = ration(30000, 1001)
    negative_queries["exact-30000-over-1001-is-not-30"] = len(list(dataset_for(bad, U + "graph:rate").query(live_query)))
    check("Every declared negative query case executed", set(negative_queries) == set(expectations["negativeQueryCases"]))
    for name, count in negative_queries.items():
        check("SPARQL rejects " + name, count == 0, {"rows": count}, category="expected-negative")
    expected_dataset = canonical_dataset({
        U + "graph:source": source, U + "graph:controller": controller, U + "graph:live-fixture": live})
    check("Persisted finite dataset has deterministic exact bytes",
          relative_file("examples/dataset.nq").read_bytes() == expected_dataset)
    return {
        "verifiedPins": len(pins) - len(manifest["unresolvedPins"]),
        "unresolvedPins": len(manifest["unresolvedPins"]),
        "queryOnlyUnresolvedPins": len(missing_live), "resolvedFormReferences": 4,
        "queryResults": [{"graph": str(row.graph), "source": str(row.source), "mode": str(row.mode),
                          "form": str(row.form), "track": str(row.track), "target": str(row.target)} for row in rows],
        "liveQueryRows": len(live_rows), "negativeQueryRows": negative_queries,
        "admission": {"decision": "NOT ADMITTED", "qualification": "DependencyUnavailable",
                      "grant": "expired at the fixed fixture evaluation instant",
                      "currentHeads": "not observed", "readyStatus": "not produced"},
    }
