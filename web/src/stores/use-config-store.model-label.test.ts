import assert from "node:assert/strict";

import { defaultConfig, isHiddenCompatibilityImageModel, modelOptionLabel, selectableModelsByCapability } from "./use-config-store";

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