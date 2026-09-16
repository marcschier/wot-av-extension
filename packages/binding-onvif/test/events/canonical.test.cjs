const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve, join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { compileCatalog } = require("./.compiled/catalog/compiler");
const { generatePayloadSchema } = require("./.compiled/catalog/schemas");
const { requireImplemented } = require("./.compiled/xml/descriptors");
const { decodeElement, encodeElement } = require("./.compiled/xml/mapper");
const { decodeMetadata } = require("./.compiled/xml/metadata");
const { parseXml, serializeXml } = require("./.compiled/xml/parser");
const { decodeSimple } = require("./.compiled/xml/simple-values");
const { XSD_PATTERNS, matchesXsdPattern } = require("./.compiled/xml/xsd-patterns");
const { dom, infoset, miniature, XSD } = require("./source-helpers.cjs");
const root = resolve(__dirname, "..", "..", "..", "..");
const catalog = compileCatalog({ root });
const TT = "http://www.onvif.org/ver10/schema";
const WSN = "http://docs.oasis-open.org/wsn/b-2";
const TOPIC = "http://docs.oasis-open.org/wsn/t-1";
const descriptor = (namespace, name) => catalog.xml.elements[`{${namespace}}${name}`];

test("phase4: every locked type and complete request/response/fault/xsi:type graph is implemented, compact and referential", () => {
    assert.equal(catalog.operations.length, 579);
    assert.equal(catalog.types.length, 3426);
    assert.deepEqual(catalog.issues, []);
    const visited = new Set();
    const walk = (value) => {
        if (!value || typeof value !== "object") return;
        assert.notEqual(value.kind, "unsupported");
        if (value.kind === "ref") {
            assert.ok(Object.hasOwn(catalog.xml.types, value.ref), value.ref);
            if (!visited.has(value.ref)) { visited.add(value.ref); walk(catalog.xml.types[value.ref]); }
        }
        for (const child of Object.values(value)) walk(child);
    };
    walk(catalog.xml);
    for (const operation of catalog.operations) {
        for (const element of [operation.request, operation.response, ...operation.faults.map((fault) => fault.element)].filter(Boolean)) {
            requireImplemented(element, catalog.xml);
            walk(element);
        }
        assert.ok(operation.issues.every((issue) => issue.code === "one-way-not-qualified"));
    }
    assert.ok(visited.size > 3000);
    assert.ok(Buffer.byteLength(JSON.stringify(catalog, null, 4)) < 20000000);
    const schema = generatePayloadSchema(catalog);
    assert.ok(Buffer.byteLength(JSON.stringify(schema, null, 4)) < 10000000);
    const refs = (value) => {
        if (!value || typeof value !== "object") return;
        if (value.$ref) assert.ok(Object.hasOwn(schema.$defs, value.$ref.slice("#/$defs/".length)), value.$ref);
        for (const child of Object.values(value)) refs(child);
    };
    refs(schema);
});

for (const fixture of require("../catalog/fixtures/native-responses.json").cases) {
    test(`phase4 source-native canonical regression: ${fixture.id}`, () => {
        const operation = catalog.operations.find((entry) => entry.serviceNamespace === fixture.serviceNamespace
            && entry.portTypeQName.localName === fixture.portType && entry.operation === fixture.operation);
        assert.ok(operation);
        const value = decodeElement(operation.response, parseXml(fixture.xml), catalog.xml);
        if (fixture.expected) assert.deepEqual(value, fixture.expected);
        assert.deepEqual(infoset(dom(serializeXml(encodeElement(operation.response, value, catalog.xml)))), infoset(dom(fixture.xml)));
    });
}

test("phase4: native mixed Topic text, namespace context, comment, PI and extension order survive beside attributes", () => {
    const xml = `<n:Topic xmlns:n="${WSN}" xmlns:a="urn:access" Dialect="urn:expression">a:Door<!--keep--><?audit exact?><v:Limit xmlns:v="urn:vendor" k="001">0002</v:Limit> tail</n:Topic>`;
    const value = decodeElement(descriptor(WSN, "Topic"), parseXml(xml), catalog.xml);
    assert.deepEqual(value.$attributes, { Dialect: "urn:expression" });
    assert.equal(value.$namespaces.a, "urn:access");
    assert.deepEqual(value.$children.map((child) => child.kind === "element"
        ? [child.kind, child.name, child.attributes.map((a) => a.value), child.children.map((c) => c.value)]
        : [child.kind, child.value]), [
        ["text", "a:Door"], ["comment", "keep"], ["processing-instruction", "exact"],
        ["element", { namespace: "urn:vendor", localName: "Limit" }, ["001"], ["0002"]], ["text", " tail"]
    ]);
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(descriptor(WSN, "Topic"), value, catalog.xml)))), infoset(dom(xml)));
    assert.throws(() => decodeElement(descriptor(WSN, "Topic"),
        parseXml(xml.replace(" tail", '<v:Second xmlns:v="urn:vendor"/> tail')), catalog.xml), { code: "InvalidValue" });
});

test("phase4: mixed declared children are still type/sequence checked, not an opaque operation escape", () => {
    const c = miniature('<x:element name="Echo"><x:complexType mixed="true"><x:sequence><x:element name="Count" type="x:int"/></x:sequence><x:attribute name="id" type="x:ID" use="required"/></x:complexType></x:element>');
    const element = c.operations[0].request;
    const xml = '<t:Echo xmlns:t="urn:phase4" id="event1">before<t:Count>3</t:Count>after</t:Echo>';
    const value = decodeElement(element, parseXml(xml), c.xml);
    assert.deepEqual(value.$attributes, { id: "event1" });
    assert.deepEqual(value.$children.map((child) => child.kind), ["text", "element", "text"]);
    assert.throws(() => decodeElement(element, parseXml(xml.replace(">3<", ">three<")), c.xml), { code: "InvalidValue" });
    assert.throws(() => encodeElement(element, { ...value, $children: [] }, c.xml), { code: "InvalidValue" });
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(element, value, c.xml)))), infoset(dom(xml)));
});

test("phase4: complete MetadataStream chooses expanded native QName over any and preserves unknown ordered extensions", () => {
    const xml = `<tt:MetadataStream xmlns:tt="${TT}" xmlns:v="urn:vendor" v:label="0007"><tt:VideoAnalytics><tt:Frame UtcTime="2026-09-15T10:11:12.123456789Z"/><v:Frame>vendor</v:Frame></tt:VideoAnalytics><v:Extra>first</v:Extra><tt:SensorData UtcTime="2026-09-15T10:11:12Z" SensorID="01"><tt:Type>heat</tt:Type><tt:Value>+1.20e2</tt:Value></tt:SensorData><tt:Event/><v:Extra>last</v:Extra></tt:MetadataStream>`;
    const value = decodeMetadata(Buffer.from(xml), catalog.xml);
    const choices = value.$choice1_1;
    assert.deepEqual(choices.map((entry) => entry.$case), ["VideoAnalytics", "$any6", "SensorData", "Event", "$any6"]);
    assert.deepEqual(choices[0].$value.$choice1.map((entry) => entry.$case), ["Frame", "$any3"]);
    assert.equal(choices[0].$value.$choice1[0].$value.$attributes.UtcTime, "2026-09-15T10:11:12.123456789Z");
    assert.equal(choices[2].$value.Value, "+1.20e2");
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(descriptor(TT, "MetadataStream"), value, catalog.xml)))), infoset(dom(xml)));
    assert.throws(() => decodeMetadata(xml.replace("Value>+1.20e2", "Value>invalid"), catalog.xml), { code: "InvalidValue" });
    assert.throws(() => decodeMetadata('<tt:Frame xmlns:tt="' + TT + '"/>', catalog.xml), { code: "InvalidValue" });
    const invalid = structuredClone(value);
    invalid.$choice1_1[0] = { $case: "$any6", $value: parseXml(`<tt:VideoAnalytics xmlns:tt="${TT}"/>`) };
    assert.throws(() => encodeElement(descriptor(TT, "MetadataStream"), invalid, catalog.xml), { code: "InvalidValue" });
});

test("phase4: actual ONVIF/OASIS pattern facets agree with an independent XML Schema validator", () => {
    const cases = [
        { pattern: XSD_PATTERNS.oid, base: "xs:string", values: ["1", "1.2.003", "1x2", "123", "12.3a4", "x1", "1.", "1..2", "1\n2", ""] },
        { pattern: XSD_PATTERNS.passphrase, base: "xs:string", values: ["12345678", "a".repeat(63), "a".repeat(64), "short", "1234567é", "        ", "abc\n12345"] },
        { pattern: XSD_PATTERNS.concreteTopic, base: "xs:token", values: ["a:Door", "Root/a:Leaf", "Door", "é:門/Leaf", "/Door", "a:*", "a:b:c", "Door//Leaf", "Door/", ""] },
        { pattern: XSD_PATTERNS.fullTopic, base: "xs:token", values: ["a:Door//.", "a://Root/*|Other/Leaf", "//Root", "*", "a:b:c", "Root///Leaf", "a:Door|", "", "a:Door/../x"] }
    ];
    const oracle = spawnSync("python", ["-X", "utf8", "-B", join(__dirname, "xsd-oracle.py")], {
        input: JSON.stringify(cases), encoding: "utf8", timeout: 30000
    });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.deepEqual(cases.map((entry) => entry.values.map((value) => matchesXsdPattern(entry.pattern, value))), JSON.parse(oracle.stdout));
    const sourcePatterns = Object.values(catalog.xml.types).flatMap((type) => {
        const found = [];
        const collect = (t) => {
            if (t.kind === "restriction") { found.push(...(t.facets.patterns || [])); collect(t.base); }
        };
        collect(type);
        return found;
    });
    assert.deepEqual([...new Set(sourcePatterns)].sort(), Object.values(XSD_PATTERNS).sort());
    const passphrase = catalog.xml.types[`{${TT}}Dot11PSKPassphrase`];
    assert.throws(() => decodeSimple(passphrase, "short", parseXml("<Value/>")), { code: "InvalidValue" });
    const c = miniature('<x:element name="Echo"><x:simpleType><x:restriction base="x:string"><x:pattern value="(?=unknown)"/></x:restriction></x:simpleType></x:element>');
    assert.equal(c.operations[0].mappingSupport, "unsupported");
    assert.throws(() => encodeElement(c.operations[0].request, "unknown", c.xml), { code: "UnsupportedCapability" });
});

test("phase4: xml:id and typed xs:ID are document-wide; uniqueness restarts for another document", () => {
    assert.throws(() => parseXml('<Root xml:id="same"><Child xml:id="same"/></Root>'), { code: "InvalidValue" });
    assert.throws(() => parseXml('<Root xml:id="prefix:bad"/>'), { code: "InvalidValue" });
    const c = miniature('<x:element name="Echo"><x:complexType><x:sequence><x:element name="Item" maxOccurs="unbounded"><x:complexType><x:attribute name="id" type="x:ID" use="required"/></x:complexType></x:element></x:sequence></x:complexType></x:element>');
    const element = c.operations[0].request;
    const xml = '<Echo xmlns="urn:phase4"><Item id="one"/><Item id="two"/></Echo>';
    const value = decodeElement(element, parseXml(xml), c.xml);
    assert.deepEqual(decodeElement(element, parseXml(xml), c.xml), value);
    assert.throws(() => decodeElement(element, parseXml(xml.replace('id="two"', 'id="one"')), c.xml), { code: "InvalidValue" });
    value.Item[1].$attributes.id = "one";
    assert.throws(() => encodeElement(element, value, c.xml), { code: "InvalidValue" });
});

test("phase4: xs:unique derives QName-aware selector/field paths, typed tuple equality and native scope", () => {
    const c = miniature(`<x:element name="Echo"><x:complexType><x:sequence><x:element name="Group" maxOccurs="unbounded"><x:complexType><x:sequence><x:element name="Item" maxOccurs="unbounded"><x:complexType><x:attribute name="name" type="x:QName"/><x:attribute name="count" type="x:integer"/></x:complexType></x:element></x:sequence></x:complexType><x:unique name="tuple"><x:selector xpath="t:Item"/><x:field xpath="@name"/><x:field xpath="@count"/></x:unique></x:element></x:sequence></x:complexType></x:element>`);
    const element = c.operations[0].request;
    const xml = '<Echo xmlns="urn:phase4" xmlns:a="urn:keys" xmlns:b="urn:keys"><Group><Item name="a:Door" count="01"/><Item name="a:Door" count="2"/><Item/></Group><Group><Item name="b:Door" count="+1"/></Group></Echo>';
    decodeElement(element, parseXml(xml), c.xml);
    assert.throws(() => decodeElement(element, parseXml(xml.replace('count="2"', 'count="+001"')), c.xml), { code: "InvalidValue" });
    const topic = descriptor(TOPIC, "TopicNamespace");
    assert.deepEqual(topic.unique[0].selector[0].elements, [{ namespace: TOPIC, localName: "Topic" }]);
    const topicType = catalog.xml.types[`{${TOPIC}}TopicType`];
    const child = topicType.sequence.find((particle) => particle.key === "Topic");
    assert.equal(child.element.unique[0].selector[0].elements[0].localName, "topic", "Retain the literal lowercase source selector");
    const wire = `<TopicNamespace xmlns="${TOPIC}" targetNamespace="urn:test"><Topic name="Door"/><Topic name="Door"/></TopicNamespace>`;
    assert.throws(() => decodeElement(topic, parseXml(wire), catalog.xml), { code: "InvalidValue" });
});

test("phase4: native XML keeps byte/entity and nil/64-bit/decimal/list/union/temporal distinctions", () => {
    assert.throws(() => decodeMetadata(Buffer.from([0xc3, 0x28]), catalog.xml), { code: "InvalidXml" });
    assert.throws(() => decodeMetadata(`<?xml version="1.0" encoding="iso-8859-1"?><MetadataStream xmlns="${TT}"/>`, catalog.xml), { code: "InvalidXml" });
    assert.throws(() => decodeMetadata(`<!DOCTYPE m [<!ENTITY e SYSTEM "file:///never">]><MetadataStream xmlns="${TT}">&e;</MetadataStream>`, catalog.xml), { code: "InvalidXml" });
    assert.throws(() => decodeMetadata(`<MetadataStream xmlns="${TT}"/>`, catalog.xml, { maxBytes: 4 }), { code: "XmlLimit" });
    const c = miniature(`<x:element name="Echo"><x:complexType><x:sequence>
        <x:element name="Nil" type="x:long" nillable="true"/><x:element name="Long" type="x:long"/>
        <x:element name="Decimal" type="x:decimal"/><x:element name="Stamp" type="x:dateTime"/>
        <x:element name="Union" maxOccurs="unbounded"><x:simpleType><x:union memberTypes="x:unsignedLong x:duration"/></x:simpleType></x:element>
        <x:element name="List"><x:simpleType><x:list itemType="x:decimal"/></x:simpleType></x:element>
        </x:sequence></x:complexType></x:element>`);
    const xml = '<Echo xmlns="urn:phase4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Nil xsi:nil="true"/><Long>-9223372036854775808</Long><Decimal>12345678901234567890.00000100</Decimal><Stamp>2024-02-29T24:00:00.000+14:00</Stamp><Union>18446744073709551615</Union><Union>PT0.125S</Union><List>001.200 .000001</List></Echo>';
    const expected = { Nil: { $nil: true }, Long: "-9223372036854775808", Decimal: "12345678901234567890.00000100",
        Stamp: "2024-02-29T24:00:00.000+14:00", Union: [
            { $member: `{${XSD}}unsignedLong`, $value: "18446744073709551615" },
            { $member: `{${XSD}}duration`, $value: "PT0.125S" }], List: ["001.200", ".000001"] };
    assert.deepEqual(decodeElement(c.operations[0].request, parseXml(xml), c.xml), expected);
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(c.operations[0].request, expected, c.xml)))), infoset(dom(xml)));
    assert.throws(() => encodeElement(c.operations[0].request, { ...expected, Long: -9223372036854775808 }, c.xml), { code: "InvalidValue" });
    assert.throws(() => decodeElement(c.operations[0].request, parseXml(xml.replace("2024-02-29", "2023-02-29")), c.xml), { code: "InvalidValue" });
});
