const { readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { spawnSync } = require("node:child_process");

const suites = ["unit", "binding-gate", "catalog", "events", "discovery", "publication", "media", "integration"];
const selected = process.argv.slice(2);
const requested = selected.length ? selected : suites;
if (requested.some((suite) => !suites.includes(suite) && suite !== "media-native")
    || new Set(requested).size !== requested.length) {
    throw new Error("Select unique known ONVIF suites; native media is explicitly media-native");
}
const files = requested.flatMap((suite) => {
    if (suite === "media-native") {
        if (process.env.ONVIF_MEDIA_NATIVE_TEST !== "1") {
            throw new Error("Native loopback media requires ONVIF_MEDIA_NATIVE_TEST=1 and configured worker/SDK/Python paths");
        }
        return [join(__dirname, "media", "native.integration.cjs")];
    }
    const directory = join(__dirname, suite);
    const found = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".test.cjs"))
        .map((entry) => join(directory, entry.name)).sort();
    if (!found.length) throw new Error(`ONVIF suite ${suite} has no tests`);
    return found;
});
const child = spawnSync(process.execPath, [
    "--require", join(__dirname, "composed.cjs"), "--test", "--test-concurrency=1", ...files
], { cwd: resolve(__dirname, ".."), stdio: "inherit" });
if (child.error) throw child.error;
if (child.signal) throw new Error(`ONVIF test runner terminated by ${child.signal}`);
process.exitCode = child.status ?? 1;
