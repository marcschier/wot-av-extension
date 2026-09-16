# Frozen specification relocation plan

**STEP 1 only.** [The complete ledger](relocation-plan.json) freezes the 909
original tracked files at commit
`1a9216897254fb132ce55065287bcbdd933adf37`. No original file has been moved,
rewritten, deleted, staged, or regenerated. This document and its JSON companion
are new supporting metadata, not members of that original snapshot.

## Integrity and inventory

The original tree contains **91,926,307 representation bytes**. Each entry records
its original path, Git mode/blob, byte count, SHA-256, independently matched
working-file hashes, immutable original GitHub locator, destination, classification,
initial owner/source role, normative-annex relationship, permitted future
transformations, reason, and validation gates.

| Classification | Original files |
| --- | ---: |
| Normative | 313: 5 AV and 308 ONVIF |
| Tools, tests and test fixtures | 147 |
| Illustrative examples | 17 |
| Executable samples/reference implementation | 109 |
| Supporting material | 31 |
| Historical archives/provenance | 234 |
| Live third-party sources/notices | 50 |
| Shared administration/workflows | 8 |
| **Total** | **909** |

The mapped destinations contain 285 original files under `av`, 616 under `onvif`,
and eight unchanged shared paths: `.gitattributes`, `.gitignore`, `package.json`,
`package-lock.json`, `publication-ownership.json`, `requirements-dev.txt`, and the
two existing `.github/workflows` files. There are zero unclassified records,
duplicate sources, duplicate destinations, Windows case-fold collisions, or
file/directory collisions. The other 901 original paths are only *planned* moves.

**Original-row SHA-256:** `fab18d6617ace69f70c7ae209ec539b2049d67d59849f6ad327e85fa4c8dc69f`.
This exactly reproduces the researched baseline: Git tree order, UTF-8/LF,
`originalPath<TAB>originalMode<TAB>gitBlob<TAB>bytes<TAB>sha256<LF>`.

**JSON SHA-256:** `f6a84a879a4dc196a3c8965ae0bc5848331a440f245311a143030ebc04248cd7`
over all **1,734,963 bytes**, including the final LF. JSON uses four-space
indentation, ASCII escapes, insertion-order keys, no BOM, and no embedded
self-digest. This external anchor does not include this Markdown file:

<!-- relocation-plan.json sha256: f6a84a879a4dc196a3c8965ae0bc5848331a440f245311a143030ebc04248cd7 -->

**Relocation-row SHA-256:** `cfc4a6edfcd9b1b2d150db95a55258192d1c6c96bf6ddf339627b5c1797af9bc`.
These TSV rows insert destination and classification after the original path.
The earlier proposed digest
`c41e291e0e7a0e08e7316ceb4ebe5a485dd0e8b90a790d808867c89d5ea1e92d`
is not asserted to match: this ledger uses the requested eight classification
tokens, combines the two normative categories, and records AV/ONVIF ownership
separately. The complete destination matrix and its family counts are checked;
the original-byte baseline remains identical.

## Exact-byte protection

| Protected family | Files |
| --- | ---: |
| `archive/v0.1-proposed` interior | 139 |
| Original snapshot index and manifest outside that interior | 2 |
| Historical research plus original research provenance | 93 |
| One live WoT bundle, including its notices and manifest | 6 |
| Live ONVIF bundle: 43 locked source/notice inputs plus README | 44 |
| Both native `.patch` files | 2 |
| Contextual native `.gitattributes` | 1 |
| Reference-runtime `NOTICE.md` | 1 |
| **Named protected groups** | **288** |

The two native dependency/source lock files also allow no content transformation,
making **290 exact-only entries**. All 909 original Git modes must be retained.
Historical interiors, upstream headers/notices, original coordinates, manifests
and digests are not rewritten or resealed. Active navigation/verifiers must adapt
externally. The admitted live third-party count is **50**, not 49; older copies
inside history remain history, not additional live bundles.

`classic-media-v2.patch` is exactly 17,793 bytes with 441 CRLF sequences and no
bare CR/LF bytes. Its SHA-256 is
`83a7f897984d223fa907c984dfb854488064b78ba3bedff0bdab383e8af3c0b9`;
its Git blob is `3486ef71ae058372085db461fd747dd8e7669138`.
Move the native project `.gitattributes` unchanged with the project: its
`patches/classic-media-v2.patch -text !eol` rule remains correctly contextual at
the new location. Do not normalize the tracked patch.

## Migration rules and authority

1. Consume the explicit 909-entry map, not rename similarity, broad directory
   moves, or a fresh recursive inventory. Existing safe parent directories are
   allowed; existing destination files are not overwritten. Stop on conflicting
   source/index/HEAD changes or unexpected untracked files. Leave ignored
   `local-only`, environments, dependencies, SDK/source caches and build outputs
   at their legacy locations; do not inspect their contents. Retain both new
   relocation metadata files in place, outside the original-file move loop.
2. Preserve old `readme.md` as `av/support/repository-overview.md`; a new root
   navigator is a later addition. Old `spec.md` becomes `av/spec.md`. Preserve
   the 17 old ONVIF documents as 14 notes and three reports; `onvif/spec.md` is
   separately authored later. Keep all 94 research files under
   `av/support/research`; ONVIF support navigation cross-links without duplication.
3. Treat `plannedAuthority.annexes` and each entry's source role as initial
   placement/ownership declarations, not semantic changes. AV's authored
   `terms.json` owns its generated projections and complete supporting term
   reference. Retain ONVIF vocabulary, payload/Form/requirement schemas, catalog,
   requirements and model indexes with their stated limited roles. In particular,
   the snapshot schema describes a reference-projection DTO, not a required
   adapter wire format. Supporting references/reports and generator/runtime code
   do not replace independent root-specification prose.
4. Preserve 285 existing TMs and seven separate client-requirement manifests,
   including their base/operation, event, service, resource, feature and profile
   families. Filesystem relocation does not rename namespaces, IRIs, TM identities
   or imports, schema identifiers, native URLs, source `relativePath`, or package
   exports. Abstract/native model separation and semantic changes need a later,
   explicitly versioned review.
5. Use `packageStaging.physicalArtifactSources` to resolve each
   `logicalArtifactPath`. The 309 physical artifact sources retain 305 canonical
   outputs, 14 flat aliases and their distinct staging coordinates. For example,
   physical `onvif/catalog.json` still supplies both `dist/catalog-data/catalog.json`
   and `dist/catalog-data/generated/catalog.json`; the two manifests likewise
   remain distinct. The planned package path set has 526 `dist` paths plus
   package metadata/NOTICE, with zero collisions. No package was built or staged.
6. Preserve exact fixture exceptions and the split between sample code and
   tools. Node tests retain 67 source/config files and 29 fixtures; 27 fixture
   paths lose exactly one `fixtures` component and the two `native-fixture.cjs`
   files retain their suite directories. Native placement is 24 implementation/
   build files, four tools, 11 tests/helpers and eight fixtures. The explicit
   `nativeCohort.sourceMap` retains all **43** fingerprint inputs, including 23
   outside the new native project root, and all seven CTest targets. Preserve
   original fingerprint keys; later reviewed source edits change hashes, not
   membership silently.
7. A later move starts with exact bytes. Only individually reviewed active
   path/ownership transformations listed on an entry are permitted afterward;
   record resulting hashes and applicable gates separately without changing this
   baseline. Do not run generators, stale-output cleanup, package staging, native
   provisioning, or publication as part of the freeze.

The current working tree remains the behavior baseline. AV semantic gaps,
ONVIF editorial/requirement closure, independent normative consolidation,
abstract models, executable UVC/Aravis semantic adapters and generated HTML are
later work, not outcomes of this ledger. No SOAP facade, camera access, hardware
qualification, profile certification, distribution, commit or remote push is
implied.

## Reproducibility

The deterministic Python freeze tool is deliberately retained only in session
storage. Its `--self-test` mode checks mapping/fixture exceptions, unsafe paths,
case-fold/file-directory collisions, logical staging separation and serialization.
`--inspect` writes nothing; `--write` exclusively creates the new JSON and refuses
existing outputs; `--check` reconstructs it from raw Git blobs and working files
and checks this external digest anchor. It never moves originals, invokes project
generators, reads ignored content, or changes the index.

Existing inventories independently matched their frozen member hashes: AV release
55, ONVIF release 275, canonical generation 304 plus its manifest, historical
snapshot 139, all 43 vendored ONVIF records and the five WoT payload/notice records
plus their manifest. Post-move behavioral and publication gates are recorded in
the JSON as future gates, not claimed to have run here.
