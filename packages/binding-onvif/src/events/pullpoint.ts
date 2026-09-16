import { AsyncLocalStorage } from "node:async_hooks";
import type { InteractionOptions } from "wot-typescript-definitions";
import { isRecord, OnvifError, positiveInteger } from "../binding/errors.js";
import { SoapFaultError, readEndpointReference, type EndpointReference } from "../binding/soap.js";
import type { NativeExecutionResult, NativeInvokeOptions } from "../binding/request.js";
import type { OperationDescriptor, OperationRegistry } from "../binding/registry.js";
import { childElements, equalQName, type CanonicalValue, type XmlElement } from "../xml/types.js";
import { encodeElement } from "../xml/mapper.js";
import { canonicalTopicFilter, EVENT_NS, WSN_NS, type ResolvedSubscription, type TopicFilter } from "./contracts.js";
import { duration, eventClock, fixedDurationMilliseconds, instantMilliseconds, type EventClock } from "./time.js";

export interface EventDiagnostic {
    readonly at: number;
    readonly code: string;
    readonly generation: number;
    readonly severity: "info" | "gap" | "error";
    readonly message: string;
    readonly execution?: string;
}
export interface EventLease {
    readonly currentTime: string;
    readonly terminationTime: string | null;
    readonly observedAt: number;
    readonly expiresAt: number | null;
    readonly basis: "server-current-time" | "previous-server-clock";
}
export interface NativeEventRecord {
    readonly value: CanonicalValue;
    readonly xml: XmlElement;
    readonly receivedAt: number;
    readonly currentTime: string;
    readonly terminationTime: string | null;
    readonly generation: number;
    readonly continuity: "initial" | "continuous" | "gap";
}
export interface EventSubscriptionOptions {
    readonly input?: Readonly<Record<string, unknown>>;
    readonly topicFilter?: TopicFilter;
    readonly pullTimeoutMs?: number;
    readonly messageLimit?: number;
    readonly minimumPollIntervalMs?: number;
    readonly requestGraceMs?: number;
    readonly cleanupTimeoutMs?: number;
    readonly leaseDuration?: string;
    readonly synchronize?: boolean;
    readonly renewal?: { readonly supported: true; readonly duration?: string; readonly marginMs?: number };
    readonly restartOnExpiry?: boolean;
    readonly maxRestarts?: number;
    readonly maxQueuedMessages?: number;
    readonly maxQueuedBytes?: number;
    readonly deliveryTimeoutMs?: number;
    readonly signal?: AbortSignal;
}
export interface ManagedEventSubscription {
    readonly active: boolean;
    readonly state: "creating" | "active" | "recovering" | "closing" | "closed" | "failed" | "uncertain";
    readonly stopPromise: Promise<void>;
    readonly lease: EventLease | undefined;
    readonly generation: number;
    readonly diagnostics: readonly EventDiagnostic[];
    readonly lastError: Error | undefined;
    readonly delivered: number;
    stop(options?: InteractionOptions): Promise<void>;
    close(): Promise<void>;
}
export interface PullPointAdapter {
    readonly registry: OperationRegistry;
    readonly contract: ResolvedSubscription;
    execute(operation: OperationDescriptor, input: unknown, options: NativeInvokeOptions): Promise<NativeExecutionResult>;
    authorize(endpoint: EndpointReference): void;
}
export interface PullPointListeners {
    next(record: NativeEventRecord): unknown;
    error?(error: Error): unknown;
}

type Settings = ReturnType<typeof settings>;
function settings(input: EventSubscriptionOptions) {
    const value: unknown = input;
    if (!isRecord(value) || Object.keys(value).some((key) => !["input", "topicFilter", "pullTimeoutMs", "messageLimit",
        "minimumPollIntervalMs", "requestGraceMs", "cleanupTimeoutMs", "leaseDuration", "synchronize", "renewal",
        "restartOnExpiry", "maxRestarts", "maxQueuedMessages", "maxQueuedBytes", "deliveryTimeoutMs", "signal"].includes(key))) {
        throw new OnvifError("InvalidConfiguration", "Unknown managed event subscription option");
    }
    if (input.input !== undefined && !isRecord(input.input)
        || input.signal !== undefined && !(input.signal instanceof AbortSignal)
        || input.synchronize !== undefined && typeof input.synchronize !== "boolean"
        || input.restartOnExpiry !== undefined && typeof input.restartOnExpiry !== "boolean") {
        throw new OnvifError("InvalidConfiguration", "Invalid native event subscription arguments");
    }
    const leaseDuration = input.leaseDuration ?? "PT60S";
    if (typeof leaseDuration !== "string" || fixedDurationMilliseconds(leaseDuration) <= 0) {
        throw new OnvifError("InvalidConfiguration", "Event lease duration must be positive and bounded");
    }
    const renewal = input.renewal;
    if (renewal !== undefined) {
        const raw: unknown = renewal;
        if (!isRecord(raw) || raw.supported !== true || Object.keys(raw).some((key) => !["supported", "duration", "marginMs"].includes(key))) {
            throw new OnvifError("InvalidConfiguration", "Renew is conditional and requires explicit supported=true");
        }
        if (fixedDurationMilliseconds(renewal.duration ?? leaseDuration) <= 0) throw new OnvifError("InvalidConfiguration", "Renew duration must be positive");
    }
    const maxRestarts = input.maxRestarts ?? 1;
    if (!Number.isSafeInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 10) throw new OnvifError("InvalidConfiguration", "Event restart bound must be 0..10");
    const pullTimeoutMs = input.pullTimeoutMs ?? 60000;
    if (!Number.isSafeInteger(pullTimeoutMs) || pullTimeoutMs < 0 || pullTimeoutMs > 2147000000) {
        throw new OnvifError("InvalidConfiguration", "PullPoint timeout must be 0..2147000000 milliseconds");
    }
    return {
        pullTimeoutMs,
        messageLimit: positiveInteger(input.messageLimit ?? 16, "messageLimit", 1024),
        minimumPollIntervalMs: positiveInteger(input.minimumPollIntervalMs ?? 50, "minimumPollIntervalMs", 60000),
        requestGraceMs: positiveInteger(input.requestGraceMs ?? 5000, "requestGraceMs", 300000),
        cleanupTimeoutMs: positiveInteger(input.cleanupTimeoutMs ?? 10000, "cleanupTimeoutMs", 300000),
        leaseDuration, synchronize: input.synchronize ?? false, renewal,
        renewalMarginMs: positiveInteger(renewal?.marginMs ?? 10000, "renewalMarginMs", 300000),
        restartOnExpiry: input.restartOnExpiry ?? false, maxRestarts,
        maxQueuedMessages: positiveInteger(input.maxQueuedMessages ?? 128, "maxQueuedMessages", 4096),
        maxQueuedBytes: positiveInteger(input.maxQueuedBytes ?? 4 * 1024 * 1024, "maxQueuedBytes", 16 * 1024 * 1024),
        deliveryTimeoutMs: positiveInteger(input.deliveryTimeoutMs ?? 10000, "deliveryTimeoutMs", 300000)
    };
}

function errorValue(error: unknown): Error {
    return error instanceof Error ? error : new OnvifError("InvalidValue", "Native event listener rejected with a non-Error value");
}
function resourceUnknown(error: unknown): boolean {
    return error instanceof SoapFaultError && (error.fault.subcodes.some((name) =>
        name.namespace === "http://docs.oasis-open.org/wsrf/r-2" && ["ResourceUnknown", "ResourceUnknownFault"].includes(name.localName))
        || error.fault.typedDetails?.some((detail) =>
            detail.name.namespace === "http://docs.oasis-open.org/wsrf/r-2" && detail.name.localName === "ResourceUnknownFault") === true);
}
const deliveryContext = new AsyncLocalStorage<OwnedPullPoint>();

class OwnedPullPoint implements ManagedEventSubscription {
    private currentState: ManagedEventSubscription["state"] = "creating";
    private currentLease: EventLease | undefined;
    private endpoint: EndpointReference | undefined;
    private endpointGone = false;
    private cleanupAttempted = false;
    private serverOffset: number | undefined;
    private currentGeneration = 0;
    private restarts = 0;
    private limitNegotiations = 0;
    private requestTimeout: number;
    private requestLimit: number;
    private stopRequested = false;
    private unsubscribeInput: unknown = {};
    private readonly abort = new AbortController();
    private readonly queue: { record: NativeEventRecord; bytes: number }[] = [];
    private queuedBytes = 0;
    private delivering = false;
    private delivery: Promise<void> | undefined;
    private deliveryFailure: Error | undefined;
    private failure: Error | undefined;
    private count = 0;
    private continuity: NativeEventRecord["continuity"] = "initial";
    private readonly findings: EventDiagnostic[] = [];
    private readonly options: Settings;
    private readonly input: Readonly<Record<string, unknown>>;
    private resolveStop!: () => void;
    private rejectStop!: (error: Error) => void;
    private resolveRemote!: () => void;
    private rejectRemote!: (error: Error) => void;
    readonly stopPromise: Promise<void>;
    private readonly remoteStopped: Promise<void>;

    constructor(
        private readonly adapter: PullPointAdapter, private readonly listeners: PullPointListeners,
        private readonly callerOptions: EventSubscriptionOptions, private readonly clock: EventClock
    ) {
        this.options = settings(callerOptions);
        if (this.options.renewal && adapter.contract.renew === undefined) throw new OnvifError("UnsupportedCapability", "No native Renew tuple is declared");
        if (this.options.synchronize && adapter.contract.synchronize === undefined) throw new OnvifError("UnsupportedCapability", "No native synchronization tuple is declared");
        this.requestTimeout = this.options.pullTimeoutMs;
        this.requestLimit = this.options.messageLimit;
        const input: Record<string, unknown> = { ...adapter.contract.descriptor.defaultInput, ...callerOptions.input };
        if (callerOptions.topicFilter !== undefined) {
            if (input.Filter !== undefined) throw new OnvifError("InvalidValue", "Specify either a TopicFilter or canonical native Filter, not both");
            input.Filter = canonicalTopicFilter(callerOptions.topicFilter, adapter.registry);
        }
        input.InitialTerminationTime ??= { $member: "{http://www.w3.org/2001/XMLSchema}duration", $value: this.options.leaseDuration };
        this.input = structuredClone(input);
        this.stopPromise = new Promise<void>((resolve, reject) => { this.resolveStop = resolve; this.rejectStop = reject; });
        this.remoteStopped = new Promise<void>((resolve, reject) => { this.resolveRemote = resolve; this.rejectRemote = reject; });
        void this.stopPromise.then(() => undefined, (error: unknown) => { this.failure = errorValue(error); });
        void this.remoteStopped.then(() => undefined, (error: unknown) => { this.failure ??= errorValue(error); });
    }

    get active(): boolean { return ["creating", "active", "recovering"].includes(this.currentState); }
    get state(): ManagedEventSubscription["state"] { return this.currentState; }
    get lease(): EventLease | undefined { return this.currentLease === undefined ? undefined : { ...this.currentLease }; }
    get generation(): number { return this.currentGeneration; }
    get diagnostics(): readonly EventDiagnostic[] { return this.findings.map((finding) => ({ ...finding })); }
    get lastError(): Error | undefined { return this.failure ?? this.deliveryFailure; }
    get delivered(): number { return this.count; }

    private now(): number {
        const now = this.clock.now();
        if (!Number.isSafeInteger(now)) throw new OnvifError("InvalidConfiguration", "Event clock must return a finite integer millisecond instant");
        return now;
    }

    private diagnostic(code: string, severity: EventDiagnostic["severity"], message: string, error?: unknown): void {
        if (severity === "gap") this.continuity = "gap";
        if (this.findings.length === 256) this.findings.shift();
        this.findings.push({ at: this.now(), code, severity, generation: this.currentGeneration, message,
            ...(error instanceof OnvifError ? { execution: error.execution } : {}) });
    }

    private target(timeoutMs: number, signal = true): NativeInvokeOptions {
        if (this.endpoint === undefined) throw new OnvifError("InvalidValue", "Native subscription has no owned EPR");
        return { target: this.endpoint.address, addressing: {
            namespace: this.endpoint.addressingNamespace, to: this.endpoint.address,
            referenceParameters: this.endpoint.referenceParameters, referenceProperties: this.endpoint.referenceProperties
        }, timeoutMs, ...(signal ? { signal: this.abort.signal } : {}) };
    }

    private timing(result: NativeExecutionResult, startedAt: number): void {
        const value = result.value;
        if (!isRecord(value)) throw new OnvifError("InvalidValue", "Native event timing response is not an object", "unknown");
        const current = value.CurrentTime, termination = value.TerminationTime;
        if (current !== undefined && typeof current !== "string") throw new OnvifError("InvalidValue", "Invalid lexical CurrentTime", "unknown");
        const indefinite = isRecord(termination) && termination.$nil === true;
        if (!indefinite && typeof termination !== "string") throw new OnvifError("InvalidValue", "Missing lexical TerminationTime", "unknown");
        if (current !== undefined) {
            const server = instantMilliseconds(current);
            if (this.currentLease !== undefined && server < instantMilliseconds(this.currentLease.currentTime)) {
                this.diagnostic("ServerClockRegression", "gap", "Server time moved backwards; reboot/clock-change continuity is not established");
            }
            this.serverOffset = startedAt - server;
        }
        if (this.serverOffset === undefined || current === undefined && this.currentLease === undefined) {
            throw new OnvifError("InvalidValue", "Initial native lease lacks CurrentTime", "unknown");
        }
        const currentTime = current ?? this.currentLease?.currentTime;
        if (currentTime === undefined) throw new OnvifError("InvalidValue", "No server clock evidence");
        this.currentLease = { currentTime, terminationTime: indefinite ? null : String(termination),
            observedAt: this.now(), expiresAt: indefinite ? null : instantMilliseconds(String(termination)) + this.serverOffset,
            basis: current === undefined ? "previous-server-clock" : "server-current-time" };
    }

    private async create(): Promise<void> {
        const started = this.now();
        const result = await this.adapter.execute(this.adapter.contract.create, this.input, {
            timeoutMs: this.options.cleanupTimeoutMs, signal: this.abort.signal
        });
        if (result.xml === undefined) throw new OnvifError("InvalidXml", "CreatePullPointSubscription returned no native message", "unknown");
        const reference = childElements(result.xml).find((node) =>
            equalQName(node.name, { namespace: EVENT_NS, localName: "SubscriptionReference" }));
        if (reference === undefined) throw new OnvifError("InvalidXml", "CreatePullPointSubscription has no EPR", "unknown");
        this.endpoint = readEndpointReference(reference);
        this.cleanupAttempted = false;
        this.endpointGone = false;
        this.currentGeneration++;
        this.adapter.authorize(this.endpoint);
        this.timing(result, started);
        if (this.options.synchronize && this.adapter.contract.synchronize !== undefined) {
            await this.adapter.execute(this.adapter.contract.synchronize, {}, this.target(this.options.cleanupTimeoutMs));
        }
        this.currentState = "active";
        this.diagnostic("SubscriptionCreated", "info", "Owned native EPR created; PullMessages supplies keepalive");
    }

    async start(): Promise<ManagedEventSubscription> {
        if (this.callerOptions.signal?.aborted) throw new OnvifError("RuntimeClosed", "Subscription was cancelled before creation");
        this.callerOptions.signal?.addEventListener("abort", this.externalStop, { once: true });
        try { await this.create(); }
        catch (error) {
            await this.finish(errorValue(error));
            throw this.failure ?? error;
        }
        void this.run().then(() => this.finish(), (error: unknown) => this.finish(errorValue(error)))
            .then(() => undefined, (error: unknown) => { this.failure = errorValue(error); this.rejectStop(this.failure); });
        return this;
    }

    private readonly externalStop = (): void => {
        if (this.stopRequested) return;
        this.stopRequested = true;
        this.currentState = "closing";
        this.abort.abort();
    };

    private async recover(reason: string, gone: boolean): Promise<void> {
        this.diagnostic(reason, "gap", "Subscription expired or its resource disappeared; delivery history has a gap");
        this.endpointGone = gone;
        if (!this.options.restartOnExpiry || this.restarts >= this.options.maxRestarts) {
            throw new OnvifError("OutcomeUnknown", "Event continuity ended; automatic subscription restart is disabled or exhausted", "unknown");
        }
        this.currentState = "recovering";
        await this.release();
        this.currentLease = undefined;
        this.serverOffset = undefined;
        this.restarts++;
        await this.create();
        this.continuity = "gap";
    }

    private limitFault(error: unknown): boolean {
        if (!(error instanceof SoapFaultError) || error.execution !== "rejected" || this.limitNegotiations >= 2) return false;
        const detail = error.fault.typedDetails?.find((entry) =>
            equalQName(entry.name, { namespace: EVENT_NS, localName: "PullMessagesFaultResponse" }));
        if (!isRecord(detail?.value)) return false;
        const timeout = detail.value.MaxTimeout, maximum = detail.value.MaxMessageLimit;
        if (typeof timeout !== "string" || typeof maximum !== "number" || !Number.isSafeInteger(maximum) || maximum <= 0) {
            throw new OnvifError("InvalidValue", "Native PullMessages fault advertised invalid request limits", "unknown");
        }
        const maxTimeout = Math.floor(fixedDurationMilliseconds(timeout));
        if (maxTimeout < 0) throw new OnvifError("InvalidValue", "Native maximum timeout is negative");
        const nextTimeout = Math.min(this.requestTimeout, maxTimeout), nextLimit = Math.min(this.requestLimit, maximum);
        if (nextTimeout === this.requestTimeout && nextLimit === this.requestLimit) return false;
        this.requestTimeout = nextTimeout;
        this.requestLimit = nextLimit;
        this.limitNegotiations++;
        this.diagnostic("ServerRequestLimits", "info", "Explicitly rejected pull limits were reduced to the advertised native maxima");
        return true;
    }

    private enqueue(record: NativeEventRecord): void {
        const bytes = Buffer.byteLength(JSON.stringify(record.value));
        if (this.queue.length + (this.delivering ? 1 : 0) >= this.options.maxQueuedMessages
            || this.queuedBytes + bytes > this.options.maxQueuedBytes) {
            this.diagnostic("DeliveryOverflow", "gap", "Bounded delivery capacity was exhausted; notifications were not replaced by empty successes");
            throw new OnvifError("XmlLimit", "Native event delivery queue exceeded its bound", "unknown");
        }
        this.queue.push({ record, bytes });
        this.queuedBytes += bytes;
        if (this.delivery === undefined) {
            const work = this.drain();
            this.delivery = work;
            void work.then(() => { if (this.delivery === work) this.delivery = undefined; }, (error: unknown) => {
                this.deliveryFailure = errorValue(error);
                this.diagnostic("DeliveryFailed", "gap", "Native event listener failed or exceeded its bounded deadline", error);
                this.abort.abort();
            });
        }
    }

    private async boundedCallback(callback: () => unknown): Promise<void> {
        const abort = new AbortController();
        const timeout = this.clock.sleep(this.options.deliveryTimeoutMs, abort.signal).then(() => {
            throw new OnvifError("OutcomeUnknown", "Event delivery callback exceeded its bounded deadline", "unknown");
        });
        try { await Promise.race([Promise.resolve().then(callback), timeout]); }
        finally { abort.abort(); }
    }

    private async drain(): Promise<void> {
        while (this.queue.length && !this.stopRequested) {
            const next = this.queue.shift();
            if (next === undefined) return;
            this.delivering = true;
            try {
                await deliveryContext.run(this, () => this.boundedCallback(() => this.listeners.next(next.record)));
                this.count++;
            } finally {
                this.delivering = false;
                this.queuedBytes -= next.bytes;
            }
        }
    }

    private async run(): Promise<void> {
        while (!this.stopRequested) {
            if (this.deliveryFailure !== undefined) throw this.deliveryFailure;
            const started = this.now(), lease = this.currentLease;
            if (lease === undefined) throw new OnvifError("InvalidValue", "Active native subscription lost its lease");
            if (lease.expiresAt !== null && lease.expiresAt <= started) {
                await this.recover("LeaseExpired", false);
                continue;
            }
            if (this.options.renewal && this.adapter.contract.renew !== undefined && lease.expiresAt !== null
                && lease.expiresAt - started <= this.options.renewalMarginMs) {
                let result: NativeExecutionResult;
                try {
                    result = await this.adapter.execute(this.adapter.contract.renew, {
                        TerminationTime: { $member: "{http://www.w3.org/2001/XMLSchema}duration",
                            $value: this.options.renewal.duration ?? this.options.leaseDuration }
                    }, this.target(this.options.cleanupTimeoutMs));
                } catch (error) {
                    if (this.stopRequested) {
                        this.diagnostic("RenewCancelled", "gap", "Pending renewal was cancelled; its outcome is not replayed", error);
                        return;
                    }
                    if (resourceUnknown(error)) { await this.recover("ResourceUnknownOrReboot", true); continue; }
                    this.diagnostic("RenewFailed", "gap", "Native renewal failed and was not automatically replayed", error);
                    throw error;
                }
                this.timing(result, started);
                this.diagnostic("SubscriptionRenewed", "info", "Explicitly supported WS-BaseNotification Renew extended the native lease");
            }
            const available = this.currentLease?.expiresAt === null ? this.requestTimeout
                : Math.max(0, (this.currentLease?.expiresAt ?? started) - this.now() - 1);
            const timeout = Math.min(this.requestTimeout, available);
            let result: NativeExecutionResult;
            try {
                result = await this.adapter.execute(this.adapter.contract.pull,
                    { Timeout: duration(timeout), MessageLimit: this.requestLimit },
                    this.target(timeout + this.options.requestGraceMs));
            } catch (error) {
                if (this.deliveryFailure !== undefined) throw this.deliveryFailure;
                if (this.stopRequested) {
                    this.diagnostic("PullCancelled", "gap", "Pending pull was cancelled; its drained-message outcome is not replayed", error);
                    return;
                }
                if (this.limitFault(error)) continue;
                if (resourceUnknown(error)) { await this.recover("ResourceUnknownOrReboot", true); continue; }
                this.diagnostic("PullFailed", "gap", "Native pull failed; uncertain stateful drains are never replayed", error);
                throw error;
            }
            this.timing(result, started);
            if (this.stopRequested) return;
            if (!isRecord(result.value) || !Array.isArray(result.value.NotificationMessage) || result.xml === undefined) {
                throw new OnvifError("InvalidValue", "PullMessages must return its canonical NotificationMessage array", "unknown");
            }
            const messages = result.value.NotificationMessage;
            const nodes = childElements(result.xml).filter((node) => equalQName(node.name, { namespace: WSN_NS, localName: "NotificationMessage" }));
            if (messages.length !== nodes.length || messages.length > this.requestLimit) {
                throw new OnvifError("InvalidValue", "Native response exceeds MessageLimit or loses notification structure", "unknown");
            }
            const timing = this.currentLease;
            if (timing === undefined) throw new OnvifError("InvalidValue", "PullMessages has no server timing");
            for (const [index, node] of nodes.entries()) {
                this.enqueue({ value: messages[index] as CanonicalValue, xml: node, receivedAt: this.now(),
                    currentTime: timing.currentTime, terminationTime: timing.terminationTime,
                    generation: this.currentGeneration, continuity: this.continuity });
                this.continuity = "continuous";
            }
            const wait = this.options.minimumPollIntervalMs - (this.now() - started);
            if (wait > 0) {
                try { await this.clock.sleep(wait, this.abort.signal); }
                catch (error) { if (this.deliveryFailure !== undefined) throw this.deliveryFailure; if (!this.stopRequested) throw error; }
            }
        }
    }

    private async release(): Promise<void> {
        if (this.endpoint === undefined || this.endpointGone || this.cleanupAttempted) return;
        this.cleanupAttempted = true;
        try {
            await this.adapter.execute(this.adapter.contract.unsubscribe, this.unsubscribeInput,
                this.target(this.options.cleanupTimeoutMs, false));
            this.endpointGone = true;
        } catch (error) {
            if (!resourceUnknown(error)) throw error;
            this.endpointGone = true;
            this.diagnostic("CleanupResourceAbsent", "info", "Native fault confirms that the owned subscription resource no longer exists", error);
        }
    }

    private async finish(error?: Error): Promise<void> {
        this.stopRequested = true;
        this.abort.abort();
        this.currentState = "closing";
        this.callerOptions.signal?.removeEventListener("abort", this.externalStop);
        const errors: Error[] = error === undefined ? [] : [error];
        try { await this.release(); this.resolveRemote(); }
        catch (cleanup) {
            const failure = errorValue(cleanup);
            errors.push(failure);
            this.rejectRemote(failure);
            this.currentState = "uncertain";
            this.diagnostic("UnsubscribeOutcomeUnknown", "error", "Owned Unsubscribe was not confirmed and will not be automatically replayed", cleanup);
        }
        const delivery = await Promise.allSettled(this.delivery === undefined ? [] : [this.delivery]);
        for (const result of delivery) if (result.status === "rejected") errors.push(errorValue(result.reason));
        if (this.queue.length) {
            this.diagnostic("UndeliveredNotifications", "gap", `${this.queue.length} bounded queued notifications were not delivered before shutdown`);
            this.queue.length = 0;
            this.queuedBytes = 0;
        }
        const distinct = [...new Set(errors)];
        if (distinct.length) {
            this.failure = distinct.length === 1 ? distinct[0] : new AggregateError(distinct, "Native event lifecycle or delivery failed");
            this.currentState = this.currentState === "uncertain" ? "uncertain" : "failed";
            if (this.failure !== undefined && this.listeners.error !== undefined) {
                try { await this.boundedCallback(() => this.listeners.error?.(this.failure ?? new Error("Event failure"))); }
                catch (notification) {
                    this.failure = new AggregateError([this.failure, errorValue(notification)], "Native event failure and error listener failure");
                }
            }
            this.rejectStop(this.failure ?? new Error("Native event failure"));
        } else {
            this.currentState = "closed";
            this.resolveStop();
        }
    }

    async stop(options: InteractionOptions = {}): Promise<void> {
        if (!isRecord(options) || Object.keys(options).some((key) => !["uriVariables", "formIndex", "data"].includes(key))
            || options.uriVariables !== undefined || options.formIndex !== undefined && options.formIndex !== 0) {
            return Promise.reject(new OnvifError("UnsupportedCapability", "Managed native cleanup uses the descriptor's returned EPR, not another Form/template"));
        }
        if (!this.stopRequested && options.data !== undefined) {
            encodeElement(this.adapter.contract.unsubscribe.request, options.data, this.adapter.registry.xml);
            this.unsubscribeInput = structuredClone(options.data);
        }
        this.externalStop();
        return deliveryContext.getStore() === this ? this.remoteStopped : this.stopPromise;
    }
    close(): Promise<void> { return this.stop(); }
}

export function startPullPoint(
    adapter: PullPointAdapter, listeners: PullPointListeners, options: EventSubscriptionOptions = {},
    clock: EventClock = eventClock()
): Promise<ManagedEventSubscription> {
    return new OwnedPullPoint(adapter, listeners, options, clock).start();
}
