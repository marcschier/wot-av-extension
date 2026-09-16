"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { adaptNativeProcess } = require("./.compiled/media/process.js");
const { startMediaSession } = require("./.compiled/media/session.js");
const { mediaLimits } = require("./.compiled/media/policy.js");
const { options } = require("../../../fixtures/reference-runtime/media/session-options.cjs");

function processFixture(mode) {
    const args = [join(__dirname, "../../../fixtures/reference-runtime/media/fake-worker.cjs"),
        "--data-fd", "3", "--secret-fd", "4", "--input-fd", "5"];
    const child = spawn(process.execPath, args, {
        stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"], windowsHide: true, detached: false,
        env: { ...process.env, ONVIF_MEDIA_FAKE_MODE: mode }
    });
    return { process: adaptNativeProcess(child), args };
}

test("media fake process: credentials use fd4, fragmented decoded units use fd3, and close awaits actual exit",
    { timeout: 10000 }, async () => {
        const fixture = processFixture("normal"), settings = options(fixture.process);
        const password = "private-pipe-only-synthetic-credential";
        settings.descriptor.scope.authentication = { kind: "digest", realm: "unit-realm" };
        settings.descriptor.credentialHandle = 7;
        settings.material.native = { origin: settings.descriptor.scope.origin, principal: settings.descriptor.scope.principal,
            realm: "unit-realm", username: "unit-only-user", password };
        const session = await startMediaSession(settings);
        const stream = session.frames(), reader = stream[Symbol.asyncIterator]();
        const frame = (await reader.next()).value;
        assert.deepEqual(frame.bytes, Buffer.alloc(384, 90), "This is an explicitly synthetic byte fixture, not a decoder oracle");
        assert.equal(frame.ptsNs, undefined);
        await reader.return();
        const closed = await session.close();
        assert.equal(closed.remote, "acknowledged");
        assert.equal(closed.localCleanup, true);
        assert.equal(closed.workerExit.observed, true);
        assert.equal(closed.workerExit.code, 0);
        assert.equal(closed.terminated, false);
        assert.equal(closed.failure, undefined);
        assert.ok(closed.stderrBytes > 0);
        assert.equal(JSON.stringify([fixture.args, closed]).includes(password), false);
    });

test("media fake process: an unresponsive owned child is terminated only after its close deadline",
    { timeout: 10000 }, async () => {
        const fixture = processFixture("ignore-close"), settings = options(fixture.process);
        settings.descriptor.limits = mediaLimits({ closeTimeoutMs: 80, killTimeoutMs: 1000 });
        const session = await startMediaSession(settings);
        const started = performance.now();
        const closed = await session.close();
        assert.ok(performance.now() - started >= 70);
        assert.equal(closed.remote, "uncertain");
        assert.equal(closed.localCleanup, false);
        assert.equal(closed.terminated, true);
        assert.equal(closed.workerExit.observed, true);
        assert.ok(closed.workerExit.code !== 0 || closed.workerExit.signal !== null);
        assert.equal(closed.failure.code, "OutcomeUnknown");
    });

test("media fake process: bad binary HELLO receives no secret and closes its actual owned process",
    { timeout: 10000 }, async () => {
        const fixture = processFixture("bad-handshake");
        await assert.rejects(startMediaSession(options(fixture.process)), (error) => {
            assert.equal(error.code, "InvalidValue");
            assert.equal(error.cleanup.remote, "not-created");
            assert.equal(error.cleanup.workerExit.observed, true);
            assert.equal(error.cleanup.workerExit.code, 0, "Child independently asserted that fd4 contained no secret");
            assert.equal(error.cleanup.terminated, false);
            return true;
        });
    });
