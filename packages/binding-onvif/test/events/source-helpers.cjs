const { createHash } = require("node:crypto");
const { DOMParser } = require("@xmldom/xmldom");
const { compileClosure } = require("./.compiled/catalog/compiler");
const { parseSource } = require("./.compiled/catalog/sources");
const WSDL = "http://schemas.xmlsoap.org/wsdl/";
const SOAP = "http://schemas.xmlsoap.org/wsdl/soap12/";
const XSD = "http://www.w3.org/2001/XMLSchema";
const dom = (xml) => new DOMParser().parseFromString(xml, "application/xml").documentElement;
function infoset(node) {
    return {
        name: [node.namespaceURI || "", node.localName],
        attributes: Array.from(node.attributes).filter((a) => a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
            .map((a) => [a.namespaceURI || "", a.localName, a.value]).sort(),
        children: Array.from(node.childNodes).filter((n) => n.nodeType !== 3 || n.data.trim())
            .map((n) => n.nodeType === 1 ? infoset(n) : [n.nodeType, n.nodeName, n.data])
    };
}
function miniature(schema) {
    const xml = `<w:definitions xmlns:w="${WSDL}" xmlns:s="${SOAP}" xmlns:x="${XSD}" xmlns:t="urn:phase4" targetNamespace="urn:phase4">
        <w:types><x:schema targetNamespace="urn:phase4" elementFormDefault="qualified">${schema}</x:schema></w:types>
        <w:message name="EchoMessage"><w:part name="p" element="t:Echo"/></w:message>
        <w:portType name="Port"><w:operation name="Echo"><w:input message="t:EchoMessage"/><w:output message="t:EchoMessage"/></w:operation></w:portType>
        <w:binding name="Binding" type="t:Port"><s:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/><w:operation name="Echo"><s:operation soapAction="urn:phase4:echo"/><w:input><s:body use="literal"/></w:input><w:output><s:body use="literal"/></w:output></w:operation></w:binding>
    </w:definitions>`;
    const bytes = Buffer.from(xml), id = "fixture:phase4-schema";
    const source = { id, kind: "wsdl", url: "urn:fixture:phase4", relativePath: "phase4.wsdl", storage: "test-only",
        sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, imports: [] };
    return compileClosure({ lock: { schemaVersion: 1, baseline: { kind: "schema-regression-not-native-catalog" },
        sources: [source], sourceGroups: { canonicalServiceEntryPoints: [id] } }, lockDigest: source.sha256,
        entryPoints: [id], importCount: 0, documents: new Map([[id, { source, root: parseSource(bytes, id) }]]) });
}
module.exports = { dom, infoset, miniature, XSD };
