"""Edition-level vectors independent of the implementation's keyword registry."""

from __future__ import annotations

import copy
import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common import (
    AV, TD, absolute_iri, graph_for, json_bytes, native_payload_schema,
    read, relative_file, resolve_form, resolve_native_form, strict_json,
)
from matching import matches_schema, normalize_mode, schema_validator, validate_need
from test_matching import CoreFixture


KEYWORDS = """$schema $id $anchor $dynamicAnchor $ref $dynamicRef $defs $vocabulary
$comment type const enum minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
minLength maxLength pattern items contains minContains maxContains minItems maxItems
uniqueItems unevaluatedItems properties patternProperties additionalProperties
propertyNames required dependentRequired dependentSchemas minProperties maxProperties
unevaluatedProperties allOf anyOf oneOf not if then else title description default
deprecated readOnly writeOnly examples format contentEncoding contentMediaType
contentSchema""".split()
ABSENT_VALUE = object()


class DiagnosticAssertions:
    def error(self, code, action):
        with self.assertRaises(ValueError) as caught:
            action()
        self.assertEqual(getattr(caught.exception, "code", None), code, str(caught.exception))
        self.assertTrue(caught.exception.stage)
        return caught.exception


class ExactInputTests(DiagnosticAssertions, unittest.TestCase):
    def test_decoded_names_surrogates_and_iri_syntax(self):
        for text in ('{"a":1,"\\u0061":2}', '"\\ud800"', '{"\\udfff":0}', '{"n":NaN}'):
            with self.subTest(text=text):
                self.error("AV_INVALID_SYNTAX", lambda: strict_json(text))
        self.assertEqual(strict_json('"\\ud800\\udc00"'), "\U00010000")
        for value in ("urn:bad:%xy", "urn:bad:\x00", "urn:bad:|", "urn:bad:\ud800",
                      "https:///missing", "https://[invalid]/", "urn:bad:%", "urn:bad:\ufdd0",
                      "https://example.org/\ue000"):
            with self.subTest(value=repr(value)):
                self.error("AV_INVALID_DESCRIPTION", lambda: absolute_iri(value))
        self.assertEqual(absolute_iri("https://example.org/\u00e9%20x"), "https://example.org/\u00e9%20x")
        self.assertEqual(absolute_iri("https://example.org/?q=\ue000"), "https://example.org/?q=\ue000")

    def test_decimal_parse_serialize_and_exact_arithmetic(self):
        values = strict_json('[0.3,0.1,9007199254740993.1,1e-400,1e400]')
        self.assertEqual(values[2], Decimal("9007199254740993.1"))
        self.assertEqual(strict_json(json_bytes(values)), values)
        self.assertTrue(matches_schema(values[0], {"multipleOf": values[1]}))
        self.assertFalse(matches_schema(values[2], {"maximum": Decimal("9007199254740993.0")}))
        self.assertFalse(matches_schema(values[3], {"const": 0}))
        self.assertTrue(matches_schema(values[4], {"minimum": 10**399}))
        self.assertFalse(matches_schema(True, {"const": 1}))

    def test_numeric_capacity_is_explicit_not_nonfinite_or_nonmatch(self):
        self.error("AV_RESOURCE_LIMIT", lambda: strict_json("1e999"))
        self.error("AV_RESOURCE_LIMIT", lambda: strict_json("1" * 1100))
        self.error("AV_RESOURCE_LIMIT", lambda: matches_schema(Decimal("1e999"), {}))

    def test_json_literal_preserves_exact_numbers(self):
        from rdflib.namespace import RDF
        from model import make_context
        from common import loader_for
        need = read(relative_file("av/tools/fixtures/core.json"))["need"]
        need["av:input"][0]["av:accepts"] = strict_json('{"const":9007199254740993.1}')
        graph = graph_for(need, loader_for(make_context()))
        literal = next(graph.objects(None, AV.accepts))
        self.assertEqual(literal.datatype, RDF.JSON)
        self.assertEqual(strict_json(str(literal)), need["av:input"][0]["av:accepts"])


class PortableContractTests(DiagnosticAssertions, unittest.TestCase):
    def test_keyword_inventory_is_exactly_the_specification_list(self):
        from matching import SCHEMA_KEYWORDS
        self.assertEqual(len(KEYWORDS), 56)
        self.assertEqual(set(SCHEMA_KEYWORDS), set(KEYWORDS))

    def test_keyword_shapes_and_annotation_data_are_not_schemas(self):
        for schema in ({"type": 4}, {"required": "x"}, {"items": []}, {"allOf": []},
                       {"multipleOf": 0}, {"minItems": -1}, {"properties": []},
                       {"default": 1, "readOnly": "false"}):
            with self.subTest(schema=schema):
                self.error("AV_INVALID_CONTRACT", lambda: schema_validator(schema))
        self.assertTrue(matches_schema({}, {"default": {"unknown": 1}, "examples": [{"$ref": "remote"}]}))
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator({"unknown": False}))
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator({"prefixItems": [True]}))

    def test_vocabulary_and_dialect_placement(self):
        from matching import DIALECT
        core = "https://json-schema.org/draft/2020-12/vocab/core"
        self.assertTrue(matches_schema({}, {"$vocabulary": {core: True}}))
        for schema in ({"$vocabulary": {}}, {"$vocabulary": {core: False}},
                       {"properties": {"x": {"$vocabulary": {core: True}}}},
                       {"properties": {"x": {"$schema": DIALECT}}}):
            with self.subTest(schema=schema):
                self.error("AV_INVALID_CONTRACT", lambda: schema_validator(schema))
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator(
            {"$vocabulary": {core: True, "urn:unknown": False}}))
        schema_validator({"$id": "https://schema.example/root", "$defs": {
            "inner": {"$id": "inner", "$schema": DIALECT, "type": "string"}}})

    def test_reference_locations_resources_and_unused_definitions(self):
        for schema in ({"default": {}, "$ref": "#/default"},
                       {"const": True, "$ref": "#/const"},
                       {"$defs": {"a": {"$anchor": "x"}, "b": {"$dynamicAnchor": "x"}}},
                       {"$id": "urn:test:root", "$defs": {"a": {"$id": "urn:test:root"}}},
                       {"$defs": {"unused": {"$ref": "#/missing"}}}):
            with self.subTest(schema=schema):
                self.error("AV_INVALID_CONTRACT", lambda: schema_validator(schema))
        self.error("AV_EXTERNAL_REFERENCE", lambda: schema_validator({"$ref": "https://schema.example/x"}))
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator({"$id": "relative"}))
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator({"$defs": {"x": {"$id": "relative"}}}))

    def test_cycles_are_preflight_errors_even_in_unselected_locations(self):
        for schema in ({"anyOf": [True, {"$ref": "#"}]},
                       {"$defs": {"unused": {"$ref": "#/$defs/unused"}}},
                       {"$dynamicAnchor": "x", "$dynamicRef": "#x"}):
            with self.subTest(schema=schema):
                error = self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator(schema))
                self.assertEqual(error.reason, "non-progressing-recursion")
        schema = {"anyOf": [{"type": "integer"}, {"type": "array", "items": {"$ref": "#"}}]}
        self.assertTrue(matches_schema([[[7]]], schema))
        self.assertFalse(matches_schema([[["wrong"]]], schema))

    def test_oneof_zero_one_two_and_evaluated_locations(self):
        schema = {"oneOf": [{"type": "integer"}, {"minimum": 0, "type": "number"}]}
        # Independent truth table: integer status, nonnegative-number status.
        for value, branches in (("x", (False, False)), (-1, (True, False)), (1, (True, True))):
            self.assertEqual(matches_schema(value, schema), sum(branches) == 1)
        schema = {"$defs": {"a": {"properties": {"a": True}}},
                  "allOf": [{"$ref": "#/$defs/a"}, {"properties": {"b": True}}],
                  "unevaluatedProperties": False}
        self.assertTrue(matches_schema({"a": 1, "b": 2}, schema))
        self.assertFalse(matches_schema({"a": 1, "b": 2, "c": 3}, schema))
        self.assertTrue(matches_schema([1], {"allOf": [
            {"contains": {"const": 1}}, {"contains": {"minimum": 1}}]}))
        self.assertTrue(matches_schema([], {"contains": False, "minContains": 0}))

    def test_portable_regex_has_ecmascript_unicode_and_anchor_behavior(self):
        for value, pattern, expected in (("\u0661", r"\d", False),
                                         ("\u00e9", r"\w", False),
                                         ("x\n", "x$", False),
                                         ("\u2028", ".", False),
                                         ("\U00010000", r"^\u{10000}$", True),
                                         ("\U00010000", r"^\uD800\uDC00$", True),
                                         ("\U00010000", "^.$", True)):
            with self.subTest(pattern=pattern, value=value):
                self.assertEqual(matches_schema(value, {"pattern": pattern}), expected)
        self.error("AV_INVALID_CONTRACT", lambda: schema_validator({"pattern": "["}))
        for pattern in ("(?=x)", r"\p{Letter}", r"(x)\1", "(?i)x"):
            self.error("AV_UNSUPPORTED_CONTRACT", lambda: schema_validator({"pattern": pattern}))

    def test_resource_limits_remain_errors(self):
        from schema_contract import ContractLimits
        self.error("AV_RESOURCE_LIMIT", lambda: schema_validator(
            {"allOf": [True, True]}, limits=ContractLimits(schema_locations=2)))
        self.error("AV_RESOURCE_LIMIT", lambda: matches_schema(
            "abcd", {"pattern": "a+"}, limits=ContractLimits(regex_input=3)))

    def test_every_keyword_has_an_independent_value_shape_vector(self):
        from matching import DIALECT
        core = "https://json-schema.org/draft/2020-12/vocab/core"
        cases = {
            "$schema": (DIALECT, 5), "$id": ("urn:fixture:schema", 1),
            "$anchor": ("label", 1), "$dynamicAnchor": ("dynamic", 1),
            "$ref": ("#/$defs/value", 1), "$dynamicRef": ("#value", 1),
            "$defs": ({"value": True}, []), "$vocabulary": ({core: True}, []),
            "$comment": ("Explanation", 1), "type": ("string", []),
            "const": (None, ABSENT_VALUE), "enum": ([None], []),
            "minimum": (0, False), "maximum": (1, False),
            "exclusiveMinimum": (0, False), "exclusiveMaximum": (1, False),
            "multipleOf": (1, 0), "minLength": (0, -1), "maxLength": (1, -1),
            "pattern": ("a", "["), "items": (True, []), "contains": (True, []),
            "minContains": (0, -1), "maxContains": (1, -1),
            "minItems": (0, -1), "maxItems": (1, -1), "uniqueItems": (True, 1),
            "unevaluatedItems": (False, []), "properties": ({"x": True}, []),
            "patternProperties": ({"x": True}, []), "additionalProperties": (False, []),
            "propertyNames": (True, []), "required": (["x"], [1]),
            "dependentRequired": ({"x": ["y"]}, {"x": "y"}),
            "dependentSchemas": ({"x": True}, {"x": 1}),
            "minProperties": (0, -1), "maxProperties": (1, -1),
            "unevaluatedProperties": (True, []), "allOf": ([True], []),
            "anyOf": ([True], []), "oneOf": ([True], []), "not": (False, []),
            "if": (True, []), "then": (True, []), "else": (True, []),
            "title": ("Title", 1), "description": ("Description", 1),
            "default": (None, ABSENT_VALUE), "deprecated": (False, 1),
            "readOnly": (False, 1), "writeOnly": (False, 1),
            "examples": ([1], 1), "format": ("email", 1),
            "contentEncoding": ("base64", 1), "contentMediaType": ("image/jpeg", 1),
            "contentSchema": (True, []),
        }
        self.assertEqual(set(cases), set(KEYWORDS))
        for keyword, (valid, invalid) in cases.items():
            base = {"$defs": {"value": {"$anchor": "value"}}}
            with self.subTest(keyword=keyword, shape="valid"):
                schema_validator({**base, keyword: valid})
            if invalid is not ABSENT_VALUE:
                with self.subTest(keyword=keyword, shape="invalid"):
                    self.error("AV_INVALID_CONTRACT", lambda: schema_validator({**base, keyword: invalid}))

    def test_compiled_contract_isolated_from_source_and_public_schema_view(self):
        schema = {"const": 7}
        compiled = schema_validator(schema)
        schema["const"] = 8
        compiled.schema["const"] = 9
        self.assertTrue(compiled.is_valid(7))
        self.assertFalse(compiled.is_valid(8))

    def test_missing_library_handler_cannot_silently_widen_the_contract(self):
        from unittest.mock import patch
        from jsonschema import Draft202012Validator
        missing = {key: value for key, value in Draft202012Validator.VALIDATORS.items() if key != "const"}
        with patch.object(Draft202012Validator, "VALIDATORS", missing):
            self.error("AV_EDITION_INCONSISTENT", lambda: schema_validator({"const": 7}))

    def test_embedded_evaluated_locations_and_dialect_keep_exact_arithmetic(self):
        from matching import DIALECT
        schema = {"$schema": DIALECT, "$id": "https://schema.example/root", "$defs": {
            "inner": {"$id": "inner", "$schema": DIALECT, "$defs": {"n": {"multipleOf": Decimal("0.1")}},
                      "properties": {"n": {"$ref": "#/$defs/n"}}}},
                  "allOf": [{"$ref": "#/$defs/inner"}], "unevaluatedProperties": False}
        self.assertTrue(matches_schema({"n": Decimal("0.3")}, schema))
        self.assertFalse(matches_schema({"n": Decimal("0.31")}, schema))
        self.assertFalse(matches_schema({"n": Decimal("0.3"), "extra": 1}, schema))

class DescriptionEditionTests(DiagnosticAssertions, CoreFixture):
    def test_unselected_invalid_mode_cannot_hide_inside_offer(self):
        offer, mode = self.offered()
        other = copy.deepcopy(mode)
        other["@id"] = "urn:fixture:other"
        other["av:track"][0]["av:width"] = False
        offer["av:mode"].append(other)
        self.error("AV_INVALID_DESCRIPTION", lambda: normalize_mode(offer, mode))

    def test_shared_identity_means_identical_unordered_core_facts(self):
        offer, mode = self.offered(self.f["liveMode"])
        other = copy.deepcopy(mode)
        other["@id"] = "urn:fixture:other"
        other["av:track"].reverse()
        offer["av:mode"].append(other)
        self.assertEqual(normalize_mode(offer, mode), normalize_mode(offer, other))
        other["av:track"][1]["av:width"] += 1
        self.error("AV_INVALID_DESCRIPTION", lambda: normalize_mode(offer, mode))

    def test_still_multi_image_audio_only_and_unicode_name_sort(self):
        offer, mode = self.offered()
        second = copy.deepcopy(mode["av:track"][0])
        second["@id"] = "urn:fixture:second-image"
        second["dcterms:identifier"] = "\U00010000"
        mode["av:track"][0]["dcterms:identifier"] = "\ue000"
        mode["av:track"].insert(0, second)
        self.assertEqual([t["dcterms:identifier"] for t in normalize_mode(offer, mode)["av:track"]],
                         ["\ue000", "\U00010000"])
        for kind in ("av:Live", "av:Clip"):
            mode["av:kind"] = kind
            mode["av:track"] = [self.f["tracks"]["pcm"]]
            self.assertNotIn("av:cadence", normalize_mode(offer, mode)["av:track"][0])

    def test_intrinsic_closure_types_and_null_do_not_add_defaults(self):
        from matching import record
        rational = {"av:numerator": 30, "av:denominator": 1,
                    "dcterms:description": "Known exact rate"}
        record(rational, "Rational")
        for addition in ({"unknown": 1}, {"@type": []}, {"@type": ["av:Rational", "av:Rational"]},
                         {"av:denominator": None}):
            self.error("AV_INVALID_DESCRIPTION", lambda: record({**rational, **addition}, "Rational"))

    def test_node_wrappers_work_through_need_and_native_resolution(self):
        need = self.f["resultNeed"]
        for key in ("av:result", "av:destination"):
            if key in need:
                for field in ("av:document", "av:form", "av:operation"):
                    need[key][field] = {"@id": need[key][field]}
        validate_need(need)
        documents = {self.f["documentLocations"][name]: self.f[name] for name in ("source", "application")}
        resolved = resolve_form(need["av:result"], documents)
        self.assertEqual(resolved.operation, str(TD.readProperty))

    def test_need_payload_roles_checked_without_native_fetch(self):
        need = self.f["resultNeed"]
        need["av:result"]["av:operation"] = str(TD.unsubscribeEvent)
        self.error("AV_INVALID_DESCRIPTION", lambda: validate_need(need))

    def test_complete_selection_distinguishes_omission_and_contract_errors(self):
        from matching import select_inputs
        need = self.f["need"]
        offer, mode = self.offered()
        name = need["av:input"][0]["dcterms:identifier"]
        self.assertEqual(select_inputs(need, {name: (offer, mode)})[name].status, "MATCH")
        self.assertEqual(select_inputs(need, {name: None})[name].status, "UNSATISFIED_REQUIRED")
        need["av:input"][0]["av:presence"] = "av:Optional"
        self.assertEqual(select_inputs(need, {name: None})[name].status, "OMITTED_OPTIONAL")
        self.error("AV_INVALID_DESCRIPTION", lambda: select_inputs(need, {}))
        need["av:input"][0]["av:accepts"] = {"unknown": 1}
        self.error("AV_UNSUPPORTED_CONTRACT", lambda: select_inputs(need, {}))

    def test_attached_source_and_association_duplicates(self):
        from matching import validate_document
        source = self.f["source"]
        validate_document(source)
        source["av:offer"].append(copy.deepcopy(source["av:offer"][0]))
        self.error("AV_INVALID_DESCRIPTION", lambda: validate_document(source))
        source["av:offer"].pop()
        source["av:offer"][0]["av:source"] = "urn:fixture:other-source"
        self.error("AV_INVALID_DESCRIPTION", lambda: validate_document(source))


class NativeEditionTests(DiagnosticAssertions, CoreFixture):
    def documents(self):
        return {self.f["documentLocations"][name]: self.f[name] for name in ("source", "application")}

    def test_actual_template_expansion_and_missing_issued_identifier(self):
        from native_parameters import InvocationParameters
        source = self.f["source"]
        prop = source["properties"]["snapshot"]
        prop["forms"][0]["href"] = "images/{imageId}{?count,flag,optional}"
        source["uriVariables"] = {"imageId": {"type": "integer"}, "count": {"type": "integer"},
                                  "flag": {"type": "boolean"}, "optional": {"type": "string"}}
        prop["uriVariables"] = {"imageId": {"type": "string", "minLength": 1}}
        reference = self.f["formReference"]
        self.error("AV_MISSING_NATIVE_PARAMETER", lambda: resolve_form(
            reference, self.documents(), parameters=InvocationParameters(required_uri_variables=("imageId",))))
        params = InvocationParameters(uri_variables={"imageId": "issued/\u00e9", "count": 2, "flag": False},
                                      required_uri_variables=("imageId",))
        resolved = resolve_form(reference, self.documents(), parameters=params)
        self.assertTrue(resolved.form["href"].endswith("images/issued%2F%C3%A9?count=2&flag=false"))
        self.assertEqual(resolved.uri_variables["imageId"], {"type": "string", "minLength": 1})
        self.error("AV_INVALID_NATIVE_PARAMETER", lambda: resolve_form(
            reference, self.documents(), parameters=InvocationParameters(uri_variables={"imageId": 1})))
        self.assertIn("{imageId}", prop["forms"][0]["href"])

    def test_rfc6570_scalar_operator_vectors_and_policy_recheck(self):
        from native_parameters import expand_template
        values = {"x": "a/b c", "empty": "", "unicode": "\U00010000"}
        for template, expected in (("{x}", "a%2Fb%20c"), ("{+x}", "a/b%20c"),
                                   ("{#x}", "#a/b%20c"), ("{/x:1}", "/a"),
                                   ("{?empty,missing}", "?empty="), ("{;empty}", ";empty"),
                                   ("{.unicode}", ".%F0%90%80%80")):
            self.assertEqual(expand_template(template, values), expected)
        from native_parameters import InvocationParameters
        checked = []
        params = InvocationParameters(target_policy=checked.append)
        resolved = resolve_form(self.f["formReference"], self.documents(), parameters=params)
        self.assertEqual(checked, [resolved.form["href"]])

    def test_response_and_action_defaults_do_not_change_original_td(self):
        prop = self.f["source"]["properties"]["snapshot"]
        prop["forms"][0]["response"] = {}
        self.error("AV_INVALID_DESCRIPTION", lambda: resolve_form(self.f["formReference"], self.documents()))
        del prop["forms"][0]["response"]
        resolved = resolve_form(self.f["formReference"], self.documents())
        self.assertEqual(resolved.form["response"]["contentType"], resolved.form["contentType"])
        self.assertNotIn("response", prop["forms"][0])
        resolved = resolve_form(self.f["destinationReference"], self.documents())
        self.assertFalse(resolved.affordance["safe"])
        self.assertFalse(resolved.affordance["idempotent"])

    def test_combo_minimum_is_two_and_not_schema_exclusivity(self):
        source = self.f["source"]
        source["security"] = ["combo"]
        source["securityDefinitions"] = {"a": {"scheme": "basic"}, "b": {"scheme": "digest"},
                                         "combo": {"scheme": "combo", "oneOf": ["a", "b"]}}
        resolved = resolve_form(self.f["formReference"], self.documents())
        self.assertEqual(set(resolved.security_definitions), {"combo", "a", "b"})
        source["securityDefinitions"]["combo"]["oneOf"] = ["a"]
        self.error("AV_INVALID_DESCRIPTION", lambda: resolve_form(self.f["formReference"], self.documents()))

    def test_payload_projection_keeps_native_terms_and_direction(self):
        prop = self.f["source"]["properties"]["snapshot"]
        prop.update({"type": "object", "readOnly": False, "required": ["read", "write", "both"],
                     "titles": {"en": "Native value"}, "maxProperties": 4,
                     "properties": {"read": {"type": "string", "readOnly": True},
                                    "write": {"type": "string", "writeOnly": True},
                                    "both": {"type": "object", "required": ["r", "w"],
                                             "properties": {"r": {"readOnly": True}, "w": {"writeOnly": True}}}}})
        ref = self.f["formReference"]
        read_schema = native_payload_schema(resolve_form(ref, self.documents()))
        write_schema = native_payload_schema(resolve_form(
            {**ref, "av:operation": str(TD.writeProperty)}, self.documents()), "destination")
        self.assertEqual(set(read_schema["properties"]), {"read", "both"})
        self.assertEqual(set(write_schema["properties"]), {"write", "both"})
        self.assertEqual(read_schema["properties"]["both"]["required"], ["r"])
        self.assertEqual(write_schema["properties"]["both"]["required"], ["w"])
        self.assertEqual(read_schema["titles"], {"en": "Native value"})
        self.assertEqual(read_schema["maxProperties"], 4)

    def test_result_reports_selected_producer_and_actual_schema_source(self):
        from common import native_payload_contract
        reference = self.f["destinationReference"]
        self.f["application"]["actions"]["store"]["output"] = {"type": "string"}
        resolved = resolve_form(reference, self.documents())
        result = native_payload_contract(resolved)
        self.assertEqual(result.producer, self.f["application"]["id"])
        self.assertEqual(result.operation, str(TD.invokeAction))
        self.assertEqual(result.data_role, "output")
        self.assertTrue(result.schema_source.endswith("/output"))
        self.assertEqual(result.document_iri, reference["av:document"])
        self.error("AV_UNKNOWN_PAYLOAD_SCHEMA", lambda: native_payload_contract(
            resolve_form(self.f["formReference"], self.documents())))
        action = self.f["application"]["actions"]
        selected = next(value for value in action.values() if "output" in value)
        selected["output"] = {}
        self.assertEqual(native_payload_schema(resolve_form(reference, self.documents())), {})

    def test_authored_native_parameter_fixture(self):
        from native_parameters import InvocationParameters
        fixture = read(relative_file("av/tools/fixtures/native-parameters.json"))["rawImage"]
        producer = read(relative_file("av/examples/processor.td.json"))
        parameters = fixture["parameters"]
        resolved = resolve_form(
            fixture["reference"], {fixture["reference"]["av:document"]: producer},
            parameters=InvocationParameters(uri_variables=parameters["uriVariables"],
                                            required_uri_variables=tuple(parameters["requiredUriVariables"])))
        self.assertEqual(resolved.form["href"], fixture["expectedHref"])
        self.error("AV_MISSING_NATIVE_PARAMETER", lambda: resolve_form(
            fixture["reference"], {fixture["reference"]["av:document"]: producer},
            parameters=InvocationParameters(required_uri_variables=tuple(parameters["requiredUriVariables"]))))

    def test_external_result_producer_is_not_inferred_from_processor(self):
        from common import native_payload_contract
        need = self.f["resultNeed"]
        need["av:processor"] = "urn:fixture:separate-processor"
        validate_need(need)
        selected = native_payload_contract(resolve_form(need["av:result"], self.documents()))
        self.assertNotEqual(selected.producer, need["av:processor"])
        self.assertEqual(selected.producer, self.f["application"]["id"])
        del need["av:processor"]
        validate_need(need)
        self.assertNotIn("av:processor", need)

    def test_invocation_input_is_explicit_and_native_schema_is_not_accepts(self):
        from native_parameters import InvocationParameters
        self.error("AV_MISSING_NATIVE_PARAMETER", lambda: resolve_form(
            self.f["destinationReference"], self.documents(), parameters=InvocationParameters()))
        self.error("AV_INVALID_NATIVE_PARAMETER", lambda: resolve_form(
            self.f["destinationReference"], self.documents(), parameters=InvocationParameters(input={"label": 1})))
        resolved = resolve_form(self.f["destinationReference"], self.documents(),
                                parameters=InvocationParameters(input={"label": "supplied"}))
        self.assertEqual(resolved.operation, str(TD.invokeAction))

    def test_invalid_native_schema_and_unavailable_references_have_stable_errors(self):
        from native_parameters import InvocationParameters
        prop = self.f["source"]["properties"]["snapshot"]
        prop["uriVariables"] = {"x": {"type": 7}}
        self.error("AV_INVALID_DESCRIPTION", lambda: resolve_form(self.f["formReference"], self.documents()))
        prop["uriVariables"] = {"x": {"$ref": "https://unregistered.example/schema"}}
        self.error("AV_UNSUPPORTED_NATIVE_ACCESS", lambda: resolve_form(
            self.f["formReference"], self.documents(), parameters=InvocationParameters(uri_variables={"x": 7})))


class SemanticEditionTests(DiagnosticAssertions, CoreFixture):
    def test_projection_checks_complete_assertions_and_graph_boundary(self):
        from rdflib import Dataset, Literal, URIRef
        from rdflib.namespace import XSD
        from semantic import assert_projection, normalize_semantic, project_graph
        source = self.f["source"]
        offer = source["av:offer"][0]
        mode = offer["av:mode"][0]
        graph = graph_for(source)
        self.assertGreater(assert_projection(source, graph), 10)
        self.assertEqual(normalize_semantic(graph, offer["@id"], mode["@id"]), normalize_mode(offer, mode))
        track = URIRef(mode["av:track"][0]["@id"])
        for change in ("value", "datatype", "subject", "cardinality"):
            changed = copy.deepcopy(graph)
            before = next(changed.objects(track, AV.width))
            if change != "cardinality":
                changed.remove((track, AV.width, before))
            subject = URIRef("urn:fixture:wrong-subject") if change == "subject" else track
            after = Literal("1280", datatype=XSD.string) if change == "datatype" else Literal(640, datatype=XSD.integer)
            changed.add((subject, AV.width, after))
            with self.subTest(change=change):
                self.error("AV_INVALID_DESCRIPTION", lambda: assert_projection(source, changed))
        dataset = Dataset()
        for triple in graph:
            dataset.graph(URIRef("urn:fixture:graph:a")).add(triple)
        self.error("AV_INVALID_DESCRIPTION", lambda: project_graph(dataset, offer["@id"]))
        self.assertEqual(normalize_semantic(dataset, offer["@id"], mode["@id"], graph_name="urn:fixture:graph:a"),
                         normalize_mode(offer, mode))

    def test_full_iri_keys_need_correct_jsonld_coercion(self):
        from semantic import assert_projection
        source = self.f["source"]
        offer = source["av:offer"][0]
        offer[str(AV.source)] = offer.pop("av:source")
        self.error("AV_INVALID_DESCRIPTION", lambda: assert_projection(source))
        offer[str(AV.source)] = {"@id": offer[str(AV.source)]}
        self.assertGreater(assert_projection(source), 0)
        need = self.f["need"]
        requirement = need["av:input"][0]
        requirement[str(AV.accepts)] = requirement.pop("av:accepts")
        self.error("AV_INVALID_DESCRIPTION", lambda: assert_projection(need))
        requirement[str(AV.accepts)] = {"@value": requirement[str(AV.accepts)], "@type": "@json"}
        self.assertGreater(assert_projection(need), 0)

    def test_split_same_subject_and_contextual_intrinsic_class(self):
        from semantic import normalize_semantic
        from common import AV_CONTEXT
        offer, mode = self.offered(self.f["liveMode"])
        expected = normalize_mode(offer, mode)
        track = mode["av:track"][0]
        frame_rate = track["av:frameRate"]
        frame_rate.pop("@type", None)
        split = {"@id": track["@id"], "av:width": track.pop("av:width")}
        document = {"@context": AV_CONTEXT, "@graph": [offer, split]}
        graph = graph_for(document)
        self.assertEqual(normalize_semantic(graph, offer["@id"], mode["@id"]), expected)

    def test_unknown_context_and_implicit_named_graph_union_are_errors(self):
        from common import AV_CONTEXT
        self.error("AV_UNRESOLVED_REFERENCE", lambda: graph_for(
            {"@context": "https://unregistered.example/context", "@id": "urn:fixture:x"}))
        self.error("AV_INVALID_DESCRIPTION", lambda: graph_for(
            {"@context": AV_CONTEXT, "@id": "urn:fixture:named", "@graph": [self.f["offer"]]}))


class ImageGridContractTests(DiagnosticAssertions, CoreFixture):
    """Stipulated native facts exercise metadata, not a decoder or camera."""

    def assert_grid(self, updates, expected_track, native_facts, wrong_grids=(), kind="av:Still"):
        offer, mode = self.offered()
        mode["av:kind"] = kind
        mode["backend"] = {"nativeGeometry": native_facts}
        track = mode["av:track"][0]
        if updates.get("av:representation") == "av:RawVideo":
            del track["av:codec"]
        track.update(updates)
        before = copy.deepcopy((offer, mode))
        expected = {
            "av:source": "urn:fixture:av02:source",
            "av:kind": kind,
            "av:track": [{"dcterms:identifier": "picture", **expected_track}],
        }
        descriptor = normalize_mode(offer, mode)
        self.assertEqual(descriptor, expected)
        self.assertTrue(matches_schema(descriptor, {"const": expected}))
        self.assertEqual((offer, mode), before)
        for width, height in wrong_grids:
            with self.subTest(wrong_grid=(width, height)):
                other_offer, other_mode = copy.deepcopy((offer, mode))
                other_mode["av:track"][0].update({"av:width": width, "av:height": height})
                other_before = copy.deepcopy((other_offer, other_mode))
                other = normalize_mode(other_offer, other_mode)
                other_expected = copy.deepcopy(expected)
                other_expected["av:track"][0].update({"av:width": width, "av:height": height})
                self.assertEqual(other, other_expected)
                self.assertFalse(matches_schema(other, {"const": expected}))
                self.assertEqual((other_offer, other_mode), other_before)

    def test_ordinary_raster_example_keeps_its_dimensions(self):
        self.assert_grid(
            {},
            {"av:representation": "av:EncodedVideo", "av:codec": "av:JPEG",
             "av:width": 1280, "av:height": 720},
            {"sampleGrid": [1280, 720], "presentationRotation": 0, "pixelAspectRatio": [1, 1]},
        )

    def test_exif_orientation_does_not_rotate_jpeg_descriptor(self):
        native = {"jpegSampleColumns": 4000, "jpegSampleRows": 3000, "exifOrientation": 6,
                  "displayGrid": [3000, 4000], "previewMirrored": True}
        self.assert_grid(
            {"av:width": native["jpegSampleColumns"], "av:height": native["jpegSampleRows"]},
            {"av:representation": "av:EncodedVideo", "av:codec": "av:JPEG",
             "av:width": 4000, "av:height": 3000},
            native, wrong_grids=((3000, 4000),),
        )

    def test_codec_conformance_crop_excludes_padded_storage(self):
        native = {"codedColumns": 1920, "codedRows": 1088, "cropBottomSamples": 8}
        self.assert_grid(
            {"av:codec": "av:H264", "av:width": native["codedColumns"],
             "av:height": native["codedRows"] - native["cropBottomSamples"]},
            {"av:representation": "av:EncodedVideo", "av:codec": "av:H264",
             "av:width": 1920, "av:height": 1080},
            native, wrong_grids=((1920, 1088),), kind="av:Clip",
        )

    def test_pixel_aspect_and_preview_do_not_rescale_descriptor(self):
        native = {"sampleColumns": 720, "sampleRows": 576, "pixelAspectRatio": [16, 15],
                  "displayGrid": [768, 576], "previewGrid": [384, 288]}
        self.assertEqual(native["sampleColumns"] * 16, native["displayGrid"][0] * 15)
        self.assert_grid(
            {"av:width": native["sampleColumns"], "av:height": native["sampleRows"]},
            {"av:representation": "av:EncodedVideo", "av:codec": "av:JPEG",
             "av:width": 720, "av:height": 576},
            native, wrong_grids=((768, 576), (384, 288)),
        )

    def test_strided_bgr_grid_is_independent_of_scan_direction(self):
        for stride in (56, -56):
            with self.subTest(stride=stride):
                native = {"columns": 17, "rows": 13, "rowStrideOctets": stride,
                          "firstRowOffset": 0 if stride > 0 else 672, "allocationOctets": 728}
                row_octets = native["columns"] * 3
                span = (native["rows"] - 1) * abs(stride) + row_octets
                self.assertEqual((row_octets, row_octets * native["rows"], span), (51, 663, 723))
                self.assertGreaterEqual(native["allocationOctets"], span)
                self.assert_grid(
                    {"av:representation": "av:RawVideo", "av:pixelFormat": "av:BGR8",
                     "av:bufferLayout": "av:Strided",
                     "av:width": native["columns"], "av:height": native["rows"]},
                    {"av:representation": "av:RawVideo", "av:pixelFormat": "av:BGR8",
                     "av:bufferLayout": "av:Strided", "av:width": 17, "av:height": 13},
                    native, wrong_grids=((56, 13),),
                )

    def test_odd_yuv_grid_is_not_plane_or_allocation_geometry(self):
        native = {"columns": 17, "rows": 13, "allocations": ["Y", "U", "V"],
                  "planeOffsetsWithinAllocations": [0, 0, 0]}
        chroma = ((native["columns"] + 1) // 2, (native["rows"] + 1) // 2)
        planes = (native["columns"] * native["rows"], chroma[0] * chroma[1],
                  chroma[0] * chroma[1])
        self.assertEqual(chroma, (9, 7))
        self.assertEqual(planes, (221, 63, 63))
        self.assertEqual(sum(planes), 347)
        self.assert_grid(
            {"av:representation": "av:RawVideo", "av:pixelFormat": "av:YUV420P",
             "av:bufferLayout": "av:Contiguous",
             "av:width": native["columns"], "av:height": native["rows"]},
            {"av:representation": "av:RawVideo", "av:pixelFormat": "av:YUV420P",
             "av:bufferLayout": "av:Contiguous", "av:width": 17, "av:height": 13},
            native, wrong_grids=((9, 7), (347, 1)),
        )

    def test_roi_origin_and_sensor_extent_are_not_image_dimensions(self):
        native = {"sensorGrid": [4000, 3000], "roi": {"x": 320, "y": 240, "width": 640, "height": 480}}
        self.assert_grid(
            {"av:width": native["roi"]["width"], "av:height": native["roi"]["height"]},
            {"av:representation": "av:EncodedVideo", "av:codec": "av:JPEG",
             "av:width": 640, "av:height": 480},
            native, wrong_grids=((960, 720), (4000, 3000)),
        )

    def test_materialized_rotation_describes_the_new_output_grid(self):
        native = {"inputGrid": [1280, 720], "rotationAppliedToPixels": 90, "outputGrid": [720, 1280]}
        self.assert_grid(
            {"av:representation": "av:RawVideo", "av:pixelFormat": "av:BGR8",
             "av:bufferLayout": "av:Contiguous",
             "av:width": native["outputGrid"][0], "av:height": native["outputGrid"][1]},
            {"av:representation": "av:RawVideo", "av:pixelFormat": "av:BGR8",
             "av:bufferLayout": "av:Contiguous", "av:width": 720, "av:height": 1280},
            native, wrong_grids=((1280, 720),),
        )

    def test_unknown_legacy_grid_is_not_filled_from_native_hints(self):
        for missing in (("av:width",), ("av:height",), ("av:width", "av:height")):
            with self.subTest(missing=missing):
                offer, mode = self.offered()
                mode["backend"] = {"legacyMeaning": "unknown", "displayGrid": [1280, 720],
                                   "sensorMaximum": [4000, 3000], "exifOrientation": 6}
                for key in missing:
                    del mode["av:track"][0][key]
                before = copy.deepcopy((offer, mode))
                self.error("AV_INVALID_DESCRIPTION", lambda: normalize_mode(offer, mode))
                self.assertEqual((offer, mode), before)

    def test_dimensions_do_not_add_orientation_roi_or_control_fields(self):
        for key in ("av:orientation", "av:roiX", "av:roiY", "av:stride", "av:displayWidth", "av:setWidth"):
            with self.subTest(key=key):
                offer, mode = self.offered()
                mode["av:track"][0][key] = 1
                before = copy.deepcopy((offer, mode))
                self.error("AV_INVALID_DESCRIPTION", lambda: normalize_mode(offer, mode))
                self.assertEqual((offer, mode), before)


class PublicationEditionTests(DiagnosticAssertions, unittest.TestCase):
    def test_inventory_regions_are_complete_stable_and_checked(self):
        from generated_regions import assemble, sources
        from model import TERMS
        text = relative_file("av/spec.md").read_text(encoding="utf-8")
        self.assertEqual(assemble(text, TERMS, check=True), text)
        entries = list(sources(TERMS))
        self.assertEqual(len(entries), 100)
        self.assertEqual(text.count("<!-- BEGIN GENERATED:"), 101)
        for _, _, doc in entries:
            for anchor in doc["specification"]["anchors"]:
                self.assertEqual(text.count(f'<a id="{anchor}"></a>'), 1)
            self.assertIn(doc["specification"]["normative_text"], text)
        self.error("AV_EDITION_INCONSISTENT", lambda: assemble(
            text.replace("<!-- END GENERATED: terms.json#/classes/Offer -->", ""), TERMS, check=True))
        self.error("AV_EDITION_INCONSISTENT", lambda: assemble(
            text.replace("### 4.1 `av:Offer`", "### Incorrect Offer"), TERMS, check=True))

    def test_role_and_artifact_contract_is_readable_in_root(self):
        text = relative_file("av/spec.md").read_text(encoding="utf-8")
        for word in ("Description Publisher", "Requirement Author", "Document Processor", "Metadata Matcher",
                     "Native-reference Consumer", "AV-SHACL-PARTIAL", "AV-EDITION-CONSISTENCY",
                     "AV-ARTIFACT-INVENTORY", "Annex B. Independent implementer exercise"):
            self.assertIn(word, text)
        self.assertEqual(text.count("```mermaid"), 6)
        for number in range(1, 7):
            self.assertIn(f"**Figure {number} (informative):", text)

    def test_media_geometry_and_layout_contract_is_explicit(self):
        text = relative_file("av/spec.md").read_text(encoding="utf-8")
        for statement in ("codec-mandated conformance", "presentation", "ceil(width/2)",
                          "ceil(height/2)", "one allocation", "Sensor ROI",
                          "AV-IMAGE-GRID-EDITION", "EXIF orientation",
                          "withhold or withdraw", "does not decode media"):
            self.assertIn(statement, text)
        width, height = 5, 3
        planes = (width * height, ((width + 1) // 2) * ((height + 1) // 2),
                  ((width + 1) // 2) * ((height + 1) // 2))
        self.assertEqual(planes, (15, 6, 6))
        self.assertEqual(sum(planes), 27)
        self.assertEqual(1280 * 720 * 3, 2764800)

    def test_direction_and_transfer_boundaries_remain_explicit(self):
        text = relative_file("av/spec.md").read_text(encoding="utf-8")
        for statement in ("Schema equality is not wire-payload compatibility",
                          "generate undeclared receiver input", "does not assign a general `type: string` default",
                          "AV-DESTINATION-EXPLICIT", "AV-PROCESSOR-RESULT-IDENTITY"):
            self.assertIn(statement, text)
        self.assertIn("Initial native UVC adapters advertise Still only", text)

    def test_diagnostics_retain_native_uncertainty_and_categories(self):
        from diagnostics import AVError, CODES
        text = relative_file("av/spec.md").read_text(encoding="utf-8")
        for code in CODES:
            self.assertIn("`" + code + "`", text)
            error = AVError(code, "Explicit diagnostic", stage="test", location="/record")
            self.assertIsInstance(error, ValueError)
            self.assertEqual(error.as_dict()["location"], "/record")
        native = AVError("AV_NATIVE_FAILURE", "Native timeout", stage="native",
                         native_status="timeout", execution="may-have-occurred")
        self.assertEqual(native.as_dict()["execution"], "may-have-occurred")
        self.assertEqual(native.as_dict()["nativeStatus"], "timeout")


if __name__ == "__main__":
    unittest.main()
