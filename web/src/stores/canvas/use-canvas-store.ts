import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let queuedPersistState: PersistedCanvasState | null = null;

export type DurableCanvasPersistence<T> = {
    write: (snapshot: T) => Promise<void>;
    enqueue: (snapshot: T) => void;
    flush: () => Promise<void>;
};

export function createDurableCanvasPersistence<T>(options: {
    schedule: (callback: () => void) => unknown;
    cancel: (handle: unknown) => void;
    write: (snapshot: T) => Promise<void>;
}): DurableCanvasPersistence<T> {
    let timer: unknown;
    const queued: T[] = [];
    let active: Promise<void> | undefined;

    const drain = (): Promise<void> => {
        if (active) return active.then(() => drain());
        if (!queued.length) return Promise.resolve();
        const snapshot = queued.shift()!;
        const write = options.write(snapshot);
        active = write;
        return write.then(
            () => {
                active = undefined;
                return drain();
            },
            (error) => {
                active = undefined;
                // Retry the exact failed snapshot before any state accepted
                // while that write was in flight.
                queued.unshift(snapshot);
                throw error;
            },
        );
    };

    return {
        write: options.write,
        enqueue(snapshot: T) {
            // While debouncing only the newest state matters. Once a write is
            // active, preserve its successor as a distinct serialized write.
            if (timer !== undefined && !active) queued.splice(0, queued.length, snapshot);
            else if (active && queued.length) queued[queued.length - 1] = snapshot;
            else queued.push(snapshot);
            if (timer !== undefined) options.cancel(timer);
            timer = options.schedule(() => {
                timer = undefined;
                void drain().catch(() => undefined);
            });
        },
        flush() {
            if (timer !== undefined) {
                options.cancel(timer);
                timer = undefined;
            }
            return drain();
        },
    };
}

type CanvasStorageSnapshot = { name: string; value: StorageValue<CanvasStore> };
function durableCanvasValue(value: StorageValue<CanvasStore>) {
    const copy = structuredClone(value);
    for (const project of (copy.state as PersistedCanvasState).projects || []) {
        for (const node of project.nodes || []) {
            if (node.metadata?.storageKey) node.metadata.content = node.metadata.storageKey;
        }
    }
    return copy;
}

type CanvasStorePersistence = {
    write: (name: string, value: StorageValue<CanvasStore>) => Promise<void>;
    read: (name: string) => Promise<StorageValue<CanvasStore> | null>;
    enqueue: (snapshot: CanvasStorageSnapshot) => void;
    flush: () => Promise<void>;
};

export const canvasStorePersistence: CanvasStorePersistence = {
    write: async (name: string, value: StorageValue<CanvasStore>): Promise<void> => {
        await localForageStorage.setItem(name, JSON.stringify(value));
    },
    read: async (name: string): Promise<StorageValue<CanvasStore> | null> => {
        const value = await localForageStorage.getItem(name);
        return value ? JSON.parse(value) as StorageValue<CanvasStore> : null;
    },
    enqueue: () => { throw new Error("canvas persistence queue is not initialized"); },
    flush: async () => { throw new Error("canvas persistence queue is not initialized"); },
};

const durableQueue: DurableCanvasPersistence<CanvasStorageSnapshot> = createDurableCanvasPersistence<CanvasStorageSnapshot>({
    schedule: (callback) => setTimeout(callback, 400),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    write: async (snapshot): Promise<void> => canvasStorePersistence.write(snapshot.name, durableCanvasValue(snapshot.value)),
});
canvasStorePersistence.enqueue = durableQueue.enqueue;
canvasStorePersistence.flush = durableQueue.flush;

export const flushCanvasStorePersistence = () => canvasStorePersistence.flush();

export const canvasStorage: PersistStorage<CanvasStore> & { persistence: typeof canvasStorePersistence; flush: typeof flushCanvasStorePersistence } = {
    persistence: canvasStorePersistence,
    flush: flushCanvasStorePersistence,
    getItem: async (name) => {
        const value = await canvasStorePersistence.read(name);
        if (!value) return null;
        queuedPersistState = value.state as PersistedCanvasState;
        return value;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        canvasStorePersistence.enqueue({ name, value });
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
