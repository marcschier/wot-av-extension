const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const wire = require("../fixtures/endpoint.cjs");
const { compileCatalog } = require("./.compiled/catalog/compiler");
const { actionTemplate, eventTemplate, context } = require("./.compiled/catalog/models");
const { defineOperationRegistry } = require("./.compiled/binding/registry");
const { createOnvifRuntime } = require("./.compiled/binding/runtime");
const root = resolve(__dirname, "..", "..", "..", "..");
const catalog = compileCatalog({ root });
const registry = defineOperationRegistry(catalog.operations, catalog.xml);
const E = "http://www.onvif.org/ver10/events/wsdl";
const N = "http://docs.oasis-open.org/wsn/b-2";
const BW = "http://docs.oasis-open.org/wsn/bw-2";
const TT = "http://www.onvif.org/ver10/schema";
const TOPIC = "http://docs.oasis-open.org/wsn/t-1";
const actions = {
    CreatePullPointSubscription: `${E}/EventPortType/CreatePullPointSubscriptionRequest`,
    GetEventProperties: `${E}/EventPortType/GetEventPropertiesRequest`,
    PullMessages: `${E}/PullPointSubscription/PullMessagesRequest`,
    SetSynchronizationPoint: `${E}/PullPointSubscription/SetSynchronizationPointRequest`,
    Renew: `${BW}/SubscriptionManager/RenewRequest`,
    Unsubscribe: `${BW}/SubscriptionManager/UnsubscribeRequest`
};
const responseActions = Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, action.replace(/Request$/, "Response")]));
const notification = (id = "0007") => `<n:NotificationMessage xmlns:n="${N}">
<n:Topic Dialect="${TOPIC}/TopicExpression/Concrete" xmlns:a="urn:independent:access">a:Door<!--ordered--><?audit exact?></n:Topic>
<n:Message><tt:Message xmlns:tt="${TT}" UtcTime="2026-09-16T03:11:12.123456789Z" PropertyOperation="Changed"><tt:Source><tt:SimpleItem Name="Token" Value="${id}"/></tt:Source><tt:Data><tt:SimpleItem Name="LogicalState" Value="Denied"/></tt:Data></tt:Message></n:Message>
</n:NotificationMessage>`;
const topicProperties = `<e:GetEventPropertiesResponse xmlns:e="${E}" xmlns:n="${N}" xmlns:t="${TOPIC}" xmlns:a="urn:independent:access">
<e:TopicNamespaceLocation>urn:independent:access</e:TopicNamespaceLocation><n:FixedTopicSet>false</n:FixedTopicSet>
<t:TopicSet><a:Door t:topic="true"><tt:MessageDescription xmlns:tt="${TT}" IsProperty="true"><tt:Source><tt:SimpleItemDescription Name="Token" Type="tt:ReferenceToken"/></tt:Source><tt:Data><tt:SimpleItemDescription xmlns:xs="http://www.w3.org/2001/XMLSchema" Name="LogicalState" Type="xs:string"/></tt:Data></tt:MessageDescription></a:Door><a:Extension>ordered</a:Extension></t:TopicSet>
<n:TopicExpressionDialect>${TOPIC}/TopicExpression/Concrete</n:TopicExpressionDialect><e:MessageContentFilterDialect/>
<e:MessageContentSchemaLocation>http://www.onvif.org/ver10/schema</e:MessageContentSchemaLocation>
</e:GetEventPropertiesResponse>`;
function envelope(payload, action, namespace = wire.WSA) {
    return `<s:Envelope xmlns:s="${wire.SOAP}" xmlns:a="${namespace}">${action ? `<s:Header><a:Action>${action}</a:Action></s:Header>` : ""}<s:Body>${payload}</s:Body></s:Envelope>`;
}
function fault(detail = "", subcode = "ResourceUnknown", namespace = "http://docs.oasis-open.org/wsrf/r-2") {
    return envelope(`<s:Fault xmlns:s="${wire.SOAP}" xmlns:f="${namespace}"><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>f:${subcode}</s:Value></s:Subcode></s:Code><s:Reason><s:Text xml:lang="en">Independent rejection</s:Text></s:Reason>${detail ? `<s:Detail>${detail}</s:Detail>` : ""}</s:Fault>`);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function until(predicate) {
    const deadline = Date.now() + 4000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, "Independent fixture condition reached its deadline");
        await delay(5);
    }
}
function operation(namespace, name, binding) {
    const found = catalog.operations.filter((entry) => entry.serviceNamespace === namespace && entry.operation === name
        && (binding === undefined || entry.bindingQName.localName === binding));
    assert.equal(found.length, 1, `${namespace} ${name} ${binding ?? ""}`);
    return found[0];
}
function description(href) {
    return { "@context": context(), id: "urn:independent:native-event-device", title: "Independent native Event fixture",
        securityDefinitions: { none: { scheme: "nosec" } }, security: ["none"], "onvif:registryDigest": registry.digest,
        actions: { properties: actionTemplate(operation(E, "GetEventProperties"), catalog, href) },
        events: { notifications: eventTemplate(catalog, href) } };
}
async function setup(t, config = {}) {
    const calls = [];
    let activePulls = 0, peakPulls = 0, creates = 0, pulls = 0;
    const base = Date.parse("2026-09-16T03:00:00Z"), started = Date.now();
    const timestamp = (offset = 0) => new Date(base + Date.now() - started + offset).toISOString();
    const server = await wire.endpoint(async (request, response, body) => {
        const xml = wire.parseWire(body), native = wire.children(wire.one(xml, wire.SOAP, "Body"))[0];
        const name = native.localName;
        assert.ok(Object.hasOwn(actions, name), `No unrelated or physical control operation: ${name}`);
        const { document } = wire.verifySoap(request, body, actions[name], ["Renew", "Unsubscribe"].includes(name) ? N : E, name);
        const call = { name, document, native, url: request.url, request, response };
        calls.push(call);
        if (["PullMessages", "Renew", "Unsubscribe", "SetSynchronizationPoint"].includes(name)) {
            assert.match(request.url, /^\/subscription\?id=\d{4}&scope=A%2BB%2F$/);
            const ref = wire.one(document, "urn:independent:epr", "Identifier");
            assert.equal(ref.textContent, "00070009");
            assert.equal(ref.parentNode.localName, "Header");
            assert.equal(ref.getAttributeNS(wire.WSA, "IsReferenceParameter"), "true");
            assert.equal(ref.getAttributeNS("urn:independent:scope", "kind"), "k:Door");
            assert.equal(ref.lookupNamespaceURI("k"), "urn:independent:scope");
        }
        if (name === "CreatePullPointSubscription") {
            creates++;
            call.ordinal = creates;
        }
        if (name === "PullMessages") {
            call.ordinal = ++pulls;
            call.timeout = wire.one(native, E, "Timeout").textContent;
            call.limit = Number(wire.one(native, E, "MessageLimit").textContent);
            activePulls++;
            peakPulls = Math.max(peakPulls, activePulls);
        }
        try {
            const custom = await config[name]?.(call, { server, creates, pulls, timestamp });
            if (custom === false) return;
            if (name === "CreatePullPointSubscription") {
                wire.reply(response, envelope(`<e:CreatePullPointSubscriptionResponse xmlns:e="${E}" xmlns:n="${N}" xmlns:a="${wire.WSA}">
<e:SubscriptionReference><a:Address>${server.origin}/subscription?id=${String(creates).padStart(4, "0")}&amp;scope=A%2BB%2F</a:Address>
<a:ReferenceParameters><p:Identifier xmlns:p="urn:independent:epr" xmlns:k="urn:independent:scope" k:kind="k:Door">0007<k:Nested code="0009">0009</k:Nested></p:Identifier></a:ReferenceParameters><a:Metadata><p:Metadata xmlns:p="urn:independent:epr">retained</p:Metadata></a:Metadata></e:SubscriptionReference>
<n:CurrentTime>${timestamp()}</n:CurrentTime><n:TerminationTime>${timestamp(config.initialLeaseMs ?? 60000)}</n:TerminationTime>
</e:CreatePullPointSubscriptionResponse>`, responseActions[name]));
            } else if (name === "PullMessages") {
                await delay(config.pullDelayMs ?? 5);
                wire.reply(response, envelope(`<e:PullMessagesResponse xmlns:e="${E}"><e:CurrentTime>${timestamp(config.clockOffset ?? 0)}</e:CurrentTime><e:TerminationTime>${timestamp(config.pullLeaseMs ?? 60000)}</e:TerminationTime>${config.messages?.[pulls - 1] ?? ""}</e:PullMessagesResponse>`, responseActions[name]));
            } else if (name === "Renew") {
                wire.reply(response, envelope(`<n:RenewResponse xmlns:n="${N}"><n:TerminationTime>${timestamp(60000)}</n:TerminationTime>${config.renewWithoutCurrentTime ? "" : `<n:CurrentTime>${timestamp()}</n:CurrentTime>`}</n:RenewResponse>`, responseActions[name]));
            } else if (name === "GetEventProperties") wire.reply(response, envelope(topicProperties, responseActions[name]));
            else wire.reply(response, envelope(`<${name}Response xmlns="${name === "Unsubscribe" ? N : E}"/>`, responseActions[name]));
        } finally { if (name === "PullMessages") activePulls--; }
    });
    const runtime = await createOnvifRuntime({ registry, trust: { allowedOrigins: [server.origin] }, timeoutMs: 1000 });
    const td = description(`${server.origin}/events`);
    const thing = await runtime.consume(td);
    const state = { runtime, thing, td, server, calls, config, timestamp, expectedCloseFailure: false, get peakPulls() { return peakPulls; } };
    t.after(async () => {
        config.release?.();
        try {
            if (state.expectedCloseFailure) await assert.rejects(runtime.close(), AggregateError);
            else await runtime.close();
        } finally { await server.close(); }
    });
    return state;
}
module.exports = { ...wire, root, catalog, registry, E, N, BW, TT, TOPIC, actions, responseActions,
    notification, topicProperties, envelope, fault, deferred, until, operation, description, setup };
