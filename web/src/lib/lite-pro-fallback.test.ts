import assert from "node:assert/strict";

import { calculateImageCost, type PricingPayload } from "./image-pricing";
import {
    buildLiteToProFallback,
    isLitePoolExhaustedError,
    liteToProFallbackError,
} from "./lite-pro-fallback";

const pricing: PricingPayload = {
    success: true,
    data: [
        { model_name: "gpt-image-2-lite", quota_type: 1, model_price: 0.1, enable_groups: ["GPT生图特价"] },
        { model_name: "gpt-image-2-pro", quota_type: 1, model_price: 0.2, enable_groups: ["GPT生图专用"] },
    ],
    group_ratio: { GPT生图特价: 0.8, GPT生图专用: 0.6 },
    auto_groups: ["GPT生图特价", "GPT生图专用"],
};

const tagged = liteToProFallbackError("Lite unavailable", "lite_pool_exhausted");
assert.equal(isLitePoolExhaustedError(tagged), true);
assert.equal(isLitePoolExhaustedError(liteToProFallbackError("Server unavailable", "bad_response_status_code")), false);
assert.equal(isLitePoolExhaustedError(new Error("lite_pool_exhausted")), false, "human-readable text must not trigger paid fallback");

const auto = buildLiteToProFallback({
    apiMode: "newapi",
    model: "default::gpt-image-2-lite",
    group: "auto",
    size: "9:16",
    pricing,
    count: 2,
});
assert.deepEqual(auto, {
    model: "gpt-image-2-pro",
    group: "auto",
    quality: "low",
    size: "9:16",
    count: 2,
    switchesToAuto: false,
    cost: calculateImageCost(pricing, "gpt-image-2-pro", "auto", 2),
});

const fixedWithoutPro = buildLiteToProFallback({
    apiMode: "newapi",
    model: "gpt-image-2-lite",
    group: "GPT生图特价",
    size: "16:9",
    pricing,
    count: 1,
});
assert.equal(fixedWithoutPro?.group, "auto");
assert.equal(fixedWithoutPro?.switchesToAuto, true);
assert.deepEqual(fixedWithoutPro?.cost, calculateImageCost(pricing, "gpt-image-2-pro", "auto", 1));

const fixedWithPro = buildLiteToProFallback({
    apiMode: "newapi",
    model: "gpt-image-2-lite",
    group: "GPT生图专用",
    size: "1:1",
    pricing,
    count: 1,
});
assert.equal(fixedWithPro?.group, "GPT生图专用");
assert.equal(fixedWithPro?.switchesToAuto, false);

assert.equal(buildLiteToProFallback({ apiMode: "direct", model: "gpt-image-2-lite", group: "auto", size: "1:1", pricing, count: 1 }), null);
assert.equal(buildLiteToProFallback({ apiMode: "newapi", model: "gpt-image-2-pro", group: "auto", size: "1:1", pricing, count: 1 }), null);

console.log("lite/pro fallback tests passed");
