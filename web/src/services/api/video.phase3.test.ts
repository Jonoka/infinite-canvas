import { afterEach, describe, expect, mock, test } from "bun:test";
import axios from "axios";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { createVideoGenerationTask, pollVideoGenerationTask } from "./video";

const originalPost = axios.post;
const originalGet = axios.get;

afterEach(() => {
    axios.post = originalPost;
    axios.get = originalGet;
});

function config(model: string, overrides: Partial<AiConfig> = {}, script?: string): AiConfig {
    const channel = {
        id: "video",
        name: "Video",
        baseUrl: "https://api.example.test/console/",
        apiKey: "",
        apiMode: "newapi" as const,
        apiFormat: "openai" as const,
        group: "video paid/专用",
        models: [{ name: model, capability: "video" as const, script }],
    };
    return {
        ...defaultConfig,
        ...channel,
        channels: [channel],
        model: `video::${model}`,
        videoModel: `video::${model}`,
        size: "16:9",
        vquality: "720p",
        videoSeconds: "6",
        ...overrides,
    };
}

function requestHeaders(value: unknown) {
    return new Headers((value as { headers?: HeadersInit }).headers);
}

describe("Phase 3 video protocol", () => {
    test("New API creates and polls OpenAI video tasks on canvas routes with group cookie auth only", async () => {
        const post = mock(async (..._args: unknown[]) => ({ data: { code: 0, data: { id: "video-task-1", status: "queued" } } }));
        const get = mock(async (..._args: unknown[]) => ({ data: { code: 0, data: { id: "video-task-1", status: "running" } } }));
        axios.post = post as typeof axios.post;
        axios.get = get as typeof axios.get;
        const cfg = config("grok-imagine-video");

        const task = await createVideoGenerationTask(cfg, "animate this");
        expect(await pollVideoGenerationTask(cfg, task)).toEqual({ status: "pending" });

        const [createUrl, , createOptions] = post.mock.calls[0];
        const [pollUrl, pollOptions] = get.mock.calls[0];
        expect(createUrl).toBe("https://api.example.test/canvas/v1/videos?group=video+paid%2F%E4%B8%93%E7%94%A8");
        expect(pollUrl).toBe("https://api.example.test/canvas/v1/videos/video-task-1?group=video+paid%2F%E4%B8%93%E7%94%A8");
        expect((createOptions as { withCredentials?: boolean }).withCredentials).toBe(true);
        expect((pollOptions as { withCredentials?: boolean }).withCredentials).toBe(true);
        expect(requestHeaders(createOptions).get("authorization")).toBeNull();
        expect(requestHeaders(pollOptions).get("authorization")).toBeNull();
    });

    test("Seedance preserves mixed-media reference order and emits first/last/component semantics as structure", async () => {
        const post = mock(async (..._args: unknown[]) => ({ data: { id: "seedance-task" } }));
        axios.post = post as typeof axios.post;
        const ordered = <T,>(value: T, order: number) => Object.assign(value, { order });
        const images = [
            ordered({ id: "last", name: "last.png", type: "image/png", dataUrl: "", url: "https://media.test/last.png", role: "last_frame" }, 4),
            ordered({ id: "first", name: "first.png", type: "image/png", dataUrl: "", url: "https://media.test/first.png", role: "first_frame" }, 0),
            ordered({ id: "actor", name: "actor.png", type: "image/png", dataUrl: "", url: "https://media.test/actor.png", role: "component", component: "actor" }, 2),
        ] as Array<ReferenceImage & { order: number; role: string; component?: string }>;
        const videos = [ordered({ id: "motion", name: "motion.mp4", type: "video/mp4", url: "https://media.test/motion.mp4", durationMs: 3000 }, 1)] as Array<ReferenceVideo & { order: number }>;
        const audios = [ordered({ id: "music", name: "music.mp3", type: "audio/mpeg", url: "https://media.test/music.mp3", durationMs: 3000 }, 3)] as Array<ReferenceAudio & { order: number }>;

        await createVideoGenerationTask(config("doubao-seedance-2.0"), "keep the sequence", images, videos, audios);

        const payload = post.mock.calls[0][1] as { content: Array<Record<string, unknown>> };
        expect(payload.content.slice(1)).toEqual([
            { type: "image_url", image_url: { url: "https://media.test/first.png" }, role: "first_frame" },
            { type: "video_url", video_url: { url: "https://media.test/motion.mp4" }, role: "reference_video" },
            { type: "image_url", image_url: { url: "https://media.test/actor.png" }, role: "component", component: "actor" },
            { type: "audio_url", audio_url: { url: "https://media.test/music.mp3" }, role: "reference_audio" },
            { type: "image_url", image_url: { url: "https://media.test/last.png" }, role: "last_frame" },
        ]);
    });

    test("video plugins receive image/video/audio references and accept the first valid URL from multi-result output", async () => {
        const script = `
if (images.length !== 0 || videos[0].url !== "https://media.test/ref.mp4" || audios[0].url !== "https://media.test/ref.mp3") {
  throw new Error("video references were not passed through");
}
return [{ status: "pending", url: "https://media.test/tasks/plugin-task" }, "", { video_url: "https://media.test/generated.mp4" }];`;
        const videos: ReferenceVideo[] = [{ id: "video", name: "ref.mp4", type: "video/mp4", url: "https://media.test/ref.mp4", durationMs: 3000 }];
        const audios: ReferenceAudio[] = [{ id: "audio", name: "ref.mp3", type: "audio/mpeg", url: "https://media.test/ref.mp3", durationMs: 3000 }];
        const cfg = config("custom-video", {}, script);

        const task = await createVideoGenerationTask(cfg, "plugin prompt", [], videos, audios);
        expect(await pollVideoGenerationTask(cfg, task)).toEqual({
            status: "completed",
            result: { url: "https://media.test/generated.mp4", mimeType: "video/mp4" },
        });
    });
});
