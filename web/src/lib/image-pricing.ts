export type PricingModel = {
    model_name: string;
    quota_type: number;
    model_price: number;
    enable_groups: string[];
};

export type PricingPayload = {
    success: boolean;
    data: PricingModel[];
    group_ratio: Record<string, number>;
    auto_groups: string[];
};

export type ImageCost = { cost: number; group: string };

export function formatImageCost(cost: number) {
    return `$${cost.toFixed(2)}`;
}

export function calculateImageCost(payload: PricingPayload, selectedModel: string, selectedGroup: string, count: number): ImageCost | null {
    if (!payload.success || !Array.isArray(payload.data) || !payload.group_ratio || !Array.isArray(payload.auto_groups)) return null;
    const modelName = selectedModel.split("::").at(-1) || selectedModel;
    const model = payload.data.find((item) => item.model_name === modelName);
    if (!model || model.quota_type !== 1 || !Number.isFinite(model.model_price)) return null;

    const enabledGroups = Array.isArray(model.enable_groups) ? model.enable_groups : [];
    const allowsAll = enabledGroups.includes("all");
    const group = selectedGroup === "auto" ? payload.auto_groups.find((item) => allowsAll || enabledGroups.includes(item)) : selectedGroup;
    if (!group || group === "auto" || (!allowsAll && !enabledGroups.includes(group))) return null;

    const ratio = payload.group_ratio[group];
    const normalizedCount = Math.floor(count);
    if (!Number.isFinite(ratio) || ratio < 0 || model.model_price < 0 || !Number.isFinite(normalizedCount) || normalizedCount < 1) return null;
    return { cost: Number((model.model_price * ratio * normalizedCount).toFixed(12)), group };
}
