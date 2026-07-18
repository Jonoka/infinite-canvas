import type { VideoGenerationResult } from "@/services/api/video";
import type { UploadedFile } from "@/services/file-storage";

/** Carry provider variants through storage without dropping alternate URLs. */
export function preserveVideoGenerationResult(result: VideoGenerationResult, stored: UploadedFile): UploadedFile & Pick<VideoGenerationResult, "urls"> {
    return { ...stored, url: stored.url || result.url || result.urls?.[0] || "", ...(result.urls?.length ? { urls: [...result.urls] } : {}) };
}
