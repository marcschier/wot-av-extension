"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadCanonical, OPERATIONS } = require("../../../samples/adapters/src/canonical.cjs");

test("illustrative adapter TDs derive only exact abstract canonical fragments with schema/source references", () => {
    const canonical = loadCanonical();
    const root = path.resolve(__dirname, "..", "..", "..", "examples", "adapted-cameras");
    for (const prefix of ["uvc", "genicam"]) {
        const read = suffix => JSON.parse(fs.readFileSync(path.join(root, `${prefix}-${suffix}.json`), "utf8"));
        const td = read("camera.td"), model = read("camera.tm"), facts = read("facts");
        assert.equal(td.links.filter(link => link.rel === "type").length, 1);
        assert.equal(td.links.find(link => link.rel === "type").href, model.id);
        assert.equal(model.links.filter(link => link.rel === "tm:extends").length, 1);
        assert.ok(model.links.find(link => link.rel === "tm:extends").href.includes("/abstract/"));
        const abstractRoot = path.resolve(root, "..", "..", "models", "abstract", "0.2-proposed");
        const abstractBase = JSON.parse(fs.readFileSync(path.join(abstractRoot, "SemanticThing.tm.json"), "utf8"));
        const abstractOperations = JSON.parse(fs.readFileSync(path.join(abstractRoot, "operations.tm.json"), "utf8"));
        assert.equal(abstractBase.id, model.links.find(link => link.rel === "tm:extends").href);
        assert.deepEqual(Object.keys(td.actions).sort(), Object.values(OPERATIONS).sort());
        assert.equal(td["onvif:projection"].nativeProtocol, false);
        assert.equal(td["onvif:projection"].fullProfile, false);
        for (const id of Object.values(OPERATIONS)) {
            assert.ok(model.actions[id]["tm:ref"].includes("/abstract/"));
            assert.ok(abstractOperations.actions[id]);
            assert.ok(td.actions[id].input["onvif:sourceDataSchema"].endsWith("input_" + id));
            assert.ok(td.actions[id].output["onvif:sourceDataSchema"].endsWith("output_" + id));
            assert.equal(td.actions[id].forms[0].contentType, "application/json");
            assert.equal(td.actions[id].forms[0]["onvif:binding"], undefined);
        }
        assert.equal(td.properties.snapshot.forms[0].contentType, "image/jpeg");
        assert.equal(facts.publishLive, false);
        assert.equal(facts.videoEncoder, false);
        assert.equal(facts.dataProcessingNative.GetProfile.supported, false);
        canonical.profiles.output({ Profiles: [facts.profile] });
        for (const suffix of ["camera.td", "camera.tm", "facts"]) {
            const text = fs.readFileSync(path.join(root, `${prefix}-${suffix}.json`), "utf8");
            assert.equal(text, JSON.stringify(JSON.parse(text), null, 4) + "\n");
        }
    }
});
