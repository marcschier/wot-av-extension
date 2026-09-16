const test = require("node:test");
const assert = require("node:assert/strict");
const { WSDL } = require("soap");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadWsdl(xml) {
    return new Promise((resolve, reject) => {
        const wsdl = new WSDL(xml, "urn:wot-av:test:local-wsdl", {});
        wsdl.onReady((error) => error ? reject(error) : resolve(wsdl));
    });
}

test("candidate: soap 1.12.0 reads service-less WSDL but offers no generated service methods", async () => {
    const xml = readFileSync(join(__dirname, "../../../fixtures/reference-runtime/soap-candidate.wsdl"), "utf8");
    const wsdl = await loadWsdl(xml);
    assert.deepEqual(wsdl.describeServices(), {});
    assert.ok(wsdl.definitions.bindings.CandidateBinding);
    assert.ok(wsdl.definitions.portTypes.CandidatePort);
});

test("candidate: generic node-soap mapping is explicitly disqualified by precision/date loss", async () => {
    const xml = readFileSync(join(__dirname, "../../../fixtures/reference-runtime/soap-candidate.wsdl"), "utf8");
    const service = '<wsdl:service name="ProbeService"><wsdl:port name="ProbePort" binding="t:CandidateBinding"><soap:address location="http://127.0.0.1:1/not-contacted"/></wsdl:port></wsdl:service>';
    const wsdl = await loadWsdl(xml.replace("</wsdl:definitions>", service + "</wsdl:definitions>"));
    const parsed = wsdl.xmlToObject('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><t:ProbeResponse xmlns:t="urn:wot-av:test:candidate"><t:Long>9223372036854775807</t:Long><t:Decimal>12345678901234567890.0012300</t:Decimal><t:Timestamp>2026-09-15T10:11:12.123456789Z</t:Timestamp></t:ProbeResponse></s:Body></s:Envelope>');
    assert.equal(typeof parsed.Body.ProbeResponse.Long, "number");
    assert.notEqual(String(parsed.Body.ProbeResponse.Long), "9223372036854775807");
    assert.equal(typeof parsed.Body.ProbeResponse.Decimal, "number");
    assert.ok(parsed.Body.ProbeResponse.Timestamp instanceof Date);
    assert.equal(parsed.Body.ProbeResponse.Timestamp.toISOString(), "2026-09-15T10:11:12.123Z");
});
