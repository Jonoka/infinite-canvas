import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { fetchPricing } from "@/services/api/pricing";
import { retryLitePoolFailureWithConsent, retryLitePoolFailuresWithConsent } from "@/lib/image-paid-fallback-orchestrator";
import { applyLiteToProRequestOverride, buildLiteToProFallback, isLitePoolExhaustedError, type LiteToProFallback } from "@/lib/lite-pro-fallback";
import { confirmLiteToProFallback } from "@/lib/lite-pro-fallback-consent";
import type { PricingPayload } from "@/lib/image-pricing";

type RequestFallback = Pick<LiteToProFallback, "model" | "group" | "count"> & Partial<LiteToProFallback>;
type Dependencies<T> = {
    request: (prompt: string, config: AiConfig, index?: number) => Promise<T>;
    requestConsent?: (input: unknown) => Promise<RequestFallback | null>;
    loadPricing?: (config: AiConfig) => Promise<PricingPayload | null>;
};

function applyFallback(config: AiConfig, fallback: RequestFallback) {
    return applyLiteToProRequestOverride(config, {
        quality: "low", size: config.size, switchesToAuto: fallback.group === "auto" && config.group !== "auto", cost: null,
        ...fallback,
    } as LiteToProFallback);
}

async function defaultConsent(config: AiConfig, count: number, loadPricing?: Dependencies<unknown>["loadPricing"]) {
    let pricing: PricingPayload | null = null;
    let pricingAvailable = false;
    try {
        pricing = loadPricing ? await loadPricing(config) : await fetchPricing(config) as PricingPayload;
        pricingAvailable = Boolean(pricing);
    } catch { /* price availability must not create standing consent or block an explicit choice */ }
    const fallback = buildLiteToProFallback({ apiMode: config.apiMode, model: config.model, group: config.group, size: config.size, pricing, pricingAvailable, count });
    if (!fallback) return null;
    const accepted = await confirmLiteToProFallback({ failedCount: count, fromGroup: config.group, toGroup: fallback.group, switchesToAuto: fallback.switchesToAuto, cost: fallback.cost, pricingAvailable });
    return accepted ? fallback : null;
}

export function createImageWorkbenchActions<T>(dependencies: Dependencies<T>) {
    const resolve = (config: AiConfig) => {
        const resolved = config.channelId ? config : resolveModelRequestConfig(config, (config.imageModel || config.model).trim());
        return { ...resolved, imageModel: resolved.model };
    };
    const consent = async (config: AiConfig, count: number, failedIndexes: number[]) => {
        if (!dependencies.requestConsent) return defaultConsent(config, count, dependencies.loadPricing);
        let pricing: PricingPayload | null = null;
        try { pricing = dependencies.loadPricing ? await dependencies.loadPricing(config) : await fetchPricing(config) as PricingPayload; } catch { /* explicit consent remains available without a quote */ }
        return dependencies.requestConsent({ config, count, failedIndexes, pricing });
    };
    const retryBatch = async (config: AiConfig, prompts: string[], results: PromiseSettledResult<T>[]) => {
        const resolved = resolve(config);
        return retryLitePoolFailuresWithConsent({
            results,
            isEligible: isLitePoolExhaustedError,
            confirm: ({ count, failedIndexes }) => consent(resolved, count, failedIndexes),
            retry: (index, fallback) => dependencies.request(prompts[index], applyFallback(resolved, fallback), index),
        });
    };
    return {
        generateBatch: async (config: AiConfig, prompts: string[], results?: PromiseSettledResult<T>[]) => {
            const resolved = resolve(config);
            return retryBatch(resolved, prompts, results || await Promise.allSettled(prompts.map((prompt, index) => dependencies.request(prompt, resolved, index))));
        },
        retrySlot: async (config: AiConfig, prompt: string, result?: PromiseSettledResult<T>) => {
            const resolved = resolve(config);
            return retryLitePoolFailureWithConsent({
                result: result || await dependencies.request(prompt, resolved).then((value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<T>, (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult),
                isEligible: isLitePoolExhaustedError,
                confirm: ({ count, failedIndexes }) => consent(resolved, count, failedIndexes),
                retry: (_index, fallback) => dependencies.request(prompt, applyFallback(resolved, fallback)),
            });
        },
    };
}
