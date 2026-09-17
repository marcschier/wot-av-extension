# Shared Markdown publication

`av/spec.md` and `onvif/spec.md` are authoritative. This private workspace
assembles their declared inputs and renders independent technical drafts at
`av/index.html` and `onvif/index.html`. The ONVIF entry point imports this one
implementation. It never copies prototype drafts over the specifications.

## Commands

Use the reviewed Node 24.12.0 executable and the already qualified installed
Edge, not a browser downloader:

```powershell
$nodeRoot = 'C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Microsoft\VisualStudio\NodeJs'
$env:PATH = $nodeRoot + ';' + $env:PATH
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
npm run test:specs
npm run build:specs
npm run check:specs
```

`build:specs` runs the preparation commands declared in each publication
configuration, snapshots actual inputs, renders documents sequentially, checks
input stability, writes HTML and evidence, then reseals the existing publication
inventories. No browser, SDK, source specification or bibliography is fetched.
Existing Python preparation dependencies must already be provisioned.

Preparation includes the source-bound ONVIF example generator before annex
assembly, so changed abstract/native models cannot leave those TDs stale.
Adapter-owner example snapshots are checked by the adapter suite separately.
The final reseal order is ONVIF delivery inventory, then AV publication inventory.

`check:specs` checks preparation, renders in two fresh child processes, compares
their exact bytes and compares all HTML, reports and publication manifests with
the repository. The canonical ONVIF check may refresh its ignored `dist`
staging; it is not a claim of no filesystem writes. It does not bless changed
browser or asset pins.

```powershell
node av\tools\publication\build-specs.mjs --inputs-only
node av\tools\publication\build-specs.mjs --render-only
node onvif\tools\publication\build-specs.mjs
node av\tools\publication\build-specs.mjs --fixture
node av\tools\publication\assets.mjs
```

`--av` or `--onvif` selects one specification without overwriting the other
specification's evidence. `--inputs-only` reports actual input readiness without
generation or a browser. `--render-only` is for integration after the owning
generators have run; missing or inconsistent inputs still fail. `--output-dir`
explicitly selects a review-output directory without writing root publications.
Tests use only their own temporary output directories and browser profiles.

For an already provisioned isolated tool package, `--tool-package` (or the
explicit `PUBLICATION_TOOL_PACKAGE` environment variable) supplies its module
resolution root. Puppeteer must still be exactly 25.10.0. This is not an
automatic dependency fallback or a bypass of Node, asset or browser checks.

## Dependencies and qualification

Exact direct pins are ReSpec 37.4.0, Puppeteer 25.10.0, Mermaid 11.12.0 and
axe-core 4.10.3. The root npm lock preserves the relocated reference-runtime
workspace; publication is a separate private workspace. Do not run `npm ci`
in a shared active checkout or copy another environment's `node_modules`.
After a manifest change, provision the selected workspace with
`npm install --workspace @wot-av/publication --install-strategy nested
--ignore-scripts --offline --registry=https://registry.npmjs.org/`
and an explicitly supplied populated `--cache`. Root Puppeteer configuration
also disables automatic browser downloads.

Browser identity, executable hash and CDP metadata are checked against
`av/support/publication/publication-policy.json`, `assets.lock.json` and
`browser-qualification.json`. An automatic Edge update blocks normal builds.
Explicitly run:

```powershell
node av\tools\publication\build-specs.mjs --fixture --qualify-browser
```

Only successful static fixture checks and equal bytes from two fresh profiles
write a new qualification. Review the resulting pin changes. This tests a
selected Edge executable; it is not a Puppeteer vendor-support guarantee.

Eight local resources, their hashes and their package/notice provenance are
retained under `av/support/publication`. The notice bundle retains the original
prototype package-provisioning provenance; it does not license the specifications.
W3C display-CSS URLs are answered with the project stylesheet. Logo/fixup
preloads receive explicit neutral/no-op substitutes, not copied W3C branding.

## Source contract

Each `support/publication/specification.json` declares its root Markdown,
normative inputs, allowed normative Markdown includes, explicit mechanics,
example roots, required generated-definition sources and preparation commands.
The ONVIF configuration also reads the current normative and canonical
manifests. The current ONVIF `model-manifest.json` supplies explicit normative
and informative roles plus logical `path` / `physicalPath` records. Physical
artifact paths and canonical logical identities are distinct. An additional
`artifactPathMap`, when declared, must match those records. Counts come from the
actual manifest, never a fixed historical artifact count.

Includes and source pointers resolve relative to their original Markdown file.
An explicit `sourceAliases` table records the reviewed AV draft's legacy
repository-relative example markers; it is not a fallback filesystem search.
Only declared normative Markdown may be included. Referenced examples must be
actual JSON files under that specification's examples tree or individually
declared `exampleFiles`. The latter can supply illustrative JSON data, never a
normative include or generated-definition authority. Runtime, tools, tests and
history cannot become normative inputs. Inputs are bounded, hashed,
symlink-contained and checked again before output is written. Unfilled generated
regions, absent annexes, invalid pointers and changed literals fail; there is no
prototype-substitution mode. JSON keeps original numeric/string tokens while
formatting with four spaces and expanded nonempty arrays.

ONVIF vocabulary examples additionally use explicitly source-bound TD/TM
excerpts. Their `td-excerpt` comment declares a complete example document and
the JSON Pointer paths to retain. The adjacent `jsonc` fence preserves the TD
context and actual parent placement, with standalone `// ...` lines marking
omitted members. The shared lossless JSON reader verifies the visible tokens
and omission markers against that source. A changed value, missing context,
unmarked JSONC fence or arbitrary comment fails. These illustrative excerpts
are not complete JSON documents; ordinary JSON fences and downloadable
examples remain strictly valid JSON. `check_docs.py` uses the same excerpt
checker rather than relaxing its ordinary JSON checks.

Root and annex links are rebased to physical files. Canonical model identity
links can carry a separately labelled local artifact download; an unhosted IRI
is not advertised as a working local file. Dated bibliography entries and
normative/informative classifications are local data, not fetched at build time.

## Output and policy boundaries

ReSpec runs as `unofficial`, with no assigned editors, logos, group, patent
commitments or JSON-LD rights metadata. The explicit rights override leaves
first-party licensing unselected. Technical rendering is independent of those
approval gates; `--release` always fails until a separately authorized release
route and metadata are implemented.

The renderer awaits ReSpec, rejects every warning/error or unapproved page
request, canonicalizes SVG IDs, embeds CSS/SVG and removes executable scripts
and resource links. It checks code text, source anchors, citation counts, table
headers/captions, diagrams and a 390-pixel viewport with JavaScript disabled and
the page offline. Local axe checks are not complete WCAG or manual accessibility
qualification.

The loopback server serves only exact in-memory approved paths. Request
interception and browser background-network flags are page-request controls and
defense in depth, **not an OS-level proof of all browser-process egress**.
Only the owned browser PID/profile and loopback server are closed.

Publication manifests hash actual sources, tooling and generated artifacts,
excluding their own hashes and temporary command logs. Source dates are
declared, not derived from wall-clock generation time. `SOURCE_DATE_EPOCH`, if
set, must match the reviewed source date. No site, registry, commit, push,
hardware qualification or standards endorsement follows from a successful build.

Root ownership explicitly registers all renderer inputs and generated outputs.
The existing ONVIF delivery inventory incorporates both specifications' HTML
and publication evidence through exact-file input globs. Each specification's
separate publication manifest supplies its complete renderer/output provenance;
neither the AV nor ONVIF semantic generator owns or writes the HTML.
