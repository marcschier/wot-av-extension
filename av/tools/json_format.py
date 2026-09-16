"""Strict JSON and one readable serialization, separate from fingerprint bytes."""

from __future__ import annotations

import json
import math
import re
from decimal import Decimal

from diagnostics import AVError, diagnostic

MAX_DIGITS = 1024
MAX_EXPONENT = 512
MAX_DEPTH = 128
MAX_JSON_BYTES = 16 * 1024 * 1024


def numeric_limit(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise AVError("AV_INVALID_SYNTAX", "Nonfinite JSON number", stage="parse")
        digits = len(value.as_tuple().digits)
        exponent = abs(value.as_tuple().exponent)
    elif type(value) is int:
        if value.bit_length() > MAX_DIGITS * 4:
            raise AVError("AV_RESOURCE_LIMIT", "Integer digit budget exceeded",
                          stage="numeric", limit="numeric-digits")
        digits, exponent = len(str(abs(value))), 0
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise AVError("AV_INVALID_SYNTAX", "Nonfinite JSON number", stage="parse")
        return
    else:
        return
    if digits > MAX_DIGITS or exponent > MAX_EXPONENT:
        raise AVError("AV_RESOURCE_LIMIT", "Exact number exceeds declared digit/exponent budget",
                      stage="numeric", limit="numeric-digits/exponent",
                      measured={"digits": digits, "exponent": exponent})


def unicode_scalar(value):
    if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise AVError("AV_INVALID_SYNTAX", "Unpaired Unicode surrogate", stage="parse")
    return value


def check_json_domain(value, depth=0):
    if depth > MAX_DEPTH:
        raise AVError("AV_RESOURCE_LIMIT", "JSON nesting budget exceeded",
                      stage="parse", limit="json-depth", measured=depth)
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise AVError("AV_INVALID_SYNTAX", "JSON member names must be strings", stage="parse")
            unicode_scalar(key)
            check_json_domain(child, depth + 1)
    elif isinstance(value, (list, tuple)):
        for child in value:
            check_json_domain(child, depth + 1)
    elif isinstance(value, str):
        unicode_scalar(value)
    elif value is not None and type(value) is not bool:
        if not isinstance(value, (int, float, Decimal)):
            raise AVError("AV_INVALID_SYNTAX", "Value is outside the JSON input domain", stage="parse")
        numeric_limit(value)


@diagnostic("AV_INVALID_SYNTAX", "parse")
def strict_json(source: str | bytes):
    if len(source) > MAX_JSON_BYTES:
        raise AVError("AV_RESOURCE_LIMIT", "JSON input byte budget exceeded",
                      stage="parse", limit="json-bytes", measured=len(source))
    if isinstance(source, bytes):
        source = source.decode("utf-8")

    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON member: " + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("Non-JSON numeric constant: " + value)

    def number(value):
        if len(value) > MAX_DIGITS + 16:
            raise AVError("AV_RESOURCE_LIMIT", "Numeric token budget exceeded",
                          stage="parse", limit="numeric-digits", measured=len(value))
        result = Decimal(value) if any(char in value for char in ".eE") else int(value)
        numeric_limit(result)
        return result

    result = json.loads(source, object_pairs_hook=pairs,
                        parse_constant=invalid_constant, parse_float=number, parse_int=number)
    check_json_domain(result)
    return result


def json_bytes(value) -> bytes:
    check_json_domain(value)

    def encode(item, depth=0):
        if isinstance(item, (dict, list, tuple)):
            if not item:
                return "{}" if isinstance(item, dict) else "[]"
            opening, closing = ("{", "}") if isinstance(item, dict) else ("[", "]")
            children = ([json.dumps(key, ensure_ascii=True) + ": " + encode(child, depth + 1)
                         for key, child in item.items()] if isinstance(item, dict)
                        else [encode(child, depth + 1) for child in item])
            indent = "    " * (depth + 1)
            return opening + "\n" + indent + (",\n" + indent).join(children) + "\n" + "    " * depth + closing
        if isinstance(item, Decimal):
            return str(item)
        return json.dumps(item, ensure_ascii=True, allow_nan=False)

    return (encode(value) + "\n").encode("utf-8")


def format_json(source: str | bytes) -> bytes:
    """Change whitespace only; preserve every string escape and numeric token."""
    strict_json(source)
    text = source.decode("utf-8") if isinstance(source, bytes) else source
    tokens = re.findall(r'"(?:[^"\\]|\\.)*"|[^\s{}\[\],:]+|[{}\[\],:]', text)
    pieces = []
    depth = 0
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else None
        following = tokens[index + 1] if index + 1 < len(tokens) else None
        if token in ("{", "["):
            pieces.append(token)
            if following not in ("}", "]"):
                depth += 1
                pieces.append("\n" + "    " * depth)
        elif token in ("}", "]"):
            if previous not in ("{", "["):
                depth -= 1
                pieces.append("\n" + "    " * depth)
            pieces.append(token)
        elif token == ",":
            pieces.append(",\n" + "    " * depth)
        elif token == ":":
            pieces.append(": ")
        else:
            pieces.append(token)
    result = "".join(pieces) + "\n"
    strict_json(result)
    return result.encode("utf-8")
