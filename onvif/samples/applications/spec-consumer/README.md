# Independent document consumer

This is an executable, deliberately bounded Python consumer derived from
`av/spec.md`, `onvif/spec.md`, their public machine annexes and the pinned native
Media2 clauses. It does **not** import the ONVIF reference plugin, its codecs,
its private descriptor classes, or the repository's AV matcher.

It consumes the same canonical Media2 `GetProfiles` and `GetSnapshotUri`
contracts through either actual SOAP 1.2 or an ordinary HTTP/JSON semantic
adapter. The CLI sends nothing until explicitly invoked with files, a document
location, trusted policy and an explicit profile selection. There is no default
camera, first-device selection, enumeration, configuration write or daemon.

## Prerequisites

- Python 3.13 and the four public packages pinned in `requirements.txt`.
  This exercise used already-installed packages; it installed nothing.
- The root ONVIF annexes, their `model-manifest.json`, and the lock-declared
  unchanged native WSDL bytes under `onvif/support/upstream/onvif`.
- For the independent test command only: an existing Node 20.19+ executable,
  the already-built camera-adapter package and
  `onvif/samples/adapters/build-windows/windows-capture-worker.exe`.
  The adapter is used solely through its documented exports and public type
  declarations. Its `mf-memory` backend never opens or enumerates hardware.
- An explicitly supplied, offline TD 1.1 validation schema. The exercised
  `1.1-09-November-2023` file has SHA-256
  `87481cfafa3847d0c593c047750e090d4365dcc0f1b5daab3a725d63c991a4da`.
  Tests do not fetch schemas or contact non-loopback endpoints.

The consumer accepts explicit `nosec` with anonymous intent and separately
scoped bearer credentials. Digest, UsernameToken, client certificates and
authentication negotiation are **unsupported**, not replaced with anonymous
access. Plain HTTP is limited to literal `127.0.0.1`; HTTPS retains standard
certificate and hostname verification. Credentials never belong in a TD.

## Run the public consumer

Supply a concrete TD and an independently trusted policy file. The policy's
`thingId`, principal, complete operation IDs, exact target URLs and, when used,
complete logical EPR/reference-header association must already be approved.
`imagePrefix` and `imageSecurity` separately authorize image retrieval.
An EPR grant is test/deployment configuration, not a vocabulary annotation or
a grant derived from the TD itself.

```powershell
python .\onvif\samples\applications\spec-consumer\consumer.py `
    --onvif-root .\onvif `
    --td '<approved-files>\camera.td.json' `
    --policy '<approved-files>\policy.json' `
    --profiles-input .\onvif\samples\applications\spec-consumer\get-profiles.json `
    --document-uri '<actual-TD-document-URI>' `
    --all-profiles
```

`--all-profiles` explicitly resolves a snapshot URI for **each token returned
by this invocation**, not a hardcoded main/sub token. Alternatively supply
`--profile-token` with an actual issued token. Neither path invents required
native input. The omitted Media2 `Type` requests profile identities without
configuration detail.

Add `--image-directory '<new-output-directory>'` to explicitly perform the
separate HTTP JPEG GETs. Files are created exclusively, not overwritten.
For a bearer-protected adapter, supply one
`--credential-env SECURITY_NAME=EXISTING_ENVIRONMENT_VARIABLE` per selected
security definition, using separate control and image credentials.
The CLI never prints credential values.

## Repeat the bounded exercise

The test runner creates its own loopback servers on port zero, obtains the
actual ports, writes complete concrete TD/TM examples, and executes the CLI
while those endpoints are alive. No fixed localhost endpoint is assumed.

```powershell
python .\onvif\tools\tests\implementer\run.py `
    --repo . `
    --output .\onvif\tools\fixtures\implementer\generated `
    --node '<installed-Node-directory>\node.exe' `
    --td-schema '<offline-standards-directory>\td11-schema.json'
```

The output contains `evidence.json`, two native-camera TD/TM/policy sets with
different issued tokens, a captured MF-memory TD/composite/policy, safe native
request traces and an independently decoded JPEG. These are **captured software
examples**, not running endpoints after the test exits; rerunning generates
new actual ephemeral addresses. Bearer values exist only in private pipes and
the CLI subprocess environment, never in those artifacts.

The MF-memory fixture must receive its explicit `mf-memory-source.json`
declaration. Its public mode is 17 by 13; the originally planned 64 by 48
configuration is reported unsupported, not silently resized. The independent
native SOAP fixture separately generates its explicitly declared 64 by 48
software image. Neither image represents camera hardware.

## AV metadata-only CLI

```powershell
python .\onvif\samples\applications\spec-consumer\av_match.py `
    --offer .\onvif\tools\fixtures\implementer\av-offer.json `
    --need .\onvif\tools\fixtures\implementer\av-need.json `
    --mode urn:example:implementer:mode:exact-audio `
    --terms .\av\terms.json
```

The literal fixture requires exact `30000/1001` video and audio in the **same**
Mode. `30/1`, video-only and audio-only alternatives are non-matches. Metadata
evaluation uses public JSON Schema 2020-12, preserves the original descriptor,
and never applies schema defaults as media facts. URI-template tests use the
public RFC 6570 library and actual document/affordance variable resolution,
including reserved expansion, query escaping and Form metadata preservation.

## Exact implementation boundary

This is not a general ONVIF stack, W3C codec, full AV conformance implementation
or certification test. The serializer implements the selected scalar,
restriction, attribute and element-sequence shapes needed by the finite pilots,
plus the frozen absent/default/nil vectors. Other present particles, mixed or
open XML, derived types, explicit false nil, unsupported native scalars/facets
and additional transport/authentication features reject explicitly.

The matcher accepts compact records and one supplied input. General JSON-LD
graph processing, multi-input assignments, schema references/resources,
regular expressions, noninteger schema numbers and directional result matching
are explicitly unsupported. Its Form function demonstrates URI-variable
resolution; it does not claim the complete native-reference conformance role.
Limits include 1 MiB SOAP/JSON responses, 16 MiB JPEG responses, bounded XML
depth/nodes/attributes/namespaces, a five-second invocation budget, a 15-second
fixture handshake and awaited native/HTTP cleanup.

The independent model check recomputes all seven profile-role inventories,
walks the native and abstract TM imports, verifies fragments and model bytes,
and keeps seven client manifests separate from TMs. It does not execute 579
operations or prove full native/semantic profile requirements. Normative
conflicts are retained in `evidence.json` and
`onvif/support/reports/implementer-exercise.md`, never repaired by importing
private runtime code.
