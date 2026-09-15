"""Offline whole-Mode metadata comparison, never scheduling or native execution."""

from __future__ import annotations

import copy
from collections.abc import Mapping

from jsonschema import Draft202012Validator, SchemaError
from referencing import Registry, Resource
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012

from common import AV, absolute_iri, exact_integer, ratio, validate_av_keys
from model import TERMS, uses_for

DIALECT = "https://json-schema.org/draft/2020-12/schema"
DC = TERMS["prefixes"]["dcterms"]
TRACK_FIELDS = tuple(name for name, prop in TERMS["properties"].items() if "av:Track" in prop["uses"])
SCHEMA_MAPS = {"$defs", "properties", "patternProperties", "dependentSchemas"}
SCHEMA_ARRAYS = {"allOf", "anyOf", "oneOf", "prefixItems"}
SCHEMA_SINGLE = {
    "not", "if", "then", "else", "items", "contains", "additionalProperties",
    "propertyNames", "unevaluatedItems", "unevaluatedProperties", "contentSchema",
}
SCHEMA_KEYWORDS = (
    set(Draft202012Validator.VALIDATORS)
    | SCHEMA_MAPS | SCHEMA_ARRAYS | SCHEMA_SINGLE
    | {"$schema", "$id", "$vocabulary", "$anchor", "$dynamicAnchor", "$defs", "$comment",
       "title", "description", "default", "deprecated", "readOnly", "writeOnly",
       "examples", "contentEncoding", "contentMediaType", "minContains", "maxContains"}
)
VOCABULARIES = {
    "https://json-schema.org/draft/2020-12/vocab/" + name
    for name in ("core", "applicator", "unevaluated", "validation", "meta-data",
                 "format-annotation", "content")
}


def compact_record(value, label):
    if not isinstance(value, dict):
        raise ValueError(label + " must be a complete object; unresolved graph references are unsupported")
    validate_av_keys(value)
    result = {}
    for key, child in value.items():
        normalized = "av:" + key[len(str(AV)):] if key.startswith(str(AV)) else key
        if key.startswith(DC):
            normalized = "dcterms:" + key[len(DC):]
        if normalized in result:
            raise ValueError("Duplicate compact/expanded property: " + normalized)
        result[normalized] = child
    return result


def record(value, class_name):
    value = compact_record(value, class_name)
    definition = TERMS["classes"][class_name]
    if definition["identity"] == "iri":
        absolute_iri(value.get("@id"), class_name + " identity")
    elif "@id" in value:
        absolute_iri(value["@id"], class_name + " identity")
    types = value.get("@type", [])
    types = [types] if isinstance(types, str) else types
    if not isinstance(types, list) or any(not isinstance(item, str) for item in types):
        raise ValueError("Invalid @type on " + class_name)
    types = ["av:" + item[len(str(AV)):] if item.startswith(str(AV)) else item for item in types]
    if definition["identity"] == "iri" and "av:" + class_name not in types:
        raise ValueError(class_name + " requires its explicit class type")
    if any(item.startswith("av:") and item != "av:" + class_name for item in types):
        raise ValueError("Wrong or unknown AV class on " + class_name)
    uses = uses_for("av:" + class_name)
    for key in value:
        if key.startswith("av:") and key not in uses:
            raise ValueError("AV property not allowed on " + class_name + ": " + key)
    for key, (prop, usage) in uses.items():
        if usage["min"] and key not in value:
            raise ValueError(class_name + " requires " + key)
        if key not in value:
            continue
        if prop.get("container") == "set":
            items = value[key]
            if not isinstance(items, list) or len(items) < usage["min"]:
                raise ValueError(key + " requires an array with the declared cardinality")
        elif isinstance(value[key], list):
            raise ValueError(key + " is single-valued")
    return value


def iri_value(value, label):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    return absolute_iri(value, label)


def controlled(value, enum):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    if isinstance(value, str) and value.startswith(str(AV)):
        value = "av:" + value[len(str(AV)):]
    allowed = {"av:" + key for key in TERMS["enums"][enum]}
    if not isinstance(value, str) or value not in allowed:
        raise ValueError("Unknown or inapplicable " + enum + " IRI: " + str(value))
    return value


def normalize_rational(value):
    value = record(value, "Rational")
    rate = ratio(value)
    if rate <= 0:
        raise ValueError("frameRate must be strictly positive")
    return {"av:numerator": rate.numerator, "av:denominator": rate.denominator}


def normalize_track(value, kind):
    value = record(value, "Track")
    name = value.get("dcterms:identifier")
    if not isinstance(name, str) or not name:
        raise ValueError("Track requires a nonempty dcterms:identifier string")
    representation = controlled(value["av:representation"], "Representation")
    rule = TERMS["representation_rules"][representation[3:]]
    required = {"av:" + key for key in rule["required"]}
    permitted = required | {"av:" + key for key in rule["optional"]} | {"av:representation"}
    fields = {key for key in value if key in {"av:" + name for name in TRACK_FIELDS}}
    if required - fields:
        raise ValueError("Incomplete concrete Track; missing " + ", ".join(sorted(required - fields)))
    if fields - permitted:
        raise ValueError("Inapplicable Track fields: " + ", ".join(sorted(fields - permitted)))
    result = {"dcterms:identifier": name}
    for field in TRACK_FIELDS:
        key = "av:" + field
        if key not in value:
            continue
        prop = TERMS["properties"][field]
        range_name = prop["uses"]["av:Track"]["range"]
        if prop["value"] == "integer":
            item = exact_integer(value[key])
            if item < prop.get("minimum", item):
                raise ValueError(key + " must be positive")
        elif range_name.startswith("enum:"):
            item = controlled(value[key], range_name[5:])
        elif field == "frameRate":
            item = normalize_rational(value[key])
        else:
            raise ValueError("Unsupported descriptor field: " + key)
        if field in rule["choices"] and item not in {"av:" + choice for choice in rule["choices"][field]}:
            raise ValueError("Representation-specific " + key + " is invalid")
        result[key] = item
    if kind == "av:Still" and (representation not in {"av:EncodedVideo", "av:RawVideo"}
                              or "av:cadence" in result or "av:frameRate" in result):
        raise ValueError("Still permits image Tracks only, without cadence or frameRate")
    if (result.get("av:cadence") == "av:Constant") != ("av:frameRate" in result):
        raise ValueError("Exactly Constant cadence requires frameRate")
    expected_channels = {"av:Mono": 1, "av:StereoLR": 2}.get(result.get("av:channelLayout"))
    if expected_channels is not None and result["av:channels"] != expected_channels:
        raise ValueError("Audio channel count disagrees with channelLayout")
    return result


def normalize_mode(offer, mode):
    """Return the fixed descriptor of one actual Mode member of this Offer."""
    offer = record(offer, "Offer")
    source = iri_value(offer["av:source"], "Offer source")
    iri_value(offer["av:document"], "Offer TD document")
    members = [record(item, "Mode") for item in offer["av:mode"]]
    identities = [item["@id"] for item in members]
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate Mode identity in Offer")
    if isinstance(mode, str):
        matching = [item for item in members if item["@id"] == mode]
        if len(matching) != 1:
            raise ValueError("Mode is not a unique member of this Offer")
        mode = matching[0]
    else:
        mode = record(mode, "Mode")
        if mode not in members:
            raise ValueError("Mode is not the complete advertised member of this Offer")
    kind = controlled(mode["av:kind"], "MediaKind")
    iri_value(mode["av:form"], "Mode native Form")
    tracks = [record(item, "Track") for item in mode["av:track"]]
    ids = [item["@id"] for item in tracks]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate Track identity within a Mode")
    normalized = [normalize_track(item, kind) for item in tracks]
    names = [item["dcterms:identifier"] for item in normalized]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate Track dcterms:identifier within a Mode")
    return {"av:source": source, "av:kind": kind,
            "av:track": sorted(normalized, key=lambda item: item["dcterms:identifier"])}


def schema_children(schema):
    for keyword in SCHEMA_MAPS:
        yield from schema.get(keyword, {}).values()
    for keyword in SCHEMA_ARRAYS:
        yield from schema.get(keyword, [])
    for keyword in SCHEMA_SINGLE:
        if keyword in schema:
            yield schema[keyword]


def schema_validator(schema):
    if not isinstance(schema, dict):
        raise ValueError("accepts must be a JSON Schema object, not a boolean or RDF node")
    if schema.get("$schema", DIALECT) != DIALECT:
        raise ValueError("Unsupported accepts dialect; only JSON Schema 2020-12 is supported")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as error:
        raise ValueError("Invalid JSON Schema 2020-12: " + error.message) from error

    def no_retrieval(uri):
        raise ValueError("External schema retrieval is prohibited: " + uri)

    def precheck(node):
        if isinstance(node, bool):
            return
        if not isinstance(node, dict):
            raise ValueError("Local reference does not identify a schema")
        if node.get("$schema", DIALECT) != DIALECT:
            raise ValueError("Unsupported accepts dialect; only JSON Schema 2020-12 is supported")
        unknown = set(node) - SCHEMA_KEYWORDS
        if unknown:
            raise ValueError("Unsupported JSON Schema keywords: " + ", ".join(sorted(unknown)))
        if "prefixItems" in node:
            raise ValueError("Positional prefixItems is unsupported: track array order has no semantic contract")
        if set(node.get("$vocabulary", {})) - VOCABULARIES:
            raise ValueError("Unsupported JSON Schema vocabulary; format assertions are not enabled")
        for key in ("$ref", "$dynamicRef"):
            if key in node and (not isinstance(node[key], str) or not node[key].startswith("#")):
                raise ValueError("Only self-contained local schema references are supported")
        for child in schema_children(node):
            precheck(child)

    precheck(schema)
    resource = Resource.from_contents(schema, default_specification=DRAFT202012)
    registry = Registry(retrieve=no_retrieval).with_resource(resource.id() or "urn:av:accepts", resource).crawl()
    inspected = set()

    def inspect(node, resolver, *, root=False):
        if isinstance(node, bool) or id(node) in inspected:
            return
        inspected.add(id(node))
        precheck(node)
        if not root:
            resolver = resolver.in_subresource(Resource.from_contents(node, default_specification=DRAFT202012))
        for key in ("$ref", "$dynamicRef"):
            if key in node:
                ref = node[key]
                try:
                    resolved = resolver.lookup(ref)
                except Unresolvable as error:
                    raise ValueError("Unresolved local schema reference: " + ref) from error
                target = resolved.contents
                if not isinstance(target, (dict, bool)):
                    raise ValueError("Local reference does not identify a schema: " + ref)
                inspect(target, resolved.resolver, root=True)
        for child in schema_children(node):
            inspect(child, resolver)

    inspect(schema, registry.resolver_with_root(resource), root=True)
    return Draft202012Validator(copy.deepcopy(schema), registry=registry)


def matches_schema(descriptor, schema) -> bool:
    """Defaults and format remain annotations. Invalid/unsupported schemas raise."""
    validator = schema_validator(schema)
    try:
        return validator.is_valid(descriptor)
    except (Unresolvable, RecursionError) as error:
        raise ValueError("Unsupported or unresolved recursive schema evaluation") from error


def match_mode(offer, mode, schema) -> bool:
    return matches_schema(normalize_mode(offer, mode), schema)


def validate_input(requirement):
    requirement = record(requirement, "InputRequirement")
    name = requirement.get("dcterms:identifier")
    if not isinstance(name, str) or not name:
        raise ValueError("InputRequirement requires a nonempty local identifier")
    controlled(requirement["av:presence"], "Presence")
    schema_validator(requirement["av:accepts"])
    return requirement


def matches_input(requirement, offer=None, mode=None) -> bool:
    """An omitted Optional input is allowed; an included input keeps its whole schema."""
    requirement = validate_input(requirement)
    if offer is None and mode is None:
        return controlled(requirement["av:presence"], "Presence") == "av:Optional"
    if offer is None or mode is None:
        raise ValueError("A selected input requires both an Offer and a complete Mode")
    return match_mode(offer, mode, requirement["av:accepts"])


def validate_need(need):
    need = record(need, "Need")
    inputs = [validate_input(item) for item in need["av:input"]]
    for key in ("@id", "dcterms:identifier"):
        values = [item[key] for item in inputs]
        if len(values) != len(set(values)):
            raise ValueError("Duplicate input " + key + " within Need")
    if "av:processor" in need:
        iri_value(need["av:processor"], "Requested processor Thing")
    if "av:destination" in need and "av:result" not in need:
        raise ValueError("destination requires result on the same Need")
    for key in ("av:result", "av:destination"):
        if key in need:
            reference = record(need[key], "FormReference")
            for field in ("av:document", "av:form", "av:operation"):
                iri_value(reference[field], field)
            if reference["av:operation"] not in {
                TERMS["prefixes"]["td"] + name[3:] for name in TERMS["enums"]["NativeOperation"]
            }:
                raise ValueError("FormReference requires a native standard operation IRI")
    return need


def validate_offer(offer):
    offer = record(offer, "Offer")
    for mode in offer["av:mode"]:
        normalize_mode(offer, mode)
    return offer
