const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");
const { defineOperationRegistry, operationKey } = require("./.compiled/binding/registry");
const fixtures = require("../fixtures/operations.cjs");
const wire = require("../fixtures/endpoint.cjs");

const sourceOperation = fixtures.operations.find((operation) => operation.operation === "GetDeviceInformation"
    && operation.bindingQName.namespace === "http://www.onvif.org/ver10/device/wsdl");
const key = operationKey(sourceOperation);

test("RuntimeReadAdapter invokes a real node-wot ConsumedThing against an independent native SOAP endpoint, with exact path/query", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        assert.equal(request.url, "/native/device/control?unit=01&view=raw");
        wire.verifyInformation(request, body);
        wire.reply(response);
    });
    t.after(() => server.close());
    const target = {
        xaddr: `${server.origin}/native/device/control?unit=01&view=raw`,
        endpointReference: { address: h.EPR, referenceProperties: [], referenceParameters: [] },
        interfaceId: "loop-a", segmentId: "segment-a"
    };
    const registry = defineOperationRegistry([sourceOperation]);
    const adapter = new h.RuntimeReadAdapter({
        runtimeOptions: () => ({ registry, trust: { allowedOrigins: [server.origin] } }),
        security: () => ({ security: ["nosec_sc"], securityDefinitions: { nosec_sc: { scheme: "nosec" } } })
    });
    const inspector = new h.ReadonlyInspector(adapter, new h.NodeClock(), h.boundedOptions(), h.timerOptions(), new Set([target.xaddr]));
    t.after(() => inspector.close());
    const result = await inspector.executeReadonly(key, {}, target, new AbortController().signal);
    assert.equal(result.status, "known");
    assert.deepEqual(result.value, { Manufacturer: "Independent & Co", Model: "Gate fixture", FirmwareVersion: "0.01",
        SerialNumber: "000000001", HardwareId: "0000" });
    assert.equal(server.requests.length, 1);
    const denied = await inspector.executeReadonly(key, {}, { ...target, xaddr: `${server.origin}/native/device/control` }, new AbortController().signal);
    assert.equal(denied.status, "denied");
    assert.equal(server.requests.length, 1, "Same origin but unapproved exact resource never reaches native credentials/HTTP");
    await inspector.close();
    assert.equal(inspector.pendingReads, 0);
});

test("read integration rejects writable registry classifications and EPR reference headers the current native runtime cannot carry", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint(() => assert.fail("Guarded read must not be transmitted"));
    t.after(() => server.close());
    const target = { xaddr: server.url, endpointReference: null, interfaceId: "loop-a", segmentId: "segment-a" };
    const security = () => ({ security: ["none"], securityDefinitions: { none: { scheme: "nosec" } } });
    const guarded = new h.RuntimeReadAdapter({
        runtimeOptions: () => ({ registry: defineOperationRegistry([{ ...sourceOperation, access: "write" }]),
            trust: { allowedOrigins: [server.origin] } }), security
    });
    t.after(() => guarded.close());
    const request = { signal: new AbortController().signal, timeoutMs: 500, maxBytes: 32768 };
    await assert.rejects(guarded.executeReadonly(key, {}, target, request), { code: "PolicyDenied" });
    for (const change of [
        { soapAction: `${wire.DEVICE}/SystemReboot`, addressingAction: `${wire.DEVICE}/SystemReboot` },
        { request: { ...sourceOperation.request, name: { namespace: wire.DEVICE, localName: "SystemReboot" } } },
        { response: { ...sourceOperation.response, name: { namespace: wire.DEVICE, localName: "SystemRebootResponse" } } }
    ]) {
        const disguised = new h.RuntimeReadAdapter({
            runtimeOptions: () => ({ registry: defineOperationRegistry([{ ...sourceOperation, ...change }]),
                trust: { allowedOrigins: [server.origin] } }), security
        });
        t.after(() => disguised.close());
        await assert.rejects(disguised.executeReadonly(key, {}, target, request), { code: "PolicyDenied" });
    }
    const adapter = new h.RuntimeReadAdapter({
        runtimeOptions: () => ({ registry: defineOperationRegistry([sourceOperation]), trust: { allowedOrigins: [server.origin] } }), security
    });
    t.after(() => adapter.close());
    const reference = h.parseDiscovery(h.fixture("reference-properties.xml")).matches[0].endpointReference;
    const result = await adapter.executeReadonly(key, {}, { ...target, endpointReference: reference }, request);
    assert.equal(result.status, "unsupported");
    assert.equal(result.code, "AddressedReadHeaders");
    assert.equal(server.requests.length, 0);
});
