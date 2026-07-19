import { describe, expect, test } from "bun:test";

import {
    createSidePanelResizeState,
    getSidePanelResizeBounds,
    normalizeSidePanelWidth,
    reduceSidePanelResize,
    resolvePhysicalPanelSide,
    type SidePanelResizeEvent,
    type SidePanelResizeState,
} from "./canvas-side-panel-resize";

const bounds = { min: 220, max: 480 };

function start(side: "left" | "right" = "left") {
    const idle = createSidePanelResizeState(280, bounds);
    return reduceSidePanelResize(idle, {
        type: "pointer-down",
        pointerId: 7,
        clientX: 100,
        button: 0,
        isPrimary: true,
        physicalSide: side,
    });
}

function moved(): SidePanelResizeState {
    return reduceSidePanelResize(start().state, {
        type: "pointer-move",
        pointerId: 7,
        clientX: 160,
    }).state;
}

describe("Phase 4D Canvas side-panel resize state machine", () => {
    test("normalizes invalid and out-of-range widths and lets viewport safety override the configured minimum", () => {
        expect(normalizeSidePanelWidth(Number.NaN, bounds, 280)).toBe(280);
        expect(normalizeSidePanelWidth(Number.POSITIVE_INFINITY, bounds, 280)).toBe(280);
        expect(normalizeSidePanelWidth(100, bounds, 280)).toBe(220);
        expect(normalizeSidePanelWidth(900, bounds, 280)).toBe(480);
        expect(getSidePanelResizeBounds({ minWidth: 220, maxWidth: 480, viewportWidth: 300, reservedMainWidth: 160 })).toEqual({ min: 140, max: 140 });
    });

    test("resolves logical start/end through text direction", () => {
        expect(resolvePhysicalPanelSide("start", "ltr")).toBe("left");
        expect(resolvePhysicalPanelSide("end", "ltr")).toBe("right");
        expect(resolvePhysicalPanelSide("start", "rtl")).toBe("right");
        expect(resolvePhysicalPanelSide("end", "rtl")).toBe("left");
    });

    test("accepts only a primary left-button pointer and grants it exclusive ownership", () => {
        const idle = createSidePanelResizeState(280, bounds);
        expect(reduceSidePanelResize(idle, { type: "pointer-down", pointerId: 1, clientX: 0, button: 2, isPrimary: true, physicalSide: "left" })).toEqual({ state: idle, effects: [] });
        expect(start().effects).toEqual([
            { type: "set-pointer-capture", pointerId: 7 },
            { type: "start-interaction-lock" },
        ]);

        const dragging = start().state;
        expect(reduceSidePanelResize(dragging, { type: "pointer-move", pointerId: 8, clientX: 200 })).toEqual({ state: dragging, effects: [] });
        expect(reduceSidePanelResize(dragging, { type: "pointer-up", pointerId: 8, clientX: 200 }).state.phase).toBe("dragging");
    });

    test("uses the pointer-up coordinate, persists once, and makes duplicate finish events inert", () => {
        const completed = reduceSidePanelResize(start().state, {
            type: "pointer-up",
            pointerId: 7,
            clientX: 140,
        });
        expect(completed.state).toMatchObject({ phase: "idle", preferredWidth: 320, renderedWidth: 320 });
        expect(completed.effects.filter((effect) => effect.type === "persist-width")).toEqual([{ type: "persist-width", width: 320 }]);
        expect(completed.effects).toContainEqual({ type: "release-pointer-capture", pointerId: 7 });
        expect(completed.effects).toContainEqual({ type: "stop-interaction-lock" });
        expect(reduceSidePanelResize(completed.state, { type: "window-blur" })).toEqual({ state: completed.state, effects: [] });
    });

    test.each([
        [{ type: "escape" }],
        [{ type: "pointer-cancel", pointerId: 7 }],
        [{ type: "lost-pointer-capture", pointerId: 7 }],
        [{ type: "capture-failed", pointerId: 7 }],
        [{ type: "window-blur" }],
        [{ type: "unmount" }],
    ] as Array<[SidePanelResizeEvent]>)("%o restores the pre-drag width without persistence", (event) => {
        const cancelled = reduceSidePanelResize(moved(), event);
        expect(cancelled.state).toMatchObject({ phase: "idle", preferredWidth: 280, renderedWidth: 280 });
        expect(cancelled.effects).not.toContainEqual(expect.objectContaining({ type: "persist-width" }));
        expect(cancelled.effects).toContainEqual({ type: "stop-interaction-lock" });
    });

    test("viewport bounds clamp rendering without overwriting or persisting preference", () => {
        const idle = createSidePanelResizeState(420, bounds);
        const narrowed = reduceSidePanelResize(idle, { type: "bounds-changed", bounds: { min: 180, max: 180 } });
        expect(narrowed.state).toMatchObject({ preferredWidth: 420, renderedWidth: 180 });
        expect(narrowed.effects).toEqual([{ type: "render-width", width: 180 }]);
    });

    test("bounds changes during dragging cancel ownership and restore the preference in the new bounds", () => {
        const cancelled = reduceSidePanelResize(moved(), { type: "bounds-changed", bounds: { min: 180, max: 180 } });
        expect(cancelled.state).toMatchObject({ phase: "idle", preferredWidth: 280, renderedWidth: 180, bounds: { min: 180, max: 180 } });
        expect(cancelled.effects).toContainEqual({ type: "release-pointer-capture", pointerId: 7 });
        expect(cancelled.effects).toContainEqual({ type: "stop-interaction-lock" });
        expect(cancelled.effects).not.toContainEqual(expect.objectContaining({ type: "persist-width" }));
    });

    test("keeps rendered drag origin separate from cancellation preference", () => {
        const narrow = createSidePanelResizeState(420, { min: 140, max: 140 });
        const dragging = reduceSidePanelResize(narrow, { type: "pointer-down", pointerId: 7, clientX: 100, button: 0, isPrimary: true, physicalSide: "left" }).state;
        expect(dragging).toMatchObject({ startRenderedWidth: 140, cancelPreferredWidth: 420 });
        expect(reduceSidePanelResize(dragging, { type: "escape" }).state).toMatchObject({ preferredWidth: 420, renderedWidth: 140 });
    });

    test("external width synchronizes idle state and cancels an active drag", () => {
        const synced = reduceSidePanelResize(createSidePanelResizeState(280, bounds), { type: "external-width", width: 360 });
        expect(synced.state).toMatchObject({ phase: "idle", preferredWidth: 360, renderedWidth: 360 });
        const cancelled = reduceSidePanelResize(moved(), { type: "external-width", width: 400 });
        expect(cancelled.state).toMatchObject({ phase: "idle", preferredWidth: 400, renderedWidth: 400 });
        expect(cancelled.effects).toContainEqual({ type: "release-pointer-capture", pointerId: 7 });
        expect(cancelled.effects).toContainEqual({ type: "stop-interaction-lock" });
    });

    test("narrow-screen pointer-up persists exactly the resulting state width", () => {
        const narrow = createSidePanelResizeState(280, { min: 140, max: 140 });
        const dragging = reduceSidePanelResize(narrow, { type: "pointer-down", pointerId: 7, clientX: 100, button: 0, isPrimary: true, physicalSide: "left" }).state;
        const completed = reduceSidePanelResize(dragging, { type: "pointer-up", pointerId: 7, clientX: 160 });
        expect(completed.state).toMatchObject({ preferredWidth: 140, renderedWidth: 140 });
        expect(completed.effects).toContainEqual({ type: "persist-width", width: 140 });
    });

    test("keyboard movement follows the physical separator and persists an atomic adjustment", () => {
        const idle = createSidePanelResizeState(280, bounds);
        const left = reduceSidePanelResize(idle, { type: "key-adjust", key: "ArrowRight", step: 8, physicalSide: "left" });
        const right = reduceSidePanelResize(idle, { type: "key-adjust", key: "ArrowRight", step: 8, physicalSide: "right" });
        expect(left.state).toMatchObject({ preferredWidth: 288, renderedWidth: 288 });
        expect(right.state).toMatchObject({ preferredWidth: 272, renderedWidth: 272 });
        expect(left.effects).toContainEqual({ type: "persist-width", width: 288 });
        expect(reduceSidePanelResize(idle, { type: "key-adjust", key: "Home", step: 8, physicalSide: "left" }).state).toMatchObject({ renderedWidth: 220 });
        expect(reduceSidePanelResize(idle, { type: "key-adjust", key: "End", step: 8, physicalSide: "left" }).state).toMatchObject({ renderedWidth: 480 });
    });
});
