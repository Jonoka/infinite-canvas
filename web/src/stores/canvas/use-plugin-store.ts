import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { PluginManifest } from "@/lib/canvas/plugin-registry";

export type InstalledPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    url: string; // 安装来源,可用于更新
    source: string; // 缓存的插件源码,离线可用、版本固定
    enabled: boolean;
    local?: boolean; // 自动发现于 web/public/plugins 的本地插件(默认关闭,启用时按 url 重新拉取)
    official?: boolean; // 从官方注册表安装(用于在管理器里归类)
    trust: "verified" | "development" | "legacy-unverified";
    manifest?: PluginManifest;
    registryId?: string;
    installedAt: string;
};

type PluginStore = {
    plugins: InstalledPlugin[];
    upsert: (plugin: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string }) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

export function migratePersistedPlugins(persisted: unknown): PluginStore {
    const state = (persisted || {}) as Partial<PluginStore>;
    const plugins = Array.isArray(state.plugins) ? state.plugins.map((plugin) => ({ ...plugin, enabled: false, trust: "legacy-unverified" as const })) : [];
    return { ...state, plugins } as PluginStore;
}

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => ({
            plugins: [],
            upsert: (plugin) =>
                set((state) => {
                    const installedAt = plugin.installedAt || new Date().toISOString();
                    const exists = state.plugins.some((item) => item.id === plugin.id);
                    const next = { ...plugin, installedAt };
                    return { plugins: exists ? state.plugins.map((item) => (item.id === plugin.id ? next : item)) : [next, ...state.plugins] };
                }),
            setEnabled: (id, enabled) => set((state) => ({ plugins: state.plugins.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            remove: (id) => set((state) => ({ plugins: state.plugins.filter((item) => item.id !== id) })),
        }),
        {
            name: "infinite-canvas:plugin_store",
            storage: createJSONStorage(() => localForageStorage),
            version: 1,
            migrate: migratePersistedPlugins,
        },
    ),
);

// Zustand's persist middleware intentionally does not await storage writes. The
// loader calls this explicit barrier before activation is reported successful.
export async function flushPluginStorePersistence() {
    const state = usePluginStore.getState();
    await localForageStorage.setItem("infinite-canvas:plugin_store", JSON.stringify({ state: { plugins: state.plugins }, version: 1 }));
}
