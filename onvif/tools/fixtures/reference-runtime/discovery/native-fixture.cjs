const h = require("../../../tests/reference-runtime/discovery/helpers.cjs");

function nativeFixture(patch) {
    const data = JSON.parse(h.fixture("native-results.json"));
    const adapter = new h.FixtureReadAdapter(async (key, args, target, request) => {
        const reference = h.readonlyContract(key).reference;
        const namespace = reference.bindingQName.namespace;
        const route = `${namespace}|${reference.operation}`;
        const override = await patch?.({ reference, route, args, target, request, data });
        if (override !== undefined) return override;
        const root = namespace === h.NAMESPACES.device ? {
            GetServices: data.services, GetDeviceInformation: data.information, GetEndpointReference: data.endpointReference,
            GetScopes: data.scopes
        } : {};
        const response = reference.operation === "GetServiceCapabilities" ? data.capabilities[namespace]
            : root[reference.operation] ?? data.routes[route];
        if (response === undefined) return { status: "unsupported", code: "FixtureNotConfigured",
            message: "This source operation has no successful response configured in the independent fixture", responded: false };
        return { status: "known", value: structuredClone(response), responded: true };
    });
    const clock = new h.FixtureClock(1000);
    const bounds = h.boundedOptions();
    const timers = h.timerOptions();
    const allowed = new Set(data.services.Service.map((service) => service.XAddr));
    const inspector = new h.ReadonlyInspector(adapter, clock, bounds, timers, allowed);
    const target = { xaddr: h.XADDR, endpointReference: { address: h.EPR, referenceProperties: [], referenceParameters: [] },
        interfaceId: "loop-a", segmentId: "segment-a" };
    return { data, adapter, clock, bounds, timers, allowed, inspector, target };
}
module.exports = { nativeFixture };
