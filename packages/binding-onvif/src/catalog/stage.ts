import { resolve } from "node:path";
import { stagePackagedArtifacts } from "./artifacts.js";

stagePackagedArtifacts(resolve(__dirname, "..", "..", "..", ".."));
