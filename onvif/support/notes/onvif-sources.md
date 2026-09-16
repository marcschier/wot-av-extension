# Locked public ONVIF sources

This is the source/provenance layer for the native ONVIF binding. It does not
claim complete profile requirement coverage, implemented native operations,
product registration, certification, or publication clearance.

## Baseline and editions

[`sources.lock.json`](../../sources.lock.json) pins ONVIF release
**26.06** to commit `68ee1b540a40f848c9599eba2c55b87547c588d6`. The release was
published **July 2, 2026** and updated **August 18, 2026**. The observed tag points
to an August correction; this is not evidence of the original July tag contents.
Do not replace the commit with `main`, a moving tag, or a service namespace URL.

The [profile-edition catalog](../../profile-editions.json)
selects the following seven released public documents. Each record includes its
official PDF URL, SHA-256, physical page count, cover/requirement clause locators,
minimum specification reference, and separate device/client role scope.

| Profile | Document edition | Physical PDF pages |
| --- | --- | --- |
| A | 1.0, June 2017 | 25 |
| C | 1.0, December 2013 | 17 |
| D | 1.0, June 2021 | 35 |
| G | 1.1, October 2025 | 19 |
| M | 1.1, March 2024 | 49 |
| S | 1.3, November 2019 | 42 |
| T | 1.0, September 2018 | 77 |

PDF upload-directory dates are not edition dates. Retired **Q 1.2** is catalog
history only. **V** and its companion **Security Add-on** are excluded release
candidates, not eighth/ninth released profiles. **TLS Configuration** is a
separately versioned add-on, not an automatic requirement of all seven profiles.
The separately locked AdvancedSecurity WSDL is not add-on conformance evidence.
Profile S's March 31, 2027 cutoff concerns new product/firmware submissions; it
does not automatically invalidate registered existing firmware or remove native
integration support.

`ProfileEdition` metadata is not `ConformanceEvidence`. Device-advertised profile
claims, observed capabilities, firmware-specific registered evidence, and measured
runtime support remain distinct. The source catalog explicitly establishes none
of those product claims. Its clause anchors locate source sections; they are not
an exhaustive requirement-atom ledger.

## What is locked and copied

The baseline contains **53 records**: **42 XML documents**, **seven reference-only
PDFs**, and **four complete original notice documents**. The XML set contains 28
ONVIF documents and 14 external dependency documents. There are **50 explicit
XSD/WSDL import/include edges**, all resolved by source ID.

The 43 vendored records occupy 2,182,891 bytes. They include 17 canonical service
entry points, two separately identified optional/add-on service WSDLs, supporting
ONVIF schemas, the topic-namespace placeholder, W3C/OASIS dependencies, and notices.
The three older XMLSOAP discovery/addressing inputs are deliberately fetch-only.
The PDFs are not bundled.

Every public source record identifies `id`, `url`, exact `sha256` and `bytes`,
`relativePath`, `storage`, verification date, and the redistribution decision.
XML records also retain `rootElement`, `targetNamespace`, `schemaVersions`, and
the ordered `imports` declarations. ONVIF records retain upstream paths and
verified Git blob identities. `schemaVersions` contains the actual XSD version
attributes, or an empty list when none are declared. For example, Device
Management is 26.06, Media1 is 21.06, AccessControl is 20.12, PACS types are 19.12,
and metadata is 25.12. None of these is a profile edition.

`relativePath` is a portable, slash-delimited **resource identifier**, relative to
`onvif\support\upstream\onvif\` or an explicitly supplied cache. Filesystem callers must split
it into native path components rather than treating arbitrary import strings as
paths. The upstream XML files are copied byte-for-byte: no rewritten
`schemaLocation`, namespace, newline, copyright, or license text. The repository's
existing `* -text` Git attribute preserves their octets across checkouts.

### Use by compilers and other modules

Use the lock as the single URL/import authority; do not create another list of
mutable source URLs. `sourceGroups.canonicalServiceEntryPoints` selects the 17
service WSDLs. `separateConditionalOrAddOnServices` and `nativeDiscovery` are
separate groups, not universal profile obligations.

For example, the Device service source ID is
`onvif:wsdl/ver10/device/wsdl/devicemgmt.wsdl`; the Event service source ID is
`onvif:wsdl/ver10/events/wsdl/event.wsdl`. The Media1 and Media2 paths and namespaces
are different records, despite their identical file and operation local names.

The standard-library Python API is:

```python
from pathlib import Path
from tools.fetch_onvif_sources import load_lock, verify_sources

root = Path.cwd()
registry = load_lock(root / "bindings" / "onvif" / "sources.lock.json")
verify_sources(registry, root, source_ids=[
    "onvif:wsdl/ver10/events/wsdl/event.wsdl"
])
dependency = registry.resolve_import(
    "onvif:wsdl/ver10/events/wsdl/event.wsdl",
    "http://docs.oasis-open.org/wsn/bw-2.wsdl",
    "http://docs.oasis-open.org/wsn/bw-2",
)
local_file = root.joinpath("onvif", "support", "upstream", "onvif", *dependency["relativePath"].split("/"))
```

The API is importable without AV model initialization or third-party Python
dependencies. A Node/compiler integration can read the same JSON directly: match
each actual import declaration to its recorded `sourceId`, check the destination
namespace/kind and bytes, then supply those bytes through an offline resolver.
HTTP source identities in `aliases` are explicit remaps to the recorded HTTPS
retrieval URL; they are never requests to downgrade transport. Do not select by
namespace alone: one namespace can span multiple schemas.

Neither syntax inspection nor `resolve_import` loads an external schema, DTD,
entity, stylesheet, or XInclude. A downstream schema compiler or runtime must
likewise disable invocation-time external retrieval. This verifier checks source
integrity, XML syntax/metadata, notices, and the recorded closure; it is not a
complete XSD compiler or a second XML codec authority. Topic definitions cannot
be inferred from `topicns.xml`, which explicitly remains a placeholder.

## Offline checking, explicit fetching, and export

Run commands from the repository root. No installation or dependency-manifest
change is required.

```powershell
python -B -m unittest discover -s tests\onvif_sources -p test_*.py -v
python -B onvif\tools\fetch_onvif_sources.py --check --scope vendored
```

`--check` is optional: checking is the default, and it never enables network
access. The default `--scope xml` requires **all** locked XML inputs, including
the three fetch-only discovery/addressing files. Without an explicit cache,
that complete-scope check exits **2** with a missing-source diagnostic instead of
pretending the closure is locally available. `--scope vendored` explicitly checks
the shipped subset and its complete import/notice dependencies.

Prepare a local development cache only when network retrieval is intended:

```powershell
$cache = Join-Path $env:TEMP 'onvif-public-sources'
python -B onvif\tools\fetch_onvif_sources.py --fetch --cache $cache --scope xml
python -B onvif\tools\fetch_onvif_sources.py --check --cache $cache --scope xml
```

`--fetch` requires an explicit cache **outside the repository**. It retrieves only
missing locked inputs; verified vendored/cache bytes are reused. It never
automatically vendors fetched files, changes the lock, or clears a legal gate.
`--scope profiles` retrieves/checks the seven PDFs; `--scope all` includes PDFs,
all XML, and notices. Use repeated `--source ID` arguments for a specific root
set; its transitive imports and notice dependencies are always included.

Fetch URLs are exact locked HTTPS URLs on five fixed public hosts. The ONVIF
GitHub path must contain the immutable commit. Redirects, credentials/userinfo,
nondefault ports, query strings, fragments, ambiguous paths, response content
encoding, unexpected status, oversized/truncated bodies, and hash mismatches are
errors. The tool uses no implicit environment proxy. The limits are 2 MiB per
XML document, 8 MiB per PDF/notice, 64 MiB per source set, 128 records, a
15-second network timeout, and a 300-second fetch-batch deadline. There are no
automatic retries or trust-downgrade fallbacks.

A damaged existing file is an error even with `--fetch`; it is not silently
replaced. Investigate the mismatch before deliberately removing that named cache
file and fetching again. Source errors exit **2**. Success reports exactly the
selected verified IDs, the scope, and remaining redistribution gates; it never
reports product conformance.

To copy a permitted subset, its original notices, and its provenance together:

```powershell
$export = Join-Path $env:TEMP 'onvif-source-export'
python -B onvif\tools\fetch_onvif_sources.py --export $export --scope vendored
python -B onvif\tools\fetch_onvif_sources.py --check --lock (Join-Path $export 'sources.lock.json') --root $export --cache $export --scope all
```

Export is offline, preflights the entire selected closure, refuses uncleared
redistribution even for cached files, and refuses conflicting destination bytes.
It emits a subset `sources.lock.json`, keeps only resolvable source-group
members, and marks the selection as a subset rather than the complete baseline.
Each file is published locally from a completed temporary file using an exclusive
hard link; a filesystem without hard-link support fails explicitly rather than
silently weakening the copy guarantee. No source is staged, committed, pushed, or
published to a package/site/registry by these commands.

## Notices and outstanding gates

The [source policy](../upstream/source-policy.json) records the
copying basis and exclusions. Original ONVIF and OASIS copyright/license/disclaimer
blocks remain intact. ONVIF notices vary between file editions; the verifier
retains the actual text rather than adding a modern notice to older files. The
ONVIF Contributor License Agreement is included as provenance, not as a blanket
Apache assignment to all documents or project-authored code.

W3C schemas with explicit software-license notices retain those notices and the
full matching 1998/2002 license documents. The XML namespace and XOP schema have
no embedded notice; their unchanged copies use the public-site default
[W3C Document License](https://www.w3.org/copyright/document-license-2023/), with
its full notice and source-specific attribution retained in the source lock.
No broader software/modification license is inferred for those two documents.

The April 2005 WS-Discovery WSDL/XSD and August 2004 WS-Addressing schema grant
copying for developing/evaluating the specification. Broader distribution rights
for the intended implementation/package have not been established here. They
remain hash-pinned, **fetch-only**, and blocked by `--export`; a reviewed applicable
permission is required before redistribution. Their source/hash closure is
complete and can be checked against an explicitly prepared local cache without
assuming publication clearance.

Unchanged copying does not establish clearance for transformed requirement
datasets, generated derivative packages, patents, profile symbols, or
certification claims. No first-party license is added. Private ACF and member-only
sources are excluded rather than copied into a public source tree.

## Editorial decisions

The [editorial register](../editorial/editorial-decisions.json)
retains exact source IDs and clause/page or native line locators. Important
decisions include the correct **singular `SetUser`**, S's November edition, D's
conflicting revision year, G's stale running headers, M's repeated printed
pagination, M's client metadata table, and the native
`MetadataStream/VideoAnalytics/Frame` element path.

Two normative interpretations deliberately remain unresolved: G's
`SetTrackConfiguration` device condition (prose versus function table) and S's
PTZ `GetNodes`/`GetNode` choice (prose OR versus both rows M). Later requirement
mapping must retain both pieces of evidence and obtain an explicit reviewed
decision. Source lookup or successful SOAP execution does not settle them.
