import { OnvifError } from "../binding/errors.js";
import type { CanonicalCatalog, CompiledOperation } from "./compiler.js";

export interface SafeReadAlias {
    readonly id: string;
    readonly operationId: string;
    readonly reason: string;
    readonly sourceId: string;
    readonly locator: string;
}

const safeReads: readonly (readonly [string, string, readonly string[]])[] = [
    ["http://www.onvif.org/ver10/device/wsdl", "Device",
        ["GetDeviceInformation", "GetServices", "GetServiceCapabilities", "GetSystemDateAndTime", "GetScopes", "GetCapabilities"]],
    ["http://www.onvif.org/ver10/media/wsdl", "Media", ["GetProfiles", "GetVideoSources", "GetAudioSources", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver20/media/wsdl", "Media2", ["GetProfiles", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/recording/wsdl", "RecordingPort", ["GetRecordings", "GetRecordingConfiguration", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/search/wsdl", "SearchPort", ["GetRecordingSummary", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/accesscontrol/wsdl", "PACSPort", ["GetAccessPointInfoList", "GetAccessPointInfo", "GetAccessPointState", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/doorcontrol/wsdl", "DoorControlPort", ["GetDoorInfoList", "GetDoorInfo", "GetDoorState", "GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/deviceIO/wsdl", "DeviceIOPort", ["GetDigitalInputs", "GetSerialPorts", "GetServiceCapabilities"]]
];

export function safeReadAliases(catalog: CanonicalCatalog): SafeReadAlias[] {
    const aliases: SafeReadAlias[] = [];
    for (const [namespace, portType, operations] of safeReads) {
        if (!catalog.services.some((service) => service.namespace === namespace)) continue;
        for (const name of operations) {
            const operation = catalog.operations.find((entry) => entry.serviceNamespace === namespace
                && entry.portTypeQName.localName === portType && entry.operation === name);
            if (operation === undefined) throw new OnvifError("InvalidRegistry", `Authored SafeRead contract no longer resolves: ${namespace}/${portType}/${name}`);
            aliases.push({ id: `read_${operation.id}`, operationId: operation.id, sourceId: operation.sourceId,
                locator: `L${operation.portTypeSource.line}`,
                reason: "Explicitly reviewed finite information/capability/inventory/status retrieval in the cited WSDL operation documentation. Repeat invocation does not allocate, drain, actuate, synchronize, or change native state. This is a safe Action alias, not an inferred Property or an authentication/access-class assertion." });
        }
    }
    return aliases.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function resourceKinds(catalog: CanonicalCatalog): readonly {
    kind: string; nativeTypeIds: string[]; parentKinds: readonly string[]; description: string;
}[] {
    const tt = "http://www.onvif.org/ver10/schema";
    const mappings: readonly (readonly [string, readonly string[], readonly string[]])[] = [
        ["MediaProfile", [`{${tt}}Profile`, "{http://www.onvif.org/ver20/media/wsdl}MediaProfile"], []],
        ["Recording", [`{${tt}}GetRecordingsResponseItem`], []],
        ["RecordingTrack", [`{${tt}}GetTracksResponseItem`], ["Recording"]],
        ["RecordingJob", [`{${tt}}RecordingJobConfiguration`], []],
        ["AccessPoint", ["{http://www.onvif.org/ver10/accesscontrol/wsdl}AccessPointInfo"], []],
        ["Door", ["{http://www.onvif.org/ver10/doorcontrol/wsdl}DoorInfo"], []],
        ["AnalyticsModule", [`{${tt}}Config`], ["AnalyticsConfiguration"]],
        ["AnalyticsRule", [`{${tt}}Config`], ["AnalyticsConfiguration"]],
        ["Receiver", [`{${tt}}Receiver`], []],
        ["VideoSource", [`{${tt}}VideoSource`], []],
        ["AudioSource", [`{${tt}}AudioSource`], []],
        ["DigitalInput", [`{${tt}}DigitalInput`], []],
        ["RelayOutput", [`{${tt}}RelayOutput`], []],
        ["SerialPort", ["{http://www.onvif.org/ver10/deviceIO/wsdl}SerialPort"], []]
    ];
    return mappings.map(([kind, nativeTypeIds, parentKinds]) => {
        for (const id of nativeTypeIds) {
            if (!Object.hasOwn(catalog.xml.types, id)) throw new OnvifError("InvalidRegistry", `Authored resource type no longer resolves: ${id}`);
        }
        return { kind, nativeTypeIds: [...nativeTypeIds], parentKinds,
            description: `${kind} identity uses the stable device EPR, service namespace, resource kind, complete ordered parent-token path, and native token. Inventories are observed at runtime, never generated enumerations. Resource metadata does not automatically fill or rewrite native operation inputs.` };
    });
}

export function operationReferenceData(operation: CompiledOperation): Record<string, unknown> {
    return { bindingQName: operation.bindingQName, portTypeQName: operation.portTypeQName, operation: operation.operation };
}
