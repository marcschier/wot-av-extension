"""The fixed AV 2020-12 contract, independent of installed handler inventories."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from urllib.parse import unquote, urldefrag, urljoin, urlsplit

from jsonschema import Draft202012Validator, SchemaError, ValidationError, validators
from referencing import Registry, Resource
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012

from diagnostics import AVError, diagnostic
from json_format import check_json_domain
from portable_regex import compile_pattern

DIALECT = "https://json-schema.org/draft/2020-12/schema"
SCHEMA_MAPS = frozenset({"$defs", "properties", "patternProperties", "dependentSchemas"})
SCHEMA_ARRAYS = frozenset({"allOf", "anyOf", "oneOf"})
SCHEMA_SINGLE = frozenset({
    "not", "if", "then", "else", "items", "contains", "additionalProperties",
    "propertyNames", "unevaluatedItems", "unevaluatedProperties", "contentSchema",
})
SCHEMA_KEYWORDS = frozenset("""
$schema $id $anchor $dynamicAnchor $ref $dynamicRef $defs $vocabulary $comment
type const enum minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
minLength maxLength pattern items contains minContains maxContains minItems maxItems
uniqueItems unevaluatedItems properties patternProperties additionalProperties
propertyNames required dependentRequired dependentSchemas minProperties maxProperties
unevaluatedProperties allOf anyOf oneOf not if then else title description default
deprecated readOnly writeOnly examples format contentEncoding contentMediaType contentSchema
""".split())
VOCABULARIES = frozenset(
    "https://json-schema.org/draft/2020-12/vocab/" + name for name in
    ("core", "applicator", "unevaluated", "validation", "meta-data", "format-annotation", "content")
)
SAME_INSTANCE = frozenset({"allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependentSchemas"})
ASSERTION_KEYWORDS = frozenset("""
$ref $dynamicRef additionalProperties allOf anyOf const contains dependentRequired
dependentSchemas enum exclusiveMaximum exclusiveMinimum if items maxItems maxLength
maxProperties maximum minItems minLength minProperties minimum multipleOf not oneOf
pattern patternProperties properties propertyNames required type unevaluatedItems
unevaluatedProperties uniqueItems
""".split())


@dataclass(frozen=True)
class ContractLimits:
    schema_locations: int = 4096
    evaluation_states: int = 200000
    regex_length: int = 1024
    regex_input: int = 4096
    regex_steps: int = 200000
    regex_repeat: int = 256

    def __post_init__(self):
        if any(type(value) is not int or value < 1 for value in vars(self).values()):
            raise ValueError("Contract limits must be positive integers")


def children(schema):
    for key in sorted(SCHEMA_MAPS):
        for name, value in sorted(schema.get(key, {}).items()):
            yield key, "/" + key + "/" + name.replace("~", "~0").replace("/", "~1"), value
    for key in sorted(SCHEMA_ARRAYS):
        for index, value in enumerate(schema.get(key, [])):
            yield key, "/" + key + "/" + str(index), value
    for key in sorted(SCHEMA_SINGLE):
        if key in schema:
            yield key, "/" + key, schema[key]


def schema_children(schema):
    return (value for _, _, value in children(schema))


def fail(code, message, location="", **context):
    raise AVError(code, message, stage="contract", location=location, **context)


def exact_domain(value):
    check_json_domain(value)
    if isinstance(value, float):
        raise AVError("AV_RESOURCE_LIMIT", "Exact decimal token unavailable for a host float; use strict_json or Decimal",
                      stage="numeric", limit="exact-number-input")
    if isinstance(value, dict):
        for child in value.values():
            exact_domain(child)
    elif isinstance(value, list):
        for child in value:
            exact_domain(child)


def meta_view(value):
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    if isinstance(value, dict):
        return {key: meta_view(child) for key, child in value.items()}
    if isinstance(value, list):
        return [meta_view(child) for child in value]
    return value


@diagnostic("AV_INVALID_CONTRACT", "contract")
def compile_contract(schema, *, limits=None):
    limits = ContractLimits() if limits is None else limits
    if ASSERTION_KEYWORDS - Draft202012Validator.VALIDATORS.keys():
        fail("AV_EDITION_INCONSISTENT", "The installed evaluator lacks a required AV assertion handler")
    if not isinstance(schema, dict):
        fail("AV_INVALID_CONTRACT", "accepts must be a JSON Schema object, not a boolean or RDF node")
    exact_domain(schema)
    if "$schema" in schema and not isinstance(schema["$schema"], str):
        fail("AV_INVALID_CONTRACT", "Invalid accepts dialect value; $schema must be a string", "/$schema")
    try:
        Draft202012Validator.check_schema(meta_view(schema), format_checker=None)
    except SchemaError as error:
        fail("AV_INVALID_CONTRACT", "Invalid JSON Schema 2020-12: " + error.message,
             "/" + "/".join(str(item) for item in error.absolute_path))
    if schema.get("$schema", DIALECT) != DIALECT:
        fail("AV_UNSUPPORTED_CONTRACT", "Unsupported accepts dialect; only JSON Schema 2020-12 is supported")

    schema = copy.deepcopy(schema)
    locations, resources, anchors, dynamics, edges, contexts = {}, {}, {}, {}, {}, {}
    patterns = {}

    def visit(node, path, base, explicit_base, resource_path):
        if len(locations) >= limits.schema_locations:
            fail("AV_RESOURCE_LIMIT", "Schema location budget exceeded", path,
                 limit="schema-locations", measured=len(locations) + 1)
        locations[path] = node
        edges[path] = set()
        if isinstance(node, bool):
            contexts[path] = (base, resource_path)
            return
        if "enum" in node and not node["enum"]:
            fail("AV_INVALID_CONTRACT", "The AV acceptance profile requires a nonempty enum", path + "/enum")
        unknown = set(node) - SCHEMA_KEYWORDS
        if "prefixItems" in unknown:
            fail("AV_UNSUPPORTED_CONTRACT", "Positional prefixItems is unsupported", path + "/prefixItems")
        if unknown:
            fail("AV_UNSUPPORTED_CONTRACT", "Unsupported JSON Schema keywords: " + ", ".join(sorted(unknown)), path)
        if "$schema" in node:
            if node["$schema"] != DIALECT:
                fail("AV_UNSUPPORTED_CONTRACT", "Unsupported accepts dialect", path + "/$schema")
            if path and "$id" not in node:
                fail("AV_INVALID_CONTRACT", "$schema is allowed only at a schema resource root", path + "/$schema")
        if "$vocabulary" in node:
            if path:
                fail("AV_INVALID_CONTRACT", "$vocabulary is allowed only at the accepts root", path + "/$vocabulary")
            vocabulary = node["$vocabulary"]
            if set(vocabulary) - VOCABULARIES:
                fail("AV_UNSUPPORTED_CONTRACT", "Unsupported JSON Schema vocabulary", path + "/$vocabulary")
            if vocabulary.get("https://json-schema.org/draft/2020-12/vocab/core") is not True:
                fail("AV_INVALID_CONTRACT", "$vocabulary requires the full core vocabulary with true", path)
        if "$id" in node:
            identifier = node["$id"]
            if re.search(r"[\x00-\x20<>\"{}|\\^`]", identifier) or re.search(r"%(?![0-9A-Fa-f]{2})", identifier):
                fail("AV_INVALID_CONTRACT", "Invalid schema resource URI", path + "/$id")
            if not urlsplit(identifier).scheme:
                if not path or not explicit_base:
                    fail("AV_UNSUPPORTED_CONTRACT", "Relative schema $id requires an explicit absolute ancestor", path)
                identifier = urljoin(base, identifier)
                if not urlsplit(identifier).scheme:
                    fail("AV_UNSUPPORTED_CONTRACT", "Ancestor cannot resolve this relative schema $id", path)
            identifier, fragment = urldefrag(identifier)
            if fragment:
                fail("AV_INVALID_CONTRACT", "A schema $id cannot have a nonempty fragment", path)
            if identifier in resources:
                fail("AV_INVALID_CONTRACT", "Duplicate schema resource identity", path + "/$id")
            base, resource_path, explicit_base = identifier, path, True
            resources[base] = path
        elif not path:
            resources[base] = path
        contexts[path] = (base, resource_path)
        for key in ("$anchor", "$dynamicAnchor"):
            if key in node:
                anchor = node[key]
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9._-]*", anchor):
                    fail("AV_INVALID_CONTRACT", "Invalid schema anchor", path + "/" + key)
                if (base, anchor) in anchors:
                    fail("AV_INVALID_CONTRACT", "Duplicate schema anchor", path + "/" + key)
                anchors[base, anchor] = path
                if key == "$dynamicAnchor":
                    dynamics.setdefault(anchor, set()).add(path)
        for key in ("$ref", "$dynamicRef"):
            if key in node and not node[key].startswith("#"):
                fail("AV_EXTERNAL_REFERENCE", "Only self-contained local schema references are supported", path + "/" + key)
        for pattern in ([node["pattern"]] if "pattern" in node else []) + list(node.get("patternProperties", {})):
            patterns[pattern] = compile_pattern(pattern, max_length=limits.regex_length, max_repeat=limits.regex_repeat)
        for keyword, suffix, child in children(node):
            child_path = path + suffix
            visit(child, child_path, base, explicit_base, resource_path)
            if keyword in SAME_INSTANCE:
                edges[path].add(child_path)

    visit(schema, "", "urn:av:accepts:anonymous", False, "")

    def resolve(ref, path):
        if re.search(r"%(?![0-9A-Fa-f]{2})", ref):
            fail("AV_INVALID_CONTRACT", "Invalid URI fragment escape", path)
        try:
            fragment = unquote(ref[1:], encoding="utf-8", errors="strict")
        except UnicodeError as error:
            fail("AV_INVALID_CONTRACT", "Invalid UTF-8 schema fragment: " + str(error), path)
        base, resource_path = contexts[path]
        if not fragment:
            target = resource_path
        elif fragment.startswith("/"):
            if re.search(r"~(?![01])", fragment):
                fail("AV_INVALID_CONTRACT", "Invalid local JSON Pointer escape", path)
            target = resource_path + fragment
        else:
            target = anchors.get((base, fragment))
        if target not in locations:
            fail("AV_INVALID_CONTRACT", "Unresolved local schema reference or non-schema target: " + ref, path)
        return target, fragment

    for path, node in locations.items():
        if isinstance(node, bool):
            continue
        for key in ("$ref", "$dynamicRef"):
            if key in node:
                target, fragment = resolve(node[key], path)
                edges[path].add(target)
                if key == "$dynamicRef" and isinstance(locations[target], dict) and locations[target].get("$dynamicAnchor") == fragment:
                    edges[path].update(dynamics.get(fragment, ()))
    active, visited = set(), set()

    def acyclic(path):
        if path in active:
            fail("AV_UNSUPPORTED_CONTRACT", "Unsupported non-progressing recursive schema evaluation",
                 path, reason="non-progressing-recursion")
        if path in visited:
            return
        active.add(path)
        for target in sorted(edges[path]):
            acyclic(target)
        active.remove(path)
        visited.add(path)

    for path in sorted(locations):
        acyclic(path)

    # The dialect has been checked; keeping it on subresources would let the
    # library switch away from this evaluator's exact arithmetic and budgets.
    for node in locations.values():
        if isinstance(node, dict):
            node.pop("$schema", None)

    def no_retrieval(uri):
        fail("AV_EXTERNAL_REFERENCE", "External schema retrieval is prohibited: " + uri)

    resource = Resource.from_contents(schema, default_specification=DRAFT202012)
    registry = Registry(retrieve=no_retrieval).with_resource(resource.id() or "urn:av:accepts:anonymous", resource).crawl()
    return CompiledContract(schema, registry, patterns, limits)


@dataclass(frozen=True)
class CompiledContract:
    _schema: dict
    _registry: Registry
    _patterns: dict
    limits: ContractLimits

    @property
    def schema(self):
        return copy.deepcopy(self._schema)

    @diagnostic("AV_INVALID_CONTRACT", "evaluation")
    def is_valid(self, instance):
        exact_domain(instance)
        counters = {"evaluation-states": 0, "regex-steps": 0}

        def tick(name="evaluation-states"):
            counters[name] += 1
            maximum = self.limits.evaluation_states if name == "evaluation-states" else self.limits.regex_steps
            if counters[name] > maximum:
                raise AVError("AV_RESOURCE_LIMIT", "Schema evaluation budget exceeded", stage="evaluation",
                              limit=name, measured=counters[name])

        def pattern_search(pattern, value):
            if len(value) > self.limits.regex_input:
                raise AVError("AV_RESOURCE_LIMIT", "Regexp input budget exceeded", stage="evaluation",
                              limit="regex-input", measured=len(value))
            return self._patterns[pattern].search(value, lambda: tick("regex-steps"))

        def pattern(validator, expression, value, schema):
            if isinstance(value, str) and not pattern_search(expression, value):
                yield ValidationError("String does not match the portable pattern")

        def multiple_of(validator, divisor, value, schema):
            if validator.is_type(value, "number") and (Fraction(value) / Fraction(divisor)).denominator != 1:
                yield ValidationError("Number is not an exact multipleOf")

        def pattern_properties(validator, mapping, value, schema):
            if isinstance(value, dict):
                for expression, subschema in mapping.items():
                    for name, child in value.items():
                        if pattern_search(expression, name):
                            yield from validator.descend(child, subschema, path=name, schema_path=expression)

        def additional_properties(validator, subschema, value, schema):
            if isinstance(value, dict):
                for name, child in value.items():
                    if name not in schema.get("properties", {}) and not any(
                            pattern_search(expression, name) for expression in schema.get("patternProperties", {})):
                        yield from validator.descend(child, subschema, path=name)

        def subvalidator(validator, schema):
            resource = Resource.from_contents(schema, default_specification=DRAFT202012)
            return validator.evolve(schema=schema, _resolver=validator._resolver.in_subresource(resource))

        def evaluated_properties(validator, value, schema):
            if isinstance(schema, bool):
                return set()
            found = set(schema.get("properties", {})) & value.keys()
            for ref in ("$ref", "$dynamicRef"):
                if ref in schema:
                    resolved = validator._resolver.lookup(schema[ref])
                    found |= evaluated_properties(validator.evolve(schema=resolved.contents, _resolver=resolved.resolver),
                                                  value, resolved.contents)
            for expression in schema.get("patternProperties", {}):
                found.update(name for name in value if pattern_search(expression, name))
            for keyword in ("additionalProperties", "unevaluatedProperties"):
                if keyword in schema:
                    for name, child in value.items():
                        if subvalidator(validator, schema[keyword]).is_valid(child):
                            found.add(name)
            for name, subschema in schema.get("dependentSchemas", {}).items():
                if name in value:
                    found |= evaluated_properties(subvalidator(validator, subschema), value, subschema)
            for keyword in ("allOf", "anyOf", "oneOf"):
                for subschema in schema.get(keyword, []):
                    child_validator = subvalidator(validator, subschema)
                    if child_validator.is_valid(value):
                        found |= evaluated_properties(child_validator, value, subschema)
            if "if" in schema:
                passed = subvalidator(validator, schema["if"]).is_valid(value)
                if passed:
                    found |= evaluated_properties(subvalidator(validator, schema["if"]), value, schema["if"])
                branch = "then" if passed else "else"
                if branch in schema:
                    found |= evaluated_properties(subvalidator(validator, schema[branch]), value, schema[branch])
            return found

        def unevaluated_properties(validator, subschema, value, schema):
            if isinstance(value, dict):
                for name in value.keys() - evaluated_properties(validator, value, schema):
                    yield from validator.descend(value[name], subschema, path=name)

        overrides = {"pattern": pattern, "multipleOf": multiple_of,
                     "patternProperties": pattern_properties, "additionalProperties": additional_properties,
                     "unevaluatedProperties": unevaluated_properties}

        def bounded(handler):
            def validate(validator, argument, value, schema):
                tick()
                yield from handler(validator, argument, value, schema)
            return validate

        handlers = {name: bounded(overrides.get(name, handler))
                    for name, handler in Draft202012Validator.VALIDATORS.items() if name in SCHEMA_KEYWORDS}
        checker = Draft202012Validator.TYPE_CHECKER.redefine(
            "integer", lambda _, value: type(value) is int or isinstance(value, Decimal) and value == value.to_integral_value())
        cls = validators.extend(Draft202012Validator, validators=handlers, type_checker=checker)
        try:
            return cls(self._schema, registry=self._registry, format_checker=None).is_valid(instance)
        except Unresolvable as error:
            raise AVError("AV_INVALID_CONTRACT", "Unresolved local schema reference",
                          stage="evaluation") from error


schema_validator = compile_contract


def matches_schema(descriptor, schema, *, limits=None):
    return compile_contract(schema, limits=limits).is_valid(descriptor)
