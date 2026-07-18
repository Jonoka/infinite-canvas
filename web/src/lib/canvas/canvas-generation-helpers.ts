import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { normalizeVideoReferences } from "@/lib/canvas/video-reference-normalization";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export function generationVideoReferences(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string; role?: string; component?: string; order?: number }>; referenceAudios?: Array<{ storageKey?: string; url?: string; role?: string; component?: string; order?: number }> }) {
    return normalizeVideoReferences([
        ...context.referenceImages.map((item) => ({ kind: "image" as const, url: referenceUrl(item) || "", role: (item as ReferenceImage & { role?: string }).role, component: (item as ReferenceImage & { component?: string }).component, order: (item as ReferenceImage & { order?: number }).order })),
        ...context.referenceVideos.map((item) => ({ kind: "video" as const, url: item.storageKey || item.url || "", role: item.role || "reference_video", component: item.component, order: item.order })),
        ...(context.referenceAudios || []).map((item) => ({ kind: "audio" as const, url: item.storageKey || item.url || "", role: item.role || "reference_audio", component: item.component, order: item.order })),
    ].filter((item) => Boolean(item.url)));
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    return {
        ...config,
        model: node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return resetInterruptedImageGeneration(nodes);
}

const imageTaskRecoveryKeys = ["taskId", "taskContentIndex", "taskRecoverable", "taskApiMode", "taskModel", "taskGroup", "taskChannelId", "taskBaseUrl"] as const;
type ImageTaskRecoveryKey = typeof imageTaskRecoveryKeys[number];
type ImageTaskRecoveryMetadata = Pick<CanvasNodeMetadata, ImageTaskRecoveryKey>;
type ImageTaskRequest = { method: "GET" | "POST"; path: string };

export function shouldRecoverImageTask(node: CanvasNodeData) {
    const metadata = node.metadata;
    return node.type === CanvasNodeType.Image && metadata?.status === "error" && metadata.taskRecoverable === true && metadata.taskApiMode === "newapi" && typeof metadata.taskId === "string" && Boolean(metadata.taskId.trim());
}

export function imageRetryActionLabel(node: CanvasNodeData) {
    return shouldRecoverImageTask(node) ? "重新获取成品" : "重试";
}

export function canvasNodeRetryLabel(node: CanvasNodeData) {
    return shouldRecoverImageTask(node)
        ? { kind: "recover" as const, label: "重新获取成品" }
        : { kind: "regenerate" as const, label: "重试" };
}

export function resetInterruptedImageGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading") return node;
        const recoverable = node.type === CanvasNodeType.Image && node.metadata.taskRecoverable === true && node.metadata.taskApiMode === "newapi" && Boolean(node.metadata.taskId?.trim());
        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: recoverable ? "页面刷新后生成已中断，可重新获取成品。" : "页面刷新后生成已中断，请重新生成。" } };
    });
}

export function clearImageTaskRecovery<T extends Partial<Record<ImageTaskRecoveryKey, unknown>>>(metadata: T): Omit<T, ImageTaskRecoveryKey> {
    const result: Record<string, unknown> = { ...metadata };
    for (const key of imageTaskRecoveryKeys) delete result[key];
    return result as Omit<T, ImageTaskRecoveryKey>;
}

export function buildImageRetryPlan(node: CanvasNodeData): { kind: "recover" | "regenerate"; requests: ImageTaskRequest[] } {
    if (!shouldRecoverImageTask(node)) return { kind: "regenerate", requests: [] };
    const id = encodeURIComponent(node.metadata!.taskId!.trim());
    const index = Number.isInteger(node.metadata!.taskContentIndex) && node.metadata!.taskContentIndex! >= 0 ? node.metadata!.taskContentIndex! : 0;
    return { kind: "recover", requests: [{ method: "GET", path: `/images/tasks/${id}` }, { method: "GET", path: `/images/tasks/${id}/content/${index}` }] };
}

export function resolveImageTaskRecoveryConfig(input: { node: CanvasNodeData; currentConfig: AiConfig }): AiConfig {
    const metadata = input.node.metadata;
    if (!shouldRecoverImageTask(input.node) || !metadata?.taskBaseUrl || !metadata.taskChannelId || !metadata.taskModel) {
        throw new Error("图片任务缺少可恢复的来源信息");
    }
    let provenance: URL;
    try { provenance = new URL(metadata.taskBaseUrl.trim()); } catch { throw new Error("图片任务来源 URL 无效"); }
    const credentialQuery = Array.from(provenance.searchParams.keys()).some((key) => /^(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)$/i.test(key));
    if (!["http:", "https:"].includes(provenance.protocol) || provenance.username || provenance.password || credentialQuery) throw new Error("图片任务来源 URL 包含无效协议或凭据");
    const channel = input.currentConfig.channels.find((item) => item.id === metadata.taskChannelId);
    if (!channel) throw new Error("图片任务原渠道已不存在，无法安全恢复凭据");
    return {
        ...input.currentConfig,
        channelId: metadata.taskChannelId,
        apiMode: metadata.taskApiMode!,
        apiFormat: "openai",
        baseUrl: provenance.toString().replace(/\/$/, ""),
        apiKey: channel.apiKey,
        model: metadata.taskModel,
        imageModel: metadata.taskModel,
        group: metadata.taskGroup || "",
    };
}

export async function persistAcceptedImageTask(input: {
    nodes: CanvasNodeData[];
    nodeId: string;
    acceptance: Required<ImageTaskRecoveryMetadata>;
    writeNodes: (nodes: CanvasNodeData[]) => void | Promise<void>;
    flush: () => Promise<void>;
}) {
    const nodes = input.nodes.map((node) => node.id === input.nodeId ? { ...node, metadata: { ...node.metadata, ...input.acceptance } } : node);
    await input.writeNodes(nodes);
    await input.flush();
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}

export const __test__ = { shouldRecoverImageTask, imageRetryActionLabel, resetInterruptedImageGeneration, clearImageTaskRecovery, buildImageRetryPlan, persistAcceptedImageTask, resolveImageTaskRecoveryConfig };
