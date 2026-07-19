import { create } from "zustand";
import { nanoid } from "nanoid";

import { mutateAssetRepository } from "@/lib/canvas/asset-repository";
import { planAssetRemoval } from "@/lib/canvas/asset-removal";
import type { AssetUploadCommit, AssetUploadOwnership } from "@/lib/canvas/asset-upload";
import { commitAssetUpload } from "@/lib/canvas/asset-store-persistence";
import { localForageStorage } from "@/lib/localforage-storage";
import { resolveImageUrl, setImageBlob, uploadImage, deleteStoredImages } from "@/services/image-storage";
import { resolveMediaUrl, setMediaBlob, deleteStoredMedia } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type NewAsset = Omit<Asset, "id" | "createdAt" | "updatedAt">;
type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: NewAsset) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    commitUploadedAssets: (upload: AssetUploadCommit, ownership: AssetUploadOwnership) => Promise<void>;
    replaceAssets: (assets: Asset[]) => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
type DurableState = { state: { assets: Asset[] }; version: number };

async function readDurableAssets() {
    const value = await localForageStorage.getItem(ASSET_STORE_KEY);
    if (!value) return [];
    return (JSON.parse(value) as DurableState).state.assets || [];
}
async function persistAssets(assets: Asset[]) {
    await localForageStorage.setItem(ASSET_STORE_KEY, JSON.stringify({ state: { assets }, version: 0 } satisfies DurableState));
}
async function hydrateAssets(assets: Asset[]): Promise<Asset[]> {
    return Promise.all(assets.map(async (asset) => {
        if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
        if (asset.kind !== "image") return asset;
        if (asset.data.storageKey) return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl, data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) } };
        if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
        const image = await uploadImage(asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } } as Asset;
    }));
}

const repository = {
    isHydrated: () => useAssetStore.getState().hydrated,
    getAssets: () => useAssetStore.getState().assets,
    persistAssets,
    publishAssets: (assets: Asset[]) => useAssetStore.setState({ assets }),
};

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    assets: [],
    addAsset: (asset) => {
        const now = new Date().toISOString();
        const id = nanoid();
        return mutateAssetRepository(repository, (latest) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...latest], result: id }));
    },
    updateAsset: (id, patch) => mutateAssetRepository(repository, (latest) => ({
        assets: latest.map((asset) => asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset), result: undefined,
    })),
    removeAsset: async (id) => {
        const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
        await mutateAssetRepository(repository, (latest) => {
            // Reference check and metadata decision share the repository lock. Blob GC is tombstoned/deferred.
            planAssetRemoval(id, latest, useCanvasStore.getState().projects);
            return { assets: latest.filter((asset) => asset.id !== id), result: undefined };
        });
    },
    commitUploadedAssets: (upload, ownership) => {
        if (!get().hydrated) return Promise.reject(new Error("asset_repository_not_hydrated"));
        return commitAssetUpload<Asset>(upload, ownership, {
            getAssets: () => get().assets,
            readDurableAssets: () => readDurableAssets().then(hydrateAssets),
            writeBlob: (file) => file.kind === "image" ? setImageBlob(file.storageKey, file.file) : setMediaBlob(file.storageKey, file.file),
            deleteBlobs: async (files) => {
                await Promise.all([
                    deleteStoredImages(files.filter((file) => file.kind === "image").map((file) => file.storageKey)),
                    deleteStoredMedia(files.filter((file) => file.kind === "video").map((file) => file.storageKey)),
                ]);
            },
            persistAssets,
            publishAssets: (assets) => set({ assets }),
            materialize: (commit, urls) => commit.assets.map((asset) => {
                const url = urls.get(asset.id) || "";
                return asset.kind === "image" ? ({ ...asset, coverUrl: url, data: { ...asset.data, dataUrl: url } } as ImageAsset) : ({ ...asset, data: { ...asset.data, url } } as VideoAsset);
            }),
        });
    },
    replaceAssets: (assets) => mutateAssetRepository(repository, () => ({ assets, result: undefined })),
    // Physical cleanup is deliberately deferred until cross-store references can be rechecked safely.
    cleanupImages: () => undefined,
}));

const hydratePromise = (async () => {
    try {
        const assets = await hydrateAssets(await readDurableAssets());
        useAssetStore.setState({ assets, hydrated: true });
    } catch {
        useAssetStore.setState({ hydrated: true });
    }
});
void hydratePromise;
