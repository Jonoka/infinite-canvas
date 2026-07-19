import { describe, expect, test } from "bun:test";

import { reuseEquivalentBatchMotion, reuseEquivalentResourceReferences } from "./canvas-node-derived-props";
import type { CanvasResourceReference } from "./canvas-resource-references";

describe("Phase 4A Canvas node derived-prop structural sharing", () => {
    test("reuses an unchanged mention-reference array so an unrelated node move cannot defeat React.memo", () => {
        const previous: CanvasResourceReference[] = [
            {
                id: "image-a",
                nodeId: "image-a",
                kind: "image",
                label: "图片1",
                title: "参考图",
                previewUrl: "blob:image-a",
                active: true,
            },
        ];
        const rebuilt = previous.map((reference) => ({ ...reference }));

        expect(reuseEquivalentResourceReferences(previous, rebuilt)).toBe(previous);
    });

    test("does not reuse references when a resource field that affects rendering changes", () => {
        const previous: CanvasResourceReference[] = [
            {
                id: "text-a",
                nodeId: "text-a",
                kind: "text",
                label: "文本1",
                title: "旧标题",
                text: "旧内容",
                active: true,
            },
        ];
        const changed = [{ ...previous[0], title: "新标题", text: "新内容" }];

        expect(reuseEquivalentResourceReferences(previous, changed)).toBe(changed);
    });

    test("reuses an unchanged batch-motion object but preserves real motion updates", () => {
        const previous = { x: 34, y: 14, index: 0 };
        const rebuilt = { x: 34, y: 14, index: 0 };
        const changed = { x: 48, y: 22, index: 1 };

        expect(reuseEquivalentBatchMotion(previous, rebuilt)).toBe(previous);
        expect(reuseEquivalentBatchMotion(previous, changed)).toBe(changed);
        expect(reuseEquivalentBatchMotion(undefined, undefined)).toBeUndefined();
    });
});
