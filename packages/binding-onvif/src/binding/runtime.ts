import { ConsumedThing, Servient, type Form } from "@node-wot/core";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError, positiveInteger } from "./errors.js";
import { NativeExecutor, type ExecutorOptions } from "./executor.js";
import { CanonicalSoapCodec, isNativeForm, prepareDescription, validateNativeForm } from "./forms.js";
import { MultiplexFactory, type TrackInteraction } from "./multiplexer.js";
import { readEndpointReference, type EndpointReference } from "./soap.js";
import { authorizeTarget, validateTrust, type SecurityContext } from "../security/policy.js";
import { projectedEndpointReference } from "../security/logical-endpoint.js";
import { validateUsernameTokenPolicy } from "../security/username-token.js";
import { digestPolicy } from "../security/digest.js";
import { xmlLimits } from "../xml/parser.js";
import { decodeMetadata } from "../xml/metadata.js";
import type { CanonicalValue } from "../xml/types.js";
import type { NativeExecutionResult, NativeInvokeOptions } from "./request.js";
import { NativeEventClient, type NativeEventOptions } from "../events/consumer.js";
import type { ManagedEventSubscription } from "../events/pullpoint.js";

export interface OnvifRuntimeOptions extends Omit<ExecutorOptions, "timeoutMs"> {
    timeoutMs?: number;
    requiredCapabilities?: readonly string[];
}
export interface ConsumeContext { principal?: string; }
export interface ManagedSubscriptionOptions {
    endpoint: EndpointReference;
    unsubscribeAction: string;
    formIndex?: number;
}
export type SubscriptionState = "active" | "closing" | "closed" | "uncertain";
export interface ManagedSubscription {
    readonly state: SubscriptionState;
    stop(): Promise<void>;
    close(): Promise<void>;
}
export interface OnvifRuntime {
    readonly capabilities: readonly string[];
    consume(description: ThingDescription, context?: ConsumeContext): Promise<ConsumedThing>;
    invokeAction(thing: ConsumedThing, name: string, input?: Parameters<ConsumedThing["invokeAction"]>[1],
        options?: NativeInvokeOptions): ReturnType<ConsumedThing["invokeAction"]>;
    execute(thing: ConsumedThing, name: string, input?: unknown, options?: NativeInvokeOptions): Promise<NativeExecutionResult>;
    decodeMetadata(content: string | Uint8Array): CanonicalValue;
    subscribeEvent(thing: ConsumedThing, name: string, listener: Parameters<ConsumedThing["subscribeEvent"]>[1],
        errorListener?: Parameters<ConsumedThing["subscribeEvent"]>[2], options?: NativeEventOptions): Promise<ManagedEventSubscription>;
    manageSubscription(thing: ConsumedThing, options: ManagedSubscriptionOptions): ManagedSubscription;
    close(): Promise<void>;
}

const capabilities = Object.freeze([
    "soap12-document-literal", "canonical-xml-v1", "http-https-multiplex",
    "http-digest-md5", "http-digest-sha256", "wsse-username-token",
    "tls-server-identity", "tls-client-identity", "managed-epr-unsubscribe", "addressed-native-requests",
    "one-way-accepted-empty", "canonical-mixed-content", "canonical-metadata-stream", "native-pullpoint-events"
]);

class OwnedSubscription implements ManagedSubscription {
    private currentState: SubscriptionState = "active";
    private stopping: Promise<void> | undefined;
    constructor(private readonly cleanup: () => Promise<void>) {}
    get state(): SubscriptionState { return this.currentState; }
    stop(): Promise<void> {
        if (this.stopping === undefined) {
            this.currentState = "closing";
            this.stopping = this.cleanup().then(() => { this.currentState = "closed"; }, (error: unknown) => {
                this.currentState = "uncertain";
                throw error;
            });
        }
        return this.stopping;
    }
    close(): Promise<void> { return this.stop(); }
}

class Runtime implements OnvifRuntime {
    readonly capabilities = capabilities;
    private readonly executor: NativeExecutor;
    private readonly contexts = new WeakMap<ConsumedThing, { context: SecurityContext; description: ThingDescription }>();
    private readonly services = new Set<{ servient: Servient; factories: MultiplexFactory[]; codec: CanonicalSoapCodec; events: NativeEventClient }>();
    private readonly invocation = new AsyncLocalStorage<NativeInvokeOptions>();
    private readonly events = new WeakMap<ConsumedThing, { client: NativeEventClient; subscribe: ConsumedThing["subscribeEvent"] }>();
    private readonly subscriptions = new Set<OwnedSubscription>();
    private readonly pending = new Set<Promise<unknown>>();
    private accepting = true;
    private closing: Promise<void> | undefined;

    constructor(options: ExecutorOptions) { this.executor = new NativeExecutor(options); }

    private readonly track: TrackInteraction = <T>(work: () => Promise<T>, cleanup = false): Promise<T> => {
        if (!this.accepting && !cleanup) return Promise.reject(new OnvifError("RuntimeClosed", "Native runtime is closing or closed"));
        const promise = Promise.resolve().then(work);
        this.pending.add(promise);
        void promise.then(() => { this.pending.delete(promise); }, () => { this.pending.delete(promise); });
        return promise;
    };

    consume(description: ThingDescription, context: ConsumeContext = {}): Promise<ConsumedThing> {
        return this.track(async () => {
            const prepared = prepareDescription(description, context.principal ?? "default",
                this.executor.options.registry, this.executor.options.trust, this.executor.limits);
            if (this.executor.options.trust.authorizeLogicalEndpoint !== undefined) {
                const endpointReference = projectedEndpointReference(prepared.description);
                if (endpointReference !== undefined) prepared.context = Object.freeze({ ...prepared.context, endpointReference });
            }
            const servient = new Servient();
            const events = new NativeEventClient(this.executor, prepared.context);
            const factories = (["http", "https"] as const).map((scheme) =>
                new MultiplexFactory(scheme, this.executor, prepared.context, this.track, () => this.invocation.getStore(), events));
            for (const factory of factories) servient.addClientFactory(factory);
            const codec = new CanonicalSoapCodec(this.executor.options.registry);
            servient.addMediaType(codec);
            this.services.add({ servient, factories, codec, events });
            const wot = await servient.start();
            const thing = await wot.consume(prepared.description);
            if (!(thing instanceof ConsumedThing)) throw new OnvifError("UnsupportedCapability", "Unexpected node-wot consumer implementation");
            this.contexts.set(thing, prepared);
            this.events.set(thing, { client: events, subscribe: thing.subscribeEvent });
            events.wrap(thing, this.track);
            return thing;
        });
    }

    private nativeAction(thing: ConsumedThing, name: string, options: NativeInvokeOptions) {
        const owned = this.contexts.get(thing);
        if (owned === undefined) throw new OnvifError("InvalidValue", "Consumed Thing is not owned by this runtime");
        const index = options.formIndex ?? 0;
        if (!Number.isSafeInteger(index) || index < 0) throw new OnvifError("InvalidValue", "Invalid native Form index");
        const form = owned.description.actions?.[name]?.forms?.[index];
        if (form === undefined || !isNativeForm(form)) throw new OnvifError("UnsupportedCapability", "Addressed invocation requires a native Action Form");
        validateNativeForm(form, this.executor.options.registry);
        return { form, context: owned.context };
    }

    invokeAction(thing: ConsumedThing, name: string, input?: Parameters<ConsumedThing["invokeAction"]>[1],
        options: NativeInvokeOptions = {}): ReturnType<ConsumedThing["invokeAction"]> {
        this.nativeAction(thing, name, options);
        return this.track(() => this.invocation.run(options, () => thing.invokeAction(name, input,
            options.formIndex === undefined ? undefined : { formIndex: options.formIndex })));
    }

    execute(thing: ConsumedThing, name: string, input: unknown = {}, options: NativeInvokeOptions = {}): Promise<NativeExecutionResult> {
        const action = this.nativeAction(thing, name, options);
        return this.track(() => this.executor.execute(action.context, action.form, input, options));
    }

    decodeMetadata(content: string | Uint8Array): CanonicalValue {
        return decodeMetadata(content, this.executor.options.registry.xml, this.executor.limits);
    }

    subscribeEvent(thing: ConsumedThing, name: string, listener: Parameters<ConsumedThing["subscribeEvent"]>[1],
        errorListener?: Parameters<ConsumedThing["subscribeEvent"]>[2], options: NativeEventOptions = {}): Promise<ManagedEventSubscription> {
        return this.track(() => {
            const events = this.events.get(thing);
            if (events === undefined) throw new OnvifError("InvalidValue", "Consumed Thing is not owned by this runtime");
            return events.client.subscribeEvent(thing, events.subscribe, name, listener, errorListener, options);
        });
    }

    manageSubscription(thing: ConsumedThing, options: ManagedSubscriptionOptions): ManagedSubscription {
        if (!this.accepting) throw new OnvifError("RuntimeClosed", "Native runtime is closing or closed");
        if (this.subscriptions.size >= 64) throw new OnvifError("InvalidValue", "Managed subscription capacity reached");
        const owned = this.contexts.get(thing);
        if (owned === undefined) throw new OnvifError("InvalidValue", "Consumed Thing is not owned by this runtime");
        const action = owned.description.actions?.[options.unsubscribeAction];
        const index = options.formIndex ?? 0;
        if (!Number.isSafeInteger(index) || index < 0) throw new OnvifError("InvalidValue", "Invalid Unsubscribe form index");
        const form = action?.forms?.[index];
        if (form === undefined || !isNativeForm(form)) throw new OnvifError("UnsupportedCapability", "Managed cleanup requires a native Unsubscribe Action Form");
        const operation = validateNativeForm(form, this.executor.options.registry);
        if (operation.operation !== "Unsubscribe" || operation.request.name.namespace !== "http://docs.oasis-open.org/wsn/b-2"
            || operation.request.name.localName !== "Unsubscribe") {
            throw new OnvifError("UnsupportedCapability", "This lifecycle adapter only owns native WS-BaseNotification Unsubscribe");
        }
        const endpoint = readEndpointReference(options.endpoint.xml);
        if (endpoint.address !== options.endpoint.address
            || JSON.stringify(endpoint.referenceParameters) !== JSON.stringify(options.endpoint.referenceParameters)
            || JSON.stringify(endpoint.referenceProperties) !== JSON.stringify(options.endpoint.referenceProperties)
            || endpoint.addressingNamespace !== options.endpoint.addressingNamespace) {
            throw new OnvifError("InvalidValue", "EndpointReference fields disagree with its retained XML");
        }
        authorizeTarget(endpoint.address, this.executor.options.trust, owned.context.principal);
        const endpointForm: Form = { ...structuredClone(form), href: endpoint.address };
        const subscription = new OwnedSubscription(() => this.track(async () => {
            await this.executor.invoke(owned.context, endpointForm, undefined, { addressing: {
                namespace: endpoint.addressingNamespace, to: endpoint.address,
                referenceParameters: endpoint.referenceParameters, referenceProperties: endpoint.referenceProperties
            } });
            this.subscriptions.delete(subscription);
        }, true));
        this.subscriptions.add(subscription);
        return subscription;
    }

    close(): Promise<void> {
        if (this.closing === undefined) {
            this.accepting = false;
            this.closing = this.shutdown();
        }
        return this.closing;
    }

    private async shutdown(): Promise<void> {
        const pending = [...this.pending];
        const results = await Promise.allSettled([...pending, ...[...this.subscriptions].map((subscription) => subscription.stop())]);
        const events = await Promise.allSettled([...this.services].map((service) => service.events.close()));
        const factories = await Promise.allSettled([...this.services].flatMap((service) =>
            service.factories.map((factory) => factory.close())));
        const services = await Promise.allSettled([...this.services].map((service) => service.servient.shutdown()));
        for (const service of this.services) service.codec.close();
        const transport = await Promise.allSettled([this.executor.transport.close()]);
        const errors = [...new Set([...results, ...events, ...factories, ...services, ...transport]
            .filter((result) => result.status === "rejected").map((result) => result.reason))];
        this.services.clear();
        if (errors.length) throw new AggregateError(errors, "Runtime shutdown did not confirm all owned cleanup");
    }
}

export async function createOnvifRuntime(options: OnvifRuntimeOptions): Promise<OnvifRuntime> {
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    if (major < 20 || (major === 20 && minor < 19)) {
        throw new OnvifError("InvalidConfiguration", "The native runtime requires Node >=20.19.0");
    }
    if (!isRecord(options) || Object.keys(options).some((key) => ![
        "registry", "trust", "credentials", "transport", "clock", "nonce", "digest",
        "usernameToken", "xml", "timeoutMs", "requiredCapabilities"
    ].includes(key))) {
        throw new OnvifError("UnsupportedCapability", "Runtime option is not implemented by the first native gate");
    }
    if (!options.registry || typeof options.registry.resolve !== "function" || !/^[a-f0-9]{64}$/u.test(options.registry.digest)) {
        throw new OnvifError("InvalidRegistry", "A locally defined, content-addressed OperationRegistry is required");
    }
    if (options.requiredCapabilities?.some((capability) => !capabilities.includes(capability))) {
        throw new OnvifError("UnsupportedCapability", "A required runtime capability is not implemented by the first native gate");
    }
    const trust = validateTrust(options.trust);
    const timeoutMs = positiveInteger(options.timeoutMs ?? 10000, "timeoutMs", 2147483647);
    const xml = xmlLimits(options.xml);
    const digest = digestPolicy(options.digest);
    const usernameToken = validateUsernameTokenPolicy(options.usernameToken);
    return new Runtime({ ...options, trust, timeoutMs, xml, digest, usernameToken });
}
