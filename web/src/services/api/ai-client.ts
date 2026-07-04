import type { AxiosRequestConfig } from "axios";

import { buildApiUrl, isNewApiMode, type AiConfig } from "@/stores/use-config-store";

export function aiApiUrl(config: AiConfig, path: string) {
    const url = new URL(buildApiUrl(isNewApiMode(config) ? normalizeNewApiCanvasBaseUrl(config.baseUrl) : config.baseUrl, path));
    if (isNewApiMode(config)) url.searchParams.set("group", config.group.trim());
    return url.toString();
}

function normalizeNewApiCanvasBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl.trim());
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        if (lowerPath === "") url.pathname = "/canvas";
        else if (lowerPath === "/v1") url.pathname = "/canvas/v1";
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}

export function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        ...(isNewApiMode(config) ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export function aiRequestOptions(config: AiConfig, options?: AxiosRequestConfig): AxiosRequestConfig {
    return {
        ...options,
        headers: {
            ...aiHeaders(config),
            ...(options?.headers || {}),
        },
        withCredentials: isNewApiMode(config) || options?.withCredentials,
    };
}

export function assertAiConfig(config: AiConfig, model: string, capability: string) {
    if (!model) throw new Error(`请先配置${capability}模型`);
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (isNewApiMode(config)) {
        if (!config.group.trim()) throw new Error("请先配置 New API 分组");
        return;
    }
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
}
