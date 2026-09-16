"""Strict, offline helpers shared by the release generator and fixture checks."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from fractions import Fraction
from pathlib import Path, PurePosixPath

from pyld import jsonld
from rdflib import Dataset, Graph, Namespace, URIRef

ROOT = Path(__file__).resolve().parents[1]
AV = Namespace("https://example.org/wot/av#")
TD = Namespace("https://www.w3.org/2019/wot/td#")
HCTL = Namespace("https://www.w3.org/2019/wot/hypermedia#")
XSD = Namespace("http://www.w3.org/2001/XMLSchema#")
U = "urn:example:av-example:"
TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
AV_CONTEXT = "https://example.org/wot/av/context/v0.1"
TD_REVISION = "87808f1644ba79eb0a58d238385a8bd4a2236853"
SCHEMA_URL = (
    "https://raw.githubusercontent.com/w3c/wot-thing-description/"
    + TD_REVISION + "/validation/td-json-schema-validation.json"
)
SCHEMA_SHA = "87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da"
TD_CONTEXT_SHA = "9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069"
SAFE_INTEGER = 9007199254740991


def relative_file(name: str) -> Path:
    """Manifest paths use POSIX notation; actual filesystem paths are native."""
    value = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or value.is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError("Expected a safe repository-relative path: " + name)
    result = ROOT.joinpath(*value.parts).resolve()
    if not result.is_relative_to(ROOT):
        raise ValueError("Path leaves the release root: " + name)
    return result


def strict_json(source: str | bytes):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON member: " + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("Non-JSON numeric constant: " + value)

    def finite_float(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError("Nonfinite JSON number: " + value)
        return result

    return json.loads(source, object_pairs_hook=pairs,
                      parse_constant=invalid_constant, parse_float=finite_float)


def read(file: Path):
    return strict_json(file.read_bytes())


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def sha(data: str | bytes) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def metadata(name: str, data: bytes | None = None) -> dict:
    content = relative_file(name).read_bytes() if data is None else data
    return {"path": name, "bytes": len(content), "sha256": sha(content)}


def loader_for(context: dict | None = None):
    documents = {
        TD_CONTEXT: read(relative_file("third_party/wot/td-context.jsonld")),
        AV_CONTEXT: read(relative_file("vocabulary/context.jsonld")) if context is None else context,
    }

    def loader(url, options=None):
        if url not in documents:
            raise ValueError("Offline JSON-LD loader rejected an unregistered context: " + url)
        return {"contextUrl": None, "documentUrl": url,
                "document": copy.deepcopy(documents[url])}
    return loader


def expand(document, loader=None):
    return jsonld.expand(document, options={
        "documentLoader": loader_for() if loader is None else loader,
        "processingMode": "json-ld-1.1",
        "base": "https://example.org/verification/document",
    })


def graph_for(document, loader=None) -> Graph:
    nquads = jsonld.to_rdf(expand(document, loader), options={"format": "application/n-quads"})
    # These fixture documents have no named graphs. Reject a quad here.
    return Graph().parse(data=nquads, format="nt")


def dataset_for(document, graph_id, loader=None) -> Dataset:
    result = Dataset()
    for triple in graph_for(document, loader):
        result.graph(URIRef(graph_id)).add(triple)
    return result


def canonical_dataset(documents: dict[str, dict], loader=None) -> bytes:
    dataset = Dataset()
    for graph_id, document in documents.items():
        for triple in graph_for(document, loader):
            dataset.graph(URIRef(graph_id)).add(triple)
    return jsonld.normalize(dataset.serialize(format="nquads"), options={
        "algorithm": "URDNA2015", "inputFormat": "application/n-quads",
        "format": "application/n-quads",
    }).encode("utf-8")


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def validate_av_keys(document, terms=None):
    terms = read(relative_file("vocabulary/terms.json")) if terms is None else terms
    allowed = {"av:" + name for name in terms["properties"]}
    for node in nodes(document):
        for key in node:
            if key.startswith("av:") and key not in allowed:
                raise ValueError("Unknown AV property: " + key)


def native_forms(document):
    yield from document.get("forms", [])
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
            if not re.fullmatch(r"0|[1-9][0-9]*", part) or int(part) >= len(current):
                raise ValueError("Invalid JSON Pointer array index: " + part)
            current = current[int(part)]
        elif isinstance(current, dict) and part in current:
            current = current[part]
        else:
            raise ValueError("Unresolved JSON Pointer member: " + part)
    return current


def verify_pin(record: dict, content: str | bytes, allowed_kinds=None):
    if sha(content) != record["av:hexDigest"]:
        raise ValueError("IntegrityMismatch: complete exact representation octets differ")
    if allowed_kinds and record["av:documentKind"] not in allowed_kinds:
        raise ValueError("IntegrityMismatch: publisher/directory provenance scope differs")


def resolve_fixture_form(reference: dict, td_pin: dict, content: str | bytes):
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
    tokens = form.get("op", [])
    tokens = [tokens] if isinstance(tokens, str) else tokens
    native_context = read(relative_file("third_party/wot/td-context.jsonld"))["@context"]["forms"]["@context"]
    resolved = []
    for token in tokens:
        meaning = native_context.get(token)
        if not isinstance(meaning, str) or not meaning.startswith("td:"):
            raise ValueError("Unknown native operation token: " + str(token))
        resolved.append(str(TD[meaning.split(":", 1)[1]]))
    # Fixture Forms declare op explicitly; native defaults/binding dispatch are not implemented.
    if reference["av:operation"] not in resolved:
        raise ValueError("Selected operation is not explicitly declared by the fixture Form")
    return form


def exact_integer(value) -> int:
    if type(value) is int and abs(value) <= SAFE_INTEGER:
        return value
    if (isinstance(value, dict) and set(value) == {"@value", "@type"}
            and value["@type"] == str(XSD.integer) and isinstance(value["@value"], str)
            and re.fullmatch(r"-?(0|[1-9][0-9]*)", value["@value"])):
        return int(value["@value"])
    raise ValueError("Expected a safe native integer token or explicit xsd:integer lexical value")


def ration(numerator: int, denominator: int = 1):
    value = Fraction(numerator, denominator)
    return {"@type": "av:Rational", "av:numerator": value.numerator,
            "av:denominator": value.denominator}


def ratio(value: dict) -> Fraction:
    numerator = exact_integer(value["av:numerator"])
    denominator = exact_integer(value["av:denominator"])
    if denominator <= 0:
        raise ValueError("Rational denominator must be positive")
    if math.gcd(numerator, denominator) != 1:
        raise ValueError("Rational is not reduced")
    return Fraction(numerator, denominator)


class Checks:
    def __init__(self):
        self.rows = []

    def check(self, name, condition, detail=None, category="positive"):
        if not condition:
            raise AssertionError(name + ": " + str(detail))
        self.rows.append({"name": name, "category": category, "result": "passed", "detail": detail})

    def negative(self, name, action, exception=ValueError, category="expected-negative"):
        try:
            action()
        except exception as error:
            self.check(name, True, {"rejectedBecause": str(error)[:240]}, category)
        else:
            raise AssertionError("Negative fixture was not rejected: " + name)
