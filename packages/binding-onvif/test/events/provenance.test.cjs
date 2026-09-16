const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { DOMParser } = require("@xmldom/xmldom");
const f = require("./native-fixture.cjs");
const { XSD } = require("./source-helpers.cjs");
const { requireImplemented } = require("./.compiled/xml/descriptors");
const { eventTemplate } = require("./.compiled/catalog/models");
const { generatePayloadSchema } = require("./.compiled/catalog/schemas");

test("canonical provenance: every registered type and field points to a hash-locked source declaration or an explicit XSD builtin", () => {
    const documents = new Map();
    for (const source of f.catalog.sourcePins.sources) {
        const bytes = readFileSync(join(f.root, "third_party", "onvif", ...source.relativePath.split("/")));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.id);
        const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
        const lines = text.split("\n");
        const offsets = [];
        let total = 0;
        for (const line of lines) { offsets.push(total); total += line.length + 1; }
        const document = new DOMParser({ locator: {} }).parseFromString(text, "application/xml");
        const byLine = new Map();
        for (const node of Array.from(document.getElementsByTagName("*"))) {
            let endLine = node.lineNumber, quote;
            for (let offset = offsets[node.lineNumber - 1] + node.columnNumber - 1; offset < text.length; offset++) {
                const char = text[offset];
                if (char === "\n") endLine++;
                if (quote) { if (char === quote) quote = undefined; }
                else if (char === "'" || char === '"') quote = char;
                else if (char === ">") break;
            }
            const nodes = byLine.get(endLine) ?? [];
            nodes.push(node);
            byLine.set(endLine, nodes);
        }
        documents.set(source.id, { source, byLine });
    }
    assert.deepEqual(new Set(f.catalog.types.map((type) => type.id)), new Set(Object.keys(f.catalog.xml.types)));
    for (const type of f.catalog.types) {
        if (type.sourceId === "builtin:xml-schema-1.0") {
            assert.equal(type.name.namespace, XSD);
            assert.equal(type.line, 0);
            assert.equal(type.id, `{${XSD}}${type.name.localName}`);
            continue;
        }
        const document = documents.get(type.sourceId);
        assert.ok(document, type.id);
        assert.equal(type.sha256, document.source.sha256, type.id);
        const declarations = (document.byLine.get(type.line) ?? []).filter((node) => node.namespaceURI === XSD);
        assert.ok(declarations.length, `${type.id} ${type.sourceId}:${type.line}`);
        if (type.name) {
            const declared = declarations.find((node) => node.getAttribute("name") === type.name.localName);
            assert.ok(declared, type.id);
            let schema = declared;
            while (schema && !(schema.namespaceURI === XSD && schema.localName === "schema")) schema = schema.parentNode;
            assert.ok(schema, type.id);
            assert.equal(type.name.namespace, schema.getAttribute("targetNamespace"), type.id);
        }
        for (const field of type.fields) {
            const owner = documents.get(field.sourceId);
            assert.ok(owner, `${type.id} field source`);
            assert.equal(field.sha256, owner.source.sha256, type.id);
            assert.ok((owner.byLine.get(field.line) ?? []).some((node) => node.namespaceURI === XSD && node.localName === field.xmlKind),
                `${type.id} ${field.xmlKind} ${field.sourceId}:${field.line}`);
        }
    }
    for (const operation of f.catalog.operations) {
        for (const element of [operation.request, operation.response, ...operation.faults.map((fault) => fault.element)].filter(Boolean)) {
            requireImplemented(element, f.catalog.xml);
        }
        for (const id of operation.reachableTypes) assert.ok(Object.hasOwn(f.catalog.xml.types, id), `${operation.id} -> ${id}`);
    }
});

test("canonical event model: every public creation/data/cancellation schema reference resolves and exposes no private codec descriptors", () => {
    const event = eventTemplate(f.catalog, "http://127.0.0.1:49100/events"), payload = generatePayloadSchema(f.catalog);
    assert.equal(event.forms[0]["onvif:binding"], "pullpoint-v1");
    assert.deepEqual(event.forms[0].op, ["subscribeevent", "unsubscribeevent"]);
    for (const name of ["subscription", "data", "cancellation"]) {
        const schema = event[name], uri = schema["onvif:sourceDataSchema"];
        assert.equal(typeof uri, "string");
        const key = uri.split("#/$defs/")[1];
        assert.ok(Object.hasOwn(payload.$defs, key), uri);
        assert.notEqual(payload.$defs[key].not, true, uri);
        assert.equal(Object.hasOwn(schema, "onvif:xml"), false);
        assert.equal(schema["onvif:validation"], "sourceDataSchema-and-canonical-codec");
    }
    assert.equal(event.forms[0]["onvif:subscription"].renew.portTypeQName.namespace, f.BW);
    assert.equal(event.forms[0]["onvif:subscription"].pull.operation, "PullMessages");
});
