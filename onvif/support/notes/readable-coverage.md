# ONVIF draft coverage and interpretation status

Generated for 0.2-proposed, 2026-09-16. This is an informative readable index, not native certification, hardware qualification or named editorial approval. Original source rows and dated historical notes remain evidence; the current normative authority is [the root specification](../../spec.md) and its declared annexes.

| Profile / edition | Device atoms | Client atoms | Role boundary |
| --- | ---: | ---: | --- |
| A 1.0 | 108 | 102 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| C 1.0 | 101 | 96 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| D 1.0 | 133 | 114 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| G 1.1 | 187 | 193 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| M 1.1 | 142 | 112 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| S 1.3 | 292 | 209 | Source, native/proprietary feature, client implementation and resource scope remain distinct |
| T 1.0 | 477 | 370 | Source, native/proprietary feature, client implementation and resource scope remain distinct |

2636 original atoms and 28 original at-least-N groups are retained. Every atom keeps its raw source record, original local level, effective draft level and complete condition/native resolution. Conditions with missing or denied typed evidence remain unknown; applicability is never satisfaction.

NP-S1 uses the existing nonexclusive PTZ retrieval group with both table/prose assertions in the complete branch. NP-G1 separates mandatory SetTrackConfiguration interface availability from conditional dynamic-track update behavior. NP-G2 requires the complete interface only within each actual native/proprietary on-board feature. NP-A1 keeps client attestation separate from the peer Schedule flag.

NP-G3's exact RecordingConfig/RecordingJobConfiguration topic is source-verified. RecordingControl 5.29.2 and Core 9.4.3 are both cited. Source RecordingJobToken and typed Configuration ElementItem are retained, with no invented same-named global element. The actual payload root still requires its trusted native message description. This is an affected payload/qualification boundary, not an unresolved topic-name guess.

All named interpretations are deterministic draft rules. Their current decision records have empty reviewer lists, formalReleaseApproved=false, exact affected IDs and a before-formal-release named-editor/independent-domain-review gate. No external approval is fabricated.

Historical pre-relocation/qualification notes do not re-open a resolved EPR-routing implementation issue or override this standard. Logical-route authorization, physical target authorization and publisher trust remain independent required decisions; a matching ID or source prefix is never an authorizer.
