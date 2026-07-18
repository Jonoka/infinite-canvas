import { describe, expect, test } from "bun:test";

import * as generationHelpers from "./canvas-generation-helpers";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";

type RecoveryMetadata = {
    taskId?: string;
    taskContentIndex?: number;
    taskRecoverable?: boolean;
    taskApiMode?: "newapi" | "direct";
    taskModel?: string;
    taskGroup?: string;
    taskChannelId?: string;
    taskBaseUrl?: string;
};
type RecoveryKeys = keyof RecoveryMetadata;
type RecoveryHooks = {
    shouldRecoverImageTask: (node: CanvasNodeData) => boolean;
    imageRetryActionLabel: (node: CanvasNodeData) => string;
    resetInterruptedImageGeneration: (nodes: CanvasNodeData[]) => CanvasNodeData[];
    clearImageTaskRecovery: <T extends RecoveryMetadata>(metadata: T) => Omit<T, RecoveryKeys>;
    buildImageRetryPlan: (node: CanvasNodeData) => { kind: "recover" | "regenerate"; requests: Array<{ method: "GET" | "POST"; path: string }> };
    persistAcceptedImageTask: (input: {
        nodes: CanvasNodeData[];
        nodeId: string;
        acceptance: Required<RecoveryMetadata>;
        writeNodes: (nodes: CanvasNodeData[]) => void | Promise<void>;
        flush: () => Promise<void>;
    }) => Promise<void>;
    resolveImageTaskRecoveryConfig: (input: {
        node: CanvasNodeData;
        currentConfig: AiConfig;
    }) => AiConfig;
};

const hooks = (generationHelpers as typeof generationHelpers & { __test__?: Partial<RecoveryHooks> }).__test__;

function hook<K extends keyof RecoveryHooks>(name: K): RecoveryHooks[K] {
    const value = hooks?.[name];
    expect(typeof value, `Phase 2B requires canvas-generation-helpers.ts __test__.${name} as a pure policy seam`).toBe("function");
    return value as RecoveryHooks[K];
}

function node(overrides: Partial<CanvasNodeData> = {}, metadata: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id: "target-image",
        type: CanvasNodeType.Image,
        title: "image",
        position: { x: 0, y: 0 },
        width: 512,
        height: 512,
        metadata: {
            status: "error",
            generationType: "generation",
            taskId: "task-accepted",
            taskContentIndex: 0,
            taskRecoverable: true,
            taskApiMode: "newapi",
            taskModel: "actual-model",
            taskGroup: "actual-group",
            taskChannelId: "accepted-channel",
            taskBaseUrl: "https://accepted.example.com/console",
            ...metadata,
        },
        ...overrides,
    } as CanvasNodeData;
}

describe("Phase 2B billing-safe image recovery eligibility", () => {
    test("recovers only a failed image with a recoverable New API task and valid task ID", () => {
        expect(hook("shouldRecoverImageTask")(node())).toBe(true);
    });

    test.each<[string, CanvasNodeData]>([
        ["non-image node", node({ type: CanvasNodeType.Video })],
        ["non-failed node", node({}, { status: "loading" })],
        ["direct API task", node({}, { taskApiMode: "direct" })],
        ["missing API mode", node({}, { taskApiMode: undefined })],
        ["explicitly non-recoverable task", node({}, { taskRecoverable: false })],
        ["missing recoverable marker", node({}, { taskRecoverable: undefined })],
        ["missing task ID", node({}, { taskId: undefined })],
        ["blank task ID", node({}, { taskId: "   " })],
    ])("does not recover: %s", (_reason, candidate) => {
        expect(hook("shouldRecoverImageTask")(candidate)).toBe(false);
    });

    test("uses the recovery-specific action label and retains the existing retry label otherwise", () => {
        expect(hook("imageRetryActionLabel")(node())).toBe("重新获取成品");
        expect(hook("imageRetryActionLabel")(node({}, { taskId: undefined }))).toBe("重试");
    });

    test("recovery plan performs status/content GET only and cannot issue a billable generation/edit POST", () => {
        const plan = hook("buildImageRetryPlan")(node({}, { taskId: "task/unsafe", taskContentIndex: 2 }));
        expect(plan.kind).toBe("recover");
        expect(plan.requests).toEqual([
            { method: "GET", path: "/images/tasks/task%2Funsafe" },
            { method: "GET", path: "/images/tasks/task%2Funsafe/content/2" },
        ]);
        expect(plan.requests.some((request) => request.method === "POST" || /\/images\/(generations|edits)$/.test(request.path))).toBe(false);
    });

    test("an ineligible node explicitly plans regeneration rather than masquerading as recovery", () => {
        expect(hook("buildImageRetryPlan")(node({}, { taskRecoverable: false }))).toMatchObject({ kind: "regenerate" });
    });

    test("recovery config uses saved provenance so the current unrelated channel cannot hijack routing", () => {
        const currentConfig = {
            apiMode: "newapi",
            apiFormat: "openai",
            baseUrl: "https://hijacker.example.com/",
            apiKey: "current-secret",
            group: "current-group",
            model: "current-model",
            imageModel: "current-model",
            quality: "auto", size: "1:1", count: "1", systemPrompt: "",
            channels: [
                { id: "accepted-channel", name: "Accepted (currently edited)", baseUrl: "https://changed.example.com/", apiKey: "accepted-secret", apiMode: "newapi", apiFormat: "openai", group: "accepted-group", models: [{ name: "actual-model" }] },
                { id: "current-channel", name: "Current", baseUrl: "https://hijacker.example.com/", apiKey: "current-secret", apiMode: "newapi", apiFormat: "openai", group: "current-group", models: [{ name: "current-model" }] },
            ],
        } as AiConfig;

        const resolved = hook("resolveImageTaskRecoveryConfig")({ node: node(), currentConfig });
        expect(resolved).toMatchObject({
            apiMode: "newapi", baseUrl: "https://accepted.example.com/console", model: "actual-model", group: "actual-group",
        });
        expect(resolved.baseUrl).not.toContain("hijacker.example.com");
        expect(resolved.baseUrl).not.toContain("changed.example.com");
        expect(resolved.apiKey).toBe("accepted-secret");
        expect(JSON.stringify(node().metadata)).not.toContain("accepted-secret");
        expect(JSON.stringify(node().metadata)).not.toContain("current-secret");
    });
});

describe("Phase 2B interruption and new-submission semantics", () => {
    test("an interrupted recoverable task says its accepted result can be fetched without regeneration", () => {
        const [interrupted] = hook("resetInterruptedImageGeneration")([node({}, { status: "loading" })]);
        expect(interrupted.metadata?.status).toBe("error");
        expect(interrupted.metadata?.errorDetails).toMatch(/重新获取成品/);
        expect(interrupted.metadata?.errorDetails).not.toMatch(/重新生成/);
    });

    test("an interrupted ordinary generation retains regenerate semantics", () => {
        const [interrupted] = hook("resetInterruptedImageGeneration")([node({}, { status: "loading", taskId: undefined, taskRecoverable: undefined })]);
        expect(interrupted.metadata?.errorDetails).toMatch(/重新生成/);
        expect(interrupted.metadata?.errorDetails).not.toMatch(/重新获取成品/);
    });

    test("beginning a real new submission clears stale recovery fields and preserves unrelated metadata", () => {
        const sentinel = { nested: { keep: true } };
        const metadata = hook("clearImageTaskRecovery")({
            ...(node().metadata as RecoveryMetadata),
            status: "loading",
            generationType: "edit",
            sentinel,
        });
        expect(metadata).not.toHaveProperty("taskId");
        expect(metadata).not.toHaveProperty("taskContentIndex");
        expect(metadata).not.toHaveProperty("taskRecoverable");
        expect(metadata).not.toHaveProperty("taskApiMode");
        expect(metadata).not.toHaveProperty("taskModel");
        expect(metadata).not.toHaveProperty("taskGroup");
        expect(metadata).not.toHaveProperty("taskChannelId");
        expect(metadata).not.toHaveProperty("taskBaseUrl");
        expect(metadata).toMatchObject({ status: "loading", generationType: "edit", sentinel });
        expect(metadata.sentinel).toBe(sentinel);
    });
});

describe("Phase 2B accepted-task persistence seam", () => {
    test("updates only the target node metadata and awaits durable flush before polling may proceed", async () => {
        const other = node({ id: "other", title: "other-image" }, {
            status: "complete",
            generationType: "edit",
            taskId: "other-task",
            taskContentIndex: 7,
            taskRecoverable: false,
            taskApiMode: "direct",
            taskModel: "other-model",
            taskGroup: "other-group",
            taskChannelId: "other-channel",
            taskBaseUrl: "https://other.example.com",
            sentinel: { nested: ["unchanged"] },
        });
        const otherSnapshot = structuredClone(other);
        const target = node({}, { taskId: undefined });
        const acceptance: Required<RecoveryMetadata> = {
            taskId: "accepted-42",
            taskContentIndex: 0,
            taskRecoverable: true,
            taskApiMode: "newapi",
            taskModel: "actual-resolved-model",
            taskGroup: "actual-paid-group",
            taskChannelId: "accepted-channel",
            taskBaseUrl: "https://accepted.example.com/console",
        };
        const events: string[] = [];
        let written: CanvasNodeData[] = [];
        let releaseFlush!: () => void;
        const flushGate = new Promise<void>((resolve) => { releaseFlush = resolve; });

        const pending = hook("persistAcceptedImageTask")({
            nodes: [other, target],
            nodeId: target.id,
            acceptance,
            writeNodes: (nodes) => {
                events.push("write");
                written = nodes;
            },
            flush: async () => {
                events.push("flush:start");
                await flushGate;
                events.push("flush:end");
            },
        }).then(() => events.push("polling-may-start"));

        await Promise.resolve();
        expect(events).toEqual(["write", "flush:start"]);
        expect(written.find((item) => item.id === target.id)?.metadata).toMatchObject(acceptance);
        expect(written.find((item) => item.id === other.id)).toEqual(otherSnapshot);

        releaseFlush();
        await pending;
        expect(events).toEqual(["write", "flush:start", "flush:end", "polling-may-start"]);
    });
});
