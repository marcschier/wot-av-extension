# Browserless committed-generation verification

Run the read-only verifier with the reviewed Node version (currently 24.12.0):

```powershell
node av\tools\publication\check-committed.mjs
```

The command needs no npm installation, renderer, browser executable, native
SDK, service, network request or Git credentials. It checks both specifications;
there is no single-specification, rewrite, repair or reseal mode. The exported
`checkCommitted({ root })` interface returns a verification summary or throws.
`--root PATH` selects another complete local checkout or an isolated fixture.
Paths inside metadata remain portable repository-relative resource names.

The source repository and the intended Pages audience are public by owner
authorization. The historical private-source assumption is no longer the
hosting constraint. This does not grant a first-party license, appoint editors,
approve a formal W3C/ONVIF release or change provisional canonical identifiers.

## What is checked

The verifier uses the same `freezeSpecification` input rules as the producer,
not an input list supplied by a stored success report. It reconstructs both
specification configurations, normative/mechanics and source-bound example
membership, generated regions, bibliography rewrites and local link targets.
ONVIF artifact roles, physical paths and counts come from the current
`model-manifest.json`, not a historical artifact-count constant.

Both publication manifests must equal the producer's current metadata and
actual HTML/report hashes. Reports must agree with current frozen inputs,
annexes, source regions, links, bibliography rewrites and recorded browser
qualification, and contain no errors, warnings or blocked requests. Asset and
notice bytes must match their locks. The recorded Node/Puppeteer/CDP/hash
metadata is verified without testing whether the producer's platform-specific
Node or Edge executable paths exist on the checking machine.

All canonical artifact hashes and lengths are checked, including the
informative coverage report kept outside the public site. The separate source
seal binds the complete published input/output closure and the current
generator code, authored metadata, locked native sources, native implementation
inputs, CI definitions and original package-location inputs that still exist.
New or removed files in the reviewed owner/workspace/source roots change
membership, even if a previous seal omitted them. Neither a stored `kind`
label nor a success counter authorizes another input or artifact.

The source rules are implemented in `../../tools/publication/source-inputs.mjs`.
They combine explicit publication/owner files, owner source roots, explicit npm
workspace roots, AV/ONVIF authoring and publication metadata, pinned upstream
material, and the retained original `packages`, `native`, `tools`, `bindings`,
`spec`, `vocabulary` and `shapes` locations. Build directories, dependencies,
private local authoring storage and generated outputs are excluded from source
membership. Actual normative outputs and selected examples are independently
bound through the frozen publication and canonical inventories. Source or
policy changes require the owning producer, not a deployment-time rehash.

## Producer seal and ordering

`source-input-manifest.json` follows `source-input-manifest.schema.json`. Its
classification is `PrivateSourceOnly`: it is verification evidence, not an
additional public download or permission to publish implementation sources.
The label excludes a site payload; it does not claim the source repository
is still private.
Its self digest covers the deterministic four-space, LF-terminated JSON object
without `digest`; file entries hash exact bytes. No wall-clock timestamp,
local absolute source path or fabricated source commit is added.

A complete normal `npm run build:specs` captures generator inputs, runs both
owning preparation pipelines, renders both HTML documents and writes their
reports/manifests. It then verifies that generator inputs did not change,
verifies the produced publication snapshot, and writes the source seal.
Canonical generation failure, renderer failure, source drift or unsuccessful
output verification prevents that write. The existing ONVIF and AV inventory
reseals run afterwards.

The seal, the downstream AV/ONVIF release inventories and
`integration-result.json` are never source inputs or seal outputs. This avoids
a self-hash or downstream-inventory cycle; their existing independent
verification contracts remain in force. The frozen relocation baseline is
not recalculated or rewritten by the checker.

`--render-only`, `--inputs-only`, `--fixture`, output-directory runs and partial
`--av`/`--onvif` builds do not create a new complete source seal. A partial
normal build reports that a complete build is needed. A full `check:specs`
still performs qualified fresh-process renders and additionally checks the
stored source seal; it does not create one. Browser qualification remains the
explicit fixture gate if the installed producer Edge changes.

Run the final complete producer only after all shared source, workflow,
ownership, provenance and documentation changes have settled. Staging and CI
must call the read-only checker; they must never regenerate its proof around
old HTML.

## Assurance boundary

A passing check proves internal consistency with the recorded successful
producer snapshot. It is **not independent rendering, semantic recompilation,
accessibility testing, native/hardware qualification or protection against an
authorized author deliberately forging content and every proof**.

A legitimate uncommitted local preview can pass after normal regeneration.
The checker makes no branch/commit-cleanliness assertion and needs no invented
commit. The site stager and CI separately require the complete exact Git
snapshot intended for deployment. Source freshness and deployable-commit
freshness are separate checks.

## Public provenance normalization

`onvif/support/editorial/standards-decisions.json` and its authoritative
`editorial-decisions.json` interpretation records now expose the same reviewed
`oldSource` strings. `oldSource` remains a string; no native source reference,
QName, service, profile, interpretation, vocabulary class or approval field
was removed or reclassified.

The change normalizes 68 existing scalar fields across the two authored files:
33 `oldSource` fields in each, plus the standards record's repository root and
private draft locator. Each original mapping set had 65 repository paths and
two private authoring-note paths. Fifty-eight repository locators resolve to
the recorded historical revision and line ranges or explicit authored record
selectors. Seven recorded working-draft ranges exceed the committed file's
length; they are retained in qualified source records, not falsely presented
as verified citations. The two private notes and the private draft have honest
record IDs and labels, not broken public URLs.

`provenance-normalization.json` records original/new file and field hashes,
public replacement values, historical path/blob locators and reasons. It
contains no new copy of original private scalar values. Exact unredacted
copies are retained only in ignored local authoring storage; the already-public
reachable Git history is not rewritten. The catalog loader accepts only the
reviewed original hashes or the already-normalized strings, checks exact
decision/record membership, and preserves unrelated native examples such as
`C:\Media`. It does not run a blanket Windows-path replacement over native data.

The normal ONVIF pipeline regenerates the requirement index and consequent
digest-bearing models, examples and annex metadata. The entire requirements
index remains hash-addressed. No staging-time redaction or canonical-IRI
rewrite is used.

Digest-addressed observed example model IDs, their references, projection
versions and model-array ordering change with the requirements digest. The
declared canonical artifact identities, native operation tuples and provisional
namespace do not change.
