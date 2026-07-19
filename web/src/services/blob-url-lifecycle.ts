export type BlobUrlLifecycle = {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
};

/** Pure seam: never exposes a replacement URL until durable Blob storage succeeds. */
export async function replaceStoredBlobUrl(input: {
    storageKey: string;
    blob: Blob;
    currentUrl?: string;
    write: (storageKey: string, blob: Blob) => Promise<unknown>;
    lifecycle: BlobUrlLifecycle;
}) {
    const nextUrl = input.lifecycle.createObjectURL(input.blob);
    try {
        await input.write(input.storageKey, input.blob);
    } catch (error) {
        input.lifecycle.revokeObjectURL(nextUrl);
        throw error;
    }
    if (input.currentUrl && input.currentUrl !== nextUrl) input.lifecycle.revokeObjectURL(input.currentUrl);
    return nextUrl;
}

export async function deleteStoredBlobUrl(input: {
    storageKey: string;
    currentUrl?: string;
    remove: (storageKey: string) => Promise<unknown>;
    revokeObjectURL: (url: string) => void;
}) {
    await input.remove(input.storageKey);
    if (input.currentUrl) input.revokeObjectURL(input.currentUrl);
}
