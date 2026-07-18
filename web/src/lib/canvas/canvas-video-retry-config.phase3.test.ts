import { describe, expect, test } from "bun:test";

type BuildRetryPlan = (input: {
    currentConfig: Record<string, unknown>;
    metadata: { prompt: string; model: string; size: string; seconds: string; vquality: string; generateAudio: string; watermark: string; videoReferences: [] };
}) => { config: Record<string, unknown> };

describe("Canvas video retry saved configuration", () => {
    test("restores every saved video option but retains the currently configured auth provenance", async () => {
        const production = (await import("./canvas-generation-helpers")) as Record<string, unknown>;
        const build = production.buildCanvasVideoRetryPlan as BuildRetryPlan | undefined;
        expect(typeof build).toBe("function");

        const { config } = build!({
            currentConfig: {
                model: "current-model",
                videoModel: "current-video-model",
                size: "1:1",
                videoSeconds: "3",
                vquality: "480p",
                videoGenerateAudio: "false",
                videoWatermark: "true",
                channelId: "current-channel",
                baseUrl: "https://current-auth.test/api",
                apiKey: "current-secret",
                group: "current-group",
            },
            metadata: {
                prompt: "saved prompt",
                model: "saved-video-model",
                size: "16:9",
                seconds: "10",
                vquality: "1080p",
                generateAudio: "true",
                watermark: "false",
                videoReferences: [],
            },
        });

        expect(config).toMatchObject({
            model: "saved-video-model",
            videoModel: "saved-video-model",
            size: "16:9",
            videoSeconds: "10",
            vquality: "1080p",
            videoGenerateAudio: "true",
            videoWatermark: "false",
            channelId: "current-channel",
            baseUrl: "https://current-auth.test/api",
            apiKey: "current-secret",
            group: "current-group",
        });
    });
});
