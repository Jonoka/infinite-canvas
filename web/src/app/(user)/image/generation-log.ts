import type { AiConfig } from "@/stores/use-config-store";
import type { ImageTaskAcceptance } from "@/services/api/image";
import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    actualModel?: string;
    actualGroup?: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "interrupted";
    image?: GeneratedImage;
    error?: string;
    durationMs?: number;
    waitStartedAt?: number;
    task?: ImageTaskAcceptance & Pick<AiConfig, "baseUrl" | "apiMode">;
};

export type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "group" | "quality" | "size" | "count" | "imageAsync">;

export type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "成功" | "失败" | "生成中" | "等待查询";
    images: GeneratedImage[];
    thumbnails: string[];
    results?: GenerationResult[];
};

export function generationLogResults(log: Pick<GenerationLog, "results" | "images">): GenerationResult[] {
    return log.results ?? log.images.map((image) => ({ id: image.id, status: "success", image }));
}

export function interruptGenerationResults(results: GenerationResult[], error?: string): GenerationResult[] {
    return results.map((result) =>
        result.status === "pending"
            ? {
                  ...result,
                  status: "interrupted",
                  waitStartedAt: undefined,
                  durationMs: (result.durationMs || 0) + (result.waitStartedAt ? Math.max(0, Date.now() - result.waitStartedAt) : 0),
                  error: error || (result.task?.recoverable ? "等待已中断，任务状态待查询" : "等待已中断，未保存可恢复任务"),
              }
            : result,
    );
}

export function summarizeGenerationLog(log: GenerationLog, results: GenerationResult[]): GenerationLog {
    const images = results.flatMap((result) => (result.status === "success" && result.image ? [result.image] : []));
    const failed = results.filter((result) => result.status === "failed").length;
    return {
        ...log,
        results,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        successCount: images.length,
        failCount: failed,
        durationMs: Math.max(log.durationMs, ...results.map((result) => result.durationMs || result.image?.durationMs || 0)),
        status: results.some((result) => result.status === "pending") ? "生成中" : results.some((result) => result.status === "interrupted") ? "等待查询" : images.length ? "成功" : "失败",
    };
}

export function updateGenerationResult(log: GenerationLog, id: string, patch: Partial<GenerationResult>): GenerationLog {
    return summarizeGenerationLog(
        log,
        generationLogResults(log).map((result) => (result.id === id ? { ...result, ...patch } : result)),
    );
}

// Slot callbacks finish independently; writes to one batch must retain their order.
export function createGenerationLogWriter(write: (id: string, log: GenerationLog | null) => Promise<unknown>) {
    const pending = new Map<string, Promise<unknown>>();
    const enqueue = (id: string, log: GenerationLog | null) => {
        const operation = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(() => write(id, log));
        pending.set(id, operation);
        const cleanup = () => {
            if (pending.get(id) === operation) pending.delete(id);
        };
        void operation.then(cleanup, cleanup);
        return operation;
    };
    return Object.assign(enqueue, {
        flush: async () => {
            await Promise.allSettled(pending.values());
        },
    });
}
