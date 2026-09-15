"""Create synthetic publication specimens and run offline formal-consistency probes.

This is not a matcher, media adapter, SHACL engine, or conformance implementation.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import math
from collections import Counter
from datetime import datetime
from fractions import Fraction
from pathlib import Path

import jsonschema
from pyld import jsonld
from rdflib import BNode, Dataset, Graph, Literal, Namespace, URIRef
from rdflib.namespace import OWL, RDF, RDFS, SH, XSD

PREFIX = Path(str(Path(__file__))[: -len(".verify.py")])
AV = Namespace("https://example.org/wot/av#")
TD = Namespace("https://www.w3.org/2019/wot/td#")
HCTL = Namespace("https://www.w3.org/2019/wot/hypermedia#")
TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
AV_CONTEXT = "https://example.org/wot/av/context/v0.1"
SAFE_INTEGER = 9007199254740991
REPORT = {"checks": [], "failures": []}
DOCUMENTS: dict[str, str] = {}
PINS: list[dict] = []


def path(suffix: str) -> Path:
    return PREFIX.with_name(PREFIX.name + suffix)


def text(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False) + "\n"


def write(suffix: str, value: object) -> None:
    path(suffix).write_text(text(value), encoding="utf-8")


def strict_json(source: str) -> object:
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON member: " + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("Non-JSON numeric constant: " + value)

    return json.loads(source, object_pairs_hook=pairs, parse_constant=invalid_constant)


def load(suffix: str) -> dict:
    return strict_json(path(suffix).read_text(encoding="utf-8"))


TERMS = load(".terms.json")
CONTEXT = load(".context.jsonld")
NATIVE_CONTEXT = load(".native-td-context.jsonld")
TD_SCHEMA = load(".native-td-schema.json")


def check(name: str, condition: bool, detail: object = None) -> None:
    if not condition:
        REPORT["failures"].append({"name": name, "detail": detail})
        raise AssertionError(name + ": " + str(detail))
    REPORT["checks"].append({"name": name, "result": "passed", "detail": detail})


def rejects(name: str, action, exception_type=ValueError) -> None:
    try:
        action()
    except exception_type as error:
        check(name, True, str(error)[:240])
    else:
        check(name, False, "Expected an explicit rejection")


def digest(source: str | bytes) -> str:
    return hashlib.sha256(source.encode("utf-8") if isinstance(source, str) else source).hexdigest()


def ration(numerator: int, denominator: int = 1) -> dict:
    number = Fraction(numerator, denominator)
    return {"@type": "av:Rational", "av:numerator": number.numerator, "av:denominator": number.denominator}


def ratio(value: dict) -> Fraction:
    n, d = value["av:numerator"], value["av:denominator"]
    if isinstance(n, bool) or isinstance(d, bool) or not isinstance(n, int) or not isinstance(d, int):
        raise ValueError("Rational requires native exact integer components")
    if abs(n) > SAFE_INTEGER or not 1 <= d <= SAFE_INTEGER:
        raise ValueError("Rational denominator/range is invalid; use typed lexical integers for larger exact values")
    if math.gcd(n, d) != 1:
        raise ValueError("Rational is not reduced")
    return Fraction(n, d)


def pin(name: str, url: str, content: object | str, kind: str, media_type="application/json",
        dependencies=(), profile: str | None = None, expected_thing: str | None = None) -> str:
    rendered = content if isinstance(content, str) else text(content)
    if url in DOCUMENTS and DOCUMENTS[url] != rendered:
        raise ValueError("Conflicting fixture retrieval identity: " + url)
    DOCUMENTS[url] = rendered
    identifier = "urn:example:pin:" + name
    record = {
        "@id": identifier, "@type": "av:DocumentPin", "av:document": url,
        "av:documentKind": "av:" + kind, "av:hexDigest": digest(rendered),
        "dcterms:format": media_type,
    }
    if dependencies:
        record["av:pin"] = list(dependencies)
    if profile:
        record["dcterms:conformsTo"] = [profile]
    if expected_thing:
        record["av:expectedThing"] = expected_thing
    PINS.append(record)
    return identifier


def choice(field: str, values: list[str]) -> dict:
    return {"@type": "av:ChoiceConstraint", "av:field": "av:" + field, "av:allowedValues": values}


def exact_integer(field: str, value: int) -> dict:
    return {"@type": "av:IntegerConstraint", "av:field": "av:" + field,
            "av:lowerInteger": value, "av:upperInteger": value}


def exact_rate(numerator: int, denominator=1) -> dict:
    return {"@type": "av:RationalConstraint", "av:field": "av:frameRate",
            "av:lowerRational": ration(numerator, denominator),
            "av:upperRational": ration(numerator, denominator)}


def track_requirement(identifier: str, name: str, representation: str, presence: str, constraints: list) -> dict:
    return {"@id": identifier, "@type": "av:TrackRequirement", "dcterms:identifier": name,
            "av:representation": "av:" + representation, "av:presence": "av:" + presence,
            "av:constraints": constraints}


def make_specimens() -> tuple[dict, dict, dict]:
    pin_native = pin("native-context", TD_CONTEXT, path(".native-td-context.jsonld").read_text(encoding="utf-8"), "ContextDocument", "application/ld+json")
    pin_av = pin("av-context", AV_CONTEXT, path(".context.jsonld").read_text(encoding="utf-8"), "ContextDocument", "application/ld+json")
    pin_ontology = pin("av-ontology", "https://example.org/wot/av/vocabulary/v0.1.ttl", path(".ttl").read_text(encoding="utf-8"), "OntologyDocument", "text/turtle")
    pin_shapes = pin("av-shapes", "https://example.org/wot/av/shapes/v0.1.ttl", path(".shacl.ttl").read_text(encoding="utf-8"), "ShapeDocument", "text/turtle")
    definition_pins = {}
    for key, profile in TERMS["profiles"].items():
        body = {"release": "0.1-proposed", "profile": profile["iri"],
                "status": "Unhosted proposed profile contract; no implementation is implied.",
                "requiredMeaning": profile["required_meaning"]}
        if "controlled_values" in profile:
            body["controlledValues"] = {
                profile["iri"] + "#" + name: meaning
                for name, meaning in profile["controlled_values"].items()
            }
        definition_pins[key] = pin("profile-" + key, profile["iri"], body, "ProfileDocument",
                                   dependencies=[pin_av, pin_ontology])
    binding_url = "https://example.org/bindings/http-matroska/v0.1"
    binding = pin("binding", binding_url, {
        "status": "Synthetic fixture, not a published or qualified camera binding.",
        "nativeOperation": str(TD.readProperty), "method": "GET",
        "nativeFormRepresentation": "video/x-matroska",
        "mediaDirection": "av:FromThing",
        "mediaLeg": "The response body carries the declared multiplexed H264 and AAC tracks.",
        "requiredQualification": "Framing, clock extraction, security, buffering, abort/reconnect and errors must be qualified before admission."
    }, "ProfileDocument", dependencies=[pin_native, pin_av])
    resource = pin("resource-config", "https://example.org/configuration/camera7/720p30", {
        "fixture": True, "resource": "urn:example:resource:camera7-acquisition",
        "video": {"width": 1280, "height": 720, "frameRate": ration(30), "codec": "av:H264"},
        "audio": {"sampleRate": 48000, "channels": 1, "codec": "av:AAC"},
        "acquisition": "av:Live", "stateCompleteness": "Synthetic complete tuple for arithmetic/identity probes only."
    }, "ProfileDocument", dependencies=[definition_pins["resource-config-v0.1"]],
       profile=TERMS["profiles"]["resource-config-v0.1"]["iri"])
    acquisition = pin("acquisition", "https://example.org/configuration/camera7/acquisition-v1", {
        "fixture": True,
        "captureBehavior": TERMS["profiles"]["acquisition-v0.1"]["iri"] + "#Continuous",
        "trigger": TERMS["profiles"]["acquisition-v0.1"]["iri"] + "#FreeRun",
        "captureOwner": "urn:example:connector7", "triggerOwner": "urn:example:connector7",
        "permittedIntent": ["av:Observe"], "resourceConfiguration": resource,
        "controls": [], "actualQualification": "Not performed."
    }, "ProfileDocument", dependencies=[resource, binding, definition_pins["acquisition-v0.1"]],
       profile=TERMS["profiles"]["acquisition-v0.1"]["iri"])
    video_config = pin("codec-layout-video", "https://example.org/configuration/camera7/h264-v1", {
        "fixture": True, "codec": "av:H264", "codecProfile": "High", "codecLevel": "3.1",
        "codedPixelLayout": "YUV 4:2:0 8-bit", "colorMatrix": "BT.709", "range": "limited",
        "decoderInitialization": "Carried by the selected native binding; actual stream verification was not performed."
    }, "ProfileDocument", dependencies=[definition_pins["codec-layout-v0.1"], binding],
       profile=TERMS["profiles"]["codec-layout-v0.1"]["iri"])
    audio_config = pin("codec-layout-audio", "https://example.org/configuration/camera7/aac-v1", {
        "fixture": True, "codec": "av:AAC", "objectType": "AAC-LC",
        "sampleRate": 48000, "channels": 1,
        "decoderInitialization": "Binding-owned; not an executed decoder qualification."
    }, "ProfileDocument", dependencies=[definition_pins["codec-layout-v0.1"], binding],
       profile=TERMS["profiles"]["codec-layout-v0.1"]["iri"])
    td = {
        "@context": [TD_CONTEXT, AV_CONTEXT],
        "id": "urn:example:camera7",
        "@type": ["td:Thing", "av:MediaSource"],
        "title": "Synthetic A/V source for vocabulary probes",
        "version": {"instance": "4"},
        "securityDefinitions": {"none": {"scheme": "nosec"}},
        "security": ["none"],
        "av:connector": "urn:example:connector7",
        "av:offer": [{
            "@id": "urn:example:offer:camera7", "@type": "av:Offer", "av:source": "urn:example:camera7",
            "av:mode": [{
                "@id": "urn:example:mode:camera7:720p30", "@type": "av:Mode", "av:kind": "av:Live",
                "av:form": "urn:example:form:camera7:media", "av:configuration": acquisition,
                "av:resourceUses": [{"@type": "av:ResourceUse", "av:resource": "urn:example:resource:camera7-acquisition",
                                     "av:configuration": resource, "av:sharing": "av:SameConfiguration"}],
                "av:track": [
                    {"@id": "urn:example:track:camera7:v0", "@type": "av:Track", "dcterms:identifier": "v0",
                     "av:representation": "av:EncodedVideo", "av:codec": "av:H264",
                     "av:width": 1280, "av:height": 720, "av:cadence": "av:Constant", "av:frameRate": ration(30),
                     "av:configuration": video_config},
                    {"@id": "urn:example:track:camera7:a0", "@type": "av:Track", "dcterms:identifier": "a0",
                     "av:representation": "av:EncodedAudio", "av:codec": "av:AAC",
                     "av:sampleRate": 48000, "av:channels": 1, "av:channelLayout": "av:Mono",
                     "av:configuration": audio_config},
                ],
            }],
        }],
        "properties": {"media": {
            "title": "Native media interaction", "readOnly": True,
            "forms": [{
                "@id": "urn:example:form:camera7:media",
                "href": "https://media.example.org/camera7/live.mkv",
                "op": "readproperty", "contentType": "video/x-matroska",
                "av:mediaDirection": "av:FromThing", "av:locality": "av:Network", "av:binding": binding_url,
            }],
        }},
    }
    write(".camera.td.json", td)
    td_pin = pin("publisher-td", "https://example.org/descriptions/camera7/4", text(td),
                 "PublisherTD", "application/td+json",
                 dependencies=[pin_native, pin_av, pin_ontology, binding, acquisition, video_config, audio_config],
                 expected_thing=td["id"])
    wire_video = track_requirement("urn:example:requirement:wire-picture", "picture", "EncodedVideo", "Required",
                                   [choice("codec", ["av:H264"]), choice("cadence", ["av:Constant"]), exact_rate(30)])
    wire_audio = track_requirement("urn:example:requirement:wire-sound", "sound", "EncodedAudio", "Optional",
                                   [choice("codec", ["av:AAC"]), exact_integer("sampleRate", 48000)])
    delivered_video = track_requirement("urn:example:requirement:delivered-picture", "picture", "RawVideo", "Required",
                                        [choice("pixelFormat", ["av:BGR8"]), choice("bufferLayout", ["av:Contiguous"]),
                                         exact_integer("width", 1280), exact_integer("height", 720)])
    delivered_audio = track_requirement("urn:example:requirement:delivered-sound", "sound", "PCM", "Optional",
                                        [choice("sampleFormat", ["av:S16LE"]), choice("bufferLayout", ["av:Interleaved"]),
                                         choice("channelLayout", ["av:Mono"]), exact_integer("sampleRate", 48000),
                                         exact_integer("channels", 1)])
    need = {
        "@context": AV_CONTEXT, "@id": "urn:example:need:opencv-media:7", "@type": "av:Need",
        "dcterms:isVersionOf": "urn:example:need:opencv-media", "av:generation": 7, "av:state": "av:Active",
        "av:processor": "urn:example:processor:opencv",
        "av:pin": [pin_av, pin_ontology, pin_shapes],
        "av:input": [{
            "@id": "urn:example:input:inspection", "@type": "av:InputRequirement",
            "dcterms:identifier": "inspection", "av:presence": "av:Required",
            "av:alternative": [{
                "@id": "urn:example:alternative:inspection:live", "@type": "av:InputAlternative",
                "av:kind": "av:Live", "av:source": "urn:example:camera7",
                "av:captureIntent": "av:Observe",
                "av:constraints": [choice("host", ["urn:example:host:edge1"]),
                                   choice("backend", ["urn:example:backend:ffmpeg-video:v1", "urn:example:backend:gstreamer-av:v1"])],
                "av:transformPermissions": ["av:Decode", "av:ColorConvert"],
                "av:wireTracks": [wire_video, wire_audio], "av:deliveredTracks": [delivered_video, delivered_audio],
                "av:queues": [{
                    "@type": "av:QueuePolicy", "av:stage": "av:DecodedDelivery",
                    "av:capacity": 1, "av:unit": "av:Bundle", "av:overflow": "av:DropOldest",
                    "av:coveragePolicy": "av:BestEffort", "av:limitMs": 100,
                }],
            }],
        }],
        "av:preferences": [{
            "@type": "av:Preference", "av:input": "urn:example:input:inspection",
            "av:goal": track_requirement("urn:example:goal:sound", "sound", "PCM", "Required",
                                          [choice("sampleFormat", ["av:S16LE"])]),
        }],
    }
    write(".need.jsonld", need)
    need_pin = pin("need7", "https://example.org/needs/opencv-media/7", text(need), "DomainDocument",
                   "application/ld+json", dependencies=[pin_av, pin_ontology, pin_shapes])
    form_ref = {
        "@type": "av:FormReference", "av:pin": td_pin, "av:form": "urn:example:form:camera7:media",
        "av:operation": str(TD.readProperty), "av:jsonPointer": "/properties/media/forms/0",
    }
    adapter = pin("adapter", "https://example.org/plans/fixture-video-only/v1", {
        "fixture": True, "profile": TERMS["profiles"]["adapter-plan-v0.1"]["iri"],
        "host": "urn:example:host:edge1", "backend": "urn:example:backend:ffmpeg-video:v1",
        "source": form_ref, "wire": wire_video,
        "delivered": delivered_video, "operations": ["av:Decode", "av:ColorConvert"],
        "queues": need["av:input"][0]["av:alternative"][0]["av:queues"],
        "qualificationState": "av:Unknown",
        "limits": "Fixture specifies intent/signatures only. No real adapter, internal queues, resource costs or timing were qualified; do not admit this plan in production."
    }, "ProfileDocument", dependencies=[td_pin, definition_pins["adapter-plan-v0.1"]],
       profile=TERMS["profiles"]["adapter-plan-v0.1"]["iri"])
    grant = {
        "@id": "urn:example:grant:g0", "@type": "av:LeaseGrant",
        "dcterms:isVersionOf": "urn:example:grant-series:camera7-reader",
        "av:authority": "urn:example:authority:access", "av:holder": "urn:example:instance:processor:boot2",
        "av:scope": "urn:example:scope:camera7-reader", "av:fence": 317, "av:sequence": 0,
        "av:validFrom": "2026-09-14T08:30:00Z", "av:validUntil": "2026-09-14T08:35:00Z",
        "av:clock": "urn:example:clock:authority-utc", "av:uncertaintyMs": 2,
    }
    assignment = {
        "@id": "urn:example:assignment:a1", "@type": "av:Assignment", "av:need": need["@id"],
        "av:generation": 7, "av:holder": grant["av:holder"],
        "prov:wasAttributedTo": "urn:example:agent:controller",
        "av:pin": [need_pin, td_pin, adapter, pin_av, pin_ontology, pin_shapes],
        "av:lease": [grant["@id"]], "av:omitted": [],
        "av:selections": [{
            "@id": "urn:example:selection:inspection", "@type": "av:InputSelection",
            "av:requirement": "urn:example:input:inspection",
            "av:alternative": "urn:example:alternative:inspection:live",
            "av:offer": "urn:example:offer:camera7", "av:mode": "urn:example:mode:camera7:720p30",
            "av:configuration": adapter, "av:forms": [form_ref],
            "av:selections": [{
                "@id": "urn:example:selection:picture", "@type": "av:TrackSelection",
                "av:track": "urn:example:track:camera7:v0",
                "av:requirement": [wire_video["@id"], delivered_video["@id"]],
            }],
            "av:omitted": [wire_audio["@id"], delivered_audio["@id"]],
        }],
    }
    status = {
        "@id": "urn:example:status:a1:42", "@type": "av:AssignmentStatus",
        "av:assignment": assignment["@id"], "av:generation": 7,
        "prov:wasAttributedTo": "urn:example:agent:controller", "av:incarnation": "urn:example:instance:controller:boot3",
        "av:sequence": 42, "av:state": "av:Applying", "av:lease": [grant["@id"]],
        "av:observedAt": "2026-09-14T08:30:01Z", "av:validUntil": "2026-09-14T08:30:02Z",
        "av:clock": "urn:example:clock:controller-utc", "av:uncertaintyMs": 2,
        "av:conditions": [
            {"@type": "av:Condition", "av:condition": "av:MediaObserved", "av:conditionState": "av:False",
             "av:evidence": ["urn:example:evidence:synthetic-no-frames-yet"]},
            {"@type": "av:Condition", "av:condition": "av:ApplicationReady", "av:conditionState": "av:Unknown"},
            {"@type": "av:Condition", "av:condition": "av:ModelLoaded", "av:conditionState": "av:NotApplicable"},
            {"@type": "av:Condition", "av:condition": "av:ResultCommitted", "av:conditionState": "av:NotApplicable"},
        ],
    }
    records = {
        "@context": AV_CONTEXT,
        "@graph": [
            {"@id": "urn:example:records", "dcterms:description":
             "All records are synthetic structural fixtures. The Assignment illustrates accepted-record syntax only; the explicitly unqualified adapter is NOT a valid admission. No real grant, observation, execution or model loading is asserted."},
            {"@id": "urn:example:connector7", "@type": "av:Connector",
             "av:host": "urn:example:host:edge1", "av:backend": "urn:example:backend:native-camera:v1"},
            {"@id": "urn:example:agent:controller", "@type": "prov:SoftwareAgent"},
            grant, assignment, status, *PINS,
        ],
    }
    write(".records.jsonld", records)
    write(".fixtures.json", {
        "notice": "Synthetic immutable representation octets for local pin/identity probes. URLs are not hosted. Non-context documents are not fetched by JSON-LD expansion.",
        "serialization": "Each string value below is the exact UTF-8 decoded representation whose SHA-256 is pinned; no parse/reserialize canonicalization is used by the verification.",
        "documents": DOCUMENTS,
    })
    return td, need, records


def offline_loader(url: str, options=None) -> dict:
    documents = {TD_CONTEXT: NATIVE_CONTEXT, AV_CONTEXT: CONTEXT}
    if url not in documents:
        raise ValueError("Offline JSON-LD loader rejected an unregistered context: " + url)
    return {"contextUrl": None, "documentUrl": url, "document": documents[url]}


OPTIONS = {"documentLoader": offline_loader, "processingMode": "json-ld-1.1",
           "base": "https://example.org/verification/document"}


def expand(document: dict) -> list:
    return jsonld.expand(document, options=OPTIONS)


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def expanded_node(document: list, identifier: str) -> dict:
    definitions = [node for node in nodes(document) if node.get("@id") == identifier and len(node) > 1]
    if len(definitions) != 1:
        raise ValueError(f"Expected one defining node for {identifier}, got {len(definitions)}")
    return definitions[0]


def native_forms(document: dict):
    for form in document.get("forms", []):
        yield form
    for group in ("properties", "actions", "events"):
        for affordance in document.get(group, {}).values():
            yield from affordance.get("forms", [])


def pointer(document, selector: str):
    if selector == "":
        return document
    if not selector.startswith("/"):
        raise ValueError("Invalid JSON Pointer")
    current = document
    for part in selector[1:].split("/"):
        if "~" in part.replace("~0", "").replace("~1", ""):
            raise ValueError("Invalid JSON Pointer escape")
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            if not part.isdigit() or (len(part) > 1 and part.startswith("0")):
                raise ValueError("Invalid array index")
            current = current[int(part)]
        else:
            current = current[part]
    return current


def verify_pin(record: dict, content: str, allowed_kinds=None) -> None:
    if digest(content) != record["av:hexDigest"]:
        raise ValueError("IntegrityMismatch: complete exact representation octets differ")
    if allowed_kinds and record["av:documentKind"] not in allowed_kinds:
        raise ValueError("IntegrityMismatch: publisher/directory provenance scope differs")


def fixture_pin_closure_key(root: str, catalog: dict[str, dict]) -> tuple:
    def signature(record: dict) -> tuple:
        profiles = record.get("dcterms:conformsTo", [])
        if isinstance(profiles, str):
            profiles = [profiles]
        return (record["av:document"], record["av:documentKind"], record["dcterms:format"],
                record["av:hexDigest"], record.get("av:expectedThing", ""), tuple(sorted(profiles)))

    pending, seen, signatures, edges = [root], set(), set(), set()
    while pending:
        identifier = pending.pop()
        if identifier in seen:
            continue
        seen.add(identifier)
        record = catalog[identifier]
        key = signature(record)
        signatures.add(key)
        for dependency in record.get("av:pin", []):
            edges.add((key, signature(catalog[dependency])))
            pending.append(dependency)
    return signature(catalog[root]), tuple(sorted(signatures)), tuple(sorted(edges))


def resolve_fixture_form(reference: dict, td_pin: dict, content: str) -> dict:
    verify_pin(td_pin, content, {"av:PublisherTD", "av:DirectorySnapshot"})
    document = strict_json(content)
    if document.get("id") != td_pin["av:expectedThing"]:
        raise ValueError("Expected Thing identity mismatch")
    matches = [form for form in native_forms(document) if form.get("@id") == reference["av:form"]]
    if len(matches) != 1:
        raise ValueError("Missing/ambiguous named native Form")
    form = matches[0]
    if "av:jsonPointer" in reference and pointer(document, reference["av:jsonPointer"]) is not form:
        raise ValueError("JSON Pointer and Form identity disagree")
    # This fixture has an explicit native op. General default/binding resolution is not implemented here.
    tokens = form.get("op")
    if isinstance(tokens, str):
        tokens = [tokens]
    native_context = NATIVE_CONTEXT["@context"]["forms"]["@context"]
    resolved = [str(TD[native_context[token].split(":", 1)[1]]) for token in tokens or []]
    if reference["av:operation"] not in resolved:
        raise ValueError("Selected operation is not explicitly declared by the fixture Form")
    return form


def check_inventory_and_shapes() -> None:
    ontology = Graph().parse(path(".ttl"), format="turtle")
    shapes = Graph().parse(path(".shacl.ttl"), format="turtle")
    check("RDF/Turtle ontology parsed", len(ontology) > 0, len(ontology))
    check("RDF/Turtle shapes parsed (not SHACL execution)", len(shapes) > 0, len(shapes))
    check("AV property inventory exactly equals ontology declarations",
          {str(node)[len(str(AV)):] for node in ontology.subjects(RDF.type, RDF.Property)} == set(TERMS["properties"]))
    check("AV class inventory exactly equals ontology declarations",
          {str(node)[len(str(AV)):] for node in ontology.subjects(RDF.type, RDFS.Class)} == set(TERMS["classes"]))
    expected_keys = {"av:" + name for name in TERMS["properties"]} | set(TERMS["external_properties"])
    actual_keys = set(CONTEXT["@context"]) - {"@version", "@protected", "av", "prov", "dcterms"}
    check("Context property definitions exactly match inventory", expected_keys == actual_keys)
    check("No core term aliases or AV @vocab reset",
          not ({"@vocab", "id", "type", "forms", "security", "DataSchema", "dataSchema"} & set(CONTEXT["@context"])))
    check("No heavyweight imports, equivalence guesses or unsafe global domains/ranges",
          all(not list(ontology.triples((None, predicate, None)))
              for predicate in (OWL.imports, OWL.equivalentClass, OWL.equivalentProperty, OWL.sameAs, RDFS.domain, RDFS.range)))
    check("No legacy ambiguous value/endpoints/rational aliases",
          not ({"Endpoint", "FormRef", "FragmentRef"} & set(TERMS["classes"])) and
          not ({"value", "n", "d", "href", "url"} & set(TERMS["properties"])))
    native_context = NATIVE_CONTEXT["@context"]["forms"]["@context"]
    actual_operations = {value for key, value in native_context.items()
                         if isinstance(value, str) and value.startswith("td:") and key.islower()}
    check("Selected operation enum equals pinned native TD operation vocabulary",
          set(TERMS["enums"]["NativeOperation"]) == actual_operations, sorted(actual_operations))
    # Selected static sanity checks only; these are deliberately not a SHACL syntax validator.
    node_shapes = set(shapes.subjects(RDF.type, SH.NodeShape))
    check("Selected shape sanity: node shapes have no sh:path",
          all(not list(shapes.objects(node, SH.path)) for node in node_shapes))
    check("Selected shape sanity: each property shape has exactly one path",
          all(len(list(shapes.objects(prop, SH.path))) == 1 for prop in shapes.objects(None, SH.property)))
    singular = [SH["and"], SH["or"], SH.xone, SH["not"], SH.datatype, SH["class"],
                SH.nodeKind, SH.minCount, SH.maxCount, SH["in"], SH.node]
    check("Selected shape sanity: no duplicate singleton constraint parameters",
          all(len(list(shapes.objects(subject, predicate))) <= 1
              for subject in set(shapes.subjects()) for predicate in singular))
    check("Selected shape sanity: zero-or-more path nodes have one defining triple",
          all(len(list(shapes.predicate_objects(node))) == 1 for node in shapes.subjects(SH.zeroOrMorePath, None)))
    check("Selected shape sanity: no assumed rdf:List typing for JSON-LD lists",
          not list(shapes.triples((None, SH["class"], RDF.List))))
    check("Control-only binding annotations are not targeted as media Forms",
          (AV.MediaFormShape, SH.targetSubjectsOf, AV.binding) not in shapes and
          (AV.MediaFormShape, SH.targetSubjectsOf, AV.mediaDirection) in shapes)
    defined = set(TERMS["classes"]) | set(TERMS["properties"])
    defined |= {key for values in TERMS["enums"].values() if isinstance(values, dict) for key in values}
    referenced = {str(node)[len(str(AV)):] for triple in shapes for node in triple
                  if isinstance(node, URIRef) and str(node).startswith(str(AV)) and not str(node).endswith("Shape")}
    check("Shape vocabulary references all occur in inventory", referenced <= defined, sorted(referenced - defined))


def semantic_probes(td: dict, need: dict, records: dict) -> None:
    validator = jsonschema.Draft7Validator(TD_SCHEMA)
    validator.validate(td)
    check("Native annotated TD passes cached pinned Draft-07 schema", True, TD_SCHEMA.get("$id"))
    invalid_td = copy.deepcopy(td)
    invalid_td["properties"]["media"]["forms"][0]["op"] = "publishmedia"
    rejects("Invented native operation rejected by pinned TD schema",
            lambda: validator.validate(invalid_td), jsonschema.ValidationError)
    for name, document in (("camera", td), ("need", need), ("records", records)):
        expanded = expand(document)
        rdf = jsonld.to_rdf(document, options={**OPTIONS, "format": "application/n-quads"})
        dataset = Dataset()
        dataset.parse(data=rdf, format="nquads")
        check("Offline JSON-LD expansion and RDF conversion: " + name, len(expanded) > 0,
              {"expanded_roots": len(expanded), "quads": len(list(dataset.quads()))})
    expanded = expand(td)
    form = expanded_node(expanded, "urn:example:form:camera7:media")
    check("Named native Form identity survives extension expansion", True, form["@id"])
    check("Native op expands to the standard TD operation IRI",
          form[str(HCTL.hasOperationType)] == [{"@id": str(TD.readProperty)}])
    check("Native href remains xsd:anyURI literal, not av:form resource",
          form[str(HCTL.hasTarget)][0]["@type"] == str(XSD.anyURI) and "@value" in form[str(HCTL.hasTarget)][0])
    mode = expanded_node(expanded, "urn:example:mode:camera7:720p30")
    check("av:form is a named native-node reference, without copied href",
          mode[str(AV.form)] == [{"@id": form["@id"]}] and "href" not in mode)
    check("Native boolean remains boolean", any(node.get("@value") is True for node in nodes(expanded)))
    inputs = need["av:input"][0]["av:alternative"][0]
    wire = inputs["av:wireTracks"][0]
    delivered = inputs["av:deliveredTracks"][0]
    check("Typical media Need constrains exact 30 fps on WIRE only",
          any(c.get("av:field") == "av:frameRate" and ratio(c["av:lowerRational"]) == 30 for c in wire["av:constraints"]) and
          not any(c.get("av:field") == "av:frameRate" for c in delivered["av:constraints"]))
    check("BGR geometry is a delivered-media contract, not tensor preprocessing",
          delivered["av:representation"] == "av:RawVideo" and
          next(c for c in delivered["av:constraints"] if c["av:field"] == "av:pixelFormat")["av:allowedValues"] == ["av:BGR8"] and
          [next(c for c in delivered["av:constraints"] if c["av:field"] == "av:" + field)["av:lowerInteger"] for field in ("width", "height")] == [1280, 720])
    check("Drop policy is explicitly staged at decoded delivery",
          inputs["av:queues"][0]["av:stage"] == "av:DecodedDelivery" and inputs["av:queues"][0]["av:overflow"] == "av:DropOldest")
    list_probe = {"@context": AV_CONTEXT, "@id": "urn:probe:ordered",
                  "av:preferences": [{"@id": "urn:goal:b"}, {"@id": "urn:goal:a"}, {"@id": "urn:goal:b"}]}
    values = expand(list_probe)[0][str(AV.preferences)][0]["@list"]
    check("Ordered list preserves order and repeated members", [x["@id"] for x in values] == ["urn:goal:b", "urn:goal:a", "urn:goal:b"])
    num_probe = {"@context": AV_CONTEXT, "@id": "urn:probe:numeric",
                 "av:numerator": 30, "av:denominator": 1, "av:uncertaintyMs": 0.5}
    num_rdf = Graph().parse(data=jsonld.to_rdf(num_probe, options={**OPTIONS, "format": "application/n-quads"}), format="nt")
    check("Native integer token 30 converts to xsd:integer", (URIRef("urn:probe:numeric"), AV.numerator, Literal(30, datatype=XSD.integer)) in num_rdf)
    float_probe = {**num_probe, "av:numerator": 30.0}
    float_rdf = Graph().parse(data=jsonld.to_rdf(float_probe, options={**OPTIONS, "format": "application/n-quads"}), format="nt")
    integral_float_datatype = next(float_rdf.objects(None, AV.numerator)).datatype
    REPORT["implementation_caveats"] = [
        "Observed PyLD 3.1.0 maps Python float 30.0 to xsd:double, while JSON-LD API 1.1 section 8.2.2 specifies value-based integer conversion for this case. Emit native integer tokens (30) or explicit typed lexical xsd:integer values for integer fields; do not claim arbitrary-number round-trip conformance."
    ]
    check("PyLD integral-float implementation discrepancy is explicitly recorded",
          integral_float_datatype == XSD.double, str(integral_float_datatype))
    check("Fractional native number converts to xsd:double", next(num_rdf.objects(None, AV.uncertaintyMs)).datatype == XSD.double)
    check("Native numbers remain numbers in expansion",
          isinstance(expand(num_probe)[0][str(AV.uncertaintyMs)][0]["@value"], float))
    large = {"@context": AV_CONTEXT, "@id": "urn:probe:large",
             "av:fence": {"@value": "9007199254740993", "@type": str(XSD.integer)}}
    large_rdf = Graph().parse(data=jsonld.to_rdf(large, options={**OPTIONS, "format": "application/n-quads"}), format="nt")
    check("Typed lexical large integer retains all digits", str(next(large_rdf.objects(None, AV.fence))) == "9007199254740993")
    truth_probe = {"@context": AV_CONTEXT, "@id": "urn:probe:truth",
                   "av:conditionState": ["av:True", "av:False", "av:Unknown", "av:NotApplicable"],
                   "av:hexDigest": "a" * 64}
    expanded_truth = expand(truth_probe)[0]
    check("Four truth states remain distinct IRIs",
          {value["@id"] for value in expanded_truth[str(AV.conditionState)]} == {str(AV[x]) for x in ("True", "False", "Unknown", "NotApplicable")})
    check("Digest is a string literal, never a truth-state value",
          expanded_truth[str(AV.hexDigest)] == [{"@type": str(XSD.string), "@value": "a" * 64}])
    bare = expand({"@context": AV_CONTEXT, "av:mediaDirection": "FromThing"})[0][str(AV.mediaDirection)][0]["@id"]
    check("Bare enum under @id coercion demonstrates relative-IRI trap", bare != str(AV.FromThing), bare)
    full_key = expand({"@context": AV_CONTEXT, str(AV.form): "urn:example:form"})[0][str(AV.form)][0]
    explicit = expand({"@context": AV_CONTEXT, str(AV.form): {"@id": "urn:example:form"}})[0][str(AV.form)][0]
    check("Full-IRI key does not inherit compact-key coercion", full_key.get("@value") == "urn:example:form" and explicit.get("@id") == "urn:example:form")
    unknown = {"@context": AV_CONTEXT, "av:framRate": 30}
    check("Unknown prefixed fields survive expansion; separate whitelist is necessary", str(AV.framRate) in expand(unknown)[0])
    rejects("Unknown AV key rejected by inventory whitelist",
            lambda: validate_av_keys(unknown))
    rejects("Duplicate JSON keys rejected before expansion", lambda: strict_json('{"av:state":"av:Ready","av:state":"av:Failed"}'))
    rejects("Non-JSON NaN rejected before expansion", lambda: strict_json('{"av:uncertaintyMs":NaN}'))
    rejects("Uncached context cannot cause a network fetch", lambda: offline_loader("https://example.org/not-allowed"))
    changed_context = copy.deepcopy(CONTEXT["@context"])
    changed_context["av"]["@id"] = "https://example.org/wrong#"
    rejects("Protected AV prefix cannot be redefined in a following context",
            lambda: expand({"@context": [AV_CONTEXT, changed_context], "av:form": "urn:example:f"}),
            jsonld.JsonLdError)
    for document in (td, need, records):
        validate_av_keys(document)
    check("All emitted domain specimens use known prefixed AV properties", True)


def validate_av_keys(document) -> None:
    for node in nodes(document):
        for key in node:
            if key.startswith("av:") and key[3:] not in TERMS["properties"]:
                raise ValueError("Unknown AV property " + key)


def arithmetic_and_reference_probes(td: dict, need: dict, records: dict) -> None:
    rational_schema = {
        "type": "object",
        "properties": {"@type": {"const": "av:Rational"}, "av:numerator": {"type": "integer"},
                       "av:denominator": {"type": "integer", "minimum": 1}},
        "required": ["@type", "av:numerator", "av:denominator"], "additionalProperties": False,
    }
    validator = jsonschema.Draft202012Validator(rational_schema)
    validator.validate(ration(30000, 1001))
    check("Local JSON Schema Rational structural probe", True)
    rejects("Zero denominator rejected", lambda: validator.validate({"@type": "av:Rational", "av:numerator": 30, "av:denominator": 0}), jsonschema.ValidationError)
    rejects("Numeric string is not an integer", lambda: validator.validate({"@type": "av:Rational", "av:numerator": "30", "av:denominator": 1}), jsonschema.ValidationError)
    rejects("Unreduced rational rejected by explicit arithmetic rule", lambda: ratio({"av:numerator": 60, "av:denominator": 2}))
    rejects("Integer-token profile excludes integral float representation", lambda: ratio({"av:numerator": 30.0, "av:denominator": 1}))
    rejects("Unsafe native counter/rational integer rejected", lambda: ratio({"av:numerator": 9007199254740993, "av:denominator": 1}))
    check("Hard exact 30 rejects 30000/1001 wire cadence", ratio(ration(30000, 1001)) != ratio(ration(30)))
    available = [(1280, 720, Fraction(30)), (1920, 1080, Fraction(25))]
    check("Complete Mode enumeration prevents unsupported Cartesian product",
          (1920, 1080, Fraction(30)) not in available)
    check("Worst-case age includes both uncertainty bounds", 80 + 5 + 2 == 87 and 87 <= 100 and not 87 <= 86)
    check("Worst-case skew includes both uncertainty bounds", abs(100 - 133) + 3 + 5 == 41 and 41 > 40)
    check("Clip half-open arithmetic is exact", Fraction(21, 10) <= Fraction(3) < Fraction(42, 10) and not Fraction(42, 10) < Fraction(42, 10))
    check("Wire 30 plus slower latest-only consumer does not establish delivered 30",
          Fraction(30) != Fraction(10), "A synthetic 10 fps application processing schedule with DropOldest is compatible with wire 30; no delivered-rate guarantee follows.")
    pin_by_id = {node["@id"]: node for node in PINS}
    for record in PINS:
        verify_pin(record, DOCUMENTS[record["av:document"]])
        for dependency in record.get("av:pin", []):
            if dependency not in pin_by_id:
                raise ValueError("Missing pinned dependency: " + dependency)
    check("All fixture pins cover exact archived octets and resolve dependency IDs", True, len(PINS))
    td_pin = pin_by_id["urn:example:pin:publisher-td"]
    check("TD pin explicitly closes over BOTH TD and AV contexts and binding",
          {"urn:example:pin:native-context", "urn:example:pin:av-context", "urn:example:pin:binding"} <= set(td_pin["av:pin"]))
    changed_dependencies = copy.deepcopy(pin_by_id)
    changed_dependencies["urn:example:pin:av-context"]["av:hexDigest"] = digest(path(".context.jsonld").read_text(encoding="utf-8") + "\n")
    check("Unchanged TD bytes do not make changed context/profile closure interchangeable",
          fixture_pin_closure_key(td_pin["@id"], pin_by_id) != fixture_pin_closure_key(td_pin["@id"], changed_dependencies))
    assignment = next(node for node in records["@graph"] if node.get("@type") == "av:Assignment")
    ref = assignment["av:selections"][0]["av:forms"][0]
    original = DOCUMENTS[td_pin["av:document"]]
    form = resolve_fixture_form(ref, td_pin, original)
    check("Pinned TD + named native Form + selected native operation resolve", form["@id"] == ref["av:form"])
    rejects("Whole-document whitespace change invalidates exact-octet pin", lambda: verify_pin(td_pin, original + "\n"))
    enriched = copy.deepcopy(td)
    enriched["description"] = "Synthetic directory enrichment; not a genuine Discovery response."
    directory_pin = {**td_pin, "av:documentKind": "av:DirectorySnapshot", "av:hexDigest": digest(text(enriched)),
                     "av:document": "https://example.org/directory/things/camera7"}
    check("Publisher and synthetic enriched-snapshot digests differ", td_pin["av:hexDigest"] != directory_pin["av:hexDigest"])
    rejects("Directory scope cannot masquerade as publisher scope",
            lambda: verify_pin(directory_pin, text(enriched), {"av:PublisherTD"}))
    missing = copy.deepcopy(td)
    del missing["properties"]["media"]["forms"][0]["@id"]
    missing_pin = {**td_pin, "av:hexDigest": digest(text(missing))}
    rejects("Nameless legacy Form not silently accepted", lambda: resolve_fixture_form(ref, missing_pin, text(missing)))
    duplicate = copy.deepcopy(td)
    duplicate["properties"]["media"]["forms"].append(copy.deepcopy(duplicate["properties"]["media"]["forms"][0]))
    duplicate_pin = {**td_pin, "av:hexDigest": digest(text(duplicate))}
    rejects("Duplicate defining native Form IDs rejected", lambda: resolve_fixture_form(ref, duplicate_pin, text(duplicate)))
    reordered = copy.deepcopy(td)
    other_form = copy.deepcopy(form)
    other_form["@id"] = "urn:example:form:camera7:other"
    reordered["properties"]["media"]["forms"].insert(0, other_form)
    reordered_pin = {**td_pin, "av:hexDigest": digest(text(reordered))}
    rejects("Pointer fallback must agree with the named Form", lambda: resolve_fixture_form(ref, reordered_pin, text(reordered)))
    by_name = {key: value for key, value in ref.items() if key != "av:jsonPointer"}
    check("Named Form survives array reordering in a newly pinned representation",
          resolve_fixture_form(by_name, reordered_pin, text(reordered))["@id"] == form["@id"])
    wrong_op = {**ref, "av:operation": str(TD.writeProperty)}
    rejects("Accepted selected operation must be native-compatible", lambda: resolve_fixture_form(wrong_op, td_pin, original))
    check("Pointer escaping resolves original JSON keys", pointer({"a/b": {"~c": 17}}, "/a~1b/~0c") == 17)
    grant = next(node for node in records["@graph"] if node.get("@type") == "av:LeaseGrant")
    observation = next(node for node in records["@graph"] if node.get("@type") == "av:AssignmentStatus")
    renewal = {**grant, "@id": "urn:example:grant:g1", "av:sequence": 1, "av:validUntil": "2026-09-14T08:40:00Z"}
    check("Renewal revision preserves fence/holder/series and does not rewrite observation freshness",
          renewal["av:fence"] == grant["av:fence"] and renewal["av:holder"] == grant["av:holder"] and
          renewal["dcterms:isVersionOf"] == grant["dcterms:isVersionOf"] and
          renewal["av:sequence"] > grant["av:sequence"] and observation["av:validUntil"] == "2026-09-14T08:30:02Z")
    instant = lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))
    check("Grant expiry is exclusive in the scalar interval probe",
          not instant(grant["av:validFrom"]) <= instant(grant["av:validUntil"]) < instant(grant["av:validUntil"]))
    check("Optional omitted wire/delivered tracks are explicit named requirements",
          set(assignment["av:selections"][0]["av:omitted"]) == {"urn:example:requirement:wire-sound", "urn:example:requirement:delivered-sound"})
    check("Accepted-record fixture does NOT claim actual qualified admission",
          strict_json(DOCUMENTS["https://example.org/plans/fixture-video-only/v1"])["qualificationState"] == "av:Unknown")


def main() -> None:
    td, need, records = make_specimens()
    check_inventory_and_shapes()
    semantic_probes(td, need, records)
    arithmetic_and_reference_probes(td, need, records)
    REPORT["versions"] = {name: importlib.metadata.version(name) for name in ("PyLD", "jsonschema", "rdflib")}
    REPORT["shacl_engine_installed"] = importlib.util.find_spec("pyshacl") is not None
    REPORT["shacl_executed"] = False
    REPORT["full_shacl_syntax_validation"] = False
    REPORT["network_during_verification"] = False
    REPORT["limits"] = [
        "No SHACL engine, complete SHACL syntax validator, matcher, profile-body validator or media adapter executed.",
        "Turtle parsing and selected static shape sanity probes are not SHACL conformance evidence.",
        "The synthetic accepted-record example deliberately references an unqualified adapter fixture; it illustrates syntax, not a valid admission.",
        "No real timing, samples, model loading, external authority, grant, cleanup, result commit or protocol interoperability was measured.",
        "No claim of full TD behavioral/camera conformance; only the cached repository-pinned TD JSON Schema was run.",
        "Closed JSON/admission checks are selected probes, not a complete generated controller or AV JSON Schema."
    ]
    REPORT["limits"].extend(REPORT.get("implementation_caveats", []))
    REPORT["summary"] = {"passed": len(REPORT["checks"]), "failed": len(REPORT["failures"])}
    write(".checks.json", REPORT)
    files = []
    for item in sorted(PREFIX.parent.glob(PREFIX.name + ".*")):
        if item.name.endswith(".publication.json"):
            continue
        raw = item.read_bytes()
        files.append({"path": str(item), "bytes": len(raw), "lines": len(raw.splitlines()), "sha256": digest(raw)})
    write(".publication.json", {
        "release": TERMS["release"], "namespace": TERMS["namespace"], "context_url": AV_CONTEXT,
        "status": TERMS["status"], "files": files,
        "validation": REPORT["summary"], "validation_limits": REPORT["limits"],
        "single_source_of_terms": str(path(".terms.json")),
        "regeneration": ["python " + str(path(".build.py")), "python " + str(path(".verify.py"))],
    })
    print(json.dumps({"passed": len(REPORT["checks"]), "failed": len(REPORT["failures"]),
                      "pins": len(PINS), "files": len(files), "shacl_executed": False}))


if __name__ == "__main__":
    main()
