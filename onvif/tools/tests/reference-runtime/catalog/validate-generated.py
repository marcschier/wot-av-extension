"""Independent JSON Schema/JSON-LD checks; no source compiler or network loader."""

import json
import pathlib
import sys

from jsonschema import Draft202012Validator, Draft7Validator
from pyld import jsonld
from referencing import Registry, Resource

root = pathlib.Path(sys.argv[1])
data = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
base = root / "onvif"


def deny_retrieval(uri):
    raise AssertionError(f"External schema/context retrieval is forbidden: {uri}")


schemas = [
    json.loads((base / name).read_text(encoding="utf-8"))
    for name in (
        "payloads.schema.json",
        "form.schema.json",
        "snapshot.schema.json",
        "requirements.schema.json",
    )
]
registry = Registry(retrieve=deny_retrieval).with_resources(
    (schema["$id"], Resource.from_contents(schema)) for schema in schemas
)
for schema in schemas:
    Draft202012Validator.check_schema(schema)

payload, form, snapshot, requirements = schemas
for case in data["payloads"]:
    selected = {"$ref": payload["$id"] + case["fragment"]}
    Draft202012Validator(selected, registry=registry).validate(case["value"])

td_schema = json.loads(
    (root / "av" / "support" / "upstream" / "wot" / "td-schema.json").read_text(encoding="utf-8")
)
contexts = {
    "https://www.w3.org/2022/wot/td/v1.1": json.loads(
        (root / "av" / "support" / "upstream" / "wot" / "td-context.jsonld").read_text(encoding="utf-8")
    ),
    "https://example.org/wot/onvif/context/v0.1": json.loads(
        (base / "context.jsonld").read_text(encoding="utf-8")
    ),
}


def loader(url, options=None):
    if url not in contexts:
        deny_retrieval(url)
    return {"contextUrl": None, "documentUrl": url, "document": contexts[url]}


for td in data["tds"]:
    Draft7Validator(td_schema).validate(td)
    assert len([link for link in td["links"] if link["rel"] == "type"]) == 1
    for collection in ("actions", "events"):
        for affordance in td.get(collection, {}).values():
            for native_form in affordance["forms"]:
                Draft202012Validator(form, registry=registry).validate(native_form)
    expanded = jsonld.expand(td, {"documentLoader": loader})
    assert expanded, "TD expansion must not become empty"
    assert "https://example.org/wot/onvif#registryDigest" in expanded[0]

for native_form in data.get("invalidForms", []):
    assert not Draft202012Validator(form, registry=registry).is_valid(native_form)

for item in data["snapshots"]:
    Draft202012Validator(snapshot, registry=registry).validate(item)

for name in ("requirements-st.json", "requirements-gm.json", "requirements-acd.json"):
    value = json.loads((base / "requirements" / name).read_text(encoding="utf-8"))
    Draft202012Validator(requirements, registry=registry).validate(value)

definition = next(
    value
    for value in payload["$defs"].values()
    if value.get("onvif:canonicalType") == "{http://www.w3.org/2001/XMLSchema}unsignedLong"
)
validator = Draft202012Validator(definition, registry=registry)
validator.validate("18446744073709551615")
assert not validator.is_valid("18446744073709551616")
assert not validator.is_valid(18446744073709551615)

print(
    json.dumps(
        {
            "schemas": len(schemas),
            "payloads": len(data["payloads"]),
            "tds": len(data["tds"]),
            "snapshots": len(data["snapshots"]),
            "ledgers": 3,
            "externalRetrieval": False,
        }
    )
)
