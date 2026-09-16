const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");

function observe(inventory, xml, patch) {
    const message = h.parseDiscovery(xml, h.DEFAULT_BOUNDS, true);
    inventory.observe(message, h.provenance(message, patch));
    return h.endpointIdentity(message.matches[0].endpointReference);
}

test("5,8 then delayed 6: same sequence is ordered; old Bye does not renew freshness or start retirement", async () => {
    const { inventory, clock } = h.inventory();
    const xml = h.fixture("hello-device.xml");
    const id = observe(inventory, xml);
    const initial = inventory.device(id);
    observe(inventory, xml.replace('MessageNumber="5"', 'MessageNumber="8"').replace("hello-device-5", "hello-device-8"));
    await clock.advance(10);
    observe(inventory, h.fixture("bye-device-old.xml").replace('MessageNumber="4"', 'MessageNumber="6"'));
    assert.equal(inventory.device(id).ordering.sequences[0].messageNumber, "8");
    assert.equal(inventory.device(id).state, "candidate");
    assert.equal(inventory.device(id).seenAt, initial.seenAt);
    assert.equal(inventory.device(id).suspectSince, null);
    assert.ok(inventory.snapshot().diagnostics.some((item) => item.code === "OldMessageNumber"));
});

test("higher InstanceId fences pending native inspection; lower epoch and MetadataVersion cannot roll back state", () => {
    const { inventory } = h.inventory();
    const id = observe(inventory, h.fixture("hello-device.xml"));
    const token = inventory.beginInspection(id);
    const old = h.report(inventory.device(id).endpointReference);
    observe(inventory, h.fixture("hello-restart.xml"), { interfaceId: "loop-b", segmentId: "segment-b", address: "127.0.0.2" });
    assert.equal(inventory.commitInspection(token, old), false);
    assert.equal(inventory.device(id).epoch, 2);
    assert.equal(inventory.device(id).ordering.instanceId, "8");
    assert.equal(inventory.device(id).metadataVersion, "8", "Metadata must not regress from 8 to 7 across restart");
    assert.equal(inventory.device(id).endpoints.length, 2);
    const oldEpoch = h.fixture("hello-device.xml").replace("hello-device-5", "delayed-old-epoch").replace('MessageNumber="5"', 'MessageNumber="99"');
    observe(inventory, oldEpoch);
    assert.equal(inventory.device(id).ordering.sequences[0].messageNumber, "1");
    assert.equal(inventory.device(id).information.status, "unknown");
    for (const code of ["SupersededInspection", "MetadataRegression", "OldInstance"]) {
        assert.ok(inventory.snapshot().diagnostics.some((item) => item.code === code), code);
    }
});

test("null and explicit SequenceIds are incomparable; each watermark survives and contradictory presence is quarantined", async () => {
    const { inventory, clock } = h.inventory();
    const id = observe(inventory, h.fixture("hello-device.xml"));
    const other = h.fixture("bye-device-old.xml").replace('SequenceId="urn:sequence:x" ', "").replace('MessageNumber="4"', 'MessageNumber="8"');
    observe(inventory, other);
    const device = inventory.device(id);
    assert.equal(device.state, "conflict");
    assert.deepEqual(device.ordering.sequences.map((item) => [item.sequenceId, item.messageNumber]), [["urn:sequence:x", "5"], [null, "8"]]);
    observe(inventory, h.fixture("hello-device.xml").replace("hello-device-5", "x-six").replace('MessageNumber="5"', 'MessageNumber="6"'));
    assert.equal(inventory.device(id).ordering.sequences.find((item) => item.sequenceId === null).messageNumber, "8");
    await clock.advance(100);
    inventory.liveness(id, 1, false, true);
    inventory.liveness(id, 2, false, true);
    inventory.reconcile();
    assert.equal(inventory.device(id).state, "conflict", "Incomparable arrival order cannot retire a device");
});

test("MessageID deduplication retains multi-interface provenance but cannot refresh a lease or accept contradictory replay content", async () => {
    const { inventory, clock } = h.inventory();
    const xml = h.fixture("hello-device.xml");
    const id = observe(inventory, xml);
    const token = inventory.beginInspection(id);
    inventory.commitInspection(token, h.report(inventory.device(id).endpointReference));
    const before = inventory.device(id);
    await clock.advance(9);
    observe(inventory, xml, { interfaceId: "loop-b", segmentId: "segment-b", address: "127.0.0.2" });
    const device = inventory.device(id);
    assert.equal(inventory.snapshot().devices.length, 1);
    assert.equal(device.provenance.length, 2);
    assert.equal(device.endpoints[0].provenance.length, 2);
    assert.equal(device.seenAt, before.seenAt);
    assert.equal(device.verifiedAt, before.verifiedAt);
    assert.equal(device.inspectionGeneration, before.inspectionGeneration);
    observe(inventory, xml.replace("<disc:MetadataVersion>8", "<disc:MetadataVersion>10"));
    assert.equal(inventory.device(id).metadataVersion, "8");
    assert.ok(inventory.snapshot().diagnostics.some((item) => item.code === "MessageIdCollision"));
});

test("equal MetadataVersion merges complementary exact XAddrs and does not mistake multiple NICs for cloned identities", () => {
    const { inventory } = h.inventory();
    const xml = h.fixture("hello-device.xml");
    const id = observe(inventory, xml);
    const second = xml.replace("hello-device-5", "second-nic").replace('MessageNumber="5"', 'MessageNumber="6"')
        .replace("127.0.0.1:18080/custom", "127.0.0.2:18080/new");
    observe(inventory, second, { interfaceId: "loop-b", segmentId: "segment-b", address: "127.0.0.2" });
    assert.deepEqual(inventory.device(id).endpoints.map((item) => item.xaddr), [h.XADDR, h.RESTART_XADDR]);
    assert.equal(inventory.device(id).state, "candidate");
    assert.equal(inventory.snapshot().devices.length, 1);
    const first = h.report(inventory.device(id).endpointReference);
    first.identityEvidence = [{ kind: "authenticated", authority: "fixture-device-cert", subject: "unit-1", xaddr: h.XADDR, observedAt: 1000 }];
    assert.equal(inventory.commitInspection(inventory.beginInspection(id), first), true);
    const clone = h.report(inventory.device(id).endpointReference);
    clone.identityEvidence = [{ kind: "authenticated", authority: "fixture-device-cert", subject: "unit-2", xaddr: h.RESTART_XADDR, observedAt: 1001 }];
    assert.equal(inventory.commitInspection(inventory.beginInspection(id), clone), false);
    assert.equal(inventory.device(id).state, "conflict");
    assert.equal(inventory.device(id).identityEvidence.length, 2);
    assert.equal(inventory.commitInspection(inventory.beginInspection(id), first), false, "A later arrival cannot clear authenticated clone evidence");
});

test("Bye requires grace and two distinct failed liveness rounds; denial resets absence evidence", async () => {
    const { inventory, clock } = h.inventory();
    const id = observe(inventory, h.fixture("hello-device.xml"));
    inventory.commitInspection(inventory.beginInspection(id), h.report(inventory.device(id).endpointReference));
    observe(inventory, h.fixture("bye-device-old.xml").replace('MessageNumber="4"', 'MessageNumber="8"'));
    assert.equal(inventory.device(id).state, "suspect");
    inventory.liveness(id, 1, false, true);
    inventory.liveness(id, 1, false, true);
    await clock.advance(25);
    inventory.reconcile();
    assert.equal(inventory.device(id).state, "suspect");
    assert.equal(inventory.device(id).failedLivenessRounds, 1);
    inventory.liveness(id, 2, true, false);
    assert.equal(inventory.device(id).failedLivenessRounds, 0);
    inventory.liveness(id, 3, false, true);
    inventory.liveness(id, 4, false, true);
    inventory.reconcile();
    assert.equal(inventory.device(id).state, "departed");
    assert.equal(inventory.device(id).information.status, "known", "Durable tombstone retains last confirmed information");
    const restored = h.inventory();
    restored.inventory.restore(inventory.snapshot());
    assert.equal(restored.inventory.device(id).state, "departed");
});

test("curated firmware evidence, advertised claims and observed native features are separate; snapshots are detached", () => {
    const { inventory } = h.inventory();
    const id = observe(inventory, h.fixture("hello-device.xml"));
    const inspection = h.report(inventory.device(id).endpointReference);
    inventory.commitInspection(inventory.beginInspection(id), inspection);
    inventory.addRegistryEvidence(id, { endpointAddress: h.EPR, profile: "T", edition: "1.0", product: "Curated product",
        firmwareVersion: "1.0", authority: "Operator-reviewed ONVIF registration", reference: "urn:fixture:curated-evidence" });
    assert.equal(inventory.device(id).registryEvidence[0].status, "matched");
    assert.equal(inventory.device(id).claims[0].label, "T");
    assert.deepEqual(inventory.device(id).observedFeatures, []);
    inspection.information.value.firmwareVersion = "2.0";
    inventory.commitInspection(inventory.beginInspection(id), inspection);
    assert.equal(inventory.device(id).registryEvidence[0].status, "firmware-mismatch");
    const snapshot = inventory.snapshot();
    snapshot.devices[0].endpointReference.address = "urn:modified";
    assert.equal(inventory.device(id).endpointReference.address, h.EPR);
    h.assertSnapshot(inventory.snapshot());
});

test("candidate, sequence, endpoint and diagnostic budgets are real bounds; missing sequences never erase ordered state", () => {
    const { inventory } = h.inventory({ bounds: { maxDevices: 1, maxSequenceIds: 1, maxXAddrs: 1, maxDiagnostics: 3 } });
    const xml = h.fixture("hello-device.xml");
    const id = observe(inventory, xml);
    observe(inventory, h.fixture("hello-legacy.xml"));
    observe(inventory, xml.replace("hello-device-5", "new-sequence").replace("urn:sequence:x", "urn:sequence:y"));
    observe(inventory, xml.replace("hello-device-5", "unsequenced").replace(/<disc:AppSequence[^>]+\/>/, ""));
    const snapshot = inventory.snapshot();
    assert.equal(snapshot.devices.length, 1);
    assert.equal(snapshot.devices[0].ordering.sequences.length, 1);
    assert.equal(snapshot.devices[0].endpoints.length, 1);
    assert.equal(snapshot.truncated, true);
    assert.ok(snapshot.diagnostics.length <= 3);
    assert.equal(inventory.device(id).ordering.instanceId, "7");
});

test("inventory byte budget rejects oversized replacement atomically while preserving prior known data and explicit truncation", () => {
    const { inventory } = h.inventory({ bounds: { maxStoreBytes: 10000 } });
    const id = observe(inventory, h.fixture("hello-device.xml"));
    const first = h.report(inventory.device(id).endpointReference);
    assert.equal(inventory.commitInspection(inventory.beginInspection(id), first), true);
    const tooLarge = structuredClone(first);
    tooLarge.information.value.model = "x".repeat(11000);
    assert.equal(inventory.commitInspection(inventory.beginInspection(id), tooLarge), false);
    assert.equal(inventory.device(id).information.value.model, "Mixed native services");
    assert.equal(inventory.snapshot().truncated, true);
    assert.ok(inventory.snapshot().diagnostics.some((item) => item.code === "InventoryByteLimit"));
    assert.ok(Buffer.byteLength(JSON.stringify(inventory.snapshot())) <= 10000);
    h.assertSnapshot(inventory.snapshot(), h.boundedOptions({ maxStoreBytes: 10000 }));
});
