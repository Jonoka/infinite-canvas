import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json();
const sidePanel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
const assetStore = await Bun.file(new URL("../../stores/use-asset-store.ts", import.meta.url)).text();
const imageStorage = await Bun.file(new URL("../../services/image-storage.ts", import.meta.url)).text();
const mediaStorage = await Bun.file(new URL("../../services/file-storage.ts", import.meta.url)).text();
const blobCache = await Bun.file(new URL("../../services/blob-url-cache.ts", import.meta.url)).text();
const promptsPage = await Bun.file(new URL("../../pages/prompts/index.tsx", import.meta.url)).text();
const imagePage = await Bun.file(new URL("../../pages/image/index.tsx", import.meta.url)).text();
const videoPage = await Bun.file(new URL("../../pages/video/index.tsx", import.meta.url)).text();
const canvasProject = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
const appSync = await Bun.file(new URL("../../services/app-sync.ts", import.meta.url)).text();
const assetsPage = await Bun.file(new URL("../../pages/assets/index.tsx", import.meta.url)).text();
const agentTools = await Bun.file(new URL("../agent/agent-site-tools.ts", import.meta.url)).text();

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
        expect(imagePage).not.toContain("deleteStoredImages");
        expect(videoPage).not.toContain("deleteStoredMedia");
    });

    test("awaits and catches durable addAsset at all four production callers", () => {
        for (const source of [promptsPage, imagePage, videoPage, canvasProject]) {
            expect(source).toContain("await addAsset(");
            expect(source).toMatch(/catch\s*(?:\([^)]*\))?\s*\{/);
        }
    });

    test("fails hydration closed and gates asset UI on writeReady", () => {
        expect(assetStore).toContain("writeReady: false");
        expect(assetStore).toContain("hydrationError:");
        expect(assetStore).toContain("asset_repository_not_write_ready");
        expect(sidePanel).toContain("disabled={uploading || !writeReady}");
        expect(assetStore).not.toContain("setState({ hydrated: true });");
    });

    test("fails app-sync and Agent reads closed when asset hydration is not write-ready", () => {
        expect(appSync).toContain("if (!assetState.writeReady) throw new Error");
        expect(appSync).toContain("assetState.hydrationError");
        expect(agentTools).toContain("if (!writeReady) throw new Error");
        expect(agentTools).toContain("hydrationError");
    });

    test("handles AssetsPage durable save failures instead of dropping the promise", () => {
        expect(assetsPage).toContain("await (editingAsset ? updateAsset");
        expect(assetsPage).toContain('message.error("保存资产失败，请重试")');
        expect(assetsPage).toMatch(/const saveAsset = async \(\) => \{[\s\S]*try \{[\s\S]*catch \(error\)/);
    });

    test("applies app-sync asset merge through the repository lock", () => {
        expect(appSync).toContain("getState().mergeAssets(remote");
        expect(appSync).not.toContain("getState().replaceAssets(await Promise.all(data.assets");
        expect(assetStore).toContain("mergeAssetRepository(repository");
    });

    test("reports partial upload distinctly with all outcome counts", () => {
        expect(sidePanel).toContain('result.status === "partial"');
        expect(sidePanel).toContain("message.warning(summary)");
        expect(sidePanel).toContain("message.error(summary)");
        expect(sidePanel).toContain("成功 ${result.committedCount} 个，拒绝 ${result.rejectedCount} 个，失败 ${result.failedCount} 个");
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
