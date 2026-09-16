"""Offline whole-Mode metadata comparison, never scheduling or native execution."""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass
import re

from common import AV, TD, absolute_iri, exact_integer, nodes, ratio, validate_av_keys
from diagnostics import AVError, diagnostic
from json_format import unicode_scalar
from model import TERMS, uses_for
from schema_contract import (
    DIALECT, SCHEMA_ARRAYS, SCHEMA_KEYWORDS, SCHEMA_MAPS, SCHEMA_SINGLE, VOCABULARIES,
    matches_schema, schema_children, schema_validator,
)
DC = TERMS["prefixes"]["dcterms"]
TRACK_FIELDS = tuple(name for name, prop in TERMS["properties"].items() if "av:Track" in prop["uses"])


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def compact_record(value, label):
    if not isinstance(value, dict):
        raise ValueError(label + " must be a complete object; unresolved graph references are unsupported")
    validate_av_keys(value)
    result = {}
    for key, child in value.items():
        normalized = "av:" + key[len(str(AV)):] if key.startswith(str(AV)) else key
        for prefix in ("dcterms", "prov", "rdf"):
            namespace = TERMS["prefixes"][prefix]
            if key.startswith(namespace):
                normalized = prefix + ":" + key[len(namespace):]
        if normalized == "rdf:type":
            normalized = "@type"
            values = child if isinstance(child, list) else [child]
            child = [item["@id"] if isinstance(item, dict) and set(item) == {"@id"} else item for item in values]
        if normalized in result:
            raise ValueError("Duplicate compact/expanded property: " + normalized)
        result[normalized] = child
    return result


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def record(value, class_name):
    value = compact_record(value, class_name)
    definition = TERMS["classes"][class_name]
    if definition["identity"] == "iri":
        absolute_iri(value.get("@id"), class_name + " identity")
    elif "@id" in value:
        absolute_iri(value["@id"], class_name + " identity")
    types = value.get("@type", [])
    types = [types] if isinstance(types, str) else types
    if (not isinstance(types, list) or any(not isinstance(item, str) for item in types)
            or "@type" in value and (not types or len(types) != len(set(types)))):
        raise ValueError("Invalid @type on " + class_name)
    types = ["av:" + item[len(str(AV)):] if item.startswith(str(AV)) else item for item in types]
    if len(types) != len(set(types)):
        raise ValueError("Duplicate equivalent AV class type on " + class_name)
    if definition["identity"] == "iri" and "av:" + class_name not in types:
        raise ValueError(class_name + " requires its explicit class type")
    if any(item.startswith("av:") and item != "av:" + class_name for item in types):
        raise ValueError("Wrong or unknown AV class on " + class_name)
    if any(item.startswith(("https://example.org/wot/av#", "https://example.org/wot/av/"))
           for item in types):
        raise ValueError("Unknown or historical AV class on " + class_name)
    uses = uses_for("av:" + class_name)
    for key in value:
        if key.startswith("av:") and key not in uses:
            raise ValueError("AV property not allowed on " + class_name + ": " + key)
        if (definition["identity"] == "node" and key not in uses
                and key not in {"@id", "@type", "@context", "rdf:type"}):
            raise ValueError("Undeclared intrinsic-record property on " + class_name + ": " + key)
    for key, (prop, usage) in uses.items():
        if usage["min"] and key not in value:
            raise ValueError(class_name + " requires " + key)
        if key not in value:
            continue
        if value[key] is None:
            raise ValueError(key + " cannot be null")
        if prop.get("container") == "set":
            items = value[key]
            if (not isinstance(items, list) or len(items) < usage["min"]
                    or usage["max"] is not None and len(items) > usage["max"]):
                raise ValueError(key + " requires an array with the declared cardinality")
        elif isinstance(value[key], list):
            raise ValueError(key + " is single-valued")
        if prop["value"] == "string":
            if not isinstance(value[key], str):
                raise ValueError(key + " requires a string")
            unicode_scalar(value[key])
        if not key.startswith("av:") and prop["value"] == "node":
            items = value[key] if prop.get("container") == "set" else [value[key]]
            identities = [iri_value(item, key) for item in items]
            if len(identities) != len(set(identities)):
                raise ValueError("Duplicate external reference on " + key)
        if prop["value"] == "dateTime" and (
                not isinstance(value[key], str) or not re.search(r"(Z|[+-][0-9]{2}:[0-9]{2})$", value[key])):
            raise ValueError(key + " requires an explicit dateTime timezone")
    return value


def iri_value(value, label):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    return absolute_iri(value, label)


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def controlled(value, enum):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    if isinstance(value, str) and value.startswith(str(AV)):
        value = "av:" + value[len(str(AV)):]
    allowed = {"av:" + key for key in TERMS["enums"][enum]}
    if not isinstance(value, str) or value not in allowed:
        raise ValueError("Unknown or inapplicable " + enum + " IRI: " + str(value))
    return value


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def normalize_rational(value):
    value = record(value, "Rational")
    rate = ratio(value)
    if rate <= 0:
        raise ValueError("frameRate must be strictly positive")
    return {"av:numerator": rate.numerator, "av:denominator": rate.denominator}


@diagnostic("AV_INVALID_DESCRIPTION", "description")
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


def core_signature(value, class_name):
    value = record(value, class_name)
    fields = uses_for("av:" + class_name)

    def signature(item, prop, usage):
        if prop["value"] == "json":
            return freeze(item)
        if prop["value"] == "integer":
            return exact_integer(item)
        target = usage["range"]
        if isinstance(target, str) and target.startswith("av:") and target[3:] in TERMS["classes"]:
            return core_signature(item, target[3:])
        if prop["value"] == "node":
            if isinstance(target, str) and target.startswith("enum:") and target != "enum:NativeOperation":
                return controlled(item, target[5:])
            return iri_value(item, "Core identity")
        return item

    result = [("@id", value.get("@id")), ("@type", "av:" + class_name)]
    for key, (prop, usage) in fields.items():
        if key not in value or not (key.startswith("av:") or key == "dcterms:identifier"):
            continue
        item = value[key]
        normalized = (tuple(sorted((signature(child, prop, usage) for child in item), key=repr))
                      if prop.get("container") == "set" else signature(item, prop, usage))
        result.append((key, normalized))
    return tuple(sorted(result))


def freeze(value):
    if isinstance(value, dict):
        return tuple((key, freeze(child)) for key, child in sorted(value.items()))
    if isinstance(value, list):
        return tuple(freeze(child) for child in value)
    return (type(value).__name__, value)


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def identity_consistency(value, seen=None):
    seen = {} if seen is None else seen
    if isinstance(value, list):
        for child in value:
            identity_consistency(child, seen)
    elif isinstance(value, dict):
        compact = compact_record(value, "AV record")
        types = compact.get("@type", [])
        types = [types] if isinstance(types, str) else types
        classes = [name for name in TERMS["classes"] if "av:" + name in types or str(AV[name]) in types]
        if classes and "@id" in compact:
            signature = core_signature(compact, classes[0])
            identity = compact["@id"]
            if identity in seen and seen[identity] != signature:
                raise ValueError("Conflicting complete AV facts for reused identity: " + identity)
            seen[identity] = signature
        for key, child in compact.items():
            if key not in {"@context", "av:accepts", "@value"} and isinstance(child, (dict, list)):
                identity_consistency(child, seen)


def offer_descriptors(offer):
    offer = record(offer, "Offer")
    source = iri_value(offer["av:source"], "Offer source")
    iri_value(offer["av:document"], "Offer TD document")
    members = [record(item, "Mode") for item in offer["av:mode"]]
    identities = [item["@id"] for item in members]
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate Mode identity in Offer")
    descriptors = {}
    for mode in members:
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
        descriptors[mode["@id"]] = {
            "av:source": source, "av:kind": kind,
            "av:track": sorted(normalized, key=lambda item: item["dcterms:identifier"]),
        }
    identity_consistency(offer)
    return members, descriptors


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def normalize_mode(offer, mode):
    """Validate the whole Offer before returning one actual member's comparison value."""
    members, descriptors = offer_descriptors(offer)
    identity = mode if isinstance(mode, str) else record(mode, "Mode")["@id"]
    if identity not in descriptors:
        raise ValueError("Mode is not a unique complete advertised member of this Offer")
    if not isinstance(mode, str):
        member = next(item for item in members if item["@id"] == identity)
        if core_signature(mode, "Mode") != core_signature(member, "Mode"):
            raise ValueError("Mode is not the complete advertised member of this Offer")
    return descriptors[identity]


def match_mode(offer, mode, schema) -> bool:
    contract = schema_validator(schema)
    return contract.is_valid(normalize_mode(offer, mode))


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def validate_input(requirement, *, compile_schema=True):
    requirement = record(requirement, "InputRequirement")
    name = requirement.get("dcterms:identifier")
    if not isinstance(name, str) or not name:
        raise ValueError("InputRequirement requires a nonempty local identifier")
    controlled(requirement["av:presence"], "Presence")
    if compile_schema:
        schema_validator(requirement["av:accepts"])
    return requirement


@diagnostic("AV_INVALID_DESCRIPTION", "selection")
def matches_input(requirement, offer=None, mode=None) -> bool:
    """An omitted Optional input is allowed; an included input keeps its whole schema."""
    requirement = validate_input(requirement)
    if offer is None and mode is None:
        return controlled(requirement["av:presence"], "Presence") == "av:Optional"
    if offer is None or mode is None:
        raise ValueError("A selected input requires both an Offer and a complete Mode")
    return match_mode(offer, mode, requirement["av:accepts"])


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def validate_need(need):
    need = record(need, "Need")
    inputs = [validate_input(item, compile_schema=False) for item in need["av:input"]]
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
                reference[field] = iri_value(reference[field], field)
            operation = reference["av:operation"]
            if operation not in {
                TERMS["prefixes"]["td"] + name[3:] for name in TERMS["enums"]["NativeOperation"]
            }:
                raise ValueError("FormReference requires a native standard operation IRI")
            if operation not in ({
                    str(TD.readProperty), str(TD.observeProperty), str(TD.invokeAction), str(TD.subscribeEvent)
                    } if key == "av:result" else {str(TD.writeProperty), str(TD.invokeAction)}):
                raise ValueError("Inapplicable native operation for " + key)
    identity_consistency(need)
    for requirement in inputs:
        schema_validator(requirement["av:accepts"])
    return need


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def validate_offer(offer):
    offer = record(offer, "Offer")
    offer_descriptors(offer)
    return offer


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def record_index(documents):
    """Index only an explicitly supplied compact boundary, never retrieve or union graphs."""
    result = {}
    for document in documents:
        for node in nodes(document):
            types = node.get("@type", [])
            types = [types] if isinstance(types, str) else types
            classes = [name for name in TERMS["classes"] if "av:" + name in types or str(AV[name]) in types]
            if classes and "@id" in node:
                identity = absolute_iri(node["@id"])
                if identity in result and core_signature(result[identity], classes[0]) != core_signature(node, classes[0]):
                    raise ValueError("Conflicting AV records in the explicitly supplied boundary: " + identity)
                result[identity] = node
    return result


@diagnostic("AV_INVALID_DESCRIPTION", "description")
def validate_document(document, *, records=None):
    document = compact_record(document, "Document")
    for key, class_name, validate in (("av:offer", "Offer", validate_offer), ("av:need", "Need", validate_need)):
        items = document.get(key, [])
        if not isinstance(items, list):
            raise ValueError(key + " requires an unordered array")
        associated = []
        for item in items:
            if isinstance(item, str) or isinstance(item, dict) and set(item) == {"@id"}:
                identity = iri_value(item, class_name + " association")
                if records is None or identity not in records:
                    raise AVError("AV_UNRESOLVED_REFERENCE", "Associated AV record is unavailable in the explicit boundary",
                                  stage="description", location=identity)
                item = records[identity]
            associated.append(validate(item))
        identities = [item["@id"] for item in associated]
        if len(identities) != len(set(identities)):
            raise ValueError("Duplicate " + class_name + " association identity")
        if key == "av:offer" and "id" in document:
            for item in associated:
                if iri_value(item["av:source"], "Offer source") != document["id"]:
                    raise ValueError("Offer source differs from its containing Thing id")
    identity_consistency(document)
    return document


@dataclass(frozen=True)
class InputSelection:
    status: str
    input_id: str
    offer_id: str | None = None
    mode_id: str | None = None
    document: str | None = None
    form: str | None = None


@diagnostic("AV_INVALID_DESCRIPTION", "selection")
def select_inputs(need, selections):
    """Report complete explicit selections; the legacy Boolean helpers remain available."""
    need = validate_need(need)
    inputs = {item["dcterms:identifier"]: item for item in (validate_input(item) for item in need["av:input"])}
    if not isinstance(selections, Mapping) or set(selections) != set(inputs):
        raise ValueError("Every known input requires exactly one explicit selection or omission")
    result = {}
    for name, requirement in inputs.items():
        selected = selections[name]
        if selected is None:
            status = ("OMITTED_OPTIONAL" if controlled(requirement["av:presence"], "Presence") == "av:Optional"
                      else "UNSATISFIED_REQUIRED")
            result[name] = InputSelection(status, requirement["@id"])
            continue
        if not isinstance(selected, (tuple, list)) or len(selected) != 2 or any(item is None for item in selected):
            raise ValueError("A selected input requires both an Offer and a complete Mode")
        offer, mode = selected
        descriptor = normalize_mode(offer, mode)
        offer = record(offer, "Offer")
        mode_id = mode if isinstance(mode, str) else mode["@id"]
        member = next(record(item, "Mode") for item in offer["av:mode"] if item["@id"] == mode_id)
        status = "MATCH" if matches_schema(descriptor, requirement["av:accepts"]) else "NON_MATCH"
        result[name] = InputSelection(status, requirement["@id"], offer["@id"], mode_id,
                                      iri_value(offer["av:document"], "TD document"),
                                      iri_value(member["av:form"], "Mode Form"))
    return result
