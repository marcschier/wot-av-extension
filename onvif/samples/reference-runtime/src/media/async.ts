import { OnvifError, type ExecutionCertainty } from "../binding/errors.js";

export class Deferred<T> {
    readonly promise: Promise<T>;
    private resolveValue!: (value: T) => void;
    private rejectValue!: (error: Error) => void;
    private settled = false;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => { this.resolveValue = resolve; this.rejectValue = reject; });
    }
    resolve(value: T): void {
        if (this.settled) return;
        this.settled = true;
        this.resolveValue(value);
    }
    reject(error: Error): void {
        if (this.settled) return;
        this.settled = true;
        this.rejectValue(error);
    }
}

export function mediaError(error: unknown, message: string, execution: ExecutionCertainty = "unknown"): OnvifError {
    return error instanceof OnvifError ? error : new OnvifError("TransportError", message, execution);
}
export function mediaAborted(execution: ExecutionCertainty = "not-sent"): OnvifError {
    return new OnvifError("TransportError", "Media operation was aborted", execution);
}
export function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(mediaAborted());
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => { reject(mediaAborted()); };
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => {
            if (signal.aborted) throw mediaAborted();
            return work();
        }).then((result) => {
            signal.removeEventListener("abort", abort);
            resolve(result);
        }, (error: unknown) => {
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}
