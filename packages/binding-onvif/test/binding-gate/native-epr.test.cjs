const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createOnvifRuntime, defineOperationRegistry } = require("../../dist");
const fixtures = require("../fixtures/operations.cjs");
const wire = require("../fixtures/endpoint.cjs");

const DSA = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
const WSA = "http://www.w3.org/2005/08/addressing";
const EPR = "urn:fixture:logical-epr";
const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object" ? `{${Object.keys(value).sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const header = (name, value) => ({
    kind: "element", name: { namespace: EPR, localName: name }, prefix: "r",
    namespaces: { r: EPR }, attributes: [], children: [{ kind: "text", value }]
});
function identity(endpoint, resource) {
    const key = [endpoint.address, endpoint.referenceProperties];
    return resource === undefined ? `urn:onvif:device:${digest(key)}`
        : `urn:onvif:resource:${digest([...key, resource.serviceNamespace, resource.kind, resource.parentTokens, resource.token])}`;
}
function addressing(endpoint) {
    return { namespace: endpoint.addressingNamespace, to: endpoint.address,
        referenceProperties: structuredClone(endpoint.referenceProperties),
        referenceParameters: structuredClone(endpoint.referenceParameters) };
}

async function fixture(t, { namespace = DSA, address, resource = false } = {}) {
    let expected;
    const scopes = [], credentialScopes = [], runtimes = [];
    const foreign = await wire.endpoint((request, response) => wire.reply(response));
    const server = await wire.endpoint((request, response, body) => {
        assert.equal(request.url, "/onvif/device_service", "Only the physical native endpoint receives SOAP");
        assert.equal(request.method, "POST");
        assert.equal(request.headers.authorization, undefined);
        assert.ok(request.headers["content-type"].includes(`action="${fixtures.DEVICE}/GetDeviceInformation"`));
        const document = wire.parseWire(body);
        const headers = wire.children(wire.one(document, wire.SOAP, "Header"));
        assert.equal(wire.one(document, namespace, "To").textContent, expected.address);
        assert.equal(wire.one(document, namespace, "Action").textContent, `${fixtures.DEVICE}/GetDeviceInformation`);
        assert.deepEqual(headers.map((node) => node.localName), ["Action", "To", "MessageID", "ReplyTo",
            ...expected.referenceProperties.map((node) => node.name.localName),
            ...expected.referenceParameters.map((node) => node.name.localName), "Security"]);
        const retained = headers.filter((node) => node.namespaceURI === EPR);
        assert.deepEqual(retained.map((node) => node.textContent),
            [...expected.referenceProperties, ...expected.referenceParameters].map((node) => node.children[0].value));
        for (const node of retained) {
            assert.equal(node.getAttributeNS(WSA, "IsReferenceParameter"), namespace === WSA ? "true" : "");
        }
        const payload = wire.children(wire.one(document, wire.SOAP, "Body"));
        assert.equal(payload.length, 1);
        assert.equal(payload[0].namespaceURI, fixtures.DEVICE);
        assert.equal(payload[0].localName, "GetDeviceInformation");
        assert.equal(payload[0].textContent, "");
        assert.equal(wire.one(document, WSSE, "Username").textContent, "alice");
        const nonce = Buffer.from(wire.one(document, WSSE, "Nonce").textContent, "base64");
        const created = wire.one(document, WSU, "Created").textContent;
        assert.equal(wire.one(document, WSSE, "Password").textContent,
            createHash("sha1").update(nonce).update(created).update("fixture-only-password").digest("base64"));
        wire.reply(response);
    });
    t.after(async () => {
        await Promise.all(runtimes.map((runtime) => runtime.close()));
        await Promise.all([server.close(), foreign.close()]);
    });
    expected = { address: address?.(server, foreign) ?? "urn:uuid:00000000-0000-4000-8000-000000000001",
        addressingNamespace: namespace,
        referenceProperties: namespace === DSA ? [header("Property", "device-0001"), header("Property", "channel-0002")] : [],
        referenceParameters: [header("Parameter", "lease-0003"), header("Parameter", "route-0004")] };
    const resourceIdentity = resource ? { epr: expected.address, serviceNamespace: fixtures.DEVICE,
        kind: "FixtureResource", parentTokens: [{ kind: "FixtureParent", token: "0001" }], token: "0002", evidence: [] } : undefined;
    const description = fixtures.td(server.url, {
        id: identity(expected, resourceIdentity), securityDefinitions: { native: { scheme: "onvif:UsernameTokenSecurityScheme" } },
        security: ["native"], actions: { information: { forms: [fixtures.form(server.url, fixtures.device, ["native"])] } },
        "onvif:discovery": { endpointReference: {
            address: expected.address, referenceProperties: structuredClone(expected.referenceProperties),
            referenceParameters: structuredClone(expected.referenceParameters)
        }, addressingNamespace: namespace },
        ...(resourceIdentity === undefined ? {} : { "onvif:resourceIdentity": resourceIdentity })
    });
    const expectedId = description.id;
    const authorizeLogicalEndpoint = (scope) => {
        scopes.push(structuredClone(scope));
        assert.equal(Object.isFrozen(scope), true);
        return scope.thingId === expectedId && scope.principal === "alice"
            && scope.href === server.url && scope.origin === server.origin
            && canonical(scope.operation) === canonical(fixtures.reference(fixtures.device))
            && canonical(scope.endpointReference) === canonical(expected);
    };
    const create = async (trust = {}, options = {}) => {
        const runtime = await createOnvifRuntime({
            registry: defineOperationRegistry([fixtures.device]),
            trust: { allowedOrigins: [server.origin], allowedTargets: [server.url],
                principalTargets: { alice: [server.url] }, authorizeLogicalEndpoint, ...trust },
            credentials: async (scope) => {
                credentialScopes.push(scope);
                return { origin: server.origin, principal: scope.principal,
                    material: { kind: "password", username: scope.principal, password: "fixture-only-password" } };
            }, ...options
        });
        runtimes.push(runtime);
        return runtime;
    };
    const noSend = async (work, code = "PolicyDenied") => {
        await assert.rejects(work, { code, execution: "not-sent" });
        assert.equal(server.requests.length, 0, "Denied EPR sends no physical request");
        assert.equal(foreign.requests.length, 0, "Denied EPR sends no alias/cross-service request");
        assert.equal(credentialScopes.length, 0, "Denied EPR does not retrieve credentials");
    };
    return { server, foreign, expected, description, scopes, credentialScopes, create, noSend };
}

for (const namespace of [DSA, WSA]) {
    test(`gate: approved projected logical URN is target/Thing/principal bound with ordered ${namespace} headers`, async (t) => {
        const f = await fixture(t, { namespace });
        const original = structuredClone(f.description), options = { target: f.server.url, addressing: addressing(f.expected) };
        const originalOptions = structuredClone(options);
        const runtime = await f.create();
        const thing = await runtime.consume(f.description, { principal: "alice" });
        assert.equal((await (await runtime.invokeAction(thing, "information", {}, options)).value()).SerialNumber, "000000001");
        assert.equal((await runtime.execute(thing, "information", {}, options)).value.HardwareId, "0000");
        assert.equal(f.server.requests.length, 2);
        assert.equal(f.scopes.length, 2);
        assert.ok(f.credentialScopes.every((scope) => scope.thingId === original.id && scope.principal === "alice"
            && scope.href === f.server.url && scope.origin === f.server.origin && scope.securityName === "native"));
        assert.equal(thing.getThingDescription().id, original.id);
        assert.deepEqual(f.description, original, "Consume/invoke cannot rewrite source TD identity, metadata or security");
        assert.deepEqual(options, originalOptions, "Native headers are not rewritten in caller inputs");
    });
}

test("gate: pre-existing same-Thing logical EPR needs no alias policy", async (t) => {
    const f = await fixture(t);
    f.description.id = f.expected.address;
    const runtime = await f.create({ authorizeLogicalEndpoint: undefined });
    const thing = await runtime.consume(f.description, { principal: "alice" });
    await runtime.execute(thing, "information", {}, { addressing: addressing(f.expected) });
    assert.equal(f.server.requests.length, 1);
    assert.equal(f.scopes.length, 0);
});

const denials = {
    "unapproved alias by default": (f, state) => { state.trust.authorizeLogicalEndpoint = undefined; },
    "explicit policy refusal": (f, state) => { state.trust.authorizeLogicalEndpoint = () => false; },
    "non-boolean policy result": (f, state) => { state.trust.authorizeLogicalEndpoint = () => "allow"; },
    "changed logical URN": (f, state) => { state.options.addressing.to = "urn:uuid:another-device"; },
    "changed addressing namespace": (f, state) => { state.options.addressing.namespace = WSA; },
    "changed reference property": (f, state) => { state.options.addressing.referenceProperties[0].children[0].value = "another-device"; },
    "reordered reference properties": (f, state) => { state.options.addressing.referenceProperties.reverse(); },
    "changed reference parameter": (f, state) => { state.options.addressing.referenceParameters[0].children[0].value = "another-lease"; },
    "reordered reference parameters": (f, state) => { state.options.addressing.referenceParameters.reverse(); },
    "missing expected headers": (f, state) => { delete state.options.addressing.referenceParameters; },
    "Form/override target mismatch even when both authorized": (f, state) => {
        const other = f.server.origin + "/other-native-service";
        state.options.target = other;
        state.trust.allowedTargets.push(other);
        state.trust.principalTargets.alice.push(other);
    },
    "different Form target even when the principal has physical permission": (f, state) => {
        const other = f.server.origin + "/other-native-service";
        state.description.actions.information.forms[0].href = other;
        state.trust.allowedTargets.push(other);
        state.trust.principalTargets.alice.push(other);
    },
    "different principal with the same physical permission": (f, state) => {
        state.principal = "bob";
        state.trust.principalTargets.bob = [f.server.url];
    },
    "principal absent from target policy": (f, state) => { state.principal = "unapproved"; },
    "forged projected Thing digest": (f, state) => { state.description.id = `urn:onvif:device:${"0".repeat(64)}`; },
    "forged EPR address metadata": (f, state) => { state.description["onvif:discovery"].endpointReference.address = "urn:uuid:forged"; },
    "forged identity reference-property metadata": (f, state) => {
        state.description["onvif:discovery"].endpointReference.referenceProperties[0].children[0].value = "forged";
    },
    "forged non-identity parameter metadata and matching request still need policy approval": (f, state) => {
        state.description["onvif:discovery"].endpointReference.referenceParameters[0].children[0].value = "forged";
        state.options.addressing.referenceParameters[0].children[0].value = "forged";
    },
    "raw unverified TD metadata cannot grant an alias": (f, state) => {
        state.description.id = "urn:unverified:thing";
        state.trust.authorizeLogicalEndpoint = () => true;
    },
    "a lookalike TD endpoint field cannot grant an alias": (f, state) => {
        delete state.description["onvif:discovery"];
        state.description["onvif:endpointReference"] = structuredClone(f.expected);
        state.trust.authorizeLogicalEndpoint = () => true;
    },
    "cross-service physical origin": (f, state) => { state.options.target = f.foreign.url; }
};
for (const [name, change] of Object.entries(denials)) {
    test(`gate: logical EPR rejects ${name} before network`, async (t) => {
        const f = await fixture(t);
        const state = { description: structuredClone(f.description), principal: "alice",
            options: { addressing: addressing(f.expected) },
            trust: { allowedTargets: [f.server.url], principalTargets: { alice: [f.server.url] } } };
        change(f, state);
        await f.noSend(async () => {
            const runtime = await f.create(state.trust);
            const thing = await runtime.consume(state.description, { principal: state.principal });
            await runtime.invokeAction(thing, "information", {}, state.options);
        });
    });
}

for (const deny of [undefined, "origin", "target", "principal", "no alias policy", "alias policy refusal"]) {
    test(`gate: HTTP logical alias different from physical requires explicit same-principal authorization (${deny ?? "approved"})`, async (t) => {
        const f = await fixture(t, { address: (server, foreign) => foreign.url });
        const trust = { allowedOrigins: [f.server.origin, f.foreign.origin], allowedTargets: [f.server.url, f.foreign.url],
            principalTargets: { alice: [f.server.url, f.foreign.url] } };
        if (deny === "origin") { trust.allowedOrigins.pop(); trust.allowedTargets.pop(); trust.principalTargets.alice.pop(); }
        if (deny === "target") trust.allowedTargets.pop();
        if (deny === "principal") trust.principalTargets.alice.pop();
        if (deny === "no alias policy") trust.authorizeLogicalEndpoint = undefined;
        if (deny === "alias policy refusal") trust.authorizeLogicalEndpoint = () => false;
        const work = async () => {
            const runtime = await f.create(trust);
            const thing = await runtime.consume(f.description, { principal: "alice" });
            await runtime.execute(thing, "information", {}, { addressing: addressing(f.expected) });
        };
        if (deny) await f.noSend(work);
        else {
            await work();
            assert.equal(f.server.requests.length, 1);
            assert.equal(f.foreign.requests.length, 0, "An authorized HTTP logical alias is still not the protocol endpoint");
        }
    });
}

for (const address of ["urn:fixture:device#fragment", "urn:fixture:device#", "http://user:password@127.0.0.1/logical",
    "http://@127.0.0.1/logical", "urn://user@127.0.0.1/logical",
    "http://127.0.0.1/logical#", "file:///native", "urn:fixture:bad address"]) {
    test(`gate: logical URI syntax cannot be approved by a permissive hook: ${address}`, async (t) => {
        const f = await fixture(t, { address: () => address });
        await f.noSend(async () => {
            const runtime = await f.create({ authorizeLogicalEndpoint: () => true });
            const thing = await runtime.consume(f.description, { principal: "alice" });
            await runtime.execute(thing, "information", {}, { addressing: addressing(f.expected) });
        });
    });
}

for (const field of [undefined, "token", "parentTokens", "epr", "serviceNamespace"]) {
    test(`gate: projected resource EPR includes exact native token and parent identity (${field ?? "approved"})`, async (t) => {
        const f = await fixture(t, { resource: true });
        const description = structuredClone(f.description);
        if (field === "parentTokens") description["onvif:resourceIdentity"].parentTokens[0].token = "another-parent";
        else if (field) description["onvif:resourceIdentity"][field] = "another-native-identity";
        const work = async () => {
            const runtime = await f.create();
            const thing = await runtime.consume(description, { principal: "alice" });
            await runtime.execute(thing, "information", {}, { addressing: addressing(f.expected) });
        };
        if (field) await f.noSend(work);
        else { await work(); assert.equal(f.server.requests.length, 1); }
    });
}

test("gate: alias approval cannot replace selected native security", async (t) => {
    const f = await fixture(t);
    f.description.securityDefinitions.native = { scheme: "basic" };
    await f.noSend(async () => {
        const runtime = await f.create({ authorizeLogicalEndpoint: () => true });
        await runtime.consume(f.description, { principal: "alice" });
    }, "UnsupportedCapability");
});

test("gate: WSA2005 parameters are not identity properties but still require exact scoped approval", async (t) => {
    const f = await fixture(t, { namespace: WSA });
    const originalId = f.description.id;
    f.expected.referenceParameters[0].children[0].value = "explicitly-approved-new-lease";
    f.description["onvif:discovery"].endpointReference.referenceParameters = structuredClone(f.expected.referenceParameters);
    assert.equal(identity(f.expected), originalId, "Parameters are excluded from the projector identity digest");
    const runtime = await f.create();
    const thing = await runtime.consume(f.description, { principal: "alice" });
    await runtime.execute(thing, "information", {}, { addressing: addressing(f.expected) });
    assert.equal(f.server.requests.length, 1);
    assert.equal(f.scopes[0].thingId, originalId);
});

test("gate: WSA2005 cannot gain WSA2004 identity properties even with a matching hash and permissive policy", async (t) => {
    const f = await fixture(t, { namespace: WSA });
    f.expected.referenceProperties = [header("Property", "not-a-2005-property")];
    f.description.id = identity(f.expected);
    f.description["onvif:discovery"].endpointReference.referenceProperties = structuredClone(f.expected.referenceProperties);
    await f.noSend(async () => {
        const runtime = await f.create({ authorizeLogicalEndpoint: () => true });
        await runtime.consume(f.description, { principal: "alice" });
    });
});

test("gate: request options cannot inject trusted endpoint-reference approval", async (t) => {
    const f = await fixture(t);
    const runtime = await f.create({ authorizeLogicalEndpoint: undefined });
    const thing = await runtime.consume(f.description, { principal: "alice" });
    await f.noSend(async () => {
        await runtime.execute(thing, "information", {}, {
            addressing: addressing(f.expected), endpointReference: f.expected
        });
    }, "InvalidConfiguration");
});

test("gate: approved EPR is snapshotted before awaited credentials and cannot be changed by the hook", async (t) => {
    const f = await fixture(t);
    const options = { addressing: addressing(f.expected) };
    const runtime = await f.create({ authorizeLogicalEndpoint: (scope) => {
        scope.endpointReference.referenceParameters[0].children[0].value = "hook-mutated";
        return true;
    } }, { credentials: async (scope) => {
        options.addressing.to = "urn:uuid:changed-after-approval";
        options.addressing.referenceParameters[0].children[0].value = "changed-after-approval";
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { origin: f.server.origin, principal: scope.principal,
            material: { kind: "password", username: "alice", password: "fixture-only-password" } };
    } });
    const original = structuredClone(f.description);
    const thing = await runtime.consume(f.description, { principal: "alice" });
    f.description["onvif:discovery"].endpointReference.referenceParameters[0].children[0].value = "source-mutated";
    await runtime.execute(thing, "information", {}, options);
    assert.equal(f.server.requests.length, 1);
    assert.equal(thing.getThingDescription().id, original.id);
});
