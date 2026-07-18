import { describe, expect, test } from "bun:test";

import { createImageWorkbenchActions } from "@/pages/image/image-generation-actions";
import { createCanvasImageActions } from "@/pages/canvas/canvas-image-actions";
import { createPluginImageActions } from "@/pages/canvas/hooks/use-plugin-host";
import { confirmLiteToProFallback } from "./lite-pro-fallback-consent";
import { ImageRequestError } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";

// Vite injects this while Bun evaluates the real page graphs directly.
(globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ ??= "test";

const imagePage = await import("@/pages/image");
const canvasProject = await import("@/pages/canvas/project");

type Result = PromiseSettledResult<string>;
const exhausted = new ImageRequestError("empty", "lite_pool_exhausted");
const lite = { apiMode: "newapi", model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", group: "lite", count: "1" } as AiConfig;

function deps() {
    const calls: Array<{ surface: string; config: AiConfig }> = [];
    let prompts = 0;
    return {
        calls,
        get prompts() { return prompts; },
        request: async (surface: string, config: AiConfig) => { calls.push({ surface, config }); return config.model.includes("pro") ? `pro:${surface}` : Promise.reject(exhausted); },
        consent: async () => { prompts++; return { model: "gpt-image-2-pro", group: "auto", quality: "low", size: "1:1", count: 1 }; },
    };
}

describe("Phase 2C production action/factory wiring", () => {
    test("the real image page exports the exact action factory and confirmation function it wires", () => {
        expect(imagePage.imageWorkbenchPaidFallbackWiring).toEqual({
            createActions: createImageWorkbenchActions,
            confirm: confirmLiteToProFallback,
        });
    });

    test("the real canvas project names every eligible path and wires exact shared references", () => {
        expect(canvasProject.canvasProjectPaidFallbackWiring).toEqual({
            mask: createCanvasImageActions,
            angle: createCanvasImageActions,
            "plugin-panel": createCanvasImageActions,
            batch: createCanvasImageActions,
            "node-retry": createCanvasImageActions,
            confirm: confirmLiteToProFallback,
        });
    });

    test.each(["batch", "single-retry"] as const)("image workbench %s uses the exported shared paid-consent action", async (operation) => {
        const d = deps();
        const actions = imagePage.imageWorkbenchPaidFallbackWiring.createActions({ request: d.request, requestConsent: d.consent });
        const output: Result[] = operation === "batch" ? await actions.generateBatch(lite, ["a", "b"]) : [await actions.retrySlot(lite, "a")];
        expect(d.prompts).toBe(1);
        expect(d.calls.filter((call) => call.config.model.includes("pro"))).toHaveLength(output.length);
        if (operation === "batch") expect(d.calls.filter((call) => call.config.model.includes("pro")).map((call) => String(call.config.count))).toEqual(["1", "1"]);
        expect(output.every((item) => item.status === "fulfilled")).toBe(true);
    });

    test.each(["mask", "angle", "plugin-panel", "batch", "node-retry"] as const)("canvas %s routes through its exported shared paid-consent factory", async (surface) => {
        const d = deps();
        const factory = canvasProject.canvasProjectPaidFallbackWiring[surface];
        const actions = factory({ request: d.request, requestConsent: d.consent });
        const output = await actions.run(surface, lite, surface === "batch" ? ["a", "b"] : ["a"]);
        expect(d.prompts).toBe(1);
        expect(d.calls.filter((call) => call.config.model.includes("pro"))).toHaveLength(output.length);
    });

    test("pricing uses failed-request provenance rather than mutable global selection", async () => {
        const d = deps();
        const priced: AiConfig[] = [];
        const failedRequest = { ...lite, channelId: "images", baseUrl: "https://failed.example/canvas/v1", group: "lite-channel" };
        const actions = imagePage.imageWorkbenchPaidFallbackWiring.createActions({
            request: d.request,
            requestConsent: d.consent,
            loadPricing: async (resolvedFailedConfig: AiConfig) => { priced.push(resolvedFailedConfig); return null; },
        });
        await actions.retrySlot(failedRequest, "slot");
        expect(priced).toHaveLength(1);
        expect(priced[0]).toMatchObject({ channelId: "images", baseUrl: "https://failed.example/canvas/v1", group: "lite-channel", model: "gpt-image-2-lite" });
    });

    test("plugin host direct API exports an explicit no-fallback action", async () => {
        const d = deps();
        const plugin = createPluginImageActions({ request: d.request });
        await expect(plugin.generateImage(lite, "plugin-direct")).rejects.toBe(exhausted);
        expect(d.calls).toHaveLength(1);
        expect(plugin.paidFallbackPolicy).toBe("none");
    });
});
