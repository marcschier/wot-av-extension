import {
    CaptureBackend, configuredCapturePermission, loadCanonical, memoryTarget, SemanticAdapter, startServer,
    type CaptureOpenRequest, type CreateSemanticAdapterTd
} from "../../../samples/adapters/src/contract";

const target = memoryTarget("software-only");
const request: CaptureOpenRequest = {
    target, modeId: `mf-${"a".repeat(32)}`, capabilityEvidenceDigest: "b".repeat(64),
    output: "JPEG", durationMs: 1000
};
const authorizeOpen = configuredCapturePermission({ ...request, permitAcquisition: true });
const backend = new CaptureBackend({ workerPath: "operator-supplied-absolute-path", authorizeOpen });
const canonical = loadCanonical();
const createSemanticAdapterTd: CreateSemanticAdapterTd = canonical.createSemanticAdapterTd;
const adapter = new SemanticAdapter({
    canonical, createSemanticAdapterTd, thingId: "urn:example:typed-software-only",
    modeId: request.modeId, profile: { $attributes: { token: "software-p1", fixed: true }, Name: "Software only" }
});
void backend;
void adapter;
void startServer;
