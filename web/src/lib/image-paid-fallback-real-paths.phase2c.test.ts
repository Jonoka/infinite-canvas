import { describe, expect, test } from "bun:test";

const imagePageSource = await Bun.file(new URL("../pages/image/index.tsx", import.meta.url)).text();
const canvasProjectSource = await Bun.file(new URL("../pages/canvas/project.tsx", import.meta.url)).text();

function section(source: string, start: string, end: string) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from, `missing real production path start: ${start}`).toBeGreaterThanOrEqual(0);
    expect(to, `missing real production path end: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
}

function expectPaidFallbackInRealPath(source: string, path: string) {
    expect(
        source,
        `${path} must invoke the shared exact lite_pool_exhausted paid-consent orchestration from the real production callback`,
    ).toMatch(/retryLitePoolFailures?WithConsent|\.generateBatch\(|\.retrySlot\(/);
}

function expectGuardedRequest(source: string, path: string) {
    expect(source, `${path} must preserve the request AbortSignal`).toContain("signal: controller.signal");
    expect(source, `${path} must preserve accepted-task provenance persistence`).toContain("onTaskAccepted: imageTaskAcceptance(");
    expect(source, `${path} must preserve the stale-request guard before applying results`).toContain("if (!isCurrentRequest())");
    expectPaidFallbackInRealPath(source, path);
}

describe("Phase 2C real production paid-fallback call paths", () => {
    test("image page batch invokes consent orchestration after real slot exhaustion", () => {
        const generate = section(imagePageSource, "    const generate = async () => {", "    // 响应 Agent 面板");
        expect(generate).toContain("runGenerationSlot(index, snapshot)");
        expectPaidFallbackInRealPath(generate, "image page batch");
    });

    test("image page single retry invokes consent orchestration after real slot exhaustion", () => {
        const retry = section(imagePageSource, "    const retryResult = async (index: number) => {", "    return (");
        expect(retry).toContain("runGenerationSlot(index, snapshot)");
        expectPaidFallbackInRealPath(retry, "image page single retry");
    });

    test("canvas mask edit keeps source, mask, signal, acceptance, and stale guards while adding consent", () => {
        const mask = section(canvasProjectSource, "    const maskEditImageNode = useCallback(", "    const upscaleImageNode = useCallback");
        expect(mask).toContain("requestEdit(generationConfig, prompt, [source]");
        expect(mask).toContain("dataUrl: payload.maskDataUrl");
        expectGuardedRequest(mask, "canvas mask edit");
    });

    test("canvas angle edit keeps its source image, prompt, signal, acceptance, and stale guards while adding consent", () => {
        const angle = section(canvasProjectSource, "    const generateAngleNode = useCallback(", "    const handleFontSizeChange = useCallback");
        expect(angle).toContain("requestEdit(");
        expect(angle).toContain("generationConfig,\n                    prompt,");
        expect(angle).toContain("dataUrl: node.metadata.content");
        expectGuardedRequest(angle, "canvas angle edit");
    });

    test("canvas plugin panel keeps generated prompt/references and guarded task lifecycle while adding consent", () => {
        const panel = section(
            canvasProjectSource,
            "            if (sourceNode && builtinPanel?.writeBackToSelf",
            "            setRunningNodeId(nodeId);\n            const runController",
        );
        expect(panel).toContain("const fullPrompt = (builtinPanel.promptPrefix || \"\") + scene");
        expect(panel).toContain("requestEdit({ ...generationConfig, count: \"1\" }, fullPrompt, refs");
        expect(panel).toContain("requestGeneration({ ...generationConfig, count: \"1\" }, fullPrompt");
        expectGuardedRequest(panel, "canvas plugin panel");
    });

    test("canvas batch keeps per-target references, prompt, signal, acceptance, and stale guards while adding one consent decision", () => {
        const batch = section(canvasProjectSource, "                if (mode === \"image\") {", "                if (mode === \"video\") {");
        expect(batch).toContain("targetIds.map(async (targetId) =>");
        expect(batch).toContain("effectivePrompt, referenceImages");
        expect(batch).toContain("requestGeneration({ ...generationConfig, count: \"1\" }, effectivePrompt");
        expectGuardedRequest(batch, "canvas image batch");
        expect(batch, "canvas batch must aggregate eligible failures before prompting once").toMatch(/retryLitePoolFailuresWithConsent|\.generateBatch\(/);
    });

    test("canvas node retry keeps saved prompt/references, signal, acceptance, and stale guards while adding consent", () => {
        const retry = section(canvasProjectSource, "            const sourceNode = findRetrySourceNode", "            } catch (error) {");
        expect(retry).toContain("const retryImages = retryReferenceImages || []");
        expect(retry).toContain("requestEdit(generationConfig, prompt, retryImages");
        expect(retry).toContain("requestGeneration(generationConfig, prompt");
        expectGuardedRequest(retry, "canvas node retry");
    });
});
