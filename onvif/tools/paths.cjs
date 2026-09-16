"use strict";

const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");
let root = __dirname;
while (!existsSync(join(root, "publication-ownership.json"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Cannot locate the specification repository");
    root = parent;
}
module.exports = Object.freeze({
    root,
    av: join(root, "av"),
    onvif: join(root, "onvif"),
    runtime: join(root, "onvif", "samples", "reference-runtime"),
    tests: join(root, "onvif", "tools", "tests", "reference-runtime"),
    fixtures: join(root, "onvif", "tools", "fixtures", "reference-runtime")
});
