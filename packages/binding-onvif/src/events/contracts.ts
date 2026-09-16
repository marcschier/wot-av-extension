import { isRecord, OnvifError } from "../binding/errors.js";
import { operationKey, operationReference, type OperationDescriptor, type OperationReference, type OperationRegistry } from "../binding/registry.js";
import { requireImplemented } from "../xml/descriptors.js";
import { decodeElement } from "../xml/mapper.js";
import { isNCName, type ElementDescriptor, type XmlElement } from "../xml/types.js";
import { matchesXsdPattern, XSD_PATTERNS } from "../xml/xsd-patterns.js";

export const EVENT_NS = "http://www.onvif.org/ver10/events/wsdl";
export const WSN_NS = "http://docs.oasis-open.org/wsn/b-2";
export const WSN_WSDL_NS = "http://docs.oasis-open.org/wsn/bw-2";
export const CONCRETE_SET = "http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet";
export const CONCRETE_TOPIC = "http://docs.oasis-open.org/wsn/t-1/TopicExpression/Concrete";
export const FULL_TOPIC = "http://docs.oasis-open.org/wsn/t-1/TopicExpression/Full";
export const EVENT_BINDING = "pullpoint-v1";

export interface SubscriptionDescriptor {
    readonly mode: "pullpoint";
    readonly create: OperationReference;
    readonly pull: OperationReference;
    readonly unsubscribe: OperationReference;
    readonly renew?: OperationReference;
    readonly synchronize?: OperationReference;
    readonly defaultInput?: Readonly<Record<string, unknown>>;
}
export interface TopicFilter {
    readonly expression: string;
    readonly namespaces: Readonly<Record<string, string>>;
    readonly dialect?: string;
}
export interface ResolvedSubscription {
    readonly descriptor: SubscriptionDescriptor;
    readonly create: OperationDescriptor;
    readonly pull: OperationDescriptor;
    readonly unsubscribe: OperationDescriptor;
    readonly renew?: OperationDescriptor;
    readonly synchronize?: OperationDescriptor;
    readonly notification: ElementDescriptor;
}

export function eventReference(binding: string, port: string, operation: string, namespace = EVENT_NS): OperationReference {
    return { bindingQName: { namespace: EVENT_NS, localName: binding }, portTypeQName: { namespace, localName: port }, operation };
}

export function canonicalSubscription(registry: OperationRegistry): SubscriptionDescriptor {
    const descriptor: SubscriptionDescriptor = {
        mode: "pullpoint",
        create: eventReference("EventBinding", "EventPortType", "CreatePullPointSubscription"),
        pull: eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "PullMessages"),
        unsubscribe: eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "Unsubscribe"),
        renew: eventReference("SubscriptionManagerBinding", "SubscriptionManager", "Renew", WSN_WSDL_NS),
        synchronize: eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "SetSynchronizationPoint")
    };
    resolveSubscription(descriptor, registry);
    return descriptor;
}

export function resolveSubscription(value: unknown, registry: OperationRegistry): ResolvedSubscription {
    if (!isRecord(value) || value.mode !== "pullpoint" || Object.keys(value).some((key) =>
        !["mode", "create", "pull", "unsubscribe", "renew", "synchronize", "defaultInput"].includes(key))
        || value.defaultInput !== undefined && !isRecord(value.defaultInput)) {
        throw new OnvifError("InvalidRegistry", "Event requires an explicit native PullPoint subscription descriptor");
    }
    const resolve = (input: unknown, expected: readonly OperationReference[]): OperationDescriptor => {
        const reference = operationReference(input);
        if (!expected.some((entry) => operationKey(entry) === operationKey(reference))) {
            throw new OnvifError("InvalidRegistry", "Subscription descriptor does not name the required native WSDL tuple");
        }
        const operation = registry.resolve(reference);
        if (operation.response === null) throw new OnvifError("InvalidRegistry", "PullPoint lifecycle operations require native responses");
        for (const element of [operation.request, operation.response, ...(operation.faults ?? []).map((fault) => fault.element)]) {
            requireImplemented(element, registry.xml);
        }
        return operation;
    };
    const create = resolve(value.create, [eventReference("EventBinding", "EventPortType", "CreatePullPointSubscription")]);
    const pull = resolve(value.pull, [eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "PullMessages")]);
    const unsubscribe = resolve(value.unsubscribe, [
        eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "Unsubscribe"),
        eventReference("SubscriptionManagerBinding", "SubscriptionManager", "Unsubscribe", WSN_WSDL_NS)
    ]);
    const renew = value.renew === undefined ? undefined
        : resolve(value.renew, [eventReference("SubscriptionManagerBinding", "SubscriptionManager", "Renew", WSN_WSDL_NS)]);
    const synchronize = value.synchronize === undefined ? undefined
        : resolve(value.synchronize, [eventReference("PullPointSubscriptionBinding", "PullPointSubscription", "SetSynchronizationPoint")]);
    const notification = registry.xml.elements[`{${WSN_NS}}NotificationMessage`];
    if (notification === undefined) throw new OnvifError("InvalidRegistry", "Subscription has no compiled native NotificationMessage declaration");
    requireImplemented(notification, registry.xml);
    return { descriptor: { mode: "pullpoint", create: operationReference(create), pull: operationReference(pull),
        unsubscribe: operationReference(unsubscribe), ...(renew === undefined ? {} : { renew: operationReference(renew) }),
        ...(synchronize === undefined ? {} : { synchronize: operationReference(synchronize) }),
        ...(value.defaultInput === undefined ? {} : { defaultInput: structuredClone(value.defaultInput) }) },
    create, pull, unsubscribe, notification, ...(renew === undefined ? {} : { renew }),
    ...(synchronize === undefined ? {} : { synchronize }) };
}

export function canonicalTopicFilter(filter: TopicFilter, registry: OperationRegistry): unknown {
    const dialect = filter.dialect ?? CONCRETE_SET;
    if (!isRecord(filter.namespaces) || typeof filter.expression !== "string") throw new OnvifError("InvalidValue", "Topic filter requires expression and namespace bindings");
    const parts = dialect === CONCRETE_SET ? filter.expression.split("|") : [filter.expression];
    const pattern = dialect === FULL_TOPIC ? XSD_PATTERNS.fullTopic : XSD_PATTERNS.concreteTopic;
    if (![CONCRETE_SET, CONCRETE_TOPIC, FULL_TOPIC].includes(dialect)) {
        throw new OnvifError("UnsupportedCapability", "Use canonical native Filter input for an unqualified expression dialect");
    }
    if (!parts.every((part) => matchesXsdPattern(pattern, part))) throw new OnvifError("InvalidValue", "Topic filter violates its native expression grammar");
    for (const token of filter.expression.split(/[|/]/u)) {
        if (!token.includes(":")) continue;
        const prefix = token.slice(0, token.indexOf(":"));
        if (!isNCName(prefix) || typeof filter.namespaces[prefix] !== "string" || !filter.namespaces[prefix]) {
            throw new OnvifError("InvalidValue", "Topic filter contains an unbound QName prefix");
        }
    }
    const expression: XmlElement = { kind: "element", name: { namespace: WSN_NS, localName: "TopicExpression" },
        namespaces: { "": "", ...filter.namespaces },
        attributes: [{ name: { namespace: "", localName: "Dialect" }, value: dialect }],
        children: [{ kind: "text", value: filter.expression }] };
    const element: ElementDescriptor = { name: { namespace: EVENT_NS, localName: "Filter" },
        type: { kind: "ref", ref: `{${WSN_NS}}FilterType` } };
    return decodeElement(element, { kind: "element", name: element.name, namespaces: {},
        attributes: [], children: [expression] }, registry.xml);
}
