"""Explicit native invocation context and RFC 6570 scalar URI-template expansion."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from urllib.parse import quote

from jsonschema import Draft7Validator, SchemaError
from referencing import Registry
from referencing.exceptions import Unresolvable

from diagnostics import AVError, diagnostic
from json_format import check_json_domain, numeric_limit

Scalar = str | int | bool | Decimal | None
ABSENT = object()


@dataclass(frozen=True)
class InvocationParameters:
    uri_variables: Mapping[str, Scalar] = field(default_factory=dict)
    required_uri_variables: tuple[str, ...] = ()
    input: object = ABSENT
    security_variables: Mapping[str, str] = field(default_factory=dict, repr=False)
    target_policy: Callable[[str], None] | None = field(default=None, repr=False)


OPERATORS = {
    "": ("", ",", False, False), "+": ("", ",", False, True),
    "#": ("#", ",", False, True), ".": (".", ".", False, False),
    "/": ("/", "/", False, False), ";": (";", ";", True, False),
    "?": ("?", "&", True, False), "&": ("&", "&", True, False),
}
RESERVED = ":/?#[]@!$&'()*+,;="
VARIABLE = r"(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})|\.(?=[A-Za-z0-9_%]))*"
EXPRESSION = re.compile(r"([+#./;?&]?)(.+)")
VARSPEC = re.compile("(" + VARIABLE + r")(?:(\*)|:([1-9][0-9]{0,3}))?")


def template_expressions(template):
    offset = 0
    for match in re.finditer(r"\{([^{}]*)\}", template):
        if "{" in template[offset:match.start()] or "}" in template[offset:match.start()]:
            raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Malformed URI template", stage="native-parameters")
        expression = EXPRESSION.fullmatch(match[1])
        if expression is None:
            raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Unsupported URI template expression", stage="native-parameters")
        operator, variables = expression.groups()
        entries = []
        for item in variables.split(","):
            parsed = VARSPEC.fullmatch(item)
            if parsed is None:
                raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Unsupported URI template variable/modifier",
                              stage="native-parameters")
            entries.append((parsed[1], int(parsed[3]) if parsed[3] else None))
        yield match, operator, entries
        offset = match.end()
    if "{" in template[offset:] or "}" in template[offset:]:
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Malformed URI template", stage="native-parameters")


def scalar_text(value):
    check_json_domain(value)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if isinstance(value, Decimal):
        numeric_limit(value)
        if not value:
            return "0"
        text = format(value, "f")
        return text.rstrip("0").rstrip(".") if "." in text else text
    raise AVError("AV_INVALID_NATIVE_PARAMETER", "Native URI variable must be an exact JSON scalar",
                  stage="native-parameters")


def expand_template(template, values):
    if not isinstance(template, str) or len(template) > 16384:
        raise AVError("AV_RESOURCE_LIMIT", "Native template length budget exceeded",
                      stage="native-parameters", limit="template-length")
    result, offset = [], 0
    for match, operator, variables in template_expressions(template):
        result.append(template[offset:match.start()])
        prefix, separator, named, reserved = OPERATORS[operator]
        parts = []
        for name, length in variables:
            value = scalar_text(values.get(name))
            if value is None:
                continue
            if length is not None:
                value = value[:length]
            encoded = quote(value, safe=RESERVED if reserved else "", encoding="utf-8", errors="strict")
            if named:
                encoded = name + ("" if operator == ";" and not encoded else "=" + encoded)
            parts.append(encoded)
        if parts:
            result.append(prefix + separator.join(parts))
        offset = match.end()
    result.append(template[offset:])
    expanded = "".join(result)
    if len(expanded) > 65536:
        raise AVError("AV_RESOURCE_LIMIT", "Expanded native target budget exceeded",
                      stage="native-parameters", limit="expanded-uri-length", measured=len(expanded))
    return expanded


def native_value_valid(value, schema):
    """Native TD schemas are not subjected to the AV acceptance keyword profile."""
    from jsonschema import validators
    from fractions import Fraction
    from jsonschema import ValidationError

    def multiple_of(validator, divisor, instance, _):
        if validator.is_type(instance, "number") and (Fraction(instance) / Fraction(divisor)).denominator != 1:
            yield ValidationError("Native value is not an exact multiple")

    checker = Draft7Validator.TYPE_CHECKER.redefine(
        "integer", lambda _, item: type(item) is int or isinstance(item, Decimal) and item == item.to_integral_value())
    validator = validators.extend(Draft7Validator, {"multipleOf": multiple_of}, type_checker=checker)
    def no_retrieval(uri):
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Native schema dependency is not in the explicit input boundary",
                      stage="native-parameters")

    try:
        return validator(schema, format_checker=None, registry=Registry(retrieve=no_retrieval)).is_valid(value)
    except Unresolvable as error:
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Native schema reference is not resolvable in the explicit boundary",
                      stage="native-parameters") from error


@diagnostic("AV_INVALID_NATIVE_PARAMETER", "native-parameters")
def parameterize(document, affordance, kind, form, security_definitions, parameters=None, operation=None):
    supplied_context = parameters is not None
    parameters = InvocationParameters() if parameters is None else parameters
    if not isinstance(parameters, InvocationParameters):
        raise ValueError("parameters must be an InvocationParameters instance")
    root_variables = document.get("uriVariables", {})
    owner_variables = affordance.get("uriVariables", {}) if kind != "thing" else {}
    if not isinstance(root_variables, dict) or not isinstance(owner_variables, dict):
        raise AVError("AV_INVALID_DESCRIPTION", "Native uriVariables must be a map", stage="native-resolution")
    effective = {**root_variables, **owner_variables}
    for name, schema in effective.items():
        if not isinstance(schema, dict):
            raise AVError("AV_INVALID_DESCRIPTION", "Native URI variable schema must be an object",
                          stage="native-resolution", location="/uriVariables/" + name)
        try:
            Draft7Validator.check_schema(schema, format_checker=None)
        except SchemaError as error:
            raise AVError("AV_INVALID_DESCRIPTION", "Native URI variable has an invalid DataSchema",
                          stage="native-resolution", location="/uriVariables/" + name) from error
        types = schema.get("type", [])
        types = [types] if isinstance(types, str) else types
        if any(item in {"object", "array"} for item in types):
            raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Native URI variables cannot use array/object schemas",
                          stage="native-parameters")
    secret_names = {item["name"] for item in security_definitions.values()
                    if item.get("in") == "uri" and isinstance(item.get("name"), str)}
    if secret_names & effective.keys():
        raise AVError("AV_INVALID_DESCRIPTION", "Security and ordinary URI variable names must be distinct",
                      stage="native-resolution")
    ordinary = dict(parameters.uri_variables)
    secrets = dict(parameters.security_variables)
    if ordinary.keys() - effective.keys() or secrets.keys() - secret_names:
        raise ValueError("Supplied native URI parameter has no applicable declaration")
    href = form["href"]
    template_names = {name for _, _, entries in template_expressions(href) for name, _ in entries}
    undeclared = template_names - effective.keys() - secret_names
    if undeclared:
        raise AVError("AV_UNSUPPORTED_NATIVE_ACCESS", "Unsupported URI template: undeclared native variables",
                      stage="native-parameters", location="/uriVariables")
    if template_names and not supplied_context:
        raise AVError("AV_MISSING_NATIVE_PARAMETER", "Required native invocation parameter context was not supplied",
                      stage="native-parameters")
    for name in parameters.required_uri_variables:
        if name not in effective and name not in secret_names:
            raise ValueError("Required native parameter has no applicable declaration: " + name)
        if ordinary.get(name, secrets.get(name)) is None:
            raise AVError("AV_MISSING_NATIVE_PARAMETER", "Required native parameter was not supplied: " + name,
                          stage="native-parameters", location="/uriVariables/" + name)
    for name in template_names & secret_names:
        if not secrets.get(name):
            raise AVError("AV_MISSING_NATIVE_PARAMETER", "Required native security parameter was not supplied",
                          stage="native-parameters")
    for name, value in ordinary.items():
        check_json_domain(value)
        scalar_text(value)
        if not native_value_valid(value, effective[name]):
            raise ValueError("Native URI parameter violates its schema: " + name)
    if parameters.input is not ABSENT:
        from common import native_input_schema
        schema = native_input_schema(affordance, kind, operation)
        check_json_domain(parameters.input)
        if not native_value_valid(parameters.input, schema):
            raise ValueError("Native invocation input violates its directional schema")
    elif supplied_context and kind == "actions" and isinstance(affordance.get("input"), dict) and affordance["input"].get("required"):
        raise AVError("AV_MISSING_NATIVE_PARAMETER", "Required native invocation input was not supplied",
                      stage="native-parameters", location="/input")
    return expand_template(href, {**ordinary, **secrets}), copy.deepcopy(effective)
