"""Check entry-level documentation, examples, references and lossless JSON formatting."""

from __future__ import annotations

import argparse
import copy
import re
from urllib.parse import unquote, urlsplit

import generate
import model
from common import (
    ROOT, Checks, absolute_iri, format_json, json_bytes, nodes, pointer, read, relative_file,
    resolve_form, ratio, strict_json, validate_av_keys,
)
from matching import (
    controlled, exact_integer, normalize_mode, normalize_track, record,
    validate_input, validate_need, validate_offer,
)

DOC_FIELDS = {
    "defined_by", "declared_by", "source_of_truth", "describes", "used_by",
    "how", "when_omitted", "boundary", "example",
}
POLICIES = {
    "required", "unknown", "conditional", "no-declaration", "no-push-request",
    "not-applicable", "property-defined",
}
FENCE = re.compile(r"^```(?:json|jsonld|json-ld)[ \t]*\n(.*?)^```[ \t]*$", re.M | re.S)


def check_documentation(doc, label, usage=None):
    if not isinstance(doc, dict) or DOC_FIELDS - doc.keys():
        raise ValueError("Incomplete documentation metadata: " + label)
    for field in DOC_FIELDS - {"when_omitted", "example"}:
        value = doc[field]
        if not isinstance(value, str) or len(value.strip()) < 8 or re.search(r"\b(TODO|TBD)\b", value):
            raise ValueError("Missing meaningful " + field + ": " + label)
    omission = doc["when_omitted"]
    if (not isinstance(omission, dict) or omission.get("policy") not in POLICIES
            or not isinstance(omission.get("explanation"), str) or not omission["explanation"].strip()):
        raise ValueError("Missing explicit omission policy: " + label)
    if set(omission) != {"policy", "explanation"}:
        raise ValueError("Undeclared default value in documentation: " + label)
    if re.search(r"\bdefaults?\s+(?:to|is|=)\s+(?!not\b)", omission["explanation"], re.I):
        raise ValueError("An AV entry has no implicit value default: " + label)
    if usage:
        if usage["min"] and omission["policy"] != "required":
            raise ValueError("Required use has a misleading omission/default claim: " + label)
        if not usage["min"] and omission["policy"] == "required":
            raise ValueError("Optional/conditional use claims unconditional presence: " + label)
    example = doc["example"]
    if not isinstance(example, dict) or not example.get("scope"):
        raise ValueError("Example scope is required: " + label)
    if ("file" in example) == ("value" in example):
        raise ValueError("Example requires exactly one inline value or file reference: " + label)
    if "file" in example and not relative_file(example["file"]).is_file():
        raise ValueError("Missing example reference: " + example["file"])
    value = generate.documentation_example(doc)
    json_bytes(value)
    return value


def validate_example(value):
    validate_av_keys(value)
    fixtures = read(relative_file("tests/fixtures/core.json"))
    documents = {fixtures["documentLocations"][name]: fixtures[name] for name in ("source", "application")}
    for node in nodes(value):
        types = node.get("@type", [])
        types = [types] if isinstance(types, str) else types
        for name in model.TERMS["classes"]:
            if "av:" + name not in types:
                continue
            if name == "Offer":
                validate_offer(node)
            elif name == "Mode":
                offer = {**fixtures["offer"], "av:mode": [node]}
                normalize_mode(offer, node)
            elif name == "Track":
                normalize_track(node, "av:Live")
            elif name == "Rational":
                ratio(record(node, name))
            elif name == "Need":
                validate_need(node)
            elif name == "InputRequirement":
                validate_input(node)
            elif name == "FormReference":
                resolve_form(node, documents)
        for key, item in node.items():
            if key not in model.ALL_PROPERTIES:
                continue
            prop = model.ALL_PROPERTIES[key]
            if prop["value"] == "integer":
                number = exact_integer(item)
                if "minimum" in prop and number < prop["minimum"]:
                    raise ValueError("Example integer violates its declared minimum")
            elif prop["value"] == "node":
                ranges = {usage["range"] for usage in prop["uses"].values()}
                for range_name in ranges:
                    if isinstance(range_name, str) and range_name.startswith("enum:") and range_name != "enum:NativeOperation":
                        controlled(item, range_name[5:])
                    elif range_name == "enum:NativeOperation":
                        operations = {model.TERMS["prefixes"]["td"] + member[3:]
                                      for member in model.TERMS["enums"]["NativeOperation"]}
                        if item not in operations:
                            raise ValueError("Example operation is not a standard TD operation IRI")
                    elif range_name == "IRI":
                        for part in item if isinstance(item, list) else [item]:
                            absolute_iri(part, "Example reference")
            elif prop["value"] == "string":
                values = item if isinstance(item, list) else [item]
                if any(not isinstance(part, str) for part in values):
                    raise ValueError("Example literal has the wrong datatype")


def inventory_documentation(terms=None, *, rendered=None):
    terms = model.TERMS if terms is None else terms
    entries = list(generate.catalogue_entries(terms))
    if len({entry[0] for entry in entries}) != len(entries):
        raise ValueError("Duplicate documentation entry anchor")
    examples = {}
    count = 0
    for anchor, name, kind, definition in entries:
        docs = [(name, definition["documentation"], None)]
        if kind == "property":
            docs.extend((name + " on " + domain, usage["documentation"], usage)
                        for domain, usage in definition["uses"].items())
            if name in {"av:form", "av:document"}:
                authors = {usage["documentation"]["declared_by"] for usage in definition["uses"].values()}
                if len(authors) != len(definition["uses"]):
                    raise ValueError("Per-use publisher/selector responsibility is not explicit: " + name)
        for label, doc, usage in docs:
            value = check_documentation(doc, label, usage)
            examples[json_bytes(value)] = value
            count += 1
        if rendered is not None:
            section = generate.entry_section(anchor, name, kind, definition)
            if rendered.count(f'<a id="{anchor}"></a>') != 1 or section not in rendered:
                raise ValueError("Missing/stale entry-specific rendered documentation: " + name)
    conditional_fields = {field for rule in terms["representation_rules"].values()
                          for field in rule["required"] + rule["optional"]}
    if any(not terms["properties"][field].get("conditions") for field in conditional_fields):
        raise ValueError("Representation-dependent field lacks explicit conditions")
    for value in examples.values():
        validate_example(value)
    return {"entries": len(entries), "entryAndUseRecords": count, "distinctExamples": len(examples)}


def check_json_bytes(data, label):
    if format_json(data) != data:
        raise ValueError("JSON must use lossless four-space expanded formatting: " + label)


def check_fences(text, label):
    count = 0
    for match in FENCE.finditer(text):
        check_json_bytes(match.group(1).encode("utf-8"), label + " JSON fence")
        count += 1
    starts = re.findall(r"^```(?:json|jsonld|json-ld)[ \t]*$", text, re.M)
    if len(starts) != count:
        raise ValueError("Unclosed or malformed JSON fence: " + label)
    return count


def heading_anchors(text):
    anchors = set(re.findall(r'<a\s+id="([^"]+)"', text))
    duplicates = {}
    for heading in re.findall(r"^#{1,6}[ \t]+(.+?)\s*#*[ \t]*$", text, re.M):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        index = duplicates.get(slug, 0)
        duplicates[slug] = index + 1
        anchors.add(slug if index == 0 else slug + "-" + str(index))
    return anchors


def markdown_references(path, text):
    for target in re.findall(r"!?\[[^\]\n]*\]\(([^)\n]+)\)", text):
        target = target.strip().split(' "', 1)[0].strip("<>")
        if not target or urlsplit(target).scheme:
            continue
        relative, separator, fragment = target.partition("#")
        relative = unquote(relative)
        resolved = path if not relative else path.parent.joinpath(*relative.replace("\\", "/").split("/")).resolve()
        if not resolved.is_relative_to(ROOT) or not resolved.exists():
            raise ValueError("Broken/out-of-repository Markdown reference: " + target)
        if separator and fragment and resolved.suffix == ".md":
            target_text = text if resolved == path else resolved.read_text(encoding="utf-8")
            if unquote(fragment) not in heading_anchors(target_text):
                raise ValueError("Broken Markdown heading reference: " + target)


def snippet_references(text):
    markers = list(re.finditer(r"<!--\s*example:\s*([^\s#]+)#([^\s]*?)\s*-->", text))
    for marker in markers:
        name, selector = marker.group(1), marker.group(2)
        sample = pointer(read(relative_file(name)), selector)
        fence = FENCE.search(text, marker.end())
        if fence is None or re.search(r"<!--\s*example:", text[marker.end():fence.start()]):
            raise ValueError("Example pointer is not followed by its JSON fence")
        actual = json_bytes(strict_json(fence.group(1)))
        if actual != json_bytes(sample):
            raise ValueError("Stale literal documentation excerpt: " + name + "#" + selector)
    return len(markers)


def run(checks, *, core_only=False):
    rendered = relative_file("spec/terms.md").read_text(encoding="utf-8")
    coverage = inventory_documentation(rendered=rendered)
    checks.check("Every class/property/controlled entry and per-use record has checked documentation", True, coverage)
    context = model.make_context()["@context"]
    checks.check("Authoring-only documentation is not context vocabulary",
                 not DOC_FIELDS.intersection(context) and "documentation" not in context)
    paths = set(generate.AUTHORED_FILES) | generate.GENERATED_FILES
    paths = {name for name in paths if not name.startswith(("third_party/", "archive/", "research/"))}
    if core_only:
        paths = {name for name in paths if name.startswith(("vocabulary/", "tests/", "tools/"))
                 or name in {"provenance.json", "spec/terms.md"}}
    json_count = fence_count = snippet_count = 0
    for name in sorted(paths):
        path = relative_file(name)
        if not path.exists():
            raise ValueError("Missing active documentation/artifact: " + name)
        if path.suffix in {".json", ".jsonld"}:
            check_json_bytes(path.read_bytes(), name)
            json_count += 1
        elif path.suffix == ".md":
            text = path.read_text(encoding="utf-8")
            fence_count += check_fences(text, name)
            markdown_references(path, text)
            snippet_count += snippet_references(text)
    checks.check("All active first-party JSON and JSON fences parse and use the shared format", True,
                 {"jsonFiles": json_count, "jsonFences": fence_count, "literalExcerpts": snippet_count})
    bad = copy.deepcopy(model.TERMS)
    del bad["classes"]["Mode"]["documentation"]["source_of_truth"]
    checks.negative("Documentation rejects a missing source of truth", lambda: inventory_documentation(bad))
    bad = copy.deepcopy(model.TERMS)
    bad["properties"]["width"]["uses"]["av:Track"]["documentation"]["when_omitted"]["value"] = 1280
    checks.negative("Documentation rejects an invented default", lambda: inventory_documentation(bad))
    bad = copy.deepcopy(model.TERMS)
    bad["classes"]["Mode"]["documentation"]["example"]["pointer"] = "/absent-mode"
    checks.negative("Documentation rejects a broken example pointer", lambda: inventory_documentation(bad))
    stale = rendered.replace('"av:width": 1280', '"av:width": 1279', 1)
    checks.negative("Documentation rejects a stale rendered snippet",
                    lambda: inventory_documentation(rendered=stale))
    return {**coverage, "jsonFiles": json_count, "jsonFences": fence_count, "literalExcerpts": snippet_count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-only", action="store_true")
    args = parser.parse_args()
    checks = Checks()
    result = run(checks, core_only=args.core_only)
    print(json_bytes({"result": "passed", **result}).decode("utf-8"), end="")


if __name__ == "__main__":
    main()
