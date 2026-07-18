import type { AxiosRequestConfig } from "axios";
import { buildApiUrl, isNewApiMode, type AiConfig } from "@/stores/use-config-store";

function newApiBase(base: string) {
    const url = new URL(base.trim());
    url.pathname = "/canvas/v1";
    return url;
}

export function aiApiUrl(config: AiConfig, path: string) {
    if (!isNewApiMode(config)) return new URL(buildApiUrl(config.baseUrl, path)).toString();
    const parsedPath = new URL(path, "https://placeholder.invalid");
    const url = newApiBase(config.baseUrl);
    url.pathname = `${url.pathname}${parsedPath.pathname}`;
    parsedPath.searchParams.forEach((value, key) => url.searchParams.set(key, value));
    url.searchParams.set("group", config.group.trim());
    return url.toString();
}

export function aiHeaders(config: AiConfig, contentType?: string) {
    return { ...(isNewApiMode(config) ? {} : { Authorization: `Bearer ${config.apiKey.trim()}` }), ...(contentType ? { "Content-Type": contentType } : {}) };
}

export function normalizeHeaders(headers: AxiosRequestConfig["headers"] | HeadersInit | undefined): Record<string, string> {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (typeof (headers as { forEach?: unknown }).forEach === "function") {
        const result: Record<string, string> = {};
        (headers as Headers).forEach((value, key) => { result[key] = value; });
        return result;
    }
    if (typeof (headers as { toJSON?: () => Record<string, unknown> }).toJSON === "function") {
        return Object.fromEntries(Object.entries((headers as { toJSON: () => Record<string, unknown> }).toJSON()).map(([key, value]) => [key, String(value)]));
    }
    return Object.fromEntries(Object.entries(headers as Record<string, string | number | boolean>).map(([key, value]) => [key, String(value)]));
}

function withoutAuthorization(headers: AxiosRequestConfig["headers"] | HeadersInit | undefined) {
    const result = new Headers(normalizeHeaders(headers));
    result.forEach((_value, key) => { if (key.toLowerCase() === "authorization") result.delete(key); });
    return result;
}

export function aiRequestOptions(config: AiConfig, options?: AxiosRequestConfig): AxiosRequestConfig {
    const headers = isNewApiMode(config) ? withoutAuthorization(options?.headers) : new Headers({ ...aiHeaders(config), ...normalizeHeaders(options?.headers) });
    return { ...options, headers: Object.fromEntries(headers.entries()), withCredentials: isNewApiMode(config) ? true : options?.withCredentials };
}

export function aiFetchOptions(config: AiConfig, options?: RequestInit): RequestInit {
    const headers = isNewApiMode(config) ? withoutAuthorization(options?.headers) : new Headers({ ...aiHeaders(config), ...normalizeHeaders(options?.headers) });
    return { ...options, headers, credentials: isNewApiMode(config) ? "include" : options?.credentials };
}

export function assertAiConfig(config: AiConfig, model: string, capability: string) {
    if (!model.trim()) throw new Error(`请先配置${capability}模型`);
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (isNewApiMode(config)) {
        if (config.apiFormat !== "openai") throw new Error("New API 仅支持 OpenAI 格式");
        if (!config.group.trim()) throw new Error("请先配置 New API 分组");
    } else if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
}
