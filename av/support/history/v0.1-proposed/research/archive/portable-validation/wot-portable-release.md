# Portable canonical WoT AV release stage

**Ready for coordinator import, not yet a published repository or an admitted
media implementation.** The stage is:

`media-research\wot-portable-stage-64c41574`

It contains **43 files, 647,364 bytes** (about 632 KiB). Its canonical inventory
retains **38 classes, 105 AV properties, 17 reused external properties, H265 and
Opus**. The required offline validation command passes **867 checks**, including
103 SHACL data cases, meta-SHACL, exact pins, native TD structure, references and
SPARQL positives/negatives. The worked Assignment remains **NOT ADMITTED**. [E1,
E2]

The external integrity anchor for the staged `release-manifest.json` is:

```text
SHA-256 e579fd514d58d1ec9a084c9d5156dced82279a119cce3c44bdef5f553072f92d
```

The manifest covers the other 42 release-owned files and deliberately excludes
its own hash. This report is outside the stage and is not a runtime dependency.
No repository was created, modified, initialized, committed or pushed. No
GitHub publication/account operation was performed. Public upstream source
fetches were used only to verify W3C provenance and license terms.

## File layout

```text
.gitattributes
provenance.json
release-manifest.json
requirements-dev.txt
vocabulary\
    terms.json
    context.jsonld
    ontology.ttl
shapes\
    av.shacl.ttl
spec\
    terms.md
    validation.md
examples\
    NOTES.md
    source.td.json
    controller.td.json
    need.jsonld
    assignment.jsonld
    cache-policy.json
    pins.jsonld
    manifest.json
    dataset.nq
    query.rq
    live.query.rq
    profiles\
        acquisition.json
        resource.json
        codec.json
        adapter.json
        http-profile.json
        control-profile.json
tools\
    common.py
    model.py
    generate.py
    validate.py
    check_examples.py
    check_shapes.py
tests\
    fixtures\
        expectations.json
        controller.json
        live.td.json
        codec-fragments.jsonld
third_party\
    wot\
        td-context.jsonld
        td-schema.json
        LICENSE.md
        LICENSE-W3C-2023.txt
        NOTICE-W3C.txt
        manifest.json
```

There is deliberately **no root README, main specification, root first-party
license, historical archive, .git directory, virtual environment, SDK, screenshot
or cached HTML**. Original proposal code was adapted from the authorized Temp
generators/probes, not copied from proprietary ACF source. Original historical
reports and generators remain outside the stage. `provenance.json` records their
basenames and hashes; these are provenance records, not working-directory or
machine-path dependencies.

## Canonical preservation and repairs

The source authority is the supplied `wot-av-release-v0.1.terms.json`, SHA-256
`04e7e215a4af64812f0e9fd91f78acfc5e68dd0d72c68d18897885c94d13ea32`.
Seventeen complete meaning-bearing sections compare exactly with it, including
all class/property/enum definitions, profiles, conventions, admission/lifecycle
rules and codec extension policy. Exactly five metadata fields changed: the
historical source basename, portable inventory path, shape/example status and
shape-coverage description. The complete generated catalogue retains full
meanings and rules rather than importing the shortened parent-session
catalogue. [E1]

The staged context has the exact release context mappings. The ontology is
graph-equivalent to the supplied release ontology: **1,023 triples**. The shipped
shape graph is graph-equivalent to the reviewed corrected SHACL plus the codec
merge: **2,837 triples**. Seventeen copied example/native artifacts remain
byte-identical to their authorized originals; historical input fingerprints were
also checked. [E1]

The six sign checks are:

| Value location | Shape helper |
|---|---|
| Track.frameRate | PositiveRationalShape |
| RationalConstraint.lowerRational | PositiveRationalShape |
| RationalConstraint.upperRational | PositiveRationalShape |
| TimestampMapping.timeBase | PositiveRationalShape |
| TimeSelector.start | NonNegativeRationalShape |
| TimeSelector.end | NonNegativeRationalShape |

Both helpers are **validation shapes, not new AV classes**. Generic Rational,
including negative values, and signed observed Timestamp values remain valid.
H265/Opus occur in exactly the intended three codec lists: all codecs,
EncodedVideo = H264/JPEG/H265, EncodedAudio = AAC/Opus. RawVideo and PCM still
forbid codec fields. Positive, zero, negative and cross-representation cases
execute in the harness. No VideoTrack or SubmitNeedAction class is introduced.
[E1, E2]

All external namespace/context/profile URIs remain unchanged and unhosted where
originally declared so. The finite cache policy is explicit and local.
Graph-to-pin and query-only provenance mappings remain distinct. No OWL import,
inference or network resolution supplies missing descriptions. [E2]

## Commands and observed results

From the stage root, with the declared dependencies available:

```powershell
python tools\validate.py
python tools\generate.py --check
```

For intentional changes only, explicitly regenerate and reseal:

```powershell
python tools\generate.py
python tools\validate.py
```

The exact provided interpreter reused for this task was:

```text
isolated-runtime\Scripts\python.exe
```

No dependencies were installed. `requirements-dev.txt` reflects the four actual
direct dependencies: **PyLD 3.1.0, jsonschema 4.26.0, RDFLib 7.6.0, pySHACL
0.40.1**. Execution used **Python 3.13.15 on Windows**. Generation uses PyLD and
RDFLib; validation additionally uses jsonschema and pySHACL. [E2]

| Check | Observed result |
|---|---|
| Required default offline command | Exit 0; 867 checks; no artifact writes |
| Shipped SHACL and meta-SHACL | Pass; inference=none; OWL imports disabled |
| SHACL data fixtures | 103 cases: 41 structural positives, 52 expected failures, 10 documented limits |
| Opt-in finite resolved-reference profiles | Positive and expected-negative checks pass; meta-SHACL also executed |
| Native TD structure | Source, Controller and separate Live fixture pass the immutable native schema |
| JSON/RDF/AV roles | Strict JSON, integer/rational, expansion preservation and canonical marker checks pass |
| Pin/Form resolution | 16 resolved pins, 4 resolved FormReferences; qualification dependency intentionally unavailable |
| Still and Live queries | Exactly one expected candidate each |
| Seven negative query cases | Zero rows for every case |
| Deterministic regeneration | All 43 files byte-identical across fresh processes and PYTHONHASHSEED 1/987654 |
| Relocation | Complete copy under a path containing spaces, invoked from an unrelated directory: 867 checks pass |
| Stale-pin command negatives | Both default validation and generation --check return nonzero; no silent repair |
| Physical/device/runtime tests | None |

Evidence is saved outside the stage in [E1]-[E5]. The inspected temporary
relocation copy, including its deliberately corrupted stale-pin specimen, was
removed. The canonical stage and evidence reports remain.

The validator's expected-negative categories are not mistaken for structural
success. The 867 checks comprise 706 ordinary positives, 49 other expected
negatives, 41 structural positives, 54 structural failures including the two
resolved-reference negatives, 3 expected admission rejections, 13 documented
limits and one counterfactual accepted-envelope **schema-only** check. [E2]

## Worked-example admission boundary

The source/controller TDs and Need are complete synthetic descriptions. The
Assignment explicitly says **HYPOTHETICAL SERIALIZATION / NEGATIVE ADMISSION
FIXTURE**. Its adapter qualification pin has no bytes; the zero digest is a
visible sentinel, not a checksum that qualifies content. Its grant is expired
at the fixed fixture evaluation instant. Current authenticated heads, publisher
trust, resources, grants, media observation and runtime behavior are not proved.
The adapter and Assignment dependency traversals must reject with
`DependencyUnavailable`. The saved request is unsent and the rejection receipt
is synthetic. [E2]

The separate Live query fixture has four explicitly unresolved configuration
pins and unqualified Connector/binding identities. The codec fragments have
seven unresolved configuration pins, two unresolved Forms and explicitly listed
unqualified source/resource/clock identities. These are not admitted paths or
WebRTC/codec capability evidence. Controller/profile dependency cycles use
stable pin IDs and are traversed cycle-safely; no document embeds its own hash.

## W3C provenance and lawful redistribution

The minimal native dependency set is pinned to W3C upstream revision
`87808f1644ba79eb0a58d238385a8bd4a2236853`. Both local snapshots matched fetched
upstream bytes. The context also matched the public native context URL. [L1]

| Native file | Bytes | SHA-256 |
|---|---:|---|
| td-context.jsonld | 39,128 | `9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069` |
| td-schema.json | 34,302 | `87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da` |

Exact primary sources:

- Context: https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/context/td-context-1.1.jsonld
- Public context: https://www.w3.org/2022/wot/td/v1.1
- Schema: https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json
- Repository-wide notice: https://raw.githubusercontent.com/w3c/wot-thing-description/87808f1644ba79eb0a58d238385a8bd4a2236853/LICENSE.md
- Full applicable license: https://www.w3.org/copyright/software-license-2023/
- Short notice: https://www.w3.org/Consortium/Legal/2023/copyright-software-short-notice.html
- Associated publication copyright: https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

The exact upstream LICENSE.md is **164 bytes**, SHA-256
`4836077a1c67170bc261e63ced2c9636d5187506f72ac106df435070315078d5`.
It applies the W3C Software and Document License repository-wide. Its historical
license URL redirects to the edition effective 1 January 2023; SPDX identifies
this edition as **W3C-20150513**, not the older identifier `W3C`. The package
includes the unmodified notice, the full license/disclaimers transcribed for
offline use, and a redistribution notice preserving the associated 2017-2023
publication copyright. Native context/schema bytes were not edited. Notice
transformations and actual output hashes are recorded separately. [L1]

The current public schema at `https://www.w3.org/2022/wot/td-schema/v1.1` is
different: version `1.1-12-March-2025`, 34,642 bytes, SHA-256
`fd44f319f94c6f16f66978860ef2f9f4e0e9fd7fc5835a2f3840b9cf2002e0f1`.
It was **not substituted or bundled**. The package retains the supplied immutable
`1.1-09-November-2023` representation. No HTML cache, SPDX XML, SDK, native
ontology download or additional remote context was copied into the stage. [L1]

**No W3C redistribution blocker was identified with these notices included.**
The publisher still needs to choose/confirm the root license for the original
AV proposal and tools. The W3C license applies to its identified material, not
automatically to the rest of this new repository.

## Remaining limits and import instructions

The pinned native schema declares Draft-07 but contains two `prefixItems`
occurrences, which Draft-07 ignores. Optional `format` assertions are not enabled,
so there is no hidden dependency on optional format packages. Structural schema
success is not complete TD conformance. Its 153 local references resolve to 40
distinct local targets; the native context has no remote context imports. The
schema's mutable `$id` is preserved as source text, not followed as an upgrade
instruction. [E2, L1]

SHACL still does not implement every list, arithmetic, reference, profile,
matching, lifecycle, authority, resource or physical-behavior rule. Selected
JSON/arithmetic/reference cases are separately probed; limitations are explicit.
No operational admission engine, codec execution, authentication or hardware
test is claimed. Windows relocation was exercised; Linux/macOS and a fresh
dependency installation were not. [E2, E4]

When the coordinating task is ready to import into
`target-repository-root`:

1. Inspect the destination for conflicts, then copy only the 43 staged files,
   preserving their relative layout and **including `.gitattributes`**. Do not
   blindly overwrite other tasks' files or copy Temp siblings.
2. Add the separately owned root README, main specification and first-party
   license. Put historical research in the separately inventoried archive;
   none of it is needed by these functional tools.
3. Run `python tools\validate.py` from the destination root. Preserve the W3C
   notices and pinned bytes. If canonical files are intentionally changed,
   review the changes, run `python tools\generate.py`, then validate again.

The release manifest deliberately covers this stage's owned files only; adding
the other tasks' root documentation/archive does not require folding unrelated
files into the generator. No commit, push or repository-creation command was
executed by this packaging task.

## Local evidence references

- [E1] `media-research\wot-portable-source-audit-64c41574.json:2-19` — exact meaning preservation, graph equivalence, copied bytes and bounded inventory.
- [E2] `media-research\wot-portable-validation-64c41574.json:2-92` — required offline command, runtime versions, categories, queries, admission stop and limits.
- [E3] `media-research\wot-portable-regeneration-64c41574.json:2-36` — byte-identical regeneration and different hash seeds/cwd.
- [E4] `media-research\wot-portable-relocation-64c41574.json:2-92` — full validation after relocation.
- [E5] `media-research\wot-portable-stale-pin-64c41574.json:2-17` — explicit nonzero stale-pin rejections without repair.
- [L1] `media-research\wot-portable-stage-64c41574\third_party\wot\manifest.json:2-110` — exact native source URLs, revision, checksums, license basis, notice transformations and schema mismatch.
