const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readBoundedJson, atomicJson, OwnedJsonFile, OwnedDocumentBundle } = require("./.compiled/publication/files.js");
const { PublicationError } = require("./.compiled/publication/common.js");

const code = (expected) => (error) => error instanceof PublicationError && error.code === expected;
async function temporary(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-publication-files-"));
    const resources = [], failedOpeners = new Set();
    t.after(async () => {
        try {
            for (const resource of resources) {
                if (failedOpeners.has(resource)) await assert.rejects(resource.close(), AggregateError);
                else await resource.close();
            }
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
    return { root, failedOpeners, track(value) { resources.push(value); return value; } };
}
const validate = (value) => {
    if (!value || value.owner !== "files-owner" || !Number.isInteger(value.value)) {
        throw new PublicationError("InvalidPublicationState", "Foreign or invalid file");
    }
};

test("readBoundedJson accepts exact bytes and rejects oversized, malformed, missing and linked files", async (t) => {
    const { root } = await temporary(t);
    const file = path.join(root, "data.json");
    await fs.writeFile(file, '{"n":1}', { mode: 0o600 });
    assert.deepEqual(await readBoundedJson(file, 7), { n: 1 });
    await assert.rejects(readBoundedJson(file, 6), code("FileOwnership"));
    assert.equal(await fs.readFile(file, "utf8"), '{"n":1}');
    await fs.writeFile(file, "{bad");
    await assert.rejects(readBoundedJson(file, 4), SyntaxError);
    await assert.rejects(readBoundedJson(path.join(root, "absent.json"), 100), { code: "ENOENT" });
    await assert.rejects(readBoundedJson(root, 100), code("FileOwnership"));
    const linked = path.join(root, "linked.json");
    await fs.link(file, linked);
    await assert.rejects(readBoundedJson(file, 100), code("FileOwnership"));
    await assert.rejects(readBoundedJson(linked, 100), code("FileOwnership"));
    assert.equal(await fs.readFile(file, "utf8"), "{bad");
});

test("atomicJson writes deterministic newline-terminated bytes and leaves no temporary file on an over-limit replacement", async (t) => {
    const { root } = await temporary(t);
    const file = path.join(root, "data.json");
    await atomicJson(file, {}, 3);
    assert.equal(await fs.readFile(file, "utf8"), "{}\n");
    await assert.rejects(atomicJson(file, { n: 1 }, 14), code("PublicationLimit"));
    assert.equal(await fs.readFile(file, "utf8"), "{}\n");
    assert.deepEqual(await fs.readdir(root), ["data.json"]);
    await atomicJson(file, { n: 1 }, 15);
    assert.equal(await fs.readFile(file, "utf8"), '{\n    "n": 1\n}\n');
    assert.deepEqual(await fs.readdir(root), ["data.json"]);
});

test("owned file requires an absolute path and a bounded capacity", () => {
    assert.throws(() => new OwnedJsonFile("relative.json", validate), code("InvalidConfiguration"));
    assert.throws(() => new OwnedJsonFile(path.resolve(os.tmpdir(), "never-opened.json"), validate, 0), code("InvalidConfiguration"));
    assert.throws(() => new OwnedDocumentBundle("relative", "owner"), code("InvalidConfiguration"));
    assert.throws(() => new OwnedDocumentBundle(os.tmpdir(), "../owner"), code("InvalidConfiguration"));
});

test("owned JSON file serializes writes, isolates values and releases only its own writer lock", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t), file = path.join(temp.root, "state.json");
    const first = temp.track(new OwnedJsonFile(file, validate));
    assert.equal(await first.load(), null);
    assert.equal(await fs.readFile(`${file}.lock`, "utf8"), "ONVIF publication single-writer lock\n");
    const input = { owner: "files-owner", value: 7 };
    const saving = first.save(input);
    input.value = 999;
    await assert.rejects(first.save({ owner: "files-owner", value: 8 }), code("PublicationBusy"));
    await saving;
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).value, 7);
    const loaded = await first.load();
    loaded.value = 123;
    assert.equal((await first.load()).value, 7);
    const competing = temp.track(new OwnedJsonFile(file, validate));
    temp.failedOpeners.add(competing);
    await assert.rejects(competing.load(), { code: "EEXIST" });
    await assert.rejects(competing.close(), AggregateError);
    assert.equal(await fs.readFile(`${file}.lock`, "utf8"), "ONVIF publication single-writer lock\n");
    await first.close();
    assert.deepEqual(await fs.readdir(temp.root), ["state.json"]);
    const reopened = temp.track(new OwnedJsonFile(file, validate));
    assert.equal((await reopened.load()).value, 7);
    await reopened.save({ owner: "files-owner", value: 8 });
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).value, 8);
    await reopened.close();
    await assert.rejects(reopened.load(), code("RuntimeClosed"));
    await assert.rejects(reopened.save({ owner: "files-owner", value: 9 }), code("RuntimeClosed"));
});

test("owned JSON file rejects an initially foreign file without overwriting it and cleans up failed-open lock", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t), file = path.join(temp.root, "state.json");
    const bytes = '{"owner":"someone-else","value":4}';
    await fs.writeFile(file, bytes, { mode: 0o600 });
    const owned = temp.track(new OwnedJsonFile(file, validate));
    temp.failedOpeners.add(owned);
    await assert.rejects(owned.load(), code("InvalidPublicationState"));
    assert.equal(await fs.readFile(file, "utf8"), bytes);
    await assert.rejects(owned.close(), AggregateError);
    assert.deepEqual(await fs.readdir(temp.root), ["state.json"]);
});

test("owned JSON file refuses an independently replaced file after initial load", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t), file = path.join(temp.root, "state.json");
    const owned = temp.track(new OwnedJsonFile(file, validate));
    await owned.save({ owner: "files-owner", value: 1 });
    await fs.writeFile(file, '{"owner":"other-writer","value":41}');
    await assert.rejects(owned.save({ owner: "files-owner", value: 2 }), code("FileOwnership"));
    assert.equal(await fs.readFile(file, "utf8"), '{"owner":"other-writer","value":41}');
    assert.equal((await owned.load()).value, 1);
});

test("bundle manifest records fixed content hashes, retains old models and preserves unrelated paths", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t);
    const bundle = temp.track(new OwnedDocumentBundle(temp.root, "bundle-owner"));
    await fs.writeFile(path.join(temp.root, "unrelated.txt"), "not publication-owned");
    await bundle.write([
        { path: "models/one.tm.json", value: { id: "urn:model:one", title: "Model one" } },
        { path: "context/v1", value: { "@context": { onvif: "urn:onvif:" } } }
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp.root, "onvif-bundle-manifest.json"), "utf8")), {
        schemaVersion: 1, owner: "bundle-owner", files: {
            "models/one.tm.json": "80f8c705345ebba4c1edbef283a9bdd780950605303a511498e9685976325ff4",
            "context/v1": "f58bc86bb150b89563d2d83f84962ad155558ded50ebab80fb99dddaf63e2997"
        }
    });
    await bundle.write([{ path: "models/one.tm.json", value: { id: "urn:model:one", title: "Model two" } }]);
    const manifest = JSON.parse(await fs.readFile(path.join(temp.root, "onvif-bundle-manifest.json"), "utf8"));
    assert.deepEqual(manifest.files, {
        "models/one.tm.json": "481b37de3ad2b1a9f58ab72e7c18445ae5fe49135e8af9e32639abee77440b84",
        "context/v1": "f58bc86bb150b89563d2d83f84962ad155558ded50ebab80fb99dddaf63e2997"
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp.root, "context/v1"), "utf8")), { "@context": { onvif: "urn:onvif:" } });
    assert.equal(await fs.readFile(path.join(temp.root, "unrelated.txt"), "utf8"), "not publication-owned");
    await bundle.write([]);
    assert.equal(JSON.parse(await fs.readFile(path.join(temp.root, "models/one.tm.json"), "utf8")).title, "Model two");
    await bundle.close();
    await assert.rejects(bundle.write([]), code("RuntimeClosed"));
});

for (const mode of ["unowned", "externally modified", "hard-linked"]) {
    test(`bundle refuses ${mode} target without changing the target or manifest`, { timeout: 20000 }, async (t) => {
        const temp = await temporary(t);
        const bundle = temp.track(new OwnedDocumentBundle(temp.root, "bundle-owner"));
        const file = path.join(temp.root, "model.json");
        await bundle.write([{ path: "keep.json", value: { keep: 7 } }]);
        if (mode !== "unowned") await bundle.write([{ path: "model.json", value: { title: "Owned" } }]);
        if (mode === "hard-linked") await fs.link(file, path.join(temp.root, "linked.json"));
        else await fs.writeFile(file, '{"title":"Independent"}', { mode: 0o600 });
        const original = await fs.readFile(file, "utf8");
        const manifest = await fs.readFile(path.join(temp.root, "onvif-bundle-manifest.json"), "utf8");
        await assert.rejects(bundle.write([{ path: "model.json", value: { title: "Replacement" } }]), code("FileOwnership"));
        assert.equal(await fs.readFile(file, "utf8"), original);
        assert.equal(await fs.readFile(path.join(temp.root, "onvif-bundle-manifest.json"), "utf8"), manifest);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp.root, "keep.json"), "utf8")), { keep: 7 });
    });
}

test("bundle rejects escaping/reserved names and duplicate/over-capacity batches before writing documents", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t);
    const bundle = temp.track(new OwnedDocumentBundle(temp.root, "bundle-owner"));
    for (const name of ["../escape.json", "/absolute.json", "C:/absolute.json", "a\\escape.json", "a//b.json",
        "a/./b.json", "a/../b.json", "onvif-bundle-manifest.json", "other.lock", "a b.json", "x".repeat(513)]) {
        await assert.rejects(bundle.write([{ path: name, value: { wrong: true } }]), code("FileOwnership"), name);
    }
    await assert.rejects(bundle.write([{ path: "same.json", value: 1 }, { path: "same.json", value: 2 }]), code("PublicationLimit"));
    await assert.rejects(bundle.write(Array.from({ length: 20001 }, (_, i) => ({ path: `n${i}.json`, value: i }))), code("PublicationLimit"));
    assert.deepEqual(await fs.readdir(temp.root), ["onvif-bundle-manifest.json.lock"]);
});

test("bundle refuses a symlink/junction directory without touching its external target", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t);
    const outside = path.join(temp.root, "outside"), owned = path.join(temp.root, "owned");
    await fs.mkdir(outside, { mode: 0o700 });
    await fs.mkdir(owned, { mode: 0o700 });
    await fs.writeFile(path.join(outside, "sentinel.json"), '{"owner":"external"}');
    await fs.symlink(outside, path.join(owned, "models"), process.platform === "win32" ? "junction" : "dir");
    const bundle = temp.track(new OwnedDocumentBundle(owned, "bundle-owner"));
    await assert.rejects(bundle.write([{ path: "models/sentinel.json", value: { owner: "publication" } }]), code("FileOwnership"));
    assert.equal(await fs.readFile(path.join(outside, "sentinel.json"), "utf8"), '{"owner":"external"}');
    assert.deepEqual(await fs.readdir(outside), ["sentinel.json"]);
});

test("bundle rejects a foreign owner manifest and enforces exact per-file capacity and concurrent writes", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t);
    const bundle = temp.track(new OwnedDocumentBundle(temp.root, "bundle-owner", 3));
    const saving = bundle.write([{ path: "one.json", value: {} }]);
    await assert.rejects(bundle.write([]), code("PublicationBusy"));
    await saving;
    await assert.rejects(bundle.write([{ path: "two.json", value: { n: 1 } }]), code("PublicationLimit"));
    assert.equal(await fs.readFile(path.join(temp.root, "one.json"), "utf8"), "{}\n");
    await assert.rejects(fs.stat(path.join(temp.root, "two.json")), { code: "ENOENT" });
    await bundle.close();
    const foreign = temp.track(new OwnedDocumentBundle(temp.root, "different-owner"));
    temp.failedOpeners.add(foreign);
    await assert.rejects(foreign.write([]), code("FileOwnership"));
    assert.equal(JSON.parse(await fs.readFile(path.join(temp.root, "onvif-bundle-manifest.json"), "utf8")).owner, "bundle-owner");
});

test("bundle refuses an independently replaced owner manifest before modifying any previously owned document", { timeout: 20000 }, async (t) => {
    const temp = await temporary(t);
    const bundle = temp.track(new OwnedDocumentBundle(temp.root, "bundle-owner"));
    await bundle.write([{ path: "model.json", value: { title: "Model one" } }]);
    const manifest = path.join(temp.root, "onvif-bundle-manifest.json");
    const external = '{"schemaVersion":1,"owner":"external-owner","files":{}}\n';
    await fs.writeFile(manifest, external);
    await assert.rejects(bundle.write([{ path: "model.json", value: { title: "Would overwrite another owner" } }]), code("FileOwnership"));
    assert.equal(await fs.readFile(manifest, "utf8"), external);
    assert.equal(await fs.readFile(path.join(temp.root, "model.json"), "utf8"), '{\n    "title": "Model one"\n}\n');
});

test("atomicJson cleans its temporary file after rename failure without replacing an existing directory", async (t) => {
    const { root } = await temporary(t);
    const target = path.join(root, "not-a-file");
    await fs.mkdir(target, { mode: 0o700 });
    await fs.writeFile(path.join(target, "sentinel.txt"), "existing directory remains owned by the caller");
    await assert.rejects(atomicJson(target, { title: "Cannot replace directory" }, 1024), Error);
    assert.deepEqual(await fs.readdir(root), ["not-a-file"]);
    assert.equal((await fs.lstat(target)).isDirectory(), true);
    assert.equal(await fs.readFile(path.join(target, "sentinel.txt"), "utf8"), "existing directory remains owned by the caller");
});
