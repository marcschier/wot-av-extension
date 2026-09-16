# ONVIF support and conformance boundaries

**All seven released profile models are mapped; no full device/client profile
certificate is claimed.** This matrix separates current generated contracts,
observed native facts and bounded local runtime evidence as of 16 September
2026. It is not an ONVIF conformance statement or permission to operate hardware.
The [native binding index](../bindings/onvif/readme.md) links the implementation.

## Sources, roles and generated coverage

The [source lock](../bindings/onvif/sources.lock.json) pins release 26.06 at
`68ee1b540a40f848c9599eba2c55b87547c588d6`. Profile editions retain their own
dates and hashes in the [edition catalog](../bindings/onvif/catalog/profile-editions.json).
Retired Q and V/Security Add-on release candidates are not additional released
profiles. TLS Configuration is a separate add-on.

| Released edition | Device atoms | Client atoms | Mapping and representative evidence boundary |
| --- | ---: | ---: | --- |
| A 1.0, June 2017 | 108 | 102 | Access Rules, Credential, Schedule and Events contracts. Native payload cases and an independent post-Directory access-profile read are exercised; physical access-policy changes and complete client credential CRUD are not qualified. |
| C 1.0, December 2013 | 101 | 96 | Access-point/door and Event contracts. Independent post-Directory door-info and PullPoint Event paths are exercised; no physical door actuation or full C workflow is qualified. |
| D 1.0, June 2021 | 133 | 114 | Access-peripheral, DeviceIO and supported media/Event contracts. Native schema cases and an independent post-Directory DeviceIO capability read do not prove a complete peripheral/client implementation. |
| G 1.1, October 2025 | 187 | 193 | Recording/search/replay contracts. Independent SOAP fixtures exercise stateful search-result drains/faults; the media cohort exercises bounded forward replay, not reverse playback or every recording workflow. |
| M 1.1, March 2024 | 142 | 112 | Analytics, metadata and Event contracts. Complete canonical MetadataStream mapping and selected native notifications are exercised; arbitrary vendor analytics, recognition, MQTT and EXI are not thereby qualified. |
| S 1.3, November 2019 | 292 | 209 | Media1/native device contracts and legacy discovery type. Selected SOAP, streaming and metadata paths are exercised; not every S feature or device is qualified. |
| T 1.0, September 2018 | 477 | 370 | Media2, imaging/PTZ/Events and advanced streaming contracts. Selected Media2 URI and native codec paths are exercised; not every optional feature, codec profile or client obligation is qualified. |
| **Total** | **1,440** | **1,196** | **2,636 authored requirement atoms**, not 2,636 independently executed behaviors. |

The [S/T](onvif-profile-st.md), [G/M](onvif-profile-gm.md) and
[A/C/D](onvif-profile-acd.md) ledgers retain all individual role rows, source
locators, conditions, alternatives and dependency-review limitations.
Mandatory members inside conditional features or at-least-N groups are not
silently promoted to universal requirements. Unknown/denied/truncated facts
remain unknown; device evidence never substitutes for client implementation
evidence. S's GetNodes/GetNode and G's SetTrackConfiguration interpretation
conflicts remain unresolved in the [editorial register](../bindings/onvif/catalog/editorial-decisions.json).

Current [coverage](../bindings/onvif/coverage/coverage.json) records **579
compiled operations, 0 unsupported operation graphs, 3,426 type contracts,
33 bindings and 28 obligation groups**. The 39-document service compiler closure
has 48 import edges. Its 17 canonical WSDL entry points contribute 500 operation
tuples; the two separately classified conditional/add-on entry points contribute
79. These are source mappings, not universally exposed device Actions.
The [generated manifest](../bindings/onvif/generated/manifest.json) lists 304
artifacts, with 305 files including the manifest itself.

## What is actually exercised

The rows below are separate proof scopes, not counts to add into a fictional
all-system pass. Tests use owned loopback peers and synthetic media, not cameras
or physical access-control devices.

| Surface | Current bounded evidence | Not established |
| --- | --- | --- |
| Canonical compiler and XML | All-source operation/type provenance and rejecting unknown graphs; mixed content, ordered choices, IDs/uniqueness, native facets, lexical precision and full MetadataStream. [Mapping](onvif-mapping.md), [catalog tests](../packages/binding-onvif/test/catalog), [event tests](../packages/binding-onvif/test/events). | Every possible XSD construct, vendor schema or algorithm semantics. |
| Native SOAP/node-wot | Real consumed Actions at native XAddrs; Digest, UsernameToken, TLS/mTLS, WSA2004/2005, bounded requests, native faults and accepted-empty one-way Notify. [Binding](onvif-binding.md), [first gate](../packages/binding-onvif/test/binding-gate), [continued native cases](../packages/binding-onvif/test/events). | Every one of the 579 operation workflows, device effects, or every profile client obligation. |
| Native Events | Real node-wot subscribe/client/codec path, serial PullMessages, conditional Renew, complete notification data, cancellation, gaps and awaited Unsubscribe. [Events](onvif-events.md). | Universal device PullPoint/filter/renew support, arbitrary push transports, MQTT or durable application delivery. |
| Discovery | Native Device and separate legacy-S Probes, scoped UDP and fixed native read gate, typed finite inventories and parent-scoped identities. [Discovery](onvif-discovery.md). | Unapproved networks, deployment-specific multicast/multi-NIC/IPv6 confinement, configuration writes, search allocation/drain, subscriptions or media starts. |
| Directory/file publication | Preserved publication cohort passes; models/imports are independently served and read back, with explicit Directory contract, ownership/CAS and lease rules. [Runtime](onvif-runtime.md), [publication tests](../packages/binding-onvif/test/publication). | Arbitrary Directory contracts or model reachability in file-only mode. |
| Composed bridge | The current composed rerun passes, including the formerly failing separate consumer after bridge shutdown. Explicit scoped logical-EPR authorization preserves the TD ID/security and reaches the later A/C/D/Event assertions. [Regression/policy](onvif-runtime.md#logical-epr-authorization-status). | Universal alias approval, real-device behavior, every seven-profile workflow, or T/G/M media playback in that bridge case. Native media has separate evidence. |
| Node media | Completed scoped unit and actual native cohorts; Media1/Media2/Replay through the real runtime, JPEG/PCMU byte/sample oracles, full canonical metadata, session isolation, controls, backchannel and cleanup. [Node media](onvif-node-media.md), [media tests](../packages/binding-onvif/test/media). | Native H.264/H.265/MPEG-4/AAC decoding merely from HELLO inventory; those have separate native-worker evidence below. |
| Installed package and CI | Separately owned [packaging evidence](onvif-packaging.md). | Source exports, successful isolated builds or these documentation checks alone are not installed-package/CI proof. |

## Native media matrix

The completed [native C/GStreamer cohort](onvif-media-qualification.md) uses
one stable current worker and independent loopback fixtures. The matrix is
**not every codec crossed with every transport**.

| Native mode/direction | TCP interleaved | UDP unicast | HTTP tunnel | HTTPS tunnel | TLS interleaved |
| --- | --- | --- | --- | --- | --- |
| Live JPEG, PCMU and XML receive | Exercised | Exercised | Exercised | Exercised | Exercised |
| Forward recorded receive and PAUSE/PLAY/seek generations | Exercised | Unsupported | Exercised | Exercised | Exercised |
| Explicit live PCMU backchannel from S16LE/8 kHz/mono | Exercised | Exercised | Exercised | Exercised | Exercised |
| Recorded backchannel | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported |

| Native TCP decoding/reference | Measured result and boundary |
| --- | --- |
| JPEG | Exact I420 pixels for ordinary 16x16 JPEG and ONVIF SOF-adjusted 17x16 live/replay fixtures. |
| H.264 | Constrained-baseline, 8-bit, 64x48 neutral-gray I420 reference frames; not arbitrary H.264 profiles. |
| H.265 | Main, 8-bit, 64x48 neutral-gray I420 reference frames; not all profiles/bit depths. |
| MPEG-4 video | Simple Profile reference frames, including the final access unit drained by native EOS. |
| PCMU | Exact decoded receive PCM and independently decoded backchannel samples; no audible hardware-playback claim. |
| AAC | AAC-LC, 48 kHz mono, 9,216 samples including priming, within one S16 LSB on the silence reference; not all AAC modes. |
| XML metadata | Bounded native RTP assembly/gzip/XML guard; Node invokes the canonical MetadataStream decoder and retains source/clock evidence. Native XML guarding alone is not XSD validation. |

Digest scopes for native RTSP and outer tunnels are separate. TLS verification
remains enabled; trusted positives and HTTPS untrusted/wrong-host negatives are
exercised. Direct TLS interleaving has positive native evidence, not a separately
claimed set of certificate-negative vectors. Explicit legacy-MD5 cases are not
an implicit security downgrade. Final worker qualification retains native
diagnostic warnings rather than suppressing them into success claims.

Reverse replay, multicast media, SRTP/MIKEY, EXI, native-media mTLS, SRT/WebRTC,
arbitrary codec profiles/bit depths and non-Windows worker distribution remain
unsupported or unqualified. SOAP mTLS support does not imply media mTLS.
Device interoperability, physical effects, clock accuracy, bandwidth and media
quality outside the named references remain unqualified.

## Publication and claim discipline

The projector records applicability and observed operations; its
`runtimeEvidence` remains `not-established-by-projection`. Provided registered
product records retain issuer/product/firmware/source and are not independently
verified by generation. TD `profile` is not used as an ONVIF badge, and an
observed TD links to one observed composite TM rather than claiming a complete
profile wrapper.

`productConformanceEstablished` and `publicationClearanceEstablished` remain
false in generated coverage. Media capability reports likewise retain
`certification: false` and `distributionApproved: false`.
No first-party reuse license or public visibility change is implied. Public
source notices, transformed-data rights, native patch/API review, corresponding
source/relinking and codec-patent/plugin-bundle decisions remain separate
[source](onvif-sources.md) and [packaging](onvif-packaging.md) gates.
