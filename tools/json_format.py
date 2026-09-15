"""Strict JSON and one readable serialization, separate from fingerprint bytes."""

from __future__ import annotations

import json
import math
import re


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


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=True, indent=4, allow_nan=False) + "\n").encode("utf-8")


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
