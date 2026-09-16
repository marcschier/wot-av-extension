import { ONVIF_BASE, PAYLOAD_SCHEMA, type Schema } from "./schemas.js";

const string = { type: "string", minLength: 1 };
const stringList = { type: "array", items: string };
const qname = { $ref: "#/$defs/qname" };
const operationReference: Schema = {
    type: "object", properties: { bindingQName: qname, portTypeQName: qname, operation: string },
    required: ["bindingQName", "portTypeQName", "operation"], additionalProperties: false
};
const qnameDefinition: Schema = {
    type: "object", properties: { namespace: { type: "string" }, localName: string },
    required: ["namespace", "localName"], additionalProperties: false
};
const jsonValue: Schema = { oneOf: [
    { type: ["null", "boolean", "number", "string"] },
    { type: "array", items: { $ref: "#/$defs/jsonValue" }, maxItems: 20000 },
    { type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" }, maxProperties: 20000 }
] };
const evidence: Schema = {
    type: "array", maxItems: 128, items: {
        type: "object", properties: { sourceId: string, observedAt: string, operation: { $ref: "#/$defs/operation" }, detail: { type: "string" } },
        required: ["sourceId"], additionalProperties: false
    }
};
const nativeReference: Schema = {
    type: "object", properties: { operation: string, portType: string, binding: string },
    required: ["operation"], additionalProperties: false
};

function observation(valueSchema: Schema): Schema {
    return { oneOf: [
        { type: "object", properties: { state: { const: "known" }, value: valueSchema,
            evidence: { ...evidence, minItems: 1 }, detail: { type: "string" } },
        required: ["state", "value", "evidence"], additionalProperties: false },
        { type: "object", properties: { state: { enum: ["unsupported", "denied", "fault", "timeout", "truncated", "unknown"] },
            evidence, detail: { type: "string" } },
        required: ["state", "evidence"], additionalProperties: false }
    ] };
}

export function formSchema(): Schema {
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema", $id: `${ONVIF_BASE}/schemas/form.schema.json`,
        title: "Native ONVIF SOAP 1.2 Action or PullPoint Event Form",
        type: "object", required: ["href", "op", "onvif:binding"],
        properties: {
            href: { type: "string", format: "uri", pattern: "^https?://" },
            op: { oneOf: [{ enum: ["invokeaction", "subscribeevent", "unsubscribeevent"] },
                { type: "array", items: { enum: ["invokeaction", "subscribeevent", "unsubscribeevent"] }, minItems: 1, maxItems: 2, uniqueItems: true }] },
            contentType: { enum: ["application/soap+xml", "application/soap+xml; charset=utf-8"] },
            "htv:methodName": { const: "POST" },
            security: { oneOf: [string, { ...stringList, minItems: 1 }] },
            "onvif:binding": { enum: ["soap12-http-v1", "pullpoint-v1"] },
            "onvif:operation": { $ref: "#/$defs/operation" }, "onvif:soapAction": string,
            "onvif:subscription": { type: "object",
                properties: { mode: { const: "pullpoint" }, create: { $ref: "#/$defs/operation" },
                    pull: { $ref: "#/$defs/operation" }, unsubscribe: { $ref: "#/$defs/operation" },
                    renew: { $ref: "#/$defs/operation" }, synchronize: { $ref: "#/$defs/operation" },
                    defaultInput: { type: "object" } },
                required: ["mode", "create", "pull", "unsubscribe"], additionalProperties: false }
        },
        oneOf: [
            { required: ["onvif:operation"], properties: { "onvif:binding": { const: "soap12-http-v1" },
                "onvif:subscription": false,
                op: { oneOf: [{ const: "invokeaction" }, { type: "array", items: { const: "invokeaction" }, maxItems: 1 }] } } },
            { required: ["onvif:subscription"], properties: { "onvif:binding": { const: "pullpoint-v1" },
                "onvif:operation": false, "onvif:soapAction": false,
                op: { oneOf: [{ enum: ["subscribeevent", "unsubscribeevent"] },
                    { type: "array", items: { enum: ["subscribeevent", "unsubscribeevent"] } }] } } }
        ],
        patternProperties: { "^onvif:(?!(?:binding|operation|soapAction|subscription)$)": false },
        $defs: { qname: qnameDefinition, operation: operationReference },
        $comment: "Registry agreement, target/security policy and native execution capability checks remain mandatory. Codec descriptors are private consumed-schema augmentation, not public Form options."
    };
}

export function snapshotSchema(): Schema {
    const outcome = observation({ $ref: "#/$defs/jsonValue" });
    const facts = { type: "object", maxProperties: 10000, additionalProperties: outcome };
    const resourceToken = { type: "object", properties: { kind: string, token: string }, required: ["kind", "token"], additionalProperties: false };
    const referenceProperties = { type: "array", maxItems: 64, items: { $ref: `${PAYLOAD_SCHEMA}#/$defs/xmlElement` } };
    const recordIdentity = {
        type: "object", properties: Object.fromEntries(["manufacturer", "model", "firmwareVersion", "serialNumber", "hardwareId"].map((name) => [name, { type: "string" }])),
        additionalProperties: false
    };
    const operationProperties = { operation: string, portType: string, binding: string };
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema", $id: `${ONVIF_BASE}/schemas/snapshot.schema.json`,
        title: "DeviceSnapshot offline composition input", type: "object",
        properties: {
            schemaVersion: { const: 1 },
            epr: { type: "object", properties: { address: { type: "string", format: "uri" }, referenceProperties, referenceParameters: referenceProperties },
                required: ["address", "referenceProperties"], additionalProperties: false },
            identity: observation(recordIdentity),
            services: { type: "array", maxItems: 128, items: {
                type: "object", properties: {
                    namespace: string, xaddr: { type: "string", format: "uri", pattern: "^https?://" }, evidence: { ...evidence, minItems: 1 },
                    version: { type: "object", properties: { major: { type: "integer", minimum: 0 }, minor: { type: "integer", minimum: 0 } },
                        required: ["major", "minor"], additionalProperties: false },
                    capabilities: observation({ type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" } }),
                    readOutcomes: { type: "array", maxItems: 2048, items: { type: "object", properties: { ...operationProperties, outcome },
                        required: ["operation", "outcome"], additionalProperties: false } },
                    supportedOperations: { type: "array", maxItems: 2048, items: { type: "object",
                        properties: { ...operationProperties, support: observation({ type: "boolean" }) },
                        required: ["operation", "support"], additionalProperties: false } }
                }, required: ["namespace", "xaddr", "evidence", "capabilities", "readOutcomes"], additionalProperties: false
            } },
            profileClaims: { type: "array", maxItems: 64, items: { type: "object",
                properties: { profile: string, edition: string, role: { enum: ["device", "client"] }, evidence: { ...evidence, minItems: 1 } },
                required: ["profile", "role", "evidence"], additionalProperties: false } },
            resources: { type: "array", maxItems: 20000, items: { type: "object",
                properties: { serviceNamespace: string, kind: string, token: string, parentTokens: { type: "array", items: resourceToken, maxItems: 64 },
                    evidence: { ...evidence, minItems: 1 }, facts, operations: { type: "array", items: nativeReference, maxItems: 2048 } },
                required: ["serviceNamespace", "kind", "token", "parentTokens", "evidence"], additionalProperties: false } },
            facts,
            conformanceEvidence: { type: "array", maxItems: 64, items: { type: "object",
                properties: Object.fromEntries(["issuer", "product", "firmware", "profile", "edition", "source"].map((name) => [name, string])),
                required: ["issuer", "product", "firmware", "profile", "source"], additionalProperties: false } }
        },
        required: ["schemaVersion", "epr", "services", "profileClaims", "resources"], additionalProperties: false,
        $defs: { qname: qnameDefinition, operation: operationReference, jsonValue },
        $comment: "No network or discovery is performed by projection. Read-result canonical validation, URI credential exclusion, provenance, bounds, and identity-conflict checks are enforced by assertDeviceSnapshot/project."
    };
}

export function requirementsSchema(): Schema {
    const source = {
        type: "object", properties: { sourceId: string, pdfPage: { type: "integer", minimum: 1 },
            printedPage: { type: ["string", "integer", "null"] }, clause: string, table: string, row: string },
        required: ["sourceId", "pdfPage", "printedPage", "clause"], additionalProperties: true
    };
    const condition = { oneOf: [
        { type: "null" },
        ...["all", "any"].map((name) => ({ type: "object",
            properties: { [name]: { type: "array", minItems: 1, items: { $ref: "#/$defs/condition" } } },
            required: [name], additionalProperties: false })),
        { type: "object", properties: { not: { $ref: "#/$defs/condition" } }, required: ["not"], additionalProperties: false },
        { type: "object", properties: { fact: string, equals: { $ref: "#/$defs/jsonValue" } }, required: ["fact"], additionalProperties: false },
        { type: "object", properties: { atLeast: { type: "integer", minimum: 1 },
            of: { type: "array", minItems: 1, items: { $ref: "#/$defs/condition" } } },
        required: ["atLeast", "of"], additionalProperties: false },
        { type: "object", properties: { constant: { type: "boolean" } }, required: ["constant"], additionalProperties: false }
    ] };
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema", $id: `${ONVIF_BASE}/schemas/requirements.schema.json`,
        title: "Shared authored profile requirement row contract", type: "object",
        properties: {
            profileEditions: { type: "array", items: { type: ["object", "string"] } },
            requirements: { type: "array", minItems: 1, items: {
                type: "object", properties: {
                    id: string, profile: string, edition: string, role: { enum: ["device", "client"] }, source,
                    requirementLevel: { enum: ["mandatory", "conditional", "optional"] }, feature: string,
                    condition: { $ref: "#/$defs/condition" },
                    classification: { enum: ["protocol", "schema", "capability", "behavior", "process", "notRepresentableTd"] },
                    native: { type: "array", items: { type: "object", properties: {
                        serviceNamespace: string, portType: string, operation: string, topic: string, topicNamespace: string,
                        typeQName: { oneOf: [qname, { type: "string", pattern: "^\\{[^}]*\\}.+$" }] }
                    }, required: ["serviceNamespace"], additionalProperties: true } },
                    mapping: { type: "object", properties: { kind: string, reason: string }, required: ["kind"], additionalProperties: true },
                    evidenceTargets: { ...stringList, minItems: 1 }, editorialDecisionIds: stringList,
                    obligationGroupId: string, obligationGroup: { type: "object" }
                },
                required: ["id", "profile", "edition", "role", "source", "requirementLevel", "feature", "condition",
                    "classification", "native", "mapping", "evidenceTargets", "editorialDecisionIds"], additionalProperties: true
            } },
            coverage: { type: "object" }
        }, required: ["requirements", "coverage"], additionalProperties: true,
        $defs: { qname: qnameDefinition, jsonValue, condition },
        $comment: "Group, fact, source-assertion and editorial extensions are retained and semantically linted by the indexer. No count or model link certifies a profile."
    };
}
