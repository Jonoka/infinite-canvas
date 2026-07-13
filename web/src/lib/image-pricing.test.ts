import assert from "node:assert/strict";

import { calculateImageCost, formatImageCost, type PricingPayload } from "./image-pricing";

const pricing: PricingPayload = {
    success: true,
    data: [
        { model_name: "gpt-image-2-lite", quota_type: 1, model_price: 0.125, enable_groups: ["discount", "standard"] },
        { model_name: "gpt-image-2-pro", quota_type: 1, model_price: 0.75, enable_groups: ["pro", "standard"] },
        { model_name: "metered-image", quota_type: 0, model_price: 99, enable_groups: ["standard"] },
    ],
    group_ratio: { auto: 1, discount: 0.4, standard: 1.2, pro: 1.5 },
    auto_groups: ["discount", "pro", "standard"],
};

assert.deepEqual(calculateImageCost(pricing, "gpt-image-2-lite", "discount", 3), { cost: 0.15, group: "discount" }, "fixed pricing multiplies live model price, allowed selected-group ratio, and count");
assert.deepEqual(calculateImageCost(pricing, "default::gpt-image-2-pro", "pro", 2), { cost: 2.25, group: "pro" }, "channel-qualified Pro aliases resolve without hardcoded prices");
assert.equal(calculateImageCost(pricing, "gpt-image-2-pro", "discount", 1), null, "a selected group must be enabled for the model");
assert.deepEqual(calculateImageCost(pricing, "gpt-image-2-pro", "auto", 2), { cost: 2.25, group: "pro" }, "auto uses the first enabled model group present in auto_groups and that group's real ratio");
assert.deepEqual(calculateImageCost(pricing, "gpt-image-2-lite", "auto", 2), { cost: 0.1, group: "discount" }, "auto never prices with the synthetic auto ratio");
assert.equal(calculateImageCost(pricing, "metered-image", "standard", 1), null, "unsupported non-fixed billing is unavailable");
assert.equal(calculateImageCost(pricing, "missing", "standard", 1), null, "missing models are unavailable");
assert.equal(calculateImageCost({ ...pricing, group_ratio: { standard: 1.2 } }, "gpt-image-2-lite", "discount", 1), null, "missing group ratios are unavailable");
assert.equal(calculateImageCost({ ...pricing, success: false }, "gpt-image-2-lite", "discount", 1), null, "unsuccessful pricing payloads are unavailable");
assert.equal(formatImageCost(0.08), "$0.08");
assert.equal(formatImageCost(1.2), "$1.20");
