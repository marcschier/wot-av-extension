# Still-to-BGR worked fixture

**A structurally coherent candidate, NOT an admitted media path.** Every Thing,
host, backend, profile and endpoint is hypothetical. The source and controller
retain the native TD 1.1 context first, then the external AV context. The AV
namespace is unregistered and its context URI is unhosted; the configured offline
cache supplies its exact local bytes without changing the URI.

`source.td.json` describes one Thing with MediaSource and Connector roles, one
Offer, one complete Still Mode, one encoded JPEG Track and explicit acquisition,
resource and codec configuration pins. The named native snapshot Property Form
uses `readproperty` / HTTPS GET and carries raw `image/jpeg` bytes, not a JSON
binary alias. It is a latest-existing image, not a new exposure or Live stream.
Authentication metadata contains no credentials and proves no authentication.

`need.jsonld` requests Still JPEG 1280x720 at the wire boundary, then contiguous
BGR8 `[720,1280,3]` at delivery. Decode and ColorConvert are explicitly permitted.
There is no inferred resizing, audio, FPS, freshness, tensor or inference-model
contract. Track requirements use the same `dcterms:identifier` to join their
wire and delivered boundaries. Track is a flat canonical class, with
`av:representation` and codec/layout fields directly on it.

`controller.td.json` defines ordinary native `submitNeed` and `release` Actions
and a read-only `status` Property. `profiles/control-profile.json` maps its
profile-owned semantic identifiers to exact named Forms, JSON Pointers, standard
TD operations and input/output schema locations. There are no additional AV
Action classes or native operation tokens. Control Forms do not invent media
direction. The profile describes stronger replay, compare-current, unknown-input,
authority and cleanup rules than the structural payload schemas alone enforce.

`assignment.jsonld` is explicitly a **counterfactual / negative admission
fixture**. It illustrates the canonical Assignment, InputSelection, TrackSelection
and FormReference mapping to the current worked Need, source TD and Controller.
It does not assert acceptance. Missing adapter qualification and an expired
synthetic grant block admission; current authenticated heads and runtime behavior
are not observed. `tests/fixtures/controller.json` contains the unsent request and
dated synthetic rejection receipt. A `recorded` drain receipt is not proof of
Released cleanup.

`cache-policy.json` is the explicit authored allow-list. The generated
`pins.jsonld` and `manifest.json` seal the copied canonical context, inventory,
ontology, shapes, native W3C documents and worked example profiles/documents.
Sixteen pins have verified bytes. The qualification pin is intentionally
unresolved and its all-zero digest is a visible sentinel, never a checksum for
accepted content. Pin dependencies are traversed cycle-safely; the controller and
profile refer to stable pin IDs rather than embedding their own digest.
Hash equality proves consistency, not publisher authenticity or qualification.

`dataset.nq` is a deterministic, finite named-graph projection of exactly the
source TD, Controller TD and separate synthetic Live query fixture. Graph-to-pin
or query-only provenance mappings are explicit in the manifest. The Need and
Assignment are not silently treated as directory query graphs. The original
JSON documents remain authoritative for member-presence and ordered-list rules.

`query.rq` returns the one Still JPEG candidate, following native `td:hasForm`
membership to the Form and its literal `hctl:hasTarget`. `live.query.rq` requires
H264 1280x720 at exactly 30/1 and AAC mono 48 kHz in the **same Mode and graph**.
The Live fixture is query-positive only: its unresolved pins and unqualified
identities are separately listed. Neither query establishes execution readiness.
Negative query cases reject Still-versus-Live, finite Clip-versus-Live, audio in
another Mode or graph, a lookalike outside native Forms, and 30000/1001 versus
30/1. The codec fragments under `tests/fixtures` are not complete TDs or a WebRTC
implementation; their unresolved references are also explicitly listed.

Run `python tools\validate.py` from the release root. It performs offline
structural and fixture checks without resealing, networking or hardware access.
See `spec/validation.md` for exact scope, regeneration and schema limitations.
