import { spawn, type ChildProcess } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";
import { OnvifError } from "../binding/errors.js";
import type { MediaWorkerExit, NativeMediaProcess, NativeWorkerOptions } from "./types.js";

export function adaptNativeProcess(child: ChildProcess): NativeMediaProcess {
    const commands = child.stdin, control = child.stdout, stderr = child.stderr;
    const pipes: readonly (Readable | Writable | null | undefined)[] = child.stdio;
    const data = pipes[3], secrets = pipes[4], audio = pipes[5];
    if (!(commands instanceof Writable) || !(control instanceof Readable) || !(stderr instanceof Readable)
        || !(data instanceof Readable) || !(secrets instanceof Writable) || !(audio instanceof Writable)) {
        throw new OnvifError("InvalidConfiguration", "Native media requires six separately owned private pipes");
    }
    let spawnFailed = false;
    child.on("error", () => { spawnFailed = true; });
    const exit = new Promise<MediaWorkerExit>((resolve) => {
        child.once("close", (code, signal) => resolve({ observed: true, code, signal, ...(spawnFailed ? { spawnFailed: true } : {}) }));
    });
    return {
        get pid(): number | undefined { return child.pid; },
        commands, control, stderr, data, secrets, audio, exit,
        terminate(): boolean {
            return child.pid !== undefined && child.exitCode === null && child.signalCode === null && child.kill("SIGKILL");
        }
    };
}

export function spawnNativeMediaWorker(options: NativeWorkerOptions): NativeMediaProcess {
    if (typeof options.executable !== "string" || !isAbsolute(options.executable)
        || options.dllDirectory !== undefined && (typeof options.dllDirectory !== "string" || !isAbsolute(options.dllDirectory))
        || Object.keys(options).some((key) => !["executable", "dllDirectory"].includes(key))) {
        throw new OnvifError("InvalidConfiguration", "Native worker and optional DLL directory must be explicit absolute paths");
    }
    const environment = { ...process.env };
    if (options.dllDirectory !== undefined) {
        const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH");
        const prior = pathKey === undefined ? "" : environment[pathKey] ?? "";
        for (const key of Object.keys(environment)) if (key.toUpperCase() === "PATH") delete environment[key];
        environment.PATH = options.dllDirectory + delimiter + prior;
        environment.GSTRUNTIMEDLLPATH = options.dllDirectory;
    }
    return adaptNativeProcess(spawn(options.executable, [
        "--data-fd", "3", "--secret-fd", "4", "--input-fd", "5"
    ], { stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"], windowsHide: true, detached: false, env: environment }));
}
