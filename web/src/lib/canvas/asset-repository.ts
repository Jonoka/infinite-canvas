/** One process-wide queue for every durable asset metadata mutation. */
let mutationQueue: Promise<void> = Promise.resolve();

export function enqueueAssetMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
}

export type AssetRepositoryDependencies<TAsset> = {
    isHydrated: () => boolean;
    getAssets: () => TAsset[];
    persistAssets: (assets: TAsset[]) => Promise<void>;
    publishAssets: (assets: TAsset[]) => void;
};

export function mutateAssetRepository<TAsset, TResult>(
    dependencies: AssetRepositoryDependencies<TAsset>,
    mutation: (latest: TAsset[]) => { assets: TAsset[]; result: TResult },
) {
    return enqueueAssetMutation(async () => {
        if (!dependencies.isHydrated()) throw new Error("asset_repository_not_hydrated");
        const next = mutation(dependencies.getAssets());
        await dependencies.persistAssets(next.assets);
        dependencies.publishAssets(next.assets);
        return next.result;
    });
}
