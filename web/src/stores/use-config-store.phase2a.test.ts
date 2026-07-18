import { describe, expect, test } from "bun:test";

import * as storeApi from "./use-config-store";
import type { AiConfig, ChannelModel } from "./use-config-store";

type Phase2AStoreHooks = {
    isHiddenCompatibilityImageModel: (model: string) => boolean;
    migrateLegacyGptImageConfig: (config: AiConfig) => AiConfig;
    reconcileChannelModels: (config: AiConfig, channelId: string, models: string[]) => AiConfig;
};

const phase2a = storeApi as typeof storeApi & Partial<Phase2AStoreHooks>;
const { createModelChannel, defaultConfig, resolveModelRequestConfig, selectableModelsByCapability } = storeApi;

function requiredHook<K extends keyof Phase2AStoreHooks>(name: K): Phase2AStoreHooks[K] {
    const hook = phase2a[name];
    expect(hook, `use-config-store.ts must export ${name} for Phase 2A reconciliation`).toBeFunction();
    return hook as Phase2AStoreHooks[K];
}

const image = (name: string) => ({ name, capability: "image" as const });
const unrelatedModels: ChannelModel[] = [
    { name: "grok-imagine-video", capability: "video", script: "return 'video'" },
    { name: "gpt-5.5", capability: "text", script: "return 'text'" },
    { name: "gpt-4o-mini-tts", capability: "audio", script: "return 'audio'" },
];

function withDefaultChannel(models: ChannelModel[], selection: string): AiConfig {
    const channel = createModelChannel({
        ...defaultConfig.channels[0],
        id: "default",
        name: "默认渠道",
        models,
    });
    return {
        ...defaultConfig,
        channels: [channel],
        models: channel.models.map((model) => `default::${model.name}`),
        model: selection,
        imageModel: selection,
    };
}

describe("Phase 2A Lite/Pro config migration", () => {
    test.each(["gpt-image-2", "gpt-image-2-pro"])("migrates the %s image entry in the official default channel without deleting unrelated capability models", (legacyModel) => {
        const migrated = requiredHook("migrateLegacyGptImageConfig")(
            withDefaultChannel([image(legacyModel), ...unrelatedModels], `default::${legacyModel}`),
        );

        const expectedModels = [image("gpt-image-2-lite"), image("gpt-image-2-pro"), ...unrelatedModels];
        expect(migrated.channels[0].models).toEqual(expectedModels);
        expect(migrated.models).toEqual(expectedModels.map((model) => `default::${model.name}`));
        expect(selectableModelsByCapability(migrated, "image")).toEqual(["default::gpt-image-2-lite", "default::gpt-image-2-pro"]);
        expect(migrated.imageModel).toBe("default::gpt-image-2-lite");
        expect(migrated.model).toBe("default::gpt-image-2-lite");
        expect(migrated.videoModel).toBe(defaultConfig.videoModel);
        expect(migrated.textModel).toBe(defaultConfig.textModel);
        expect(migrated.audioModel).toBe(defaultConfig.audioModel);
    });

    test("does not rewrite a custom channel that happens to use a Pro-only model", () => {
        const custom = withDefaultChannel([image("gpt-image-2-pro")], "custom::gpt-image-2-pro");
        custom.channels = [{ ...custom.channels[0], id: "custom", name: "我的渠道" }];
        custom.models = ["custom::gpt-image-2-pro"];

        expect(requiredHook("migrateLegacyGptImageConfig")(custom)).toEqual(custom);
    });

    test("hides the compatibility alias from image selection without hiding Lite or Pro", () => {
        const config = withDefaultChannel(
            [image("gpt-image-2"), image("gpt-image-2-lite"), image("gpt-image-2-pro")],
            "default::gpt-image-2-lite",
        );

        const hidden = requiredHook("isHiddenCompatibilityImageModel");
        expect(hidden("gpt-image-2")).toBe(true);
        expect(hidden("default::gpt-image-2")).toBe(true);
        expect(hidden("gpt-image-2-lite")).toBe(false);
        expect(selectableModelsByCapability(config, "image")).toEqual(["default::gpt-image-2-lite", "default::gpt-image-2-pro"]);
    });
});

describe("Phase 2A authoritative channel reconciliation", () => {
    test("fixed-group discovery removes stale models and repairs invalid image and generic selections", () => {
        const config = withDefaultChannel([image("gpt-image-2-lite"), image("gpt-image-2-pro"), image("stale-image")], "default::gpt-image-2-pro");
        config.channels[0] = { ...config.channels[0], apiMode: "newapi", group: "GPT生图特价" };

        const reconciled = requiredHook("reconcileChannelModels")(config, "default", ["gpt-image-2-lite"]);

        expect(reconciled.channels[0].models).toEqual([image("gpt-image-2-lite")]);
        expect(reconciled.models).toEqual(["default::gpt-image-2-lite"]);
        expect(reconciled.imageModel).toBe("default::gpt-image-2-lite");
        expect(reconciled.model).toBe("default::gpt-image-2-lite");
    });

    test("auto discovery accepts the complete returned union instead of retaining a previous subset", () => {
        const config = withDefaultChannel([image("gpt-image-2-lite")], "default::gpt-image-2-lite");
        config.channels[0] = { ...config.channels[0], apiMode: "newapi", group: "auto" };

        const reconciled = requiredHook("reconcileChannelModels")(config, "default", ["gpt-image-2-lite", "gpt-image-2-pro", "flux-1"]);

        expect(reconciled.channels[0].models).toEqual([image("gpt-image-2-lite"), image("gpt-image-2-pro"), image("flux-1")]);
        expect(selectableModelsByCapability(reconciled, "image")).toEqual([
            "default::gpt-image-2-lite",
            "default::gpt-image-2-pro",
            "default::flux-1",
        ]);
    });

    test("request resolution preserves the selected channel group for both Lite and Pro", () => {
        const config = withDefaultChannel([image("gpt-image-2-lite"), image("gpt-image-2-pro")], "default::gpt-image-2-lite");
        config.channels[0] = { ...config.channels[0], apiMode: "newapi", group: "GPT 生图/专用" };

        expect(resolveModelRequestConfig(config, "default::gpt-image-2-lite").group).toBe("GPT 生图/专用");
        expect(resolveModelRequestConfig(config, "default::gpt-image-2-pro").group).toBe("GPT 生图/专用");
    });
});
