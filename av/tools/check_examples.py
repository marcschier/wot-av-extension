"""Check the assembled synthetic bundle without network, camera or processor operations."""

from __future__ import annotations

import copy
import re

import jsonschema
from rdflib import URIRef

import model
from common import (
    AV, TD, canonical_dataset, dataset_for, json_bytes, metadata, native_forms,
    native_payload_schema, nodes, pointer, read, relative_file, resolve_form,
    resolve_native_form, validate_av_keys,
)
from matching import matches_input, matches_schema, normalize_mode, schema_validator, validate_need, validate_offer


def patched(document, operations):
    """The fixture oracle uses only RFC 6902 add/remove/replace, never a runtime DSL."""
    result = copy.deepcopy(document)
    for operation in operations:
        action, path = operation["op"], operation["path"]
        if action not in {"add", "remove", "replace"}:
            raise ValueError("Unsupported fixture JSON Patch operation")
        if path == "":
            if action == "remove":
                raise ValueError("Fixture patch cannot remove the document root")
            result = copy.deepcopy(operation["value"])
            continue
        if not path.startswith("/"):
            raise ValueError("Fixture patch path must be a JSON Pointer")
        parent_path, _, token = path.rpartition("/")
        parent = pointer(result, parent_path)
        if "~" in token.replace("~0", "").replace("~1", ""):
            raise ValueError("Invalid JSON Pointer escape in fixture patch")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(parent, list):
            if action == "add" and token == "-":
                index = len(parent)
            elif re.fullmatch(r"0|[1-9][0-9]*", token):
                index = int(token)
            else:
                raise ValueError("Invalid fixture array index")
            if index > len(parent) or action != "add" and index == len(parent):
                raise ValueError("Fixture patch index is outside the array")
            if action == "remove":
                del parent[index]
            elif action == "replace":
                parent[index] = copy.deepcopy(operation["value"])
            else:
                parent.insert(index, copy.deepcopy(operation["value"]))
        elif isinstance(parent, dict):
            if action != "add" and token not in parent:
                raise ValueError("Fixture patch target is absent")
            if action == "remove":
                del parent[token]
            else:
                parent[token] = copy.deepcopy(operation["value"])
        else:
            raise ValueError("Fixture patch parent is not a container")
    return result


def run_authored_oracle(checks, path):
    oracle = read(relative_file(path))
    cached = {}

    def document(name):
        if name not in cached:
            cached[name] = read(relative_file("av/examples/" + name))
        return cached[name]

    def need(name):
        return validate_need(document(name))

    def requirement(name, identifier):
        found = [item for item in need(name)["av:input"] if item["dcterms:identifier"] == identifier]
        if len(found) != 1:
            raise ValueError("Example oracle input is not uniquely named")
        return found[0]

    descriptors, modes = {}, {}
    for name, item in oracle["descriptors"].items():
        td = document(item["td"])
        offers = [offer for offer in td["av:offer"] if offer["@id"] == item["offer"]]
        if len(offers) != 1:
            raise ValueError("Example oracle Offer identity is ambiguous or absent")
        offer = offers[0]
        candidates = [mode for mode in offer["av:mode"] if mode["@id"] == item["mode"]]
        if len(candidates) != 1:
            raise ValueError("Example oracle Mode identity is ambiguous or absent")
        mode = candidates[0]
        actual = normalize_mode(offer, mode)
        checks.check("Authored normalized descriptor: " + name,
                     json_bytes(actual) == json_bytes(item["normalized"]))
        descriptors[name], modes[name] = actual, (offer, mode)
    groups = ("cases", "crossModeCases", "selectionCases", "invalidCases",
              "schemaCases", "referenceCases", "accessCases", "payloadCases")
    case_ids = [item["id"] for group in groups for item in oracle[group]]
    checks.check("Every authored integration case has a unique ID", len(case_ids) == len(set(case_ids)))
    outcomes = {}
    for case in oracle["cases"]:
        descriptor = patched(descriptors[case["descriptor"]], case.get("patch", []))
        schema = patched(requirement(case["need"], case["input"])["av:accepts"], case.get("schemaPatch", []))
        before = copy.deepcopy((descriptor, schema))
        actual = matches_schema(descriptor, schema)
        checks.check("Authored compatibility case: " + case["id"], actual is case["expectedMatch"])
        checks.check("Comparison never injects defaults or private application facts: " + case["id"],
                     (descriptor, schema) == before)
        outcomes[case["id"]] = actual
    for case in oracle["crossModeCases"]:
        schema = requirement(case["need"], case["input"])["av:accepts"]
        actual = [matches_schema(patched(descriptors[item["descriptor"]], item.get("patch", [])), schema)
                  for item in case["candidates"]]
        checks.check(case["id"], actual == case["expectedMatches"] and any(actual) is case["expectedAnyMatch"])
    for case in oracle["selectionCases"]:
        inputs = {item["dcterms:identifier"]: item for item in need(case["need"])["av:input"]}
        selected = {item["input"]: item["descriptor"] for item in case["selected"]}
        if len(selected) != len(case["selected"]) or set(selected) - set(inputs):
            raise ValueError("Oracle selection has duplicate/unknown named inputs")
        actual = all(matches_schema(descriptors[selected[name]], item["av:accepts"])
                     if name in selected else matches_input(item) for name, item in inputs.items())
        checks.check("Metadata-only named selection: " + case["id"], actual is case["expectedCompatible"])
    for case in oracle["invalidCases"]:
        changed = patched(document(case["td"]), case["tdPatch"])

        def validate_changed():
            for offer in changed["av:offer"]:
                validate_offer(offer)

        if case["expectedValid"]:
            validate_changed()
            checks.check(case["id"], True)
        else:
            checks.negative("Invalid authored-description case: " + case["id"], validate_changed)
    for case in oracle["schemaCases"]:
        if case["expectedValid"]:
            schema_validator(case["accepts"])
            checks.check(case["id"], True)
        else:
            checks.negative("Invalid authored schema case: " + case["id"],
                            lambda case=case: schema_validator(case["accepts"]))
    native_documents = {location: document(name) for location, name in oracle["documents"].items()}
    for case in oracle["referenceCases"]:
        reference = patched(need(case["need"])[case["reference"]], case.get("referencePatch", []))
        if case["expectedValid"]:
            resolved = resolve_form(reference, native_documents)
            role = "destination" if case["reference"] == "av:destination" else "result"
            checks.check(case["id"], resolved.document == document(case["expectedTD"])
                         and native_payload_schema(resolved, role) == pointer(document(case["expectedTD"]), case["expectedSchemaPointer"])
                         and resolved.form["contentType"] == case["expectedContentType"])
        else:
            checks.negative(case["id"], lambda ref=reference: resolve_form(ref, native_documents))
    for case in oracle["accessCases"]:
        offer, mode = modes[case["descriptor"]]

        def resolve():
            return resolve_native_form(offer["av:document"], mode["av:form"], native_documents,
                                       expected_source=offer["av:source"])

        if case["expectedResolvable"]:
            resolved = resolve()
            checks.check(case["id"], resolved.form["@id"] == mode["av:form"])
        else:
            checks.negative(case["id"], resolve, match=re.escape(case["expectedErrorContains"]),
                            category="documented-native-limit")
    contract = oracle["nativeContractChecks"]
    producer, sink = document(contract["producerTD"]), document(contract["sinkTD"])
    producer_schema = pointer(producer, contract["producerOutputPointer"])
    sink_schema = pointer(sink, contract["sinkInputPointer"])
    checks.check("Authored native result/sink schema equality is exact",
                 (producer_schema == sink_schema) is contract["expectedEqualPayloadSchemas"])
    parameter_path = contract["destinationParameterPointer"]
    pointer(producer, parameter_path)
    parent_path, _, parameter = parameter_path.rpartition("/properties/")
    checks.check("Native destination parameter has explicit optionality",
                 (parameter in pointer(producer, parent_path).get("required", [])) is contract["destinationRequired"])
    for case in oracle["payloadCases"]:
        schema = pointer(document(case["td"]), case["schemaPointer"])
        actual = jsonschema.Draft7Validator(schema).is_valid(case["payload"])
        checks.check("Synthetic unsent native payload: " + case["id"], actual is case["expectedValid"])
    checks.check("The authored oracle never claims runtime acceptance", oracle["runtimeAcceptance"] == "not-evaluated")
    return {"descriptors": len(descriptors), "cases": len(case_ids),
            "groups": {group: len(oracle[group]) for group in groups}, "metadataMatches": outcomes}


def run(checks):
    check, negative = checks.check, checks.negative
    expectations = read(relative_file("av/tools/fixtures/expectations.json"))
    for name in expectations["requiredExamples"]:
        check("Required authored example exists: " + name, relative_file(name).is_file())
    manifest = read(relative_file("av/tools/fixtures/examples/manifest.json"))
    for item in manifest["cache"].values():
        check("Exact publication cache bytes: " + item["path"], metadata(item["path"]) == item)
    documents = {item["path"]: read(relative_file(item["path"])) for item in manifest["graphs"].values()}
    native_documents = {
        location: read(relative_file(item["path"])) for location, item in manifest["cache"].items()
        if item["path"].endswith(".td.json")
    }
    schema = read(relative_file("av/support/upstream/wot/td-schema.json"))
    validator = jsonschema.Draft7Validator(schema)
    unresolved = {}
    offer_count = reference_count = need_count = 0
    for name, document in documents.items():
        validate_av_keys(document)
        if name.endswith(".td.json"):
            validator.validate(document)
            check("Unmodified native TD schema validates: " + name, True)
            forms = list(native_forms(document))
            identities = [form["@id"] for form in forms if "@id" in form]
            check("Named native Form identities are unique: " + name, len(identities) == len(set(identities)))
            for offer in document.get("av:offer", []):
                validate_offer(offer)
                offer_count += 1
                for mode in offer["av:mode"]:
                    form_id = mode["av:form"]

                    def resolve():
                        return resolve_native_form(offer["av:document"], form_id, native_documents,
                                                   expected_source=offer["av:source"])

                    if form_id in expectations["unsupportedNativeAccess"]:
                        negative("Native template access needs explicit parameters: " + form_id, resolve,
                                 match=r"^Required native invocation parameter context",
                                 category="documented-native-limit")
                        unresolved[form_id] = expectations["unsupportedNativeAccess"][form_id]
                    else:
                        selected = resolve()
                        check("Mode addresses only a uniquely owned native Form", selected.form["@id"] == form_id)
        for node in nodes(document):
            types = node.get("@type", [])
            types = [types] if isinstance(types, str) else types
            if "av:Need" in types:
                validate_need(node)
                need_count += 1
            if "av:FormReference" in types:
                resolve_form(node, native_documents)
                reference_count += 1
    check("Every declared unresolved native access is checked explicitly",
          set(unresolved) == set(expectations["unsupportedNativeAccess"]))
    from native_parameters import InvocationParameters
    fixture = read(relative_file("av/tools/fixtures/native-parameters.json"))["rawImage"]
    invocation = fixture["parameters"]
    expanded = resolve_form(fixture["reference"], native_documents, parameters=InvocationParameters(
        uri_variables=invocation["uriVariables"], required_uri_variables=tuple(invocation["requiredUriVariables"])))
    check("Explicit synthetic native parameter fixture expands without an invented runtime result",
          expanded.form["href"] == fixture["expectedHref"])
    oracle = run_authored_oracle(checks, expectations["matchingOracle"])
    two_inputs = documents["av/examples/two-input-need.jsonld"]["av:input"]
    required = next(item for item in two_inputs if item["av:presence"] == "av:Required")
    optional = next(item for item in two_inputs if item["av:presence"] == "av:Optional")
    check("Omitting a Required input is not a metadata selection", not matches_input(required))
    check("Optional permits omission of that entire input only", matches_input(optional))

    result_need = documents["av/examples/result-need.jsonld"]
    producer = resolve_form(result_need["av:result"], native_documents)
    destination = resolve_form(result_need["av:destination"], native_documents)
    result_schema = native_payload_schema(producer)
    destination_schema = native_payload_schema(destination, "destination")
    check("Result schema comes from native Action output, not an AV contract copy",
          producer.kind == "actions" and result_schema == producer.affordance["output"])
    check("Destination schema comes from the native receiving Action input",
          destination.kind == "actions" and destination_schema == destination.affordance["input"])
    check("The illustrative processor explicitly declares the destination parameter",
          "destination" in producer.affordance["input"]["properties"]
          and "destination" not in producer.affordance["input"].get("required", []))
    check("A requested result path does not add Assignment or ResultContract types",
          not {"Assignment", "ResultContract"}.intersection(model.TERMS["classes"]))

    source = documents["av/examples/source.td.json"]
    live = documents["av/examples/live.td.json"]
    jpeg_query = relative_file("av/samples/queries/query.rq").read_text(encoding="utf-8")
    live_query = relative_file("av/samples/queries/live.query.rq").read_text(encoding="utf-8")
    source_dataset = dataset_for(source, "urn:fixture:query:still")
    live_dataset = dataset_for(live, "urn:fixture:query:live")
    jpeg_rows = list(source_dataset.query(jpeg_query))
    live_rows = list(live_dataset.query(live_query))
    check("Still discovery query returns the actual native Form and Mode", len(jpeg_rows) == 1
          and str(jpeg_rows[0].source) == source["id"]
          and str(jpeg_rows[0].form) == source["av:offer"][0]["av:mode"][0]["av:form"])
    check("Live discovery query returns one same-Mode audio/video candidate", len(live_rows) == 1)
    rejected = {"live-input-versus-still": len(list(source_dataset.query(live_query)))}
    changed = copy.deepcopy(live)
    changed["av:offer"][0]["av:mode"][0]["av:kind"] = "av:Clip"
    rejected["finite-clip-versus-live"] = len(list(dataset_for(changed, "urn:fixture:query:clip").query(live_query)))
    changed = copy.deepcopy(live)
    modes = changed["av:offer"][0]["av:mode"]
    audio = next(track for track in modes[0]["av:track"] if track["av:representation"] == "av:EncodedAudio")
    modes[0]["av:track"].remove(audio)
    modes.append({**copy.deepcopy(modes[0]), "@id": modes[0]["@id"] + ":other", "av:track": [audio]})
    rejected["audio-in-another-mode"] = len(list(dataset_for(changed, "urn:fixture:query:split-mode").query(live_query)))
    requirement = documents["av/examples/live-need.jsonld"]["av:input"][0]
    check("Whole-Mode matcher also rejects split audio/video facts",
          not any(matches_input(requirement, changed["av:offer"][0], mode) for mode in modes))
    split = dataset_for(live, "urn:fixture:query:video-graph")
    video_graph = split.graph(URIRef("urn:fixture:query:video-graph"))
    audio_graph = split.graph(URIRef("urn:fixture:query:audio-graph"))
    audio_id = URIRef(audio["@id"])
    moved = set(video_graph.triples((None, AV.track, audio_id))) | set(video_graph.triples((audio_id, None, None)))
    for triple in moved:
        video_graph.remove(triple)
        audio_graph.add(triple)
    rejected["audio-in-another-graph"] = len(list(split.query(live_query)))
    ghost = dataset_for(source, "urn:fixture:query:outside-native")
    graph = ghost.graph(URIRef("urn:fixture:query:outside-native"))
    form_id = URIRef(source["av:offer"][0]["av:mode"][0]["av:form"])
    graph.remove((None, TD.hasForm, form_id))
    rejected["form-outside-native-membership"] = len(list(ghost.query(jpeg_query)))
    changed = copy.deepcopy(live)
    mode = changed["av:offer"][0]["av:mode"][0]
    video = next(track for track in mode["av:track"] if track["av:representation"] == "av:EncodedVideo")
    video["av:frameRate"] = {"@type": "av:Rational", "av:numerator": 30000, "av:denominator": 1001}
    rejected["exact-30000-over-1001-is-not-30"] = len(list(dataset_for(changed, "urn:fixture:query:exact-rate").query(live_query)))
    check("Schema matching preserves the exact-rate distinction",
          not matches_input(requirement, changed["av:offer"][0], mode))
    check("Every declared negative discovery case was exercised", set(rejected) == set(expectations["negativeQueryCases"]))
    for name, count in rejected.items():
        check("Discovery rejects " + name, count == 0, {"rows": count}, category="expected-negative")
    expected_dataset = canonical_dataset({
        graph_id: documents[item["path"]] for graph_id, item in manifest["graphs"].items()
    })
    check("Canonical dataset preserves the explicit named document graphs",
          relative_file("av/examples/dataset.nq").read_bytes() == expected_dataset)
    adapter = read(relative_file("onvif/examples/onvif-adapter.json"))
    check("ONVIF example remains ordinary adapter configuration, not AV control vocabulary",
          not any(key.startswith("av:") for node in nodes(adapter) for key in node))
    for name in ("av/examples/pins.jsonld", "av/examples/assignment.jsonld", "av/examples/controller.td.json"):
        check("Retired machinery exists only in the historical snapshot: " + name,
              not relative_file(name).exists())
    check("No active profile document family remains", not list((relative_file("av/examples") / "profiles").glob("*.json")))
    return {
        "tds": sum(name.endswith(".td.json") for name in documents),
        "offers": offer_count, "needs": need_count, "formReferences": reference_count,
        "authoredOracle": oracle, "negativeQueryRows": rejected,
        "unresolvedNativeAccess": unresolved,
        "runtimeAcceptance": "Not evaluated; native operations, decoding, authorization and delivery were not exercised.",
    }
