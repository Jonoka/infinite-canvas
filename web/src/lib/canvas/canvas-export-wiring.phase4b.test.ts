import { describe, expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json();
const sidePanel = await Bun.file(new URL("../../components/canvas/canvas-side-panel.tsx", import.meta.url)).text();
const projectPage = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();

describe("Phase 4B export wiring", () => {
    test("runs the Phase 4B contract in hosted protocol CI", () => {
        expect(packageJson.scripts["test:protocol"]).toContain("src/lib/canvas/canvas-export.phase4b.test.ts");
        expect(packageJson.scripts["test:protocol"]).toContain("src/lib/canvas/canvas-export-wiring.phase4b.test.ts");
    });

    test("selected-node UI reports exported media and partial omissions instead of selected element count", () => {
        expect(sidePanel).toContain("const result = await exportCanvasNodes");
        expect(sidePanel).toContain("result.exportedFileCount");
        expect(sidePanel).toContain('result.status === "partial"');
        expect(sidePanel).not.toContain("message.success(`已导出 ${targets.length} 个元素`)");
    });

    test("current-canvas UI consumes partial export results", () => {
        expect(projectPage).toContain("const result = await exportCanvasProjects");
        expect(projectPage).toContain('result.status === "partial"');
    });
});
