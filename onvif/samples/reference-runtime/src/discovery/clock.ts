import type { Clock, TimerHandle } from "./types.js";

export class NodeClock implements Clock {
    now(): number { return Date.now(); }
    setTimeout(callback: () => void, delayMs: number): TimerHandle { return setTimeout(callback, delayMs); }
    clearTimeout(handle: TimerHandle): void { clearTimeout(handle as NodeJS.Timeout); }
}

export class FixtureClock implements Clock {
    private time: number;
    private readonly pending = new Map<TimerHandle, { at: number; callback: () => void }>();
    constructor(now = 0) { this.time = now; }
    now(): number { return this.time; }
    get pendingTimers(): number { return this.pending.size; }
    setTimeout(callback: () => void, delayMs: number): TimerHandle {
        const handle = {};
        this.pending.set(handle, { at: this.time + delayMs, callback });
        return handle;
    }
    clearTimeout(handle: TimerHandle): void { this.pending.delete(handle); }
    async advance(ms: number): Promise<void> {
        const end = this.time + ms;
        if (!Number.isFinite(ms) || ms < 0) throw new RangeError("Fixture time must advance by a finite nonnegative duration");
        let count = 0;
        for (;;) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            const next = [...this.pending].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            if (++count > 100000) throw new RangeError("Fixture timer advancement exceeded its bound");
            this.time = next[1].at;
            this.pending.delete(next[0]);
            next[1].callback();
        }
        this.time = end;
        await Promise.resolve();
    }
}

export function sleep(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const abort = (): void => {
            clock.clearTimeout(handle);
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
        };
        const handle = clock.setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
    });
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => {
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void work.then((value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
        }, (error: unknown) => {
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}

export async function withDeadline<T>(clock: Clock, work: Promise<T>, milliseconds: number, error: Error): Promise<T> {
    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(error), milliseconds);
    try { return await abortable(work, controller.signal); }
    finally { clock.clearTimeout(timer); }
}
