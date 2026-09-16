import { randomUUID, createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isRecord } from "../binding/errors.js";
import { verifyPrivateInventoryDirectory } from "../discovery/persistence.js";
import { assertOwner, boundedInteger, isMissing, PublicationError } from "./common.js";

async function regularFile(path: string, maxBytes: number): Promise<Stats> {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) {
        throw new PublicationError("FileOwnership", "Publication data must be a bounded regular non-linked file");
    }
    return stat;
}

async function readBoundedFile(path: string, maxBytes: number): Promise<{ bytes: Buffer; identity: string }> {
    const initial = await regularFile(path, maxBytes);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== initial.dev || opened.ino !== initial.ino) {
            throw new PublicationError("FileOwnership", "Publication file changed while it was being opened");
        }
        if (opened.size > maxBytes) throw new PublicationError("PublicationLimit", "JSON file exceeds its byte bound");
        const bytes = await file.readFile();
        if (bytes.length > maxBytes) throw new PublicationError("PublicationLimit", "JSON file grew beyond its byte bound");
        const current = await regularFile(path, maxBytes);
        if (current.dev !== opened.dev || current.ino !== opened.ino || current.size !== bytes.length
            || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs) {
            throw new PublicationError("FileOwnership", "Publication file changed while it was being read");
        }
        return { bytes, identity: `${current.dev}:${current.ino}:${current.mtimeMs}:${current.ctimeMs}:${createHash("sha256").update(bytes).digest("hex")}` };
    } finally { await file.close(); }
}

export async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
    return JSON.parse((await readBoundedFile(path, maxBytes)).bytes.toString("utf8"));
}

export async function atomicJson(path: string, value: unknown, maxBytes: number): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value, null, 4) + "\n", "utf8");
    if (bytes.length > maxBytes) throw new PublicationError("PublicationLimit", "JSON publication exceeds its byte bound");
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    let renamed = false;
    try {
        try { await file.writeFile(bytes); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, path);
        renamed = true;
        if (process.platform !== "win32") {
            const directory = await open(dirname(path), constants.O_RDONLY);
            try { await directory.sync(); } finally { await directory.close(); }
        }
    } finally { if (!renamed) await unlink(temporary); }
}

export class OwnedJsonFile<T> {
    private lock: FileHandle | undefined;
    private opening: Promise<void> | undefined;
    private pending: Promise<void> | undefined;
    private stored: T | null = null;
    private identity: string | null = null;
    private closing: Promise<void> | undefined;
    readonly path: string;

    constructor(path: string, private readonly validate: (value: unknown) => asserts value is T,
        private readonly maxBytes = 16 * 1024 * 1024) {
        if (!isAbsolute(path)) throw new PublicationError("InvalidConfiguration", "Publication state requires an explicit absolute file path");
        this.path = resolve(path);
        boundedInteger(maxBytes, "state bytes", 64 * 1024 * 1024);
    }

    private async initialize(): Promise<void> {
        await verifyPrivateInventoryDirectory(dirname(this.path));
        this.lock = await open(`${this.path}.lock`, "wx", 0o600);
        await this.lock.writeFile("ONVIF publication single-writer lock\n");
        await this.lock.sync();
        try {
            const snapshot = await readBoundedFile(this.path, this.maxBytes);
            const value: unknown = JSON.parse(snapshot.bytes.toString("utf8"));
            this.validate(value);
            this.stored = value;
            this.identity = snapshot.identity;
        } catch (error) { if (!isMissing(error)) throw error; }
    }

    private async ready(): Promise<void> {
        if (this.closing) throw new PublicationError("RuntimeClosed", "Publication state is closed");
        this.opening ??= this.initialize();
        await this.opening;
    }

    async load(): Promise<T | null> { await this.ready(); return structuredClone(this.stored); }

    async verifyOwnership(): Promise<void> {
        await this.ready();
        let current: string | null = null;
        try { current = (await readBoundedFile(this.path, this.maxBytes)).identity; }
        catch (error) { if (!isMissing(error)) throw error; }
        if (current !== this.identity) throw new PublicationError("FileOwnership", "Refusing to replace independently changed publication state");
    }

    save(value: T): Promise<void> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Publication state is closed"));
        if (this.pending) return Promise.reject(new PublicationError("PublicationBusy", "Publication state writes must be serialized"));
        const input = structuredClone(value);
        this.validate(input);
        const work = (async () => {
            await this.verifyOwnership();
            await atomicJson(this.path, input, this.maxBytes);
            const written = await readBoundedFile(this.path, this.maxBytes);
            if (written.bytes.toString("utf8") !== JSON.stringify(input, null, 4) + "\n") {
                throw new PublicationError("FileOwnership", "Publication state changed after replacement");
            }
            this.identity = written.identity;
            this.stored = input;
        })();
        this.pending = work;
        void work.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
        return work;
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            const results = await Promise.allSettled([...(this.opening ? [this.opening] : []), ...(this.pending ? [this.pending] : [])]);
            if (this.lock) {
                await this.lock.close();
                await unlink(`${this.path}.lock`);
                this.lock = undefined;
            }
            const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
            if (failures.length) throw new AggregateError(failures, "Publication state closed after an unconfirmed operation");
        })();
        return this.closing;
    }
}

interface BundleManifest {
    schemaVersion: 1;
    owner: string;
    files: Record<string, string>;
}
export interface BundleDocument { readonly path: string; readonly value: unknown; }

/** Only manifest-owned, unmodified files can be replaced. Old models remain reachable. */
export class OwnedDocumentBundle {
    private readonly manifest: OwnedJsonFile<BundleManifest>;
    private current: BundleManifest | undefined;
    private pending: Promise<void> | undefined;
    private closed = false;
    readonly directory: string;

    constructor(directory: string, readonly owner: string, private readonly maxFileBytes = 64 * 1024 * 1024) {
        if (!isAbsolute(directory)) throw new PublicationError("InvalidConfiguration", "File export requires an explicit absolute directory");
        assertOwner(owner);
        this.directory = resolve(directory);
        const validate = (value: unknown): asserts value is BundleManifest => {
            if (!isRecord(value) || value.schemaVersion !== 1 || value.owner !== owner || !isRecord(value.files)
                || Object.keys(value.files).length > 20000 || Object.entries(value.files).some(([path, hash]) =>
                    !this.safeName(path) || typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))) {
                throw new PublicationError("FileOwnership", "Invalid bundle manifest or different publication owner");
            }
        };
        this.manifest = new OwnedJsonFile(join(this.directory, "onvif-bundle-manifest.json"), validate, 4 * 1024 * 1024);
    }

    private safeName(path: string): boolean {
        return path.length <= 512 && path.split("/").every((part) =>
            /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part) && part !== "." && part !== "..")
            && path !== "onvif-bundle-manifest.json" && !path.endsWith(".lock");
    }

    private async target(path: string): Promise<string> {
        if (!this.safeName(path)) throw new PublicationError("FileOwnership", "Unsafe relative document name");
        const parts = path.split("/");
        let directory = this.directory;
        for (const part of parts.slice(0, -1)) {
            directory = join(directory, part);
            try { await mkdir(directory, { mode: 0o700 }); }
            catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
            const stat = await lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) {
                throw new PublicationError("FileOwnership", "Document directories cannot be symlinks or junctions");
            }
        }
        return join(this.directory, ...parts);
    }

    write(documents: readonly BundleDocument[]): Promise<void> {
        if (this.closed) return Promise.reject(new PublicationError("RuntimeClosed", "Document bundle is closed"));
        if (this.pending) return Promise.reject(new PublicationError("PublicationBusy", "Bundle writes must be serialized"));
        const work = this.writeBatch(documents);
        this.pending = work;
        void work.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
        return work;
    }

    private async writeBatch(documents: readonly BundleDocument[]): Promise<void> {
        this.current ??= await this.manifest.load() ?? { schemaVersion: 1, owner: this.owner, files: {} };
        await this.manifest.verifyOwnership();
        if (documents.length > 20000 || new Set(documents.map((document) => document.path)).size !== documents.length) {
            throw new PublicationError("PublicationLimit", "Too many or duplicate bundle document paths");
        }
        for (const document of documents) {
            await this.manifest.verifyOwnership();
            const target = await this.target(document.path);
            const bytes = Buffer.from(JSON.stringify(document.value, null, 4) + "\n", "utf8");
            if (bytes.length > this.maxFileBytes) throw new PublicationError("PublicationLimit", "Model document exceeds its byte bound");
            const hash = createHash("sha256").update(bytes).digest("hex");
            let existing: string | undefined;
            try {
                await regularFile(target, this.maxFileBytes);
                existing = createHash("sha256").update(await readFile(target)).digest("hex");
            } catch (error) { if (!isMissing(error)) throw error; }
            if (existing !== undefined && this.current.files[document.path] !== existing) {
                throw new PublicationError("FileOwnership", "Refusing to overwrite an unowned or externally modified document");
            }
            if (existing !== hash) await atomicJson(target, document.value, this.maxFileBytes);
            this.current.files[document.path] = hash;
            await this.manifest.save(this.current);
        }
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        const results = await Promise.allSettled([...(this.pending ? [this.pending] : [])]);
        await this.manifest.close();
        const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Document bundle closed after a failed export");
    }
}
