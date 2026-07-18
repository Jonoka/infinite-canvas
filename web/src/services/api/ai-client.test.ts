import { describe, expect, test } from "bun:test";
import { AxiosHeaders } from "axios";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { aiApiUrl, aiFetchOptions, aiHeaders, aiRequestOptions, assertAiConfig } from "./ai-client";

const config = (values: Partial<AiConfig>): AiConfig => ({ ...defaultConfig, ...values });

describe("central AI protocol", () => {
    test("keeps direct OpenAI-compatible URL and bearer auth without forcing credentials", () => {
        const direct = config({ baseUrl: "https://api.example.com", apiKey: " sk-direct ", apiMode: "direct", group: "" });
        expect(aiApiUrl(direct, "/images/generations?response_format=b64_json")).toBe("https://api.example.com/v1/images/generations?response_format=b64_json");
        expect(aiHeaders(direct)).toEqual({ Authorization: "Bearer sk-direct" });
        expect(aiRequestOptions(direct).withCredentials).toBeUndefined();
        expect(aiFetchOptions(direct).credentials).toBeUndefined();
    });

    test.each(["", "/v1", "/canvas", "/canvas/v1"])("canonicalizes New API base suffix %s", (suffix) => {
        const newapi = config({ baseUrl: `https://api.example.com${suffix}`, apiKey: "", apiMode: "newapi", group: " GPT 生图/专用 " });
        expect(aiApiUrl(newapi, "/images/generations?response_format=url&group=old")).toBe(
            "https://api.example.com/canvas/v1/images/generations?response_format=url&group=GPT+%E7%94%9F%E5%9B%BE%2F%E4%B8%93%E7%94%A8",
        );
    });

    test("uses cookie credentials and strips every Authorization header spelling in New API mode", () => {
        const newapi = config({ baseUrl: "https://api.example.com", apiKey: "", apiMode: "newapi", group: "auto" });
        expect(aiHeaders(newapi)).toEqual({});
        const axios = aiRequestOptions(newapi, { headers: { authorization: "Bearer leaked", AUTHORIZATION: "also leaked", "X-Test": "ok" } });
        expect(axios.withCredentials).toBe(true);
        expect(axios.headers).toEqual({ "X-Test": "ok" });
        const fetch = aiFetchOptions(newapi, { headers: { Authorization: "Bearer leaked", authorization: "also leaked", "X-Test": "ok" } });
        expect(fetch.credentials).toBe("include");
        expect(new Headers(fetch.headers).get("authorization")).toBeNull();
        expect(new Headers(fetch.headers).get("x-test")).toBe("ok");
    });

    test("validates mode-specific required configuration", () => {
        expect(() => assertAiConfig(config({ apiMode: "newapi", baseUrl: "https://api.example.com", apiKey: "", group: "auto", apiFormat: "openai" }), "model", "图像")).not.toThrow();
        expect(() => assertAiConfig(config({ apiMode: "newapi", group: " " }), "model", "图像")).toThrow(/New API 分组/);
        expect(() => assertAiConfig(config({ apiMode: "newapi", group: "auto", apiFormat: "gemini" }), "model", "图像")).toThrow(/OpenAI/);
        expect(() => assertAiConfig(config({ apiMode: "direct", apiKey: " " }), "model", "图像")).toThrow(/API Key/);
    });

    test("normalizes AxiosHeaders for both request adapters", () => {
        const direct = config({ apiKey: "sk-test", apiMode: "direct" });
        const headers = new AxiosHeaders({ "X-Test": "ok", Authorization: "Bearer override" });
        expect(aiRequestOptions(direct, { headers }).headers).toEqual({ Authorization: "Bearer override", "X-Test": "ok" });
        expect(new Headers(aiFetchOptions(direct, { headers }).headers).get("x-test")).toBe("ok");
    });
});