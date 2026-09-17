# Public specifications on GitHub Pages

## Current status and activation boundary

`marcschier/wot-av-extension` is now a **public source repository**. The owner's
explicit visibility authorization supersedes the older private-source planning
assumption; it does not assign a license or authorize package/binary publication.
GitHub API read-back on 2026-09-17 confirmed Actions-based Pages, HTTPS, and the
existing `github-pages` environment restricted to the **branch** `main`.
Routine workflows must not enable Pages again, change visibility, provision
credentials, or replace environment/domain/protection settings.

The configured URL is
<https://marcschier.github.io/wot-av-extension/>. The first deployment is
**pending**: the setup check returned HTTP 404 and no Pages deployment existed.
The planned AV and ONVIF reading paths are `/wot-av-extension/av/` and
`/wot-av-extension/onvif/`; these are not claims of a working live site.
The workflow definition and local checks do not constitute deployment.

Every future reviewed push to `main` is intended to publish the checked public
documentation automatically. Activating this new definition through a commit
and push, or requesting its first manual deployment, requires separate explicit
approval. This implementation task performs none of those operations. Record a
live URL, source commit and payload digest only after deployment and anonymous
public verification actually succeed.

## Local commands and the producer boundary

Use the existing qualified Node 24.12.0, Python 3.12 or newer, and Git. Normal
Pages CI uses Node built-ins and Python's standard library; it does not run
`npm ci`, install Python packages, restore Puppeteer, render with Edge, download
native SDKs, or run camera/runtime qualification. The root npm aliases only
launch local commands and need no workspace dependency restoration.

```powershell
npm run test:site
npm run check:specs:committed
npm run build:site -- --preview --base-path /wot-av-extension/ --output <fresh-stage>
npm run check:site -- --site <stage>
```

`<fresh-stage>` must be an explicitly chosen, new output directory, not the
checkout or an existing tree. `--preview` permits local review but is explicitly
nonpublishable. It must not label uncommitted working bytes as a deployed
commit. Deployment preparation omits `--preview` and requires the actual
checked-out HEAD, workflow `GITHUB_SHA`, and selected tracked source bytes to
agree. Never bypass that boundary by staging or committing from a validation
command.

The browserless committed check establishes input membership, source/output
hash agreement and sealed generator consistency. It does not independently
re-render the specifications or defend against an authorized author replacing
both evidence and output. After source/generator changes, use the existing
qualified [`build:specs` and `check:specs` producer workflow](../../tools/publication/README.md)
and review its evidence before deployment. Missing or stale evidence is an
error, not permission for CI to bless a snapshot.

Archive checking is also local and does not upload:

```powershell
python -B av\tools\publication\stage-site.py verify-archive --archive <artifact.tar> --site <stage>
```

The site policy selects approved documentation, canonical downloads, examples
and applicable notices; even though the repository is public, it never means
"upload the whole checkout." The stager owns public-file membership, link and
JSON Pointer closure, provenance/privacy checks, the public manifest, and the
strict size bound. Only `.nojekyll` is an approved hidden payload file.
Normative JSON is not redacted during copying. Public provenance must be
normalized at its owning generator and all dependent hashes regenerated.

## Workflow trust and artifact flow

[`.github/workflows/pages.yml`](../../../.github/workflows/pages.yml) has
three isolated jobs:

| Job | Authority and behavior |
| --- | --- |
| `prepare` | `contents: read`; reject invalid event/ref identity, checkout `github.sha` with persisted credentials disabled, select Node, run publication controls and browserless checks, stage/check the approved tree, upload only that tree for production, then verify the actual uploaded tar. |
| `deploy` | `contents: read`, `pages: write`, `id-token: write`; no checkout or repository-script execution. Read existing Pages metadata with enablement disabled, validate the exact HTTPS destination, compare current remote main immediately before deployment, and publish this run's uniquely named `github-pages` artifact. |
| `smoke` | `contents: read`; checkout the same immutable SHA and make bounded, unauthenticated requests through the public-check helper, using the actual deployment URL and the expected commit/content digest. No GitHub token is placed in the public-request environment. |

The events are pushes to `main`, pull requests targeting `main`, and manual
dispatch. There is **no path filter**: shared files, new/deleted inputs, tooling,
locks, and documentation-only changes must not evade freshness checks.
Pull requests run only read-only validation and nonpublishable preview staging;
they do not upload deployable artifacts, enter the Pages environment or receive
deployment permissions. A fork's own workflow cannot publish this repository.
There is no `pull_request_target`, privileged `workflow_run`, self-hosted runner,
PR preview publication, dispatch ref input, or arbitrary artifact/run selector.
A manual dispatch from a non-main branch or a tag named `main` fails explicitly
before checkout.

The uploader receives only `${{ runner.temp }}/pages-site`, with one-day
retention and `include-hidden-files: true` after strict staging checks have
allowed `.nojekyll`. At the pinned uploader revision, the actual tar is
`$RUNNER_TEMP/artifact.tar`. The upload step sets `TAR_OPTIONS: --format=posix`:
the current longest payload name is 101 bytes with the action's `./` prefix.
GNU tar otherwise emits a forbidden GNU long-name extension; POSIX emits the
bounded PAX path metadata accepted by the verifier. Links, sparse and GNU
extension payloads remain forbidden. Verification runs **after** upload and compares its
members and bytes without unsafe extraction. An extra, altered or invalid tar
member fails `prepare`; the dependent deploy job cannot run. No fallback to an
older or differently named artifact is allowed.

The stager emits a single validated `content_sha256=<64 lowercase hex digits>`
step output after successful deployment preparation. The workflow checks that
output shape and exact agreement of prepare/check stdout with that step output.
Duplicate, malformed or conflicting digests fail. `prepare` exposes that digest only
through its job output; smoke compares it with the public manifest and fetched
bytes. Preview preparation does not create a publishable commit/digest claim.

## Serialization and current-main recovery

All production runs, including smoke, share workflow concurrency group `pages`
with `cancel-in-progress: false` and `queue: max`. Pull requests have distinct
`pages-pr-<number>` groups. GitHub currently permits up to 100 pending runs with
`queue: max`; it must not be replaced with the default single-pending slot,
which can let a late obsolete run evict the newest run.

Waiting-queue order is not push chronology. Immediately before deployment the
privileged job reads `GET /repos/marcschier/wot-av-extension/git/ref/heads/main`
using the built-in token for that API call only. The returned SHA must be exactly
40 lowercase hex characters and equal the immutable workflow SHA. A mismatch
produces an explicit obsolete-run notice and skips deployment and smoke.
API failure, timeout, empty or malformed metadata is a failure, not a successful
stale/no-change skip.

Main may advance after this comparison while a deployment is already running.
The active deployment is preserved; a retained, valid current-main run follows.
This is eventual latest-valid-main publication, subject to queue/service
availability, not an atomic guarantee that no older content can appear
temporarily. A queue overflow, expired artifact or service outage requires a
new, separately authorized dispatch of **current main**, not an obsolete
artifact. A rerun must pass the same current-main guard.

## Public verification and rollback

Smoke uses the validated actual deployment `page_url`, the configured project
base path, the immutable source commit, and the prepared content digest. It
checks the landing page, both specification pages, the public manifest and
curated representative normative downloads. It must validate content types,
titles and hashes rather than accept an HTTP 200 error page, stale marker or
the mere existence of a deployment URL.

Requests are unauthenticated, finite, and confined to the approved HTTPS origin
and project prefix. No cookies, GitHub token or document-discovered URLs are
used. The helper owns a 180-second propagation deadline, per-request timeouts
and bounded cache-busting retries. The smoke job runs only after a successful
deployment has returned the exact approved URL.

A deployment can complete while public verification subsequently fails. The
workflow reports those outcomes separately and does not automatically roll
back, change Pages settings or declare a verified site. Rollback is an
owner-approved revert on `main`, followed by the normal validation/deployment
path. No local command or CI repair step automatically commits that revert.

## Immutable action and runtime provenance

These official release-tag commit refs and their action definitions were
reconfirmed by read-only GitHub API calls on 2026-09-17:

| Action | Release | Full commit pin |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/configure-pages` | v6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` |
| `actions/upload-pages-artifact` | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| `actions/deploy-pages` | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |

`setup-node` explicitly selects Node 24.12.0, present as a stable Linux x64
binary in the official `actions/node-versions` release
[`24.12.0-20140960970`](https://github.com/actions/node-versions/releases/tag/24.12.0-20140960970).
Automatic package-manager caching is disabled. This does not assume the
Ubuntu runner's default Node version or install workspace dependencies.
The uploader also pins its nested `actions/upload-artifact` to
`bbbca2ddaa5d8feaa63e36b76fdaad77386f024f` (v7.0.0).

Relevant primary contracts are the pinned
[upload definition](https://github.com/actions/upload-pages-artifact/blob/fc324d3547104276b827a68afc52ff2a11cc49c9/action.yml),
[configuration definition](https://github.com/actions/configure-pages/blob/45bfe0192ca1faeb007ade9deae92b16b8254a0d/action.yml),
[deployment definition](https://github.com/actions/deploy-pages/blob/368f82528645a54fb793d4d04e342629a3f51346/action.yml),
and current [workflow concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
Future action updates must review those inputs and nested pins; unrelated
existing workflows are not upgraded as part of Pages setup.

## Specification and licensing status

These remain independent technical drafts, not W3C or ONVIF standards
publications. Editor identity, first-party licensing, external editorial/domain
review, namespace hosting and formal release authorization remain unapproved.
Existing notices and false release/distribution flags are unchanged, and npm
workspaces remain private packages. Pages is a retrieval location, not a
reassignment of canonical identifiers: provisional `example.org` IRIs and TD
contexts must not be rewritten to `github.io` or advertised as newly hosted
semantic namespaces.
