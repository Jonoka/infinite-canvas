import { sha256 } from "@noble/hashes/sha2.js";

export type AssetUploadLimits = {
    maxBatchFiles: number;
    maxSingleFileBytes: number;
    maxTotalBytes: number;
    maxConcurrentFiles: number;
};

export const ASSET_UPLOAD_LIMITS: AssetUploadLimits = {
    maxBatchFiles: 50,
    maxSingleFileBytes: 100 * 1024 * 1024,
    maxTotalBytes: 500 * 1024 * 1024,
    maxConcurrentFiles: 3,
};
export const ASSET_UPLOAD_HASH_CHUNK_BYTES = 4 * 1024 * 1024;
export const ASSET_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

export type UploadErrorCode =
    | "unsupported_type" | "type_signature_mismatch" | "empty_file" | "batch_file_limit"
    | "single_file_size_limit" | "total_file_size_limit" | "duplicate_content"
    | "media_metadata_failed" | "aborted" | "stale_batch" | "quota_exceeded" | "persistence_failed";
export type AssetUploadError = { code: UploadErrorCode; duplicateOf?: { type: "existing"; assetId: string } | { type: "batch"; index: number } };
export type ReadyAssetUploadPlanItem = { index: number; file: File; status: "ready"; mimeType: string; sha256: string };
export type RejectedAssetUploadPlanItem = { index: number; file: File; status: "rejected"; error: AssetUploadError };
export type AssetUploadPlanItem = ReadyAssetUploadPlanItem | RejectedAssetUploadPlanItem;
export type AssetUploadPlan = { items: AssetUploadPlanItem[]; readyCount: number; rejectedCount: number; readyBytes: number; examinedBytes: number };
export type ExistingAssetDigest = { assetId: string; sha256: string };
export type UploadedAsset = {
    id: string; kind: "image" | "video"; title: string; coverUrl: string; tags: string[]; createdAt: string; updatedAt: string;
    metadata: { uploadSha256: string };
    data: { dataUrl?: string; url?: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string };
};
export type AssetUploadOwnership = { signal: AbortSignal; isCurrent: () => boolean };
export type AssetUploadCommit = { assets: UploadedAsset[]; files: Array<{ assetId: string; file: File; storageKey: string; kind: "image" | "video" }> };
export type AssetUploadRunnerDependencies = {
    readMetadata: (input: { index: number; file: File; mimeType: string; getObjectURL: () => string; signal: AbortSignal }) => Promise<{ width: number; height: number }>;
    commitUpload: (commit: AssetUploadCommit, ownership: AssetUploadOwnership) => Promise<void>;
    createObjectURL: (input: { index: number; file: File }) => string;
    revokeObjectURL: (url: string) => void;
    now: () => string;
    createId: (input: { index: number; file: File }) => string;
};
export type AssetUploadResultItem = { index: number; status: "committed" | "rejected" | "failed"; assetId?: string; error?: AssetUploadError };
export type AssetUploadResult = { status: "success" | "partial" | "failed"; items: AssetUploadResultItem[]; committedCount: number; rejectedCount: number; failedCount: number };

function starts(bytes: Uint8Array, signature: number[]) { return signature.every((value, index) => bytes[index] === value); }
function ascii(bytes: Uint8Array, offset: number, value: string) {
    return bytes.length >= offset + value.length && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
function readU32(bytes: Uint8Array, offset: number) {
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "avc1", "mp41", "mp42", "M4V ", "M4A ", "dash", "MSNV", "3gp4", "3gp5", "3gp6", "3g2a"]);

/** Returns a canonical MIME solely from bytes, never from File.type. */
export function sniffMime(bytes: Uint8Array): string | undefined {
    if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "image/gif";
    if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
    if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
    if (bytes.length < 16 || !ascii(bytes, 4, "ftyp")) return undefined;
    const boxSize = Math.min(readU32(bytes, 0), bytes.length);
    if (boxSize < 16) return undefined;
    const brands = [String.fromCharCode(...bytes.slice(8, 12))];
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(String.fromCharCode(...bytes.slice(offset, offset + 4)));
    if (brands.includes("qt  ")) return "video/quicktime";
    if (brands.some((brand) => MP4_BRANDS.has(brand))) return "video/mp4";
    return undefined;
}

function normalizedMime(type: string) {
    const mime = type.split(";", 1)[0].trim().toLowerCase();
    return mime === "image/jpg" ? "image/jpeg" : mime;
}
function abortError() { return Object.assign(new Error("aborted"), { name: "AbortError", uploadCode: "aborted" as const }); }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

export async function hashAssetFile(file: Blob, signal?: AbortSignal, chunkBytes = ASSET_UPLOAD_HASH_CHUNK_BYTES) {
    const chunkSize = Math.min(ASSET_UPLOAD_HASH_CHUNK_BYTES, Math.max(1, chunkBytes));
    const hash = sha256.create();
    for (let offset = 0; offset < file.size; offset += chunkSize) {
        checkSignal(signal);
        hash.update(new Uint8Array(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer()));
        checkSignal(signal);
    }
    return hash.digest().reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), "");
}

export async function planAssetUpload(files: Iterable<File>, existing: ExistingAssetDigest[], options: { limits?: Partial<AssetUploadLimits>; signal?: AbortSignal } = {}): Promise<AssetUploadPlan> {
    const limits: AssetUploadLimits = { ...ASSET_UPLOAD_LIMITS, ...options.limits };
    const existingByDigest = new Map(existing.map((asset) => [asset.sha256, asset.assetId]));
    const batchByDigest = new Map<string, number>();
    const items: AssetUploadPlanItem[] = [];
    let readyBytes = 0;
    let examinedBytes = 0;
    for (const [index, file] of Array.from(files).entries()) {
        checkSignal(options.signal);
        const reject = (code: UploadErrorCode, duplicateOf?: AssetUploadError["duplicateOf"]) => items.push({ index, file, status: "rejected", error: { code, duplicateOf } });
        if (index >= limits.maxBatchFiles) { reject("batch_file_limit"); continue; }
        if (!file.size) { reject("empty_file"); continue; }
        const declaredMime = normalizedMime(file.type);
        if (!ASSET_UPLOAD_ACCEPT.split(",").includes(declaredMime)) { reject("unsupported_type"); continue; }
        if (file.size > limits.maxSingleFileBytes) { reject("single_file_size_limit"); continue; }
        if (examinedBytes + file.size > limits.maxTotalBytes) { reject("total_file_size_limit"); continue; }
        examinedBytes += file.size;
        checkSignal(options.signal);
        const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        checkSignal(options.signal);
        const mimeType = sniffMime(bytes);
        if (!mimeType || mimeType !== declaredMime) { reject("type_signature_mismatch"); continue; }
        const digest = await hashAssetFile(file, options.signal);
        const existingId = existingByDigest.get(digest);
        if (existingId) { reject("duplicate_content", { type: "existing", assetId: existingId }); continue; }
        const duplicateIndex = batchByDigest.get(digest);
        if (duplicateIndex !== undefined) { reject("duplicate_content", { type: "batch", index: duplicateIndex }); continue; }
        batchByDigest.set(digest, index);
        readyBytes += file.size;
        items.push({ index, file, status: "ready", mimeType, sha256: digest });
    }
    return { items, readyCount: items.filter((item) => item.status === "ready").length, rejectedCount: items.filter((item) => item.status === "rejected").length, readyBytes, examinedBytes };
}

function ownershipCode(ownership: AssetUploadOwnership): UploadErrorCode { return ownership.signal.aborted ? "aborted" : "stale_batch"; }
function checkOwnership(ownership: AssetUploadOwnership) {
    checkSignal(ownership.signal);
    if (!ownership.isCurrent()) throw Object.assign(new Error("stale"), { uploadCode: "stale_batch" as const });
}

export async function runAssetUpload(plan: AssetUploadPlan, dependencies: AssetUploadRunnerDependencies, ownership: AssetUploadOwnership): Promise<AssetUploadResult> {
    const results: AssetUploadResultItem[] = plan.items.map((item) => item.status === "rejected" ? { index: item.index, status: "rejected", error: item.error } : { index: item.index, status: "failed" });
    const ready = plan.items.filter((item): item is ReadyAssetUploadPlanItem => item.status === "ready");
    const prepared: Array<{ item: typeof ready[number]; asset: UploadedAsset; file: AssetUploadCommit["files"][number] } | undefined> = new Array(ready.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < ready.length) {
            const slot = cursor++;
            const item = ready[slot];
            let temporaryUrl: string | undefined;
            const getObjectURL = () => temporaryUrl ||= dependencies.createObjectURL({ index: item.index, file: item.file });
            try {
                checkOwnership(ownership);
                const metadata = await dependencies.readMetadata({ index: item.index, file: item.file, mimeType: item.mimeType, getObjectURL, signal: ownership.signal });
                checkOwnership(ownership);
                const id = dependencies.createId({ index: item.index, file: item.file });
                const now = dependencies.now();
                const kind = item.mimeType.startsWith("image/") ? "image" : "video";
                const storageKey = `${kind}:${id}`;
                prepared[slot] = { item, asset: { id, kind, title: item.file.name || (kind === "image" ? "图片" : "视频"), coverUrl: "", tags: [], createdAt: now, updatedAt: now, metadata: { uploadSha256: item.sha256 }, data: { storageKey, width: metadata.width, height: metadata.height, bytes: item.file.size, mimeType: item.mimeType } }, file: { assetId: id, file: item.file, storageKey, kind } };
            } catch (error) {
                const code = (error as { uploadCode?: UploadErrorCode }).uploadCode || "media_metadata_failed";
                results[item.index] = { index: item.index, status: "failed", error: { code } };
            } finally { if (temporaryUrl) dependencies.revokeObjectURL(temporaryUrl); }
        }
    };
    await Promise.all(Array.from({ length: Math.min(ASSET_UPLOAD_LIMITS.maxConcurrentFiles, ready.length) }, worker));
    const successful = prepared.filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (successful.length) {
        try {
            checkOwnership(ownership);
            await dependencies.commitUpload({ assets: successful.map(({ asset }) => asset), files: successful.map(({ file }) => file) }, ownership);
            checkOwnership(ownership);
            successful.forEach(({ item, asset }) => { results[item.index] = { index: item.index, status: "committed", assetId: asset.id }; });
        } catch (error) {
            const code: UploadErrorCode = (error as { uploadCode?: UploadErrorCode; name?: string }).uploadCode || ((error as { name?: string }).name === "QuotaExceededError" ? "quota_exceeded" : ownership.signal.aborted || !ownership.isCurrent() ? ownershipCode(ownership) : "persistence_failed");
            successful.forEach(({ item }) => { results[item.index] = { index: item.index, status: "failed", error: { code } }; });
        }
    }
    const committedCount = results.filter((item) => item.status === "committed").length;
    const rejectedCount = results.filter((item) => item.status === "rejected").length;
    const failedCount = results.filter((item) => item.status === "failed").length;
    return { status: committedCount && !failedCount && !rejectedCount ? "success" : committedCount ? "partial" : "failed", items: results, committedCount, rejectedCount, failedCount };
}
