import { describe, expect, test } from "bun:test";

function canvasNodeInvocation(source: string) {
    const start = source.indexOf("{visibleNodes.map((node) => (");
    const end = source.indexOf("</CanvasNode>", start);
    const selfClosingEnd = source.indexOf("/>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(selfClosingEnd).toBeGreaterThan(start);
    return source.slice(start, end >= 0 && end < selfClosingEnd ? end : selfClosingEnd);
}

describe("Phase 4A Canvas node performance wiring", () => {
    test("only Text nodes receive dynamic mention references", async () => {
        const source = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
        const invocation = canvasNodeInvocation(source);

        expect(invocation).toContain("node.type === CanvasNodeType.Text");
        expect(invocation).toContain("mentionReferencesByNodeId.get(node.id)");
        expect(invocation).toContain("EMPTY_REFERENCES");
    });

    test("panel and Config renderers are not passed to every Canvas node", async () => {
        const source = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
        const invocation = canvasNodeInvocation(source);

        expect(invocation).toContain("renderPanel={showPanel ? renderNodePanel : undefined}");
        expect(invocation).toContain('renderNodeContent={node.type === CanvasNodeType.Config ? renderNodeContentPanel : undefined}');
    });

    test("keeps Plugin refresh props and Phase 2B recovery metadata intact", async () => {
        const project = await Bun.file(new URL("../../pages/canvas/project.tsx", import.meta.url)).text();
        const invocation = canvasNodeInvocation(project);
        const canvasTypes = await Bun.file(new URL("../../types/canvas.ts", import.meta.url)).text();

        expect(invocation).toContain("pluginHost={pluginHost}");
        expect(invocation).toContain("registryVersion={nodeRegistryVersion}");
        for (const field of ["taskId?", "taskContentIndex?", "taskRecoverable?", "taskApiMode?"]) {
            expect(canvasTypes).toContain(field);
        }
    });
});
