import assert from "node:assert/strict";

import { aiApiUrl, aiHeaders, aiRequestOptions, assertAiConfig } from "./ai-client";
import type { AiConfig } from "@/stores/use-config-store";

const directConfig = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    apiMode: "direct",
    group: "",
    model: "gpt-image-2",
} as AiConfig;

const newApiConfig = {
    ...directConfig,
    baseUrl: "https://api.example.com/canvas",
    apiKey: "",
    apiMode: "newapi",
    group: "codex",
} as AiConfig;

assert.equal(aiApiUrl(newApiConfig, "/images/generations"), "https://api.example.com/canvas/v1/images/generations?group=codex");
assert.equal(aiApiUrl({ ...newApiConfig, baseUrl: "https://api.example.com" }, "/images/generations"), "https://api.example.com/canvas/v1/images/generations?group=codex");
assert.equal(aiApiUrl({ ...newApiConfig, baseUrl: "https://api.example.com/v1" }, "/images/generations"), "https://api.example.com/canvas/v1/images/generations?group=codex");
assert.deepEqual(aiHeaders(newApiConfig, "application/json"), { "Content-Type": "application/json" });
assert.equal(aiRequestOptions(newApiConfig).withCredentials, true);
assert.doesNotThrow(() => assertAiConfig(newApiConfig, "gpt-image-2", "生图"));

assert.equal(aiApiUrl(directConfig, "/images/generations"), "https://api.example.com/v1/images/generations");
assert.deepEqual(aiHeaders(directConfig, "application/json"), { Authorization: "Bearer sk-test", "Content-Type": "application/json" });
assert.equal(aiRequestOptions(directConfig).withCredentials, undefined);
assert.doesNotThrow(() => assertAiConfig(directConfig, "gpt-image-2", "生图"));

assert.throws(() => assertAiConfig({ ...newApiConfig, group: "" }, "gpt-image-2", "生图"), /New API 分组/);
assert.throws(() => assertAiConfig({ ...directConfig, apiKey: "" }, "gpt-image-2", "生图"), /API Key/);
