const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const h = require("./helpers.cjs");
const { OnvifError } = require("./.compiled/binding/errors");

async function directory(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onvif-discovery-inventory-"));
    const stores = [];
    const expectedFailures = new Set();
    t.after(async () => {
        const settled = await Promise.allSettled(stores.map((store) => store.close()));
        for (let index = 0; index < settled.length; index++) {
            if (settled[index].status === "rejected") assert.ok(expectedFailures.has(stores[index]), "Unexpected persistence cleanup failure");
        }
        const files = await fs.readdir(root);
        for (const file of files) {
            assert.match(file, /^inventory\.json(?:\.lock|\.[a-f0-9-]+\.tmp)?$/, "Cleanup is restricted to files created by this fixture");
            assert.equal((await fs.lstat(path.join(root, file))).isFile(), true);
            await fs.unlink(path.join(root, file));
        }
        await fs.rmdir(root);
    });
    return {
        root, file: path.join(root, "inventory.json"), stores, expectedFailures,
        create(options = {}) {
            const store = new h.JsonFilePersistence({ path: path.join(root, "inventory.json"), ...options });
            stores.push(store);
            return store;
        }
    };
}

function snapshot() {
    const { inventory } = h.inventory();
    const message = h.parseDiscovery(h.fixture("hello-device.xml"));
    const id = inventory.observe(message, h.provenance(message))[0];
    inventory.commitInspection(inventory.beginInspection(id), h.report(inventory.device(id).endpointReference));
    return inventory.snapshot();
}

test("memory adapter persists detached normalized state, rejects stale writes and never accepts invented conformance/status shapes", async () => {
    const initial = snapshot();
    const store = new h.MemoryPersistence();
    assert.equal(await store.load(), null);
    await store.save(initial);
    initial.devices[0].information.value.firmwareVersion = "mutated externally";
    const loaded = await store.load();
    assert.equal(loaded.devices[0].information.value.firmwareVersion, "1.0");
    await assert.rejects(store.save({ ...loaded, revision: loaded.revision - 1 }), { code: "PolicyDenied" });
    for (const mutate of [
        (data) => { data.schemaVersion = 2009; },
        (data) => { data.devices[0].id = "http://127.0.0.1:18080/url-is-not-native-identity"; },
        (data) => { data.devices[0].services.status = "certified"; },
        (data) => { data.devices[0].ordering.instanceId = "-1"; },
        (data) => { data.devices.push(structuredClone(data.devices[0])); },
        (data) => { data.devices[0].endpoints[0].xaddr = "http://user:password@127.0.0.1/device"; }
    ]) {
        const data = structuredClone(loaded);
        mutate(data);
        assert.throws(() => h.assertSnapshot(data));
    }
    await store.close();
    await assert.rejects(store.load(), { code: "RuntimeClosed" });
});

test("JSON file adapter verifies private directory ACLs/permissions, atomically persists and restores real inventory and tombstones", { timeout: 20000 }, async (t) => {
    const dir = await directory(t);
    await h.verifyPrivateInventoryDirectory(dir.root);
    const store = dir.create();
    assert.equal(await store.load(), null);
    const data = snapshot();
    await store.save(data);
    const bytes = await fs.readFile(dir.file, "utf8");
    assert.deepEqual(JSON.parse(bytes), data);
    assert.deepEqual((await fs.readdir(dir.root)).sort(), ["inventory.json", "inventory.json.lock"]);
    const tombstone = structuredClone(data);
    tombstone.revision++;
    tombstone.devices[0].state = "departed";
    tombstone.devices[0].failedLivenessRounds = 2;
    tombstone.devices[0].suspectSince = 1000;
    await store.save(tombstone);
    await store.close();
    assert.deepEqual(await fs.readdir(dir.root), ["inventory.json"]);
    const second = dir.create();
    assert.deepEqual(await second.load(), tombstone);
    await second.close();
});

test("single-writer lock, stale revision and same-revision conflict fail without overwriting or deleting the owner's lock", { timeout: 20000 }, async (t) => {
    const dir = await directory(t);
    const owner = dir.create();
    const data = snapshot();
    await owner.save(data);
    const competing = dir.create();
    dir.expectedFailures.add(competing);
    await assert.rejects(competing.load(), { code: "EEXIST" });
    await assert.rejects(competing.close(), AggregateError);
    assert.equal((await fs.lstat(`${dir.file}.lock`)).isFile(), true, "A failed opener must not unlink another owner's lock");
    await assert.rejects(owner.save({ ...data, revision: data.revision - 1 }), { code: "PolicyDenied" });
    const contradictory = structuredClone(data);
    contradictory.devices[0].state = "departed";
    await assert.rejects(owner.save(contradictory), { code: "PolicyDenied" });
    assert.deepEqual(JSON.parse(await fs.readFile(dir.file, "utf8")), data);
    await owner.close();
});

test("corrupt, oversized and policy-denied persisted input is not silently treated as an empty inventory", { timeout: 30000 }, async (t) => {
    for (const mode of ["corrupt", "oversized", "policy"]) {
        const dir = await directory(t);
        const text = mode === "corrupt" ? "{not-json" : mode === "oversized" ? " ".repeat(1025) : JSON.stringify(snapshot());
        await fs.writeFile(dir.file, text, { mode: 0o600 });
        const store = dir.create({
            ...(mode === "oversized" ? { bounds: { maxStoreBytes: 1024 } } : {}),
            ...(mode === "policy" ? { verifyPrivateDirectory: async () => {
                throw new OnvifError("PolicyDenied", "Additional deployment policy rejected this private directory");
            } } : {})
        });
        dir.expectedFailures.add(store);
        await assert.rejects(store.load(), mode === "corrupt" ? SyntaxError : { code: mode === "policy" ? "PolicyDenied" : "InvalidValue" });
        assert.equal(await fs.readFile(dir.file, "utf8"), text);
        await assert.rejects(store.close(), AggregateError);
    }
});

test("file byte budget and concurrent writes are enforced before any temporary replacement becomes visible", { timeout: 20000 }, async (t) => {
    const dir = await directory(t);
    const store = dir.create({ bounds: { maxStoreBytes: 1024 } });
    await store.load();
    await assert.rejects(store.save(snapshot()), { code: "InvalidValue" });
    await assert.rejects(fs.stat(dir.file), { code: "ENOENT" });
    const empty = { schemaVersion: 1, revision: 1, capturedAt: 1000, devices: [], seeds: [], diagnostics: [], truncated: false };
    const first = store.save(empty);
    await assert.rejects(store.save({ ...empty, revision: 2 }), { code: "PolicyDenied" });
    await first;
    assert.deepEqual(JSON.parse(await fs.readFile(dir.file, "utf8")), empty);
    assert.ok(!(await fs.readdir(dir.root)).some((name) => name.endsWith(".tmp")));
    await store.close();
});
