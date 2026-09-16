import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { OnvifError } from "../binding/errors.js";
import { boundedOptions } from "./policy.js";
import { assertSnapshot } from "./snapshot.js";
import type { Bounds, InventoryPersistence, InventorySnapshot } from "./types.js";

function code(error: unknown, expected: string): boolean {
    return error instanceof Error && "code" in error && error.code === expected;
}

function content(snapshot: InventorySnapshot): string {
    return JSON.stringify({ ...snapshot, capturedAt: 0 });
}

async function verifyWindowsAcl(target: string, directory: boolean): Promise<void> {
    const script = [
        "$ErrorActionPreference = 'Stop'",
        "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        "$allowed = @($user, 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-0')",
        `$acl = [System.IO.${directory ? "Directory" : "File"}]::GetAccessControl($env:ONVIF_PRIVATE_INVENTORY_PATH)`,
        "$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
        "if ($owner -notin $allowed) { throw 'Inventory owner is not trusted' }",
        "$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
        "foreach ($rule in $rules) { if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'Inventory ACL grants access outside its private owner/system/administrator set' } }",
        "Write-Output 'private'"
    ].join("; ");
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
        const result = await promisify(execFile)(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
            timeout: 5000, maxBuffer: 4096, windowsHide: true, encoding: "utf8",
            env: { ...process.env, ONVIF_PRIVATE_INVENTORY_PATH: target }
        });
        if (result.stdout.trim() !== "private") throw new OnvifError("PolicyDenied", "Windows private-directory ACL verification was inconclusive");
    } catch (error) {
        if (error instanceof OnvifError) throw error;
        throw new OnvifError("PolicyDenied", "Windows inventory directory ACL could not be established as private");
    }
}

export async function verifyPrivateInventoryDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new OnvifError("PolicyDenied", "Inventory requires an existing private non-symlink directory");
    }
    if (process.platform === "win32") await verifyWindowsAcl(directory, true);
    else if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
        throw new OnvifError("PolicyDenied", "Inventory directory must be owned by the process user and inaccessible to other users");
    }
}

export class MemoryPersistence implements InventoryPersistence {
    private stored: InventorySnapshot | null = null;
    private closed = false;
    readonly bounds: Bounds;
    constructor(initial: InventorySnapshot | null = null, bounds: Partial<Bounds> = {}) {
        this.bounds = boundedOptions(bounds);
        if (initial) { assertSnapshot(initial, this.bounds); this.stored = structuredClone(initial); }
    }
    async load(): Promise<InventorySnapshot | null> {
        if (this.closed) throw new OnvifError("RuntimeClosed", "Inventory persistence is closed");
        return structuredClone(this.stored);
    }
    async save(snapshot: InventorySnapshot): Promise<void> {
        if (this.closed) throw new OnvifError("RuntimeClosed", "Inventory persistence is closed");
        assertSnapshot(snapshot, this.bounds);
        if (this.stored && (snapshot.revision < this.stored.revision
            || (snapshot.revision === this.stored.revision && content(snapshot) !== content(this.stored)))) {
            throw new OnvifError("PolicyDenied", "Refusing a stale or contradictory inventory revision");
        }
        this.stored = structuredClone(snapshot);
    }
    async close(): Promise<void> { this.closed = true; }
}

export interface JsonFilePersistenceOptions {
    path: string;
    bounds?: Partial<Bounds>;
    verifyPrivateDirectory?: (directory: string) => Promise<void>;
}

export class JsonFilePersistence implements InventoryPersistence {
    private readonly bounds: Bounds;
    private readonly path: string;
    private lock: FileHandle | undefined;
    private opening: Promise<void> | undefined;
    private pending: Promise<void> | undefined;
    private stored: InventorySnapshot | null = null;
    private closing: Promise<void> | undefined;
    private closed = false;

    constructor(private readonly options: JsonFilePersistenceOptions) {
        if (!isAbsolute(options.path)) throw new OnvifError("InvalidConfiguration", "Inventory file requires an explicit absolute path");
        this.path = resolve(options.path);
        this.bounds = boundedOptions(options.bounds);
    }

    private async initialize(): Promise<void> {
        const directory = dirname(this.path);
        await verifyPrivateInventoryDirectory(directory);
        await this.options.verifyPrivateDirectory?.(directory);
        this.lock = await open(`${this.path}.lock`, "wx", 0o600);
        await this.lock.writeFile("ONVIF inventory single-writer lock\n", "utf8");
        await this.lock.sync();
        let file: FileHandle | undefined;
        try {
            const fileStat = await lstat(this.path);
            if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1
                || (process.platform !== "win32" && ((fileStat.mode & 0o077) !== 0 || (process.getuid && fileStat.uid !== process.getuid())))) {
                throw new OnvifError("PolicyDenied", "Inventory file is not a private regular file");
            }
            if (process.platform === "win32") await verifyWindowsAcl(this.path, false);
            file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const openedStat = await file.stat();
            if (openedStat.size > this.bounds.maxStoreBytes) throw new OnvifError("InvalidValue", "Inventory file exceeds its byte bound");
            const value: unknown = JSON.parse(await file.readFile("utf8"));
            assertSnapshot(value, this.bounds);
            this.stored = value;
        } catch (error) {
            if (!code(error, "ENOENT")) throw error;
        } finally { await file?.close(); }
    }

    private async ready(): Promise<void> {
        if (this.closed) throw new OnvifError("RuntimeClosed", "Inventory persistence is closed");
        this.opening ??= this.initialize();
        await this.opening;
    }

    async load(): Promise<InventorySnapshot | null> {
        await this.ready();
        return structuredClone(this.stored);
    }

    save(snapshot: InventorySnapshot): Promise<void> {
        if (this.pending) return Promise.reject(new OnvifError("PolicyDenied", "Inventory writes must be serialized by the owning engine"));
        const input = structuredClone(snapshot);
        const work = this.write(input);
        this.pending = work;
        void work.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
        return work;
    }

    private async write(snapshot: InventorySnapshot): Promise<void> {
        await this.ready();
        assertSnapshot(snapshot, this.bounds);
        if (this.stored && (snapshot.revision < this.stored.revision
            || (snapshot.revision === this.stored.revision && content(snapshot) !== content(this.stored)))) {
            throw new OnvifError("PolicyDenied", "Refusing a stale or contradictory durable inventory revision");
        }
        if (this.stored && snapshot.revision === this.stored.revision) return;
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        const file = await open(temporary, "wx", 0o600);
        let renamed = false;
        try {
            try { await file.writeFile(JSON.stringify(snapshot), "utf8"); await file.sync(); }
            finally { await file.close(); }
            await rename(temporary, this.path);
            renamed = true;
            this.stored = structuredClone(snapshot);
            if (process.platform !== "win32") {
                const directory = await open(dirname(this.path), constants.O_RDONLY);
                try { await directory.sync(); } finally { await directory.close(); }
            }
        } finally {
            if (!renamed) await unlink(temporary);
        }
    }

    close(): Promise<void> {
        if (!this.closing) {
            this.closed = true;
            this.closing = (async () => {
                const results = await Promise.allSettled([...(this.opening ? [this.opening] : []), ...(this.pending ? [this.pending] : [])]);
                if (this.lock) {
                    await this.lock.close();
                    await unlink(`${this.path}.lock`);
                    this.lock = undefined;
                }
                const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "Inventory persistence closed after an unconfirmed operation");
            })();
        }
        return this.closing;
    }
}
