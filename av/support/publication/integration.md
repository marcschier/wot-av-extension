# Coordinated specification integration

This is the current local integration record, not a release approval.
The [909-entry original ledger](relocation-plan.json) and the
[path-only result](relocation-result.json) remain frozen historical evidence.
Their original hashes and the original 528-path package inventory are not
rewritten to describe the later specification edition.

## Preservation and explicit transformations

The [transformation register](transformation-register.json) lists each changed
original separately: original path, current path, reason, authoritative change
record and the applicable byte/token constraint. The checker rejects
unregistered transformations, missing originals, destination collisions,
changed protected bytes and unknown new-file classifications. The
[current result](integration-result.json) partitions retained originals and
new core, example, sample, tool, support and administrative files. Counts are
derived from actual nonignored files and the current canonical manifest.

The original Git modes and blobs remain the preservation baseline. After a
committed integration, an explicit evolution record identifies that commit and
its exact tree as the current unstaged-work index baseline; it does not replace
the original ledger. All 290 exact-only
files, including the 139-file v0.1 snapshot, vendor/notice bytes and protected
native patches, retain their original checks. Historical semantic equivalence
is distinct from physical preservation: `relocatecheck.py --path-only` retains
the old strict comparison and is not expected to accept the evolved draft.
The normal check audits the explicitly recorded evolution instead.

## AV processing edition

The [30 AV decisions](../migration/specification-clarifications.md) authorize
the documented processing corrections and generated complete references.
They are not an assertion that these changes are merely path substitutions.
AV 0.2 namespace/context identities and the thin model remain unchanged.
The [AV-D09 image-raster technical disposition](../migration/dimensions-technical-disposition.md)
now selects the active image grid and explicit legacy-description migration
for this local edition. It does not assert that incompatible deployed
display-size meanings are equivalent. Named external editorial/domain review
remains unapproved; the root specification retains that formal-release gate.

## ONVIF model edition

The [33 ONVIF decisions](../../../onvif/support/editorial/standards-decisions.json)
and [model translation](../../../onvif/model-translation.json) own the native /
abstract separation, normalized requirement interpretations and complete
machine annexes. Original native model IDs and source authority are preserved.
New abstract 0.2 identities are additive. Client-requirement manifests are not
Thing Models. The current manifest, not a historical artifact count, controls
physical mapping and package admission.

## ONVIF class names and documentation excerpts

The [17 September 2026 vocabulary revision](../../../onvif/support/editorial/standards-decisions.json#/vocabularyRevision)
is based on committed integration `94ffdde1d2aa8a2bd30adb0cbe284bcf4cfeaab3`.
It intentionally removes the `Thing` suffix from 18 proposal class IRIs and
labels, naming the native-contract classification `NativeContract`, while
preserving their meanings, native operation identities and
existing model document IDs/filenames. This is not a path-only change or an
assertion that old class IRIs remain valid aliases. Dependent models and TDs
must be regenerated from the current inventory.

The same revision replaces isolated vocabulary annotation snippets with
source-bound TD/TM excerpts. Only explicitly marked JSONC fences permit
standalone `// ...` omission comments. Their visible paths, values, context and
omission markers are checked against complete informative examples. Native XML,
payload records, normative format grammar and ordinary JSON remain strict.

The transformation register retains prior original byte/token constraints,
records the new per-original reason and authority, and additionally constrains
each current edit by its committed input hash and exact resulting bytes.
Only the specifically owned generated publication outputs are resealed by
their existing generators. Neither the 909-original ledger, the 290 protected
representations, the frozen implementer oracle nor dated qualification evidence
is rehashed into a new historical claim. This revision requires no new native
SDK or hardware qualification.

## Shared workspace and publication

Root navigation exposes only the two specifications and shared administration.
The reference runtime, publication tool and camera adapters are explicit
workspaces. Existing dependency versions, resolutions and integrity fields are
retained, including the separately provisioned publication dependencies.
Four-space formatting changes whitespace only and preserves numeric/string
tokens; upstream, historical and private trees are excluded.
The shared documentation checker resolves literal excerpts from their original
Markdown file, with the publication configuration's finite AV legacy alias
table. This fixes the reproducible attempt to read a nonexistent root
`example.json` for the publication fixture. That fixture now retains a checked,
token-exact literal block; neither missing paths nor stale literals are waived.

Root adapter commands distinguish portable contract checks, Windows MF/WIC
software execution and a separately provisioned Linux build. The Linux alias
rejects Windows before invoking any shell, so it cannot start WSL as a fallback.
The separate definition tests exercise only host-portable fixtures. Publication
ownership includes native C/C++ headers/sources, shell/Node tools, sample
applications and examples, while excluding ignored build/cache trees.
No compiled native binary or SDK becomes a distributable artifact. The owned
native prerequisite `.cache` is explicitly excluded from recursive delivery
inventory discovery, independently of Git ignore rules. The scoped ignore,
provisioning readme and native qualification report/provenance are inventoried;
the SDK, fetched source copies, native build and qualification logs are not.
Synthetic JPEGs retained by the independent implementer exercise are explicit
test-data inputs, not camera evidence, executable binaries or package payloads;
inventorying them grants no distribution or license permission.

`build:specs` prepares AV, compiles/generates ONVIF canonical artifacts, generates
source-bound ONVIF examples and annexes, renders both roots, then reseals ONVIF
delivery metadata followed by AV metadata. The canonical check may update only
its explicitly ignored staging tree. Fresh-process HTML checks do not silently
qualify another browser. The current integration result is not hashed as one
of its own publication inputs.

## Installed-package verification

The independent package proof derives its exact tarball allowlist from the
canonical/flat manifests, compiled source inventory and provenance. It checks
all current artifacts and new public aliases, native and abstract model IDs,
client manifests, public declarations, typed semantic-adapter output and
rejection of false full-profile claims. Runtime imports must resolve entirely
inside an unrelated installation, without inherited `NODE_PATH`, source-tree
imports or an old sibling workspace.

CLI export is checked against the actual installed library and its owned
manifest, not a fixed historical count. Temporary certificates are generated
only for owned loopback fixtures and removed by that proof.

## Contextual binding-schema correction

The independent exercise reproduced `IMPL-GAP-01`: the generated binding schema
required ONVIF canonical annotations on an ordinary Action's `input` even when
that Action did not declare ONVIF semantics. This contradicted the root
specification's canonical-root scope. The generator now applies those required
annotations to identified canonical Actions and annotated canonical data roots,
while permitting ordinary Actions in the same Thing. Native Form markers,
canonical source metadata and mapping-support markers still require complete
canonical input/output annotations. Positive mixed-Action and missing-annotation
negative controls are part of the independent public-artifact validator.
No normative prose, namespace, term meaning or runtime codec was changed.

## Qualification and release boundaries

The required local checks cover AV reference processing, complete ONVIF Node
suites, source integrity, independent installation, publication rendering,
Windows MF-memory/WIC HTTP capture, portable C++ and API declarations.
Their command results belong in the coordinator's dated execution report;
this change record does not infer success from an earlier owner's report.

The separate [relocated ONVIF/GStreamer qualification](../../../onvif/support/reports/native-relocated-qualification.md)
actually compiled and executed all seven CTest targets, containing 146 fixture
scenarios and 15 named C unit checks, and all 23 Node/native cases on
2026-09-16. Its [provenance](../../../onvif/support/reports/native-relocated-provenance.json)
binds the results to the current 43 native inputs, 22 measured binaries and
182 selected SDK inputs. The two fetch-tool transformations permit only owned
`qualification-*` direct children of the tool's ignored `.cache`, while
retaining the original TEMP mode, ownership marker, exact source/archive pins
and portable development flags. Their current reviewed hashes are registered
as integration changes, not merely path substitutions.

The separate [Linux software qualification](../../../onvif/tools/adapters/linux/README.md)
actually compiled and linked the unchanged native sources on Ubuntu 24.04.5
with GNU C++ 13.3.0 and pinned Aravis 0.8.36. The final full build passed all
six CTest cohorts, with zero failures/skips. Explicit V4L2-only and SDK
USB-disabled variants passed their four and six applicable cohorts. Real SDK
Fake and simulated V4L2 results are not physical camera/driver or GigE/USB
transport execution. The owned VM was shut down and ephemeral access material
removed; this integration starts no VM, distro, Docker/WSL, service, SDK
provisioner or hardware operation.

These dated follow-ups close the earlier missing Linux/native-SDK software
gates without rewriting their failed, skipped or unexecuted historical
records. All physical V4L2/UVC, GigE and USB3 Vision hardware, Linux Node/HTTP
deployment and hardware timing/cleanup qualification remain unverified.
Stock Aravis USB's unknown interface-release limitation remains unchanged.

Reference checks are not full ONVIF-profile, W3C, accessibility or production
certification. Named editorial review, first-party/source-derivative rights,
editor identity, namespace hosting and release authorization remain unapproved.
No staging, commit, push, external publication or license change is part of
this integration.
