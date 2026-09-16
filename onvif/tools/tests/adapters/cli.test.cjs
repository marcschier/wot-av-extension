"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const main = path.resolve(__dirname, "..", "..", "..", "samples", "adapters", "src", "main.cjs");

function command(args) {
    const result = spawnSync(process.execPath, [main, ...args], {
        encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 1048576
    });
    const lines = (result.stdout ?? "").trim().split(/\r?\n/).filter(value => value.startsWith("{"))
        .map(value => JSON.parse(value));
    return { result, lines };
}

test("CLI discovery is denied unless explicitly authorized", () => {
    const { result } = command(["discover"]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, "PolicyDenied");
});

test("CLI uses real memory capture only on its separate explicit acquisition command", { timeout: 60000 }, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "windows-capture-cli-"));
    const configPath = path.join(temporary, "software.private.json");
    try {
        const prepared = command(["software-config", "--allow-software", "--output", configPath]);
        assert.equal(prepared.result.status, 0);
        assert.equal(prepared.lines[0].evidenceKind, "synthetic");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        config.http.port = 0;
        fs.writeFileSync(configPath, JSON.stringify(config));
        const publicationOnly = command([
            "run", "--config", configPath, "--allow-publication", "--seconds", "1",
            "--worker", path.join(temporary, "deliberately-absent.exe")
        ]);
        assert.equal(publicationOnly.result.status, 0);
        assert.equal(publicationOnly.lines.at(-1).acquisition, null);
        const acquired = command([
            "run", "--config", configPath, "--allow-publication", "--allow-acquisition", "--seconds", "1"
        ]);
        assert.equal(acquired.result.status, 0);
        assert.equal(acquired.lines.at(-1).status, "stopped");
        assert.equal(acquired.lines.at(-1).acquisition.close.status, "closed");
        assert.equal(acquired.lines.at(-1).acquisition.close.acquisitionStop, "acknowledged");
        assert.ok(!acquired.result.stdout.includes(config.http.controlToken));
        assert.ok(!acquired.result.stdout.includes(configPath));
    } finally {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        fs.rmdirSync(temporary);
    }
});
