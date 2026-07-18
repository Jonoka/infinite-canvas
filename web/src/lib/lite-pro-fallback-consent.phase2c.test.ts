import { describe, expect, test } from "bun:test";

import * as consent from "./lite-pro-fallback-consent";

type ConsentCopy = { title: string; content: string; confirmLabel: string; cancelLabel: string };
type ConsentSeams = {
    buildLiteToProConsentCopy: (input: {
        failedCount: number; fromGroup: string; toGroup: string; switchesToAuto: boolean;
        cost: { cost: number; group: string } | null; pricingAvailable: boolean;
    }) => ConsentCopy;
};
const hooks = consent as typeof consent & Partial<ConsentSeams>;

function copy(input: Parameters<ConsentSeams["buildLiteToProConsentCopy"]>[0]) {
    expect(typeof hooks.buildLiteToProConsentCopy, "Phase 2C requires modal disclosure to be built by a pure production seam").toBe("function");
    return hooks.buildLiteToProConsentCopy!(input);
}

describe("Phase 2C explicit paid-consent disclosure", () => {
    test("discloses failed-slot count, live estimate, actual priced group, and one-shot route change", () => {
        const result = copy({
            failedCount: 2, fromGroup: "lite-only", toGroup: "auto", switchesToAuto: true,
            cost: { cost: 1.875, group: "pro-route" }, pricingAvailable: true,
        });
        expect(result.title).toMatch(/专业版|Pro/i);
        expect(result.content).toMatch(/2/);
        expect(result.content).toContain("lite-only");
        expect(result.content).toMatch(/auto|自动/i);
        expect(result.content).toContain("pro-route");
        expect(result.content).toContain("$1.88");
        expect(result.content).toMatch(/估算|预计/);
        expect(result.content).toMatch(/不保证|可能|实际.*为准/);
        expect(result.content).not.toMatch(/将路由到|一定|保证.*pro-route/i);
        expect(result.content).toMatch(/本次|一次|不修改|不会修改/);
        expect(result.confirmLabel).toMatch(/专业版|Pro|付费|重试/i);
        expect(result.cancelLabel).toMatch(/取消|不使用/);
    });

    test("pricing unavailable is stated plainly and remains explicitly confirmable without a fabricated amount", () => {
        const result = copy({
            failedCount: 1, fromGroup: "fixed", toGroup: "auto", switchesToAuto: true,
            cost: null, pricingAvailable: false,
        });
        expect(result.content).toMatch(/价格|费用/);
        expect(result.content).toMatch(/不可用|无法获取|暂时无法/);
        expect(result.content).not.toMatch(/\$\d/);
        expect(result.content).toContain("fixed");
        expect(result.content).toMatch(/auto|自动/i);
        expect(result.confirmLabel.length).toBeGreaterThan(0);
    });

    test("a capable fixed group is disclosed as unchanged", () => {
        const result = copy({
            failedCount: 1, fromGroup: "shared", toGroup: "shared", switchesToAuto: false,
            cost: { cost: 0.75, group: "shared" }, pricingAvailable: true,
        });
        expect(result.content).toContain("shared");
        expect(result.content).toMatch(/继续|保持|不切换/);
        expect(result.content).not.toMatch(/切换.*自动/);
    });
});
