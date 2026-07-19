import { enqueueAssetMutation } from "./asset-repository";
import type { AssetUploadCommit, AssetUploadOwnership } from "./asset-upload";

export type StoredUploadAsset = AssetUploadCommit["assets"][number] & { data: AssetUploadCommit["assets"][number]["data"] & { dataUrl?: string; url?: string } };
export type AssetCommitDependencies<TAsset> = {
    getAssets: () => TAsset[];
    readDurableAssets: () => Promise<TAsset[]>;
    writeBlob: (file: AssetUploadCommit["files"][number]) => Promise<string>;
    deleteBlobs: (written: AssetUploadCommit["files"]) => Promise<void>;
    persistAssets: (assets: TAsset[]) => Promise<void>;
    publishAssets: (assets: TAsset[]) => void;
    materialize: (upload: AssetUploadCommit, urls: Map<string, string>) => TAsset[];
};

function checkOwnership(ownership: AssetUploadOwnership) {
    if (ownership.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError", uploadCode: "aborted" });
    if (!ownership.isCurrent()) throw Object.assign(new Error("stale"), { uploadCode: "stale_batch" });
}

/** Stages Blobs, commits metadata, then publishes. Compensation removes this batch only. */
export function commitAssetUpload<TAsset extends { id: string }>(upload: AssetUploadCommit, ownership: AssetUploadOwnership, dependencies: AssetCommitDependencies<TAsset>) {
    return enqueueAssetMutation(async () => {
        const written: AssetUploadCommit["files"] = [];
        let metadataCommitted = false;
        try {
            checkOwnership(ownership);
            const urls = new Map<string, string>();
            for (const file of upload.files) {
                checkOwnership(ownership);
                urls.set(file.assetId, await dependencies.writeBlob(file));
                written.push(file);
                checkOwnership(ownership);
            }
            // Read inside the repository lock. Never restore an upload-time snapshot.
            const next = [...dependencies.materialize(upload, urls), ...dependencies.getAssets()];
            checkOwnership(ownership);
            await dependencies.persistAssets(next);
            metadataCommitted = true;
            checkOwnership(ownership);
            dependencies.publishAssets(next);
            checkOwnership(ownership);
        } catch (error) {
            if (!metadataCommitted) {
                await dependencies.deleteBlobs(written);
                throw error;
            }

            const batchIds = new Set(upload.assets.map((asset) => asset.id));
            const compensated = dependencies.getAssets().filter((asset) => !batchIds.has(asset.id));
            try {
                await dependencies.persistAssets(compensated);
                dependencies.publishAssets(compensated);
                await dependencies.deleteBlobs(written);
            } catch (rollbackError) {
                // Durable metadata may still reference this batch: retain every Blob and republish durable truth.
                let durableReadError: unknown;
                try {
                    dependencies.publishAssets(await dependencies.readDurableAssets());
                } catch (readError) {
                    durableReadError = readError;
                }
                throw Object.assign(new Error("asset upload failed and durable rollback failed; staged blobs retained"), {
                    cause: error,
                    rollbackError,
                    durableReadError,
                    uploadCode: "persistence_failed" as const,
                    rollback: "failed_blobs_retained" as const,
                });
            }
            throw error;
        }
    });
}
