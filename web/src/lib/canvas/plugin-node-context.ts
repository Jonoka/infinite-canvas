import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodePluginId } from "@/lib/canvas/node-registry";
import { getActivePluginSecurity } from "@/lib/canvas/plugin-loader";
import { capabilityFilteredAi } from "@/lib/canvas/plugin-runtime";
import { sanitizePluginMarkup } from "@/lib/canvas/plugin-content-security";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";

// 把宿主能力 + 节点 + 主题/缩放,组装成注入给插件节点的上下文
export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false): CanvasNodeContext {
    const pluginId = getNodePluginId(node.type);
    const storage = createPluginStorage(pluginId);
    const security = getActivePluginSecurity(pluginId);
    const ai =
        pluginId === "builtin"
            ? host.ai
            : capabilityFilteredAi(
                  host.ai,
                  {
                      pluginId,
                      pluginVersion: security?.pluginVersion || "unverified",
                      registryId: security?.registryId || "unverified",
                  },
                  security?.permissions || [],
              );
    return {
        node,
        theme,
        scale,
        isSelected,
        updateMetadata: (patch) => host.updateMetadata(node.id, patch),
        updateNode: (patch) => host.updateNode(node.id, patch),
        getNode: (id) => host.getNode(id),
        getNodes: () => host.getNodes(),
        getConnections: () => host.getConnections(),
        getUpstream: () => host.getUpstream(node.id),
        getDownstream: () => host.getDownstream(node.id),
        applyOps: (ops) => host.applyOps(ops),
        emit: (event, payload) => emitCanvasEvent(event, payload),
        on: (event, handler) => onCanvasEvent(event, handler),
        ai,
        openPanel: () => host.openPanel(node.id),
        closePanel: () => host.closePanel(),
        storage,
        sanitizeMarkup: sanitizePluginMarkup,
    };
}
