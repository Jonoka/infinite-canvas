import { describe, expect, test } from "bun:test";

function section(source: string, start: string, end: string) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
}

describe("Canvas video retry commit wiring", () => {
    test("the retry result is committed only through the stale-request guard", async () => {
        const source = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
        const retryVideoBranch = section(source, "if (node.type === CanvasNodeType.Video) {", "if (node.type === CanvasNodeType.Audio) {");

        expect(retryVideoBranch).toContain("commitCanvasVideoResultIfCurrent({");
        expect(retryVideoBranch).toContain("isCurrentRequest");
        expect(retryVideoBranch).toContain("commit:");
        expect(retryVideoBranch.indexOf("commitCanvasVideoResultIfCurrent({")).toBeLessThan(retryVideoBranch.indexOf("setNodes("));
    });
});
