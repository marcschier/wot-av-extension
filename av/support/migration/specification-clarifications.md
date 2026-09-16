# AV processing edition 2026-09-16-clarifications

This is an intentional processing/documentation edition, **not** a path-only
relocation or a new AV vocabulary. Namespace
`https://example.org/wot/av/0.2#`, context
`https://example.org/wot/av/context/v0.2`, release `0.2-proposed`, seven classes,
29 AV properties and zero mandatory profiles are unchanged. The authoritative
contract is [the assembled specification](../../spec.md) and its incorporated
inventory, not implementation behavior or this migration evidence.

The following records the 30 selected original-project draft technical
decisions, not named independent/domain review or formal release approval.
Assertion IDs are stable
anchors in the specification. Test names identify executable regression
evidence under `av/tools/tests/`; they are not additional normative rules.
The pre-change baseline was 52 passing unit tests after relocation.

| Decision / normative assertion | Prior behavior and reason for the change | Regression evidence |
| --- | --- | --- |
| AV-D01 / AV-AUTHORITY-SINGLE-SOURCE, AV-GENERATED-REFERENCE-COMPLETE | Complete definitions lived outside the root. The root now incorporates all 100 inventory-owned entries and all 49 property-owner uses; paired regions are generated, never independently authored duplicates. | `test_inventory_regions_are_complete_stable_and_checked` |
| AV-D02 / AV-CONFORMANCE-CLAIMS | Prototype support notes could be mistaken for standards exemptions. Five explicit roles separate document processing, matching and actual native bindings. | `test_role_and_artifact_contract_is_readable_in_root` |
| AV-D03 / AV-JSON-SOURCE-VALID, AV-INTEGER-EXACT | Duplicate names were checked but surrogate, IRI escape and numeric-capacity boundaries were incomplete. Invalid syntax/description is explicit, without coercion. | `test_decoded_names_surrogates_and_iri_syntax`, original exact-integer tests |
| AV-D04 / AV-NUMBER-PRECISION | Fraction/exponent tokens passed through binary64. Exact Decimal parsing, serialization and rational multipleOf evaluation preserve mathematical values; declared capacity failures are resource errors. Direct matching API floats require exact source tokens instead. | `test_decimal_parse_serialize_and_exact_arithmetic`, `test_numeric_capacity_is_explicit_not_nonfinite_or_nonmatch` |
| AV-D05 / AV-SEMANTIC-PROJECTION | Predicate-set survival could miss subject, value, datatype or cardinality loss. Full assertion auditing and explicitly bounded RDF graph projection replace it; opaque JSON literals retain exact schema values. | `test_json_literal_preserves_exact_numbers`, `test_projection_checks_complete_assertions_and_graph_boundary` |
| AV-D06 / AV-IDENTITY-CONSISTENCY | Only local Mode/Track/input duplicates were rejected. Association duplicates, attached-source disagreement and contradictory shared identities now fail; identical sharing remains valid. | `test_shared_identity_means_identical_unordered_core_facts`, `test_attached_source_and_association_duplicates` |
| AV-D07 / AV-COMPACT-RECORDS | Intrinsic records accepted arbitrary non-AV fields despite closed shapes. Only declared fields, direct Resource metadata and structural members remain; contextual class recognition does not invent source triples. | `test_intrinsic_closure_types_and_null_do_not_add_defaults` |
| AV-D08 / AV-KIND-ROSTER | Still prose ambiguously said one image. Multiple image components and audio-only Live/Clip preserve existing valid behavior; no synchronization or freshness is inferred. | `test_still_multi_image_audio_only_and_unicode_name_sort` |
| AV-D09 / AV-IMAGE-GRID, AV-IMAGE-GRID-EDITION | **Local technical disposition complete:** [the source-backed dimension decision](dimensions-technical-disposition.md) selects active raster columns/rows after intrinsic codec crop and before presentation transforms. Retain `0.2-proposed` IRIs; explicitly migrate incompatible descriptions or withhold unknown grids, never auto-coerce them. Compatibility evidence is limited to the retained ordinary raster example cohort, not unknown third-party deployments. External formal review remains unapproved. | `ImageGridContractTests` covers EXIF presentation, coded padding, pixel aspect/preview, raw strides, odd YUV, ROI, already-transformed output and unknown facts; descriptor evidence is not decoder/hardware truth |
| AV-D10 / AV-RAW-LAYOUT-KNOWN | Odd chroma sizes and independent packed allocations were unspecified. YUV420P uses ceil halves; packed rows imply neither one allocation nor known offsets. | `test_media_geometry_and_layout_contract_is_explicit`, independent 5x3 and BGR8 arithmetic |
| AV-D11 / AV-CADENCE-EXACT, AV-REPRESENTATION-FIELDS | Exact positive reduced rates, conditional fields and codec/channel choices are preserved. No new bpc, profile, audio amplitude, signaling-clock or nominal-FPS inference. | Original representation/rational/channel tests; audio-only and missing-fact vectors |
| AV-D12 / AV-FORM-RESOLUTION | Accepted `@id` wrappers failed later string membership checks. All identity/operation fields normalize before validation and lookup, without native-token guessing. | `test_node_wrappers_work_through_need_and_native_resolution` |
| AV-D13 / AV-CONTRACT-KEYWORDS | Installed validator registrations determined part of keyword support. A fixed 56-keyword inventory and explicit schema positions now govern support. Unknown/legacy/custom keywords fail. | `test_keyword_inventory_is_exactly_the_specification_list`, `test_keyword_shapes_and_annotation_data_are_not_schemas` |
| AV-D14 / AV-CONTRACT-KEYWORDS | Vocabulary/dialect placement and core:true were not fully checked. Root-only vocabulary declarations and resource-root dialect declarations are enforced; format remains annotation. | `test_vocabulary_and_dialect_placement` |
| AV-D15 / AV-CONTRACT-LOCAL-CLOSURE | Object/Boolean reference targets could be annotation data. Recognized schema locations, resource identities, anchors and bases are now preflight-checked, including unused definitions, with no fetch. | `test_reference_locations_resources_and_unused_definitions`, original pointer/anchor/embedded/dynamic tests |
| AV-D16 / AV-CONTRACT-WELL-FOUNDED | Nonprogressing recursion depended on host recursion errors and branch order. The potential same-instance graph is checked before candidates; child recursion remains supported within budgets. | `test_cycles_are_preflight_errors_even_in_unselected_locations`, original child-recursion test |
| AV-D17 / AV-CONTRACT-REGEX | Python regexp interpretation was not portable or effort-bounded. A Unicode-scalar ECMAScript-subset parser/evaluator now distinguishes invalid, unsupported and resource-limited patterns. | `test_portable_regex_has_ecmascript_unicode_and_anchor_behavior`, `test_resource_limits_remain_errors` |
| AV-D18 / AV-CONTRACT-NO-DEFAULT-INJECTION | Intended applicator and annotation behavior is preserved and independently exercised for zero/one/two oneOf branches and evaluated locations. | `test_oneof_zero_one_two_and_evaluated_locations`, original annotation/contains tests |
| AV-D19 / AV-NORMALIZATION-COMPLETE | Direct selection could hide invalid unselected media facts. Every Mode in the supplied Offer is validated first. | `test_unselected_invalid_mode_cannot_hide_inside_offer` |
| AV-D20 / AV-MATCH-CONTRACT-FIRST | Boolean convenience APIs conflated omission and successful matching. They remain compatible; a separate complete-selection result distinguishes MATCH, NON_MATCH, OMITTED_OPTIONAL and UNSATISFIED_REQUIRED. | `test_complete_selection_distinguishes_omission_and_contract_errors` |
| AV-D21 / AV-FORM-RESOLUTION | Existing original-TD membership/base/security rules are preserved. Resolution exposes effective variables and operations without choosing the first operation or initiating access. | Original native membership/base/default tests; `test_rfc6570_scalar_operator_vectors_and_policy_recheck` |
| AV-D22 / AV-NATIVE-TEMPLATE-BINDING | All templates were rejected. Scalar RFC 6570 expansion now takes typed separate invocation parameters, Thing/affordance scoping and an optional post-expansion policy. Missing actual identifiers still fail; no native conversion or latest-image fallback is invented. | `test_actual_template_expansion_and_missing_issued_identifier`, `test_authored_native_parameter_fixture` |
| AV-D23 / AV-NATIVE-DEFAULTS, AV-NATIVE-SECURITY | Combo minimum cardinality and response validity were incomplete. Combo members require at least two; absent versus present ExpectedResponse and native action/security defaults are explicit. Existing missing/cyclic fixtures now contain two members so they still test their original error. | `test_combo_minimum_is_two_and_not_schema_exclusivity`, `test_response_and_action_defaults_do_not_change_original_td` |
| AV-D24 / AV-PAYLOAD-NATIVE-AUTHORITY, AV-PAYLOAD-DIRECTION | Property extraction lost native schema terms and directional nested fields. Full relevant schema data and explicit producer/receiver direction are retained; native payload metadata exposes the actual source pointer. | `test_payload_projection_keeps_native_terms_and_direction`, `test_result_reports_selected_producer_and_actual_schema_source` |
| AV-D25 / AV-PAYLOAD-NO-ARBITRARY-DEFAULT | Missing schema remains unknown, but now has a typed category distinct from explicit empty schema, string, null and binary bytes. No universal missing-type string default is introduced. | `test_result_reports_selected_producer_and_actual_schema_source`, original unknown-schema tests |
| AV-D26 / AV-PROCESSOR-RESULT-IDENTITY | Optional processor and independent result-producer identities remain valid. The selected native TD identifies the producer; no causal attribution or default processor is inferred. | `test_external_result_producer_is_not_inferred_from_processor` |
| AV-D27 / AV-DESTINATION-EXPLICIT | Schema equality and synthetic payload checks remain illustrative, not a transfer algorithm. Destination resolution neither schedules nor sends; extra producer fields require an explicit receiver mapping. | `test_direction_and_transfer_boundaries_remain_explicit`, original conversion non-match tests |
| AV-D28 / AV-ERROR-NOT-NONMATCH | Mostly untyped ValueError failures now expose stable code, stage, location, reason, limits and native execution context through the ValueError-compatible AVError. No error becomes NON_MATCH. | `DiagnosticAssertions`, `test_diagnostics_retain_native_uncertainty_and_categories` |
| AV-D29 / AV-SHACL-PARTIAL, AV-ARTIFACT-INVENTORY | Partial shape limitations are incorporated in the root. Complete source/Need/matcher/native exercises distinguish offline evidence from actual hardware/native execution. | Existing SHACL scope tests; `test_role_and_artifact_contract_is_readable_in_root` |
| AV-D30 / AV-PUBLICATION-STABLE-IDS | Markdown remains authoritative; all existing draft IDs and legacy entry aliases are preserved additively. Formatting preserves tokens; diagrams have textual equivalents. HTML/rights/author identity remain publication-owner work. | `test_inventory_regions_are_complete_stable_and_checked`, original formatting and literal-pointer tests |

## Integration boundaries

The full validator still requires up-to-date publication hashes and all linked
published pages. Neither gate is bypassed when another owner has not finished.
Only core generation is performed by this work; final manifest resealing and
any changed example dataset belong to the final integrator. The ONVIF cross-link
must resolve to an actual `onvif/spec.md`, not a permissive link-check exception.
Publication renderer/HTML, ONVIF models/runtime, adapters, real camera evidence,
editor identity, licensing and external publication remain separate scopes.

All protected archive, research and upstream bytes remain exact. No vocabulary
IRI alias, new AV field, Assignment/result lifecycle, dependency change,
credential, automatic native access, stage, commit, push or site publication is
part of this edition.
