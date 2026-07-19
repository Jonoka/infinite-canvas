export type BlobUrlCacheDependencies<TBlob> = {
    read: (key: string) => Promise<TBlob | null>;
    write: (key: string, blob: TBlob) => Promise<unknown>;
    remove: (key: string) => Promise<unknown>;
    createObjectURL: (blob: TBlob) => string;
    revokeObjectURL: (url: string) => void;
};

/** Per-key serial operations plus eager generations prevent stale resolves from resurrecting URLs. */
export function createBlobUrlCache<TBlob>(dependencies: BlobUrlCacheDependencies<TBlob>) {
    const urls = new Map<string, string>();
    const generations = new Map<string, number>();
    const queues = new Map<string, Promise<void>>();
    const bump = (key: string) => {
        const generation = (generations.get(key) || 0) + 1;
        generations.set(key, generation);
        return generation;
    };
    const enqueue = <T>(key: string, operation: () => Promise<T>) => {
        const previous = queues.get(key) || Promise.resolve();
        const result = previous.then(operation, operation);
        const settled = result.then(() => undefined, () => undefined);
        queues.set(key, settled);
        void settled.finally(() => { if (queues.get(key) === settled) queues.delete(key); });
        return result;
    };

    return {
        resolve(key: string, fallback = "") {
            const generation = generations.get(key) || 0;
            return enqueue(key, async () => {
                const cached = urls.get(key);
                if (cached) return cached;
                const blob = await dependencies.read(key);
                if (!blob) return fallback;
                const url = dependencies.createObjectURL(blob);
                if ((generations.get(key) || 0) !== generation) {
                    dependencies.revokeObjectURL(url);
                    return fallback;
                }
                urls.set(key, url);
                return url;
            });
        },
        set(key: string, blob: TBlob) {
            const generation = bump(key);
            return enqueue(key, async () => {
                await dependencies.write(key, blob);
                const url = dependencies.createObjectURL(blob);
                if (generations.get(key) !== generation) {
                    dependencies.revokeObjectURL(url);
                    return "";
                }
                const previous = urls.get(key);
                urls.set(key, url);
                if (previous && previous !== url) dependencies.revokeObjectURL(previous);
                return url;
            });
        },
        delete(key: string) {
            const generation = bump(key);
            return enqueue(key, async () => {
                await dependencies.remove(key);
                if (generations.get(key) !== generation) return;
                const previous = urls.get(key);
                urls.delete(key);
                if (previous) dependencies.revokeObjectURL(previous);
            });
        },
    };
}
