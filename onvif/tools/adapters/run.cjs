"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..", "..", "samples", "adapters");
const build = path.join(root, "build-windows");
const tests = path.resolve(__dirname, "..", "tests", "adapters");
const privateLog = path.join(os.tmpdir(), "regroup-camera-adapters-tests.log");
const results = [];
const logs = [];

if (process.platform !== "win32") {
    console.error("This qualification runner requires Windows MF/WIC. Use scripts/linux-build.sh on an approved Linux host.");
    process.exit(1);
}
if (!fs.existsSync(build)) {
    console.error("Missing native build. Run onvif/tools/adapters/scripts/windows-build.ps1 first.");
    process.exit(1);
}

function run(name, executable, args, cwd = build) {
    const result = spawnSync(executable, args, {
        cwd, env: process.env, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024
    });
    logs.push(`=== ${name} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n`);
    const output = result.stdout ?? "";
    const item = { name, passed: result.status === 0, exitCode: result.status, errorCode: result.error?.code ?? null };
    const cases = /^(?:#|\u2139) tests (\d+)$/m.exec(output);
    if (cases) item.cases = Number(cases[1]);
    results.push(item);
    return item.passed;
}

let success = run("native-memory-wic", path.join(build, "windows-capture-tests.exe"), []);
if (success) success = run("node-backend-and-wot-http", process.execPath, [
    "--test", "--test-concurrency=1",
    path.join(tests, "backend.test.cjs"), path.join(tests, "semantic-http.test.cjs"),
    path.join(tests, "cli.test.cjs"), path.join(tests, "portable.test.cjs"), path.join(tests, "examples.test.cjs")
]);
if (success) success = run("independent-jpeg-decode", process.env.CAPTURE_PYTHON ?? "python",
    [path.join(tests, "verify-jpeg.py")]);
fs.writeFileSync(privateLog, logs.join("\n"));
const report = {
    result: success ? "pass" : "fail", qualification: "software-only",
    node: process.version, results, hardwareEnumerated: false, hardwareOpened: false,
    nativeOnvifSoap: false, fullOnvifProfileClaim: false,
    diagnostics: "Private system-temp log; no local paths or device selectors in unit stdout."
};
fs.writeFileSync(path.join(build, "qualification-results.json"), JSON.stringify(report, null, 4) + "\n");
console.log(JSON.stringify(report));
process.exitCode = success ? 0 : 1;
