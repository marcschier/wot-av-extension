# WoT AV Extension

This repository has **two complementary scopes**:

| Scope | What it supplies |
| --- | --- |
| [AV 0.2 metadata](spec.md) | Optional, thin, read-only descriptions for heterogeneous sources and processor outputs: **7 classes, 29 AV properties, zero mandatory AV profile families**. Its matching and ownership semantics are unchanged. |
| [Native ONVIF WoT binding](bindings/onvif/readme.md) | Canonical models and separate device/client requirement mappings for **all seven released profiles A/C/D/G/M/S/T**, native SOAP/Events through node-wot, native C/GStreamer RTSP sessions, and a read-only discovery-to-Directory/file publisher with CLI. |

**If ordinary ONVIF integration meets requirements, no WoT layer is required.**
The new binding is useful when an application wants to consume ONVIF through
WoT Actions/Events and discover its descriptions alongside other Things. It
speaks the existing camera/access-control protocols directly; it does not
rebuild ONVIF as a custom JSON RPC or camera-control gateway.
An external OpenCV worker or indexer does not itself require WoT; ONVIF already
supports distributed analytics.[^onvif][^analytics]

The optional AV annotations describe existing interfaces; native TD
DataSchemas, Forms, operation names, and security remain the access contract.[^td]

**AV status: breaking draft revision, `0.2-proposed`.** This is not a W3C
specification, registered vocabulary, deployed service, or interoperability
certification. The new namespace `https://example.org/wot/av/0.2#` is
**unregistered**; `https://example.org/wot/av/context/v0.2` is an **unhosted
placeholder**, not a download endpoint. Offline tooling uses explicit local
context mappings. The deprecated v0.1 namespace is not an alias for this one.

**ONVIF status: local reference implementation, `0.1.0-dev.0`.** The separate
provisional `onvif:` prefix does not change the AV namespace. All **579** locked
operation graphs compile; that is a mapping result, not 579 hardware-qualified
workflows or full device/client conformance. Native SOAP, Event and scoped
media evidence is described in the [support matrix](spec/onvif-conformance.md).
The bounded bridge/Directory consumer path now passes with
[explicit logical-EPR authorization](spec/onvif-runtime.md#logical-epr-authorization-status),
including native consumption after bridge shutdown. That local fixture result
does not confer ONVIF/W3C certification or distribution clearance.

## What the small layer does

An **Offer** describes existing, complete **Modes**, each with its simultaneous
**Tracks** and a named native Form. A **Need** belongs to the application:
each named **InputRequirement** uses JSON Schema 2020-12 to test one normalized
Mode **description**, not media bytes or a running job. **Rational** preserves
exact rates; **FormReference** selects a Form, its TD document, and an existing
TD operation.

Missing required facts fail; schema defaults do not invent them. A JPEG source
does not directly match a raw-BGR requirement, nor can audio from one Mode be
combined with video from another. A converter advertises its output only when
that output is an independently useful application interface, not for every
internal `cv2` conversion. Native camera controls remain native.

Optional result references use the producer's existing DataSchema and Form.
A requested destination neither creates a subscription nor sends results by
itself. The core has no Assignment, lease, pin-closure, model-manifest,
admission-controller, or lifecycle framework.

## Quick start

Read [native ONVIF integration](spec/onvif-integration.md) for the protocol and
ownership boundaries. For the implemented binding, use its
[specification index and typed quickstart](bindings/onvif/readme.md) and
[bridge configuration](spec/onvif-runtime.md). For optional AV descriptions,
start with the
[HTTP/JPEG source](examples/source.td.json) and
[input Need](examples/need.jsonld), which deliberately requires the processor's
separate BGR output rather than pretending JPEG matches directly. Follow the
[illustrated specification](spec.md) for same-Mode matching and native access.
All example endpoints and outcomes are synthetic.

| Location | Purpose |
| --- | --- |
| [spec.md](spec.md) | Native-first decision, six explained diagrams, complete fragments, and matching/default rules. |
| [bindings/onvif/readme.md](bindings/onvif/readme.md) | Native binding specification index, actual package exports, and a typed integration helper. |
| [spec/onvif-integration.md](spec/onvif-integration.md) | Seven-profile native scope, real operation flow, optional AV ownership, and primary ONVIF citations. |
| [spec/onvif-sources.md](spec/onvif-sources.md), [profile editions](bindings/onvif/catalog/profile-editions.json) | Complete locked source catalog, exact release/edition pins, exclusions, and rights gates. |
| [S/T ledger](spec/onvif-profile-st.md), [G/M ledger](spec/onvif-profile-gm.md), [A/C/D ledger](spec/onvif-profile-acd.md) | 2,636 role-specific requirement atoms, native locators, conditions, alternatives, and unresolved obligations. |
| [spec/onvif-mapping.md](spec/onvif-mapping.md), [binding reference](spec/onvif-binding-reference.md) | Canonical compiler, generated models, XML/JSON rules, and every current binding vocabulary entry. |
| [native SOAP](spec/onvif-binding.md), [Events](spec/onvif-events.md), [Node media](spec/onvif-node-media.md) | Direct node-wot execution and separately owned native RTSP media sessions. |
| [bridge/CLI](spec/onvif-runtime.md), [support matrix](spec/onvif-conformance.md), [packaging](spec/onvif-packaging.md) | Discovery/publication, measured scope versus deferred behavior, and installation/build/publication gates. |
| [spec/terms.md](spec/terms.md) | Generated per-entry reference and TOC: who authors it, what it describes, how it is used, and omission/default behavior. |
| [vocabulary/terms.json](vocabulary/terms.json) | Authored term inventory and documentation metadata. |
| [vocabulary/context.jsonld](vocabulary/context.jsonld), [vocabulary/ontology.ttl](vocabulary/ontology.ttl) | Generated JSON-LD context and vocabulary. |
| [shapes/av.shacl.ttl](shapes/av.shacl.ttl), [spec/validation.md](spec/validation.md) | Structural constraints and the distinct JSON, TD, RDF, metadata-schema, and implementation boundaries. |
| [examples/source.td.json](examples/source.td.json), [examples/live.td.json](examples/live.td.json), [examples/clip.td.json](examples/clip.td.json) | Still, joint live audio/video, and whole finite Clip descriptions. |
| [examples/processor.td.json](examples/processor.td.json), [examples/result-need.jsonld](examples/result-need.jsonld) | Explicit processor interfaces, native result schema, and optional destination selection. |
| [examples/sink.td.json](examples/sink.td.json) | Receiver-owned native input schema and Form; no implicit push or durability. |
| [examples/live-need.jsonld](examples/live-need.jsonld), [examples/two-input-need.jsonld](examples/two-input-need.jsonld) | Complete live-track requirements and separately named application inputs, without a scheduler. |
| [examples/onvif-adapter.json](examples/onvif-adapter.json), [examples/NOTES.md](examples/NOTES.md) | Synthetic read-only adapter configuration and exact example scope. |
| [tools/generate.py](tools/generate.py), [tools/check_docs.py](tools/check_docs.py), [tools/validate.py](tools/validate.py) | Intentional generation, documentation checks, and offline validation. |
| [spec/migration.md](spec/migration.md) | Breaking IRI/behavior changes and deprecated v0.1 archive boundary. |
| [research/media-registry-research.md](research/media-registry-research.md) | Main research report: public-standards-based, informative rationale, transport findings, and tradeoffs. |
| [provenance.json](provenance.json), [release-manifest.json](release-manifest.json) | Publication provenance and explicitly scoped integrity inventory. |

## Local setup and checks

For the native binding, use Node **>=20.19.0** on PATH. In a fresh, private
checkout, install the lockfile dependencies without lifecycle scripts, then
build and inspect the CLI:

```powershell
npm ci --ignore-scripts
npm run build:onvif
node .\packages\binding-onvif\dist\cli\main.js --help
npm run test:onvif
```

Do not run `npm ci` over a shared dependency tree while another owner is using
it. `test:onvif` is the composed non-native-worker suite, not the historical
first SOAP gate alone. Native-media execution is separately opt-in and needs
an already built worker and matching SDK; npm does not install them.
See [packaging](spec/onvif-packaging.md) and
[explicit media prerequisites](spec/onvif-runtime.md#scope-and-qualification).

For the unchanged AV publication tools,
use Python 3.10 or newer. If dependencies are not already available, create
an isolated environment and install the pinned development requirements:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

If activation is unavailable, use `.\.venv\Scripts\python.exe` instead of
`python`. Installation is a separate setup step and may need network access.
From the repository root, inspect the assembled publication without rewriting it:

```powershell
python -B tools\generate.py --check
python -B tools\check_docs.py
python -B tools\validate.py
```

After an **intentional, reviewed change** to authored inputs or generation
rules, regeneration is explicit:

```powershell
python -B tools\generate.py
python -B tools\check_docs.py
python -B tools\validate.py
python -B tools\generate.py --check
```

Do not regenerate to conceal unexplained integrity failures. The inventory,
not the generated catalogue, is the term authority. Preserve `.gitattributes`:
line-ending conversion changes exact-byte digests. The release manifest's file
list defines its coverage; it does not hash itself or implicitly cover every
file in the repository. Publication hashes are tooling, not runtime AV pins.

These commands do not operate a camera or qualify a decoder. Synthetic
metadata compatibility, native TD structure, native implementation support,
authorization, and actual execution are different claims; see
[validation scope](spec/validation.md).

## Canonical material, history, and rights

The AV links in the quick tour identify the active **0.2** publication set.
The additive ONVIF implementation has its own
[source authority](spec/onvif-sources.md), [generated inventory](bindings/onvif/generated/manifest.json),
and [publication boundaries](spec/onvif-packaging.md). Its package/context
version `0.1` is unrelated to the deprecated AV v0.1 design.
The [v0.1 specification](archive/v0.1-proposed/spec.md) is **deprecated
historical material**, preserved from committed v0.1 files, not another current
normative source. Its assignment/profile machinery and reported outcomes are
not requirements or results of the active draft.

The [historical research archive index](research/archive/README.md) and
[publication provenance](research/provenance.json) identify admitted editions,
original fingerprints, transformations, and withheld categories. Historical
material under `research/archive/` is background, not another term authority;
earlier vocabularies, generators, fixtures, and reported outcomes belong to
their own snapshots and may be superseded. Archive inclusion is restricted by
redistribution rights.

Rights-limited earlier research is retained locally and **not committed**.
Private-source code, prose, implementation citations, and personal host paths
are not reproduced in these root documents. The repository therefore does not
contain every earlier research artifact, and its visibility is not a substitute
for redistribution permission.

The repository is published **private**. Do not change its visibility as a
packaging step; any broader distribution requires a separate rights review.

**No first-party reuse license has been selected** for this draft's vocabulary,
documentation, or tooling. Do not infer one from another project's license.
The copied W3C TD context and schema have their own
[upstream notice](third_party/wot/LICENSE.md),
[full license](third_party/wot/LICENSE-W3C-2023.txt), and
[redistribution notice](third_party/wot/NOTICE-W3C.txt).
Their [provenance manifest](third_party/wot/manifest.json) records source
revision, exact bytes, and notice transformations. Those third-party terms
apply to the identified copies; they do not automatically license the new AV
proposal.

[^onvif]: The [locked seven-profile catalog](bindings/onvif/catalog/profile-editions.json)
    records the authoritative A 1.0, C 1.0, D 1.0, G 1.1, M 1.1,
    S 1.3 (November 2019), and T 1.0 PDF URLs, hashes and role scopes.
[^analytics]: ONVIF release 26.06, [distributed analytics architecture, lines 552-587](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Analytics.xml#L552-L587).
[^td]: W3C, [WoT Thing Description 1.1](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/),
    Recommendation, 5 December 2023.
