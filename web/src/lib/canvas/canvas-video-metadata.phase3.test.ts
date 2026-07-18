import { describe, expect, test } from "bun:test";

import { videoMetadata } from "./canvas-node-factory";

describe("Canvas video metadata", () => {
    test("preserves all provider result URLs on the node metadata", () => {
        const video = {
            id: "stored-video",
            url: "blob:https://app.test/stored-video",
            urls: ["https://media.test/primary.mp4", "https://media.test/alternate.mp4"],
            storageKey: "video:stored-video",
            width: 1280,
            height: 720,
            bytes: 42,
            mimeType: "video/mp4",
        };

        expect(videoMetadata(video)).toMatchObject({
            content: video.url,
            storageKey: video.storageKey,
            urls: video.urls,
        });
        expect((videoMetadata(video) as { urls?: string[] }).urls).not.toBe(video.urls);
    });
});
