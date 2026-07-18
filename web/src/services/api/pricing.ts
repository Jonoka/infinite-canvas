import type { AiConfig } from "@/stores/use-config-store";

export function buildPricingRequest(config: AiConfig, signal?: AbortSignal) {
    const url = new URL(config.baseUrl.trim());
    url.pathname = "/canvas/v1/pricing";
    url.search = "";
    url.hash = "";
    url.searchParams.set("group", config.group.trim());
    return { url: url.toString(), options: { method: "GET", signal, credentials: "include" as RequestCredentials, withCredentials: true } };
}

export const pricingRequestTransport = { buildRequest: buildPricingRequest };

export async function fetchPricing(config: AiConfig, options?: { signal?: AbortSignal; fetch?: typeof fetch }) {
    const request = pricingRequestTransport.buildRequest(config, options?.signal);
    const response = await (options?.fetch || fetch)(request.url, request.options);
    if (!response.ok) throw new Error(`读取图片价格失败：${response.status}`);
    return response.json();
}
