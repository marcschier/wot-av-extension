import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { ROOT, REPO_ROOT, SUPPORT_ROOT, assemble, readJSON } from "../lib.mjs";
import { render, createServer, PROFILE_ROOT } from "../render.mjs";

const refs = await readJSON(path.join(SUPPORT_ROOT, "bibliography.json"));
const ownedPids = new Set([process.pid]);
let scratch;
before(async () => { scratch = await mkdtemp(path.join(os.tmpdir(), "wot-av-publication-test-")); });
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: false }); });
const source = async (extra, references = refs) => assemble({
    source: "spec.md", refs: references,
    read: async () => "# Integration fixture\n<a id=\"abstract\"></a>\n## Abstract\nA local test.\n<a id=\"sotd\"></a>\n## Status\nIndependent draft. No assigned editor or license.\n## Contract {#contract}\n" + extra
});
test("loopback server rejects traversal, unapproved paths and request bodies", async () => {
    const service = await createServer(new Map([["/approved", { body: Buffer.from("local"), contentType: "text/plain" }]]));
    try {
        const request = (target, method = "GET") => new Promise((resolve, reject) => {
            const origin = new URL(service.origin);
            const req = http.request({ hostname: origin.hostname, port: origin.port, path: target, method, headers: method === "POST" ? { "Content-Length": "1" } : {} }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
            req.on("error", reject); req.end(method === "POST" ? "x" : undefined);
        });
        assert.equal(await request("/approved"), 200);
        assert.equal(await request("/unknown"), 404);
        assert.equal(await request("/%2e%2e/secret"), 400);
        assert.equal(await request("/approved", "POST"), 405);
    } finally { await service.close(); }
});
test("an unapproved remote resource fails the rendering transaction", { timeout: 180000 }, async () => {
    await assert.rejects(render(await source('<img src="https://unapproved.invalid/no.svg" alt="Disallowed network image">')), /unapproved\.invalid/);
});
test("missing terms and ambiguous definitions fail, not silently link elsewhere", { timeout: 180000 }, async () => {
    await assert.rejects(render(await source("[=missing-term=]")), /matching|definition/i);
    await assert.rejects(render(await source('<dfn id="a">term</dfn> and <dfn id="b">term</dfn>')), /Ambiguous definition/);
});
test("versioned bibliography keys use actual ReSpec identifiers and exact citation counts", { timeout: 180000 }, async () => {
    const references = await readJSON(path.join(REPO_ROOT, "onvif", "support", "publication", "bibliography.json"));
    const result = await render(await source("[[MQTT-3.1.1]]", references));
    assert.equal(result.report.readable.referenceCounts["MQTT-3.1.1"], 1);
    assert.match(result.report.readable.referenceIds["MQTT-3.1.1"], /^bib-/);
    assert.equal(result.report.readable.errors.length, 0);
});
test("complete fixture is identical across fresh processes and contains static graphics", { timeout: 240000 }, async () => {
    for (const pass of ["first", "second"]) {
        const result = spawnSync(process.execPath, [path.join(ROOT, "build-specs.mjs"), "--fixture", "--output-dir", path.join(scratch, pass)], { cwd: ROOT, encoding: "utf8", timeout: 180000, windowsHide: true });
        assert.equal(result.error, undefined);
        ownedPids.add(result.pid);
        assert.equal(result.status, 0, result.stderr);
    }
    const a = await readFile(path.join(scratch, "first", "fixture", "index.html"));
    const b = await readFile(path.join(scratch, "second", "fixture", "index.html"));
    assert.ok(a.equals(b));
    const html = a.toString();
    assert.match(html, /<svg/);
    assert.match(html, /aria-labelledby="diagram-1-title diagram-1-desc"/);
    assert.match(html, /900719925474099312345/);
    assert.match(html, /nativeMediaSnapshot/);
    assert.match(html, /id="qualified-operation"/);
    assert.match(html, /href="#qualified-operation"/);
    assert.match(html, /<blockquote/);
    assert.doesNotMatch(html, /<script\b|<base\b|creativecommons\.org|application\/ld\+json/);
    assert.match(html, /Unassigned \(no editor has been designated\)/);
    const report = await readJSON(path.join(scratch, "first", "fixture-report.json"));
    assert.equal(report.readable.scrollWidth, 390);
    assert.equal(report.readable.diagrams, 1);
    assert.equal(report.status.errors.length + report.status.warnings.length + report.blocked.length, 0);
});
test("release stays blocked and all owned browser profiles are cleaned", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "build-specs.mjs"), "--release"], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Publication blocked/);
});
test("render success and failure leave no owned profiles", async () => {
    const ours = (await readdir(PROFILE_ROOT)).filter(name => [...ownedPids].some(pid => name.startsWith(`owned-${pid}-`)));
    assert.deepEqual(ours, []);
});
