#!/usr/bin/env node
"use strict";

const { resolve } = require("node:path");
const { generateOnvif } = require("../packages/binding-onvif/dist/catalog/artifacts.js");

const args = process.argv.slice(2);
let check = false;
let root = resolve(__dirname, "..");
for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--check") check = true;
    else if (option === "--root" && args[index + 1]) root = resolve(args[++index]);
    else {
        console.error(`Unsupported option: ${option}. Usage: npm run generate:onvif -- [--check] [--root PATH]`);
        process.exit(2);
    }
}
try {
    const result = generateOnvif(root, check);
    if (check && result.stale.length) {
        console.error(`ONVIF artifacts are stale:\n${result.stale.join("\n")}`);
        process.exitCode = 1;
    } else {
        console.log(`${check ? "Verified" : "Generated"} ${result.artifacts} ONVIF artifacts; ${result.operations} native operations (${result.compiledOperations} structurally compiled), ${result.requirements} requirement rows.`);
        console.log(`Registry ${result.registryDigest}; offline source closure ${result.sources} XML / ${result.imports} imports. Runtime/profile conformance remains separate.`);
    }
} catch (error) {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : "ONVIF generation failed with a non-Error exception.");
    process.exitCode = 2;
}
