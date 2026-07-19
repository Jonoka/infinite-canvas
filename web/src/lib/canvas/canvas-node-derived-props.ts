import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasBatchMotion = { x: number; y: number; index: number };

export function reuseEquivalentResourceReferences(previous: CanvasResourceReference[] | undefined, next: CanvasResourceReference[]) {
    if (!previous || previous.length !== next.length) return next;
    for (let index = 0; index < next.length; index += 1) {
        const before = previous[index];
        const after = next[index];
        if (
            before.id !== after.id ||
            before.nodeId !== after.nodeId ||
            before.kind !== after.kind ||
            before.label !== after.label ||
            before.title !== after.title ||
            before.previewUrl !== after.previewUrl ||
            before.text !== after.text ||
            before.active !== after.active
        ) {
            return next;
        }
    }
    return previous;
}

export function reuseEquivalentBatchMotion(previous: CanvasBatchMotion | undefined, next: CanvasBatchMotion | undefined) {
    if (!previous || !next) return next;
    return previous.x === next.x && previous.y === next.y && previous.index === next.index ? previous : next;
}
