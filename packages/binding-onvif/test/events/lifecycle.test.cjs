const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { ConsumedThing } = require("@node-wot/core");
const f = require("./native-fixture.cjs");
const { canonicalTopicFilter } = require("./.compiled/events/contracts");
const { parseXml, serializeXml } = require("./.compiled/xml/parser");
const { decodeElement, encodeElement } = require("./.compiled/xml/mapper");
const { infoset, dom } = require("./source-helpers.cjs");
const options = { pullTimeoutMs: 50, minimumPollIntervalMs: 10, requestGraceMs: 100, cleanupTimeoutMs: 500 };
const delivered = (signal, managed) => Promise.race([signal.promise, managed.stopPromise.then(() => {
    throw new Error("Native subscription ended before the expected notification");
})]);

test("events: generated TD uses real node-wot subscribe, ordered TopicSet, creation data and awaited EPR cleanup", { timeout: 15000 }, async (t) => {
    const cleanup = f.deferred(), started = f.deferred(), received = f.deferred();
    const state = await f.setup(t, {
        initialLeaseMs: 1000, messages: [f.notification()], release: cleanup.resolve,
        CreatePullPointSubscription: (call) => {
            assert.equal(f.one(call.native, f.E, "InitialTerminationTime").textContent, "PT25S");
            const topic = f.one(call.native, f.N, "TopicExpression");
            assert.equal(topic.textContent, "a:Door|a:Access/Denied");
            assert.equal(topic.lookupNamespaceURI("a"), "urn:independent:access");
        },
        Unsubscribe: async () => { started.resolve(); await cleanup.promise; }
    });
    const properties = await state.runtime.execute(state.thing, "properties", {});
    assert.equal(properties.value.FixedTopicSet, false);
    assert.deepEqual(properties.value.MessageContentFilterDialect, [""]);
    assert.deepEqual(infoset(dom(serializeXml(encodeElement(f.operation(f.E, "GetEventProperties").response,
        properties.value, f.catalog.xml)))), infoset(dom(f.topicProperties)));
    const sourceTd = JSON.stringify(state.td);
    let coreCalls = 0;
    const subscribe = ConsumedThing.prototype.subscribeEvent;
    // Wrap a fresh owner while instrumenting the released method, not a fake protocol client.
    ConsumedThing.prototype.subscribeEvent = function (...args) { coreCalls++; return subscribe.apply(this, args); };
    let thing;
    try { thing = await state.runtime.consume(state.td); }
    finally { ConsumedThing.prototype.subscribeEvent = subscribe; }
    assert.ok(thing instanceof ConsumedThing);
    const managed = await thing.subscribeEvent("notifications", async (output) => received.resolve(await output.value()), undefined, {
        data: {
            Filter: canonicalTopicFilter({ expression: "a:Door|a:Access/Denied", namespaces: { a: "urn:independent:access" } }, f.registry),
            InitialTerminationTime: { $member: "{http://www.w3.org/2001/XMLSchema}duration", $value: "PT25S" }
        }
    });
    const message = await delivered(received, managed);
    assert.equal(coreCalls, 1);
    assert.deepEqual(message.Topic.$children.map((node) => node.kind), ["text", "comment", "processing-instruction"]);
    assert.equal(message.Topic.$namespaces.a, "urn:independent:access");
    assert.equal(JSON.stringify(state.td), sourceTd);
    assert.ok(!state.calls.some((call) => call.name === "Renew"), "Short initial lease alone must not authorize WS-N Renew");
    let settled = false;
    const stopping = managed.stop().then(() => { settled = true; });
    await started.promise;
    await delay(20);
    assert.equal(settled, false);
    assert.equal(managed.state, "closing");
    cleanup.resolve();
    await Promise.all([stopping, managed.close(), managed.stopPromise]);
    assert.equal(managed.state, "closed");
    await managed.stop();
    assert.equal(managed.state, "closed", "Idempotent stop preserves terminal state");
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
    assert.equal(state.peakPulls, 1);
    assert.equal(managed.delivered, 1);
});

test("events: conditional WS-N Renew and synchronization use native union inputs and imported response order", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { initialLeaseMs: 500, renewWithoutCurrentTime: true, messages: [f.notification("0008")],
        Renew: (call) => assert.equal(f.one(call.native, f.N, "TerminationTime").textContent, "PT45S") });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications",
        async (output) => received.resolve(await output.value()), undefined,
        { ...options, synchronize: true, renewal: { supported: true, duration: "PT45S", marginMs: 1000 } });
    await delivered(received, managed);
    await managed.stop();
    assert.deepEqual(state.calls.slice(0, 4).map((call) => call.name),
        ["CreatePullPointSubscription", "SetSynchronizationPoint", "Renew", "PullMessages"]);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "SubscriptionRenewed"));
    assert.equal(state.peakPulls, 1);
});

test("events: explicit rejected native maxima allow zero timeout and true empty pulls without fabricated notifications", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { messages: ["", "", f.notification("0003")],
        PullMessages: (call) => {
            if (call.ordinal !== 1) return;
            f.reply(call.response, f.fault(`<e:PullMessagesFaultResponse xmlns:e="${f.E}"><e:MaxTimeout>PT0S</e:MaxTimeout><e:MaxMessageLimit>1</e:MaxMessageLimit></e:PullMessagesFaultResponse>`, "InvalidArgVal", "http://www.onvif.org/ver10/error"), 400);
            return false;
        } });
    let count = 0;
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", async (output) => {
        count++; received.resolve(await output.value());
    }, undefined, { ...options, messageLimit: 12 });
    await delivered(received, managed);
    await managed.stop();
    assert.equal(count, 1);
    const pulls = state.calls.filter((call) => call.name === "PullMessages");
    assert.deepEqual(pulls.slice(0, 3).map((call) => [call.timeout, call.limit]), [["PT0.05S", 12], ["PT0S", 1], ["PT0S", 1]]);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "ServerRequestLimits"));
    assert.equal(state.peakPulls, 1);
});

test("events: unknown stateful pull outcome is not replayed or disguised as an empty timeout", { timeout: 10000 }, async (t) => {
    const errors = [];
    const state = await f.setup(t, { PullMessages: (call) => { call.request.socket.destroy(); return false; } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => assert.fail("No message"),
        (error) => { errors.push(error); }, { ...options, restartOnExpiry: true });
    await assert.rejects(managed.stopPromise, { code: "OutcomeUnknown", execution: "unknown" });
    state.expectedCloseFailure = true;
    assert.deepEqual(state.calls.map((call) => call.name), ["CreatePullPointSubscription", "PullMessages", "Unsubscribe"]);
    assert.equal(errors.length, 1);
    assert.equal(managed.state, "failed");
    assert.ok(managed.diagnostics.some((entry) => entry.code === "PullFailed" && entry.severity === "gap"));
});

test("events: ResourceUnknown reboot starts a bounded new generation and records a continuity gap", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { messages: ["", f.notification("0022")], PullMessages: (call) => {
        if (call.ordinal !== 1) return;
        f.reply(call.response, f.fault(), 400);
        return false;
    } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", async (output) => received.resolve(await output.value()),
        undefined, { ...options, restartOnExpiry: true, maxRestarts: 1 });
    await delivered(received, managed);
    await managed.stop();
    assert.equal(managed.generation, 2);
    assert.equal(state.calls.filter((call) => call.name === "CreatePullPointSubscription").length, 2);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1, "Already absent resource is not replayed");
    assert.ok(managed.diagnostics.some((entry) => entry.code === "ResourceUnknownOrReboot" && entry.severity === "gap"));
});

test("events: expired initial lease stops explicitly without silently restarting", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t, { initialLeaseMs: -1000 });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => assert.fail("No message"), undefined, options);
    await assert.rejects(managed.stopPromise, { code: "OutcomeUnknown" });
    state.expectedCloseFailure = true;
    assert.deepEqual(state.calls.map((call) => call.name), ["CreatePullPointSubscription", "Unsubscribe"]);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "LeaseExpired"));
});

test("events: malformed known message is a typed failure, not an empty event", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t, { messages: [f.notification().replace(' UtcTime="2026-09-16T03:11:12.123456789Z"', "")] });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => assert.fail("Invalid payload"), undefined, options);
    await assert.rejects(managed.stopPromise, { code: "InvalidValue", execution: "unknown" });
    state.expectedCloseFailure = true;
    assert.equal(state.calls.filter((call) => call.name === "PullMessages").length, 1);
});

for (const mode of ["reject", "timeout"]) {
    test(`events: asynchronous listener ${mode} is observed and owned cleanup remains bounded`, { timeout: 10000 }, async (t) => {
        const state = await f.setup(t, { messages: [f.notification()] });
        const managed = await state.runtime.subscribeEvent(state.thing, "notifications", async (output) => {
            await output.value();
            if (mode === "reject") throw new Error("independent-listener-failure");
            await new Promise(() => {});
        }, undefined, { ...options, deliveryTimeoutMs: 40 });
        await assert.rejects(managed.stopPromise, mode === "reject" ? /independent-listener-failure/ : { code: "OutcomeUnknown" });
        state.expectedCloseFailure = true;
        assert.ok(managed.diagnostics.some((entry) => entry.code === "DeliveryFailed"));
        assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
    });
}

test("events: listener can await its own stop without losing awaited remote cleanup", { timeout: 10000 }, async (t) => {
    const ended = f.deferred();
    const state = await f.setup(t, { messages: [f.notification()] });
    let managed;
    managed = await state.runtime.subscribeEvent(state.thing, "notifications", async (output) => {
        await output.value();
        await managed.stop();
        ended.resolve();
    }, undefined, options);
    await delivered(ended, managed);
    await managed.stopPromise;
    assert.equal(managed.state, "closed");
    assert.equal(managed.delivered, 1);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
});

test("events: runtime close awaits in-flight creation and delayed native cleanup and rejects new work", { timeout: 10000 }, async (t) => {
    const creating = f.deferred(), allowCreate = f.deferred(), cleanup = f.deferred(), allowCleanup = f.deferred();
    const state = await f.setup(t, {
        release: () => { allowCreate.resolve(); allowCleanup.resolve(); },
        CreatePullPointSubscription: async () => { creating.resolve(); await allowCreate.promise; },
        Unsubscribe: async () => { cleanup.resolve(); await allowCleanup.promise; }
    });
    const subscribing = state.runtime.subscribeEvent(state.thing, "notifications", () => {}, undefined, options);
    await creating.promise;
    let closed = false;
    const closing = state.runtime.close().then(() => { closed = true; });
    await assert.rejects(state.thing.invokeAction("properties"), { code: "RuntimeClosed" });
    await delay(10);
    assert.equal(closed, false);
    allowCreate.resolve();
    const managed = await subscribing;
    await cleanup.promise;
    await delay(10);
    assert.equal(closed, false);
    allowCleanup.resolve();
    await closing;
    assert.equal(managed.state, "closed");
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
});

test("events: lost Unsubscribe is uncertain and repeated stop/runtime close never replay it", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { messages: [f.notification()],
        Unsubscribe: (call) => { call.request.socket.destroy(); return false; } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => received.resolve(), undefined, options);
    await delivered(received, managed);
    await assert.rejects(managed.stop(), { code: "OutcomeUnknown" });
    await assert.rejects(managed.close(), { code: "OutcomeUnknown" });
    state.expectedCloseFailure = true;
    assert.equal(managed.state, "uncertain");
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
});

test("events: TopicFilter rejects missing namespaces, ambiguous input and undeclared dialect before creation", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t);
    for (const extra of [
        { topicFilter: { expression: "a:Door", namespaces: {} } },
        { topicFilter: { expression: "Door", namespaces: {}, dialect: "urn:unqualified" } },
        { input: { Filter: {} }, topicFilter: { expression: "Door", namespaces: {} } },
        { pullTimeoutMs: -1 }, { messageLimit: 1025 }, { renewal: { supported: false } }
    ]) await assert.rejects(state.runtime.subscribeEvent(state.thing, "notifications", () => {}, undefined, { ...options, ...extra }));
    assert.equal(state.server.requests.length, 0);
    const filter = canonicalTopicFilter({ expression: "Door", namespaces: {} }, f.registry);
    const xml = serializeXml(encodeElement(f.registry.xml.elements[`{${f.N}}Filter`], filter, f.registry.xml));
    assert.equal(f.one(f.parseWire(xml), f.N, "TopicExpression").textContent, "Door");
    assert.equal(parseXml(xml).name.namespace, f.N);
});

test("events: external cancellation aborts a pending pull but not its awaited Unsubscribe", { timeout: 10000 }, async (t) => {
    const pending = f.deferred(), abort = new AbortController();
    const state = await f.setup(t, { PullMessages: () => { pending.resolve(); return false; } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => assert.fail("Cancelled drain"), undefined,
        { ...options, signal: abort.signal });
    await pending.promise;
    abort.abort();
    await managed.stopPromise;
    assert.equal(managed.state, "closed");
    assert.equal(managed.delivered, 0);
    assert.deepEqual(state.calls.map((call) => call.name), ["CreatePullPointSubscription", "PullMessages", "Unsubscribe"]);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "PullCancelled" && entry.severity === "gap"));
});

test("events: already-aborted creation, excessive options and undeclared lifecycle tuple never send", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t), abort = new AbortController();
    abort.abort();
    await assert.rejects(state.runtime.subscribeEvent(state.thing, "notifications", () => {}, undefined,
        { ...options, signal: abort.signal }), { code: "RuntimeClosed" });
    for (const extra of [{ maxQueuedMessages: 4097 }, { maxQueuedBytes: 16777217 }, { maxRestarts: 11 }, { deliveryTimeoutMs: 300001 }]) {
        await assert.rejects(state.runtime.subscribeEvent(state.thing, "notifications", () => {}, undefined, { ...options, ...extra }));
    }
    const bad = structuredClone(state.td);
    bad.events.notifications.forms[0]["onvif:subscription"].pull.operation = "Seek";
    await assert.rejects(state.runtime.consume(bad), { code: "InvalidRegistry" });
    assert.equal(state.server.requests.length, 0);
});

for (const bound of ["messages", "bytes"]) {
    test(`events: bounded notification ${bound} overflow reports a gap and closes instead of silently dropping`, { timeout: 10000 }, async (t) => {
        const state = await f.setup(t, { messages: [f.notification("0001") + f.notification("0002")] });
        const managed = await state.runtime.subscribeEvent(state.thing, "notifications", async (output) => { await output.value(); await delay(5); },
            undefined, { ...options, ...(bound === "messages" ? { maxQueuedMessages: 1 } : { maxQueuedBytes: 10 }) });
        await assert.rejects(managed.stopPromise, { code: "XmlLimit" });
        state.expectedCloseFailure = true;
        assert.ok(managed.diagnostics.some((entry) => entry.code === "DeliveryOverflow" && entry.severity === "gap"));
        assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
    });
}

test("events: server clock regression is exposed as a gap without rewriting native lexical timing", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { clockOffset: -10000, messages: [f.notification()] });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => received.resolve(), undefined, options);
    await delivered(received, managed);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "ServerClockRegression" && entry.severity === "gap"));
    assert.match(managed.lease.currentTime, /^2026-09-16T02:59:5/);
    assert.equal(managed.lease.basis, "server-current-time");
    await managed.stop();
});

test("events: an exhausted reboot budget does not replay creation or cleanup of an already absent EPR", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t, { PullMessages: (call) => { f.reply(call.response, f.fault(), 400); return false; } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => {}, undefined,
        { ...options, restartOnExpiry: true, maxRestarts: 1 });
    await assert.rejects(managed.stopPromise, { code: "OutcomeUnknown" });
    state.expectedCloseFailure = true;
    assert.equal(state.calls.filter((call) => call.name === "CreatePullPointSubscription").length, 2);
    assert.equal(state.calls.filter((call) => call.name === "PullMessages").length, 2);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 0);
});

test("events: separate Event names sharing an endpoint own distinct EPRs and can resubscribe after confirmed stop", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t), td = structuredClone(state.td);
    td.events.other = structuredClone(td.events.notifications);
    const thing = await state.runtime.consume(td);
    const [first, second] = await Promise.all([
        state.runtime.subscribeEvent(thing, "notifications", () => {}, undefined, options),
        state.runtime.subscribeEvent(thing, "other", () => {}, undefined, options)
    ]);
    await assert.rejects(state.runtime.subscribeEvent(thing, "notifications", () => {}, undefined, options), /already/);
    await Promise.all([first.stop(), second.stop()]);
    const third = await state.runtime.subscribeEvent(thing, "notifications", () => {}, undefined, options);
    await third.stop();
    const eprs = state.calls.filter((call) => call.name === "Unsubscribe").map((call) => call.url);
    assert.equal(eprs.length, 3);
    assert.equal(new Set(eprs).size, 3);
});

test("events: 64-subscription capacity includes concurrent creation reservations and rejects the next one before send", { timeout: 30000 }, async (t) => {
    const state = await f.setup(t), td = structuredClone(state.td);
    const names = Array.from({ length: 65 }, (_, index) => `event${index}`);
    td.events = Object.fromEntries(names.map((name) => [name, structuredClone(td.events.notifications)]));
    const thing = await state.runtime.consume(td);
    const results = await Promise.allSettled(names.map((name) => state.runtime.subscribeEvent(thing, name, () => {}, undefined,
        { ...options, pullTimeoutMs: 0, minimumPollIntervalMs: 1000, requestGraceMs: 5000, cleanupTimeoutMs: 5000 })));
    const accepted = results.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
    const rejected = results.filter((entry) => entry.status === "rejected");
    await Promise.all(accepted.map((entry) => entry.stop()));
    assert.equal(accepted.length, 64);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "InvalidValue");
    assert.equal(state.calls.filter((call) => call.name === "CreatePullPointSubscription").length, 64);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 64);
});

test("events: selected nonzero Form and canonical cancellation data retain the owned EPR instead of retargeting cleanup", { timeout: 10000 }, async (t) => {
    const state = await f.setup(t, { Unsubscribe: (call) => {
        assert.equal(f.one(call.native, "urn:independent:cancellation", "Reason").textContent, "0007");
    } });
    const td = structuredClone(state.td), form = structuredClone(td.events.notifications.forms[0]);
    form.href = `${state.server.origin}/events-alternative`;
    td.events.notifications.forms.push(form);
    const thing = await state.runtime.consume(td);
    const managed = await state.runtime.subscribeEvent(thing, "notifications", () => {}, undefined, { ...options, formIndex: 1 });
    await assert.rejects(managed.stop({ formIndex: 0 }), { code: "UnsupportedCapability", execution: "not-sent" });
    await assert.rejects(managed.stop({ formIndex: 1, data: { Invalid: true } }), { code: "InvalidValue", execution: "not-sent" });
    assert.equal(managed.active, true);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 0);
    const unsubscribe = f.catalog.operations.find((operation) => operation.bindingQName.localName === "PullPointSubscriptionBinding" && operation.operation === "Unsubscribe");
    const data = decodeElement(unsubscribe.request, parseXml(`<n:Unsubscribe xmlns:n="${f.N}"><c:Reason xmlns:c="urn:independent:cancellation">0007</c:Reason></n:Unsubscribe>`), f.catalog.xml);
    await managed.stop({ formIndex: 1, data });
    assert.equal(state.calls[0].url, "/events-alternative");
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
});

test("events: expired lease recovery confirms old cleanup before creating a replacement subscription", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const config = { initialLeaseMs: -1000, messages: [f.notification()],
        Unsubscribe: () => { config.initialLeaseMs = 60000; } };
    const state = await f.setup(t, config);
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => received.resolve(), undefined,
        { ...options, restartOnExpiry: true, maxRestarts: 1 });
    await delivered(received, managed);
    await managed.stop();
    assert.deepEqual(state.calls.slice(0, 4).map((call) => call.name),
        ["CreatePullPointSubscription", "Unsubscribe", "CreatePullPointSubscription", "PullMessages"]);
    assert.equal(managed.generation, 2);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 2);
    assert.ok(managed.diagnostics.some((entry) => entry.code === "LeaseExpired" && entry.severity === "gap"));
});

test("events: a confirmed reboot during conditional Renew uses the same bounded gap recovery as PullMessages", { timeout: 10000 }, async (t) => {
    const received = f.deferred();
    const state = await f.setup(t, { initialLeaseMs: 500, messages: [f.notification()],
        Renew: (call) => {
            if (state.calls.filter((entry) => entry.name === "Renew").length !== 1) return;
            state.config.initialLeaseMs = 60000;
            f.reply(call.response, f.fault(), 400);
            return false;
        } });
    const managed = await state.runtime.subscribeEvent(state.thing, "notifications", () => received.resolve(), undefined,
        { ...options, restartOnExpiry: true, maxRestarts: 1, renewal: { supported: true, marginMs: 1000 } });
    await delivered(received, managed);
    await managed.stop();
    assert.deepEqual(state.calls.slice(0, 4).map((call) => call.name),
        ["CreatePullPointSubscription", "Renew", "CreatePullPointSubscription", "PullMessages"]);
    assert.equal(managed.generation, 2);
    assert.equal(state.calls.filter((call) => call.name === "Unsubscribe").length, 1);
});
