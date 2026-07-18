import axios from "axios";

import { assertModelCapability, resolveModelRequestConfig, resolveModelScript, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { aiApiUrl, aiFetchOptions, aiRequestOptions, assertAiConfig } from "./ai-client";
import { normalizePluginImages, runModelPlugin } from "./model-plugin";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>> | Record<string, unknown> | null;
    result?: { data?: Array<Record<string, unknown>> | null } | null;
    error?: { message?: string };
    code?: string | number;
    msg?: string;
    id?: string;
    task_id?: string;
    status?: string;
    retry_after?: number;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
export type ImageTaskAcceptance = {
    taskId: string;
    contentIndex: number;
    apiMode: "newapi" | "direct";
    model: string;
    group: string;
    channelId: string;
    baseUrl: string;
    recoverable: boolean;
};
export type RequestOptions = {
    signal?: AbortSignal;
    onTaskAccepted?: (task: ImageTaskAcceptance) => void | Promise<void>;
    transport?: (request: { url: string; method: string; body: unknown }) => Promise<unknown>;
};
type ImageResult = { id: string; dataUrl: string };

export class ImageRequestError extends Error {
    constructor(message: string, public readonly code?: string | number) {
        super(message);
        this.name = "ImageRequestError";
    }
}

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
const GPT_IMAGE_RATIO_SIZE_MAP: Record<string, Record<string, string>> = {
    auto: { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536", "4:3": "1152x864", "3:4": "864x1152", "5:4": "1120x896", "4:5": "896x1120", "16:9": "1280x720", "9:16": "720x1280", "21:9": "1456x624" },
    low: { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536", "4:3": "1152x864", "3:4": "864x1152", "5:4": "1120x896", "4:5": "896x1120", "16:9": "1280x720", "9:16": "720x1280", "21:9": "1456x624" },
    medium: { "1:1": "2048x2048", "3:2": "2496x1664", "2:3": "1664x2496", "4:3": "2304x1728", "3:4": "1728x2304", "5:4": "2240x1792", "4:5": "1792x2240", "16:9": "2560x1440", "9:16": "1440x2560", "21:9": "3024x1296" },
    high: { "1:1": "2880x2880", "3:2": "3504x2336", "2:3": "2336x3504", "4:3": "3264x2448", "3:4": "2448x3264", "5:4": "3200x2560", "4:5": "2560x3200", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648" },
};

function isGptImageModel(model: string | undefined) {
    return /^(?:gpt-image-2|gpt-image-2-lite|gpt-image-2-pro)$/i.test((model || "").trim());
}

function isGptImageLiteModel(model: string | undefined) {
    return (model || "").trim().toLowerCase() === "gpt-image-2-lite";
}

function imageRatio(size: string) {
    const value = size.trim();
    if (value.includes(":")) return value;
    const dimensions = parseImageDimensions(value);
    if (!dimensions) return undefined;
    const divisor = greatestCommonDivisor(dimensions.width, dimensions.height);
    return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
    return right ? greatestCommonDivisor(right, left % right) : left;
}

const LITE_RATIO_HINT = /(?:\n\n)?输出必须采用 \d+(?:\.\d+)?:\d+(?:\.\d+)? (?:横向|竖向|方形)构图，目标宽高比严格为 \d+(?:\.\d+)?:\d+(?:\.\d+)?；实际像素可由模型决定。\s*$/;

function withLiteRatioHint(model: string | undefined, prompt: string, size: string) {
    if (!isGptImageLiteModel(model)) return prompt;
    if (!size.includes(":")) return prompt;
    const ratio = imageRatio(size);
    if (!ratio) return prompt;
    const dimensions = ratio.split(":").map(Number);
    const orientation = dimensions[0] === dimensions[1] ? "方形" : dimensions[0] > dimensions[1] ? "横向" : "竖向";
    return `${prompt.replace(LITE_RATIO_HINT, "").trimEnd()}\n\n输出必须采用 ${ratio} ${orientation}构图，目标宽高比严格为 ${ratio}；实际像素可由模型决定。`;
}

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GEMINI_IMAGE_SIZE_BY_QUALITY: Record<string, string> = { low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K" };

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Only "transparent" is forwarded; any other value (incl. empty) means keep the default opaque background. */
function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveRequestSize(quality: string | undefined, size: string, model?: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) {
        if (isGptImageModel(model)) {
            const preset = GPT_IMAGE_RATIO_SIZE_MAP[quality || "auto"]?.[value];
            if (preset) return preset;
        }
        return resolveSize(quality, value);
    }
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = config.size.trim();
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = supportsGeminiImageSize(config.model) ? resolveGeminiImageSize(config.quality, dimensions) : undefined;
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { responseFormat: { image } } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(quality: string, dimensions: { width: number; height: number } | null) {
    const normalizedQuality = normalizeQuality(quality);
    if (normalizedQuality) return GEMINI_IMAGE_SIZE_BY_QUALITY[normalizedQuality];
    if (!dimensions) return undefined;
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function supportsGeminiImageSize(model: string) {
    const value = model.toLowerCase();
    return value.includes("gemini-3") || value.includes("3.1") || value.includes("3-pro");
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse): ImageResult[] {
    assertNoImageTaskError(payload, "请求失败");
    const data = Array.isArray(payload.data) ? payload.data : payload.result && Array.isArray(payload.result.data) ? payload.result.data : [];
    const images = data
        .map(resolveImageDataUrl)
        .filter((value): value is string => Boolean(value))
        .map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) throw new Error("接口没有返回图片");
    return images;
}

type ImageTaskContext = {
    apiMode: "newapi" | "direct";
    model: string;
    group: string;
    channelId: string;
    baseUrl: string;
    kind: "generation" | "edit";
};

function upstreamImageTaskError(payload: unknown, fallback: string) {
    const value = isRecord(payload) ? payload : {};
    const nested = imageTaskErrorEnvelope(value);
    const code = typeof nested?.code === "string" || typeof nested?.code === "number"
        ? nested.code
        : typeof value.code === "string" || typeof value.code === "number" ? value.code : undefined;
    return new ImageRequestError(stringValue(nested?.message) || stringValue(value.msg) || fallback, code);
}

export const imageRequestErrorFromPayload = upstreamImageTaskError;

function resolveImageRequestConfig(config: AiConfig, override: Partial<Pick<AiConfig, "model" | "group" | "quality" | "size" | "count">> = {}) {
    const selected = (config.imageModel || config.model).trim();
    const resolved = resolveModelRequestConfig(config, selected);
    return { ...resolved, ...override, model: override.model || resolved.model, imageModel: override.model || resolved.model };
}

function imageTaskErrorEnvelope(payload: Record<string, unknown>): Record<string, unknown> | undefined {
    if (isRecord(payload.error)) return payload.error;
    return isRecord(payload.data) ? imageTaskErrorEnvelope(payload.data) : undefined;
}

function assertNoImageTaskError(payload: unknown, fallback: string) {
    if (!isRecord(payload)) return;
    if (imageTaskErrorEnvelope(payload) || (payload.code !== undefined && payload.code !== 0 && payload.code !== "0")) {
        throw upstreamImageTaskError(payload, fallback);
    }
}

function normalizedProvenanceBaseUrl(value: string) {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new ImageRequestError("图片任务来源 URL 无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ImageRequestError("图片任务来源 URL 协议或凭据无效");
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

function successfulEnvelope(payload: unknown, fallback: string) {
    if (!isRecord(payload)) throw new ImageRequestError(fallback);
    assertNoImageTaskError(payload, fallback);
    return isRecord(payload.data) ? payload.data : payload;
}

function extractAcceptedImageTask(payload: unknown, context: ImageTaskContext): ImageTaskAcceptance {
    const value = successfulEnvelope(payload, "图片任务提交失败");
    const id = typeof value.task_id === "string" ? value.task_id : typeof value.id === "string" ? value.id : "";
    if (!id.trim()) throw new ImageRequestError("图片接口没有返回有效任务 ID");
    return {
        taskId: id.trim(), contentIndex: 0, apiMode: context.apiMode, model: context.model, group: context.group,
        channelId: context.channelId, baseUrl: normalizedProvenanceBaseUrl(context.baseUrl), recoverable: context.apiMode === "newapi",
    };
}

async function notifyAcceptedImageTask(payload: unknown, context: ImageTaskContext, onAccepted: (task: ImageTaskAcceptance) => void | Promise<void>) {
    await onAccepted(extractAcceptedImageTask(payload, context));
}

function classifyImageTaskStatus(status: unknown, _apiMode: "newapi" | "direct") {
    const value = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (["success", "succeeded", "completed"].includes(value)) return "success" as const;
    if (["pending", "submitted", "not_start", "queued", "running", "processing", "in_progress"].includes(value)) return "pending" as const;
    if (["failed", "failure", "cancelled", "canceled", "expired"].includes(value)) return "failure" as const;
    throw new ImageRequestError("图片任务状态无效");
}

function unwrapImageTaskStatus(payload: unknown) { return successfulEnvelope(payload, "图片任务查询失败"); }
function parseCompletedImageTask(payload: unknown): ImageResult[] {
    assertNoImageTaskError(payload, "图片任务解析失败");
    const task = unwrapImageTaskStatus(payload);
    return parseImagePayload((isRecord(task.result) ? task.result : task) as ImageApiResponse);
}
function validTaskId(taskId: string) {
    const value = taskId.trim();
    if (!value) throw new ImageRequestError("图片任务 ID 无效");
    return encodeURIComponent(value);
}
function buildImageTaskStatusPath(apiMode: "newapi" | "direct", kind: "generation" | "edit", taskId: string) {
    const id = validTaskId(taskId);
    return apiMode === "newapi" ? `/images/tasks/${id}` : `/images/${kind === "edit" ? "edits" : "generations"}/${id}`;
}
function buildImageTaskContentPath(taskId: string, contentIndex: number) {
    if (!Number.isInteger(contentIndex) || contentIndex < 0) throw new ImageRequestError("图片任务内容索引无效");
    return `/canvas/v1/images/tasks/${validTaskId(taskId)}/content/${contentIndex}`;
}
function validateImageTaskContent(input: { status: number; contentType: string | null; blob: Blob }) {
    if (input.status < 200 || input.status >= 300) throw new ImageRequestError(`图片任务内容请求状态异常：${input.status}`);
    if (!input.contentType?.toLowerCase().startsWith("image/")) throw new ImageRequestError("图片任务内容 MIME 类型无效");
    if (!input.blob.size) throw new ImageRequestError("图片任务返回了空内容");
    return input.blob;
}
function buildImageContentFetchRequest(config: AiConfig, contentUrl: string) {
    const value = contentUrl.trim();
    if (!value || value.startsWith("//")) throw new ImageRequestError("图片内容 URL 协议无效");
    const base = new URL(normalizedProvenanceBaseUrl(config.baseUrl));
    let url: URL;
    try { url = value.startsWith("/") ? new URL(value, base.origin) : new URL(value); } catch { throw new ImageRequestError("图片内容 URL 无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ImageRequestError("图片内容 URL 协议或凭据无效");
    const sameOrigin = url.origin === base.origin;
    const options = aiFetchOptions(config, { method: "GET", credentials: sameOrigin ? "include" : "omit" });
    const headers = new Headers(options.headers);
    headers.delete("Authorization");
    options.headers = headers;
    options.credentials = sameOrigin ? "include" : "omit";
    return { url: url.toString(), options };
}

async function fetchImageTaskContent(input: {
    config: AiConfig;
    contentUrl: string;
    signal?: AbortSignal;
    timeoutMs: number;
    fetcher: typeof fetch;
    setTimer: (callback: () => void, delayMs: number) => unknown;
    clearTimer: (timer: unknown) => void;
}) {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new ImageRequestError("图片任务内容超时配置无效");
    const request = buildImageContentFetchRequest(input.config, input.contentUrl);
    const controller = new AbortController();
    let rejectTimeout!: (error: Error) => void;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const timer = input.setTimer(() => {
        controller.abort();
        rejectTimeout(new ImageRequestError("图片任务内容请求超时"));
    }, input.timeoutMs);
    try {
        const requestSignal = disposableAbortSignal(controller.signal, input.signal);
        const content = input.fetcher(request.url, {
            ...request.options, signal: requestSignal.signal,
        }).then(async (response) => ({
            status: response.status,
            contentType: response.headers.get("content-type"),
            blob: await response.blob(),
        })).finally(requestSignal.dispose);
        return await Promise.race([content, timeout]);
    } finally {
        input.clearTimer(timer);
    }
}

async function resolveSubmittedImageTask(input: {
    submittedPayload: unknown;
    config: AiConfig;
    kind: "generation" | "edit";
    onAccepted: (task: ImageTaskAcceptance) => void | Promise<void>;
    poll: (input: { taskId: string; timeoutMs: number; signal: AbortSignal }) => ImageResult[] | Promise<ImageResult[]>;
    pollTimeoutMs: number;
}) {
    assertNoImageTaskError(input.submittedPayload, "图片任务提交失败");
    // Production passes the exact config resolved before submission. Keep that
    // provenance authoritative; raw pure-seam callers are resolved once here.
    const selected = (input.config.imageModel || input.config.model).trim();
    const resolved = input.config.channelId ? input.config : resolveModelRequestConfig(input.config, selected);
    const context: ImageTaskContext = {
        apiMode: resolved.apiMode, model: resolved.model, group: resolved.group,
        channelId: resolved.channelId || "", baseUrl: resolved.baseUrl, kind: input.kind,
    };
    const task = extractAcceptedImageTask(input.submittedPayload, context);
    await notifyAcceptedImageTask(input.submittedPayload, context, input.onAccepted);
    return input.poll({ taskId: task.taskId, timeoutMs: input.pollTimeoutMs, signal: new AbortController().signal });
}

async function pollImageTask(input: {
    taskId: string;
    timeoutMs: number;
    transport: (input: { taskId: string; timeoutMs: number; signal: AbortSignal }) => unknown | Promise<unknown>;
    setTimer: (callback: () => void, delayMs: number) => unknown;
    clearTimer: (timer: unknown) => void;
}) {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new ImageRequestError("图片任务轮询超时配置无效");
    const controller = new AbortController();
    let rejectTimeout!: (error: Error) => void;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const timer = input.setTimer(() => {
        controller.abort();
        rejectTimeout(new ImageRequestError("图片任务轮询超时"));
    }, input.timeoutMs);
    try {
        return await Promise.race([input.transport({ taskId: input.taskId, timeoutMs: input.timeoutMs, signal: controller.signal }), timeout]);
    } finally {
        input.clearTimer(timer);
    }
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener("abort", abort, { once: true });
    });
}

const IMAGE_POLL_REQUEST_TIMEOUT_MS = 30_000;
function disposableAbortSignal(...values: Array<AbortSignal | undefined>) {
    const signals = values.filter((value): value is AbortSignal => Boolean(value));
    if (signals.length < 2) return { signal: signals[0] || new AbortController().signal, dispose: () => undefined };
    if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any(signals), dispose: () => undefined };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signals.some((signal) => signal.aborted)) abort();
    else signals.forEach((signal) => signal.addEventListener("abort", abort, { once: true }));
    return { signal: controller.signal, dispose: () => signals.forEach((signal) => signal.removeEventListener("abort", abort)) };
}
async function pollSubmittedImageTask(
    config: AiConfig,
    kind: "generation" | "edit",
    input: { taskId: string; timeoutMs: number; signal: AbortSignal },
    options?: RequestOptions,
) : Promise<ImageResult[]> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const callerSignal = disposableAbortSignal(input.signal, options?.signal);
        const response = await pollImageTask({
            taskId: input.taskId, timeoutMs: input.timeoutMs,
            transport: async ({ signal, timeoutMs }) => {
                const requestSignal = disposableAbortSignal(signal, callerSignal.signal);
                try {
                    return await axios.get<unknown>(
                        aiApiUrl(config, buildImageTaskStatusPath(config.apiMode, kind, input.taskId)),
                        aiRequestOptions(config, { signal: requestSignal.signal, timeout: timeoutMs }),
                    );
                } finally { requestSignal.dispose(); }
            },
            setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        }).finally(callerSignal.dispose) as { data: unknown };
        const task = unwrapImageTaskStatus(response.data);
        const state = classifyImageTaskStatus(task.status, config.apiMode);
        if (state === "success") return parseCompletedImageTask(response.data);
        if (state === "failure") throw upstreamImageTaskError(task, "图片生成失败");
        if (attempt === 119) break;
        const retryAfter = Number(task.retry_after);
        const waitSignal = disposableAbortSignal(input.signal, options?.signal);
        await delay(
            Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(5000, Math.max(250, retryAfter * 1000)) : 1500,
            waitSignal.signal,
        ).finally(waitSignal.dispose);
    }
    throw new ImageRequestError("图片生成超时，请稍后重试");
}
async function resolveImageSubmission(config: AiConfig, kind: "generation" | "edit", payload: ImageApiResponse, options?: RequestOptions): Promise<ImageResult[]> {
    const envelope = successfulEnvelope(payload, "图片请求失败");
    if (!("task_id" in envelope) && !("id" in envelope)) return parseImagePayload(envelope as ImageApiResponse);
    return resolveSubmittedImageTask({
        submittedPayload: payload, config, kind, onAccepted: options?.onTaskAccepted || (() => undefined),
        pollTimeoutMs: IMAGE_POLL_REQUEST_TIMEOUT_MS,
        poll: (input) => pollSubmittedImageTask(config, kind, input, options),
    });
}

type RecoveryResolverInput = {
    config: AiConfig;
    taskId: string;
    contentIndex: number;
    resolveStatus: (input: { config: AiConfig; taskId: string }) => unknown | Promise<unknown>;
    resolveContent: (input: { config: AiConfig; contentUrl: string }) => Promise<{ status: number; contentType: string | null; blob: Blob }>;
};
async function recoverImageTaskWithResolvers(input: RecoveryResolverInput) {
    if (input.config.apiMode !== "newapi") throw new ImageRequestError("仅 New API 图片任务支持恢复");
    normalizedProvenanceBaseUrl(input.config.baseUrl);
    const payload = await input.resolveStatus({ config: input.config, taskId: input.taskId });
    const status = unwrapImageTaskStatus(payload);
    const state = classifyImageTaskStatus(status.status, "newapi");
    if (state === "pending") throw new ImageRequestError("图片任务尚未完成，请稍后重试");
    if (state === "failure") throw upstreamImageTaskError(status, "图片生成失败");
    const result = isRecord(status.result) ? status.result : undefined;
    const resultData = Array.isArray(result?.data) ? result.data : [];
    const serverUrl = resultData.map((item) => isRecord(item) ? resolveImageDataUrl(item) : null).find(Boolean);
    const contentUrl = typeof status.content_url === "string" && status.content_url.trim()
        ? status.content_url : serverUrl || buildImageTaskContentPath(input.taskId, input.contentIndex);
    buildImageContentFetchRequest(input.config, contentUrl);
    return validateImageTaskContent(await input.resolveContent({ config: input.config, contentUrl }));
}

export async function recoverImageTask(
    config: AiConfig,
    task: Pick<ImageTaskAcceptance, "taskId" | "contentIndex" | "apiMode" | "model" | "group" | "channelId" | "baseUrl" | "recoverable">,
    options?: Pick<RequestOptions, "signal">,
) {
    if (!task.recoverable || task.apiMode !== "newapi") throw new ImageRequestError("该图片任务不可恢复");
    const channel = config.channels.find((item) => item.id === task.channelId);
    if (!channel) throw new ImageRequestError("图片任务原渠道已不存在，无法安全恢复凭据");
    const savedBaseUrl = normalizedProvenanceBaseUrl(task.baseUrl);
    const configuredBaseUrl = normalizedProvenanceBaseUrl(channel.baseUrl);
    if (savedBaseUrl !== configuredBaseUrl) throw new ImageRequestError("图片任务来源与当前渠道地址不一致，已拒绝发送凭据");
    const requestConfig: AiConfig = {
        ...config,
        channelId: task.channelId,
        apiMode: "newapi",
        apiFormat: "openai",
        baseUrl: savedBaseUrl,
        apiKey: channel.apiKey,
        model: task.model,
        imageModel: task.model,
        group: task.group,
    };
    try {
        return await recoverImageTaskWithResolvers({
            config: requestConfig, taskId: task.taskId, contentIndex: task.contentIndex,
            resolveStatus: async ({ config: used, taskId }) => (await axios.get<unknown>(
                aiApiUrl(used, buildImageTaskStatusPath("newapi", "generation", taskId)),
                aiRequestOptions(used, { signal: options?.signal, timeout: IMAGE_POLL_REQUEST_TIMEOUT_MS }),
            )).data,
            resolveContent: async ({ config: used, contentUrl }) => {
                return fetchImageTaskContent({
                    config: used, contentUrl, signal: options?.signal, timeoutMs: IMAGE_POLL_REQUEST_TIMEOUT_MS, fetcher: fetch,
                    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
                    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
                });
            },
        });
    } catch (error) {
        if (error instanceof ImageRequestError) throw error;
        throw new ImageRequestError(readAxiosError(error, "重新获取图片失败"));
    }
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || readStatusError(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}


function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), aiFetchOptions(config, {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    }));
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
            contents: [{ role: "user", parts }],
        },
        aiRequestOptions(config, { headers: geminiHeaders(config), signal: options?.signal }),
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

function shouldUseAsyncImageRequest(config: Pick<AiConfig, "apiMode" | "model">) {
    return config.apiMode === "newapi" && isGptImageModel(config.model);
}

function buildGenerationRequestBody(config: AiConfig, prompt: string) {
    const quality = isGptImageLiteModel(config.model) ? "low" : normalizeQuality(config.quality);
    const size = config.size;
    const requestSize = resolveRequestSize(quality, size, config.model);
    const background = normalizeBackground(config.background);
    return {
        model: config.model,
        prompt: withLiteRatioHint(config.model, withSystemPrompt(config, prompt), size),
        n: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1))),
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...(background ? { background } : {}),
        ...(shouldUseAsyncImageRequest(config) ? { async: true } : {}),
        response_format: shouldUseAsyncImageRequest(config) ? "url" : "b64_json",
        output_format: IMAGE_OUTPUT_FORMAT,
    };
}

function buildEditFormData(config: AiConfig, prompt: string) {
    const formData = new FormData();
    Object.entries(buildGenerationRequestBody(config, prompt)).forEach(([key, value]) => formData.set(key, String(value)));
    return formData;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<ImageResult[]> {
    const selectedModel = (config.imageModel || config.model).trim();
    assertModelCapability(config, selectedModel, "image", "图像");
    const requestConfig = resolveImageRequestConfig(config, { group: config.group, quality: config.quality, size: config.size, count: config.count });
    assertAiConfig(requestConfig, requestConfig.model, "图像");
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        // Model plugins are authoritative: pass generic normalized inputs, not standard OpenAI model-specific rewrites.
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const background = normalizeBackground(config.background);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, prompt),
                images: [],
                params: { size: requestSize, quality, count: n, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    try {
        const url = aiApiUrl(requestConfig, "/images/generations");
        const body = buildGenerationRequestBody({ ...requestConfig, count: config.count, quality: config.quality, size: config.size, background: config.background }, prompt);
        const payload = options?.transport
            ? await options.transport({ url, method: "POST", body })
            : (await axios.post<ImageApiResponse>(url, body, {
                ...aiRequestOptions(requestConfig, { headers: { "Content-Type": "application/json" }, signal: options?.signal }),
            })).data;
        const images = await resolveImageSubmission(requestConfig, "generation", payload as ImageApiResponse, options);
        return images;
    } catch (error) {
        if (error instanceof ImageRequestError) throw error;
        if (axios.isAxiosError(error)) throw upstreamImageTaskError(error.response?.data, readAxiosError(error, "请求失败"));
        throw new ImageRequestError(readAxiosError(error, "请求失败"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions): Promise<ImageResult[]> {
    const selectedModel = (config.imageModel || config.model).trim();
    assertModelCapability(config, selectedModel, "image", "图像");
    const requestConfig = resolveImageRequestConfig(config, { group: config.group, quality: config.quality, size: config.size, count: config.count });
    assertAiConfig(requestConfig, requestConfig.model, "图像");
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        // Model plugins are authoritative: pass generic normalized inputs, not standard OpenAI model-specific rewrites.
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const background = normalizeBackground(config.background);
        const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, requestPrompt),
                images: refs,
                params: { size: requestSize, quality, count: n, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const formData = buildEditFormData({ ...requestConfig, count: config.count, quality: config.quality, size: config.size, background: config.background }, requestPrompt);
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        const url = aiApiUrl(requestConfig, "/images/edits");
        const payload = options?.transport
            ? await options.transport({ url, method: "POST", body: formData })
            : (await axios.post<ImageApiResponse>(url, formData, aiRequestOptions(requestConfig, { signal: options?.signal }))).data;
        const images = await resolveImageSubmission(requestConfig, "edit", payload as ImageApiResponse, options);
        return images;
    } catch (error) {
        if (error instanceof ImageRequestError) throw error;
        if (axios.isAxiosError(error)) throw upstreamImageTaskError(error.response?.data, readAxiosError(error, "请求失败"));
        throw new ImageRequestError(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const selectedModel = (config.textModel || config.model).trim();
    assertModelCapability(config, selectedModel, "text", "文本");
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertAiConfig(requestConfig, requestConfig.model, "文本");
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        try {
            const answer = await runModelPlugin<string>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta,
            });
            const text = String(answer ?? "").trim() || "没有返回内容";
            if (text === "没有返回内容") onDelta(text);
            return text;
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer = (await requestStreamingResponse(requestConfig, {
            model: requestConfig.model,
            input: toResponseInput(withSystemMessage(requestConfig, messages)),
        }, onDelta, options)).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "apiMode" | "group">) {
    try {
        if (config.apiFormat === "gemini") {
            const geminiConfig = { ...defaultGeminiConfig, ...config } as AiConfig;
            const response = await axios.get<GeminiPayload>(geminiApiUrl(geminiConfig), aiRequestOptions(geminiConfig, { headers: geminiHeaders(geminiConfig) }));
            validateGeminiPayload(response.data);
            const models = response.data.models;
            if (!Array.isArray(models)) throw new Error("接口返回的模型列表格式无效");
            return normalizeDiscoveredModelNames(models.map((model) => typeof model === "object" && model ? (model as { name?: unknown }).name : model).map((name) => typeof name === "string" ? name.replace(/^models\//, "") : name))
                .sort((a: string, b: string) => a.localeCompare(b));
        }
        const modelsUrl = new URL(aiApiUrl(config as AiConfig, "/models"));
        if (config.apiMode === "newapi" && config.group.trim().toLowerCase() === "auto") modelsUrl.searchParams.delete("group");
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(modelsUrl.toString(), aiRequestOptions(config as AiConfig));
        const models = response.data.data;
        if (!Array.isArray(models)) throw new Error("接口返回的模型列表格式无效");
        return normalizeDiscoveredModelNames(models.map((model) => typeof model === "object" && model ? (model as { id?: unknown }).id : model)).sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

function normalizeDiscoveredModelNames(payload: unknown): string[] {
    if (!Array.isArray(payload)) throw new Error("接口返回的模型列表格式无效");
    const names = Array.from(new Set(payload.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
    if (!names.length) throw new Error("接口返回的模型列表为空");
    return names;
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat, apiMode: channel.apiMode, group: channel.group });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};

export const __test__ = {
    buildGenerationRequestBody, buildEditFormData, normalizeDiscoveredModelNames,
    extractAcceptedImageTask, notifyAcceptedImageTask, classifyImageTaskStatus, unwrapImageTaskStatus,
    parseCompletedImageTask, buildImageTaskStatusPath, buildImageTaskContentPath,
    validateImageTaskContent, upstreamImageTaskError, buildImageContentFetchRequest, resolveSubmittedImageTask, resolveImageSubmission,
    fetchImageTaskContent, pollImageTask, recoverImageTask: recoverImageTaskWithResolvers, normalizedProvenanceBaseUrl, disposableAbortSignal, resolveImageRequestConfig,
};
