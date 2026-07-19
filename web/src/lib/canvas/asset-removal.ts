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

let removalQueue: Promise<void> = Promise.resolve();
function enqueueRemoval<T>(operation: () => Promise<T>) {
    const result = removalQueue.then(operation, operation);
    removalQueue = result.then(() => undefined, () => undefined);
    return result;
}

export async function confirmAssetRemoval(input: {
    assetId: string;
    getAssets: () => readonly unknown[];
    getProjects: () => readonly unknown[];
    removeAssetMetadata: (assetId: string) => void | Promise<void>;
    deleteStoredImages: (keys: Iterable<string>) => Promise<void>;
    deleteStoredMedia: (keys: Iterable<string>) => Promise<void>;
}) {
    const plan = planAssetRemoval(input.assetId, input.getAssets(), input.getProjects());
    await input.removeAssetMetadata(input.assetId);
    if (!plan.storageKey) return plan;
    await enqueueRemoval(async () => {
        // GC deliberately uses the latest snapshots, after metadata removal and immediately before Blob deletion.
        const stillReferenced = input.getAssets().some((asset) => storageKeyOf(asset) === plan.storageKey)
            || input.getProjects().some((project) => containsStorageKey(project, plan.storageKey!));
        if (stillReferenced) return;
        if (plan.kind === "image") await input.deleteStoredImages([plan.storageKey!]);
        else if (plan.kind === "video") await input.deleteStoredMedia([plan.storageKey!]);
    });
    return plan;
}
