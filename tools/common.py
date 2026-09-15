"""Strict, offline helpers shared by the release generator and fixture checks."""

from __future__ import annotations

import copy
import hashlib
import math
import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit

from pyld import jsonld
from rdflib import Dataset, Graph, Namespace, URIRef

from json_format import format_json, json_bytes, strict_json

ROOT = Path(__file__).resolve().parents[1]
AV = Namespace("https://example.org/wot/av/0.2#")
TD = Namespace("https://www.w3.org/2019/wot/td#")
HCTL = Namespace("https://www.w3.org/2019/wot/hypermedia#")
XSD = Namespace("http://www.w3.org/2001/XMLSchema#")
U = "urn:example:av-example:"
TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
AV_CONTEXT = "https://example.org/wot/av/context/v0.2"
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


def read(file: Path):
    return strict_json(file.read_bytes())


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


def nodes(value, *, skip_literals=True):
    if isinstance(value, dict):
        yield value
        for key, child in value.items():
            if skip_literals and (key in {"@context", "av:accepts", str(AV.accepts)}
                                  or key == "@value" and value.get("@type") == "@json"):
                continue
            yield from nodes(child, skip_literals=skip_literals)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child, skip_literals=skip_literals)


def validate_av_keys(document, terms=None):
    terms = read(relative_file("vocabulary/terms.json")) if terms is None else terms
    allowed = {"av:" + name for name in terms["properties"]}
    allowed |= {terms["namespace"] + name for name in terms["properties"]}
    for node in nodes(document):
        for key in node:
            if key.startswith(("av:", "https://example.org/wot/av#",
                               "https://example.org/wot/av/")) and key not in allowed:
                raise ValueError("Unknown AV property: " + key)


def form_memberships(document):
    for form in document.get("forms", []):
        yield form, document, "thing", None
    for group in ("properties", "actions", "events"):
        for name, affordance in document.get(group, {}).items():
            for form in affordance.get("forms", []):
                yield form, affordance, group, name


def native_forms(document):
    for form, _, _, _ in form_memberships(document):
        yield form


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


def absolute_iri(value, label="IRI") -> str:
    if (not isinstance(value, str) or not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:.+", value)
            or re.search(r'[\s<>"{}\\]', value)):
        raise ValueError(label + " must be an absolute IRI")
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https"} and not parsed.netloc:
        raise ValueError(label + " must have an authority")
    return value


def string_set(value, label):
    values = [value] if isinstance(value, str) else value
    if (not isinstance(values, list) or not values
            or any(not isinstance(item, str) or not item for item in values)
            or len(values) != len(set(values))):
        raise ValueError(label + " must be a nonempty string or unique string array")
    return tuple(values)


def operation_map():
    context = read(relative_file("third_party/wot/td-context.jsonld"))["@context"]["forms"]["@context"]
    return {key: str(TD[value[3:]]) for key, value in context.items()
            if key.islower() and isinstance(value, str) and value.startswith("td:")}


def native_operations(form, affordance, kind):
    mapping = operation_map()
    if kind == "properties":
        for key in ("readOnly", "writeOnly", "observable"):
            if key in affordance and type(affordance[key]) is not bool:
                raise ValueError("Native property " + key + " must be boolean")
        if affordance.get("readOnly", False) and affordance.get("writeOnly", False):
            raise ValueError("Native property cannot be both readOnly and writeOnly")
    if "op" in form:
        tokens = string_set(form["op"], "Native Form op")
    elif kind == "properties":
        read_only = affordance.get("readOnly", False)
        write_only = affordance.get("writeOnly", False)
        if type(read_only) is not bool or type(write_only) is not bool or read_only and write_only:
            raise ValueError("Invalid native property readOnly/writeOnly flags")
        tokens = tuple(token for token, allowed in (
            ("readproperty", not write_only), ("writeproperty", not read_only)
        ) if allowed)
    elif kind == "actions":
        tokens = ("invokeaction",)
    elif kind == "events":
        tokens = ("subscribeevent", "unsubscribeevent")
    else:
        raise ValueError("Unsupported omitted op on a top-level native Form")
    allowed_by_kind = {
        "properties": {"readproperty", "writeproperty", "observeproperty", "unobserveproperty"},
        "actions": {"invokeaction", "queryaction", "cancelaction"},
        "events": {"subscribeevent", "unsubscribeevent"},
        "thing": {"readallproperties", "writeallproperties", "readmultipleproperties",
                  "writemultipleproperties", "observeallproperties", "unobserveallproperties",
                  "queryallactions", "subscribeallevents", "unsubscribeallevents"},
    }
    if kind not in allowed_by_kind or any(token not in mapping or token not in allowed_by_kind[kind]
                                         for token in tokens):
        raise ValueError("Unknown or inapplicable native operation")
    if kind == "properties":
        if (affordance.get("readOnly", False) and "writeproperty" in tokens
                or affordance.get("writeOnly", False) and any(
                    token in tokens for token in ("readproperty", "observeproperty", "unobserveproperty"))):
            raise ValueError("Native operation conflicts with readOnly/writeOnly")
        if any(token in tokens for token in ("observeproperty", "unobserveproperty")):
            if affordance.get("observable", False) is not True:
                raise ValueError("Observation requires native observable=true")
    return tuple(mapping[token] for token in tokens)


@dataclass(frozen=True)
class RetrievedTD:
    document: dict
    document_url: str


@dataclass(frozen=True)
class ResolvedForm:
    document: dict
    document_iri: str
    effective_document_iri: str
    affordance: dict
    kind: str
    name: str | None
    form: dict
    operations: tuple[str, ...]
    operation: str | None
    security_definitions: dict


def resolve_native_form(document_iri, form_iri, documents, *, operation=None, expected_source=None):
    """Resolve only supplied documents. No retrieval or native operation is performed."""
    absolute_iri(document_iri, "TD document")
    absolute_iri(form_iri, "Native Form identity")
    if document_iri not in documents:
        raise ValueError("TD document unavailable in the explicit offline document map")
    retrieved = documents[document_iri]
    if isinstance(retrieved, RetrievedTD):
        document, effective_url = retrieved.document, retrieved.document_url
    elif isinstance(retrieved, dict):
        document, effective_url = retrieved, document_iri
    else:
        raise ValueError("Unsupported retrieved TD representation")
    absolute_iri(effective_url, "Effective TD retrieval IRI")
    absolute_iri(document.get("id"), "Native Thing identity")
    if expected_source is not None and document["id"] != expected_source:
        raise ValueError("Offer source differs from the located TD Thing id")
    memberships = list(form_memberships(document))
    matches = [item for item in memberships if item[0].get("@id") == form_iri]
    if len(matches) != 1:
        raise ValueError("Missing/ambiguous named native Form membership")
    form, affordance, kind, name = matches[0]
    operations = native_operations(form, affordance, kind)
    if operation is not None and operation not in operations:
        raise ValueError("Selected standard operation is not supported by the native Form")
    if "security" in affordance and kind != "thing":
        raise ValueError("Unsupported non-native affordance-level security inheritance")
    definitions = document.get("securityDefinitions")
    if not isinstance(definitions, dict) or not definitions:
        raise ValueError("Native securityDefinitions is required")
    if "security" not in document:
        raise ValueError("Native top-level security is required; no anonymous fallback")
    top_security = string_set(document["security"], "Native top-level security")
    if any(key not in definitions for key in top_security):
        raise ValueError("Unresolved native top-level security definition")
    security = string_set(form.get("security", document["security"]), "Effective native Form security")
    visited = set()

    def security_definition(key, ancestors=()):
        if key in ancestors:
            raise ValueError("Cyclic native security definition")
        if key not in definitions or not isinstance(definitions[key], dict):
            raise ValueError("Unresolved native security definition: " + key)
        definition = definitions[key]
        if not isinstance(definition.get("scheme"), str):
            raise ValueError("Native security definition has no scheme")
        visited.add(key)
        if definition["scheme"] == "combo":
            fields = [field for field in ("oneOf", "allOf") if field in definition]
            if len(fields) != 1:
                raise ValueError("Invalid native combo security definition")
            for child in string_set(definition[fields[0]], "Combo security members"):
                security_definition(child, (*ancestors, key))

    for key in security:
        security_definition(key)
    base = document.get("base", effective_url)
    absolute_iri(base, "Native TD base")
    href = form.get("href")
    if not isinstance(href, str) or not href:
        raise ValueError("Native Form href is required")
    if "{" in href or "}" in href:
        raise ValueError("Unsupported URI template: supply a native template-expansion implementation")
    href = absolute_iri(urljoin(base, href), "Resolved native Form href")
    effective = copy.deepcopy(form)
    effective["href"] = href
    effective["security"] = list(security)
    effective["contentType"] = form.get("contentType", "application/json")
    if not isinstance(effective["contentType"], str) or not effective["contentType"]:
        raise ValueError("Invalid native contentType")
    effective_definitions = {key: copy.deepcopy(definitions[key]) for key in sorted(visited)}
    security_defaults = {
        "basic": {"in": "header"}, "digest": {"in": "header", "qop": "auth"},
        "apikey": {"in": "query"},
        "bearer": {"in": "header", "alg": "ES256", "format": "jwt"},
    }
    for definition in effective_definitions.values():
        for key, value in security_defaults.get(definition["scheme"], {}).items():
            definition.setdefault(key, value)
    return ResolvedForm(
        copy.deepcopy(document), document_iri, effective_url, copy.deepcopy(affordance),
        kind, name, effective, operations, operation,
        effective_definitions,
    )


def resolve_form(reference, documents):
    if not isinstance(reference, dict):
        raise ValueError("FormReference must be an object")
    validate_av_keys(reference)
    compact = {}
    for key, value in reference.items():
        name = "av:" + key[len(str(AV)):] if key.startswith(str(AV)) else key
        if name in compact:
            raise ValueError("Duplicate compact/expanded FormReference property")
        compact[name] = value
    reference = compact
    required = {"av:document", "av:form", "av:operation"}
    if required - reference.keys():
        raise ValueError("FormReference requires document, form and operation")
    if any(key.startswith("av:") and key not in required for key in reference):
        raise ValueError("Inapplicable AV property on FormReference")
    for key in required:
        absolute_iri(reference[key], key)
    if reference["av:operation"] not in operation_map().values():
        raise ValueError("FormReference operation must be a standard native TD operation IRI")
    return resolve_native_form(reference["av:document"], reference["av:form"], documents,
                               operation=reference["av:operation"])


def native_payload_schema(resolved: ResolvedForm, role="result"):
    """Read a native payload schema, never invent one for an absent contract."""
    if role not in {"result", "destination"}:
        raise ValueError("Unknown payload role")
    operation = resolved.operation
    if resolved.kind == "properties" and operation in (
        {str(TD.readProperty), str(TD.observeProperty)} if role == "result" else {str(TD.writeProperty)}
    ):
        value_keys = {
            "type", "const", "default", "unit", "oneOf", "enum", "format",
            "contentMediaType", "contentEncoding", "minimum", "maximum",
            "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength",
            "maxLength", "pattern", "items", "minItems", "maxItems", "properties", "required",
        }
        schema = {key: copy.deepcopy(value) for key, value in resolved.affordance.items() if key in value_keys}
        if not schema:
            raise ValueError("Native payload schema is absent/unknown; no compatibility conclusion")
    elif resolved.kind == "actions" and operation == str(TD.invokeAction):
        schema = resolved.affordance.get("output" if role == "result" else "input")
    elif resolved.kind == "events" and operation == str(TD.subscribeEvent) and role == "result":
        schema = resolved.affordance.get("data")
    else:
        raise ValueError("Unsupported native operation for this payload role")
    if not isinstance(schema, dict):
        raise ValueError("Native payload schema is absent/unknown; no compatibility conclusion")
    return copy.deepcopy(schema)


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

    def negative(self, name, action, exception=ValueError, category="expected-negative", match=None):
        try:
            action()
        except exception as error:
            if match is not None and re.search(match, str(error)) is None:
                raise AssertionError(name + " failed for the wrong reason: " + str(error)) from error
            self.check(name, True, {"rejectedBecause": str(error)[:240]}, category)
        else:
            raise AssertionError("Negative fixture was not rejected: " + name)
