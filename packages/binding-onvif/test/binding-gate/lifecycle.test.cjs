const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { createOnvifRuntime, defineOperationRegistry, readEndpointReference } = require("../../dist");
const fixtures = require("../fixtures/operations.cjs");
const wire = require("../fixtures/endpoint.cjs");

async function setup(t, loseCleanup = false) {
    let release;
    let started;
    const cleanupStarted = new Promise((resolve) => { started = resolve; });
    const cleanupAllowed = new Promise((resolve) => { release = resolve; });
    let released = 0;
    const server = await wire.endpoint(async (request, response, body) => {
        if (request.url === "/subscription?id=0007") {
            const { document } = wire.verifySoap(request, body,
                "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest",
                "http://docs.oasis-open.org/wsn/b-2", "Unsubscribe");
            const id = wire.one(document, "urn:wot-av:test:subscription", "Identifier");
            assert.equal(id.textContent, "00070009");
            assert.equal(id.getAttributeNS(wire.WSA, "IsReferenceParameter"), "true");
            assert.equal(id.getAttributeNS("urn:wot-av:test:scope", "kind"), "k:Door");
            assert.equal(id.lookupNamespaceURI("k"), "urn:wot-av:test:scope");
            assert.equal(wire.one(id, "urn:wot-av:test:scope", "Nested").getAttribute("code"), "0009");
            assert.equal(id.parentNode.localName, "Header");
            started();
            await cleanupAllowed;
            released++;
            if (loseCleanup) request.socket.destroy();
            else wire.reply(response,
                '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><UnsubscribeResponse xmlns="http://docs.oasis-open.org/wsn/b-2"/></s:Body></s:Envelope>');
        } else {
            wire.verifySoap(request, body,
                "http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest",
                "http://www.onvif.org/ver10/events/wsdl", "CreatePullPointSubscription");
            wire.reply(response, `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>
<e:CreatePullPointSubscriptionResponse xmlns:e="http://www.onvif.org/ver10/events/wsdl">
<e:SubscriptionReference xmlns:a="http://www.w3.org/2005/08/addressing">
<a:Address>${server.origin}/subscription?id=0007</a:Address>
<a:ReferenceParameters><p:Identifier xmlns:p="urn:wot-av:test:subscription" xmlns:k="urn:wot-av:test:scope" k:kind="k:Door">0007<k:Nested code="0009">0009</k:Nested></p:Identifier></a:ReferenceParameters>
<a:Metadata><fixture xmlns="urn:wot-av:test:metadata">retained</fixture></a:Metadata>
</e:SubscriptionReference>
<n:CurrentTime xmlns:n="http://docs.oasis-open.org/wsn/b-2">2026-09-15T10:00:00.123456789Z</n:CurrentTime>
<n:TerminationTime xmlns:n="http://docs.oasis-open.org/wsn/b-2">2026-09-15T10:01:00Z</n:TerminationTime>
</e:CreatePullPointSubscriptionResponse>
</s:Body></s:Envelope>`);
        }
    });
    t.after(() => { release(); return server.close(); });
    const runtime = await createOnvifRuntime({
        registry: defineOperationRegistry(fixtures.operations),
        trust: { allowedOrigins: [server.origin] }, timeoutMs: 3000
    });
    const thing = await runtime.consume(fixtures.td(server.url));
    const result = await (await thing.invokeAction("createSubscription")).value();
    assert.equal(result.CurrentTime, "2026-09-15T10:00:00.123456789Z");
    assert.equal(result.TerminationTime, "2026-09-15T10:01:00Z");
    const endpoint = readEndpointReference(result.SubscriptionReference);
    assert.equal(endpoint.referenceParameters.length, 1);
    assert.ok(JSON.stringify(endpoint.xml).includes("retained"), "Complete EPR metadata retained");
    const subscription = runtime.manageSubscription(thing, { endpoint, unsubscribeAction: "unsubscribe" });
    return { runtime, thing, subscription, release, cleanupStarted, released: () => released, server };
}

test("gate: managed subscription stop/close await delayed native Unsubscribe with exact EPR reference parameters", { timeout: 15000 }, async (t) => {
    const state = await setup(t);
    t.after(() => state.runtime.close());
    let settled = false;
    const stop = state.subscription.stop().then(() => { settled = true; });
    const sameStop = state.subscription.close();
    await state.cleanupStarted;
    await delay(30);
    assert.equal(settled, false, "Do not inherit node-wot's fire-and-forget event stop");
    assert.equal(state.subscription.state, "closing");
    assert.equal(state.released(), 0);
    state.release();
    await Promise.all([stop, sameStop]);
    assert.equal(state.subscription.state, "closed");
    assert.equal(state.released(), 1);
    await state.subscription.stop();
    assert.equal(state.server.requests.length, 2, "No duplicate cleanup");
});

test("gate: runtime close drains owned native cleanup before resolving and forbids new interactions", { timeout: 15000 }, async (t) => {
    const state = await setup(t);
    let settled = false;
    const closing = state.runtime.close().then(() => { settled = true; });
    await state.cleanupStarted;
    await delay(30);
    assert.equal(settled, false);
    await assert.rejects(state.thing.invokeAction("information"), { code: "RuntimeClosed" });
    state.release();
    await closing;
    assert.equal(state.subscription.state, "closed");
    assert.equal(state.released(), 1);
    await state.runtime.close();
});

test("gate: lost cleanup surfaces uncertainty; repeated close never replays Unsubscribe", { timeout: 15000 }, async (t) => {
    const state = await setup(t, true);
    const closing = state.runtime.close();
    const rejected = assert.rejects(closing, (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0].code, "OutcomeUnknown");
        return true;
    });
    await state.cleanupStarted;
    state.release();
    await rejected;
    assert.equal(state.subscription.state, "uncertain");
    await assert.rejects(state.runtime.close(), AggregateError);
    assert.equal(state.released(), 1);
    assert.equal(state.server.requests.length, 2);
});
