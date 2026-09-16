import type { ThingDescription } from "wot-typescript-definitions";
import type { OnvifRuntimeOptions } from "./binding/runtime.js";
import { defineOperationRegistry } from "./binding/registry.js";
import type { RequestAddressing } from "./binding/request.js";
import { loadPackagedProjectionCatalog } from "./catalog/packaged.js";
import { createDiscoveryEngine } from "./discovery/engine.js";
import { NodeDatagramAdapter, type NodeDatagramOptions } from "./discovery/datagrams.js";
import { MemoryPersistence } from "./discovery/persistence.js";
import { RuntimeReadAdapter } from "./discovery/read-adapters.js";
import { ADDRESSING } from "./discovery/protocol.js";
import { assertSnapshot } from "./discovery/snapshot.js";
import type {
    Clock, DatagramAdapter, DiscoveryEngine, DiscoveryOptions, InventoryPersistence, InventorySnapshot,
    NativeReadRequest, NativeTarget
} from "./discovery/types.js";
import type { ProjectionCatalog, ProjectionPolicy } from "./projection/project.js";
import { PublicationError } from "./publication/common.js";
import { FilePublication, preparePublication, type PreparedPublication } from "./publication/models.js";
import { DirectoryPublisher, type PublicationReport } from "./publication/publisher.js";
import {
    projectInventory, type InventoryProjection, type SnapshotAdapterOptions
} from "./publication/snapshot-adapter.js";
import type { PublicationState } from "./publication/state.js";

export type BridgeInput = {
    readonly mode: "discover";
    readonly discovery: DiscoveryOptions;
    readonly runtimeOptions: (target: NativeTarget, request: NativeReadRequest) => Omit<OnvifRuntimeOptions, "registry">;
    readonly security: (target: NativeTarget) => Pick<ThingDescription, "security" | "securityDefinitions">;
    readonly principal?: (target: NativeTarget) => string;
    readonly addressing?: (target: NativeTarget) => RequestAddressing | undefined;
    readonly inventory?: InventoryPersistence;
    readonly datagrams?: NodeDatagramOptions;
} | {
    readonly mode: "fixture";
    readonly snapshot: InventorySnapshot;
};

export type BridgeOutput = { readonly mode: "inspect" }
    | { readonly mode: "directory"; readonly publisher: DirectoryPublisher; readonly modelBaseUrl: string }
    | { readonly mode: "file"; readonly publisher: FilePublication; readonly modelBaseUrl: string };

export interface OnvifBridgeOptions {
    readonly input: BridgeInput;
    readonly projection: ProjectionPolicy;
    readonly adapter?: SnapshotAdapterOptions;
    readonly output: BridgeOutput;
    readonly catalog?: ProjectionCatalog;
}

export interface BridgePorts {
    readonly clock?: Clock;
    readonly datagrams?: DatagramAdapter;
}

export interface BridgeInspection {
    readonly inventory: InventorySnapshot;
    readonly projection: InventoryProjection;
    readonly publication: PublicationState | null;
}

export class OnvifBridge {
    private engine: DiscoveryEngine | undefined;
    private catalog: ProjectionCatalog | undefined;
    private starting: Promise<void> | undefined;
    private pending: Promise<PublicationReport | PreparedPublication | null> | undefined;
    private closing: Promise<void> | undefined;
    private lifecycle: "new" | "starting" | "running" | "failed" | "closing" | "closed" = "new";

    constructor(private readonly options: OnvifBridgeOptions, private readonly ports: BridgePorts = {}) {
        if (!options || !options.input || !["discover", "fixture"].includes(options.input.mode)
            || !options.output || !["inspect", "directory", "file"].includes(options.output.mode)) {
            throw new PublicationError("InvalidConfiguration", "Bridge input and output modes must be explicit");
        }
        if (options.input.mode === "fixture") assertSnapshot(options.input.snapshot);
    }

    get state(): string { return this.lifecycle; }

    start(): Promise<void> {
        if (this.closing) return Promise.reject(new PublicationError("RuntimeClosed", "Bridge is closed"));
        this.starting ??= this.initialize().catch(async (error: unknown) => {
            this.lifecycle = "failed";
            try { await this.close(); }
            catch (cleanup) { throw new AggregateError([error, cleanup], "Bridge startup and owned cleanup failed"); }
            throw error;
        });
        return this.starting;
    }

    private assertOpen(): void {
        if (this.closing) throw new PublicationError("RuntimeClosed", "Bridge is closing");
    }

    private async initialize(): Promise<void> {
        this.lifecycle = "starting";
        this.catalog = this.options.catalog ?? loadPackagedProjectionCatalog();
        if (this.options.output.mode === "directory") await this.options.output.publisher.start();
        this.assertOpen();
        const input = this.options.input;
        if (input.mode === "discover") {
            const registry = defineOperationRegistry(this.catalog.registry.operations, this.catalog.registry.xml);
            const nativeRead = new RuntimeReadAdapter({
                runtimeOptions: (target, request) => ({ ...input.runtimeOptions(target, request), registry }),
                security: input.security,
                ...(input.principal === undefined ? {} : { principal: input.principal }),
                execute: async (runtime, thing, args, target, request) => {
                    const endpoint = target.endpointReference;
                    const addressing = input.addressing?.(target) ?? (endpoint ? {
                        namespace: ADDRESSING, to: endpoint.address,
                        referenceParameters: endpoint.referenceParameters, referenceProperties: endpoint.referenceProperties
                    } : undefined);
                    const response = await runtime.execute(thing, "inspect", args, {
                        target: target.xaddr, signal: request.signal, timeoutMs: request.timeoutMs,
                        maxResponseBytes: request.maxBytes,
                        ...(addressing === undefined ? {} : { addressing })
                    });
                    return response.value;
                }
            });
            this.engine = createDiscoveryEngine({
                datagrams: this.ports.datagrams ?? new NodeDatagramAdapter(input.datagrams),
                nativeRead, persistence: input.inventory ?? new MemoryPersistence(),
                ...(this.ports.clock ? { clock: this.ports.clock } : {})
            });
            await this.engine.start(input.discovery);
            await this.engine.whenIdle();
        }
        this.assertOpen();
        this.lifecycle = "running";
        await this.publish();
    }

    snapshot(): InventorySnapshot {
        if (this.options.input.mode === "fixture") return structuredClone(this.options.input.snapshot);
        return this.engine?.snapshot() ?? {
            schemaVersion: 1, revision: 0, capturedAt: this.ports.clock?.now() ?? Date.now(),
            devices: [], seeds: [], diagnostics: [], truncated: false
        };
    }

    async inspect(): Promise<BridgeInspection> {
        await this.start();
        this.assertOpen();
        await this.engine?.whenIdle();
        const catalog = this.catalog;
        if (!catalog) throw new PublicationError("InvalidConfiguration", "Bridge catalog is not initialized");
        const inventory = this.snapshot();
        return {
            inventory, projection: projectInventory(inventory, catalog, this.options.projection, this.options.adapter),
            publication: this.options.output.mode === "directory" ? this.options.output.publisher.snapshot() : null
        };
    }

    async refresh(deviceId?: string): Promise<PublicationReport | PreparedPublication | null> {
        await this.start();
        this.assertOpen();
        if (this.engine) {
            if (deviceId !== undefined) await this.engine.inspect(deviceId);
            else await this.engine.reconcile();
            await this.engine.whenIdle();
        } else if (deviceId !== undefined) throw new PublicationError("InvalidConfiguration", "Recorded fixture input cannot perform a native refresh");
        return this.reconcile();
    }

    reconcile(): Promise<PublicationReport | PreparedPublication | null> {
        if (this.lifecycle !== "running") return Promise.reject(new PublicationError("RuntimeClosed", "Bridge is not running"));
        if (this.pending) return Promise.reject(new PublicationError("PublicationBusy", "Bridge reconciliation must be serialized"));
        const work = this.publish();
        this.pending = work;
        void work.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
        return work;
    }

    private async publish(): Promise<PublicationReport | PreparedPublication | null> {
        this.assertOpen();
        if (this.options.output.mode === "inspect") return null;
        if (!this.catalog) throw new PublicationError("InvalidConfiguration", "Bridge catalog is not initialized");
        const projection = projectInventory(this.snapshot(), this.catalog, this.options.projection, this.options.adapter);
        const publication = preparePublication(projection, this.options.output.modelBaseUrl);
        if (this.options.output.mode === "directory") return this.options.output.publisher.reconcile(publication);
        await this.options.output.publisher.publish(publication);
        return publication;
    }

    close(): Promise<void> {
        this.closing ??= (async () => {
            this.lifecycle = "closing";
            const stopped = await Promise.allSettled([...(this.engine ? [this.engine.close()] : []), ...(this.pending ? [this.pending] : [])]);
            const publishers = await Promise.allSettled(this.options.output.mode === "inspect" ? [] : [this.options.output.publisher.close()]);
            this.lifecycle = "closed";
            const errors = [...stopped, ...publishers].filter((result) => result.status === "rejected").map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "Bridge did not confirm all owned cleanup");
        })();
        return this.closing;
    }
}

export function createOnvifBridge(options: OnvifBridgeOptions, ports?: BridgePorts): OnvifBridge {
    return new OnvifBridge(options, ports);
}
