import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { Content, type ConsumedThing, type Form } from "@node-wot/core";
import { Subscription } from "rxjs/Subscription";
import type { InteractionOptions } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "../binding/errors.js";
import { isNativeForm, validateEventForm, BINDING_NAME } from "../binding/forms.js";
import type { NativeExecutor } from "../binding/executor.js";
import { operationReference } from "../binding/registry.js";
import { authorizeTarget, type SecurityContext } from "../security/policy.js";
import { serializeXml } from "../xml/parser.js";
import { startPullPoint, type EventSubscriptionOptions, type ManagedEventSubscription } from "./pullpoint.js";

export interface NativeEventOptions extends EventSubscriptionOptions {
    readonly formIndex?: number;
}

interface EventInvocation {
    readonly options: EventSubscriptionOptions;
    managed?: ManagedEventSubscription;
    delivery?: Promise<unknown>;
    notification?: Promise<unknown>;
}

const invocation = new AsyncLocalStorage<EventInvocation>();
type Subscribe = ConsumedThing["subscribeEvent"];

class OwnedEvent implements ManagedEventSubscription {
    private unlinking: Promise<void> | undefined;
    private failure: Error | undefined;
    readonly stopPromise: Promise<void>;

    constructor(private readonly native: ManagedEventSubscription, private readonly core: Awaited<ReturnType<Subscribe>>,
        private readonly formIndex: number) {
        this.stopPromise = native.stopPromise.then(() => this.unlink());
        // The rejection remains observable by stop/close/runtime.close and lastError.
        void this.stopPromise.catch((error: unknown) => {
            this.failure = error instanceof Error ? error : new OnvifError("InvalidValue", "Native event cleanup rejected with a non-Error value");
        });
    }

    private unlink(): Promise<void> {
        // Core 0.9 does not await event unlink. Remote cleanup is already confirmed here.
        return this.unlinking ??= this.core.stop();
    }

    get active() { return this.native.active; }
    get state() { return this.failure !== undefined && this.native.state === "closed" ? "failed" : this.native.state; }
    get lease() { return this.native.lease; }
    get generation() { return this.native.generation; }
    get diagnostics() { return this.native.diagnostics; }
    get lastError() { return this.failure ?? this.native.lastError; }
    get delivered() { return this.native.delivered; }
    async stop(options: InteractionOptions = {}): Promise<void> {
        if (!isRecord(options) || options.formIndex !== undefined && options.formIndex !== this.formIndex) {
            throw new OnvifError("UnsupportedCapability", "Native Event cleanup cannot select a different Form from its owned subscription");
        }
        const { formIndex: _, ...cleanup } = options;
        await this.native.stop(cleanup);
        await this.unlink();
    }
    close(): Promise<void> { return this.stop(); }
}

export class NativeEventClient {
    private readonly byForm = new WeakMap<Form, ManagedEventSubscription>();
    private readonly owned = new Set<ManagedEventSubscription>();
    private readonly starting = new Set<string>();
    private closing = false;
    private closeWork: Promise<void> | undefined;

    constructor(private readonly executor: NativeExecutor, private readonly context: SecurityContext) {}

    async subscribe(form: Form, next: (content: Content) => void, error?: (error: Error) => void): Promise<Subscription> {
        const call = invocation.getStore();
        if (call === undefined || this.closing) throw new OnvifError("RuntimeClosed", "Native Events require the owning runtime's active consumer");
        const contract = validateEventForm(form, this.executor.options.registry);
        const managed = await startPullPoint({
            registry: this.executor.options.registry, contract,
            authorize: (endpoint) => { authorizeTarget(endpoint.address, this.executor.options.trust, this.context.principal); },
            execute: (operation, input, options) => this.executor.execute(this.context, {
                href: form.href, op: "invokeaction", contentType: "application/soap+xml",
                ...(form.security === undefined ? {} : { security: form.security }),
                "onvif:binding": BINDING_NAME, "onvif:operation": operationReference(operation)
            }, input, options)
        }, {
            next: (record) => {
                delete call.delivery;
                next(new Content("application/soap+xml", Readable.from([
                    Buffer.from(serializeXml(record.xml, this.executor.limits), "utf8")
                ])));
                if (call.delivery === undefined) throw new OnvifError("InvalidValue", "node-wot did not deliver the native notification");
                return call.delivery;
            },
            error: (failure) => {
                delete call.notification;
                error?.(failure);
                return call.notification;
            }
        }, call.options);
        call.managed = managed;
        this.byForm.set(form, managed);
        this.owned.add(managed);
        return new Subscription();
    }

    unlink(form: Form): Promise<void> {
        const managed = this.byForm.get(form);
        if (managed === undefined) return Promise.reject(new OnvifError("InvalidValue", "No owned native subscription matches this Event Form"));
        return managed.stop();
    }

    async subscribeEvent(
        thing: ConsumedThing, original: Subscribe, name: string, listener: Parameters<Subscribe>[1],
        errorListener: Parameters<Subscribe>[2], options: NativeEventOptions = {}
    ): Promise<ManagedEventSubscription> {
        if (this.closing) throw new OnvifError("RuntimeClosed", "Native event client is closing");
        if (typeof listener !== "function" || errorListener !== undefined && typeof errorListener !== "function") {
            throw new OnvifError("InvalidValue", "Native Event listeners must be functions");
        }
        if (this.starting.has(name) || this.owned.size + this.starting.size >= 64) {
            throw new OnvifError("InvalidValue", "Native Event is already starting or owned subscription capacity was reached");
        }
        const index = options.formIndex ?? 0;
        if (!Number.isSafeInteger(index) || index < 0) throw new OnvifError("InvalidValue", "Invalid native Event Form index");
        const form = thing.events[name]?.forms[index];
        if (form === undefined || !isNativeForm(form)) throw new OnvifError("UnsupportedCapability", "Native subscription requires a native Event Form");
        validateEventForm(form, this.executor.options.registry);
        const { formIndex: _, ...eventOptions } = options;
        const call: EventInvocation = { options: eventOptions };
        this.starting.add(name);
        try {
            const core = await invocation.run(call, () => original.call(thing, name,
                (output) => { call.delivery = Promise.resolve().then(() => listener(output)); },
                (error) => { call.notification = Promise.resolve().then(() => errorListener?.(error)); },
                { formIndex: index }));
            if (call.managed === undefined) throw new OnvifError("InvalidValue", "node-wot did not start its native protocol subscription");
            const owned = new OwnedEvent(call.managed, core, index);
            this.owned.delete(call.managed);
            this.owned.add(owned);
            void owned.stopPromise.then(() => { this.owned.delete(owned); }, () => undefined);
            return owned;
        } catch (error) {
            if (call.managed !== undefined) {
                try { await call.managed.stop(); }
                catch (cleanup) { throw new AggregateError([error, cleanup], "Event registration and owned cleanup failed"); }
            }
            throw error;
        } finally { this.starting.delete(name); }
    }

    wrap(thing: ConsumedThing, track: <T>(work: () => Promise<T>) => Promise<T>): void {
        const original = thing.subscribeEvent;
        thing.subscribeEvent = (name, listener, errorListener, options = {}) => {
            const forms = thing.events[name]?.forms;
            if (forms === undefined || !forms.some(isNativeForm)) return original.call(thing, name, listener, errorListener, options);
            return track(() => {
                if (Object.keys(options).some((key) => !["formIndex", "data"].includes(key))
                    || options.data !== undefined && !isRecord(options.data)) {
                    throw new OnvifError("UnsupportedCapability", "Native Event options accept formIndex and canonical creation data; use runtime.subscribeEvent for controller options");
                }
                return this.subscribeEvent(thing, original, name, listener, errorListener, {
                    ...(options.formIndex === undefined ? {} : { formIndex: options.formIndex }),
                    ...(options.data === undefined ? {} : { input: options.data })
                });
            });
        };
    }

    close(): Promise<void> {
        return this.closeWork ??= (async () => {
            this.closing = true;
            const results = await Promise.allSettled([...this.owned].map((entry) => entry.stop()));
            const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
            if (failures.length) throw new AggregateError(failures, "Native event cleanup was not confirmed");
        })();
    }
}
