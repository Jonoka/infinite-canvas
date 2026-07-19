import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).text();
const panel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
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
    });

    test("centralizes fail-soft storage and clamps every store write", () => {
        expect(store).toContain("CANVAS_SIDE_PANEL_WIDTH_KEY");
        expect(store).toContain("normalizeSidePanelWidth");
        expect(store).toContain("try {");
        expect(store).toContain("localStorage.getItem");
        expect(store).toContain("localStorage.setItem");
        expect(store).not.toContain('const WIDTH_KEY = "canvas-side-panel-width"');
        expect(panel).not.toContain('localStorage.setItem("canvas-side-panel-width"');
    });
});
