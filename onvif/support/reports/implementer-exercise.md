# Independent document consumer exercise

> **Integration follow-up:** `IMPL-GAP-01` is corrected in the generated binding
> schema, with positive mixed-Action and negative canonical-root regression
> controls. The final integrator's independent 16-group rerun accepted the
> ordinary DataSchema and reported no specification gaps. See the
> [contextual schema correction record](../../../av/support/publication/integration.md#contextual-binding-schema-correction).
> The original exercise observations below are retained as phase-specific
> evidence, not a claim that the defect is still present.

**Result: executable independent proof completed; one normative schema conflict
remains recorded, not silently repaired.** Sixteen test groups completed with
zero execution failures/errors: fifteen execution/invariant groups and one
diagnostic probe that records the schema conflict. This bounded exercise owns only
`onvif/samples/applications/spec-consumer`, `onvif/tools/tests/implementer`,
`onvif/tools/fixtures/implementer`, and this report. No normative text, existing
dataset, root package, publication tool, or private adapter code is being changed.

## Evidence boundary and frozen expectations

The first evidence pass used only `av/spec.md`, `av/terms.json`,
`av/context.jsonld`, `onvif/spec.md`, and the root ONVIF normative catalogs,
schemas, models, manifest, requirements index, translation map and source lock.
It additionally read the lock-declared Media2 WSDL and the expressly incorporated
`onvif/specs@68ee1b540a40f848c9599eba2c55b87547c588d6:doc/Media2.xml`.
The latter's Git blob was independently recomputed as
`cd4d822f330dffe738c3666531966867be896559`, agreeing with Annex A.2.

`onvif/tools/fixtures/implementer/oracles.json` was written **before fixture
implementation or inspection of any reference implementation interface/source**.
It fixes literal SOAP bodies, canonical JSON, error and QName expectations,
native/adapter TD classification, seven profile-role counts, exact-ratio
matching, and RFC 6570 results. The endpoint port is the sole wire-address
placeholder and is supplied by each explicitly started loopback fixture.
Profile tokens and fictional labels are source fixture declarations, not
client defaults. Both pilots are deliberately partial interfaces.

The initial freeze at **2026-09-16 15:40:10 UTC** had byte SHA-256
`289d9ed4128b773d7d7d517deedc766b4f9d9dadf03b71df2fb942f3e50c4c95`.
A concurrent formatting pass expanded the seven profile-count pairs and changed
CRLF to LF. Reversing only those formatting operations **in memory** reproduced
the exact initial hash; no expectation changed. The formatted byte hash is
`c29c8a62360b87279d05a5db3e7d0df193eb5d38a875c867c1cb53d66e3d2972`.

The consumer uses Python's public HTTP/XML interfaces and public JSON Schema
validation, not node-wot's ONVIF plugin or an implementation codec. No 579-operation
execution, native profile compliance, hardware capture, Linux execution, RTSP,
GStreamer, publication clearance, or certification claim follows from this work.

The only reference implementation material inspected subsequently was the
adapter's public `package.json`, `readme.md`, `capture-contract.json`, and
`src/contract.d.ts`. Its documented exports were then executed as a black box.
Neither the adapter implementation, ONVIF binding/codec implementation, native
worker source, AV helper implementation nor reference test goldens were read.
The native provider is a separate literal-SOAP fixture using Python's standard
XML parser; it never imports the independent consumer serializer.

## Executed coverage

The final recorded run began at `2026-09-16T16:18:47Z` and completed at
`2026-09-16T16:19:00Z`, approximately 39 minutes after oracle freeze.
The preceding complete run also passed all sixteen groups. The final version
retrieves the adapter TD over HTTP, executes both public consumer CLI paths,
and rejects non-XML whitespace in native Boolean/QName lexical values.

| Area | Actual proof and boundary |
| --- | --- |
| Native Device/Media2 | A fictional T+M-style DeviceThing has actual canonical Action schemas, original conservative safe/idempotent flags, explicit anonymous intent/nosec and one partial composite type. GetDeviceInformation, GetProfiles and GetSnapshotUri run against an independently authored SOAP endpoint. No configuration or door operation is sent. |
| Native request wire | Empty GetProfiles still sends its required element. Complete binding/portType tuples select the catalog operation. Token-before-Type order, plain string `All`, exact expanded roots, WS-Addressing Action and SOAP 1.2 HTTP action parameter are checked. A SOAP 1.1 SOAPAction header is absent. |
| Native results | HTTP **201** responses are decoded, not replaced with empty success. Two fresh servers issue different configured token sets; the CLI uses those actual tokens and returned URIs. Missing optional `fixed`/Configurations stay absent; repeated zero Profiles becomes an empty array. |
| Faults and routing | Unknown token retains Sender, ordered InvalidArgVal/NoProfile subcodes, language-tagged Reason, Node, Role and complete Detail XML. WSA2005 parameters retain QName context and receive IsReferenceParameter; WSA2004 properties retain their order/context without that marker. Missing independent logical-route approval fails before send. |
| Negative boundaries | Wrong response root, missing required Uri/ProfileToken, non-nillable nil, unknown mustUnderstand header, non-UTF-8 charset, mismatched operation tuple/action, wrong repeated shape, malformed XML/JSON, DTDs, duplicate JSON keys and undeclared canonical fields fail explicitly. Unsupported Digest does not fall back to anonymous access. |
| Semantic adapter | The actual Windows MF-memory/WIC package exposes canonical HTTP/JSON GetProfiles and GetSnapshotUri plus finite HTTP JPEG GET. The independent client retrieves the real TD and model, follows the abstract import closure, validates canonical JSON, and verifies absence of native typing/SOAP selectors/full-profile claims. Control/image bearer credentials are separate, ephemeral and out of band. |
| Image bytes | Native software fixture: independent 64x48 solid-colour JPEG dimensions and pixel tolerance. MF-memory: actual 17x13, 749-byte JPEG; SOI/EOI, Pillow/libjpeg decode, exact raster/decoded RGB extent and nonconstant pixels verified. This catches JSON/base64 substitution, not merely a Content-Type claim. No physical sensor or timing/codec-transport qualification is asserted. |
| AV | The root document's literal JPEG Offer produces the frozen comparison value. Exact 30000/1001 video plus audio in one Mode matches; 30/1, video-only and audio-only alternatives do not. A required missing fact is not supplied by default; source descriptors remain unchanged; nonreduced rates and unsupported contracts are errors, not NON_MATCH. |
| URI parameters | RFC 6570 expansion uses document/base and owning-affordance variable precedence. Required imageId is supplied explicitly; missing input fails. Reserved/query/fragment expansion and escaping are checked. Original contentType, htv:methodName, response and additionalResponses metadata survive resolution. These tests do not contact the illustrative external document URI. |
| Normative model/data set | Public mapping.schema.json accepts the actual 579-operation catalog; the payload library root rejects arbitrary values. All **571 TMs**, their bytes/imports/fragments, **14 native/abstract wrapper artifacts** for seven families, and **seven separate client manifests** are checked. All 1,440 device and 1,196 client requirement memberships are independently recomputed from requirements-index.json. These are graph/role checks, not 579-operation or full-profile execution. |
| Ownership | Fixture startup is explicit, loopback addresses use actual ephemeral ports, native acquisition is opt-in, HTTP/capture close is awaited, and the child exits naturally. The retained receipt reports acknowledged acquisition stop, released resources and observed worker exit. The pump's expected Cancelled read is retained in evidence, not hidden. |

The executable assertions are in
`onvif/tools/tests/implementer/run.py:107-176` (public grammar/model roles),
`:189-338` (native wire/value/fault/routing),
`:340-407` (AV/templates), and `:409-607` (real adapter/CLI/cleanup and further
negative boundaries). The consumer's independent implementations are
`onvif/samples/applications/spec-consumer/public_contract.py:109-400`,
`consumer.py:151-308`, and `av_match.py:103-306`.

## Confirmed normative conflict: IMPL-GAP-01

**Affected authority:** `onvif/spec.md:246-260` and `:3590-3599` require
`onvif:sourceDataSchema` on **canonical** operation/data roots, while allowing
other actual WoT bindings to coexist (`:3491-3495`, `:4637-4644`).
`onvif/binding.schema.json:19-30,253-287` nevertheless applies `canonicalData`
to **every** Action input/output.

This ordinary noncanonical Action DataSchema is a concrete counterexample:

```json
{
    "actions": {
        "ordinary": {
            "input": {
                "type": "string"
            }
        }
    }
}
```

The public schema rejects it with both
`'onvif:sourceDataSchema' is a required property` and
`'onvif:validation' is a required property`. No private implementation was
consulted to choose a different answer. The frozen oracle's expected acceptance
is retained; `evidence.json` records `ordinaryDataSchemaAccepted: false` and
`specGaps`, even though the diagnostic **probe** itself ran successfully.

**Minimal repair proposal for the normative/integration owner:** make the
canonical requirements contextual to a selected canonical operation/data root,
using canonical type/annotation and native or abstract canonical contract
membership. Permit ordinary DataSchemas in other Actions. Do not weaken the
required annotations on actual canonical roots, including deliberately missing
annotation cases. No normative file was changed by this exercise.

## Other limits and observations

**MF-memory fixture assumption, not a standards defect.** The pre-fixture oracle
planned 64x48 software output. The subsequently inspected public describe API
offers one exact 17x13 software mode, with negative native stride; it has no
64x48 configuration. The original oracle remains unchanged. The test records
64x48 as unsupported, then selects the explicit public 17x13 tuple recorded
in `mf-memory-source.json` **before acquisition or image-byte inspection**.
There is no hidden resize or synthetic substitution under a hardware label.
Pixel-content qualification is limited to the stated independent byte/geometry
checks; the worker's private colour-grid algorithm was not inspected.

**Public adapter prerequisite.** A separately constructed CaptureBackend needs
the previously obtained `cachedEvidence` as well as the configured acquisition
permission. The public declaration exposes that constructor input. An initial
omission produced IdentityChanged and a real failure; the fixture was completed
by supplying this declared input, not by weakening identity checks or changing
the adapter. The adapter's documented HTTP authorization rejection is 403 and
is retained as PolicyDenied, not converted to empty profiles.

**Integrity scope.** Catalog/payload bytes and the registry digest recipe are
checked independently; selected native WSDL bytes are checked against both
catalog and source-lock hashes. The model manifest has a `sourceLockDigest`
but no source-lock byte-artifact entry. This exercise does not infer a private
lock-digest recipe or conclude that a separate publication manifest is absent.
Annex A.1's complete-edition-manifest requirement and B.6's digest rules should
be linked to that precise public authority for a full bundle-integrity claim.
That wider claim is deliberately not made here.

**Deliberate implementation subsets.** This is an independent pilot, not a
general Canonical Value Processor or full Native SOAP/AV conformance class.
Unsupported descriptor particles, general QName/scalar families, open/mixed XML,
derived types, explicit false nil and unsupported native facets reject.
The AV sample rejects schema references/resources/regex, noninteger schema
numbers, general JSON-LD graph assembly, multi-input assignment and directional
result matching. No full 56-keyword matcher claim is made. Error categories,
bounds and supported subset are documented in the sample README.

No hardware enumeration/open, Linux/Docker/WSL service, GStreamer, RTSP session,
full codec/client/profile behavior, ONVIF registration or W3C publication process
was exercised. Named editor, independent domain reviewer, licensing and formal
publication approvals remain external governance information; they do not block
these completed code artifacts or turn them into certification.

## Reproduction and artifacts

Installed tools used: Python **3.13.15**, jsonschema **4.26.0**, lxml **6.1.1**,
Pillow **12.3.0**, uri-template **1.3.0**, Visual Studio Node **24.12.0**.
No dependency or OS service was installed. No camera-adapter or reference-runtime
source was edited or rebuilt.

The exact local command, with every prerequisite explicit, was:

```powershell
python .\onvif\tools\tests\implementer\run.py `
    --repo 'D:\git\marcschier\wot-av-extension' `
    --output 'D:\git\marcschier\wot-av-extension\onvif\tools\fixtures\implementer\generated' `
    --node 'C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe' `
    --td-schema 'C:\Users\mschier\.copilot\session-state\64c41574-f11d-4446-9598-f117adff756b\files\av-td11-pinned-schema.json'
```

The TD 1.1 schema is explicitly supplied offline, byte-pinned in the runner,
and is not an implementation helper. All network exchanges **in the tests**
use `127.0.0.1`. Its external-schema preparation is a prerequisite, not an
invocation-time fetch.

Persistent deliverables:

- `onvif/samples/applications/spec-consumer/README.md`: prerequisites, real CLI
  invocation, independent implementation and exact scope.
- `onvif/tools/fixtures/implementer/oracles.json`: unchanged expectations with
  the initial and formatting-only byte fingerprints documented above.
- `onvif/tools/fixtures/implementer/generated/evidence.json`: run outcome,
  explicit normative gap, model-role counts, JPEG digest and close receipt.
- `generated/native-repeat-0/` and `generated/native-repeat-1/`: actual
  instantiated native TD/TM/policy examples with different returned token sets.
- `generated/mf-memory-camera.td.json`, `mf-memory-camera.tm.json`,
  `mf-memory-policy.json` and `mf-memory-snapshot.jpg`: actual software
  adapter documents and verified image bytes, with **no saved bearer values**.

Generated TD addresses describe the captured ephemeral test instances; those
instances are closed after the run. Regeneration provides new live addresses.
There is no hidden fixed localhost service. Native safe request traces retain
fictional data only; no credential, real camera selector or hardware serial is
saved. The separately requested handoff is
`%TEMP%\regroup-implementer-exercise.md`.

**Integration notification:** the root/publication/data owner should receive
this report and IMPL-GAP-01's minimal repair proposal. This implementer changed
only its assigned paths and the requested temporary handoff. No staging, commit,
push, publication or rewrite of existing datasets was performed.
