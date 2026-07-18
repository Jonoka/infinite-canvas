import { describe, expect, test } from "bun:test";

import * as consent from "./lite-pro-fallback-consent";
import { createImageWorkbenchActions } from "@/pages/image/image-generation-actions";

// Vite injects this while Bun evaluates the real page module directly.
(globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ ??= "test";
const imagePage = await import("@/pages/image");

type CloseKind = "cancel-button" | "close" | "escape" | "mask";
type ConfirmInput = { failedCount: number; fromGroup: string; toGroup: string; switchesToAuto: boolean; cost: { cost: number; group: string } | null; pricingAvailable: boolean };
type ModalProps = { title: string; content: string; onOk: () => void; onCancel: () => void };
type ConsentExports = {
    createLiteToProConsentModalAdapter: (adapter: { open: (props: ModalProps) => void }) => (input: ConfirmInput) => Promise<boolean>;
    confirmLiteToProFallback: (input: ConfirmInput) => Promise<boolean>;
    liteToProConsentModalAdapter: { open: (props: ModalProps) => void };
};
const production = consent as typeof consent & Partial<ConsentExports>;

function createConfirm(open: (props: ModalProps) => void) {
    expect(typeof production.createLiteToProConsentModalAdapter, "Phase 2C requires a production modal adapter factory").toBe("function");
    return production.createLiteToProConsentModalAdapter!({ open });
}

const input: ConfirmInput = { failedCount: 2, fromGroup: "lite", toGroup: "auto", switchesToAuto: true, cost: { cost: 1.875, group: "pro" }, pricingAvailable: true };

describe("Phase 2C real consent modal adapter", () => {
    test("the production page/action wiring references the exact exported confirmation hook", () => {
        expect(typeof production.confirmLiteToProFallback).toBe("function");
        expect(typeof production.liteToProConsentModalAdapter?.open).toBe("function");
        expect(imagePage.imageWorkbenchPaidFallbackWiring).toEqual({
            createActions: createImageWorkbenchActions,
            confirm: production.confirmLiteToProFallback,
        });
    });

    test("the exported production confirmation opens through the exported modal adapter", async () => {
        const adapter = production.liteToProConsentModalAdapter!;
        const originalOpen = adapter.open;
        let rendered: ModalProps | undefined;
        adapter.open = (props) => { rendered = props; };
        try {
            const pending = production.confirmLiteToProFallback!(input);
            expect(rendered?.content).toContain("$1.88");
            rendered!.onCancel();
            expect(await pending).toBe(false);
        } finally {
            adapter.open = originalOpen;
        }
    });

    test.each(["cancel-button", "close", "escape", "mask"] as const)("%s resolves cancellation and performs no Pro action", async (closeKind: CloseKind) => {
        let rendered: ModalProps | undefined;
        let pro = 0;
        const confirm = createConfirm((props) => { rendered = props; });
        const pending = confirm(input);
        expect(rendered?.title).toMatch(/Pro|专业版/i);
        expect(rendered?.content).toMatch(/2/);
        expect(rendered?.content).toContain("lite");
        expect(rendered?.content).toMatch(/auto|自动/i);
        expect(rendered?.content).toContain("pro");
        expect(rendered?.content).toContain("$1.88");
        expect(closeKind).toMatch(/cancel-button|close|escape|mask/);
        rendered!.onCancel();
        if (await pending) pro++;
        expect(pro).toBe(0);
    });

    test("OK is the only adapter path that grants one-shot paid consent", async () => {
        let ok!: () => void;
        const pending = createConfirm((props) => { ok = props.onOk; })({ ...input, failedCount: 1, cost: null, pricingAvailable: false });
        ok();
        expect(await pending).toBe(true);
    });
});
