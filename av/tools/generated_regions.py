"""Inventory-owned Markdown regions; no publication renderer or HTML ownership."""

from __future__ import annotations

import re

from common import pointer
from diagnostics import AVError

MARKER = re.compile(r"^<!-- (BEGIN|END) GENERATED: ([^\r\n]+) -->[ \t]*$", re.M)


def sources(terms):
    for group in ("classes", "properties", "external_properties"):
        for name, definition in terms[group].items():
            yield f"terms.json#/{group}/{name}", definition, definition["documentation"]
    for group, values in terms["enums"].items():
        for index, name in enumerate(values):
            selector = str(index) if isinstance(values, list) else name
            doc = terms["enum_documentation"][group][name]
            yield f"terms.json#/enums/{group}/{selector}", {"meaning": doc["describes"]}, doc


def section_lines(doc):
    labels = (
        ("defined_by", "Defined by"), ("declared_by", "Declared by"),
        ("source_of_truth", "Source of truth"), ("describes", "Describes"),
        ("used_by", "Used by"), ("how", "How to specify"), ("boundary", "Boundary"),
    )
    result = []
    for field, label in labels:
        result.extend([f"**{label}:** {doc[field]}", ""])
    omission = doc["when_omitted"]
    result.extend([f"**Defaults / omission ({omission['policy']}):** {omission['explanation']}", ""])
    return result


def entry_text(definition, doc):
    spec = doc["specification"]
    result = [*(f'<a id="{anchor}"></a>' for anchor in spec["anchors"]),
              spec["heading"], "", spec["normative_text"], ""]
    if "value" in definition:
        container = "unordered array/set" if definition.get("container") == "set" else "one value when present"
        result.extend([f"**Representation:** `{definition['value']}`; {container}. "
                       f"**Unit:** {definition.get('unit', 'no additional numeric unit')}.", ""])
        if "conditions" in definition:
            result.extend(["**Conditions:** " + definition["conditions"], ""])
    elif "identity" in definition:
        result.extend([f"**Identity:** `{definition['identity']}`; "
                       f"**Superclasses:** {', '.join(definition['superclasses']) or 'none required'}.", ""])
    result.extend(section_lines(doc))
    for owner, usage in definition.get("uses", {}).items():
        maximum = "*" if usage["max"] is None else usage["max"]
        result.extend([f"**Use on `{owner}`:** range `{usage['range']}`; "
                       f"cardinality `{usage['min']}..{maximum}`.", ""])
        result.extend(section_lines(usage["documentation"]))
    return "\n".join(result).rstrip() + "\n"


def representation_table(terms):
    lines = ["| Representation | Required fields | Conditionally permitted fields | Restricted choices |",
             "| --- | --- | --- | --- |"]
    for name, rule in terms["representation_rules"].items():
        optional = ", ".join(rule["optional"]) or "None"
        if rule["optional"]:
            optional += " on Live/Clip only"
        choices = "; ".join(key + ": " + ", ".join(values) for key, values in rule["choices"].items())
        if name in {"PCM", "EncodedAudio"}:
            choices += ("; " if choices else "") + "Mono/1 or StereoLR/2"
        lines.append(f"| {name} | {', '.join(rule['required'])} | {optional} | {choices} |")
    return "\n".join(lines) + "\n"


def generated_bodies(terms):
    entries = list(sources(terms))
    if len(entries) != 100 or len(terms["classes"]) != 7 or len(terms["properties"]) != 29:
        raise AVError("AV_EDITION_INCONSISTENT", "The reviewed AV term surface must remain 100 entries, 7 classes and 29 properties",
                      stage="documentation")
    result = {}
    anchors = set()
    for selector, definition, doc in entries:
        pointer(terms, selector.partition("#")[2])
        spec = doc.get("specification", {})
        if not spec.get("anchors") or not spec.get("heading") or len(spec.get("normative_text", "")) < 80:
            raise AVError("AV_EDITION_INCONSISTENT", "Incomplete inventory-owned specification entry",
                          stage="documentation", location=selector)
        for anchor in spec["anchors"]:
            if anchor in anchors:
                raise AVError("AV_EDITION_INCONSISTENT", "Duplicate inventory-owned stable anchor",
                              stage="documentation", location=anchor)
            anchors.add(anchor)
        result[selector] = entry_text(definition, doc)
    result["terms.json#/representation_rules"] = representation_table(terms)
    return result


def assemble(text, terms, *, check=False):
    bodies = generated_bodies(terms)
    seen, parts, opened, offset = set(), [], None, 0
    for marker in MARKER.finditer(text):
        kind, selector = marker.groups()
        if kind == "BEGIN":
            if opened is not None or selector in seen or selector not in bodies:
                raise AVError("AV_EDITION_INCONSISTENT", "Unknown, duplicate or nested generated region",
                              stage="documentation", location=selector)
            opened = (selector, marker)
        else:
            if opened is None or opened[0] != selector:
                raise AVError("AV_EDITION_INCONSISTENT", "Mismatched generated region markers",
                              stage="documentation", location=selector)
            begin = opened[1]
            parts.extend([text[offset:begin.end()], "\n", bodies[selector], marker[0]])
            offset = marker.end()
            seen.add(selector)
            opened = None
    if opened is not None or seen != bodies.keys():
        raise AVError("AV_EDITION_INCONSISTENT", "Missing or unclosed complete-reference regions",
                      stage="documentation", location=", ".join(sorted(bodies.keys() - seen)))
    parts.append(text[offset:])
    result = "".join(parts)
    ids = re.findall(r'<a id="([^"]+)"></a>', result)
    if len(ids) != len(set(ids)):
        raise AVError("AV_EDITION_INCONSISTENT", "Duplicate specification stable IDs", stage="documentation")
    if check and result != text:
        raise AVError("AV_EDITION_INCONSISTENT", "Generated specification regions are stale",
                      stage="documentation", location="av/spec.md")
    return result
