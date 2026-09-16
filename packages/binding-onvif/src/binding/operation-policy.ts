import type { OperationDescriptor, OperationReference } from "./registry.js";

const readRules: readonly (readonly [string, string, readonly string[]])[] = [
    ["http://www.onvif.org/ver10/device/wsdl", "Device", ["GetServices", "GetServiceCapabilities", "GetDeviceInformation",
        "GetScopes", "GetEndpointReference", "GetSystemDateAndTime", "GetCapabilities", "GetNetworkInterfaces"]],
    ["http://www.onvif.org/ver10/media/wsdl", "Media", ["GetServiceCapabilities", "GetProfiles", "GetVideoSources",
        "GetAudioSources", "GetVideoSourceConfigurations", "GetVideoEncoderConfigurations", "GetMetadataConfigurations",
        "GetVideoAnalyticsConfigurations", "GetStreamUri"]],
    ["http://www.onvif.org/ver20/media/wsdl", "Media2", ["GetServiceCapabilities", "GetProfiles", "GetVideoSourceConfigurations",
        "GetVideoEncoderConfigurations", "GetMetadataConfigurations", "GetAnalyticsConfigurations", "GetStreamUri"]],
    ["http://www.onvif.org/ver10/events/wsdl", "EventPortType", ["GetServiceCapabilities", "GetEventProperties"]],
    ["http://www.onvif.org/ver10/recording/wsdl", "RecordingPort", ["GetServiceCapabilities", "GetRecordings", "GetRecordingConfiguration",
        "GetRecordingJobs", "GetRecordingJobConfiguration", "GetRecordingJobState"]],
    ["http://www.onvif.org/ver20/analytics/wsdl", "AnalyticsEnginePort", ["GetServiceCapabilities", "GetSupportedAnalyticsModules", "GetAnalyticsModules"]],
    ["http://www.onvif.org/ver20/analytics/wsdl", "RuleEnginePort", ["GetSupportedRules"]],
    ["http://www.onvif.org/ver10/accesscontrol/wsdl", "PACSPort", ["GetServiceCapabilities", "GetAccessPointInfoList", "GetAccessPointInfo", "GetAccessPointState"]],
    ["http://www.onvif.org/ver10/doorcontrol/wsdl", "DoorControlPort", ["GetServiceCapabilities", "GetDoorInfoList", "GetDoorInfo", "GetDoorState"]],
    ["http://www.onvif.org/ver10/accessrules/wsdl", "AccessRulesPort", ["GetServiceCapabilities", "GetAccessProfileList"]],
    ["http://www.onvif.org/ver10/schedule/wsdl", "SchedulePort", ["GetServiceCapabilities", "GetScheduleList"]],
    ["http://www.onvif.org/ver10/receiver/wsdl", "ReceiverPort", ["GetServiceCapabilities", "GetReceivers"]],
    ["http://www.onvif.org/ver10/credential/wsdl", "CredentialPort", ["GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/deviceIO/wsdl", "DeviceIOPort", ["GetServiceCapabilities", "GetDigitalInputs", "GetSerialPorts"]],
    ["http://www.onvif.org/ver20/imaging/wsdl", "ImagingPort", ["GetServiceCapabilities"]],
    ["http://www.onvif.org/ver20/ptz/wsdl", "PTZ", ["GetServiceCapabilities"]],
    ["http://www.onvif.org/ver10/search/wsdl", "SearchPort", ["GetServiceCapabilities", "GetRecordingSummary"]],
    ["http://www.onvif.org/ver10/replay/wsdl", "ReplayPort", ["GetServiceCapabilities", "GetReplayUri"]]
];

export function nativeOperationPolicy(reference: OperationReference, oneWay: boolean): {
    access: OperationDescriptor["access"]; execution: NonNullable<OperationDescriptor["execution"]>;
} {
    const safe = !oneWay && readRules.some(([namespace, port, names]) =>
        reference.portTypeQName.namespace === namespace && reference.portTypeQName.localName === port
        && names.includes(reference.operation));
    const eventState = ["http://www.onvif.org/ver10/events/wsdl", "http://docs.oasis-open.org/wsn/bw-2"]
        .includes(reference.portTypeQName.namespace) && !safe;
    const searchState = reference.portTypeQName.namespace === "http://www.onvif.org/ver10/search/wsdl"
        && ["FindRecordings", "FindEvents", "FindPTZPosition", "FindMetadata", "GetRecordingSearchResults",
            "GetEventSearchResults", "GetPTZPositionSearchResults", "GetMetadataSearchResults", "EndSearch"].includes(reference.operation);
    return { access: safe ? "read" : eventState || searchState || oneWay ? "stateful" : "unclassified",
        execution: { mode: oneWay ? "one-way" : "request-response", safe, idempotent: safe } };
}
