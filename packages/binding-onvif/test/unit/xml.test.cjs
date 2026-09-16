const test = require("node:test");
const assert = require("node:assert/strict");
const { parseXml, serializeXml, decodeElement, encodeElement } = require("../../dist");
const { mappingElement, q, scalar, element, field } = require("../fixtures/operations.cjs");
const { mapping, infoset, parseWire } = require("../fixtures/endpoint.cjs");

test("XML: independent infoset preserves namespaces, attributes, precision, choices, nil and extensions", () => {
    const value = decodeElement(mappingElement, parseXml(mapping));
    assert.deepEqual(value.$attributes, { id: "001", mode: q("urn:wot-av:test:keys", "Ready") });
    assert.equal(value.Count, "18446744073709551615");
    assert.equal(value.Price, "12345678901234567890.0012300");
    assert.equal(value.Stamp, "2026-09-15T10:11:12.123456789");
    assert.equal(value.Hex, "00010a");
    assert.equal(value.Bytes, "AAEC");
    assert.deepEqual(value.Kind, q("urn:wot-av:test:keys", "Ready"));
    assert.ok(!Object.hasOwn(value, "Absent"));
    assert.equal(value.Empty, "");
    assert.deepEqual(value.Nil, { $nil: true, $attributes: { code: "kept" } });
    assert.deepEqual(value.Tags, ["00001", "00002"]);
    assert.deepEqual(value.Choices, [
        { $case: "A", $value: "first" },
        { $case: "B", $value: 2 },
        { $case: "A", $value: "third" }
    ]);
    assert.equal(value.$extensions[0].namespaces.k, "urn:wot-av:test:keys");
    const encoded = serializeXml(encodeElement(mappingElement, value));
    assert.deepEqual(infoset(parseWire(encoded)), infoset(parseWire(mapping)));
    const decoded = decodeElement(mappingElement, parseXml(encoded));
    assert.deepEqual({ ...decoded, $extensions: [] }, { ...value, $extensions: [] });
    for (const [prefix, namespace] of Object.entries(value.$extensions[0].namespaces)) {
        assert.equal(decoded.$extensions[0].namespaces[prefix], namespace, "Retain every original extension namespace binding");
    }
    assert.equal(decoded.$extensions[0].namespaces[""], "", "Do not change unprefixed QName values in opaque content");
});

test("XML: repeated fields stay arrays for zero, one and many occurrences", () => {
    const descriptor = element("urn:list", "List", {
        kind: "complex",
        sequence: [field("items", element("urn:list", "Item", scalar("string")),
            { minOccurs: 0, maxOccurs: "unbounded" })]
    });
    for (const items of [[], ["000"], ["000", "001"]]) {
        const xml = `<List xmlns="urn:list">${items.map((x) => `<Item>${x}</Item>`).join("")}</List>`;
        assert.deepEqual(decodeElement(descriptor, parseXml(xml)), { items });
    }
});

test("XML: invalid values, loss-inducing input, wrong namespaces and out-of-sequence children reject", () => {
    const value = () => decodeElement(mappingElement, parseXml(mapping));
    for (const Count of [18446744073709551615, "18446744073709551616", "-1", "1e3"]) {
        assert.throws(() => encodeElement(mappingElement, { ...value(), Count }), { code: "InvalidValue" });
    }
    for (const patch of [{ Price: 1.23 }, { Price: "1e3" }, { Hex: "000" }, { Bytes: "AAE!" },
        { Stamp: "2026-02-30T12:00:00" }, { Empty: null }, { Absent: null }, { unknown: "lost" }]) {
        assert.throws(() => encodeElement(mappingElement, { ...value(), ...patch }), { code: "InvalidValue" });
    }
    assert.throws(() => decodeElement(mappingElement, parseXml(mapping.replace(
        "<m:Count>", '<m:Count xmlns:m="urn:wrong">'))), { code: "InvalidValue" });
    assert.throws(() => decodeElement(mappingElement, parseXml(mapping.replace(
        /<m:Count>[\s\S]*?<\/m:Count>/, ""))), { code: "InvalidValue" });
    assert.throws(() => decodeElement(mappingElement, parseXml(mapping.replace(
        "<m:Empty/>", "<m:Empty xsi:nil=\"true\"/>"))), { code: "InvalidValue" });
});

test("XML: external entities, DTDs, malformed namespaces/UTF8 and resource overflow fail closed", () => {
    for (const xml of [
        '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///not-opened">]><x>&secret;</x>',
        '<!DOCTYPE x SYSTEM "https://never.example/schema"><x/>',
        '<x>&notDefined;</x>', '<p:x/>', '<x a="1" a="2"/>', "<x/><y/>",
        Buffer.from([0x3c, 0x78, 0x3e, 0xff, 0x3c, 0x2f, 0x78, 0x3e])
    ]) {
        assert.throws(() => parseXml(xml), { code: "InvalidXml" });
    }
    assert.throws(() => parseXml("<x><y><z/></y></x>", { maxDepth: 2 }), { code: "XmlLimit" });
    assert.throws(() => parseXml("<x><y/><y/></x>", { maxNodes: 2 }), { code: "XmlLimit" });
    assert.throws(() => parseXml('<x a="1" b="2"/>', { maxAttributes: 1 }), { code: "XmlLimit" });
    assert.throws(() => parseXml("<x>12345</x>", { maxBytes: 10 }), { code: "XmlLimit" });
    assert.throws(() => parseXml("<x/>", { maxDepth: 0 }), { code: "InvalidConfiguration" });
});

test("XML: explicit simple content, QName xsi:type, list and union keep their native identity", () => {
    const descriptor = element("urn:types", "Value", {
        kind: "complex",
        text: scalar("string"),
        attributes: [{ key: "token", name: q("", "token"), type: scalar("string") }]
    }, {
        types: [{
            name: q("urn:types", "Exact"),
            type: { kind: "complex", text: scalar("decimal"),
                attributes: [{ key: "token", name: q("", "token"), type: scalar("string") }] }
        }]
    });

    const xml = '<v:Value xmlns:v="urn:types" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="v:Exact" token="000">12345678901234567890.10</v:Value>';
    const value = decodeElement(descriptor, parseXml(xml));
    assert.deepEqual(value, { $type: q("urn:types", "Exact"),
        $attributes: { token: "000" }, $value: "12345678901234567890.10" });
    assert.deepEqual(infoset(parseWire(serializeXml(encodeElement(descriptor, value)))), infoset(parseWire(xml)));
    const list = element("urn:types", "List", { kind: "list", item: scalar("uint64") });
    assert.deepEqual(decodeElement(list, parseXml('<List xmlns="urn:types">0 18446744073709551615</List>')),
        ["0", "18446744073709551615"]);
    const union = element("urn:types", "Union", { kind: "union", members: [
        { name: "integer", type: scalar("integer") }, { name: "text", type: scalar("string") }
    ] });
    assert.deepEqual(decodeElement(union, parseXml('<Union xmlns="urn:types">0001</Union>')),
        { $member: "integer", $value: "0001" });
    assert.throws(() => encodeElement(union, { $member: "text", $value: "0001" }), { code: "InvalidValue" });
});

test("XML: wildcard attributes retain namespaces needed by unknown QName-valued content", () => {
    const descriptor = element("urn:attributes", "Value", { kind: "complex", anyAttributes: true, sequence: [] });
    const xml = '<a:Value xmlns:a="urn:attributes" xmlns:v="urn:vendor" v:state="v:Ready" marker="Local"/>';
    const value = decodeElement(descriptor, parseXml(xml));
    assert.equal(value.$namespaces.v, "urn:vendor");
    assert.equal(value.$namespaces[""], "");
    const encoded = serializeXml(encodeElement(descriptor, value));
    const root = parseWire(encoded).documentElement;
    assert.equal(root.lookupNamespaceURI("v"), "urn:vendor");
    assert.equal(root.lookupNamespaceURI(null) || "", "");
    assert.equal(root.getAttributeNS("urn:vendor", "state"), "v:Ready");
    assert.deepEqual(infoset(root), infoset(parseWire(xml)));
    const incomplete = { ...value };
    delete incomplete.$namespaces;
    assert.throws(() => encodeElement(descriptor, incomplete), { code: "InvalidValue" });
});

test("XML: QName values in the empty namespace must not acquire their containing element's namespace", () => {
    const descriptor = element("urn:qualified", "Name", scalar("QName"));
    const xml = serializeXml(encodeElement(descriptor, q("", "Unqualified")));
    const root = parseWire(xml).documentElement;
    assert.equal(root.namespaceURI, "urn:qualified");
    assert.equal(root.lookupNamespaceURI(null) || "", "");
    assert.deepEqual(decodeElement(descriptor, parseXml(xml)), q("", "Unqualified"));
});
