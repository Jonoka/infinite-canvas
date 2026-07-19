export type SidePanelResizeBounds = { min: number; max: number };
export type PhysicalPanelSide = "left" | "right";
export type LogicalPanelSide = "start" | "end";

type ResizeStateBase = {
    preferredWidth: number;
    renderedWidth: number;
    bounds: SidePanelResizeBounds;
};

type IdleResizeState = ResizeStateBase & {
    phase: "idle";
};

type DraggingResizeState = ResizeStateBase & {
    phase: "dragging";
    pointerId: number;
    startX: number;
    startRenderedWidth: number;
    cancelPreferredWidth: number;
    physicalSide: PhysicalPanelSide;
};

export type SidePanelResizeState = IdleResizeState | DraggingResizeState;

export type SidePanelResizeEvent =
    | { type: "pointer-down"; pointerId: number; clientX: number; button: number; isPrimary: boolean; physicalSide: PhysicalPanelSide }
    | { type: "pointer-move"; pointerId: number; clientX: number }
    | { type: "pointer-up"; pointerId: number; clientX: number }
    | { type: "pointer-cancel" | "lost-pointer-capture" | "capture-failed"; pointerId: number }
    | { type: "escape" | "window-blur" | "unmount" }
    | { type: "bounds-changed"; bounds: SidePanelResizeBounds }
    | { type: "external-width"; width: number }
    | { type: "key-adjust"; key: "ArrowLeft" | "ArrowRight" | "Home" | "End"; step: number; physicalSide: PhysicalPanelSide };

export type SidePanelResizeEffect =
    | { type: "render-width"; width: number }
    | { type: "persist-width"; width: number }
    | { type: "set-pointer-capture"; pointerId: number }
    | { type: "release-pointer-capture"; pointerId: number }
    | { type: "start-interaction-lock" }
    | { type: "stop-interaction-lock" };

export type SidePanelResizeResult = { state: SidePanelResizeState; effects: SidePanelResizeEffect[] };

function finiteOr(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}

export function getSidePanelResizeBounds({ minWidth, maxWidth, viewportWidth, reservedMainWidth }: {
    minWidth: number;
    maxWidth: number;
    viewportWidth: number;
    reservedMainWidth: number;
}): SidePanelResizeBounds {
    const configuredMin = Math.max(0, finiteOr(minWidth, 0));
    const configuredMax = Math.max(configuredMin, finiteOr(maxWidth, configuredMin));
    const viewportMax = Math.max(0, finiteOr(viewportWidth, 0) - Math.max(0, finiteOr(reservedMainWidth, 0)));
    const max = Math.min(configuredMax, viewportMax);
    const min = Math.min(configuredMin, max);
    return { min, max };
}

export function normalizeSidePanelWidth(width: number, bounds: SidePanelResizeBounds, fallback: number) {
    const min = finiteOr(bounds.min, 0);
    const max = Math.max(min, finiteOr(bounds.max, min));
    const safeFallback = Number.isFinite(fallback) ? fallback : min;
    return Math.min(max, Math.max(min, finiteOr(width, safeFallback)));
}

export function resolvePhysicalPanelSide(side: LogicalPanelSide, direction: "ltr" | "rtl"): PhysicalPanelSide {
    return (side === "start") === (direction === "ltr") ? "left" : "right";
}

export function createSidePanelResizeState(width: number, bounds: SidePanelResizeBounds): SidePanelResizeState {
    const preferredWidth = finiteOr(width, bounds.min);
    const renderedWidth = normalizeSidePanelWidth(preferredWidth, bounds, bounds.min);
    return { phase: "idle", preferredWidth, renderedWidth, bounds };
}

function dragWidth(state: DraggingResizeState, clientX: number) {
    const direction = state.physicalSide === "left" ? 1 : -1;
    return normalizeSidePanelWidth(state.startRenderedWidth + (clientX - state.startX) * direction, state.bounds, state.startRenderedWidth);
}

function cancelDrag(state: DraggingResizeState, releaseCapture: boolean, preferredWidth = state.cancelPreferredWidth): SidePanelResizeResult {
    const renderedWidth = normalizeSidePanelWidth(preferredWidth, state.bounds, state.renderedWidth);
    const idle: IdleResizeState = {
        phase: "idle",
        preferredWidth,
        renderedWidth,
        bounds: state.bounds,
    };
    const effects: SidePanelResizeEffect[] = state.renderedWidth === renderedWidth ? [] : [{ type: "render-width", width: renderedWidth }];
    if (releaseCapture) effects.push({ type: "release-pointer-capture", pointerId: state.pointerId });
    effects.push({ type: "stop-interaction-lock" });
    return { state: idle, effects };
}

export function reduceSidePanelResize(state: SidePanelResizeState, event: SidePanelResizeEvent): SidePanelResizeResult {
    if (event.type === "external-width") {
        const preferredWidth = finiteOr(event.width, state.preferredWidth);
        if (state.phase === "dragging") return cancelDrag(state, true, preferredWidth);
        const renderedWidth = normalizeSidePanelWidth(preferredWidth, state.bounds, state.renderedWidth);
        return {
            state: { ...state, preferredWidth, renderedWidth },
            effects: renderedWidth === state.renderedWidth ? [] : [{ type: "render-width", width: renderedWidth }],
        };
    }

    if (event.type === "bounds-changed") {
        if (state.phase === "dragging") return cancelDrag({ ...state, bounds: event.bounds }, true);
        const renderedWidth = normalizeSidePanelWidth(state.preferredWidth, event.bounds, state.renderedWidth);
        const next = { ...state, bounds: event.bounds, renderedWidth } as SidePanelResizeState;
        return { state: next, effects: renderedWidth === state.renderedWidth ? [] : [{ type: "render-width", width: renderedWidth }] };
    }

    if (state.phase === "idle") {
        if (event.type === "pointer-down" && event.button === 0 && event.isPrimary) {
            return {
                state: { ...state, phase: "dragging", pointerId: event.pointerId, startX: event.clientX, startRenderedWidth: state.renderedWidth, cancelPreferredWidth: state.preferredWidth, physicalSide: event.physicalSide },
                effects: [{ type: "set-pointer-capture", pointerId: event.pointerId }, { type: "start-interaction-lock" }],
            };
        }
        if (event.type === "key-adjust") {
            let width = state.renderedWidth;
            if (event.key === "Home") width = state.bounds.min;
            else if (event.key === "End") width = state.bounds.max;
            else {
                const xDirection = event.key === "ArrowRight" ? 1 : -1;
                const sideDirection = event.physicalSide === "left" ? 1 : -1;
                width += Math.max(0, event.step) * xDirection * sideDirection;
            }
            width = normalizeSidePanelWidth(width, state.bounds, state.renderedWidth);
            if (width === state.renderedWidth) return { state, effects: [] };
            return {
                state: { ...state, preferredWidth: width, renderedWidth: width },
                effects: [{ type: "render-width", width }, { type: "persist-width", width }],
            };
        }
        return { state, effects: [] };
    }

    if ((event.type === "pointer-move" || event.type === "pointer-up") && event.pointerId !== state.pointerId) return { state, effects: [] };
    if ((event.type === "pointer-cancel" || event.type === "lost-pointer-capture" || event.type === "capture-failed") && event.pointerId !== state.pointerId) return { state, effects: [] };

    if (event.type === "pointer-move") {
        const renderedWidth = dragWidth(state, event.clientX);
        if (renderedWidth === state.renderedWidth) return { state, effects: [] };
        return { state: { ...state, renderedWidth }, effects: [{ type: "render-width", width: renderedWidth }] };
    }
    if (event.type === "pointer-up") {
        const width = dragWidth(state, event.clientX);
        return {
            state: { phase: "idle", preferredWidth: width, renderedWidth: width, bounds: state.bounds },
            effects: [
                ...(width === state.renderedWidth ? [] : [{ type: "render-width", width } as const]),
                { type: "persist-width", width },
                { type: "release-pointer-capture", pointerId: state.pointerId },
                { type: "stop-interaction-lock" },
            ],
        };
    }
    if (event.type === "pointer-cancel") return cancelDrag(state, true);
    if (event.type === "lost-pointer-capture" || event.type === "capture-failed") return cancelDrag(state, false);
    if (event.type === "escape" || event.type === "window-blur" || event.type === "unmount") return cancelDrag(state, true);
    return { state, effects: [] };
}
