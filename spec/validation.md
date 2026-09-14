# Portable generation and offline validation

Use Python 3.10 or newer. The exercised environment is Python 3.13.15 with the
four exact direct dependency versions in `requirements-dev.txt`. Generation uses
RDFLib and PyLD; validation additionally uses jsonschema and pySHACL. Dependencies
must already be available for offline execution. Installing from the manifest is
a separate environment-setup step, not something these tools attempt.

From the release/repository root:

```powershell
python tools\validate.py
python tools\generate.py --check
```

Validation never installs packages, contacts a Thing, retrieves a context, imports
OWL, or repairs a pin. It returns nonzero on an unexpected result. Its JSON stdout
distinguishes positive checks, expected structural failures, expected admission
rejections, and documented limitations. A passing result means those stated
expectations held; it does **not** mean every deliberately invalid input passed.
An optional `--report path.json` writes full check details to a new, repository-
relative non-release file. The default command writes no files.

After intentionally reviewing changes to the authored inventory, rules, fixture
inputs or tooling, explicitly regenerate and reseal:

```powershell
python tools\generate.py
python tools\validate.py
```

`vocabulary/terms.json` is the sole authored term inventory. `tools/model.py`
contains the additional structural rules. The generator derives the JSON-LD
context, ontology, shapes and complete term catalogue, then reseals the example
pin bundle/cache manifest and canonicalizes the finite query dataset with
URDNA2015. `release-manifest.json` hashes every release-owned input/output except
itself. No pin bundle or document contains its own digest. Generator checks are
byte-for-byte, not merely RDF-isomorphism checks. Generation does not overwrite
the authored TDs, Need, counterfactual Assignment or profile descriptions.

All paths are resolved from the tools' location, not the current directory or a
developer machine. JSON manifests use safe repository-relative POSIX notation;
the resolver converts these to the local filesystem's native paths and rejects
absolute paths, traversal and escaping symlinks. Preserve `.gitattributes`:
line-ending conversion changes exact-octet hashes. Do not copy a virtual
environment into this release.

## Scope and limits

The canonical inventory contains 38 classes, 105 AV properties, 17 reused external
properties and the H265/Opus additions. H265 is allowed only for EncodedVideo;
Opus only for EncodedAudio. All-codec and both representation-specific lists are
checked. RawVideo and PCM still forbid codec fields. Codec family names are not
evidence of decoder, encoder, transport or WebRTC support.

The reviewed sign repair applies `PositiveRationalShape` to Track.frameRate,
RationalConstraint lower/upper bounds and TimestampMapping.timeBase, and
`NonNegativeRationalShape` to TimeSelector start/end. These are **SHACL helpers,
not new AV classes**. Generic Rational and observed Timestamp values remain
signed. Shape tests include each site's negative, zero and positive cases.

The shipped shape graph is run through pySHACL and meta-SHACL with `inference`
set to `none`, `do_owl_imports=False`, and no advanced/JavaScript execution.
The data graphs are a finite explicit list in `tests/fixtures/expectations.json`;
the ontology is checked separately, never used to fetch or invent missing facts.
Additional resolved-reference test profiles are opt-in finite test graphs, not
new domain classes. Native Form membership is checked through `td:hasForm`, not
an assumed `hctl:Form` type triple. A binding annotation alone does not target a
control Form as media.

JSON parsing rejects duplicate members, non-JSON constants and overflow to
infinity. Explicit fixture probes cover integer tokens, rational reduction and
cross-products, pins, provenance kind, named Forms, JSON Pointers, native
operations, payload schemas, graph preservation and SPARQL cases. SHACL alone
does not enforce every rational/list/reference rule, finite RDF values, all
profile requirements, matching, lifecycle currentness or physical feasibility.
Those known limitations are tested and reported as limitations, not silently
turned into admission success. Original JSON is retained because RDF cannot
distinguish an absent unordered set from an explicitly empty JSON array.

The W3C schema is the exact immutable 2023 upstream representation, not the
different schema currently served at the publication URL. It declares Draft-07
but contains `prefixItems`, which Draft-07 ignores. Optional JSON Schema `format`
assertions are not enabled, avoiding undeclared optional packages. Passing this
structural schema is not complete TD 1.1 conformance. The actual context has no
remote scoped contexts/imports and all 153 schema references (40 distinct
targets) are local. The harness blocks network operations, even for unexpected
dereferencing attempts. `third_party/wot/manifest.json` records exact pins and
the applicable license; the native bytes are unmodified.

## Example admission boundary

The source and controller TDs are complete **synthetic advertisements**. The
saved Assignment is a counterfactual serialization with explicit negative
admission labeling, not an acceptance assertion. Its adapter qualification pin
has no bytes and is intentionally unresolved; its zero digest is a sentinel, not
a known checksum. The grant is expired at the fixed fixture evaluation instant.
Expected qualification-resolution failures must occur for validation to pass.
The controller request is unsent and its rejection receipt is synthetic. One
counterfactual accepted-envelope check tests schema shape only and is never
emitted as an accepted result.

The local cache contains 16 resolved pins, one explicit unresolved qualification
pin, and a deliberate controller/profile dependency cycle. The separate Live
query fixture has four unresolved configuration pins and unqualified identities.
Codec fragments have seven unresolved configuration pins, two unresolved Forms
and explicitly listed unqualified identities. Candidate queries prove none of
their missing operational facts. No HTTP requests, credentials, issuer checks,
decoding, acquisition, device tests, runtime admission or current-head lookup
are performed.
