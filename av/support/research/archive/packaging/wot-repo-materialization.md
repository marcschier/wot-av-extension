# WoT AV local repository materialization

**Local import and standalone checks complete; no staging, commit, or publication.**
The target repository is `marcschier/wot-av-extension`. Copyright/redistribution
clearance remains a separate decision. All historical material is retained only
under ignored `local-only\research-archive`; no first-party root license was added.

| Result | Observed count/status |
| --- | --- |
| Coherent active portable bundle | 43 files, 647,364 bytes; byte-exact |
| Original authored history | 92 files, 2,724,289 bytes; byte-exact local archive |
| Standalone W3C duplicates | Four aliases recorded; only staged licensed native bundle copied |
| Finite inventory coverage | All 139 non-runtime rows and all 132 original proposed destinations accounted for |
| Runtime/environment files | 1,274 excluded without copying |
| Archive including index and packaging evidence | 102 files |
| Files materialized by this task | 146 (excludes separately owned root docs and `.git`) |
| `python tools\validate.py` from target root | Exit 0; 867 checks; offline; no artifact writes |
| `python tools\generate.py --check` from target root | Exit 0; all eight generated artifacts current; no resealing |
| Git blob normalization | All 43 release files: filtered blob OID equals raw-byte blob OID |
| Root `.gitattributes` | Original `* -text` bytes retained; no EOL/encoding/filter/ident conversion |
| Required `.gitignore` coverage | `.venv/`, `__pycache__/`, `*.pyc`, `/local-only/` |
| Git index | Unchanged; zero tracked/staged entries |

The exact source-root-relative input name, original SHA-256/size, target,
target SHA-256/size, original inventory proposal, and actual disposition are in
`wot-repo-materialization.json`. The separate `.sha256` file anchors the final
JSON and this report; neither embeds its own hash. No recursive target scan is
used as an import source. Original inventory files are retained as immutable
historical proposals, not silently rewritten execution records.

The active release-manifest SHA-256 remains `e579fd514d58d1ec9a084c9d5156dced82279a119cce3c44bdef5f553072f92d`.
Its 42 entries exclude itself, root `readme.md`, root `spec.md`, `.gitignore`,
and all local history. The original final-session variants are archived rather
than replacing the deliberate normalized/resealed stage. No portability code
change or regeneration was needed. The existing isolated interpreter named
in the original portable-stage report was reused; no packages were installed.

Historical namespace choices, rule sets, synthetic results, and hashes remain
snapshot-specific. The worked Assignment is still **NOT ADMITTED**. Fixture
checks do not establish device operation, authenticated authority, grants,
codec qualification, runtime conformance, or real media behavior.

The local archive index documents the copyright gate, host-path normalization
needed for any future cleared publication derivative, and retention of original
fingerprints. Private ACF-derived reports were not copied into publication
paths. The W3C native payloads retain the stage's full license/notice/provenance
bundle; that license is not assigned to first-party work.

The root documentation belongs to another task and was neither copied nor
edited here. `.git` was preserved. No authentication/identity output, personal
Git email, screenshots, binary/runtime trees, unrelated temporary files, remote
repository actions, `git add`, commit, or push are part of this materialization.
