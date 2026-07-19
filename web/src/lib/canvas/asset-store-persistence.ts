import type { AssetUploadCommit, AssetUploadOwnership } from "./asset-upload";

export type StoredUploadAsset = AssetUploadCommit["assets"][number] & { data: AssetUploadCommit["assets"][number]["data"] & { dataUrl?: string; url?: string } };
export type AssetCommitDependencies<TAsset> = {
    getAssets: () => TAsset[];
    writeBlob: (file: AssetUploadCommit["files"][number]) => Promise<string>;
    deleteBlobs: (written: AssetUploadCommit["files"]) => Promise<void>;
    persistAssets: (assets: TAsset[]) => Promise<void>;
    publishAssets: (assets: TAsset[]) => void;
    materialize: (upload: AssetUploadCommit, urls: Map<string, string>) => TAsset[];
};

let commitQueue: Promise<void> = Promise.resolve();
export function enqueueAssetCommit<T>(operation: () => Promise<T>): Promise<T> {
    const result = commitQueue.then(operation, operation);
    commitQueue = result.then(() => undefined, () => undefined);
    return result;
}

function checkOwnership(ownership: AssetUploadOwnership) {
    if (ownership.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError", uploadCode: "aborted" });
    if (!ownership.isCurrent()) throw Object.assign(new Error("stale"), { uploadCode: "stale_batch" });
}

/** Serial, rollback-capable seam used by the Zustand store and pure regression tests. */
export function commitAssetUpload<TAsset>(upload: AssetUploadCommit, ownership: AssetUploadOwnership, dependencies: AssetCommitDependencies<TAsset>) {
    return enqueueAssetCommit(async () => {
        const before = dependencies.getAssets();
        const written: AssetUploadCommit["files"] = [];
        let metadataWritten = false;
        try {
            checkOwnership(ownership);
            const urls = new Map<string, string>();
            for (const file of upload.files) {
                checkOwnership(ownership);
                urls.set(file.assetId, await dependencies.writeBlob(file));
                written.push(file);
                checkOwnership(ownership);
            }
            const next = [...dependencies.materialize(upload, urls), ...before];
            checkOwnership(ownership);
            await dependencies.persistAssets(next);
            metadataWritten = true;
            checkOwnership(ownership);
            dependencies.publishAssets(next);
            checkOwnership(ownership);
        } catch (error) {
            if (metadataWritten) {
                await dependencies.persistAssets(before);
                dependencies.publishAssets(before);
            }
            await dependencies.deleteBlobs(written);
            throw error;
        }
    });
}
