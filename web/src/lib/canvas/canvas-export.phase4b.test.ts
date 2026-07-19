import { describe, expect, test } from "bun:test";

import {
    CanvasExportError,
    buildCanvasProjectExport,
    buildSelectedNodeMediaExport,
    type CanvasExportReaders,
} from "./canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const baseProject: CanvasProject = {
    id: "project-1",
    title: "项目/一",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "grid",
    showImageInfo: true,
    viewport: { x: 0, y: 0, k: 1 },
};

function mediaNode(id: string, type: CanvasNodeType, title: string, storageKey: string, content = storageKey): CanvasNodeData {
    return {
        id,
        type,
        title,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        status: "success",
        metadata: { storageKey, content },
    };
}

function readers(blobs: Record<string, Blob | null>): CanvasExportReaders {
    return {
        getImageBlob: async (key) => blobs[key] ?? null,
        getMediaBlob: async (key) => blobs[key] ?? null,
        now: () => "2026-07-19T01:02:03.000Z",
    };
}

describe("Phase 4B current-canvas export contract", () => {
    test("builds a deterministic version-4 project manifest and reports missing media instead of silently dropping it", async () => {
        const project: CanvasProject = {
            ...baseProject,
            nodes: [
                mediaNode("node-b", CanvasNodeType.Video, "视频", "video:b"),
                mediaNode("node-a", CanvasNodeType.Image, "图片", "image:a", "blob:temporary-a"),
                mediaNode("node-duplicate", CanvasNodeType.Image, "重复", "image:a", "blob:temporary-duplicate"),
                mediaNode("node-missing", CanvasNodeType.Audio, "缺失", "audio:missing"),
            ],
        };

        const plan = await buildCanvasProjectExport(project, readers({
            "image:a": new Blob(["png"], { type: "image/png" }),
            "video:b": new Blob(["mp4!"], { type: "video/mp4" }),
        }));

        expect(plan.entries.map((entry) => entry.name)).toEqual([
            "projects/project-1/files/image_a.png",
            "projects/project-1/files/video_b.mp4",
        ]);
        expect(plan.manifest).toMatchObject({
            app: "infinite-canvas",
            version: 4,
            kind: "canvas-project",
            exportedAt: "2026-07-19T01:02:03.000Z",
            summary: {
                status: "partial",
                projectCount: 1,
                referencedFileCount: 3,
                exportedFileCount: 2,
                exportedBytes: 7,
                omittedCount: 1,
            },
        });
        expect(plan.manifest.projects[0].files[0]).toMatchObject({ storageKey: "image:a", nodeIds: ["node-a", "node-duplicate"] });
        expect(plan.manifest.projects[0].issues).toContainEqual(expect.objectContaining({ code: "missing_storage", nodeId: "node-missing", storageKey: "audio:missing" }));
        expect(plan.manifest.projects[0].project.nodes[1].metadata?.content).toBe("image:a");
        expect(project.nodes[1].metadata?.content).toBe("blob:temporary-a");
    });

    test("redacts credential-shaped fields and signed query values from the exported project snapshot", async () => {
        const node = mediaNode("node-secret", CanvasNodeType.Image, "私密", "image:a");
        node.metadata = {
            ...node.metadata,
            taskBaseUrl: "https://api.example.test/content?token=secret-token&safe=yes",
            apiKey: "secret-api-key",
        } as typeof node.metadata;

        const plan = await buildCanvasProjectExport({ ...baseProject, nodes: [node] }, readers({ "image:a": new Blob(["x"], { type: "image/png" }) }));
        const serialized = JSON.stringify(plan.manifest);

        expect(serialized).not.toContain("secret-api-key");
        expect(serialized).not.toContain("secret-token");
        expect(plan.manifest.projects[0].issues).toContainEqual(expect.objectContaining({ code: "credential_redacted", nodeId: "node-secret" }));
    });
});

describe("Phase 4B selected-node media export contract", () => {
    test("exports media only in project order, de-duplicates storage keys, and reports unsupported nodes", async () => {
        const nodes: CanvasNodeData[] = [
            mediaNode("image-a", CanvasNodeType.Image, "封面", "image:shared"),
            { ...mediaNode("text-a", CanvasNodeType.Text, "说明", ""), metadata: { content: "不应生成 txt" } },
            mediaNode("image-b", CanvasNodeType.Image, "封面", "image:shared"),
            mediaNode("video-a", CanvasNodeType.Video, "预告", "video:a"),
        ];

        const plan = await buildSelectedNodeMediaExport(nodes, ["video-a", "text-a", "image-b", "image-a"], readers({
            "image:shared": new Blob(["img"], { type: "image/png" }),
            "video:a": new Blob(["video"], { type: "video/mp4" }),
        }));

        expect(plan.entries.map((entry) => entry.name)).toEqual(["media/0001-封面.png", "media/0004-预告.mp4"]);
        expect(plan.manifest.selectedNodeIds).toEqual(["image-a", "text-a", "image-b", "video-a"]);
        expect(plan.manifest.items[1]).toMatchObject({ nodeId: "image-b", path: "media/0001-封面.png", duplicateOf: "image-a" });
        expect(plan.manifest.issues).toContainEqual(expect.objectContaining({ code: "unsupported_node", nodeId: "text-a" }));
        expect(plan.result).toMatchObject({ status: "partial", exportedFileCount: 2, omittedCount: 1 });
    });

    test("never fetches remote media URLs and fails without creating a fake JSON media export", async () => {
        const remote = mediaNode("remote", CanvasNodeType.Image, "远程", "", "https://cdn.example.test/a.png?token=secret");
        const plan = await buildSelectedNodeMediaExport([remote], ["remote"], readers({}));

        expect(plan.entries).toEqual([]);
        expect(plan.manifest.issues).toContainEqual(expect.objectContaining({ code: "blocked_remote_url", nodeId: "remote", source: "https://cdn.example.test/a.png" }));
        expect(JSON.stringify(plan.manifest)).not.toContain("secret");
        expect(() => plan.assertDownloadable()).toThrow(CanvasExportError);
        expect(() => plan.assertDownloadable()).toThrow("没有可导出的媒体");
    });

    test("rejects an oversized Blob before ZIP creation", async () => {
        const oversized = new Blob([new Uint8Array(9)], { type: "image/png" });
        const node = mediaNode("large", CanvasNodeType.Image, "大图", "image:large");

        await expect(buildSelectedNodeMediaExport([node], [node.id], { ...readers({ "image:large": oversized }), limits: { maxSingleFileBytes: 8, maxTotalBytes: 16, maxFiles: 10, maxSelectedNodes: 10 } })).rejects.toMatchObject({
            code: "single_file_size_limit",
        });
    });
});
