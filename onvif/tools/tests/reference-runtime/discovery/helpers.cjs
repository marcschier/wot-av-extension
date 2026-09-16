const fs = require("node:fs");
const path = require("node:path");
const { DOMParser } = require("@xmldom/xmldom");
const discovery = require("./.compiled/discovery");

const EPR = "urn:uuid:11111111-1111-4111-8111-111111111111";
const XADDR = "http://127.0.0.1:18080/custom/device?slot=one&view=main";
const RESTART_XADDR = "http://127.0.0.2:18080/new/device?slot=one&view=main";
function fixture(name) {
    return fs.readFileSync(path.join(__dirname, "../../../fixtures/reference-runtime/discovery", name), "utf8");
}
function wire(xml) {
    const errors = [];
    const document = new DOMParser({ errorHandler: {
        warning: (error) => errors.push(error), error: (error) => errors.push(error), fatalError: (error) => errors.push(error)
    } }).parseFromString(Buffer.from(xml).toString("utf8"), "application/xml");
    if (errors.length) throw new Error(errors.join("; "));
    return document;
}
function element(document, namespace, local) {
    const elements = document.getElementsByTagNameNS(namespace, local);
    if (elements.length !== 1) throw new Error(`Expected exactly one independent ${local}`);
    return elements.item(0);
}
function provenance(message, patch = {}) {
    return { interfaceId: "loop-a", segmentId: "segment-a", address: "127.0.0.1", family: "IPv4", port: 3702,
        receivedAt: 1000, messageId: message.messageId, ...patch };
}
function inventory(patch = {}) {
    const clock = new discovery.FixtureClock(1000);
    const bounds = discovery.boundedOptions(patch.bounds);
    const timers = discovery.timerOptions({ refreshMs: 10, staleMs: 30, departureGraceMs: 20, ...patch.timers });
    return { clock, bounds, timers, inventory: new discovery.Inventory(bounds, timers,
        new Set([XADDR, RESTART_XADDR, ...patch.allowed ?? []]), clock) };
}
function known(value, at = 1000) { return { status: "known", value, observedAt: at }; }
function failure(status, at = 1000, code = `Fixture${status}`) {
    return { status, code, message: `Explicit fixture ${status} result`, observedAt: at };
}
function report(endpointReference, at = 1000) {
    return {
        information: known({ manufacturer: "Independent fixture", model: "Mixed native services", firmwareVersion: "1.0",
            serialNumber: "0000007", hardwareId: "0001" }, at),
        services: known([{ namespace: discovery.NAMESPACES.device, xaddr: XADDR, version: { major: 2, minor: 6 },
            capabilities: failure("unknown", at) }], at),
        scopes: known(["onvif://www.onvif.org/Profile/T"], at),
        endpointReference: known(endpointReference, at), reads: [], resources: [], observedFeatures: [],
        identityEvidence: [], completedAt: at, responsive: true, truncated: false
    };
}
function options(patch = {}) {
    return {
        interfaces: [{ id: "loop-a", address: "127.0.0.1", family: "IPv4" }],
        segments: [{ id: "segment-a", interfaceId: "loop-a", cidr: "127.0.0.0/8", destination: { address: "127.0.0.1", port: 19002 },
            listenPort: 0, multicast: false }],
        allowedXAddrs: [XADDR, RESTART_XADDR],
        retransmissions: 3,
        timers: { probeWindowMs: 20, probeIntervalMs: 1000, retransmitMinMs: 1, retransmitMaxMs: 2,
            readTimeoutMs: 20, inspectionTimeoutMs: 100, refreshMs: 100, staleMs: 200, departureGraceMs: 40 },
        ...patch
    };
}
function datagram(xml, patch = {}) {
    return { data: Buffer.from(xml), address: "127.0.0.1", port: 3702, family: "IPv4", ...patch };
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }

module.exports = { ...discovery, EPR, XADDR, RESTART_XADDR, fixture, wire, element, provenance, inventory, known, failure, report, options, datagram, flush };
