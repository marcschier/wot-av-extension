const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");

test("April 2005: namespace-expanded general and legacy types remain independent alternatives", () => {
    const general = h.parseDiscovery(h.fixture("hello-device.xml"));
    const legacy = h.parseDiscovery(h.fixture("hello-legacy.xml"));
    assert.deepEqual(general.matches[0].types, [{ namespace: "http://www.onvif.org/ver10/device/wsdl", localName: "Device" }]);
    assert.deepEqual(legacy.matches[0].types, [{ namespace: "http://www.onvif.org/ver10/network/wsdl", localName: "NetworkVideoTransmitter" }]);
    assert.equal(h.matchesProbe(general.matches[0], [h.DEVICE], []), true);
    assert.equal(h.matchesProbe(legacy.matches[0], [h.LEGACY_DEVICE], []), true);
    assert.equal(h.matchesProbe(legacy.matches[0], [h.DEVICE], []), false, "Legacy S is allowed to omit Device");
    assert.equal(h.matchesProbe(general.matches[0], [h.DEVICE, h.LEGACY_DEVICE], []), false, "One Probe type list has AND semantics");
    assert.deepEqual(general.sequence, { instanceId: "7", sequenceId: "urn:sequence:x", messageNumber: "5" });
    assert.deepEqual(legacy.sequence, { instanceId: "5", sequenceId: null, messageNumber: "8" });
    assert.equal(general.matches[0].xaddrs[0], h.XADDR);
});

test("outgoing probes and Resolve are checked by an independent DOM parser, not the production decoder", () => {
    for (const [type, namespace, local] of [
        ["device", "http://www.onvif.org/ver10/device/wsdl", "Device"],
        ["legacy", "http://www.onvif.org/ver10/network/wsdl", "NetworkVideoTransmitter"]
    ]) {
        const document = h.wire(h.encodeProbe("urn:uuid:independent-request", type, ["onvif://www.onvif.org/location/A"]));
        assert.equal(document.documentElement.namespaceURI, "http://www.w3.org/2003/05/soap-envelope");
        assert.equal(h.element(document, h.ADDRESSING, "Action").textContent, `${h.DISCOVERY}/Probe`);
        assert.equal(h.element(document, h.ADDRESSING, "To").textContent, h.DISCOVERY_TO);
        const types = h.element(document, h.DISCOVERY, "Types");
        assert.equal(types.textContent.trim().split(/\s+/).length, 1);
        const [prefix, actual] = types.textContent.split(":");
        assert.equal(types.lookupNamespaceURI(prefix), namespace);
        assert.equal(actual, local);
        assert.equal(h.element(document, h.DISCOVERY, "Scopes").getAttribute("MatchBy"), `${h.DISCOVERY}/rfc3986`);
    }
    assert.equal(h.wire(h.encodeProbe("urn:uuid:untyped", "untyped")).getElementsByTagNameNS(h.DISCOVERY, "Types").length, 0);
    const endpoint = h.parseDiscovery(h.fixture("reference-properties.xml")).matches[0].endpointReference;
    const document = h.wire(h.encodeResolve("urn:uuid:resolve", endpoint));
    assert.equal(h.element(document, h.ADDRESSING, "ReplyTo").getElementsByTagNameNS(h.ADDRESSING, "Address").item(0).textContent, h.ANONYMOUS);
    assert.equal(h.element(document, h.ADDRESSING, "EndpointReference").getElementsByTagNameNS(h.ADDRESSING, "Address").item(0).textContent, h.EPR);
    const properties = document.getElementsByTagNameNS("urn:fixture:reference", "Partition");
    assert.equal(properties.length, 1);
    assert.equal(properties.item(0).getAttribute("code"), "north");
    assert.equal(properties.item(0).textContent, "0001");
});

test("RFC3986 matching: case-correct segments, canonical escapes, no dot segments; query/fragment excluded", () => {
    const cases = [
        ["ONVIF://WWW.ONVIF.ORG/location/A", "onvif://www.onvif.org/location/A/floor/2", true],
        ["onvif://www.onvif.org/location/a", "onvif://www.onvif.org/location/A", false],
        ["onvif://www.onvif.org/hardware/D1", "onvif://www.onvif.org/hardware/D1-566", false],
        ["onvif://www.onvif.org/hardware/%44%31", "onvif://www.onvif.org/hardware/D1", true],
        ["onvif://www.onvif.org/location/A%2fB", "onvif://www.onvif.org/location/A/B", false],
        ["onvif://www.onvif.org", "onvif://www.onvif.org/location/A", true],
        ["onvif://www.onvif.org/location/A?left=1#x", "onvif://www.onvif.org/location/A/B?right=2#y", true],
        ["onvif://www.onvif.org/location/./A", "onvif://www.onvif.org/location/A", false],
        ["onvif://www.onvif.org/location/%2e%2e/A", "onvif://www.onvif.org/A", false],
        ["onvif://www.onvif.org/location/A", "onvif://evil.example/location/A", false]
    ];
    for (const [query, advertised, expected] of cases) assert.equal(h.scopeMatches(query, advertised), expected, `${query} versus ${advertised}`);
    const match = h.parseDiscovery(h.fixture("hello-device.xml")).matches[0];
    assert.equal(h.matchesProbe(match, [], ["onvif://www.onvif.org/location", "onvif://www.onvif.org/Profile/T"]), true);
    assert.equal(h.matchesProbe(match, [], ["onvif://www.onvif.org/location", "onvif://www.onvif.org/Profile/S"]), false);
});

test("identity is EPR plus reference properties, not prefixes, endpoints or reference-parameter routing", () => {
    const xml = h.fixture("reference-properties.xml");
    const first = h.parseDiscovery(xml).matches[0].endpointReference;
    const alias = h.parseDiscovery(xml.replaceAll("site:", "renamed:").replace("xmlns:site=", "xmlns:renamed=")).matches[0].endpointReference;
    const changedRoute = h.parseDiscovery(xml.replace(">current<", ">replacement<")).matches[0].endpointReference;
    const partition = h.parseDiscovery(xml.replace('code="north"', 'code="south"')).matches[0].endpointReference;
    assert.equal(h.endpointIdentity(first), h.endpointIdentity(alias));
    assert.equal(h.endpointIdentity(first), h.endpointIdentity(changedRoute));
    assert.notEqual(h.endpointIdentity(first), h.endpointIdentity(partition));
    assert.notEqual(h.endpointIdentity(first), h.endpointIdentity({ address: first.address, referenceProperties: [], referenceParameters: [] }));
});

test("DiscoveryProxy suppression Hello is parsed distinctly and cannot masquerade as ordinary unsolicited Hello", () => {
    const proxy = h.parseDiscovery(h.fixture("proxy-hello.xml"));
    assert.equal(proxy.discoveryProxy, true);
    assert.equal(proxy.relatesTo, "urn:uuid:probe-general");
    assert.throws(() => h.parseDiscovery(h.fixture("hello-device.xml").replace("<addr:To>",
        '<addr:RelatesTo>urn:uuid:probe-general</addr:RelatesTo><addr:To>')), { code: "InvalidXml" });
    assert.throws(() => h.parseDiscovery(h.fixture("proxy-hello.xml").replace("d:DiscoveryProxy d:TargetService", "d:DiscoveryProxy")), { code: "InvalidXml" });
});

test("SequenceId is an explicit bounded URI reference, including empty/relative, distinct from the absent null sequence", () => {
    const xml = h.fixture("hello-device.xml");
    for (const value of ["", "sequence-a", "urn:sequence:x"]) {
        assert.equal(h.parseDiscovery(xml.replace('SequenceId="urn:sequence:x"', `SequenceId="${value}"`)).sequence.sequenceId, value);
    }
    const { inventory } = h.inventory();
    for (const [index, value] of [null, "", "sequence-a"].entries()) {
        const message = h.parseDiscovery(xml.replace('SequenceId="urn:sequence:x"', value === null ? "" : `SequenceId="${value}"`)
            .replace("hello-device-5", `sequence-${index}`));
        inventory.observe(message, h.provenance(message));
    }
    assert.deepEqual(inventory.snapshot().devices[0].ordering.sequences.map((item) => item.sequenceId), [null, "", "sequence-a"]);
    h.assertSnapshot(inventory.snapshot());
});

test("strict action/body/addressing, DTD/entity, UTF-8, unsigned counters and XML byte/depth limits fail explicitly", () => {
    const xml = h.fixture("hello-device.xml");
    for (const invalid of [
        xml.replaceAll("http://schemas.xmlsoap.org/ws/2005/04/discovery", "http://docs.oasis-open.org/ws-dd/ns/discovery/2009/01"),
        xml.replaceAll("http://schemas.xmlsoap.org/ws/2004/08/addressing", "http://www.w3.org/2005/08/addressing"),
        xml.replace('InstanceId="7"', 'InstanceId="-1"'),
        xml.replace('MessageNumber="5"', 'MessageNumber="4294967296"'),
        xml.replace("device:Device", "unbound:Device"),
        xml.replace("<soap:Body>", "<soap:Body><disc:Bye/>"),
        xml.replace("<soap:Header>", "<soap:Header><addr:MessageID>urn:duplicate</addr:MessageID>"),
        '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///do-not-read">]>' + xml.replace(/^<\?xml[^?]+\?>/, ""),
        Buffer.from([0xc0, 0x80])
    ]) assert.throws(() => h.parseDiscovery(invalid));
    const bytes = Buffer.byteLength(xml);
    assert.equal(h.parseDiscovery(xml, { ...h.DEFAULT_BOUNDS, maxDatagramBytes: bytes }).kind, "Hello");
    assert.throws(() => h.parseDiscovery(xml, { ...h.DEFAULT_BOUNDS, maxDatagramBytes: bytes - 1 }), { code: "XmlLimit" });
    const nested = xml.replace("device:Device", "<x>".repeat(35) + "</x>".repeat(35));
    assert.throws(() => h.parseDiscovery(nested), { code: "XmlLimit" });
    const missing = xml.replace(/<disc:AppSequence[^>]+\/>/, "");
    assert.throws(() => h.parseDiscovery(missing), { code: "InvalidXml" });
    assert.equal(h.parseDiscovery(missing, h.DEFAULT_BOUNDS, true).sequence, null);
});

test("normalized JSON budget measures exact UTF-8 and escaping rather than a proxy character threshold", () => {
    const value = { text: "line\nquote\"\u{1f30d}", number: -0, array: [null, true, {}, []] };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    assert.doesNotThrow(() => h.assertJson(value, 100, 10, bytes));
    assert.throws(() => h.assertJson(value, 100, 10, bytes - 1), { code: "XmlLimit" });
    assert.throws(() => h.assertJson({ token: undefined }), { code: "InvalidValue" });
    assert.throws(() => h.assertJson({ count: 1n }), { code: "InvalidValue" });
});
