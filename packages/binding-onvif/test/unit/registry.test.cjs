const test = require("node:test");
const assert = require("node:assert/strict");
const { defineOperationRegistry, createOnvifRuntime } = require("../../dist");
const { device, collision, reference, operations, td } = require("../fixtures/operations.cjs");

test("registry: binding + portType + operation prevents a same-name collision", () => {
    const registry = defineOperationRegistry(operations);
    assert.equal(registry.resolve(reference(device)).soapAction, device.soapAction);
    assert.equal(registry.resolve(reference(collision)).soapAction, collision.soapAction);
    assert.notEqual(registry.resolve(reference(device)), registry.resolve(reference(collision)));
    assert.equal(device.portTypeQName.localName, collision.portTypeQName.localName);
    assert.notEqual(device.portTypeQName.namespace, collision.portTypeQName.namespace);
    assert.throws(() => registry.resolve({ ...reference(device), bindingQName: collision.bindingQName }),
        { code: "UnsupportedCapability" });
    assert.throws(() => registry.resolve({ ...reference(device), portTypeQName: collision.portTypeQName }),
        { code: "UnsupportedCapability" });
    assert.match(registry.digest, /^[a-f0-9]{64}$/);
    assert.equal(registry.digest, defineOperationRegistry([...operations].reverse()).digest);
    assert.throws(() => registry.resolve({ ...reference(device), operation: "Unknown" }),
        { code: "UnsupportedCapability" });
    assert.throws(() => defineOperationRegistry([device, device]), { code: "InvalidRegistry" });
    assert.ok(Object.isFrozen(registry.resolve(reference(device)).request));
});

test("registry: unimplemented required capabilities and unresolved native TDs fail explicitly", async () => {
    const registry = defineOperationRegistry([device]);
    await assert.rejects(createOnvifRuntime({
        registry,
        trust: { allowedOrigins: ["http://127.0.0.1:1"] },
        requiredCapabilities: ["all-released-profiles"]
    }), { code: "UnsupportedCapability" });
    const runtime = await createOnvifRuntime({ registry, trust: { allowedOrigins: ["http://127.0.0.1:1"] } });
    try {
        await assert.rejects(runtime.consume(td("http://127.0.0.1:1/device")),
            { code: "UnsupportedCapability" });
    } finally {
        await runtime.close();
    }
});

test("registry: unsupported XSD constructs, absent action metadata and unsafe bounds do not silently pass", async () => {
    assert.throws(() => defineOperationRegistry([{ ...device,
        request: { ...device.request, type: { kind: "all", sequence: [] } }
    }]), { code: "InvalidRegistry" });
    const mixed = defineOperationRegistry([{ ...device,
        request: { ...device.request, type: { kind: "complex", mixed: true, sequence: [] } }
    }]);
    assert.equal(mixed.resolve(reference(device)).request.type.mixed, true);
    const missingAction = { ...device };
    delete missingAction.addressingAction;
    assert.throws(() => defineOperationRegistry([missingAction]), { code: "InvalidRegistry" });
    const registry = defineOperationRegistry([device]);
    for (const patch of [{ timeoutMs: 2147483648 }, { mediaBackend: {} },
        { xml: { maxDepth: 1000 } }, { digest: { allowBasicFallback: true } }]) {
        await assert.rejects(createOnvifRuntime({
            registry, trust: { allowedOrigins: ["http://127.0.0.1:1"] }, ...patch
        }));
    }
});
