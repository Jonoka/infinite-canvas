export type VideoReferenceKind = "image" | "video" | "audio";
export type VideoReferenceRole = "first_frame" | "last_frame" | "reference_video" | "reference_audio" | "component" | (string & {});
export type VideoReference = { kind: VideoReferenceKind; url: string; role?: VideoReferenceRole; component?: string; [key: string]: unknown };

export function normalizeVideoReferences<T extends VideoReference>(references: T[]): T[] {
    const clone = (value: unknown): unknown => {
        if (typeof structuredClone === "function") return structuredClone(value);
        if (Array.isArray(value)) return value.map(clone);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
        return value;
    };
    return clone(references) as T[];
}
