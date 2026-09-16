# Canonical and native model integration

This is an informative implementation guide for the independent
[0.2-proposed standard](../../spec.md). Public contracts are the standard and
its incorporated JSON/JSON-LD/RDF/SHACL annexes, not runtime source code.

The original 285 native Thing Model IDs and seven client-manifest IDs are
preserved. There are 286 additive form-free abstract TMs: corresponding
operation/service/feature/profile/resource/Event contracts plus the initial
camera inventory/snapshot fragment. Native overlays have one immediate
abstract base; other affordances are imported by `tm:ref`. Concrete native
projections contain both the actual abstract composite and its native overlay,
and each TD has one immediate type link. Profile associations never turn a
partial observation into a complete wrapper instance.

Most native files are under `models/native/`. The Event model retains
`models/events/PullPointSubscription.tm.json` for existing Event consumers.
`model-translation.json` and `model-manifest.json` declare every physical path,
public logical ID, role, dependency and digest; IDs must not be constructed by
assuming the physical path is the public name.

## Pure adapter contract

Import `loadPackagedCatalog`, `createSemanticAdapterModel`, `deriveAdapterTd`,
`semanticAdapterOperationId` and `assertSemanticAdapterValue` from
`@wot-av/binding-onvif/catalog`. The root runtime barrel can be composed
separately; direct catalog imports are the stable integration seam.

Both QName namespaces below are `http://www.onvif.org/ver20/media/wsdl`.
The binding local name is `Media2Binding`, the portType local name is `Media2`,
and the initial allowed operation names are `GetProfiles` and `GetSnapshotUri`.
Pass full tuples, not an `operationQName`, display name or a generated suffix.

```typescript
import { deriveAdapterTd, loadPackagedCatalog } from "@wot-av/binding-onvif/catalog";

const catalog = loadPackagedCatalog();
const namespace = "http://www.onvif.org/ver20/media/wsdl";
const operations = ["GetProfiles", "GetSnapshotUri"].map((operation) => ({
    bindingQName: { namespace, localName: "Media2Binding" },
    portTypeQName: { namespace, localName: "Media2" },
    operation
}));
const projection = deriveAdapterTd(catalog, {
    id: "urn:example:semantic-camera",
    title: "Illustrative semantic camera",
    operations,
    evidence: [{
        sourceId: "urn:example:operator-attestation",
        detail: "Fictional configuration, not a discovered or qualified camera."
    }],
    bindingForms: operations.map((operation) => ({
        operation,
        forms: [{
            href: `https://adapter.example.invalid/actions/${operation.operation}`,
            op: "invokeaction",
            contentType: "application/json",
            "htv:methodName": "POST"
        }]
    })),
    securityDefinitions: { control: { scheme: "bearer", in: "header" } },
    security: ["control"]
});
```

`projection.model` is the minimal selected semantic composite and
`projection.td` has real adapter Forms and complete canonical DataSchemas.
`modelId` optionally selects the composite document ID. The only accepted
claim option is `"fragment"`; the default is the same. The factory rejects
full/native claims, unsupported operations, schema replacements, private
runtime fields, filesystem source IDs, credential values and SOAP selectors.
Its documentary evidence does not authenticate the publisher or physical
source. Thing ID and HardwareIdentifier remain separate.

Validate operator-derived canonical facts, incoming action input and actual
results with `assertSemanticAdapterValue(catalog, tuple, direction, value)`,
where direction is `"input"` or `"output"`. The function performs no device
I/O. It does not prove backend semantic equivalence: the adapter must preserve
Token/Type selection, omitted-Type configuration behavior, stable snapshot
URI semantics, actual authorization and typed failures. Credentials and native
driver/device selectors stay in private deployment configuration. No native
SOAP facade, EPR, Directory registration or hardware selection is created.

## Reproducible owned generation

From the repository root, with the existing Node/Python toolchain:

```powershell
npm --workspace @wot-av/binding-onvif run compile
node onvif\tools\generate-onvif.cjs
node onvif\tools\generate-onvif-examples.cjs
node onvif\tools\generate-spec-annexes.cjs
```

Each generator accepts `--check`. The canonical generator owns its manifest
and packaged catalog data. The example generator owns only its explicit
62-artifact manifest and does not overwrite adapter-owner UVC/GenICam files.
The prose generator fills complete vocabulary/descriptor/closure regions,
checks literal includes and references, and writes readable coverage and the
standards list with `localBiblio` for the separate publication pipeline.
None contacts a device, fetches a schema, installs an SDK, reseals AV or grants
publication rights.

Source review and draft interpretation are deliberately distinct.
`support/editorial/editorial-decisions.json#/decisions` preserves legacy
source-review records; `#/mappingInterpretations` holds all 33 selected draft
decisions. The normalized index retains both source-review state and explicit
draft interpretation, without rewriting any original requirement row.
NP-G3's topic and Source/Data mapping are verified; its actual ElementItem
root requires a trusted message description and remains a qualification gate.
Named editor/domain review is still required before formal release.
