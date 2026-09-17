"""Run document-derived oracles and two explicit, loopback-only workflow pilots."""

import argparse
import copy
import hashlib
import io
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag

from jsonschema import Draft7Validator, Draft202012Validator
from lxml import etree
from PIL import Image


PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument("--repo", required=True, type=Path)
PARSER.add_argument("--output", required=True, type=Path)
PARSER.add_argument("--node", required=True, type=Path)
PARSER.add_argument("--td-schema", required=True, type=Path)
ARGS = PARSER.parse_args()
REPO = ARGS.repo.resolve()
ROOT = REPO / "onvif"
FIXTURES = ROOT / "tools" / "fixtures" / "implementer"
SAMPLE = ROOT / "samples" / "applications" / "spec-consumer"
sys.path.insert(0, str(SAMPLE))
from av_match import compile_contract, match, normalize, resolve_form
from consumer import Consumer, http_exchange, qname_value
from native_fixture import CameraFixture
from public_contract import (
    Catalog, ConsumerError, DEVICE, MEDIA, PROFILES, SNAPSHOT, SOAP,
    WSA2004, WSA2005, native_documents, parse_json, parse_xml, read_json
)


ORACLES = read_json(FIXTURES / "oracles.json")
ORACLE_HASH = "c29c8a62360b87279d05a5db3e7d0df193eb5d38a875c867c1cb53d66e3d2972"
EVIDENCE = {
    "startedAt": datetime.now(timezone.utc).isoformat(),
    "oracleSha256": ORACLE_HASH,
    "initialOracleSha256": "289d9ed4128b773d7d7d517deedc766b4f9d9dadf03b71df2fb942f3e50c4c95",
    "scope": ORACLES["scope"],
    "specGaps": [],
    "observations": {}
}


def save(name, value):
    ARGS.output.mkdir(parents=True, exist_ok=True)
    (ARGS.output / name).write_text(json.dumps(value, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")


def xml_shape(node):
    return (node.tag, dict(node.attrib), node.text or "", [xml_shape(child) for child in node])


def references(value):
    if isinstance(value, dict):
        if "tm:ref" in value:
            yield value["tm:ref"]
        for link in value.get("links", []):
            if link["rel"] == "tm:extends":
                yield link["href"]
        for item in value.values():
            yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


class Exercise(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if hashlib.sha256((FIXTURES / "oracles.json").read_bytes()).hexdigest() != ORACLE_HASH:
            raise AssertionError("Frozen oracle bytes changed")
        cls.catalog = Catalog(ROOT)
        cls.terms = read_json(REPO / "av" / "terms.json")
        cls.binding = Draft202012Validator(read_json(ROOT / "binding.schema.json"))
        schema_bytes = ARGS.td_schema.read_bytes()
        if hashlib.sha256(schema_bytes).hexdigest() != "87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da":
            raise AssertionError("Supply the documented pinned TD 1.1 schema")
        cls.td_validator = Draft7Validator(json.loads(schema_bytes))
        cls.models = {model["id"]: model for model in read_json(ROOT / "models.json")["models"]}
        cls.requirements = read_json(ROOT / "requirements-index.json")

    def rejected(self, category, operation):
        with self.assertRaises(ConsumerError) as raised:
            operation()
        self.assertEqual(raised.exception.category, category)
        return raised.exception

    def documents(self, fixture):
        return native_documents(self.catalog, fixture.origin, ORACLES["native"]["logicalAddress"],
                                [ORACLES["native"]["referenceHeader"]])

    def test_01_public_descriptor_grammar_and_rejecting_library_root(self):
        schema = read_json(ROOT / "mapping.schema.json")
        Draft202012Validator(schema).validate(self.catalog.data)
        self.assertEqual(len(self.catalog.operations), 579)
        self.assertFalse(Draft202012Validator(self.catalog.payloads).is_valid({}))
        self.assertEqual(self.catalog.data["registryDigest"], ORACLES["native"]["registryDigest"])

    def test_02_models_all_seven_wrappers_and_separate_roles(self):
        requirements = self.requirements["requirements"]
        counts = Counter((row["profile"], row["role"]) for row in requirements)
        clients = [model for model in self.models.values() if model.get("kind") == "client-requirement-manifest"]
        self.assertEqual(len(clients), 7)
        visited, active = set(), set()

        def resolve(reference):
            identity, fragment = urldefrag(reference)
            self.assertIn(identity, self.models, reference)
            node = self.models[identity]
            if fragment:
                self.assertTrue(fragment.startswith("/"), reference)
                for segment in fragment[1:].split("/"):
                    node = node[segment.replace("~1", "/").replace("~0", "~")]
            return identity, node

        def walk(identity):
            self.assertNotIn(identity, active, "Model import cycle")
            if identity in visited:
                return
            active.add(identity)
            model = self.models[identity]
            self.assertLessEqual(sum(link["rel"] == "tm:extends" for link in model.get("links", [])), 1)
            for reference in references(model):
                target, unused = resolve(reference)
                self.assertNotEqual(self.models[target].get("kind"), "client-requirement-manifest")
                walk(target)
            active.remove(identity)
            visited.add(identity)

        for identity, model in self.models.items():
            if model.get("@type") == "tm:ThingModel":
                walk(identity)
        wrapper_counts = {}
        for profile, pair in ORACLES["scope"]["profileRoles"].items():
            self.assertEqual([counts[(profile, "device")], counts[(profile, "client")]], pair)
            wrappers = [model for identity, model in self.models.items()
                        if "/profiles/Profile-" + profile + "-" in identity]
            self.assertEqual(len(wrappers), 2, "One preserved native wrapper and one additive abstraction")
            expected = {row["id"] for row in requirements if row["profile"] == profile and row["role"] == "device"}
            for wrapper in wrappers:
                self.assertEqual(set(wrapper["onvif:requirements"]), expected)
                client = self.models[wrapper["onvif:clientRequirements"]]
                self.assertEqual(client["role"], "client")
                self.assertFalse(client["createsClientThing"])
                client_expected = {row["id"] for row in requirements
                                   if row["profile"] == profile and row["role"] == "client"}
                self.assertEqual(set(client["requirements"]), client_expected)
            wrapper_counts[profile] = pair
        roles = Counter(item["role"] for item in self.catalog.manifest["artifacts"])
        self.assertEqual(roles["thing-model"], len(visited))
        for artifact in self.catalog.manifest["artifacts"]:
            if artifact["role"] in ("thing-model", "client-requirement-manifest"):
                path = REPO.joinpath(*artifact["physicalPath"].split("/"))
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), artifact["sha256"])
        EVIDENCE["observations"]["modelClosure"] = {
            "thingModels": len(visited), "clientManifests": len(clients),
            "profileRoleCounts": wrapper_counts, "nativeAndAbstractWrappers": 14,
            "executionClaim": False
        }

    def test_03_contextual_ordinary_dataschema_probe(self):
        ordinary = {"actions": {"ordinary": {"input": ORACLES["classification"]["ordinaryNonCanonicalActionInput"]}}}
        errors = list(self.binding.iter_errors(ordinary))
        if errors:
            EVIDENCE["specGaps"].append({
                "id": "IMPL-GAP-01",
                "paragraph": "onvif/spec.md:246-260,3590-3599; onvif/binding.schema.json:19-30,253-287",
                "expected": "An ordinary noncanonical Action DataSchema is permitted.",
                "observed": [error.message for error in errors],
                "repair": "Apply canonicalData requirements only in canonical operation/data contexts."
            })
        EVIDENCE["observations"]["ordinaryDataSchemaAccepted"] = not errors

    def test_04_literal_encode_order_and_native_type_words(self):
        op = self.catalog.operations[PROFILES]
        actual = self.catalog.codec.encode(op["request"], ORACLES["native"]["filteredProfilesInput"])
        expected = parse_xml(ORACLES["native"]["filteredProfilesRequest"].encode())
        self.assertEqual(xml_shape(actual), xml_shape(expected))
        self.assertEqual(actual[1].text, "All", "Native Type is a string word, not a QName object")
        self.rejected("InvalidValue", lambda: self.catalog.codec.encode(op["request"], {
            "Type": [{"namespace": MEDIA, "localName": "All"}]
        }))
        empty = self.catalog.codec.encode(op["request"], {})
        self.assertEqual(xml_shape(empty), xml_shape(parse_xml(ORACLES["native"]["emptyProfilesRequest"].encode())))

    def test_05_literal_response_and_repeated_empty_array(self):
        op = self.catalog.operations[PROFILES]
        for source, expected in (("profilesResponse", "profilesResult"), ("emptyProfilesResponse", "emptyProfilesResult")):
            with self.subTest(source=source):
                result = self.catalog.codec.decode(op["response"], parse_xml(ORACLES["native"][source].encode()))
                self.assertEqual(result, ORACLES["native"][expected])
                self.catalog.validate(PROFILES, "output", result)

    def test_06_absent_default_nil_and_missing_required(self):
        oracle = ORACLES["canonicalAbsence"]
        for label in ("absent", "default", "nil"):
            with self.subTest(label=label):
                result = self.catalog.codec.decode(oracle["descriptor"], parse_xml(oracle[label + "Xml"].encode()))
                self.assertEqual(result, oracle[label + "Json"])
                encoded = self.catalog.codec.encode(oracle["descriptor"], result)
                self.assertEqual(xml_shape(encoded), xml_shape(parse_xml(oracle[label + "Xml"].encode())))
        request = self.catalog.operations[SNAPSHOT]["request"]
        self.rejected("InvalidValue", lambda: self.catalog.codec.encode(request, {}))
        response = self.catalog.operations[SNAPSHOT]["response"]
        for label in ("missingSnapshotField", "nilSnapshotField"):
            self.rejected("InvalidValue", lambda: self.catalog.codec.decode(
                response, parse_xml(ORACLES["native"][label].encode())))
        unknown = {"name": {"namespace": "urn:example:value", "localName": "Unknown"},
                   "type": {"kind": "unsupported", "feature": "not-implemented"}}
        self.rejected("UnsupportedCapability", lambda: self.catalog.codec.encode(unknown, {}))

    def test_07_native_workflow_repeat_dynamic_tokens_and_cli(self):
        for repetition in range(2):
            declaration = read_json(FIXTURES / "native-source.json")
            if repetition:
                declaration["profiles"][0]["token"] = "rotated-main-47"
                declaration["profiles"][1]["token"] = "rotated-detail-61"
            with CameraFixture(declaration) as fixture:
                td, model, policy = self.documents(fixture)
                self.td_validator.validate(td)
                self.binding.validate(td)
                self.assertEqual(len([link for link in td["links"] if link["rel"] == "type"]), 1)
                self.assertFalse(td["onvif:projection"]["fullProfile"])
                self.assertTrue(td["onvif:projection"]["nativeProtocol"])
                for action in td["actions"].values():
                    self.assertFalse(action["safe"])
                    self.assertFalse(action["idempotent"])
                client = Consumer(self.catalog, td, policy, fixture.origin + "/camera.td.json")
                info = client.invoke(DEVICE, {})
                self.assertEqual(info["HardwareId"], "software-only")
                profiles = client.invoke(PROFILES)
                if not repetition:
                    self.assertEqual(profiles, ORACLES["native"]["profilesResult"])
                for expected, profile in zip(declaration["profiles"], profiles["Profiles"], strict=True):
                    token = profile["$attributes"]["token"]
                    self.assertEqual(token, expected["token"])
                    self.assertNotIn("Configurations", profile, "Omitted Type cannot become configuration evidence")
                    result = client.invoke(SNAPSHOT, {"ProfileToken": token})
                    self.assertEqual(result, {"Uri": fixture.origin + "/images/" + token + ".jpg"})
                    raw = client.jpeg(result["Uri"])
                    image = Image.open(io.BytesIO(raw))
                    image.load()
                    self.assertEqual(image.format, "JPEG")
                    self.assertEqual(image.size, (64, 48))
                    self.assertTrue(all(abs(actual - wanted) <= 3 for actual, wanted
                                        in zip(image.convert("RGB").getpixel((20, 20)), (20, 40, 60))))
                directory = ARGS.output / ("native-repeat-" + str(repetition))
                directory.mkdir(parents=True, exist_ok=True)
                for name, value in (("camera.td.json", td), ("camera.tm.json", model), ("policy.json", policy)):
                    (directory / name).write_text(json.dumps(value, indent=4) + "\n", encoding="utf-8")
                result = subprocess.run([
                    sys.executable, str(SAMPLE / "consumer.py"), "--onvif-root", str(ROOT),
                    "--td", str(directory / "camera.td.json"), "--policy", str(directory / "policy.json"),
                    "--profiles-input", str(SAMPLE / "get-profiles.json"),
                    "--document-uri", fixture.origin + "/camera.td.json", "--all-profiles"
                ], capture_output=True, text=True, timeout=15, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual([row["ProfileToken"] for row in json.loads(result.stdout)["snapshots"]],
                                 [row["token"] for row in declaration["profiles"]])
                posts = [item for item in fixture.requests if item["method"] == "POST"]
                self.assertTrue(all(item["operation"] in ("GetDeviceInformation", "GetProfiles", "GetSnapshotUri")
                                    for item in posts))
                self.assertTrue(all(item["soapActionHeader"] is None for item in posts))
                for item in posts:
                    root = parse_xml(item["xml"].encode())
                    self.assertIn('action="' + root.find("{" + SOAP + "}Header/{" + WSA2005 + "}Action").text + '"',
                                  item["contentType"])
                save("native-requests-" + str(repetition) + ".json", fixture.requests)
        EVIDENCE["observations"]["native"] = {"repetitions": 2, "dynamicTokenSets": 2, "responseStatus": 201,
                                               "operations": [DEVICE, PROFILES, SNAPSHOT], "credentials": "explicit nosec"}

    def test_08_native_fault_preserves_subcodes_reason_node_role_detail(self):
        with CameraFixture(read_json(FIXTURES / "native-source.json")) as fixture:
            td, model, policy = self.documents(fixture)
            client = Consumer(self.catalog, td, policy, fixture.origin)
            error = self.rejected("NativeFault", lambda: client.invoke(SNAPSHOT, {"ProfileToken": "not-issued"}))
            expected = ORACLES["native"]["fault"]
            self.assertEqual(error.certainty, expected["certainty"])
            for key in ("code", "subcodes", "reasons", "node", "role"):
                self.assertEqual(error.detail[key], expected[key])
            detail = parse_xml(error.detail["detailXml"].encode())
            self.assertEqual(xml_shape(detail[0]), xml_shape(parse_xml(expected["detail"].encode())))

    def test_09_native_bad_responses_are_not_success(self):
        with CameraFixture(read_json(FIXTURES / "native-source.json")) as fixture:
            td, model, policy = self.documents(fixture)
            client = Consumer(self.catalog, td, policy, fixture.origin)
            for mode, category in (("wrong-root", "InvalidXml"), ("missing-uri", "InvalidValue"),
                                   ("nil-uri", "InvalidValue"), ("must-understand", "UnsupportedCapability"),
                                   ("charset", "UnsupportedCapability")):
                with self.subTest(mode=mode):
                    fixture.reply_mode = mode
                    error = self.rejected(category, lambda: client.invoke(SNAPSHOT, ORACLES["native"]["snapshotInput"]))
                    self.assertEqual(error.certainty, "unknown")

    def test_10_epr_qname_routing_versions_and_denial_before_send(self):
        with CameraFixture(read_json(FIXTURES / "native-source.json")) as fixture:
            td, model, policy = self.documents(fixture)
            for namespace in (WSA2005, WSA2004):
                policy["epr"]["addressingNamespace"] = namespace
                if namespace == WSA2004:
                    policy["epr"]["referenceProperties"] = policy["epr"]["referenceParameters"]
                    policy["epr"]["referenceParameters"] = []
                client = Consumer(self.catalog, td, policy, fixture.origin)
                client.invoke(PROFILES)
                request = parse_xml(fixture.requests[-1]["xml"].encode())
                header = request.find("{" + SOAP + "}Header")
                route = header.find("{urn:example:implementer:routing}Route")
                self.assertIsNotNone(route)
                self.assertEqual(route[0].tag, "{urn:example:implementer:routing}Slot")
                self.assertEqual(route[0].text, "n:Entrance")
                self.assertEqual(route[0].nsmap["n"], "urn:example:implementer:names")
                marker = route.get("{" + WSA2005 + "}IsReferenceParameter")
                self.assertEqual(marker, "true" if namespace == WSA2005 else None)
                self.assertEqual(header.find("{" + namespace + "}To").text, ORACLES["native"]["logicalAddress"])
            policy["approvedLogicalRoute"] = False
            sent = len(fixture.requests)
            self.rejected("PolicyDenied", lambda: Consumer(self.catalog, td, policy, fixture.origin).invoke(PROFILES))
            self.assertEqual(len(fixture.requests), sent)
            wrong = copy.deepcopy(td)
            wrong["actions"][PROFILES]["forms"][0]["onvif:operation"]["bindingQName"]["localName"] = "MediaBinding"
            self.rejected("InvalidContract", lambda: Consumer(self.catalog, wrong, policy, fixture.origin).invoke(PROFILES))
            self.assertEqual(len(fixture.requests), sent)

    def test_11_av_literal_from_root_document_and_whole_modes(self):
        spec = (REPO / "av" / "spec.md").read_text(encoding="utf-8")
        marker = "<!-- example: av/examples/source.td.json#/av:offer/0 -->"
        source = spec.split(marker, 1)[1].split("```json", 1)[1].split("```", 1)[0]
        offer = json.loads(source)
        self.assertEqual(normalize(offer, offer["av:mode"][0]["@id"], self.terms),
                         ORACLES["av"]["literalJpegComparison"])
        offer, need = read_json(FIXTURES / "av-offer.json"), read_json(FIXTURES / "av-need.json")
        unchanged = copy.deepcopy(offer)
        outcomes = {}
        for suffix, expected in (("exact-audio", "MATCH"), ("thirty-audio", "NON_MATCH"),
                                 ("exact-only", "NON_MATCH"), ("audio-only", "NON_MATCH")):
            actual = match(offer, "urn:example:implementer:mode:" + suffix, need, self.terms)
            self.assertEqual(actual, expected)
            outcomes[suffix] = actual
        self.assertEqual(offer, unchanged)
        EVIDENCE["observations"]["wholeMode"] = outcomes

    def test_12_av_defaults_absence_reduction_and_unsupported_not_nonmatch(self):
        offer = read_json(FIXTURES / "av-offer.json")
        need = read_json(FIXTURES / "av-need.json")
        mode = offer["av:mode"][0]
        offer["av:mode"] = [mode]
        mode["av:track"][0].pop("av:cadence")
        mode["av:track"][0].pop("av:frameRate")
        need["av:input"][0]["av:accepts"] = {
            "properties": {"av:track": {"contains": {
                "required": ["av:cadence"],
                "properties": {"av:cadence": {"const": "av:Constant", "default": "av:Constant"}}
            }}}
        }
        self.assertEqual(match(offer, mode["@id"], need, self.terms), "NON_MATCH")
        before = normalize(offer, mode["@id"], self.terms)
        validator = compile_contract({"properties": {"missing": {"default": "not-inserted"}}})
        self.assertTrue(validator.is_valid(before))
        self.assertNotIn("missing", before)
        self.rejected("UnsupportedCapability", lambda: compile_contract({"prefixItems": [{}]}))
        self.rejected("UnsupportedCapability", lambda: compile_contract({"$ref": "#"}))
        mode["av:track"][0]["av:cadence"] = "av:Constant"
        mode["av:track"][0]["av:frameRate"] = {"av:numerator": 60000, "av:denominator": 2002}
        self.rejected("InvalidValue", lambda: normalize(offer, mode["@id"], self.terms))

    def test_13_rfc6570_parameters_and_preserved_native_metadata(self):
        form = {
            "@id": "urn:example:form", "href": "images/{imageId}.bgr",
            "contentType": "application/octet-stream", "htv:methodName": "GET",
            "response": {"contentType": "application/octet-stream"},
            "additionalResponses": [{"contentType": "application/problem+json", "success": False,
                                      "htv:statusCodeValue": 404, "schema": "problem"}]
        }
        td = {
            "id": "urn:example:processor", "securityDefinitions": {"anonymous": {"scheme": "nosec"}},
            "security": ["anonymous"], "uriVariables": {"imageId": {"type": "integer", "default": 7}},
            "properties": {"image": {"readOnly": True, "uriVariables": {
                "imageId": {"type": "string", "minLength": 1}
            }, "forms": [form]}}
        }
        oracle = ORACLES["av"]["template"]
        result = resolve_form(td, oracle["document"], form["@id"], oracle["values"], ["imageId"])
        self.assertEqual(result["href"], oracle["expected"])
        self.assertEqual(result["form"], form, "Do not drop protocol/response annotations")
        self.rejected("InvalidValue", lambda: resolve_form(td, oracle["document"], form["@id"], {}, ["imageId"]))
        second = ORACLES["av"]["reservedTemplate"]
        form["href"] = second["href"]
        td["uriVariables"] = {"path": {"type": "string"}, "query": {"type": "string"},
                              "flag": {"type": "boolean"}, "part": {"type": "string"}}
        result = resolve_form(td, second["document"].replace("PORT", "49123"), form["@id"], second["values"], [])
        self.assertEqual(result["href"], second["expected"].replace("PORT", "49123"))

    def test_14_adapter_actual_mf_memory_http_json_jpeg_and_natural_close(self):
        declaration = read_json(FIXTURES / "mf-memory-source.json")
        config = dict(declaration)
        config.update({
            "adapterModule": str(ROOT / "samples" / "adapters"),
            "workerPath": str(ROOT / "samples" / "adapters" / "build-windows" / "windows-capture-worker.exe"),
            "controlToken": os.urandom(24).hex(),
            "imageToken": os.urandom(24).hex()
        })
        process = subprocess.Popen([str(ARGS.node), str(Path(__file__).with_name("mf_fixture.cjs"))],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8")
        process.stdin.write(json.dumps(config) + "\n")
        process.stdin.flush()
        ready = None
        messages = queue.Queue(maxsize=1)

        def read_ready():
            for line in process.stdout:
                if line.startswith('{"type":"ready"'):
                    messages.put(line)
                    return
            messages.put(None)

        reader = threading.Thread(target=read_ready, name="implementer-mf-handshake")
        reader.start()
        try:
            line = messages.get(timeout=15)
            ready = json.loads(line) if line is not None else None
            reader.join(2)
            self.assertFalse(reader.is_alive(), "Handshake reader did not settle")
            if ready is None:
                process.wait(timeout=5)
                self.fail("MF fixture did not become ready: " + process.stderr.read())
            status, content_type, document = http_exchange(
                "GET", ready["tdUri"], None, {"Authorization": "Bearer " + config["controlToken"]},
                time.monotonic() + 5, 1024 * 1024)
            self.assertEqual(status, 200)
            td = json.loads(document)
            self.td_validator.validate(td)
            self.binding.validate(td)
            self.assertEqual(ready["plannedGeometry"], "UnsupportedCapability")
            self.assertEqual(td["onvif:projection"]["category"], "wotSemanticProfile")
            self.assertFalse(td["onvif:projection"]["nativeProtocol"])
            self.assertFalse(td["onvif:projection"]["fullProfile"])
            self.assertNotIn("onvif:profileClaims", td)
            types = td["@type"] if isinstance(td["@type"], list) else [td["@type"]]
            self.assertFalse(set(types) & {"onvif:NativeContract", "onvif:Device"})
            targets, control_names = {}, set()
            for operation in (PROFILES, SNAPSHOT):
                form = td["actions"][operation]["forms"][0]
                targets[operation] = form["href"]
                self.assertEqual(form["contentType"], "application/json")
                self.assertFalse(set(form) & set(ORACLES["classification"]["adapter"]["forbiddenFormTerms"]))
                security = form.get("security", td["security"])
                control_names.update([security] if isinstance(security, str) else security)
            image_forms = [form for item in td["properties"].values() for form in item["forms"]
                           if form["contentType"] == "image/jpeg"]
            self.assertEqual(len(image_forms), 1)
            image_security = image_forms[0].get("security", td["security"])
            image_names = [image_security] if isinstance(image_security, str) else image_security
            credentials = {name: config["controlToken"] for name in control_names}
            credentials.update({name: config["imageToken"] for name in image_names})
            self.assertFalse(control_names & set(image_names), "Image and control credentials remain separate")
            uri = ready["snapshotUri"]
            policy = {"thingId": td["id"], "principal": "configured-software-test-client",
                      "targets": targets, "imagePrefix": uri, "imageSecurity": image_names}
            client = Consumer(self.catalog, td, policy, ready["tdUri"], credentials)
            profiles = client.invoke(PROFILES, {})
            self.assertEqual(profiles, {"Profiles": [declaration["profile"]]})
            token = profiles["Profiles"][0]["$attributes"]["token"]
            result = client.invoke(SNAPSHOT, {"ProfileToken": token})
            self.assertEqual(result, {"Uri": uri})
            raw = client.jpeg(result["Uri"])
            self.assertTrue(raw.startswith(b"\xff\xd8") and raw.endswith(b"\xff\xd9"))
            image = Image.open(io.BytesIO(raw))
            image.load()
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (declaration["width"], declaration["height"]))
            self.assertEqual(len(image.convert("RGB").tobytes()), declaration["width"] * declaration["height"] * 3)
            self.assertGreater(len(set(image.convert("RGB").get_flattened_data())), 1)
            self.rejected("NativeFault", lambda: client.invoke(SNAPSHOT, {"ProfileToken": "not-issued"}))
            links = [link for link in td["links"] if link["rel"] == "type"]
            self.assertEqual(len(links), 1)
            status, content_type, body = http_exchange("GET", links[0]["href"], None,
                {"Authorization": "Bearer " + config["controlToken"]}, time.monotonic() + 5, 1024 * 1024)
            self.assertEqual(status, 200)
            composite = json.loads(body)
            self.assertLessEqual(sum(link["rel"] == "tm:extends" for link in composite.get("links", [])), 1)
            pending = list(references(composite))
            seen = set()
            while pending:
                reference = pending.pop()
                identity, fragment = urldefrag(reference)
                self.assertIn(identity, self.models)
                self.assertIn("/abstract/", identity, "Adapter import closure must be form-free abstraction")
                node = self.models[identity]
                if fragment:
                    self.assertTrue(fragment.startswith("/"))
                    for segment in fragment[1:].split("/"):
                        key = segment.replace("~1", "/").replace("~0", "~")
                        self.assertIn(key, node)
                        node = node[key]
                if identity not in seen:
                    seen.add(identity)
                    model = self.models[identity]
                    self.assertFalse(any("forms" in action for action in model.get("actions", {}).values()))
                    pending.extend(references(model))
            save("mf-memory-camera.td.json", td)
            save("mf-memory-camera.tm.json", composite)
            save("mf-memory-policy.json", policy)
            (ARGS.output / "mf-memory-snapshot.jpg").write_bytes(raw)
            environment = dict(os.environ)
            environment["IMPLEMENTER_CONTROL"] = config["controlToken"]
            environment["IMPLEMENTER_IMAGE"] = config["imageToken"]
            credential_args = []
            for name in sorted(control_names):
                credential_args.extend(["--credential-env", name + "=IMPLEMENTER_CONTROL"])
            for name in image_names:
                credential_args.extend(["--credential-env", name + "=IMPLEMENTER_IMAGE"])
            with tempfile.TemporaryDirectory(prefix="implementer-cli-", dir=ARGS.output) as image_directory:
                command = subprocess.run([
                    sys.executable, str(SAMPLE / "consumer.py"), "--onvif-root", str(ROOT),
                    "--td", str(ARGS.output / "mf-memory-camera.td.json"),
                    "--policy", str(ARGS.output / "mf-memory-policy.json"),
                    "--profiles-input", str(SAMPLE / "get-profiles.json"),
                    "--document-uri", ready["tdUri"], "--all-profiles",
                    "--image-directory", image_directory
                ] + credential_args, capture_output=True, text=True, timeout=12, env=environment, check=False)
                self.assertEqual(command.returncode, 0, command.stdout + command.stderr)
                command_result = json.loads(command.stdout)
                self.assertEqual(command_result["snapshots"][0]["ProfileToken"], token)
                with Image.open(command_result["snapshots"][0]["image"]["path"]) as cli_image:
                    cli_image.load()
                    self.assertEqual(cli_image.size, (declaration["width"], declaration["height"]))
            denied_credentials = dict(credentials)
            for name in control_names:
                denied_credentials[name] = "intentionally-wrong-ephemeral-credential"
            denied = Consumer(self.catalog, td, policy, ready["tdUri"], denied_credentials)
            denied_error = self.rejected("PolicyDenied", lambda: denied.invoke(PROFILES, {}))
            self.assertEqual(denied_error.detail, {"httpStatus": 403})
            EVIDENCE["observations"]["adapter"] = {
                "backend": "mf-memory", "width": image.width, "height": image.height,
                "jpegBytes": len(raw), "jpegSha256": hashlib.sha256(raw).hexdigest(),
                "abstractImportDocuments": len(seen), "profileToken": token,
                "nativeProtocol": False, "fullProfile": False,
                "planned64x48": "UnsupportedCapability; preserved frozen assumption, not silently resized"
            }
        finally:
            if ready is not None and process.poll() is None:
                process.stdin.write("close\n")
                process.stdin.flush()
            process.stdin.close()
            process.wait(timeout=12)
            remaining = process.stdout.read()
            errors = process.stderr.read()
            process.stdout.close()
            process.stderr.close()
            reader.join(2)
            self.assertFalse(reader.is_alive(), "Owned handshake reader did not close")
            self.assertEqual(process.returncode, 0, errors + remaining)
            closed = [json.loads(line) for line in remaining.splitlines() if line.startswith('{"type":"closed"')]
            self.assertEqual(len(closed), 1)
            self.assertEqual(closed[0]["receipt"]["close"]["workerExit"], "observed")
            EVIDENCE["observations"]["adapterCleanup"] = closed[0]["receipt"]

    def test_15_invalid_inputs_contenttype_and_authentication_are_not_sent(self):
        with CameraFixture(read_json(FIXTURES / "native-source.json")) as fixture:
            td, model, policy = self.documents(fixture)
            client = Consumer(self.catalog, td, policy, fixture.origin)
            self.rejected("InvalidValue", lambda: client.invoke(SNAPSHOT, {}))
            self.rejected("InvalidValue", lambda: client.invoke(PROFILES, {"Type": "All"}))
            for content_type, category in (
                ("application/soap+xml; charset=iso-8859-1", "UnsupportedCapability"),
                ('application/soap+xml; action="urn:not-the-native-action"', "InvalidContract")
            ):
                changed = copy.deepcopy(td)
                changed["actions"][PROFILES]["forms"][0]["contentType"] = content_type
                self.rejected(category, lambda: Consumer(self.catalog, changed, policy, fixture.origin).invoke(PROFILES))
            changed = copy.deepcopy(td)
            changed["securityDefinitions"]["anonymous"] = {"scheme": "digest"}
            self.rejected("UnsupportedCapability", lambda: Consumer(self.catalog, changed, policy, fixture.origin).invoke(PROFILES))
            self.assertEqual(fixture.requests, [], "No network request is allowed by these failures")

    def test_16_invalid_json_xml_and_closed_canonical_fields(self):
        for text in ('{"duplicate":1,"duplicate":2}', '{"number":NaN}', '{"value":"\\ud800"}'):
            self.rejected("InvalidValue", lambda: parse_json(text))
        self.rejected("InvalidXml", lambda: parse_xml(b"<!DOCTYPE x><x/>"))
        self.rejected("InvalidXml", lambda: parse_xml(b"<x>\xff</x>"))
        self.rejected("InvalidValue", lambda: self.catalog.codec.encode(
            self.catalog.operations[SNAPSHOT]["request"], {"ProfileToken": "issued", "invented": True}))
        self.rejected("InvalidValue", lambda: self.catalog.codec.scalar(
            {"kind": "scalar", "type": "boolean"}, "\u00a0true\u00a0", True))
        self.rejected("InvalidXml", lambda: qname_value(parse_xml(
            b'<v xmlns:ter="http://www.onvif.org/ver10/error">ter:NoProfile&#160;</v>')))


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Exercise)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    EVIDENCE["completedAt"] = datetime.now(timezone.utc).isoformat()
    EVIDENCE["tests"] = {
        "run": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
        "successfulExecution": result.wasSuccessful(),
        "details": [{"test": str(test), "traceback": text} for test, text in result.failures + result.errors]
    }
    save("evidence.json", EVIDENCE)
    raise SystemExit(0 if result.wasSuccessful() else 1)
