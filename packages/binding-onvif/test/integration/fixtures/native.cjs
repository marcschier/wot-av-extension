const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const dgram = require("node:dgram");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { DOMParser } = require("@xmldom/xmldom");

const SOAP = "http://www.w3.org/2003/05/soap-envelope";
const WSA = "http://www.w3.org/2005/08/addressing";
const DSA = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
const WSD = "http://schemas.xmlsoap.org/ws/2005/04/discovery";
const TT = "http://www.onvif.org/ver10/schema";
const WSN = "http://docs.oasis-open.org/wsn/b-2";
const BW = "http://docs.oasis-open.org/wsn/bw-2";
const TOPIC = "http://docs.oasis-open.org/wsn/t-1";
const NS = {
    device: "http://www.onvif.org/ver10/device/wsdl",
    media1: "http://www.onvif.org/ver10/media/wsdl", media2: "http://www.onvif.org/ver20/media/wsdl",
    recording: "http://www.onvif.org/ver10/recording/wsdl", analytics: "http://www.onvif.org/ver20/analytics/wsdl",
    events: "http://www.onvif.org/ver10/events/wsdl",
    access: "http://www.onvif.org/ver10/accesscontrol/wsdl", door: "http://www.onvif.org/ver10/doorcontrol/wsdl",
    rules: "http://www.onvif.org/ver10/accessrules/wsdl", schedule: "http://www.onvif.org/ver10/schedule/wsdl",
    io: "http://www.onvif.org/ver10/deviceIO/wsdl"
};
const SERVICES = {
    S: ["device", "media1"], T: ["device", "media2"], G: ["device", "recording"],
    M: ["device", "analytics", "media2"], A: ["device", "rules", "schedule", "access", "door"],
    C: ["device", "access", "door"], D: ["device", "io"]
};
const EDITIONS = { S: "1.3", T: "1.0", G: "1.1", M: "1.1", A: "1.0", C: "1.0", D: "1.0" };
const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const children = (node) => Array.from(node.childNodes).filter((item) => item.nodeType === 1);
function parse(text) {
    const errors = [];
    const doc = new DOMParser({ errorHandler: { warning: (e) => errors.push(e), error: (e) => errors.push(e), fatalError: (e) => errors.push(e) } })
        .parseFromString(text, "application/xml");
    assert.deepEqual(errors, [], "Independent XML parser must accept the actual native request");
    return doc;
}
function one(doc, namespace, name) {
    const found = doc.getElementsByTagNameNS(namespace, name);
    assert.equal(found.length, 1, `Exactly one {${namespace}}${name}`);
    return found.item(0);
}
const value = (node, namespace, name) => node.getElementsByTagNameNS(namespace, name).item(0)?.textContent;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function digestFields(header) {
    if (!header?.startsWith("Digest ")) return null;
    const result = {};
    for (const match of header.slice(7).matchAll(/([A-Za-z0-9_-]+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)) result[match[1]] = (match[2] ?? match[3]).replace(/\\(.)/g, "$1");
    return result;
}
function authenticate(request, response, device, bytes, audit) {
    if (!device.requireAuth) return true;
    const fields = digestFields(request.headers.authorization);
    if (!fields) {
        response.writeHead(401, { "WWW-Authenticate": `Digest realm="${device.realm}", nonce="${device.nonce}", algorithm=SHA-256, qop="auth-int,auth", charset=UTF-8` });
        response.end();
        return false;
    }
    const password = device.users.get(fields.username);
    const ha1 = password === undefined ? "" : hash(`${fields.username}:${device.realm}:${password}`);
    const ha2 = hash(`POST:${request.url}${fields.qop === "auth-int" ? `:${hash(bytes)}` : ""}`);
    const expected = hash(`${ha1}:${device.nonce}:${fields.nc}:${fields.cnonce}:${fields.qop}:${ha2}`);
    const valid = password !== undefined && fields.uri === request.url && fields.realm === device.realm && fields.nonce === device.nonce
        && fields.algorithm === "SHA-256" && ["auth", "auth-int"].includes(fields.qop) && fields.response === expected;
    audit.authenticated = valid;
    audit.principal = valid ? fields.username : "denied";
    if (!valid) { response.writeHead(403); response.end(); }
    return valid;
}
function envelope(body, action, addressing = WSA) {
    return `<s:Envelope xmlns:s="${SOAP}">${action ? `<s:Header><a:Action xmlns:a="${addressing}">${action}</a:Action></s:Header>` : ""}<s:Body>${body}</s:Body></s:Envelope>`;
}
function unsupported(response) {
    response.writeHead(500, { "Content-Type": "application/soap+xml; charset=utf-8" });
    response.end(envelope(`<s:Fault xmlns:s="${SOAP}" xmlns:e="http://www.onvif.org/ver10/error"><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>e:ActionNotSupported</s:Value></s:Subcode></s:Code><s:Reason><s:Text xml:lang="en">Independent fixture does not implement this optional operation</s:Text></s:Reason></s:Fault>`));
}
function capabilities(service) {
    if (service === "device") return '<n:Capabilities><n:Network IPVersion6="false"/><n:Security HttpDigest="true"/><n:System DiscoveryResolve="true" DiscoveryBye="true"/></n:Capabilities>';
    if (service === "media1" || service === "media2") return '<n:Capabilities SnapshotUri="false"><n:ProfileCapabilities MaximumNumberOfProfiles="4"/><n:StreamingCapabilities RTPMulticast="false" RTP_TCP="true" RTP_RTSP_TCP="true"/></n:Capabilities>';
    if (service === "recording") return '<n:Capabilities DynamicRecordings="true" DynamicTracks="true" Encoding="JPEG G711"/>';
    if (service === "analytics") return '<n:Capabilities RuleSupport="true" AnalyticsModuleSupport="false" SupportedMetadata="true" ImageSendingType="Embedded"/>';
    if (service === "access") return '<n:Capabilities MaxLimit="1" MaxAccessPoints="2" AccessPointManagementSupported="false"/>';
    if (service === "door") return '<n:Capabilities MaxLimit="1"/>';
    if (service === "rules") return '<n:Capabilities MaxLimit="1" MaxAccessProfiles="2" MaxAccessPoliciesPerAccessProfile="2" MultipleSchedulesPerAccessPointSupported="false"/>';
    if (service === "schedule") return '<n:Capabilities MaxLimit="1" MaxSchedules="2" MaxTimePeriodsPerDay="2" MaxSpecialDayGroups="1" MaxDaysInSpecialDayGroup="1" MaxSpecialDaysSchedules="1" ExtendedRecurrenceSupported="false" SpecialDaysSupported="false" StateReportingSupported="false"/>';
    if (service === "io") return '<n:Capabilities VideoSources="0" VideoOutputs="0" AudioSources="0" AudioOutputs="0" RelayOutputs="1" SerialPorts="1" DigitalInputs="1"/>';
    if (service === "events") return '<n:Capabilities MaxPullPoints="4" WSSubscriptionPolicySupport="false" WSPausableSubscriptionManagerInterfaceSupport="false"/>';
    return null;
}
function payload(service, operation, device, request, base, rtsp) {
    const namespace = NS[service];
    let body;
    if (service === "device" && operation === "GetServices") {
        assert.equal(value(request, namespace, "IncludeCapability"), "true");
        body = device.services.map((name) => `<n:Service><n:Namespace>${xml(NS[name])}</n:Namespace><n:XAddr>${xml(base + device.paths[name])}</n:XAddr><n:Version><t:Major>2</t:Major><t:Minor>6</t:Minor></n:Version></n:Service>`).join("");
    } else if (service === "device" && operation === "GetDeviceInformation") {
        assert.equal(children(request).length, 0, "GetDeviceInformation really has an empty native request");
        body = `<n:Manufacturer>Independent loopback</n:Manufacturer><n:Model>${device.profile === "D" ? "Access peripheral" : `Profile ${device.profile} fixture`}</n:Model><n:FirmwareVersion>${xml(device.firmware)}</n:FirmwareVersion><n:SerialNumber>0000${device.profile}</n:SerialNumber><n:HardwareId>0001</n:HardwareId>`;
    } else if (service === "device" && operation === "GetScopes") {
        body = `<n:Scopes><t:ScopeDef>Fixed</t:ScopeDef><t:ScopeItem>onvif://www.onvif.org/Profile/${device.profile}</t:ScopeItem></n:Scopes>`;
    } else if (service === "device" && operation === "GetEndpointReference") body = `<n:GUID>${device.epr}</n:GUID>`;
    else if (operation === "GetServiceCapabilities") body = capabilities(service);
    else if (["media1", "media2"].includes(service) && operation === "GetProfiles") {
        body = device.mediaProfiles.map((profile) => `<n:Profiles token="${xml(profile.token)}" fixed="${profile.fixed}"><${service === "media1" ? "t" : "n"}:Name>${xml(profile.name)}</${service === "media1" ? "t" : "n"}:Name></n:Profiles>`).join("");
    } else if (["media1", "media2"].includes(service) && ["GetVideoSourceConfigurations", "GetVideoEncoderConfigurations", "GetMetadataConfigurations", "GetVideoAnalyticsConfigurations", "GetAnalyticsConfigurations"].includes(operation)) body = "";
    else if (service === "recording" && operation === "GetRecordings") {
        body = ["recording-front", "recording-back"].map((token) => `<n:RecordingItem><t:RecordingToken>${token}</t:RecordingToken><t:Configuration><t:Source><t:SourceId>urn:fixture:source:${token}</t:SourceId><t:Name>${token}</t:Name><t:Location>Owned loopback</t:Location><t:Description>Independent recording inventory, not a PLAY assertion</t:Description><t:Address>${xml(rtsp)}/${token}</t:Address></t:Source><t:Content>Video</t:Content><t:MaximumRetentionTime>P2D</t:MaximumRetentionTime></t:Configuration><t:Tracks><t:Track><t:TrackToken>0001</t:TrackToken><t:Configuration><t:TrackType>Video</t:TrackType><t:Description>Repeated track token under distinct parents</t:Description></t:Configuration></t:Track></t:Tracks></n:RecordingItem>`).join("");
    } else if (service === "recording" && operation === "GetRecordingJobs") body = "";
    else if (service === "access" && operation === "GetAccessPointInfoList") {
        const start = value(request, namespace, "StartReference");
        assert.ok(start === undefined || start === "opaque;page=2&direction=out", "Opaque native continuation must be preserved");
        assert.ok(value(request, namespace, "Limit") === undefined || Number(value(request, namespace, "Limit")) > 0);
        const index = start === undefined ? 0 : 1;
        body = `${index === 0 ? "<n:NextStartReference>opaque;page=2&amp;direction=out</n:NextStartReference>" : ""}<n:AccessPointInfo token="point-${index === 0 ? "in" : "out"}"><n:Name>${index === 0 ? "Entry" : "Exit"}</n:Name><n:AreaFrom>${index === 0 ? "outside" : "inside"}</n:AreaFrom><n:AreaTo>${index === 0 ? "inside" : "outside"}</n:AreaTo><n:EntityType>door:Door</n:EntityType><n:Entity>door-0001</n:Entity><n:Capabilities DisableAccessPoint="false" ExternalAuthorization="false"/></n:AccessPointInfo>`;
    } else if (service === "door" && operation === "GetDoorInfoList") {
        body = '<n:DoorInfo token="door-0001"><n:Name>Independent physical door</n:Name><n:Capabilities Access="true" Lock="false"/></n:DoorInfo>';
    } else if (service === "rules" && operation === "GetAccessProfileList") {
        body = '<n:AccessProfile token="access-profile-01"><n:Name>Day access</n:Name><n:AccessPolicy><n:ScheduleToken>schedule-01</n:ScheduleToken><n:Entity>point-in</n:Entity><n:EntityType>access:AccessPoint</n:EntityType></n:AccessPolicy></n:AccessProfile>';
    } else if (service === "schedule" && operation === "GetScheduleList") {
        body = '<n:Schedule token="schedule-01"><n:Name>Weekly schedule</n:Name><n:Standard>BEGIN:VCALENDAR&#13;\nVERSION:2.0&#13;\nPRODID:-//Independent Fixture//EN&#13;\nBEGIN:VEVENT&#13;\nUID:fixture-week&#13;\nDTSTART:19700105T080000Z&#13;\nDTEND:19700105T170000Z&#13;\nRRULE:FREQ=WEEKLY;BYDAY=MO&#13;\nEND:VEVENT&#13;\nEND:VCALENDAR</n:Standard></n:Schedule>';
    } else if (service === "media1" && operation === "GetStreamUri") {
        body = `<n:MediaUri><t:Uri>${xml(rtsp)}/guard</t:Uri><t:InvalidAfterConnect>false</t:InvalidAfterConnect><t:InvalidAfterReboot>false</t:InvalidAfterReboot><t:Timeout>PT30S</t:Timeout></n:MediaUri>`;
    } else if (service === "events" && operation === "GetEventProperties") {
        body = `<n:TopicNamespaceLocation>urn:fixture:access</n:TopicNamespaceLocation><b:FixedTopicSet xmlns:b="${WSN}">false</b:FixedTopicSet><t:TopicSet xmlns:t="${TOPIC}" xmlns:a="urn:fixture:access"><a:Door t:topic="true"/></t:TopicSet><b:TopicExpressionDialect xmlns:b="${WSN}">${TOPIC}/TopicExpression/Concrete</b:TopicExpressionDialect><n:MessageContentFilterDialect/><n:MessageContentSchemaLocation>${TT}</n:MessageContentSchemaLocation>`;
    } else return null;
    if (body === null) return null;
    return `<n:${operation}Response xmlns:n="${namespace}" xmlns:t="${TT}" xmlns:door="${NS.door}" xmlns:access="${NS.access}">${body}</n:${operation}Response>`;
}

async function nativeFixture(options = {}) {
    const calls = [], datagrams = [], peers = [], counters = { reads: 0, actuations: 0, subscriptions: 0, searches: 0, uriLookups: 0, rtspPlay: 0, rtspConnections: 0 };
    const profiles = options.profiles ?? ["S", "T", "G", "M", "A", "C", "D"];
    const devices = profiles.map((profile) => {
        const services = [...SERVICES[profile]];
        if (options.eventProfiles?.includes(profile)) services.push("events");
        const paths = Object.fromEntries(services.map((service) => [service, `/native/${profile}/${service}?slot=01&view=raw`]));
        return { profile, services, paths, epr: `urn:uuid:${randomUUID()}`, firmware: "1.0", requireAuth: options.auth ?? true,
            realm: `independent-${profile}`, nonce: randomUUID(), instance: 1, sequence: 0, pulls: 0,
            mediaProfiles: [{ token: "fixed-0001", fixed: true, name: "Initial mutable fixed profile" }, { token: "mobile-0002", fixed: false, name: "Mobile" }],
            users: new Map([[`inspection-${profile}`, randomUUID()], [`consumer-${profile}`, randomUUID()]]) };
    });
    let failure, origin, rtspOrigin;
    const sockets = new Set();
    const rtspServer = net.createServer((socket) => {
        counters.rtspConnections++; sockets.add(socket); socket.on("close", () => sockets.delete(socket));
        socket.on("data", (chunk) => {
            if (/^PLAY /m.test(chunk.toString("ascii"))) counters.rtspPlay++;
            socket.end("RTSP/1.0 501 Not Implemented\r\nCSeq: 1\r\n\r\n");
        });
    });
    await new Promise((resolve, reject) => { rtspServer.once("error", reject); rtspServer.listen(0, "127.0.0.1", resolve); });
    rtspOrigin = `rtsp://127.0.0.1:${rtspServer.address().port}`;
    const createServer = options.tls ? (handler) => https.createServer(options.tls, handler) : http.createServer;
    const server = createServer((request, response) => {
        void (async () => {
            if (options.tls) {
                assert.equal(request.socket.authorized, true);
                peers.push(request.socket.getPeerCertificate().subject.CN);
                assert.equal(request.headers.authorization, undefined);
            }
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            assert.ok(bytes.length < 1024 * 1024);
            const match = devices.flatMap((device) => device.services.map((service) => ({ device, service })))
                .find(({ device, service }) => device.paths[service] === request.url
                    || service === "events" && `${device.paths.events}&subscription=0001` === request.url);
            if (!match) { response.writeHead(404); response.end(); return; }
            const { device, service } = match;
            const doc = parse(bytes.toString("utf8"));
            const body = one(doc, SOAP, "Body");
            const items = children(body);
            assert.equal(items.length, 1);
            const operation = items[0].localName;
            assert.equal(items[0].namespaceURI, operation === "Unsubscribe" ? WSN : NS[service], "Native service namespaces must match their exact XAddr");
            assert.equal(request.method, "POST");
            const action = service === "io" ? `http://www.onvif.org/ver10/deviceio/wsdl/${operation}`
                : service === "events" ? operation === "Unsubscribe" ? `${BW}/SubscriptionManager/UnsubscribeRequest`
                    : `${NS.events}/${operation === "PullMessages" ? "PullPointSubscription" : "EventPortType"}/${operation}Request`
                    : `${NS[service]}/${operation}`;
            assert.ok(request.headers["content-type"].includes(`action="${action}"`), "Literal source SOAP action required");
            const addressing = doc.getElementsByTagNameNS(DSA, "Action").length ? DSA : WSA;
            assert.equal(one(doc, addressing, "To").textContent, addressing === DSA ? device.epr : origin + request.url);
            assert.equal(one(doc, addressing, "Action").textContent, action);
            const audit = { profile: device.profile, service, operation, path: request.url, authenticated: !device.requireAuth };
            calls.push(audit);
            if (/^(Set|Create|Delete|Modify|Activate|Deactivate|AccessDoor|Lock|Unlock|Trigger|Reboot|SystemReboot)/.test(operation)
                && !/PullPointSubscription/.test(operation)) counters.actuations++;
            if (/Subscribe|PullMessages|Unsubscribe|Renew|SetSynchronizationPoint/.test(operation)) counters.subscriptions++;
            if (/Find|SearchResults/.test(operation)) counters.searches++;
            if (/GetStreamUri|GetReplayUri/.test(operation)) counters.uriLookups++;
            if (!authenticate(request, response, device, bytes, audit)) return;
            if (device.denyReads) { response.writeHead(403); response.end(); return; }
            if (service === "events" && ["CreatePullPointSubscription", "PullMessages", "Unsubscribe"].includes(operation)) {
                const now = new Date().toISOString(), expires = new Date(Date.now() + 60000).toISOString();
                let output;
                if (operation === "CreatePullPointSubscription") {
                    output = `<n:CreatePullPointSubscriptionResponse xmlns:n="${NS.events}" xmlns:b="${WSN}" xmlns:a="${WSA}"><n:SubscriptionReference><a:Address>${xml(origin + device.paths.events + "&subscription=0001")}</a:Address><a:ReferenceParameters><r:Lease xmlns:r="urn:fixture:lease">0001</r:Lease></a:ReferenceParameters></n:SubscriptionReference><b:CurrentTime>${now}</b:CurrentTime><b:TerminationTime>${expires}</b:TerminationTime></n:CreatePullPointSubscriptionResponse>`;
                } else {
                    assert.equal(one(doc, "urn:fixture:lease", "Lease").textContent, "0001");
                    assert.equal(one(doc, "urn:fixture:lease", "Lease").getAttributeNS(WSA, "IsReferenceParameter"), "true");
                    if (operation === "Unsubscribe") output = `<b:UnsubscribeResponse xmlns:b="${WSN}"/>`;
                    else {
                        await new Promise((resolve) => setTimeout(resolve, 10));
                        const message = device.pulls++ === 0 ? `<b:NotificationMessage xmlns:b="${WSN}"><b:Topic Dialect="${TOPIC}/TopicExpression/Concrete" xmlns:a="urn:fixture:access">a:Door</b:Topic><b:Message><t:Message xmlns:t="${TT}" UtcTime="2026-09-16T06:00:00.123456789Z" PropertyOperation="Changed"><t:Source><t:SimpleItem Name="DoorToken" Value="door-0001"/></t:Source><t:Data><t:SimpleItem Name="LogicalState" Value="Closed"/></t:Data></t:Message></b:Message></b:NotificationMessage>` : "";
                        output = `<n:PullMessagesResponse xmlns:n="${NS.events}"><n:CurrentTime>${now}</n:CurrentTime><n:TerminationTime>${expires}</n:TerminationTime>${message}</n:PullMessagesResponse>`;
                    }
                }
                response.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
                response.end(envelope(output, action.replace(/Request$/, "Response"), addressing));
                return;
            }
            const output = payload(service, operation, device, items[0], origin, rtspOrigin);
            if (output === null) return unsupported(response);
            counters.reads++;
            response.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
            response.end(envelope(output, service === "events" ? action.replace(/Request$/, "Response") : undefined, addressing));
        })().catch((error) => {
            failure ??= error;
            if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("Independent native fixture wire assertion failed");
        });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `${options.tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
    const udp = dgram.createSocket("udp4");
    udp.on("message", (bytes, peer) => {
        try {
            const doc = parse(bytes.toString("utf8"));
            const action = one(doc, DSA, "Action").textContent;
            const messageId = one(doc, DSA, "MessageID").textContent;
            if (action !== `${WSD}/Probe`) return;
            const types = one(doc, WSD, "Types");
            const requested = types.textContent.trim().split(/\s+/).filter(Boolean).map((name) => {
                const [prefix, localName] = name.split(":"); return { namespace: types.lookupNamespaceURI(prefix), localName };
            });
            datagrams.push({ action, messageId, requested, address: peer.address });
            const matches = devices.filter((device) => requested.length === 0 || requested.every((type) =>
                device.profile === "S" ? type.namespace === "http://www.onvif.org/ver10/network/wsdl" && type.localName === "NetworkVideoTransmitter"
                    : type.namespace === NS.device && type.localName === "Device"));
            for (const device of matches) {
                const response = `<s:Envelope xmlns:s="${SOAP}" xmlns:a="${DSA}" xmlns:d="${WSD}" xmlns:dev="${NS.device}" xmlns:nvt="http://www.onvif.org/ver10/network/wsdl"><s:Header><a:Action>${WSD}/ProbeMatches</a:Action><a:MessageID>urn:uuid:${randomUUID()}</a:MessageID><a:RelatesTo>${xml(messageId)}</a:RelatesTo><a:To>${DSA}/role/anonymous</a:To><d:AppSequence InstanceId="${device.instance}" SequenceId="urn:fixture:sequence:${device.profile}" MessageNumber="${++device.sequence}"/></s:Header><s:Body><d:ProbeMatches><d:ProbeMatch><a:EndpointReference><a:Address>${device.epr}</a:Address></a:EndpointReference><d:Types>${device.profile === "S" ? "nvt:NetworkVideoTransmitter" : "dev:Device"}</d:Types><d:Scopes>onvif://www.onvif.org/Profile/${device.profile}</d:Scopes><d:XAddrs>${xml(origin + device.paths.device)}</d:XAddrs><d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;
                udp.send(response, peer.port, peer.address);
            }
        } catch (error) { failure ??= error; }
    });
    await new Promise((resolve, reject) => { udp.once("error", reject); udp.bind(0, "127.0.0.1", resolve); });
    const targetDevice = (href) => devices.find((device) => Object.values(device.paths).some((path) => origin + path === href)
        || device.paths.events && origin + device.paths.events + "&subscription=0001" === href);
    return {
        origin, rtspOrigin, devices, calls, datagrams, counters, peers,
        allowedXAddrs: devices.flatMap((device) => Object.values(device.paths).map((path) => origin + path)),
        subscriptionXAddrs: devices.filter((device) => device.paths.events).map((device) => origin + device.paths.events + "&subscription=0001"),
        discoveryOptions(withSeeds = true) {
            return {
                interfaces: [{ id: "owned-loopback", address: "127.0.0.1", family: "IPv4" }],
                segments: [{ id: "owned-segment", interfaceId: "owned-loopback", cidr: "127.0.0.0/8",
                    destination: { address: "127.0.0.1", port: udp.address().port }, listenPort: 0, multicast: false }],
                allowedXAddrs: this.allowedXAddrs,
                ...(withSeeds ? { seeds: devices.map((device) => ({ seedId: `seed-${device.profile}`, xaddr: origin + device.paths.device,
                    interfaceId: "owned-loopback", segmentId: "owned-segment", expectedEndpointAddress: device.epr })) } : {}),
                retransmissions: 1, ipv6: "disabled",
                bounds: { maxConcurrentInspections: 1, maxRequestsPerInspection: 48, maxResources: 32, maxInspectionBytes: 4 * 1024 * 1024 },
                timers: { probeWindowMs: 50, probeIntervalMs: 60000, refreshMs: 60000, staleMs: 180000,
                    departureGraceMs: 30000, inspectionTimeoutMs: 60000, readTimeoutMs: 5000 }
            };
        },
        runtimeOptions() {
            return { trust: { allowedOrigins: [origin] }, digest: { algorithms: ["SHA-256"], qops: ["auth-int", "auth"] },
                credentials: async (scope) => {
                    const device = targetDevice(scope.href);
                    if (!device || scope.realm !== device.realm || !device.users.has(scope.principal)) return undefined;
                    return { origin, principal: scope.principal, realm: device.realm,
                        material: { kind: "password", username: scope.principal, password: device.users.get(scope.principal) } };
                } };
        },
        security(target) {
            const device = targetDevice(target.xaddr);
            assert.ok(device);
            return device.requireAuth ? { securityDefinitions: { native: { scheme: "digest", in: "header" } }, security: ["native"] }
                : { securityDefinitions: { native: { scheme: "nosec" } }, security: ["native"] };
        },
        principal(target) { return `inspection-${targetDevice(target.xaddr).profile}`; },
        claims(role = "device") {
            return Object.fromEntries(devices.map((device) => [device.epr, [{
                profile: device.profile, edition: EDITIONS[device.profile], role,
                evidence: [{ sourceId: "fixture:explicit-edition-declaration", detail: "Fixture-authored role/edition claim, not inferred from scope or device certification." }]
            }]]));
        },
        assertHealthy() { if (failure) throw failure; },
        async close() {
            await new Promise((resolve) => udp.close(resolve));
            server.closeIdleConnections();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            for (const socket of sockets) socket.end();
            await new Promise((resolve, reject) => rtspServer.close((error) => error ? reject(error) : resolve()));
            if (failure) throw failure;
        }
    };
}

module.exports = { nativeFixture, NS, EDITIONS, SOAP, WSA, WSD, DSA, xml, parse, one };
