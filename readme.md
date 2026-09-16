# WoT AV and ONVIF

Two independent technical drafts share this workspace. Markdown is authoritative;
HTML is generated, not a separately edited specification.

| Specification | Authoritative draft | Generated reading view | Examples, implementations and support |
| --- | --- | --- | --- |
| AV: media descriptions, input requirements and native Form selection | [AV specification](av/spec.md) | [AV HTML](av/index.html) | [AV navigation](av/readme.md) |
| ONVIF: native bindings, canonical models and semantic camera adapters | [ONVIF specification](onvif/spec.md) | [ONVIF HTML](onvif/index.html) | [ONVIF navigation](onvif/readme.md) |

## Shared commands and interfaces

Use provisioned Python dependencies from `requirements-dev.txt`, Node 24.12.0
and the explicitly qualified browser for publication. There is no implicit
browser, SDK or OS-service installation. See the
[publication tool contract](av/tools/publication/README.md).

| Command | Local scope |
| --- | --- |
| `npm run build:specs` | Generate canonical inputs/examples, both HTML drafts and publication inventories |
| `npm run check:specs` | Check generators and compare both publications with two fresh renders |
| `npm run test:specs` | Shared publication tests |
| `python -B av\tools\validate.py` | AV reference conformance, examples and source/document integrity |
| `npm run test:onvif:all` | ONVIF reference-runtime suites, including owned loopback fixtures |
| `npm run test:onvif:package -- --work-dir <new-system-temp-directory>` | Independent private installed-package proof |
| `npm run build:adapters:windows` / `npm run test:adapters` | Windows MF/WIC build and software-only camera qualification |
| `npm run test:adapters:portable` | Platform-independent capture-contract cases; not Linux/native qualification |
| `npm run build:adapters:linux` | Linux-only build on an explicitly provisioned runner; not run by Windows qualification |
| `npm run test:adapters:linux` | Complete offline Linux software matrix on an approved runner; missing prerequisites fail |
| `npm run test:adapters:definitions` | Host-portable Linux definition/framing/source-policy checks; no Linux execution |
| `npm run check:integration` | Frozen originals, registered transformations, current package and publication inventories |

The three explicit workspaces are the ONVIF reference runtime, shared
publication tooling and camera adapters. Native ONVIF Forms and form-free
abstract semantics are distinct interfaces. Adapter fragment support establishes
neither native ONVIF protocol support nor full-profile or product conformance.
Unavailable native backends fail explicitly. The 2026-09-16
[Linux software qualification](onvif/tools/adapters/linux/README.md) passed all
six native cohorts against Aravis 0.8.36; the
[relocated ONVIF/GStreamer qualification](onvif/support/reports/native-relocated-qualification.md)
passed all seven CTest targets and 23 Node/native cases. These are synthetic
software results, not physical-camera or deployment qualification. No shared
command starts Docker, WSL or OS services to satisfy missing prerequisites.

## Preservation and release status

The [frozen original-file ledger](av/support/publication/relocation-plan.md)
and [historical relocation evidence](av/support/publication/relocation-implementation.md)
remain separate from the [current integration record](av/support/publication/integration.md).
Historical paths and counts describe their recorded phase, not current package
ceilings. Protected history, research, source notices and vendor bytes are not
regenerated.

These are independent drafts, not W3C or ONVIF standards publications.
The [AV image-raster technical disposition](av/support/migration/dimensions-technical-disposition.md)
is selected for this local edition, including explicit legacy migration.
Named external editorial/domain review, editor identity, first-party licensing,
namespace hosting and release authorization remain unapproved. Existing source
notices remain applicable; no new license or publication permission is granted.
