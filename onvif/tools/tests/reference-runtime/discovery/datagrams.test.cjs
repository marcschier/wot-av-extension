const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const dgram = require("node:dgram");
const { once } = require("node:events");
const h = require("./helpers.cjs");

class SocketFixture extends EventEmitter {
    calls = [];
    bind(options) { this.calls.push(["bind", options]); queueMicrotask(() => this.emit("listening")); }
    setMulticastInterface(value) { this.calls.push(["interface", value]); }
    setMulticastTTL(value) { this.calls.push(["ttl", value]); }
    setMulticastLoopback(value) { this.calls.push(["loopback", value]); }
    addMembership(...args) { this.calls.push(["membership", ...args]); }
    send(...args) { this.calls.push(["send", ...args.slice(0, 3)]); queueMicrotask(() => args.at(-1)(null)); }
    close(callback) { this.calls.push(["close"]); queueMicrotask(callback); }
}

test("real Node adapter binds the configured unicast address, not INADDR_ANY; sockets are only created at open", async () => {
    const socket = new SocketFixture();
    let created = 0;
    const adapter = new h.NodeDatagramAdapter({
        interfaces: () => ({ Loopback: [{ address: "127.0.0.1", family: "IPv4" }] }),
        socketFactory: () => { created++; return socket; }
    });
    assert.equal(created, 0);
    const options = h.options();
    const channel = await adapter.open(options.interfaces[0], options.segments[0], () => {}, () => {});
    assert.equal(created, 1);
    assert.deepEqual(socket.calls[0], ["bind", { address: "127.0.0.1", port: 0, exclusive: true }]);
    await assert.rejects(channel.send(Buffer.from("not sent"), { address: "127.0.0.2", port: 19002 }), { code: "PolicyDenied" });
    await channel.send(Buffer.from("probe"), options.segments[0].destination);
    await channel.close();
    await channel.close();
    assert.equal(socket.calls.filter(([kind]) => kind === "close").length, 1);
});

test("IPv6 uses current numeric Node zone, rejects stale zones/unknown Windows confinement before opening any socket", async () => {
    const local = { id: "nic-v6", address: "fe80::1234", family: "IPv6", zone: "17" };
    const segment = { id: "seg-v6", interfaceId: local.id, cidr: "fe80::/64", destination: { address: "ff02::c", port: 3702 }, listenPort: 3702, multicast: true };
    const interfaces = () => ({ NIC: [{ address: local.address, family: "IPv6", scopeid: 17 }] });
    let created = 0;
    const sockets = [];
    const settings = { interfaces, platform: "win32", nodeVersion: "24.21.0", socketFactory: () => {
        created++;
        const socket = new SocketFixture();
        sockets.push(socket);
        return socket;
    } };
    await assert.rejects(new h.NodeDatagramAdapter(settings).open(local, segment, () => {}, () => {}), { code: "UnsupportedCapability" });
    assert.equal(created, 0);
    const attestations = [{ platform: "win32", nodeVersion: "24.21.0", interfaceId: local.id, address: local.address, scopeId: 17,
        evidence: "Independent deployment join/send/receive/wrong-interface qualification (fixture attestation only)" }];
    const adapter = new h.NodeDatagramAdapter({ ...settings, ipv6Attestations: attestations });
    await assert.rejects(adapter.open({ ...local, zone: "9" }, segment, () => {}, () => {}), { code: "UnsupportedCapability" });
    assert.equal(created, 0);
    const channel = await adapter.open(local, segment, () => {}, () => {});
    await channel.send(Buffer.from("probe"), segment.destination);
    assert.equal(sockets.length, 2, "Unicast ProbeMatches and multicast Hello/Bye require separate bound receive paths");
    assert.deepEqual(sockets[0].calls.find(([kind]) => kind === "bind")[1], { address: "fe80::1234%17", port: 0, exclusive: true });
    assert.deepEqual(sockets[1].calls.find(([kind]) => kind === "bind")[1], { address: "ff02::c%17", port: 3702, exclusive: true });
    assert.deepEqual(sockets[0].calls.find(([kind]) => kind === "interface"), ["interface", "::%17"]);
    assert.deepEqual(sockets[1].calls.find(([kind]) => kind === "membership"), ["membership", "ff02::c", "::%17"]);
    assert.equal(sockets[0].calls.find(([kind]) => kind === "send")[3], "ff02::c%17");
    await channel.close();
    assert.ok(sockets.every((socket) => socket.calls.filter(([kind]) => kind === "close").length === 1));
});

test("IPv4 multicast separates group-bound unsolicited reception from interface-bound requests and never binds all addresses", async () => {
    const sockets = [];
    const received = [];
    const adapter = new h.NodeDatagramAdapter({
        interfaces: () => ({ FixtureNIC: [{ address: "192.0.2.10", family: "IPv4" }] }),
        socketFactory: () => { const socket = new SocketFixture(); sockets.push(socket); return socket; }
    });
    const channel = await adapter.open({ id: "fixture", address: "192.0.2.10", family: "IPv4" },
        { id: "segment", interfaceId: "fixture", cidr: "192.0.2.0/24",
            destination: { address: "239.255.255.250", port: 3702 }, listenPort: 3702, multicast: true },
        (data) => received.push(data), (error) => assert.fail(error));
    assert.deepEqual(sockets.map((socket) => socket.calls.find(([kind]) => kind === "bind")[1].address), ["192.0.2.10", "239.255.255.250"]);
    assert.deepEqual(sockets[1].calls.find(([kind]) => kind === "membership"), ["membership", "239.255.255.250", "192.0.2.10"]);
    sockets[1].emit("message", Buffer.from(h.fixture("hello-device.xml")), { address: "192.0.2.20", family: "IPv4", port: 3702 });
    sockets[0].emit("message", Buffer.from(h.fixture("probe-device.xml")), { address: "192.0.2.20", family: "IPv4", port: 3702 });
    assert.equal(received.length, 2);
    await channel.close();
    assert.ok(sockets.every((socket) => socket.calls.filter(([kind]) => kind === "close").length === 1));
});

test("an unsupported multicast group bind fails closed and cleans both sockets without wildcard fallback", async () => {
    const sockets = [];
    const adapter = new h.NodeDatagramAdapter({
        interfaces: () => ({ FixtureNIC: [{ address: "192.0.2.10", family: "IPv4" }] }),
        socketFactory: () => {
            const socket = new SocketFixture();
            if (sockets.length === 1) socket.bind = (options) => {
                socket.calls.push(["bind", options]);
                queueMicrotask(() => socket.emit("error", Object.assign(new Error("Group bind unavailable"), { code: "EADDRNOTAVAIL" })));
            };
            sockets.push(socket);
            return socket;
        }
    });
    await assert.rejects(adapter.open({ id: "fixture", address: "192.0.2.10", family: "IPv4" },
        { id: "segment", interfaceId: "fixture", cidr: "192.0.2.0/24",
            destination: { address: "239.255.255.250", port: 3702 }, listenPort: 3702, multicast: true },
        () => {}, () => {}), { code: "UnsupportedCapability" });
    assert.ok(sockets.every((socket) => socket.calls.filter(([kind]) => kind === "close").length === 1));
    assert.ok(sockets.every((socket) => !socket.calls.some(([kind, options]) => kind === "bind" && options.address === "0.0.0.0")));
});

test("owned real UDP loopback emulator returns correlated April 2005 datagrams; engine shuts down its socket and timers", { timeout: 10000 }, async (t) => {
    const emulator = dgram.createSocket("udp4");
    emulator.bind(0, "127.0.0.1");
    await once(emulator, "listening");
    t.after(() => new Promise((resolve) => emulator.close(resolve)));
    const messages = [];
    emulator.on("message", (buffer, remote) => {
        assert.equal(remote.address, "127.0.0.1");
        const document = h.wire(buffer);
        const id = h.element(document, h.ADDRESSING, "MessageID").textContent;
        const type = h.element(document, h.DISCOVERY, "Types").textContent;
        messages.push({ id, type, port: remote.port });
        if (type === "tds:Device") emulator.send(Buffer.from(h.fixture("probe-device.xml").replace("urn:uuid:probe-general", id)), remote.port, remote.address);
    });
    const reads = new h.FixtureReadAdapter(() => assert.fail("Unapproved native endpoint must not be contacted"));
    const engine = h.createDiscoveryEngine({
        datagrams: new h.NodeDatagramAdapter(), nativeRead: reads, persistence: new h.MemoryPersistence()
    });
    t.after(() => engine.close());
    const options = h.options({ allowedXAddrs: [], timers: { ...h.options().timers, probeWindowMs: 200, probeIntervalMs: 1000 } });
    options.segments[0].destination.port = emulator.address().port;
    await engine.start(options);
    await engine.whenIdle();
    assert.equal(engine.snapshot().devices.length, 1);
    assert.equal(engine.snapshot().devices[0].endpointReference.address, h.EPR);
    assert.equal(messages.length, 6);
    assert.equal(new Set(messages.map((item) => item.id)).size, 2);
    assert.equal(new Set(messages.map((item) => item.port)).size, 1, "One explicitly bound owned discovery socket");
    await engine.close();
    assert.equal(reads.closed, true);
});
