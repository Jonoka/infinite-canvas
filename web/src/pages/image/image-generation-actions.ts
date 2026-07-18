import type { AiConfig } from "@/stores/use-config-store";
import { fetchPricing } from "@/services/api/pricing";
import { retryLitePoolFailureWithConsent, retryLitePoolFailuresWithConsent } from "@/lib/image-paid-fallback-orchestrator";
import { applyLiteToProRequestOverride, buildLiteToProFallback, isLitePoolExhaustedError, type LiteToProFallback } from "@/lib/lite-pro-fallback";
import { confirmLiteToProFallback } from "@/lib/lite-pro-fallback-consent";
import type { PricingPayload } from "@/lib/image-pricing";

type RequestFallback = Pick<LiteToProFallback, "model" | "group" | "count"> & Partial<LiteToProFallback>;
type Dependencies<T> = {
    request: (prompt: string, config: AiConfig) => Promise<T>;
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
    const consent = (config: AiConfig, count: number, failedIndexes: number[]) => dependencies.requestConsent
        ? dependencies.requestConsent({ config, count, failedIndexes })
        : defaultConsent(config, count, dependencies.loadPricing);
    return {
        generateBatch: async (config: AiConfig, prompts: string[]) => retryLitePoolFailuresWithConsent({
            results: await Promise.allSettled(prompts.map((prompt) => dependencies.request(prompt, config))),
            isEligible: isLitePoolExhaustedError,
            confirm: ({ count, failedIndexes }) => consent(config, count, failedIndexes),
            retry: (index, fallback) => dependencies.request(prompts[index], applyFallback(config, fallback)),
        }),
        retrySlot: async (config: AiConfig, prompt: string) => retryLitePoolFailureWithConsent({
            result: await dependencies.request(prompt, config).then((value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<T>, (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult),
            isEligible: isLitePoolExhaustedError,
            confirm: ({ count, failedIndexes }) => consent(config, count, failedIndexes),
            retry: (_index, fallback) => dependencies.request(prompt, applyFallback(config, fallback)),
        }),
    };
}
