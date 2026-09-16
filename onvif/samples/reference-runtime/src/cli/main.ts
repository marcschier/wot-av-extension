#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { errorCode, PublicationError } from "../publication/common.js";
import { loadBridgeConfiguration, type BridgeCommand } from "./config.js";

const usage = "Usage: onvif-bridge inspect|export|run --config <absolute-config.json> [--once]\n"
    + "inspect never publishes. export requires file mode. run requires an explicit interval unless --once.\n";

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
    if (argv.length === 1 && argv[0] === "--help") { process.stdout.write(usage); return 0; }
    const command = argv[0];
    if (!["inspect", "export", "run"].includes(command ?? "") || argv[1] !== "--config" || !argv[2]
        || (argv.length !== 3 && !(command === "run" && argv.length === 4 && argv[3] === "--once"))) {
        process.stderr.write(usage);
        return 2;
    }
    let bridge: Awaited<ReturnType<typeof loadBridgeConfiguration>>["bridge"] | undefined;
    const stop = new AbortController();
    const signal = (): void => stop.abort();
    try {
        const selected: BridgeCommand = command === "inspect" ? "inspect" : command === "export" ? "export" : "run";
        const configured = await loadBridgeConfiguration(argv[2], selected, env);
        bridge = configured.bridge;
        if (selected === "run" && argv[3] !== "--once" && configured.intervalMs === undefined) {
            throw new PublicationError("InvalidConfiguration", "Continuous run requires an explicit intervalMs");
        }
        process.once("SIGINT", signal); process.once("SIGTERM", signal);
        await bridge.start();
        const inspection = await bridge.inspect();
        if (selected === "inspect") process.stdout.write(JSON.stringify(inspection.inventory, null, 4) + "\n");
        else process.stdout.write(JSON.stringify({
            mode: configured.mode, inventoryRevision: inspection.inventory.revision,
            devices: inspection.inventory.devices.length, things: inspection.projection.devices.reduce((sum, device) => sum + device.projection.tds.length, 0),
            publicationRevision: inspection.publication?.revision ?? null,
            nativeControlGateway: false, conformanceEstablished: false
        }) + "\n");
        if (selected === "run" && argv[3] !== "--once") {
            while (!stop.signal.aborted) {
                try { await delay(configured.intervalMs, undefined, { signal: stop.signal }); }
                catch (error) {
                    if (error instanceof Error && error.name === "AbortError" && stop.signal.aborted) break;
                    throw error;
                }
                await bridge.refresh();
            }
        }
        return 0;
    } catch (error) {
        process.stderr.write(JSON.stringify({ code: errorCode(error), message: error instanceof PublicationError
            ? error.message : "ONVIF bridge failed; no fallback, credential output, or implied native success." }) + "\n");
        return 1;
    } finally {
        process.removeListener("SIGINT", signal); process.removeListener("SIGTERM", signal);
        if (bridge) await bridge.close();
    }
}

if (require.main === module) {
    void main().then((code) => { process.exitCode = code; }, (error: unknown) => {
        process.stderr.write(JSON.stringify({ code: errorCode(error), message: "ONVIF bridge shutdown failed." }) + "\n");
        process.exitCode = 1;
    });
}
