# Private local ONVIF package - notices and release boundary

This package is a project-authored native ONVIF binding and generated mapping,
not an ONVIF, W3C or OASIS publication. No first-party license has been selected.
`private: true` must remain set until a separate owner-approved licensing and
publication decision. Local packing, installation and fixture execution do not
authorize registry, website or binary distribution.

The registry, payload schemas, models, mapping reference and requirement data
are derived from normative ONVIF/W3C/OASIS inputs. They are not an opaque
license-free catalog. `dist/catalog-data/sources.lock.json` retains the complete
source identities, URLs, original hashes, attribution, import/notice closure
and redistribution decisions. `dist/package-provenance.json` records the local
transformation and included files; it does not claim an unmodified upstream
implementation or a reproducible native binary.

`dist/source-documents/` contains only the 43 permission-cleared, unchanged
vendored documents and notices selected by that lock. Original embedded ONVIF
and OASIS copyright, unchanged-document permissions and disclaimers remain in
the WSDL/XSD documents. The original W3C 1998 and 2002 Software notices and 2023
Document notice accompany their sources. Source-specific W3C attribution,
including XML and XOP documents without embedded notices, remains in the lock.
The ONVIF repository Contributor License Agreement is not a blanket Apache
license for specifications or this project's code.

The seven profile PDFs are reference-only. The April 2005 WS-Discovery XSD and
WSDL and August 2004 WS-Addressing XSD are fetch-only, subject to their separate
distribution-purpose review; their XML bytes are not included. Public URLs and
successful source checks do not resolve generated-derivative, patent, trademark,
profile-symbol or certification permissions.

Native media source patches, GStreamer/codec SDKs and binaries are not part of
this npm package. There is no install hook, SDK downloader or native binary
autofetch. An operator must separately provision and approve the private native
worker, corresponding sources/relinking obligations, plugin licenses and codec
patent requirements. The native patch is locally tested but **not approved for
distribution**. x265 remains GPL test-only, not a runtime package addition.

Dependencies are resolved separately by npm and retain their own notices and
licenses, including node-wot's EPL-2.0 OR W3C-20150513 choice. Nothing here
relicenses those dependencies or the unchanged W3C WoT/AV archive sources.
