import { describe, expect, test } from "bun:test";

import { mutateAssetRepository } from "./asset-repository";
import { commitAssetUpload } from "./asset-store-persistence";
import type { AssetUploadCommit } from "./asset-upload";
import { createBlobUrlCache } from "../../services/blob-url-cache";

const upload: AssetUploadCommit = {
    assets: [{ id: "new", kind: "image", title: "new", coverUrl: "", tags: [], createdAt: "now", updatedAt: "now", metadata: { uploadSha256: "hash" }, data: { storageKey: "image:new", width: 1, height: 1, bytes: 1, mimeType: "image/png" } }],
    files: [{ assetId: "new", file: new File([new Uint8Array([1])], "new.png"), storageKey: "image:new", kind: "image" }],
};
const ownership = { signal: new AbortController().signal, isCurrent: () => true };

function commitHarness() {
    let assets: Array<{ id: string }> = [{ id: "old" }];
    let durable = assets;
    const deleted: string[] = [];
    const published: string[][] = [];
    return {
        get assets() { return assets; }, get durable() { return durable; }, deleted, published,
        setDurable(next: Array<{ id: string }>) { durable = next; },
        dependencies: {
            getAssets: () => assets,
            readDurableAssets: async () => durable,
            writeBlob: async () => "blob:new",
            deleteBlobs: async (files: AssetUploadCommit["files"]) => { deleted.push(...files.map((file) => file.storageKey)); },
            persistAssets: async (next: Array<{ id: string }>) => { durable = next; },
            publishAssets: (next: Array<{ id: string }>) => { assets = next; published.push(next.map((asset) => asset.id)); },
            materialize: () => [{ id: "new" }],
        },
    };
}

describe("Phase 4C durable asset repository", () => {
    test("serializes mutations and reads latest state inside the lock", async () => {
        let assets = [{ id: "old" }];
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const dependencies = { isHydrated: () => true, getAssets: () => assets, persistAssets: async (next: typeof assets) => { if (next[0].id === "first") await blocked; }, publishAssets: (next: typeof assets) => { assets = next; } };
        const first = mutateAssetRepository(dependencies, (latest) => ({ assets: [{ id: "first" }, ...latest], result: undefined }));
        const second = mutateAssetRepository(dependencies, (latest) => ({ assets: [{ id: "second" }, ...latest], result: undefined }));
        release();
        await Promise.all([first, second]);
        expect(assets.map((asset) => asset.id)).toEqual(["second", "first", "old"]);
    });

    test("upload preserves a mutation queued before it", async () => {
        const harness = commitHarness();
        await mutateAssetRepository({ isHydrated: () => true, getAssets: harness.dependencies.getAssets, persistAssets: harness.dependencies.persistAssets, publishAssets: harness.dependencies.publishAssets }, (latest) => ({ assets: [{ id: "concurrent" }, ...latest], result: undefined }));
        await commitAssetUpload(upload, ownership, harness.dependencies);
        expect(harness.assets.map((asset) => asset.id)).toEqual(["new", "concurrent", "old"]);
    });

    test("deletes staged blobs when initial metadata persist fails", async () => {
        const harness = commitHarness();
        harness.dependencies.persistAssets = async () => { throw new Error("metadata failed"); };
        await expect(commitAssetUpload(upload, ownership, harness.dependencies)).rejects.toThrow("metadata failed");
        expect(harness.deleted).toEqual(["image:new"]);
        expect(harness.published).toEqual([]);
    });

    test("retains blobs and durable truth when compensation persist also fails", async () => {
        const harness = commitHarness();
        let persists = 0;
        let current = true;
        // Model durable commit before a post-persist failure.
        harness.dependencies.persistAssets = async (next) => {
            persists++;
            if (persists === 1) {
                harness.setDurable(next);
                current = false;
                return;
            }
            throw new Error("rollback persist failed");
        };
        const error = await commitAssetUpload(upload, { ...ownership, isCurrent: () => current }, harness.dependencies).catch((value) => value);
        expect(error).toMatchObject({ rollback: "failed_blobs_retained" });
        expect(harness.deleted).toEqual([]);
        expect(harness.assets.map((asset) => asset.id)).toContain("new");
    });
});

describe("Phase 4C keyed Blob URL cache", () => {
    test("invalidates an in-flight resolve without caching or leaking its URL", async () => {
        let release!: (blob: Blob) => void;
        const read = new Promise<Blob>((resolve) => { release = resolve; });
        const revoked: string[] = [];
        const cache = createBlobUrlCache({ read: async () => read, write: async () => undefined, remove: async () => undefined, createObjectURL: () => "blob:stale", revokeObjectURL: (url) => revoked.push(url) });
        const resolving = cache.resolve("image:key", "fallback");
        const deleting = cache.delete("image:key");
        release(new Blob());
        expect(await resolving).toBe("fallback");
        await deleting;
        expect(revoked).toEqual(["blob:stale"]);
    });

    test("serializes same-key set/delete and prevents resurrection", async () => {
        const events: string[] = [];
        const cache = createBlobUrlCache({ read: async () => null, write: async () => { events.push("write"); }, remove: async () => { events.push("delete"); }, createObjectURL: () => "blob:new", revokeObjectURL: (url) => events.push(`revoke:${url}`) });
        const setting = cache.set("video:key", new Blob());
        const deleting = cache.delete("video:key");
        expect(await setting).toBe("");
        await deleting;
        expect(events).toEqual(["write", "revoke:blob:new", "delete"]);
        expect(await cache.resolve("video:key", "missing")).toBe("missing");
    });
});
