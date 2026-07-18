import { describe, expect, test } from "bun:test";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { createVideoGenerationTask, pollVideoGenerationTask, type VideoGenerationTask } from "./video";

type DiscardPluginVideoTask = (task: VideoGenerationTask) => void;

function pluginConfig(): AiConfig {
    const model = "cleanup-plugin";
    const channel = {
        id: "cleanup",
        name: "Cleanup",
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        apiMode: "openai" as const,
        apiFormat: "openai" as const,
        group: "",
        models: [{ name: model, capability: "video" as const, script: 'return { url: "https://media.test/result.mp4" };' }],
    };
    return { ...defaultConfig, ...channel, channels: [channel], model: `cleanup::${model}`, videoModel: `cleanup::${model}` };
}

describe("plugin video task cleanup", () => {
    test.each(["abort", "failure"] as const)("removes the retained plugin result when its consumer exits by %s", async () => {
        const production = (await import("./video")) as Record<string, unknown>;
        const discardPluginVideoTask = production.discardPluginVideoTask as DiscardPluginVideoTask | undefined;
        expect(typeof discardPluginVideoTask).toBe("function");

        const config = pluginConfig();
        const task = await createVideoGenerationTask(config, "prompt");
        discardPluginVideoTask!(task);

        expect(await pollVideoGenerationTask(config, task)).toEqual({
            status: "failed",
            error: "插件视频任务已失效，请重新生成",
        });
    });

    test("requestVideoGeneration wires cleanup for every non-completed exit", async () => {
        const source = await Bun.file(new URL("./video.ts", import.meta.url)).text();
        const start = source.indexOf("export async function requestVideoGeneration");
        const end = source.indexOf("export async function createVideoGenerationTask", start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const requestFlow = source.slice(start, end);

        expect(requestFlow).toContain("finally");
        expect(requestFlow).toContain("discardPluginVideoTask(task)");
    });
});
