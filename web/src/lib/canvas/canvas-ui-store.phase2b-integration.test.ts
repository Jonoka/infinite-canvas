import { describe, expect, test } from "bun:test";

import { canvasNodeRetryLabel } from "./canvas-generation-helpers";
import {
    createCanvasImageRecoveryAction,
    createCanvasImageSubmissionHandlers,
    prepareImageGenerationSubmission,
    type CanvasImageRecoveryOutcome,
} from "./canvas-image-recovery-actions";
import { canvasProjectImageActionFactories } from "@/pages/canvas/project";
import { errorContentRetryLabel } from "@/components/canvas/nodes/builtin-nodes";
import { hoverToolbarRetryLabel } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const taskKeys = ["taskId", "taskContentIndex", "taskRecoverable", "taskApiMode", "taskModel", "taskGroup", "taskChannelId", "taskBaseUrl"] as const;
const taskMetadata = {
    taskId: "accepted-task", taskContentIndex: 2, taskRecoverable: true, taskApiMode: "newapi" as const,
    taskModel: "resolved-model", taskGroup: "paid-group", taskChannelId: "resolved-channel",
    taskBaseUrl: "https://new-api.example.com/console",
};

function node(id = "target", metadata: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 512, height: 512,
        metadata: { status: "error", prompt: "keep prompt", generationType: "generation", sentinel: { keep: true }, ...taskMetadata, ...metadata },
    } as CanvasNodeData;
}

function metadataKeys(value: CanvasNodeData) {
    return Object.keys(value.metadata || {}).sort();
}

function recoveryHarness(overrides: Record<string, unknown> = {}) {
    let current = node();
    const original = current;
    const events: string[] = [];
    const action = createCanvasImageRecoveryAction({
        recoverImageTask: async (task) => { events.push("recover"); expect(task).toEqual(taskMetadata); return new Blob(["png"], { type: "image/png" }); },
        uploadImage: async () => { events.push("upload"); return { url: "blob:preview", storageKey: "image:durable", width: 640, height: 480 }; },
        updateNode: (id, updater) => { events.push(`update:${id}`); current = updater(current); },
        flushCanvasStorePersistence: async () => { events.push("flush"); },
        ...overrides,
    });
    return { action, events, original, current: () => current };
}

describe("Phase 2B production wiring contracts", () => {
    test("project imports the real action factories rather than a test-only integration object", () => {
        expect(canvasProjectImageActionFactories).toEqual({
            createRecoveryAction: createCanvasImageRecoveryAction,
            createSubmissionHandlers: createCanvasImageSubmissionHandlers,
        });
    });

    test("both retry surfaces export the shared production node-label policy", () => {
        expect(errorContentRetryLabel).toBe(canvasNodeRetryLabel);
        expect(hoverToolbarRetryLabel).toBe(canvasNodeRetryLabel);
        expect(errorContentRetryLabel(node())).toEqual({ kind: "recover", label: "重新获取成品" });
        expect(hoverToolbarRetryLabel(node("ordinary", { taskRecoverable: false }))).toEqual({ kind: "regenerate", label: "重试" });
    });
});

describe("Phase 2B recovery action", () => {
    test("its typed dependencies expose recovery, upload, update and flush only (no generation/edit request)", () => {
        const dependencies: Parameters<typeof createCanvasImageRecoveryAction>[0] = {
            recoverImageTask: async () => new Blob(), uploadImage: async () => ({ url: "u", storageKey: "k", width: 1, height: 1 }),
            updateNode: () => {}, flushCanvasStorePersistence: async () => {},
        };
        expect(Object.keys(dependencies).sort()).toEqual(["flushCanvasStorePersistence", "recoverImageTask", "updateNode", "uploadImage"]);
    });

    test("success uploads, updates the same node, durably flushes, and preserves all unrelated metadata", async () => {
        const h = recoveryHarness();
        const beforeKeys = metadataKeys(h.original);
        await expect(h.action(h.original)).resolves.toEqual({ status: "success", nodeId: "target", storageKey: "image:durable" } satisfies CanvasImageRecoveryOutcome);
        expect(h.events).toEqual(["recover", "upload", "update:target", "flush"]);
        expect(h.current().id).toBe(h.original.id);
        expect(h.current().metadata).toMatchObject({ status: "success", content: "blob:preview", storageKey: "image:durable", prompt: "keep prompt", sentinel: { keep: true }, ...taskMetadata });
        expect(metadataKeys(h.current())).toEqual([...new Set([...beforeKeys, "content", "storageKey"])].sort());
    });

    test.each([
        ["pending", new Error("图片任务尚未完成，请稍后重试")],
        ["failure", new Error("图片生成失败")],
    ] as const)("returns a structured %s outcome and preserves the complete node for retry", async (status, error) => {
        const h = recoveryHarness({ recoverImageTask: async () => { throw error; } });
        const before = structuredClone(h.original);
        await expect(h.action(h.original)).resolves.toEqual({ status, nodeId: "target", error });
        expect(h.current()).toEqual(before);
        expect(h.events).toEqual([]);
    });

    test.each(["upload", "flush"] as const)("a %s failure returns a structured error and preserves task metadata and unrelated identity", async (stage) => {
        const error = new Error(`${stage} failed`);
        const sentinel = node().metadata!.sentinel;
        const h = recoveryHarness(stage === "upload"
            ? { uploadImage: async () => { throw error; } }
            : { flushCanvasStorePersistence: async () => { throw error; } });
        await expect(h.action(h.original)).resolves.toEqual({ status: "failure", stage, nodeId: "target", error });
        expect(Object.fromEntries(taskKeys.map((key) => [key, h.current().metadata?.[key]]))).toEqual(taskMetadata);
        expect(h.current().metadata?.sentinel).toBe(sentinel);
    });
});

describe("Phase 2B accepted metadata and new submissions", () => {
    test("acceptance produces existing metadata plus exactly eight named fields and cannot spread secrets", () => {
        const existing = { status: "loading" as const, prompt: "keep prompt", generationType: "generation" as const, sentinel: { keep: true } };
        const acceptance = { taskId: "accepted-task", contentIndex: 2, recoverable: true, apiMode: "newapi" as const, model: "resolved-model", group: "paid-group", channelId: "resolved-channel", baseUrl: "https://new-api.example.com/console", apiKey: "secret", cookie: "secret" };
        const result = canvasProjectImageActionFactories.acceptTaskMetadata(existing, acceptance);
        expect(result).toEqual({ ...existing, ...taskMetadata });
        expect(Object.keys(result).sort()).toEqual([...new Set([...Object.keys(existing), ...taskKeys])].sort());
        expect(result).not.toHaveProperty("apiKey");
        expect(result).not.toHaveProperty("cookie");
    });

    test("the real generation and edit handlers both call the shared preparation immediately before POST", async () => {
        const events: string[] = [];
        let current = node();
        const handlers = createCanvasImageSubmissionHandlers({
            prepare: (candidate) => { events.push("prepare"); current = prepareImageGenerationSubmission(candidate); return current; },
            requestGeneration: async () => { events.push("generation:post"); for (const key of taskKeys) expect(current.metadata).not.toHaveProperty(key); },
            requestEdit: async () => { events.push("edit:post"); for (const key of taskKeys) expect(current.metadata).not.toHaveProperty(key); },
        });
        await handlers.generate(node());
        await handlers.edit(node());
        expect(events).toEqual(["prepare", "generation:post", "prepare", "edit:post"]);
        expect(current.metadata).toMatchObject({ prompt: "keep prompt", sentinel: { keep: true } });
    });
});
