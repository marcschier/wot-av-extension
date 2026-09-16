const Module = require("node:module");
const { resolve, dirname, sep } = require("node:path");
const packageRoot = require("../../../paths.cjs").runtime;
const output = resolve(__dirname, ".compiled");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
    if (parent && request.startsWith(".")) {
        const absolute = resolve(dirname(parent.filename), request);
        const distribution = resolve(packageRoot, "dist");
        if (absolute === distribution || absolute.startsWith(distribution + sep)) {
            request = output + absolute.slice(distribution.length);
        }
    }
    return original.call(this, request, parent, ...args);
};
