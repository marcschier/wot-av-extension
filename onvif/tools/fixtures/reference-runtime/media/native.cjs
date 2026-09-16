"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync, statSync } = require("node:fs");
const { isAbsolute, join } = require("node:path");
const { Readable } = require("node:stream");

function nativeEnvironment() {
    assert.equal(process.env.ONVIF_MEDIA_NATIVE_TEST, "1", "Native tests require explicit ONVIF_MEDIA_NATIVE_TEST=1");
    const values = {};
    for (const name of ["ONVIF_MEDIA_WORKER", "ONVIF_MEDIA_SDK_ROOT", "ONVIF_MEDIA_PYTHON"]) {
        const value = process.env[name];
        assert.ok(typeof value === "string" && isAbsolute(value), `${name} must be an explicit absolute path`);
        assert.ok(statSync(value), `${name} must exist`);
        values[name] = value;
    }
    return {
        worker: { executable: values.ONVIF_MEDIA_WORKER, dllDirectory: join(values.ONVIF_MEDIA_SDK_ROOT, "bin") },
        python: values.ONVIF_MEDIA_PYTHON,
        workerSha256: createHash("sha256").update(readFileSync(values.ONVIF_MEDIA_WORKER)).digest("hex")
    };
}

async function startFixture(options = {}) {
    const environment = nativeEnvironment();
    const child = spawn(environment.python, ["-B", join(__dirname, "./native-server.py")], {
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: false,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ONVIF_MEDIA_NATIVE_TEST: "1" }
    });
    const pending = new Map();
    let nextId = 0, buffer = Buffer.alloc(0), stderrBytes = 0, stopped;
    let resolveReady, rejectReady, readySeen = false;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const fail = (error) => {
        rejectReady(error);
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
        pending.clear();
    };
    child.on("error", () => fail(new Error("Independent Python fixture process failed")));
    const exit = new Promise((resolve) => child.once("close", (code, signal) => {
        if (pending.size || !readySeen) fail(new Error("Independent fixture exited before its pending receipt"));
        resolve({ code, signal });
    }));
    child.stdin.on("error", () => fail(new Error("Independent fixture input pipe failed")));
    child.stdout.on("error", () => fail(new Error("Independent fixture output pipe failed")));
    child.stderr.on("error", () => fail(new Error("Independent fixture diagnostic pipe failed")));
    child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 65536) fail(new Error("Independent fixture diagnostic budget exceeded"));
    });
    child.stdout.on("data", (chunk) => {
        try {
            buffer = Buffer.concat([buffer, chunk]);
            assert.ok(buffer.length <= 4 * 1024 * 1024, "Independent fixture response byte bound");
            let boundary;
            while ((boundary = buffer.indexOf(10)) >= 0) {
                const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, boundary)));
                buffer = buffer.subarray(boundary + 1);
                if (value.event === "error") throw new Error(`Independent fixture rejected its operation (${value.code})`);
                if (value.event === "ready") {
                    assert.equal(readySeen, false);
                    const uri = new URL(value.uri);
                    assert.equal(uri.hostname, "127.0.0.1", "This integration cannot target real devices");
                    assert.equal(Number(uri.port), value.port);
                    readySeen = true;
                    resolveReady(value);
                } else {
                    const request = pending.get(value.id);
                    assert.ok(request, "Only a pending private fixture command may receive a response");
                    pending.delete(value.id);
                    clearTimeout(request.timer);
                    request.resolve(value);
                }
            }
        } catch (error) { fail(error); }
    });
    const query = (command) => {
        const id = ++nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("Independent fixture receipt deadline"));
            }, 5000);
            pending.set(id, { resolve, reject, timer });
            child.stdin.write(JSON.stringify({ command, id }) + "\n");
        });
    };
    const terminateAfterDeadline = async () => {
        let timer;
        const outcome = await Promise.race([exit, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); })]);
        clearTimeout(timer);
        if (outcome !== null) return outcome;
        if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        let killTimer;
        const terminated = await Promise.race([exit, new Promise((_, reject) => {
            killTimer = setTimeout(() => reject(new Error("Owned Python fixture exit remains unconfirmed")), 3000);
        })]).finally(() => clearTimeout(killTimer));
        throw new Error(`Owned Python fixture required deadline termination (${terminated.code})`);
    };
    const stop = () => {
        if (stopped === undefined) stopped = (async () => {
            let result, failure;
            try { result = await query("stop"); } catch (error) { failure = error; } finally { child.stdin.end(); }
            const status = await terminateAfterDeadline();
            if (failure) throw failure;
            assert.deepEqual(status, { code: 0, signal: null });
            return result.report;
        })();
        return stopped;
    };
    child.stdin.write(JSON.stringify({
        allowLoopbackTest: true, node: process.execPath,
        accounts: { "native-user-A": "only-loopback-A" }, ...options
    }) + "\n");
    let timer;
    try {
        const information = await Promise.race([ready, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Independent fixture startup deadline")), 10000);
        })]);
        clearTimeout(timer);
        assert.equal(child.exitCode, null);
        return { ...information, process: child, snapshot: async () => (await query("snapshot")).report, close: stop };
    } catch (error) {
        clearTimeout(timer);
        child.stdin.end();
        await terminateAfterDeadline();
        throw error;
    }
}

async function collect(iterator, count, timeoutMs = 8000, include = () => true) {
    const reader = iterator[Symbol.asyncIterator]();
    let timer;
    try {
        return await Promise.race([(async () => {
            const values = [];
            while (values.length < count) {
                const next = await reader.next();
                assert.equal(next.done, false, "Native stream ended before the required complete units");
                if (include(next.value)) values.push(next.value);
            }
            return values;
        })(), new Promise((_, reject) => { timer = setTimeout(() => {
            const error = new Error("Native media unit deadline");
            if (iterator instanceof Readable) iterator.destroy(error);
            reject(error);
        }, timeoutMs); })]);
    } finally {
        clearTimeout(timer);
        await reader.return();
    }
}

async function collectAll(iterator, timeoutMs = 10000) {
    const reader = iterator[Symbol.asyncIterator]();
    let timer;
    try {
        return await Promise.race([(async () => {
            const values = [];
            while (true) {
                const next = await reader.next();
                if (next.done) return values;
                assert.ok(values.length < 4096, "Independent finite capture bound");
                values.push(next.value);
            }
        })(), new Promise((_, reject) => { timer = setTimeout(() => {
            const error = new Error("Native END watermark/readable EOF deadline");
            if (iterator instanceof Readable) iterator.destroy(error);
            reject(error);
        }, timeoutMs); })]);
    } finally {
        clearTimeout(timer);
        await reader.return();
    }
}

async function waitFor(observe, predicate, timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    do {
        const value = await observe();
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
    } while (performance.now() < deadline);
    throw new Error("Independent native fixture observation deadline");
}

module.exports = { nativeEnvironment, startFixture, collect, collectAll, waitFor };
