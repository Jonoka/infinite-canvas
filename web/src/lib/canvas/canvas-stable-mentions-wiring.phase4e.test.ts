import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).text();
const promptInput = await Bun.file(new URL("../../components/canvas/canvas-prompt-chip-input.tsx", import.meta.url)).text();
const composer = await Bun.file(new URL("../../components/canvas/canvas-config-composer.tsx", import.meta.url)).text();
const generation = await Bun.file(new URL("../../components/canvas/canvas-node-generation.ts", import.meta.url)).text();
const project = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
const resources = await Bun.file(new URL("./canvas-resource-references.ts", import.meta.url)).text();

describe("Phase 4E stable mention production wiring", () => {
    test("runs the Phase 4E suites in migration validation", () => {
        expect(packageJson).toContain("canvas-stable-mentions.phase4e.test.ts");
        expect(packageJson).toContain("canvas-stable-mentions-wiring.phase4e.test.ts");
    });

    test("uses node-id chips and shared codec in both contentEditable editors", () => {
        expect(promptInput).toContain("data-reference-node-id");
        expect(promptInput).not.toContain("data-ref-label");
        expect(promptInput).toContain("parseCanvasMentionTokens");
        expect(promptInput).toContain("serializeTrustedMentionDom");
        expect(composer).toContain("parseCanvasMentionTokens");
        expect(composer).toContain("serializeTrustedMentionDom");
    });

    test("fails rich paste and drop closed and scopes selection helpers to the active editor", () => {
        for (const source of [promptInput, composer]) {
            expect(source).toContain("onPaste={handlePlainTextPaste}");
            expect(source).toContain("onDrop={preventMentionDrop}");
            expect(source).toContain("event.stopPropagation()");
            expect(source).toContain("isSelectionInsideEditor(editor");
            expect(source).toContain("isImeComposing(event)");
        }
    });

    test("preserves unresolved chips and catches resolver failures before generation can get stuck", () => {
        expect(promptInput).toContain("createUnresolvedReferenceChip");
        expect(composer).toContain("createUnresolvedReferenceChip");
        expect(promptInput).toContain("trustedNodeIds");
        expect(composer).toContain("lastEmittedRef");
        expect(project).toContain('message.error(error instanceof Error ? error.message : "引用解析失败，无法生成")');
        expect(project).toContain("finishGenerationRequest(nodeId, runController)");
        expect(project).toContain('message.error(contextResult.error instanceof Error ? contextResult.error.message : "引用解析失败，无法重试")');
    });

    test("uses the shared stable resolver in generation rather than a private token regex", () => {
        expect(generation).toContain("projectCanvasMentions");
        expect(generation).not.toContain('prompt.matchAll(/@\\[node:([^\\]]+)\\]/g)');
        expect(generation).toContain("orderedNodeIds");
    });

    test("deduplicates resource nodes by stable node id before assigning display labels", () => {
        expect(resources).toContain("dedupeResourceNodes");
        expect(resources).toContain("seen.has(node.id)");
    });

    test("does not eagerly load remote video previews from mention menus", () => {
        expect(promptInput).not.toContain('preload="metadata"');
        expect(composer).not.toContain('preload="metadata"');
        expect(promptInput).toContain('referrerPolicy="no-referrer"');
        expect(composer).toContain('referrerPolicy="no-referrer"');
    });
});
