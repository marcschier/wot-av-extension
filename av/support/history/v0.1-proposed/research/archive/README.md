# Historical research archive

**Historical and superseded, not an alternative active release.** Start with
the [root README](../../readme.md), [current specification](../../spec.md), and
[active term inventory](../../vocabulary/terms.json). The coherent 43-file
portable bundle is unchanged. Its [release manifest](../../release-manifest.json)
covers 42 files and deliberately excludes itself, root documentation, and this
archive.

The [item index](index.md) lists each admitted historical edition and its status.
The [publication provenance manifest](../provenance.json) records root-relative
source labels, original sizes and SHA-256 fingerprints, actual destinations,
required transformations, new fingerprints, duplicate aliases, and notice
associations. It does not contain personal host roots or withheld-file details.

## Areas and status

| Area | Historical scope |
| --- | --- |
| [public-media](public-media/) | Independent public-source transport, result, and lifecycle research; illustrative data, not device evidence. |
| [public-xregistry](public-xregistry/) | Public-standard contract research and bounded compatibility adjudication, with restricted passages removed. |
| [superseded-wot-design](superseded-wot-design/) | Earlier vocabulary, discovery, reuse, lifecycle, and TD design notes. |
| [superseded-formal-v0.1](superseded-formal-v0.1/) | Earlier formal bundle, fixtures, generators, and snapshot-specific checks. |
| [superseded-codec-release-v0.1](superseded-codec-release-v0.1/) | Earlier codec release and original inventory edition; not the portable active serialization. |
| [superseded-final-session](superseded-final-session/) | Earlier catalogue, context, ontology, and query variants retained without replacing active files. |
| [superseded-main-specification](superseded-main-specification/) | Cleared historical specification edition; the current root specification remains independently rewritten. |
| [historical-worked-example-v0.1](historical-worked-example-v0.1/) | Original worked-example snapshots, with only approved host-path normalization where required. |
| [shacl-review](shacl-review/) | Snapshot-specific structural review, corrected shapes, and archival source rendering. |
| [portable-validation](portable-validation/) | Historical portable-stage, regeneration, relocation, and stale-pin evidence. |
| [packaging](packaging/) | Clearable packaging reports and explicitly identified publication-facing projections. |

## Reading historical evidence

`byte-exact` means the archived bytes equal the recorded source fingerprint.
`transformed` means only the cleared redactions, host-path normalization, or
link repairs were applied; consult provenance for both fingerprints. No historical
pass/fail result, measurement, pin, or generated dataset was resealed to describe
an edited report. Hashes inside historical reports and checksum sidecars identify
their original snapshots, not necessarily the normalized editions beside them.
Historical source-line coordinates refer to the original fingerprint, not to
renumbered public editions.

Logical roots such as `media-research`, `session-research`, and `task-outputs`
are provenance labels, not filesystem locations in this repository. Refer to
the manifest for actual admitted destinations. Runtime and unshipped-evidence
labels deliberately have no download target.

**Do not run archived scripts as active tools.** They were not executed during
publication. Their original sibling-file assumptions and historical dependencies
may require explicit reconstruction; the normalized SHACL review script is an
archival rendering, not a newly ported harness. Use only
[`tools/validate.py`](../../tools/validate.py) and
[`tools/generate.py --check`](../../tools/generate.py) for the active bundle.

Old packaging reports describe their own earlier state, including superseded
copy plans, pending clearance, or suggested licensing steps. Those statements
do not change the current publication allowlist or select a first-party license.
Public projections explicitly omit restricted/private-source details instead
of claiming to reproduce their raw control reports in full.

The worked Assignment remains **NOT ADMITTED**: qualification is unavailable
and the illustrative grant is expired at the fixed fixture evaluation time.
Recorded structural/query outcomes are not current device, codec, authorization,
native interoperability, or lifecycle proof. No real hardware was exercised.

## W3C notice association

The unchanged native [TD context](../../third_party/wot/td-context.jsonld) and
[TD schema](../../third_party/wot/td-schema.json) retain the complete
[upstream notice](../../third_party/wot/LICENSE.md),
[W3C license](../../third_party/wot/LICENSE-W3C-2023.txt),
[redistribution notice](../../third_party/wot/NOTICE-W3C.txt), and
[vendor manifest](../../third_party/wot/manifest.json).

The same **W3C-BUNDLE** expressly covers the embedded native context in
[`superseded-formal-v0.1/wot-av-formal-v0.1.fixtures.json`](superseded-formal-v0.1/wot-av-formal-v0.1.fixtures.json)
at JSON Pointer
`/documents/https:~1~1www.w3.org~12022~1wot~1td~1v1.1`.
The decoded UTF-8 payload has SHA-256
`9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069`.
It remains byte-exact; historical pins were not silently replaced. Duplicate
standalone payload aliases are recorded rather than copied without notices.

**No first-party reuse license has been selected.** W3C terms apply only to the
identified third-party material, not by implication to the original AV proposal,
research, documentation, or tooling.

## Withheld material and finite scope

Ten historical artifacts remain local and are not published: the nine original
permission holds and one additional report whose residual restricted citation
falls outside its approved edit coordinates. No broader clearance was assumed.
Withheld categories include private-source-dependent architecture/contract
analysis and mixed integration examples or findings. Their private contents,
source locators, and individual filenames are not enumerated here.

Unredacted originals, full inventory/clearance control reports, authentication
and operational-readiness information, and unreviewed operational tooling also
remain local. Virtual environments, bytecode, screenshots, unlicensed caches,
and unrelated temporary files are excluded. Private repository visibility does
not waive redistribution rights.

The packaging-source cutoff is **2026-09-14T14:52:31.979987+00:00**.
Only explicitly admitted pre-cutoff source reports are represented. The final
publication execution log stays outside the repository, avoiding a final-commit
hash cycle and keeping operational details local.
