const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { createOnvifRuntime } = require("./.compiled/binding/runtime");
const { readEndpointReference } = require("./.compiled/binding/soap");
const { decodeElement, encodeElement } = require("./.compiled/xml/mapper");
const { parseXml, serializeXml } = require("./.compiled/xml/parser");
const { actionTemplate, context } = require("./.compiled/catalog/models");
const { safeReadAliases } = require("./.compiled/catalog/mappings");
const { dom, infoset } = require("./source-helpers.cjs");
const f = require("./native-fixture.cjs");
const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const SEARCH = "http://www.onvif.org/ver10/search/wsdl";
const WSA4 = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
function td(href, operations = { info: f.operation(DEVICE, "GetDeviceInformation") }) {
    return { "@context": context(), id: "urn:independent:addressed-device", title: "Independent native protocol",
        securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"],
        actions: Object.fromEntries(Object.entries(operations).map(([name, operation]) =>
            [name, actionTemplate(operation, f.catalog, href)])) };
}
async function runtimeFor(t, server, extra = {}) {
    const runtime = await createOnvifRuntime({ registry: f.registry, trust: { allowedOrigins: [server.origin] }, ...extra });
    t.after(async () => { try { await runtime.close(); } finally { await server.close(); } });
    return runtime;
}

test("native protocol: WSA2004 addressed node-wot invocation preserves logical To, both EPR header lists and exact target query", { timeout: 10000 }, async (t) => {
    const server = await f.endpoint((request, response, body) => {
        const xml = f.parseWire(body);
        assert.equal(request.url, "/read?principal=alice&token=A%2BB%2F");
        assert.equal(f.one(xml, WSA4, "Action").textContent, `${DEVICE}/GetDeviceInformation`);
        assert.equal(f.one(xml, WSA4, "To").textContent, "urn:independent:addressed-device");
        assert.equal(f.one(xml, WSA4, "ReplyTo").textContent, `${WSA4}/role/anonymous`);
        assert.equal(xml.getElementsByTagNameNS(f.WSA, "Action").length, 0);
        for (const [name, value] of [["Property", "0001"], ["Parameter", "0002"]]) {
            const header = f.one(xml, "urn:independent:headers", name);
            assert.equal(header.parentNode.localName, "Header");
            assert.equal(header.textContent, value);
            assert.equal(header.hasAttributeNS(f.WSA, "IsReferenceParameter"), false);
            assert.equal(header.getAttributeNS("urn:independent:scope", "kind"), "q:Gate");
            assert.equal(header.lookupNamespaceURI("q"), "urn:independent:scope");
        }
        assert.equal(f.one(xml, "urn:independent:custom", "Trace").textContent, "bounded");
        assert.equal(f.one(xml, DEVICE, "GetDeviceInformation").textContent, "");
        f.reply(response, f.information);
    });
    const base = `${server.origin}/service`, target = `${server.origin}/read?principal=alice&token=A%2BB%2F`;
    const runtime = await runtimeFor(t, server, { trust: { allowedOrigins: [server.origin], allowedTargets: [base, target],
        principalTargets: { alice: [base, target], bob: [base] } } });
    const epr = readEndpointReference(parseXml(`<a:EndpointReference xmlns:a="${WSA4}">
<a:Address>urn:independent:addressed-device</a:Address>
<a:ReferenceProperties><p:Property xmlns:p="urn:independent:headers" xmlns:q="urn:independent:scope" q:kind="q:Gate">0001</p:Property></a:ReferenceProperties>
<a:ReferenceParameters><p:Parameter xmlns:p="urn:independent:headers" xmlns:q="urn:independent:scope" q:kind="q:Gate">0002</p:Parameter></a:ReferenceParameters>
</a:EndpointReference>`));
    const alice = await runtime.consume(td(base), { principal: "alice" });
    const options = { target, addressing: { namespace: epr.addressingNamespace, to: epr.address,
        referenceProperties: epr.referenceProperties, referenceParameters: epr.referenceParameters },
    headers: { "{urn:independent:custom}Trace": parseXml('<v:Trace xmlns:v="urn:independent:custom">bounded</v:Trace>') },
    timeoutMs: 500, maxResponseBytes: 4096 };
    const result = await runtime.invokeAction(alice, "info", undefined, options);
    assert.equal((await result.value()).SerialNumber, "000000001");
    const bob = await runtime.consume(td(base), { principal: "bob" });
    await assert.rejects(runtime.invokeAction(bob, "info", undefined, options), { code: "PolicyDenied" });
    await assert.rejects(runtime.execute(alice, "info", {}, { ...options, target: target + "x" }), { code: "PolicyDenied" });
    await assert.rejects(runtime.execute(alice, "info", {}, { ...options,
        addressing: { ...options.addressing, namespace: f.WSA } }), { code: "InvalidValue" });
    assert.equal(server.requests.length, 1);
});

test("native protocol: concurrent addressed invocations keep their own header and principal context", { timeout: 10000 }, async (t) => {
    const observed = [];
    const server = await f.endpoint(async (request, response, body) => {
        const xml = f.parseWire(body), account = new URL(request.url, "http://fixture.invalid").searchParams.get("account");
        observed.push([account, f.one(xml, "urn:independent:custom", "Principal").textContent]);
        assert.equal(f.one(xml, f.WSA, "To").textContent, `urn:independent:${account}`);
        await delay(account === "alice" ? 20 : 2);
        f.reply(response, f.information);
    });
    const base = `${server.origin}/read`, a = `${base}?account=alice`, b = `${base}?account=bob`;
    const runtime = await runtimeFor(t, server, { trust: { allowedOrigins: [server.origin],
        principalTargets: { alice: [base, a], bob: [base, b] } } });
    const invoke = async (principal, target) => {
        const thing = await runtime.consume({ ...td(base), id: `urn:independent:${principal}` }, { principal });
        return (await runtime.invokeAction(thing, "info", undefined, { target, addressing: { to: `urn:independent:${principal}` },
            headers: { "{urn:independent:custom}Principal": parseXml(`<c:Principal xmlns:c="urn:independent:custom">${principal}</c:Principal>`) } })).value();
    };
    const results = await Promise.all([invoke("alice", a), invoke("bob", b)]);
    assert.deepEqual(observed.sort(), [["alice", "alice"], ["bob", "bob"]]);
    assert.ok(results.every((value) => value.HardwareId === "0000"));
});

test("native protocol: reserved or mismatched expanded-QName SOAP headers fail before network", { timeout: 10000 }, async (t) => {
    const server = await f.endpoint(() => assert.fail("Untrusted header must not send"));
    const runtime = await runtimeFor(t, server), thing = await runtime.consume(td(server.url));
    for (const options of [
        { headers: { "{urn:wrong}Trace": parseXml('<Trace xmlns="urn:actual"/>') } },
        { headers: { [`{${f.WSA}}To`]: parseXml(`<a:To xmlns:a="${f.WSA}">http://127.0.0.1/other</a:To>`) } },
        { addressing: { referenceParameters: [parseXml(`<s:Security xmlns:s="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"/>`)] } },
        { principal: "someone-else" }, { maxResponseBytes: 0 }
    ]) await assert.rejects(runtime.execute(thing, "info", {}, options));
    assert.equal(server.requests.length, 0);
});

test("native protocol: response byte bound and cancellation are enforced before and after send", { timeout: 10000 }, async (t) => {
    const pending = f.deferred();
    const server = await f.endpoint((request, response, body) => {
        f.verifyInformation(request, body);
        if (request.url.endsWith("wait")) { pending.resolve(); return; }
        f.reply(response, f.information);
    });
    const runtime = await runtimeFor(t, server), thing = await runtime.consume(td(server.url));
    const pre = new AbortController(); pre.abort();
    await assert.rejects(runtime.invokeAction(thing, "info", undefined, { signal: pre.signal }), { code: "TransportError", execution: "not-sent" });
    assert.equal(server.requests.length, 0);
    await assert.rejects(runtime.execute(thing, "info", {}, { maxResponseBytes: 64 }), { code: "XmlLimit", execution: "unknown" });
    const abort = new AbortController();
    const request = runtime.invokeAction(thing, "info", undefined, { target: `${server.url}?wait`, signal: abort.signal, timeoutMs: 1000 });
    const rejected = assert.rejects(request, { code: "OutcomeUnknown", execution: "unknown" });
    await pending.promise; abort.abort(); await rejected;
    assert.equal(server.requests.length, 2);
});

test("native protocol: credential lookup is bounded by the same native invocation deadline and cannot send later", { timeout: 10000 }, async (t) => {
    const server = await f.endpoint((request, response) => f.reply(response, f.information));
    const runtime = await runtimeFor(t, server, { credentials: async (scope) => {
        await delay(120);
        return { origin: server.origin, principal: scope.principal,
            material: { kind: "password", username: "fixture", password: "fixture" } };
    } });
    const description = td(server.url);
    description.securityDefinitions.wsse = { scheme: "onvif:UsernameTokenSecurityScheme" };
    description.security = ["wsse"];
    const thing = await runtime.consume(description);
    await assert.rejects(runtime.invokeAction(thing, "info", undefined, { timeoutMs: 25 }), { code: "TransportError", execution: "not-sent" });
    await delay(150);
    assert.equal(server.requests.length, 0);
});

test("native protocol: Digest challenge and authenticated request share one deadline without replay", { timeout: 10000 }, async (t) => {
    const server = await f.endpoint(async (request, response) => {
        await delay(70);
        if (!request.headers.authorization) {
            response.writeHead(401, { "WWW-Authenticate": 'Digest realm="bounded",nonce="fixture",algorithm=SHA-256,qop="auth"' });
            response.end();
        } else {
            assert.match(request.headers.authorization, /^Digest /);
            f.reply(response, f.information);
        }
    });
    const runtime = await runtimeFor(t, server, { credentials: async (scope) => ({
        origin: server.origin, principal: scope.principal, realm: scope.realm,
        material: { kind: "password", username: "fixture", password: "fixture" }
    }) });
    const description = td(server.url);
    description.securityDefinitions.digest = { scheme: "digest" };
    description.security = ["digest"];
    const thing = await runtime.consume(description);
    await assert.rejects(runtime.execute(thing, "info", {}, { timeoutMs: 110 }), { code: "OutcomeUnknown", execution: "unknown" });
    assert.equal(server.requests.length, 2);
});

for (const status of [202, 204]) {
    test(`native protocol: actual one-way Notify accepts HTTP ${status} with no response body or JSON`, { timeout: 10000 }, async (t) => {
        const notify = f.operation(f.E, "Notify", "NotificationConsumerBinding");
        const server = await f.endpoint((request, response, body) => {
            f.verifySoap(request, body, `${f.BW}/NotificationConsumer/Notify`, f.N, "Notify");
            response.writeHead(status); response.end();
        });
        const runtime = await runtimeFor(t, server);
        const description = td(server.url, { notify });
        assert.equal(Object.hasOwn(description.actions.notify, "output"), false);
        const thing = await runtime.consume(description);
        const input = decodeElement(notify.request, parseXml(`<n:Notify xmlns:n="${f.N}">${f.notification()}</n:Notify>`), f.registry.xml);
        assert.equal(await (await thing.invokeAction("notify", input)).value(), undefined);
        const result = await runtime.execute(thing, "notify", input);
        assert.deepEqual(result, { value: undefined, xml: undefined, status, outcome: "accepted-one-way" });
        assert.equal(server.requests.length, 2);
        assert.equal(notify.execution.mode, "one-way");
    });
}

test("native protocol: one-way unknown HTTP and invented payloads remain errors, not accepted successes", { timeout: 10000 }, async (t) => {
    const notify = f.operation(f.E, "Notify", "NotificationConsumerBinding");
    const server = await f.endpoint((request, response) => {
        if (request.url.endsWith("payload")) f.reply(response, f.envelope(`<n:NotifyResponse xmlns:n="${f.N}"/>`), 202);
        else { response.writeHead(request.url.endsWith("200") ? 200 : 500); response.end(); }
    });
    const runtime = await runtimeFor(t, server), thing = await runtime.consume(td(server.url, { notify }));
    const input = decodeElement(notify.request, parseXml(`<n:Notify xmlns:n="${f.N}">${f.notification()}</n:Notify>`), f.registry.xml);
    for (const suffix of ["payload", "200", "500"]) {
        await assert.rejects(runtime.execute(thing, "notify", input, { target: `${server.url}?${suffix}` }), { execution: "unknown" });
    }
    assert.equal(server.requests.length, 3);
});

test("native protocol: source-declared write timeout is OutcomeUnknown and never automatically replayed", { timeout: 10000 }, async (t) => {
    const set = f.operation(DEVICE, "SetHostname");
    const server = await f.endpoint((request, response, body) => {
        const { root } = f.verifySoap(request, body, `${DEVICE}/SetHostname`, DEVICE, "SetHostname");
        assert.equal(f.one(root, DEVICE, "Name").textContent, "offline-fixture-only");
    });
    const runtime = await runtimeFor(t, server), thing = await runtime.consume(td(server.url, { set }));
    await assert.rejects(runtime.invokeAction(thing, "set", { Name: "offline-fixture-only" }, { timeoutMs: 40 }),
        { code: "OutcomeUnknown", execution: "unknown" });
    assert.equal(server.requests.length, 1);
});

test("native protocol: Profile G recording search drains distinct native batches and preserves native search faults", { timeout: 10000 }, async (t) => {
    let token, drained = 0, ended = false;
    const recording = (value) => `<tt:RecordingInformation><tt:RecordingToken>${value}</tt:RecordingToken><tt:Source><tt:SourceId>urn:fixture:source</tt:SourceId><tt:Name>offline</tt:Name><tt:Location>fixture</tt:Location><tt:Description>no camera</tt:Description><tt:Address>urn:fixture:offline</tt:Address></tt:Source><tt:Content>fixture</tt:Content><tt:RecordingStatus>Stopped</tt:RecordingStatus></tt:RecordingInformation>`;
    const server = await f.endpoint((request, response, body) => {
        const document = f.parseWire(body), name = f.children(f.one(document, f.SOAP, "Body"))[0].localName;
        const { root } = f.verifySoap(request, body, `${SEARCH}/${name}`, SEARCH, name);
        if (name === "FindRecordings") {
            assert.equal(token, undefined);
            assert.equal(f.one(root, SEARCH, "KeepAliveTime").textContent, "PT10S");
            token = "0000007";
            f.reply(response, f.envelope(`<s:FindRecordingsResponse xmlns:s="${SEARCH}"><s:SearchToken>${token}</s:SearchToken></s:FindRecordingsResponse>`));
        } else {
            assert.equal(f.one(root, SEARCH, "SearchToken").textContent, token);
            if (name === "EndSearch") {
                ended = true;
                f.reply(response, f.envelope(`<s:EndSearchResponse xmlns:s="${SEARCH}"><s:Endpoint>2026-09-16T03:00:00Z</s:Endpoint></s:EndSearchResponse>`));
            } else if (ended) f.reply(response, f.fault("", "NoSearch", "http://www.onvif.org/ver10/error"), 400);
            else {
                assert.equal(name, "GetRecordingSearchResults");
                const n = drained++;
                const batch = n < 2 ? recording(`000${n + 1}`) : "";
                f.reply(response, f.envelope(`<s:GetRecordingSearchResultsResponse xmlns:s="${SEARCH}" xmlns:tt="${f.TT}"><s:ResultList><tt:SearchState>${n < 2 ? "Searching" : "Completed"}</tt:SearchState>${batch}</s:ResultList></s:GetRecordingSearchResultsResponse>`));
            }
        }
    });
    const operations = Object.fromEntries(["FindRecordings", "GetRecordingSearchResults", "EndSearch"].map((name) => [name, f.operation(SEARCH, name)]));
    const runtime = await runtimeFor(t, server), description = td(server.url, operations), thing = await runtime.consume(description);
    assert.equal(operations.GetRecordingSearchResults.access, "stateful");
    assert.equal(description.actions.GetRecordingSearchResults.safe, false);
    assert.ok(safeReadAliases(f.catalog).every((entry) => !/GetRecordingSearchResults/.test(entry.operationId)));
    const found = await (await thing.invokeAction("FindRecordings", { Scope: {}, KeepAliveTime: "PT10S" })).value();
    const batches = [];
    for (let index = 0; index < 3; index++) {
        batches.push(await (await thing.invokeAction("GetRecordingSearchResults", {
            SearchToken: found.SearchToken, MinResults: 0, MaxResults: 1, WaitTime: "PT0S"
        })).value());
    }
    assert.deepEqual(batches.map((batch) => batch.ResultList.RecordingInformation.map((item) => item.RecordingToken)), [["0001"], ["0002"], []]);
    assert.equal(batches[2].ResultList.SearchState, "Completed");
    await thing.invokeAction("EndSearch", { SearchToken: found.SearchToken });
    await assert.rejects(thing.invokeAction("GetRecordingSearchResults", { SearchToken: found.SearchToken }), (error) => {
        assert.equal(error.code, "SoapFault");
        assert.equal(error.execution, "rejected");
        assert.deepEqual(error.fault.subcodes, [{ namespace: "http://www.onvif.org/ver10/error", localName: "NoSearch" }]);
        return true;
    });
    assert.equal(server.requests.length, 6);
});

test("native protocol: Profile A/C/D primitive schemas preserve tokens, lists, booleans and decisions without physical calls", () => {
    const cases = [
        ["http://www.onvif.org/ver10/doorcontrol/wsdl", "GetDoorInfo", '<d:GetDoorInfo xmlns:d="http://www.onvif.org/ver10/doorcontrol/wsdl"><d:Token>0007</d:Token><d:Token>0009</d:Token></d:GetDoorInfo>', { Token: ["0007", "0009"] }],
        ["http://www.onvif.org/ver10/accesscontrol/wsdl", "ExternalAuthorization", '<a:ExternalAuthorization xmlns:a="http://www.onvif.org/ver10/accesscontrol/wsdl"><a:AccessPointToken>0001</a:AccessPointToken><a:CredentialToken>0002</a:CredentialToken><a:Reason>Offline schema-only denial</a:Reason><a:Decision>Denied</a:Decision></a:ExternalAuthorization>', { AccessPointToken: "0001", CredentialToken: "0002", Reason: "Offline schema-only denial", Decision: "Denied" }]
    ];
    for (const [namespace, name, xml, expected] of cases) {
        const operation = f.operation(namespace, name), value = decodeElement(operation.request, parseXml(xml), f.registry.xml);
        assert.deepEqual(value, expected);
        assert.deepEqual(infoset(dom(serializeXml(encodeElement(operation.request, value, f.registry.xml)))), infoset(dom(xml)));
        if (name === "ExternalAuthorization") {
            assert.throws(() => encodeElement(operation.request, { ...value, Decision: true }, f.registry.xml), { code: "InvalidValue" });
            assert.throws(() => encodeElement(operation.request, { ...value, Decision: "Allow" }, f.registry.xml), { code: "InvalidValue" });
        } else {
            assert.throws(() => encodeElement(operation.request, { Token: [7] }, f.registry.xml), { code: "InvalidValue" });
            assert.throws(() => encodeElement(operation.request, { Token: [] }, f.registry.xml), { code: "InvalidValue" });
        }
    }
    const access = require("../catalog/fixtures/native-responses.json").cases.find((entry) => entry.id === "accessrules");
    const op = f.operation(access.serviceNamespace, access.operation), value = decodeElement(op.response, parseXml(access.xml), f.registry.xml);
    assert.equal(typeof value.Capabilities.$attributes.MaxLimit, "number");
    assert.throws(() => decodeElement(op.response, parseXml(access.xml.replace('MaxLimit="10"', 'MaxLimit="0"')), f.registry.xml), { code: "InvalidValue" });
});

test("native protocol: runtime MetadataStream decoder returns the complete ordered canonical block", async () => {
    const runtime = await createOnvifRuntime({ registry: f.registry, trust: { allowedOrigins: ["http://127.0.0.1:49100"] } });
    try {
        const xml = `<tt:MetadataStream xmlns:tt="${f.TT}" xmlns:v="urn:independent:metadata"><tt:VideoAnalytics><tt:Frame UtcTime="2026-09-16T03:00:00.123456789Z"/></tt:VideoAnalytics><v:NativeExtension>first</v:NativeExtension><tt:Event>${f.notification()}</tt:Event><v:NativeExtension>last</v:NativeExtension></tt:MetadataStream>`;
        const block = runtime.decodeMetadata(Buffer.from(xml));
        assert.deepEqual(block.$choice1_1.map((entry) => entry.$case), ["VideoAnalytics", "$any6", "Event", "$any6"]);
        assert.deepEqual(infoset(dom(serializeXml(encodeElement(f.registry.xml.elements[`{${f.TT}}MetadataStream`], block, f.registry.xml)))), infoset(dom(xml)));
        assert.throws(() => runtime.decodeMetadata(xml.replace(' UtcTime="2026-09-16T03:00:00.123456789Z"', "")), { code: "InvalidValue" });
        assert.throws(() => runtime.decodeMetadata("<!DOCTYPE MetadataStream><MetadataStream/>"), { code: "InvalidXml" });
    } finally { await runtime.close(); }
});
