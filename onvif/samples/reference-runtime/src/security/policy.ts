import type { SecureVersion } from "node:tls";
import { isRecord, OnvifError } from "../binding/errors.js";
import type { OperationReference } from "../binding/registry.js";
import type { AddressingNamespace } from "../binding/request.js";
import type { XmlElement } from "../xml/types.js";

export interface TlsTrust {
    ca?: string | Buffer | (string | Buffer)[];
    cert?: string | Buffer;
    key?: string | Buffer;
    passphrase?: string;
    minVersion?: Extract<SecureVersion, "TLSv1.2" | "TLSv1.3">;
}
export interface TrustPolicy {
    allowedOrigins: readonly string[];
    allowedTargets?: readonly string[];
    principalTargets?: Readonly<Record<string, readonly string[]>>;
    authorizeLogicalEndpoint?: LogicalEndpointAuthorizer;
    tls?: TlsTrust;
}
export interface LogicalEndpointReference {
    readonly address: string;
    readonly addressingNamespace: AddressingNamespace;
    readonly referenceProperties: readonly XmlElement[];
    readonly referenceParameters: readonly XmlElement[];
}
export interface LogicalEndpointScope {
    readonly thingId: string;
    readonly principal: string;
    readonly origin: string;
    readonly href: string;
    readonly operation: OperationReference;
    readonly endpointReference: LogicalEndpointReference;
}
export type LogicalEndpointAuthorizer = (scope: LogicalEndpointScope) => boolean;
export interface CredentialScope {
    readonly thingId: string;
    readonly principal: string;
    readonly origin: string;
    readonly href: string;
    readonly securityName: string;
    readonly scheme: string;
    readonly realm?: string;
}
export type CredentialMaterial =
    | { readonly kind: "password"; readonly username: string; readonly password: string }
    | { readonly kind: "tls"; readonly cert: string | Buffer; readonly key: string | Buffer; readonly passphrase?: string }
    | { readonly kind: "http"; readonly value: unknown };
export interface ScopedCredential {
    readonly origin: string;
    readonly principal: string;
    readonly realm?: string;
    readonly material: CredentialMaterial;
}
export type CredentialProvider = (scope: CredentialScope) => Promise<ScopedCredential | undefined>;
export interface SecurityScheme {
    scheme: string;
    [key: string]: unknown;
}
export interface SecurityContext {
    readonly thingId: string;
    readonly principal: string;
    readonly definitions: Readonly<Record<string, SecurityScheme>>;
    readonly security: readonly string[];
    readonly endpointReference?: LogicalEndpointReference;
}
export interface SelectedSecurity {
    readonly name: string;
    readonly definition: SecurityScheme;
}

export const USERNAME_TOKEN_SCHEME = "onvif:UsernameTokenSecurityScheme";
export const MUTUAL_TLS_SCHEME = "onvif:MutualTlsSecurityScheme";

export function securityNames(value: unknown): string[] {
    const names: unknown[] = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    if (names.length === 0 || names.some((name) => typeof name !== "string" || !name)) {
        throw new OnvifError("InvalidSecurity", "Security must explicitly name one or more schemes");
    }
    return names.filter((name): name is string => typeof name === "string");
}

export function selectSecurity(context: SecurityContext, formSecurity: unknown, native: boolean): SelectedSecurity[] {
    const names = formSecurity === undefined ? context.security : securityNames(formSecurity);
    const selected: SelectedSecurity[] = [];
    const visit = (name: string, ancestors: Set<string>): void => {
        if (ancestors.has(name)) throw new OnvifError("InvalidSecurity", "Cyclic security combination");
        const definition = context.definitions[name];
        if (!definition) throw new OnvifError("InvalidSecurity", "Unresolved security definition");
        if (definition.scheme === "combo") {
            if (definition.oneOf !== undefined) {
                throw new OnvifError("UnsupportedCapability", "This gate requires explicit alternative Forms instead of combo oneOf");
            }
            const next = new Set(ancestors).add(name);
            for (const child of securityNames(definition.allOf)) visit(child, next);
        } else selected.push({ name, definition: structuredClone(definition) });
    };
    for (const name of names) visit(name, new Set());
    const schemes = selected.map((entry) => entry.definition.scheme);
    if (new Set(schemes).size !== schemes.length || (schemes.includes("nosec") && schemes.length > 1)) {
        throw new OnvifError("InvalidSecurity", "Security arrays are conjunctions, not alternatives");
    }
    if (native && selected.some((entry) => !["nosec", "digest", "cert", MUTUAL_TLS_SCHEME, USERNAME_TOKEN_SCHEME].includes(entry.definition.scheme))) {
        throw new OnvifError("UnsupportedCapability", "Native authentication scheme has no qualified implementation");
    }
    if (!native && selected.length !== 1) {
        throw new OnvifError("UnsupportedCapability", "Stock HTTP does not support security conjunctions");
    }
    if (selected.filter((entry) => ["cert", MUTUAL_TLS_SCHEME].includes(entry.definition.scheme)).length > 1) {
        throw new OnvifError("InvalidSecurity", "Only one scoped TLS client identity can be selected");
    }
    if (native && selected.some((entry) => entry.definition.proxy !== undefined)) {
        throw new OnvifError("UnsupportedCapability", "Native SOAP security proxies are not implemented");
    }
    return selected;
}

export function validateTrust(trust: TrustPolicy): TrustPolicy {
    if (!isRecord(trust) || !Array.isArray(trust.allowedOrigins) || trust.allowedOrigins.length === 0) {
        throw new OnvifError("InvalidConfiguration", "Native runtime requires an explicit origin allowlist");
    }
    if (Object.keys(trust).some((key) => !["allowedOrigins", "allowedTargets", "principalTargets", "authorizeLogicalEndpoint", "tls"].includes(key))) {
        throw new OnvifError("InvalidConfiguration", "Unknown target trust option");
    }
    if (trust.authorizeLogicalEndpoint !== undefined && typeof trust.authorizeLogicalEndpoint !== "function") {
        throw new OnvifError("InvalidConfiguration", "Logical endpoint authorization requires an explicit policy function");
    }
    const origins = trust.allowedOrigins.map((origin: string) => {
        const url = targetUrl(origin);
        if (url.pathname !== "/" || url.search) throw new OnvifError("InvalidConfiguration", "allowedOrigins entries must be origins, not path prefixes");
        return url.origin;
    });
    if (trust.tls !== undefined) {
        if (!isRecord(trust.tls) || Object.keys(trust.tls).some((key) => !["ca", "cert", "key", "passphrase", "minVersion"].includes(key))
            || (trust.tls.minVersion !== undefined && (typeof trust.tls.minVersion !== "string"
                || !["TLSv1.2", "TLSv1.3"].includes(trust.tls.minVersion)))) {
            throw new OnvifError("InvalidConfiguration", "Unsupported TLS trust option; verification cannot be disabled");
        }
        if ((trust.tls.cert === undefined) !== (trust.tls.key === undefined)) {
            throw new OnvifError("InvalidConfiguration", "TLS client identity requires both certificate and key");
        }
    }
    const targets = (values: readonly string[]): readonly string[] => {
        if (!Array.isArray(values) || values.length === 0 || values.length > 4096) {
            throw new OnvifError("InvalidConfiguration", "Exact target allowlist must be a bounded nonempty array");
        }
        return Object.freeze(values.map((href: string) => {
            const url = targetUrl(href);
            if (!origins.includes(url.origin)) throw new OnvifError("InvalidConfiguration", "Target is outside its allowed origin");
            return url.href;
        }));
    };
    const principalTargets: Record<string, readonly string[]> = {};
    if (trust.principalTargets !== undefined) {
        if (!isRecord(trust.principalTargets) || Object.keys(trust.principalTargets).length > 256) {
            throw new OnvifError("InvalidConfiguration", "Invalid principal target policy");
        }
        for (const [principal, values] of Object.entries(trust.principalTargets)) {
            if (!principal) throw new OnvifError("InvalidConfiguration", "Principal target policy requires a named principal");
            Object.defineProperty(principalTargets, principal, { value: targets(values), enumerable: true });
        }
    }
    return { allowedOrigins: Object.freeze(origins),
        ...(trust.allowedTargets === undefined ? {} : { allowedTargets: targets(trust.allowedTargets) }),
        ...(trust.principalTargets === undefined ? {} : { principalTargets: Object.freeze(principalTargets) }),
        ...(trust.authorizeLogicalEndpoint === undefined ? {} : { authorizeLogicalEndpoint: trust.authorizeLogicalEndpoint }),
        ...(trust.tls === undefined ? {} : { tls: { ...trust.tls } }) };
}

function targetUrl(href: string): URL {
    if (typeof href !== "string" || /[\u0000-\u0020\\]/u.test(href)) throw new OnvifError("PolicyDenied", "Invalid target URI");
    let url: URL;
    try {
        url = new URL(href);
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new OnvifError("PolicyDenied", "Target must be an absolute native HTTP(S) URI");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || !url.hostname) {
        throw new OnvifError("PolicyDenied", "Target scheme, userinfo or fragment is prohibited");
    }
    return url;
}

export function authorizeTarget(href: string, trust: TrustPolicy, principal?: string): URL {
    const url = targetUrl(href);
    if (!trust.allowedOrigins.includes(url.origin)) throw new OnvifError("PolicyDenied", "Target origin is not authorized");
    if (trust.allowedTargets !== undefined && !trust.allowedTargets.includes(url.href)) {
        throw new OnvifError("PolicyDenied", "Exact native target is not authorized");
    }
    if (trust.principalTargets !== undefined && (principal === undefined
        || !Object.hasOwn(trust.principalTargets, principal) || !trust.principalTargets[principal]?.includes(url.href))) {
        throw new OnvifError("PolicyDenied", "Principal is not authorized for the exact native target");
    }
    return url;
}

export async function credentialFor(
    provider: CredentialProvider | undefined,
    context: SecurityContext,
    target: URL,
    selection: SelectedSecurity,
    realm?: string
): Promise<CredentialMaterial> {
    if (provider === undefined) throw new OnvifError("AuthenticationFailed", "No out-of-band credential provider is configured", "rejected");
    const scope: CredentialScope = {
        thingId: context.thingId, principal: context.principal,
        href: target.href, origin: target.origin,
        securityName: selection.name, scheme: selection.definition.scheme,
        ...(realm === undefined ? {} : { realm })
    };
    const credential = await provider(Object.freeze(scope));
    if (credential === undefined) throw new OnvifError("AuthenticationFailed", "No credential is authorized for this request", "rejected");
    if (credential.origin !== target.origin || credential.principal !== context.principal
        || (realm !== undefined && credential.realm !== realm)) {
        throw new OnvifError("PolicyDenied", "Credential origin, realm or principal does not match this request", "rejected");
    }
    if (!isRecord(credential.material)
        || !["password", "http", "tls"].includes(credential.material.kind)
        || (credential.material.kind === "password"
            && (typeof credential.material.username !== "string" || typeof credential.material.password !== "string"))
        || (credential.material.kind === "tls"
            && (![credential.material.cert, credential.material.key].every((value) =>
                (typeof value === "string" || Buffer.isBuffer(value)) && value.length > 0)
                || credential.material.passphrase !== undefined && typeof credential.material.passphrase !== "string"))) {
        throw new OnvifError("InvalidSecurity", "Credential provider returned unsupported material");
    }
    return credential.material;
}
