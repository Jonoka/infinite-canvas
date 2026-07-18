import type { AiConfig } from "@/stores/use-config-store";
import type { PricingPayload } from "@/lib/image-pricing";
import type { LiteToProFallback } from "@/lib/lite-pro-fallback";
import { createImageWorkbenchActions } from "@/pages/image/image-generation-actions";

type CanvasImageDependencies<T> = {
    request: (prompt: string, config: AiConfig) => Promise<T>;
    requestConsent?: (input: unknown) => Promise<(Pick<LiteToProFallback, "model" | "group" | "count"> & Partial<LiteToProFallback>) | null>;
    loadPricing?: (config: AiConfig) => Promise<PricingPayload | null>;
};

export function createCanvasImageActions<T>(dependencies: CanvasImageDependencies<T>) {
    const actions = createImageWorkbenchActions(dependencies);
    return {
        run: (surface: string, config: AiConfig, prompts: string[]) => actions.generateBatch(config, prompts.map((prompt) => prompt || surface)),
    };
}
