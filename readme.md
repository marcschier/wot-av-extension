# WoT AV Extension

**If ONVIF meets requirements, use ONVIF directly.** The WoT layer is optional
read-only heterogeneous application integration. ONVIF already covers discovery,
configuration, PTZ/imaging, live streams, snapshots, supported analytics/events,
and recording/replay through services and support-dependent Profiles S/T/G/M.
An external OpenCV worker or indexer does not itself require WoT; ONVIF's
analytics architecture also permits distributed processing.[^onvif][^analytics]

[marcschier/wot-av-extension](https://github.com/marcschier/wot-av-extension)
proposes a small shared description for applications that actually benefit
from discovering cameras, files, and independently exposed processor outputs.
It has **7 classes, 29 AV properties, and zero mandatory AV profile families**.
Native Thing Descriptions, DataSchemas, Forms, operation names, and security
remain the access contract.[^td]

**Status: breaking draft revision, `0.2-proposed`.** This is not a W3C
specification, registered vocabulary, deployed service, or interoperability
certification. The new namespace `https://example.org/wot/av/0.2#` is
**unregistered**; `https://example.org/wot/av/context/v0.2` is an **unhosted
placeholder**, not a download endpoint. Offline tooling uses explicit local
context mappings. The deprecated v0.1 namespace is not an alias for this one.

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

First read the [native ONVIF integration](spec/onvif-integration.md). If ordinary
ONVIF/native configuration solves the application, stop there; no TD is needed.
For shared descriptions, start with the
[HTTP/JPEG source](examples/source.td.json) and
[input Need](examples/need.jsonld), which deliberately requires the processor's
separate BGR output rather than pretending JPEG matches directly. Follow the
[illustrated specification](spec.md) for same-Mode matching and native access.
All example endpoints and outcomes are synthetic.

| Location | Purpose |
| --- | --- |
| [spec.md](spec.md) | Native-first decision, six explained diagrams, complete fragments, and matching/default rules. |
| [spec/onvif-integration.md](spec/onvif-integration.md) | Real native operation flow, ordinary adapter configuration, ownership, and primary ONVIF citations. |
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

Use Python 3.10 or newer. If dependencies are not already available, create
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

Use the files in the quick tour as the active **0.2** publication set.
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

[^onvif]: ONVIF [Profile S v1.3](https://www.onvif.org/wp-content/uploads/2019/12/ONVIF_Profile_-S_Specification_v1-3.pdf),
    [Profile T v1.0](https://www.onvif.org/wp-content/uploads/2018/09/ONVIF_Profile_T_Specification_v1-0.pdf),
    [Profile G v1.1](https://www.onvif.org/wp-content/uploads/2025/11/ONVIF-Profile-G-Specification-v1-1.pdf),
    and [Profile M v1.1](https://www.onvif.org/wp-content/uploads/2024/04/onvif-profile-m-specification-v1-1.pdf).
[^analytics]: ONVIF release 26.06, [distributed analytics architecture, lines 552-587](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/doc/Analytics.xml#L552-L587).
[^td]: W3C, [WoT Thing Description 1.1](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/),
    Recommendation, 5 December 2023.
