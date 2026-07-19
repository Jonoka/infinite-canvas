import { describe, expect, test } from "bun:test";

import {
    CanvasExportError,
    buildCanvasProjectExport,
    buildSelectedNodeMediaExport,
    parseCanvasProjectExportManifest,
    type CanvasExportReaders,
} from "./canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

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

function mediaNode(id: string, type: CanvasNodeTypeId, title: string, storageKey: string, content = storageKey): CanvasNodeData {
    return {
        id,
        type,
        title,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { storageKey, content, status: "success" },
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
            taskBaseUrl: "https://user:secret-token@api.example.test/content?token=secret-token&safe=yes#secret-token",
            apiKey: "secret-api-key",
        } as typeof node.metadata;

        const plan = await buildCanvasProjectExport({ ...baseProject, nodes: [node] }, readers({ "image:a": new Blob(["x"], { type: "image/png" }) }));
        const serialized = JSON.stringify(plan.manifest);

        expect(serialized).not.toContain("secret-api-key");
        expect(serialized).not.toContain("secret-token");
        expect(plan.manifest.projects[0].issues).toContainEqual(expect.objectContaining({ code: "credential_redacted", nodeId: "node-secret" }));
    });

    test("recursively collects nested chat/plugin keys and preserves ordinary prompt URLs", async () => {
        const plugin = mediaNode("plugin", "example:media", "插件", "plugin:file");
        plugin.metadata = { ...plugin.metadata, prompt: "请访问 https://example.test/help?topic=canvas#intro", nested: { storageKey: "image:nested" } } as typeof plugin.metadata;
        const project = { ...baseProject, nodes: [plugin], chatSessions: [{ id: "chat", title: "chat", createdAt: "", updatedAt: "", messages: [{ id: "message", role: "assistant" as const, text: "ok", references: [{ id: "ref", type: CanvasNodeType.Image, title: "ref", storageKey: "image:chat" }] }] }] };
        const plan = await buildCanvasProjectExport(project, readers({
            "plugin:file": new Blob(["p"], { type: "image/png" }),
            "image:nested": new Blob(["n"], { type: "image/png" }),
            "image:chat": new Blob(["c"], { type: "image/png" }),
        }));

        expect(plan.manifest.projects[0].files.map((file) => file.storageKey)).toEqual(["image:chat", "image:nested", "plugin:file"]);
        expect(plan.manifest.projects[0].project.nodes[0].metadata?.prompt).toBe("请访问 https://example.test/help?topic=canvas#intro");
    });

    test("collects Phase 3 reference keys and preserves supported native media MIME types", async () => {
        const video = mediaNode("video", CanvasNodeType.Video, "视频", "video:result");
        video.metadata = {
            ...video.metadata,
            references: ["image:first"],
            videoReferences: [
                { kind: "video", url: "video:motion" },
                { kind: "audio", url: "audio:music" },
            ],
        };
        const plan = await buildCanvasProjectExport({ ...baseProject, nodes: [video] }, readers({
            "video:result": new Blob(["result"], { type: "video/quicktime" }),
            "image:first": new Blob(["image"], { type: "image/png" }),
            "video:motion": new Blob(["motion"], { type: "video/mp4" }),
            "audio:music": new Blob(["music"], { type: "audio/flac" }),
        }));

        expect(plan.manifest.projects[0].files.map((file) => file.storageKey)).toEqual(["audio:music", "image:first", "video:motion", "video:result"]);
        expect(plan.result.status).toBe("success");
    });

    test("does not persist remote media secrets, transient payloads, or invalid storage keys", async () => {
        const remote = mediaNode("remote", CanvasNodeType.Image, "远程", "", "https://cdn.example.test/a.png?token=content-secret");
        remote.metadata = { ...remote.metadata, storageKey: "https://evil.example/a?token=key-secret", dataUrl: "data:image/png;base64,payload-secret", urls: ["blob:transient-secret"] } as typeof remote.metadata;
        const plan = await buildCanvasProjectExport({ ...baseProject, nodes: [remote] }, readers({}));
        const serialized = JSON.stringify(plan.manifest);

        expect(serialized).not.toContain("content-secret");
        expect(serialized).not.toContain("key-secret");
        expect(serialized).not.toContain("payload-secret");
        expect(serialized).not.toContain("transient-secret");

        const dataContent = mediaNode("data-content", CanvasNodeType.Image, "data", "", "data:image/png;base64,content-payload-secret");
        const blobContent = mediaNode("blob-content", CanvasNodeType.Video, "blob", "", "blob:content-transient-secret");
        const nestedPlugin = mediaNode("nested-plugin", "example:media", "plugin", "");
        nestedPlugin.metadata = { ...nestedPlugin.metadata, nested: { dataUrl: "data:image/png;base64,plugin-payload-secret", url: "blob:plugin-transient-secret" } } as typeof nestedPlugin.metadata;
        const locationPlan = await buildCanvasProjectExport({ ...baseProject, nodes: [dataContent, blobContent, nestedPlugin] }, readers({}));
        const locationSerialized = JSON.stringify(locationPlan.manifest);
        expect(locationSerialized).not.toContain("content-payload-secret");
        expect(locationSerialized).not.toContain("content-transient-secret");
        expect(locationSerialized).not.toContain("plugin-payload-secret");
        expect(locationSerialized).not.toContain("plugin-transient-secret");
    });

    test("sanitizes traversal and resolves colliding ZIP paths globally", async () => {
        const project = { ...baseProject, id: "../same", nodes: [mediaNode("a", CanvasNodeType.Image, "a", "image:a:b"), mediaNode("b", CanvasNodeType.Image, "b", "image:a_b")] };
        const plan = await buildCanvasProjectExport(project, readers({ "image:a:b": new Blob(["a"], { type: "image/png" }), "image:a_b": new Blob(["b"], { type: "image/png" }) }));
        expect(plan.entries.every((entry) => !entry.name.includes("..") && !entry.name.includes("\\"))).toBe(true);
        expect(new Set(plan.entries.map((entry) => entry.name)).size).toBe(plan.entries.length);
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
        const remote = mediaNode("remote", CanvasNodeType.Image, "远程", "", "https://cdn.example.test/a.png?token=secret-token");
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

    test("exports a plugin node with a valid storage key and reports exact MIME failures", async () => {
        const plugin = mediaNode("plugin", "example:media", "插件", "plugin:file");
        const plan = await buildSelectedNodeMediaExport([plugin], [plugin.id], readers({ "plugin:file": new Blob(["x"], { type: "application/x-custom" }) }));
        expect(plan.manifest.issues).toContainEqual(expect.objectContaining({ code: "unknown_mime_type", nodeId: "plugin" }));
        const valid = await buildSelectedNodeMediaExport([plugin], [plugin.id], readers({ "plugin:file": new Blob(["x"], { type: "image/png" }) }));
        expect(valid.entries).toHaveLength(1);
    });
});

describe("Phase 4B import manifest guard", () => {
    const project = { project: baseProject, files: [] };
    test("accepts runtime v3 and v4 canvas-project manifests", () => {
        expect(parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, exportedAt: "", projects: [project] }).version).toBe(3);
        expect(parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 4, kind: "canvas-project", exportedAt: "", projects: [project], summary: {} }).version).toBe(4);
        const legacyFile = { storageKey: "video:legacy", path: "projects/old/files/video_legacy.bin", mimeType: "application/octet-stream" };
        expect(parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, exportedAt: "", projects: [{ project: baseProject, files: [legacyFile] }, { project: { ...baseProject, id: "second" }, files: [{ ...legacyFile, path: "projects/second/files/video_legacy.bin" }] }] }).version).toBe(3);
    });
    test("rejects selected-node and unsafe, missing, or conflicting file declarations", () => {
        expect(() => parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 4, kind: "selected-node-media", projects: [] })).toThrow(CanvasExportError);
        expect(() => parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, projects: [{ project: baseProject }] })).toThrow(CanvasExportError);
        expect(() => parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, projects: [{ project: baseProject, files: [{ storageKey: "image:a", path: "../escape.png", mimeType: "image/png" }] }] })).toThrow(CanvasExportError);
        expect(() => parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, projects: [{ project: baseProject, files: [{ storageKey: "image:a", path: "projects.json", mimeType: "image/png" }] }] })).toThrow(CanvasExportError);
        expect(() => parseCanvasProjectExportManifest({ app: "infinite-canvas", version: 3, projects: [{ project: baseProject, files: [{ storageKey: "image:a", path: "projects/p/files/a.png", mimeType: "video/mp4" }] }] })).toThrow(CanvasExportError);
    });
});
