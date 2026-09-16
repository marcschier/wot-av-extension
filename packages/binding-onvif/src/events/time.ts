import { OnvifError } from "../binding/errors.js";
import { decodeSimple } from "../xml/simple-values.js";

export interface EventClock {
    now(): number;
    sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export function eventClock(now: () => number = Date.now): EventClock {
    return { now, sleep: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) {
            reject(new OnvifError("InvalidConfiguration", "Event wait is outside its finite bound"));
            return;
        }
        const done = (): void => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(); };
        const abort = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            reject(new OnvifError("RuntimeClosed", "Event wait cancelled"));
        };
        const timer = setTimeout(done, milliseconds);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
    }) };
}

export function fixedDurationMilliseconds(value: string): number {
    const match = typeof value === "string"
        ? /^P(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u.exec(value) : null;
    if (!match || !match.slice(1).some((part) => part !== undefined)) {
        throw new OnvifError("InvalidValue", "A bounded PullPoint timeout requires a nonnegative day/time duration, not calendar months");
    }
    const milliseconds = (Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
        + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)) * 1000;
    if (!Number.isFinite(milliseconds) || milliseconds > 2147483647) throw new OnvifError("XmlLimit", "Native duration exceeds the scheduler bound");
    return milliseconds;
}

export function duration(milliseconds: number): string {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) {
        throw new OnvifError("InvalidValue", "Native timeout must be a bounded nonnegative integer millisecond interval");
    }
    return `PT${milliseconds / 1000}S`;
}

export function instantMilliseconds(value: string): number {
    decodeSimple({ kind: "scalar", type: "dateTime" }, value, {
        kind: "element", name: { namespace: "", localName: "Time" }, namespaces: {}, attributes: [], children: []
    });
    const match = /^(-?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
    if (!match) throw new OnvifError("UnsupportedCapability", "Lease scheduling requires an explicit native timezone; the codec still preserves timezone absence");
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), Number((match[7] ?? "").padEnd(3, "0").slice(0, 3)));
    const zone = match[8] ?? "Z";
    const offset = zone === "Z" ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
        * 60000 * (zone[0] === "-" ? -1 : 1);
    const result = date.getTime() - offset;
    if (!Number.isSafeInteger(result)) throw new OnvifError("XmlLimit", "Native lease time is outside the scheduler's finite instant range");
    return result;
}
