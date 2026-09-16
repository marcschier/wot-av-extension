import { OnvifError, positiveInteger } from "../binding/errors.js";

export interface MediaQueueOptions {
    readonly maxBytes: number;
    readonly maxUnits: number;
    readonly maxSubscribers: number;
    readonly mode: "live" | "recorded";
    readonly onGap: (units: number) => void;
}
interface Entry<T> {
    readonly value: T;
    readonly bytes: number;
    readonly release: () => void;
}
interface Subscriber<T> {
    readonly entries: Entry<T>[];
    bytes: number;
    claimed: boolean;
    ended: boolean;
    pending: {
        resolve(value: IteratorResult<T>): void;
        reject(error: Error): void;
    } | undefined;
}

export class BoundedMediaQueue<T> implements AsyncIterable<T> {
    private readonly subscribers = new Set<Subscriber<T>>();
    private initial: Subscriber<T>;
    private ended = false;
    private draining = false;
    private failure: Error | undefined;
    private peak = 0;

    constructor(private readonly options: MediaQueueOptions) {
        positiveInteger(options.maxBytes, "queue bytes", 128 * 1024 * 1024);
        positiveInteger(options.maxUnits, "queue units", 256);
        positiveInteger(options.maxSubscribers, "queue subscribers", 16);
        if (options.mode !== "live" && options.mode !== "recorded" || typeof options.onGap !== "function") {
            throw new OnvifError("InvalidConfiguration", "Invalid media queue mode or gap observer");
        }
        this.initial = this.add();
    }

    get queuedBytes(): number { return [...this.subscribers].reduce((sum, slot) => sum + slot.bytes, 0); }
    get queuedUnits(): number { return [...this.subscribers].reduce((sum, slot) => sum + slot.entries.length, 0); }
    get peakBytesPerSubscriber(): number { return this.peak; }

    private add(): Subscriber<T> {
        if (this.subscribers.size >= this.options.maxSubscribers) {
            throw new OnvifError("InvalidValue", "Media subscriber capacity reached");
        }
        const slot: Subscriber<T> = { entries: [], bytes: 0, claimed: false, ended: this.ended || this.draining, pending: undefined };
        if (!slot.ended) this.subscribers.add(slot);
        return slot;
    }

    private removeEntry(slot: Subscriber<T>): Entry<T> | undefined {
        const entry = slot.entries.shift();
        if (entry !== undefined) slot.bytes -= entry.bytes;
        return entry;
    }

    publish(value: T, bytes: number, release: () => void = () => {}): void {
        positiveInteger(bytes, "media unit bytes", 128 * 1024 * 1024);
        let references = 1;
        const relinquish = (): void => { if (--references === 0) release(); };
        try {
            if (this.ended || this.draining) return;
            for (const slot of this.subscribers) {
                if (slot.pending !== undefined) {
                    const pending = slot.pending;
                    slot.pending = undefined;
                    pending.resolve({ value, done: false });
                    continue;
                }
                if (bytes > this.options.maxBytes) {
                    if (this.options.mode === "recorded") {
                        throw new OnvifError("InvalidValue", "Recorded media unit exceeds the consumer queue bound");
                    }
                    this.options.onGap(1);
                    continue;
                }
                let dropped = 0;
                while (slot.entries.length >= this.options.maxUnits || slot.bytes + bytes > this.options.maxBytes) {
                    if (this.options.mode === "recorded") {
                        throw new OnvifError("InvalidValue", "Recorded media exceeded its outstanding consumer credits");
                    }
                    const removed = this.removeEntry(slot);
                    if (removed === undefined) throw new OnvifError("InvalidValue", "Media queue accounting mismatch");
                    removed.release();
                    dropped++;
                }
                if (dropped) this.options.onGap(dropped);
                references++;
                slot.entries.push({ value, bytes, release: relinquish });
                slot.bytes += bytes;
                this.peak = Math.max(this.peak, slot.bytes);
            }
        } finally {
            relinquish();
        }
    }

    discard(): number {
        let discarded = 0;
        for (const slot of this.subscribers) {
            let entry: Entry<T> | undefined;
            while ((entry = this.removeEntry(slot)) !== undefined) {
                entry.release();
                discarded++;
            }
        }
        return discarded;
    }

    end(): void {
        if (this.ended || this.draining) return;
        this.draining = true;
        for (const slot of this.subscribers) if (!slot.entries.length) this.detach(slot);
    }

    resume(): void {
        if (this.ended) throw new OnvifError("RuntimeClosed", "Media queue is closed");
        if (!this.draining) return;
        for (const slot of this.subscribers) this.detach(slot);
        this.draining = false;
        this.initial = this.add();
    }

    finish(error?: Error): void {
        if (this.ended) return;
        this.ended = true;
        this.failure = error;
        this.discard();
        for (const slot of this.subscribers) this.detach(slot);
        this.subscribers.clear();
    }

    private detach(slot: Subscriber<T>): void {
        slot.ended = true;
        let entry: Entry<T> | undefined;
        while ((entry = this.removeEntry(slot)) !== undefined) entry.release();
        const pending = slot.pending;
        slot.pending = undefined;
        if (pending !== undefined) {
            if (this.failure !== undefined) pending.reject(this.failure);
            else pending.resolve({ value: undefined, done: true });
        }
        this.subscribers.delete(slot);
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        const slot = this.initial.claimed ? this.add() : this.initial;
        slot.claimed = true;
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (slot.ended || this.ended) return this.failure === undefined
                    ? Promise.resolve({ value: undefined, done: true }) : Promise.reject(this.failure);
                const entry = this.removeEntry(slot);
                if (entry !== undefined) {
                    entry.release();
                    return Promise.resolve({ value: entry.value, done: false });
                }
                if (this.draining) {
                    this.detach(slot);
                    return Promise.resolve({ value: undefined, done: true });
                }
                if (slot.pending !== undefined) {
                    return Promise.reject(new OnvifError("InvalidValue", "Only one pending read per media subscriber is permitted"));
                }
                return new Promise((resolve, reject) => { slot.pending = { resolve, reject }; });
            },
            return: (): Promise<IteratorResult<T>> => {
                this.detach(slot);
                return Promise.resolve({ value: undefined, done: true });
            },
            throw: (error?: unknown): Promise<IteratorResult<T>> => {
                this.detach(slot);
                return Promise.reject(error);
            },
            [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }
        };
    }
}
