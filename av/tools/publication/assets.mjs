import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ROOT, SUPPORT_ROOT, readJSON, sha256 } from "./lib.mjs";

export async function verifiedAssets() {
    const policy = await readJSON(path.join(SUPPORT_ROOT, "publication-policy.json"));
    const lock = await readJSON(path.join(SUPPORT_ROOT, "assets.lock.json"));
    if (process.versions.node !== policy.node.version || lock.node !== policy.node.version) throw new Error(`Reviewed Node ${policy.node.version} is required; use ${policy.node.executable}`);
    const pkg = await readJSON(path.join(ROOT, "package.json"));
    for (const [name, version] of Object.entries(pkg.dependencies)) {
        const entry = lock.packages.find(item => item.package === `node_modules/${name}`);
        if (entry?.version !== version || !entry.integrity?.startsWith("sha512-") || !entry.source?.startsWith("https://registry.npmjs.org/")) throw new Error(`Unreviewed publication package pin: ${name}`);
    }
    const notices = await readFile(path.join(SUPPORT_ROOT, "THIRD-PARTY-NOTICES.txt"));
    if (sha256(notices) !== lock.noticesSha256) throw new Error("Third-party notice digest mismatch");
    const files = new Map(), remote = new Map();
    for (const item of lock.assets) {
        if (!/^assets\/[a-zA-Z0-9.-]+$/.test(item.path) || files.has("/" + item.path)) throw new Error(`Invalid or duplicate locked asset: ${item.path}`);
        const body = await readFile(path.join(SUPPORT_ROOT, ...item.path.split("/")));
        if (sha256(body) !== item.sha256 || body.length !== item.bytes) throw new Error(`Asset digest or length mismatch: ${item.path}`);
        const asset = { body, contentType: item.contentType };
        files.set("/" + item.path, asset);
        for (const url of item.urls) {
            if (!/^https:\/\//.test(url) || remote.has(url)) throw new Error(`Invalid or duplicate asset interception URL: ${url}`);
            remote.set(url, asset);
        }
    }
    return { policy, lock, files, remote };
}

export async function recordQualification(candidate) {
    const { policy, lock } = await verifiedAssets();
    if (candidate.executableSha256 !== sha256(await readFile(policy.browser.executable))) throw new Error("Browser changed during qualification");
    const version = candidate.product.match(/^Edg\/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (!version) throw new Error("Qualification requires the explicitly selected Microsoft Edge executable");
    const reviewed = { version, product: candidate.product, revision: candidate.revision, protocolVersion: candidate.protocolVersion };
    Object.assign(policy.browser, reviewed);
    Object.assign(lock.browser, reviewed, { sha256: candidate.executableSha256 });
    const json = value => JSON.stringify(value, null, 4) + "\n";
    await writeFile(path.join(SUPPORT_ROOT, "publication-policy.json"), json(policy));
    await writeFile(path.join(SUPPORT_ROOT, "assets.lock.json"), json(lock));
    await writeFile(path.join(SUPPORT_ROOT, "browser-qualification.json"), json(candidate));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { lock } = await verifiedAssets();
        console.log(JSON.stringify({ result: "verified", assets: lock.assets.length, browserDownloaded: false }));
    } catch (error) {
        console.error(`Publication assets: ${error.message}`);
        process.exitCode = 1;
    }
}
