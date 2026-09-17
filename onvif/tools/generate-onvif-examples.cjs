"use strict";

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { root } = require("./paths.cjs");
const { buildVocabularyExamples } = require("./vocabulary-examples.cjs");
const runtime = join(root, "onvif", "samples", "reference-runtime", "dist");
const { project } = require(join(runtime, "projection", "project.js"));
const { decodeElement, encodeElement } = require(join(runtime, "xml", "mapper.js"));
const { parseXml } = require(join(runtime, "xml", "parser.js"));
const { OnvifError } = require(join(runtime, "binding", "errors.js"));
const { digest } = require(join(runtime, "catalog", "sources.js"));
const { deriveAdapterTd } = require(join(runtime, "catalog", "semantic-adapter.js"));
const { operationSchemaUri, ONVIF_BASE } = require(join(runtime, "catalog", "schemas.js"));
const base = join(root, "onvif");
const read = (path) => JSON.parse(readFileSync(join(base, ...path.split("/")), "utf8"));
const sources = read("tools/fixtures/reference-runtime/catalog/native-responses.json").cases;
const edition = { A: "1.0", C: "1.0", D: "1.0", G: "1.1", M: "1.1", S: "1.3", T: "1.0" };
const media2 = "http://www.onvif.org/ver20/media/wsdl";
const media1 = "http://www.onvif.org/ver10/media/wsdl";
const recording = "http://www.onvif.org/ver10/recording/wsdl";
const tt = "http://www.onvif.org/ver10/schema";
const evidence = (id) => [{ sourceId: `urn:example:fictional-native-source:${id}`,
    detail: "Independently authored fictional native observation; not hardware discovery, certification or a live network result." }];
const known = (value, id) => ({ state: "known", value, evidence: evidence(id) });
const unknown = () => ({ state: "unknown", evidence: [], detail: "Not supplied by this fictional read-only source." });

function buildExamples(catalog, requirements) {
    const output = new Map(), allModels = new Map(), allScenarios = [];
    const put = (path, value) => output.set(path, value);
    function selected(namespace, portType, operation) {
        const matches = catalog.operations.filter((entry) => entry.serviceNamespace === namespace
            && entry.portTypeQName.localName === portType && entry.operation === operation);
        if (matches.length !== 1) throw new Error(`Golden source has no exact native contract: ${namespace} ${portType} ${operation}`);
        return matches[0];
    }
    function scene(name, profiles, title, origin) {
        return { name, title, origin, wire: [], snapshot: {
            schemaVersion: 1, epr: { address: `urn:example:fictional-native-device:${name}`, referenceProperties: [] },
            services: [], resources: [], profileClaims: profiles.map((profile) => ({
                profile, edition: edition[profile], role: "device", evidence: evidence(`${name}:hypothetical-profile-${profile}`)
            })), conformanceEvidence: []
        } };
    }
    function service(scene, operation, route) {
        let value = scene.snapshot.services.find((entry) => entry.namespace === operation.serviceNamespace);
        if (value === undefined) {
            value = { namespace: operation.serviceNamespace, xaddr: new URL(route, scene.origin).href,
                evidence: evidence(`${scene.name}:${route}`), capabilities: unknown(), readOutcomes: [] };
            scene.snapshot.services.push(value);
        }
        return value;
    }
    function observation(scene, namespace, portType, name, xml, route) {
        const operation = selected(namespace, portType, name);
        let value;
        try { value = decodeElement(operation.response, parseXml(xml), catalog.xml); }
        catch (error) {
            if (!(error instanceof OnvifError)) throw error;
            throw new Error(`Fictional source ${scene.name}/${operation.id}: ${error.message}`, { cause: error });
        }
        encodeElement(operation.response, value, catalog.xml);
        const observed = service(scene, operation, route);
        observed.readOutcomes.push({ operation: name, portType, binding: operation.bindingQName.localName,
            outcome: known(value, `${scene.name}:${operation.id}`) });
        if (value.Capabilities) observed.capabilities = known(value.Capabilities, `${scene.name}:${operation.id}`);
        scene.wire.push({ operation: { bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName,
            operation: name }, responseXml: xml });
        return value;
    }
    function fixture(scene, id, route, xml) {
        const source = sources.find((entry) => entry.id === id);
        if (!source) throw new Error(`Unknown golden source fixture ${id}`);
        return observation(scene, source.serviceNamespace, source.portType, source.operation, xml ?? source.xml, route);
    }
    function resource(scene, namespace, kind, token, parents = [], facts) {
        scene.snapshot.resources.push({ serviceNamespace: namespace, kind, token, parentTokens: parents,
            evidence: evidence(`${scene.name}:${kind}:${token}`), ...(facts ? { facts } : {}) });
    }
    function uriResolver(scene, name) {
        const operation = selected(media2, "Media2", name), observed = service(scene, operation, "/native/media2");
        (observed.supportedOperations ??= []).push({
            operation: name, portType: "Media2", binding: operation.bindingQName.localName,
            support: known(true, `${scene.name}:read-only-emulation:${name}`)
        });
        scene.wire.push({ operation: { bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName,
            operation: name }, dynamicResponse: name === "GetStreamUri" ? "profile-token-stream-uri" : "profile-token-snapshot-uri",
            requiredInput: name === "GetStreamUri" ? ["Protocol", "ProfileToken"] : ["ProfileToken"],
            policy: "Explicit finite invocation only; no stream start, writes, stateful search or subscription is implemented by this source." });
    }
    function publish(scene, directory, file, resourcesFile) {
        const projected = project(scene.snapshot, { registry: catalog, requirements }, {
            securityDefinitions: { nativeDigest: { scheme: "digest" } }, security: ["nativeDigest"]
        });
        for (const model of projected.models) allModels.set(model.id, model);
        const documents = projected.tds.map((original) => {
            const td = structuredClone(original);
            delete td.version;
            delete td["onvif:projectionDigest"];
            delete td["onvif:profileAssessments"];
            td.description = "Fictional native source observation. This partial interface advertises only the finite reads/resolvers in its declared source emulation; no hardware, native authentication qualification, writes or profile conformance are asserted.";
            if (td["@type"] === "onvif:Device") {
                td.title = scene.title;
                td.links.push({ rel: "describedby", href: `${ONVIF_BASE}/examples/${directory}/${file}-assessments.json`,
                    type: "application/json" });
            }
            const revision = digest(td);
            return { ...td, version: { instance: revision }, "onvif:projectionDigest": revision };
        });
        const device = documents.find((td) => td["@type"] === "onvif:Device");
        if (!device) throw new Error(`No native Thing was projected for ${scene.name}`);
        put(`${directory}/${file}.td.json`, device);
        put(`${directory}/${file}-observed.tm.json`, allModels.get(device.links.find((link) => link.rel === "type").href));
        put(`${directory}/${file}-models.json`, { formatVersion: 1, models: projected.models });
        put(`${directory}/${file}-assessments.json`, { formatVersion: 1,
            description: "Complete typed assessments retained separately from the concise public TD; applicability is not satisfaction.",
            requirementsDigest: requirements.digest, assessments: projected.assessments, diagnostics: projected.diagnostics });
        put(`${directory}/${resourcesFile ?? `${file}-resources.tds.json`}`, documents.filter((td) => td !== device));
        put(`${directory}/${file}-source.json`, { formatVersion: 1, provenance: "fictional-read-only-native-source",
            noHardwareDiscovery: true, readOnlyEmulation: true, snapshot: scene.snapshot, wire: scene.wire });
        allScenarios.push({ scenario: scene.name, td: `${directory}/${file}.td.json`,
            profiles: scene.snapshot.profileClaims.map((claim) => ({ profile: claim.profile, edition: claim.edition, role: claim.role })),
            source: `${directory}/${file}-source.json`, fullProfileClaim: false });
        return { device, documents };
    }

    const camera = scene("t-m-camera", ["T", "M"], "Fictional T+M entrance network camera", "https://camera-tm.example.invalid");
    fixture(camera, "device", "/native/device");
    const firstProfile = sources.find((entry) => entry.id === "media2").xml;
    const secondProfile = '<m:Profiles token="0002" fixed="false"><m:Name>Secondary</m:Name></m:Profiles>';
    const profileValue = fixture(camera, "media2", "/native/media2", firstProfile.replace("</m:GetProfilesResponse>", secondProfile + "</m:GetProfilesResponse>"));
    for (const profile of profileValue.Profiles) resource(camera, media2, "MediaProfile", profile.$attributes.token, [], {
        fixed: known(profile.$attributes.fixed, "native-profile-fixed")
    });
    fixture(camera, "analytics", "/native/analytics");
    const analytics = "http://www.onvif.org/ver20/analytics/wsdl";
    const modules = observation(camera, analytics, "AnalyticsEnginePort", "GetAnalyticsModules",
        `<a:GetAnalyticsModulesResponse xmlns:a="${analytics}" xmlns:t="${tt}" xmlns:v="urn:example:analytics"><a:AnalyticsModule Name="Detector-01" Type="v:Detector"><t:Parameters/></a:AnalyticsModule></a:GetAnalyticsModulesResponse>`, "/native/analytics");
    const rules = observation(camera, analytics, "RuleEnginePort", "GetRules",
        `<a:GetRulesResponse xmlns:a="${analytics}" xmlns:t="${tt}" xmlns:v="urn:example:analytics"><a:Rule Name="Line-01" Type="v:LineCounting"><t:Parameters/></a:Rule></a:GetRulesResponse>`, "/native/analytics");
    resource(camera, analytics, "AnalyticsConfiguration", "analytics-01");
    for (const module of modules.AnalyticsModule) resource(camera, analytics, "AnalyticsModule", module.$attributes.Name,
        [{ kind: "AnalyticsConfiguration", token: "analytics-01" }]);
    for (const rule of rules.Rule) resource(camera, analytics, "AnalyticsRule", rule.$attributes.Name,
        [{ kind: "AnalyticsConfiguration", token: "analytics-01" }]);
    for (const name of ["GetAnalyticsModules", "GetRules"]) {
        const operation = selected(analytics, name === "GetRules" ? "RuleEnginePort" : "AnalyticsEnginePort", name);
        const input = { ConfigurationToken: "analytics-01" };
        encodeElement(operation.request, input, catalog.xml);
        camera.wire.find((entry) => entry.operation.operation === name).input = input;
    }
    observation(camera, "http://www.onvif.org/ver10/events/wsdl", "EventPortType", "GetServiceCapabilities",
        '<e:GetServiceCapabilitiesResponse xmlns:e="http://www.onvif.org/ver10/events/wsdl"><e:Capabilities MaxPullPoints="2"/></e:GetServiceCapabilitiesResponse>', "/native/events");
    const video = observation(camera, media1, "Media", "GetVideoSources",
        `<m:GetVideoSourcesResponse xmlns:m="${media1}" xmlns:t="${tt}"><m:VideoSources token="source-01"><t:Framerate>30</t:Framerate><t:Resolution><t:Width>1920</t:Width><t:Height>1080</t:Height></t:Resolution></m:VideoSources></m:GetVideoSourcesResponse>`, "/native/media1");
    for (const source of video.VideoSources) resource(camera, media1, "VideoSource", source.$attributes.token);
    uriResolver(camera, "GetStreamUri");
    uriResolver(camera, "GetSnapshotUri");
    const cameraOutput = publish(camera, "cameras", "t-m-camera", "t-m-resources.tds.json");

    const legacy = scene("s-camera", ["S"], "Fictional Profile S Media1 camera", "https://camera-s.example.invalid");
    fixture(legacy, "device", "/native/device");
    const legacyProfiles = fixture(legacy, "media1", "/native/media1");
    for (const profile of legacyProfiles.Profiles) resource(legacy, media1, "MediaProfile", profile.$attributes.token);
    publish(legacy, "cameras", "s-camera");

    const metadata = scene("m-metadata-source", ["M"], "Fictional Profile M metadata source, not a video-camera claim", "https://metadata.example.invalid");
    fixture(metadata, "device", "/native/device");
    fixture(metadata, "analytics", "/native/analytics");
    publish(metadata, "cameras", "m-metadata-source");

    const recorder = scene("g-recorder", ["G"], "Fictional Profile G recorder", "https://recorder.example.invalid");
    fixture(recorder, "device", "/native/device");
    const originalRecording = sources.find((entry) => entry.id === "recording").xml;
    const recordingItem = originalRecording.match(/<r:RecordingItem>[\s\S]*<\/r:RecordingItem>/)[0];
    const recordings = fixture(recorder, "recording", "/native/recording", originalRecording.replace(
        "</r:GetRecordingsResponse>", recordingItem.replaceAll("rec-001", "rec-002") + "</r:GetRecordingsResponse>"));
    for (const item of recordings.RecordingItem) {
        resource(recorder, recording, "Recording", item.RecordingToken);
        for (const track of item.Tracks.Track) resource(recorder, recording, "RecordingTrack", track.TrackToken,
            [{ kind: "Recording", token: item.RecordingToken }]);
    }
    const jobs = observation(recorder, recording, "RecordingPort", "GetRecordingJobs",
        `<r:GetRecordingJobsResponse xmlns:r="${recording}" xmlns:t="${tt}"><r:JobItem><t:JobToken>job-01</t:JobToken><t:JobConfiguration><t:RecordingToken>rec-001</t:RecordingToken><t:Mode>Idle</t:Mode><t:Priority>1</t:Priority></t:JobConfiguration></r:JobItem></r:GetRecordingJobsResponse>`, "/native/recording");
    for (const job of jobs.JobItem) resource(recorder, recording, "RecordingJob", job.JobToken, [], {
        mode: known(job.JobConfiguration.Mode, "observed-job-mode-not-transfer-state")
    });
    const search = "http://www.onvif.org/ver10/search/wsdl";
    observation(recorder, search, "SearchPort", "GetRecordingSummary",
        `<s:GetRecordingSummaryResponse xmlns:s="${search}" xmlns:t="${tt}"><s:Summary><t:DataFrom>2026-09-15T00:00:00Z</t:DataFrom><t:DataUntil>2026-09-16T00:00:00Z</t:DataUntil><t:NumberRecordings>2</t:NumberRecordings></s:Summary></s:GetRecordingSummaryResponse>`, "/native/search");
    const replayOperation = selected("http://www.onvif.org/ver10/replay/wsdl", "ReplayPort", "GetReplayUri");
    service(recorder, replayOperation, "/native/replay").supportedOperations = [{
        operation: replayOperation.operation, portType: replayOperation.portTypeQName.localName,
        binding: replayOperation.bindingQName.localName, support: known(true, "recorder:finite-replay-uri-emulation")
    }];
    recorder.wire.push({ operation: { bindingQName: replayOperation.bindingQName, portTypeQName: replayOperation.portTypeQName,
        operation: replayOperation.operation }, dynamicResponse: "recording-token-replay-uri",
        requiredInput: ["StreamSetup", "RecordingToken"],
        policy: "Finite authorized URI resolution only; this source does not start replay, allocate searches, drain results or claim decoder/transport qualification." });
    publish(recorder, "recorders", "g-recorder", "g-recording-resources.tds.json");

    const access = scene("a-controller", ["A"], "Fictional Profile A access-rules controller", "https://access-a.example.invalid");
    fixture(access, "device", "/native/device");
    fixture(access, "accessrules", "/native/access-rules");
    observation(access, "http://www.onvif.org/ver10/schedule/wsdl", "SchedulePort", "GetServiceCapabilities",
        '<s:GetServiceCapabilitiesResponse xmlns:s="http://www.onvif.org/ver10/schedule/wsdl"><s:Capabilities MaxLimit="10" MaxSchedules="100" MaxTimePeriodsPerDay="8" MaxSpecialDayGroups="16" MaxDaysInSpecialDayGroup="366" MaxSpecialDaysSchedules="16" ExtendedRecurrenceSupported="false" SpecialDaysSupported="true" StateReportingSupported="true"/></s:GetServiceCapabilitiesResponse>', "/native/schedule");
    publish(access, "access-control", "a-controller");
    const control = scene("c-access-device", ["C"], "Fictional Profile C access/door device", "https://access-c.example.invalid");
    fixture(control, "device", "/native/device");
    const doors = fixture(control, "door", "/native/door");
    for (const door of doors.DoorInfo) resource(control, "http://www.onvif.org/ver10/doorcontrol/wsdl", "Door", door.$attributes.token);
    publish(control, "access-control", "c-access-device");

    for (const [name, points, doors] of [["d-reader-only", 1, 0], ["d-door-only", 0, 1], ["d-reader-door", 1, 1]]) {
        const device = scene(name, ["D"], `Fictional Profile D ${name.slice(2)} peripheral`, `https://${name}.example.invalid`);
        fixture(device, "device", "/native/device");
        const pointNamespace = "http://www.onvif.org/ver10/accesscontrol/wsdl", doorNamespace = "http://www.onvif.org/ver10/doorcontrol/wsdl";
        observation(device, pointNamespace, "PACSPort", "GetServiceCapabilities",
            `<p:GetServiceCapabilitiesResponse xmlns:p="${pointNamespace}"><p:Capabilities MaxLimit="10" MaxAccessPoints="${points}"/></p:GetServiceCapabilitiesResponse>`, "/native/access-control");
        observation(device, doorNamespace, "DoorControlPort", "GetServiceCapabilities",
            `<d:GetServiceCapabilitiesResponse xmlns:d="${doorNamespace}"><d:Capabilities MaxLimit="10" MaxDoors="${doors}"/></d:GetServiceCapabilitiesResponse>`, "/native/door");
        for (const [namespace, port, prefix, kind, capacity, route] of [
            [pointNamespace, "PACSPort", "p", "AccessPoint", points, "/native/access-control"],
            [doorNamespace, "DoorControlPort", "d", "Door", doors, "/native/door"]
        ]) {
            if (capacity === 0) for (const operation of [`Get${kind}s`, `Get${kind}List`, `Get${kind}Info`, `Get${kind}InfoList`]) {
                observation(device, namespace, port, operation, `<${prefix}:${operation}Response xmlns:${prefix}="${namespace}"/>`, route);
            }
        }
        device.snapshot.facts = {
            "device.accessPoints.MaxAccessPoints": known(points, `${name}:explicit-capacity`),
            "device.doors.MaxDoors": known(doors, `${name}:explicit-capacity`)
        };
        publish(device, "access-control", name);
    }

    const operations = ["GetProfiles", "GetSnapshotUri"].map((name) => {
        const operation = selected(media2, "Media2", name);
        return { bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName, operation: name };
    });
    const adapted = deriveAdapterTd(catalog, {
        id: "urn:example:canonical-semantic-camera", modelId: `${ONVIF_BASE}/examples/adapted-cameras/canonical-fragments.tm.json`,
        title: "Fictional canonical inventory/snapshot semantic adapter", operations, evidence: evidence("semantic-fragments"),
        bindingForms: operations.map((operation) => ({ operation, forms: [{
            href: `https://adapter.example.invalid/actions/${operation.operation}`, op: "invokeaction",
            contentType: "application/json", "htv:methodName": "POST"
        }] })), securityDefinitions: { adapterDigest: { scheme: "digest" } }, security: ["adapterDigest"]
    });
    put("adapted-cameras/canonical-fragments.td.json", adapted.td);
    put("adapted-cameras/canonical-fragments.tm.json", adapted.model);
    allModels.set(adapted.model.id, adapted.model);

    const createJob = selected(recording, "RecordingPort", "CreateRecordingJob");
    const adjusted = { JobToken: "job-01", JobConfiguration: { RecordingToken: "rec-001", Mode: "Idle", Priority: 1, Source: [] } };
    encodeElement(createJob.response, adjusted, catalog.xml);
    put("recorders/recording-job-returned-configuration.json", {
        provenance: "Fictional native response illustration only; no create operation was performed or advertised by the read-only source.",
        operation: { bindingQName: createJob.bindingQName, portTypeQName: createJob.portTypeQName, operation: createJob.operation },
        sourceDataSchema: operationSchemaUri(createJob, "output"), result: adjusted,
        interpretation: "JobToken and the configuration actually returned are authoritative. Requested Active mode, allocation intent or a model reference is not observed transfer."
    });
    put("cameras/native-acquisition.json", {
        format: "onvif-informative-acquisition-example-1",
        provenance: "Fictional explicitly invoked native resolver and negotiated track; not captured hardware or decoded-media evidence.",
        thing: cameraOutput.device.id, namedMode: "native-h264-rtp",
        operation: camera.wire.find((entry) => entry.dynamicResponse === "profile-token-stream-uri").operation,
        input: { Protocol: "RtspUnicast", ProfileToken: "0001" },
        nativeUri: "rtsp://192.0.2.30:554/live/0001",
        representation: { kind: "original-rtp-packet", contentType: "application/rtp", payloadEncoding: "H264", clockRate: 90000 },
        interpretation: "This named Mode describes original wire RTP, not decoded video or a representation derived from MetadataStream. RTP timestamps are not source UTC; actual SDP and separate clock evidence govern.",
        noAutomaticCapture: true
    });
    put("canonical/native-value-boundaries.json", {
        format: "onvif-informative-canonical-values-1", provenance: "Fictional standalone value illustrations; select the corresponding descriptor before validation.",
        values: { uint64: "18446744073709551615", int64: "-9223372036854775808",
            decimal: "12345678901234567890.0012300", dateTime: "2026-09-16T12:34:56.123456789",
            qname: { namespace: tt, localName: "Frame" }, attributes: { $attributes: { token: "0001", fixed: false } },
            absent: {}, emptyString: "", nil: { $nil: true }, explicitDefault: { $default: true },
            choice: [{ $case: "Binary", $value: "AAEC" }], binary: "0000aF" },
        constraints: "Timezone absence is preserved; true nil/default need their source declaration; decimal/64-bit strings never pass through JSON numbers; choice keys come from the descriptor."
    });
    put("canonical/media-observations.json", {
        format: "onvif-media-observation-1", session: "fictional-owner", generation: 0, kind: "gap",
        source: { thing: cameraOutput.device.id, profileToken: "0001" },
        clock: { basis: "unknown" },
        data: { cause: "illustrative-sequence-loss", extent: "unknown", completeness: "incomplete",
            interpretation: "This fixture is neither original RTP bytes nor decoded video and asserts no source capture timestamp." }
    });
    put("vocabulary-examples.json", buildVocabularyExamples(catalog, read("terms.json")));
    put("model-index.json", { formatVersion: 1, models: [...allModels.values()].sort((a, b) => a.id < b.id ? -1 : 1) });
    put("golden-manifest.json", { formatVersion: 1, mappingEdition: "0.2-proposed", provenance: "fictional-read-only-source-families",
        registryDigest: catalog.registryDigest, requirementsDigest: requirements.digest,
        scenarios: allScenarios, artifacts: [...output.keys()].sort(),
        policy: "No live discovery, SDK access, source writes, stateful drains, media capture or Directory publication occurs during generation. UVC/GenICam adapter-owner examples are separate and are not overwritten." });
    return output;
}

function generate(check = false) {
    const output = buildExamples(read("catalog.json"), read("requirements-index.json"));
    const stale = [];
    for (const [name, value] of output) {
        const path = join(base, "examples", ...name.split("/")), bytes = JSON.stringify(value, null, 4) + "\n";
        if (!existsSync(path) || readFileSync(path, "utf8") !== bytes) {
            stale.push(name);
            if (!check) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
        }
    }
    return { artifacts: output.size, stale, check };
}

module.exports = { buildExamples, generate };
if (require.main === module) {
    try {
        if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node generate-onvif-examples.cjs [--check]");
        const result = generate(process.argv.includes("--check"));
        if (result.check && result.stale.length) { console.error(JSON.stringify(result)); process.exitCode = 1; }
        else console.log(JSON.stringify({ ...result, stale: result.check ? result.stale : [] }));
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Example generation failed");
        process.exitCode = 2;
    }
}
