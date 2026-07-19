import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json();
const sidePanel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
const assetStore = await Bun.file(new URL("../../stores/use-asset-store.ts", import.meta.url)).text();
const imageStorage = await Bun.file(new URL("../../services/image-storage.ts", import.meta.url)).text();
const mediaStorage = await Bun.file(new URL("../../services/file-storage.ts", import.meta.url)).text();
const blobCache = await Bun.file(new URL("../../services/blob-url-cache.ts", import.meta.url)).text();

describe("Phase 4C asset sidebar wiring", () => {
    test("runs Phase 4C contracts in protocol CI", () => {
        expect(packageJson.scripts["test:protocol"]).toContain("src/lib/canvas/asset-upload.phase4c.test.ts");
        expect(packageJson.scripts["test:protocol"]).toContain("src/lib/canvas/asset-upload-wiring.phase4c.test.ts");
        expect(packageJson.scripts["test:protocol"]).toContain("src/lib/canvas/asset-persistence.phase4c.test.ts");
    });

    test("routes multi-file selection through the planner and runner with exact safe types", () => {
        expect(sidePanel).toContain("planAssetUpload");
        expect(sidePanel).toContain("runAssetUpload");
        expect(sidePanel).not.toContain('if (file.type.startsWith("image/"))');
        expect(sidePanel).not.toContain('if (file.type.startsWith("video/"))');
        expect(sidePanel).not.toContain('accept="image/*,video/*"');
        expect(sidePanel).toContain('accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"');
        expect(assetStore).toContain("commitUploadedAssets");
    });

    test("owns and aborts stale upload batches without overwriting a newer batch", () => {
        expect(sidePanel).toContain("AbortController");
        expect(sidePanel).toContain(".abort()");
        expect(sidePanel).toContain("uploadGenerationRef");
        expect(sidePanel).toContain("isCurrent");
    });

    test("makes insert and remove actions visible to keyboard focus and touch", () => {
        expect(sidePanel).toContain("group-focus-within:opacity-100");
        expect(sidePanel).toContain("pointer-coarse:opacity-100");
        expect(sidePanel).toContain('aria-label={`插入素材：${asset.title}`}');
        expect(sidePanel).toContain('aria-label={`移除素材：${asset.title}`}');
        expect(sidePanel).toContain('event.key === "Enter"');
        expect(sidePanel).toContain('event.key === " "');
        expect(sidePanel).toContain("event.target === event.currentTarget");
        expect(sidePanel).toContain("event.preventDefault()");
        expect(sidePanel).not.toContain('event.key === "Delete"');
        expect(sidePanel).not.toContain('event.key === "Backspace"');
        expect(sidePanel).toContain("<Popconfirm");
    });

    test("routes removal through the async repository and defers physical GC", () => {
        expect(sidePanel).toContain("useAssetStore.getState().removeAsset(asset.id)");
        expect(assetStore).toContain("mutateAssetRepository(repository");
        expect(assetStore).not.toContain("removeAssetMetadata");
        expect(assetStore).toContain("cleanupImages: () => undefined");
    });

    test("routes image and media URLs through the keyed generation cache", () => {
        expect(imageStorage).toContain("createBlobUrlCache");
        expect(mediaStorage).toContain("createBlobUrlCache");
        expect(blobCache).toContain("generations");
        expect(blobCache).toContain("queues");
        expect(mediaStorage).not.toMatch(/cleanupUnusedMedia[\s\S]*unused\.map\(\(key\) => store\.removeItem\(key\)\)/);
        expect(mediaStorage).toContain("deleteStoredMedia(unused)");
    });
});
