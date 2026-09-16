"""Offline worked-example checks, not an AV matcher or an admission implementation.

--seal explicitly snapshots inputs and regenerates fixture pins. Ordinary runs
verify existing pins without repairing them. No package installation or network.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
from pyld import jsonld
from rdflib import Dataset, Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, XSD

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parent
STEM = "wot-av-example-v0.1"
U = "urn:example:av-example:"
AV = Namespace("https://example.org/wot/av#")
TD = Namespace("https://www.w3.org/2019/wot/td#")
HCTL = Namespace("https://www.w3.org/2019/wot/hypermedia#")
DC = Namespace("http://purl.org/dc/terms/")
TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
AV_CONTEXT = "https://example.org/wot/av/context/v0.1"
SCHEMA_SHA = "87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da"
TD_CONTEXT_SHA = "9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069"
HELPER = BASE / "wot-av-formal-v0.1.verify.py"
SNAPSHOTS = {
    "terms": ("wot-av-formal-v0.1.terms.json", ".terms.snapshot.json"),
    "av-context": ("wot-av-formal-v0.1.context.jsonld", ".context.snapshot.jsonld"),
    "td-context": ("wot-av-formal-v0.1.native-td-context.jsonld", ".td-context.snapshot.jsonld"),
    "td-schema": ("wot-av-formal-v0.1.native-td-schema.json", ".td-schema.snapshot.json"),
    "live-fixture": ("wot-av-formal-v0.1.camera.td.json", ".live-fixture.snapshot.td.json"),
}
REPORT = {"scope": "Offline syntax, reference and query fixtures only; never admission.", "checks": []}


def path(suffix):
    return BASE / (STEM + suffix)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(file):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON member: " + key)
            result[key] = value
        return result

    def nonfinite(value):
        raise ValueError("Non-JSON numeric constant: " + value)

    return json.loads(file.read_bytes(), object_pairs_hook=pairs, parse_constant=nonfinite)


def write_json(suffix, value):
    path(suffix).write_bytes((json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False) + "\n").encode())


def check(name, condition, detail=None):
    if not condition:
        raise AssertionError(name + ": " + str(detail))
    REPORT["checks"].append({"name": name, "result": "passed", "detail": detail})


def negative(name, action, exception=ValueError):
    try:
        action()
    except exception as error:
        check(name, True, {"negativeFixture": True, "rejectedBecause": str(error)[:240]})
    else:
        raise AssertionError("Negative fixture was not rejected: " + name)


def metadata(file):
    data = file.read_bytes()
    return {"path": str(file), "bytes": len(data), "lines": len(data.splitlines()), "sha256": sha(data)}


def seal():
    old = read(path(".manifest.json")) if path(".manifest.json").exists() else None
    originals = old["originals"] if old else {}
    inputs = [item[0] for item in SNAPSHOTS.values()] + [
        "wot-vocab-td-examples.md", "wot-vocab-discovery.md", HELPER.name]
    for name in inputs:
        originals.setdefault(name, metadata(BASE / name))
    for original, suffix in SNAPSHOTS.values():
        target, data = path(suffix), (BASE / original).read_bytes()
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError("Original changed since snapshot; do not silently repin: " + original)
        else:
            target.write_bytes(data)
    if sha(path(SNAPSHOTS["td-schema"][1]).read_bytes()) != SCHEMA_SHA:
        raise ValueError("Pinned official TD schema does not match the known revision")
    if sha(path(SNAPSHOTS["td-context"][1]).read_bytes()) != TD_CONTEXT_SHA:
        raise ValueError("Pinned official TD context changed")

    pins, cache = [], {}

    def pin(name, suffix, kind, media_type, dependencies=(), document=None, thing=None):
        file = path(suffix)
        uri = document or U + "document:" + name
        record = {"@id": U + "pin:" + name, "@type": "av:DocumentPin",
                  "av:document": uri, "av:documentKind": "av:" + kind,
                  "av:hexDigest": sha(file.read_bytes()), "dcterms:format": media_type}
        if dependencies:
            record["av:pin"] = [U + "pin:" + dep for dep in dependencies]
        if thing:
            record["av:expectedThing"] = U + thing
        pins.append(record)
        cache[uri] = metadata(file)

    pin("terms", SNAPSHOTS["terms"][1], "ProfileDocument", "application/json")
    pin("av-context", SNAPSHOTS["av-context"][1], "ContextDocument", "application/ld+json", ["terms"], AV_CONTEXT)
    pin("td-context", SNAPSHOTS["td-context"][1], "ContextDocument", "application/ld+json", document=TD_CONTEXT)
    pin("td-schema", SNAPSHOTS["td-schema"][1], "ShapeDocument", "application/schema+json",
        document="https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json")
    for name, deps in [("http-profile", ["terms"]), ("resource", ["terms"]),
                       ("codec", ["terms"]), ("acquisition", ["terms", "resource"]),
                       ("adapter", ["terms", "codec", "source", "need", "qualification-missing"]),
                       ("control-profile", ["terms", "controller"])]:
        pin(name, "." + name + ".json", "ProfileDocument", "application/json", deps)
    pin("source", ".source.td.json", "PublisherTD", "application/td+json",
        ["av-context", "td-context", "td-schema", "http-profile", "acquisition", "resource", "codec"], thing="source")
    pin("controller", ".controller.td.json", "PublisherTD", "application/td+json",
        ["av-context", "td-context", "td-schema", "control-profile"], thing="controller")
    pin("need", ".need.jsonld", "DomainDocument", "application/ld+json", ["av-context", "terms"])
    pin("assignment", ".assignment.jsonld", "DomainDocument", "application/ld+json",
        ["av-context", "need", "source", "controller", "adapter", "control-profile"])
    pins.append({"@id": U + "pin:qualification-missing", "@type": "av:DocumentPin",
                 "av:document": U + "unresolved:adapter-qualification",
                 "av:documentKind": "av:ProfileDocument", "av:hexDigest": "0" * 64,
                 "dcterms:format": "application/json",
                 "dcterms:description": "UNRESOLVED NEGATIVE FIXTURE: zero digest is a visible sentinel, NOT a known checksum. No qualification bytes, schema, authenticated implementation or validity evidence exist in this example."})
    fault = {"@id": U + "fault:qualification", "@type": "av:Fault",
             "av:code": "av:UnknownRequiredFact",
             "dcterms:description": "Synthetic negative receipt: adapter qualification and current external authority have not been established."}
    write_json(".pins.jsonld", {"@context": AV_CONTEXT, "@graph": pins + [fault]})
    submit = {"clientKey": "still-1-submit", "expectedGeneration": 0, "needPin": U + "pin:need"}
    # This fixed ASCII/string/integer specimen has JCS-equivalent encoding.
    # This is intentionally not a general RFC 8785 implementation.
    fingerprint = sha(json.dumps(submit, sort_keys=True, separators=(",", ":")).encode("ascii"))
    write_json(".fixtures.json", {
        "label": "SYNTHETIC NEGATIVE ADMISSION / SCHEMA FIXTURES; no HTTP requests or receipts occurred.",
        "assumedPriorGeneration": 0,
        "submitRequest": submit,
        "submitRejectedReceipt": {
            "receipt": U + "receipt:rejected-fixture", "requestDigest": fingerprint,
            "replayUntil": "2000-01-02T00:00:00Z", "outcome": "rejected",
            "assignmentPins": [], "issues": [U + "fault:qualification"]},
        "liveCatalogFixture": "Copied formal synthetic Live TD; query-positive only, not qualified streaming.",
        "negativeQueryFixtures": ["Live Need versus this Still", "Live versus finite Clip",
                                  "audio only in another Mode", "audio only in another pinned graph",
                                  "same-shape graph node is not a native Form", "30000/1001 is not 30/1"],
        "unresolvedPins": [U + "pin:qualification-missing"]})
    query_live = read(path(SNAPSHOTS["live-fixture"][1]))
    query_mode = query_live["av:offer"][0]["av:mode"][0]
    query_only_missing = [query_mode["av:configuration"]] + [
        use["av:configuration"] for use in query_mode["av:resourceUses"]] + [
        track["av:configuration"] for track in query_mode["av:track"]]
    manifest = {
        "fixtureOnly": True, "originals": originals, "cache": cache,
        "unresolvedPins": {U + "pin:qualification-missing": "No bytes; zero digest is an explicitly non-resolvable sentinel."},
        "graphToPin": {U + "graph:source": U + "pin:source", U + "graph:controller": U + "pin:controller"},
        "queryOnlyGraphs": {U + "graph:live-fixture": metadata(path(SNAPSHOTS["live-fixture"][1]))},
        "queryOnlyUnresolvedPins": {identifier: "UNRESOLVED in copied synthetic Live query fixture; no bytes or qualification imported."
                                    for identifier in query_only_missing},
        "queryOnlyUnresolvedIdentities": {
            query_live["av:connector"]: "No Connector description imported; query fixture is not admissible.",
            query_live["properties"]["media"]["forms"][0]["av:binding"]: "Unqualified synthetic binding, not a hosted standard."},
        "schemaRevision": "w3c/wot-thing-description@87808f1644ba79eb0a58d238385a8bd4a2236853",
        "profileDependencyCycles": "Controller and its Control mapping refer to one another by stable pin IDs. Closure traversal is cycle-safe; no document contains its own digest.",
        "extraFiles": [metadata(path(".pins.jsonld")), metadata(path(".fixtures.json")),
                       metadata(path(".query.rq")), metadata(path(".live.query.rq")), metadata(Path(__file__))]}
    write_json(".manifest.json", manifest)


def main():
    manifest = read(path(".manifest.json"))
    REPORT["manifestSha256"] = sha(path(".manifest.json").read_bytes())
    check("Existing original helper is unchanged", sha(HELPER.read_bytes()) == manifest["originals"][HELPER.name]["sha256"])
    spec = importlib.util.spec_from_file_location("existing_formal_helpers", HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    terms = read(path(SNAPSHOTS["terms"][1]))
    helper.TERMS = terms
    helper.CONTEXT = read(path(SNAPSHOTS["av-context"][1]))
    helper.NATIVE_CONTEXT = read(path(SNAPSHOTS["td-context"][1]))
    helper.TD_SCHEMA = read(path(SNAPSHOTS["td-schema"][1]))
    check("Final inventory baseline", (len(terms["classes"]), len(terms["properties"])) == (38, 105))
    check("Pinned official TD schema", sha(path(SNAPSHOTS["td-schema"][1]).read_bytes()) == SCHEMA_SHA)
    check("Pinned native TD context", sha(path(SNAPSHOTS["td-context"][1]).read_bytes()) == TD_CONTEXT_SHA)
    for item in list(manifest["cache"].values()) + manifest["extraFiles"] + list(manifest["queryOnlyGraphs"].values()):
        check("Exact bytes: " + Path(item["path"]).name, sha(Path(item["path"]).read_bytes()) == item["sha256"])
    records = read(path(".pins.jsonld"))
    pins = {n["@id"]: n for n in records["@graph"] if n["@type"] == "av:DocumentPin"}
    check("Unique pin IDs", len(pins) == len(records["@graph"]) - 1)

    def resolve_bytes(identifier, seen=None):
        seen = set() if seen is None else seen
        if identifier in seen:
            return
        seen.add(identifier)
        pin = pins[identifier]
        if identifier in manifest["unresolvedPins"]:
            raise ValueError("DependencyUnavailable: explicitly unresolved pin " + identifier)
        entry = manifest["cache"][pin["av:document"]]
        content = Path(entry["path"]).read_bytes()
        if sha(content) != pin["av:hexDigest"]:
            raise ValueError("IntegrityMismatch: exact pin bytes differ")
        for dependency in pin.get("av:pin", []):
            resolve_bytes(dependency, seen)

    for identifier, pin in pins.items():
        check("Known dependency IDs: " + identifier, set(pin.get("av:pin", [])) <= pins.keys())
        if identifier not in manifest["unresolvedPins"]:
            check("Verified pin octets: " + identifier,
                  sha(Path(manifest["cache"][pin["av:document"]]["path"]).read_bytes()) == pin["av:hexDigest"])
    resolve_bytes(U + "pin:source")
    resolve_bytes(U + "pin:controller")
    negative("Changing representation whitespace invalidates its pin",
             lambda: helper.verify_pin(pins[U + "pin:need"], path(".need.jsonld").read_bytes().decode() + "\n"))
    negative("Adapter qualification closure cannot be bypassed", lambda: resolve_bytes(U + "pin:adapter"))
    negative("Assignment closure cannot be admitted", lambda: resolve_bytes(U + "pin:assignment"))

    source, controller, need, assignment = [read(path(s)) for s in [
        ".source.td.json", ".controller.td.json", ".need.jsonld", ".assignment.jsonld"]]
    profile, adapter = read(path(".control-profile.json")), read(path(".adapter.json"))
    schema = jsonschema.Draft7Validator(helper.TD_SCHEMA, format_checker=jsonschema.FormatChecker())
    jsonschema.Draft7Validator.check_schema(helper.TD_SCHEMA)
    for label, td in [("source", source), ("controller", controller)]:
        schema.validate(td)
        check("Pinned TD 1.1 schema: " + label, True)
        forms = list(helper.native_forms(td))
        check("Unique named native Forms: " + label, len({f["@id"] for f in forms}) == len(forms))
        check("TD context retained: " + label, td["@context"] == [TD_CONTEXT, AV_CONTEXT])
        check("Bearer security inherited: " + label, td["security"] == ["bearer"] and
              td["securityDefinitions"]["bearer"] == {"scheme": "bearer", "in": "header", "name": "Authorization", "format": "jwt", "alg": "ES256"})
        check("No unhosted standard conformance claim: " + label, "profile" not in td and
              all(link["rel"] == "describedby" for link in td["links"]))
    check("Exactly three controller affordances", set(controller["properties"]) == {"status"} and
          set(controller["actions"]) == {"submitNeed", "release"} and "events" not in controller)
    check("Control Forms do not pretend to carry media", all("av:mediaDirection" not in f for f in helper.native_forms(controller)))
    check("Read-only state access", controller["properties"]["status"]["readOnly"] is True)
    check("Raw JPEG payload, no invented JSON binary type", "type" not in source["properties"]["snapshot"] and
          source["properties"]["snapshot"]["forms"][0]["contentType"] == "image/jpeg")

    all_docs = [source, controller, need, assignment, records]
    allowed = set(terms["classes"]) | set(terms["properties"])
    for values in terms["enums"].values():
        if isinstance(values, dict):
            allowed.update(values)
    for doc in all_docs:
        helper.validate_av_keys(doc)
        for node in helper.nodes(doc):
            types = node.get("@type", [])
            for name in [types] if isinstance(types, str) else types:
                if name.startswith("av:"):
                    check("Known canonical class " + name, name[3:] in terms["classes"])
            for value in node.values():
                for item in value if isinstance(value, list) else [value]:
                    if isinstance(item, str) and re.fullmatch(r"av:[A-Za-z0-9]+", item):
                        check("Known canonical term " + item, item[3:] in allowed)
    negative("Old plural AV key is not accepted",
             lambda: helper.validate_av_keys({"av:offers": []}))
    negative("Unpinned context is refused",
             lambda: helper.expand({"@context": "https://invalid.example/context", "x": 1}),
             jsonld.JsonLdError)

    graphs, union = [], Graph()
    for doc in all_docs:
        expanded = helper.expand(doc)
        graph = Graph().parse(data=jsonld.to_rdf(expanded, options={"format": "application/n-quads"}), format="nquads")
        graphs.append(graph)
        union += graph
    raw_keys = {AV[k[3:]] for d in all_docs for n in helper.nodes(d) for k in n if k.startswith("av:")}
    check("Every authored AV key survived expansion", raw_keys <= {p for _, p, _ in union})
    for subject, pred, obj in union:
        term = terms["properties"].get(str(pred)[len(str(AV)):]) if str(pred).startswith(str(AV)) else None
        if term and term["value"] == "node":
            check("Node-valued AV term is not a literal", not isinstance(obj, Literal), str(pred))
    for name, cls in terms["classes"].items():
        for subject in union.subjects(RDF.type, AV[name]):
            for key, definition in terms["properties"].items():
                rule = definition["uses"].get("av:" + name)
                if rule and definition.get("container") != "list":
                    count = len(set(union.objects(subject, AV[key])))
                    check("Class cardinality " + name + "." + key,
                          count >= rule["min"] and (rule["max"] is None or count <= rule["max"]), count)
    for td, graph in zip([source, controller], graphs[:2]):
        for form in helper.native_forms(td):
            form_id = URIRef(form["@id"])
            check("Native Form membership and anyURI target", bool(list(graph.subjects(TD.hasForm, form_id))) and
                  (form_id, HCTL.hasTarget, Literal(form["href"], datatype=XSD.anyURI)) in graph)

    def resolve_form(reference):
        td_pin = pins[reference["av:pin"][0]]
        resolve_bytes(td_pin["@id"])
        content = Path(manifest["cache"][td_pin["av:document"]]["path"]).read_bytes().decode()
        return helper.resolve_fixture_form(reference, td_pin, content)

    reference = assignment["av:selections"][0]["av:forms"][0]
    resolve_form(reference)
    check("Source FormReference resolves inside current source pin", True)
    for operation in profile["operations"]:
        ref = {"@type": "av:FormReference", "av:pin": [profile["controllerPin"]],
               "av:form": operation["form"], "av:operation": operation["operation"],
               "av:jsonPointer": operation["formPointer"]}
        form = resolve_form(ref)
        aff = controller[operation["affordanceKind"]][operation["affordanceName"]]
        check("Control mapping matches exact affordance/Form", form == aff["forms"][0] and
              form["htv:methodName"] == operation["method"], operation["affordanceName"])
        for field in ("inputPointer", "outputPointer"):
            if field in operation:
                check("Control schema pointer resolves", isinstance(helper.pointer(controller, operation[field]), dict))
    for label, field, value in [
        ("href is not a Form identity", "av:form", source["properties"]["snapshot"]["forms"][0]["href"]),
        ("wrong native operation", "av:operation", str(TD.invokeAction)),
        ("pointer disagrees with named Form", "av:jsonPointer", "/properties/snapshot")]:
        bad = copy.deepcopy(reference)
        bad[field] = value
        negative(label, lambda b=bad: resolve_form(b))

    alt = need["av:input"][0]["av:alternative"][0]
    mode = source["av:offer"][0]["av:mode"][0]
    track = mode["av:track"][0]
    selection = assignment["av:selections"][0]
    requirements = alt["av:wireTracks"] + alt["av:deliveredTracks"]
    check("One complete Still offer/mode/track", len(source["av:offer"]) == len(source["av:offer"][0]["av:mode"]) == len(mode["av:track"]) == 1 and mode["av:kind"] == alt["av:kind"] == "av:Still")
    check("No unsupported Still cadence, freshness or FPS promise",
          not any(k in n for n in helper.nodes(source) for k in ("av:cadence", "av:frameRate")) and
          not any(k in n for n in helper.nodes(need) for k in ("av:maxAge", "av:maxSkew", "av:frameRate")) and
          all(n.get("av:field") != "av:frameRate" for n in helper.nodes(need)))
    check("Both transforms explicitly permitted", alt["av:transformPermissions"] == ["av:Decode", "av:ColorConvert"] and
          adapter["orderedTransforms"] == [str(AV.Decode), str(AV.ColorConvert)])
    check("Flat Track representation, not a Representation node", track["@type"] == "av:Track" and track["av:representation"] == "av:EncodedVideo")
    check("Current worked Need revision pin and generation", assignment["av:need"] == [need["@id"]] and
          assignment["av:generation"] == need["av:generation"] == 1 and U + "pin:need" in assignment["av:pin"])
    check("DCMI logical identity and identifiers retain their value kinds",
          (URIRef(need["@id"]), DC.isVersionOf, URIRef(need["dcterms:isVersionOf"])) in union and
          all(isinstance(o, Literal) and o.language is None and o.datatype in (None, XSD.string)
              for o in union.objects(None, DC.identifier)))
    check("Mapping roles and boundary names agree",
          selection["av:requirement"] == [need["av:input"][0]["@id"]] and selection["av:alternative"] == [alt["@id"]] and
          selection["av:offer"] == [source["av:offer"][0]["@id"]] and selection["av:mode"] == [mode["@id"]] and
          selection["av:selections"][0]["av:track"] == [track["@id"]] and
          set(selection["av:selections"][0]["av:requirement"]) == {r["@id"] for r in requirements} and
          all(r["dcterms:identifier"] == track["dcterms:identifier"] for r in requirements))
    for req in requirements:
        fields = {c["av:field"]: c for c in req["av:constraints"]}
        for field, expected in [("av:width", 1280), ("av:height", 720)]:
            c = fields[field]
            check("Typed exact integer bound " + field,
                  c["@type"] == "av:IntegerConstraint" and type(c["av:lowerInteger"]) is int and
                  c["av:lowerInteger"] == c["av:upperInteger"] == expected)
        check("Nonempty typed choices", all(c["@type"] != "av:ChoiceConstraint" or
              (isinstance(c["av:allowedValues"], list) and len(c["av:allowedValues"]) > 0) for c in fields.values()))
    check("BGR output boundary is not a tensor contract", adapter["delivered"]["shape"] == [720, 1280, 3] and
          adapter["delivered"]["rowStrideOctets"] == 3840 and adapter["delivered"]["totalOctets"] == 2764800 and
          not any(k in need for k in ("av:model", "av:contract", "av:allowedPreprocessing")))
    check("Illustrative grant cannot be current", datetime.fromisoformat(assignment["av:lease"][0]["av:validUntil"].replace("Z", "+00:00")) < datetime.now(timezone.utc))

    forbidden = {"$ref", "$defs", "definitions", "allOf", "anyOf", "not", "if", "then", "else", "additionalProperties", "patternProperties", "uniqueItems", "dependentRequired"}
    check("Only TD DataSchema operators, no general-JSON-Schema shortcuts",
          not any(k in forbidden for group in ("actions", "properties") for n in helper.nodes(controller[group]) for k in n))
    fixtures = read(path(".fixtures.json"))
    validate = lambda sch, obj: jsonschema.Draft7Validator(sch, format_checker=jsonschema.FormatChecker()).validate(obj)
    submit = controller["actions"]["submitNeed"]
    validate(submit["input"], fixtures["submitRequest"])
    validate(submit["output"], fixtures["submitRejectedReceipt"])
    check("Complete request and explicitly negative receipt fit TD schemas", True)
    check("Receipt issues resolve to canonical Fault records",
          all((URIRef(iri), RDF.type, AV.Fault) in union for iri in fixtures["submitRejectedReceipt"]["issues"]))
    release = controller["actions"]["release"]
    negative("Release requires expected current grant references",
             lambda: validate(release["input"], {"clientKey": "negative-no-grants", "assignmentPin": U + "pin:assignment", "expectedGeneration": 1}),
             jsonschema.ValidationError)
    negative("A drain receipt cannot claim Released cleanup",
             lambda: validate(release["output"], {"receipt": U + "receipt:negative-released", "requestDigest": "0" * 64,
                                                   "replayUntil": "2000-01-02T00:00:00Z", "outcome": "Released", "issues": []}),
             jsonschema.ValidationError)
    bad = copy.deepcopy(fixtures["submitRejectedReceipt"])
    bad["assignmentPins"] = [U + "pin:assignment"]
    negative("Negative receipt cannot carry an Assignment", lambda: validate(submit["output"], bad), jsonschema.ValidationError)
    bad = copy.deepcopy(fixtures["submitRejectedReceipt"])
    bad["outcome"] = "accepted"
    bad["issues"] = []
    negative("Accepted receipt requires an Assignment pin", lambda: validate(submit["output"], bad), jsonschema.ValidationError)
    negative("Status reference requires its Assignment pin", lambda: validate(controller["properties"]["status"], {"statusPin": U + "pin:absent-status"}), jsonschema.ValidationError)

    def dataset(document, graph_id):
        result = Dataset()
        expanded = helper.expand(document)
        result.graph(URIRef(graph_id)).parse(data=jsonld.to_rdf(expanded, options={"format": "application/n-quads"}), format="nquads")
        return result

    jpeg_query = path(".query.rq").read_text()
    live_query = path(".live.query.rq").read_text()
    source_ds = dataset(source, U + "graph:source")
    rows = list(source_ds.query(jpeg_query))
    check("JPEG query returns the selected source exactly once", len(rows) == 1 and
          str(rows[0].source) == source["id"] and str(rows[0].form) == mode["av:form"])
    check("NEGATIVE: Live Need cannot match the refreshed Still", len(list(source_ds.query(jpeg_query.replace("VALUES ?wantedKind { av:Still }", "VALUES ?wantedKind { av:Live }")))) == 0)
    check("NEGATIVE: Live A/V query does not relabel this Still", len(list(source_ds.query(live_query))) == 0)
    live = read(path(SNAPSHOTS["live-fixture"][1]))
    live_mode = live["av:offer"][0]["av:mode"][0]
    missing_live = {live_mode["av:configuration"]} | {
        n["av:configuration"] for n in live_mode["av:resourceUses"] + live_mode["av:track"]}
    check("Every query-only unresolved configuration pin is explicitly labeled",
          missing_live == set(manifest["queryOnlyUnresolvedPins"]))
    live_ds = dataset(live, U + "graph:live-fixture")
    check("Synthetic Live catalogue positive, not streaming proof", len(list(live_ds.query(live_query))) == 1)
    bad = copy.deepcopy(live)
    bad_mode = bad["av:offer"][0]["av:mode"][0]
    bad_mode["av:kind"] = "av:Clip"
    bad_mode["av:selector"] = {"@type": "av:TimeSelector", "av:clock": U + "timeline:clip-negative",
                              "av:selection": "av:ExactSamples",
                              "av:start": helper.ration(0), "av:end": helper.ration(10)}
    check("NEGATIVE: finite Clip cannot satisfy Live", len(list(dataset(bad, U + "graph:clip-negative").query(live_query))) == 0)
    bad = copy.deepcopy(live)
    modes = bad["av:offer"][0]["av:mode"]
    other = copy.deepcopy(modes[0])
    other["@id"] += ":other"
    other["av:track"] = [modes[0]["av:track"].pop()]
    modes.append(other)
    check("NEGATIVE: audio in another Mode is not a joint tuple", len(list(dataset(bad, U + "graph:split-mode").query(live_query))) == 0)
    split = dataset(live, U + "graph:video-only")
    video_graph = split.graph(URIRef(U + "graph:video-only"))
    audio_graph = split.graph(URIRef(U + "graph:audio-only"))
    audio_id = URIRef(live["av:offer"][0]["av:mode"][0]["av:track"][1]["@id"])
    moved = set(video_graph.triples((None, AV.track, audio_id))) | set(video_graph.triples((audio_id, None, None)))
    for triple in moved:
        video_graph.remove(triple)
        audio_graph.add(triple)
    check("NEGATIVE: audio across pinned graphs is not a joint tuple", len(list(split.query(live_query))) == 0)
    bad = copy.deepcopy(source)
    ghost = bad["properties"].pop("snapshot")["forms"][0]
    bad["av:offer"][0]["av:mode"][0]["av:form"] = ghost
    check("NEGATIVE: named lookalike outside native Forms is not selectable", len(list(dataset(bad, U + "graph:ghost-form").query(jpeg_query))) == 0)
    bad = copy.deepcopy(live)
    bad["av:offer"][0]["av:mode"][0]["av:track"][0]["av:frameRate"] = helper.ration(30000, 1001)
    check("NEGATIVE: exact 30000/1001 is not 30/1", len(list(dataset(bad, U + "graph:rate-negative").query(live_query))) == 0)
    combined = source_ds
    controller_ds = dataset(controller, U + "graph:controller")
    for s, p, o, g in controller_ds.quads((None, None, None, None)):
        combined.graph(g).add((s, p, o))
    for s, p, o, g in live_ds.quads((None, None, None, None)):
        combined.graph(g).add((s, p, o))
    named_graphs = {str(g.identifier) for g in combined.graphs() if len(g)}
    check("Every persisted graph has a pin or explicit query-fixture snapshot",
          named_graphs == set(manifest["graphToPin"]) | set(manifest["queryOnlyGraphs"]))
    path(".dataset.nq").write_bytes(combined.serialize(format="nquads").encode())
    REPORT["queryResults"] = [{"graph": str(r.graph), "source": str(r.source), "mode": str(r.mode),
                               "form": str(r.form), "track": str(r.track), "target": str(r.target)} for r in rows]
    REPORT["coverage"] = {"classes": len({o for _, _, o in union.triples((None, RDF.type, None)) if str(o).startswith(str(AV))}),
                          "avProperties": len(raw_keys), "nativeForms": 4, "resolvedFormReferences": 4,
                          "unionTriples": len(union), "verifiedPins": len(pins) - 1, "unresolvedPins": 1,
                          "separateLiveQueryFixtureUnresolvedPins": len(missing_live)}
    REPORT["admission"] = {"decision": "not admitted", "adapterClosure": "DependencyUnavailable",
                           "grant": "expired synthetic fixture", "externalHead": "not observed",
                           "readyStatus": "not produced"}
    REPORT["limits"] = ["No full AV JSON/SHACL validation or matcher executed.",
                        "Synthetic profile documents are typed boundary descriptions, not complete executable profile schemas or qualifications.",
                        "No HTTP media/controller calls, decoding, JWT verification, external grants, current-head lookup or hardware interaction.",
                        "JCS fingerprint calculation covers only the fixed ASCII/string/integer request fixture; no generic JCS library is installed."]
    REPORT["originalsUnchanged"] = {name: sha((BASE / name).read_bytes()) == item["sha256"] for name, item in manifest["originals"].items()}
    check("All read originals unchanged", all(REPORT["originalsUnchanged"].values()))
    REPORT["libraries"] = {name: importlib.metadata.version(name) for name in ["jsonschema", "PyLD", "rdflib"]}
    if path(".md").exists():
        words = len(path(".md").read_text().split())
        check("Explanation at most 2200 words", words <= 2200, words)
        REPORT["explanationWords"] = words
    REPORT["artifacts"] = [metadata(f) for f in sorted(BASE.glob(STEM + "*")) if f.is_file() and f != path(".checks.json")]
    REPORT["result"] = "passed"
    write_json(".checks.json", REPORT)
    print(json.dumps({"passed": len(REPORT["checks"]), "coverage": REPORT["coverage"],
                      "admission": REPORT["admission"], "report": str(path(".checks.json"))}, indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--seal"]:
        seal()
        print("Sealed synthetic fixture pins; qualification remains explicitly unresolved.")
    elif not sys.argv[1:]:
        try:
            main()
        except (AssertionError, ValueError, jsonschema.ValidationError, jsonld.JsonLdError) as error:
            REPORT["result"] = "failed"
            REPORT["error"] = str(error)
            write_json(".checks.json", REPORT)
            raise
    else:
        raise SystemExit("Usage: python <this-file> [--seal]")
