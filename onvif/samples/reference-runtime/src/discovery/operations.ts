import { OnvifError } from "../binding/errors.js";
import { operationKey, type OperationReference } from "../binding/registry.js";
import type { ResourceKind } from "./types.js";

export interface ReadContract {
    reference: OperationReference;
    soapAction: string;
    source: string;
    locator: string;
    list?: { field: string; kind: ResourceKind; pagination: boolean; tokenField?: string };
}

export const NAMESPACES = Object.freeze({
    device: "http://www.onvif.org/ver10/device/wsdl",
    media1: "http://www.onvif.org/ver10/media/wsdl",
    media2: "http://www.onvif.org/ver20/media/wsdl",
    recording: "http://www.onvif.org/ver10/recording/wsdl",
    analytics: "http://www.onvif.org/ver20/analytics/wsdl",
    events: "http://www.onvif.org/ver10/events/wsdl",
    access: "http://www.onvif.org/ver10/accesscontrol/wsdl",
    door: "http://www.onvif.org/ver10/doorcontrol/wsdl",
    accessRules: "http://www.onvif.org/ver10/accessrules/wsdl",
    schedule: "http://www.onvif.org/ver10/schedule/wsdl"
});

const contracts: ReadContract[] = [];
function service(namespace: string, binding: string, port: string, source: string, operations: readonly string[]): void {
    for (const operation of operations) {
        contracts.push({
            reference: {
                bindingQName: { namespace, localName: binding },
                portTypeQName: { namespace, localName: port }, operation
            },
            soapAction: namespace === NAMESPACES.events ? `${namespace}/EventPortType/${operation}Request`
                : namespace === "http://www.onvif.org/ver10/deviceIO/wsdl"
                    ? `http://www.onvif.org/ver10/deviceio/wsdl/${operation}` : `${namespace}/${operation}`,
            source: `onvif:wsdl/${source}`, locator: `binding ${binding}/operation ${operation}`
        });
    }
}

service(NAMESPACES.device, "DeviceBinding", "Device", "ver10/device/wsdl/devicemgmt.wsdl", [
    "GetServices", "GetServiceCapabilities", "GetDeviceInformation", "GetScopes",
    "GetEndpointReference", "GetSystemDateAndTime", "GetCapabilities"
]);
service(NAMESPACES.media1, "MediaBinding", "Media", "ver10/media/wsdl/media.wsdl", [
    "GetServiceCapabilities", "GetProfiles", "GetVideoSourceConfigurations", "GetVideoEncoderConfigurations",
    "GetMetadataConfigurations", "GetVideoAnalyticsConfigurations"
]);
service(NAMESPACES.media2, "Media2Binding", "Media2", "ver20/media/wsdl/media.wsdl", [
    "GetServiceCapabilities", "GetProfiles", "GetVideoSourceConfigurations", "GetVideoEncoderConfigurations",
    "GetMetadataConfigurations", "GetAnalyticsConfigurations"
]);
service(NAMESPACES.recording, "RecordingBinding", "RecordingPort", "ver10/recording.wsdl", [
    "GetServiceCapabilities", "GetRecordings", "GetRecordingJobs", "GetRecordingJobConfiguration", "GetRecordingJobState"
]);
service(NAMESPACES.analytics, "AnalyticsEngineBinding", "AnalyticsEnginePort", "ver20/analytics/wsdl/analytics.wsdl", [
    "GetServiceCapabilities", "GetSupportedAnalyticsModules", "GetAnalyticsModules"
]);
service(NAMESPACES.analytics, "RuleEngineBinding", "RuleEnginePort", "ver20/analytics/wsdl/analytics.wsdl", ["GetSupportedRules"]);
service(NAMESPACES.events, "EventBinding", "EventPortType", "ver10/events/wsdl/event.wsdl", ["GetServiceCapabilities", "GetEventProperties"]);
service(NAMESPACES.access, "PACSBinding", "PACSPort", "ver10/pacs/accesscontrol.wsdl", ["GetServiceCapabilities", "GetAccessPointInfoList"]);
service(NAMESPACES.door, "DoorControlBinding", "DoorControlPort", "ver10/pacs/doorcontrol.wsdl", ["GetServiceCapabilities", "GetDoorInfoList"]);
service(NAMESPACES.accessRules, "AccessRulesBinding", "AccessRulesPort", "ver10/accessrules/wsdl/accessrules.wsdl", ["GetServiceCapabilities", "GetAccessProfileList"]);
service(NAMESPACES.schedule, "ScheduleBinding", "SchedulePort", "ver10/schedule/wsdl/schedule.wsdl", ["GetServiceCapabilities", "GetScheduleList"]);
service("http://www.onvif.org/ver10/receiver/wsdl", "ReceiverBinding", "ReceiverPort", "ver10/receiver.wsdl", ["GetServiceCapabilities", "GetReceivers"]);
service("http://www.onvif.org/ver10/credential/wsdl", "CredentialBinding", "CredentialPort", "ver10/credential/wsdl/credential.wsdl", ["GetServiceCapabilities"]);
service("http://www.onvif.org/ver10/deviceIO/wsdl", "DeviceIOBinding", "DeviceIOPort", "ver10/deviceio.wsdl", ["GetServiceCapabilities"]);
service("http://www.onvif.org/ver20/imaging/wsdl", "ImagingBinding", "ImagingPort", "ver20/imaging/wsdl/imaging.wsdl", ["GetServiceCapabilities"]);
service("http://www.onvif.org/ver20/ptz/wsdl", "PTZBinding", "PTZ", "ver20/ptz/wsdl/ptz.wsdl", ["GetServiceCapabilities"]);
service("http://www.onvif.org/ver10/search/wsdl", "SearchBinding", "SearchPort", "ver10/search.wsdl", ["GetServiceCapabilities"]);
service("http://www.onvif.org/ver10/replay/wsdl", "ReplayBinding", "ReplayPort", "ver10/replay.wsdl", ["GetServiceCapabilities"]);

function resource(namespace: string, operation: string, field: string, kind: ResourceKind, pagination = false, tokenField?: string): void {
    const contract = contracts.find((item) => item.reference.bindingQName.namespace === namespace && item.reference.operation === operation);
    if (!contract) throw new Error("Internal read contract is missing");
    contract.list = { field, kind, pagination, ...(tokenField ? { tokenField } : {}) };
}
for (const namespace of [NAMESPACES.media1, NAMESPACES.media2]) {
    resource(namespace, "GetProfiles", "Profiles", "media-profile");
    resource(namespace, "GetVideoSourceConfigurations", "Configurations", "video-source-configuration");
    resource(namespace, "GetVideoEncoderConfigurations", "Configurations", "video-encoder-configuration");
    resource(namespace, "GetMetadataConfigurations", "Configurations", "metadata-configuration");
    resource(namespace, namespace === NAMESPACES.media1 ? "GetVideoAnalyticsConfigurations" : "GetAnalyticsConfigurations",
        "Configurations", "analytics-configuration");
}
resource(NAMESPACES.recording, "GetRecordings", "RecordingItem", "recording", false, "RecordingToken");
resource(NAMESPACES.recording, "GetRecordingJobs", "JobItem", "recording-job", false, "JobToken");
resource(NAMESPACES.access, "GetAccessPointInfoList", "AccessPointInfo", "access-point", true);
resource(NAMESPACES.door, "GetDoorInfoList", "DoorInfo", "door", true);
resource(NAMESPACES.accessRules, "GetAccessProfileList", "AccessProfile", "access-profile", true);
resource(NAMESPACES.schedule, "GetScheduleList", "Schedule", "schedule", true);
resource("http://www.onvif.org/ver10/receiver/wsdl", "GetReceivers", "Receivers", "receiver", false, "Token");

for (const contract of contracts) {
    Object.freeze(contract.reference.bindingQName);
    Object.freeze(contract.reference.portTypeQName);
    Object.freeze(contract.reference);
    if (contract.list) Object.freeze(contract.list);
    Object.freeze(contract);
}
export const READ_CONTRACTS: readonly Readonly<ReadContract>[] = Object.freeze(contracts);
const byKey = new Map(READ_CONTRACTS.map((contract) => [operationKey(contract.reference), contract]));

export function readonlyContract(key: string): Readonly<ReadContract> {
    const contract = byKey.get(key);
    if (!contract) throw new OnvifError("PolicyDenied", "Operation is not in the fixed discovery read allowlist");
    return contract;
}

export function readContract(namespace: string, operation: string): Readonly<ReadContract> {
    const result = READ_CONTRACTS.find((contract) =>
        contract.reference.bindingQName.namespace === namespace && contract.reference.operation === operation);
    if (!result) throw new OnvifError("PolicyDenied", "No qualified discovery read contract exists for this service operation");
    return result;
}
