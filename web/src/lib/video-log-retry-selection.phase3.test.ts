import { describe, expect, test } from "bun:test";

type RetrySnapshot = {
    text: string;
    config: Record<string, unknown>;
    references: Array<{ id: string; dataUrl: string }>;
    videoReferences: Array<{ id: string; url: string }>;
    audioReferences: Array<{ id: string; url: string }>;
};

type SelectVideoLogRetrySnapshot = (log: {
    prompt: string;
    config: Record<string, unknown>;
    references?: RetrySnapshot["references"];
    videoReferences?: RetrySnapshot["videoReferences"];
    audioReferences?: RetrySnapshot["audioReferences"];
}) => RetrySnapshot;

describe("historical video log retry selection", () => {
    test("builds retry input from the selected historical log, not the unrelated latest request", async () => {
        const production = (await import("./video-retry-snapshot")) as Record<string, unknown>;
        const selectVideoLogRetrySnapshot = production.selectVideoLogRetrySnapshot as SelectVideoLogRetrySnapshot | undefined;
        expect(typeof selectVideoLogRetrySnapshot).toBe("function");

        const unrelatedLatest: RetrySnapshot = {
            text: "latest prompt",
            config: { model: "latest-model", size: "1:1" },
            references: [{ id: "latest-image", dataUrl: "image:latest" }],
            videoReferences: [{ id: "latest-video", url: "video:latest" }],
            audioReferences: [{ id: "latest-audio", url: "audio:latest" }],
        };
        const selectedLog = {
            prompt: "historical prompt",
            config: { model: "historical-model", size: "16:9", videoSeconds: "10" },
            references: [{ id: "history-image", dataUrl: "image:history" }],
            videoReferences: [{ id: "history-video", url: "video:history" }],
            audioReferences: [{ id: "history-audio", url: "audio:history" }],
        };

        const selected = selectVideoLogRetrySnapshot!(selectedLog);
        unrelatedLatest.config.model = "mutated-latest-model";
        selectedLog.references[0].dataUrl = "image:mutated-history";

        expect(selected).toEqual({
            text: "historical prompt",
            config: { model: "historical-model", size: "16:9", videoSeconds: "10" },
            references: [{ id: "history-image", dataUrl: "image:history" }],
            videoReferences: [{ id: "history-video", url: "video:history" }],
            audioReferences: [{ id: "history-audio", url: "audio:history" }],
        });
        expect(selected).not.toEqual(unrelatedLatest);
    });
});
