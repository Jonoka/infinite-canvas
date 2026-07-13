import assert from "node:assert/strict";

import { defaultConfig, isHiddenCompatibilityImageModel, migrateLegacyGptImageConfig, modelOptionLabel, selectableModelsByCapability } from "./use-config-store";

assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2-lite"), "GPT Image 2 · 轻量版");
assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2-pro"), "GPT Image 2 · 专业版");
assert.equal(modelOptionLabel(defaultConfig, "default::gpt-image-2-lite"), "GPT Image 2 · 轻量版（默认渠道）");
assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2"), "gpt-image-2", "the compatibility model should keep its existing label");
assert.equal(isHiddenCompatibilityImageModel("gpt-image-2"), true);
assert.equal(isHiddenCompatibilityImageModel("default::gpt-image-2"), true);
assert.equal(isHiddenCompatibilityImageModel("gpt-image-2-lite"), false);
assert.deepEqual(
    selectableModelsByCapability(
        {
            ...defaultConfig,
            imageModels: ["default::gpt-image-2", "default::gpt-image-2-lite", "default::gpt-image-2-pro"],
        },
        "image",
    ),
    ["default::gpt-image-2-lite", "default::gpt-image-2-pro"],
    "the legacy compatibility model should be hidden from image pickers",
);

const legacyProOnlyConfig = {
    ...defaultConfig,
    channels: [
        {
            ...defaultConfig.channels[0],
            models: ["gpt-image-2-pro"],
        },
    ],
    models: ["default::gpt-image-2-pro"],
    imageModels: ["default::gpt-image-2-pro"],
    model: "default::gpt-image-2-pro",
    imageModel: "default::gpt-image-2-pro",
};
const migratedLegacyConfig = migrateLegacyGptImageConfig(legacyProOnlyConfig);
assert.deepEqual(
    migratedLegacyConfig.channels[0].models,
    ["gpt-image-2-lite", "gpt-image-2-pro"],
    "legacy default channels should gain the lite model without losing pro",
);
assert.deepEqual(
    migratedLegacyConfig.imageModels,
    ["default::gpt-image-2-lite", "default::gpt-image-2-pro"],
    "legacy pro-only image choices should gain lite",
);
assert.equal(migratedLegacyConfig.imageModel, "default::gpt-image-2-lite", "legacy pro-only defaults should migrate to lite");

const configuredLiteAndPro = {
    ...defaultConfig,
    channels: [{ ...defaultConfig.channels[0], models: ["gpt-image-2-lite", "gpt-image-2-pro"] }],
    models: ["default::gpt-image-2-lite", "default::gpt-image-2-pro"],
    imageModels: ["default::gpt-image-2-pro"],
    model: "default::gpt-image-2-pro",
    imageModel: "default::gpt-image-2-pro",
};
assert.deepEqual(migrateLegacyGptImageConfig(configuredLiteAndPro), configuredLiteAndPro, "an explicit lite/pro selection must remain unchanged");

const customConfig = {
    ...legacyProOnlyConfig,
    channels: [{ ...legacyProOnlyConfig.channels[0], id: "custom", name: "自定义渠道" }],
    models: ["custom::gpt-image-2-pro"],
    imageModels: ["custom::gpt-image-2-pro"],
    model: "custom::gpt-image-2-pro",
    imageModel: "custom::gpt-image-2-pro",
};
assert.deepEqual(migrateLegacyGptImageConfig(customConfig), customConfig, "custom channels must not be modified by the official default-channel migration");