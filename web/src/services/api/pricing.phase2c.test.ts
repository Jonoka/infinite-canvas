import { describe, expect, test } from "bun:test";

import * as pricingApi from "./pricing";
import type { AiConfig } from "@/stores/use-config-store";

type PricingRequest = { url: string; options: RequestInit & { withCredentials?: boolean } };
type PricingApi = {
    buildPricingRequest: (config: AiConfig, signal?: AbortSignal) => PricingRequest;
    pricingRequestTransport: { buildRequest: (config: AiConfig, signal?: AbortSignal) => PricingRequest };
    fetchPricing: (config: AiConfig, options?: { signal?: AbortSignal; fetch?: typeof fetch }) => Promise<unknown>;
};
const production = pricingApi as typeof pricingApi & Partial<PricingApi>;

function config(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        apiMode: "newapi", apiFormat: "openai", baseUrl: "https://new-api.example.com/v1/", apiKey: "must-not-leak",
        group: "auto", model: "gpt-image-2-lite", imageModel: "gpt-image-2-lite", channels: [], quality: "low", size: "1:1", count: "1",
        ...overrides,
    } as AiConfig;
}

function build(value: AiConfig, signal?: AbortSignal) {
    expect(typeof production.buildPricingRequest, "Phase 2C requires a public production request builder used by fetchPricing").toBe("function");
    return production.buildPricingRequest!(value, signal);
}

describe("Phase 2C pricing request semantics", () => {
    test("the real fetchPricing path calls the exported builder contract and injected native fetch", async () => {
        expect(typeof production.fetchPricing).toBe("function");
        expect(production.pricingRequestTransport?.buildRequest).toBe(production.buildPricingRequest);
        const signal = new AbortController().signal;
        const seam = production.pricingRequestTransport!;
        const originalBuilder = seam.buildRequest;
        let builds = 0;
        let expected: PricingRequest | undefined;
        seam.buildRequest = (value, requestSignal) => {
            builds++;
            expected = originalBuilder(value, requestSignal);
            return expected;
        };
        const calls: Array<{ url: string; options?: RequestInit }> = [];
        const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
            calls.push({ url: String(url), options });
            return new Response(JSON.stringify({ success: true, data: [], group_ratio: {}, auto_groups: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch;

        try {
            await production.fetchPricing!(config({ group: "paid/group" }), { signal, fetch: fetcher });
            expect(builds).toBe(1);
            expect(calls).toHaveLength(1);
            expect(calls[0].url).toBe(expected!.url);
            expect(calls[0].options).toEqual(expected!.options);
        } finally {
            seam.buildRequest = originalBuilder;
        }
    });

    test("requests live New API pricing for the resolved group with cookies", () => {
        const signal = new AbortController().signal;
        const request = build(config({ group: "paid/group" }), signal);
        const url = new URL(request.url);
        expect(url.origin + url.pathname).toBe("https://new-api.example.com/canvas/v1/pricing");
        expect(url.searchParams.get("group")).toBe("paid/group");
        expect(request.options.withCredentials).toBe(true);
        expect(request.options.method?.toUpperCase() || "GET").toBe("GET");
        expect(request.options).toMatchObject({ signal });
    });

    test("never sends the locally stored API key", () => {
        const headers = new Headers(build(config()).options.headers);
        expect(headers.has("Authorization")).toBe(false);
        expect(JSON.stringify(Object.fromEntries(headers))).not.toContain("must-not-leak");
    });

    test.each([
        "https://new-api.example.com", "https://new-api.example.com/", "https://new-api.example.com/v1", "https://new-api.example.com/v1/",
        "https://new-api.example.com/canvas", "https://new-api.example.com/canvas/v1", "https://new-api.example.com/console",
        "https://new-api.example.com/console/?tenant=x#settings",
    ])("canonicalizes supported public base URL %s", (baseUrl) => {
        const url = new URL(build(config({ baseUrl, group: "pro" })).url);
        expect(url.origin + url.pathname).toBe("https://new-api.example.com/canvas/v1/pricing");
        expect(url.searchParams.get("group")).toBe("pro");
        expect(url.hash).toBe("");
    });
});
