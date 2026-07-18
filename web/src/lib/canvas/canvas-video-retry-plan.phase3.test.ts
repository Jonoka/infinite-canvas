import { describe, expect, test } from "bun:test";

type SavedVideoReference = {
    kind: "image" | "video" | "audio";
    url: string;
    role?: string;
    component?: string;
};

type CanvasVideoRetryPlan = {
    prompt: string;
    config: Record<string, unknown>;
    references: Array<{ dataUrl: string; storageKey?: string; role?: string; component?: string; order: number }>;
    videoReferences: Array<{ url: string; storageKey?: string; role?: string; component?: string; order: number }>;
    audioReferences: Array<{ url: string; storageKey?: string; role?: string; component?: string; order: number }>;
};

type BuildCanvasVideoRetryPlan = (input: {
    currentConfig: Record<string, unknown>;
    metadata: {
        prompt: string;
        model: string;
        size: string;
        seconds: string;
        vquality: string;
        generateAudio: string;
        watermark: string;
        videoReferences: SavedVideoReference[];
    };
}) => CanvasVideoRetryPlan;

describe("Canvas frozen video retry plan", () => {
    test("replays saved config and every mixed image/video/audio reference in original order", async () => {
        const production = (await import("./canvas-generation-helpers")) as Record<string, unknown>;
        const buildCanvasVideoRetryPlan = production.buildCanvasVideoRetryPlan as BuildCanvasVideoRetryPlan | undefined;
        expect(typeof buildCanvasVideoRetryPlan).toBe("function");

        const plan = buildCanvasVideoRetryPlan!({
            currentConfig: {
                model: "current-model",
                size: "1:1",
                videoSeconds: "3",
                vquality: "current-quality",
                videoGenerateAudio: "false",
                videoWatermark: "true",
                apiKey: "current-credential",
            },
            metadata: {
                prompt: "saved prompt",
                model: "saved-model",
                size: "16:9",
                seconds: "10",
                vquality: "1080p",
                generateAudio: "true",
                watermark: "false",
                videoReferences: [
                    { kind: "image", url: "image:first", role: "first_frame" },
                    { kind: "video", url: "video:motion", role: "reference_video" },
                    { kind: "image", url: "https://media.test/actor.png", role: "component", component: "actor" },
                    { kind: "audio", url: "audio:music", role: "reference_audio" },
                    { kind: "image", url: "image:last", role: "last_frame" },
                ],
            },
        });

        expect(plan).toEqual({
            prompt: "saved prompt",
            config: {
                model: "saved-model",
                videoModel: "saved-model",
                size: "16:9",
                videoSeconds: "10",
                vquality: "1080p",
                videoGenerateAudio: "true",
                videoWatermark: "false",
                apiKey: "current-credential",
            },
            references: [
                { dataUrl: "image:first", storageKey: "image:first", role: "first_frame", order: 0 },
                { dataUrl: "https://media.test/actor.png", role: "component", component: "actor", order: 2 },
                { dataUrl: "image:last", storageKey: "image:last", role: "last_frame", order: 4 },
            ],
            videoReferences: [{ url: "video:motion", storageKey: "video:motion", role: "reference_video", order: 1 }],
            audioReferences: [{ url: "audio:music", storageKey: "audio:music", role: "reference_audio", order: 3 }],
        });
    });
});
