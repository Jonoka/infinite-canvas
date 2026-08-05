import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

let previousWindow: typeof globalThis.window | undefined;

beforeAll(() => {
    previousWindow = globalThis.window;
    Object.assign(globalThis, { window: new JSDOM("", { url: "https://canvas.example.test" }).window });
});

afterAll(() => {
    Object.assign(globalThis, { window: previousWindow });
});

describe("Phase 5 plugin content sanitization", () => {
    test("removes executable Markdown HTML and dangerous URL attributes", async () => {
        const { sanitizePluginMarkup } = await import("./plugin-content-security");
        const clean = sanitizePluginMarkup("markdown", '<p onclick="alert(1)">ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
        expect(clean).toContain("ok");
        expect(clean).not.toMatch(/script|onclick|javascript:/i);
    });

    test("removes SVG scripts, event handlers, and foreignObject content", async () => {
        const { sanitizePluginMarkup } = await import("./plugin-content-security");
        const clean = sanitizePluginMarkup("svg", '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="x"></iframe></foreignObject><circle cx="1" /></svg>');
        expect(clean).toContain("circle");
        expect(clean).not.toMatch(/onload|script|foreignObject|iframe/i);
    });
});
