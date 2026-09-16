"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { finished } = require("node:stream/promises");
const { createOnvifRuntime } = require("./.compiled/binding/runtime.js");
const { MediaExecutor, openMedia } = require("./.compiled/media/index.js");
const { generatedThing, soapFixture } = require("../../../fixtures/reference-runtime/media/generated.cjs");
const { nativeEnvironment, startFixture, collect, collectAll, waitFor } = require("../../../fixtures/reference-runtime/media/native.cjs");

const environment = nativeEnvironment();
const REALM = "node-native-test";
const I420 = Buffer.alloc(384, 128);
const PCM = Buffer.from("000000007c7d8482".repeat(40), "hex");
const range = { startNtpNs: 3998462400250000000n, endNtpNs: 3998462402250000000n };

async function consumer(t, fixture, { variant = "media1", transport = "tcp-interleaved", caPem = fixture.caPem,
    allowedOrigins, accounts = { "principal-A": ["native-user-A", "only-loopback-A"] } } = {}) {
    const wire = await soapFixture(fixture.uri, { variant });
    t.after(() => wire.close());
    const source = generatedThing(wire.target, variant);
    const runtime = await createOnvifRuntime({ registry: source.registry, trust: { allowedOrigins: [wire.origin] } });
    t.after(() => runtime.close());
    const target = new URL(fixture.uri), origin = `${target.protocol}//${target.hostname}:${target.port}`;
    const tunneled = transport === "http-tunnel" || transport === "https-tunnel";
    const executor = new MediaExecutor({ registry: source.registry, worker: environment.worker,
        security: async (scope) => {
            const account = accounts[scope.principal];
            assert.ok(account, "Every native principal must have an independently configured account");
            return {
                thingId: scope.thingId, principal: scope.principal, targetRef: scope.targetRef, origin,
                native: { origin, principal: scope.principal, realm: REALM, username: account[0], password: account[1] },
                ...(tunneled ? { tunnel: { origin: `${transport === "https-tunnel" ? "https" : "http"}://127.0.0.1:${fixture.port}`,
                    principal: scope.principal, realm: "outer-native-fixture",
                    username: "tunnel-fixture", password: "not-an-http-password" } } : {}),
                caPem
            };
        } });
    t.after(() => executor.close());
    const context = {
        principal: "principal-A", targetRef: "approved-loopback-device",
        trust: { serviceTargets: [wire.target], allowedOrigins: allowedOrigins ?? [origin], transports: [transport],
            authentication: { kind: "digest", realm: REALM },
            ...(tunneled ? { tunnelAuthentication: { kind: "digest", realm: "outer-native-fixture" } } : {}) }
    };
    const consumed = await executor.consume(runtime, source.description, context);
    const input = structuredClone(source.input);
    if (variant === "media2") input.Protocol = transport === "udp-unicast" ? "RtspUnicast" : tunneled ? "RtspOverHttp" : "RTSP";
    else input.StreamSetup.Transport.Protocol = transport === "udp-unicast" ? "UDP" : tunneled ? "HTTP" : "RTSP";
    const request = { action: source.action, input, transport, packetOutput: true,
        tracks: { video: ["JPEG"], audio: ["PCMU"], metadata: true }, localAddress: "127.0.0.1",
        ...(variant === "replay" ? { replay: range } : {}) };
    return { runtime, executor, thing: consumed, request, wire, source, context };
}

async function goldenMedia(session, metadataCount = 4, zeroObjects = false, utc = "2026-09-15T12:00:00.25Z") {
    const [frames, metadata] = await Promise.all([collect(session.frames(), 8), collect(session.metadata, metadataCount)]);
    const video = frames.filter((frame) => frame.format === "I420"), audio = frames.filter((frame) => frame.format === "S16LE");
    assert.equal(video.length, 4);
    assert.equal(audio.length, 4);
    for (const frame of video) {
        assert.equal(frame.width, 16);
        assert.equal(frame.height, 16);
        assert.equal(frame.count, 1);
        assert.deepEqual(frame.bytes, I420, "Every decoded I420 byte must equal the independent RFC2435 synthetic image");
    }
    for (const frame of audio) {
        assert.equal(frame.sampleRate, 8000);
        assert.equal(frame.channels, 1);
        assert.equal(frame.count, 160);
        assert.deepEqual(frame.bytes, PCM, "Every signed PCM sample must equal the independent G.711 oracle");
    }
    for (const document of metadata) {
        assert.deepEqual(document.originalSource, { thingId: session.selection.thingId, targetRef: session.selection.targetRef,
            uri: session.selection.uri, nativeSessionId: session.nativeSessionId, track: 3, ssrc: document.ssrc });
        assert.equal(document.clock.rate, 90000);
        assert.equal(document.clock.firstRtpTimestamp, document.firstRtpTimestamp);
        assert.equal(document.clock.lastRtpTimestamp, document.lastRtpTimestamp);
        assert.equal(document.clock.receiptMonoNs, document.receiptMonoNs);
        assert.equal(typeof document.clock.receiptMonoNs, "bigint");
        assert.equal(document.clock.captureUtc, undefined);
        const analytics = document.value.$choice1_1;
        assert.equal(analytics[0].$case, "VideoAnalytics");
        assert.equal(analytics[0].$value.$choice1[0].$case, "Frame");
        const frame = analytics[0].$value.$choice1[0].$value;
        assert.equal(frame.$attributes.UtcTime, utc);
        if (zeroObjects) assert.ok(frame.Object === undefined || Array.isArray(frame.Object) && frame.Object.length === 0);
        else {
            assert.equal(frame.Object[0].$attributes.ObjectId, "7");
            assert.match(document.xml.toString("utf8"), /caf\u00e9/u);
        }
    }
    return { frames, metadata };
}

test("media native: generated URI action reaches worker and preserves complete canonical metadata and decoded byte oracles",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        const original = JSON.stringify(client.source.description);
        const processSettings = () => Object.fromEntries(["PATH", "Path", "GSTRUNTIMEDLLPATH", "GST_PLUGIN_PATH_1_0"]
            .map((key) => [key, process.env[key]]));
        const parentEnvironment = processSettings();
        const session = await openMedia(client.runtime, client.thing, client.request);
        t.after(() => session.close());
        assert.equal(session.support.protocol, 2);
        assert.equal(session.support.certification, false);
        assert.deepEqual(processSettings(), parentEnvironment, "Native DLL/plugin settings belong only to the spawned child");
        const packets = collect(session.packets, 20, 8000, (entry) => entry.kind === "rtp");
        const senderReports = collect(session.packets, 3, 8000, (entry) => entry.kind === "sender-report");
        await goldenMedia(session);
        const captured = await packets;
        assert.equal(captured.length, 20);
        const reports = await senderReports;
        assert.deepEqual(reports.map((entry) => entry.track).sort(), [1, 2, 3]);
        for (const report of reports) assert.equal(report.ntp, (3998462400n << 32n) | 0x40000000n);
        assert.deepEqual(captured.filter((entry) => entry.track === 3).map((entry) => entry.rtpSequence),
            [65534, 65535, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const closed = await session.close();
        assert.equal(closed.remote, "acknowledged");
        assert.equal(closed.localCleanup, true);
        assert.equal(closed.workerExit.observed, true);
        assert.equal(closed.workerExit.code, 0);
        assert.equal(closed.failure, undefined);
        assert.deepEqual(processSettings(), parentEnvironment);
        assert.equal(client.wire.records.length, 1);
        assert.equal(client.wire.records[0].rootCount, 1);
        assert.equal(JSON.stringify(client.source.description), original);
        const report = await fixture.snapshot();
        assert.deepEqual(report.errors, []);
        assert.equal(report.requests.filter((entry) => entry.method === "SETUP" && entry.authorizationPresent).length, 3);
        assert.equal(report.requests.filter((entry) => entry.method === "TEARDOWN" && entry.authorizationPresent).length, 1);
        assert.deepEqual(captured.map((entry) => entry.bytes.toString("base64")).sort(),
            report.sentPackets.filter((entry) => entry.track > 0).map((entry) => entry.bytes).sort());
    });

module.exports = { consumer, goldenMedia, REALM, range };

for (const [nativeTransport, transport] of [
    ["udp", "udp-unicast"], ["http", "http-tunnel"], ["https", "https-tunnel"], ["tls", "tls-interleaved"]
]) {
    test(`media native: ${transport} uses real transport, canonical metadata and exact decoded bytes`,
        { timeout: 30000 }, async (t) => {
            const tunneled = nativeTransport === "http" || nativeTransport === "https";
            const fixture = await startFixture({ realm: REALM, transport: nativeTransport,
                outerAuth: tunneled ? "sha256" : "none", gzip: tunneled, metadataReorder: nativeTransport === "udp" });
            t.after(() => fixture.close());
            const client = await consumer(t, fixture, { transport, variant: nativeTransport === "udp" ? "media2" : "media1" });
            const session = await openMedia(client.runtime, client.thing, client.request);
            t.after(() => session.close());
            const packets = collect(session.packets, 20, 8000, (entry) => entry.kind === "rtp");
            await goldenMedia(session);
            const captured = await packets;
            const closed = await session.close();
            assert.equal(closed.remote, "acknowledged");
            assert.equal(closed.localCleanup, true);
            assert.equal(closed.failure, undefined);
            const report = await fixture.snapshot();
            assert.deepEqual(report.errors, []);
            assert.deepEqual(captured.map((entry) => entry.bytes.toString("base64")).sort(),
                report.sentPackets.filter((entry) => entry.track > 0).map((entry) => entry.bytes).sort());
            if (nativeTransport === "udp") {
                for (const setup of report.requests.filter((entry) => entry.method === "SETUP" && entry.authorizationPresent)) {
                    assert.match(setup.transport, /client_port=\d+-\d+/u);
                    assert.doesNotMatch(setup.transport, /TCP/u);
                }
            }
            if (tunneled) {
                assert.deepEqual([...new Set(report.outerRequests.filter((entry) => entry.authorizationPresent)
                    .map((entry) => entry.method))].sort(), ["GET", "POST"]);
            }
            if (nativeTransport === "https" || nativeTransport === "tls") assert.ok(report.tlsConnections.length >= 1);
        });
}

for (const [nativeTransport, transport] of [
    ["tcp", "tcp-interleaved"], ["http", "http-tunnel"], ["https", "https-tunnel"]
]) {
    test(`media native: ${transport} replay drains END and preserves all four acknowledged generations`,
        { timeout: 45000 }, async (t) => {
            const ranges = [range, range,
                { startNtpNs: range.startNtpNs + 5000000000n, endNtpNs: range.endNtpNs + 5000000000n },
                { startNtpNs: range.startNtpNs + 11000000000n, endNtpNs: range.endNtpNs + 11000000000n }];
            const fixture = await startFixture({ realm: REALM, transport: nativeTransport, mode: "recorded",
                outerAuth: nativeTransport === "tcp" ? "none" : "sha256", staleReplay: nativeTransport === "tcp",
                expectedRanges: ranges.map((entry) => [String(entry.startNtpNs), String(entry.endNtpNs)]) });
            t.after(() => fixture.close());
            const client = await consumer(t, fixture, { variant: "replay", transport });
            const session = await openMedia(client.runtime, client.thing, client.request);
            t.after(() => session.close());
            const allPackets = [];
            for (let generation = 1; generation <= 4; generation++) {
                if (generation === 2) {
                    const paused = await session.pause();
                    assert.deepEqual(paused, { acknowledged: true, generation: 1, state: "paused" });
                    assert.deepEqual(await session.play(), { acknowledged: true, generation: 2, state: "playing" });
                } else if (generation > 2) {
                    assert.deepEqual(await session.seek(ranges[generation - 1]),
                        { acknowledged: true, generation, state: "playing" });
                }
                const [frames, metadata, packets] = await Promise.all([
                    collectAll(session.frames()), collectAll(session.metadata), collectAll(session.packets)
                ]);
                assert.equal(frames.length, 8, `No terminal decoded frame lost in generation ${generation}`);
                assert.equal(metadata.length, 4, `No terminal XML document lost in generation ${generation}`);
                assert.equal(packets.length, 20, `All original RTP survives generation ${generation}`);
                for (const frame of frames) {
                    assert.equal(frame.generation, generation);
                    assert.deepEqual(frame.bytes, frame.format === "I420" ? I420 : PCM);
                }
                for (const document of metadata) {
                    assert.equal(document.generation, generation);
                    assert.equal(document.value.$choice1_1[0].$value.$choice1[0].$value.Object[0].$attributes.ObjectId, "7");
                }
                const first = packets.find((entry) => entry.track === 1);
                const start = ranges[generation - 1].startNtpNs;
                assert.equal(first.replayNtp, (start / 1000000000n << 32n) + ((start % 1000000000n << 32n) / 1000000000n));
                for (const packet of packets) {
                    assert.equal(packet.generation, generation);
                    assert.equal(packet.replayExtension, true);
                }
                allPackets.push(...packets);
            }
            const closed = await session.close();
            assert.equal(closed.remote, "acknowledged");
            assert.equal(closed.localCleanup, true);
            assert.equal(closed.failure, undefined);
            const report = await fixture.snapshot();
            assert.deepEqual(report.errors, []);
            assert.deepEqual(report.playRanges, ranges.map((entry) => [String(entry.startNtpNs), String(entry.endNtpNs)]));
            const stale = new Set(report.stalePackets);
            assert.deepEqual(allPackets.map((entry) => entry.bytes.toString("base64")).sort(),
                report.sentPackets.filter((entry) => entry.track > 0 && !stale.has(entry.bytes)).map((entry) => entry.bytes).sort());
            const plays = report.requests.filter((entry) => entry.method === "PLAY" && entry.authorizationPresent);
            assert.equal(plays.length, 4);
            for (const packet of allPackets) assert.equal(packet.playCseqLow, plays[packet.generation - 1].cseq & 255);
            if (nativeTransport === "tcp") assert.equal(stale.size, 3);
        });
}

for (const [nativeTransport, transport] of [
    ["tcp", "tcp-interleaved"], ["udp", "udp-unicast"], ["http", "http-tunnel"], ["https", "https-tunnel"]
]) {
    test(`media native: ${transport} backchannel delivers 640 exact samples and ending it preserves receive tracks`,
        { timeout: 30000 }, async (t) => {
            const fixture = await startFixture({ realm: REALM, transport: nativeTransport, backchannel: true,
                outerAuth: nativeTransport === "http" || nativeTransport === "https" ? "sha256" : "none" });
            t.after(() => fixture.close());
            const client = await consumer(t, fixture, { transport });
            client.request.tracks.backchannel = "PCMU";
            const session = await openMedia(client.runtime, client.thing, client.request);
            t.after(() => session.close());
            assert.equal(session.tracks.find((track) => track.id === 4).direction, "send");
            const incoming = goldenMedia(session);
            for (let index = 0; index < 4; index++) {
                await new Promise((resolve, reject) => session.backchannel.write({
                    format: "S16LE", sampleRate: 8000, channels: 1, ptsNs: BigInt(index) * 20000000n, bytes: PCM
                }, (error) => error ? reject(error) : resolve()));
            }
            session.backchannel.end();
            await finished(session.backchannel);
            assert.equal(session.state, "playing");
            await incoming;
            await waitFor(() => fixture.snapshot(), (report) => report.backchannelPackets.length === 4);
            const closed = await session.close(), report = await fixture.snapshot();
            assert.equal(closed.backchannelPackets, 4);
            assert.equal(closed.backchannelSamples, 640);
            assert.equal(closed.remote, "acknowledged");
            assert.equal(closed.localCleanup, true);
            assert.equal(closed.failure, undefined);
            assert.deepEqual(report.errors, []);
            const samples = [], headers = [];
            for (const bytes of report.backchannelPackets) {
                const packet = Buffer.from(bytes, "base64");
                assert.equal(packet.length, 172);
                assert.equal(packet[0], 0x80);
                assert.equal(packet[1] & 127, 97);
                headers.push([packet.readUInt16BE(2), packet.readUInt32BE(4), packet.readUInt32BE(8)]);
                for (const octet of packet.subarray(12)) {
                    const value = ~octet & 255, magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
                    samples.push(value & 128 ? 132 - magnitude : magnitude - 132);
                }
            }
            assert.deepEqual(samples, Array.from({ length: 640 }, (_, index) => [0, 0, 32124, -32124][index % 4]));
            for (let index = 1; index < headers.length; index++) {
                assert.deepEqual(headers[index], [(headers[index - 1][0] + 1) & 65535,
                    (headers[index - 1][1] + 160) >>> 0, headers[index - 1][2]]);
            }
            assert.equal(report.requests.find((entry) => entry.method === "PLAY").session, session.nativeSessionId);
        });
}

for (const wrongHost of [false, true]) {
    test(`media native: HTTPS rejects ${wrongHost ? "wrong-host" : "untrusted"} certificates without credential disclosure`,
        { timeout: 30000 }, async (t) => {
            const fixture = await startFixture({ realm: REALM, transport: "https", outerAuth: "sha256", wrongHost });
            t.after(() => fixture.close());
            const client = await consumer(t, fixture, { transport: "https-tunnel", ...(wrongHost ? {} : { caPem: "" }) });
            await assert.rejects(openMedia(client.runtime, client.thing, client.request), (error) => {
                assert.equal(error.code, "InvalidSecurity");
                assert.equal(error.nativeCode, "TlsCertificateRejected");
                assert.equal(error.cleanup.workerExit.observed, true);
                assert.notEqual(error.cleanup.workerExit.code, 0);
                assert.equal(error.cleanup.remote, "not-created");
                assert.equal(error.cleanup.terminated, false);
                assert.equal(JSON.stringify(error).includes("only-loopback-A"), false);
                return true;
            });
            const report = await fixture.snapshot();
            assert.deepEqual(report.requests, []);
            assert.equal(report.outerRequests.some((entry) => entry.authorizationPresent), false);
        });
}

test("media native: two object-associated principals own independent native sessions and closing one preserves the other",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM, cycles: 40,
            accounts: { "native-user-A": "only-loopback-A", "native-user-B": "only-loopback-B" } });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture, { accounts: {
            "principal-A": ["native-user-A", "only-loopback-A"], "principal-B": ["native-user-B", "only-loopback-B"]
        } });
        const secondThing = await client.executor.consume(client.runtime, client.source.description,
            { ...client.context, principal: "principal-B" });
        const first = await openMedia(client.runtime, client.thing, client.request);
        const second = await openMedia(client.runtime, secondThing, client.request);
        t.after(() => first.close());
        t.after(() => second.close());
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.nativeSessionId, second.nativeSessionId);
        assert.equal((await first.close()).remote, "acknowledged");
        assert.deepEqual(await second.pause(), { acknowledged: true, state: "paused", generation: 1 });
        assert.deepEqual(await second.play(), { acknowledged: true, state: "playing", generation: 2 });
        const frames = await collect(second.frames(), 4);
        assert.equal(frames.every((frame) => frame.generation === 2), true);
        assert.equal((await second.close()).remote, "acknowledged");
        const report = await fixture.snapshot();
        assert.deepEqual(report.errors, []);
        for (const [session, account] of [[first, "native-user-A"], [second, "native-user-B"]]) {
            const requests = report.requests.filter((entry) => entry.session === session.nativeSessionId && entry.authorizationPresent);
            assert.ok(requests.length >= 5);
            assert.equal(requests.every((entry) => entry.account === account), true);
            assert.equal(requests.filter((entry) => entry.method === "TEARDOWN").length, 1);
        }
    });

test("media native: unauthorized absolute SDP control never reaches the separately owned loopback listener",
    { timeout: 30000 }, async (t) => {
        let connections = 0;
        const spy = net.createServer((socket) => { connections++; socket.destroy(); });
        await new Promise((resolve) => spy.listen(0, "127.0.0.1", resolve));
        t.after(() => new Promise((resolve) => spy.close(resolve)));
        const fixture = await startFixture({ realm: REALM,
            forbiddenControl: `rtsp://127.0.0.1:${spy.address().port}/denied` });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        await assert.rejects(openMedia(client.runtime, client.thing, client.request), (error) => {
            assert.equal(error.code, "PolicyDenied", error.nativeCode);
            assert.match(error.nativeCode, /^Forbidden/u);
            assert.equal(error.cleanup.workerExit.observed, true);
            assert.equal(error.cleanup.terminated, false);
            return true;
        });
        assert.equal(connections, 0);
    });

test("media native: AbortSignal during SETUP sends scoped cancellation and awaits owned exit",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM, setupDelay: 0.3 });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture), controller = new AbortController();
        const opening = openMedia(client.runtime, client.thing, { ...client.request, signal: controller.signal });
        const rejected = assert.rejects(opening, (error) => {
            assert.equal(error.code, "TransportError");
            assert.equal(error.cleanup.workerExit.observed, true);
            assert.equal(error.cleanup.terminated, false);
            assert.notEqual(error.cleanup.remote, "not-created", "The fixture observed an actual SETUP request");
            return true;
        });
        await waitFor(() => fixture.snapshot(), (report) => report.requests.some((entry) => entry.method === "SETUP"));
        controller.abort();
        await rejected;
    });

test("media native: AbortSignal during seek closes the reserved generation without manufacturing its ACK",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM, mode: "recorded", controlDelay: 0.3 });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture, { variant: "replay" }), controller = new AbortController();
        const session = await openMedia(client.runtime, client.thing, { ...client.request, signal: controller.signal });
        t.after(() => session.close());
        await Promise.all([collectAll(session.frames()), collectAll(session.metadata), collectAll(session.packets)]);
        const seek = session.seek(range);
        const rejected = assert.rejects(seek, { code: "TransportError" });
        await waitFor(() => fixture.snapshot(), (report) =>
            report.requests.filter((entry) => entry.method === "PLAY" && entry.authorizationPresent).length === 2);
        controller.abort();
        await rejected;
        const closed = await session.closed;
        assert.equal(session.generation, 1);
        assert.equal(closed.workerExit.observed, true);
        assert.equal(closed.terminated, false);
        assert.equal(closed.failure.code, "TransportError");
        assert.notEqual(closed.failure.nativeCode, "IpcSessionOrGenerationMismatch");
    });

test("media native: close escapes exhausted data credits without hanging on unconsumed queues",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM, cycles: 40 });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        const session = await openMedia(client.runtime, client.thing, { ...client.request, limits: { queueUnits: 2 } });
        t.after(() => session.close());
        await waitFor(() => fixture.snapshot(), (report) => report.sentPackets.length >= 10);
        const closed = await session.close();
        assert.equal(closed.remote, "acknowledged");
        assert.equal(closed.localCleanup, true);
        assert.equal(closed.workerExit.observed, true);
        assert.equal(closed.terminated, false);
        assert.ok(closed.droppedUnits > 0);
    });

test("media native: gzip metadata preserves zero-object frames, Event messages, extensions and lexical source clocks",
    { timeout: 30000 }, async (t) => {
        const utc = "2026-09-16T03:00:00.123456789Z";
        const xml = Buffer.from(`<tt:MetadataStream xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:v="urn:independent:media">
<tt:VideoAnalytics><tt:Frame UtcTime="${utc}"/></tt:VideoAnalytics>
<v:Extra>first</v:Extra><tt:SensorData UtcTime="${utc}" SensorID="01"><tt:Type>heat</tt:Type><tt:Value>+1.20e2</tt:Value></tt:SensorData>
<tt:Event><n:NotificationMessage xmlns:n="http://docs.oasis-open.org/wsn/b-2">
<n:Topic Dialect="http://docs.oasis-open.org/wsn/t-1/TopicExpression/Concrete" xmlns:a="urn:independent:access">a:Door</n:Topic>
<n:Message><tt:Message UtcTime="${utc}" PropertyOperation="Changed"><tt:Source><tt:SimpleItem Name="Token" Value="0007"/></tt:Source><tt:Data><tt:SimpleItem Name="LogicalState" Value="Denied"/></tt:Data></tt:Message></n:Message>
</n:NotificationMessage></tt:Event><v:Extra>last</v:Extra></tt:MetadataStream>`);
        const fixture = await startFixture({ realm: REALM, gzip: true, documents: [xml.toString("base64")] });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        const session = await openMedia(client.runtime, client.thing, client.request);
        t.after(() => session.close());
        const { metadata } = await goldenMedia(session, 4, true, utc);
        for (const document of metadata) {
            assert.deepEqual(document.xml, xml, "Native gzip assembly must retain the entire original XML byte sequence");
            const blocks = document.value.$choice1_1;
            assert.deepEqual(blocks.map((entry) => entry.$case), ["VideoAnalytics", "$any6", "SensorData", "Event", "$any6"]);
            assert.equal(blocks[2].$value.Value, "+1.20e2");
            assert.equal(blocks[2].$value.$attributes.SensorID, "01");
            assert.deepEqual(blocks[3].$value.$choice1.map((entry) => entry.$case), ["NotificationMessage"]);
            const notification = blocks[3].$value.$choice1[0].$value;
            assert.equal(notification.Topic.$attributes.Dialect,
                "http://docs.oasis-open.org/wsn/t-1/TopicExpression/Concrete");
            assert.deepEqual(notification.Topic.$children, [{ kind: "text", value: "a:Door" }]);
            assert.equal(notification.Topic.$namespaces.a, "urn:independent:access");
            assert.equal(notification.Message.$any1_1.length, 1);
            const message = notification.Message.$any1_1[0];
            assert.deepEqual(message.name, { namespace: "http://www.onvif.org/ver10/schema", localName: "Message" });
            assert.deepEqual(message.attributes.map((entry) => [entry.name.localName, entry.value]),
                [["UtcTime", utc], ["PropertyOperation", "Changed"]]);
            assert.deepEqual(message.children.map((entry) => entry.name.localName), ["Source", "Data"]);
            assert.deepEqual(message.children.map((entry) => entry.children[0].attributes.map((attribute) => attribute.value)),
                [["Token", "0007"], ["LogicalState", "Denied"]]);
            assert.equal(document.originalSource.nativeSessionId, session.nativeSessionId);
        }
        assert.equal((await session.close()).remote, "acknowledged");
        assert.deepEqual((await fixture.snapshot()).errors, []);
    });

test("media native: canonical rejection reports gaps and never substitutes an empty metadata object",
    { timeout: 30000 }, async (t) => {
        const good = Buffer.from('<tt:MetadataStream xmlns:tt="http://www.onvif.org/ver10/schema"><tt:VideoAnalytics><tt:Frame UtcTime="2026-09-15T12:00:00.25Z"/></tt:VideoAnalytics></tt:MetadataStream>');
        const bad = Buffer.from(good.toString("utf8").replace(' UtcTime="2026-09-15T12:00:00.25Z"', ""));
        const fixture = await startFixture({ realm: REALM, documents: [bad.toString("base64"), good.toString("base64")] });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        const session = await openMedia(client.runtime, client.thing, client.request);
        t.after(() => session.close());
        const gaps = collect(session.diagnostics, 2, 8000, (entry) => entry.code === "CanonicalMetadataRejected");
        const { metadata } = await goldenMedia(session, 2, true);
        assert.deepEqual(metadata.map((entry) => entry.xml), [good, good]);
        assert.deepEqual((await gaps).map((entry) => [entry.kind, entry.track, entry.droppedUnits]), [["gap", 3, 1], ["gap", 3, 1]]);
        const closed = await session.close();
        assert.equal(closed.remote, "acknowledged");
        assert.equal(closed.failure, undefined);
        assert.ok(closed.droppedUnits >= 2);
    });

test("media native: corrupt gzip is rejected before canonical delivery while decoded replay drains to real END",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM, mode: "recorded", gzip: true, gzipCorrupt: true });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture, { variant: "replay" });
        const session = await openMedia(client.runtime, client.thing, client.request);
        t.after(() => session.close());
        const gaps = collect(session.diagnostics, 4, 8000, (entry) => entry.kind === "gap" && entry.track === 3);
        const [frames, metadata, packets] = await Promise.all([
            collectAll(session.frames()), collectAll(session.metadata), collectAll(session.packets)
        ]);
        assert.equal(frames.length, 8);
        assert.equal(packets.length, 20);
        assert.deepEqual(metadata, []);
        assert.equal((await gaps).length, 4);
        for (const frame of frames) assert.deepEqual(frame.bytes, frame.format === "I420" ? I420 : PCM);
        const closed = await session.close();
        assert.equal(closed.remote, "acknowledged");
        assert.equal(closed.localCleanup, true);
        assert.equal(closed.failure, undefined);
    });

test("media native: explicit FormReference resolves the actual source before native execution, without URI extraction overrides",
    { timeout: 30000 }, async (t) => {
        const fixture = await startFixture({ realm: REALM });
        t.after(() => fixture.close());
        const client = await consumer(t, fixture);
        const description = structuredClone(client.source.description);
        const form = description.actions[client.source.action].forms[0];
        description.actions[client.source.action].forms = [
            { ...form, "@id": "urn:media:native:unused", href: "/unused" },
            { ...form, "@id": "urn:media:native:resolver", href: "../onvif/media" }
        ];
        const document = `${client.wire.origin}/td/camera.td.json`;
        const thing = await client.executor.consume(client.runtime, description, { ...client.context, document });
        const session = await openMedia(client.runtime, thing, { ...client.request,
            formRef: { document, form: "urn:media:native:resolver", operation: "https://www.w3.org/2019/wot/td#invokeAction" } });
        t.after(() => session.close());
        await goldenMedia(session);
        assert.equal(session.selection.formIndex, 1);
        assert.equal(client.wire.records.length, 1);
        assert.equal(client.wire.records[0].url, "/onvif/media");
        assert.equal(session.selection.serviceTarget, client.wire.target);
        assert.equal((await session.close()).remote, "acknowledged");
    });
