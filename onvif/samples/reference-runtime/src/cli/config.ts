import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord } from "../binding/errors.js";
import { canonicalJson } from "../catalog/sources.js";
import { digestPolicy, type DigestPolicy } from "../security/digest.js";
import type { CredentialProvider } from "../security/policy.js";
import { createOnvifBridge, type BridgeInput, type BridgeOutput, type OnvifBridge } from "../bridge.js";
import { JsonFilePersistence, MemoryPersistence } from "../discovery/persistence.js";
import { validateOptions } from "../discovery/policy.js";
import { assertSnapshot } from "../discovery/snapshot.js";
import type { DiscoveryOptions, NativeTarget } from "../discovery/types.js";
import type { ProjectionPolicy } from "../projection/project.js";
import { DirectoryClient, type DirectoryContract } from "../publication/directory.js";
import { boundedInteger, httpUrl, PublicationError } from "../publication/common.js";
import { FilePublication, StaticModelPublisher } from "../publication/models.js";
import { readBoundedJson } from "../publication/files.js";
import { DirectoryPublisher, type PublicationPolicy } from "../publication/publisher.js";
import { JsonFilePublicationStore, MemoryPublicationStore } from "../publication/state.js";
import type { SnapshotAdapterOptions } from "../publication/snapshot-adapter.js";

export type BridgeCommand = "inspect" | "export" | "run";
interface StoreConfig { readonly mode: "memory" | "json-file"; readonly path?: string; }
interface PasswordCredential {
    readonly kind?: "password";
    readonly usernameEnv: string;
    readonly passwordEnv: string;
    readonly realm?: string;
}
interface CertificateCredential {
    readonly kind: "tls";
    readonly certFile: string;
    readonly keyFile: string;
    readonly passphraseEnv?: string;
}
type NativeCredential = PasswordCredential | CertificateCredential;
interface NativeTargetConfig {
    readonly xaddr: string;
    readonly principal: string;
    readonly security: readonly string[];
    readonly credential?: NativeCredential;
}
interface NativeConfig {
    readonly securityDefinitions: NonNullable<ThingDescription["securityDefinitions"]>;
    readonly targets: readonly NativeTargetConfig[];
    readonly tlsCaFile?: string;
    readonly digest?: Partial<DigestPolicy>;
}
interface ModelConfig { readonly directory: string; readonly baseUrl: string; }
interface DirectoryConfig {
    readonly collectionUrl: string;
    readonly contract: DirectoryContract;
    readonly authentication: { readonly mode: "none" } | { readonly mode: "bearer-env"; readonly principal: string; readonly tokenEnv: string };
    readonly tlsCaFile?: string;
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
}
interface FileConfig {
    readonly schemaVersion: 1;
    readonly input: { readonly mode: "fixture"; readonly path: string }
        | { readonly mode: "discover"; readonly discovery: DiscoveryOptions; readonly native: NativeConfig; readonly inventory: StoreConfig };
    readonly projection: ProjectionPolicy;
    readonly adapter?: SnapshotAdapterOptions;
    readonly output: { readonly mode: "inspect" }
        | { readonly mode: "file"; readonly owner: string; readonly directory: string; readonly models: ModelConfig }
        | { readonly mode: "directory"; readonly owner: string; readonly directory: DirectoryConfig; readonly models: ModelConfig;
            readonly state: StoreConfig; readonly policy: PublicationPolicy };
    readonly intervalMs?: number;
}

function object(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new PublicationError("InvalidConfiguration", `Invalid or unknown ${label} fields`);
}
function text(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !value || value.length > 8192 || /[\u0000-\u001f]/u.test(value)) {
        throw new PublicationError("InvalidConfiguration", `Invalid ${label}`);
    }
}
function absolutePath(value: unknown, label: string): asserts value is string {
    text(value, label);
    if (!isAbsolute(value)) throw new PublicationError("InvalidConfiguration", `${label} requires an explicit absolute path`);
}
function environmentName(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value)) {
        throw new PublicationError("InvalidConfiguration", "Credential references must be environment variable names, never inline values");
    }
}
function store(value: unknown): asserts value is StoreConfig {
    object(value, ["mode", "path"], "state-store");
    if (value.mode === "json-file") absolutePath(value.path, "State file");
    else if (value.mode !== "memory" || value.path !== undefined) throw new PublicationError("InvalidConfiguration", "State mode must be explicitly memory or json-file");
}
function security(definitions: unknown, selection: unknown): void {
    if (!isRecord(definitions) || !Object.keys(definitions).length || Object.values(definitions).some((entry) =>
        !isRecord(entry) || !["nosec", "digest", "cert", "onvif:MutualTlsSecurityScheme", "onvif:UsernameTokenSecurityScheme"].includes(String(entry.scheme))
        || Object.keys(entry).some((key) => !["scheme", "description", "descriptions", "@type", "in"].includes(key))
        || entry.in !== undefined && (entry.scheme !== "digest" || entry.in !== "header"))) {
        throw new PublicationError("InvalidConfiguration", "Only native security scheme metadata belongs in configuration/TD security definitions");
    }
    if (!Array.isArray(selection) || !selection.length || selection.length > 16
        || selection.some((name: unknown) => typeof name !== "string" || !Object.hasOwn(definitions, name))) {
        throw new PublicationError("InvalidConfiguration", "Every native target must explicitly select declared security schemes");
    }
    const schemes = selection.map((name) => {
        const definition = definitions[String(name)];
        if (!isRecord(definition)) throw new PublicationError("InvalidConfiguration", "Missing native security definition");
        return String(definition.scheme);
    });
    if (new Set(schemes).size !== schemes.length || schemes.includes("nosec") && schemes.length !== 1) {
        throw new PublicationError("InvalidConfiguration", "Native security selections are conjunctions, not fallback alternatives");
    }
}
function projection(value: unknown): asserts value is ProjectionPolicy {
    object(value, ["securityDefinitions", "security", "serviceSecurity", "includeSafeReadAliases", "includeAddOns"], "projection");
    security(value.securityDefinitions, value.security);
    if (value.serviceSecurity !== undefined) {
        if (!Array.isArray(value.serviceSecurity)) throw new PublicationError("InvalidConfiguration", "Service security must be an array");
        for (const entry of value.serviceSecurity) {
            object(entry, ["namespace", "xaddr", "security"], "service security");
            text(entry.namespace, "service namespace");
            if (entry.xaddr !== undefined) { text(entry.xaddr, "service XAddr"); httpUrl(entry.xaddr); }
            security(value.securityDefinitions, entry.security);
        }
    }
    for (const name of ["includeSafeReadAliases", "includeAddOns"]) {
        if (value[name] !== undefined && typeof value[name] !== "boolean") throw new PublicationError("InvalidConfiguration", "Projection feature switches must be boolean");
    }
}
function native(value: unknown, allowed: readonly string[]): asserts value is NativeConfig {
    object(value, ["securityDefinitions", "targets", "tlsCaFile", "digest"], "native runtime");
    if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > 512) throw new PublicationError("InvalidConfiguration", "Explicit bounded native target/principal bindings are required");
    const found = new Set<string>();
    for (const target of value.targets) {
        object(target, ["xaddr", "principal", "security", "credential"], "native target");
        text(target.xaddr, "Native target"); httpUrl(target.xaddr); text(target.principal, "Native principal");
        if (found.has(target.xaddr) || !allowed.includes(target.xaddr)) throw new PublicationError("InvalidConfiguration", "Native targets must uniquely match exact allowed XAddrs");
        found.add(target.xaddr);
        security(value.securityDefinitions, target.security);
        if (target.credential !== undefined) {
            if (isRecord(target.credential) && target.credential.kind === "tls") {
                object(target.credential, ["kind", "certFile", "keyFile", "passphraseEnv"], "native certificate reference");
                absolutePath(target.credential.certFile, "Native certificate file");
                absolutePath(target.credential.keyFile, "Native key file");
                if (target.credential.passphraseEnv !== undefined) environmentName(target.credential.passphraseEnv);
                if (httpUrl(target.xaddr).protocol !== "https:") throw new PublicationError("InvalidConfiguration", "Client certificate targets must use HTTPS");
            } else {
                object(target.credential, ["kind", "usernameEnv", "passwordEnv", "realm"], "native credential reference");
                if (target.credential.kind !== undefined && target.credential.kind !== "password") throw new PublicationError("InvalidConfiguration", "Unknown native credential kind");
                environmentName(target.credential.usernameEnv); environmentName(target.credential.passwordEnv);
                if (target.credential.realm !== undefined) text(target.credential.realm, "Native realm");
            }
        }
    }
    if (allowed.some((target) => !found.has(target))) throw new PublicationError("InvalidConfiguration", "Every approved native XAddr needs its own explicit principal/security binding");
    if (value.tlsCaFile !== undefined) absolutePath(value.tlsCaFile, "Native CA file");
    if (value.digest !== undefined) object(value.digest, ["algorithms", "qops"], "Digest policy");
}
function model(value: unknown): asserts value is ModelConfig {
    object(value, ["directory", "baseUrl"], "model publication");
    absolutePath(value.directory, "Model output directory"); text(value.baseUrl, "Model publication base"); httpUrl(value.baseUrl);
}
function directory(value: unknown): asserts value is DirectoryConfig {
    object(value, ["collectionUrl", "contract", "authentication", "tlsCaFile", "timeoutMs", "maxResponseBytes"], "Directory");
    text(value.collectionUrl, "Directory collection URL"); httpUrl(value.collectionUrl);
    object(value.contract, ["verification", "ownership", "list", "expiry"], "Directory contract");
    if (!isRecord(value.contract.verification) || !isRecord(value.contract.ownership)
        || !isRecord(value.contract.list) || !isRecord(value.contract.expiry)) throw new PublicationError("InvalidConfiguration", "Incomplete Directory capability contract");
    object(value.authentication, ["mode", "principal", "tokenEnv"], "Directory authentication");
    if (value.authentication.mode === "bearer-env") {
        text(value.authentication.principal, "Directory principal"); environmentName(value.authentication.tokenEnv);
    } else if (value.authentication.mode !== "none" || value.authentication.principal !== undefined || value.authentication.tokenEnv !== undefined) {
        throw new PublicationError("InvalidConfiguration", "Directory authentication must explicitly be none or bearer-env");
    }
    if (value.tlsCaFile !== undefined) absolutePath(value.tlsCaFile, "Directory CA file");
    for (const key of ["timeoutMs", "maxResponseBytes"]) {
        if (value[key] !== undefined && typeof value[key] !== "number") throw new PublicationError("InvalidConfiguration", "Directory bounds must be numeric");
    }
}

function assertConfig(value: unknown): asserts value is FileConfig {
    object(value, ["schemaVersion", "input", "projection", "adapter", "output", "intervalMs"], "bridge");
    if (value.schemaVersion !== 1) throw new PublicationError("InvalidConfiguration", "Unsupported bridge configuration version");
    projection(value.projection);
    object(value.input, ["mode", "path", "discovery", "native", "inventory"], "bridge input");
    if (value.input.mode === "fixture") {
        absolutePath(value.input.path, "Fixture snapshot");
        if (value.input.discovery !== undefined || value.input.native !== undefined || value.input.inventory !== undefined) {
            throw new PublicationError("InvalidConfiguration", "Fixture input cannot hide a native network configuration");
        }
    } else if (value.input.mode === "discover") {
        if (value.input.path !== undefined) throw new PublicationError("InvalidConfiguration", "Discovery cannot fall back to a fixture path");
        assertDiscoveryConfig(value.input.discovery);
        native(value.input.native, value.input.discovery.allowedXAddrs);
        for (const target of value.input.native.targets) {
            for (const name of target.security) {
                if (!Object.hasOwn(value.projection.securityDefinitions, name)
                    || canonicalJson(value.projection.securityDefinitions[name]) !== canonicalJson(value.input.native.securityDefinitions[name])) {
                    throw new PublicationError("InvalidConfiguration", "Native inspection and publication must agree on named security definitions");
                }
            }
        }
        store(value.input.inventory);
    } else throw new PublicationError("InvalidConfiguration", "Explicit fixture or discover input is required");
    if (value.adapter !== undefined) {
        object(value.adapter, ["claims", "factMappings", "eventSubscriptions"], "snapshot adapter");
        if (value.adapter.claims !== undefined && !isRecord(value.adapter.claims)) throw new PublicationError("InvalidConfiguration", "Additional claims require explicit EPR keys");
        if (value.adapter.factMappings !== undefined && !Array.isArray(value.adapter.factMappings)) throw new PublicationError("InvalidConfiguration", "Fact mappings must be an array");
        if (value.adapter.eventSubscriptions !== undefined) {
            if (!Array.isArray(value.adapter.eventSubscriptions) || value.adapter.eventSubscriptions.length > 64) {
                throw new PublicationError("InvalidConfiguration", "Event publication needs a bounded explicit policy list");
            }
            for (const entry of value.adapter.eventSubscriptions) {
                object(entry, ["xaddr", "evidence"], "Event publication policy");
                text(entry.xaddr, "Event XAddr"); httpUrl(entry.xaddr);
                if (!Array.isArray(entry.evidence) || !entry.evidence.length) throw new PublicationError("InvalidConfiguration", "Event publication needs policy evidence");
                for (const proof of entry.evidence) {
                    object(proof, ["sourceId", "observedAt", "operation", "detail"], "Event policy evidence");
                    text(proof.sourceId, "Event policy source");
                }
            }
        }
    }
    object(value.output, ["mode", "owner", "directory", "models", "state", "policy"], "bridge output");
    if (value.output.mode === "file") {
        text(value.output.owner, "Publication owner"); absolutePath(value.output.directory, "TD export directory"); model(value.output.models);
        if (resolve(value.output.directory) === resolve(value.output.models.directory)) throw new PublicationError("InvalidConfiguration", "TD and model bundle directories must be separate owned paths");
        if (value.output.state !== undefined || value.output.policy !== undefined) throw new PublicationError("InvalidConfiguration", "File export does not use Directory registration state");
    } else if (value.output.mode === "directory") {
        text(value.output.owner, "Publication owner"); directory(value.output.directory); model(value.output.models); store(value.output.state);
        object(value.output.policy, ["freshMs", "graceMs", "renewBeforeMs"], "publication freshness");
        for (const key of ["freshMs", "graceMs", "renewBeforeMs"]) {
            if (typeof value.output.policy[key] !== "number") throw new PublicationError("InvalidConfiguration", "Explicit numeric freshness/grace/renewal bounds are required");
        }
        const inventory = value.input.inventory;
        if (value.input.mode === "discover" && isRecord(inventory) && inventory.mode === "json-file" && value.output.state.mode === "json-file"
            && inventory.path === value.output.state.path) throw new PublicationError("InvalidConfiguration", "Native inventory and Directory publication state must use separate files");
    } else if (value.output.mode !== "inspect" || Object.keys(value.output).length !== 1) {
        throw new PublicationError("InvalidConfiguration", "Explicit inspect, file or Directory output is required");
    }
    if (value.intervalMs !== undefined) {
        if (typeof value.intervalMs !== "number") throw new PublicationError("InvalidConfiguration", "Run interval must be numeric");
        boundedInteger(value.intervalMs, "run interval");
    }
}

function assertDiscoveryConfig(value: unknown): asserts value is DiscoveryOptions {
    object(value, ["interfaces", "segments", "allowedXAddrs", "scopes", "seeds", "ipv6", "untypedFallback",
        "missingSequence", "retransmissions", "bounds", "timers"], "discovery");
    if (!Array.isArray(value.interfaces) || !Array.isArray(value.segments) || !Array.isArray(value.allowedXAddrs)) {
        throw new PublicationError("InvalidConfiguration", "Discovery interfaces, segments and exact XAddr allowlist must be explicit arrays");
    }
    for (const entry of value.interfaces) {
        object(entry, ["id", "address", "family", "zone"], "discovery interface");
        text(entry.id, "Interface id"); text(entry.address, "Interface address");
        if (entry.family !== "IPv4" && entry.family !== "IPv6") throw new PublicationError("InvalidConfiguration", "Interface family must be explicit");
    }
    for (const entry of value.segments) {
        object(entry, ["id", "interfaceId", "cidr", "destination", "listenPort", "multicast"], "discovery segment");
        text(entry.id, "Segment id"); text(entry.interfaceId, "Segment interface"); text(entry.cidr, "Segment CIDR");
        object(entry.destination, ["address", "port"], "discovery destination"); text(entry.destination.address, "Destination address");
        if (typeof entry.destination.port !== "number" || typeof entry.listenPort !== "number" || typeof entry.multicast !== "boolean") {
            throw new PublicationError("InvalidConfiguration", "Discovery segment ports and multicast mode must be explicit");
        }
    }
    if (value.allowedXAddrs.some((entry: unknown) => typeof entry !== "string")) throw new PublicationError("InvalidConfiguration", "XAddr allowlist must contain strings");
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (value === undefined || value.length > 16384) throw new PublicationError("MissingCredential", "An out-of-band credential environment reference is unavailable");
    return value;
}
async function caFile(path: string | undefined): Promise<{ ca: string } | undefined> {
    if (path === undefined) return undefined;
    const bytes = await readFile(path);
    if (bytes.length > 1024 * 1024) throw new PublicationError("PublicationLimit", "CA trust file exceeds its bound");
    return { ca: bytes.toString("utf8") };
}

export async function loadBridgeConfiguration(path: string, command: BridgeCommand, env: NodeJS.ProcessEnv = process.env): Promise<{
    bridge: OnvifBridge; intervalMs: number | undefined; mode: BridgeOutput["mode"];
}> {
    absolutePath(path, "Bridge configuration");
    const config = await readBoundedJson(path, 1024 * 1024);
    assertConfig(config);
    let input: BridgeInput;
    if (config.input.mode === "fixture") {
        const snapshot = await readBoundedJson(config.input.path, 64 * 1024 * 1024);
        assertSnapshot(snapshot);
        input = { mode: "fixture", snapshot };
    } else {
        const { native, inventory } = config.input;
        validateOptions(config.input.discovery);
        if (native.digest) digestPolicy(native.digest);
        for (const target of native.targets) {
            const schemes = target.security.map((name) => native.securityDefinitions[name]?.scheme);
            const certificates = schemes.filter((scheme) => scheme === "cert" || scheme === "onvif:MutualTlsSecurityScheme");
            if (certificates.length && (certificates.length !== 1 || schemes.length !== 1 || target.credential?.kind !== "tls")) {
                throw new PublicationError("UnsupportedCapability", "CLI certificate targets require one scoped TLS identity; combined TLS/password credentials need the programmatic runtime");
            }
            if (!certificates.length && target.credential?.kind === "tls"
                || schemes.includes("nosec") && target.credential !== undefined) {
                throw new PublicationError("InvalidConfiguration", "Native credential reference does not match its selected security scheme");
            }
        }
        const tls = await caFile(native.tlsCaFile);
        const targetFor = (target: NativeTarget): NativeTargetConfig => {
            const entry = native.targets.find((candidate) => candidate.xaddr === target.xaddr);
            if (!entry) throw new PublicationError("PolicyDenied", "Native target has no explicit principal/security binding");
            return entry;
        };
        const credentials: CredentialProvider = async (scope) => {
            const target = native.targets.find((entry) => entry.xaddr === scope.href && entry.principal === scope.principal);
            const configured = target?.credential;
            if (!configured || !target?.security.includes(scope.securityName)) return undefined;
            if (configured.kind === "tls") {
                if (!["cert", "onvif:MutualTlsSecurityScheme"].includes(scope.scheme)) return undefined;
                const [cert, key] = await Promise.all([readFile(configured.certFile), readFile(configured.keyFile)]);
                if (!cert.length || !key.length || cert.length > 1024 * 1024 || key.length > 1024 * 1024) {
                    throw new PublicationError("PublicationLimit", "Native certificate/key files must be nonempty and bounded");
                }
                return { origin: scope.origin, principal: scope.principal, material: {
                    kind: "tls", cert, key,
                    ...(configured.passphraseEnv === undefined ? {} : { passphrase: envValue(env, configured.passphraseEnv) })
                } };
            }
            if (scope.realm !== undefined && configured.realm !== scope.realm) return undefined;
            return { origin: scope.origin, principal: scope.principal,
                ...(configured.realm === undefined ? {} : { realm: configured.realm }),
                material: { kind: "password", username: envValue(env, configured.usernameEnv), password: envValue(env, configured.passwordEnv) } };
        };
        input = {
            mode: "discover", discovery: config.input.discovery,
            inventory: inventory.mode === "memory" ? new MemoryPersistence() : new JsonFilePersistence({ path: inventory.path ?? "" }),
            runtimeOptions: (target) => ({
                trust: { allowedOrigins: [httpUrl(target.xaddr).origin], allowedTargets: [target.xaddr],
                    principalTargets: { [targetFor(target).principal]: [target.xaddr] }, ...(tls ? { tls } : {}) }, credentials,
                ...(native.digest === undefined ? {} : { digest: native.digest })
            }),
            security: (target) => {
                const [first, ...rest] = targetFor(target).security;
                if (first === undefined) throw new PublicationError("InvalidConfiguration", "Native target security cannot be empty");
                return { securityDefinitions: native.securityDefinitions, security: [first, ...rest] };
            },
            principal: (target) => targetFor(target).principal
        };
    }
    let output: BridgeOutput;
    if (command === "inspect") output = { mode: "inspect" };
    else if (config.output.mode === "file") {
        const models = new StaticModelPublisher({ ...config.output.models, owner: config.output.owner, verification: "file-only" });
        output = { mode: "file", publisher: new FilePublication(models, config.output.directory, config.output.owner), modelBaseUrl: models.baseUrl };
    } else if (command === "run" && config.output.mode === "directory") {
        const out = config.output, authentication = out.directory.authentication;
        const tls = await caFile(out.directory.tlsCaFile);
        const directoryClient = new DirectoryClient({
            collectionUrl: out.directory.collectionUrl, contract: out.directory.contract,
            http: {
                ...(tls ? { tls } : {}),
                ...(out.directory.timeoutMs === undefined ? {} : { timeoutMs: out.directory.timeoutMs }),
                ...(out.directory.maxResponseBytes === undefined ? {} : { maxResponseBytes: out.directory.maxResponseBytes }),
                ...(authentication.mode === "none" ? {} : { authorization: {
                    origin: httpUrl(out.directory.collectionUrl).origin, principal: authentication.principal,
                    bearer: async () => envValue(env, authentication.tokenEnv)
                } })
            }
        });
        const models = new StaticModelPublisher({ ...out.models, owner: out.owner, verification: "http" });
        const state = out.state.mode === "memory" ? new MemoryPublicationStore(out.owner) : new JsonFilePublicationStore(out.owner, out.state.path ?? "");
        output = { mode: "directory", modelBaseUrl: models.baseUrl,
            publisher: new DirectoryPublisher({ owner: out.owner, directory: directoryClient, models, state, policy: out.policy }) };
    } else throw new PublicationError("InvalidConfiguration", "export requires explicit file output; run requires explicit file or Directory output");
    const adapter: SnapshotAdapterOptions = { ...config.adapter,
        ...(config.input.mode === "discover" ? { principals: config.input.native.targets.map((target) => ({
            xaddr: target.xaddr, principal: target.principal, security: target.security
        })) } : {}) };
    return { bridge: createOnvifBridge({ input, output, projection: config.projection, adapter }), intervalMs: config.intervalMs, mode: output.mode };
}
