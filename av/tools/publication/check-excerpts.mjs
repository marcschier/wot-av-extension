import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTDExcerpt, decodeUTF8, logicalPath, parseTDExcerpt, REPO_ROOT, sourceTarget } from "./lib.mjs";

export async function checkExcerpts(text, source, root = REPO_ROOT) {
    text = text.replace(/\r\n/g, "\n");
    const matches = [...text.matchAll(/^<!-- td-excerpt: (.+) -->\n```jsonc\n([\s\S]*?)\n```[ \t]*$/gm)];
    const starts = text.match(/^```jsonc[ \t]*$/gm) ?? [];
    const directives = text.match(/^<!--\s*td-excerpt\b.*$/gm) ?? [];
    if (starts.length !== matches.length || directives.length !== matches.length) throw new Error("Every JSONC fence requires one adjacent td-excerpt directive");
    for (const match of matches) {
        const metadata = parseTDExcerpt(match[1]), { target, pointer } = sourceTarget(metadata.source);
        const name = logicalPath(source, target), spec = source.split("/")[0];
        if (!name.startsWith(`${spec}/examples/`) || !/\.json(?:ld)?$/.test(name)) throw new Error("TD excerpt source is outside the specification examples");
        const base = await realpath(path.join(root, spec, "examples"));
        const file = await realpath(path.join(root, ...name.split("/")));
        const relative = path.relative(base, file);
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("TD excerpt source escapes its examples root");
        assertTDExcerpt(match[2], decodeUTF8(await readFile(file)), pointer, metadata.retain);
    }
    return matches.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3) throw new Error("Usage: node check-excerpts.mjs <repository-relative Markdown path>; Markdown is read from stdin");
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        console.log(await checkExcerpts(decodeUTF8(Buffer.concat(chunks)), process.argv[2]));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
