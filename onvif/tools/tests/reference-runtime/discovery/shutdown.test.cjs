const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

test("shutdown proof: separate process naturally exits after closing active real UDP discovery without process.exit or forced unref", { timeout: 15000 }, async () => {
    const result = await promisify(execFile)(process.execPath, [
        "--require", path.join(__dirname, "..", "composed.cjs"),
        "--unhandled-rejections=strict", path.join(__dirname, "../../../fixtures/reference-runtime/discovery/shutdown-child.cjs")
    ], { cwd: require("../../../paths.cjs").runtime, timeout: 10000, maxBuffer: 32768, windowsHide: true });
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout.trim()), { closed: true, pendingTimers: 0, readAdapterClosed: true });
});
