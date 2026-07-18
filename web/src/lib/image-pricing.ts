export type PricingPayload = {
    success?: boolean;
    code?: string | number;
    data?: unknown;
    group_ratio?: Record<string, unknown>;
    auto_groups?: unknown;
};

export type ImageCost = { cost: number; group: string };

type PricingModel = { model_name?: unknown; quota_type?: unknown; model_price?: unknown; enable_groups?: unknown };

function finiteNonnegative(value: unknown) {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

function unwrap(payload: PricingPayload) {
    if (payload.success === false || (payload.code !== undefined && payload.code !== 0 && payload.code !== "0")) return null;
    const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : null;
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(nested?.data) ? nested.data : Array.isArray(nested?.models) ? nested.models : null;
    const ratios = (nested?.group_ratio || payload.group_ratio) as Record<string, unknown> | undefined;
    const autoGroups = nested?.auto_groups || payload.auto_groups;
    return rows && ratios && Array.isArray(autoGroups) ? { rows: rows as PricingModel[], ratios, autoGroups } : null;
}

export function calculateImageCost(payload: PricingPayload, selectedModel: string, requestedGroup: string, count: number): ImageCost | null {
    const pricing = unwrap(payload);
    const modelName = selectedModel.includes("::") ? selectedModel.slice(selectedModel.indexOf("::") + 2) : selectedModel;
    if (!pricing || !Number.isInteger(count) || count < 1) return null;
    const matching = pricing.rows.filter((row) => row?.model_name === modelName);
    if (matching.length !== 1) return null;
    const row = matching[0];
    if (Number(row.quota_type) !== 1 || !Array.isArray(row.enable_groups)) return null;
    const price = finiteNonnegative(row.model_price);
    const enabled = row.enable_groups.filter((group): group is string => typeof group === "string");
    const group = requestedGroup === "auto" ? pricing.autoGroups.find((candidate): candidate is string => typeof candidate === "string" && enabled.includes(candidate)) : requestedGroup;
    if (price === null || !group || !enabled.includes(group)) return null;
    const ratio = finiteNonnegative(pricing.ratios[group]);
    if (ratio === null) return null;
    const cost = Math.round((price * ratio * count + Number.EPSILON) * 1e12) / 1e12;
    return { cost, group };
}

export async function loadImageCostPreview(input: { model: string; group: string; count: number; fetchPricing: () => Promise<PricingPayload> }) {
    try {
        const cost = calculateImageCost(await input.fetchPricing(), input.model, input.group, input.count);
        return cost ? { available: true as const, cost } : { available: false as const, cost: null, reason: "unsupported" as const };
    } catch {
        return { available: false as const, cost: null, reason: "fetch_failed" as const };
    }
}
