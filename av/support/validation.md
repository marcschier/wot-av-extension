# Layered generation and validation

**Draft `0.2-proposed`: offline description checks are not native
interoperability checks.** The active target is seven AV classes, 29 AV
properties, and zero mandatory AV profile families. A valid description can
still be incompatible with a Need; compatible metadata can still be unusable
by a particular decoder, unauthorized, stale, or unavailable.

See the [main specification](../spec.md), the
[per-entry reference](reference/terms.md), and the [native ONVIF boundary](../../onvif/support/notes/onvif-integration.md).
This document describes check scope and interpretation, not a stored claim
that a particular assembled revision has passed.

## Run the assembled publication checks

Use Python 3.10 or newer with the dependencies in
[requirements-dev.txt](../../requirements-dev.txt). Installing those dependencies
is a separate setup step; the [README](repository-overview.md#local-setup-and-checks)
gives the PowerShell commands.

From the repository root:

```powershell
python -B av\tools\generate.py --check
python -B av\tools\check_docs.py
python -B av\tools\validate.py
```

These are inspection commands, not requests to configure a device, acquire
media, repair an input, or reseal a mismatch. Read the actual check output and
exit status for the assembled working tree. A missing dependency or missing
cross-file artifact is a blocker, not a successful validation or a hardware
failure. Historical fixture counts and previous passing runs do not establish
the outcome of this revision.

After an intentional, reviewed change to the authored inventory, examples, or
generation rules, regeneration is explicit:

```powershell
python -B av\tools\generate.py
python -B av\tools\check_docs.py
python -B av\tools\validate.py
python -B av\tools\generate.py --check
```

Do not regenerate merely to suppress an unexplained integrity failure.
Generation changes active derived artifacts and their publication hashes;
it is not a runtime pin or assignment protocol.

## What each layer establishes

| Layer / input | What to establish | What it does not establish |
| --- | --- | --- |
| Strict JSON and formatting / original files and fences | Parseable JSON without duplicate members, non-JSON constants, or non-finite values; exact numeric handling and required four-space formatting. | Meaning, native access, or media payload validity. |
| Native TD structure / complete TDs | Structure against the pinned W3C schema, keeping native affordances, Forms, operations, DataSchemas, and security. | Complete TD 1.1 conformance or a working protocol binding. |
| JSON-LD and RDF constraints / selected finite graphs | Correct namespace/context use, known AV terms, cardinalities, representation fields, identities, and applicable shapes. | Every original-JSON omission, numeric-token rule, schema reference, or native behavior. |
| Resolved native references / original TD and explicit location | Source identity, unique named Form membership, operation compatibility, and preservation of native bases/defaults. | Immutable bytes, publisher trust, reachability, or permission. |
| Mode-description schema / one normalized Mode and `accepts` | Self-contained 2020-12 schema evaluation against the deterministic descriptor, with no injected defaults. | Media decoding, layout qualification, scheduling, simultaneous availability, or execution. |
| Documentation and generation / authored inventory and publication | Per-entry who/what/how/defaults, resolvable excerpt pointers, current generated outputs, and explicitly scoped integrity. | Correct camera firmware, timing, authorization, inference quality, or durable results. |
| Native implementation / deployed device, adapter, processor, and receiver | Protocol support, authentication, negotiation, actual media/results, and application-specific operational requirements. | **Not performed by the repository's offline description checks.** |

WoT defines native affordances and payload schemas; JSON-LD defines semantic
expansion, while SHACL validates data graphs against shapes. These are
different inputs and validation targets.[^td][^jsonld][^shacl]

An `av:accepts` object is carried as an opaque JSON-LD JSON literal.
Its schema keys, including strings such as `"av:width"` inside `properties`,
are not asserted AV predicates. Do not recursively audit them as if they
were Track fields, or expand them into additional RDF nodes.[^jsonld]

Keep original JSON alongside RDF where a rule depends on member duplication,
explicit presence, integer token spelling, or an empty array. RDF shape
success alone cannot substitute for those checks.

## Metadata comparison, omissions, and expected failures

The [deterministic comparison value](../spec.md#deterministic-comparison-value)
contains only `av:source`, `av:kind`, and identifier-sorted `av:track`
descriptions. It excludes Mode/Track IDs, contexts, native targets, and security.
All compared tracks come from the same complete Mode.

The compact-input comparator accepts fixed compact keys and their equivalent
full 0.2 IRIs. It is not a general resolver for arbitrary aliases or remote
graph references: other JSON-LD serializations need explicit processing into
the documented input representation first. Exact source integers, including
typed lexical integers, normalize to exact descriptor integers without
floating-point rounding.

| Case | Required interpretation |
| --- | --- |
| A concrete video Track omits width or height. | Invalid concrete Mode description. Do not use a camera maximum or default value. |
| A schema makes width a hard requirement but the descriptor lacks it. | Non-match through `required`, not a successful partial match. |
| `properties` constrains width without `required`. | The constraint is conditional on presence. It is not automatically a hard-presence test. |
| A schema contains `default: 1280`. | Annotation only; leave the descriptor unchanged. |
| A schema contains `format: "uri"`. | Annotation only in this core; no format assertion, authentication, or network probe. |
| `$schema` is omitted. | Use the explicitly defined 2020-12 default; do not guess another dialect. |
| A different dialect or unresolved/external reference is required. | Report schema/validation error; never convert it to compatibility. |
| A schema uses positional `prefixItems`, a custom keyword, or an unsupported vocabulary. | Report an unsupported contract; no array-position matching or silent omission of a purported hard condition. |
| A requirement wants exact `30/1`, but the Mode declares `30000/1001`. | Non-match. No floating-point rounding or general rational-inequality shortcut. |
| Audio and video match only in different Modes. | No joint compatible Mode. Do not merge their track rosters. |
| A JPEG source is compared with a raw-RGB input contract. | Direct non-match. Conversion requires an explicitly supported native path, not a metadata side effect. |
| An Optional input is selected. | Its entire schema still applies; Optional permits omission, not weakened facts. |
| A result/destination reference resolves structurally. | The native producer/receiver schemas and supported interaction still govern actual access and delivery. |

The distinction between `required`, conditional property validation,
annotation-only `default`, and the separate format vocabularies comes from
JSON Schema. The self-contained schema boundary and dialect default are
explicit restrictions of this AV draft.[^schema-core][^schema-validation]
Local `$ref`/`$dynamicRef` values begin with `#` and resolve inside the supplied
`accepts` value. These checks do not enable a general remote schema loader.

A checker can intentionally exercise invalid examples or non-matches. Its
summary MUST distinguish expected failures from unexpected failures and
known limitations; "checks passed" does not mean that every supplied example
was accepted. No old counterfactual Assignment is relabeled as a successful
0.2 run.

## Native TD baseline and limitations

The [vendored provenance manifest](upstream/wot/manifest.json) identifies
the exact W3C context/schema copies, upstream revision
`87808f1644ba79eb0a58d238385a8bd4a2236853`, byte hashes, and notices.
The schema at a mutable publication URL must not silently replace that copy.

The pinned schema declares Draft-07 and contains `prefixItems`, which is not
a Draft-07 assertion. Its structural check and optional `format` behavior
are not equivalent to checking every TD 1.1 requirement.
The **native TD schema dialect** and the **2020-12 descriptor schema dialect**
must therefore stay separate.[^pinned-schema][^schema-dialects]

Resolving a FormReference must use real native `forms` membership, not a
matching `@id` elsewhere in the graph, a copied `href`, or a presumed first
Form. Resolve the chosen operation according to the original TD's supported
operations and native defaults. Preserve explicit `base`, effective retrieval
location, URI variables, and security inheritance. A reference itself grants
no permission to invoke an operation.[^td]

Offline context/schema mappings are a tooling choice, not a claim that the
unhosted AV context URL is available on the network. Unknown dependencies
must remain errors. Shape evaluation uses explicitly supplied data/shapes;
it must not fetch arbitrary imports or invent missing source facts.

## Documentation, formatting, and integrity

The authored [term inventory](../terms.json) owns the definitions
and explanatory metadata. The generated [reference](reference/terms.md) gives a
stable section for each class/property and controlled value, including:
who defines/authors it, what it describes, who uses it and how, applicable
units/cardinality, omission/default behavior, and an example or boundary.
Metadata added for documentation must not become runtime AV properties.

Root examples use an adjacent HTML comment containing `example:` followed by
a repository-relative file and JSON Pointer, for example
`example: av/examples/source.td.json#/properties/snapshot`.
The following JSON fence is a literal excerpt, not an independently editable
copy. A complete document uses an empty pointer after `#`. Derived descriptor
illustrations are labeled as derived rather than falsely marked as literals.
The pointer identifies a fragment in the local source, not an HTTP fragment
service.[^pointer]

First-party active JSON/JSON-LD files and fences use four spaces; nonempty
objects/arrays are expanded, opening delimiters stay on the property line,
and each field appears on its own line. Empty `{}`/`[]` may remain inline.
Formatting must preserve strings, escapes, integer/exponent/fractional tokens,
and semantics; do not silently round-trip exact values through floating point.

Generation owns context, ontology, shapes, catalogue, and its listed derived
publication outputs. It must not overwrite authored examples or root prose.
The release manifest inventories an explicit active scope and excludes its
own hash. Preserve `.gitattributes`: byte integrity includes line endings.
Publication hashing is not evidence that a runtime TD is immutable or trusted.

The [v0.1 archive](history/v0.1-proposed/spec.md), separate
[research archive](research/archive/README.md), and vendored W3C files
retain their own bytes and notices. They are not bulk-formatting targets.
Use [migration guidance](migration.md) for the distinction between historical
snapshots, independently preserved research changes, and the active draft.

[^td]: W3C, [WoT Thing Description 1.1, vocabulary and validation](https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#sec-vocabulary-definition),
    Recommendation, 5 December 2023.
[^jsonld]: W3C, [JSON-LD 1.1, JSON literals](https://www.w3.org/TR/2020/REC-json-ld11-20200716/#json-literals),
    Recommendation, 16 July 2020.
[^shacl]: W3C, [Shapes Constraint Language](https://www.w3.org/TR/2017/REC-shacl-20170720/),
    Recommendation, 20 July 2017.
[^schema-core]: JSON Schema, [2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core).
[^schema-validation]: JSON Schema, [2020-12 Validation](https://json-schema.org/draft/2020-12/json-schema-validation).
[^pinned-schema]: W3C TD repository at `87808f1644ba79eb0a58d238385a8bd4a2236853`,
    [schema declaration, lines 1-15](https://github.com/w3c/wot-thing-description/blob/87808f1644ba79eb0a58d238385a8bd4a2236853/validation/td-json-schema-validation.json#L1-L15);
    exact local copy and recorded limitations in [the provenance manifest](upstream/wot/manifest.json).
[^schema-dialects]: JSON Schema, [Draft-07 validation](https://json-schema.org/draft-07/draft-handrews-json-schema-validation-01)
    and [2020-12 Core, array applicators](https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.1).
[^pointer]: IETF, [RFC 6901: JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901.html).
