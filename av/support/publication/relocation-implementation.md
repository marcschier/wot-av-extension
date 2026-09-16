# Path-only relocation implementation

The 909-file baseline at `1a9216897254fb132ce55065287bcbdd933adf37` is accounted
for: 901 files moved individually with `Move-Item`; eight shared paths stayed.
The frozen [ledger](relocation-plan.json) is unchanged. The
[result](relocation-result.json) records original/result hashes and permitted
active transformations. The [locator](redirect-index.json) maps all original
coordinates to destinations and immutable original-commit links.

This phase did not copy specification drafts, introduce adapters, change
normative model semantics, or claim completion of either specification. No
files were staged or committed, and nothing was pushed or published.

## Restored behavior and preservation

| Gate | Result |
| --- | --- |
| Exact-only originals | All 290 unchanged, including 139 snapshot interiors, 93 historical research/provenance files, 50 live upstream files, native patches/attributes, NOTICE and native locks |
| AV | Full offline validation passed: 52 core tests, 63 SHACL cases, 49 authored oracle cases; seven classes and 29 AV properties remain |
| Canonical ONVIF | 305 outputs; all 304 non-manifest artifacts retain their semantics after normalizing only reviewed physical coordinates and their derived provenance digests |
| Reference runtime | All eight composed Node suites passed: 634 tests, zero failures or skips |
| Source authority | 43 vendored inputs verified; 41 source tests ran: 40 passed and the existing explicit-cache test skipped; all 53 source records and native import identities unchanged |
| Package | Real offline installation outside the checkout passed public API, declarations and CLI checks; exact original 528 logical paths; dependency version/resolution/integrity pins and public exports unchanged |
| Native definitions | All 43 original fingerprint inputs, including 23 relocated outside the native project, and all seven CTest definitions retained |
| Isolated tooling | All five relocated TypeScript test configurations type-checked; native Python entry points and certificate-helper syntax checked |
| Navigation | Active Markdown links checked separately from immutable historical interiors |

The runtime workspace is `onvif/samples/reference-runtime`; tests and fixtures
are under `onvif/tools`. Package staging deliberately preserves the 14 flat
aliases and distinct hierarchical canonical resources. Canonical manifest
`path` remains the logical artifact coordinate; `physicalPath` records its
repository location. The mapping rejects traversal and paths outside the
declared generated resources; relocation never makes the entire ONVIF tree a
generated-output deletion target.

AV and ONVIF tools use explicit repository/specification roots. Both reuse the
single live WoT bundle under `av/support/upstream/wot`. Ignored dependencies,
private files, SDKs and old build environments stayed at their legacy locations.
Historical files retain old filenames and commands as original evidence:
consult the locator, not archived tools, for current paths.

## Reproduction and remaining external gate

Use Python with the pinned `requirements-dev.txt` dependencies and Node
`>=20.19.0` on PATH. The implementation restored the missing SHACL dependency
only in an isolated system-Temp environment; no global installation occurred.
The npm workspace was repaired with offline, script-disabled installs, not a
destructive root `npm ci`.

```powershell
python -B av\tools\generate.py --check
python -B av\tools\validate.py
python -B av\tools\archive_v01.py --check
python -B onvif\tools\validate_onvif.py --suite unit --suite catalog
npm run test:onvif:all
python -B onvif\tools\pack_onvif.py --work-dir (Join-Path $env:TEMP ('onvif-relocation-proof-' + [guid]::NewGuid().ToString('N')))
python -B av\tools\relocatecheck.py --package
```

**Native execution is not newly qualified.** No SDK/source inputs were supplied
for a relocated native build, and no SDK was downloaded or old build/cache
traversed. All seven CTest cohorts and native Node composition remain an explicit
operator-provisioned qualification gate; preserving definitions is not passing
those tests. With approved SDK/source/archive inputs, use:

```powershell
.\onvif\tools\verify-onvif-native-ci.ps1 -AllowNative `
    -SdkRoot $SdkRoot -SourceRoot $SourceRoot -SdkArchive $SdkArchive `
    -NodeExecutable $NodeExecutable
```

Hardware, independent specification completion, standards publication and the
prepared adapter/specification drafts remain separate work. Active AV and ONVIF
publication inventories are resealed by their respective owners; immutable
historical manifests are not resealed.
