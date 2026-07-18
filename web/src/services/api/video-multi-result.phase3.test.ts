import { describe, expect, test } from "bun:test";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { createVideoGenerationTask, pollVideoGenerationTask } from "./video";

function config(script: string): AiConfig {
    const channel = {
        id: "video",
        name: "Video",
        baseUrl: "https://api.example.test/console/",
        apiKey: "",
        apiMode: "newapi" as const,
        apiFormat: "openai" as const,
        group: "video paid/专用",
        models: [{ name: "custom-video", capability: "video" as const, script }],
    };
    return {
        ...defaultConfig,
        ...channel,
        channels: [channel],
        model: "video::custom-video",
        videoModel: "video::custom-video",
        size: "16:9",
        vquality: "720p",
        videoSeconds: "6",
    };
}

describe("Phase 3 video multi-result preservation", () => {
    test("preserves every valid URL from a plugin result in response order while retaining the primary URL", async () => {
        const script = `
return [
  { url: "https://media.test/first.mp4" },
  "https://media.test/second.mp4",
  { video_url: "https://media.test/third.mp4" },
];`;
        const task = await createVideoGenerationTask(config(script), "make three variants");
        const state = await pollVideoGenerationTask(config(script), task);

        expect(state).toEqual({
            status: "completed",
            result: {
                url: "https://media.test/first.mp4",
                urls: [
                    "https://media.test/first.mp4",
                    "https://media.test/second.mp4",
                    "https://media.test/third.mp4",
                ],
                mimeType: "video/mp4",
            },
        });
    });
});
