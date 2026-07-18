export type VideoRetrySnapshot<TPrompt = string, TConfig = Record<string, unknown>, TReference = unknown> = {
    prompt: TPrompt;
    config: TConfig;
    references: TReference[];
    videoReferences: TReference[];
    audioReferences: TReference[];
};

export function freezeVideoRetrySnapshot<T extends { config: unknown; references?: unknown[]; videoReferences?: unknown[]; audioReferences?: unknown[] } & ({ prompt: unknown } | { text: unknown })>(input: T): T {
    const clone = (value: unknown): unknown => {
        if (typeof structuredClone === "function") return structuredClone(value);
        if (Array.isArray(value)) return value.map(clone);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
        return value;
    };
    return clone({ ...input, references: input.references || [], videoReferences: input.videoReferences || [], audioReferences: input.audioReferences || [] }) as T;
}

export function selectVideoLogRetrySnapshot(log: { prompt: string; config: Record<string, unknown>; references?: unknown[]; videoReferences?: unknown[]; audioReferences?: unknown[] }) {
    return freezeVideoRetrySnapshot({ text: log.prompt, config: log.config, references: log.references || [], videoReferences: log.videoReferences || [], audioReferences: log.audioReferences || [] });
}
