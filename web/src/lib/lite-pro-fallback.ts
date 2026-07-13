import { calculateImageCost, type ImageCost, type PricingPayload } from "./image-pricing";

const LITE_MODEL = "gpt-image-2-lite";
const PRO_MODEL = "gpt-image-2-pro";
const LITE_POOL_EXHAUSTED = "lite_pool_exhausted";

export class ImageRequestError extends Error {
    apiCode?: string;

    constructor(message: string, apiCode?: string) {
        super(message);
        this.name = "ImageRequestError";
        this.apiCode = apiCode;
    }
}

export function liteToProFallbackError(message: string, apiCode?: string) {
    return new ImageRequestError(message, apiCode);
}

export function isLitePoolExhaustedError(error: unknown) {
    return error instanceof ImageRequestError && error.apiCode === LITE_POOL_EXHAUSTED;
}

export type LiteToProFallback = {
    model: typeof PRO_MODEL;
    group: string;
    quality: "low";
    size: string;
    count: number;
    switchesToAuto: boolean;
    cost: ImageCost | null;
};

export function buildLiteToProFallback(input: {
    apiMode: string;
    model: string;
    group: string;
    size: string;
    pricing: PricingPayload | null;
    pricingAvailable?: boolean;
    count: number;
}): LiteToProFallback | null {
    const model = input.model.split("::").at(-1)?.trim().toLowerCase();
    if (input.apiMode !== "newapi" || model !== LITE_MODEL) return null;
    const count = Math.max(1, Math.floor(input.count));
    const pro = input.pricing?.data.find((item) => item.model_name === PRO_MODEL);
    const fixedGroupSupportsPro = Boolean(pro && (pro.enable_groups.includes("all") || pro.enable_groups.includes(input.group)));
    const groupSupportKnown = input.pricingAvailable ?? input.pricing !== null;
    const switchesToAuto = input.group !== "auto" && (!groupSupportKnown || !fixedGroupSupportsPro);
    const group = switchesToAuto ? "auto" : input.group;
    return {
        model: PRO_MODEL,
        group,
        quality: "low",
        size: input.size,
        count,
        switchesToAuto,
        cost: input.pricing ? calculateImageCost(input.pricing, PRO_MODEL, group, count) : null,
    };
}
