# ONVIF local packaging and CI

**Private local delivery only.** `@wot-av/binding-onvif` remains
`private: true`, version `0.1.0-dev.0`, with no first-party license assigned.
None of these commands stages, commits, pushes, publishes to npm, deploys a
website, downloads a native SDK, or contacts a real device. Do not substitute
registry publication for the local `npm pack` step.

## Existing tools and dependency boundary

The package requires Node >=20.19; the locally exercised CI/reference setup
uses VS-bundled Node 24.12.0/npm 11.6.4. The hosted workflow selects Node 24 and
Python 3.13. Use the existing lock and installed dependencies; do not remove a
shared checkout's dependency tree to test packaging.

```powershell
$env:PATH = 'C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs;C:\Program Files\Git\usr\bin;' + $env:PATH
node --version
npm --version
npm run build:onvif
```

On a new CI checkout with missing dependencies, use
`npm ci --ignore-scripts --no-audit --no-fund` and
`python -m pip install --disable-pip-version-check -r requirements-dev.txt`.
For a local missing Python dependency, use an explicitly named Temp virtual
environment rather than changing global Python. No global Node/npm installation,
audit or native postinstall is required.

## A real pack and independent installation

The package's `prepack` compiles current source, stages the existing canonical
bytes, and verifies their hashes before copying the full public artifact set
and allowed source/notice closure. It does **not** regenerate the canonical
catalog. Repacking is a source-checkout operation, not an install lifecycle hook.

For just the tarball, create a new explicit output directory first:

```powershell
$pack = Join-Path $env:TEMP 'onvif-local-tarball'
New-Item -ItemType Directory -Path $pack -ErrorAction Stop
npm run pack:onvif -- --pack-destination $pack
```

For the complete installed-package proof, the work directory must not already
exist and must be below system Temp, outside the checkout:

```powershell
python -B onvif\tools\pack_onvif.py `
  --work-dir (Join-Path $env:TEMP 'onvif-isolated-package-proof')
```

The proof executes real `npm pack`, seeds a separate dependency lock from the
workspace's exact resolved versions/integrities, reconciles it without lifecycle
scripts, and performs `npm ci` into a fresh installation. It rejects dependency
pin changes. It defaults to npm's offline cache; if an actual cache-miss failure
occurs, a new work directory plus explicit `--allow-registry` permits npm to
download the same integrity-pinned dependencies. This flag does not fetch ONVIF
XML, SDKs or device content.

The copied smoke module executes in a separate Node process with its own CWD,
without inherited `NODE_PATH`, `NODE_OPTIONS`, repository imports, test loaders,
or repository runtime helpers. It uses public package exports only:

- Hash-checks all canonical files, loads the generated registry and mapping
  references, resolves model imports, and runs the pure projector.
- Uses real node-wot `ConsumedThing`, lower-level native execution and a native
  Action. An independent HTTPS/SOAP fixture returns fresh DeviceInformation,
  different from the projection's old inspection value.
- Publishes/retrieves/lists/deletes the projected TD through a separately scoped,
  authenticated loopback Directory fixture with actual resource ETags.
- Consumes the packed Event template; observes native Create/Pull/Unsubscribe,
  preserved EPR parameters and lexical notification data, and awaits closure.
- Loads public media/discovery APIs without launching the native worker, compiles
  a strict TypeScript consumer, and invokes npm's actual `onvif-bridge` bin shim
  for help, offline inspection and complete file-only model export.

OpenSSL generates ephemeral server/client certificates. Verification remains
enabled, credentials stay out of TDs and command arguments, and all listeners
bind to `127.0.0.1`. Public evidence contains no private keys, bearer tokens or
SOAP credential traces. The fixture does not scan interfaces or contact devices.
The CLI export uses an empty inventory deliberately: it proves packaged model
delivery and file-only operation, not discovery or hosted model reachability.

The pack proof is **not** the bridge's separate projected-logical-EPR regression:
its direct Event TD uses its original endpoint identity, and its Directory Action
uses its native Form without an extra logical-To override. It neither skips nor
weakens the bridge test. Continuous loopback CI still runs that integration suite.

The named work directory retains the tarball, separate package/lock, command
logs, tarball allowlist/hash audit, installed proof and result JSON. Ephemeral
keys are always removed. By default, only the proof's explicitly owned
`install\node_modules`, `install\cli-models` and `install\cli-things` directories
are removed afterward. `--keep-install` retains those directories for inspection.
The checkout, system Temp root and other sessions are never cleanup targets.

## Included artifacts and licensing

The current canonical manifest contains **596 artifacts including itself**:
285 native Thing Models, 286 abstract Thing Models and seven separate
client-requirement manifests, plus catalogs, schemas, vocabulary and evidence.
The packager and installed proof derive exact membership from that manifest;
the historical 305-artifact / 528-package-path counts are not current ceilings.
The package
also retains the flat integrity-checked runtime assets, complete mapping
reference, schema/vocabulary/model paths, generated declarations, source lock
and package build-input provenance. The registry contains 579 structurally
compiled operations across the seven A/C/D/G/M/S/T source profiles. Compilation
is not all-operation, profile, device or client conformance.

The installed proof also checks the four additive public mapping/binding/topic/
translation aliases, public semantic-adapter declarations, canonical typed
outputs and rejection of false full-profile claims. CLI model export is
compared with the exact installed model library and its owned file manifest,
not a minimum historical file count. No sibling source workspace is required.

`@wot-av/binding-onvif/artifacts/*` resolves package-local canonical paths, for
example `generated/mapping-reference.json` and
`models/events/PullPointSubscription.tm.json`.
`@wot-av/binding-onvif/package-provenance.json` records the copied hashes and
authored build inputs. `@wot-av/binding-onvif/source-documents/*` contains the
unchanged vendored document/notice closure. Runtime loading does not fall back
to a checkout's `bindings` directory.

Prepack rejects unowned files or symlinks in `dist` before a tarball can be
created; stale output is an explicit error, not silently deleted. The independent
tarball allowlist also rejects extra files and requires every compiled
JavaScript/declaration, canonical artifact and source notice. Tests, fixtures,
source-private native patches, native binaries, SDK caches, credential files,
session logs, reference-only PDFs and restricted fetch-only XML are not included.
The 53-record original source lock remains byte-identical: **43 vendored
documents/notices**, seven reference-only PDFs, three restricted fetch-only XMLs.

The package's `NOTICE.md`, source policy, original W3C notices and embedded
ONVIF/OASIS notices identify the normative source ownership and attribution,
including W3C XML/XOP documents without embedded notices. The ONVIF Contributor
License Agreement is not a blanket Apache grant for specifications. Unchanged
source-copy permission does not clear generated derivatives, patents, branding,
profile symbols or certification. First-party licensing remains an owner decision.

**The native patch and binary bundle are not distribution-approved.** Native
execution additionally requires operator-provisioned SDKs, the pinned pristine
source cache, private patch/API review, corresponding-source/relinking compliance,
plugin/codec licensing and patent review. x265 is GPL test-only, not a runtime
bundle addition. npm never downloads or includes a worker, SDK or codec binary.

## Generation ownership and local CI commands

`publication-ownership.json` separates the original eight AV generator outputs
from the ONVIF canonical manifest and newly authored library/native/build inputs.
`onvif\tools\generate_onvif.py` writes only `onvif/support/publication/release-manifest.json`; it hashes
authored TS/C/TOML/XML/CMake/package/workflow inputs and references the canonical
manifest rather than rehashing the historical archive or duplicating its entries.
The AV generator excludes ONVIF-owned documents/tests from its thin-core input
selection. This is a domain boundary, not an aliasing of ONVIF terms into AV.

```powershell
npm run verify:onvif:sources
npm run generate:onvif -- --check
python -B onvif\tools\generate_onvif.py
python -B onvif\tools\generate_onvif.py --check
python -B onvif\tools\validate_onvif.py --suite unit --suite catalog
npm run test:onvif:ci:loopback
```

Source verification selects `--scope vendored` explicitly. It does not require
the three fetch-only legacy XMLs and never fetches them to obtain a green check.
Canonical `--check` compares generated bytes offline; it may refresh ignored
package staging, but does not rewrite the authored canonical tree.
`validate_onvif.py` is a subprocess composition wrapper: it does not import the
legacy Python validator and its process-wide network audit hook. Wire suites
selected through the wrapper require explicit `--allow-loopback`; for example:

```powershell
python -B onvif\tools\validate_onvif.py --allow-loopback --suite events --suite integration
```

The continuous workflow has separate AV, ONVIF offline/unit/catalog, and ONVIF
loopback/package jobs. The loopback selection includes binding-gate, events,
discovery, publication, media-unit and integration tests without skipping the
bridge regression. It does not imply native-worker qualification.

Keep the existing full AV baseline commands:

```powershell
python -B av\tools\generate.py --check
python -B av\tools\validate.py
```

Shared documentation/provenance edits legitimately make release hashes stale.
After all owners finish, the coordinator must deliberately run AV generation,
then ONVIF publication inventory generation, and rerun both checks and the full
Node suite. ONVIF packaging does not rewrite the eight AV outputs to conceal a
stale baseline. Archive, W3C vendor sources, research and local-only remain intact.

## Explicit native CI, not an automatic full-pipeline guarantee

`native-local-verification.yml` is **workflow_dispatch only** and requires
`allow_native=true`, a reviewed ref, an operator-approved environment and a
self-hosted Windows x64 runner with label
`onvif-msvc-2026-gstreamer-1-28-7`. Provision the locally qualified VS 2026/MSVC
19.51 x64 tools, CMake >=3.28, Ninja >=1.11, Python >=3.11, existing VS-bundled
Node 24, GStreamer 1.28.7 SDK and the 28 pinned pristine upstream files.
The standard hosted `windows-latest` VS 2022 image is not claimed equivalent to
that native reference environment.

Dispatch inputs are absolute existing `sdk_root`, `source_root`, `sdk_archive`
and `node_executable` paths. Before native execution the helper verifies the
cached official archive against the locked SHA-256; the native prepare/cohort
tools verify pristine source pins and record actual SDK/binary identities.
The archive is not executed, downloaded or used to silently provision an SDK.
The operator is responsible for the already extracted SDK's provenance and
local license permission.

The exact reusable workflow command is:

```powershell
.\onvif\tools\verify-onvif-native-ci.ps1 -AllowNative `
  -SdkRoot $SdkRoot -SourceRoot $SourceRoot -SdkArchive $SdkArchive `
  -NodeExecutable $NodeExecutable
```

It configures/builds in the separately owned `onvif\samples\reference-runtime\native-media\build-package-ci`,
runs all seven CTest targets through the fresh-cohort gate, then executes the
actual Node/native media integration suite. It makes no real-device calls,
global environment changes, installer calls or artifact uploads. Do not upload
SDK/codec binaries, raw native traces, credentials or private fixture keys.

All workflows have read-only repository permissions, no required secrets and no
publication steps; checkout credentials are not persisted. Standard versioned
GitHub Actions are used because this repository had no existing SHA-pin policy.
Local execution of these commands is evidence for those commands, **not** proof
that a GitHub-hosted or operator self-hosted workflow has run. The optional native
dispatch cannot be described as continuously observed full native coverage.
