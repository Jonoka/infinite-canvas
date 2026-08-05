import React from "react";

import { emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import type { CanvasPluginApp } from "@/types/canvas-plugin";
import type { CanvasPluginAi, PluginAiRequestIdentity } from "@/types/canvas-plugin";

// 插件运行时:远程插件通过它拿到宿主的 React 实例,避免多份 React 实例
export type PluginRuntime = CanvasPluginApp & {
    React: typeof React;
    jsx: typeof React.createElement;
    Fragment: typeof React.Fragment;
    injectCSS: (css: string, key?: string) => () => void;
};

let runtime: PluginRuntime | null = null;

// 注入插件样式:同 key 覆盖旧样式,返回移除函数
function injectCSS(css: string, key?: string) {
    const id = key ? `canvas-plugin-style-${key}` : undefined;
    if (id) document.getElementById(id)?.remove();
    const style = document.createElement("style");
    if (id) style.id = id;
    style.dataset.canvasPluginStyle = "true";
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
}

export function getPluginRuntime(): PluginRuntime {
    if (!runtime) {
        runtime = {
            React,
            jsx: React.createElement,
            Fragment: React.Fragment,
            injectCSS,
            version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
            emit: emitCanvasEvent,
            on: onCanvasEvent,
        };
        (window as unknown as { InfiniteCanvasRuntime?: PluginRuntime }).InfiniteCanvasRuntime = runtime;
    }
    return runtime;
}

export function capabilityFilteredAi(ai: CanvasPluginAi, identity: PluginAiRequestIdentity, permissions: readonly string[]): CanvasPluginAi {
    const requireAi = () => {
        if (!permissions.includes("ai")) throw new Error(`插件 ${identity.pluginId} 未获 AI 权限`);
    };
    return {
        generateImage: (prompt, options) => {
            requireAi();
            return ai.generateImage(prompt, options, identity);
        },
        generateVideo: (prompt, options) => {
            requireAi();
            return ai.generateVideo(prompt, options, identity);
        },
        generateText: (prompt, options) => {
            requireAi();
            return ai.generateText(prompt, options, identity);
        },
        listModels: (capability) => {
            requireAi();
            return ai.listModels(capability, identity);
        },
        defaultModel: (capability) => {
            requireAi();
            return ai.defaultModel(capability, identity);
        },
    };
}
