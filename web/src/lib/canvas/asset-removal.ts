export type AssetRemovalPlan = { assetId: string; storageKey?: string; kind?: string; referencedByCanvas: boolean; referencedByOtherAsset: boolean };

type AssetLike = { id?: unknown; kind?: unknown; data?: unknown };
function asAsset(value: unknown): AssetLike | undefined { return value && typeof value === "object" ? value as AssetLike : undefined; }
function storageKeyOf(value: unknown) {
    const asset = asAsset(value);
    const data = asset?.data && typeof asset.data === "object" ? asset.data as { storageKey?: unknown } : undefined;
    return typeof data?.storageKey === "string" ? data.storageKey : undefined;
}
function containsStorageKey(value: unknown, storageKey: string): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((item) => containsStorageKey(item, storageKey));
    return Object.values(value).some((item) => item === storageKey || containsStorageKey(item, storageKey));
}

export function planAssetRemoval(assetId: string, assets: readonly unknown[], projects: readonly unknown[]): AssetRemovalPlan {
    const asset = assets.map(asAsset).find((item) => item?.id === assetId);
    const storageKey = storageKeyOf(asset);
    const referencedByOtherAsset = Boolean(storageKey && assets.some((item) => asAsset(item)?.id !== assetId && storageKeyOf(item) === storageKey));
    return {
        assetId,
        storageKey,
        kind: typeof asset?.kind === "string" ? asset.kind : undefined,
        referencedByCanvas: Boolean(storageKey && projects.some((project) => containsStorageKey(project, storageKey))),
        referencedByOtherAsset,
    };
}
