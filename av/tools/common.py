"""Strict, offline helpers shared by the release generator and fixture checks."""

from __future__ import annotations

import copy
import hashlib
import math
import re
from dataclasses import dataclass, field
from decimal import Decimal
from fractions import Fraction
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit

from pyld import jsonld
from rdflib import Dataset, Graph, Namespace, URIRef
from rdflib.namespace import RDF
from rdflib.exceptions import ParserError

from diagnostics import AVError, diagnostic
from json_format import MAX_DIGITS, format_json, json_bytes, strict_json, unicode_scalar

from repository import AV_ROOT, REPO_ROOT

ROOT = REPO_ROOT
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
        TD_CONTEXT: read(relative_file("av/support/upstream/wot/td-context.jsonld")),
        AV_CONTEXT: read(relative_file("av/context.jsonld")) if context is None else context,
    }

    def loader(url, options=None):
        if url not in documents:
            raise ValueError("Offline JSON-LD loader rejected an unregistered context: " + url)
        return {"contextUrl": None, "documentUrl": url,
                "document": context_syntax(documents[url])}
    return loader


def context_syntax(value):
    if isinstance(value, dict):
        return {key: 1.1 if key == "@version" and child == Decimal("1.1") else context_syntax(child)
                for key, child in value.items()}
    if isinstance(value, list):
        return [context_syntax(child) for child in value]
    return copy.deepcopy(value)


@diagnostic("AV_INVALID_DESCRIPTION", "semantic-projection")
def expand(document, loader=None):
    def local_contexts(value):
        if isinstance(value, dict):
            return {key: context_syntax(child) if key == "@context"
                    else copy.deepcopy(child) if key in {"av:accepts", str(AV.accepts), "@value"}
                    else local_contexts(child) for key, child in value.items()}
        if isinstance(value, list):
            return [local_contexts(child) for child in value]
        return value

    try:
        return jsonld.expand(local_contexts(document), options={
            "documentLoader": loader_for() if loader is None else loader,
            "processingMode": "json-ld-1.1",
            "base": "https://example.org/verification/document",
        })
    except jsonld.JsonLdError as error:
        code = ("AV_UNRESOLVED_REFERENCE" if "loading" in str(getattr(error, "code", ""))
                else "AV_INVALID_DESCRIPTION")
        raise AVError(code, "JSON-LD expansion failed under the explicit offline context policy",
                      stage="semantic-projection", reason=getattr(error, "code", None)) from error


def graph_for(document, loader=None) -> Graph:
    expanded = expand(document, loader)

    def exact_json_literals(value):
        def needs_exact(item):
            if isinstance(item, Decimal) or type(item) is int and abs(item) > SAFE_INTEGER:
                return True
            if isinstance(item, dict):
                return any(needs_exact(child) for child in item.values())
            if isinstance(item, list):
                return any(needs_exact(child) for child in item)
            return False

        if isinstance(value, dict):
            if value.get("@type") == "@json" and "@value" in value:
                if needs_exact(value["@value"]):
                    value["@value"] = json_bytes(value["@value"]).decode("utf-8").strip()
                    value["@type"] = str(RDF.JSON)
                return
            for child in value.values():
                exact_json_literals(child)
        elif isinstance(value, list):
            for child in value:
                exact_json_literals(child)

    exact_json_literals(expanded)
    nquads = jsonld.to_rdf(expanded, options={"format": "application/n-quads"})
    # These fixture documents have no named graphs. Reject a quad here.
    try:
        return Graph().parse(data=nquads, format="nt")
    except ParserError as error:
        raise AVError("AV_INVALID_DESCRIPTION", "The JSON-LD document is not one finite unnamed graph; select a dataset graph explicitly",
                      stage="semantic-projection") from error


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


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def validate_av_keys(document, terms=None):
    terms = read(relative_file("av/terms.json")) if terms is None else terms
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


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def absolute_iri(value, label="IRI") -> str:
    if (not isinstance(value, str) or not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:.+", value)
            or re.search(r'[\s\x00-\x1f\x7f-\x9f<>"{}|\\^`]', value)
            or any(0xD800 <= ord(char) <= 0xDFFF or ord(char) & 0xFFFF in {0xFFFE, 0xFFFF}
                   for char in value)
            or re.search(r"%(?![0-9A-Fa-f]{2})", value) or value.count("#") > 1):
        raise ValueError(label + " must be an absolute IRI")
    parsed = urlsplit(value)
    if any(char in parsed.path + parsed.query + parsed.fragment for char in "[]"):
        raise ValueError(label + " contains forbidden unescaped delimiters")
    if parsed.scheme in {"http", "https"} and (not parsed.netloc or not parsed.hostname):
        raise ValueError(label + " must have an authority")
    if parsed.netloc:
        parsed.port
    def ucschar(char, *, private=False):
        number = ord(char)
        if number < 128:
            return True
        ordinary = (0xA0 <= number <= 0xD7FF or 0xF900 <= number <= 0xFDCF
                    or 0xFDF0 <= number <= 0xFFEF
                    or 0x10000 <= number <= 0xDFFFD and number & 0xFFFF <= 0xFFFD
                    or 0xE1000 <= number <= 0xEFFFD)
        iprivate = (0xE000 <= number <= 0xF8FF or 0xF0000 <= number <= 0xFFFFD
                    or 0x100000 <= number <= 0x10FFFD)
        return ordinary or private and iprivate
    if any(not ucschar(char) for char in parsed.netloc + parsed.path + parsed.fragment):
        raise ValueError(label + " contains a character outside the RFC 3987 component grammar")
    if any(not ucschar(char, private=True) for char in parsed.query):
        raise ValueError(label + " contains a character outside the RFC 3987 query grammar")
    return value


def string_set(value, label):
    values = [value] if isinstance(value, str) else value
    if (not isinstance(values, list) or not values
            or any(not isinstance(item, str) or not item for item in values)
            or len(values) != len(set(values))):
        raise ValueError(label + " must be a nonempty string or unique string array")
    return tuple(values)


def operation_map():
    context = read(relative_file("av/support/upstream/wot/td-context.jsonld"))["@context"]["forms"]["@context"]
    return {key: str(TD[value[3:]]) for key, value in context.items()
            if key.islower() and isinstance(value, str) and value.startswith("td:")}


@diagnostic("AV_INVALID_DESCRIPTION", "native-resolution")
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
    uri_variables: dict = field(default_factory=dict)


def iri_identity(value, label):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    return absolute_iri(value, label)


@diagnostic("AV_INVALID_DESCRIPTION", "native-resolution")
def resolve_native_form(document_iri, form_iri, documents, *, operation=None, expected_source=None, parameters=None):
    """Resolve only supplied documents. No retrieval or native operation is performed."""
    document_iri = iri_identity(document_iri, "TD document")
    form_iri = iri_identity(form_iri, "Native Form identity")
    if operation is not None:
        operation = iri_identity(operation, "Native operation")
    if expected_source is not None:
        expected_source = iri_identity(expected_source, "Offer source")
    if document_iri not in documents:
        raise AVError("AV_UNRESOLVED_REFERENCE", "TD document unavailable in the explicit offline document map",
                      stage="native-resolution", location=document_iri)
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
        raise AVError("AV_AMBIGUOUS_FORM" if matches else "AV_UNRESOLVED_REFERENCE",
                      "Missing/ambiguous named native Form membership", stage="native-resolution", location=form_iri)
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
            members = string_set(definition[fields[0]], "Combo security members")
            if len(members) < 2:
                raise ValueError("Native combo security requires at least two members")
            for child in members:
                security_definition(child, (*ancestors, key))

    for key in security:
        security_definition(key)
    base = document.get("base", effective_url)
    absolute_iri(base, "Native TD base")
    href = form.get("href")
    if not isinstance(href, str) or not href:
        raise ValueError("Native Form href is required")
    effective = copy.deepcopy(form)
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
    response = effective.get("response")
    if response is None and "response" not in effective:
        effective["response"] = {"contentType": effective["contentType"]}
    elif not isinstance(response, dict) or not isinstance(response.get("contentType"), str) or not response["contentType"]:
        raise ValueError("A present native ExpectedResponse requires contentType")
    if "additionalResponses" in effective:
        if not isinstance(effective["additionalResponses"], list):
            raise ValueError("Native additionalResponses must be an array")
        for response in effective["additionalResponses"]:
            if not isinstance(response, dict):
                raise ValueError("Native AdditionalExpectedResponse must be an object")
            response.setdefault("success", False)
            response.setdefault("contentType", effective["contentType"])
            if type(response["success"]) is not bool or not isinstance(response["contentType"], str) or not response["contentType"]:
                raise ValueError("Invalid native AdditionalExpectedResponse")
    from native_parameters import parameterize
    href, variables = parameterize(document, affordance, kind, effective, effective_definitions, parameters, operation)
    effective["href"] = absolute_iri(urljoin(base, href), "Resolved native Form href")
    if parameters is not None and parameters.target_policy is not None:
        parameters.target_policy(effective["href"])
    owner = copy.deepcopy(affordance)
    defaults = ("safe", "idempotent") if kind == "actions" else ("readOnly", "writeOnly", "observable") if kind == "properties" else ()
    for key in defaults:
        owner.setdefault(key, False)
        if type(owner[key]) is not bool:
            raise ValueError("Native " + key + " must be boolean")
    return ResolvedForm(
        copy.deepcopy(document), document_iri, effective_url, owner,
        kind, name, effective, operations, operation,
        effective_definitions, variables,
    )


@diagnostic("AV_INVALID_DESCRIPTION", "native-resolution")
def resolve_form(reference, documents, *, parameters=None):
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
    from matching import record
    reference = record(reference, "FormReference")
    for key in required:
        reference[key] = iri_identity(reference[key], key)
    if reference["av:operation"] not in operation_map().values():
        raise ValueError("FormReference operation must be a standard native TD operation IRI")
    return resolve_native_form(reference["av:document"], reference["av:form"], documents,
                               operation=reference["av:operation"], parameters=parameters)


def directional_schema(schema, role):
    result = copy.deepcopy(schema)
    if not isinstance(result, dict):
        return result
    if isinstance(result.get("properties"), dict):
        forbidden = "writeOnly" if role == "result" else "readOnly"
        removed = {name for name, child in result["properties"].items()
                   if isinstance(child, dict) and child.get(forbidden) is True}
        result["properties"] = {name: directional_schema(child, role)
                                for name, child in result["properties"].items() if name not in removed}
        if "required" in result:
            result["required"] = [name for name in result["required"] if name not in removed]
    for key in ("items", "oneOf", "allOf", "anyOf", "not", "if", "then", "else",
                "additionalProperties", "unevaluatedProperties", "contains"):
        if key in result:
            value = result[key]
            result[key] = ([directional_schema(child, role) for child in value]
                           if isinstance(value, list) else directional_schema(value, role))
    for key in ("$defs", "definitions", "patternProperties", "dependentSchemas"):
        if isinstance(result.get(key), dict):
            result[key] = {name: directional_schema(child, role) for name, child in result[key].items()}
    return result


PROPERTY_VALUE_KEYS = frozenset("""
type const default unit oneOf enum format contentMediaType contentEncoding
minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minLength maxLength pattern
items minItems maxItems properties required additionalProperties minProperties maxProperties
uniqueItems allOf anyOf not $ref $defs
""".split())


def property_schema(affordance):
    if not PROPERTY_VALUE_KEYS.intersection(affordance):
        raise AVError("AV_UNKNOWN_PAYLOAD_SCHEMA", "Native payload schema is absent/unknown; no compatibility conclusion",
                      stage="native-payload")
    return {key: copy.deepcopy(value) for key, value in affordance.items()
            if key not in {"forms", "uriVariables", "readOnly", "writeOnly", "observable", "@id"}}


@dataclass(frozen=True)
class PayloadContract:
    schema: dict
    original_schema: dict
    document_iri: str
    effective_document_iri: str
    producer: str
    operation: str
    data_role: str
    schema_source: str
    content_type: str
    role: str
    td: dict

    def as_dict(self):
        return {
            "resultTD" if self.role == "result" else "destinationTD": copy.deepcopy(self.td),
            "document": self.document_iri, "effectiveDocument": self.effective_document_iri,
            "producer" if self.role == "result" else "receiver": self.producer,
            "operation": self.operation, "dataRole": self.data_role,
            "schemaSource": self.schema_source, "schema": copy.deepcopy(self.schema),
            "contentType": self.content_type, "role": self.role,
        }


@diagnostic("AV_INVALID_DESCRIPTION", "native-payload")
def native_payload_contract(resolved: ResolvedForm, role="result"):
    """Return the selected native producer/receiver and its directional schema source."""
    if role not in {"result", "destination"}:
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Unknown payload role", stage="native-payload")
    operation = resolved.operation
    if resolved.kind == "properties" and operation in (
        {str(TD.readProperty), str(TD.observeProperty)} if role == "result" else {str(TD.writeProperty)}
    ):
        schema = property_schema(resolved.affordance)
        data_role = "property-read" if role == "result" else "property-write"
        suffix = ""
    elif resolved.kind == "actions" and operation == str(TD.invokeAction):
        data_role = "output" if role == "result" else "input"
        suffix = "/" + data_role
        schema = resolved.affordance.get(data_role)
    elif resolved.kind == "events" and operation == str(TD.subscribeEvent) and role == "result":
        schema = resolved.affordance.get("data")
        data_role, suffix = "data", "/data"
    else:
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Unsupported native operation for this payload role", stage="native-payload")
    if not isinstance(schema, dict):
        raise AVError("AV_UNKNOWN_PAYLOAD_SCHEMA", "Native payload schema is absent/unknown; no compatibility conclusion",
                      stage="native-payload")
    projected = directional_schema(schema, role) if resolved.kind == "properties" else copy.deepcopy(schema)
    name = resolved.name.replace("~", "~0").replace("/", "~1")
    return PayloadContract(projected, copy.deepcopy(schema), resolved.document_iri, resolved.effective_document_iri,
                           resolved.document["id"], operation, data_role,
                           "/" + resolved.kind + "/" + name + suffix, resolved.form["contentType"], role,
                           copy.deepcopy(resolved.document))


def native_payload_schema(resolved: ResolvedForm, role="result"):
    return native_payload_contract(resolved, role).schema


def native_input_schema(affordance, kind, operation):
    if kind == "actions" and operation == str(TD.invokeAction) and isinstance(affordance.get("input"), dict):
        return copy.deepcopy(affordance["input"])
    if kind == "properties" and operation == str(TD.writeProperty):
        return directional_schema(property_schema(affordance), "destination")
    raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Selected operation has no supported native invocation input",
                  stage="native-parameters")


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def exact_integer(value) -> int:
    if type(value) is int and abs(value) <= SAFE_INTEGER:
        return value
    if (isinstance(value, dict) and set(value) == {"@value", "@type"}
            and value["@type"] == str(XSD.integer) and isinstance(value["@value"], str)
            and re.fullmatch(r"-?(0|[1-9][0-9]*)", value["@value"])):
        if len(value["@value"].lstrip("-")) > MAX_DIGITS:
            raise AVError("AV_RESOURCE_LIMIT", "Exact integer digit budget exceeded",
                          stage="numeric", limit="numeric-digits")
        return int(value["@value"])
    raise ValueError("Expected a safe native integer token or explicit xsd:integer lexical value")


def ration(numerator: int, denominator: int = 1):
    value = Fraction(numerator, denominator)
    return {"@type": "av:Rational", "av:numerator": value.numerator,
            "av:denominator": value.denominator}


@diagnostic("AV_INVALID_DESCRIPTION", "description")
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
