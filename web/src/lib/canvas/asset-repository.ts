/** One process-wide queue for every durable asset metadata mutation. */
let mutationQueue: Promise<void> = Promise.resolve();

export function enqueueAssetMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
}

export type AssetRepositoryDependencies<TAsset> = {
    isWriteReady: () => boolean;
    getAssets: () => TAsset[];
    persistAssets: (assets: TAsset[]) => Promise<void>;
    publishAssets: (assets: TAsset[]) => void;
};

export function mutateAssetRepository<TAsset, TResult>(
    dependencies: AssetRepositoryDependencies<TAsset>,
    mutation: (latest: TAsset[]) => { assets: TAsset[]; result: TResult },
) {
    return enqueueAssetMutation(async () => {
        if (!dependencies.isWriteReady()) throw new Error("asset_repository_not_write_ready");
        const next = mutation(dependencies.getAssets());
        await dependencies.persistAssets(next.assets);
        dependencies.publishAssets(next.assets);
        return next.result;
    });
}

export function mergeAssetRepository<TAsset>(
    dependencies: AssetRepositoryDependencies<TAsset>,
    remote: TAsset[],
    merge: (latest: TAsset[], remote: TAsset[]) => TAsset[],
) {
    return mutateAssetRepository(dependencies, (latest) => {
        const assets = merge(latest, remote);
        return { assets, result: assets };
    });
}

export function hydrateAssetRepository<TAsset>(dependencies: {
    loadAssets: () => Promise<{ assets: TAsset[]; requiresPersist: boolean }>;
    persistAssets: (assets: TAsset[]) => Promise<void>;
    publishAssets: (assets: TAsset[]) => void;
}) {
    return enqueueAssetMutation(async () => {
        const loaded = await dependencies.loadAssets();
        if (loaded.requiresPersist) await dependencies.persistAssets(loaded.assets);
        dependencies.publishAssets(loaded.assets);
        return loaded.assets;
    });
}
