import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json();
const sidePanel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
const assetStore = await Bun.file(new URL("../../stores/use-asset-store.ts", import.meta.url)).text();
const imageStorage = await Bun.file(new URL("../../services/image-storage.ts", import.meta.url)).text();
const mediaStorage = await Bun.file(new URL("../../services/file-storage.ts", import.meta.url)).text();
const blobLifecycle = await Bun.file(new URL("../../services/blob-url-lifecycle.ts", import.meta.url)).text();

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

    test("uses reference-aware removal rather than deleting shared media immediately", () => {
        expect(sidePanel).toContain("confirmAssetRemoval");
        expect(sidePanel).not.toContain("onRemove={() => (removeAsset(asset.id)");
        expect(assetStore).toContain("removeAssetMetadata");
    });

    test("routes image and media cleanup through revoke-aware deletion", () => {
        expect(imageStorage).toContain("deleteStoredBlobUrl");
        expect(mediaStorage).toContain("deleteStoredBlobUrl");
        expect(blobLifecycle).toContain("revokeObjectURL");
        expect(mediaStorage).not.toMatch(/cleanupUnusedMedia[\s\S]*unused\.map\(\(key\) => store\.removeItem\(key\)\)/);
        expect(mediaStorage).toContain("deleteStoredMedia(unused)");
    });
});
