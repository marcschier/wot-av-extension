import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { ROOT, SUPPORT_ROOT, readJSON, sha256, escapeHTML } from "./lib.mjs";
import { verifiedAssets } from "./assets.mjs";

export const PROFILE_ROOT = path.join(os.tmpdir(), "wot-av-publication-profiles");

async function browserDriver(toolPackage) {
    const require = createRequire(path.join(toolPackage ?? ROOT, "package.json"));
    const pkg = await readJSON(require.resolve("puppeteer/package.json"));
    if (pkg.version !== "25.10.0") throw new Error("Publication requires Puppeteer 25.10.0; do not restore another workspace or download a browser");
    return (await import(pathToFileURL(require.resolve("puppeteer")).href)).default;
}

export async function createServer(files) {
    const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
        const raw = req.url ?? "";
        if (req.method !== "GET" || req.headers["content-length"] || req.headers["transfer-encoding"]) { res.writeHead(405); res.end(); return; }
        if (raw.length > 2048 || /%|\\|\.\.|[?#]/.test(raw)) { res.writeHead(400); res.end(); return; }
        const asset = files.get(raw);
        if (!asset) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": asset.contentType, "Content-Length": asset.body.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(asset.body);
    });
    server.maxRequestsPerSocket = 100;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return { server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

function sectionHTML(markdown) {
    const out = [], stack = [];
    let chunk = false, rawPre = false;
    const closeChunk = () => { if (chunk) { out.push("\n</div>"); chunk = false; } };
    for (const line of markdown.split("\n")) {
        const heading = !rawPre && line.match(/^(#{2,6}) (.+) \{#([\w-]+)\}$/);
        if (heading) {
            closeChunk();
            const level = heading[1].length;
            while (stack.length && stack.at(-1) >= level) { out.push("</section>"); stack.pop(); }
            const id = heading[3];
            const text = escapeHTML(heading[2]).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
            out.push(`<section id="${id}"${id === "sotd" ? ' class="override"' : ""}><h${level}>${text}</h${level}>`);
            stack.push(level);
        } else {
            if (!chunk) { out.push('<div data-format="markdown">\n'); chunk = true; }
            out.push(rawPre || /<pre\b/.test(line) ? line : line.replace(/`([^`]+)`/g, (_, code) => "<code>" + escapeHTML(code).replace(/\{\{|\[\[|\[=/g, token => token[0] + "<span></span>" + token[1]) + "</code>"));
        }
        if (/<pre\b/.test(line) && !/<\/pre>/.test(line)) rawPre = true;
        if (/<\/pre>/.test(line)) rawPre = false;
    }
    closeChunk();
    while (stack.length) { out.push("</section>"); stack.pop(); }
    return out.join("\n");
}

export async function render(assembled, { qualify = false, timeout = 150000, toolPackage = process.env.PUBLICATION_TOOL_PACKAGE } = {}) {
    const { policy, lock, files, remote } = await verifiedAssets();
    const executableSha256 = sha256(await readFile(policy.browser.executable));
    if (!qualify && executableSha256 !== lock.browser.sha256) throw new Error("Installed browser changed; explicitly run the --fixture --qualify-browser gate before building or checking");
    const puppeteer = await browserDriver(toolPackage);
    const blocked = [], requests = [];
    const css = files.get("/assets/publication.css").body.toString();
    if (assembled.diagnostics.length) throw new Error("Unresolved normative inputs block technical draft rendering");
    const notes = `<aside class="prototype-notice"><strong>Independent technical draft - not approved for distribution.</strong> Editorial ownership is unassigned; first-party licensing is unselected. No W3C or ONVIF endorsement, group status, patent-policy commitment or implementation certification is asserted.</aside>`;
    const wrapper = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(assembled.title)}</title><style>${css}</style><link rel="icon" href="data:,"></head><body><p class="copyright">${escapeHTML(policy.publication.rights)}</p>${notes}${sectionHTML(assembled.markdown)}</body></html>`;
    files.set("/document", { body: Buffer.from(wrapper), contentType: "text/html; charset=utf-8" });
    let browser, service, profile;
    const outer = setTimeout(() => { if (browser?.process()) browser.process().kill(); }, timeout);
    outer.unref();
    try {
        await mkdir(PROFILE_ROOT, { recursive: true });
        profile = await mkdtemp(path.join(PROFILE_ROOT, `owned-${process.pid}-`));
        service = await createServer(files);
        browser = await puppeteer.launch({
            executablePath: policy.browser.executable, headless: true, pipe: true,
            userDataDir: profile, timeout: 30000, protocolTimeout: timeout,
            args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run",
                "--no-default-browser-check", "--disable-extensions", "--disable-breakpad", "--disable-domain-reliability",
                "--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication", "--metrics-recording-only",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--js-flags=--max-old-space-size=4096"]
        });
        const session = await browser.target().createCDPSession();
        const version = await session.send("Browser.getVersion");
        if (!qualify) for (const key of ["revision", "product", "protocolVersion"]) if (policy.browser[key] !== version[key]) throw new Error(`Reviewed browser ${key} differs; explicit fixture qualification required`);
        const qualification = { node: process.versions.node, puppeteer: "25.10.0", executableSha256, ...version };
        if (!qualify) {
            const pin = await readJSON(path.join(SUPPORT_ROOT, "browser-qualification.json"));
            for (const key of ["revision", "product", "protocolVersion", "executableSha256"]) if (pin[key] !== qualification[key]) throw new Error(`Browser protocol pin changed: ${key}`);
        }
        const page = await browser.newPage();
        page.setDefaultTimeout(timeout);
        await page.setViewport({ width: 1280, height: 900 });
        await page.setCacheEnabled(false);
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on("request", request => {
            const url = request.url();
            requests.push(url.startsWith(service.origin) ? url.slice(service.origin.length) : url);
            const asset = remote.get(url);
            if (asset && request.method() === "GET") { void request.respond({ status: 200, contentType: asset.contentType, body: asset.body }); return; }
            if (url.startsWith(service.origin + "/") && files.has(url.slice(service.origin.length)) && request.method() === "GET") { void request.continue(); return; }
            if (/^data:/.test(url)) { void request.continue(); return; }
            blocked.push(url); void request.abort("blockedbyclient");
        });
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.goto(service.origin + "/document", { waitUntil: "load", timeout });
        await page.evaluate(() => {
            const terms = new Set();
            for (const dfn of document.querySelectorAll("dfn")) {
                for (const name of (dfn.getAttribute("data-lt") ?? dfn.textContent).split("|")) {
                    const key = [dfn.getAttribute("data-dfn-for") ?? "", dfn.getAttribute("data-dfn-type") ?? "", name.trim().toLowerCase()].join("|");
                    if (terms.has(key)) throw new Error(`Ambiguous definition: ${name}`);
                    terms.add(key);
                }
            }
        });
        await page.addScriptTag({ url: service.origin + "/assets/mermaid.min.js" });
        await page.evaluate(async diagrams => {
            mermaid.initialize({ startOnLoad: false, securityLevel: "strict", deterministicIds: true, deterministicIDSeed: "publication", handDrawnSeed: 42, theme: "neutral", flowchart: { htmlLabels: false }, fontFamily: "sans-serif" });
            for (const item of diagrams) {
                const result = await mermaid.render(`${item.id}-svg`, item.renderInput);
                const panel = document.querySelector(`#${item.id} .diagram-panel`);
                panel.innerHTML = result.svg;
                const svg = panel.querySelector("svg");
                const ids = new Map([...svg.querySelectorAll("[id]")].map((e, index) => [e.id, `${item.id}-element-${index + 1}`]));
                const replace = value => value.replace(/#([A-Za-z_][\w.-]*)/g, (whole, id) => ids.has(id) ? "#" + ids.get(id) : whole);
                for (const e of svg.querySelectorAll("*")) {
                    if (ids.has(e.id)) e.id = ids.get(e.id);
                    for (const attr of [...e.attributes]) if (attr.name !== "id") e.setAttribute(attr.name, replace(attr.value));
                    if (e.tagName.toLowerCase() === "style") e.textContent = replace(e.textContent);
                }
                svg.setAttribute("role", "img");
                const title = document.createElementNS("http://www.w3.org/2000/svg", "title"), desc = document.createElementNS("http://www.w3.org/2000/svg", "desc");
                title.id = `${item.id}-title`; desc.id = `${item.id}-desc`;
                const heading = svg.closest("section")?.querySelector("h2,h3,h4,h5,h6")?.textContent ?? item.raw.split("\n")[0];
                title.textContent = `Diagram ${item.id.split("-").at(-1)}: ${heading}`;
                svg.closest("figure").querySelector("figcaption").textContent = `Diagram ${item.id.split("-").at(-1)} (informative): ${heading}.`;
                desc.textContent = "Informative diagram. Nodes and relationships: " + item.raw.split("\n").slice(1).map(s => s.trim()).join("; ");
                svg.prepend(title, desc);
                svg.setAttribute("aria-labelledby", `${title.id} ${desc.id}`);
            }
        }, assembled.diagrams);
        await page.evaluate(({ config, date, editorialOwnership }) => {
            window.respecConfig = {
                ...config,
                specStatus: "unofficial", subtitle: "Independent Editor's Draft",
                shortName: config.shortName,
                publishDate: date, latestVersion: "", thisVersion: "", noRecTrack: true,
                editors: [{ name: editorialOwnership }],
                authors: [], logos: [], doJsonLd: false, xref: false, github: false,
                noTOC: false, darkMode: false, highlightVars: false, addSectionLinks: false,
                lint: { a11y: true, "no-headingless-sections": true, "local-refs-exist": true },
                postProcess: [() => {
                    for (const div of document.querySelectorAll("div[data-format=markdown]")) div.replaceWith(...div.childNodes);
                    for (const [index, table] of [...document.querySelectorAll("table")].entries()) {
                        for (const th of table.querySelectorAll("thead th")) th.scope = "col";
                        if (!table.caption) { const caption = table.createCaption(); caption.textContent = `Table ${index + 1}: ${table.closest("section")?.querySelector("h2,h3,h4")?.textContent ?? "Reference data"}`; }
                        const panel = document.createElement("div");
                        panel.className = "table-panel"; panel.tabIndex = 0; panel.role = "region"; panel.setAttribute("aria-label", table.caption.textContent);
                        table.before(panel); panel.append(table);
                    }
                }]
            };
        }, { config: { title: assembled.title, shortName: assembled.metadata.shortName ?? "independent-draft", localBiblio: assembled.localBiblio }, date: assembled.metadata.draftDate ?? policy.sourceDate, editorialOwnership: policy.publication.editorialOwnership });
        await page.addScriptTag({ url: service.origin + "/assets/respec-w3c.js" });
        await page.waitForFunction(() => Boolean(document.respec));
        const status = await page.evaluate(async () => {
            await document.respec.ready;
            const diagnostic = e => ({ message: e.message, plugin: e.plugin });
            return { errors: document.respec.errors.map(diagnostic), warnings: document.respec.warnings.map(diagnostic) };
        });
        if (status.errors.length || status.warnings.length || blocked.length || pageErrors.length) throw new Error(JSON.stringify({ ...status, blocked, pageErrors }));
        const exported = await page.evaluate(async () => document.respec.toHTML());
        const html = await page.evaluate(({ exported, css, origin, rights }) => {
            const doc = new DOMParser().parseFromString(exported, "text/html");
            const comments = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT), removeComments = [];
            while (comments.nextNode()) if (/^-?[\d.]+%$/.test(comments.currentNode.data)) removeComments.push(comments.currentNode);
            for (const node of removeComments) node.remove();
            for (const node of doc.querySelectorAll("script,link,head style,meta[http-equiv],base,iframe,object,embed")) node.remove();
            for (const node of doc.querySelectorAll("*")) for (const attr of [...node.attributes]) {
                if (/^on/i.test(attr.name) || ["data-cite", "data-cite-frag", "data-cite-path", "data-xref-type", "data-respec-id", "about", "resource", "typeof", "property"].includes(attr.name)) node.removeAttribute(attr.name);
                else if (attr.value.includes(origin)) node.setAttribute(attr.name, attr.value.replaceAll(origin + "/document#", "#").replaceAll(origin + "#", "#"));
            }
            for (const dt of doc.querySelectorAll("dt")) if (/^Editor/.test(dt.textContent)) dt.textContent = "Editorial ownership (unassigned):";
            const notice = doc.querySelector(".copyright");
            if (!notice || notice.textContent.trim() !== rights) throw new Error("Unexpected rights notice");
            const style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
            const csp = doc.createElement("meta"); csp.httpEquiv = "Content-Security-Policy"; csp.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"; doc.head.prepend(csp);
            const meta = doc.createElement("meta"); meta.name = "publication-status"; meta.content = "Independent technical draft; distribution not approved"; doc.head.append(meta);
            return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML + "\n";
        }, { exported, css, origin: service.origin, rights: policy.publication.rights });
        if (/CC-BY|creativecommons\.org|W3C-internal|w3c\.org\/Consortium\/Legal|rel=["']license|application\/ld\+json|<script\b|[A-Z]:\\(?:Users|git|Program Files)\\|sourceMappingURL/i.test(html)) throw new Error("Unintended rights, status, executable or machine metadata in output");
        const check = await browser.newPage();
        await check.setJavaScriptEnabled(false);
        await check.setOfflineMode(true);
        await check.setViewport({ width: 390, height: 844 });
        await check.setContent(html, { waitUntil: "domcontentloaded" });
        const readable = await check.evaluate(({ codes, diagramCount, originalIds, citations }) => {
            const errors = [], ids = new Set();
            for (const e of document.querySelectorAll("[id]")) { if (ids.has(e.id)) errors.push(`Duplicate ID: ${e.id}`); ids.add(e.id); }
            for (const id of originalIds) if (!ids.has(id)) errors.push(`Source anchor lost: ${id}`);
            for (const a of document.querySelectorAll('a[href^="#"]')) {
                const id = decodeURIComponent(a.getAttribute("href").slice(1));
                if (id && !ids.has(id)) errors.push(`Missing fragment: ${id}`);
            }
            for (const code of codes) if (document.getElementById(code.id)?.textContent !== code.raw) errors.push(`Code text mismatch: ${code.id}`);
            const diagrams = [...document.querySelectorAll("figure.diagram svg")];
            if (diagrams.length !== diagramCount) errors.push("Missing SVG diagram");
            for (const svg of diagrams) if (!svg.querySelector("title")?.textContent || !svg.querySelector("desc")?.textContent || !svg.querySelector("path,rect,polygon,line") || !svg.getAttribute("aria-labelledby")) errors.push("Empty or inaccessible SVG");
            for (const table of document.querySelectorAll("table")) if (!table.caption || !table.querySelector('th[scope="col"]')) errors.push("Table lacks caption or scoped headers");
            for (const e of document.querySelectorAll("[src]")) if (!/^data:/.test(e.getAttribute("src"))) errors.push("External resource remains: " + e.getAttribute("src"));
            for (const e of document.querySelectorAll("svg image,svg use")) {
                const value = e.getAttribute("href") ?? e.getAttribute("xlink:href");
                if (value && !/^(#|data:)/.test(value)) errors.push("External SVG resource remains");
            }
            for (const style of document.querySelectorAll("style")) if (/@import|url\(\s*["']?(?:https?:|\/\/|file:)/i.test(style.textContent)) errors.push("External CSS resource remains");
            if (document.documentElement.scrollWidth > innerWidth + 2) errors.push(`Page overflow: ${document.documentElement.scrollWidth} > ${innerWidth}`);
            if (document.querySelectorAll("h1").length !== 1) errors.push("Expected one publication H1");
            if (!document.querySelector("#toc a[href^='#']")) errors.push("Missing generated table of contents");
            const referenceCounts = {}, referenceIds = {};
            const bibliography = [...document.querySelectorAll("dt[id]")];
            for (const [key, count] of Object.entries(citations)) {
                const entries = bibliography.filter(entry => entry.textContent.trim() === `[${key}]`);
                const id = entries.length === 1 ? entries[0].id : null;
                referenceIds[key] = id;
                referenceCounts[key] = id ? [...document.querySelectorAll('a[href^="#"]')].filter(a => a.getAttribute("href") === "#" + id).length : 0;
                if (!id || !ids.has(id) || referenceCounts[key] < count) errors.push(`Bibliography or citation count lost: ${key}`);
            }
            return { errors, textLength: document.body.innerText.length, headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length, tables: document.querySelectorAll("table").length, diagrams: diagrams.length, referenceCounts, referenceIds, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
        }, { codes: assembled.codes, diagramCount: assembled.diagrams.length, originalIds: assembled.originalIds, citations: assembled.citations });
        if (readable.errors.length) throw new Error(JSON.stringify(readable));
        return { html, report: { status, readable, browser: qualification, requests: [...new Set(requests)].sort(), blocked, source: assembled.source, inputs: assembled.inputs, regions: assembled.regions, diagnostics: assembled.diagnostics, annexes: assembled.annexes ?? null, localLinks: assembled.localLinks ?? [], referenceRewrites: assembled.referenceRewrites } };
    } finally {
        clearTimeout(outer);
        try {
            if (browser) await browser.close();
        } finally {
            try { if (service) await service.close(); }
            finally { if (profile) await rm(profile, { recursive: true, force: false }); }
        }
    }
}
