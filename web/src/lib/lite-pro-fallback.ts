import { calculateImageCost, type PricingPayload } from "./image-pricing";
import { ImageRequestError } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";

export { ImageRequestError };

export type LiteToProFallback = {
    model: "gpt-image-2-pro";
    group: string;
    quality: "low";
    size: string;
    count: number;
    switchesToAuto: boolean;
    cost: { cost: number; group: string } | null;
};

export function isLitePoolExhaustedError(error: unknown) {
    return error instanceof ImageRequestError && error.code === "lite_pool_exhausted";
}

export function imageRequestErrorFromPayload(payload: unknown, fallback: string) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : undefined;
    const nested = (value.error && typeof value.error === "object" ? value.error : data?.error && typeof data.error === "object" ? data.error : value) as Record<string, unknown>;
    const code = typeof nested.code === "string" || typeof nested.code === "number" ? nested.code : undefined;
    const message = typeof nested.message === "string" ? nested.message : typeof nested.msg === "string" ? nested.msg : fallback;
    return new ImageRequestError(message, code);
}

export function buildLiteToProFallback(input: { apiMode: string; model: string; group: string; size: string; pricing: PricingPayload | null; pricingAvailable?: boolean; count: number }): LiteToProFallback | null {
    const model = input.model.includes("::") ? input.model.slice(input.model.indexOf("::") + 2) : input.model;
    if (input.apiMode !== "newapi" || model.toLowerCase() !== "gpt-image-2-lite") return null;
    const fixedCost = input.pricing ? calculateImageCost(input.pricing, "gpt-image-2-pro", input.group, input.count) : null;
    const keepsFixed = input.group !== "auto" && Boolean(fixedCost);
    const group = keepsFixed ? input.group : "auto";
    return {
        model: "gpt-image-2-pro", group, quality: "low", size: input.size, count: input.count,
        switchesToAuto: input.group !== "auto" && !keepsFixed,
        cost: input.pricing ? calculateImageCost(input.pricing, "gpt-image-2-pro", group, input.count) : null,
    };
}

export function applyLiteToProRequestOverride(config: AiConfig, fallback: LiteToProFallback): AiConfig {
    return { ...config, model: fallback.model, imageModel: fallback.model, group: fallback.group, quality: fallback.quality, size: fallback.size, count: String(fallback.count) };
}
