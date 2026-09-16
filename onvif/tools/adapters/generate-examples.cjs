"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadCanonical } = require("../../samples/adapters/src/canonical.cjs");

const canonical = loadCanonical();
const root = path.resolve(__dirname, "..", "..", "examples", "adapted-cameras");
fs.mkdirSync(root, { recursive: true });
for (const [prefix, title, backend] of [
    ["uvc", "Illustrative OS-video semantic adapter", "windows-mf or linux-v4l2"],
    ["genicam", "Illustrative industrial semantic adapter", "aravis-gige or aravis-usb3"]
]) {
    const id = `urn:example:${prefix}-semantic-camera`;
    const origin = "http://127.0.0.1:8098";
    const { td, model } = canonical.createSemanticAdapterTd({
        id, title, origin,
        modelId: `https://example.org/wot/onvif/examples/adapted-cameras/${prefix}-camera.tm.json`,
        evidence: [{
            sourceId: "illustrative-operator-configuration",
            detail: `${backend}; hypothetical selected mode, no hardware observation or full/native ONVIF claim.`
        }]
    });
    td.description = "Illustrative only. An operator authors the selected native mode and persisted adapter profile. "
        + "Lookup/read do not start acquisition. No configuration, native encoding or hardware support is inferred.";
    td.properties = {
        snapshot: {
            type: "string", readOnly: true, observable: false,
            description: "Already acquired image/jpeg, unavailable when no fresh owned frame exists.",
            security: ["image"],
            forms: [{
                href: origin + "/" + encodeURIComponent(id) + "/properties/snapshot",
                contentType: "image/jpeg", op: "readproperty", "htv:methodName": "GET", security: ["image"]
            }]
        }
    };
    delete td.version;
    delete td["onvif:projectionDigest"];
    const facts = {
        author: "Sample application/operator, not the physical camera or ONVIF certification body",
        role: "semantic-adapter",
        source: "Pinned Media2 operation schemas plus hypothetical configured native capture evidence",
        validity: "illustrative; no hardware observation",
        defaults: { automaticDiscovery: false, automaticCapture: false, nativeConfigurationObjects: "omitted" },
        backend,
        nativeProtocol: false,
        fullProfile: false,
        publishLive: false,
        videoEncoder: false,
        dataProcessingNative: { GetProfile: { supported: false, reason: "Not implemented by this JPEG-first sample." } },
        payloadSchema: canonical.schemaId,
        profile: { $attributes: { token: "capture-p1", fixed: true }, Name: "Operator-configured native mode" },
        model: model.id
    };
    canonical.profiles.output({ Profiles: [facts.profile] });
    for (const [suffix, value] of [["camera.td.json", td], ["camera.tm.json", model], ["facts.json", facts]]) {
        fs.writeFileSync(path.join(root, `${prefix}-${suffix}`), JSON.stringify(value, null, 4) + "\n");
    }
}
console.log(JSON.stringify({ generated: 6, prefixes: ["uvc-", "genicam-"], hardwareQualified: false }));
