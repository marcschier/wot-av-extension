# ONVIF

[Specification](spec.md) and [generated HTML](index.html) define this independent
binding/mapping draft. The specification declares its normative machine annexes;
[model-manifest.json](model-manifest.json) records their exact physical paths,
logical identities and roles. [Model translation](model-translation.json)
separates preserved native identities from additive abstract 0.2 models.

The current edition contains 285 native Thing Models, 286 form-free abstract
Thing Models and seven separate client-requirement manifests. These are not
596 Thing Models: the current 596-artifact canonical inventory also includes
schemas, catalogs, vocabulary and its manifest. Future counts must be derived
from the manifest, not used as a historical ceiling. Profiles A, C, D, G, M, S
and T retain distinct device/client obligations and conditional evidence.

[Examples](examples) are illustrative TDs, models and source observations.
[Reference runtime](samples/reference-runtime),
[camera adapters](samples/adapters) and [applications](samples/applications)
are supporting implementations, not normative sources.
[Tools/tests](tools), [runtime guide](support/reference-runtime-guide.md),
[editorial records](support/editorial) and [upstream sources](support/upstream)
retain their separate informative/provenance roles.

Semantic adapters expose selected canonical fragments with their actual WoT
Forms. They are not SOAP facades, certified ONVIF products or full-profile
implementations. Separate 2026-09-16 software runs passed the
[six Linux native cohorts](tools/adapters/linux/README.md), including real
Aravis 0.8.36 SDK Fake and simulated V4L2, and the
[seven relocated ONVIF/GStreamer CTest targets and 23 Node/native cases](support/reports/native-relocated-qualification.md).
Physical V4L2/UVC, GigE and USB3 Vision hardware and Linux Node/HTTP deployment
remain unqualified. Named external editorial review, source/derivative rights
and formal publication approvals remain independent gates. Shared commands
are in the [root navigation](../readme.md).
