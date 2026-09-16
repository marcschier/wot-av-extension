# Native camera semantic adapters

One private Node workspace package, `@wot-av/camera-adapters`, combines a
bounded capture interface with real node-wot 0.9.2 HTTP Forms. Windows uses
C++17 Media Foundation/WIC. Linux source implements V4L2 MMAP and direct
Aravis 0.8.36 GigE Vision/USB3 Vision. It does **not** create an ONVIF SOAP
device, use native SOAP Forms, imply complete Profile S/T support, or claim
ONVIF certification. See [qualified capability facts](capability-matrix.json).

**Qualification is separate from implementation:** Windows MF memory/WIC,
Node software/HTTP and portable C++ safety tests run without a camera.
Linux compilation, Linux/Aravis Fake runtime and every physical hardware
combination are unverified until an operator supplies an approved target.
No Docker/WSL/service startup, OS installation or device/network probe is
part of build, publication or the default test command.

## Public and private boundaries

Public exports are in `src/index.cjs`, typed by `src/contract.d.ts`:
`CaptureBackend.describe/open`, `CaptureSession.next/close/closed`,
`configuredCapturePermission`, `SemanticAdapter`, `pump`, `loadCanonical`
and `startServer`. The worker protocol is separate `capture-v1`; the native
ONVIF RTSP worker is unchanged.

The application supplies `createSemanticAdapterTd` explicitly.
`loadCanonical().createSemanticAdapterTd` connects the model owner's pure
`deriveAdapterTd` API to the source-pinned Media2 qualified operation tuples.
It returns a composite of abstract operation fragments, never a native
device/profile wrapper. HTTP serves the adapter's actual composite model at
the TD's single immediate type URL, protected by the control credential.
Its abstract imports remain the publication's canonical model dependencies.
The application adds the JPEG property; a pre-composition projection digest
is not misrepresented as a digest of that changed TD.

Canonical inputs **and** outputs are checked against the integrity-loaded
`payloads.schema.json` and `encodeElement` codec. Generated shallow TD types
are not the acceptance validator. The two implemented actions are:

| Action | Behavior |
| --- | --- |
| `Media2Binding_GetProfiles_95aacf693b24` | One configured, evidenced mode/profile; exact token lookup. Omitted/empty `Type` omits Configurations; singleton `All` includes present associations. Mixed lists select literal names. |
| `Media2Binding_GetSnapshotUri_c14d66eeeeff` | Canonical `{ "Uri": "..." }` for the stable, actually exposed JPEG property Form. Unknown token fails, never falls back. |

Media-profile tokens and `fixed=true` are persisted **adapter policy**, not
physical ONVIF profiles or sensor main/sub-profile badges. Native configuration
objects, especially VideoEncoder, are omitted unless every required field is
representable and evidenced. Raw mode catalogs are not concurrent profiles.
Neither action nor JPEG GET opens a source or triggers exposure.

`dataProcessingNative.GetProfile` is explicitly unsupported in the ordinary
sample capability record. It is not a policy protocol or an AV grammar term.
No generic camera control, lease service, fencing token or blanket grant is
required merely to describe a camera.

## Explicit acquisition and identity

Construction and cached describe do not start a worker. Fresh selected-device
reads require local permission. `open` requires a trusted `authorizeOpen`
callback, default-denied, plus a finite duration (1-30000 ms). The helper
`configuredCapturePermission` creates a simple target/mode/digest/output/
maximum-duration allowlist; it issues no transferable permission token.
Authorization, current native tuple and device identity are rechecked before
capture. Publication and retrieval have no route to this callback.

Private configurations contain the exact selector, expected scoped identity,
cached native evidence, selected mode, adapter Thing ID, stable media token
and HTTP credentials. Do not commit real selectors, serials or tokens.
Selectors travel in a bounded private stdin pipe, not command-line arguments.
Examples use invented identities and contain no working credentials.

Windows requires its opaque MF symbolic link, not device index zero.
V4L2 uses a descriptor-verified exact device node, preferably a stable
operator-known by-id path; identity is topology/instance-scoped, not globally
unique serial evidence. Aravis GigE uses literal local-interface and camera
addresses, plus checked vendor/model/serial and the current configured image
tuple. A control-session probe is explicitly distinct from native-read-only:
GigE construction already takes control. USB additionally requires explicit
permission for stock SDK library enumeration/candidate descriptor access and
driver auto-detach; otherwise it fails closed. It is not a constrained USB
open. Stock USB cleanup cannot attest checked interface release and reports
unknown resources. See [Linux protocol/access contract](native/linux/CONTRACT.md)
and [source-pinned Aravis behavior](genicam/README.md).

## Build and run without a camera

Use the installed dependencies; the adapter scripts never install packages.
The root workspace owner adds `onvif/samples/adapters` and manages the root
lockfile. The existing reference runtime must be built, including its catalog
semantic API and integrity-staged payload artifacts.

From the repository root on an already provisioned Windows MSVC host:

```powershell
.\onvif\tools\adapters\scripts\windows-build.ps1
node .\onvif\tools\adapters\run.cjs
node .\onvif\samples\adapters\src\main.cjs software-config `
    --allow-software --output '<private-directory>\software.private.json'
node .\onvif\samples\adapters\src\main.cjs run `
    --config '<private-directory>\software.private.json' `
    --allow-publication --allow-acquisition --seconds 5
```

`software-config` uses the explicitly selected MF memory backend, never a
camera. Files are created exclusively, tokens are not printed, and Windows
directory ACLs remain operator responsibility; no ACL is changed. Omitting
`--allow-acquisition` publishes only configured semantics; JPEG GET returns
503. Port zero is for isolated tests; a fixed nonzero operator port preserves
snapshot URIs across restarts.

Portable Node contracts run with `node --test
onvif/tools/tests/adapters/portable.test.cjs`. Portable C++ tests have their
own CMake project under `onvif/tools/tests/adapters/linux`, usable with MSVC;
that is **not** Linux compilation proof.

On a separately approved, provisioned Linux target, run
`bash onvif/tools/adapters/scripts/linux-build.sh`. It requires Linux headers,
OpenSSL, libjpeg and (by default) exactly Aravis 0.8.36 development libraries.
Missing/platform/version prerequisites fail, not skip as success. Linux
software CTest uses the SDK Fake interface with real transports disabled.
`linux-build-ci.informative.yml` is an integration definition, not an installed
or executed workflow. Do not start Docker's internal WSL distro to satisfy it.
Explicit operator enrollment is `linux-probe.py`; it is never run by tests.

## Bounded media and HTTP

One explicitly started acquisition loop feeds one shared JPEG cache.
Native bytes are copied while MF/V4L2/ArvBuffer ownership is held, before
unlock/requeue. Each HTTP subscriber receives an independent finite copy;
slow clients cannot block the capture callback or multiply sessions.
The finite ReadableStream uses the exact polyfill resolved by node-wot core;
its Content body is piped without a second full-image collection. This avoids
the `image/jpeg` Base64Codec Buffer serialization trap. An eager
`ProtocolHelpers.toWoTStream(Readable.from(...))` can drain before the
ExposedThing caller consumes it; that pattern is deliberately not used.

Default maxima are 4096 per dimension, 32 MiB/native payload, 16 MiB/output
frame, two in-flight image slots, 32 MiB cache/in-flight budget and two
subscribers, with one outstanding image each. Limits only tighten.
These are sample defaults, **not normative AV** or a hard SDK/OS total-memory
guarantee. Native stride/layout may reduce the admissible geometry.
Native, SDK and receipt clock origins stay distinct; no arbitrary tick count
is called UTC exposure time.

The HTTP sample is authenticated and **loopback-only** (`127.0.0.1`).
Non-loopback addresses are rejected; this is not a production TLS deployment.
Separate bearer credentials control TD/actions versus images. Host/Origin,
request size/time, connection count, response lifetime and subscriber limits
are enforced. Fault middleware dispatches through actual ExposedThing
handlers and maps authorization=403, unknown token=404, busy=409,
no/stale/lost frame=503, timeout=504. Images use `no-store`.

EOS, disconnect, cancellation and source failure clear the cache. Close
attempts checked native stop/cleanup, wakes caller reads, then observes the
owned child's exit. Watchdog termination reports stop/resources **unknown**;
it never proves that hardware stopped. Errors are not converted to empty
profiles, zero-byte frames or successful cleanup.

Test source and corrupt worker fixtures live exclusively under `onvif/tools`.
The runtime writes ignored `build-windows/qualification-results.json` and
JPEG artifacts; independent Pillow/libjpeg decode compares actual pixels.
No first-party licensing or SDK redistribution rights are assigned here.
