import { describe, expect, test } from "bun:test";

import * as storeApi from "./use-config-store";
import type { AiConfig, ChannelModel } from "./use-config-store";

type Phase2AStoreHooks = {
    isHiddenCompatibilityImageModel: (model: string) => boolean;
    migrateLegacyGptImageConfig: (config: AiConfig) => AiConfig;
    reconcileChannelModels: (config: AiConfig, channelId: string, models: string[]) => AiConfig;
    normalizeChannelModels: (models: Array<string | ChannelModel> | undefined) => ChannelModel[];
    withChannels: (config: AiConfig, channels: ReturnType<typeof storeApi.createModelChannel>[]) => AiConfig;
};

const phase2a = storeApi as typeof storeApi & Partial<Phase2AStoreHooks>;
const { createModelChannel, defaultConfig, modelMatchesCapability, resolveModelRequestConfig, selectableModelsByCapability } = storeApi;

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

    test("does not rewrite an imported default-id channel with a non-official base URL", () => {
        const imported = withDefaultChannel([image("gpt-image-2-pro")], "default::gpt-image-2-pro");
        imported.channels[0] = { ...imported.channels[0], baseUrl: "https://gateway.example/v1" };

        expect(requiredHook("migrateLegacyGptImageConfig")(imported)).toEqual(imported);
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
    test("discovered names are trimmed, deduped, and newly assigned guessed capabilities", () => {
        expect(requiredHook("normalizeChannelModels")([" flux-1 ", "", "flux-1", "gpt-5.5"])).toEqual([
            { name: "flux-1", capability: "image", script: undefined },
            { name: "gpt-5.5", capability: "text", script: undefined },
        ]);
    });

    test("persisted metadata-less models remain capability-permissive after normalization", () => {
        const models = requiredHook("normalizeChannelModels")([{ name: "legacy-opaque-model" }]);
        expect(models).toEqual([{ name: "legacy-opaque-model", capability: undefined, script: undefined }]);
        const config = { ...defaultConfig, channels: [createModelChannel({ id: "legacy", models })] };
        expect(modelMatchesCapability(config, "legacy::legacy-opaque-model", "image")).toBe(true);
        expect(modelMatchesCapability(config, "legacy::legacy-opaque-model", "text")).toBe(true);
    });

    test("persisted metadata-less custom models remain selectable for every capability without duplicates or the image compatibility alias", () => {
        const channel = {
            ...createModelChannel({ id: "legacy" }),
            models: [{ name: "legacy-opaque-model" }, { name: "legacy-opaque-model" }, { name: "gpt-image-2" }],
        };
        const config = { ...defaultConfig, channels: [channel], models: ["legacy::legacy-opaque-model", "legacy::gpt-image-2"] };

        for (const capability of ["image", "video", "text", "audio"] as const) {
            const options = selectableModelsByCapability(config, capability);
            expect(options.filter((model) => model === "legacy::legacy-opaque-model")).toHaveLength(1);
            if (capability === "image") expect(options).not.toContain("legacy::gpt-image-2");
        }
    });

    test("reconciliation and channel replacement preserve a selected metadata-less model", () => {
        const legacy = { name: "legacy-opaque-model" };
        const fallback = image("fallback-image");
        const channel = createModelChannel({ id: "legacy", models: [legacy, fallback] });
        const selected = "legacy::legacy-opaque-model";
        const config = {
            ...defaultConfig,
            channels: [channel],
            models: [selected, "legacy::fallback-image"],
            model: selected,
            imageModel: selected,
            videoModel: selected,
            textModel: selected,
            audioModel: selected,
        };

        const reconciled = requiredHook("reconcileChannelModels")(config, "legacy", ["legacy-opaque-model", "fallback-image"]);
        expect([reconciled.model, reconciled.imageModel, reconciled.videoModel, reconciled.textModel, reconciled.audioModel]).toEqual(Array(5).fill(selected));

        const replaced = requiredHook("withChannels")(config, [createModelChannel({ ...channel, models: [legacy, fallback] })]);
        expect([replaced.model, replaced.imageModel, replaced.videoModel, replaced.textModel, replaced.audioModel]).toEqual(Array(5).fill(selected));
    });

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

    test("channel deletion repairs the generic selection as well as capability selections", () => {
        const first = createModelChannel({ id: "first", models: [image("first-image")] });
        const second = createModelChannel({ id: "second", models: [image("second-image")] });
        const config = { ...defaultConfig, channels: [first, second], models: ["first::first-image", "second::second-image"], model: "second::second-image", imageModel: "second::second-image" };

        const repaired = requiredHook("withChannels")(config, [first]);
        expect(repaired.imageModel).toBe("first::first-image");
        expect(repaired.model).toBe("first::first-image");
    });
});
