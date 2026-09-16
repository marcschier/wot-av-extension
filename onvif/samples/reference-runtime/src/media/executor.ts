import { ConsumedThing, type Form } from "@node-wot/core";
import { randomInt } from "node:crypto";
import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "../binding/errors.js";
import { validateNativeForm } from "../binding/forms.js";
import { operationReference, type OperationDescriptor, type OperationRegistry } from "../binding/registry.js";
import type { OnvifRuntime } from "../binding/runtime.js";
import { requireImplemented } from "../xml/descriptors.js";
import { encodeElement } from "../xml/mapper.js";
import { METADATA_STREAM } from "../xml/metadata.js";
import { abortable, mediaAborted, mediaError } from "./async.js";
import {
    authorizeMediaTarget, mediaServiceTarget, mediaText, validateMediaRequest, validateMediaSecurity, validateMediaTrust
} from "./policy.js";
import { spawnNativeMediaWorker } from "./process.js";
import { loadMediaRegistry, mediaResolverKind, type MediaResolverKind } from "./registry.js";
import { MediaOpenError, startMediaSession } from "./session.js";
import type {
    MediaCloseResult, MediaConsumerContext, MediaExecutionSelection, MediaExecutorOptions,
    MediaSecurityScope, MediaSession, OpenMediaRequest
} from "./types.js";

interface Association {
    readonly runtime: OnvifRuntime;
    readonly owner: MediaExecutor;
    readonly thingId: string;
    readonly context: MediaConsumerContext;
}
const associations = new WeakMap<ConsumedThing, Association>();

function validateResolverInput(kind: MediaResolverKind, request: OpenMediaRequest): void {
    if ((kind === "replay") !== (request.replay !== undefined)) {
        throw new OnvifError("InvalidValue", "Native resolver identity and requested live/replay mode disagree");
    }
    const input = request.input;
    if (!isRecord(input)) throw new OnvifError("InvalidValue", "Media URI Action input must follow its canonical native object schema");
    mediaText(input[kind === "replay" ? "RecordingToken" : "ProfileToken"], 64, "native profile or recording token");
    if (kind === "media2") {
        const protocol = request.transport === "udp-unicast" ? "RtspUnicast"
            : request.transport === "http-tunnel" || request.transport === "https-tunnel" ? "RtspOverHttp" : "RTSP";
        if (input.Protocol !== protocol) throw new OnvifError("PolicyDenied", "Media2 resolver protocol disagrees with the explicit native transport");
    } else {
        const setup = input.StreamSetup;
        const protocol = request.transport === "udp-unicast" ? "UDP"
            : request.transport === "http-tunnel" || request.transport === "https-tunnel" ? "HTTP" : "RTSP";
        if (!isRecord(setup) || setup.Stream !== "RTP-Unicast" || !isRecord(setup.Transport)
            || setup.Transport.Protocol !== protocol || setup.Transport.Tunnel !== undefined) {
            throw new OnvifError("PolicyDenied", "Native StreamSetup must agree with the explicit unicast transport");
        }
    }
}

function resolverAction(association: Association, thing: ConsumedThing, request: OpenMediaRequest, registry: OperationRegistry): {
    readonly operation: OperationDescriptor; readonly kind: MediaResolverKind; readonly target: string; readonly formIndex: number;
} {
    const description = thing.getThingDescription();
    if (description.id !== association.thingId || description["onvif:registryDigest"] !== registry.digest) {
        throw new OnvifError("InvalidRegistry", "Consumed media Thing identity or generated registry pin changed");
    }
    let formIndex = request.formIndex ?? 0;
    if (request.formRef !== undefined) {
        if (association.context.document === undefined
            || mediaServiceTarget(request.formRef.document) !== association.context.document) {
            throw new OnvifError("PolicyDenied", "FormReference must identify the explicitly bound TD retrieval document");
        }
        const forms = [
            ...(description.forms ?? []),
            ...Object.values(description.actions ?? {}).flatMap((entry) => entry.forms ?? []),
            ...Object.values(description.properties ?? {}).flatMap((entry) => entry.forms ?? []),
            ...Object.values(description.events ?? {}).flatMap((entry) => entry.forms ?? [])
        ];
        const matching = forms.filter((form) => form["@id"] === request.formRef?.form);
        const index = description.actions?.[request.action]?.forms?.findIndex((form) => form["@id"] === request.formRef?.form);
        if (matching.length !== 1 || index === undefined || index < 0
            || request.formIndex !== undefined && request.formIndex !== index) {
            throw new OnvifError("PolicyDenied", "FormReference must select exactly one Form of the declared native Action");
        }
        formIndex = index;
    }
    const form = description.actions?.[request.action]?.forms?.[formIndex];
    if (form === undefined || form.op !== undefined
        && !(Array.isArray(form.op) ? form.op.includes("invokeaction") : form.op === "invokeaction")) {
        throw new OnvifError("UnsupportedCapability", "Media must invoke a declared canonical Action Form");
    }
    if (/[{}]|%7[bBdD]/u.test(form.href)) {
        throw new OnvifError("UnsupportedCapability", "Select a concrete native resolver Form; unresolved URI templates cannot be guessed");
    }
    const target = mediaServiceTarget(description.base === undefined ? form.href : new URL(form.href, description.base).href);
    if (!association.context.trust.serviceTargets.includes(target)
        || !association.context.trust.transports.includes(request.transport)) {
        throw new OnvifError("PolicyDenied", "Media resolver service or transport is outside the independently bound consumer policy");
    }
    const bound: Form = { ...form, href: target };
    const operation = validateNativeForm(bound, registry), kind = mediaResolverKind(operation);
    validateResolverInput(kind, request);
    encodeElement(operation.request, request.input, registry.xml);
    return { operation, kind, target, formIndex };
}

function uriResult(kind: MediaResolverKind, operation: OperationDescriptor, value: unknown, registry: OperationRegistry): string {
    if (operation.response === null) throw new OnvifError("InvalidRegistry", "Media URI resolver has no native response contract");
    encodeElement(operation.response, value, registry.xml);
    if (!isRecord(value)) throw new OnvifError("InvalidValue", "Native URI resolver did not return its canonical response object");
    const uri = kind === "media1" && isRecord(value.MediaUri) ? value.MediaUri.Uri : kind === "media1" ? undefined : value.Uri;
    if (typeof uri !== "string" || !uri) throw new OnvifError("InvalidValue", "Native URI resolver did not return the declared URI variant");
    return uri;
}

export class MediaExecutor {
    private readonly registry: OperationRegistry;
    private readonly options: MediaExecutorOptions;
    private readonly sessions = new Set<MediaSession>();
    private readonly pending = new Map<AbortController, Promise<MediaSession>>();
    private accepting = true;
    private closing: Promise<readonly MediaCloseResult[]> | undefined;

    constructor(options: MediaExecutorOptions) {
        if (!isRecord(options) || Object.keys(options).some((key) => !["worker", "security", "registry", "processFactory"].includes(key))
            || !isRecord(options.worker) || typeof options.worker.executable !== "string" || typeof options.security !== "function"
            || options.processFactory !== undefined && typeof options.processFactory !== "function") {
            throw new OnvifError("InvalidConfiguration", "Media requires an explicit owned worker and an out-of-band scoped security resolver");
        }
        this.registry = options.registry ?? loadMediaRegistry();
        if (!/^[a-f0-9]{64}$/u.test(this.registry.digest) || typeof this.registry.resolve !== "function") {
            throw new OnvifError("InvalidRegistry", "Media requires a locally compiled, content-addressed registry");
        }
        this.options = { ...options, worker: Object.freeze({ ...options.worker }) };
    }

    async consume(runtime: OnvifRuntime, description: ThingDescription, context: MediaConsumerContext): Promise<ConsumedThing> {
        if (!this.accepting) throw new OnvifError("RuntimeClosed", "Media executor is closing or closed");
        if (typeof runtime.consume !== "function" || typeof runtime.invokeAction !== "function") {
            throw new OnvifError("UnsupportedCapability", "Runtime has no owned canonical node-wot invocation API");
        }
        if (!isRecord(context) || Object.keys(context).some((key) => !["principal", "targetRef", "trust", "document"].includes(key))) {
            throw new OnvifError("InvalidConfiguration", "Media consumer identity must be provided independently of its TD");
        }
        const principal = mediaText(context.principal, 256, "media principal"), targetRef = mediaText(context.targetRef, 256, "media target reference");
        const thingId = mediaText(description.id, 4096, "media Thing ID"), trust = validateMediaTrust(context.trust);
        const document = context.document === undefined ? undefined : mediaServiceTarget(context.document);
        if (description["onvif:registryDigest"] !== this.registry.digest) {
            throw new OnvifError("InvalidRegistry", "Media requires the generated TD's local registry digest");
        }
        const resolved = document === undefined ? description : { ...structuredClone(description),
            base: description.base === undefined ? document : mediaServiceTarget(new URL(description.base, document).href) };
        const thing = await runtime.consume(resolved, { principal });
        if (!(thing instanceof ConsumedThing) || thing.getThingDescription().id !== thingId) {
            throw new OnvifError("InvalidValue", "Runtime did not return the declared, owned node-wot Thing");
        }
        if (!this.accepting) throw new OnvifError("RuntimeClosed", "Media executor closed while consuming the Thing");
        associations.set(thing, { runtime, owner: this, thingId,
            context: Object.freeze({ principal, targetRef, trust, ...(document === undefined ? {} : { document }) }) });
        return thing;
    }

    openMedia(runtime: OnvifRuntime, thing: ConsumedThing, input: OpenMediaRequest): Promise<MediaSession> {
        try {
            if (!this.accepting) throw new OnvifError("RuntimeClosed", "Media executor is closing or closed");
            const associated = associations.get(thing);
            if (associated === undefined || associated.owner !== this || associated.runtime !== runtime) {
                throw new OnvifError("PolicyDenied", "Consumed media Thing is not associated with this runtime and security owner");
            }
            if (this.pending.size + this.sessions.size >= 32) throw new OnvifError("InvalidValue", "Owned media session capacity reached");
            const validated = validateMediaRequest(input);
            const request: OpenMediaRequest = { ...input, input: structuredClone(input.input), tracks: structuredClone(input.tracks),
                ...(input.replay === undefined ? {} : { replay: Object.freeze({ ...input.replay }) }),
                ...(input.formRef === undefined ? {} : { formRef: Object.freeze({ ...input.formRef }) }),
                ...(input.addressing === undefined ? {} : { addressing: structuredClone(input.addressing) }) };
            const action = resolverAction(associated, thing, request, this.registry);
            if (request.tracks.metadata) {
                const descriptor = this.registry.xml.elements[METADATA_STREAM];
                if (typeof runtime.decodeMetadata !== "function" || descriptor === undefined) {
                    throw new OnvifError("UnsupportedCapability", "Required canonical metadata decoder is not available from this runtime and generated registry");
                }
                requireImplemented(descriptor, this.registry.xml);
            }
            const controller = new AbortController();
            const pending = this.open(associated, thing, request, action, validated, controller);
            this.pending.set(controller, pending);
            void pending.then(() => this.pending.delete(controller), () => this.pending.delete(controller));
            return pending;
        } catch (error) { return Promise.reject(error); }
    }

    private async open(
        associated: Association, thing: ConsumedThing, request: OpenMediaRequest,
        action: ReturnType<typeof resolverAction>, validated: ReturnType<typeof validateMediaRequest>, controller: AbortController
    ): Promise<MediaSession> {
        const abort = (): void => controller.abort();
        const unlink = (): void => request.signal?.removeEventListener("abort", abort);
        request.signal?.addEventListener("abort", abort, { once: true });
        if (request.signal?.aborted) controller.abort();
        let timeout = false, transferred = false;
        const deadline = setTimeout(() => { timeout = true; controller.abort(); }, request.timeoutMs ?? 12000);
        try {
            const output = await abortable(() => associated.runtime.invokeAction(thing, request.action, request.input, {
                formIndex: action.formIndex, target: action.target, signal: controller.signal, timeoutMs: request.timeoutMs ?? 12000,
                ...(request.addressing === undefined ? {} : { addressing: request.addressing })
            }), controller.signal);
            const value = await abortable(() => output.value(), controller.signal);
            const uri = uriResult(action.kind, action.operation, value, this.registry);
            const target = authorizeMediaTarget(uri, request.transport, associated.context.trust);
            const scope: MediaSecurityScope = Object.freeze({
                thingId: associated.thingId, targetRef: associated.context.targetRef, principal: associated.context.principal,
                serviceTarget: action.target, operation: operationReference(action.operation), uri, origin: target.origin,
                transport: request.transport, authentication: associated.context.trust.authentication,
                ...(target.tunnelOrigin === undefined ? {} : {
                    tunnelOrigin: target.tunnelOrigin,
                    tunnelAuthentication: associated.context.trust.tunnelAuthentication ?? { kind: "none" as const }
                })
            });
            const material = validateMediaSecurity(scope, await abortable(() => this.options.security(scope, controller.signal), controller.signal));
            if (controller.signal.aborted || !this.accepting) throw mediaAborted();
            const selection: MediaExecutionSelection = Object.freeze({
                thingId: scope.thingId, targetRef: scope.targetRef, principal: scope.principal, action: request.action,
                formIndex: action.formIndex, operation: scope.operation, serviceTarget: action.target, uri,
                transport: request.transport, mode: request.replay === undefined ? "live" : "recorded"
            });
            const process = (this.options.processFactory ?? spawnNativeMediaWorker)(this.options.worker);
            const session = await startMediaSession({
                process, descriptor: { request, scope, trust: associated.context.trust, ...validated,
                    credentialHandle: scope.authentication.kind === "none" ? 0 : randomInt(1, 0x100000000),
                    trustHandle: randomInt(1, 0x100000000) },
                selection, material, decodeMetadata: (bytes) => associated.runtime.decodeMetadata(bytes), signal: controller.signal
            });
            if (!this.accepting || controller.signal.aborted) {
                const cleanup = await session.close();
                throw new MediaOpenError(mediaAborted("unknown"), cleanup);
            }
            this.sessions.add(session);
            transferred = true;
            void session.closed.then(() => { this.sessions.delete(session); unlink(); });
            return session;
        } catch (error) {
            if (timeout) {
                const expired = new OnvifError("TransportError", "Media open exceeded its total resolver/setup deadline", "unknown");
                throw error instanceof MediaOpenError ? new MediaOpenError(expired, error.cleanup) : expired;
            }
            throw mediaError(error, "Media resolver or native execution failed", "not-sent");
        } finally {
            clearTimeout(deadline);
            if (!transferred) unlink();
        }
    }

    close(): Promise<readonly MediaCloseResult[]> {
        if (this.closing === undefined) {
            this.accepting = false;
            for (const controller of this.pending.keys()) controller.abort();
            const pending = [...this.pending.values()], sessions = [...this.sessions];
            this.closing = (async () => {
                const closing = Promise.all(sessions.map((session) => session.close()));
                await Promise.allSettled(pending);
                return Object.freeze(await closing);
            })();
        }
        return this.closing;
    }
}

export function openMedia(runtime: OnvifRuntime, thing: ConsumedThing, request: OpenMediaRequest): Promise<MediaSession> {
    const association = associations.get(thing);
    if (association === undefined || association.runtime !== runtime) {
        return Promise.reject(new OnvifError("PolicyDenied", "Use MediaExecutor.consume to bind the actual runtime and out-of-band principal"));
    }
    return association.owner.openMedia(runtime, thing, request);
}
