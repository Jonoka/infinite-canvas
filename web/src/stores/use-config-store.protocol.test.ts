import { describe, expect, test } from "bun:test";

import { assertModelCapability, createModelChannel, defaultConfig, modelMatchesCapability, normalizePersistedAiConfig, resolveModelRequestConfig, useConfigStore } from "./use-config-store";

describe("AI protocol config resolution", () => {
    test("retains ChannelModel metadata and normalizes persisted protocol fields", () => {
        const normalized = normalizePersistedAiConfig({
            ...defaultConfig,
            apiMode: "invalid" as never,
            group: " top-level ",
            channels: [{ ...defaultConfig.channels[0], apiMode: undefined as never, group: " channel group ", models: [{ name: "same-model", capability: "image", script: " return 1 " }] }],
        });
        expect(normalized.apiMode).toBe("direct");
        expect(normalized.group).toBe("top-level");
        expect(normalized.channels[0]).toMatchObject({ apiMode: "direct", group: "channel group", apiFormat: "openai" });
        expect(normalized.channels[0].models).toEqual([{ name: "same-model", capability: "image", script: "return 1" }]);
    });

    test("resolves an encoded duplicate model from its exact channel", () => {
        const first = createModelChannel({ id: "first", baseUrl: "https://first.example", apiKey: "first-key", apiMode: "direct", group: "first", models: [{ name: "duplicate", capability: "text" }] });
        const second = createModelChannel({ id: "second", baseUrl: "https://second.example/canvas", apiKey: "", apiMode: "newapi", group: " second group ", models: [{ name: "duplicate", capability: "text" }] });
        const resolved = resolveModelRequestConfig({ ...defaultConfig, channels: [first, second] }, "second::duplicate");
        expect(resolved).toMatchObject({ baseUrl: "https://second.example/canvas", apiKey: "", apiMode: "newapi", group: "second group", apiFormat: "openai", model: "duplicate" });
    });

    test("enforces explicit capability metadata but permits legacy models", () => {
        const legacy = { name: "legacy-model" } as { name: string; capability?: "image" | "video" | "text" | "audio" };
        const config = { ...defaultConfig, channels: [createModelChannel({ id: "cap", baseUrl: "https://api.example", apiKey: "key", models: [{ name: "image-model", capability: "image" }, legacy] })] };
        expect(() => assertModelCapability(config, "cap::image-model", "text", "文本")).toThrow(/不支持文本/);
        expect(modelMatchesCapability(config, "cap::legacy-model", "text")).toBe(true);
        expect(() => assertModelCapability(config, "cap::legacy-model", "text", "文本")).not.toThrow();
    });

    test("readiness follows mode-specific requirements", () => {
        const ready = useConfigStore.getState().isAiConfigReady;
        const newapi = createModelChannel({ id: "n", baseUrl: "https://api.example", apiMode: "newapi", group: "auto", apiKey: "", models: [{ name: "model", capability: "text" }] });
        expect(ready({ ...defaultConfig, channels: [newapi] }, "n::model")).toBe(true);
        expect(ready({ ...defaultConfig, channels: [{ ...newapi, group: " " }] }, "n::model")).toBe(false);
        expect(ready({ ...defaultConfig, channels: [{ ...newapi, baseUrl: " " }] }, "n::model")).toBe(false);
        expect(ready({ ...defaultConfig, channels: [{ ...newapi, apiMode: "direct" }] }, "n::model")).toBe(false);
    });
});