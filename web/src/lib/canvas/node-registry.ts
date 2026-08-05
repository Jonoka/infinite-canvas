import { create } from "zustand";

import type { CanvasNodeDefinition } from "@/types/canvas-plugin";
import { CanvasNodeType } from "@/types/canvas";

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>(); // type -> pluginId(内置为 "builtin")

// 注册表版本号,注册/卸载时自增,驱动创建菜单等 UI 重渲染
export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
function bump() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(defs: CanvasNodeDefinition[], pluginId = "builtin") {
    const incoming = new Set<string>();
    for (const def of defs) {
        if (!def.type || incoming.has(def.type)) throw new Error(`节点类型重复: ${def.type || "<empty>"}`);
        incoming.add(def.type);
        if (pluginId !== "builtin" && !def.type.startsWith(`${pluginId}:`)) throw new Error(`插件节点必须使用 ${pluginId}: 命名空间`);
        const owner = ownerByType.get(def.type);
        if (owner && owner !== pluginId) throw new Error(`节点类型冲突: ${def.type} 已由 ${owner} 注册`);
    }
    defs.forEach((def) => {
        definitions.set(def.type, def);
        ownerByType.set(def.type, pluginId);
    });
    bump();
}

export function assertPluginNodeDefinitions(defs: CanvasNodeDefinition[], pluginId: string, declaredTypes: readonly string[]) {
    const actual = defs.map((definition) => definition.type);
    if (actual.length !== declaredTypes.length || actual.some((type) => !declaredTypes.includes(type))) throw new Error("插件 bundle 节点类型与清单不一致");
    const incoming = new Set<string>();
    for (const type of actual) {
        if (!type.startsWith(`${pluginId}:`) || incoming.has(type)) throw new Error(`插件节点必须唯一且使用 ${pluginId}: 命名空间`);
        incoming.add(type);
        const owner = ownerByType.get(type);
        if (owner && owner !== pluginId) throw new Error(`节点类型冲突: ${type} 已由 ${owner} 注册`);
    }
}

export function unregisterPluginNodes(pluginId: string) {
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
    }
    bump();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: "节点", metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

// 提供默认尺寸/标题/初始 metadata,createCanvasNode 与 agent-ops 复用
export function getNodeSpec(type: string) {
    const def = definitions.get(type);
    if (!def) return FALLBACK_SPEC;
    return { width: def.defaultSize.width, height: def.defaultSize.height, title: def.title, metadata: def.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}
