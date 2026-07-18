import type { ImageTaskAcceptance } from "@/services/api/image";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { clearImageTaskRecovery } from "./canvas-generation-helpers";

type RecoveryTask = Pick<ImageTaskAcceptance, "taskId" | "contentIndex" | "recoverable" | "apiMode" | "model" | "group" | "channelId" | "baseUrl">;
type UploadedRecoveryImage = { url: string; storageKey: string; width: number; height: number };

export type CanvasImageRecoveryOutcome =
    | { status: "success"; nodeId: string; storageKey: string }
    | { status: "aborted" | "stale"; nodeId: string; error: DOMException }
    | { status: "pending" | "failure"; nodeId: string; error: unknown; stage?: "upload" | "flush"; persistenceRetried?: boolean };

export function acceptImageTaskMetadata<T extends CanvasNodeMetadata>(metadata: T, task: ImageTaskAcceptance) {
    return {
        ...metadata,
        taskId: task.taskId,
        taskContentIndex: task.contentIndex,
        taskRecoverable: task.recoverable,
        taskApiMode: task.apiMode,
        taskModel: task.model,
        taskGroup: task.group,
        taskChannelId: task.channelId,
        taskBaseUrl: task.baseUrl,
    };
}

function recoveryTask(node: CanvasNodeData): RecoveryTask {
    const metadata = node.metadata!;
    return {
        taskId: metadata.taskId!,
        contentIndex: metadata.taskContentIndex || 0,
        recoverable: metadata.taskRecoverable === true,
        apiMode: metadata.taskApiMode!,
        model: metadata.taskModel!,
        group: metadata.taskGroup || "",
        channelId: metadata.taskChannelId!,
        baseUrl: metadata.taskBaseUrl!,
    };
}

export function createCanvasImageRecoveryAction(dependencies: {
    recoverImageTask: (task: RecoveryTask, signal: AbortSignal) => Promise<Blob>;
    uploadImage: (blob: Blob) => Promise<UploadedRecoveryImage>;
    updateNode: (nodeId: string, updater: (node: CanvasNodeData) => CanvasNodeData) => void;
    flushCanvasStorePersistence: () => Promise<void>;
    isCurrent?: () => boolean;
}) {
    return async (node: CanvasNodeData, controller = new AbortController()): Promise<CanvasImageRecoveryOutcome> => {
        const current = () => !controller.signal.aborted && (dependencies.isCurrent?.() ?? true);
        const stale = (): CanvasImageRecoveryOutcome => ({
            status: controller.signal.aborted ? "aborted" : "stale",
            nodeId: node.id,
            error: new DOMException(controller.signal.aborted ? "Aborted" : "Stale", "AbortError"),
        });
        if (!current()) return stale();
        dependencies.updateNode(node.id, (value) => ({ ...value, metadata: { ...value.metadata, status: "loading", errorDetails: undefined } }));
        let blob: Blob;
        try {
            blob = await dependencies.recoverImageTask(recoveryTask(node), controller.signal);
        } catch (error) {
            if (!current()) return stale();
            dependencies.updateNode(node.id, (value) => ({ ...value, metadata: { ...value.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "重新获取图片失败" } }));
            const pending = error instanceof Error && /尚未完成|稍后重试/.test(error.message);
            return { status: pending ? "pending" : "failure", nodeId: node.id, error };
        }
        if (!current()) return stale();
        let image: UploadedRecoveryImage;
        try {
            image = await dependencies.uploadImage(blob);
        } catch (error) {
            if (!current()) return stale();
            dependencies.updateNode(node.id, (value) => ({ ...value, metadata: { ...value.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "图片保存失败" } }));
            return { status: "failure", stage: "upload", nodeId: node.id, error };
        }
        if (!current()) return stale();
        dependencies.updateNode(node.id, (value) => ({
            ...value,
            metadata: { ...value.metadata, status: "success", content: image.url, storageKey: image.storageKey },
        }));
        try {
            await dependencies.flushCanvasStorePersistence();
        } catch (error) {
            if (!current()) return stale();
            dependencies.updateNode(node.id, (value) => ({ ...value, metadata: { ...value.metadata, status: "error", errorDetails: "恢复结果持久化失败，请重新获取成品" } }));
            if (!current()) return stale();
            try {
                await dependencies.flushCanvasStorePersistence();
            } catch {
                if (!current()) return stale();
            }
            return { status: "failure", stage: "flush", nodeId: node.id, error, persistenceRetried: true };
        }
        if (!current()) return stale();
        return { status: "success", nodeId: node.id, storageKey: image.storageKey };
    };
}

export function prepareImageGenerationSubmission(node: CanvasNodeData): CanvasNodeData {
    return { ...node, metadata: clearImageTaskRecovery(node.metadata || {}) };
}

export function createCanvasImageSubmissionHandlers(dependencies: {
    prepare: (node: CanvasNodeData) => CanvasNodeData;
    requestGeneration: (node: CanvasNodeData) => Promise<unknown>;
    requestEdit: (node: CanvasNodeData) => Promise<unknown>;
}) {
    return {
        generate: (node: CanvasNodeData) => dependencies.requestGeneration(dependencies.prepare(node)),
        edit: (node: CanvasNodeData) => dependencies.requestEdit(dependencies.prepare(node)),
    };
}
