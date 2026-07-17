import { fitNodeSize } from "./canvas-node-size";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../types";

export function canvasImageRetryAction(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && node.metadata?.status === "error" && node.metadata.imageTaskId && node.metadata.imageTaskRecoverable ? "recover" : "regenerate";
}

export function interruptedGenerationError(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && node.metadata?.imageTaskId && node.metadata.imageTaskRecoverable ? "页面刷新后轮询已中断，可重新获取已有任务成品。" : "页面刷新后生成已中断，请重新生成。";
}

export function clearImageTaskMetadata(metadata: CanvasNodeMetadata): CanvasNodeMetadata {
    const next = { ...metadata };
    delete next.imageTaskId;
    delete next.imageTaskContentIndex;
    delete next.imageTaskModel;
    delete next.imageTaskGroup;
    delete next.imageTaskRecoverable;
    return next;
}

export function canceledGenerationMetadata(metadata: CanvasNodeMetadata): CanvasNodeMetadata {
    return metadata.imageTaskId && metadata.imageTaskRecoverable
        ? { ...metadata, status: "error", errorDetails: "已停止等待，可重新获取已有任务成品。" }
        : { ...metadata, status: "idle", errorDetails: undefined };
}

export function fitRecoveredImageNode(node: CanvasNodeData, naturalWidth: number, naturalHeight: number) {
    const size = fitNodeSize(naturalWidth, naturalHeight, node.width, node.height);
    return {
        position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
        ...size,
    };
}