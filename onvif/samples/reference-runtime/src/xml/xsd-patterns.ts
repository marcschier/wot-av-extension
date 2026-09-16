import { OnvifError } from "../binding/errors.js";
import { isNCName, XML_NAME_CHAR, XML_NAME_START } from "./types.js";

// These are the four source patterns, not JavaScript regular expressions.
export const XSD_PATTERNS = Object.freeze({
    oid: "[0-9]+(.[0-9]+)*",
    passphrase: "[ -~]{8,63}",
    concreteTopic: "(([\\i-[:]][\\c-[:]]*:)?[\\i-[:]][\\c-[:]]*)(/([\\i-[:]][\\c-[:]]*:)?[\\i-[:]][\\c-[:]]*)*",
    fullTopic: "([\\i-[:]][\\c-[:]]*:)?(//)?([\\i-[:]][\\c-[:]]*|\\*)((/|//)(([\\i-[:]][\\c-[:]]*:)?[\\i-[:]][\\c-[:]]*|\\*|[.]))*(\\|([\\i-[:]][\\c-[:]]*:)?(//)?([\\i-[:]][\\c-[:]]*|\\*)((/|//)(([\\i-[:]][\\c-[:]]*:)?[\\i-[:]][\\c-[:]]*|\\*|[.]))*)*"
});
const known = new Set<string>(Object.values(XSD_PATTERNS));
const start = new RegExp(`^[${XML_NAME_START}]$`, "u");
const part = new RegExp(`^[${XML_NAME_CHAR}]$`, "u");

export function assertSupportedXsdPattern(pattern: string): void {
    if (!known.has(pattern)) {
        throw new OnvifError("UnsupportedCapability", `Unqualified XSD pattern: ${JSON.stringify(pattern)}`);
    }
}

function lexicalQName(value: string): boolean {
    const parts = value.split(":");
    return parts.length <= 2 && parts.every(isNCName);
}

function fullTopicPath(value: string): boolean {
    const characters = [...value];
    let cursor = 0;
    const name = (): boolean => {
        if (!start.test(characters[cursor] ?? "")) return false;
        cursor++;
        while (part.test(characters[cursor] ?? "")) cursor++;
        return true;
    };
    const prefix = (): void => {
        const before = cursor;
        if (!name() || characters[cursor] !== ":") cursor = before;
        else cursor++;
    };
    prefix();
    if (characters[cursor] === "/" && characters[cursor + 1] === "/") cursor += 2;
    if (characters[cursor] === "*") cursor++;
    else if (!name()) return false;
    while (cursor < characters.length) {
        if (characters[cursor++] !== "/") return false;
        if (characters[cursor] === "/") cursor++;
        if (characters[cursor] === "*" || characters[cursor] === ".") cursor++;
        else {
            prefix();
            if (!name()) return false;
        }
    }
    return true;
}

export function matchesXsdPattern(pattern: string, value: string): boolean {
    assertSupportedXsdPattern(pattern);
    if (value.length > 65536) throw new OnvifError("XmlLimit", "XSD pattern lexical bound exceeded");
    if (pattern === XSD_PATTERNS.passphrase) return /^[ -~]{8,63}$/u.test(value);
    if (pattern === XSD_PATTERNS.concreteTopic) return value.split("/").every(lexicalQName);
    if (pattern === XSD_PATTERNS.fullTopic) return value.split("|").every(fullTopicPath);
    // XSD '.' is any character except CR/LF, even here in the published OID pattern.
    // A finite-state recognizer avoids ambiguous digit/separator regex backtracking.
    let digit = false, separator = false;
    for (const character of value) {
        if (character === "\r" || character === "\n") return false;
        const numeric = character >= "0" && character <= "9";
        if (!digit && !separator && !numeric) return false;
        if (separator && !numeric) return false;
        separator = !numeric;
        digit = numeric;
    }
    return digit;
}
