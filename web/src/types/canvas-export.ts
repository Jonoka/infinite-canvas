import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasExportStatus = "success" | "partial";
export type CanvasExportResult = { status: CanvasExportStatus; exportedFileCount: number; exportedBytes: number; omittedCount: number };
export type CanvasExportIssueCode = "missing_storage" | "blocked_remote_url" | "credential_redacted" | "unsupported_node" | "invalid_storage_key" | "unknown_mime_type" | "mime_type_mismatch";
export type CanvasExportIssue = { code: CanvasExportIssueCode; nodeId?: string; storageKey?: string; source?: string; mimeType?: string };
export type CanvasExportAsset = { storageKey: string; path: string; mimeType: string; bytes: number; nodeIds: string[] };
export type CanvasProjectExportItem = { project: CanvasProject; files: CanvasExportAsset[]; issues: CanvasExportIssue[] };
export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 4;
    kind: "canvas-project";
    exportedAt: string;
    summary: CanvasExportResult & { projectCount: number; referencedFileCount: number };
    projects: CanvasProjectExportItem[];
};
export type LegacyCanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: Array<{ project: CanvasProject; files: Array<{ storageKey: string; path: string; mimeType: string }> }>;
};
export type ImportableCanvasExportFile = LegacyCanvasExportFile | CanvasExportFile;
export type SelectedNodeExportItem = { nodeId: string; storageKey: string; path?: string; duplicateOf?: string; mimeType?: string; bytes?: number };
export type SelectedNodeMediaExportFile = {
    app: "infinite-canvas";
    version: 4;
    kind: "selected-node-media";
    exportedAt: string;
    selectedNodeIds: string[];
    items: SelectedNodeExportItem[];
    issues: CanvasExportIssue[];
    summary: CanvasExportResult;
};
