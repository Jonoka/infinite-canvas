import assert from "node:assert/strict";

import { defaultConfig, modelOptionLabel } from "./use-config-store";

assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2-lite"), "GPT Image 2 · 轻量版");
assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2-pro"), "GPT Image 2 · 专业版");
assert.equal(modelOptionLabel(defaultConfig, "default::gpt-image-2-lite"), "GPT Image 2 · 轻量版（默认渠道）");
assert.equal(modelOptionLabel(defaultConfig, "gpt-image-2"), "gpt-image-2", "the compatibility model should keep its existing label");