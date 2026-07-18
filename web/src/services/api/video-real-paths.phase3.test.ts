import { describe, expect, test } from "bun:test";

import type { VideoGenerationResult } from "./video";
import { preserveVideoGenerationResult } from "@/lib/video-generation-contracts";
import { freezeVideoRetrySnapshot } from "@/lib/video-retry-snapshot";
import { normalizeVideoReferences } from "@/lib/canvas/video-reference-normalization";

describe("Phase 3 real video result propagation", () => {
    test("preserves every VideoGenerationResult URL in the page/log or stored video result", () => {
        const result: VideoGenerationResult = {
            url: "https://media.test/primary.mp4",
            urls: ["https://media.test/primary.mp4", "https://media.test/alternate.mp4"],
            mimeType: "video/mp4",
        };

        expect(preserveVideoGenerationResult(result, {
            id: "stored-video",
            url: result.url,
            storageKey: "videos/stored-video",
            mimeType: result.mimeType,
        })).toMatchObject({ url: result.url, urls: result.urls, mimeType: result.mimeType });
    });
});

describe("Phase 3 real video retry snapshot", () => {
    test("retry input remains frozen when current prompt/config/references mutate", () => {
        const references = [{ id: "first", url: "https://media.test/first.png" }];
        const snapshot = freezeVideoRetrySnapshot({
            prompt: "original prompt",
            config: { model: "video-original", size: "16:9", videoSeconds: "6" },
            references,
            videoReferences: [{ id: "motion", url: "https://media.test/motion.mp4" }],
            audioReferences: [{ id: "music", url: "https://media.test/music.mp3" }],
        });

        references[0].url = "https://media.test/current.png";
        expect(snapshot).toEqual({
            prompt: "original prompt",
            config: { model: "video-original", size: "16:9", videoSeconds: "6" },
            references: [{ id: "first", url: "https://media.test/first.png" }],
            videoReferences: [{ id: "motion", url: "https://media.test/motion.mp4" }],
            audioReferences: [{ id: "music", url: "https://media.test/music.mp3" }],
        });
    });
});

describe("Phase 3 real Canvas reference normalization", () => {
    test("keeps mixed media order and first/last/component metadata", () => {
        expect(normalizeVideoReferences([
            { kind: "image", url: "https://media.test/first.png", role: "first_frame" },
            { kind: "video", url: "https://media.test/motion.mp4", role: "reference_video" },
            { kind: "image", url: "https://media.test/actor.png", role: "component", component: "actor" },
            { kind: "audio", url: "https://media.test/music.mp3", role: "reference_audio" },
            { kind: "image", url: "https://media.test/last.png", role: "last_frame" },
        ])).toEqual([
            { kind: "image", url: "https://media.test/first.png", role: "first_frame" },
            { kind: "video", url: "https://media.test/motion.mp4", role: "reference_video" },
            { kind: "image", url: "https://media.test/actor.png", role: "component", component: "actor" },
            { kind: "audio", url: "https://media.test/music.mp3", role: "reference_audio" },
            { kind: "image", url: "https://media.test/last.png", role: "last_frame" },
        ]);
    });
});
