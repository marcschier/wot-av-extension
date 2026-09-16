const test = require("node:test");
const assert = require("node:assert/strict");
const { Servient, ConsumedThing } = require("@node-wot/core");
const { createOnvifRuntime, defineOperationRegistry, decodeElement, parseXml } = require("../../../../samples/reference-runtime/dist");
const fixtures = require("../../../fixtures/reference-runtime/operations.cjs");
const wire = require("../../../fixtures/reference-runtime/endpoint.cjs");

test("gate: real node-wot consume/invoke sends empty native SOAP 1.2 while ordinary HTTP works", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        if (request.url === "/directory/things") {
            assert.equal(request.method, "GET");
            assert.equal(request.headers.authorization, undefined);
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end('[{"id":"urn:independent:directory:entry","serial":"0007"}]');
        } else {
            wire.verifyInformation(request, body);
            wire.reply(response);
        }
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations),
        trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => runtime.close());
    const description = fixtures.td(server.url, {
        properties: {
            directory: { type: "array", readOnly: true,
                forms: [{ href: `${server.origin}/directory/things`, contentType: "application/json", op: "readproperty" }] }
        }
    });
    const original = JSON.stringify(description);
    const registrations = [];
    const addFactory = Servient.prototype.addClientFactory;
    Servient.prototype.addClientFactory = function (factory) {
        registrations.push(factory.scheme);
        return addFactory.call(this, factory);
    };
    let thing;
    try {
        thing = await runtime.consume(description);
    } finally {
        Servient.prototype.addClientFactory = addFactory;
    }
    assert.ok(thing instanceof ConsumedThing, "The public object is the released node-wot ConsumedThing");
    assert.deepEqual(registrations.sort(), ["http", "https"], "Only one multiplex factory per scheme");
    const [result, directory] = await Promise.all([
        thing.invokeAction("information").then((output) => output.value()),
        thing.readProperty("directory").then((output) => output.value())
    ]);
    assert.deepEqual(result, {
        Manufacturer: "Independent & Co", Model: "Gate fixture", FirmwareVersion: "0.01",
        SerialNumber: "000000001", HardwareId: "0000"
    });
    assert.deepEqual(directory, [{ id: "urn:independent:directory:entry", serial: "0007" }]);
    assert.equal(JSON.stringify(description), original, "Do not mutate the source TD");
    assert.equal(server.requests.length, 2);
});

test("gate: native operation selection uses binding and portType, not local operation name", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        if (request.headers["content-type"].includes("urn:wot-av:test:collision:information")) {
            wire.verifySoap(request, body, "urn:wot-av:test:collision:information",
                wire.DEVICE, "GetDeviceInformation");
            wire.reply(response, '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><Information xmlns="urn:wot-av:test:collision">000099</Information></s:Body></s:Envelope>');
        } else {
            wire.verifyInformation(request, body);
            wire.reply(response);
        }
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => runtime.close());
    const thing = await runtime.consume(fixtures.td(server.url));
    assert.equal(await (await thing.invokeAction("collision")).value(), "000099");
    assert.equal((await (await thing.invokeAction("information")).value()).SerialNumber, "000000001");
});

test("gate: typed input travels through the node-wot codec to independently checked XML", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        const { root } = wire.verifySoap(request, body, "urn:wot-av:test:mapping:roundtrip",
            "urn:wot-av:test:mapping", "Sample");
        assert.deepEqual(wire.infoset(root), wire.infoset(wire.parseWire(wire.mapping)));
        wire.reply(response, `<s:Envelope xmlns:s="${wire.SOAP}"><s:Body>${wire.mapping}</s:Body></s:Envelope>`);
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => runtime.close());
    const thing = await runtime.consume(fixtures.td(server.url));
    const input = decodeElement(fixtures.mappingElement, parseXml(wire.mapping));
    const result = await (await thing.invokeAction("roundTrip", input)).value();
    assert.equal(result.Count, "18446744073709551615");
    assert.equal(result.Price, "12345678901234567890.0012300");
    assert.deepEqual(result.Choices, input.Choices);
    assert.equal(result.$extensions[0].children[0].value, "before");
    await assert.rejects(thing.invokeAction("roundTrip", { ...input, Count: "18446744073709551616" }));
    assert.equal(server.requests.length, 1, "Invalid values fail before the network");
});

test("gate: SOAP fault keeps nested native subcodes, multilingual reasons, detail and certainty", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        wire.verifySoap(request, body, "urn:wot-av:test:change", "urn:wot-av:test:mapping", "Change");
        wire.reply(response, wire.fault, 500);
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => runtime.close());
    const thing = await runtime.consume(fixtures.td(server.url));
    await assert.rejects(thing.invokeAction("change", { Value: "0000" }), (error) => {
        assert.equal(error.code, "SoapFault");
        assert.equal(error.status, 500);
        assert.deepEqual(error.operation, fixtures.reference(fixtures.write));
        assert.equal(error.execution, "rejected");
        assert.deepEqual(error.fault.code, fixtures.q(wire.SOAP, "Sender"));
        assert.deepEqual(error.fault.subcodes, [
            fixtures.q("http://www.onvif.org/ver10/error", "InvalidArgVal"),
            fixtures.q("http://www.onvif.org/ver10/error", "NoEntity")
        ]);
        assert.deepEqual(error.fault.reasons, [
            { language: "en", text: "Fixture rejected token" }, { language: "de", text: "Token fehlt" }
        ]);
        assert.equal(error.fault.detail.children.filter((x) => x.kind === "element")[0].attributes[0].value, "0000");
        return true;
    });
    assert.equal(server.requests.length, 1);
});

test("gate: lost write response is OutcomeUnknown and is never automatically replayed", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        wire.verifySoap(request, body, "urn:wot-av:test:change", "urn:wot-av:test:mapping", "Change");
        request.socket.destroy();
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] },
        timeoutMs: 2000
    });
    t.after(() => runtime.close());
    const thing = await runtime.consume(fixtures.td(server.url));
    await assert.rejects(thing.invokeAction("change", { Value: "sent-once" }),
        { code: "OutcomeUnknown", execution: "unknown" });
    assert.equal(server.requests.length, 1);
});

test("gate: annotated unsupported capabilities, media encodings and mismatched action metadata fail closed", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint(() => assert.fail("Unsupported path must not contact the endpoint"));
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] }
    });

    t.after(() => runtime.close());
    for (const patch of [
        { "onvif:binding": "unsupported-v2" },
        { "onvif:soapAction": "urn:not-the-registry-action" },
        { contentCoding: "gzip" },
        { contentType: "multipart/related" },
        { "htv:methodName": "GET" }
    ]) {
        const description = fixtures.td(server.url);
        Object.assign(description.actions.information.forms[0], patch);
        await assert.rejects(runtime.consume(description));
    }
    const description = fixtures.td(server.url);
    description.events = { native: { forms: [{
        ...fixtures.form(server.url, fixtures.createSubscription), op: "subscribeevent"
    }] } };
    await assert.rejects(runtime.consume(description), { code: "UnsupportedCapability" });
    assert.equal(server.requests.length, 0);
});

test("gate: SOAP response charset and mandatory unknown headers cannot be silently ignored", { timeout: 15000 }, async (t) => {
    const server = await wire.endpoint((request, response, body) => {
        wire.verifyInformation(request, body);
        if (request.url.endsWith("charset")) {
            response.writeHead(200, { "Content-Type": "application/soap+xml; charset=iso-8859-1" });
            response.end(wire.information);
        } else {
            wire.reply(response, wire.information.replace("<env:Body>",
                '<env:Header><vendor:Required xmlns:vendor="urn:unknown" env:mustUnderstand="true"/></env:Header><env:Body>'));
        }
    });
    t.after(() => server.close());
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations), trust: { allowedOrigins: [server.origin] }
    });
    t.after(() => runtime.close());
    const description = fixtures.td(`${server.url}?charset`);
    description.actions.information.forms.push(fixtures.form(`${server.url}?header`, fixtures.device));
    const thing = await runtime.consume(description);
    for (const formIndex of [0, 1]) {
        await assert.rejects(thing.invokeAction("information", undefined, { formIndex }),
            { code: "UnsupportedCapability", execution: "unknown" });
    }
});
