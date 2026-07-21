import { describe, expect, test } from "bun:test";

import {
    CanvasMentionResolutionError,
    escapePastedMentionText,
    parseCanvasMentionTokens,
    projectCanvasMentions,
    serializeCanvasMentionTokens,
    type CanvasMentionProjectionInput,
} from "./canvas-stable-mentions";

const inputs: CanvasMentionProjectionInput[] = [
    { nodeId: "image-a", kind: "image" },
    { nodeId: "image-b", kind: "image" },
    { nodeId: "video-a", kind: "video" },
    { nodeId: "text-a", kind: "text", text: "稳定文本" },
];

describe("Phase 4E stable mention codec", () => {
    test("round-trips text and stable node-id tokens without interpreting visible labels", () => {
        const value = "普通图片1 @[node:image-a] 与 @[node:image-a]";
        const tokens = parseCanvasMentionTokens(value);
        expect(tokens).toEqual([
            { type: "text", value: "普通图片1 " },
            { type: "reference", nodeId: "image-a" },
            { type: "text", value: " 与 " },
            { type: "reference", nodeId: "image-a" },
        ]);
        expect(serializeCanvasMentionTokens(tokens)).toBe(value);
    });

    test("keeps malformed, empty, and invalid-id token lookalikes as ordinary text", () => {
        const value = "@[node:] @[node:a/b] @[node:missing @[node:ok-id]";
        expect(parseCanvasMentionTokens(value)).toEqual([
            { type: "text", value: "@[node:] @[node:a/b] @[node:missing " },
            { type: "reference", nodeId: "ok-id" },
        ]);
    });

    test("escapes plain clipboard text so pasted token lookalikes cannot forge mentions", () => {
        const escaped = escapePastedMentionText("外部 @[node:image-a] 与 @@[node:image-b]");
        expect(escaped).toBe("外部 @@[node:image-a] 与 @@@[node:image-b]");
        expect(parseCanvasMentionTokens(escaped)).toEqual([{ type: "text", value: "外部 @[node:image-a] 与 @@[node:image-b]" }]);
        expect(serializeCanvasMentionTokens(parseCanvasMentionTokens(escaped))).toBe(escaped);
    });

    test("projects by node identity and first mention order rather than mutable labels or input order", () => {
        const projected = projectCanvasMentions("用 @[node:image-b] 配合 @[node:video-a]，再看 @[node:image-b]", inputs);
        expect(projected).toEqual({
            hasMentions: true,
            prompt: "用 图片1 配合 视频1，再看 图片1",
            orderedNodeIds: ["image-b", "video-a"],
            counts: { image: 1, video: 1, audio: 0, text: 0 },
            textBlocks: [],
        });
    });

    test("keeps text mention content and uses one resource for repeated tokens", () => {
        const projected = projectCanvasMentions("总结 @[node:text-a] 和 @[node:text-a]", inputs);
        expect(projected.prompt).toBe("总结 【文本1】 和 【文本1】\n\n【文本1】\n稳定文本");
        expect(projected.orderedNodeIds).toEqual(["text-a"]);
        expect(projected.counts.text).toBe(1);
    });

    test("rejects node ids outside the canonical token grammar instead of emitting lossy tokens", () => {
        expect(() => serializeCanvasMentionTokens([{ type: "reference", nodeId: "node/unsafe" }])).toThrow(CanvasMentionResolutionError);
        expect(() => projectCanvasMentions("普通文本", [{ nodeId: "node/unsafe", kind: "image" }])).toThrow(CanvasMentionResolutionError);
    });

    test("rejects duplicate node identities because resolution would be ambiguous", () => {
        expect(() => projectCanvasMentions("@[node:image-a]", [...inputs, { nodeId: "image-a", kind: "video" }])).toThrow(CanvasMentionResolutionError);
    });

    test("fails closed for unresolved mentions and never rebinds by a reused label", () => {
        expect(() => projectCanvasMentions("使用 @[node:deleted-node]", inputs)).toThrow(CanvasMentionResolutionError);
        try {
            projectCanvasMentions("使用 @[node:deleted-node]", inputs);
        } catch (error) {
            expect(error).toBeInstanceOf(CanvasMentionResolutionError);
            expect((error as CanvasMentionResolutionError).nodeIds).toEqual(["deleted-node"]);
        }
    });

    test("preserves legacy plain prompts and selects no mention-specific resources", () => {
        expect(projectCanvasMentions("请参考图片1，但它只是普通文本", inputs)).toEqual({
            hasMentions: false,
            prompt: "请参考图片1，但它只是普通文本",
            orderedNodeIds: [],
            counts: { image: 0, video: 0, audio: 0, text: 0 },
            textBlocks: [],
        });
    });
});
