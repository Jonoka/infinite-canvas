import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { assertPluginNodeDefinitions, registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import type { OfficialPluginEntry, PluginManifest } from "@/lib/canvas/plugin-registry";
import { OFFICIAL_REGISTRY_ID } from "@/lib/canvas/plugin-registry";
import { flushPluginStorePersistence, usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";

type ActiveSecurityContext = { pluginId: string; pluginVersion: string; registryId: string; permissions: string[] };
export type PluginInstallCandidate = { manifest: OfficialPluginEntry; source: string; sourceDomain: string };

export async function runPluginActivationTransaction(actions: { activate: () => void; commit: () => void | Promise<void>; cleanup: () => void; restore: () => void | Promise<void> }) {
    try {
        actions.activate();
        await actions.commit();
    } catch (error) {
        try {
            actions.cleanup();
        } finally {
            await actions.restore();
        }
        throw error;
    }
}

const cleanups = new Map<string, () => void>();
const securityContexts = new Map<string, ActiveSecurityContext>();

export function getActivePluginSecurity(pluginId: string) {
    return securityContexts.get(pluginId);
}

async function evaluatePluginSource(source: string, manifest: PluginManifest): Promise<CanvasPlugin> {
    assertDeclaredDependencies(source, manifest);
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin, manifest);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function evaluateDevelopmentSource(source: string): Promise<CanvasPlugin> {
    if (!import.meta.env.DEV) throw new Error("开发插件加载在 production 中已禁用");
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        const value = plugin as Partial<CanvasPlugin> | null;
        if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.version !== "string" || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error("开发插件未导出有效对象");
        assertPluginNodeDefinitions(
            value.nodes,
            value.id,
            value.nodes.map((node) => node.type),
        );
        return value as CanvasPlugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function developmentManifest(plugin: CanvasPlugin): PluginManifest {
    return {
        schemaVersion: 1,
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        host: { minVersion: "0.9.0" },
        entry: "development-only",
        sha256: "0".repeat(64),
        nodeTypes: plugin.nodes.map((node) => node.type),
        permissions: [],
        dependencies: [{ bundled: true }],
        csp: { connectSrc: ["'none'"], imageSrc: ["'self'", "data:", "blob:"], frameSrc: ["'none'"] },
    };
}

function assertDeclaredDependencies(source: string, manifest: PluginManifest) {
    if (/\bimport\s*\(\s*(?!["'])/.test(source)) throw new Error("插件包含无法验证的动态依赖");
    const remoteImports = Array.from(source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](https:\/\/[^"']+)["']|\bimport\s*\(\s*["'](https:\/\/[^"']+)["']\s*\)/g), (match) => match[1] || match[2]);
    const declared = new Set(manifest.dependencies.flatMap((dependency) => ("url" in dependency ? [dependency.url] : [])));
    if (remoteImports.some((url) => !declared.has(url))) throw new Error("插件包含未声明或未固定完整性的远程依赖");
    const declaredSources = new Set([...manifest.csp.connectSrc, ...manifest.csp.imageSrc, ...manifest.csp.frameSrc]);
    const literalUrls = Array.from(source.matchAll(/["'](https:\/\/[^"']+)["']/g), (match) => match[1]);
    for (const value of literalUrls) {
        const origin = new URL(value).origin;
        if (!declaredSources.has(origin)) throw new Error(`插件 bundle 使用了未在 CSP 中声明的来源: ${origin}`);
    }
}

function assertPlugin(plugin: unknown, manifest: PluginManifest): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error("插件未导出有效对象");
    if (value.id !== manifest.id || value.version !== manifest.version || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error("插件 bundle 身份与清单不一致");
    assertPluginNodeDefinitions(value.nodes, manifest.id, manifest.nodeTypes);
}

function activateVerifiedPlugin(plugin: CanvasPlugin, manifest: PluginManifest, registryId: string) {
    assertPluginNodeDefinitions(plugin.nodes, plugin.id, manifest.nodeTypes);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    try {
        registerNodeDefinitions(plugin.nodes, plugin.id);
        disposers.push(() => unregisterPluginNodes(plugin.id));
        if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
        const cleanup = plugin.setup?.(runtime);
        if (typeof cleanup === "function") disposers.push(cleanup);
        securityContexts.set(plugin.id, { pluginId: plugin.id, pluginVersion: plugin.version, registryId, permissions: [...manifest.permissions] });
        cleanups.set(plugin.id, () => {
            for (const dispose of [...disposers].reverse()) dispose();
            securityContexts.delete(plugin.id);
        });
    } catch (error) {
        for (const dispose of [...disposers].reverse()) {
            try {
                dispose();
            } catch {
                /* preserve the activation error */
            }
        }
        securityContexts.delete(plugin.id);
        throw error;
    }
}

export function deactivatePlugin(pluginId: string) {
    const cleanup = cleanups.get(pluginId);
    if (cleanup) cleanup();
    else unregisterPluginNodes(pluginId);
    cleanups.delete(pluginId);
    securityContexts.delete(pluginId);
}

async function fetchPluginSource(url: string) {
    const response = await fetch(url, { credentials: "omit", headers: { accept: "text/javascript, application/javascript;q=0.9" } });
    if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`);
    return response.text();
}

function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

export async function prepareOfficialPlugin(entry: OfficialPluginEntry): Promise<PluginInstallCandidate> {
    if (entry.registryId !== OFFICIAL_REGISTRY_ID) throw new Error("插件不是来自官方注册表");
    const source = await fetchPluginSource(entry.url);
    const digest = bytesToHex(sha256(new TextEncoder().encode(source)));
    if (digest !== entry.sha256) throw new Error("插件 bundle SHA-256 不匹配");
    assertDeclaredDependencies(source, entry);
    return { manifest: entry, source, sourceDomain: new URL(entry.url).hostname };
}

function installedRecord(candidate: PluginInstallCandidate): Omit<InstalledPlugin, "installedAt"> {
    const { manifest, source } = candidate;
    return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        url: manifest.url,
        source,
        enabled: true,
        official: true,
        trust: "verified",
        manifest,
        registryId: manifest.registryId,
    };
}

export async function installOfficialPlugin(candidate: PluginInstallCandidate) {
    const plugin = await evaluatePluginSource(candidate.source, candidate.manifest);
    const store = usePluginStore.getState();
    const previousRecords = store.plugins;
    const previous = previousRecords.find((record) => record.id === plugin.id);
    let previousPlugin: CanvasPlugin | null = null;
    if (previous?.trust === "verified" && previous.manifest) previousPlugin = await evaluatePluginSource(previous.source, previous.manifest);

    deactivatePlugin(plugin.id);
    await runPluginActivationTransaction({
        activate: () => activateVerifiedPlugin(plugin, candidate.manifest, candidate.manifest.registryId),
        commit: async () => {
            usePluginStore.getState().upsert(installedRecord(candidate));
            await flushPluginStorePersistence();
        },
        cleanup: () => deactivatePlugin(plugin.id),
        restore: async () => {
            usePluginStore.setState({ plugins: previousRecords });
            if (previousPlugin && previous?.manifest) activateVerifiedPlugin(previousPlugin, previous.manifest, previous.registryId || OFFICIAL_REGISTRY_ID);
            await flushPluginStorePersistence();
        },
    });
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin, candidate: PluginInstallCandidate) {
    if (record.id !== candidate.manifest.id || record.trust !== "verified") throw new Error("只能从官方清单更新已验证插件");
    return installOfficialPlugin(candidate);
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (import.meta.env.DEV && record.trust === "development") {
        if (!enabled) {
            deactivatePlugin(record.id);
            usePluginStore.getState().setEnabled(record.id, false);
            await flushPluginStorePersistence();
            return;
        }
        const plugin = await evaluateDevelopmentSource(await fetchPluginSource(withCacheBust(record.url)));
        activateVerifiedPlugin(plugin, developmentManifest(plugin), "development");
        usePluginStore.getState().setEnabled(record.id, true);
        await flushPluginStorePersistence();
        return;
    }
    if (record.trust !== "verified" || !record.manifest || record.registryId !== OFFICIAL_REGISTRY_ID) throw new Error("未验证插件不能执行");
    const previousEnabled = record.enabled;
    if (!enabled) {
        deactivatePlugin(record.id);
        usePluginStore.getState().setEnabled(record.id, false);
        await flushPluginStorePersistence();
        return;
    }
    try {
        const plugin = await evaluatePluginSource(record.source, record.manifest);
        activateVerifiedPlugin(plugin, record.manifest, record.registryId);
        usePluginStore.getState().setEnabled(record.id, true);
        await flushPluginStorePersistence();
    } catch (error) {
        deactivatePlugin(record.id);
        usePluginStore.getState().setEnabled(record.id, previousEnabled);
        await flushPluginStorePersistence();
        throw error;
    }
}

export async function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
    await flushPluginStorePersistence();
}

let loaded = false;

export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    await usePluginStore.persist.rehydrate();
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled && record.trust === "verified" && record.official && record.registryId === OFFICIAL_REGISTRY_ID && record.manifest);
    for (const record of records) {
        try {
            const plugin = await evaluatePluginSource(record.source, record.manifest!);
            activateVerifiedPlugin(plugin, record.manifest!, record.registryId!);
        } catch (error) {
            usePluginStore.getState().setEnabled(record.id, false);
            console.error(`[plugin] 已验证插件加载失败并已禁用: ${record.id}`, error);
        }
    }
    if (import.meta.env.DEV) {
        await loadLocalDevelopmentPlugins();
        await loadConfiguredDevelopmentPlugins();
    }
}

async function loadLocalDevelopmentPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json", { credentials: "same-origin" });
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return;
    }
    if (!Array.isArray(urls)) return;
    for (const url of urls) {
        if (typeof url !== "string" || !url.startsWith("/plugins/")) continue;
        try {
            const source = await fetchPluginSource(withCacheBust(url));
            const plugin = await evaluateDevelopmentSource(source);
            const existing = usePluginStore.getState().plugins.find((record) => record.id === plugin.id);
            usePluginStore.getState().upsert({
                id: plugin.id,
                name: plugin.name,
                version: plugin.version,
                description: plugin.description,
                url,
                source,
                enabled: existing?.trust === "development" ? existing.enabled : false,
                local: true,
                trust: "development",
            });
            if (existing?.trust === "development" && existing.enabled) activateVerifiedPlugin(plugin, developmentManifest(plugin), "development");
        } catch (error) {
            console.error(`[plugin] 开发插件发现失败: ${url}`, error);
        }
    }
}

async function loadConfiguredDevelopmentPlugins() {
    const raw = import.meta.env.VITE_DEV_PLUGINS;
    if (!raw) return;
    for (const url of raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)) {
        try {
            const plugin = await evaluateDevelopmentSource(await fetchPluginSource(withCacheBust(url)));
            deactivatePlugin(plugin.id);
            activateVerifiedPlugin(plugin, developmentManifest(plugin), "development");
        } catch (error) {
            console.error(`[plugin] 配置的开发插件加载失败: ${url}`, error);
        }
    }
}

export function resetPluginLoaderForTests() {
    for (const pluginId of [...cleanups.keys()]) deactivatePlugin(pluginId);
    loaded = false;
}
