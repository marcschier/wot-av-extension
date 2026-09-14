# Structural SHACL verification evidence

## Result and exact release fix

The original bundle passes pySHACL's meta-SHACL check and accepts the supplied RDF specimens without inference. The suspected native-Form typing/import dependency is **not present**. However, eight negative mutations expose one narrow semantic gap: contextual Rational signs are not enforced. The original accepts zero/negative rates and tick durations, negative rate bounds, and negative selector offsets despite the term inventory's sign requirements. The separate corrected copy rejects those eight cases and preserves all other 90 observed outcomes. This is structural verification, not admission or operational qualification.

Executed on 2026-09-14: **98 paired cases**, each against original and corrected shapes; original 54 conforming / 44 nonconforming, corrected 46 / 52. All expected outcomes matched. There were also 10 overlay/codec validation invocations; the original, corrected, and in-memory codec-extension bundles passed meta-SHACL. Evidence implementation: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:504-565`; assertions fail rather than converting errors into successful results.

**Merge only this sign-check delta into the release generator.** Preserve the signed primitive `RationalShape`; add two reusable, untargeted SHACL Core helper shapes and replace six nested `sh:node` references:

| Containing shape / property | Required nested shape | Constraint added to the existing Rational structure |
| --- | --- | --- |
| `TrackShape / av:frameRate` | `PositiveRationalShape` | `av:numerator sh:minExclusive 0` |
| `RationalConstraintShape / av:lowerRational` | `PositiveRationalShape` | Same |
| `RationalConstraintShape / av:upperRational` | `PositiveRationalShape` | Same |
| `TimestampMappingShape / av:timeBase` | `PositiveRationalShape` | Same |
| `TimeSelectorShape / av:start` | `NonNegativeRationalShape` | `av:numerator sh:minInclusive 0` |
| `TimeSelectorShape / av:end` | `NonNegativeRationalShape` | Same; full interval ordering remains external |

Both helpers use `sh:node av:RationalShape`, preserving exact numerator/denominator counts, integer datatypes, denominator positivity, and the existing local closure. Neither adds a class requirement, import, inference regime, or global target. `TimestampShape / av:time` and standalone Rational values remain signed. Source requirements: `media-research\wot-av-formal-v0.1.terms.json:175-176`, `:212-216`. Delta implementation: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:134-181`.

The eight demonstrated repairs were frame-rate numerator `0` and `-1`, time-base numerator `0` and `-1`, lower rate-bound numerator `-1`, upper rate-bound numerator `0`, selector start `-1`, and selector end `-1`. Each originally conformed. The first six now report `MinExclusiveConstraintComponent` through `NodeConstraintComponent`; the last two report `MinInclusiveConstraintComponent` through `NodeConstraintComponent`. Mutation definitions: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:314-395`.

This deliberately does not turn the advertised structural subset into a complete validator. In release coverage, explicitly retain the external checks listed below; do not describe contextual positivity as proving gcd, interval ordering, or readiness.

## Persistent copy, replay, and isolation

| Artifact | Absolute path | Line / triple count |
| --- | --- | --- |
| Original, unchanged | `media-research\wot-av-formal-v0.1.shacl.ttl` | 1,737 lines; 2,817 triples before engine processing |
| Working corrected copy | `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.shacl.ttl` | **1,753 lines; 2,829 triples** |
| Reproducible delta and probes | `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py` | Generates only the sibling reviewed copy |

Corrected-copy references: frame rate `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.shacl.ttl:1124-1128`; lower/upper bounds `:1468-1478`; time base `:1525-1529`; selector start/end `:1673-1682`; helper definitions `:1739-1753`.

The first chosen command was installed-Python validation, `python -m pyshacl -i none -m -s <original.shacl.ttl> <original.ttl>`. It failed with `No module named pyshacl` before validation. Only then was pySHACL installed into the unique TEMP venv below, using `--system-site-packages` to reuse the already installed PyLD/rdflib. No global, repository, or user-extension installation was performed. Observed versions: **pySHACL 0.40.1, rdflib 7.6.0, PyLD 3.1.0**.

```powershell
& 'isolated-runtime\Scripts\python.exe' 'media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py' --emit-copy
```

The replay asserts every expected outcome, meta-SHACL, copied-graph equivalence, and unchanged source hashes. An existing different reviewed copy is not overwritten. Original candidate generators, verifiers, fixtures archive, narrative files, release files, and repository files were not read or edited. The additional context files were read only because offline expansion requires their pinned bytes. No cameras, live services, infrastructure jobs, commits, or pushes were used. Installation/public normative-source retrieval is separate from the strictly offline RDF processing.

All engine calls pass graph objects with `inference="none"`, `do_owl_imports=False`, `advanced=False`, and `js=False`. No ontology graph is supplied to validation. Meta-SHACL is the engine's bundled SHACL-for-SHACL check, not an exhaustive certification claim. The engine receives cloned graphs, so its in-memory bookkeeping cannot alter the source graphs or files. Invocation and loader: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:66-92`, `:98-132`; source/copy guards `:612-626`.

## Graph boundary: asserted descriptions versus lookup-only references

The actual offline expansions contained **54 camera, 138 Need, and 242 records triples**, with a 434-triple supplied union. All conformed to both bundles, but these are checks of the supplied material, not proof that every external reference resolves. In particular, the supplied union lacks a description of `urn:example:processor:opencv`; a separate test explicitly adds a synthetic `av:Processor, td:Thing` declaration, producing 436 triples. That addition is test data, not inferred or remotely fetched evidence. Corpus construction: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:209-226`.

A separate **20-triple true structural-positive Need graph** explicitly includes the Need, Processor, InputRequirement, InputAlternative, and delivered TrackRequirement descriptions. All class-valued links in that small graph are checked to point at those asserted descriptions; its logical revision-series identifier is only an identity reference. A further positive adds a fully described preference and typed choice goal. These are not dangling-IRI substitutes for complete positives. Fixture and closure assertions: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:228-250`, `:264-269`.

The original intentionally checks many durable cross-record links as `sh:IRI`, not recursively complete descriptions. Replacing the Need's input with a dangling IRI therefore still conforms; an explicitly typed InputRequirement missing its identifier is rejected. Both observations are retained and labeled separately. Do not claim that the first graph is a full resolved Need. A tested, **opt-in** SHACL Core overlay applies `sh:node av:InputRequirementShape` at `av:Need / av:input` and rejects the dangling input while accepting the full fixture. That one-edge demonstration is not a complete reference-resolution profile. Sources: `media-research\wot-av-formal-v0.1.shacl.ttl:796-813`; probes/overlay `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:251-258`, `:539-544`.

**Policy for the release:** construct a finite validation graph from the chosen documents and explicitly resolved descriptions; declare which references are intentionally lookup-only. Target explicitly asserted AV classes. Apply reusable `sh:node` shapes to intrinsic values, including untyped nested values. Polymorphic choice/rational/integer constraint branches and preference goals retain their deliberate explicit AV class discriminants; these do not require RDFS imports. Unregistered contexts are rejected by the controlled loader, not fetched. Source policy: `media-research\wot-av-formal-v0.1.terms.json:362-365`; successful untyped and negative type probes `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:270-274`, `:318-322`.

## WoT Forms and operation mapping

The camera's native named Form has **no explicit `rdf:type`**, and its actual operation triple is:

```turtle
<urn:example:form:camera7:media>
    <https://www.w3.org/2019/wot/hypermedia#hasOperationType>
    <https://www.w3.org/2019/wot/td#readProperty> .
```

The Form is an object of `td:hasForm`; native `href` expands to an `hctl:hasTarget` **`xsd:anyURI` literal**, not the identity of the Form. The original accepts this data because `MediaFormShape` targets **subjects of `av:mediaDirection`**, not `sh:targetClass hctl:Form`, and adds no Form class requirement. Adding an artificial `sh:class hctl:Form` restriction demonstrably fails with `ClassConstraintComponent`. Therefore **do not add that restriction or silently require entailment**. Exact projection assertions: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:399-404`, `:527-532`; original shape `media-research\wot-av-formal-v0.1.shacl.ttl:587-624`.

Missing binding/locality is rejected on an explicitly media-annotated Form. `HostLocal` without host is rejected and with host accepted. A control-only binding annotation does not create a media target. Removing the selected Form's media-direction annotation, however, removes automatic targeting and still conforms. This is the explicitly documented reference/profile gap, not a reason to target every native/control Form. A tested resolved-media Mode overlay invokes `MediaFormShape` at `av:form` and catches that omission without adding a class assertion. Evidence: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:405-417`, `:532-538`; declared policy `media-research\wot-av-formal-v0.1.terms.json:328-333`.

## Conditions, Rational structure, optional properties, and lists

| Area | Actual accepted/rejected evidence; unchanged except the sign delta |
| --- | --- |
| Four condition names | Exactly one each of `MediaObserved`, `ApplicationReady`, `ModelLoaded`, `ResultCommitted` accepts. Three/five conditions, four nodes with a duplicated name, and one node carrying two names reject. |
| Ready | `Ready` with `ApplicationReady Unknown` rejects. `ApplicationReady True` without evidence rejects; with an evidence IRI it accepts even if `ModelLoaded` is Unknown/NotApplicable. This is deliberately not proof that a model-dependent run may start. |
| ModelLoaded evidence/scope | True without evidence rejects. An arbitrary evidence IRI accepts; exact accepted model/configuration/holder correspondence and authenticity are not checked. `av:scope` on Condition rejects because that predicate belongs to LeaseGrant, not Condition. |
| NotApplicable eligibility | In non-Ready status, MediaObserved/ApplicationReady NotApplicable still accepts structurally. The lifecycle contract disallows this usage; condition-specific eligibility and obligation checks remain external and must be named explicitly in coverage. |
| Rational | Missing/extra numerator or denominator, nonpositive denominator, numeric string, double-valued integer, and extra unlisted properties reject. Arbitrarily large exact integers, signed primitive values, and untyped nested valid Rational structures accept. Unreduced `60/2` still accepts; an independent `math.gcd(60, 2)` check detects nonreduction. |
| Optional properties | Omitted optional queue fields and timestamp-mapping companions without a reference clock accept. A reference clock requires configuration and known uncertainty. Lower-only or upper-only integer/rational bounds accept; neither rational bound rejects. Integer reversed bounds reject; rational reversed bounds remain external. |
| Preferences/list precision | Absent preferences, `rdf:nil`, and repeated valid members in an ordered list accept. Missing preference goal, literal list head, or multiple heads reject. A dangling list head and a cycle with valid reachable members accept: the property path checks reachable members, **not list topology/length/order-based ranking**. |
| Open Things | Native/unrelated Thing properties remain accepted. Exactly the original eight intrinsic shapes stay closed; no worldwide `sh:closed` is added to Things, domain records, or provenance classes. |

Condition cases and policy: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:419-468`; `media-research\wot-av-formal-v0.1.terms.json:245-245`, `:355-356`. Rational cases: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:290-322`. Optional/list/closure cases: same absolute harness `:264-288`, `:333-372`, `:488-498`, `:612-618`.

## JSON preflight and RDF information loss

The controlled experiment distinguishes two operations: direct PyLD expand/compact preserved an empty `av:allowedPreprocessing: []`, but conversion to RDF produced **the same graph as omission**. Reconstructing JSON-LD from that RDF and compacting omitted the property. A set container keeps nonempty compact values array-shaped; it cannot recover an empty JSON member from RDF. The supplied Assignment's explicit `av:omitted: []` likewise yields no corresponding RDF triple.

An empty `@list` is different: empty `av:preferences` produces `av:preferences rdf:nil`, so do not generalize the empty-set loss to lists. JSON-level preflight is required whenever original member presence, array syntax, duplicate keys/IDs/names, or explicit omission records matter. Optional empty permission sets mean no permission; this is not a proposal to reject every empty optional array. A required ChoiceConstraint allowed-values set is separately enforced as nonempty by `sh:minCount 1`. Reproducible checks: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:567-610`, `:484-487`; inventory convention `media-research\wot-av-formal-v0.1.terms.json:29-33`.

## H265/Opus integration, provenance, and explicit limits

**The corrected copy intentionally retains the original codec enum.** The original H265-video and Opus-audio negative expectations remain unchanged in both files. A separate in-memory release extension modifies exactly three `sh:in` lists: add H265 and Opus to the generic Track codec list, H265 to the EncodedVideo branch, and Opus to the EncodedAudio branch. H265 video and Opus audio then accept; Opus video and H265 audio reject; that extended graph also passes meta-SHACL. The release must keep its own term inventory/vocabulary and any affected generated artifacts consistent; no release file was changed here. Probe implementation: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:500-502`, `:546-565`.

PROV class axioms remain descriptive RDF. An actual declared `av:ProcessingRun` structure passes without importing PROV or materializing `prov:Activity`; deleting required `prov:used` rejects because the AV shape explicitly constrains that property. Adding a superclass axiom/role assertion does not establish truthful use, generation, execution, or role consistency. Evidence: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:259-262`, `:470-482`; vocabulary axioms are read separately, not supplied as validation constraints.

Retained limits, observed rather than disguised as positives: gcd/reduced fractions and rational cross-products; equal/reversed selector endpoints; list topology/length; positive infinity in a milliseconds field; field-specific ChoiceConstraint enum applicability; context/pin/reference integrity and full graph closure; native operation defaults/compatibility/authorization; NotApplicable eligibility and exact scoped evidence; currentness, model obligation, matching, admission, native protocol behavior, hardware readiness, grants/fencing, or real provenance. Examples of intentional accepts are unreduced `60/2`, equal interval ends, `INF`, an arbitrary codec choice IRI, and an arbitrary evidence IRI. These require documented JSON/application/profile checks; neither meta-SHACL nor provenance class declarations discharge them. Source coverage: `media-research\wot-av-formal-v0.1.coverage.json:1-15`; probes cited above and `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:484-498`.

## Primary normative sources

- [SHACL class constraints](https://www.w3.org/TR/shacl/#ClassConstraintComponent), definitions in section 1.1, and section 1.5: class membership follows supplied `rdf:type` and `rdfs:subClassOf` paths; full RDFS inferencing is not required. A range axiom alone is not a portable substitute for explicit typing.
- [SHACL targets](https://www.w3.org/TR/shacl/#targets): class targets select SHACL instances, while subjects-of/objects-of targets select existing predicate endpoints without manufacturing class assertions. `sh:targetObjectsOf td:hasForm` can select untyped native Forms when appropriate, but targeting every Form with media requirements would be the wrong policy here.
- [SHACL node constraints](https://www.w3.org/TR/shacl/#NodeConstraintComponent): `sh:node` applies the referenced shape to the supplied value node; its target declarations do not independently require a class on that value.
- [SHACL Core constraint components](https://www.w3.org/TR/shacl/#core-components): property-pair constraints provide equality/disjointness/ordering, not a general gcd operation. This bundle's reduced-fraction and cross-product rules need separate arithmetic validation.
- [JSON-LD 1.1 to-RDF algorithm](https://www.w3.org/TR/json-ld11-api/#deserialize-json-ld-to-rdf-algorithm), especially step 1.3.2.5: ordinary property triples are emitted for each value. Empty ordinary sets emit none. Section 8.3 separately maps an empty RDF list to `rdf:nil`.
- [RDF 1.1 graphs](https://www.w3.org/TR/rdf11-concepts/#section-rdf-graph): an RDF graph is a set of triples; a reference triple does not itself add a resource's description. SHACL [closed shapes](https://www.w3.org/TR/shacl/#ClosedConstraintComponent) forbid unlisted predicates, while required presence is a separate [minimum-count](https://www.w3.org/TR/shacl/#MinCountConstraintComponent) constraint.

## Exact byte identities

SHA-256 was computed before and after the successful run; all ten original inputs were unchanged. These identify the actual tested bytes, not a claim that embedded DocumentPin records were verified. Hash implementation and guards: `media-research\wot-av-shacl-reviewed-64c41574-c0b3ae29.build-delta.py:25-42`, `:63-64`, `:619-626`.

| Tested input / copy | SHA-256 |
| --- | --- |
| `wot-av-formal-v0.1.shacl.ttl` | `c8fa9ce24fb5a8036a925cca9be6bc977fce1eddbf6867a256f39524591c5e3f` |
| `wot-av-formal-v0.1.ttl` | `e807d0ca1eafb98a830fea8635aad382fb53de87fdd854cb7c915176d026065e` |
| `wot-av-formal-v0.1.terms.json` | `bd8d7b56cb95fdef0b372a5cbf1741d607e945fc29a00ac100580e5e59751151` |
| `wot-av-formal-v0.1.camera.td.json` | `c95e8c02bf3b78e2b782fe562d47ae365d0cf982351724a9e1ddd0bc3d6deeac` |
| `wot-av-formal-v0.1.need.jsonld` | `43e192ba0e63792a9b58c9e5b419730e7bd6c9a144ed5b90decd1cf79731944a` |
| `wot-av-formal-v0.1.records.jsonld` | `8fb0542031d26b29e1c93cdbd45ae9351e9add0869f1c6100d9a5728a21cb54d` |
| `wot-av-formal-v0.1.checks.json` | `4147c60b857124d9597e4ba1f7eb2cdcf40088d7afe9c751db7ec04881d143eb` |
| `wot-av-formal-v0.1.coverage.json` | `479d80f66d97fe41366b51d89e506d795c752860c828a8e05df61618ea8718c9` |
| `wot-av-formal-v0.1.context.jsonld` | `7f8773169709682ff39f1cc18a793221044fb909890963913b6117b660212057` |
| `wot-av-formal-v0.1.native-td-context.jsonld` | `9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069` |
| `wot-av-shacl-reviewed-64c41574-c0b3ae29.shacl.ttl` | `58b556fea8df027c93626d38906394dee487509c6438fd1ebacfef83b923abbf` |

All names in this table are under `media-research\`. No original or release artifact was updated to manufacture these results.
