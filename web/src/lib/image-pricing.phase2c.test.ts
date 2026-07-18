import { describe, expect, test } from "bun:test";

import {
    calculateImageCost,
    loadImageCostPreview,
    type PricingPayload,
} from "./image-pricing";

const pricing: PricingPayload = {
    success: true,
    data: [
        { model_name: "gpt-image-2-lite", quota_type: 1, model_price: 0.125, enable_groups: ["discount", "standard"] },
        { model_name: "gpt-image-2-pro", quota_type: 1, model_price: 0.75, enable_groups: ["pro", "standard"] },
        { model_name: "metered-image", quota_type: 0, model_price: 99, enable_groups: ["standard"] },
    ],
    // Deliberately include a tempting synthetic auto value. It must never be used.
    group_ratio: { auto: 99, discount: 0.4, standard: 1.2, pro: 1.5 },
    auto_groups: ["discount", "pro", "standard"],
};

describe("Phase 2C live image pricing policy", () => {
    test("fixed-group preview uses the live model price, live group ratio, and requested count", () => {
        expect(calculateImageCost(pricing, "channel-a::gpt-image-2-pro", "standard", 2)).toEqual({
            cost: 1.8,
            group: "standard",
        });
    });

    test("auto resolves the first enabled live group and never applies a synthetic auto ratio", () => {
        expect(calculateImageCost(pricing, "gpt-image-2-lite", "auto", 2)).toEqual({
            cost: 0.1,
            group: "discount",
        });
        expect(calculateImageCost(pricing, "gpt-image-2-pro", "auto", 2)).toEqual({
            cost: 2.25,
            group: "pro",
        });
    });

    test.each([
        ["unsupported billing", pricing, "metered-image", "standard"],
        ["missing model", pricing, "missing-image", "standard"],
        ["disabled fixed group", pricing, "gpt-image-2-pro", "discount"],
        ["missing ratio", { ...pricing, group_ratio: { discount: 0.4 } }, "gpt-image-2-pro", "standard"],
        ["unsuccessful payload", { ...pricing, success: false }, "gpt-image-2-pro", "standard"],
    ] as const)("%s is disclosed as unavailable rather than estimated", (_label, payload, model, group) => {
        expect(calculateImageCost(payload as PricingPayload, model, group, 1)).toBeNull();
    });

    test("auto does not quote a route unless a documented candidate is owned by the requested model", () => {
        expect(calculateImageCost({ ...pricing, auto_groups: ["discount"] }, "gpt-image-2-pro", "auto", 2)).toBeNull();
    });

    test.each([
        ["string numbers", { ...pricing, data: [{ model_name: "gpt-image-2-pro", quota_type: "1", model_price: "0.75", enable_groups: ["pro"] }], group_ratio: { pro: "1.5" }, auto_groups: ["pro"] }, { cost: 2.25, group: "pro" }],
        ["duplicate rows", { ...pricing, data: [pricing.data[1], { ...pricing.data[1] }] }, null],
        ["negative price", { ...pricing, data: [{ ...pricing.data[1], model_price: -1 }] }, null],
        ["nonfinite price", { ...pricing, data: [{ ...pricing.data[1], model_price: "Infinity" }] }, null],
        ["negative ratio", { ...pricing, group_ratio: { pro: -1 } }, null],
        ["nonfinite ratio", { ...pricing, group_ratio: { pro: "NaN" } }, null],
        ["missing fields", { ...pricing, data: [{ model_name: "gpt-image-2-pro", quota_type: 1 }] }, null],
        ["malformed envelope", { ...pricing, data: { items: "bad" } }, null],
    ] as const)("parses %s conservatively", (_label, payload, expected) => {
        expect(calculateImageCost(payload as unknown as PricingPayload, "gpt-image-2-pro", "pro", 2)).toEqual(expected);
    });

    test.each([
        { success: true, data: { data: pricing.data, group_ratio: pricing.group_ratio, auto_groups: pricing.auto_groups } },
        { code: 0, data: { models: pricing.data, group_ratio: pricing.group_ratio, auto_groups: pricing.auto_groups } },
    ])("accepts documented nested pricing envelopes", (payload) => {
        expect(calculateImageCost(payload as unknown as PricingPayload, "gpt-image-2-pro", "pro", 2)).toEqual({ cost: 2.25, group: "pro" });
    });

    test("pricing fetch failure is nonblocking and returns an explicit unavailable preview", async () => {
        const result = await loadImageCostPreview({
            model: "gpt-image-2-pro",
            group: "auto",
            count: 2,
            fetchPricing: async () => { throw new Error("pricing offline"); },
        });
        expect(result).toEqual({ available: false, cost: null, reason: "fetch_failed" });
    });

    test("an unsupported live response is also nonblocking, without a guessed fallback price", async () => {
        const result = await loadImageCostPreview({
            model: "metered-image",
            group: "standard",
            count: 1,
            fetchPricing: async () => pricing,
        });
        expect(result).toEqual({ available: false, cost: null, reason: "unsupported" });
    });
});
