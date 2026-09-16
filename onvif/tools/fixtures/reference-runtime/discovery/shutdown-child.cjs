const dgram = require("node:dgram");
const { once } = require("node:events");
const h = require("../../../tests/reference-runtime/discovery/helpers.cjs");

class CountingClock extends h.NodeClock {
    handles = new Set();
    setTimeout(callback, delay) {
        const handle = super.setTimeout(() => { this.handles.delete(handle); callback(); }, delay);
        this.handles.add(handle);
        return handle;
    }
    clearTimeout(handle) { this.handles.delete(handle); super.clearTimeout(handle); }
}

async function main() {
    const clock = new CountingClock();
    const emulator = dgram.createSocket("udp4");
    emulator.bind(0, "127.0.0.1");
    await once(emulator, "listening");
    const received = once(emulator, "message");
    const reads = new h.FixtureReadAdapter(() => { throw new Error("Unapproved device inspection was attempted"); });
    const engine = h.createDiscoveryEngine({
        datagrams: new h.NodeDatagramAdapter(), nativeRead: reads, persistence: new h.MemoryPersistence(), clock
    });
    const options = h.options({ allowedXAddrs: [], timers: { ...h.options().timers, probeWindowMs: 3000, probeIntervalMs: 60000 } });
    options.segments[0].destination.port = emulator.address().port;
    try {
        await engine.start(options);
        await received;
        await engine.close();
    } finally {
        await engine.close();
        await new Promise((resolve) => emulator.close(resolve));
    }
    if (clock.handles.size !== 0 || !reads.closed) throw new Error("Owned discovery timers or read adapter remain open");
    process.stdout.write(JSON.stringify({ closed: true, pendingTimers: clock.handles.size, readAdapterClosed: reads.closed }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
