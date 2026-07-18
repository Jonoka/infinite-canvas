export type VideoRetrySnapshot<TPrompt = string, TConfig = Record<string, unknown>, TReference = unknown> = {
    prompt: TPrompt;
    config: TConfig;
    references: TReference[];
    videoReferences: TReference[];
    audioReferences: TReference[];
};

export function freezeVideoRetrySnapshot<T extends { prompt: unknown; config: unknown; references?: unknown[]; videoReferences?: unknown[]; audioReferences?: unknown[] }>(input: T): T {
    const clone = (value: unknown): unknown => {
        if (typeof structuredClone === "function") return structuredClone(value);
        if (Array.isArray(value)) return value.map(clone);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
        return value;
    };
    return clone({ ...input, references: input.references || [], videoReferences: input.videoReferences || [], audioReferences: input.audioReferences || [] }) as T;
}
