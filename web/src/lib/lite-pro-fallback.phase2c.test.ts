import { describe, expect, test } from "bun:test";

import * as fallbackPolicy from "./lite-pro-fallback";
import type { PricingPayload } from "./image-pricing";
import type { AiConfig } from "@/stores/use-config-store";

type Fallback = {
    model: "gpt-image-2-pro"; group: string; quality: "low"; size: string; count: number;
    switchesToAuto: boolean; cost: { cost: number; group: string } | null;
};
type FallbackSeams = {
    ImageRequestError: new (message: string, code?: string | number) => Error & { code?: string | number };
    isLitePoolExhaustedError: (error: unknown) => boolean;
    buildLiteToProFallback: (input: {
        apiMode: string; model: string; group: string; size: string; pricing: PricingPayload | null;
        pricingAvailable?: boolean; count: number;
    }) => Fallback | null;
    applyLiteToProRequestOverride: (config: AiConfig, fallback: Fallback) => AiConfig;
};
const seams = fallbackPolicy as typeof fallbackPolicy & Partial<FallbackSeams>;

const pricing: PricingPayload = {
    success: true,
    data: [
        { model_name: "gpt-image-2-lite", quota_type: 1, model_price: 0.1, enable_groups: ["lite", "shared"] },
        { model_name: "gpt-image-2-pro", quota_type: 1, model_price: 0.75, enable_groups: ["pro", "shared"] },
    ],
    group_ratio: { lite: 0.5, pro: 1.25, shared: 1 },
    auto_groups: ["lite", "pro", "shared"],
};

function fallback(input: Parameters<FallbackSeams["buildLiteToProFallback"]>[0]) {
    expect(typeof seams.buildLiteToProFallback).toBe("function");
    return seams.buildLiteToProFallback!(input);
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        apiMode: "newapi", apiFormat: "openai", baseUrl: "https://new-api.example.com", apiKey: "", group: "lite",
        model: "channel::gpt-image-2-lite", imageModel: "channel::gpt-image-2-lite", channels: [], quality: "low", size: "9:16", count: "4",
        ...overrides,
    } as AiConfig;
}

describe("Phase 2C exact paid-fallback eligibility", () => {
    test("only the structured exact code is recognized", () => {
        expect(typeof seams.ImageRequestError).toBe("function");
        expect(seams.isLitePoolExhaustedError?.(new seams.ImageRequestError!("pool empty", "lite_pool_exhausted"))).toBe(true);
        expect(seams.isLitePoolExhaustedError?.(new seams.ImageRequestError!("pool empty", "LITE_POOL_EXHAUSTED"))).toBe(false);
        expect(seams.isLitePoolExhaustedError?.(new seams.ImageRequestError!("lite_pool_exhausted"))).toBe(false);
        expect(seams.isLitePoolExhaustedError?.(new Error("lite_pool_exhausted"))).toBe(false);
        expect(seams.isLitePoolExhaustedError?.({ code: "lite_pool_exhausted" })).toBe(false);
    });

    test.each([
        [{ error: { code: "lite_pool_exhausted", message: "empty" } }],
        [{ data: { error: { code: "lite_pool_exhausted", message: "empty" } } }],
        [{ code: "lite_pool_exhausted", msg: "empty" }],
    ])("real API envelopes become ImageRequestError before exact eligibility", (payload) => {
        const parse = (seams as typeof seams & { imageRequestErrorFromPayload?: (payload: unknown, fallback: string) => Error }).imageRequestErrorFromPayload;
        expect(typeof parse).toBe("function");
        const error = parse!(payload, "request failed");
        expect(error).toBeInstanceOf(seams.ImageRequestError!);
        expect(seams.isLitePoolExhaustedError?.(error)).toBe(true);
    });

    test.each([
        ["direct mode", { apiMode: "direct", model: "gpt-image-2-lite" }],
        ["Pro request", { apiMode: "newapi", model: "gpt-image-2-pro" }],
        ["unrelated model", { apiMode: "newapi", model: "other-image" }],
    ])("%s never produces a consent offer", (_label, override) => {
        expect(fallback({ apiMode: override.apiMode, model: override.model, group: "auto", size: "1:1", pricing, count: 1 })).toBeNull();
    });

    test("a fixed group that supports Pro stays fixed", () => {
        expect(fallback({ apiMode: "newapi", model: "gpt-image-2-lite", group: "shared", size: "9:16", pricing, count: 2 })).toMatchObject({
            group: "shared", switchesToAuto: false, cost: { cost: 1.5, group: "shared" },
        });
    });

    test("a fixed Lite-only group visibly switches this one retry to auto and prices the actual Pro auto route", () => {
        expect(fallback({ apiMode: "newapi", model: "gpt-image-2-lite", group: "lite", size: "9:16", pricing, count: 2 })).toEqual({
            model: "gpt-image-2-pro", group: "auto", quality: "low", size: "9:16", count: 2,
            switchesToAuto: true, cost: { cost: 1.875, group: "pro" },
        });
    });

    test("unavailable pricing still permits explicit consent but discloses no guessed price or fixed-group capability", () => {
        expect(fallback({ apiMode: "newapi", model: "gpt-image-2-lite", group: "lite", size: "1:1", pricing: null, pricingAvailable: false, count: 1 })).toEqual({
            model: "gpt-image-2-pro", group: "auto", quality: "low", size: "1:1", count: 1,
            switchesToAuto: true, cost: null,
        });
    });
});

describe("Phase 2C one-shot override and provenance", () => {
    test("applies Pro/auto/count only to a cloned request and never mutates persisted config", () => {
        expect(typeof seams.applyLiteToProRequestOverride, "Phase 2C requires a real one-shot request override seam").toBe("function");
        const persisted = config();
        const before = structuredClone(persisted);
        const paid = fallback({ apiMode: "newapi", model: persisted.imageModel, group: persisted.group, size: persisted.size, pricing, count: 2 })!;
        const request = seams.applyLiteToProRequestOverride!(persisted, paid);

        expect(request).not.toBe(persisted);
        expect(request).toMatchObject({ model: "gpt-image-2-pro", imageModel: "gpt-image-2-pro", group: "auto", quality: "low", size: "9:16", count: "2" });
        expect(persisted).toEqual(before);
        expect(persisted.imageModel).toBe("channel::gpt-image-2-lite");
        expect(persisted.group).toBe("lite");
    });
});
