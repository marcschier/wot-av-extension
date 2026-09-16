import { invalidValue, isRecord, OnvifError } from "../binding/errors.js";
import {
    isNCName, isQName, resolveQName, type CanonicalValue, type QName,
    XML_NAME_CHAR, XML_NAME_START, type ScalarType, type SimpleType, type XmlElement
} from "./types.js";
import { matchesXsdPattern } from "./xsd-patterns.js";

const xmlName = new RegExp(`^[:${XML_NAME_START}][:${XML_NAME_CHAR}]*$`, "u");
const xmlToken = new RegExp(`^[:${XML_NAME_CHAR}]+$`, "u");

export function qnameText(value: QName, node: XmlElement): string {
    if (value.namespace === "") {
        node.namespaces[""] = "";
        return value.localName;
    }
    let prefix = Object.keys(node.namespaces).find((key) => key !== "" && node.namespaces[key] === value.namespace);
    if (prefix === undefined) {
        let index = 0;
        while (Object.hasOwn(node.namespaces, `q${index}`)) index++;
        prefix = `q${index}`;
        Object.defineProperty(node.namespaces, prefix, { value: value.namespace, enumerable: true, writable: true });
    }
    return `${prefix}:${value.localName}`;
}

function validDateTime(value: string): boolean {
    const match = /^(-?[0-9]{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/u.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
    if (yearText === undefined || yearText.length > 4096) return false;
    const year = BigInt(yearText);
    if (year === 0n || (yearText.replace("-", "").length > 4 && yearText.replace("-", "").startsWith("0"))) return false;
    const month = Number(monthText), day = Number(dayText), hour = Number(hourText);
    const minute = Number(minuteText), second = Number(secondText);
    const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)
        || hour > 24 || minute > 59 || second > 59) return false;
    if (hour === 24 && (minute !== 0 || second !== 0 || (fraction !== undefined && /[1-9]/u.test(fraction)))) return false;
    if (zone !== undefined && zone !== "Z") {
        const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
        if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
    }
    return true;
}

function validTemporal(type: string, text: string): boolean {
    const zone = "(Z|[+-]\\d{2}:\\d{2})?";
    const match = new RegExp(`^(.+?)${zone}$`, "u").exec(text);
    const value = match?.[1], suffix = match?.[2] ?? "";
    if (value === undefined) return false;
    switch (type) {
        case "date": return validDateTime(`${value}T00:00:00${suffix}`);
        case "time": return validDateTime(`2000-01-01T${value}${suffix}`);
        case "gYearMonth": return validDateTime(`${value}-01T00:00:00${suffix}`);
        case "gYear": return validDateTime(`${value}-01-01T00:00:00${suffix}`);
        case "gMonthDay": return /^--\d{2}-\d{2}$/u.test(value) && validDateTime(`2000${value.slice(1)}T00:00:00${suffix}`);
        case "gDay": return /^---\d{2}$/u.test(value) && validDateTime(`2000-01-${value.slice(3)}T00:00:00${suffix}`);
        case "gMonth": return /^--\d{2}(?:--)?$/u.test(value) && validDateTime(`2000-${value.slice(2, 4)}-01T00:00:00${suffix}`);
        default: return false;
    }
}

function decodeScalar(type: ScalarType, input: string, node: XmlElement): CanonicalValue {
    const replaced = input.replace(/[\t\r\n]/gu, " ");
    const text = ["string", "normalizedString"].includes(type.type)
        ? type.type === "string" ? input : replaced : replaced.trim().replace(/ +/gu, " ");
    switch (type.type) {
        case "string": case "normalizedString": case "token": case "anyURI": return text;
        case "language":
            if (!/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(text)) invalidValue("Invalid XSD language");
            return text;
        case "NCName": case "ID":
            if (!isNCName(text)) invalidValue("Invalid XSD NCName");
            return text;
        case "Name":
            if (!xmlName.test(text)) invalidValue("Invalid XSD Name");
            return text;
        case "NMTOKEN":
            if (!xmlToken.test(text)) invalidValue("Invalid XSD NMTOKEN");
            return text;
        case "QName": return resolveQName(text, node.namespaces);
        case "boolean":
            if (text === "true" || text === "1") return true;
            if (text === "false" || text === "0") return false;
            return invalidValue("Invalid XSD boolean");
        case "int32": case "uint32": case "int64": case "uint64": case "integer": {
            if (!/^[+-]?\d+$/u.test(text)) invalidValue("Invalid XSD integer lexical value");
            if (text.length > 4096) throw new OnvifError("XmlLimit", "Integer lexical bound exceeded");
            if (type.type === "integer") return text;
            const integer = BigInt(text);
            const [min, max] = type.type === "int32" ? [-2147483648n, 2147483647n]
                : type.type === "uint32" ? [0n, 4294967295n]
                    : type.type === "int64" ? [-9223372036854775808n, 9223372036854775807n]
                        : [0n, 18446744073709551615n];
            if (min === undefined || max === undefined || integer < min || integer > max) invalidValue("XSD integer out of range");
            return type.type === "int32" || type.type === "uint32" ? Number(integer) : text;
        }
        case "decimal":
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text)) invalidValue("Invalid XSD decimal lexical value");
            return text;
        case "float": case "double":
            if (!/^(?:-?INF|NaN|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/u.test(text)) {
                invalidValue("Invalid XSD floating-point lexical value");
            }
            return text;
        case "dateTime":
            if (!validDateTime(text)) invalidValue("Invalid XSD dateTime lexical value");
            return text;
        case "date": case "time": case "gYearMonth": case "gYear": case "gMonthDay": case "gDay": case "gMonth":
            if (!validTemporal(type.type, text)) invalidValue(`Invalid XSD ${type.type} lexical value`);
            return text;
        case "duration":
            if (!/^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u.test(text)) {
                invalidValue("Invalid XSD duration lexical value");
            }
            return text;
        case "hexBinary":
            if (!/^(?:[a-fA-F0-9]{2})*$/u.test(text)) invalidValue("Invalid hexBinary octets");
            return text;
        case "base64Binary": {
            const collapsed = text.replace(/[\t\r\n ]/gu, "");
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(collapsed)
                || Buffer.from(collapsed, "base64").toString("base64") !== collapsed) invalidValue("Invalid base64Binary octets");
            return collapsed;
        }
    }
}

function encodeScalar(type: ScalarType, value: unknown, node: XmlElement): string {
    if (type.type === "QName") {
        if (!isQName(value)) invalidValue("A QName must use namespace and localName");
        return qnameText(value, node);
    }
    if (type.type === "boolean") {
        if (typeof value !== "boolean") invalidValue("A boolean must not be coerced");
        return String(value);
    }
    if (type.type === "int32" || type.type === "uint32") {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) invalidValue("A bounded integer must be an exact number");
    } else if (typeof value !== "string") invalidValue("Lexically significant XSD values must be strings");
    const text = String(value);
    const decoded = decodeScalar(type, text, node);
    if (typeof value === "string" && typeof decoded === "string" && decoded !== value
        && !["base64Binary"].includes(type.type)) {
        invalidValue("Canonical whitespace must already obey the declared XSD whiteSpace rule");
    }
    return text;
}

function scalarBase(type: SimpleType): ScalarType | undefined {
    return type.kind === "restriction" ? scalarBase(type.base) : type.kind === "scalar" ? type : undefined;
}

function decimalParts(text: string): { integer: bigint; scale: number } {
    if (text.length > 4096 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text)) {
        invalidValue("Unsupported or excessive decimal facet comparison");
    }
    const parts = text.split(".");
    return { integer: BigInt(`${parts[0] || "0"}${parts[1] ?? ""}`), scale: parts[1]?.length ?? 0 };
}

function compareDecimal(left: string, right: string): number {
    const a = decimalParts(left), b = decimalParts(right);
    const scale = Math.max(a.scale, b.scale);
    const x = a.integer * 10n ** BigInt(scale - a.scale);
    const y = b.integer * 10n ** BigInt(scale - b.scale);
    return x < y ? -1 : x > y ? 1 : 0;
}

function equivalent(type: SimpleType, left: CanonicalValue, right: CanonicalValue): boolean {
    if (type.kind === "restriction") return equivalent(type.base, left, right);
    if (type.kind === "list") return Array.isArray(left) && Array.isArray(right) && left.length === right.length
        && left.every((value, index) => equivalent(type.item, value, right[index] ?? null));
    if (type.kind === "union") {
        if (!isRecord(left) || !isRecord(right)) return false;
        const member = type.members.find((entry) => entry.name === left.$member);
        return left.$member === right.$member && member !== undefined
            && equivalent(member.type, left.$value as CanonicalValue, right.$value as CanonicalValue);
    }
    if (["int32", "uint32", "int64", "uint64", "integer", "decimal"].includes(type.type)) {
        return compareDecimal(String(left), String(right)) === 0;
    }
    if (["float", "double"].includes(type.type)) {
        if (left === right) return true;
        return Number(String(left)) === Number(String(right));
    }
    if (type.type === "hexBinary") return String(left).toLowerCase() === String(right).toLowerCase();
    if (type.type === "QName") return isQName(left) && isQName(right)
        && left.namespace === right.namespace && left.localName === right.localName;
    return JSON.stringify(left) === JSON.stringify(right);
}

export function identityValueKey(type: SimpleType, value: CanonicalValue): string {
    if (type.kind === "restriction") return identityValueKey(type.base, value);
    if (type.kind === "union") {
        if (!isRecord(value)) invalidValue("Invalid identity union value");
        const member = type.members.find((entry) => entry.name === value.$member);
        if (member === undefined) invalidValue("Invalid identity union member");
        return identityValueKey(member.type, value.$value as CanonicalValue);
    }
    if (type.kind === "list") {
        if (!Array.isArray(value)) invalidValue("Invalid identity list value");
        return `list:${JSON.stringify(value.map((item) => identityValueKey(type.item, item)))}`;
    }
    if (["int32", "uint32", "int64", "uint64", "integer", "decimal"].includes(type.type)) {
        let { integer, scale } = decimalParts(String(value));
        while (scale > 0 && integer % 10n === 0n) { integer /= 10n; scale--; }
        return `decimal:${integer}:${integer === 0n ? 0 : scale}`;
    }
    if (type.type === "QName") {
        if (!isQName(value)) invalidValue("Invalid identity QName");
        return `QName:${JSON.stringify([value.namespace, value.localName])}`;
    }
    if (type.type === "hexBinary") return `binary:${String(value).toLowerCase()}`;
    if (type.type === "base64Binary") return `binary:${Buffer.from(String(value), "base64").toString("hex")}`;
    if (["float", "double", "dateTime", "date", "time", "duration", "gYearMonth", "gYear", "gMonthDay", "gDay", "gMonth"].includes(type.type)) {
        throw new OnvifError("UnsupportedCapability", `xs:unique ${type.type} value-space comparison is not qualified`);
    }
    return `${type.type === "boolean" ? "boolean" : "string"}:${JSON.stringify(value)}`;
}

function whitespace(type: SimpleType): "preserve" | "replace" | "collapse" {
    if (type.kind === "restriction") return type.facets.whiteSpace ?? whitespace(type.base);
    if (type.kind !== "scalar") return "collapse";
    return type.type === "string" ? "preserve" : type.type === "normalizedString" ? "replace" : "collapse";
}

export function decodeSimple(type: SimpleType, input: string, node: XmlElement): CanonicalValue {
    if (type.kind === "scalar") return decodeScalar(type, input, node);
    if (type.kind === "list") {
        return input.trim() === "" ? [] : input.trim().split(/[\t\r\n ]+/u).map((item) => decodeSimple(type.item, item, node));
    }
    if (type.kind === "restriction") {
        let text = input;
        const space = whitespace(type);
        if (space !== "preserve") text = text.replace(/[\t\r\n]/gu, " ");
        if (space === "collapse") text = text.trim().replace(/ +/gu, " ");
        if (type.facets.patterns !== undefined && !type.facets.patterns.some((pattern) => matchesXsdPattern(pattern, text))) {
            invalidValue("Value violates the native XSD pattern facet");
        }
        const value = decodeSimple(type.base, text, node);
        if (type.facets.enumeration !== undefined && !type.facets.enumeration.some((item) =>
            equivalent(type.base, value, decodeSimple(type.base, item.lexical,
                { ...node, namespaces: { ...node.namespaces, ...item.namespaces } })))) {
            invalidValue("Value is outside the declared XSD enumeration");
        }
        const scalar = scalarBase(type.base);
        const length = Array.isArray(value) ? value.length
            : typeof value === "string" ? scalar?.type === "hexBinary" ? value.length / 2
                : scalar?.type === "base64Binary" ? Buffer.from(value, "base64").length : [...value].length : undefined;
        if ((type.facets.length !== undefined && length !== type.facets.length)
            || (type.facets.minLength !== undefined && (length === undefined || length < type.facets.minLength))
            || (type.facets.maxLength !== undefined && (length === undefined || length > type.facets.maxLength))) {
            invalidValue("Value violates an XSD length facet");
        }
        for (const [bound, relation] of [["minInclusive", 0], ["maxInclusive", 0], ["minExclusive", 1], ["maxExclusive", 1]] as const) {
            const limit = type.facets[bound];
            if (limit === undefined) continue;
            const comparison = compareDecimal(String(value), limit);
            if (bound.startsWith("min") ? comparison < relation : comparison > -relation) {
                invalidValue("Value violates an XSD numeric bound");
            }
        }
        return value;
    }
    for (const member of type.members) {
        try {
            return { $member: member.name, $value: decodeSimple(member.type, input, node) };
        } catch (error) {
            if (!(error instanceof OnvifError) || error.code !== "InvalidValue") throw error;
        }
    }
    return invalidValue("No declared XSD union member accepts this value");
}

export function encodeSimple(type: SimpleType, value: unknown, node: XmlElement): string {
    if (type.kind === "scalar") return encodeScalar(type, value, node);
    if (type.kind === "restriction") {
        const text = encodeSimple(type.base, value, node);
        decodeSimple(type, text, node);
        return text;
    }
    if (type.kind === "list") {
        if (!Array.isArray(value)) invalidValue("An XSD list must be an array");
        return value.map((item: unknown) => {
            const text = encodeSimple(type.item, item, node);
            if (text === "" || /[\t\r\n ]/u.test(text)) invalidValue("List item cannot contain list separators");
            return text;
        }).join(" ");
    }
    if (!isRecord(value) || Object.keys(value).some((key) => !["$member", "$value"].includes(key))) {
        invalidValue("A union must select its named member");
    }
    const member = type.members.find((entry) => entry.name === value.$member);
    if (member === undefined) invalidValue("Unknown XSD union member");
    const text = encodeSimple(member.type, value.$value, node);
    const decoded = decodeSimple(type, text, node);
    if (!isRecord(decoded) || decoded.$member !== member.name) {
        invalidValue("The selected union member would change under XSD first-match semantics");
    }
    return text;
}
