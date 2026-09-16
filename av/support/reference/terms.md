# WoT AV 0.2 - complete thin-core reference

**Local breaking draft; namespace unregistered and context unhosted.** `av/terms.json` defines 7 classes, 29 AV properties and 17 directly reused external mappings. Only `dcterms:identifier` adds a required external field on Tracks/inputs. There are **zero mandatory AV pinned-profile families**.

Documentation metadata is authoring-only, not an AV payload. Domains are alternative uses, not global RDFS intersections. `*` is unbounded. Every per-use responsibility, absence rule and example is explicit below. A fragment is not a runnable camera request.

Metadata matching does not establish authorization, availability, decoder qualification or runtime acceptance. Native controls and payload schemas remain authoritative.

## Entry index

- [av:Offer - class](#class-offer)
- [av:Mode - class](#class-mode)
- [av:Track - class](#class-track)
- [av:Rational - class](#class-rational)
- [av:Need - class](#class-need)
- [av:InputRequirement - class](#class-inputrequirement)
- [av:FormReference - class](#class-formreference)
- [av:offer - property](#property-av-offer)
- [av:need - property](#property-av-need)
- [av:source - property](#property-av-source)
- [av:mode - property](#property-av-mode)
- [av:kind - property](#property-av-kind)
- [av:form - property](#property-av-form)
- [av:track - property](#property-av-track)
- [av:representation - property](#property-av-representation)
- [av:width - property](#property-av-width)
- [av:height - property](#property-av-height)
- [av:codec - property](#property-av-codec)
- [av:pixelFormat - property](#property-av-pixelformat)
- [av:cadence - property](#property-av-cadence)
- [av:frameRate - property](#property-av-framerate)
- [av:sampleRate - property](#property-av-samplerate)
- [av:channels - property](#property-av-channels)
- [av:channelLayout - property](#property-av-channellayout)
- [av:sampleFormat - property](#property-av-sampleformat)
- [av:bufferLayout - property](#property-av-bufferlayout)
- [av:numerator - property](#property-av-numerator)
- [av:denominator - property](#property-av-denominator)
- [av:processor - property](#property-av-processor)
- [av:input - property](#property-av-input)
- [av:presence - property](#property-av-presence)
- [av:document - property](#property-av-document)
- [av:operation - property](#property-av-operation)
- [av:accepts - property](#property-av-accepts)
- [av:result - property](#property-av-result)
- [av:destination - property](#property-av-destination)
- [dcterms:identifier - property](#property-dcterms-identifier)
- [dcterms:isVersionOf - property](#property-dcterms-isversionof)
- [dcterms:format - property](#property-dcterms-format)
- [dcterms:conformsTo - property](#property-dcterms-conformsto)
- [dcterms:description - property](#property-dcterms-description)
- [dcterms:title - property](#property-dcterms-title)
- [dcterms:creator - property](#property-dcterms-creator)
- [dcterms:publisher - property](#property-dcterms-publisher)
- [dcterms:license - property](#property-dcterms-license)
- [dcterms:references - property](#property-dcterms-references)
- [prov:used - property](#property-prov-used)
- [prov:wasGeneratedBy - property](#property-prov-wasgeneratedby)
- [prov:wasDerivedFrom - property](#property-prov-wasderivedfrom)
- [prov:wasAssociatedWith - property](#property-prov-wasassociatedwith)
- [prov:wasAttributedTo - property](#property-prov-wasattributedto)
- [prov:startedAtTime - property](#property-prov-startedattime)
- [prov:endedAtTime - property](#property-prov-endedattime)
- [av:Live - controlled value](#value-mediakind-live)
- [av:Still - controlled value](#value-mediakind-still)
- [av:Clip - controlled value](#value-mediakind-clip)
- [av:EncodedVideo - controlled value](#value-representation-encodedvideo)
- [av:RawVideo - controlled value](#value-representation-rawvideo)
- [av:EncodedAudio - controlled value](#value-representation-encodedaudio)
- [av:PCM - controlled value](#value-representation-pcm)
- [av:H264 - controlled value](#value-codec-h264)
- [av:JPEG - controlled value](#value-codec-jpeg)
- [av:AAC - controlled value](#value-codec-aac)
- [av:H265 - controlled value](#value-codec-h265)
- [av:Opus - controlled value](#value-codec-opus)
- [av:BGR8 - controlled value](#value-pixelformat-bgr8)
- [av:RGB8 - controlled value](#value-pixelformat-rgb8)
- [av:Mono8 - controlled value](#value-pixelformat-mono8)
- [av:YUV420P - controlled value](#value-pixelformat-yuv420p)
- [av:Constant - controlled value](#value-cadence-constant)
- [av:Variable - controlled value](#value-cadence-variable)
- [av:Triggered - controlled value](#value-cadence-triggered)
- [av:Mono - controlled value](#value-channellayout-mono)
- [av:StereoLR - controlled value](#value-channellayout-stereolr)
- [av:S16LE - controlled value](#value-sampleformat-s16le)
- [av:F32LE - controlled value](#value-sampleformat-f32le)
- [av:Contiguous - controlled value](#value-bufferlayout-contiguous)
- [av:Strided - controlled value](#value-bufferlayout-strided)
- [av:Interleaved - controlled value](#value-bufferlayout-interleaved)
- [av:Planar - controlled value](#value-bufferlayout-planar)
- [av:Required - controlled value](#value-presence-required)
- [av:Optional - controlled value](#value-presence-optional)
- [td:readProperty - controlled value](#value-nativeoperation-td-readproperty)
- [td:writeProperty - controlled value](#value-nativeoperation-td-writeproperty)
- [td:observeProperty - controlled value](#value-nativeoperation-td-observeproperty)
- [td:unobserveProperty - controlled value](#value-nativeoperation-td-unobserveproperty)
- [td:readAllProperties - controlled value](#value-nativeoperation-td-readallproperties)
- [td:writeAllProperties - controlled value](#value-nativeoperation-td-writeallproperties)
- [td:readMultipleProperties - controlled value](#value-nativeoperation-td-readmultipleproperties)
- [td:writeMultipleProperties - controlled value](#value-nativeoperation-td-writemultipleproperties)
- [td:observeAllProperties - controlled value](#value-nativeoperation-td-observeallproperties)
- [td:unobserveAllProperties - controlled value](#value-nativeoperation-td-unobserveallproperties)
- [td:invokeAction - controlled value](#value-nativeoperation-td-invokeaction)
- [td:queryAction - controlled value](#value-nativeoperation-td-queryaction)
- [td:cancelAction - controlled value](#value-nativeoperation-td-cancelaction)
- [td:queryAllActions - controlled value](#value-nativeoperation-td-queryallactions)
- [td:subscribeEvent - controlled value](#value-nativeoperation-td-subscribeevent)
- [td:unsubscribeEvent - controlled value](#value-nativeoperation-td-unsubscribeevent)
- [td:subscribeAllEvents - controlled value](#value-nativeoperation-td-subscribeallevents)
- [td:unsubscribeAllEvents - controlled value](#value-nativeoperation-td-unsubscribeallevents)

<a id="class-offer"></a>
## `av:Offer` (class)

One source Thing's discoverable set of alternative complete media Modes.

**Value / identity:** `iri`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** One source Thing's discoverable set of alternative complete media Modes.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Identify the Offer with an absolute @id; supply source, document and one or more Modes.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (not-applicable):** No offer annotation means no AV media advertisement, not absence of native camera capabilities.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

**Edition-specific definition and counterexample:**

An Offer is one source Thing's discoverable set of alternative complete media
Modes. The source or adapter publisher authors it from known native interface
facts. A consumer compares its Modes individually and retains the selected
native access coordinates.

**Required:** absolute `@id`, explicit `av:Offer` type, one `av:source`, one
`av:document`, and a nonempty `av:mode` set. The located TD must identify the
source Thing. Absence of an Offer means no AV advertisement, not absence of
native capability. It gives no authorization or availability guarantee.
Example: the JPEG Offer in [the publication example](../../spec.md#example-offer).
Counterexample: an Offer containing independent width and codec options,
but no complete Mode, is invalid.

<a id="class-mode"></a>
## `av:Mode` (class)

One jointly offered media-kind, native-Form and complete simultaneous Track combination.

**Value / identity:** `iri`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** One jointly offered media-kind, native-Form and complete simultaneous Track combination.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use an absolute @id, kind, form and nonempty track set; source operation details remain in the native TD.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (not-applicable):** Do not synthesize missing combinations by taking independent maxima or tracks from other Modes.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

**Edition-specific definition and counterexample:**

A Mode is one jointly offered combination of media kind, one native Form,
and the complete simultaneous Track roster. The publisher authors the
combination, not a matcher assembling independent capability maxima.

**Required:** absolute `@id`, explicit `av:Mode` type, one `av:kind`, one
`av:form`, and a nonempty `av:track` set. A consumer tests the whole Mode
without changing it. Omission never permits synthesis of a missing
combination. Example: one Live H.264-plus-AAC interface. Counterexample:
video from one Mode plus audio from another is not a third offered Mode.

<a id="class-track"></a>
## `av:Track` (class)

One named simultaneous encoded or raw component at this Thing's offered interface.

**Value / identity:** `iri`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** One named simultaneous encoded or raw component at this Thing's offered interface.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use an absolute @id and dcterms:identifier unique within the Mode; state representation and applicable actual media fields.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (not-applicable):** Track roster is complete. Missing essential fields invalidate the concrete description; optional absent facts remain unknown.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

A Track is one named encoded or raw component at the offered interface.
The publisher supplies actual representation facts; the consumer checks
only facts that are both declared and applicable.

**Required:** absolute `@id`, explicit `av:Track` type, one nonempty
`dcterms:identifier`, one `av:representation`, and all fields required by
the [representation matrix](../../spec.md#representation-matrix). Names and identities
are unique within a Mode. Missing essential facts invalidate the concrete
Mode; optional absent facts remain unknown. Example: a JPEG picture Track
with actual dimensions. Counterexample: a video Track with no height is
not an unconstrained-height offer.

<a id="class-rational"></a>
## `av:Rational` (class)

An exact reduced integer numerator and positive integer denominator.

**Value / identity:** `node`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The explicitly supplied exact integers; av:frameRate supplies frames per media-second as the unit.

**Describes:** An exact reduced integer numerator and positive integer denominator.

**Used by:** A matcher preserves exact integer pairs rather than rounding frame rates.

**How to specify:** Use numerator and denominator; frameRate requires a positive value. Reuse existing exact-integer and gcd rules.

**Boundary:** No generic clock model, cross-field arithmetic guarantee, runtime throughput or delivered-losslessness claim.

**Defaults / omission (not-applicable):** No denominator-one or nominal-rate fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/rational`.

```json
{
    "@type": "av:Rational",
    "av:numerator": 30000,
    "av:denominator": 1001
}
```

**Edition-specific definition and counterexample:**

A Rational is an exact, reduced signed integer numerator and positive
integer denominator. The declaring publisher supplies both integers; a
consumer preserves the value without floating-point rounding.

**Required:** one `av:numerator` and one `av:denominator`; their greatest
common divisor is one. At `av:frameRate`, the numerator is additionally
positive and the unit is frames per media second. Identity and an explicit
class type are optional for this intrinsic record. No denominator-one or
nominal-rate default exists. Example: `30000/1001`. Counterexamples:
`60000/2002`, a zero denominator, and a negative frame rate are invalid.
Generic zero is represented only by `0/1`.

<a id="class-need"></a>
## `av:Need` (class)

An identified desired-work input contract, optionally naming a target processor and declared result access/destination.

**Value / identity:** `iri`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** An identified desired-work input contract, optionally naming a target processor and declared result access/destination.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Use a stable absolute revision @id and named inputs; revisions use ordinary identifiers/metadata rather than a new current-head protocol.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (not-applicable):** No inferred active state, generation, assignment, execution or result guarantee.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/need`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ]
}
```

**Edition-specific definition and counterexample:**

A Need is an identified desired-work input contract, optionally selecting a
processing Thing and native result/destination interactions. The application
or deployment author owns it. Source publishers do not rewrite their facts
to satisfy it.

**Required:** absolute `@id`, explicit `av:Need` type, and a nonempty `av:input`
set. `av:processor`, `av:result`, and `av:destination` are each optional and
single-valued; destination requires result. Ordinary revision metadata may
identify lineage, but no current-head, active-job, execution, or lease state
is implied. Example: one required image plus optional reference audio.
Counterexample: an empty Need is not successful empty work.

<a id="class-inputrequirement"></a>
## `av:InputRequirement` (class)

One named logical workload input with an explicit required/optional inclusion rule and a complete incoming-Mode acceptance schema.

**Value / identity:** `iri`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** One named logical workload input with an explicit required/optional inclusion rule and a complete incoming-Mode acceptance schema.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Use @id, dcterms:identifier, explicit presence and accepts. Use whole-contract anyOf for alternatives.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (not-applicable):** Missing presence/accepts is invalid. Optional inclusion still requires the entire contract to hold.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

**Edition-specific definition and counterexample:**

An InputRequirement is one named logical input with an explicit inclusion
rule and one whole-Mode acceptance contract. The application author declares
it; a matcher validates it before selecting or omitting that input.

**Required:** absolute `@id`, explicit `av:InputRequirement` type, one
nonempty `dcterms:identifier`, one `av:presence`, and one object-valued
`av:accepts`. Names and identities are unique within a Need. Optional permits
omission of the whole input, not weakening its schema when selected.
Example: Required Still/BGR8 input. Counterexample: an omitted Optional
input whose schema is malformed is still an invalid requirement.

<a id="class-formreference"></a>
## `av:FormReference` (class)

Selection of a named native Form and standard TD operation in an explicitly located TD document.

**Value / identity:** `node`. **Superclasses:** none required.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The party choosing an existing native Form owns the choice; the TD publisher owns its address, operation support, input/output schemas, binding and security.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** Selection of a named native Form and standard TD operation in an explicitly located TD document.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Supply document, form and operation. Verify unique native Form membership and compatible native operation.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (not-applicable):** All three fields are required. No first-form, href-as-identity, nameless legacy, or implicit document lookup fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/formReference`.

```json
{
    "@type": "av:FormReference",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

**Edition-specific definition and counterexample:**

A FormReference selects an existing named native Form and standard TD
operation in an explicitly located TD. The selecting party owns the choice;
the TD publisher owns its target, binding, payload contract, and security.

**Required:** one `av:document`, one `av:form`, and one `av:operation`.
Identity and explicit class type are optional for this intrinsic record.
Resolution requires unique native Form membership, not a matching annotation
or `href`. No first-Form, inferred document, or default-operation selection
is allowed. Example: [the result reference](../../spec.md#example-result-reference).
Counterexample: an `href` and lowercase `invokeaction` token are not a
FormReference.

<a id="property-av-offer"></a>
## `av:offer` (property)

Advertised complete media alternatives, not copied endpoints.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** td:Thing: Advertised complete media alternatives, not copied endpoints.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Publish embedded or identified Offer records on the Thing.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (no-declaration):** No AV advertisement; no statement about all native capabilities.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/source`.

```json
{
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        "https://example.org/wot/av/context/v0.2"
    ],
    "id": "urn:fixture:av02:source",
    "title": "Synthetic source; no hardware",
    "securityDefinitions": {
        "test_only": {
            "scheme": "nosec"
        }
    },
    "security": [
        "test_only"
    ],
    "av:offer": [
        {
            "@id": "urn:fixture:av02:offer",
            "@type": "av:Offer",
            "av:source": "urn:fixture:av02:source",
            "av:document": "https://fixtures.example.org/source.td.json",
            "av:mode": [
                {
                    "@id": "urn:fixture:av02:mode:still",
                    "@type": "av:Mode",
                    "av:kind": "av:Still",
                    "av:form": "urn:fixture:av02:form:snapshot",
                    "av:track": [
                        {
                            "@id": "urn:fixture:av02:track:picture",
                            "@type": "av:Track",
                            "dcterms:identifier": "picture",
                            "av:representation": "av:EncodedVideo",
                            "av:width": 1280,
                            "av:height": 720,
                            "av:codec": "av:JPEG"
                        }
                    ]
                }
            ]
        }
    ],
    "properties": {
        "snapshot": {
            "readOnly": true,
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:snapshot",
                    "href": "images/current.jpg",
                    "contentType": "image/jpeg"
                }
            ]
        }
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `td:Thing` to `av:Offer`, `0..many`, unordered set serialized as an
array. The publisher associates complete advertisements with the described
source Thing. Consumers follow an explicitly supplied complete record
closure; an identifier alone is not a complete Offer. Omission or an empty
annotation array declares no AV advertisement, not no native capabilities.
Example: one embedded JPEG Offer. Counterexample: an advertised Offer
claiming a different containing Thing as its source violates source ownership.

### Use on `td:Thing`

**Range:** `av:Offer`. **Cardinality:** `0..*`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** td:Thing: Advertised complete media alternatives, not copied endpoints.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Publish embedded or identified Offer records on the Thing.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (no-declaration):** No AV advertisement; no statement about all native capabilities.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/source`.

```json
{
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        "https://example.org/wot/av/context/v0.2"
    ],
    "id": "urn:fixture:av02:source",
    "title": "Synthetic source; no hardware",
    "securityDefinitions": {
        "test_only": {
            "scheme": "nosec"
        }
    },
    "security": [
        "test_only"
    ],
    "av:offer": [
        {
            "@id": "urn:fixture:av02:offer",
            "@type": "av:Offer",
            "av:source": "urn:fixture:av02:source",
            "av:document": "https://fixtures.example.org/source.td.json",
            "av:mode": [
                {
                    "@id": "urn:fixture:av02:mode:still",
                    "@type": "av:Mode",
                    "av:kind": "av:Still",
                    "av:form": "urn:fixture:av02:form:snapshot",
                    "av:track": [
                        {
                            "@id": "urn:fixture:av02:track:picture",
                            "@type": "av:Track",
                            "dcterms:identifier": "picture",
                            "av:representation": "av:EncodedVideo",
                            "av:width": 1280,
                            "av:height": 720,
                            "av:codec": "av:JPEG"
                        }
                    ]
                }
            ]
        }
    ],
    "properties": {
        "snapshot": {
            "readOnly": true,
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:snapshot",
                    "href": "images/current.jpg",
                    "contentType": "image/jpeg"
                }
            ]
        }
    }
}
```

<a id="property-av-need"></a>
## `av:need` (property)

Desired-work contracts associated with an application Thing.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** td:Thing: Desired-work contracts associated with an application Thing.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Link identified Need revisions; no Assignment domain remains.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (no-declaration):** No declared workload request; no implied active/withdrawn state.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/application`.

```json
{
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        "https://example.org/wot/av/context/v0.2"
    ],
    "id": "urn:fixture:av02:application",
    "title": "Synthetic result source and sink; no routing claim",
    "securityDefinitions": {
        "test_only": {
            "scheme": "nosec"
        }
    },
    "security": [
        "test_only"
    ],
    "av:need": [
        {
            "@context": "https://example.org/wot/av/context/v0.2",
            "@id": "urn:fixture:av02:need:result",
            "@type": "av:Need",
            "av:input": [
                {
                    "@id": "urn:fixture:av02:input:picture",
                    "@type": "av:InputRequirement",
                    "dcterms:identifier": "picture",
                    "av:presence": "av:Required",
                    "av:accepts": {
                        "$schema": "https://json-schema.org/draft/2020-12/schema",
                        "type": "object",
                        "required": [
                            "av:kind",
                            "av:track"
                        ],
                        "properties": {
                            "av:kind": {
                                "const": "av:Still"
                            },
                            "av:track": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": 1,
                                "items": {
                                    "type": "object",
                                    "required": [
                                        "av:representation",
                                        "av:codec",
                                        "av:width",
                                        "av:height"
                                    ],
                                    "properties": {
                                        "av:representation": {
                                            "const": "av:EncodedVideo"
                                        },
                                        "av:codec": {
                                            "const": "av:JPEG"
                                        },
                                        "av:width": {
                                            "const": 1280
                                        },
                                        "av:height": {
                                            "const": 720
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ],
            "av:processor": "urn:fixture:av02:application",
            "av:result": {
                "@type": "av:FormReference",
                "av:document": "https://fixtures.example.org/application.td.json",
                "av:form": "urn:fixture:av02:form:result",
                "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
            },
            "av:destination": {
                "@type": "av:FormReference",
                "av:document": "https://fixtures.example.org/application.td.json",
                "av:form": "urn:fixture:av02:form:store",
                "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
            }
        }
    ],
    "properties": {
        "result": {
            "type": "object",
            "required": [
                "label"
            ],
            "properties": {
                "label": {
                    "type": "string"
                }
            },
            "readOnly": true,
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:result",
                    "href": "results/current"
                }
            ]
        }
    },
    "actions": {
        "store": {
            "input": {
                "type": "object",
                "required": [
                    "label"
                ],
                "properties": {
                    "label": {
                        "type": "string"
                    }
                }
            },
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:store",
                    "href": "results"
                }
            ]
        }
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `td:Thing` to `av:Need`, `0..many`, unordered array. An application
publisher associates identified requirement revisions with its Thing;
consumers obtain the selected complete Need before evaluating it. This is
association, not submission or active-state selection. Omission or an empty
array declares none. Example: an application links its inspection Need.
Counterexample: array order does not select a current revision.

### Use on `td:Thing`

**Range:** `av:Need`. **Cardinality:** `0..*`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** td:Thing: Desired-work contracts associated with an application Thing.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Link identified Need revisions; no Assignment domain remains.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (no-declaration):** No declared workload request; no implied active/withdrawn state.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/application`.

```json
{
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        "https://example.org/wot/av/context/v0.2"
    ],
    "id": "urn:fixture:av02:application",
    "title": "Synthetic result source and sink; no routing claim",
    "securityDefinitions": {
        "test_only": {
            "scheme": "nosec"
        }
    },
    "security": [
        "test_only"
    ],
    "av:need": [
        {
            "@context": "https://example.org/wot/av/context/v0.2",
            "@id": "urn:fixture:av02:need:result",
            "@type": "av:Need",
            "av:input": [
                {
                    "@id": "urn:fixture:av02:input:picture",
                    "@type": "av:InputRequirement",
                    "dcterms:identifier": "picture",
                    "av:presence": "av:Required",
                    "av:accepts": {
                        "$schema": "https://json-schema.org/draft/2020-12/schema",
                        "type": "object",
                        "required": [
                            "av:kind",
                            "av:track"
                        ],
                        "properties": {
                            "av:kind": {
                                "const": "av:Still"
                            },
                            "av:track": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": 1,
                                "items": {
                                    "type": "object",
                                    "required": [
                                        "av:representation",
                                        "av:codec",
                                        "av:width",
                                        "av:height"
                                    ],
                                    "properties": {
                                        "av:representation": {
                                            "const": "av:EncodedVideo"
                                        },
                                        "av:codec": {
                                            "const": "av:JPEG"
                                        },
                                        "av:width": {
                                            "const": 1280
                                        },
                                        "av:height": {
                                            "const": 720
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ],
            "av:processor": "urn:fixture:av02:application",
            "av:result": {
                "@type": "av:FormReference",
                "av:document": "https://fixtures.example.org/application.td.json",
                "av:form": "urn:fixture:av02:form:result",
                "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
            },
            "av:destination": {
                "@type": "av:FormReference",
                "av:document": "https://fixtures.example.org/application.td.json",
                "av:form": "urn:fixture:av02:form:store",
                "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
            }
        }
    ],
    "properties": {
        "result": {
            "type": "object",
            "required": [
                "label"
            ],
            "properties": {
                "label": {
                    "type": "string"
                }
            },
            "readOnly": true,
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:result",
                    "href": "results/current"
                }
            ]
        }
    },
    "actions": {
        "store": {
            "input": {
                "type": "object",
                "required": [
                    "label"
                ],
                "properties": {
                    "label": {
                        "type": "string"
                    }
                }
            },
            "forms": [
                {
                    "@id": "urn:fixture:av02:form:store",
                    "href": "results"
                }
            ]
        }
    }
}
```

<a id="property-av-source"></a>
## `av:source` (property)

Physical or logical source Thing publishing this Offer.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Offer: Physical or logical source Thing publishing this Offer.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use the Thing id, including an adapter Thing for its own output; do not substitute href or a device index.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Offer. Source identity does not locate its TD document.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Offer` to one absolute Thing IRI, `1..1`. The publisher names
the physical or logical source of the advertised interface, including an
adapter or converter for its own output. Consumers compare that exact
identity and verify it against the located TD's native `id`. Omission is
invalid; neither a media URL nor a device index supplies a default.
Example: `urn:example:av-example:source`. Counterexample: treating that URN
as an automatically retrievable TD location.

### Use on `av:Offer`

**Range:** `IRI`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Offer: Physical or logical source Thing publishing this Offer.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use the Thing id, including an adapter Thing for its own output; do not substitute href or a device index.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Offer. Source identity does not locate its TD document.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

<a id="property-av-mode"></a>
## `av:mode` (property)

Complete jointly offered alternatives.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Offer: Complete jointly offered alternatives.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** List complete Modes rather than independent parameter arrays.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Empty or missing set is invalid; array order is not priority.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Offer` to `av:Mode`, `1..many`, unordered array. The publisher
lists complete alternatives; a matcher tests an actual member as a whole.
Missing or empty is invalid. Array order, independent option arrays, and
parameter maxima do not establish priority or a Cartesian product.
Example: separate 1080p-with-audio and 720p-without-audio Modes.
Counterexample: deriving 720p-with-audio from those two declarations.

### Use on `av:Offer`

**Range:** `av:Mode`. **Cardinality:** `1..*`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Offer: Complete jointly offered alternatives.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** List complete Modes rather than independent parameter arrays.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Empty or missing set is invalid; array order is not priority.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

<a id="property-av-kind"></a>
## `av:kind` (property)

Live, Still or whole finite Clip.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Mode: Live, Still or whole finite Clip.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use explicit controlled IRI; a contract tests it through accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Mode. Still is not fresh exposure; missing clip duration is not zero.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Mode` to a MediaKind IRI, `1..1`. The publisher declares Live,
Still, or Clip; the consumer applies the corresponding temporal and roster
rules. There is no default, and a missing value is invalid. Still means a
finite image item without a cadence assertion; Clip means the whole finite
media item. Example: `av:Still` for an existing JPEG read.
Counterexample: inferring fresh exposure from Still.

### Use on `av:Mode`

**Range:** `enum:MediaKind`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Mode: Live, Still or whole finite Clip.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use explicit controlled IRI; a contract tests it through accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Mode. Still is not fresh exposure; missing clip duration is not zero.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

<a id="property-av-form"></a>
## `av:form` (property)

Absolute @id of the selected native Form, never its href.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:Mode: Absolute @id of the selected native Form, never its href.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Verify unique membership under native TD forms/affordances in the explicitly identified TD.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid record; no array-index or first-Form fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Uses:** `av:Mode` to one absolute native Form IRI, `1..1`; and
`av:FormReference` to one absolute native Form IRI, `1..1`.
For a Mode the publisher names access to that complete offered combination;
for a FormReference the selecting party chooses an existing interaction.
Consumers require unique membership in the declared TD's native Form
collections. Missing is invalid in either use; `href` and array position
are never defaults. Example: `urn:example:av-example:form:snapshot`.
Counterexample: an identically named node outside native `forms`.

### Use on `av:Mode`

**Range:** `IRI`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:Mode: Absolute @id of the selected native Form, never its href.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Verify unique membership under native TD forms/affordances in the explicitly identified TD.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid record; no array-index or first-Form fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

### Use on `av:FormReference`

**Range:** `IRI`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The party choosing an existing native Form owns the choice; the TD publisher owns its address, operation support, input/output schemas, binding and security.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:FormReference: Absolute @id of the selected native Form, never its href.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Verify unique membership under native TD forms/affordances in the explicitly identified TD.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid record; no array-index or first-Form fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/formReference`.

```json
{
    "@type": "av:FormReference",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

<a id="property-av-track"></a>
## `av:track` (property)

Complete simultaneous components of this Mode.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Mode: Complete simultaneous components of this Mode.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use unique Track ids/names within this Mode; do not merge records from different Modes.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Mode, not an implicit video-only stream.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Mode` to `av:Track`, `1..many`, unordered array. The publisher
declares every simultaneous component at that interface. A matcher retains
the entire roster, not only tracks useful to the current schema. Missing
or empty is invalid; no implicit video-only or audio-free default exists.
Example: video and audio together in one Live Mode.
Counterexample: dropping an audio Track to satisfy a one-Track contract.

### Use on `av:Mode`

**Range:** `av:Track`. **Cardinality:** `1..*`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Mode: Complete simultaneous components of this Mode.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use unique Track ids/names within this Mode; do not merge records from different Modes.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Mode, not an implicit video-only stream.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/mode`.

```json
{
    "@id": "urn:fixture:av02:mode:still",
    "@type": "av:Mode",
    "av:kind": "av:Still",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:track": [
        {
            "@id": "urn:fixture:av02:track:picture",
            "@type": "av:Track",
            "dcterms:identifier": "picture",
            "av:representation": "av:EncodedVideo",
            "av:width": 1280,
            "av:height": 720,
            "av:codec": "av:JPEG"
        }
    ]
}
```

<a id="property-av-representation"></a>
## `av:representation` (property)

EncodedVideo, RawVideo, EncodedAudio or PCM at the offered interface.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: EncodedVideo, RawVideo, EncodedAudio or PCM at the offered interface.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** State the actual outgoing component representation, including an explicit processor's own output.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Track; no inferred decode or conversion.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a Representation IRI, `1..1`. The publisher declares
EncodedVideo, RawVideo, EncodedAudio, or PCM at the offered interface.
Consumers enforce the applicable required and forbidden fields. Missing
is invalid; no implicit decode, channel conversion, or host-native format
exists. Example: `av:EncodedVideo` with JPEG.
Counterexample: labeling encoded JPEG bytes `av:RawVideo`.

### Use on `av:Track`

**Range:** `enum:Representation`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: EncodedVideo, RawVideo, EncodedAudio or PCM at the offered interface.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** State the actual outgoing component representation, including an explicit processor's own output.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (required):** Invalid Track; no inferred decode or conversion.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

<a id="property-av-width"></a>
## `av:width` (property)

Active image-raster columns at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum, stride or tensor width.

**Datatype / container:** `integer`; one value when present. **Unit:** pixels.

**Conditions:** Required for EncodedVideo and RawVideo; forbidden for audio.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Active image-raster columns at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum, stride or tensor width.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project actual geometry; application constraints use accepts minimum/maximum/const with required.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish this concrete video Mode; never fill from a camera capability maximum.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to exact integer pixels, general `0..1`, minimum `1`;
required for EncodedVideo and RawVideo, forbidden for audio. The publisher
declares the active image-raster column count under [geometry](../../spec.md#image-geometry),
after codec-mandated conformance cropping for encoded media and before
presentation transforms. A consumer tests the declared integer without
inferring coordinates, orientation, display scaling, stride, sensor maximum,
or model-tensor dimensions. Missing on video invalidates the concrete Mode.
Example: a 4000 by 3000 JPEG with EXIF orientation 6 still has width `4000`.
Counterexample: substituting the rotated preview's width `3000` without
actually producing that different raster.

### Use on `av:Track`

**Range:** `integer`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Active image-raster columns at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum, stride or tensor width.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project actual geometry; application constraints use accepts minimum/maximum/const with required.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish this concrete video Mode; never fill from a camera capability maximum.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

<a id="property-av-height"></a>
## `av:height` (property)

Active image-raster rows at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum or tensor height.

**Datatype / container:** `integer`; one value when present. **Unit:** pixels.

**Conditions:** Required for EncodedVideo and RawVideo; forbidden for audio.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Active image-raster rows at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum or tensor height.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project actual geometry; requested bounds remain inside accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish this concrete video Mode; no inferred resize.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to exact integer pixels, general `0..1`, minimum `1`;
required for EncodedVideo and RawVideo, forbidden for audio. The publisher
declares the row count of the same active raster as width, under
[geometry](../../spec.md#image-geometry). No external coordinate system, display rotation,
resize, or scan direction follows from that count. Missing on video is invalid.
Example: coded storage height `1088` with a codec-mandated crop of eight
bottom sample rows has height `1080`. Counterexample: reporting the padded
height, a sensor maximum, or a tensor height instead.

### Use on `av:Track`

**Range:** `integer`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Active image-raster rows at the described interface, after codec-mandated conformance cropping for encoded media and before presentation transforms; not coded padding, sensor maximum or tensor height.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project actual geometry; requested bounds remain inside accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish this concrete video Mode; no inferred resize.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

<a id="property-av-codec"></a>
## `av:codec` (property)

Encoded-media coding family, not signaling contentType or decoder support.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Required for EncodedVideo (H264, JPEG, H265) and EncodedAudio (AAC, Opus); forbidden for RawVideo and PCM.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Encoded-media coding family, not signaling contentType or decoder support.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse H264/JPEG/H265 for encoded video and AAC/Opus for encoded audio; exact initialization/negotiation stays native.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish that concrete encoded Track. Unknown families are not coerced to a known codec.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a Codec IRI, general `0..1`. It is required for
EncodedVideo, choosing H264/JPEG/H265, and EncodedAudio, choosing AAC/Opus;
it is forbidden for RawVideo and PCM. The publisher declares the coding
family; consumers do not infer profile, level, tier, initialization,
transport framing, or decoder support. Missing on encoded media is invalid.
Example: `av:H265` on EncodedVideo.
Counterexample: `av:Opus` on EncodedVideo or a container media type as codec.

### Use on `av:Track`

**Range:** `enum:Codec`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Encoded-media coding family, not signaling contentType or decoder support.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse H264/JPEG/H265 for encoded video and AAC/Opus for encoded audio; exact initialization/negotiation stays native.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cannot publish that concrete encoded Track. Unknown families are not coerced to a known codec.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

<a id="property-av-pixelformat"></a>
## `av:pixelFormat` (property)

Actual raw channel order and sample packing.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Required only for RawVideo; forbidden for every other representation.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual raw channel order and sample packing.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse existing named formats only for known mappings; native PFNC/UVC/buffer details remain in their native interfaces.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Raw representation is incomplete, not implicitly RGB8 or BGR8.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/rawVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:RawVideo",
    "av:width": 640,
    "av:height": 640,
    "av:pixelFormat": "av:BGR8",
    "av:bufferLayout": "av:Contiguous"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a PixelFormat IRI, general `0..1`; required only for
RawVideo and forbidden otherwise. The publisher declares known component
order, sample width, and logical packing. Consumers use the exact controlled
format and obtain unexpressed layout/color facts natively. There is no RGB,
BGR, PFNC, or host-format fallback. Example: `av:BGR8`.
Counterexample: treating a native format with a different channel order as BGR8.

### Use on `av:Track`

**Range:** `enum:PixelFormat`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual raw channel order and sample packing.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse existing named formats only for known mappings; native PFNC/UVC/buffer details remain in their native interfaces.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Raw representation is incomplete, not implicitly RGB8 or BGR8.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/rawVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:RawVideo",
    "av:width": 640,
    "av:height": 640,
    "av:pixelFormat": "av:BGR8",
    "av:bufferLayout": "av:Contiguous"
}
```

<a id="property-av-cadence"></a>
## `av:cadence` (property)

Constant, Variable or Triggered observed/offered cadence semantics.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Optional for Live/Clip video; forbidden for Still and audio. Omission is unknown.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Constant, Variable or Triggered observed/offered cadence semantics.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** State a known media cadence category; Triggered does not expose a trigger command.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cadence unknown, never Constant by default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/constantVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:H264",
    "av:cadence": "av:Constant",
    "av:frameRate": {
        "@type": "av:Rational",
        "av:numerator": 30000,
        "av:denominator": 1001
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a Cadence IRI, `0..1`; permitted only on Live/Clip
video. The publisher declares known Constant, Variable, or Triggered media
cadence. Consumers distinguish a media-timeline fact from observed arrival
rate. Omission means unknown; it does not mean Constant or Variable.
Still and audio forbid this field. Example: `av:Triggered` without frameRate.
Counterexample: treating Triggered as permission to invoke a trigger.

### Use on `av:Track`

**Range:** `enum:Cadence`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Constant, Variable or Triggered observed/offered cadence semantics.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** State a known media cadence category; Triggered does not expose a trigger command.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Cadence unknown, never Constant by default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/constantVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:H264",
    "av:cadence": "av:Constant",
    "av:frameRate": {
        "@type": "av:Rational",
        "av:numerator": 30000,
        "av:denominator": 1001
    }
}
```

<a id="property-av-framerate"></a>
## `av:frameRate` (property)

Exact media cadence at this offered interface, not wall-clock throughput or delivered-losslessness SLA.

**Datatype / container:** `node`; one value when present. **Unit:** frames/media-second.

**Conditions:** Required exactly with Constant cadence; otherwise forbidden. Positive, gcd-reduced Rational only.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Exact media cadence at this offered interface, not wall-clock throughput or delivered-losslessness SLA.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use reduced exact numerator/denominator; request exact pairs/enumerated alternatives in accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Invalid with Constant; otherwise no exact rate is asserted. No rounding 30000/1001 to 30.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/constantVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:H264",
    "av:cadence": "av:Constant",
    "av:frameRate": {
        "@type": "av:Rational",
        "av:numerator": 30000,
        "av:denominator": 1001
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to `av:Rational`, general `0..1`, in frames per media
second. It is required exactly when cadence is Constant and forbidden
otherwise. The publisher supplies a positive reduced ratio; consumers
preserve both exact integers. Absence with Constant is invalid; otherwise
no exact rate is asserted. It is not a delivery-loss or throughput promise.
Example: `30000/1001`. Counterexample: rounding it to `30/1`, or using a
device frame-rate limit as evidence of exact constant cadence.

### Use on `av:Track`

**Range:** `av:Rational`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Exact media cadence at this offered interface, not wall-clock throughput or delivered-losslessness SLA.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Use reduced exact numerator/denominator; request exact pairs/enumerated alternatives in accepts.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Invalid with Constant; otherwise no exact rate is asserted. No rounding 30000/1001 to 30.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/constantVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:H264",
    "av:cadence": "av:Constant",
    "av:frameRate": {
        "@type": "av:Rational",
        "av:numerator": 30000,
        "av:denominator": 1001
    }
}
```

<a id="property-av-samplerate"></a>
## `av:sampleRate` (property)

Actual audio sampling frequency per channel.

**Datatype / container:** `integer`; one value when present. **Unit:** samples/second/channel.

**Conditions:** Required for EncodedAudio and PCM; forbidden for video.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual audio sampling frequency per channel.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project the media signature, not an RTP clock or fixed SDP signaling value.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Concrete audio description is incomplete; no default 48000.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to an exact positive integer, general `0..1`, in samples
per second per channel; required for EncodedAudio and PCM, forbidden for
video. The publisher supplies actual media sampling frequency. A consumer
does not infer it from an RTP timestamp clock or fixed SDP signaling value.
Missing makes the audio description incomplete; `48000` is not a default.
Example: declared PCM `48000`. Counterexample: deriving an Opus media
sampling frequency solely from the RTP clock.

### Use on `av:Track`

**Range:** `integer`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual audio sampling frequency per channel.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Project the media signature, not an RTP clock or fixed SDP signaling value.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Concrete audio description is incomplete; no default 48000.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

<a id="property-av-channels"></a>
## `av:channels` (property)

Actual number of media channels.

**Datatype / container:** `integer`; one value when present. **Unit:** channels.

**Conditions:** Required for audio; Mono requires 1, StereoLR requires 2. Forbidden for video.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual number of media channels.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Keep consistent with channelLayout; do not infer from a signaling clock declaration.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Concrete audio description is incomplete; no mono/stereo default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to an exact positive integer count, general `0..1`;
required for audio and forbidden for video. The publisher states the
actual count, and the consumer checks consistency with channelLayout:
Mono requires one, StereoLR two. Neither count nor layout defaults the other.
Missing is invalid on audio. Example: `2` with `av:StereoLR`.
Counterexample: six channels coerced into the supported stereo contract.

### Use on `av:Track`

**Range:** `integer`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Actual number of media channels.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Keep consistent with channelLayout; do not infer from a signaling clock declaration.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Concrete audio description is incomplete; no mono/stereo default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

<a id="property-av-channellayout"></a>
## `av:channelLayout` (property)

Audio channel meaning and order, independent of storage layout.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Required for audio; Mono/1 and StereoLR/2 are the supported matching pairs. Forbidden for video.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Audio channel meaning and order, independent of storage layout.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse Mono/1 and StereoLR/2 when known; unrepresented layouts require native descriptions, not a guessed mapping.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** No known portable channel contract.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a ChannelLayout IRI, general `0..1`; required for
audio and forbidden for video. The publisher states channel meaning/order;
the consumer distinguishes it from memory layout. Supported pairs are
Mono/one and StereoLR/two. Missing or unrepresentable layout is not a
portable concrete audio offer. Example: `av:StereoLR`.
Counterexample: inferring left/right order merely because channels is two.

### Use on `av:Track`

**Range:** `enum:ChannelLayout`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Audio channel meaning and order, independent of storage layout.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse Mono/1 and StereoLR/2 when known; unrepresented layouts require native descriptions, not a guessed mapping.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** No known portable channel contract.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedAudio`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:EncodedAudio",
    "av:codec": "av:Opus",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR"
}
```

<a id="property-av-sampleformat"></a>
## `av:sampleFormat` (property)

PCM numeric sample representation.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Required only for PCM; forbidden for every other representation.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: PCM numeric sample representation.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse S16LE/F32LE for the actual sample representation.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** PCM description is incomplete, not a host-native numeric default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/pcm`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:PCM",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR",
    "av:sampleFormat": "av:S16LE",
    "av:bufferLayout": "av:Interleaved"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a SampleFormat IRI, general `0..1`; required only for
PCM and forbidden otherwise. The publisher declares S16LE or F32LE at the
offered interface. Consumers use the stated sample width and byte order,
not the host's numeric defaults. Missing makes PCM incomplete.
Example: `av:S16LE`. Counterexample: assigning a PCM sample format to
encoded AAC before an explicit decoding boundary.

### Use on `av:Track`

**Range:** `enum:SampleFormat`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: PCM numeric sample representation.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Reuse S16LE/F32LE for the actual sample representation.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** PCM description is incomplete, not a host-native numeric default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/pcm`.

```json
{
    "@id": "urn:fixture:av02:track:sound",
    "@type": "av:Track",
    "dcterms:identifier": "sound",
    "av:representation": "av:PCM",
    "av:sampleRate": 48000,
    "av:channels": 2,
    "av:channelLayout": "av:StereoLR",
    "av:sampleFormat": "av:S16LE",
    "av:bufferLayout": "av:Interleaved"
}
```

<a id="property-av-bufferlayout"></a>
## `av:bufferLayout` (property)

Image Contiguous/Strided or audio Interleaved/Planar layout category.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Required for RawVideo (Contiguous/Strided) or PCM (Interleaved/Planar); otherwise forbidden.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Image Contiguous/Strided or audio Interleaved/Planar layout category.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Publish the actual category. Detailed strides/colorimetry/memory access are native-interface facts, not inferred from the category.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Raw description is incomplete; Strided alone does not prove an application's buffer compatibility.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/rawVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:RawVideo",
    "av:width": 640,
    "av:height": 640,
    "av:pixelFormat": "av:BGR8",
    "av:bufferLayout": "av:Contiguous"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Track` to a BufferLayout IRI, general `0..1`; required for
RawVideo (Contiguous or Strided) and PCM (Interleaved or Planar), forbidden
for encoded media. The publisher declares an actual category. A consumer
still obtains native strides, plane offsets, accessibility, and lifetime
when required. Omission makes the raw description incomplete.
Example: `av:Contiguous` BGR8. Counterexample: using `av:Planar` as a
RawVideo bufferLayout merely because YUV420P has planes.

### Use on `av:Track`

**Range:** `enum:BufferLayout`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** Known facts at this offered native source or explicit processor output interface; native device/driver/media semantics remain authoritative.

**Describes:** av:Track: Image Contiguous/Strided or audio Interleaved/Planar layout category.

**Used by:** Consumers compare one complete offered Mode with a whole-input accepts schema, retaining unknown optional facts as absent.

**How to specify:** Publish the actual category. Detailed strides/colorimetry/memory access are native-interface facts, not inferred from the category.

**Boundary:** Read-only descriptive metadata does not configure cameras, infer transformations, authorize access or prove current availability.

**Defaults / omission (conditional):** Raw description is incomplete; Strided alone does not prove an application's buffer compatibility.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/rawVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:RawVideo",
    "av:width": 640,
    "av:height": 640,
    "av:pixelFormat": "av:BGR8",
    "av:bufferLayout": "av:Contiguous"
}
```

<a id="property-av-numerator"></a>
## `av:numerator` (property)

Signed ratio numerator; positive at frameRate.

**Datatype / container:** `integer`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Signed on a generic Rational; strictly positive when used as frameRate.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The explicitly supplied exact integers; av:frameRate supplies frames per media-second as the unit.

**Describes:** av:Rational: Signed ratio numerator; positive at frameRate.

**Used by:** A matcher preserves exact integer pairs rather than rounding frame rates.

**How to specify:** Use the existing safe JSON integer or explicit typed lexical integer convention and gcd reduction.

**Boundary:** No generic clock model, cross-field arithmetic guarantee, runtime throughput or delivered-losslessness claim.

**Defaults / omission (required):** Invalid Rational; no zero fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/rational`.

```json
{
    "@type": "av:Rational",
    "av:numerator": 30000,
    "av:denominator": 1001
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Rational` to exact integer, `1..1`. The publisher supplies the
signed numerator; at frameRate it must be strictly positive. The consumer
checks exact source-integer syntax and coprimality with the denominator.
The containing property supplies units. Missing is invalid and does not
default to zero. Example: `30000` in `30000/1001`.
Counterexample: `"30000"` as an untyped numeric-looking string.

### Use on `av:Rational`

**Range:** `integer`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The explicitly supplied exact integers; av:frameRate supplies frames per media-second as the unit.

**Describes:** av:Rational: Signed ratio numerator; positive at frameRate.

**Used by:** A matcher preserves exact integer pairs rather than rounding frame rates.

**How to specify:** Use the existing safe JSON integer or explicit typed lexical integer convention and gcd reduction.

**Boundary:** No generic clock model, cross-field arithmetic guarantee, runtime throughput or delivered-losslessness claim.

**Defaults / omission (required):** Invalid Rational; no zero fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/rational`.

```json
{
    "@type": "av:Rational",
    "av:numerator": 30000,
    "av:denominator": 1001
}
```

<a id="property-av-denominator"></a>
## `av:denominator` (property)

Strictly positive ratio denominator.

**Datatype / container:** `integer`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Strictly positive and coprime to numerator.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The explicitly supplied exact integers; av:frameRate supplies frames per media-second as the unit.

**Describes:** av:Rational: Strictly positive ratio denominator.

**Used by:** A matcher preserves exact integer pairs rather than rounding frame rates.

**How to specify:** Supply explicitly and reduce with numerator.

**Boundary:** No generic clock model, cross-field arithmetic guarantee, runtime throughput or delivered-losslessness claim.

**Defaults / omission (required):** Invalid Rational; no implicit denominator 1.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/rational`.

```json
{
    "@type": "av:Rational",
    "av:numerator": 30000,
    "av:denominator": 1001
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Rational` to exact positive integer, `1..1`, minimum `1`.
The publisher supplies it explicitly; the consumer checks positivity and
coprimality. There is no implicit denominator one and no repair by automatic
reduction. Example: `1001`. Counterexample: `0`, omission, or a pair
whose greatest common divisor is greater than one.

### Use on `av:Rational`

**Range:** `integer`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The explicitly supplied exact integers; av:frameRate supplies frames per media-second as the unit.

**Describes:** av:Rational: Strictly positive ratio denominator.

**Used by:** A matcher preserves exact integer pairs rather than rounding frame rates.

**How to specify:** Supply explicitly and reduce with numerator.

**Boundary:** No generic clock model, cross-field arithmetic guarantee, runtime throughput or delivered-losslessness claim.

**Defaults / omission (required):** Invalid Rational; no implicit denominator 1.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/rational`.

```json
{
    "@type": "av:Rational",
    "av:numerator": 30000,
    "av:denominator": 1001
}
```

<a id="property-av-processor"></a>
## `av:processor` (property)

Requested processing Thing, not a running worker or model artifact.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Requested processing Thing, not a running worker or model artifact.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Name a processor if the desired work is restricted to that Thing.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (no-declaration):** No target selected; discovery/selection is external and no execution is implied.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Need` to an absolute processing-Thing IRI, `0..1`. The requirement
author restricts desired work to that Thing when supplied. The consumer
does not treat it as a source constraint, running worker, or model artifact.
Omission selects no processing Thing; it defaults neither to source nor
result producer. Example: `urn:example:av-example:processor`.
Counterexample: rejecting all candidate sources whose identity differs
from processor without a corresponding source condition in accepts.

### Use on `av:Need`

**Range:** `IRI`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Requested processing Thing, not a running worker or model artifact.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Name a processor if the desired work is restricted to that Thing.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (no-declaration):** No target selected; discovery/selection is external and no execution is implied.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

<a id="property-av-input"></a>
## `av:input` (property)

Named logical workload inputs.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Named logical workload inputs.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Use unique dcterms:identifier names within the Need; distinguish av:input from native Action input.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (required):** Invalid media Need; no fabricated successful empty selection.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/need`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Need` to `av:InputRequirement`, `1..many`, unordered array.
The application author declares uniquely identified and named logical
inputs. The matcher validates every input before candidate processing and
requires a complete selection for every Required input. Missing or empty
is invalid. This property is not native Action `input`.
Example: `inspection` and `reference-audio` inputs.
Counterexample: using array position as an implicit input identifier.

### Use on `av:Need`

**Range:** `av:InputRequirement`. **Cardinality:** `1..*`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Named logical workload inputs.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Use unique dcterms:identifier names within the Need; distinguish av:input from native Action input.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (required):** Invalid media Need; no fabricated successful empty selection.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/need`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ]
}
```

<a id="property-av-presence"></a>
## `av:presence` (property)

Required or Optional inclusion of this whole input.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:InputRequirement: Required or Optional inclusion of this whole input.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** State explicitly; all constraints stay hard if an Optional input is included.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (required):** Invalid input contract; no implicit Required/Optional default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:InputRequirement` to a Presence IRI, `1..1`. The application
author explicitly chooses Required or Optional; the matcher uses it only
for whole-input inclusion. If included, the entire accepts schema remains
hard. Missing is invalid, including for a proposed omission. There is no
default. Example: `av:Optional` reference audio.
Counterexample: treating Optional as permission to ignore a failing codec
condition on an included input.

### Use on `av:InputRequirement`

**Range:** `enum:Presence`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:InputRequirement: Required or Optional inclusion of this whole input.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** State explicitly; all constraints stay hard if an Optional input is included.

**Boundary:** A request neither authorizes native camera controls nor proves availability, decoding, acceptance, delivery or durability.

**Defaults / omission (required):** Invalid input contract; no implicit Required/Optional default.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

<a id="property-av-document"></a>
## `av:document` (property)

Explicit TD retrieval location used to interpret named Forms and native relative targets.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:Offer: Explicit TD retrieval location used to interpret named Forms and native relative targets.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Preserve the effective retrieval base and the original TD's native base. For an Offer, the resolved TD id must equal source.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid reference; do not treat Thing id or Form href as a document locator.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

**Edition-specific definition and counterexample:**

**Uses:** `av:Offer` and `av:FormReference` to one absolute TD retrieval IRI,
`1..1` on each. The publisher supplies an Offer's location; the selector
supplies a FormReference's location. Consumers retain requested and effective
retrieval locations and the original TD base. An Offer's located TD must
identify source. Missing is invalid. This is not a byte pin, authentication
claim, or implicit graph-discovery instruction.
Example: `https://media.example.org/source.td.json`.
Counterexample: substituting the source Thing IRI when retrieval fails.

### Use on `av:Offer`

**Range:** `IRI`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The source or explicit adapter Thing publisher owns descriptive offered facts. It projects native facts; it does not grant permission to change camera settings.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:Offer: Explicit TD retrieval location used to interpret named Forms and native relative targets.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Preserve the effective retrieval base and the original TD's native base. For an Offer, the resolved TD id must equal source.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid reference; do not treat Thing id or Form href as a document locator.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/offer`.

```json
{
    "@id": "urn:fixture:av02:offer",
    "@type": "av:Offer",
    "av:source": "urn:fixture:av02:source",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:mode": [
        {
            "@id": "urn:fixture:av02:mode:still",
            "@type": "av:Mode",
            "av:kind": "av:Still",
            "av:form": "urn:fixture:av02:form:snapshot",
            "av:track": [
                {
                    "@id": "urn:fixture:av02:track:picture",
                    "@type": "av:Track",
                    "dcterms:identifier": "picture",
                    "av:representation": "av:EncodedVideo",
                    "av:width": 1280,
                    "av:height": 720,
                    "av:codec": "av:JPEG"
                }
            ]
        }
    ]
}
```

### Use on `av:FormReference`

**Range:** `IRI`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The party choosing an existing native Form owns the choice; the TD publisher owns its address, operation support, input/output schemas, binding and security.

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:FormReference: Explicit TD retrieval location used to interpret named Forms and native relative targets.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Preserve the effective retrieval base and the original TD's native base. For an Offer, the resolved TD id must equal source.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid reference; do not treat Thing id or Form href as a document locator.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/formReference`.

```json
{
    "@type": "av:FormReference",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

<a id="property-av-operation"></a>
## `av:operation` (property)

The selected standard WoT operation.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** selecting_party; TD publisher owns operation support

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:FormReference: The selected standard WoT operation.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Use existing operation IRIs here; native Form op continues to use native lowercase tokens and native default rules.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid selection. No invented media operation or first-supported-operation fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/formReference`.

```json
{
    "@type": "av:FormReference",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:FormReference` to one standard TD NativeOperation IRI, `1..1`.
The selecting party specifies the operation. The native Form keeps its
lowercase `op` token and native defaults; the consumer verifies applicability
and support in its actual owner. Missing is invalid; no first-supported
operation is selected automatically. Example:
`https://www.w3.org/2019/wot/td#readProperty`.
Counterexample: using lowercase `readproperty` as this IRI value.

### Use on `av:FormReference`

**Range:** `enum:NativeOperation`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** selecting_party; TD publisher owns operation support

**Source of truth:** The named native TD Form owns href, operation support, payload schema, binding and security; this record owns only the selection.

**Describes:** av:FormReference: The selected standard WoT operation.

**Used by:** A consumer resolves unique native Form membership in the explicitly located TD and checks the selected operation.

**How to specify:** Use existing operation IRIs here; native Form op continues to use native lowercase tokens and native default rules.

**Boundary:** No copied endpoint, first-Form fallback, implicit document lookup, immutable-byte guarantee or authorization.

**Defaults / omission (required):** Invalid selection. No invented media operation or first-supported-operation fallback.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/formReference`.

```json
{
    "@type": "av:FormReference",
    "av:document": "https://fixtures.example.org/source.td.json",
    "av:form": "urn:fixture:av02:form:snapshot",
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

<a id="property-av-accepts"></a>
## `av:accepts` (property)

Requested incoming Mode-description contract at the application's delivered interface.

**Datatype / container:** `json`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Object JSON Schema 2020-12, with only self-contained local references. Explicit $schema may name only that dialect; omission selects that dialect. Hard facts require required. No defaults inject data and format is annotation-only.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:InputRequirement: Requested incoming Mode-description contract at the application's delivered interface.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Supply a JSON Schema 2020-12 object. Omitted $schema selects that dialect in this draft; another explicit dialect is unsupported. JSON-LD coercion is @json. Validate one normalized whole Mode, not media bytes or a TD DataSchema node.

**Boundary:** Exact reduced Rational pairs may be enumerated; generic rational inequalities/cross-field arithmetic are not automatically expressible.

**Defaults / omission (required):** Missing is invalid. A schema with only $schema deliberately constrains no further descriptor facts; it does not authorize operations.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:InputRequirement` to one opaque JSON object, `1..1`, represented
as `rdf:JSON` through JSON-LD `@json`. The application author supplies a
portable JSON Schema 2020-12 contract over one complete Mode description.
The matcher uses [Section 10](../../spec.md#acceptance-profile), not TD DataSchema rules.
Omitted `$schema` selects exactly 2020-12; missing accepts is invalid.
An empty object deliberately adds no descriptor restrictions, but creates
no permission or execution. `required` expresses hard presence, `default`
does not supply facts, and `format` is annotation-only.
Example: requiring kind Still and a RawVideo/BGR8 Track.
Counterexample: interpreting schema property names as asserted AV predicates.

### Use on `av:InputRequirement`

**Range:** `json`. **Cardinality:** `1..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** The application/deployment author owns requested input constraints and selections, not the camera's offered facts.

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:InputRequirement: Requested incoming Mode-description contract at the application's delivered interface.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Supply a JSON Schema 2020-12 object. Omitted $schema selects that dialect in this draft; another explicit dialect is unsupported. JSON-LD coercion is @json. Validate one normalized whole Mode, not media bytes or a TD DataSchema node.

**Boundary:** Exact reduced Rational pairs may be enumerated; generic rational inequalities/cross-field arithmetic are not automatically expressible.

**Defaults / omission (required):** Missing is invalid. A schema with only $schema deliberately constrains no further descriptor facts; it does not authorize operations.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

<a id="property-av-result"></a>
## `av:result` (property)

Selected native producer interaction whose DataSchema defines the declared result payload.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** workload_author selects; result_producer defines schema

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Selected native producer interaction whose DataSchema defines the declared result payload.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Reference a producer property, Action output or Event data Form. Resolve schema/media type from its native affordance and Form, not a copied AV schema.

**Boundary:** A multi-output payload uses its native schema; this core does not add output-slot routing or delivery lifecycle classes.

**Defaults / omission (no-declaration):** No result contract specified; do not infer no output, arbitrary output compatibility, successful completion, or durable commitment.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Need` to `av:FormReference`, `0..1`. The application selects
a native producer interaction; that producer owns its Property DataSchema,
Action output, or Event notification data schema. The consumer resolves the
applicable result role without copying it into an AV manifest. Omission
declares no result selection, not no outputs, arbitrary payload compatibility,
successful processing, or durability. Example: an inspect Action output.
Counterexample: assuming an external producer's output came from the named
processor without an explicit native/application relationship.

### Use on `av:Need`

**Range:** `av:FormReference`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** workload_author selects; result_producer defines schema

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Selected native producer interaction whose DataSchema defines the declared result payload.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Reference a producer property, Action output or Event data Form. Resolve schema/media type from its native affordance and Form, not a copied AV schema.

**Boundary:** A multi-output payload uses its native schema; this core does not add output-slot routing or delivery lifecycle classes.

**Defaults / omission (no-declaration):** No result contract specified; do not infer no output, arbitrary output compatibility, successful completion, or durable commitment.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

<a id="property-av-destination"></a>
## `av:destination` (property)

Requested receiver of the declared result.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Conditions:** Requires av:result on the same Need; native processor interaction must separately support the requested sink.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** workload_author selects; destination_owner defines native input/access

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Requested receiver of the declared result.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Choose a writable-property or Action input Form. Native processor interaction must explicitly support this sink and supply its required parameters.

**Boundary:** Reference metadata is neither a routing instruction by itself nor authorization, delivery success or durability evidence.

**Defaults / omission (no-push-request):** No push destination requested; use selected result access. No implicit callback, default sink or broadcast.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

**Edition-specific definition and counterexample:**

**Use:** `av:Need` to `av:FormReference`, `0..1`, requiring result on the same
Need. The application selects a receiver's writable Property or Action
input; the receiver owns its schema and policy. The sender's native API must
separately support the requested transfer and all required parameters.
Omission requests no push. There is no default sink, callback, broadcast,
credential forwarding, or automatic relay.
Example: an explicitly supported receive-result Action.
Counterexample: initiating a transfer merely because result and destination
appear together in a Need.

### Use on `av:Need`

**Range:** `av:FormReference`. **Cardinality:** `0..1`.

**Defined by:** This unregistered, unhosted WoT AV 0.2-proposed draft

**Declared by:** workload_author selects; destination_owner defines native input/access

**Source of truth:** This explicit workload-author Need revision; it does not replace published source facts or native schemas.

**Describes:** av:Need: Requested receiver of the declared result.

**Used by:** Application discovery/selection code evaluates the requested contract; it does not schedule or execute it.

**How to specify:** Choose a writable-property or Action input Form. Native processor interaction must explicitly support this sink and supply its required parameters.

**Boundary:** Reference metadata is neither a routing instruction by itself nor authorization, delivery success or durability evidence.

**Defaults / omission (no-push-request):** No push destination requested; use selected result access. No implicit callback, default sink or broadcast.

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/resultNeed`.

```json
{
    "@context": "https://example.org/wot/av/context/v0.2",
    "@id": "urn:fixture:av02:need:result",
    "@type": "av:Need",
    "av:input": [
        {
            "@id": "urn:fixture:av02:input:picture",
            "@type": "av:InputRequirement",
            "dcterms:identifier": "picture",
            "av:presence": "av:Required",
            "av:accepts": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": [
                    "av:kind",
                    "av:track"
                ],
                "properties": {
                    "av:kind": {
                        "const": "av:Still"
                    },
                    "av:track": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "required": [
                                "av:representation",
                                "av:codec",
                                "av:width",
                                "av:height"
                            ],
                            "properties": {
                                "av:representation": {
                                    "const": "av:EncodedVideo"
                                },
                                "av:codec": {
                                    "const": "av:JPEG"
                                },
                                "av:width": {
                                    "const": 1280
                                },
                                "av:height": {
                                    "const": 720
                                }
                            }
                        }
                    }
                }
            }
        }
    ],
    "av:processor": "urn:fixture:av02:application",
    "av:result": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:result",
        "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
    },
    "av:destination": {
        "@type": "av:FormReference",
        "av:document": "https://fixtures.example.org/application.td.json",
        "av:form": "urn:fixture:av02:form:store",
        "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
    }
}
```

<a id="property-dcterms-identifier"></a>
## `dcterms:identifier` (property)

Stable local Track or InputRequirement name, unique within its containing Mode or Need; supplements absolute @id.

**Datatype / container:** `string`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Publisher of the Track or workload author of the input

**Source of truth:** The author's declared local name

**Describes:** Stable local Track or InputRequirement name, unique within its containing Mode or Need; supplements absolute @id.

**Used by:** Consumers identify named components

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (required):** Invalid Track/InputRequirement

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:identifier": "picture"
}
```

**Edition-specific definition and counterexample:**

**AV uses:** Track and InputRequirement each require one nonempty
`xsd:string`, `1..1`. The publisher or requirement author supplies a
case-sensitive local name, unique within the containing Mode or Need.
Consumers preserve the Unicode scalar sequence and sort Track descriptions
by it. It supplements, rather than replaces, absolute identity. Example:
`picture`. Counterexample: omission, an empty name, or duplicate names
within the same roster. Native identifiers elsewhere are not retyped as
these logical names.

### Use on `av:Track`

**Range:** `string`. **Cardinality:** `1..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Interface publisher

**Source of truth:** The author's declared local name

**Describes:** av:Track: Stable local Track or InputRequirement name, unique within its containing Mode or Need; supplements absolute @id.

**Used by:** Consumers identify named components

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (required):** Invalid Track/InputRequirement

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/tracks/encodedVideo`.

```json
{
    "@id": "urn:fixture:av02:track:picture",
    "@type": "av:Track",
    "dcterms:identifier": "picture",
    "av:representation": "av:EncodedVideo",
    "av:width": 1280,
    "av:height": 720,
    "av:codec": "av:JPEG"
}
```

### Use on `av:InputRequirement`

**Range:** `string`. **Cardinality:** `1..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Workload author

**Source of truth:** The author's declared local name

**Describes:** av:InputRequirement: Stable local Track or InputRequirement name, unique within its containing Mode or Need; supplements absolute @id.

**Used by:** Consumers identify named components

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (required):** Invalid Track/InputRequirement

**Example:** AV record fragment; native access is not exercised. `av/tools/fixtures/core.json` at JSON Pointer `/input`.

```json
{
    "@id": "urn:fixture:av02:input:picture",
    "@type": "av:InputRequirement",
    "dcterms:identifier": "picture",
    "av:presence": "av:Required",
    "av:accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": [
            "av:kind",
            "av:track"
        ],
        "properties": {
            "av:kind": {
                "const": "av:Still"
            },
            "av:track": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "items": {
                    "type": "object",
                    "required": [
                        "av:representation",
                        "av:codec",
                        "av:width",
                        "av:height"
                    ],
                    "properties": {
                        "av:representation": {
                            "const": "av:EncodedVideo"
                        },
                        "av:codec": {
                            "const": "av:JPEG"
                        },
                        "av:width": {
                            "const": 1280
                        },
                        "av:height": {
                            "const": 720
                        }
                    }
                }
            }
        }
    }
}
```

<a id="property-dcterms-isversionof"></a>
## `dcterms:isVersionOf` (property)

Optional standard revision lineage; no generation, current-head or lease semantics.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional standard revision lineage; no generation, current-head or lease semantics.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:isVersionOf": "urn:example:related"
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to IRI, `0..1`. The metadata author identifies
revision lineage; consumers may relate revisions without inferring a
generation counter, current head, or lease. Example: an inspection Need
revision links its enduring concept. Counterexample: selecting the active
Need from this link alone.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional standard revision lineage; no generation, current-head or lease semantics.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:isVersionOf": "urn:example:related"
}
```

<a id="property-dcterms-format"></a>
## `dcterms:format` (property)

Optional artifact media type; never overrides native Form contentType.

**Datatype / container:** `string`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional artifact media type; never overrides native Form contentType.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:format": "Example artifact metadata"
}
```

**Edition-specific definition and counterexample:**

**Direct AV use:** `rdfs:Resource` to `xsd:string`, `0..1`, for optional
artifact format/media-type information. The artifact author declares it;
consumers retain the native Form's authoritative content metadata.
Example: an artifact annotated `application/json`.
Counterexample: overriding `image/jpeg` on a Form with this annotation.

### Use on `rdfs:Resource`

**Range:** `string`. **Cardinality:** `0..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional artifact media type; never overrides native Form contentType.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:format": "Example artifact metadata"
}
```

<a id="property-dcterms-conformsto"></a>
## `dcterms:conformsTo` (property)

Optional standard-conformance claim; not an AV pinned-profile obligation or validation evidence.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional standard-conformance claim; not an AV pinned-profile obligation or validation evidence.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:conformsTo": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to IRI set, `0..many`. The author makes an explicit
standard-conformance claim. Consumers distinguish the claim from its
evidence and exact scope. Example: a link to a separately identified
standard. Counterexample: deriving certification or a mandatory AV profile
family from the presence of a link.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional standard-conformance claim; not an AV pinned-profile obligation or validation evidence.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:conformsTo": [
        "urn:example:related"
    ]
}
```

<a id="property-dcterms-description"></a>
## `dcterms:description` (property)

Optional non-secret human explanation; native Things retain native description.

**Datatype / container:** `string`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional non-secret human explanation; native Things retain native description.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:description": "Example artifact metadata"
}
```

**Edition-specific definition and counterexample:**

**Direct AV use:** `rdfs:Resource` to `xsd:string`, `0..1`. The author supplies
non-secret human explanation; consumers may display it, but do not execute
it as an acceptance condition. Native TDs keep native `description`.
Example: explaining that a Mode is hypothetical. Counterexample: using
prose to silently override a required structured fact.

### Use on `rdfs:Resource`

**Range:** `string`. **Cardinality:** `0..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional non-secret human explanation; native Things retain native description.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:description": "Example artifact metadata"
}
```

<a id="property-dcterms-title"></a>
## `dcterms:title` (property)

Optional artifact title; native Things retain native title.

**Datatype / container:** `string`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional artifact title; native Things retain native title.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:title": "Example artifact metadata"
}
```

**Edition-specific definition and counterexample:**

**Direct AV use:** `rdfs:Resource` to `xsd:string`, `0..1`. The author supplies
an artifact title for human display. Native Things retain native `title`
and multilingual title mechanisms. Example: `Inspection input`.
Counterexample: treating a human title as a Track's required local identifier.

### Use on `rdfs:Resource`

**Range:** `string`. **Cardinality:** `0..1`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional artifact title; native Things retain native title.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:title": "Example artifact metadata"
}
```

<a id="property-dcterms-creator"></a>
## `dcterms:creator` (property)

Optional identified creator; no authorization or execution implication.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional identified creator; no authorization or execution implication.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:creator": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to IRI set, `0..many`. The metadata author attributes
creation to identified parties. Consumers may preserve attribution, not
derive access permission or actual processing from it. Example: an
explicit creator IRI. Counterexample: inferring identity from a repository
account instead of an authorized declaration.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional identified creator; no authorization or execution implication.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:creator": [
        "urn:example:related"
    ]
}
```

<a id="property-dcterms-publisher"></a>
## `dcterms:publisher` (property)

Optional identified publisher; no authenticity or permission guarantee.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional identified publisher; no authenticity or permission guarantee.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:publisher": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to IRI set, `0..many`. The author identifies
publication responsibility. Consumers separately authenticate a publisher
when required. Example: an explicitly named publication service.
Counterexample: treating the asserted IRI as a verified signing identity.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional identified publisher; no authenticity or permission guarantee.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:publisher": [
        "urn:example:related"
    ]
}
```

<a id="property-dcterms-license"></a>
## `dcterms:license` (property)

Optional license document link; not native access authorization.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional license document link; not native access authorization.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:license": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to license-document IRI set, `0..many`. An authorized
metadata author states the applicable link; consumers do not infer a license
when omitted or treat one as native access authorization. Example: an
explicitly authorized license-document link. Counterexample: a renderer
silently assigning a default license.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional license document link; not native access authorization.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:license": [
        "urn:example:related"
    ]
}
```

<a id="property-dcterms-references"></a>
## `dcterms:references` (property)

Optional supplemental reference; not a replacement for native Form/document references.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional supplemental reference; not a replacement for native Form/document references.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:references": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `rdfs:Resource` to IRI set, `0..many`. The author supplies supplemental
references; consumers preserve their informational relationship.
Example: a reference to explanatory material. Counterexample: using this
link in place of required document/form coordinates or automatically
retrieving it during matching.

### Use on `rdfs:Resource`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** rdfs:Resource: Optional supplemental reference; not a replacement for native Form/document references.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "dcterms:references": [
        "urn:example:related"
    ]
}
```

<a id="property-prov-used"></a>
## `prov:used` (property)

Optional actual use of an entity by an activity, not planned input consumption.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional actual use of an entity by an activity, not planned input consumption.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:used": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Activity` to entity IRI set, `0..many`. The provenance author
records actual entity use by an activity; a consumer must distinguish it
from planned input consumption. Example: an actual analysis activity
records the image it used. Counterexample: asserting use merely because
a Need matched a source.

### Use on `prov:Activity`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Activity: Optional actual use of an entity by an activity, not planned input consumption.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:used": [
        "urn:example:related"
    ]
}
```

<a id="property-prov-wasgeneratedby"></a>
## `prov:wasGeneratedBy` (property)

Optional actual generating activity, not a desired or selected execution.

**Datatype / container:** `node`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional actual generating activity, not a desired or selected execution.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasGeneratedBy": "urn:example:related"
}
```

**Edition-specific definition and counterexample:**

**Direct AV use:** `prov:Entity` to activity IRI, `0..1`. The provenance
author records the actual generating activity. Consumers do not equate
the relation with a selected or desired execution. Example: a real
result entity's generating activity. Counterexample: generating such a
claim from a result FormReference before invocation.

### Use on `prov:Entity`

**Range:** `IRI`. **Cardinality:** `0..1`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Entity: Optional actual generating activity, not a desired or selected execution.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasGeneratedBy": "urn:example:related"
}
```

<a id="property-prov-wasderivedfrom"></a>
## `prov:wasDerivedFrom` (property)

Optional actual derivation from an entity, not an inferred transform from matching facts.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional actual derivation from an entity, not an inferred transform from matching facts.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasDerivedFrom": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Entity` to entity IRI set, `0..many`. The provenance author
records actual derivation; consumers do not infer a transformation from
equal geometry or compatible metadata. Example: a converted image records
its actual source entity. Counterexample: claiming a conversion because
JPEG and BGR8 Offers are both discoverable.

### Use on `prov:Entity`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Entity: Optional actual derivation from an entity, not an inferred transform from matching facts.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasDerivedFrom": [
        "urn:example:related"
    ]
}
```

<a id="property-prov-wasassociatedwith"></a>
## `prov:wasAssociatedWith` (property)

Optional responsible agent association with an actual activity; Thing and Agent are distinct.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional responsible agent association with an actual activity; Thing and Agent are distinct.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasAssociatedWith": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Activity` to agent IRI set, `0..many`. The provenance author
records responsibility for an actual activity. Consumers keep Thing and
PROV Agent roles distinct. Example: an actual activity names a responsible
agent. Counterexample: automatically treating every processor Thing as
the authenticated responsible agent.

### Use on `prov:Activity`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Activity: Optional responsible agent association with an actual activity; Thing and Agent are distinct.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasAssociatedWith": [
        "urn:example:related"
    ]
}
```

<a id="property-prov-wasattributedto"></a>
## `prov:wasAttributedTo` (property)

Optional attribution of an entity to an agent; not an access grant.

**Datatype / container:** `node`; unordered array/set. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional attribution of an entity to an agent; not an access grant.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasAttributedTo": [
        "urn:example:related"
    ]
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Entity` to agent IRI set, `0..many`. The provenance author
attributes an entity to an agent. Consumers preserve attribution without
creating an access grant. Example: an actual result's attribution.
Counterexample: accepting native credentials on the strength of this claim.

### Use on `prov:Entity`

**Range:** `IRI`. **Cardinality:** `0..*`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Entity: Optional attribution of an entity to an agent; not an access grant.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:wasAttributedTo": [
        "urn:example:related"
    ]
}
```

<a id="property-prov-startedattime"></a>
## `prov:startedAtTime` (property)

Optional known actual activity start with timezone; not sensor capture time.

**Datatype / container:** `dateTime`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional known actual activity start with timezone; not sensor capture time.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:startedAtTime": "2026-09-14T00:00:00Z"
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Activity` to `xsd:dateTime`, `0..1`, with explicit timezone
in this direct serialization. The provenance author states a known actual
activity start. Consumers do not treat it as sensor capture time.
Example: the illustrative value `2000-01-01T00:00:00Z`.
Counterexample: inventing an activity timestamp from a Need or a local
image-receipt timestamp. [[!XSD11-DATATYPES]][^xsd]

### Use on `prov:Activity`

**Range:** `dateTime`. **Cardinality:** `0..1`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Activity: Optional known actual activity start with timezone; not sensor capture time.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:startedAtTime": "2026-09-14T00:00:00Z"
}
```

<a id="property-prov-endedattime"></a>
## `prov:endedAtTime` (property)

Optional known actual activity end with timezone; not delivery or durable commitment.

**Datatype / container:** `dateTime`; one value when present. **Unit:** not an additional numeric unit.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** Optional known actual activity end with timezone; not delivery or durable commitment.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:endedAtTime": "2026-09-14T00:00:00Z"
}
```

**Edition-specific definition and counterexample:**

**Use:** `prov:Activity` to `xsd:dateTime`, `0..1`, with explicit timezone.
The provenance author states a known actual activity end. Consumers do
not infer delivery, durable commitment, or capture timing.
Example: the illustrative value `2000-01-01T00:01:00Z`.
Counterexample: treating a metadata match as a completed activity.
No AV clock or timestamp framework is introduced.

### Use on `prov:Activity`

**Range:** `dateTime`. **Cardinality:** `0..1`.

**Defined by:** https://www.w3.org/TR/2013/REC-prov-o-20130430/

**Declared by:** Metadata author; actual provenance requires actual execution evidence

**Source of truth:** The upstream standard's relation and the author's known metadata/evidence

**Describes:** prov:Activity: Optional known actual activity end with timezone; not delivery or durable commitment.

**Used by:** Metadata/provenance consumers; not the core descriptor matcher

**How to specify:** Use the existing external predicate directly; do not invent an AV alias.

**Boundary:** No mandatory AV provenance wrapper, camera-control machinery or authorization semantics.

**Defaults / omission (no-declaration):** No claim is made; unknown facts or unobserved execution must not be inferred.

**Example:** External metadata fragment, not a complete TD/Mode.

```json
{
    "prov:endedAtTime": "2026-09-14T00:00:00Z"
}
```

<a id="value-mediakind-live"></a>
## `av:Live` (controlled value)

Open-ended live media. No zero duration, recording extent or delivered-continuity guarantee.

**Datatype / use:** controlled IRI in `MediaKind`, used by `av:kind`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Open-ended live media. No zero duration, recording extent or delivered-continuity guarantee.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Live as the value of av:kind.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:kind property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:kind": "av:Live"
}
```

**Edition-specific definition and counterexample:**

Open-ended media at the named interface, with no declared finite end.
It may contain video, audio, or both. Use it as Mode kind, not as a
reservation or acquisition state. A consumer does not infer duration zero,
continuous delivery, or an arrival-time guarantee. Example: native live
audio. Counterexample: inferring a video Track merely from Live.

<a id="value-mediakind-still"></a>
## `av:Still` (controlled value)

One finite image item with one or more image Tracks; no audio, cadence or frameRate. Reading implies neither new exposure nor synchronized capture.

**Datatype / use:** controlled IRI in `MediaKind`, used by `av:kind`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** One finite image item with one or more image Tracks; no audio, cadence or frameRate. Reading implies neither new exposure nor synchronized capture.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Still as the value of av:kind.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:kind property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:kind": "av:Still"
}
```

**Edition-specific definition and counterexample:**

One finite image-shaped item. One or more image Tracks may be components
of that item; none is an audio Track and none has cadence or frameRate.
Use it as Mode kind. The native operation determines which existing or
newly acquired item is returned. A consumer does not infer synchronization,
fresh exposure, or a capture time. Example: a multi-image native item with
a complete image roster. Counterexample: treating repeated reads as a
declared Live rate.

<a id="value-mediakind-clip"></a>
## `av:Clip` (controlled value)

The whole finite media item. Native media/container or explicit native interactions own extent and selection; no AV timeline/selector prerequisite.

**Datatype / use:** controlled IRI in `MediaKind`, used by `av:kind`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** The whole finite media item. Native media/container or explicit native interactions own extent and selection; no AV timeline/selector prerequisite.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Clip as the value of av:kind.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:kind property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:kind": "av:Clip"
}
```

**Edition-specific definition and counterexample:**

The whole finite media item, which may contain video, audio, or both.
Use it as Mode kind. Native media/container semantics own extent, seeking,
and selection. A consumer leaves an unknown duration unknown; no AV
timeline, selector, or resource record is required. Example: a whole WAV
recording. Counterexample: assuming a missing duration means zero.

<a id="value-representation-encodedvideo"></a>
## `av:EncodedVideo` (controlled value)

Codec-encoded video/image data, distinct from decoded pixels.

**Datatype / use:** controlled IRI in `Representation`, used by `av:representation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Codec-encoded video/image data, distinct from decoded pixels.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:EncodedVideo as the value of av:representation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:representation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:representation": "av:EncodedVideo"
}
```

**Edition-specific definition and counterexample:**

Codec-encoded video or image data, distinct from decoded pixels. Use it
as Track representation with width, height, and H264/JPEG/H265 codec.
The consumer does not infer a raw pixel format. Example: a JPEG Still.
Counterexample: an encoded Track declaring a RawVideo bufferLayout.

<a id="value-representation-rawvideo"></a>
## `av:RawVideo` (controlled value)

Unencoded image pixels with a fixed format and memory layout.

**Datatype / use:** controlled IRI in `Representation`, used by `av:representation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Unencoded image pixels with a fixed format and memory layout.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:RawVideo as the value of av:representation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:representation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:representation": "av:RawVideo"
}
```

**Edition-specific definition and counterexample:**

Unencoded image pixels with an explicit supported pixel format and image
buffer-layout category. Width, height, pixelFormat, and bufferLayout are
required. A consumer obtains detailed layout and access natively.
Example: contiguous BGR8 output. Counterexample: treating compressed
image bytes as unencoded pixels.

<a id="value-representation-encodedaudio"></a>
## `av:EncodedAudio` (controlled value)

Codec-encoded audio, distinct from decoded samples.

**Datatype / use:** controlled IRI in `Representation`, used by `av:representation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Codec-encoded audio, distinct from decoded samples.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:EncodedAudio as the value of av:representation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:representation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:representation": "av:EncodedAudio"
}
```

**Edition-specific definition and counterexample:**

Codec-encoded audio, distinct from decoded samples. AAC/Opus codec,
sampleRate, channels, and channelLayout are required. Consumers do not
infer PCM sample format or storage layout. Example: declared AAC mono.
Counterexample: omitting sampleRate because the transport has a clock rate.

<a id="value-representation-pcm"></a>
## `av:PCM` (controlled value)

Uncompressed audio samples with explicit sample and buffer formats.

**Datatype / use:** controlled IRI in `Representation`, used by `av:representation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Uncompressed audio samples with explicit sample and buffer formats.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:PCM as the value of av:representation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:representation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:representation": "av:PCM"
}
```

**Edition-specific definition and counterexample:**

Uncompressed audio samples with explicit sampleRate, channels,
channelLayout, sampleFormat, and audio bufferLayout. A native payload may
still have a container; PCM describes its samples. Example: S16LE samples
inside a WAV item. Counterexample: treating `audio/wav` as the sampleFormat.

<a id="value-codec-h264"></a>
## `av:H264` (controlled value)

ITU-T H.264/AVC encoded-video family. Native bitstream and negotiation own decoder initialization, profile and level; no decoder-support claim.

**Datatype / use:** controlled IRI in `Codec`, used by `av:codec`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** ITU-T H.264/AVC encoded-video family. Native bitstream and negotiation own decoder initialization, profile and level; no decoder-support claim.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:H264 as the value of av:codec.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:codec property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:codec": "av:H264"
}
```

**Edition-specific definition and counterexample:**

The ITU-T H.264/AVC encoded-video family, used only with EncodedVideo.
A consumer obtains native initialization and profile/level information.
Example: an established H.264 native stream. Counterexample: claiming
decoder support or SPS/PPS availability from this value alone.

<a id="value-codec-jpeg"></a>
## `av:JPEG` (controlled value)

JPEG-coded image family. The actual coding variant and decoding remain native; not raw RGB/BGR pixels.

**Datatype / use:** controlled IRI in `Codec`, used by `av:codec`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** JPEG-coded image family. The actual coding variant and decoding remain native; not raw RGB/BGR pixels.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:JPEG as the value of av:codec.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:codec property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:codec": "av:JPEG"
}
```

**Edition-specific definition and counterexample:**

The JPEG-coded image family, used only with EncodedVideo. The actual
coding variant and decoding are native concerns; it is not raw RGB/BGR.
Example: an HTTP `image/jpeg` Still whose dimensions are known.
Counterexample: directly satisfying a RawVideo/RGB8 contract.

<a id="value-codec-aac"></a>
## `av:AAC` (controlled value)

AAC encoded-audio family. Native configuration owns object type, initialization and transport parameters; no decoder-support claim.

**Datatype / use:** controlled IRI in `Codec`, used by `av:codec`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** AAC encoded-audio family. Native configuration owns object type, initialization and transport parameters; no decoder-support claim.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:AAC as the value of av:codec.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:codec property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:codec": "av:AAC"
}
```

**Edition-specific definition and counterexample:**

The AAC encoded-audio family, used only with EncodedAudio. Native
configuration supplies object type, decoder initialization, and transport
parameters. Example: an explicitly described AAC Track.
Counterexample: assuming ADTS framing, an AudioSpecificConfig, or a
particular PCM output format merely from AAC.

<a id="value-codec-h265"></a>
## `av:H265` (controlled value)

ITU-T H.265 / ISO/IEC 23008-2 HEVC encoded-video family. Native bitstream and negotiation own profile, tier, level and initialization; not H264, a container or a WebRTC support claim.

**Datatype / use:** controlled IRI in `Codec`, used by `av:codec`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** ITU-T H.265 / ISO/IEC 23008-2 HEVC encoded-video family. Native bitstream and negotiation own profile, tier, level and initialization; not H264, a container or a WebRTC support claim.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:H265 as the value of av:codec.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:codec property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:codec": "av:H265"
}
```

**Edition-specific definition and counterexample:**

The ITU-T H.265 / ISO/IEC 23008-2 HEVC encoded-video family, used only
with EncodedVideo. Native bitstream and negotiation supply profile, tier,
level, and initialization. Example: a known HEVC native output.
Counterexample: equating H265 with H264, a container, or WebRTC support.

<a id="value-codec-opus"></a>
## `av:Opus` (controlled value)

IETF RFC 6716 Opus encoded-audio family. Native configuration and negotiation own framing and transport; not PCM or a guarantee of sample rate, channels or decoder support.

**Datatype / use:** controlled IRI in `Codec`, used by `av:codec`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** IETF RFC 6716 Opus encoded-audio family. Native configuration and negotiation own framing and transport; not PCM or a guarantee of sample rate, channels or decoder support.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Opus as the value of av:codec.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:codec property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:codec": "av:Opus"
}
```

**Edition-specific definition and counterexample:**

The RFC 6716 Opus encoded-audio family, used only with EncodedAudio.
Native negotiation supplies framing and transport. An RTP timestamp clock
does not independently establish this Track's actual media sampling rate
or channel count. Example: an Opus Track with separately known audio facts.
Counterexample: assuming PCM or inferring channels from a signaling clock.
[[!RFC6716]][^opus-clock]

<a id="value-pixelformat-bgr8"></a>
## `av:BGR8` (controlled value)

uint8 B,G,R component order; HWC logical geometry; three bytes per pixel.

**Datatype / use:** controlled IRI in `PixelFormat`, used by `av:pixelFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** uint8 B,G,R component order; HWC logical geometry; three bytes per pixel.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:BGR8 as the value of av:pixelFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:pixelFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:pixelFormat": "av:BGR8"
}
```

**Edition-specific definition and counterexample:**

Three unsigned eight-bit components per pixel, ordered blue, green, red,
in height/width/component logical order: three octets per pixel.
The consumer does not reverse channels implicitly. Example: packed rows
of `3 * width` octets. Counterexample: interpreting those octets as RGB.

<a id="value-pixelformat-rgb8"></a>
## `av:RGB8` (controlled value)

uint8 R,G,B component order; HWC logical geometry; three bytes per pixel.

**Datatype / use:** controlled IRI in `PixelFormat`, used by `av:pixelFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** uint8 R,G,B component order; HWC logical geometry; three bytes per pixel.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:RGB8 as the value of av:pixelFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:pixelFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:pixelFormat": "av:RGB8"
}
```

**Edition-specific definition and counterexample:**

Three unsigned eight-bit components per pixel, ordered red, green, blue,
in height/width/component logical order: three octets per pixel.
It does not by itself assert a transfer function or color space.
Example: an actual RGB8 output. Counterexample: treating BGR8 as an
equivalent layout without an explicit conversion.

<a id="value-pixelformat-mono8"></a>
## `av:Mono8` (controlled value)

One uint8 intensity component per pixel.

**Datatype / use:** controlled IRI in `PixelFormat`, used by `av:pixelFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** One uint8 intensity component per pixel.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Mono8 as the value of av:pixelFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:pixelFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:pixelFormat": "av:Mono8"
}
```

**Edition-specific definition and counterexample:**

One unsigned eight-bit intensity component per pixel: one octet per
logical pixel. It does not assert a calibrated physical intensity or
transfer function. Example: an actual single-component image.
Counterexample: interpreting a two-byte monochrome native format as Mono8.

<a id="value-pixelformat-yuv420p"></a>
## `av:YUV420P` (controlled value)

8-bit planar Y then U then V, 4:2:0 sampling; exact colorimetry and strides remain native interface facts.

**Datatype / use:** controlled IRI in `PixelFormat`, used by `av:pixelFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** 8-bit planar Y then U then V, 4:2:0 sampling; exact colorimetry and strides remain native interface facts.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:YUV420P as the value of av:pixelFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:pixelFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:pixelFormat": "av:YUV420P"
}
```

**Edition-specific definition and counterexample:**

Unsigned eight-bit planar Y, then U, then V with 4:2:0 subsampling.
For width `W` and height `H`, Y has `W * H` samples and each chroma
plane has `ceil(W/2) * ceil(H/2)` samples. Odd dimensions do not permit
truncating chroma planes. Native facts supply chroma siting, range,
colorimetry, strides, and accessible plane offsets.
Example: a `5` by `3` grid has `3` by `2` U and V planes.
Counterexample: treating interleaved UV as this planar format.

<a id="value-cadence-constant"></a>
## `av:Constant` (controlled value)

Exact constant media cadence, requiring frameRate.

**Datatype / use:** controlled IRI in `Cadence`, used by `av:cadence`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Exact constant media cadence, requiring frameRate.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Constant as the value of av:cadence.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:cadence property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:cadence": "av:Constant"
}
```

**Edition-specific definition and counterexample:**

An exact constant video media cadence, requiring a positive reduced
frameRate. It is applicable only to Live/Clip video. Consumers distinguish
that media-timeline fact from arrival rate or delivered completeness.
Example: established `30/1`. Counterexample: declaring Constant without
frameRate or on Still.

<a id="value-cadence-variable"></a>
## `av:Variable` (controlled value)

Variable media cadence; no exact frameRate is implied.

**Datatype / use:** controlled IRI in `Cadence`, used by `av:cadence`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Variable media cadence; no exact frameRate is implied.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Variable as the value of av:cadence.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:cadence property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:cadence": "av:Variable"
}
```

**Edition-specific definition and counterexample:**

Known variable video media cadence, applicable only to Live/Clip video.
An exact frameRate is forbidden; a nominal average is not an AV exact rate.
Example: a native variable-frame-rate clip.
Counterexample: filling frameRate with an observed average.

<a id="value-cadence-triggered"></a>
## `av:Triggered` (controlled value)

Event/trigger-determined cadence, not a constant rate.

**Datatype / use:** controlled IRI in `Cadence`, used by `av:cadence`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Event/trigger-determined cadence, not a constant rate.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Triggered as the value of av:cadence.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:cadence property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:cadence": "av:Triggered"
}
```

**Edition-specific definition and counterexample:**

Known event- or trigger-determined video cadence, applicable only to
Live/Clip video, without an exact frameRate. It describes timing behavior,
not a trigger command or permission. Example: a native event-driven output.
Counterexample: invoking camera controls because this value is present.

<a id="value-channellayout-mono"></a>
## `av:Mono` (controlled value)

One audio channel.

**Datatype / use:** controlled IRI in `ChannelLayout`, used by `av:channelLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** One audio channel.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Mono as the value of av:channelLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:channelLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:channelLayout": "av:Mono"
}
```

**Edition-specific definition and counterexample:**

One audio channel; channels must equal one. It describes channel meaning,
not whether samples are planar or interleaved. Example: an actual
single-channel Track. Counterexample: two unspecified channels labeled Mono.

<a id="value-channellayout-stereolr"></a>
## `av:StereoLR` (controlled value)

Two ordered audio channels: left, then right.

**Datatype / use:** controlled IRI in `ChannelLayout`, used by `av:channelLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Two ordered audio channels: left, then right.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:StereoLR as the value of av:channelLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:channelLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:channelLayout": "av:StereoLR"
}
```

**Edition-specific definition and counterexample:**

Two ordered audio channels, left followed by right; channels must equal
two. BufferLayout separately describes storage. Example: left/right PCM
in either supported audio layout. Counterexample: assuming left/right
meaning from an otherwise unexplained count of two.

<a id="value-sampleformat-s16le"></a>
## `av:S16LE` (controlled value)

Signed 16-bit little-endian PCM samples.

**Datatype / use:** controlled IRI in `SampleFormat`, used by `av:sampleFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Signed 16-bit little-endian PCM samples.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:S16LE as the value of av:sampleFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:sampleFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:sampleFormat": "av:S16LE"
}
```

**Edition-specific definition and counterexample:**

Signed 16-bit little-endian PCM samples, two octets per sample, with
two's-complement integer values from `-32768` through `32767`.
The format is a byte representation, not a loudness calibration.
Example: actual S16LE audio. Counterexample: using host-endian storage
without establishing little-endian bytes.

<a id="value-sampleformat-f32le"></a>
## `av:F32LE` (controlled value)

IEEE 754 binary32 little-endian PCM samples.

**Datatype / use:** controlled IRI in `SampleFormat`, used by `av:sampleFormat`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** IEEE 754 binary32 little-endian PCM samples.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:F32LE as the value of av:sampleFormat.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:sampleFormat property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:sampleFormat": "av:F32LE"
}
```

**Edition-specific definition and counterexample:**

IEEE 754 binary32 little-endian PCM samples, four octets per sample.
The value specifies representation, not application amplitude scaling
or acceptance of exceptional sample values. Those are native payload
requirements. Example: actual F32LE audio. Counterexample: inferring
a normalized `[-1, 1]` range or an AV JSON-number exception policy for
the binary payload. [[IEEE754]][^ieee754]

<a id="value-bufferlayout-contiguous"></a>
## `av:Contiguous` (controlled value)

Packed raw image rows have no inter-row gaps; actual plane layout follows pixel format and native interface.

**Datatype / use:** controlled IRI in `BufferLayout`, used by `av:bufferLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Packed raw image rows have no inter-row gaps; actual plane layout follows pixel format and native interface.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Contiguous as the value of av:bufferLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:bufferLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:bufferLayout": "av:Contiguous"
}
```

**Edition-specific definition and counterexample:**

RawVideo layout with packed rows and no inter-row gaps in each logical
plane. PixelFormat determines row sample packing. Plane placement follows
the native interface and is not proven by this category alone.
Example: packed BGR8 rows. Counterexample: assuming that separately
addressed YUV planes are one concatenated allocation.

<a id="value-bufferlayout-strided"></a>
## `av:Strided` (controlled value)

Raw image rows or planes use strides. Actual stride values, offsets and memory accessibility remain native and are not implied here.

**Datatype / use:** controlled IRI in `BufferLayout`, used by `av:bufferLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** Raw image rows or planes use strides. Actual stride values, offsets and memory accessibility remain native and are not implied here.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Strided as the value of av:bufferLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:bufferLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:bufferLayout": "av:Strided"
}
```

**Edition-specific definition and counterexample:**

RawVideo rows or planes use native strides. Actual strides, offsets,
orientation, accessible extents, and lifetime must be obtained through
the native binding when needed. Example: padded native image rows.
Counterexample: considering any Strided buffer compatible without learning
its actual layout.

<a id="value-bufferlayout-interleaved"></a>
## `av:Interleaved` (controlled value)

PCM audio channel samples alternate within each sample frame.

**Datatype / use:** controlled IRI in `BufferLayout`, used by `av:bufferLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** PCM audio channel samples alternate within each sample frame.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Interleaved as the value of av:bufferLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:bufferLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:bufferLayout": "av:Interleaved"
}
```

**Edition-specific definition and counterexample:**

PCM channel samples occur in channel order within each sample frame.
For StereoLR the logical sequence is left, right for each frame.
The native contract owns external framing, padding, and access.
Example: left/right S16LE frames. Counterexample: interpreting channel
planes as alternated samples.

<a id="value-bufferlayout-planar"></a>
## `av:Planar` (controlled value)

PCM audio channels occupy separate sample planes.

**Datatype / use:** controlled IRI in `BufferLayout`, used by `av:bufferLayout`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Publisher of the offered interface

**Source of truth:** Known native media facts at this exact offered interface

**Describes:** PCM audio channels occupy separate sample planes.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Planar as the value of av:bufferLayout.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:bufferLayout property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:bufferLayout": "av:Planar"
}
```

**Edition-specific definition and counterexample:**

PCM channels occupy separate sample planes in channelLayout order.
Native access defines plane locations and extents. This is an audio
bufferLayout, not a RawVideo value. Example: separate left and right
PCM planes. Counterexample: assigning Planar to a YUV420P Track's
bufferLayout instead of Contiguous or Strided.

<a id="value-presence-required"></a>
## `av:Required` (controlled value)

This whole named input must be selected and satisfy its entire accepts schema; no execution is implied.

**Datatype / use:** controlled IRI in `Presence`, used by `av:presence`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Workload author

**Source of truth:** Explicit named input obligation

**Describes:** This whole named input must be selected and satisfy its entire accepts schema; no execution is implied.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Required as the value of av:presence.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:presence property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:presence": "av:Required"
}
```

**Edition-specific definition and counterexample:**

The requirement author requires selection of this whole named input and
satisfaction of its complete accepts schema. A matcher cannot omit it.
Example: the only inspection image input. Counterexample: returning a
successful selection without it. Selection still does not execute work.

<a id="value-presence-optional"></a>
## `av:Optional` (controlled value)

The whole input may be left unselected. If selected, every condition of its accepts schema remains hard.

**Datatype / use:** controlled IRI in `Presence`, used by `av:presence`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** WoT AV 0.2-proposed controlled description

**Declared by:** Workload author

**Source of truth:** Explicit named input obligation

**Describes:** The whole input may be left unselected. If selected, every condition of its accepts schema remains hard.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use av:Optional as the value of av:presence.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:presence property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:presence": "av:Optional"
}
```

**Edition-specific definition and counterexample:**

The requirement author permits this whole input to be unselected. The
requirement must still be valid; when included every schema condition
remains hard. Example: explicitly omitted reference audio.
Counterexample: including nonmatching audio and treating Optional as a waiver.

<a id="value-nativeoperation-td-readproperty"></a>
## `td:readProperty` (controlled value)

The existing TD readProperty operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD readProperty operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:readProperty as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#readProperty"
}
```

**Edition-specific definition and counterexample:**

Read a Property's value, using a Property Form. It is an AV result-role
operation. Example: read the snapshot Property. Counterexample: using
it on a write-only Property or treating the read as fresh exposure.

<a id="value-nativeoperation-td-writeproperty"></a>
## `td:writeProperty` (controlled value)

The existing TD writeProperty operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD writeProperty operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:writeProperty as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#writeProperty"
}
```

**Edition-specific definition and counterexample:**

Write a Property's value, using a Property Form. It is an AV
destination-role operation, not a result operation. Example: write an
explicitly supported receiver Property. Counterexample: using it on
a read-only Property or inferring a write from a Need.

<a id="value-nativeoperation-td-observeproperty"></a>
## `td:observeProperty` (controlled value)

The existing TD observeProperty operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD observeProperty operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:observeProperty as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#observeProperty"
}
```

**Edition-specific definition and counterexample:**

Observe changes to a Property through its declared observation interaction.
It requires `observable: true` and explicit native operation support, and
can select AV result values. Example: consume observed result values.
Counterexample: assuming observable automatically adds this operation to
a Form with omitted `op`.

<a id="value-nativeoperation-td-unobserveproperty"></a>
## `td:unobserveProperty` (controlled value)

The existing TD unobserveProperty operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD unobserveProperty operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:unobserveProperty as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#unobserveProperty"
}
```

**Edition-specific definition and counterexample:**

Stop a Property observation using the native observation interaction.
It is generic cleanup, not an AV payload source or destination.
Example: terminate an existing observation. Counterexample: treating
the cleanup response as the selected result data.

<a id="value-nativeoperation-td-readallproperties"></a>
## `td:readAllProperties` (controlled value)

The existing TD readAllProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD readAllProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:readAllProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#readAllProperties"
}
```

**Edition-specific definition and counterexample:**

Read all applicable Property values through a Thing-level aggregate Form.
It is not a per-Property AV result-role shortcut. Example: a declared
aggregate read. Counterexample: inventing an aggregate endpoint by joining
individual Property hrefs.

<a id="value-nativeoperation-td-writeallproperties"></a>
## `td:writeAllProperties` (controlled value)

The existing TD writeAllProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD writeAllProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:writeAllProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#writeAllProperties"
}
```

**Edition-specific definition and counterexample:**

Write all applicable Property values through a declared Thing-level Form.
It is not an AV result destination. Example: an authorized native aggregate
write. Counterexample: treating AV read-only facts as writable values.

<a id="value-nativeoperation-td-readmultipleproperties"></a>
## `td:readMultipleProperties` (controlled value)

The existing TD readMultipleProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD readMultipleProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:readMultipleProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#readMultipleProperties"
}
```

**Edition-specific definition and counterexample:**

Read a chosen set of Property values through a Thing-level Form using
native selection parameters. Example: an explicitly supported multiple read.
Counterexample: guessing missing native property selectors or assigning
an arbitrary aggregate response as an AV result schema.

<a id="value-nativeoperation-td-writemultipleproperties"></a>
## `td:writeMultipleProperties` (controlled value)

The existing TD writeMultipleProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD writeMultipleProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:writeMultipleProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#writeMultipleProperties"
}
```

**Edition-specific definition and counterexample:**

Write a chosen set of Property values through a Thing-level Form with
native parameters and authorization. It is not an AV destination-role
operation. Example: an explicitly selected native multiple write.
Counterexample: interpreting selected media dimensions as settings to write.

<a id="value-nativeoperation-td-observeallproperties"></a>
## `td:observeAllProperties` (controlled value)

The existing TD observeAllProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD observeAllProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:observeAllProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#observeAllProperties"
}
```

**Edition-specific definition and counterexample:**

Observe Property values through a declared Thing-level aggregate
observation Form. It is generic native access, not the AV single-affordance
result-role mapping. Example: a supported aggregate observation.
Counterexample: assuming independent observation Forms imply this endpoint.

<a id="value-nativeoperation-td-unobserveallproperties"></a>
## `td:unobserveAllProperties` (controlled value)

The existing TD unobserveAllProperties operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD unobserveAllProperties operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:unobserveAllProperties as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#unobserveAllProperties"
}
```

**Edition-specific definition and counterexample:**

Stop native aggregate Property observation through its Thing-level Form.
Example: explicit cleanup of that interaction. Counterexample: treating
a cleanup acknowledgement as successful media processing.

<a id="value-nativeoperation-td-invokeaction"></a>
## `td:invokeAction` (controlled value)

The existing TD invokeAction operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD invokeAction operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:invokeAction as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#invokeAction"
}
```

**Edition-specific definition and counterexample:**

Invoke a native Action. For AV result the selected schema is Action
`output`; for destination it is Action `input`. Native arguments, effects,
completion semantics, and errors remain authoritative. Example: explicitly
invoke inspect. Counterexample: invoking it merely because a Need names it.

<a id="value-nativeoperation-td-queryaction"></a>
## `td:queryAction` (controlled value)

The existing TD queryAction operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD queryAction operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:queryAction as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#queryAction"
}
```

**Edition-specific definition and counterexample:**

Query an Action's native execution/status interaction using an Action
Form and any required native identifier. It is not an AV result-role
operation in this edition. Example: query a known native action execution.
Counterexample: inventing an action identifier or completion state.

<a id="value-nativeoperation-td-cancelaction"></a>
## `td:cancelAction` (controlled value)

The existing TD cancelAction operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD cancelAction operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:cancelAction as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#cancelAction"
}
```

**Edition-specific definition and counterexample:**

Request cancellation through an Action's native interaction. It is not an
AV lease or generic cancellation protocol. Example: cancel an identified
native execution where supported. Counterexample: inferring that changing
a Need cancels work.

<a id="value-nativeoperation-td-queryallactions"></a>
## `td:queryAllActions` (controlled value)

The existing TD queryAllActions operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD queryAllActions operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:queryAllActions as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#queryAllActions"
}
```

**Edition-specific definition and counterexample:**

Query native Action status information through a declared Thing-level
aggregate Form. Example: an explicitly supported aggregate status query.
Counterexample: inferring an AV current-work registry from the operation.

<a id="value-nativeoperation-td-subscribeevent"></a>
## `td:subscribeEvent` (controlled value)

The existing TD subscribeEvent operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD subscribeEvent operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:subscribeEvent as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#subscribeEvent"
}
```

**Edition-specific definition and counterexample:**

Establish a native Event subscription. For AV result the payload schema
is Event `data`, not subscription setup data or its acknowledgement.
Example: consume actual result notifications. Counterexample: interpreting
subscription success as a produced result.

<a id="value-nativeoperation-td-unsubscribeevent"></a>
## `td:unsubscribeEvent` (controlled value)

The existing TD unsubscribeEvent operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD unsubscribeEvent operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:unsubscribeEvent as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#unsubscribeEvent"
}
```

**Edition-specific definition and counterexample:**

Terminate a native Event subscription. It is generic cleanup, not an AV
result source or destination. Example: explicit subscription cleanup.
Counterexample: forwarding its acknowledgement as the event's data payload.

<a id="value-nativeoperation-td-subscribeallevents"></a>
## `td:subscribeAllEvents` (controlled value)

The existing TD subscribeAllEvents operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD subscribeAllEvents operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:subscribeAllEvents as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#subscribeAllEvents"
}
```

**Edition-specific definition and counterexample:**

Subscribe through a declared Thing-level aggregate Event Form. Its native
aggregate contract is not the AV single-Event result mapping.
Example: a supported aggregate subscription. Counterexample: fabricating
one from independent Event Forms.

<a id="value-nativeoperation-td-unsubscribeallevents"></a>
## `td:unsubscribeAllEvents` (controlled value)

The existing TD unsubscribeAllEvents operation, not a new AV operation.

**Datatype / use:** controlled IRI in `NativeOperation`, used by `av:operation`. Cardinality and conditions are those of that property, not a second field.

**Defined by:** https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/

**Declared by:** Selecting party; native TD publisher owns operation support

**Source of truth:** Native TD operation semantics and supported Form

**Describes:** The existing TD unsubscribeAllEvents operation, not a new AV operation.

**Used by:** Consumers test this exact controlled value in its applicable property; no local-name or nearest-value substitution.

**How to specify:** Use td:unsubscribeAllEvents as the value of av:operation.

**Boundary:** No control command, authorization, codec implementation or runtime availability follows from this label.

**Defaults / omission (property-defined):** The owning av:operation property's per-use presence and omission rules apply; no controlled member is a default.

**Example:** Property-value fragment, not a complete TD or concrete Mode.

```json
{
    "av:operation": "https://www.w3.org/2019/wot/td#unsubscribeAllEvents"
}
```

**Edition-specific definition and counterexample:**

Terminate native aggregate Event subscription through the declared
Thing-level Form. Example: explicit aggregate cleanup. Counterexample:
treating disappearance of a Need as this operation or as durable completion.


## Conventions

### Inventory authority

This inventory is the sole authored term authority. Semantic documentation is normative when incorporated in the root specification; authoring fields never create AV predicates or classes. Contradictions block the edition.

### Ranges

IRI is absolute; av:Class is a node of that class; enum names denote listed controlled IRIs; integer is exact xsd:integer; json is an opaque rdf:JSON literal.

### Cardinality

min/max are per-use RDF cardinalities. null max is unbounded. Concrete JSON documents additionally require complete records, arrays for set fields, unique names and condition checks.

### Numbers

Input integer facts use safe JSON integer tokens (magnitude at most 9007199254740991) or explicit full-xsd:integer typed decimal lexical values. Normalized descriptors use exact mathematical integer values; implementations must preserve their precision. No float, boolean or numeric-string coercion. Rational denominator is positive and pairs are gcd-reduced.

### Collections

Offers, Modes, Tracks and inputs are unordered sets serialized as arrays. Native Form arrays are not priorities. Track names are unique and normalized by ascending Unicode code-point order.

### Absence

Essential missing representation fields invalidate a concrete Mode. Other absent facts are unknown. presence and accepts are required; Optional only permits not selecting the entire input.

### Authority

ONVIF/GenICam/UVC/native application mechanisms own controls and operation behavior. No camera-control, trigger, lease, fence, clock, resource, provenance or controller-framework prerequisites.


## Matching rules

### Target

One complete Mode, never combined facts or tracks from several Modes or named graphs.

### Descriptor

```json
[
    "av:source",
    "av:kind",
    "av:track"
]
```

### Track identity

Include dcterms:identifier and known representation facts; omit @context, @id, @type, Form, security and backend-private fields.

### Controls

Only known exact 0.2 AV controlled IRIs normalize to av:Token. No local-name matching across namespaces.

### Schema dialect

https://json-schema.org/draft/2020-12/schema

### Schema dialect omission

An omitted $schema selects JSON Schema 2020-12 for this draft; every explicit $schema must identify exactly that supported dialect.

### Schema scope

accepts is an object carried with @type @json. Only local self-contained references; never automatic external retrieval. Standard JSON Schema keywords only; unsupported vocabularies/keywords fail explicitly.

### Presence

Hard facts need standard required keywords. properties alone does not require presence. Schema default is annotation-only and never fills facts.

### Formats

format is annotation-only; this matcher deliberately does not enable automatic format assertions.

### Ordering

Track order has no semantic meaning; use contains/items/set-wide tests. Positional prefixItems schemas are explicitly unsupported by this portable matcher.

### Rational

Exact positive reduced av:numerator/av:denominator pairs support const/enum; no general rational inequalities, cross-field arithmetic guarantee or rounded FPS.

### Boundary

Metadata compatibility is not authorization, availability, decoder/layout/transport qualification or runtime acceptance.

### Conversion

JPEG cannot satisfy BGR8 directly. An explicitly exposed interoperable processor output can advertise BGR8 separately; internal cv2 operations need no separate Thing.


## Native form rules

### Identity

Offer document resolves to a TD whose id equals source. Mode form and every FormReference form identify exactly one native Form by absolute @id, never href, array position or copied endpoint.

### Reference

FormReference document, form and native standard operation IRI are required. TD retrieval location and effective retrieval base are explicit; Thing id is not a document locator.

### Native

Apply TD base resolution, native operation defaults and Form-over-Thing security inheritance. Unknown/unsupported native semantics fail explicitly; no silent fallback.

### Result

Property DataSchema, Action output or Event data owns the result schema. A missing schema is unknown, not arbitrary-output compatibility.

### Destination

Writable-property or Action input owns sink payload semantics. A requested destination requires result and separately supported native routing; metadata does not execute it.

### Defaults source

https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/#sec-default-values

### Access

Native consumers retain original TD, binding and security authority. The reference helper resolves supplied documents and expands RFC 6570 scalar templates with explicit invocation parameters; it does not authenticate or invoke SOAP/RTSP/native operations.

### Parameters

Thing uriVariables are overlaid by the owning affordance. A separate invocation context supplies actual variables, required native identifiers, directional input and optional target policy. Schema defaults never fabricate imageId or other native arguments.

### Payload direction

Result uses Property read representation, Action output or Event notification data; destination uses Property write representation or Action input. Preserve native schema terms and nested read/write direction. Unknown schema is not arbitrary JSON; equal schemas do not prove wire compatibility or transfer.


## Processing contract

### Dialect

https://json-schema.org/draft/2020-12/schema

### Keywords

```json
[
    "$anchor",
    "$comment",
    "$defs",
    "$dynamicAnchor",
    "$dynamicRef",
    "$id",
    "$ref",
    "$schema",
    "$vocabulary",
    "additionalProperties",
    "allOf",
    "anyOf",
    "const",
    "contains",
    "contentEncoding",
    "contentMediaType",
    "contentSchema",
    "default",
    "dependentRequired",
    "dependentSchemas",
    "deprecated",
    "description",
    "else",
    "enum",
    "examples",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "format",
    "if",
    "items",
    "maxContains",
    "maxItems",
    "maxLength",
    "maxProperties",
    "maximum",
    "minContains",
    "minItems",
    "minLength",
    "minProperties",
    "minimum",
    "multipleOf",
    "not",
    "oneOf",
    "pattern",
    "patternProperties",
    "properties",
    "propertyNames",
    "readOnly",
    "required",
    "then",
    "title",
    "type",
    "unevaluatedItems",
    "unevaluatedProperties",
    "uniqueItems",
    "writeOnly"
]
```

### Schema map positions

```json
[
    "$defs",
    "dependentSchemas",
    "patternProperties",
    "properties"
]
```

### Schema array positions

```json
[
    "allOf",
    "anyOf",
    "oneOf"
]
```

### Schema single positions

```json
[
    "additionalProperties",
    "contains",
    "contentSchema",
    "else",
    "if",
    "items",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties"
]
```

### References

Fragment-only references to recognized schema locations; no external retrieval.

### Format

Annotation only, never automatic validation.

### Numbers

Exact finite decimal values; source integer-token grammar is separate from schema numeric semantics.

### Recursion

Reject potential same-instance cycles, including unused definitions, before candidate evaluation.

### Regex

The Unicode-scalar ECMAScript subset in spec.md#av-contract-regex; explicit syntax/support/resource diagnostics.

### Authority

Normative authoring grammar; never extra AV predicates, terms or profile families.


## Shape coverage

### Closed shapes

```json
[
    "Rational",
    "FormReference"
]
```

### Covered

```json
[
    "Seven class targets and declared uses",
    "Essential representation fields and forbidden fields",
    "Still without cadence",
    "Constant positive rate",
    "Channel-layout consistency",
    "Destination requires result",
    "accepts is rdf:JSON"
]
```

### Not covered

```json
[
    "JSON Schema evaluation and keyword support",
    "Rational gcd and exact JSON numeric tokens",
    "Unique record and track/input identities",
    "Native Form/document resolution",
    "Authorization, availability, runtime acceptance and native transport qualification"
]
```


## Codec publication

### Additions

```json
{
    "H265": {
        "representation": "av:EncodedVideo",
        "media_type_reference": "video/H265",
        "sources": [
            "https://www.itu.int/rec/T-REC-H.265-202309-S/en",
            "https://www.rfc-editor.org/rfc/rfc7798.html#section-1.1",
            "https://www.rfc-editor.org/rfc/rfc7798.html#section-7.1",
            "https://www.iana.org/assignments/media-types/video/H265"
        ]
    },
    "Opus": {
        "representation": "av:EncodedAudio",
        "media_type_reference": "audio/opus",
        "sources": [
            "https://www.rfc-editor.org/rfc/rfc6716.html#section-2",
            "https://www.rfc-editor.org/rfc/rfc7587.html#section-4.1",
            "https://www.rfc-editor.org/rfc/rfc7587.html#section-6.1",
            "https://www.iana.org/assignments/media-types/audio/opus"
        ]
    }
}
```

### Representation codec sets

```json
{
    "av:EncodedVideo": [
        "av:H264",
        "av:JPEG",
        "av:H265"
    ],
    "av:EncodedAudio": [
        "av:AAC",
        "av:Opus"
    ]
}
```

### Scope

Family labels only. Native bitstreams, negotiations and interfaces own exact decoder parameters, layouts and signaling; no AV pinned-profile prerequisites or implied decoder support.

### Opus clock scope

An Opus RTP timestamp clock or SDP signaling value does not prove actual media sampling rate or channel count.

## Historical migration

The complete term/profile mapping is in `av/support/migration-v0.2.json`. Original v0.1 bytes remain in `av/support/history/v0.1-proposed`; there are no silent IRI aliases.

## Specification baselines

- https://www.w3.org/TR/2023/REC-wot-thing-description11-20231205/
- https://www.w3.org/TR/2020/REC-json-ld11-20200716/
- https://www.w3.org/TR/2013/REC-prov-o-20130430/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/2020-01-20/
- https://json-schema.org/draft/2020-12/json-schema-core
