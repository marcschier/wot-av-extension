"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { CaptureBackend, configuredCapturePermission, discover, memoryTarget } = require("./backend.cjs");
const { loadCanonical } = require("./canonical.cjs");
const { SemanticAdapter, pump } = require("./semantic.cjs");
const { startServer } = require("./server.cjs");
const { SourceFault, demand } = require("./fault.cjs");

const DEFAULT_WORKER = process.platform === "win32"
    ? path.resolve(__dirname, "..", "build-windows", "windows-capture-worker.exe")
    : path.resolve(__dirname, "..", "native", "linux", "build-linux-capture", "linux-capture-worker");
const FLAGS = new Set(["allow-discovery", "native-read-only", "allow-device-access", "allow-acquisition",
    "allow-publication", "allow-software", "control-probe", "allow-control-probe"]);
const VALUES = new Set(["config", "output", "worker", "seconds"]);

function argumentsOf(args) {
    const options = {};
    for (let i = 0; i < args.length; i++) {
        demand(args[i].startsWith("--"), "InvalidSelection", "open");
        const key = args[i].slice(2);
        demand(!Object.hasOwn(options, key), "InvalidSelection", "open");
        if (FLAGS.has(key)) options[key] = true;
        else {
            demand(VALUES.has(key) && i + 1 < args.length && !args[i + 1].startsWith("--"), "InvalidSelection", "open");
            options[key] = args[++i];
        }
    }
    return options;
}

function readConfiguration(filename) {
    demand(typeof filename === "string" && fs.statSync(filename).size <= 1048576, "InvalidSelection", "open");
    return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function privateOutput(filename, value) {
    demand(typeof filename === "string" && filename.length > 0, "InvalidSelection", "open");
    fs.writeFileSync(filename, JSON.stringify(value, null, 4) + "\n", { flag: "wx", mode: 0o600 });
}

async function main(args) {
    const command = args[0] ?? "help";
    if (command === "help") {
        console.log(JSON.stringify({
            commands: {
                "software-config": "--allow-software --output <new-private-config.json>",
                describe: "--config <private-config.json> [--native-read-only --allow-device-access] [--output <new-evidence.json>]",
                discover: "--allow-discovery --output <new-private-device-list.json>",
                run: "--config <private-config.json> --allow-publication [--allow-acquisition] --seconds <1..30>"
            },
            noDefaultDevice: true, noAutomaticCapture: true, hardwareQualified: false
        }));
        return;
    }
    const options = argumentsOf(args.slice(1));
    const workerPath = path.resolve(options.worker ?? DEFAULT_WORKER);
    if (command === "discover") {
        demand(options["allow-discovery"] === true && options.output !== undefined, "PolicyDenied", "describe");
        const result = await discover({ workerPath, permitDiscovery: true });
        privateOutput(options.output, result);
        console.log(JSON.stringify({ status: "complete", deviceCount: result.devices.length, selected: false }));
        return;
    }
    if (command === "software-config") {
        demand(options["allow-software"] === true && options.output !== undefined, "PolicyDenied", "describe");
        const backend = new CaptureBackend({ workerPath });
        const target = memoryTarget();
        const evidence = await backend.describe(target, { refresh: "native-read-only", permitDeviceAccess: true });
        privateOutput(options.output, {
            target, evidence, modeId: evidence.modes[0].modeId,
            thingId: "urn:example:camera-adapter:" + randomUUID(),
            profile: { $attributes: { token: "capture-p1", fixed: true }, Name: "Software MF memory mode" },
            http: {
                port: 8098, controlToken: randomBytes(32).toString("base64url"),
                snapshotTokens: [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")]
            },
            qualification: "synthetic-memory-only; not a physical UVC camera"
        });
        console.log(JSON.stringify({ status: "complete", evidenceKind: "synthetic", hardwareAccess: false }));
        return;
    }
    demand(command === "describe" || command === "run", "InvalidSelection", "open");
    const config = readConfiguration(options.config);
    const allowedDuration = Number(options.seconds) * 1000;
    const authorizeOpen = options["allow-acquisition"] === true ? configuredCapturePermission({
        target: config.target, modeId: config.modeId, capabilityEvidenceDigest: config.evidence?.digest,
        output: "JPEG", limits: config.limits, durationMs: allowedDuration, permitAcquisition: true
    }) : () => false;
    const backend = new CaptureBackend({
        workerPath, cachedEvidence: config.evidence ? [config.evidence] : [], authorizeOpen
    });
    if (command === "describe") {
        const evidence = await backend.describe(config.target, {
            refresh: options["control-probe"] ? "authorized-session-probe" : options["native-read-only"] ? "native-read-only" : "cached",
            permitDeviceAccess: options["allow-device-access"] === true,
            permitControlProbe: options["allow-control-probe"] === true
        });
        if (options.output) privateOutput(options.output, evidence);
        console.log(JSON.stringify({ status: "complete", evidenceKind: evidence.evidenceKind, modeCount: evidence.modes.length }));
        return;
    }
    demand(options["allow-publication"] === true && /^(?:[1-9]|[12][0-9]|30)$/.test(options.seconds ?? ""),
        "PolicyDenied", "open");
    const durationMs = Number(options.seconds) * 1000;
    const evidence = await backend.describe(config.target);
    demand(evidence.modes.some(mode => mode.modeId === config.modeId), "InvalidSelection", "open");
    const canonical = loadCanonical({
        dependencyAnchor: process.env.CAPTURE_DEPENDENCY_ANCHOR,
        bindingEntry: process.env.CAPTURE_BINDING_ENTRY
    });
    const adapter = new SemanticAdapter({
        canonical, createSemanticAdapterTd: canonical.createSemanticAdapterTd,
        thingId: config.thingId, profile: config.profile, modeId: config.modeId, limits: config.limits
    });
    const controller = new AbortController();
    const interrupted = () => controller.abort();
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    let server, acquisition, timer;
    try {
        server = await startServer({ adapter, canonical, ...config.http, permitPublication: true });
        if (options["allow-acquisition"]) {
            const request = {
                target: config.target, modeId: config.modeId, capabilityEvidenceDigest: config.evidence.digest,
                output: "JPEG", limits: config.limits, durationMs
            };
            acquisition = pump(await backend.open(request, controller.signal), adapter, controller.signal);
        }
        console.log(JSON.stringify({
            status: "serving", tdUri: server.tdUri, captureAuthorized: options["allow-acquisition"] === true,
            hardwareQualified: false
        }));
        await new Promise(resolve => {
            if (controller.signal.aborted) { resolve(); return; }
            controller.signal.addEventListener("abort", resolve, { once: true });
            timer = setTimeout(() => controller.abort(), durationMs);
        });
    } finally {
        clearTimeout(timer);
        controller.abort();
        const result = acquisition ? await acquisition : null;
        if (server) await server.close();
        process.off("SIGINT", interrupted);
        process.off("SIGTERM", interrupted);
        console.log(JSON.stringify({ status: "stopped", acquisition: result }));
        if (result?.status === "failed") process.exitCode = 1;
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        const fault = error instanceof SourceFault ? error
            : new SourceFault(error.code === "ENOENT" ? "MissingDependency" : "InvalidSelection", "open");
        console.error(JSON.stringify(fault.toJSON()));
        process.exitCode = 1;
    });
}

module.exports = { main, argumentsOf };
