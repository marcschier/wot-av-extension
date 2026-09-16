# Migration from the deprecated 0.1 draft

**`0.2-proposed` is a breaking draft revision, not a compatible relabeling.**
It makes WoT optional read-only heterogeneous application integration and
returns native device operations to ONVIF, GenICam, UVC, or the actual source
interface. If ONVIF already meets the requirements, no AV migration or WoT
layer is needed.

The [active specification](../spec.md) defines **7 classes, 29 AV properties,
and zero mandatory AV profile families**. The
[generated reference](reference/terms.md) describes every active entry. Earlier
assignments, profiles, pins, and reported outcomes are historical, not hidden
optional dependencies of the new core.

## Distinct namespace, distinct meaning

| Item | Deprecated `0.1-proposed` | Active `0.2-proposed` |
| --- | --- | --- |
| Namespace | `https://example.org/wot/av#` | `https://example.org/wot/av/0.2#` |
| Context identifier | `https://example.org/wot/av/context/v0.1` | `https://example.org/wot/av/context/v0.2` |
| AV classes/properties | 38 / 105 | 7 / 29 |
| Mandatory AV profile families | 11 | 0 |
| Authority | Archived v0.1 specification and artifacts only. | Root specification and current inventory. |

Both namespaces are unregistered proposals and both context URLs are unhosted
placeholders. A new context URL alone would not isolate changed RDF meanings:
terms expand to IRIs according to their context. The new namespace therefore
applies consistently even to retained local names.[^jsonld]

Do not replace the old context's bytes, assert blanket equivalence, silently
rewrite old records, or claim v0.1 conformance for a 0.2 document. Existing
Thing identities and native Form targets do not need to change merely because
their optional AV annotations change.

## What changes at the application boundary

| Earlier mechanism | Active alternative and migration responsibility |
| --- | --- |
| MediaSource, Connector, Processor, Controller subclasses | Use native Things and their existing affordances. The publisher may add an Offer without declaring an AV role class. |
| Modes requiring acquisition/resource profiles | Publish only existing complete source/adapter interfaces. The device and administrator retain native configuration authority. |
| Typed constraints and wire/delivered requirement joins | The application author writes `av:accepts`, a self-contained JSON Schema 2020-12 over one deterministic Mode description. Explicitly require each hard fact. |
| Generic RationalConstraint ranges | Retain exact reduced Rational pairs. Enumerate acceptable exact rates where sufficient; general FPS inequalities require separate application validation, not rounding. |
| Transformation permissions and adapter-plan graphs | Use an explicitly exposed processor interaction if needed. Advertise its output only at a useful cross-application interface; internal conversions need no Thing. |
| DocumentPin dependency closure | `FormReference` supplies a TD location, named Form, and standard operation. Normal retrieval, versioning, caching, and authentication remain separate application concerns. |
| Assignment, leases, generation/fencing, readiness lifecycle | No core replacement. An ordinary application API may return its own selection/outcome record, without implying runtime success or physical transactions. |
| ResultContract, ProcessingRun, model and commit manifests | Reuse the producer's Property DataSchema, Action `output`, or Event `data`; optional result/destination FormReferences select native interactions. Existing model/artifact formats and optional provenance stay external. |
| AV Clip timeline/selector graph | Describe the whole finite item. Native media/container or explicitly exposed interactions own seeking, ranges, and timestamps. |
| Mandatory eleven-family AV profile system | Removed, not relocated. Deployment-specific schemas cannot be presented as prerequisites of the thin core. |

A missing representation fact is not supplied by a schema `default`.
Selecting a Mode does not configure its source, acquire media, allocate a
resource, or start processing. A destination reference does not create push
delivery. These are intentional capability reductions, not implementation
shortcuts.

## Byte-exact history and publication scope

The [v0.1 archive](history/v0.1-proposed/spec.md) belongs under
`av/support/history/v0.1-proposed/`. Its source is the **committed pre-migration HEAD**,
not the dirty working tree. Preserve the archived specification, inventory,
generated artifacts, tools, fixtures, manifests, and third-party notices as
a self-contained historical layout. Do not run the new generator over it or
pretty-print its JSON.

The existing public-standards-based
[research report](research/media-registry-research.md) and its added README
link were independent working-tree changes. Preserve them in the active
repository; do not backdate them into the byte-exact v0.1 snapshot.
The separate [research archive](research/archive/README.md) also retains
its own dates, source pins, and publication restrictions.

Active JSON uses expanded four-space formatting. That changes representation
hashes, so regenerate only the active derived artifacts and integrity
inventory after reviewing the authored changes. Do not change vendored W3C
bytes/notices or claim that new hashes describe the old corpus.

Use the [layered checks](validation.md) for the assembled active publication.
Historical passing checks or deliberately rejected v0.1 examples are not
test results for this revision, and no migration operation establishes
hardware interoperability.

[^jsonld]: W3C, [JSON-LD 1.1, the context and IRIs](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#the-context),
    Recommendation, 16 July 2020.
