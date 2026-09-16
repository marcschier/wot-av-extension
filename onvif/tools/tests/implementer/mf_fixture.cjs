"use strict";

const readline = require("node:readline");

async function main() {
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
        throw new Error("An explicit private fixture configuration is required on stdin");
    }
    const config = JSON.parse(first.value);
    const api = require(config.adapterModule);
    const canonical = api.loadCanonical();
    const target = api.memoryTarget(config.adapterDeviceKey);
    const describeBackend = new api.CaptureBackend({ workerPath: config.workerPath });
    const evidence = await describeBackend.describe(target, {
        refresh: "native-read-only",
        permitDeviceAccess: true
    });
    const matches = evidence.modes.filter(mode => mode.modeId === config.modeId &&
        mode.width === config.width && mode.height === config.height &&
        mode.nativeSubtype === config.nativeSubtype);
    if (matches.length !== 1 || evidence.digest !== config.evidenceDigest || evidence.evidenceKind !== "synthetic") {
        throw new Error("The explicitly configured software tuple differs from public describe");
    }
    const planned = config.unavailablePlannedGeometry;
    if (evidence.modes.some(mode => mode.width === planned.width && mode.height === planned.height)) {
        throw new Error("The frozen unsupported-geometry observation changed");
    }
    const request = {
        target,
        modeId: config.modeId,
        capabilityEvidenceDigest: evidence.digest,
        output: "JPEG",
        durationMs: 20000
    };
    const backend = new api.CaptureBackend({
        workerPath: config.workerPath,
        cachedEvidence: [evidence],
        authorizeOpen: api.configuredCapturePermission({ ...request, permitAcquisition: true })
    });
    const adapter = new api.SemanticAdapter({
        canonical,
        thingId: config.thingId,
        profile: config.profile,
        modeId: config.modeId,
        createSemanticAdapterTd: canonical.createSemanticAdapterTd,
        title: "Explicit MF-memory software adapter; not camera hardware",
        evidence: [{
            sourceId: config.sourceId,
            detail: "Configured software MF memory/WIC path; no enumeration, physical source or native profile claim."
        }]
    });
    let server;
    let session;
    let pumping;
    const abort = new AbortController();
    try {
        server = await api.startServer({
            adapter,
            canonical,
            port: 0,
            address: "127.0.0.1",
            permitPublication: true,
            controlToken: config.controlToken,
            snapshotTokens: [config.imageToken]
        });
        session = await backend.open(request);
        const firstFrame = await session.next();
        if (firstFrame.kind !== "frame") {
            throw new Error("An explicit software acquisition did not produce a frame");
        }
        adapter.accept(firstFrame);
        pumping = api.pump(session, adapter, abort.signal);
        process.stdout.write(JSON.stringify({
            type: "ready",
            td: server.td,
            tdUri: server.tdUri,
            snapshotUri: server.snapshotUri,
            evidence: { kind: evidence.evidenceKind, width: config.width, height: config.height },
            plannedGeometry: "UnsupportedCapability"
        }) + "\n");
        const command = await iterator.next();
        if (!command.done && command.value !== "close") {
            throw new Error("Unknown fixture lifecycle command");
        }
    } finally {
        abort.abort();
        let receipt;
        if (pumping) {
            receipt = await pumping;
        } else if (session) {
            receipt = { close: await session.close("fixture cleanup") };
        }
        if (server) {
            await server.close();
        }
        lines.close();
        if (receipt && (receipt.close.status !== "closed" || receipt.close.resources !== "released")) {
            throw new Error("MF-memory cleanup was not established");
        }
        process.stdout.write(JSON.stringify({ type: "closed", receipt }) + "\n");
    }
}

main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code || error.name, message: error.message }) + "\n");
    process.exitCode = 1;
});
