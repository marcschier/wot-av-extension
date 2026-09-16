# Profile S/T normative requirement ledger

[`requirements-st.json`](../bindings/onvif/catalog/requirements-st.json) maps
**Profile S 1.3, November 2019**, and **Profile T 1.0, September 2018**.
It is an offline, role-specific source ledger, not a runtime implementation,
device inspection result, registered product record, or certification.
The [source lock](../bindings/onvif/sources.lock.json),
[edition catalog](../bindings/onvif/catalog/profile-editions.json), and
[editorial register](../bindings/onvif/catalog/editorial-decisions.json) remain
the authorities for source identity and previously recorded decisions.

| Edition | Device atoms | Client atoms | Total | Function rows | Additional scope row |
| --- | ---: | ---: | ---: | ---: | ---: |
| S 1.3 | 292 | 209 | 501 | 252 | 1 |
| T 1.0 | 477 | 370 | 847 | 436 | 1 |
| Total | 769 | 579 | 1,348 | 688 | 2 |

The review includes every normative feature block in S sections **7.1-7.13,
8.1-8.17, and 9.1-9.2**, and T sections **7.1-7.22 and 8.1-8.17**. It also
includes both editions' section 4 version minimum, section 5 requirement-level
rules, and section 7/8 normative introductions. Scope, references, definitions,
and overview sections were reviewed as context. Physical and printed pagination
are stored separately; they coincide in these two documents.

Coverage accounts for **362 feature-body normative prose bullets**, not merely
tables. A compound bullet can produce several atoms; a table assertion and a
prose assertion of the same operation remain separate, source-addressable
requirements. The resulting **1,121 source-assertion records** link back to all
atoms. `coverage.sourceSections` closes that relation in the other direction.
S sections 8.10.3-8.10.4 and 8.11.3-8.11.4 explicitly inherit the audio function
lists rather than introducing codec-named SOAP operations.

**Source mapping is complete; interpretation is not unconditionally closed.**
`profile-s-ptz-node-choice` remains unresolved: S 8.3.2, PDF page 25, permits
either client node-retrieval operation, while 8.3.4, PDF page 26, marks both
`GetNodes` and `GetNode` M. The ledger preserves the prose group and both table
obligations. This blocks an unqualified S client satisfaction conclusion; it
does not hide a missing source section or silently change either assertion.

## Native references and mapping boundaries

The source baseline is ONVIF release 26.06 at the immutable commit already
recorded in the lock. That release, each WSDL/XSD version, and the two profile
editions are different coordinates. Newer native operations and optional schema
fields do not become older-profile mandatory requirements.

Each atom has the shared `profile`, `edition`, `role`, `source`,
`requirementLevel`, `feature`, `condition`, `classification`, `native`,
`mapping`, `evidenceTargets`, and `editorialDecisionIds` fields. Additional
fields retain an original description, the local source grade, enclosing
feature path, resource scope, and inspection restrictions. Descriptions are
independently authored summaries; the original reference-only PDFs are not
modified or reproduced in the repository.

An operation reference identifies its actual `serviceNamespace`, `portType`,
`operation`, locked `sourceId`, and `proofRef`. A type reference uses an expanded
`typeQName`. **181 operation contracts and 24 type references** have shared,
deduplicated `nativeReferenceEvidence` records, including native declaration
lines, source hashes, and operation input/output message and element QNames.
The reference keys are source addresses, for example:

```text
wsdl:onvif:wsdl/ver10/device/wsdl/devicemgmt.wsdl#portType=Device&operation=SetUser
```

They are not guessed generated operation IDs or TD JSON Pointers. The compiler
can resolve them to its own canonical models without deduplicating distinct
profile/role/source requirements. Use qualifiers such as configuration type,
PTZ space, rule-type identifier, and auxiliary-command argument as constraints
on a use of the shared native contract, not as new operation names.

In particular:

- `SetUser` is singular; S's `Reboot` label maps to `SystemReboot`, and T's
  `GetHostName`/`SetHostName` labels map to `GetHostname`/`SetHostname`.
- Media1 `Media.GetStreamUri` and Media2 `Media2.GetStreamUri` are separate
  contracts. S relay operations use Device; T uses DeviceIO. S PTZ auxiliary
  commands and T Device auxiliary commands are also distinct contracts.
- S `Notify`, `Subscribe`, and `Renew` reference their actual imported OASIS
  portTypes and the corresponding ONVIF Event WSDL bindings. `Notify` preserves
  producer/consumer direction; it is not invented as a device-hosted command.
- T event topics carry a topic namespace, path, and profile-page proof.
  `topicns.xml` is only a placeholder, not evidence of complete topic payload
  schemas. `MotionRegionDetector` is a rule identifier, not a fabricated XSD
  type declaration.

Device function atoms can target native actions. Client calls, decoding,
receiving, and workflow obligations are `runtimeRequirement` mappings, not
client-hosted copies of device actions. Codec behavior, authentication,
transports, capability thresholds, and change-notification behavior are retained
without fake affordances. The classification totals are **1,075 protocol,
37 schema, 36 capability, 164 behavior, 32 process, and 4 notRepresentableTd**.
Incorporated service-specification semantics are retained through native
contracts and process obligations; this ledger does not claim to re-atomize
every normative sentence of the entire ONVIF specification set.

## Conditions, resource scope, and implementation choices

`requirementLevel` records the local M/C/O meaning; `condition` includes the
enclosing feature and any narrower resource/function condition. A conditional
feature means support in **any** implementation, including proprietary support.
Facts are self-describing and scoped by profile, role, feature, and relevant
node, configuration, or request context. `factDefinitions` records their
provenance/evidence targets. No device-wide flag substitutes for per-node
pan/tilt, motorized pan/tilt, or zoom support.

Conditions use only the shared grammar:

```json
{
    "all": [
        {"fact": "S.device.ptz.supportedInAnyWay", "equals": true},
        {"fact": "S.device.absolutePositioning.supportedInAnyWay", "equals": true}
    ]
}
```

A null condition means true. An absent fact means **unknown**, including under
`not`; it is not false. `all` is false when a member is known false and otherwise
unknown unless all members are true. `any` is true when a member is known true
and otherwise unknown unless all members are false. Comparisons preserve JSON
types, so Boolean false is not numeric zero. Adapters must omit unknown facts
rather than encode denied reads or missing observations as false.

Occurrence facts, such as a configuration change or synchronization request,
qualify the corresponding behavior atom. They do not remove the separate
function-table or event-topic support obligation when no occurrence has yet
been observed.

**The 17 `obligationGroups` are required semantics, not optional annotations.**
Each group has a role, source, activation condition, `atLeastN`, and branches
whose `allRequirementIds` must all be supported. Members also carry an
`obligationGroup` descriptor. A branch may have an additional `evidenceCondition`.
Count complete supported branches, not satisfied implications: an inactive
codec member cannot vacuously satisfy a codec choice. Two or more supported
branches are allowed. Never compile these groups as exclusive `oneOf`.

Consumers that cannot evaluate these extra group records must preserve them,
report the unsupported interpretation, and decline profile-satisfaction claims.
They must not silently flatten all M* members to universal requirements or
discard the group. Group results are not registered conformance evidence.

Important retained distinctions include S client complete push-versus-pull
event workflows; T device at-least-one H264/H265 versus both client decoders;
T device at-least-one tampering topic versus all eight for an applicable
client; baseline transport alternatives; source/output attachment versus
create-with-configuration; and at-least-one client auxiliary-command variant.
Profile creation's initial source/output requirement constrains the profile
workflow, not every unrelated use of the broader native CreateProfile XSD.

S's `Streaming` discovery scope, mandatory `NetworkVideoTransmitter` type, and
optional generic `Device` type remain explicit. A Device-only discovery probe
is not an adequate S compatibility test. No probe is sent by this ledger.

## Native flags, examples, and safe inspection

[`requirements-st-vectors.json`](../bindings/onvif/examples/requirements-st-vectors.json)
contains **46 condition vectors, 127 group vectors, 55 native flag vectors,
4 metadata event-selection vectors, 38 role-grade goldens, 23 quantitative
threshold vectors, 4 discovery-type vectors, and 138 function-table coverage
goldens**. All inputs are synthetic and contain no device credentials, addresses,
or recorded device observations. Threshold cases exercise preset capacity,
two concurrent pull points, and per-source profile capacity at and around the
required boundaries.

The metadata/support flag cases inspect the pinned native declarations.
Absent optional `Analytics`, `GeoLocation`, `ShapePolygon`, `FieldOfView`,
`FixedHomePosition`, PTZ status-capability flags, and guaranteed-frame-rate flags
are not silently defaulted to false. `PTZFilter.Status` and `Position` are
required inside an observed PTZ filter: omitting them is invalid, not a default.
An unobserved parent is instead unknown. Explicit true and false remain distinct.

The native Events-selection rule is narrower: in a valid observed metadata
configuration, absent `Events` selects no events, present `Events` without a
filter selects all, and a supplied filter selects a subset. This is a payload
selection rule, not proof that the device lacks event functionality.
Metadata synchronization follows the selected content and filters; mandatory
metadata streaming does not enable every metadata flag. Configured frame-rate
limits and advertised capacity are not measured cadence or unconditional fps
guarantees.

Every atom's inspection metadata sets `automaticallyAuthorized: false` and
`actionsIssued: false`. Tags distinguish read-only candidates, sensitive reads,
URI retrieval without session start, writes, allocation/subscription, and
stateful synchronization/event consumption. They are inputs to a separate
bounded, authenticated inspection policy, not an execution allowlist. No
mutation, subscription, synchronization, motion, relay, auxiliary command,
RTSP session, discovery scan, or real-device call is issued.

Publication review of transformed requirement data remains separate from
unchanged public-source reading permission. This work changes no source locks,
editorial decisions, canonical compiler/index/schema, vocabulary, or runtime,
and establishes no ONVIF product registration or certification.
