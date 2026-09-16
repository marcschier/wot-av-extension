"""Bounded Unicode-scalar matching for the specification's ECMAScript subset."""

from __future__ import annotations

import re
from dataclasses import dataclass

from diagnostics import AVError


def invalid(message):
    raise AVError("AV_INVALID_CONTRACT", "Invalid regular expression: " + message, stage="contract")


def unsupported(message):
    raise AVError("AV_UNSUPPORTED_CONTRACT", "Unsupported regular expression: " + message, stage="contract")


@dataclass(frozen=True)
class Pattern:
    tree: tuple

    def search(self, value, tick):
        cache = {}

        def evaluate(node, start):
            key = (id(node), start)
            if key in cache:
                return cache[key]
            tick()
            kind = node[0]
            if kind == "empty":
                result = {start}
            elif kind == "start":
                result = {start} if start == 0 else set()
            elif kind == "end":
                result = {start} if start == len(value) else set()
            elif kind == "char":
                result = {start + 1} if start < len(value) and accepts(node[1], value[start]) else set()
            elif kind == "alt":
                result = set().union(*(evaluate(child, start) for child in node[1]))
            elif kind == "seq":
                result = {start}
                for child in node[1]:
                    result = set().union(*(evaluate(child, pos) for pos in result)) if result else set()
            elif kind == "repeat":
                child, minimum, maximum = node[1:]
                frontier = {start}
                for _ in range(minimum):
                    frontier = set().union(*(evaluate(child, pos) for pos in frontier)) if frontier else set()
                result = set(frontier)
                if maximum is None:
                    seen = set(frontier)
                    while frontier:
                        following = set().union(*(evaluate(child, pos) for pos in frontier)) - seen
                        seen.update(following)
                        result.update(following)
                        frontier = following
                else:
                    for _ in range(maximum - minimum):
                        frontier = set().union(*(evaluate(child, pos) for pos in frontier)) if frontier else set()
                        result.update(frontier)
                        if not frontier:
                            break
            else:
                raise AssertionError("Unknown parsed regexp node")
            cache[key] = result
            return result

        return any(evaluate(self.tree, start) for start in range(len(value) + 1))


def accepts(predicate, char):
    kind = predicate[0]
    if kind == "literal":
        return char == predicate[1]
    if kind == "range":
        return predicate[1] <= char <= predicate[2]
    if kind == "dot":
        return char not in "\n\r\u2028\u2029"
    if kind == "digit":
        return "0" <= char <= "9"
    if kind == "word":
        return char in "_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if kind == "not":
        return not accepts(predicate[1], char)
    if kind == "union":
        return any(accepts(item, char) for item in predicate[1])
    raise AssertionError("Unknown parsed character predicate")


def compile_pattern(text, *, max_length=1024, max_repeat=256):
    if not isinstance(text, str):
        invalid("pattern must be a string")
    if len(text) > max_length:
        raise AVError("AV_RESOURCE_LIMIT", "Regexp length budget exceeded", stage="contract",
                      limit="regex-length", measured=len(text))
    position = 0

    def peek():
        return text[position] if position < len(text) else ""

    def escape(in_class=False):
        nonlocal position
        if position >= len(text):
            invalid("trailing escape")
        char = text[position]
        position += 1
        if char == "-" and not in_class:
            invalid("escaped hyphen outside a character class")
        if char in r"^$\\.*+?()[]{}|/-":
            return ("literal", char)
        if char in "nrtfv":
            return ("literal", dict(n="\n", r="\r", t="\t", f="\f", v="\v")[char])
        if char in "dDwW":
            predicate = ("digit",) if char.lower() == "d" else ("word",)
            return ("not", predicate) if char.isupper() else predicate
        if char == "u":
            if peek() == "{":
                end = text.find("}", position + 1)
                if end < 0:
                    invalid("unclosed Unicode escape")
                digits = text[position + 1:end]
                position = end + 1
                if not re.fullmatch(r"[0-9a-fA-F]{1,6}", digits):
                    invalid("invalid Unicode escape")
            else:
                digits = text[position:position + 4]
                position += 4
                if not re.fullmatch(r"[0-9a-fA-F]{4}", digits):
                    invalid("invalid Unicode escape")
            scalar = int(digits, 16)
            if 0xD800 <= scalar <= 0xDBFF and text[position:position + 2] == "\\u":
                trail = text[position + 2:position + 6]
                if re.fullmatch(r"[0-9a-fA-F]{4}", trail) and 0xDC00 <= int(trail, 16) <= 0xDFFF:
                    scalar = 0x10000 + (scalar - 0xD800) * 1024 + int(trail, 16) - 0xDC00
                    position += 6
            if scalar > 0x10FFFF or 0xD800 <= scalar <= 0xDFFF:
                invalid("escape is not a Unicode scalar")
            return ("literal", chr(scalar))
        if char in "0123456789kpsSbBPAZzGxc":
            unsupported("backreference or escape class \\" + char)
        invalid("unrecognized Unicode-mode escape \\" + char)

    def class_atom():
        nonlocal position
        if not peek():
            invalid("unclosed character class")
        char = text[position]
        position += 1
        return escape(in_class=True) if char == "\\" else ("literal", char)

    def character_class():
        nonlocal position
        negate = peek() == "^"
        position += int(negate)
        items = []
        while peek() and peek() != "]":
            left = class_atom()
            if peek() == "-" and position + 1 < len(text) and text[position + 1] != "]":
                position += 1
                right = class_atom()
                if left[0] != "literal" or right[0] != "literal" or left[1] > right[1]:
                    invalid("invalid character range")
                left = ("range", left[1], right[1])
            items.append(left)
        if peek() != "]":
            invalid("unclosed character class")
        position += 1
        predicate = ("union", tuple(items))
        return ("char", ("not", predicate) if negate else predicate)

    def atom():
        nonlocal position
        char = text[position]
        position += 1
        if char == "(":
            if peek() == "?":
                if text[position:position + 2] != "?:":
                    unsupported("lookaround, named groups or inline flags")
                position += 2
            child = alternative()
            if peek() != ")":
                invalid("unclosed group")
            position += 1
            return child
        if char == "[":
            return character_class()
        if char == "\\":
            return ("char", escape())
        if char == ".":
            return ("char", ("dot",))
        if char in "^$":
            return ("start",) if char == "^" else ("end",)
        if char in "*+?{}]":
            invalid("unescaped syntax character or missing quantifier target")
        if 0xD800 <= ord(char) <= 0xDFFF:
            invalid("unpaired surrogate")
        return ("char", ("literal", char))

    def sequence():
        nonlocal position
        items = []
        while peek() and peek() not in "|)":
            child = atom()
            if peek() and peek() in "*+?{":
                quantifier = peek()
                position += 1
                if child[0] in {"start", "end"}:
                    invalid("quantified assertion")
                if quantifier == "{":
                    match = re.match(r"([0-9]+)(?:,([0-9]*))?\}", text[position:])
                    if not match:
                        invalid("invalid repetition bounds")
                    if any(len(part) > 4 for part in match.groups() if part):
                        raise AVError("AV_RESOURCE_LIMIT", "Regexp repetition budget exceeded",
                                      stage="contract", limit="regex-repeat")
                    minimum = int(match[1])
                    maximum = minimum if match[2] is None else int(match[2]) if match[2] else None
                    position += match.end()
                    if maximum is not None and maximum < minimum:
                        invalid("reversed repetition bounds")
                else:
                    minimum, maximum = {"*": (0, None), "+": (1, None), "?": (0, 1)}[quantifier]
                if minimum > max_repeat or maximum is not None and maximum > max_repeat:
                    raise AVError("AV_RESOURCE_LIMIT", "Regexp repetition budget exceeded",
                                  stage="contract", limit="regex-repeat", measured=maximum or minimum)
                child = ("repeat", child, minimum, maximum)
                if peek() == "?":
                    position += 1
            items.append(child)
        return ("seq", tuple(items)) if items else ("empty",)

    def alternative():
        nonlocal position
        items = [sequence()]
        while peek() == "|":
            position += 1
            items.append(sequence())
        return ("alt", tuple(items)) if len(items) > 1 else items[0]

    tree = alternative()
    if position != len(text):
        invalid("unmatched closing group")
    return Pattern(tree)
