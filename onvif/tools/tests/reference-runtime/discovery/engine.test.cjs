const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");
const { nativeFixture } = require("../../../fixtures/reference-runtime/discovery/native-fixture.cjs");
const { OnvifError } = require("./.compiled/binding/errors");

function setup(t, overrides = {}) {
    const clock = new h.FixtureClock(1000);
    const datagrams = new h.FixtureDatagramAdapter();
    const nativeRead = overrides.nativeRead ?? new h.FixtureReadAdapter(() => {
        assert.fail("Unapproved fixture endpoints must never reach the native read adapter");
    });
    const persistence = overrides.persistence ?? new h.MemoryPersistence();
    const ids = ["urn:uuid:probe-general", "urn:uuid:probe-legacy", "urn:uuid:resolve-device"];
    let next = 0;
    const engine = h.createDiscoveryEngine({
        datagrams, nativeRead, persistence, clock, random: () => 0.5,
        messageId: () => ids.shift() ?? `urn:uuid:request-${++next}`
    });
    t.after(() => engine.close());
    return { engine, datagrams, nativeRead, persistence, clock };
}

test("constructor is inert; start requires configured confined segments and never silently scans or opens a gateway", async (t) => {
    const { engine, datagrams, nativeRead, clock } = setup(t);
    assert.equal(datagrams.openChannels, 0);
    assert.equal(datagrams.sent.length, 0);
    assert.equal(nativeRead.calls.length, 0);
    assert.equal(clock.pendingTimers, 0);
    for (const invalid of [
        {}, h.options({ interfaces: [] }), h.options({ segments: [] }),
        h.options({ interfaces: [{ id: "loop-a", address: "0.0.0.0", family: "IPv4" }] }),
        h.options({ segments: [{ ...h.options().segments[0], cidr: "0.0.0.0/0" }] }),
        h.options({ segments: [{ ...h.options().segments[0], destination: { address: "192.0.2.1", port: 3702 } }] }),
        h.options({ unknownOption: "ignored?" })
    ]) assert.throws(() => engine.start(invalid), { code: "InvalidConfiguration" });
    assert.equal(datagrams.openChannels, 0);
    await engine.start(h.options({ allowedXAddrs: [] }));
    assert.equal(datagrams.openChannels, 1);
    await clock.advance(20);
    await engine.whenIdle();
    assert.equal(datagrams.sent.length, 6, "Two qualified probes, each with exactly three bounded transmissions");
    for (const type of ["tds:Device", "dn:NetworkVideoTransmitter"]) {
        const sent = datagrams.sent.filter((item) => h.element(h.wire(item.data), h.DISCOVERY, "Types").textContent === type);
        assert.equal(sent.length, 3);
        assert.equal(new Set(sent.map((item) => h.element(h.wire(item.data), h.ADDRESSING, "MessageID").textContent)).size, 1);
        assert.deepEqual(sent[0].data, sent[1].data);
        assert.deepEqual(sent[1].data, sent[2].data);
    }
    const closing = engine.close();
    assert.equal(closing, engine.close());
    await closing;
    assert.equal(datagrams.openChannels, 0);
    assert.equal(clock.pendingTimers, 0);
    assert.equal(nativeRead.closed, true);
});

test("ProbeMatches and ResolveMatches require right RelatesTo, action, interface and live deadline; duplicate NIC evidence remains", async (t) => {
    const context = setup(t);
    const options = h.options({ allowedXAddrs: [], retransmissions: 1 });
    options.interfaces.push({ id: "loop-b", address: "127.0.0.2", family: "IPv4" });
    options.segments.push({ ...options.segments[0], id: "segment-b", interfaceId: "loop-b" });
    await context.engine.start(options);
    const send = (xml, segment = "segment-a") => context.datagrams.deliver(segment, h.datagram(xml));
    send(h.fixture("probe-device.xml").replace("urn:uuid:probe-general", "urn:uuid:unrelated"));
    send(h.fixture("resolve-device.xml").replace("urn:uuid:resolve-device", "urn:uuid:probe-general"));
    send(h.fixture("probe-device.xml"), "segment-b");
    assert.equal(context.engine.snapshot().devices.length, 0);
    send(h.fixture("probe-device.xml"));
    assert.equal(context.engine.snapshot().devices.length, 1);
    send(h.fixture("probe-device.xml"), "segment-b");
    assert.equal(context.engine.snapshot().devices[0].provenance.length, 2);
    const epoch = context.engine.snapshot().devices[0].epoch;
    await context.clock.advance(21);
    await context.engine.whenIdle();
    send(h.fixture("probe-device.xml").replace("probe-response-device", "late-probe-response"));
    assert.equal(context.engine.snapshot().devices[0].epoch, epoch);
    assert.ok(context.engine.snapshot().diagnostics.filter((item) => item.code === "UncorrelatedResponse").length >= 4);
    const resolve = context.engine.resolve(context.engine.snapshot().devices[0].endpointReference, "segment-a");
    const last = context.datagrams.sent.at(-1);
    const id = h.element(h.wire(last.data), h.ADDRESSING, "MessageID").textContent;
    send(h.fixture("resolve-device.xml").replace("urn:uuid:resolve-device", id));
    assert.equal(context.engine.snapshot().devices[0].ordering.sequences[0].messageNumber, "8");
    await context.clock.advance(21);
    await resolve;
    await context.engine.whenIdle();
});

test("separate general and legacy probes discover Device-only access peripherals and legacy-S-only NVT", async (t) => {
    const { engine, datagrams, clock } = setup(t);
    datagrams.onSend = (_segment, bytes) => {
        const doc = h.wire(bytes);
        const id = h.element(doc, h.ADDRESSING, "MessageID").textContent;
        const types = h.element(doc, h.DISCOVERY, "Types").textContent;
        const xml = types === "tds:Device" ? h.fixture("probe-device.xml").replace("urn:uuid:probe-general", id)
            : h.fixture("probe-legacy.xml").replace("urn:uuid:probe-legacy", id);
        datagrams.deliver("segment-a", h.datagram(xml, { address: types === "tds:Device" ? "127.0.0.1" : "127.0.0.2" }));
    };
    await engine.start(h.options({ allowedXAddrs: [] }));
    await clock.advance(21);
    await engine.whenIdle();
    const devices = engine.snapshot().devices;
    assert.equal(devices.length, 2);
    assert.deepEqual(new Set(devices.flatMap((device) => device.types.map((type) => type.localName))), new Set(["Device", "NetworkVideoTransmitter"]));
    assert.ok(devices.every((device) => device.state === "candidate"));
});

test("untyped fallback is explicit, bounded, after typed rounds, and never substitutes for native verification", async (t) => {
    const { engine, datagrams, clock } = setup(t);
    datagrams.onSend = (_segment, bytes) => {
        const doc = h.wire(bytes);
        if (doc.getElementsByTagNameNS(h.DISCOVERY, "Types").length === 0) {
            const id = h.element(doc, h.ADDRESSING, "MessageID").textContent;
            datagrams.deliver("segment-a", h.datagram(h.fixture("probe-device.xml")
                .replace("urn:uuid:probe-general", id).replace(/<d:Types>[^<]+<\/d:Types>/, "")));
        }
    };
    await engine.start(h.options({ allowedXAddrs: [], retransmissions: 1,
        untypedFallback: { enabled: true, maxProbesPerRound: 1 } }));
    await clock.advance(19);
    assert.equal(datagrams.sent.length, 2);
    await clock.advance(22);
    await engine.whenIdle();
    assert.equal(datagrams.sent.length, 3);
    assert.equal(engine.snapshot().devices.length, 1);
    assert.deepEqual(engine.snapshot().devices[0].types, []);
    assert.equal(engine.snapshot().devices[0].state, "candidate");
});

test("unsolicited Hello/Bye work without requests; proxies neither enter inventory nor suppress the configured round", async (t) => {
    const { engine, datagrams, clock } = setup(t);
    await engine.start(h.options({ allowedXAddrs: [], retransmissions: 1 }));
    await clock.advance(21);
    await engine.whenIdle();
    datagrams.deliver("segment-a", h.datagram(h.fixture("proxy-hello.xml")));
    assert.equal(engine.snapshot().devices.length, 0);
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-device.xml")));
    datagrams.deliver("segment-a", h.datagram(h.fixture("bye-device-old.xml").replace('MessageNumber="4"', 'MessageNumber="8"')));
    assert.equal(engine.snapshot().devices[0].state, "suspect");
    assert.ok(engine.snapshot().diagnostics.some((item) => item.code === "DiscoveryProxyUnapproved"));
    await engine.close();
    assert.equal(clock.pendingTimers, 0);
    assert.equal(datagrams.openChannels, 0);
});

test("static seeds retain their operator ID and stay provisional until native GetEndpointReference returns an identity", async (t) => {
    let permit = false;
    const fixture = nativeFixture(({ reference }) => {
        if (reference.operation === "GetEndpointReference" && !permit) return {
            status: "denied", code: "NativeAuthentication", message: "Explicit fixture authentication denial", responded: true
        };
    });
    const { engine, clock } = setup(t, { nativeRead: fixture.adapter });
    const options = h.options({ retransmissions: 1, allowedXAddrs: [...fixture.allowed],
        seeds: [{ seedId: "operator-front-door", xaddr: h.XADDR, interfaceId: "loop-a", segmentId: "segment-a" }] });
    await engine.start(options);
    await clock.advance(21);
    await engine.whenIdle();
    assert.equal(engine.snapshot().devices.length, 0);
    assert.equal(engine.snapshot().seeds[0].seedId, "operator-front-door");
    assert.equal(engine.snapshot().seeds[0].resolvedDeviceId, null);
    assert.equal(engine.snapshot().seeds[0].outcome.status, "denied");
    permit = true;
    await engine.reconcile();
    await engine.whenIdle();
    const snapshot = engine.snapshot();
    assert.equal(snapshot.devices.length, 1);
    assert.equal(snapshot.devices[0].endpointReference.address, h.EPR);
    assert.equal(snapshot.devices[0].state, "verified");
    assert.equal(snapshot.seeds[0].resolvedDeviceId, h.endpointIdentity({ address: h.EPR, referenceProperties: [], referenceParameters: [] }));
    assert.equal(snapshot.devices[0].registryEvidence.length, 0);
    h.assertSnapshot(snapshot);
});

test("datagram rate, XML bytes and source segment are enforced before inspection", async (t) => {
    const { engine, datagrams, clock, nativeRead } = setup(t);
    await engine.start(h.options({ allowedXAddrs: [], retransmissions: 1, bounds: { maxDatagramsPerRound: 3, maxDatagramBytes: 2048 } }));
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-device.xml"), { address: "192.0.2.1" }));
    datagrams.deliver("segment-a", h.datagram(" ".repeat(2049)));
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-device.xml")));
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-legacy.xml")));
    await clock.advance(21);
    await engine.whenIdle();
    assert.equal(engine.snapshot().devices.length, 1);
    assert.equal(engine.snapshot().truncated, true);
    for (const code of ["SourceOutsideSegment", "XmlLimit", "DatagramRateLimit"]) {
        assert.ok(engine.snapshot().diagnostics.some((item) => item.code === code), code);
    }
    assert.equal(nativeRead.calls.length, 0);
});

test("required IPv6 failure closes prior owned IPv4 socket; best-effort records unavailability instead of broad binding", async () => {
    for (const ipv6 of ["required", "bestEffort"]) {
        const clock = new h.FixtureClock(1000);
        const datagrams = new h.FixtureDatagramAdapter();
        const nativeRead = new h.FixtureReadAdapter(() => ({ status: "unknown", code: "Fixture", message: "Explicit unused fixture" }));
        const engine = h.createDiscoveryEngine({ datagrams, nativeRead, clock, persistence: new h.MemoryPersistence() });
        datagrams.openFailures.set("segment-v6", new OnvifError("UnsupportedCapability", "No attested IPv6 confinement"));
        const options = h.options({ ipv6, allowedXAddrs: [], retransmissions: 1 });
        options.interfaces.push({ id: "v6", address: "fe80::1234", family: "IPv6", zone: "17" });
        options.segments.push({ id: "segment-v6", interfaceId: "v6", cidr: "fe80::/64",
            destination: { address: "ff02::c", port: 3702 }, listenPort: 3702, multicast: true });
        if (ipv6 === "required") {
            await assert.rejects(engine.start(options), { code: "UnsupportedCapability" });
            assert.equal(datagrams.openChannels, 0);
            assert.equal(nativeRead.closed, true);
        } else {
            await engine.start(options);
            assert.equal(datagrams.openChannels, 1);
            assert.ok(engine.snapshot().diagnostics.some((item) => item.code === "Ipv6Unavailable"));
        }
        await engine.close();
        assert.equal(clock.pendingTimers, 0);
        assert.equal(datagrams.openChannels, 0);
    }
});

test("request windows stay bounded across a backward wall-clock jump and an unresponsive send adapter", async () => {
    class JumpClock extends h.FixtureClock {
        offset = 0;
        now() { return super.now() + this.offset; }
    }
    const clock = new JumpClock(1000);
    const datagrams = new h.FixtureDatagramAdapter();
    const sends = [];
    datagrams.onSend = () => new Promise((resolve) => sends.push(resolve));
    const engine = h.createDiscoveryEngine({ datagrams, clock, nativeRead: new h.FixtureReadAdapter(() => assert.fail("No reads expected")),
        persistence: new h.MemoryPersistence() });
    await engine.start(h.options({ allowedXAddrs: [], retransmissions: 1, bounds: { maxPendingRequests: 2 } }));
    clock.offset = -100;
    await clock.advance(21);
    await engine.whenIdle();
    assert.equal(sends.length, 2);
    await engine.probe();
    assert.equal(sends.length, 2, "Expired but unsettled sends still occupy the native concurrency budget");
    assert.ok(engine.snapshot().diagnostics.some((item) => item.code === "RequestLimit"));
    const closed = assert.rejects(engine.close(), AggregateError);
    await closed;
    assert.equal(clock.pendingTimers, 0);
    assert.equal(datagrams.openChannels, 0);
    for (const finish of sends) finish();
    await h.flush();
});

test("new device epochs requeue bounded inspection and cannot commit delayed old firmware observations", async (t) => {
    let release;
    let first = true;
    const fixture = nativeFixture(({ reference, data }) => {
        if (reference.operation === "GetDeviceInformation" && first) {
            first = false;
            const old = structuredClone(data.information);
            return new Promise((resolve) => { release = () => resolve({ status: "known", value: old }); });
        }
    });
    const { engine, datagrams, clock } = setup(t, { nativeRead: fixture.adapter });
    await engine.start(h.options({ allowedXAddrs: [...fixture.allowed, h.RESTART_XADDR], retransmissions: 1 }));
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-device.xml")));
    await h.flush();
    assert.equal(typeof release, "function");
    datagrams.deliver("segment-a", h.datagram(h.fixture("hello-restart.xml"), { address: "127.0.0.2" }));
    fixture.data.information.FirmwareVersion = "2.0";
    release();
    await clock.advance(21);
    await engine.whenIdle();
    const device = engine.snapshot().devices[0];
    assert.equal(device.epoch, 2);
    assert.equal(device.state, "verified");
    assert.equal(device.information.value.firmwareVersion, "2.0");
    assert.equal(fixture.adapter.calls.filter((call) => h.readonlyContract(call.key).reference.operation === "GetDeviceInformation").length, 2);
    assert.ok(engine.snapshot().diagnostics.some((item) => item.code === "SupersededInspection"));
});
