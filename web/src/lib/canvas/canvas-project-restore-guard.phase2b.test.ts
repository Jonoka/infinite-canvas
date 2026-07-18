import { describe, expect, test } from "bun:test";

import { createCanvasProjectRestoreGuard } from "./canvas-project-restore-guard";

describe("canvas project restore guard", () => {
    test("an older async hydration cannot commit after a newer project restore begins", () => {
        const guard = createCanvasProjectRestoreGuard();
        const first = guard.begin("project-a");
        const second = guard.begin("project-b");
        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    test("cleanup invalidates the captured restore instance", () => {
        const guard = createCanvasProjectRestoreGuard();
        const restore = guard.begin("project-a");
        guard.invalidate(restore);
        expect(guard.isCurrent(restore)).toBe(false);
    });
});
