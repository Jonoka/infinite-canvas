import { describe, expect, test } from "bun:test";

import * as orchestration from "./image-paid-fallback-orchestrator";

type SlotResult<T> = PromiseSettledResult<T>;
type Fallback = { model: "gpt-image-2-pro"; group: string; count: number };
type Seams = {
    retryLitePoolFailuresWithConsent: <T>(input: {
        results: SlotResult<T>[];
        isEligible: (error: unknown) => boolean;
        confirm: (input: { failedIndexes: number[]; count: number }) => Promise<Fallback | null>;
        retry: (index: number, fallback: Fallback) => Promise<T>;
    }) => Promise<SlotResult<T>[]>;
    retryLitePoolFailureWithConsent: <T>(input: {
        result: SlotResult<T>; isEligible: (error: unknown) => boolean;
        confirm: (input: { failedIndexes: number[]; count: number }) => Promise<Fallback | null>;
        retry: (index: number, fallback: Fallback) => Promise<T>;
    }) => Promise<SlotResult<T>>;
};
const seams = (orchestration as typeof orchestration & Partial<Seams>);

function orchestrate<T>(input: Parameters<Seams["retryLitePoolFailuresWithConsent"]>[0]) {
    expect(typeof seams.retryLitePoolFailuresWithConsent, "Phase 2C requires a production batch consent/orchestration seam shared by image workflows").toBe("function");
    return seams.retryLitePoolFailuresWithConsent!(input);
}

const exhausted = { structured: true, code: "lite_pool_exhausted" };
const unrelated = { structured: true, code: "upstream_failure" };
const eligible = (error: unknown) => error === exhausted;
const paid: Fallback = { model: "gpt-image-2-pro", group: "auto", count: 2 };

describe("Phase 2C paid fallback consent orchestration", () => {
    test("cancel makes zero Pro requests and leaves all Lite outcomes untouched", async () => {
        const results: SlotResult<string>[] = [
            { status: "fulfilled", value: "lite-success-0" },
            { status: "rejected", reason: exhausted },
            { status: "rejected", reason: unrelated },
        ];
        let prompts = 0;
        let proPosts = 0;
        const output = await orchestrate({
            results,
            isEligible: eligible,
            confirm: async ({ failedIndexes, count }) => {
                prompts++;
                expect(failedIndexes).toEqual([1]);
                expect(count).toBe(1);
                return null;
            },
            retry: async () => { proPosts++; return "must-not-run"; },
        });
        expect(prompts).toBe(1);
        expect(proPosts).toBe(0);
        expect(output).toEqual(results);
    });

    test("confirm prompts once per batch and retries only exact failed slots", async () => {
        const results: SlotResult<string>[] = [
            { status: "fulfilled", value: "lite-success-0" },
            { status: "rejected", reason: exhausted },
            { status: "rejected", reason: unrelated },
            { status: "rejected", reason: exhausted },
        ];
        let prompts = 0;
        const retried: number[] = [];
        const output = await orchestrate({
            results,
            isEligible: eligible,
            confirm: async ({ failedIndexes, count }) => {
                prompts++;
                expect(failedIndexes).toEqual([1, 3]);
                expect(count).toBe(2);
                return paid;
            },
            retry: async (index, fallback) => {
                expect(fallback).toBe(paid);
                retried.push(index);
                return `pro-success-${index}`;
            },
        });
        expect(prompts).toBe(1);
        expect(retried).toEqual([1, 3]);
        expect(output).toEqual([
            { status: "fulfilled", value: "lite-success-0" },
            { status: "fulfilled", value: "pro-success-1" },
            { status: "rejected", reason: unrelated },
            { status: "fulfilled", value: "pro-success-3" },
        ]);
    });

    test("unrelated failures cause neither consent nor paid traffic", async () => {
        let touched = false;
        const results: SlotResult<string>[] = [{ status: "rejected", reason: unrelated }];
        const output = await orchestrate({
            results,
            isEligible: eligible,
            confirm: async () => { touched = true; return paid; },
            retry: async () => { touched = true; return "paid"; },
        });
        expect(touched).toBe(false);
        expect(output).toEqual(results);
    });

    test("the public single-result adapter uses the same event-scoped policy", async () => {
        expect(typeof seams.retryLitePoolFailureWithConsent).toBe("function");
        const output = await seams.retryLitePoolFailureWithConsent!({
            result: { status: "rejected", reason: exhausted }, isEligible: eligible,
            confirm: async ({ failedIndexes, count }) => { expect(failedIndexes).toEqual([0]); expect(count).toBe(1); return { ...paid, count: 1 }; },
            retry: async (index) => { expect(index).toBe(0); return "single-pro"; },
        });
        expect(output).toEqual({ status: "fulfilled", value: "single-pro" });
    });

    test("a rejected Pro retry preserves its slot and every other outcome", async () => {
        const proFailure = new Error("paid route failed");
        const otherFailure = new Error("not eligible");
        const output = await orchestrate({
            results: [{ status: "fulfilled", value: "lite-0" }, { status: "rejected", reason: exhausted }, { status: "rejected", reason: otherFailure }],
            isEligible: eligible, confirm: async () => ({ ...paid, count: 1 }), retry: async () => { throw proFailure; },
        });
        expect(output).toEqual([{ status: "fulfilled", value: "lite-0" }, { status: "rejected", reason: proFailure }, { status: "rejected", reason: otherFailure }]);
    });

    test("confirmation is event-scoped: a later exhaustion prompts again and has no standing consent", async () => {
        let prompts = 0;
        let posts = 0;
        const runEvent = () => orchestrate({
            results: [{ status: "rejected", reason: exhausted }] as SlotResult<string>[],
            isEligible: eligible,
            confirm: async () => { prompts++; return { ...paid, count: 1 }; },
            retry: async () => { posts++; return "pro"; },
        });
        await runEvent();
        await runEvent();
        expect(prompts).toBe(2);
        expect(posts).toBe(2);
    });
});
