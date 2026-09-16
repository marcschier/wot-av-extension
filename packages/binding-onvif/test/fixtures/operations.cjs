const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const EVENTS = "http://www.onvif.org/ver10/events/wsdl";
const WSN = "http://docs.oasis-open.org/wsn/b-2";
const WSN_WSDL = "http://docs.oasis-open.org/wsn/bw-2";
const MAPPING = "urn:wot-av:test:mapping";
const KEY = "urn:wot-av:test:keys";

const q = (namespace, localName) => ({ namespace, localName });
const scalar = (type) => ({ kind: "scalar", type });
const element = (namespace, localName, type, options = {}) => ({
    name: q(namespace, localName), type, ...options
});
const field = (key, child, options = {}) => ({
    kind: "element", key, element: child, ...options
});
const empty = { kind: "complex", sequence: [] };
const text = scalar("string");
const fixtureSource = {
    kind: "fixture",
    document: "urn:wot-av:test:independent-endpoints",
    locator: "Authored qualification fixtures; not an all-profile operation catalog"
};

const device = {
    bindingQName: q(DEVICE, "DeviceBinding"),
    portTypeQName: q(DEVICE, "Device"),
    operation: "GetDeviceInformation",
    soapAction: `${DEVICE}/GetDeviceInformation`,
    addressingAction: `${DEVICE}/GetDeviceInformation`,
    request: element(DEVICE, "GetDeviceInformation", empty),
    response: element(DEVICE, "GetDeviceInformationResponse", {
        kind: "complex",
        sequence: ["Manufacturer", "Model", "FirmwareVersion", "SerialNumber", "HardwareId"]
            .map((name) => field(name, element(DEVICE, name, text)))
    }),
    access: "read",
    source: {
        kind: "fixture",
        document: "https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/device/wsdl/devicemgmt.wsdl",
        locator: "479-517;2507-2511;3126-3129;3870-3878"
    }
};

const collision = {
    ...device,
    bindingQName: q("urn:wot-av:test:collision", "DeviceBinding"),
    portTypeQName: q("urn:wot-av:test:collision", "Device"),
    soapAction: "urn:wot-av:test:collision:information",
    addressingAction: "urn:wot-av:test:collision:information",
    response: element("urn:wot-av:test:collision", "Information", text),
    source: fixtureSource
};

const write = {
    bindingQName: q(MAPPING, "ControlBinding"),
    portTypeQName: q(MAPPING, "Control"),
    operation: "Change",
    soapAction: "urn:wot-av:test:change",
    addressingAction: "urn:wot-av:test:change",
    request: element(MAPPING, "Change", {
        kind: "complex",
        sequence: [field("Value", element(MAPPING, "Value", text))]
    }),
    response: element(MAPPING, "ChangeResponse", empty),
    access: "write",
    source: fixtureSource
};

const createSubscription = {
    bindingQName: q(EVENTS, "EventBinding"),
    portTypeQName: q(EVENTS, "EventPortType"),
    operation: "CreatePullPointSubscription",
    soapAction: `${EVENTS}/EventPortType/CreatePullPointSubscriptionRequest`,
    addressingAction: `${EVENTS}/EventPortType/CreatePullPointSubscriptionRequest`,
    request: element(EVENTS, "CreatePullPointSubscription", empty),
    response: element(EVENTS, "CreatePullPointSubscriptionResponse", {
        kind: "complex",
        sequence: [
            field("SubscriptionReference", element(EVENTS, "SubscriptionReference", { kind: "opaque" })),
            field("CurrentTime", element(WSN, "CurrentTime", scalar("dateTime"))),
            field("TerminationTime", element(WSN, "TerminationTime", scalar("dateTime"), { nillable: true }))
        ]
    }),
    access: "stateful",
    source: fixtureSource
};

const unsubscribe = {
    bindingQName: q(EVENTS, "SubscriptionManagerBinding"),
    portTypeQName: q(WSN_WSDL, "SubscriptionManager"),
    operation: "Unsubscribe",
    soapAction: "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest",
    addressingAction: "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest",
    request: element(WSN, "Unsubscribe", empty),
    response: element(WSN, "UnsubscribeResponse", empty),
    access: "stateful",
    source: {
        kind: "fixture",
        document: "https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/events/wsdl/event.wsdl",
        locator: "13-19;713-746; OASIS bw-2.wsdl SubscriptionManager/Unsubscribe, messages refer to b-2 elements"
    }
};

const mappingElement = element(MAPPING, "Sample", {
    kind: "complex",
    attributes: [
        { key: "id", name: q("", "id"), type: text, required: true },
        { key: "mode", name: q(KEY, "mode"), type: scalar("QName"), required: true }
    ],
    sequence: [
        field("Count", element(MAPPING, "Count", scalar("uint64"))),
        field("Price", element(MAPPING, "Price", scalar("decimal"))),
        field("Stamp", element(MAPPING, "Stamp", scalar("dateTime"))),
        field("Hex", element(MAPPING, "Hex", scalar("hexBinary"))),
        field("Bytes", element(MAPPING, "Bytes", scalar("base64Binary"))),
        field("Kind", element(MAPPING, "Kind", scalar("QName"))),
        field("Absent", element(MAPPING, "Absent", text), { minOccurs: 0 }),
        field("Empty", element(MAPPING, "Empty", text)),
        field("Nil", element(MAPPING, "Nil", {
            kind: "complex",
            text,
            attributes: [{ key: "code", name: q("", "code"), type: text }]
        }, { nillable: true })),
        field("Tags", element(MAPPING, "Tag", text), { minOccurs: 0, maxOccurs: "unbounded" }),
        {
            kind: "choice",
            key: "Choices",
            minOccurs: 1,
            maxOccurs: "unbounded",
            alternatives: [
                { key: "A", element: element(MAPPING, "A", text) },
                { key: "B", element: element(MAPPING, "B", scalar("int32")) }
            ]
        },
        { kind: "any", key: "$extensions", minOccurs: 0, maxOccurs: "unbounded",
            namespaces: ["urn:wot-av:test:extension"] }
    ]
});

const mapping = {
    bindingQName: q(MAPPING, "MappingBinding"),
    portTypeQName: q(MAPPING, "Mapping"),
    operation: "RoundTrip",
    soapAction: "urn:wot-av:test:mapping:roundtrip",
    addressingAction: "urn:wot-av:test:mapping:roundtrip",
    request: mappingElement,
    response: mappingElement,
    access: "write",
    source: fixtureSource
};

function reference(operation) {
    return {
        bindingQName: operation.bindingQName,
        portTypeQName: operation.portTypeQName,
        operation: operation.operation
    };
}

function form(href, operation, security = ["none"]) {
    return {
        href,
        op: "invokeaction",
        contentType: "application/soap+xml",
        "htv:methodName": "POST",
        security,
        "onvif:binding": "soap12-http-v1",
        "onvif:operation": reference(operation)
    };
}

function td(href, overrides = {}) {
    return {
        "@context": ["https://www.w3.org/2022/wot/td/v1.1", {
            onvif: "https://marcschier.github.io/wot-av-extension/bindings/onvif#"
        }],
        id: "urn:wot-av:test:device",
        title: "Independent native gate",
        securityDefinitions: {
            none: { scheme: "nosec" },
            digest: { scheme: "digest" },
            wsse: { scheme: "onvif:UsernameTokenSecurityScheme" },
            basic: { scheme: "basic", in: "header" },
            bearer: { scheme: "bearer", in: "header", format: "jwt" }
        },
        security: ["none"],
        actions: {
            information: { forms: [form(href, device)] },
            collision: { forms: [form(href, collision)] },
            change: { input: { type: "object" }, forms: [form(href, write)] },
            createSubscription: { forms: [form(href, createSubscription)] },
            unsubscribe: { forms: [form(href, unsubscribe)] },
            roundTrip: { input: { type: "object" }, forms: [form(href, mapping)] }
        },
        ...overrides
    };
}

module.exports = {
    DEVICE, EVENTS, WSN, MAPPING, KEY, q, scalar, element, field, empty,
    device, collision, write, createSubscription, unsubscribe, mappingElement, mapping,
    reference, form, td,
    operations: [device, collision, write, createSubscription, unsubscribe, mapping]
};
