"""Focused regression contract for the thin offline matcher and its native boundaries."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from rdflib import Literal
from rdflib.namespace import RDF

from common import (
    AV, AV_CONTEXT, TD, RetrievedTD, exact_integer, format_json, graph_for,
    json_bytes, loader_for, native_payload_schema, nodes, read, relative_file,
    resolve_form, resolve_native_form, strict_json, validate_av_keys,
)
from matching import (
    DIALECT, match_mode, matches_input, matches_schema, normalize_mode,
    schema_validator, validate_need, validate_offer,
)
from model import TERMS, make_context


class CoreFixture(unittest.TestCase):
    def setUp(self):
        self.f = copy.deepcopy(read(relative_file("tests/fixtures/core.json")))

    def offered(self, mode=None):
        mode = copy.deepcopy(self.f["mode"] if mode is None else mode)
        return {**self.f["offer"], "av:mode": [mode]}, mode


class NormalizationTests(CoreFixture):
    def test_fixed_descriptor_excludes_identity_security_and_backend_fields(self):
        offer, mode = self.offered(self.f["liveMode"])
        mode["@context"] = AV_CONTEXT
        mode["security"] = ["must-not-leak"]
        mode["backend"] = {"private": "must-not-leak"}
        mode["av:track"][0]["runtime"] = {"decoder": "must-not-leak"}
        before = copy.deepcopy((offer, mode))
        descriptor = normalize_mode(offer, mode)
        self.assertEqual(list(descriptor), ["av:source", "av:kind", "av:track"])
        self.assertEqual(descriptor["av:source"], offer["av:source"])
        self.assertEqual([t["dcterms:identifier"] for t in descriptor["av:track"]], ["picture", "sound"])
        self.assertFalse(any(key in node for node in nodes(descriptor)
                             for key in ("@id", "@type", "@context", "av:form", "security", "runtime", "backend")))
        self.assertEqual((offer, mode), before)
        self.assertEqual(descriptor["av:track"][0]["av:frameRate"],
                         {"av:numerator": 30000, "av:denominator": 1001})

    def test_reordering_tracks_cannot_change_the_descriptor(self):
        offer, mode = self.offered(self.f["liveMode"])
        expected = normalize_mode(offer, mode)
        mode["av:track"].reverse()
        self.assertEqual(normalize_mode(offer, mode), expected)

    def test_exact_expanded_02_iris_normalize_but_other_namespaces_do_not(self):
        offer, mode = self.offered()
        expected = normalize_mode(offer, mode)
        mode["av:kind"] = str(AV.Still)
        track = mode["av:track"][0]
        track["av:representation"] = str(AV.EncodedVideo)
        track["av:codec"] = str(AV.JPEG)
        track[str(AV.width)] = track.pop("av:width")
        self.assertEqual(normalize_mode(offer, mode), expected)
        for value in ("https://example.org/wot/av#JPEG", "urn:elsewhere:JPEG", "av:UnknownCodec"):
            with self.subTest(value=value):
                track["av:codec"] = value
                with self.assertRaisesRegex(ValueError, "Unknown|inapplicable"):
                    normalize_mode(offer, mode)

    def test_unknown_legacy_and_wrong_domain_properties_are_rejected(self):
        for key in ("av:lease", "av:madeUp", "https://example.org/wot/av#codec", "av:destination"):
            offer, mode = self.offered()
            mode["av:track"][0][key] = "urn:example:value"
            with self.subTest(key=key), self.assertRaises(ValueError):
                normalize_mode(offer, mode)

    def test_compact_expanded_duplicates_are_rejected(self):
        offer, mode = self.offered()
        mode["av:track"][0][str(AV.width)] = 1280
        with self.assertRaisesRegex(ValueError, "Duplicate compact"):
            normalize_mode(offer, mode)

    def test_every_essential_representation_fact_is_required(self):
        fixtures = {
            "EncodedVideo": "encodedVideo", "RawVideo": "rawVideo",
            "EncodedAudio": "encodedAudio", "PCM": "pcm",
        }
        for representation, name in fixtures.items():
            for field in TERMS["representation_rules"][representation]["required"]:
                offer, mode = self.offered()
                mode["av:kind"] = "av:Live"
                mode["av:track"] = [copy.deepcopy(self.f["tracks"][name])]
                del mode["av:track"][0]["av:" + field]
                with self.subTest(representation=representation, field=field), self.assertRaisesRegex(ValueError, "Incomplete"):
                    normalize_mode(offer, mode)

    def test_other_missing_description_facts_remain_unknown(self):
        offer, mode = self.offered()
        mode["av:kind"] = "av:Live"
        descriptor = normalize_mode(offer, mode)
        self.assertNotIn("av:cadence", descriptor["av:track"][0])
        self.assertNotIn("av:frameRate", descriptor["av:track"][0])

    def test_representation_applicability_is_not_widened(self):
        cases = [
            ("rawVideo", "av:codec", "av:JPEG"),
            ("encodedVideo", "av:pixelFormat", "av:BGR8"),
            ("encodedVideo", "av:codec", "av:Opus"),
            ("encodedAudio", "av:codec", "av:H264"),
            ("pcm", "av:bufferLayout", "av:Contiguous"),
            ("rawVideo", "av:bufferLayout", "av:Planar"),
        ]
        for name, key, value in cases:
            offer, mode = self.offered()
            mode["av:kind"] = "av:Live"
            mode["av:track"] = [copy.deepcopy(self.f["tracks"][name])]
            mode["av:track"][0][key] = value
            with self.subTest(name=name, key=key), self.assertRaises(ValueError):
                normalize_mode(offer, mode)

    def test_still_has_no_audio_cadence_or_frame_rate(self):
        for name in ("encodedAudio", "constantVideo"):
            offer, mode = self.offered()
            mode["av:track"] = [copy.deepcopy(self.f["tracks"][name])]
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Still"):
                normalize_mode(offer, mode)

    def test_whole_clip_needs_no_clock_selector_or_resource(self):
        offer, mode = self.offered(self.f["clipMode"])
        descriptor = normalize_mode(offer, mode)
        self.assertEqual(descriptor["av:kind"], "av:Clip")
        self.assertEqual(set(descriptor), {"av:source", "av:kind", "av:track"})
        self.assertTrue(match_mode(offer, mode, {"properties": {"av:kind": {"const": "av:Clip"}}}))

    def test_duplicate_track_identifiers_and_ids_fail(self):
        for key in ("@id", "dcterms:identifier"):
            offer, mode = self.offered(self.f["liveMode"])
            mode["av:track"][1][key] = mode["av:track"][0][key]
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "Duplicate Track"):
                normalize_mode(offer, mode)

    def test_only_one_whole_advertised_mode_can_match(self):
        joint = self.f["liveMode"]
        video = {**copy.deepcopy(joint), "@id": "urn:fixture:video", "av:track": [joint["av:track"][0]]}
        audio = {**copy.deepcopy(joint), "@id": "urn:fixture:audio", "av:track": [joint["av:track"][1]]}
        offer = {**self.f["offer"], "av:mode": [video, audio]}
        schema = {"required": ["av:track"], "properties": {"av:track": {"minItems": 2}}}
        self.assertFalse(match_mode(offer, video, schema))
        self.assertFalse(match_mode(offer, audio, schema))
        with self.assertRaisesRegex(ValueError, "complete advertised"):
            match_mode(offer, joint, schema)

    def test_integer_facts_reject_lossy_tokens_and_preserve_large_exact_values(self):
        for value in (True, 1280.0, "1280", 9007199254740992, 0, -1):
            offer, mode = self.offered()
            mode["av:track"][0]["av:width"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_mode(offer, mode)
        offer, mode = self.offered()
        huge = 10 ** 40 + 7
        mode["av:track"][0]["av:width"] = {
            "@value": str(huge), "@type": "http://www.w3.org/2001/XMLSchema#integer",
        }
        self.assertEqual(normalize_mode(offer, mode)["av:track"][0]["av:width"], huge)

    def test_positive_reduced_frame_rate_pairs_are_required(self):
        for numerator, denominator in ((0, 1), (-1, 1), (30, 0), (30, -1), (60, 2), (30.0, 1)):
            offer, mode = self.offered(self.f["liveMode"])
            mode["av:track"][0]["av:frameRate"] = {
                "av:numerator": numerator, "av:denominator": denominator,
            }
            with self.subTest(numerator=numerator, denominator=denominator), self.assertRaises(ValueError):
                normalize_mode(offer, mode)

    def test_constant_cadence_and_rate_are_mutually_conditional(self):
        for remove, cadence in (("av:frameRate", None), ("av:cadence", None), (None, "av:Variable")):
            offer, mode = self.offered(self.f["liveMode"])
            track = mode["av:track"][0]
            if remove:
                del track[remove]
            if cadence:
                track["av:cadence"] = cadence
            with self.subTest(remove=remove, cadence=cadence), self.assertRaisesRegex(ValueError, "Constant"):
                normalize_mode(offer, mode)

    def test_30000_over_1001_does_not_match_30_over_1(self):
        offer, mode = self.offered(self.f["liveMode"])
        schema = {"properties": {"av:track": {"contains": {"properties": {
            "av:frameRate": {"const": {"av:numerator": 30, "av:denominator": 1}},
        }, "required": ["av:frameRate"]}}}}
        self.assertFalse(match_mode(offer, mode, schema))
        mode["av:track"][0]["av:frameRate"] = {"av:numerator": 30, "av:denominator": 1}
        self.assertTrue(match_mode(offer, mode, schema))

    def test_raw_jpeg_is_not_bgr_without_an_advertised_processor_output(self):
        offer, mode = self.offered()
        schema = {"properties": {"av:track": {"items": {
            "required": ["av:representation", "av:pixelFormat"],
            "properties": {"av:representation": {"const": "av:RawVideo"},
                           "av:pixelFormat": {"const": "av:BGR8"}},
        }}}}
        self.assertFalse(match_mode(offer, mode, schema))
        processor_offer, processor_mode = self.offered()
        processor_offer["av:source"] = "urn:fixture:explicit-processor"
        processor_mode["av:track"] = [self.f["tracks"]["rawVideo"]]
        self.assertTrue(match_mode(processor_offer, processor_mode, schema))
        self.assertEqual(mode["av:track"][0]["av:representation"], "av:EncodedVideo")

    def test_channel_count_and_layout_must_agree(self):
        offer, mode = self.offered(self.f["liveMode"])
        mode["av:track"][1]["av:channels"] = 1
        with self.assertRaisesRegex(ValueError, "channel count"):
            normalize_mode(offer, mode)

    def test_empty_or_unresolved_offer_members_are_not_concrete_modes(self):
        for members in ([], ["urn:fixture:unresolved"]):
            offer = {**self.f["offer"], "av:mode": members}
            with self.subTest(members=members), self.assertRaises(ValueError):
                validate_offer(offer)


class SchemaTests(CoreFixture):
    def test_2020_12_dialect_is_the_only_supported_explicit_or_omitted_dialect(self):
        self.assertTrue(matches_schema({}, {}))
        self.assertTrue(matches_schema({}, {"$schema": DIALECT}))
        for dialect in ("http://json-schema.org/draft-07/schema#", "https://example.org/custom", None):
            with self.subTest(dialect=dialect), self.assertRaisesRegex(ValueError, "dialect"):
                schema_validator({"$schema": dialect})

    def test_accepts_requires_an_object_even_though_nested_boolean_schemas_are_valid(self):
        for value in (True, False, None, [], "schema"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "object"):
                schema_validator(value)
        self.assertFalse(matches_schema({"x": 1}, {"properties": {"x": False}}))

    def test_local_pointer_anchor_and_escaped_references_work(self):
        for schema in (
            {"$defs": {"ok": {"const": 7}}, "$ref": "#/$defs/ok"},
            {"$defs": {"ok": {"$anchor": "seven", "const": 7}}, "$ref": "#seven"},
            {"$defs": {"a/b~c": {"const": 7}}, "$ref": "#/$defs/a~1b~0c"},
            {"$id": "https://schema.example/owned", "$defs": {"ok": {"const": 7}}, "$ref": "#/$defs/ok"},
        ):
            with self.subTest(schema=schema):
                self.assertTrue(matches_schema(7, schema))
                self.assertFalse(matches_schema(8, schema))

    def test_external_and_unresolved_local_references_fail_without_fetching(self):
        for ref in ("https://example.org/schema", "file:///private/schema", "../schema", "#/$defs/absent"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                schema_validator({"$defs": {"unused": {"$ref": ref}}})

    def test_dynamic_and_embedded_local_resource_references_are_self_contained(self):
        schemas = [
            {"$defs": {"value": {"$dynamicAnchor": "integer", "type": "integer"}}, "$dynamicRef": "#integer"},
            {"$id": "urn:fixture:outer", "$defs": {"inner": {
                "$id": "urn:fixture:inner", "$defs": {"value": {"type": "integer"}}, "$ref": "#/$defs/value",
            }}, "$ref": "#/$defs/inner"},
        ]
        for schema in schemas:
            with self.subTest(schema=schema):
                self.assertTrue(matches_schema(7, schema))
                self.assertFalse(matches_schema("7", schema))

    def test_well_founded_local_recursion_evaluates_without_fetching(self):
        schema = {"anyOf": [
            {"type": "integer"},
            {"type": "object", "required": ["next"], "properties": {"next": {"$ref": "#"}}},
        ]}
        self.assertTrue(matches_schema({"next": {"next": 7}}, schema))
        self.assertFalse(matches_schema({"next": {"next": "wrong"}}, schema))

    def test_unknown_keywords_and_vocabulary_do_not_become_a_hidden_dsl(self):
        for schema in (
            {"rationalMinimum": {"numerator": 30, "denominator": 1}},
            {"av:customRule": True},
            {"$vocabulary": {"https://json-schema.org/draft/2020-12/vocab/format-assertion": True}},
            {"$defs": {"unused": {"$schema": "https://example.org/other-dialect"}}},
        ):
            with self.subTest(schema=schema), self.assertRaises(ValueError):
                schema_validator(schema)

    def test_defaults_never_fill_missing_facts_and_required_is_explicit(self):
        offer, mode = self.offered()
        mode["av:kind"] = "av:Live"
        descriptor = normalize_mode(offer, mode)
        before = copy.deepcopy(descriptor)
        schema = {"properties": {"av:track": {"items": {"properties": {
            "av:cadence": {"const": "av:Constant", "default": "av:Constant"},
        }}}}}
        self.assertTrue(matches_schema(descriptor, schema))
        schema["properties"]["av:track"]["items"]["required"] = ["av:cadence"]
        self.assertFalse(matches_schema(descriptor, schema))
        self.assertEqual(descriptor, before)
        self.assertNotIn("av:cadence", descriptor["av:track"][0])

    def test_format_is_annotation_not_automatic_assertion(self):
        self.assertTrue(matches_schema("not-an-email", {"type": "string", "format": "email"}))

    def test_prefix_items_has_no_portable_array_position_contract(self):
        with self.assertRaisesRegex(ValueError, "Positional"):
            schema_validator({"properties": {"av:track": {"prefixItems": [{"const": "first"}]}}})

    def test_anyof_evaluates_a_whole_descriptor(self):
        offer, mode = self.offered()
        schema = {"anyOf": [
            {"required": ["av:kind"], "properties": {"av:kind": {"const": "av:Live"}}},
            {"required": ["av:kind", "av:track"], "properties": {
                "av:kind": {"const": "av:Still"},
                "av:track": {"items": {"required": ["av:width"], "properties": {"av:width": {"const": 1280}}}},
            }},
        ]}
        self.assertTrue(match_mode(offer, mode, schema))
        mode["av:track"][0]["av:width"] = 640
        self.assertFalse(match_mode(offer, mode, schema))

    def test_schema_literal_keys_are_not_av_graph_predicates(self):
        need = self.f["need"]
        need["av:input"][0]["av:accepts"] = {
            "properties": {"av:legacyOrApplicationFact": {"const": {"av:notVocabulary": 1}}},
        }
        validate_av_keys(need)
        graph = graph_for(need, loader_for(make_context()))
        literal = next(graph.objects(None, AV.accepts))
        self.assertIsInstance(literal, Literal)
        self.assertEqual(literal.datatype, RDF.JSON)
        self.assertNotIn(AV.legacyOrApplicationFact, set(graph.predicates()))
        with self.assertRaises(ValueError):
            validate_av_keys({"av:legacyOrApplicationFact": 1})

    def test_nonprogressing_recursive_schema_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "recursive"):
            matches_schema({}, {"$ref": "#"})

    def test_presence_and_accepts_are_required_even_for_omitted_optional_input(self):
        for field in ("av:presence", "av:accepts"):
            requirement = copy.deepcopy(self.f["input"])
            requirement["av:presence"] = "av:Optional"
            del requirement[field]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "requires"):
                matches_input(requirement)

    def test_optional_omission_does_not_relax_an_included_input(self):
        requirement = self.f["input"]
        self.assertFalse(matches_input(requirement))
        requirement["av:presence"] = "av:Optional"
        self.assertTrue(matches_input(requirement))
        offer, mode = self.offered()
        self.assertTrue(matches_input(requirement, offer, mode))
        mode["av:track"][0]["av:width"] = 640
        self.assertFalse(matches_input(requirement, offer, mode))
        with self.assertRaises(ValueError):
            matches_input(requirement, offer=offer)

    def test_need_requires_nonempty_unique_inputs_and_explicit_result_for_destination(self):
        for mutation in ("empty", "duplicate", "destination"):
            need = copy.deepcopy(self.f["need"])
            if mutation == "empty":
                need["av:input"] = []
            elif mutation == "duplicate":
                need["av:input"].append(copy.deepcopy(need["av:input"][0]))
            else:
                need["av:destination"] = self.f["destinationReference"]
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_need(need)


class NativeFormTests(CoreFixture):
    def documents(self):
        return {self.f["documentLocations"][name]: self.f[name] for name in ("source", "application")}

    def test_form_reference_requires_document_form_and_standard_operation_iri(self):
        for field in ("av:document", "av:form", "av:operation"):
            reference = copy.deepcopy(self.f["formReference"])
            del reference[field]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "requires"):
                resolve_form(reference, self.documents())
        reference = {**self.f["formReference"], "av:operation": "readproperty"}
        with self.assertRaises(ValueError):
            resolve_form(reference, self.documents())
        expanded = {str(AV[key[3:]]) if key.startswith("av:") else key: value
                    for key, value in self.f["formReference"].items()}
        self.assertEqual(resolve_form(expanded, self.documents()).operation, str(TD.readProperty))

    def test_named_membership_is_unique_and_not_an_href_or_annotation(self):
        reference = self.f["formReference"]
        source = self.f["source"]
        form = source["properties"]["snapshot"]["forms"][0]
        wrong = {**reference, "av:form": "https://fixtures.example.org/images/current.jpg"}
        with self.assertRaisesRegex(ValueError, "membership"):
            resolve_form(wrong, self.documents())
        source["properties"]["snapshot"]["forms"].append(copy.deepcopy(form))
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            resolve_form(reference, self.documents())
        source["properties"]["snapshot"]["forms"] = []
        source["exampleForm"] = form
        with self.assertRaisesRegex(ValueError, "membership"):
            resolve_form(reference, self.documents())

    def test_native_base_and_effective_retrieval_location_are_preserved(self):
        reference = self.f["formReference"]
        source = self.f["source"]
        source["base"] = "https://native.example/base/"
        self.assertEqual(resolve_form(reference, self.documents()).form["href"],
                         "https://native.example/base/images/current.jpg")
        del source["base"]
        documents = {reference["av:document"]: RetrievedTD(source, "https://cdn.example/redirected/source.td.json")}
        self.assertEqual(resolve_form(reference, documents).form["href"],
                         "https://cdn.example/redirected/images/current.jpg")
        self.assertEqual(source["properties"]["snapshot"]["forms"][0]["href"], "images/current.jpg")

    def test_offer_thing_identity_is_not_its_document_locator(self):
        reference = self.f["formReference"]
        with self.assertRaisesRegex(ValueError, "unavailable"):
            resolve_form({**reference, "av:document": self.f["source"]["id"]}, self.documents())
        with self.assertRaisesRegex(ValueError, "source differs"):
            resolve_native_form(reference["av:document"], reference["av:form"], self.documents(),
                                expected_source="urn:fixture:other-source")

    def test_native_property_defaults_respect_read_write_flags(self):
        source = self.f["source"]
        affordance = source["properties"]["snapshot"]
        reference = self.f["formReference"]
        self.assertEqual(resolve_form(reference, self.documents()).operations, (str(TD.readProperty),))
        affordance["readOnly"] = False
        affordance["observable"] = True
        self.assertEqual(resolve_form(reference, self.documents()).operations,
                         (str(TD.readProperty), str(TD.writeProperty)))
        with self.assertRaisesRegex(ValueError, "not supported"):
            resolve_form({**reference, "av:operation": str(TD.observeProperty)}, self.documents())
        affordance["writeOnly"] = True
        with self.assertRaisesRegex(ValueError, "not supported"):
            resolve_form(reference, self.documents())
        writable = resolve_form({**reference, "av:operation": str(TD.writeProperty)}, self.documents())
        self.assertEqual(writable.operations, (str(TD.writeProperty),))

    def test_native_action_and_event_defaults_and_no_top_level_default(self):
        application = self.f["application"]
        destination = resolve_form(self.f["destinationReference"], self.documents())
        self.assertEqual(destination.operations, (str(TD.invokeAction),))
        application["events"] = {"result": {
            "data": {"type": "string"}, "forms": [{"@id": "urn:fixture:event", "href": "events"}],
        }}
        reference = {**self.f["resultReference"], "av:form": "urn:fixture:event",
                     "av:operation": str(TD.subscribeEvent)}
        event = resolve_form(reference, self.documents())
        self.assertEqual(event.operations, (str(TD.subscribeEvent), str(TD.unsubscribeEvent)))
        self.assertEqual(native_payload_schema(event), {"type": "string"})
        application["forms"] = [{"@id": "urn:fixture:top", "href": "all"}]
        with self.assertRaisesRegex(ValueError, "omitted op"):
            resolve_native_form(reference["av:document"], "urn:fixture:top", self.documents())

    def test_form_security_overrides_root_and_native_scheme_defaults_are_used(self):
        source = self.f["source"]
        source["securityDefinitions"] = {"root": {"scheme": "bearer"}, "form": {"scheme": "basic"}}
        source["security"] = ["root"]
        form = source["properties"]["snapshot"]["forms"][0]
        inherited = resolve_form(self.f["formReference"], self.documents())
        self.assertEqual(inherited.security_definitions["root"],
                         {"scheme": "bearer", "in": "header", "alg": "ES256", "format": "jwt"})
        form["security"] = ["form"]
        selected = resolve_form(self.f["formReference"], self.documents())
        self.assertEqual(selected.form["security"], ["form"])
        self.assertEqual(selected.security_definitions, {"form": {"scheme": "basic", "in": "header"}})
        self.assertEqual(source["securityDefinitions"]["form"], {"scheme": "basic"})

    def test_missing_security_never_falls_back_to_anonymous(self):
        for missing in ("security", "securityDefinitions"):
            source = copy.deepcopy(self.f["source"])
            del source[missing]
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                resolve_form(self.f["formReference"], {self.f["formReference"]["av:document"]: source})

    def test_combo_security_requires_resolved_acyclic_members(self):
        source = self.f["source"]
        source["security"] = ["combined"]
        source["securityDefinitions"] = {"combined": {"scheme": "combo", "allOf": ["missing"]}}
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            resolve_form(self.f["formReference"], self.documents())
        source["securityDefinitions"]["combined"]["allOf"] = ["combined"]
        with self.assertRaisesRegex(ValueError, "Cyclic"):
            resolve_form(self.f["formReference"], self.documents())

    def test_unknown_operations_and_unsupported_uri_templates_fail_explicitly(self):
        form = self.f["source"]["properties"]["snapshot"]["forms"][0]
        form["op"] = "configurecamera"
        with self.assertRaisesRegex(ValueError, "operation"):
            resolve_form(self.f["formReference"], self.documents())
        form["op"] = "readproperty"
        form["href"] = "images/{imageId}.jpg"
        with self.assertRaisesRegex(ValueError, "Unsupported URI template"):
            resolve_form(self.f["formReference"], self.documents())

    def test_result_and_destination_schemas_come_from_native_affordances(self):
        result = native_payload_schema(resolve_form(self.f["resultReference"], self.documents()))
        destination = native_payload_schema(resolve_form(self.f["destinationReference"], self.documents()), "destination")
        self.assertEqual(result, {"type": "object", "required": ["label"],
                                  "properties": {"label": {"type": "string"}}})
        self.assertEqual(destination, result)
        self.assertNotIn("av:ResultContract", json_bytes(result).decode("utf-8"))
        with self.assertRaisesRegex(ValueError, "absent/unknown"):
            native_payload_schema(resolve_form(self.f["formReference"], self.documents()))
        del self.f["application"]["actions"]["store"]["input"]
        with self.assertRaisesRegex(ValueError, "absent/unknown"):
            native_payload_schema(resolve_form(self.f["destinationReference"], self.documents()), "destination")


class FormattingTests(unittest.TestCase):
    def test_four_space_formatter_preserves_escapes_numbers_and_empty_containers(self):
        source = br'{"a":[{"escaped":"quote:\" slash:\\ brace:{}","unicode":"\u00e9"},900719925474099312345,1.2300e+02,-0,{},[]]}'
        formatted = format_json(source)
        for token in (br'"\u00e9"', b"900719925474099312345", b"1.2300e+02", b"-0", b"{}", b"[]"):
            self.assertIn(token, formatted)
        self.assertIn(b'    "a": [\n        {\n', formatted)
        self.assertEqual(format_json(formatted), formatted)
        self.assertEqual(strict_json(source), strict_json(formatted))

    def test_shared_serializer_expands_nonempty_arrays_and_uses_same_line_braces(self):
        self.assertEqual(json_bytes({"items": [{"a": 1}]}),
                         b'{\n    "items": [\n        {\n            "a": 1\n        }\n    ]\n}\n')

    def test_duplicate_and_nonfinite_json_values_are_rejected(self):
        for value in (b'{"a":1,"a":2}', b'{"a":{"x":1,"x":2}}', b'{"n":NaN}', b'{"n":Infinity}', b'{"n":1e999}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                format_json(value)


class DocumentationTests(CoreFixture):
    def test_literal_excerpt_pointers_reject_stale_content(self):
        from check_docs import snippet_references
        value = json_bytes(self.f["rational"]).decode("utf-8")
        text = "<!-- example: tests/fixtures/core.json#/rational -->\n```json\n" + value + "```\n"
        self.assertEqual(snippet_references(text), 1)
        with self.assertRaisesRegex(ValueError, "Stale literal"):
            snippet_references(text.replace('"av:denominator": 1001', '"av:denominator": 1000'))

    def test_fences_reject_invalid_format_and_unclosed_blocks(self):
        from check_docs import check_fences
        self.assertEqual(check_fences('```json\n{\n    "a": 1\n}\n```\n', "test"), 1)
        for text in ('```json\n{"a":1}\n```\n', '```json\n{\n    "a": 1\n}\n'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                check_fences(text, "test")

    def test_required_term_use_cannot_claim_an_implicit_default(self):
        from check_docs import check_documentation
        usage = copy.deepcopy(TERMS["properties"]["presence"]["uses"]["av:InputRequirement"])
        doc = usage["documentation"]
        check_documentation(doc, "presence", usage)
        doc["when_omitted"] = {"policy": "unknown", "explanation": "Treat as an unconstrained optional input."}
        with self.assertRaisesRegex(ValueError, "misleading"):
            check_documentation(doc, "presence", usage)


if __name__ == "__main__":
    unittest.main()
