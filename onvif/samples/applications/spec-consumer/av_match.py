"""Independent, explicitly limited compact AV matcher and native Form resolver."""

import argparse
import copy
import json
import math
import re
from urllib.parse import urljoin, urlsplit

import uri_template
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from public_contract import ConsumerError, fail, read_json


AV = "https://example.org/wot/av/0.2#"
DIALECT = "https://json-schema.org/draft/2020-12/schema"
FIELDS = {
    "representation", "width", "height", "codec", "pixelFormat", "cadence",
    "frameRate", "sampleRate", "channels", "channelLayout", "sampleFormat", "bufferLayout"
}
CONTROLS = {
    "Live", "Still", "Clip", "EncodedVideo", "RawVideo", "EncodedAudio", "PCM",
    "H264", "JPEG", "AAC", "H265", "Opus", "BGR8", "RGB8", "Mono8", "YUV420P",
    "Constant", "Variable", "Triggered", "Mono", "StereoLR", "S16LE", "F32LE",
    "Contiguous", "Strided", "Interleaved", "Planar", "Required", "Optional"
}
KEYWORDS = set((
    "$schema $id $anchor $dynamicAnchor $ref $dynamicRef $defs $vocabulary $comment "
    "type const enum minimum maximum exclusiveMinimum exclusiveMaximum multipleOf "
    "minLength maxLength pattern items contains minContains maxContains minItems maxItems "
    "uniqueItems unevaluatedItems properties patternProperties additionalProperties propertyNames "
    "required dependentRequired dependentSchemas minProperties maxProperties unevaluatedProperties "
    "allOf anyOf oneOf not if then else title description default deprecated readOnly writeOnly "
    "examples format contentEncoding contentMediaType contentSchema"
).split())


def absolute(value):
    if not isinstance(value, str) or not urlsplit(value).scheme:
        fail("InvalidValue", "Expected absolute identity")
    return value


def compact(record):
    if not isinstance(record, dict):
        fail("InvalidValue", "Expected complete compact record")
    result = {}
    for key, value in record.items():
        key = "av:" + key[len(AV):] if key.startswith(AV) else key
        if key in result:
            fail("InvalidValue", "Aliased AV property collision")
        result[key] = value
    return result


def control(value):
    if isinstance(value, dict) and set(value) == {"@id"}:
        value = value["@id"]
    if not isinstance(value, str):
        fail("InvalidValue", "Expected AV controlled value")
    token = value[len(AV):] if value.startswith(AV) else value[3:] if value.startswith("av:") else None
    if token not in CONTROLS:
        fail("InvalidValue", "Unknown AV controlled value")
    return "av:" + token


def integer(value):
    if isinstance(value, dict) and set(value) == {"@type", "@value"}:
        if value["@type"] != "http://www.w3.org/2001/XMLSchema#integer":
            fail("InvalidValue", "Wrong exact integer datatype")
        lexical = value["@value"]
        if not isinstance(lexical, str) or not re.fullmatch(r"-?(0|[1-9][0-9]*)", lexical):
            fail("InvalidValue", "Invalid compact integer lexical form")
        if len(lexical) > 1024:
            fail("ResourceLimit", "Integer digit limit")
        value = int(lexical)
    elif type(value) is not int or abs(value) > 9007199254740991:
        fail("InvalidValue", "AV facts require safe integer tokens or exact typed integers")
    if value <= 0:
        fail("InvalidValue", "AV integer fact must be positive")
    return value


def record(value, kind, fields):
    value = compact(value)
    absolute(value.get("@id"))
    types = value.get("@type")
    types = [types] if isinstance(types, str) else types
    if not isinstance(types, list) or len(types) != len(set(types)):
        fail("InvalidValue", "Invalid AV type set")
    expected = ["av:" + kind, AV + kind]
    if sum(item in expected for item in types) != 1:
        fail("InvalidValue", "Missing exact AV class")
    if any((item.startswith("av:") or item.startswith(AV)) and item not in expected for item in types):
        fail("InvalidValue", "Conflicting reserved AV type")
    if any(key.startswith("av:") and key[3:] not in fields for key in value):
        fail("InvalidValue", "Unexpected reserved AV property")
    return value


def compile_contract(schema):
    if not isinstance(schema, dict):
        fail("InvalidContract", "Accepts root must be an object")
    schema = copy.deepcopy(schema)
    unsupported = {"$id", "$anchor", "$dynamicAnchor", "$ref", "$dynamicRef",
                   "$vocabulary", "pattern", "patternProperties"}

    def visit(value, depth=0):
        if depth > 32:
            fail("ResourceLimit", "Schema nesting bound")
        if type(value) is bool:
            return
        if not isinstance(value, dict):
            fail("InvalidContract", "Invalid schema position")
        if set(value) - KEYWORDS or set(value) & unsupported:
            fail("UnsupportedCapability", "Contract keyword is outside the documented matcher subset")
        if "$schema" in value and value["$schema"] != DIALECT:
            fail("UnsupportedCapability", "Unsupported schema dialect")
        for key in ("$defs", "properties", "dependentSchemas"):
            for child in value.get(key, {}).values():
                visit(child, depth + 1)
        for key in ("allOf", "anyOf", "oneOf"):
            for child in value.get(key, []):
                visit(child, depth + 1)
        for key in ("items", "contains", "unevaluatedItems", "additionalProperties",
                    "propertyNames", "unevaluatedProperties", "not", "if", "then", "else", "contentSchema"):
            if key in value:
                visit(value[key], depth + 1)

    def exact(value):
        if isinstance(value, float):
            fail("UnsupportedCapability", "This bounded sample accepts integer-only schema numbers")
        if isinstance(value, dict):
            for item in value.values():
                exact(item)
        if isinstance(value, list):
            for item in value:
                exact(item)

    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as error:
        raise ConsumerError("InvalidContract", "JSON Schema meta-validation failed") from error
    visit(schema)
    exact(schema)
    return Draft202012Validator(schema)


def normalize(offer, mode_id, terms):
    offer = record(offer, "Offer", {"source", "document", "mode"})
    source = offer.get("av:source")
    if isinstance(source, dict) and set(source) == {"@id"}:
        source = source["@id"]
    source = absolute(source)
    absolute(offer.get("av:document"))
    modes = offer.get("av:mode")
    if not isinstance(modes, list) or not modes:
        fail("InvalidValue", "Offer requires complete Modes")
    results, identities = {}, {}
    rules = terms["representation_rules"]
    for raw_mode in modes:
        mode = record(raw_mode, "Mode", {"kind", "form", "track"})
        if mode["@id"] in results:
            fail("InvalidValue", "Duplicate Mode identity")
        absolute(mode.get("av:form"))
        kind = control(mode.get("av:kind"))
        if kind not in ("av:Live", "av:Still", "av:Clip"):
            fail("InvalidValue", "Invalid media kind")
        tracks = mode.get("av:track")
        if not isinstance(tracks, list) or not tracks:
            fail("InvalidValue", "Mode requires a complete Track roster")
        names, ids, normalized = set(), set(), []
        for raw_track in tracks:
            track = record(raw_track, "Track", FIELDS)
            name = track.get("dcterms:identifier")
            if not isinstance(name, str) or not name or name in names or track["@id"] in ids:
                fail("InvalidValue", "Missing or duplicate Track identity/name")
            names.add(name)
            ids.add(track["@id"])
            representation = control(track.get("av:representation"))
            if representation[3:] not in rules:
                fail("InvalidValue", "Invalid Track representation")
            rule = rules[representation[3:]]
            present = {key[3:] for key in track if key.startswith("av:")}
            if not set(rule["required"]) <= present:
                fail("InvalidValue", "Missing essential representation fact")
            if present - (set(rule["required"]) | set(rule["optional"]) | {"representation"}):
                fail("InvalidValue", "Forbidden representation fact")
            item = {"dcterms:identifier": name, "av:representation": representation}
            for field in present - {"representation"}:
                value = track["av:" + field]
                if field in ("width", "height", "sampleRate", "channels"):
                    value = integer(value)
                elif field == "frameRate":
                    rate = compact(value)
                    if set(rate) - {"@id", "@type", "av:numerator", "av:denominator"}:
                        fail("InvalidValue", "Unexpected Rational field")
                    numerator, denominator = integer(rate.get("av:numerator")), integer(rate.get("av:denominator"))
                    if math.gcd(numerator, denominator) != 1:
                        fail("InvalidValue", "Frame rate is not reduced")
                    value = {"av:numerator": numerator, "av:denominator": denominator}
                else:
                    value = control(value)
                item["av:" + field] = value
            for field, choices in rule["choices"].items():
                if item["av:" + field] not in {"av:" + choice for choice in choices}:
                    fail("InvalidValue", "Representation controlled choice mismatch")
            for field, choices in (
                ("pixelFormat", {"av:BGR8", "av:RGB8", "av:Mono8", "av:YUV420P"}),
                ("sampleFormat", {"av:S16LE", "av:F32LE"})
            ):
                if "av:" + field in item and item["av:" + field] not in choices:
                    fail("InvalidValue", "Invalid representation format")
            audio = representation in ("av:EncodedAudio", "av:PCM")
            if audio and item["av:channelLayout"] != {1: "av:Mono", 2: "av:StereoLR"}.get(item["av:channels"]):
                fail("InvalidValue", "Channel count/layout mismatch")
            if kind == "av:Still" and (audio or "cadence" in present or "frameRate" in present):
                fail("InvalidValue", "Invalid Still roster or cadence")
            cadence = item.get("av:cadence")
            if cadence is not None and cadence not in ("av:Constant", "av:Variable", "av:Triggered"):
                fail("InvalidValue", "Invalid cadence")
            if (cadence == "av:Constant") != ("av:frameRate" in item):
                fail("InvalidValue", "Constant cadence requires exactly one exact rate")
            if track["@id"] in identities and identities[track["@id"]] != item:
                fail("InvalidValue", "Contradictory Track identity across Modes")
            identities[track["@id"]] = item
            normalized.append(item)
        results[mode["@id"]] = {
            "av:source": source, "av:kind": kind,
            "av:track": sorted(normalized, key=lambda item: item["dcterms:identifier"])
        }
    if mode_id not in results:
        fail("InvalidValue", "Selected Mode is not an actual member")
    return results[mode_id]


def match(offer, mode_id, need, terms):
    need = record(need, "Need", {"processor", "input"})
    inputs = need.get("av:input")
    if not isinstance(inputs, list) or not inputs:
        fail("InvalidValue", "Need requires inputs")
    compiled, names, identities = [], set(), set()
    for raw in inputs:
        item = record(raw, "InputRequirement", {"presence", "accepts", "result", "destination"})
        name = item.get("dcterms:identifier")
        if not isinstance(name, str) or not name or name in names or item["@id"] in identities:
            fail("InvalidValue", "Duplicate or absent input identity/name")
        names.add(name)
        identities.add(item["@id"])
        if control(item.get("av:presence")) not in ("av:Required", "av:Optional"):
            fail("InvalidValue", "Invalid input presence")
        if "av:result" in item or "av:destination" in item:
            fail("UnsupportedCapability", "Directional payload matching is outside this pilot")
        compiled.append(compile_contract(item.get("av:accepts")))
    if len(compiled) != 1:
        fail("UnsupportedCapability", "CLI pilot selects one supplied input, not a multi-input assignment")
    comparison = normalize(offer, mode_id, terms)
    return "MATCH" if compiled[0].is_valid(comparison) else "NON_MATCH"


def resolve_form(td, document, form_id, variables, required):
    memberships = []
    for form in td.get("forms", []):
        memberships.append((td, form))
    for group in ("properties", "actions", "events"):
        for owner in td.get(group, {}).values():
            for form in owner.get("forms", []):
                memberships.append((owner, form))
    matches = [(owner, form) for owner, form in memberships if form.get("@id") == form_id]
    if len(matches) != 1:
        fail("InvalidContract", "Native Form identity is unresolved or ambiguous")
    owner, form = matches[0]
    definitions = dict(td.get("uriVariables", {}))
    definitions.update(owner.get("uriVariables", {}))
    template_names = set()
    for expression in re.findall(r"\{([^}]+)\}", form["href"]):
        for specification in expression.lstrip("+#./;?&").split(","):
            template_names.add(specification.split(":", 1)[0].rstrip("*"))
    if template_names - set(definitions):
        fail("InvalidContract", "Undeclared ordinary URI variable")
    if set(required) - set(variables) or any(variables.get(name) is None for name in required):
        fail("InvalidValue", "AV_MISSING_NATIVE_PARAMETER")
    lexical = {}
    for name in template_names:
        schema = definitions[name]
        if schema.get("type") in ("object", "array"):
            fail("InvalidContract", "TD URI variable cannot be structured")
        if name not in variables or variables[name] is None:
            continue
        value = variables[name]
        if not Draft202012Validator(schema).is_valid(value):
            fail("InvalidValue", "AV_INVALID_NATIVE_PARAMETER")
        if isinstance(value, str):
            lexical[name] = value
        elif type(value) is bool:
            lexical[name] = "true" if value else "false"
        elif type(value) is int:
            lexical[name] = str(value)
        else:
            fail("UnsupportedCapability", "Noninteger numeric URI values exceed this pilot")
    target = urljoin(td.get("base", document), uri_template.expand(form["href"], **lexical))
    absolute(target)
    return {"href": target, "form": copy.deepcopy(form), "owner": copy.deepcopy(owner),
            "security": copy.deepcopy(form.get("security", td.get("security")))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offer", required=True)
    parser.add_argument("--need", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    try:
        offer, terms = read_json(args.offer), read_json(args.terms)
        outcome = match(offer, args.mode, read_json(args.need), terms)
        print(json.dumps({"outcome": outcome, "comparison": normalize(offer, args.mode, terms)}, indent=4))
    except ConsumerError as error:
        print(json.dumps({"error": error.category, "message": str(error)}, indent=4))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
