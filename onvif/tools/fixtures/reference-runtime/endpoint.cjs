const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { DOMParser } = require("@xmldom/xmldom");

const SOAP = "http://www.w3.org/2003/05/soap-envelope";
const WSA = "http://www.w3.org/2005/08/addressing";
const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const information = readFileSync(join(__dirname, "./device-information.xml"), "utf8");
const fault = readFileSync(join(__dirname, "./fault.xml"), "utf8");
const mapping = readFileSync(join(__dirname, "./mapping.xml"), "utf8");

function parseWire(xml) {
    assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(xml), "Fixture rejects DTD input");
    const fail = (message) => { throw new Error(message); };
    return new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } })
        .parseFromString(xml, "application/xml");
}

function one(parent, namespace, name) {
    const nodes = parent.getElementsByTagNameNS(namespace, name);
    assert.equal(nodes.length, 1, `Exactly one {${namespace}}${name}`);
    return nodes.item(0);
}

function children(node) {
    return Array.from({ length: node.childNodes.length }, (_, i) => node.childNodes.item(i))
        .filter((item) => item.nodeType === 1);
}

function verifySoap(request, body, action, rootNamespace, rootName) {
    assert.equal(request.method, "POST");
    assert.match(request.headers["content-type"], /^application\/soap\+xml\s*;/i);
    assert.ok(request.headers["content-type"].includes(`action="${action}"`));
    assert.equal(request.headers.soapaction, undefined, "SOAP 1.2 uses Content-Type action");
    const document = parseWire(body);
    assert.equal(document.documentElement.namespaceURI, SOAP);
    assert.equal(document.documentElement.localName, "Envelope");
    assert.equal(one(document, WSA, "Action").textContent, action);
    assert.equal(one(document, WSA, "To").textContent,
        `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}${request.url}`);
    const nativeBody = one(document, SOAP, "Body");
    assert.equal(children(nativeBody).length, 1);
    const root = children(nativeBody)[0];
    assert.equal(root.namespaceURI, rootNamespace);
    assert.equal(root.localName, rootName);
    return { document, root };
}

function verifyInformation(request, body) {
    const result = verifySoap(request, body,
        "http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation",
        DEVICE, "GetDeviceInformation");
    assert.equal(children(result.root).length, 0);
    assert.equal(result.root.textContent, "", "Empty input must still send the request element");
    return result;
}

function reply(response, xml = information, status = 200) {
    response.writeHead(status, { "Content-Type": "application/soap+xml; charset=utf-8" });
    response.end(xml);
}

async function endpoint(handler, tls) {
    const failures = [];
    const requests = [];
    const listener = async (request, response) => {
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
                size += chunk.length;
                assert.ok(size < 2 * 1024 * 1024, "Fixture request bounded");
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString("utf8");
            requests.push({ url: request.url, headers: request.headers, body });
            await handler(request, response, body, requests.length);
        } catch (error) {
            failures.push(error);
            response.writeHead(500);
            response.end("Independent fixture assertion failed");
        }
    };
    const server = tls ? https.createServer(tls, listener) : http.createServer(listener);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
    return {
        origin,
        url: `${origin}/onvif/device_service`,
        requests,
        async close() {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            if (failures.length) throw new AggregateError(failures, "Independent endpoint assertions");
        }
    };
}

function expandedValue(node, value) {
    const [prefix, name] = value.includes(":") ? value.split(":") : ["", value];
    return [node.lookupNamespaceURI(prefix || null) || "", name];
}

function infoset(node) {
    if (node.nodeType === 9) return infoset(node.documentElement);
    const attributes = [];
    for (let i = 0; i < node.attributes.length; i++) {
        const attribute = node.attributes.item(i);
        if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
        const isQName = attribute.localName === "mode" || attribute.localName === "type";
        attributes.push([attribute.namespaceURI || "", attribute.localName,
            isQName ? expandedValue(node, attribute.value) : attribute.value]);
    }
    attributes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const content = [];
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes.item(i);
        if (child.nodeType === 1) content.push(infoset(child));
        else if ((child.nodeType === 3 || child.nodeType === 4) && child.data.trim()) {
            content.push(node.localName === "Kind" ? expandedValue(node, child.data) : child.data);
        } else if (child.nodeType === 8) content.push({ comment: child.data });
        else if (child.nodeType === 7) content.push({ target: child.target, data: child.data });
    }
    return { name: [node.namespaceURI || "", node.localName], attributes, content };
}

module.exports = {
    SOAP, WSA, DEVICE, information, fault, mapping, parseWire, one, children,
    verifySoap, verifyInformation, reply, endpoint, infoset
};
