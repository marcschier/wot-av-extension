# Public document staging

The source repository is **public**. Its GitHub Pages artifact is deliberately
smaller than the repository. `site-policy.json` authorizes a public documentation
audience, not formal W3C or ONVIF publication, a first-party license assignment,
an SDK or binary distribution, or a GitHub Release.

The site retains the independent-draft, unassigned-editor, and no-new-rights
notices. The existing formal publication flags remain false. Those false flags
are displayed rather than treated as a prohibition on the separately authorized
documentation website. There is no `--release` option or bypass.

## Commands

Python's standard library, Git, and the publication policy's qualified Node
runtime suffice. The stager performs no npm install, browser launch, canonical
generation, remote fetch, Git index write, commit, or push.

From the repository root on Windows:

```powershell
python -B .\av\tools\publication\stage-site.py prepare `
    --base-path /wot-av-extension/ --output "$env:TEMP\wot-pages-new"
python -B .\av\tools\publication\stage-site.py check `
    --site "$env:TEMP\wot-pages-new"
python -B .\av\tools\publication\stage-site.py verify-archive `
    --archive "$env:TEMP\artifact.tar" --site "$env:TEMP\wot-pages-new"
```

Use the equivalent slash-separated script path on a Linux runner. `prepare`
accepts `--expected-commit SHA`, `--node EXECUTABLE`, and `--preview`.
`check` and `verify-archive` also accept `--node`. If Node is absent from PATH
on Windows, the qualified executable in the existing publication policy is
used; `--node` can explicitly select it. Executables and arguments are passed
as separate subprocess arguments, never interpolated into shell commands.

The output must be a **new directory**, outside the repository and outside its
ancestors. Its parent must already exist. Existing directories, even empty
ones, are not reused or recursively wiped. Failed staging is an error, not an
uploadable result; any partially written owned directory remains for inspection.

### Committed mode and preview

Normal `prepare` requires a real Git HEAD and, when supplied, agreement with
both `--expected-commit` and `GITHUB_SHA`. Every selected source, controlling
policy/tool, supporting-source target, and certified generator/proof input must
be tracked and byte-identical to HEAD and the index. The check hashes raw Git
blob representations rather than trusting `git diff` or assume-unchanged bits.
Ignored unrelated caches are not copied.

Before accepting the recorded publication hashes, the stager executes the real,
read-only `av/tools/publication/check-committed.mjs`. Its JSON response must say
`status: verified`, `assurance: committed-generation-consistency`, and
`browserInvoked: false`, with the matching `sourceSealDigest`. The two publication
manifests and the producer source-input seal are read before that call and
checked again afterwards. Selected file bytes must match their verified records;
canonical artifact bytes additionally match the original model manifest.

The checker is not a renderer, and the stager never recreates a missing seal.
If generation inputs changed, the owning producer must regenerate and reseal
after all related edits settle. Run the checker directly for its detailed local
diagnostic when the stager reports `SOURCE_CHECK`.

Use `prepare ... --preview` for an explicitly uncommitted working-tree snapshot.
Preview still needs a successful real source checker and valid current recorded
hashes; it is not a freshness bypass. Its public manifest and landing page say
`preview-uncommitted`, record the actual HEAD, and bind the selected source bytes
with a separate snapshot digest. Supporting-source URLs still identify that
real commit, not unpublished worktree edits. Both the archive verifier and public
smoke verifier reject preview provenance. No zero or fabricated SHA represents
a committed deployment.

Independent unit fixtures inject immutable, precomputed `SourceCertificate`
records through the Python function dependency, using their own temporary Git
repositories. There is no certificate injection, skip-check, or test-origin
switch in the production CLI.

## Exact inclusion policy

`site-files.json` has a small explicit source-to-output list and an independently
locked canonical inventory:

* Copy the two generated specification HTML files, the four AV normative
  artifacts, the original ONVIF model manifest, and four selected complete
  example files.
* Read ONVIF `artifacts[].role`, `physicalPath`, `logicalId`, declared byte length,
  digest, and dependencies from the model manifest. Admit the reviewed
  thing-model, client-requirement-manifest, normative-catalog, normative-schema,
  and normative-vocabulary records.
* Require the exact SHA-256 membership fingerprint in `site-files.json`.
  It covers the sorted path/role/identity records, independently of artifact
  contents. Adding, removing, renaming, or reclassifying an artifact requires
  an explicit inventory review. Changing generated bytes alone does not change
  this membership fingerprint. Counts and byte totals are derived, not fixed
  to a historical 605-file measurement.
* Omit the specifically identified informative coverage artifact. Its entry
  stays in the byte-exact canonical manifest; `artifact-map.json` explicitly
  marks the omission without advertising a nonexistent download.

`packageAssets`, directory globs, filenames ending in `Thing`, and transitive
repository hyperlinks do not authorize additional files. The explicit event
model path and native/abstract physical paths are retained. Unselected
implementation source, READMEs, reports, inventories, input seals, tests, history,
SDKs, caches, VM images, original upstream XML, fetch-only legacy XML, and
reference-only profile PDFs do not enter the payload.

The stager generates exactly `index.html`, `download-index.html`,
`artifact-map.json`, `site-manifest.json`, and `.nojekyll`. There is no directory
listing assumption or framework/runtime dependency.

### Identity is not retrieval

The download index exposes every selected artifact. `artifact-map.json`
associates canonical logical IDs with the exact project-relative retrieval
paths, roles, byte counts, hashes, and declared dependencies. For example, the
native `.../models/DeviceThing.tm.json` identity maps to
`/wot-av-extension/onvif/models/native/DeviceThing.tm.json`.

No namespace, model ID, `$id`, TD context, `tm:ref`, `tm:extends`, or Form is
rewritten. `example.org` remains the declared provisional identity space.
An explicit document loader can use the retrieval map; an unchanged remote
context/import is not made dereferenceable merely by hosting a copy on Pages.
Canonical dependency identities must be in the admitted map or the explicitly
listed external W3C TD context. No dependency is fetched by the stager.

### Notices

The existing rendering notice bundle and four applicable locked upstream
notices are copied byte-for-byte to explicit `notices/` aliases. Original HTML
notices have `.html.txt` names, so they are inert text downloads, not active
third-party web pages. Their original bytes, scripts, and relative resource
text are not edited or executed. The ONVIF contributor agreement does not become
a blanket first-party or specification license.

The download index includes reviewed source-specific ONVIF and OASIS citations
for original embedded notices where the complete upstream XML is not staged.
Public access, source pins, and these notices do not establish transformed-data
clearance, standards endorsement, patent permission, or certification. There is
no unrelated license-tree dump.

## Presentation and local-link checks

The only specification-HTML edits are the four reviewed informative anchors:
two AV migration links and two ONVIF editorial links. Staged copies point to
commit-pinned **public** GitHub blob views and append `supporting source`.
The JSON Pointer `/vocabularyRevision` is validated locally and preserved in the
label; it is not misrepresented as a GitHub JSON-view anchor.

Each edit records the original document SHA-256, original href and fragment,
new href, label suffix, start-tag ordinal, line, column, and original UTF-8 byte
offset. Separate staged file hashes record the resulting representation. Code
excerpts, normative text, IDs, rights, and all other HTML bytes are untouched.

All staged HTML is script-free and self-contained, with the existing restrictive
CSP. Active elements, event handlers, external resources, CSS imports and escaped
resource loads are rejected. SVG/CSS fragments and accessibility references
must identify actual local IDs. Inline text notices are not treated as HTML.

Local hyperlinks are resolved at the configured project prefix with exact
path case. Queries are not disk paths. Percent decoding and RFC 6901 token
decoding occur in the correct order; JSON Pointer object members and array
indices must exist. All JSON downloads are parsed strictly, rejecting duplicate
keys and non-finite numbers. Numbers are never reserialized in copied artifacts.
External HTTP(S) documentation/source links are syntax-checked, not downloaded.

Source and staged bytes are checked for host-local paths, private-input
locators, recognizable credential/key material, credential-bearing URLs, and
signed-secret query values. JSON escapes and HTML entities are considered.
Password-property definitions are not treated as credentials. This is a bounded
artifact policy, not a claim of exhaustive secret detection or a legal audit.
Host-specific canonical provenance must be corrected by its owner and regenerated;
the stager will not redact canonical JSON to make a scan pass.

## Filesystem and archive boundary

All path components must be normalized portable resource paths. Absolute or
drive paths, traversal, backslashes, encoded separators, alternate streams,
reserved Windows names, hidden files other than `.nojekyll`, and Unicode/casefold
collisions are rejected. Native filesystem roots supplied to CLI options are
separate from these untrusted resource names.

Every source, stage, archive, and ancestor is checked without following links.
Symlinks, Windows junction/reparse points, hardlinked regular files, and
nonregular files are forbidden. Files are checked again after reading; copies
are streamed and their exact hashes compared. Generated paths are created
exclusively inside the new owned staging directory.

Whole-document reads accumulate actual bytes in chunks of at most 65,536 bytes,
not a buffer sized to the policy ceiling. Short reads are retried, a byte beyond
the limit is rejected, and the completed length must match the opened file
descriptor before its unchanged-identity checks can succeed.

Default ceilings are 10,000 files, 67,108,864 bytes per document, 8,388,608 bytes
per metadata file, and **strictly less than 1,000,000,000 bytes** for the complete
site and independently for the archive. Policy limits can be reduced, not raised
beyond those ceilings.

`check` reconstructs the approved plan from the source checker and policies,
then compares the exact stage tree, manifest, and bytes. A tampered site manifest
cannot authorize extra files or change expected source hashes.

`verify-archive` first requires a checked committed stage. It then reads the
actual uncompressed Pages tar in bounded blocks, without extraction. Regular
files must occur exactly once and match all expected sizes and hashes, including
the site manifest. Only known directory entries and bounded, restricted PAX
metadata are accepted; conventional `./` and PAX marker headers are handled.
GNU tar's exact `./PaxHeaders/.` root-directory marker and a `PaxHeaders`
marker truncated at the 100-byte header-name boundary are accepted only as
metadata. A truncated final dot does not authorize a payload path ending in a
dot; effective PAX `path` values still pass the ordinary payload-path checks.
Links, special files, GNU long-name/sparse extensions, path escapes, duplicate
files, oversized declarations, nonzero padding, appended content, and missing
members fail. PAX sizes are bounded before any allocation.

The pinned upload-pages-artifact action invokes GNU tar without selecting its
format. The upload step must set **`TAR_OPTIONS: --format=posix`** so long names
use the accepted PAX representation rather than GNU long-name extension records.
Some current paths reach 101 bytes with the action's `./` prefix. This is an
explicit workflow setting, not an implicit environment mutation by the stager.

## Manifest and workflow output

The public manifest contains public paths, roles, bytes, hashes, the real source
commit, public-source status, project prefix, reviewed source date, provenance,
and the four presentation transformations. It contains no generator-input list,
personal paths, full private proof hashes, or source seal.

`sourceSnapshotSha256` hashes the sorted **selected public source** path/byte/hash
records. `contentSha256` hashes canonical ASCII JSON of the public manifest
metadata with sorted keys and compact separators, excluding `contentSha256`
itself. The site-manifest file is not a member of its own payload-file list.
The tar comparison separately includes its exact representation hash.

Successful commands print exactly:

```text
content_sha256=<64 lowercase hexadecimal characters>
```

Committed `prepare` and successful `verify-archive` also write that one line to
`GITHUB_OUTPUT` when supplied. The runner file must already exist, be empty,
and be a single-link regular file. `check`, `smoke`, and preview do not append
deployment job outputs. This lets one workflow step run `prepare` followed by
`check` without duplicate output records. A preparation digest is usable for
deployment only after the job's archive-verification step has succeeded.

Failures exit nonzero with a diagnostic code on stderr and no success digest.
The stager neither uploads nor deploys anything.

## Unauthenticated public smoke verification

The production command is `python ...stage-site.py smoke`, using:

| Environment | Meaning |
| --- | --- |
| `SITE_URL` | Actual deployment URL, at the exact approved HTTPS owner host and project prefix. |
| `BASE_PATH` | `/wot-av-extension/`. |
| `EXPECTED_COMMIT` | Immutable source commit of the verified deployment. |
| `CONTENT_SHA` | Verified archive content digest. |

For the workflow's configure-pages outputs, `SITE_BASE_PATH` is an alias that
also accepts the provider's single omitted trailing slash.
`EXPECTED_CONTENT_SHA256` and `EXPECTED_CONTENT_SHA` are content-digest aliases.
Conflicting primary/alias values are rejected.

The verifier requests the manifest, landing, both specifications, AV normative
JSON, the selected native Device TM, and the selected ONVIF schema. Probe paths
come from the validated local policy, never arbitrary URLs in a remote manifest.
It checks content types, strict JSON, HTML titles and safety, landing
commit/provenance metadata, and exact byte hashes bound to the expected manifest.
A 200 response containing an error page is not success.

No authentication, cookie, environment proxy, or GitHub token is sent. The
cache-busting query contains only the validated content digest. Redirects are
refused except for one same-origin, in-prefix canonical trailing-slash redirect.
HTTP requests have a maximum 10-second timeout, with retries bounded by one
180-second deadline. There is no production arbitrary-origin CLI flag.

`SITE_UNAVAILABLE` means verification never obtained the public metadata.
`DEPLOYED_CONTENT_MISMATCH` distinguishes an available/partially served site
whose content failed verification. Neither is a rollback or a claim that the
separate deployment operation failed.

## Focused tests

```powershell
python -B -m unittest discover -s .\av\tools\publication\test -p test_site.py
```

Tests create their own temporary repositories with a controlled local Git
identity; they do not alter this repository's index or commit history. All test
HTTP traffic goes to owned literal-loopback servers, closed after each test.
The test-only origin injection is a Python dependency, not a CLI switch.
Fixtures exercise committed and dirty previews, exact policy/mapping closure,
byte fidelity, source/proof races, privacy, HTML links and JSON Pointers,
filesystem safety, real tar streams, workflow output records, and bounded HTTP
failure/retry states. Windows junctions and reparse points are covered; the single
native-symlink case reports a capability skip when Windows denies symlink creation.

The trust boundary is consistency of an approved committed source snapshot,
not independent rendering, semantic recompilation, browser accessibility
qualification, or protection against an authorized committer forging both
content and proofs. Keep the existing qualified producer checks and source review.
