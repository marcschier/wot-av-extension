"use strict";

const { timingSafeEqual } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { AsyncLocalStorage } = require("node:async_hooks");
const { SourceFault, HTTP_STATUS, asFault, demand } = require("./fault.cjs");
const { OPERATIONS } = require("./canonical.cjs");

function sameToken(actual, expected) {
    if (typeof actual !== "string" || actual.length > 256) return false;
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(request, timeoutMs, operation) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const cleanup = () => {
            clearTimeout(timer);
            request.off("data", data);
            request.off("end", end);
            request.off("aborted", aborted);
            request.off("error", aborted);
        };
        const fail = fault => { cleanup(); request.pause(); reject(fault); };
        const data = chunk => {
            size += chunk.length;
            if (size > 65536) { fail(new SourceFault("ResourceLimit", operation)); return; }
            chunks.push(chunk);
        };
        const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
        const aborted = () => fail(new SourceFault("Cancelled", operation));
        const timer = setTimeout(() => fail(new SourceFault("Timeout", operation)), timeoutMs);
        request.on("data", data);
        request.once("end", end);
        request.once("aborted", aborted);
        request.once("error", aborted);
    });
}

async function startServer({ adapter, canonical, port, address = "127.0.0.1",
    permitPublication = false, controlToken, snapshotTokens }) {
    demand(permitPublication === true, "PolicyDenied", "open");
    demand(address === "127.0.0.1", "PolicyDenied", "open");
    demand(Number.isInteger(port) && port >= 0 && port <= 65535, "InvalidSelection", "open");
    demand(process.env.WOT_PORT === undefined && process.env.PORT === undefined, "PolicyDenied", "open");
    demand(typeof controlToken === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(controlToken)
        && Array.isArray(snapshotTokens) && snapshotTokens.length > 0
        && snapshotTokens.length <= adapter.limits.maxSubscribers
        && snapshotTokens.every(token => typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token))
        && new Set([controlToken, ...snapshotTokens]).size === snapshotTokens.length + 1, "PolicyDenied", "open");

    const requestScope = new AsyncLocalStorage();
    const servient = new canonical.Servient();
    let thing, origin, ready = false, tdPath;
    const routes = new Map();
    function sendFault(response, error, operation) {
        const fault = asFault(error, operation);
        if (response.destroyed) return;
        if (response.headersSent) { response.destroy(); return; }
        response.writeHead(HTTP_STATUS[fault.code], {
            "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close"
        });
        response.end(JSON.stringify(fault.toJSON()));
    }
    const http = new canonical.HttpServer({
        address: "127.0.0.1", port, baseUri: "http://127.0.0.1", devFriendlyUri: false,
        security: [{ scheme: "bearer" }],
        middleware: async (request, response) => {
            let lease = null;
            let writeTimer;
            let operation = "snapshot";
            const release = () => { clearTimeout(writeTimer); lease?.release(); };
            response.once("close", release);
            response.once("finish", release);
            try {
                demand(ready, "SourceUnavailable", operation);
                demand(request.headers.host === new URL(origin).host
                    && (request.headers.origin === undefined || request.headers.origin === origin), "PolicyDenied", operation);
                const url = new URL(request.url, origin);
                demand(url.origin === origin && !url.search && !url.hash, "InvalidSelection", operation);
                const route = routes.get(url.pathname);
                const tdRequest = url.pathname === tdPath && request.method === "GET";
                const modelRequest = adapter.model && url.href === adapter.model.id && request.method === "GET";
                demand(tdRequest || modelRequest || route !== undefined, "UnknownProfileToken", operation);
                operation = route?.operation ?? (tdRequest ? "describe" : "snapshot");
                const authorization = request.headers.authorization;
                const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
                    ? authorization.slice(7) : "";
                if (route?.kind === "snapshot") {
                    const subscriber = snapshotTokens.findIndex(approved => sameToken(token, approved));
                    demand(subscriber >= 0, "PermissionDenied", operation);
                    demand(request.method === "GET", "InvalidSelection", operation);
                    lease = adapter.acquireSnapshot("reader-" + subscriber);
                    const content = await requestScope.run({ lease }, () => thing.handleReadProperty("snapshot", { formIndex: 0 }));
                    demand(content.type === "image/jpeg", "ProtocolError", operation);
                    writeTimer = setTimeout(() => response.destroy(), adapter.limits.readDeadlineMs);
                    response.writeHead(200, {
                        "Content-Type": "image/jpeg", "Content-Length": lease.data.byteLength,
                        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
                    });
                    await pipeline(content.body, response);
                } else {
                    demand(sameToken(token, controlToken), "PermissionDenied", operation);
                    if (tdRequest || modelRequest) {
                        response.writeHead(200, {
                            "Content-Type": modelRequest ? "application/tm+json" : "application/td+json",
                            "Cache-Control": "no-store"
                        });
                        response.end(JSON.stringify(modelRequest ? adapter.model : thing.getThingDescription()));
                        return;
                    }
                    operation = route.operation;
                    demand(request.method === "POST"
                        && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? ""),
                    "InvalidSelection", operation);
                    const bytes = await readBody(request, adapter.limits.readDeadlineMs, operation);
                    let input;
                    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
                    catch (error) {
                        if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
                        throw new SourceFault("InvalidSelection", operation);
                    }
                    adapter.canonical[route.contract].input(input);
                    const content = await thing.handleInvokeAction(route.id,
                        new canonical.Content("application/json", Readable.from([bytes])), { formIndex: 0 });
                    demand(content?.type === "application/json", "ProtocolError", operation);
                    const body = await content.toBuffer();
                    demand(body.length <= 65536, "ResourceLimit", operation);
                    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                    response.end(body);
                }
            } catch (error) {
                release();
                sendFault(response, error, operation);
            }
        }
    });
    const nativeHttp = http.getServer();
    nativeHttp.maxConnections = adapter.limits.maxSubscribers + 4;
    nativeHttp.headersTimeout = 2000;
    nativeHttp.requestTimeout = 3000;
    servient.addServer(http);
    try {
        const wot = await servient.start();
        origin = "http://127.0.0.1:" + http.getPort();
        const template = adapter.tdTemplate(origin);
        thing = await wot.produce(template);
        for (const [name, id] of Object.entries(OPERATIONS)) {
            thing.setActionHandler(id, async input => name === "profiles"
                ? adapter.getProfiles(await input.value()) : adapter.getSnapshotUri(await input.value()));
        }
        thing.setPropertyReadHandler("snapshot", async () => {
            const lease = requestScope.getStore()?.lease;
            demand(lease !== undefined, "PolicyDenied", "snapshot");
            return new canonical.ReadableStream({
                start(controller) { controller.enqueue(lease.data); controller.close(); }
            });
        });
        await thing.expose();
        tdPath = "/" + encodeURIComponent(adapter.thingId);
        demand(http.getThings().has(adapter.thingId), "ProtocolError", "open");
        http.addEndpoint(thing, template, origin + tdPath);
        for (const [name, id] of Object.entries(OPERATIONS)) {
            const expected = origin + tdPath + "/actions/" + id;
            const form = thing.actions[id].forms.find(value => value.href === expected && value.contentType === "application/json");
            demand(form !== undefined, "ProtocolError", "open");
            thing.actions[id].forms = [{ ...form, op: "invokeaction", "htv:methodName": "POST", security: ["control"] }];
            routes.set(new URL(form.href).pathname, { kind: "action", operation: canonical[name].descriptor.operation, id, contract: name });
        }
        const expected = origin + tdPath + "/properties/snapshot";
        const snapshot = thing.properties.snapshot.forms.find(value => value.href === expected && value.contentType === "image/jpeg");
        demand(snapshot !== undefined, "ProtocolError", "open");
        thing.properties.snapshot.forms = [{ ...snapshot, op: "readproperty", "htv:methodName": "GET", security: ["image"] }];
        delete thing.forms;
        routes.set(new URL(snapshot.href).pathname, { kind: "snapshot" });
        adapter.setSnapshotUri(snapshot.href);
        ready = true;
    } catch (error) {
        nativeHttp.closeAllConnections();
        await servient.shutdown();
        throw asFault(error, "open");
    }
    let stopping;
    return {
        td: thing.getThingDescription(),
        tdUri: origin + tdPath,
        snapshotUri: adapter.uri,
        close() {
            if (!stopping) {
                ready = false;
                nativeHttp.closeAllConnections();
                stopping = servient.shutdown();
            }
            return stopping;
        }
    };
}

module.exports = { startServer };
