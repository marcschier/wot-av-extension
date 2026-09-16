const http = require("node:http");
const { readFile, stat } = require("node:fs/promises");
const { resolve, sep } = require("node:path");
const { randomUUID } = require("node:crypto");

const DISCOVERY = "https://www.w3.org/2022/wot/discovery";
const TD = "https://www.w3.org/2022/wot/td/v1.1";

function json(response, status, value, headers = {}) {
    response.writeHead(status, { "Content-Type": "application/json", ...headers });
    response.end(value === undefined ? undefined : JSON.stringify(value));
}
function problem(response, status, title) {
    json(response, status, { type: "about:blank", status, title }, { "Content-Type": "application/problem+json" });
}
function merge(target, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
    const result = target && typeof target === "object" && !Array.isArray(target) ? structuredClone(target) : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete result[key];
        else Object.defineProperty(result, key, { value: merge(result[key], value), writable: true, configurable: true, enumerable: true });
    }
    return result;
}
function compare(left, right) {
    const a = Array.from(left, (v) => v.codePointAt(0)), b = Array.from(right, (v) => v.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
    return a.length - b.length;
}

async function directory(options = {}) {
    const records = new Map(), audit = [], sockets = new Set(), timers = new Set();
    const writerToken = options.writerToken ?? randomUUID(), readerToken = options.readerToken ?? randomUUID();
    const now = options.now ?? Date.now;
    let sequence = 0, collection = 0, failure;
    const behavior = { nextWriteStatus: undefined, beforeWrite: undefined, listRevision: undefined,
        nextLink: undefined, ignoreLimits: false, omitEtag: false, delayMs: 0 };
    const purge = () => {
        for (const [id, entry] of records) {
            if (entry.expiresAt !== undefined && entry.expiresAt <= now()) {
                records.delete(id); collection++; audit.push({ method: "PURGE", id });
            }
        }
    };
    const enriched = (entry) => {
        const value = structuredClone(entry.td);
        const contexts = Array.isArray(value["@context"]) ? value["@context"] : [value["@context"]];
        value["@context"] = contexts.includes(DISCOVERY) ? contexts : [...contexts, DISCOVERY];
        value.registration = { ...(entry.ttl === undefined ? {} : { ttl: entry.ttl }),
            created: new Date(entry.created).toISOString(), modified: new Date(entry.modified).toISOString(),
            retrieved: new Date(now()).toISOString(), ...(entry.expiresAt === undefined ? {} : { expires: new Date(entry.expiresAt).toISOString() }) };
        if (!options.registrationOnly) value["directory:annotation"] = entry.annotation ?? "Directory-owned enrichment";
        return value;
    };
    const set = (id, td, prior) => {
        const ttl = td.registration?.ttl;
        if (ttl !== undefined && (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 || ttl > 604800)) throw new Error("Invalid TTL in independent Directory");
        const data = structuredClone(td); delete data.registration;
        const item = { td: data, etag: `"resource-${++sequence}"`, created: prior?.created ?? now(), modified: now(),
            ttl, expiresAt: ttl === undefined ? undefined : now() + ttl * 1000, annotation: prior?.annotation };
        records.set(id, item); collection++;
        return item;
    };
    const server = http.createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url, "http://127.0.0.1");
            if (url.pathname.startsWith("/model-documents/") && options.modelDirectory) {
                if (!["GET", "HEAD"].includes(request.method)) return problem(response, 405, "Static documents only");
                const relative = decodeURIComponent(url.pathname.slice("/model-documents/".length));
                if (!relative.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "..")) return problem(response, 400, "Invalid model path");
                const path = resolve(options.modelDirectory, ...relative.split("/"));
                if (!path.startsWith(resolve(options.modelDirectory) + sep)) return problem(response, 403, "Outside model bundle");
                try {
                    if (!(await stat(path)).isFile()) return problem(response, 404, "Model document absent");
                    const bytes = await readFile(path);
                    response.writeHead(200, { "Content-Type": path.endsWith(".tm.json") ? "application/tm+json" : "application/json",
                        "Content-Length": bytes.length });
                    response.end(request.method === "HEAD" ? undefined : bytes);
                } catch (error) {
                    if (error.code === "ENOENT") problem(response, 404, "Model document absent");
                    else throw error;
                }
                return;
            }
            const reading = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
            const auth = request.headers.authorization;
            const role = auth === `Bearer ${writerToken}` ? "writer" : auth === `Bearer ${readerToken}` ? "reader" : "denied";
            const entry = { method: request.method, path: request.url, role, ifMatch: request.headers["if-match"],
                ifNoneMatch: request.headers["if-none-match"] };
            audit.push(entry);
            if (options.auth !== false && (role === "denied" || (!reading && role !== "writer"))) {
                return problem(response, auth ? 403 : 401, "Directory authorization required");
            }
            purge();
            if (behavior.delayMs) await new Promise((resolve) => {
                const timer = setTimeout(() => { timers.delete(timer); resolve(); }, behavior.delayMs);
                timers.add(timer);
            });
            if (url.pathname === "/things") {
                if (!["GET", "HEAD"].includes(request.method)) return problem(response, 405, "Only listing on collection");
                const items = [...records].sort(([a], [b]) => compare(a, b));
                const limit = Number(url.searchParams.get("limit") ?? (items.length || 1));
                const offset = Number(url.searchParams.get("offset") ?? 0);
                if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(offset) || offset < 0) return problem(response, 400, "Invalid pagination");
                const revision = behavior.listRevision ? behavior.listRevision({ offset, collection, records }) : String(collection);
                const slice = behavior.ignoreLimits ? items : items.slice(offset, offset + limit);
                const next = behavior.nextLink ? behavior.nextLink({ offset, limit, items }) : offset + limit < items.length
                    ? `/things?limit=${limit}&offset=${offset + limit}` : undefined;
                const links = [`</things>; rel="canonical"; etag="${revision}"`, ...(next ? [`<${next}>; rel="next"`] : [])];
                response.writeHead(200, { "Content-Type": "application/ld+json", Link: links.join(", "), ETag: `"collection-http-${collection}"` });
                response.end(request.method === "HEAD" ? undefined : JSON.stringify(slice.map(([, item]) => enriched(item))));
                return;
            }
            if (!url.pathname.startsWith("/things/")) return problem(response, 404, "Endpoint absent");
            const id = decodeURIComponent(url.pathname.slice("/things/".length));
            const previous = records.get(id);
            entry.id = id;
            if (reading) {
                if (!previous) return problem(response, 404, "TD absent");
                const headers = behavior.omitEtag ? {} : { ETag: previous.etag };
                if (request.method === "HEAD") { response.writeHead(200, headers); response.end(); }
                else json(response, 200, enriched(previous), { "Content-Type": "application/td+json", ...headers });
                return;
            }
            const chunks = []; let bytes = 0;
            for await (const chunk of request) {
                bytes += chunk.length;
                if (bytes > 16 * 1024 * 1024) return problem(response, 413, "Request too large");
                chunks.push(chunk);
            }
            const body = bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
            entry.body = body;
            if (behavior.beforeWrite) await behavior.beforeWrite({ request, id, body, records, set });
            const current = records.get(id);
            if (behavior.nextWriteStatus) {
                const status = behavior.nextWriteStatus; behavior.nextWriteStatus = undefined;
                return problem(response, status, "Injected independent Directory rejection");
            }
            if ((request.headers["if-none-match"] === "*" && current)
                || (request.headers["if-match"] && request.headers["if-match"] !== current?.etag)) {
                return problem(response, 412, "Resource precondition failed");
            }
            if (request.method === "PUT") {
                if (!body || body.id !== id || typeof body.title !== "string" || !body["@context"]) return problem(response, 400, "Complete matching TD required");
                const value = set(id, body, current);
                response.writeHead(current ? 204 : 201, { ETag: value.etag });
                response.end();
            } else if (request.method === "PATCH") {
                if (!current) return problem(response, 404, "TD absent");
                if (request.headers["content-type"] !== "application/merge-patch+json") return problem(response, 415, "Merge Patch required");
                const patched = merge({ ...current.td, ...(current.ttl === undefined ? {} : { registration: { ttl: current.ttl } }) }, body);
                const value = set(id, patched, current);
                response.writeHead(204, { ETag: value.etag }); response.end();
            } else if (request.method === "DELETE") {
                if (!current) return problem(response, 404, "TD absent");
                records.delete(id); collection++; response.writeHead(204); response.end();
            } else problem(response, 405, "Unsupported method");
        })().catch((error) => {
            failure ??= error;
            if (!response.headersSent) problem(response, 500, "Independent Directory failure");
            else response.destroy();
        });
    });
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
        origin, collectionUrl: `${origin}/things`, modelBaseUrl: `${origin}/model-documents/`, records, audit, behavior,
        writerToken, readerToken, set, purge,
        contract: {
            verification: { mode: "owned-roundtrip", id: `urn:fixture:directory-preflight:${randomUUID()}` },
            ownership: { mode: "etag", evidence: "Owned loopback resource If-Match/If-None-Match and writer ACL" },
            list: { format: "array", pageSize: 2, maxPages: 32, maxItems: 2000, collectionRevision: "canonical-link", maxRestarts: 1 },
            expiry: { mode: "registration-ttl", ttlSeconds: 30, patch: true, purgeAttestation: "Owned fixture purges expired registrations before every CRUDL request" }
        },
        clientOptions(role = "writer") {
            return { collectionUrl: `${origin}/things`, contract: this.contract, http: {
                authorization: { origin, principal: `directory-${role}`, bearer: async () => role === "writer" ? writerToken : readerToken }
            } };
        },
        async close() {
            for (const timer of timers) clearTimeout(timer);
            server.closeIdleConnections();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            if (failure) throw failure;
        }
    };
}

function td(id, patch = {}) {
    return { "@context": [TD], id, title: "Independent Directory TD", securityDefinitions: { none: { scheme: "nosec" } },
        security: ["none"], ...patch };
}

module.exports = { directory, td, json, problem };
