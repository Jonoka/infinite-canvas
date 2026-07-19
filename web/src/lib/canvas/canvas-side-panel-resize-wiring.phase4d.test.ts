import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).text();
const panel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
const project = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
const store = await Bun.file(new URL("../../stores/use-canvas-side-panel-store.ts", import.meta.url)).text();

describe("Phase 4D Canvas side-panel resize production wiring", () => {
    test("runs the Phase 4D state-machine and wiring contracts in hosted validation", () => {
        expect(packageJson).toContain("canvas-side-panel-resize.phase4d.test.ts");
        expect(packageJson).toContain("canvas-side-panel-resize-wiring.phase4d.test.ts");
    });

    test("uses pointer capture, identity-safe cancellation, blur and unmount cleanup", () => {
        expect(panel).toContain("setPointerCapture");
        expect(panel).toContain("releasePointerCapture");
        expect(panel).toContain("lostpointercapture");
        expect(panel).toContain("pointercancel");
        expect(panel).toContain('addEventListener("blur"');
        expect(panel).toContain('type: "unmount"');
        expect(panel).toContain('type: "escape"');
        expect(panel).not.toContain('window.addEventListener("pointermove"');
        expect(panel).toContain('if (!handleRef.current) throw new Error("resize handle unavailable")');
        expect(panel).toContain('dispatchResize({ type: "unmount" }, false)');
        expect(panel).toContain("if (mounted) setResizing(false)");
    });

    test("exposes an accessible touch-safe separator and viewport-aware width", () => {
        expect(panel).toContain('role="separator"');
        expect(panel).toContain('aria-orientation="vertical"');
        expect(panel).toContain("aria-valuemin");
        expect(panel).toContain("aria-valuemax");
        expect(panel).toContain("aria-valuenow");
        expect(panel).toContain("touchAction: \"none\"");
        expect(panel).toContain("getSidePanelResizeBounds");
        expect(panel).toContain('type: "bounds-changed"');
        expect(panel).toContain('const physicalSide = "left" as const');
        expect(panel).toContain('aria-label="调整左侧面板宽度"');
        expect(panel).toContain("onResize();");
    });

    test("synchronizes external state, cancels when hidden, and rejects pointers before preventing default", () => {
        expect(panel).toContain('type: "external-width", width');
        expect(panel).toContain('if (!panelOpen || !panelMounted) dispatchResize({ type: "unmount" })');
        expect(panel).toContain("if (event.button !== 0 || !event.isPrimary) return;\n        event.preventDefault();");
    });

    test("locks the Canvas flex layout to the same physical-left model as the separator", () => {
        expect(project).toContain('<main dir="ltr" className="flex h-full min-h-0 overflow-hidden"');
        expect(panel).toContain('const physicalSide = "left" as const');
        expect(panel).toContain("right-0");
    });

    test("centralizes fail-soft storage and clamps every store write", () => {
        expect(store).toContain("CANVAS_SIDE_PANEL_WIDTH_KEY");
        expect(store).toContain("normalizeSidePanelWidth");
        expect(store).toContain("try {");
        expect(store).toContain("localStorage.getItem");
        expect(store).toContain("localStorage.setItem");
        expect(store).not.toContain('const WIDTH_KEY = "canvas-side-panel-width"');
        expect(panel).not.toContain('localStorage.setItem("canvas-side-panel-width"');
        expect(store).toContain("const PERSISTED_BOUNDS = { min: 0, max: CANVAS_SIDE_PANEL_MAX_WIDTH }");
        expect(store).toContain("normalizeSidePanelWidth(width, PERSISTED_BOUNDS");
    });
});
