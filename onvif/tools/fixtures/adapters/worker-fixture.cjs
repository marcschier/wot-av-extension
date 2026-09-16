"use strict";

const readline = require("node:readline");
const mode = process.argv[2];
let reads = 0;
function packet(value) {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([header, body]));
}
packet({ kind: "hello", protocol: "capture-v1", automaticDiscovery: false });
readline.createInterface({ input: process.stdin }).on("line", line => {
    if (mode === "blocked-read") return;
    if (line === "next" && mode === "gap-then-eos") {
        if (reads++ === 0) {
            packet({ kind: "gap", generation: "1", dropped: "1", reason: "native-incomplete" });
        } else {
            packet({ kind: "end", reason: "eos" });
            packet({ kind: "closed", status: "closed", acquisitionStop: "acknowledged", resources: "released", faults: [] });
            process.stdin.destroy();
        }
    } else if (line === "next" && mode === "source-and-cleanup-failure") {
        packet({ kind: "fault", code: "DeviceLost", operation: "next", nativeCode: "0xc00d3ea2" });
        packet({
            kind: "closed", status: "failed", acquisitionStop: "failed", resources: "unknown",
            faults: [{ code: "CleanupFailed", operation: "close", nativeCode: "0x80004005" }]
        });
        process.exitCode = 1;
        process.stdin.destroy();
    } else if (line === "next" && mode === "partial-write") {
        const header = Buffer.alloc(8);
        header.writeUInt32LE(1024);
        process.stdout.write(header);
        process.stdout.write("{");
    } else if (line === "next" && mode === "wrong-kind") {
        packet({ kind: "unexpected" });
    }
});
setInterval(() => {}, 1000).unref();
