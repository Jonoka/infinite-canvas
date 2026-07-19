import { describe, expect, test } from "bun:test";

import { confirmAssetRemoval, planAssetRemoval } from "./asset-removal";
import { commitAssetUpload } from "./asset-store-persistence";
import type { AssetUploadCommit } from "./asset-upload";
import { deleteStoredBlobUrl, replaceStoredBlobUrl } from "../../services/blob-url-lifecycle";

const upload: AssetUploadCommit = {
    assets: [{ id: "new", kind: "image", title: "new", coverUrl: "", tags: [], createdAt: "now", updatedAt: "now", metadata: { uploadSha256: "hash" }, data: { storageKey: "image:new", width: 1, height: 1, bytes: 1, mimeType: "image/png" } }],
    files: [{ assetId: "new", file: new File([new Uint8Array([1])], "new.png"), storageKey: "image:new", kind: "image" }],
};

function commitHarness() {
    let assets: Array<{ id: string }> = [{ id: "old" }];
    const deleted: string[] = [];
    const published: string[][] = [];
    return {
        get assets() { return assets; }, deleted, published,
        dependencies: {
            getAssets: () => assets,
            writeBlob: async () => "blob:new",
            deleteBlobs: async (files: AssetUploadCommit["files"]) => { deleted.push(...files.map((file) => file.storageKey)); },
            persistAssets: async (_next: Array<{ id: string }>) => undefined,
            publishAssets: (next: Array<{ id: string }>) => { assets = next; published.push(next.map((asset) => asset.id)); },
            materialize: () => [{ id: "new" }],
        },
    };
}

describe("Phase 4C durable asset commit", () => {
    test("rolls back a batch that becomes stale while Blob writing", async () => {
        const harness = commitHarness();
        let current = true;
        harness.dependencies.writeBlob = async () => { current = false; return "blob:new"; };
        await expect(commitAssetUpload(upload, { signal: new AbortController().signal, isCurrent: () => current }, harness.dependencies)).rejects.toMatchObject({ uploadCode: "stale_batch" });
        expect(harness.deleted).toEqual(["image:new"]);
        expect(harness.published).toEqual([]);
        expect(harness.assets).toEqual([{ id: "old" }]);
    });

    test("awaits metadata durability and rolls Blobs back on persist failure", async () => {
        const harness = commitHarness();
        harness.dependencies.persistAssets = async () => { throw new Error("metadata failed"); };
        await expect(commitAssetUpload(upload, { signal: new AbortController().signal, isCurrent: () => true }, harness.dependencies)).rejects.toThrow("metadata failed");
        expect(harness.deleted).toEqual(["image:new"]);
        expect(harness.published).toEqual([]);
    });
});

describe("Phase 4C reference-aware deletion", () => {
    test("retains a storage key shared by another asset", async () => {
        let assets = [{ id: "a", kind: "image", data: { storageKey: "image:shared" } }, { id: "b", kind: "image", data: { storageKey: "image:shared" } }];
        expect(planAssetRemoval("a", assets, [])).toMatchObject({ referencedByOtherAsset: true });
        const deleted: string[] = [];
        await confirmAssetRemoval({ assetId: "a", getAssets: () => assets, getProjects: () => [], removeAssetMetadata: () => { assets = assets.filter((asset) => asset.id !== "a"); }, deleteStoredImages: async (keys) => { deleted.push(...keys); }, deleteStoredMedia: async () => undefined });
        expect(deleted).toEqual([]);
    });

    test("rechecks latest canvas state immediately before GC", async () => {
        let assets = [{ id: "a", kind: "image", data: { storageKey: "image:key" } }];
        let projects: unknown[] = [];
        const deleted: string[] = [];
        await confirmAssetRemoval({ assetId: "a", getAssets: () => assets, getProjects: () => projects, removeAssetMetadata: async () => { assets = []; projects = [{ node: { storageKey: "image:key" } }]; }, deleteStoredImages: async (keys) => { deleted.push(...keys); }, deleteStoredMedia: async () => undefined });
        expect(deleted).toEqual([]);
    });
});

describe("Phase 4C Blob URL lifecycle", () => {
    test("revokes a new URL on write failure and preserves the old URL", async () => {
        const revoked: string[] = [];
        await expect(replaceStoredBlobUrl({ storageKey: "image:key", blob: new Blob(), currentUrl: "blob:old", write: async () => { throw new Error("write"); }, lifecycle: { createObjectURL: () => "blob:new", revokeObjectURL: (url) => { revoked.push(url); } } })).rejects.toThrow("write");
        expect(revoked).toEqual(["blob:new"]);
    });

    test("replaces only after write and revokes cached URL after successful delete", async () => {
        const events: string[] = [];
        const url = await replaceStoredBlobUrl({ storageKey: "image:key", blob: new Blob(), currentUrl: "blob:old", write: async () => { events.push("write"); }, lifecycle: { createObjectURL: () => { events.push("create"); return "blob:new"; }, revokeObjectURL: (value) => { events.push(`revoke:${value}`); } } });
        await deleteStoredBlobUrl({ storageKey: "image:key", currentUrl: url, remove: async () => { events.push("delete"); }, revokeObjectURL: (value) => { events.push(`revoke:${value}`); } });
        expect(events).toEqual(["create", "write", "revoke:blob:old", "delete", "revoke:blob:new"]);
    });
});
