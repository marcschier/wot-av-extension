import test from "node:test";
import assert from "node:assert/strict";
import { assemble, decodeUTF8, formatJSON, parseJSON, logicalPath, bibliography, readJSON, SUPPORT_ROOT, FIXTURE_ROOT, mermaidInput, readApproved, parseTDExcerpt, formatTDExcerpt, assertTDExcerpt } from "../lib.mjs";
import path from "node:path";
const refs = await readJSON(path.join(SUPPORT_ROOT, "bibliography.json"));
const run = (text, extra = {}) => assemble({ source: "spec.md", read: async () => text, refs, ...extra });
test("JSON retains exact tokens and expands four-space arrays", () => {
    assert.equal(formatJSON('{"n":900719925474099312345,"a":[1.2300e+02]}'), '{\n    "n": 900719925474099312345,\n    "a": [\n        1.2300e+02\n    ]\n}');
    assert.equal(formatJSON('{"a/b":{"~x":[900719925474099312345]}}', "/a~1b/~0x/0"), "900719925474099312345");
});
test("JSON rejects duplicate keys, invalid pointers and trailing data", () => {
    for (const source of ['{"a":1,"a":2}', '{"a":1,}', "01", "[1]false", '{"x":"\\q"}', "[\u00a01]", "\ufeff{}"]) assert.throws(() => parseJSON(source));
    assert.throws(() => formatJSON('{"a":1}', "/a~2"));
});
test("logical source locations permit siblings but reject traversal and URIs", () => {
    assert.equal(logicalPath("av/spec.md", "../onvif/spec.md"), "onvif/spec.md");
    for (const p of ["../../secret", "https://example.org/a", "C:\\secret", "/absolute"]) assert.throws(() => logicalPath("av/spec.md", p));
});
test("local bibliography preserves canonical alias and requires classified entries", () => {
    assert.equal(bibliography(refs).IEEE754.title, "IEEE 754-2019");
    assert.throws(() => bibliography({ ...refs, classification: {} }));
});
test("source metadata cannot select a different status or executable configuration", async () => {
    await assert.rejects(run('<!-- {"specStatus":"base"} -->\n# Title\n'), /status/);
    await assert.rejects(run('<!-- {"preProcess":"evil"} -->\n# Title\n'), /Unknown metadata/);
});
test("anchors, local citations and generated regions are strict", async () => {
    await assert.rejects(run('# Title\n<a id="a"></a>\n<a id="a"></a>'), /Duplicate explicit/);
    await assert.rejects(run("# Title\n[[!MISSING]]"), /Unresolved citation/);
    await assert.rejects(run("# Title\n<!-- BEGIN GENERATED: a -->\ntext"), /Unclosed/);
    const output = await run("# Title\n<!-- BEGIN GENERATED: a -->\nOriginal normative text.\n<!-- END GENERATED: a -->");
    assert.match(output.markdown, /Original normative text/);
    assert.equal(output.regions.length, 1);
});
test("include cycles, unknown inputs and example drift fail", async () => {
    await assert.rejects(run("# Title\n<!-- include: spec.md -->"), /cycle/);
    await assert.rejects(run("# Title\n<!-- example: a.json -->", { read: async name => { if (name === "spec.md") return "# Title\n<!-- example: a.json -->"; throw new Error(`Unapproved input: ${name}`); } }), /Unapproved input/);
    await assert.rejects(run("# Title\n<!-- include: https://example.org/a -->"), /Disallowed/);
});
test("HTML inside code cannot execute, active source HTML fails", async () => {
    const value = await run('# Title\n```html\n<script>alert(1)</script>\n```');
    assert.match(value.markdown, /&lt;script&gt;/);
    await assert.rejects(run('# Title\n<script>alert(1)</script>'), /Active HTML/);
    await assert.rejects(run('# Title\n[unsafe](javascript:alert)'), /Active HTML/);
    assert.equal((await run('# Title\n```html\n<img onerror="literal()">\n```')).codes[0].raw, '<img onerror="literal()">');
});
test("explicit heading IDs cannot be duplicated or shadow an anchor", async () => {
    await assert.rejects(run("# Title\n## One {#x}\n## Two {#x}"), /Duplicate final/);
    await assert.rejects(run('# Title\n<span id="x"></span>\n## Two {#x}'), /Duplicate final/);
});
test("sequence labels encode delimiter punctuation without changing input", () => {
    const source = "sequenceDiagram\nA->>B: Resolve; authorize\n";
    assert.equal(mermaidInput(source), "sequenceDiagram\nA->>B: Resolve#59; authorize\n");
    assert.equal(mermaidInput("flowchart LR\nA[\"a;b\"] --> B"), "flowchart LR\nA[\"a;b\"] --> B");
});
test("approved files are digest checked and undeclared inputs are never read", async () => {
    await assert.rejects(readApproved(FIXTURE_ROOT, "example.json", { "example.json": "0".repeat(64) }), /digest mismatch/);
    await assert.rejects(readApproved(FIXTURE_ROOT, "unknown.json", {}), /Unapproved input/);
});
test("paired source example exact tokens and populated regions are checked", async () => {
    const files = { "spec.md": '# Title\n<!-- BEGIN EXAMPLE: example.json# -->\n```json\n{"a":1}\n```\n<!-- END EXAMPLE: example.json# -->', "example.json": '{"a":2}' };
    await assert.rejects(run("", { read: async n => files[n] }), /Source example differs/);
    files["example.json"] = '{"a":1}';
    const result = await run("", { read: async n => files[n] });
    assert.equal(result.regions.length, 1);
});
test("document-wide reference links become locally classified citations", async () => {
    const href = refs.entries["WOT-TD11"].href;
    const result = await run(`# Title\n## One\n[TD][td]\n## Later\n[td]: ${href}`);
    assert.match(result.markdown, /\[\[!WOT-TD11\]\]/);
    assert.doesNotMatch(result.markdown, /\[TD\]\[td\]/);
    await assert.rejects(run("# Title\n[Missing][absent]"), /Missing document-wide/);
});
test("reference-looking text inside code remains literal", async () => {
    const result = await run("# Title\n```text\n[[MISSING]] [text][undefined]\n```\n`[[MISSING]]`");
    assert.equal(result.codes[0].raw, "[[MISSING]] [text][undefined]");
});
test("unfilled normative regions cannot use the retired prototype fallback", async () => {
    for (const raw of ["", "<!-- Replaced from the current edition manifest and catalogs. -->", "**TODO**: supply normative terms.", "TODO: supply normative terms.", "Placeholder for generated definitions.", "This is to be generated."]) {
        await assert.rejects(run(`# Title\n<!-- BEGIN GENERATED: terms -->\n${raw}\n<!-- END GENERATED: terms -->`), /Unassembled normative/);
    }
    await assert.rejects(run("# Title", { prototype: true }), /not supported/);
});
test("heading, footnote and link syntax in fenced examples remains literal", async () => {
    const raw = "# Not another title\n## Not a chapter {#ignored}\n[^unused]: not a reference\n[link](unapproved.md)";
    const result = await run("# Title\n```text\n" + raw + "\n```\n## A real chapter");
    assert.equal(result.codes[0].raw, raw);
    assert.equal(result.originalIds.length, 1);
    assert.match(result.markdown, /# Not another title/);
});
test("included document links resolve from the include rather than the root", async () => {
    const files = { "av/spec.md": "# Title\n<!-- include: annex/details.md -->", "av/annex/details.md": "## Details\n[Model](../model.json)\n[Other](../../onvif/spec.md)" };
    const result = await assemble({ source: "av/spec.md", refs, read: async name => files[name], outputMap: { "av/spec.md": "av/index.html", "onvif/spec.md": "onvif/index.html" } });
    assert.match(result.markdown, /\]\(model\.json\)/);
    assert.match(result.markdown, /\]\(\.\.\/onvif\/index\.html\)/);
});
test("example inputs and complete normative source pointers enter input evidence", async () => {
    const files = { "spec.md": '# Title\n<!-- BEGIN GENERATED: terms.json#/term -->\nComplete term definition.\n<!-- END GENERATED: terms.json#/term -->\n<!-- example: example.json#/data -->', "terms.json": '{"term":{}}', "example.json": '{"data":[1.200]}' };
    const result = await assemble({ source: "spec.md", refs, read: async name => files[name] });
    assert.deepEqual(Object.keys(result.inputs).sort(), ["example.json", "spec.md", "terms.json"]);
    files["spec.md"] = files["spec.md"].replaceAll("/term", "/absent");
    await assert.rejects(assemble({ source: "spec.md", refs, read: async name => files[name] }), /Missing JSON Pointer/);
});
test("QName punctuation receives stable noncolliding heading IDs", async () => {
    const result = await run("# Title\n## `{urn:a}op.name`\n## `{urn:a}op-name`");
    assert.equal(new Set(result.originalIds).size, 2);
    const reversed = await run("# Title\n## `{urn:a}op-name`\n## `{urn:a}op.name`");
    assert.deepEqual(result.originalIds.toSorted(), reversed.originalIds.toSorted());
});
test("canonical identities and physical artifact download locations stay distinct", async () => {
    const result = await run("# Title\n[Model](https://example.org/models/v2/Model)", {
        resolveLink: async () => ({ href: "https://example.org/models/v2/Model", artifactHref: "models/abstract/Model.tm.json" })
    });
    assert.match(result.markdown, /canonical identity; \[download local artifact\]\(models\/abstract\/Model\.tm\.json\)/);
});
test("longer closing fences, indentation and WebIDL-looking code stay literal", async () => {
    const output = await run("# Title\n  ~~~webidl\n  interface constructor {\n  };\n ~~~~\n");
    assert.equal(output.codes[0].raw, "interface constructor {\n};");
    assert.match(output.markdown, /code class="text"/);
    assert.throws(() => decodeUTF8(Buffer.from([0xc3, 0x28])), /encoded data/);
});
test("reviewed reference representations are explicit and retain an audit record", async () => {
    const href = refs.entries["WOT-TD11"].href;
    const alternate = "https://example.org/reviewed-td-representation";
    const mapped = { ...refs, hrefAliases: { [alternate]: href } };
    const result = await run(`# Title\n[TD][td]\n[td]: ${alternate}`, { refs: mapped });
    assert.match(result.markdown, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(result.referenceRewrites, [{ reference: "td", key: "WOT-TD11", sourceHref: alternate, href }]);
    await assert.rejects(run(`# Title\n[TD][td]\n[td]: ${alternate}`), /Uncurated/);
});

const excerptSource = '{"@context":["https://www.w3.org/2022/wot/td/v1.1",{"onvif":"https://example.org/wot/onvif#"}],"title":"Complete fixture","@type":"onvif:Device","properties":{"value":{"type":"number","minimum":900719925474099312345,"maximum":1.2300e+25,"description":"https://example.invalid/a// ...","forms":[{"href":"https://example.invalid/value","op":"readproperty"}]}},"securityDefinitions":{"none":{"scheme":"nosec"}},"security":["none"]}';
const excerptPaths = ["/@context", "/@type", "/properties/value/minimum", "/properties/value/maximum", "/properties/value/description"];
const excerptMarkdown = (body, metadata = { source: "example.json#", retain: excerptPaths }) =>
    `# Title\n<!-- td-excerpt: ${JSON.stringify(metadata)} -->\n\`\`\`jsonc\n${body}\n\`\`\``;

test("TD excerpts retain correct nesting, exact numeric and URL tokens, and explicit omissions", () => {
    const body = formatTDExcerpt(excerptSource, "", excerptPaths);
    assert.equal(body, `{
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        {
            "onvif": "https://example.org/wot/onvif#"
        }
    ],
    "@type": "onvif:Device",
    "properties": {
        "value": {
            "minimum": 900719925474099312345,
            "maximum": 1.2300e+25,
            "description": "https://example.invalid/a// ..."
            // ...
        }
    }
    // ...
}`);
    assert.equal(assertTDExcerpt(body, excerptSource, "", excerptPaths), body);
    assert.throws(() => parseJSON(body), /JSON/);
});

test("TD excerpts reject changed visible values, lost contexts, wrong omissions and arbitrary JSONC", async () => {
    const body = formatTDExcerpt(excerptSource, "", excerptPaths);
    for (const invalid of [
        body.replace("900719925474099312345", "900719925474099312346"),
        body.replace('"onvif:Device"', '"onvif:Semantic"'),
        body.replace("    // ...", ""),
        body.replace("// ...", "// hidden mistake"),
        body.replace('"@type": "onvif:Device",', '"@type": "onvif:Device",\n    "@type": "onvif:Device",'),
        body.replace("    \"@context\"", "  \"@context\"")
    ]) assert.throws(() => assertTDExcerpt(invalid, excerptSource, "", excerptPaths), /Source TD excerpt differs/);
    for (const retain of [[], ["/@type"], ["/@context/0", "/@type"], ["/@context", "/@context"]]) {
        assert.throws(() => parseTDExcerpt(JSON.stringify({ source: "example.json", retain })), /complete \/@context/);
    }
    await assert.rejects(run(`# Title\n\`\`\`jsonc\n${body}\n\`\`\``), /requires.*td-excerpt/);
    await assert.rejects(run('# Title\n```json\n{"n":1 // ...\n}\n```'), /JSON/);
});

test("TD excerpt selectors reject absent, overlapping, malformed and array-reindexing paths", () => {
    for (const paths of [
        ["/@context", "/absent"], ["/@context", "/properties~2"], ["/@context", "/properties", "/properties/value"],
        ["/@context", "/properties/value", "/properties"], ["/@context", "/security/01"]
    ]) assert.throws(() => formatTDExcerpt(excerptSource, "", paths), /Pointer|Overlapping/);
    const source = excerptSource.replace('"security":["none"]', '"security":["none","other"]');
    assert.throws(() => formatTDExcerpt(source, "", ["/@context", "/security/1"]), /contiguous prefix/);
    const fullArray = formatTDExcerpt(source, "", ["/@context", "/security"]);
    assert.match(fullArray, /"security": \[\n        "none",\n        "other"\n    \]/);
    assert.throws(() => formatTDExcerpt('{"@type":"onvif:Device"}', "", ["/@context"]), /complete TD or TM/);
    assert.throws(() => formatTDExcerpt(excerptSource.replace(',{"onvif":"https://example.org/wot/onvif#"}', ""), "", excerptPaths), /complete ONVIF context/);
});

test("TD excerpts mark omitted array tails and preserve escaped names, empty arrays and null", () => {
    const source = '{"@context":["https://www.w3.org/2022/wot/td/v1.1"],"title":"Arrays","forms":[{"href":"https://example.invalid/first","op":"readallproperties"},{"href":"https://example.invalid/second","op":"readallproperties"}],"a/b":{"~x":[]},"nil":null}';
    const body = formatTDExcerpt(source, "", ["/@context", "/forms/0/href", "/a~1b/~0x", "/nil"]);
    assert.match(body, /"forms": \[\n        \{\n            "href": "https:\/\/example\.invalid\/first"\n            \/\/ \.\.\.\n        \}\n        \/\/ \.\.\.\n    \]/);
    assert.match(body, /"a\/b": \{\n        "~x": \[\]\n    \}/);
    const value = JSON.parse(body.split("\n").filter(line => !/^ *\/\/ \.\.\.$/.test(line)).join("\n"));
    assert.deepEqual(value.forms, [{ href: "https://example.invalid/first" }]);
    assert.deepEqual(value["a/b"], { "~x": [] });
    assert.equal(value.nil, null);
});

test("source-bound TD excerpts enter publication evidence and remain escaped literal code", async () => {
    const body = formatTDExcerpt(excerptSource, "", excerptPaths);
    const files = { "spec.md": excerptMarkdown(body), "example.json": excerptSource };
    const result = await run("", { read: async name => files[name] });
    assert.equal(result.codes[0].language, "jsonc");
    assert.equal(result.codes[0].raw, body);
    assert.equal(result.regions[0].kind, "TD-EXCERPT");
    assert.equal(result.regions[0].input, "example.json");
    assert.deepEqual(result.regions[0].retain, excerptPaths);
    assert.deepEqual(Object.keys(result.inputs).sort(), ["example.json", "spec.md"]);
    files["example.json"] = excerptSource.replace("900719925474099312345", "900719925474099312346");
    await assert.rejects(run("", { read: async name => files[name] }), /Source TD excerpt differs/);
    files["spec.md"] = excerptMarkdown(body).replace("\n```jsonc", "\n\n```jsonc");
    await assert.rejects(run("", { read: async name => files[name] }), /adjacent jsonc fence/);
});
