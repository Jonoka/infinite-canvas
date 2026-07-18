import { describe, expect, test } from "bun:test";

import * as imageApi from "./image";
import type { AiConfig } from "@/stores/use-config-store";

type ImageRequestTestHooks = {
    buildGenerationRequestBody: (config: AiConfig, prompt: string) => Record<string, unknown>;
    buildEditFormData: (config: AiConfig, prompt: string) => FormData;
    normalizeDiscoveredModelNames: (payload: unknown) => string[];
};

const hooks = (imageApi as typeof imageApi & { __test__?: ImageRequestTestHooks }).__test__;

function config(overrides: Partial<AiConfig>): AiConfig {
    return {
        apiMode: "direct",
        apiFormat: "openai",
        model: "gpt-image-2-pro",
        imageModel: "gpt-image-2-pro",
        quality: "auto",
        size: "1:1",
        count: "1",
        systemPrompt: "",
        ...overrides,
    } as AiConfig;
}

function generation(overrides: Partial<AiConfig>, prompt = "prompt") {
    expect(hooks, "image.ts must expose pure standard-OpenAI request builders for protocol tests").toBeDefined();
    return hooks!.buildGenerationRequestBody(config(overrides), prompt);
}

function edit(overrides: Partial<AiConfig>, prompt = "prompt") {
    expect(hooks, "image.ts must expose pure standard-OpenAI request builders for protocol tests").toBeDefined();
    return hooks!.buildEditFormData(config(overrides), prompt);
}

describe("Phase 2A standard OpenAI image transport semantics", () => {
    test.each(["gpt-image-2", "GPT-IMAGE-2-LITE", "gpt-image-2-pro"])("New API generation makes %s asynchronous and requests URL output", (model) => {
        const body = generation({ apiMode: "newapi", model, imageModel: model });
        expect(body.async).toBe(true);
        expect(body.response_format).toBe("url");
    });

    test.each(["gpt-image-2", "gpt-image-2-lite", "gpt-image-2-pro"])("New API edit makes %s asynchronous and requests URL output", (model) => {
        const form = edit({ apiMode: "newapi", model, imageModel: model });
        expect(form.get("async")).toBe("true");
        expect(form.get("response_format")).toBe("url");
    });

    test.each(["gpt-image-2", "gpt-image-2-lite", "gpt-image-2-pro"])("direct %s generation keeps synchronous base64 compatibility unless async is explicitly requested", (model) => {
        const body = generation({ apiMode: "direct", model, imageModel: model });
        expect(Object.hasOwn(body, "async")).toBe(false);
        expect(body.response_format).toBe("b64_json");
    });

    test.each(["gpt-image-2", "gpt-image-2-lite", "gpt-image-2-pro"])("direct %s edit keeps synchronous base64 compatibility unless async is explicitly requested", (model) => {
        const form = edit({ apiMode: "direct", model, imageModel: model });
        expect(form.has("async")).toBe(false);
        expect(form.get("response_format")).toBe("b64_json");
    });

    test.each(["gpt-image-3", "gpt-image-custom", "my-gpt-image-2"])("New API does not apply GPT Image 2 async/URL semantics to %s", (model) => {
        const body = generation({ apiMode: "newapi", model, imageModel: model });
        expect(Object.hasOwn(body, "async")).toBe(false);
        expect(body.response_format).toBe("b64_json");
    });
});

describe("Phase 2A model discovery normalization", () => {
    test("validates the array and trims, filters, and dedupes names", () => {
        expect(hooks!.normalizeDiscoveredModelNames([" flux-1 ", 3, "", "flux-1", null, " gpt-5.5 "])).toEqual(["flux-1", "gpt-5.5"]);
    });

    test.each([[{}], ["models"], [null], [[]]])("rejects malformed or valid-empty discovery payload %#", (payload) => {
        expect(() => hooks!.normalizeDiscoveredModelNames(payload)).toThrow(/模型列表/);
    });
});

describe("Phase 2A gpt-image ratio and quality presets", () => {
    test("Pro high 9:16 resolves to the verified explicit 2160x3840 preset", () => {
        const body = generation({ model: "gpt-image-2-pro", imageModel: "gpt-image-2-pro", quality: "high", size: "9:16" }, "海报");
        expect(body.quality).toBe("high");
        expect(body.size).toBe("2160x3840");
        expect(body.prompt).toBe("海报");
    });

    test("gpt-image edit uses the same explicit Pro preset", () => {
        const form = edit({ model: "gpt-image-2-pro", imageModel: "gpt-image-2-pro", quality: "high", size: "9:16" }, "调整海报");
        expect(form.get("quality")).toBe("high");
        expect(form.get("size")).toBe("2160x3840");
    });

    test("non-gpt low 4:3 retains the previous generic ratio-to-pixel sizing", () => {
        const body = generation({ model: "other-image-model", imageModel: "other-image-model", quality: "low", size: "4:3" });
        expect(body.size).toBe("1168x880");
    });

    test("Lite forces low/1K and adds a composition-only ratio hint", () => {
        const body = generation({ model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", quality: "high", size: "9:16" }, "一只猫");
        expect(body.quality).toBe("low");
        expect(body.size).toBe("720x1280");
        expect(body.prompt).toBe("一只猫\n\n输出必须采用 9:16 竖向构图，目标宽高比严格为 9:16；实际像素可由模型决定。");
    });

    test("Lite replaces an existing generated ratio hint instead of duplicating hints", () => {
        const oldHint = "输出必须采用 9:16 竖向构图，目标宽高比严格为 9:16；实际像素可由模型决定。";
        const body = generation({ model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", quality: "medium", size: "16:9" }, `一只猫\n\n${oldHint}`);
        expect(body.prompt).toBe("一只猫\n\n输出必须采用 16:9 横向构图，目标宽高比严格为 16:9；实际像素可由模型决定。");
        expect(String(body.prompt).match(/输出必须采用/g)).toHaveLength(1);
    });

    test("Lite edit shares forced low/1K sizing and ratio-hint behavior", () => {
        const form = edit({ model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", quality: "auto", size: "4:3", systemPrompt: "系统" }, "调整图片");
        expect(form.get("quality")).toBe("low");
        expect(form.get("size")).toBe("1152x864");
        expect(form.get("prompt")).toBe("系统\n\n调整图片\n\n输出必须采用 4:3 横向构图，目标宽高比严格为 4:3；实际像素可由模型决定。");
    });

    test("Lite generation preserves an explicit valid pixel size without adding a fabricated ratio hint", () => {
        const body = generation({ model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", quality: "high", size: "1024x768" }, "像素尺寸");
        expect(body.quality).toBe("low");
        expect(body.size).toBe("1024x768");
        expect(body.prompt).toBe("像素尺寸");
    });

    test("Lite edit with auto omits size and ratio hint while still forcing low quality", () => {
        const form = edit({ model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", quality: "auto", size: "auto" }, "自动尺寸");
        expect(form.get("quality")).toBe("low");
        expect(form.has("size")).toBe(false);
        expect(form.get("prompt")).toBe("自动尺寸");
    });
});
