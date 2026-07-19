import { create } from "zustand";

import { normalizeSidePanelWidth } from "@/lib/canvas/canvas-side-panel-resize";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;
export const CANVAS_SIDE_PANEL_WIDTH_KEY = "canvas-side-panel-width";

const OPEN_KEY = "canvas-side-panel-open";
const CONFIGURED_BOUNDS = { min: CANVAS_SIDE_PANEL_MIN_WIDTH, max: CANVAS_SIDE_PANEL_MAX_WIDTH };
const PERSISTED_BOUNDS = { min: 0, max: CANVAS_SIDE_PANEL_MAX_WIDTH };

function safeGet(key: string) {
    if (typeof window === "undefined") return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSet(key: string, value: string) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage availability must not affect panel state or interaction cleanup.
    }
}

function clampWidth(width: number) {
    return normalizeSidePanelWidth(width, CONFIGURED_BOUNDS, CANVAS_SIDE_PANEL_DEFAULT_WIDTH);
}

function initialWidth() {
    const stored = safeGet(CANVAS_SIDE_PANEL_WIDTH_KEY);
    return stored === null ? CANVAS_SIDE_PANEL_DEFAULT_WIDTH : clampWidth(Number(stored));
}

function initialOpen() {
    return safeGet(OPEN_KEY) !== "0";
}

const initiallyOpen = initialOpen();
let closeGeneration = 0;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function invalidateCloseTimer() {
    closeGeneration += 1;
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
}

type CanvasSidePanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    setWidth: (width: number) => void;
    persistWidth: (width: number) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initiallyOpen,
    panelMounted: initiallyOpen,
    panelClosing: false,
    setWidth: (width) => set({ width: clampWidth(width) }),
    persistWidth: (width) => {
        const normalized = normalizeSidePanelWidth(width, PERSISTED_BOUNDS, CANVAS_SIDE_PANEL_DEFAULT_WIDTH);
        set({ width: normalized });
        safeSet(CANVAS_SIDE_PANEL_WIDTH_KEY, String(normalized));
    },
    openPanel: () => {
        invalidateCloseTimer();
        safeSet(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        invalidateCloseTimer();
        const generation = closeGeneration;
        safeSet(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        closeTimer = setTimeout(() => {
            closeTimer = undefined;
            if (generation === closeGeneration && get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
