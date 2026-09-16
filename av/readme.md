# AV

[Specification](spec.md) and [generated HTML](index.html) define the AV draft.
The root specification incorporates the normative
[term inventory](terms.json), [JSON-LD context](context.jsonld),
[ontology](ontology.ttl) and [SHACL constraints](av.shacl.ttl).
The inventory owns generated term prose; tools and reference behavior do not
override the specification.

[Examples](examples) are illustrative declarations.
[Sample queries](samples/queries) are executable supporting material.
[Tools and tests](tools), [readable reference](support/reference/terms.md),
[migration decisions](support/migration/specification-clarifications.md) and
[preserved history](support/history) are supporting material, not additional
normative sources.

AV retains seven classes, 29 AV properties and no mandatory AV profile families.
The 2026-09-16 processing clarifications retain the provisional AV 0.2 identities.
The [image-raster technical disposition](support/migration/dimensions-technical-disposition.md)
selects active image-raster dimensions and explicit legacy-description migration
for this local edition. It does not equate incompatible deployed display-size
semantics or infer unknown raster facts. Independent external editorial/domain
review remains unapproved; local rendering establishes neither hardware truth,
native transfer nor formal standards status.

Run `python -B av\tools\validate.py` from the repository root.
Shared publication and workspace commands are in the [root navigation](../readme.md).
