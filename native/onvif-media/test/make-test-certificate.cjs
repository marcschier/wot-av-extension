const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const requirePackage = createRequire(resolve(__dirname, "../../../packages/binding-onvif/package.json"));
const selfsigned = requirePackage("selfsigned");
const wrongHost = process.argv.includes("--wrong-host");
const identity = selfsigned.generate([{ name: "commonName", value: "Owned ephemeral ONVIF fixture" }], {
    algorithm: "sha256", keySize: 2048, days: 1,
    extensions: [
        { name: "basicConstraints", cA: true },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: wrongHost
            ? [{ type: 2, value: "not-the-approved-host.invalid" }]
            : [{ type: 7, ip: "127.0.0.1" }, { type: 2, value: "localhost" }] }
    ]
});
// stdout is a captured private child pipe, not a log. No fixture keys enter source control.
process.stdout.write(JSON.stringify({ cert: identity.cert, key: identity.private }));
