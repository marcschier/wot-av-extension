"""Independent public-artifact validation; no compiler, codec, SDK or network."""

import copy
import json
import pathlib
import re
import sys
from decimal import Decimal

from jsonschema import Draft202012Validator, Draft7Validator
from pyld import jsonld
from pyshacl import validate as validate_shacl
from rdflib import Graph, Namespace, RDF, RDFS
from referencing import Registry, Resource

root = pathlib.Path(sys.argv[1])
base = root / "onvif"


def read(name):
    return json.loads((base / name).read_text(encoding="utf-8"))


def no_retrieval(uri):
    raise AssertionError(f"External retrieval is forbidden: {uri}")


schemas = {
    name: read(name)
    for name in (
        "mapping.schema.json",
        "binding.schema.json",
        "payloads.schema.json",
        "form.schema.json",
        "snapshot.schema.json",
        "requirements.schema.json",
    )
}
registry = Registry(retrieve=no_retrieval).with_resources(
    (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
)
for schema in schemas.values():
    Draft202012Validator.check_schema(schema)

binding_context = Draft202012Validator(schemas["binding.schema.json"], registry=registry)
canonical_root = {
    "type": "object",
    "onvif:sourceDataSchema": "https://example.org/wot/onvif/schemas/payloads.schema.json#/$defs/example",
    "onvif:validation": "sourceDataSchema-and-canonical-codec",
}
mixed_actions = {"actions": {
    "ordinary": {"input": {"type": "string"}, "output": {}},
    "canonical": {"onvif:mappingSupport": "compiled", "input": canonical_root},
}}
binding_context.validate(mixed_actions)
for marker in (
    {"onvif:mappingSupport": "compiled"},
    {"onvif:source": {"operation": {}}},
    {"onvif:source": {"inputClass": "Example"}},
    {"forms": [{"onvif:binding": "soap12-http-v1"}]},
    {"forms": [{"onvif:operation": {}}]},
):
    assert not binding_context.is_valid({"actions": {"canonical": {**marker, "input": {"type": "string"}}}})
for missing in ("onvif:sourceDataSchema", "onvif:validation"):
    incomplete = {key: value for key, value in canonical_root.items() if key != missing}
    assert not binding_context.is_valid({"actions": {"canonical": {"input": incomplete}}})

catalog = read("catalog.json")
mapping = schemas["mapping.schema.json"]
Draft202012Validator(mapping, registry=registry).validate(catalog)
descriptor = Draft202012Validator(
    {"$ref": mapping["$id"] + "#/$defs/ElementDescriptor"}, registry=registry
)
good = {
    "name": {"namespace": "urn:independent:example", "localName": "Amount"},
    "type": {"kind": "scalar", "type": "decimal"},
}
descriptor.validate(good)
for field in ("SourceNode", "SourceType", "xmlRegistryId", "__runtime"):
    assert not descriptor.is_valid({**good, field: {}})
assert not descriptor.is_valid({**good, "type": {"kind": "unsupported", "feature": ""}})
assert not descriptor.is_valid(
    {**good, "type": {"kind": "scalar", "type": "decimal", "runtimeEncoder": "secret"}}
)
wildcard = Draft202012Validator(
    {"$ref": mapping["$id"] + "#/$defs/WildcardConstraint"}, registry=registry
)
assert not wildcard.is_valid({})
assert not wildcard.is_valid(
    {"namespaces": ["urn:a"], "notNamespaces": ["urn:b"], "processContents": "lax"}
)
wildcard.validate({"namespaces": ["urn:extension"], "processContents": "strict"})
capacities = Draft202012Validator(
    {"$ref": schemas["binding.schema.json"]["$id"] + "#/$defs/profileDCapacities"},
    registry=registry,
)
for points, doors in ((1, 0), (0, 1), (1, 1), (4294967295, 0)):
    capacities.validate({"MaxAccessPoints": points, "MaxDoors": doors})
for value in (
    {"MaxAccessPoints": 0, "MaxDoors": 0},
    {"MaxAccessPoints": -1, "MaxDoors": 1},
    {"MaxAccessPoints": 4294967296, "MaxDoors": 1},
    {"MaxAccessPoints": True, "MaxDoors": 0},
    {"MaxAccessPoints": "1", "MaxDoors": 0},
    {"MaxAccessPoints": 1},
):
    assert not capacities.is_valid(value), value

terms = read("terms.json")
assert len(set(terms["originalTerms"])) == 68
assert set(term["name"] for term in terms["terms"]) - set(terms["originalTerms"]) == {
    "Semantic",
    "projection",
}
markdown = (base / "spec.md").read_text(encoding="utf-8")
assert len(re.findall(r"^## \d+\.", markdown, re.MULTILINE)) == 18
assert len(re.findall(r"^## Annex [A-F]\.", markdown, re.MULTILINE)) == 6
assert markdown.count("```mermaid") == 6
assert len(markdown.split()) >= 32000
assert "SESSION-DRAFT PLACEHOLDER" not in markdown
assert "not created by this session task" not in markdown
context = read("context.jsonld")["@context"]
ontology = Graph().parse(base / "ontology.ttl", format="turtle")
shapes = Graph().parse(base / "vocabulary.shacl.ttl", format="turtle")
onvif = Namespace(terms["namespace"])
for term in terms["terms"]:
    assert markdown.count(f'<a id="term-{term["name"]}"></a>') == 1
    for field in (
        "description",
        "hosts",
        "producer",
        "consumer",
        "cardinality",
        "requiredness",
        "defaultBehavior",
        "validation",
        "securityPrivacy",
        "sourceReferences",
        "example",
        "counterexample",
        "counterexampleReason",
    ):
        assert term[field], (term["name"], field)
    assert "Project-authored " + term["name"] + " metadata." not in term["description"]
    expected = RDFS.Class if term["kind"] == "class" else RDF.Property
    assert (onvif[term["name"]], RDF.type, expected) in ontology
    if term["kind"] == "property":
        mapping_term = context[f'onvif:{term["name"]}']
        if term["representation"] == "JSON literal":
            assert mapping_term["@type"] == "@json"
        if term["representation"] == "IRI":
            assert mapping_term["@type"] == "@id"

models = read("models.json")["models"]
model_ids = {model["id"] for model in models}
native_profiles = [
    model
    for model in models
    if "/models/profiles/Profile-" in model["id"]
    and model.get("@type") == "tm:ThingModel"
]
abstract_profiles = [
    model
    for model in models
    if "/models/abstract/0.2-proposed/profiles/Profile-" in model["id"]
    and model.get("@type") == "tm:ThingModel"
]
binding = Draft202012Validator(schemas["binding.schema.json"], registry=registry)
for model in models:
    binding.validate(model)
    if model.get("@type") == "tm:ThingModel":
        bases = [link for link in model.get("links", []) if link["rel"] == "tm:extends"]
        assert len(bases) <= 1
        assert all(link["href"] in model_ids for link in bases)

payload = schemas["payloads.schema.json"]
unsigned = next(
    value
    for value in payload["$defs"].values()
    if value.get("onvif:canonicalType") == "{http://www.w3.org/2001/XMLSchema}unsignedLong"
)
unsigned_validator = Draft202012Validator(unsigned, registry=registry)
unsigned_validator.validate("18446744073709551615")
unsigned_validator.validate("-0")
assert not unsigned_validator.is_valid("18446744073709551616")
assert not unsigned_validator.is_valid(18446744073709551615)
assert Decimal("12345678901234567890.0012300") == Decimal("12345678901234567890.00123")
assert str(Decimal("12345678901234567890.0012300")) == "12345678901234567890.0012300"

td_context = json.loads(
    (root / "av" / "support" / "upstream" / "wot" / "td-context.jsonld").read_text(encoding="utf-8")
)
td_schema = json.loads(
    (root / "av" / "support" / "upstream" / "wot" / "td-schema.json").read_text(encoding="utf-8")
)
contexts = {
    "https://www.w3.org/2022/wot/td/v1.1": td_context,
    terms["context"]: read("context.jsonld"),
}


def loader(url, options=None):
    if url not in contexts:
        no_retrieval(url)
    return {"contextUrl": None, "documentUrl": url, "document": contexts[url]}


td_paths = sorted((base / "examples").glob("*/*.td.json"))
assert td_paths, "Complete declarative examples must be present"
validated = 0
for path in td_paths:
    td = json.loads(path.read_text(encoding="utf-8"))
    Draft7Validator(td_schema).validate(td)
    binding.validate(td)
    assert len([link for link in td["links"] if link["rel"] == "type"]) == 1
    assert td["onvif:projection"]["fullProfile"] is False
    if td["onvif:projection"]["category"] == "wotSemanticProfile":
        assert td["onvif:projection"]["nativeProtocol"] is False
    for action in td.get("actions", {}).values():
        for native_form in action["forms"]:
            if "onvif:binding" in native_form:
                Draft202012Validator(schemas["form.schema.json"], registry=registry).validate(native_form)
        for direction in ("input", "output"):
            if direction in action:
                uri = action[direction]["onvif:sourceDataSchema"]
                assert uri.startswith(payload["$id"] + "#/$defs/")
                assert uri.split("#/$defs/")[1] in payload["$defs"]
    graph_text = jsonld.to_rdf(td, {"documentLoader": loader, "format": "application/n-quads"})
    graph = Graph().parse(data=graph_text, format="nquads")
    conforms, _, report = validate_shacl(graph, shacl_graph=shapes, inference="none")
    assert conforms, str(path) + "\n" + report
    leaked = copy.deepcopy(td)
    leaked["__runtimeRegistry"] = {}
    assert not binding.is_valid(leaked)
    false_claim = copy.deepcopy(td)
    false_claim["onvif:projection"]["fullProfile"] = True
    assert not binding.is_valid(false_claim)
    validated += 1

vocabulary_examples = read("examples/vocabulary-examples.json")
assert set(vocabulary_examples) == {term["name"] for term in terms["terms"]}
vocabulary_tds = vocabulary_tms = 0
for term in terms["terms"]:
    document = vocabulary_examples[term["name"]]
    binding.validate(document)
    assert document["@context"] == ["https://www.w3.org/2022/wot/td/v1.1", terms["context"]]
    if term["exampleHost"] == "tm":
        assert document["@type"] == "tm:ThingModel"
        assert isinstance(document["title"], str) and document["title"]
        assert not {"security", "securityDefinitions", "forms", "actions", "events", "properties"} & document.keys()
        vocabulary_tms += 1
    else:
        Draft7Validator(td_schema).validate(document)
        vocabulary_tds += 1
    for collection in ("actions", "events"):
        for affordance in document.get(collection, {}).values():
            for native_form in affordance["forms"]:
                Draft202012Validator(schemas["form.schema.json"], registry=registry).validate(native_form)
    graph_text = jsonld.to_rdf(document, {"documentLoader": loader, "format": "application/n-quads"})
    graph = Graph().parse(data=graph_text, format="nquads")
    conforms, _, report = validate_shacl(graph, shacl_graph=shapes, inference="none")
    assert conforms, term["name"] + "\n" + report
    if term["kind"] == "class":
        assert (None, RDF.type, onvif[term["name"]]) in graph, term["name"]

print(
    json.dumps(
        {
            "terms": len(terms["terms"]),
            "originalTerms": len(terms["originalTerms"]),
            "nativeProfiles": len(native_profiles),
            "abstractProfiles": len(abstract_profiles),
            "descriptorOperations": len(catalog["operations"]),
            "examples": validated,
            "vocabularyTds": vocabulary_tds,
            "vocabularyTms": vocabulary_tms,
            "externalRetrieval": False,
        }
    )
)
