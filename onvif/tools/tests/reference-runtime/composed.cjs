const Module = require("node:module");
const { resolve, dirname, relative, sep } = require("node:path");
const tests = __dirname;
const distribution = resolve(require("../../paths.cjs").runtime, "dist");
const original = Module._resolveFilename;

// Preserved owner suites use isolated output paths. Qualification uses only the
// current composed build, never an old isolated build or a fallback artifact.
Module._resolveFilename = function (request, parent, ...args) {
    if (parent && request.startsWith(".")) {
        const parts = relative(tests, resolve(dirname(parent.filename), request)).split(sep);
        if (["discovery", "events", "publication", "media"].includes(parts[0])
            && [".compiled", ".compiled-unit"].includes(parts[1])) {
            request = resolve(distribution, ...parts.slice(2));
        }
    }
    return original.call(this, request, parent, ...args);
};
