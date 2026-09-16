import type { ThingDescription } from "wot-typescript-definitions";
import { isRecord, OnvifError } from "../binding/errors.js";
import { operationReference, type OperationDescriptor } from "../binding/registry.js";
import type { RequestAddressing } from "../binding/request.js";
import { WSA_NS, WSA_2004_NS } from "../binding/soap.js";
import { canonicalJson, digest } from "../catalog/sources.js";
import { assertXmlElement } from "../xml/parser.js";
import type { XmlElement } from "../xml/types.js";
import { authorizeTarget, type LogicalEndpointReference, type SecurityContext, type TrustPolicy } from "./policy.js";

function denied(message: string): never { throw new OnvifError("PolicyDenied", message); }

function logicalUrl(address: string): URL {
    if (typeof address !== "string" || !address || address.length > 16384
        || /[\u0000-\u0020\\]/u.test(address) || address.includes("#")
        || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/iu.test(address)) {
        return denied("Invalid logical endpoint URI");
    }
    let url: URL;
    try { url = new URL(address); } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return denied("Logical endpoint requires an absolute URI");
    }
    if (!["urn:", "http:", "https:"].includes(url.protocol) || url.username || url.password) {
        return denied("Logical endpoint scheme or userinfo is prohibited");
    }
    return url;
}

function referenceHeaders(value: unknown): readonly XmlElement[] {
    if (!Array.isArray(value) || value.length > 64) return denied("Invalid projected EPR reference headers");
    return Object.freeze(value.map((node: unknown) => {
        assertXmlElement(node);
        return structuredClone(node);
    }));
}

// This checks the projector's identity association, not the device's authenticity.
export function projectedEndpointReference(description: ThingDescription): LogicalEndpointReference | undefined {
    const discovery = description["onvif:discovery"];
    if (discovery === undefined) return undefined;
    if (!isRecord(discovery) || !isRecord(discovery.endpointReference)) return denied("Missing projected EPR metadata");
    const epr = discovery.endpointReference;
    if (Object.keys(epr).some((key) => !["address", "referenceProperties", "referenceParameters"].includes(key))
        || typeof epr.address !== "string") return denied("Invalid projected EPR metadata");
    logicalUrl(epr.address);
    const namespace = discovery.addressingNamespace;
    if (namespace !== WSA_NS && namespace !== WSA_2004_NS) return denied("Invalid projected EPR addressing namespace");
    const properties = referenceHeaders(epr.referenceProperties), parameters = referenceHeaders(epr.referenceParameters);
    if (namespace === WSA_NS && properties.length) return denied("WS-Addressing 2005 has no identity ReferenceProperties");
    const key: unknown[] = [epr.address, properties];
    const resource = description["onvif:resourceIdentity"];
    let kind = "device";
    if (resource !== undefined) {
        if (!isRecord(resource) || resource.epr !== epr.address
            || [resource.serviceNamespace, resource.kind, resource.token].some((value) =>
                typeof value !== "string" || !value || value.length > 4096)
            || !Array.isArray(resource.parentTokens) || resource.parentTokens.length > 64
            || resource.parentTokens.some((parent: unknown) => !isRecord(parent)
                || Object.keys(parent).some((field) => !["kind", "token"].includes(field))
                || [parent.kind, parent.token].some((value) => typeof value !== "string" || !value || value.length > 4096))) {
            return denied("Invalid projected native resource identity");
        }
        kind = "resource";
        key.push(resource.serviceNamespace, resource.kind, resource.parentTokens, resource.token);
    }
    if (description.id !== `urn:onvif:${kind}:${digest(key)}`) {
        return denied("Projected Thing identity does not match its full EPR and native resource identity");
    }
    return Object.freeze({ address: epr.address, addressingNamespace: namespace,
        referenceProperties: properties, referenceParameters: parameters });
}

export function authorizeLogicalEndpoint(
    context: SecurityContext, formHref: string, target: URL, operation: OperationDescriptor,
    addressing: RequestAddressing | undefined, trust: TrustPolicy
): void {
    const to = addressing?.to;
    if (to === undefined || to === context.thingId) return;
    const logical = logicalUrl(to);
    if (logical.protocol !== "urn:" && authorizeTarget(to, trust, context.principal).href === target.href) return;
    const expected = context.endpointReference;
    if (expected === undefined || trust.authorizeLogicalEndpoint === undefined) {
        return denied("Logical EPR alias requires a verified projected identity and explicit scoped policy");
    }
    if (authorizeTarget(formHref, trust, context.principal).href !== target.href
        || to !== expected.address || (addressing?.namespace ?? WSA_NS) !== expected.addressingNamespace
        || canonicalJson(addressing?.referenceProperties ?? []) !== canonicalJson(expected.referenceProperties)
        || canonicalJson(addressing?.referenceParameters ?? []) !== canonicalJson(expected.referenceParameters)) {
        return denied("Logical EPR alias must match the consumed endpoint reference and selected native Form target");
    }
    const approved = trust.authorizeLogicalEndpoint(Object.freeze({
        thingId: context.thingId, principal: context.principal, origin: target.origin, href: target.href,
        operation: structuredClone(operationReference(operation)), endpointReference: structuredClone(expected)
    }));
    if (approved !== true) return denied("Logical EPR alias is not approved for this Thing, endpoint and principal");
}
