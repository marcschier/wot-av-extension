import { runCLI } from "../../../av/tools/publication/build-specs.mjs";

await runCLI([...process.argv.slice(2), "--onvif"]);
