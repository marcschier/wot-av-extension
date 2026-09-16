const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createHash } = require("node:crypto");
const { DOMParser } = require("@xmldom/xmldom");
const {
    compileCatalog, compileClosure, loadLockedSources, parseSource, parseXml, serializeXml,
    decodeElement, encodeElement, defineOperationRegistry, operationKey
} = require("../../../../samples/reference-runtime/dist");
const { generatePayloadSchema, simpleSchema } = require("../../../../samples/reference-runtime/dist/catalog/schemas");
const { safeReadAliases } = require("../../../../samples/reference-runtime/dist/catalog/mappings");
const { resolveType } = require("../../../../samples/reference-runtime/dist/xml/descriptors");

const root = require("../../../paths.cjs").root;
const catalog = compileCatalog({ root });
const native = require("../../../fixtures/reference-runtime/catalog/native-responses.json");
const WSDL = "http://schemas.xmlsoap.org/wsdl/";
const SOAP = "http://schemas.xmlsoap.org/wsdl/soap12/";
const XSD = "http://www.w3.org/2001/XMLSchema";
const direct = (node, namespace, name) => Array.from(node.childNodes).filter((child) =>
    child.nodeType === 1 && child.namespaceURI === namespace && child.localName === name);
const expanded = (node, lexical) => {
    const [prefix, localName] = lexical.includes(":") ? lexical.split(":") : ["", lexical];
    return { namespace: node.lookupNamespaceURI(prefix || null) || "", localName };
};

function infoset(node) {
    return {
        name: [node.namespaceURI || "", node.localName],
        attributes: Array.from(node.attributes).filter((a) => a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
            .map((a) => [a.namespaceURI || "", a.localName, a.value]).sort(),
        children: Array.from(node.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.trim()))
            .map((n) => n.nodeType === 1 ? infoset(n) : n.data)
    };
}
const dom = (xml) => new DOMParser().parseFromString(xml, "application/xml").documentElement;
function operation(fixture) {
    const found = catalog.operations.find((entry) => entry.serviceNamespace === fixture.serviceNamespace
        && entry.portTypeQName.localName === fixture.portType && entry.operation === fixture.operation);
    assert.ok(found, `Native operation exists for ${fixture.id}`);
    return found;
}

test("catalog: every locked native binding operation is independently reconciled, without wsdl:service", () => {
    const lock = JSON.parse(readFileSync(join(root, "onvif", "sources.lock.json"), "utf8"));
    const selected = [...lock.sourceGroups.canonicalServiceEntryPoints, ...lock.sourceGroups.separateConditionalOrAddOnServices];
    const expected = new Map();
    for (const id of selected) {
        const source = lock.sources.find((entry) => entry.id === id);
        const bytes = readFileSync(join(root, "onvif", "support", "upstream", "onvif", ...source.relativePath.split("/")));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
        const xml = dom(bytes.toString("utf8"));
        assert.equal(direct(xml, WSDL, "service").length, 0);
        for (const binding of direct(xml, WSDL, "binding")) {
            for (const entry of direct(binding, WSDL, "operation")) {
                const reference = {
                    bindingQName: { namespace: xml.getAttribute("targetNamespace"), localName: binding.getAttribute("name") },
                    portTypeQName: expanded(binding, binding.getAttribute("type")), operation: entry.getAttribute("name")
                };
                const soap = direct(entry, SOAP, "operation")[0];
                expected.set(operationKey(reference), { action: soap.getAttribute("soapAction"), sourceId: id, sha256: source.sha256 });
            }
        }
    }
    assert.equal(selected.length, 19);
    assert.equal(expected.size, 579);
    assert.equal(catalog.operations.length, expected.size);
    for (const entry of catalog.operations) {
        const actual = expected.get(operationKey(entry));
        assert.ok(actual);
        assert.equal(entry.soapAction, actual.action);
        assert.equal(entry.addressingAction, actual.action);
        assert.equal(entry.sourceId, actual.sourceId);
        assert.equal(entry.source.sha256, actual.sha256);
        assert.notEqual(resolveType(entry.request.type, catalog.xml).kind, "opaque", "An operation is not an opaque XML coverage escape");
    }
    assert.equal(catalog.services.length, 33);
    assert.equal(catalog.sourcePins.xmlDocuments, 39);
    assert.equal(catalog.sourcePins.imports, 48);
    assert.equal(catalog.sourcePins.baseline.commit, "68ee1b540a40f848c9599eba2c55b87547c588d6");
});

test("catalog: source selection is deterministic, offline, and separates optional add-on WSDLs", () => {
    const again = compileCatalog({ root });
    assert.equal(again.registryDigest, catalog.registryDigest);
    assert.deepEqual(again, catalog);
    const core = compileCatalog({ root, includeAddOns: false });
    assert.equal(core.operations.length, 500);
    assert.ok(core.services.every((service) => service.group === "canonical"));
    assert.notEqual(core.registryDigest, catalog.registryDigest);
    assert.throws(() => loadLockedSources({ root, sourceIds: ["xmlsoap-ws-discovery-2005-wsdl"] }),
        /explicit source cache/);
    assert.throws(() => parseSource(Buffer.from('<!DOCTYPE x SYSTEM "https://never.invalid/"><x/>'), "fixture:untrusted"), /DTD/);
    assert.equal(defineOperationRegistry(catalog.operations, catalog.xml).digest, catalog.registryDigest);
});

test("catalog: shared operation names retain native request roots, class ownership, actions and imported faults", () => {
    const first = operation(native.cases.find((entry) => entry.id === "media1"));
    const second = operation(native.cases.find((entry) => entry.id === "media2"));
    assert.notEqual(first.id, second.id);
    assert.notDeepEqual(first.request.name, second.request.name);
    assert.deepEqual(decodeElement(first.request, parseXml('<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>'), catalog.xml), {});
    assert.deepEqual(decodeElement(second.request, parseXml('<GetProfiles xmlns="http://www.onvif.org/ver20/media/wsdl"><Token>0001</Token><Type>VideoSource</Type><Type>Metadata</Type></GetProfiles>'), catalog.xml),
        { Token: "0001", Type: ["VideoSource", "Metadata"] });
    assert.equal(first.input.className, "GetProfilesRequest");
    assert.equal(first.input.owner, "caller");
    assert.equal(second.output.owner, "service");
    const unsubscribe = catalog.operations.find((entry) => entry.bindingQName.localName === "SubscriptionManagerBinding" && entry.operation === "Unsubscribe");
    assert.equal(unsubscribe.portTypeQName.namespace, "http://docs.oasis-open.org/wsn/bw-2");
    assert.equal(unsubscribe.request.name.namespace, "http://docs.oasis-open.org/wsn/b-2");
    assert.ok(unsubscribe.faults.some((fault) => fault.sourceId === "oasis-wsn-b-2"));
    const notify = catalog.operations.find((entry) => entry.operation === "Notify");
    assert.equal(notify.response, null);
    assert.equal(notify.mappingSupport, "compiled");
    assert.deepEqual(notify.issues, []);
    assert.deepEqual(notify.execution, { mode: "one-way", safe: false, idempotent: false });
});

for (const fixture of native.cases) {
    test(`catalog: independent Profile ${fixture.profile} native payload ${fixture.id}`, () => {
        const contract = operation(fixture);
        assert.equal(contract.sourceId, fixture.sourceId);
        assert.equal(contract.mappingSupport, "compiled");
        const value = decodeElement(contract.response, parseXml(fixture.xml), catalog.xml);
        if (fixture.expected) assert.deepEqual(value, fixture.expected);
        if (fixture.expectedTokens) assert.deepEqual(value.Profiles.map((profile) => profile.$attributes.token), fixture.expectedTokens);
        if (fixture.expectedAttributes) assert.deepEqual(value.Capabilities.$attributes, fixture.expectedAttributes);
        if (fixture.expectedAbsentDefault) assert.equal(Object.hasOwn(value.Capabilities.$attributes, fixture.expectedAbsentDefault), false);
        if (fixture.expectedRecording) {
            assert.equal(value.RecordingItem[0].RecordingToken, fixture.expectedRecording);
            assert.equal(value.RecordingItem[0].Tracks.Track[0].TrackToken, fixture.expectedTrack);
            assert.equal(value.RecordingItem[0].Configuration.MaximumRetentionTime, "P2D");
        }
        if (fixture.expectedDoor) assert.equal(value.DoorInfo[0].$attributes.token, fixture.expectedDoor);
        if (fixture.expectedInput) assert.equal(value.DigitalInputs[0].$attributes.token, fixture.expectedInput);
        const encoded = serializeXml(encodeElement(contract.response, value, catalog.xml));
        assert.deepEqual(infoset(dom(encoded)), infoset(dom(fixture.xml)));
    });
}

test("catalog: actual restrictions, repeated native choices, attributes and lexical integers reject lossy input", () => {
    const access = operation(native.cases.find((fixture) => fixture.id === "accessrules"));
    const xml = native.cases.find((fixture) => fixture.id === "accessrules").xml;
    assert.throws(() => decodeElement(access.response, parseXml(xml.replace('MaxLimit="10"', 'MaxLimit="0"')), catalog.xml), { code: "InvalidValue" });
    const serial = catalog.operations.find((entry) => entry.operation === "SendReceiveSerialCommand");
    const wire = '<d:SendReceiveSerialCommand xmlns:d="http://www.onvif.org/ver10/deviceIO/wsdl"><d:Token>0001</d:Token><d:SerialData><d:Binary>AAEC</d:Binary></d:SerialData><d:TimeOut>PT0.125S</d:TimeOut><d:DataLength>18446744073709551615</d:DataLength></d:SendReceiveSerialCommand>';
    const value = decodeElement(serial.request, parseXml(wire), catalog.xml);
    assert.equal(value.DataLength, "18446744073709551615");
    assert.deepEqual(value.SerialData.$choice1, [{ $case: "Binary", $value: "AAEC" }]);
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(serial.request, value, catalog.xml)))), infoset(dom(wire)));
    assert.throws(() => encodeElement(serial.request, { ...value, DataLength: 18446744073709551615 }, catalog.xml), { code: "InvalidValue" });
    assert.throws(() => decodeElement(serial.request, parseXml(wire.replace("</d:Binary>", "</d:Binary><d:String>extra</d:String>")), catalog.xml), { code: "InvalidValue" });
    assert.equal(safeReadAliases(catalog).some((alias) => /SearchResults|SendReceiveSerial|SetSynchronization|PullMessages/.test(alias.operationId)), false);
});

function miniature(schema) {
    const xml = `<w:definitions xmlns:w="${WSDL}" xmlns:s="${SOAP}" xmlns:x="${XSD}" xmlns:t="urn:test:compiler" targetNamespace="urn:test:compiler">
        <w:types><x:schema targetNamespace="urn:test:compiler" elementFormDefault="qualified">${schema}</x:schema></w:types>
        <w:message name="EchoRequest"><w:part name="p" element="t:Echo"/></w:message>
        <w:message name="EchoResponse"><w:part name="p" element="t:Echo"/></w:message>
        <w:portType name="Port"><w:operation name="Echo"><w:input message="t:EchoRequest"/><w:output message="t:EchoResponse"/></w:operation></w:portType>
        <w:binding name="Binding" type="t:Port"><s:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/><w:operation name="Echo"><s:operation soapAction="urn:literal:echo"/><w:input><s:body use="literal"/></w:input><w:output><s:body use="literal"/></w:output></w:operation></w:binding>
    </w:definitions>`;
    const bytes = Buffer.from(xml), id = "fixture:compiler.wsdl";
    const source = { id, kind: "wsdl", url: "urn:fixture:compiler", relativePath: "fixture.wsdl", storage: "test-only",
        sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, imports: [] };
    return compileClosure({ lock: { schemaVersion: 1, baseline: { kind: "unit-fixture-not-production-coverage" },
        sources: [source], sourceGroups: { canonicalServiceEntryPoints: [id] } }, lockDigest: source.sha256,
    entryPoints: [id], importCount: 0, documents: new Map([[id, { source, root: parseSource(bytes, id) }]]) });
}

test("catalog: recursive source types use bounded references, nil/default choices and exact numeric/QName values", () => {
    const generated = miniature(`
        <x:complexType name="Base"><x:sequence><x:element name="Amount" type="x:decimal"/><x:element name="Counter" type="x:unsignedLong"/><x:element name="Stamp" type="x:dateTime"/></x:sequence><x:attribute name="mode" type="x:QName" use="required"/></x:complexType>
        <x:complexType name="Node"><x:complexContent><x:extension base="t:Base"><x:sequence><x:element name="Child" type="t:Node" minOccurs="0" maxOccurs="unbounded" nillable="true"/><x:element name="Enabled" type="x:boolean" default="false" minOccurs="0"/></x:sequence></x:extension></x:complexContent></x:complexType>
        <x:element name="Echo" type="t:Node"/>
    `);
    const entry = generated.operations[0];
    assert.equal(entry.mappingSupport, "compiled");
    const xml = '<t:Echo xmlns:t="urn:test:compiler" xmlns:k="urn:keys" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" mode="k:Ready"><t:Amount>12345678901234567890.0012300</t:Amount><t:Counter>18446744073709551615</t:Counter><t:Stamp>2026-09-15T10:11:12.123456789</t:Stamp><t:Child xsi:nil="true" mode="k:Ready"/><t:Enabled/></t:Echo>';
    const value = decodeElement(entry.request, parseXml(xml), generated.xml);
    assert.equal(value.Amount, "12345678901234567890.0012300");
    assert.equal(value.Counter, "18446744073709551615");
    assert.equal(value.Stamp, "2026-09-15T10:11:12.123456789");
    assert.deepEqual(value.$attributes.mode, { namespace: "urn:keys", localName: "Ready" });
    assert.deepEqual(value.Enabled, { $default: true });
    assert.equal(value.Child[0].$nil, true);
    const roundtrip = decodeElement(entry.request, parseXml(serializeXml(encodeElement(entry.request, value, generated.xml))), generated.xml);
    assert.deepEqual(roundtrip, value);
    for (const Counter of [18446744073709551615, "18446744073709551616"]) {
        assert.throws(() => encodeElement(entry.request, { ...value, Counter }, generated.xml), { code: "InvalidValue" });
    }
    assert.throws(() => encodeElement(entry.request, { ...value, Amount: 1.25 }, generated.xml), { code: "InvalidValue" });
    const recursive = structuredClone(value); recursive.Child = [recursive];
    assert.throws(() => encodeElement(entry.request, recursive, generated.xml), { code: "InvalidValue" });
    const schema = simpleSchema({ kind: "scalar", type: "uint64" });
    assert.ok(new RegExp(schema.pattern).test("18446744073709551615"));
    assert.ok(!new RegExp(schema.pattern).test("18446744073709551616"));
    assert.ok(new RegExp(schema.pattern).test("+00018446744073709551615"));
});

test("catalog: unsupported XSD remains an operation-level error and every generated schema reference resolves", () => {
    const bad = miniature('<x:complexType name="Unqualified"><x:all><x:element name="Value" type="x:string"/></x:all></x:complexType><x:element name="Echo" type="t:Unqualified"/>');
    assert.equal(bad.operations[0].mappingSupport, "unsupported");
    assert.ok(bad.operations[0].issues.some((issue) => issue.message.includes("all")));
    assert.throws(() => encodeElement(bad.operations[0].request, {}, bad.xml), { code: "UnsupportedCapability" });
    assert.deepEqual(catalog.issues, []);
    const schema = generatePayloadSchema(catalog);
    const visit = (value) => {
        if (value === null || typeof value !== "object") return;
        if (value.$ref) {
            assert.match(value.$ref, /^#\/\$defs\/[^/]+$/);
            assert.ok(Object.hasOwn(schema.$defs, value.$ref.slice("#/$defs/".length)), value.$ref);
        }
        for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    const unsupported = generatePayloadSchema(bad).$defs[`input_${bad.operations[0].id}`];
    assert.equal(unsupported.not, true);
    assert.ok(unsupported["onvif:unsupported"]);
    assert.ok(catalog.operations.every((op) => schema.$defs[`input_${op.id}`].not !== true));
});

test("catalog: abstract native types require a declared concrete xsi:type without blocking valid derivation", () => {
    const generated = miniature('<x:complexType name="Base" abstract="true"><x:sequence><x:element name="Name" type="x:string"/></x:sequence></x:complexType><x:complexType name="Concrete"><x:complexContent><x:extension base="t:Base"><x:sequence><x:element name="Count" type="x:int"/></x:sequence></x:extension></x:complexContent></x:complexType><x:element name="Echo" type="t:Base"/>');
    const descriptor = generated.operations[0].request;
    const value = { $type: { namespace: "urn:test:compiler", localName: "Concrete" }, Name: "native", Count: 2 };
    const xml = serializeXml(encodeElement(descriptor, value, generated.xml));
    assert.deepEqual(decodeElement(descriptor, parseXml(xml), generated.xml), value);
    assert.throws(() => encodeElement(descriptor, { Name: "abstract" }, generated.xml), { code: "InvalidValue" });
    assert.throws(() => decodeElement(descriptor, parseXml('<Echo xmlns="urn:test:compiler"><Name>abstract</Name></Echo>'), generated.xml), { code: "InvalidValue" });
});
