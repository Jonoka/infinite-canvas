import { describe, expect, test } from "bun:test";

import {
    ASSET_UPLOAD_HASH_CHUNK_BYTES,
    ASSET_UPLOAD_LIMITS,
    hashAssetFile,
    planAssetUpload,
    runAssetUpload,
    sniffMime,
    type AssetUploadRunnerDependencies,
} from "./asset-upload";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [...new TextEncoder().encode("GIF89a")];

function ftyp(...brands: string[]) {
    const bytes = new Uint8Array(16 + Math.max(0, brands.length - 1) * 4);
    bytes[3] = bytes.length;
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    bytes.set(new TextEncoder().encode(brands[0]), 8);
    brands.slice(1).forEach((brand, index) => bytes.set(new TextEncoder().encode(brand), 16 + index * 4));
    return [...bytes];
}

function file(bytes: number[], name: string, type: string) {
    return new File([new Uint8Array(bytes)], name, { type, lastModified: 1 });
}

function dependencies(overrides: Partial<AssetUploadRunnerDependencies> = {}): AssetUploadRunnerDependencies {
    return {
        readMetadata: async () => ({ width: 1, height: 1 }),
        commitUpload: async () => undefined,
        createObjectURL: ({ index }) => `blob:phase4c-${index}`,
        revokeObjectURL: () => undefined,
        now: () => "2026-07-19T00:00:00.000Z",
        createId: ({ index }) => `asset-${index}`,
        ...overrides,
    };
}

describe("Phase 4C asset upload planner", () => {
    test("allows only safe image/video types and verifies their signatures", async () => {
        const plan = await planAssetUpload([
            file(PNG, "a.png", "image/png"),
            file(JPEG, "b.jpg", "image/jpeg"),
            file(GIF, "c.gif", "image/gif"),
            file(PNG, "unsafe.svg", "image/svg+xml"),
            file(JPEG, "lie.png", "image/png"),
            file([], "empty.png", "image/png"),
        ], []);

        expect(plan.items.map((item) => item.status === "ready" ? item.mimeType : item.error.code)).toEqual([
            "image/png",
            "image/jpeg",
            "image/gif",
            "unsupported_type",
            "type_signature_mismatch",
            "empty_file",
        ]);
        expect(plan.readyCount).toBe(3);
        expect(plan.rejectedCount).toBe(3);
    });

    test("applies count, single-file, and cumulative limits before persistence", async () => {
        const files = Array.from({ length: 5 }, (_, index) => file([...PNG, index], `${index}.png`, "image/png"));
        const plan = await planAssetUpload(files, [], {
            limits: { maxBatchFiles: 4, maxSingleFileBytes: 9, maxTotalBytes: 18 },
        });

        expect(plan.items[0].status).toBe("ready");
        expect(plan.items[1].status).toBe("ready");
        expect(plan.items[2]).toMatchObject({ status: "rejected", error: { code: "total_file_size_limit" } });
        expect(plan.items[4]).toMatchObject({ status: "rejected", error: { code: "batch_file_limit" } });
        expect(plan.readyBytes).toBe(18);
    });

    test("deduplicates bytes while allowing duplicate names with different content", async () => {
        const first = file([...PNG, 1], "same.png", "image/png");
        const initial = await planAssetUpload([first], []);
        const sha256 = initial.items[0].status === "ready" ? initial.items[0].sha256 : "";
        const plan = await planAssetUpload([
            first,
            file([...PNG, 1], "renamed.png", "image/png"),
            file([...PNG, 2], "same.png", "image/png"),
        ], [{ assetId: "existing", sha256 }]);

        expect(plan.items[0]).toMatchObject({ status: "rejected", error: { code: "duplicate_content", duplicateOf: { type: "existing", assetId: "existing" } } });
        expect(plan.items[1]).toMatchObject({ status: "rejected", error: { code: "duplicate_content" } });
        expect(plan.items[2].status).toBe("ready");
    });

    test("sniffs ISO BMFF major and compatible brands into canonical MOV/MP4 MIME", async () => {
        expect(sniffMime(new Uint8Array(ftyp("qt  ")))).toBe("video/quicktime");
        expect(sniffMime(new Uint8Array(ftyp("isom", "qt  ")))).toBe("video/quicktime");
        expect(sniffMime(new Uint8Array(ftyp("isom", "mp42")))).toBe("video/mp4");
        const mov = await planAssetUpload([file(ftyp("qt  "), "movie.mov", "video/quicktime")], []);
        const lied = await planAssetUpload([file(ftyp("qt  "), "movie.mp4", "video/mp4")], []);
        expect(mov.items[0]).toMatchObject({ status: "ready", mimeType: "video/quicktime" });
        expect(lied.items[0]).toMatchObject({ status: "rejected", error: { code: "type_signature_mismatch" } });
    });

    test("fails closed for extended, EOF-sized, and unaligned ISO BMFF boxes", () => {
        const extended = new Uint8Array(ftyp("isom"));
        extended[3] = 1;
        const eofSized = new Uint8Array(ftyp("isom"));
        eofSized[3] = 0;
        const unaligned = new Uint8Array([...ftyp("isom"), 0]);
        unaligned[3] = unaligned.length;
        expect(sniffMime(extended)).toBeUndefined();
        expect(sniffMime(eofSized)).toBeUndefined();
        expect(sniffMime(unaligned)).toBeUndefined();
    });

    test("hashes fixed-size chunks and observes abort between chunk reads", async () => {
        const controller = new AbortController();
        const reads: Array<[number, number]> = [];
        const blob = new Blob([new Uint8Array(ASSET_UPLOAD_HASH_CHUNK_BYTES + 1)]);
        const original = blob.slice.bind(blob);
        blob.slice = ((start?: number, end?: number, type?: string) => {
            reads.push([start || 0, end || blob.size]);
            const chunk = original(start, end, type);
            if (reads.length === 1) queueMicrotask(() => controller.abort());
            return chunk;
        }) as Blob["slice"];
        await expect(hashAssetFile(blob, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(reads).toEqual([[0, ASSET_UPLOAD_HASH_CHUNK_BYTES]]);
    });

    test("charges duplicate candidates to one examined-byte budget", async () => {
        const duplicate = file([...PNG, 1], "duplicate.png", "image/png");
        const digestPlan = await planAssetUpload([duplicate], []);
        const digest = digestPlan.items[0].status === "ready" ? digestPlan.items[0].sha256 : "";
        const next = file([...PNG, 2], "next.png", "image/png");
        const plan = await planAssetUpload([duplicate, next], [{ assetId: "old", sha256: digest }], { limits: { maxTotalBytes: duplicate.size + next.size - 1 } });
        expect(plan.items[0]).toMatchObject({ status: "rejected", error: { code: "duplicate_content" } });
        expect(plan.items[1]).toMatchObject({ status: "rejected", error: { code: "total_file_size_limit" } });
        expect(plan.examinedBytes).toBe(duplicate.size);
    });
});

describe("Phase 4C asset upload runner", () => {
    test("preserves input order, bounds concurrency, and commits successful candidates once", async () => {
        const plan = await planAssetUpload([
            file([...PNG, 1], "one.png", "image/png"),
            file([...PNG, 2], "two.png", "image/png"),
            file([...PNG, 3], "three.png", "image/png"),
        ], []);
        const commits: unknown[] = [];
        let active = 0;
        let maxActive = 0;
        const result = await runAssetUpload(plan, dependencies({
            readMetadata: async ({ index }) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await Bun.sleep(index === 0 ? 10 : 1);
                active -= 1;
                return { width: 1, height: 1 };
            },
            commitUpload: async (commit) => { commits.push(commit); },
        }), { signal: new AbortController().signal, isCurrent: () => true });

        expect(maxActive).toBeLessThanOrEqual(ASSET_UPLOAD_LIMITS.maxConcurrentFiles);
        expect(commits).toHaveLength(1);
        expect(result.items.map((item) => item.assetId)).toEqual(["asset-0", "asset-1", "asset-2"]);
        expect(result).toMatchObject({ status: "success", committedCount: 3, rejectedCount: 0, failedCount: 0 });
    });

    test("isolates per-file decode failures and reports partial success", async () => {
        const plan = await planAssetUpload([
            file([...PNG, 1], "ok.png", "image/png"),
            file([...PNG, 2], "broken.png", "image/png"),
            file([...PNG, 3], "also-ok.png", "image/png"),
        ], []);
        const commits: Array<{ assets: Array<{ id: string }> }> = [];
        const result = await runAssetUpload(plan, dependencies({
            readMetadata: async ({ index }) => {
                if (index === 1) throw new Error("decode");
                return { width: 1, height: 1 };
            },
            commitUpload: async (commit) => { commits.push(commit); },
        }), { signal: new AbortController().signal, isCurrent: () => true });

        expect(commits).toHaveLength(1);
        expect(commits[0].assets.map((asset) => asset.id)).toEqual(["asset-0", "asset-2"]);
        expect(result.items[1]).toMatchObject({ status: "failed", error: { code: "media_metadata_failed" } });
        expect(result).toMatchObject({ status: "partial", committedCount: 2, failedCount: 1 });
    });

    test("publishes no assets after atomic persistence failure", async () => {
        const plan = await planAssetUpload([
            file([...PNG, 1], "one.png", "image/png"),
            file([...PNG, 2], "two.png", "image/png"),
        ], []);
        let published = 0;
        const result = await runAssetUpload(plan, dependencies({
            commitUpload: async () => { throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); },
            createObjectURL: () => { published += 1; return "blob:never"; },
        }), { signal: new AbortController().signal, isCurrent: () => true });

        expect(published).toBe(0);
        expect(result.status).toBe("failed");
        expect(result.committedCount).toBe(0);
        expect(result.items.map((item) => item.error?.code)).toEqual(["quota_exceeded", "quota_exceeded"]);
    });

    test("does not commit stale batches and revokes every temporary URL", async () => {
        const plan = await planAssetUpload([file([...PNG, 1], "one.png", "image/png")], []);
        const revoked: string[] = [];
        let commits = 0;
        const result = await runAssetUpload(plan, dependencies({
            commitUpload: async () => { commits += 1; },
            revokeObjectURL: (url) => { revoked.push(url); },
        }), { signal: new AbortController().signal, isCurrent: () => false });

        expect(commits).toBe(0);
        expect(revoked).toEqual([]);
        expect(result.items[0]).toMatchObject({ status: "failed", error: { code: "stale_batch" } });
    });

    test("passes ownership into commit and rechecks it after commit completes", async () => {
        const plan = await planAssetUpload([file([...PNG, 1], "one.png", "image/png")], []);
        let current = true;
        let receivedSignal: AbortSignal | undefined;
        const controller = new AbortController();
        const result = await runAssetUpload(plan, dependencies({
            commitUpload: async (_commit, ownership) => { receivedSignal = ownership.signal; current = false; },
        }), { signal: controller.signal, isCurrent: () => current });
        expect(receivedSignal).toBe(controller.signal);
        expect(result.items[0]).toMatchObject({ status: "failed", error: { code: "stale_batch" } });
    });
});
