import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile, CanvasExportIssue, CanvasExportResult, CanvasProjectExportItem, ImportableCanvasExportFile, SelectedNodeExportItem, SelectedNodeMediaExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasExportLimits = { maxSingleFileBytes: number; maxTotalBytes: number; maxFiles: number; maxSelectedNodes: number };
export type CanvasExportReaders = {
    getImageBlob: (storageKey: string) => Promise<Blob | null>;
    getMediaBlob: (storageKey: string) => Promise<Blob | null>;
    now?: () => string;
    limits?: Partial<CanvasExportLimits>;
};
type ExportEntry = { name: string; data: BlobPart };
type CanvasProjectExportPlan = { entries: ExportEntry[]; manifest: CanvasExportFile; result: CanvasExportResult };
type SelectedNodeMediaExportPlan = { entries: ExportEntry[]; manifest: SelectedNodeMediaExportFile; result: CanvasExportResult; assertDownloadable: () => void };

const DEFAULT_LIMITS: CanvasExportLimits = { maxSingleFileBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxFiles: 10_000, maxSelectedNodes: 10_000 };
const MEDIA_TYPES = new Set<string>([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio]);
const STORAGE_KEY = /^(?!https?:|blob:|data:)[a-z][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$/i;
const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg",
    "audio/opus": "opus", "audio/aac": "aac", "audio/flac": "flac", "audio/pcm": "pcm",
};

export class CanvasExportError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = "CanvasExportError";
    }
}

export async function buildCanvasProjectExport(project: CanvasProject, readers: CanvasExportReaders): Promise<CanvasProjectExportPlan> {
    return buildCanvasProjectsExport([project], readers);
}

export async function buildSelectedNodeMediaExport(nodes: CanvasNodeData[], selectedNodeIds: Iterable<string>, readers: CanvasExportReaders): Promise<SelectedNodeMediaExportPlan> {
    const selected = new Set(selectedNodeIds);
    const orderedNodes = nodes.filter((node) => selected.has(node.id));
    const limits = getLimits(readers);
    if (orderedNodes.length > limits.maxSelectedNodes) throw new CanvasExportError("selected_node_limit", "选中元素数量超过导出限制");
    const entries: ExportEntry[] = [];
    const items: SelectedNodeExportItem[] = [];
    const issues: CanvasExportIssue[] = [];
    const seen = new Map<string, SelectedNodeExportItem>();
    const paths = createPathResolver(["manifest.json"]);
    let exportedBytes = 0;

    for (const node of orderedNodes) {
        const storageKey = node.metadata?.storageKey || "";
        if (!storageKey && !MEDIA_TYPES.has(node.type)) {
            issues.push({ code: "unsupported_node", nodeId: node.id });
            continue;
        }
        if (!storageKey) {
            const source = remoteSource(node.metadata?.content);
            issues.push(source ? { code: "blocked_remote_url", nodeId: node.id, source } : { code: "missing_storage", nodeId: node.id });
            continue;
        }
        if (!isStorageKey(storageKey)) {
            issues.push({ code: "invalid_storage_key", nodeId: node.id });
            continue;
        }
        const duplicate = seen.get(storageKey);
        if (duplicate) {
            items.push({ nodeId: node.id, storageKey, path: duplicate.path, duplicateOf: duplicate.nodeId });
            continue;
        }
        const blob = await readBlob(storageKey, readers);
        if (!blob) {
            issues.push({ code: "missing_storage", nodeId: node.id, storageKey });
            continue;
        }
        const mime = resolveMime(blob.type, storageKey, node.type);
        if (!mime.ok) {
            issues.push({ code: mime.code, nodeId: node.id, storageKey, mimeType: blob.type });
            continue;
        }
        assertBlobLimits(blob, entries.length + 1, exportedBytes + blob.size, limits);
        const path = paths.resolve("media", `${String(nodes.indexOf(node) + 1).padStart(4, "0")}-${safeSegment(node.title || node.type, "元素")}.${mime.extension}`);
        const item = { nodeId: node.id, storageKey, path, mimeType: mime.mimeType, bytes: blob.size };
        seen.set(storageKey, item);
        items.push(item);
        entries.push({ name: path, data: blob });
        exportedBytes += blob.size;
    }
    const result = exportResult(entries.length, exportedBytes, issues.length);
    const manifest: SelectedNodeMediaExportFile = {
        app: "infinite-canvas", version: 4, kind: "selected-node-media", exportedAt: (readers.now || (() => new Date().toISOString()))(),
        selectedNodeIds: orderedNodes.map((node) => node.id), items, issues, summary: result,
    };
    return { entries, manifest, result, assertDownloadable: () => { if (!entries.length) throw new CanvasExportError("no_exportable_media", "没有可导出的媒体"); } };
}

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "无限画布") {
    const plan = await buildCanvasProjectsExport(projects, browserReaders());
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(plan.manifest, null, 2) }, ...plan.entries]);
    saveAs(zip, `${safeSegment(fileName, "无限画布")}.zip`);
    return plan.result;
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = "画布元素") {
    const plan = await buildSelectedNodeMediaExport(nodes, nodes.map((node) => node.id), browserReaders());
    plan.assertDownloadable();
    const zip = await createZip([{ name: "manifest.json", data: JSON.stringify(plan.manifest, null, 2) }, ...plan.entries]);
    saveAs(zip, `${safeSegment(fileName, "画布元素")}.zip`);
    return plan.result;
}

async function buildCanvasProjectsExport(projects: CanvasProject[], readers: CanvasExportReaders): Promise<CanvasProjectExportPlan> {
    const limits = getLimits(readers);
    const entries: ExportEntry[] = [];
    const exportedProjects: CanvasProjectExportItem[] = [];
    const exportedAssets = new Map<string, CanvasExportAsset>();
    const paths = createPathResolver(["projects.json"]);
    let referencedFileCount = 0;
    let exportedBytes = 0;
    let omittedCount = 0;
    for (const project of projects) {
        const issues: CanvasExportIssue[] = [];
        const projectSnapshot = redactProject(project, issues);
        const references = collectProjectReferences(project);
        const unpersistedMediaNodes = project.nodes.filter((node) => MEDIA_TYPES.has(node.type) && !node.metadata?.storageKey);
        unpersistedMediaNodes.forEach((node) => {
            const source = remoteSource(node.metadata?.content);
            issues.push(source ? { code: "blocked_remote_url", nodeId: node.id, source } : { code: "missing_storage", nodeId: node.id });
        });
        const files: CanvasExportAsset[] = [];
        referencedFileCount += references.length + unpersistedMediaNodes.length;
        omittedCount += unpersistedMediaNodes.length;
        const projectSegment = safeSegment(project.id, "project");
        for (const { storageKey, nodeIds, nodeTypes } of references) {
            if (!isStorageKey(storageKey)) {
                issues.push({ code: "invalid_storage_key", nodeId: nodeIds[0] });
                omittedCount += 1;
                continue;
            }
            const existing = exportedAssets.get(storageKey);
            if (existing) {
                files.push({ ...existing, nodeIds });
                continue;
            }
            const blob = await readBlob(storageKey, readers);
            if (!blob) {
                issues.push({ code: "missing_storage", nodeId: nodeIds[0], storageKey });
                omittedCount += 1;
                continue;
            }
            const mime = resolveMime(blob.type, storageKey, nodeTypes[0]);
            if (!mime.ok) {
                issues.push({ code: mime.code, nodeId: nodeIds[0], storageKey, mimeType: blob.type });
                omittedCount += 1;
                continue;
            }
            assertBlobLimits(blob, entries.length + 1, exportedBytes + blob.size, limits);
            const path = paths.resolve("projects", projectSegment, "files", `${safeSegment(storageKey, "media")}.${mime.extension}`);
            const asset = { storageKey, path, mimeType: mime.mimeType, bytes: blob.size, nodeIds };
            files.push(asset);
            exportedAssets.set(storageKey, asset);
            entries.push({ name: path, data: blob });
            exportedBytes += blob.size;
        }
        exportedProjects.push({ project: projectSnapshot, files, issues });
    }
    const result = exportResult(entries.length, exportedBytes, omittedCount);
    return {
        entries, result,
        manifest: { app: "infinite-canvas", version: 4, kind: "canvas-project", exportedAt: (readers.now || (() => new Date().toISOString()))(), summary: { ...result, projectCount: projects.length, referencedFileCount }, projects: exportedProjects },
    };
}

function collectProjectReferences(project: CanvasProject) {
    const references = new Map<string, { nodeIds: Set<string>; nodeTypes: Set<string> }>();
    const visit = (value: unknown, nodeId?: string, nodeType?: string, fieldName?: string) => {
        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (typeof item === "string" && isImplicitStorageReferenceField(fieldName) && isStorageKey(item)) addReference(item, nodeId, nodeType);
                else visit(item, nodeId, nodeType, fieldName);
            });
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        const isNode = typeof record.id === "string" && typeof record.type === "string";
        const nextNodeId = isNode ? record.id as string : nodeId;
        const nextNodeType = isNode ? record.type as string : nodeType;
        if (typeof record.storageKey === "string" && record.storageKey) addReference(record.storageKey, nextNodeId, nextNodeType);
        Object.entries(record).forEach(([key, item]) => {
            if (typeof item === "string" && isImplicitStorageReferenceField(key) && isStorageKey(item)) addReference(item, nextNodeId, nextNodeType);
            else visit(item, nextNodeId, nextNodeType, key);
        });
    };
    const addReference = (storageKey: string, nodeId?: string, nodeType?: string) => {
        const reference = references.get(storageKey) || { nodeIds: new Set<string>(), nodeTypes: new Set<string>() };
        if (nodeId) reference.nodeIds.add(nodeId);
        if (nodeType) reference.nodeTypes.add(nodeType);
        references.set(storageKey, reference);
    };
    visit(project);
    return [...references].sort(([a], [b]) => a.localeCompare(b)).map(([storageKey, value]) => ({ storageKey, nodeIds: [...value.nodeIds].sort(), nodeTypes: [...value.nodeTypes].sort() }));
}

function redactProject(project: CanvasProject, issues: CanvasExportIssue[]): CanvasProject {
    return redactValue(project, undefined, issues, false) as CanvasProject;
}

function redactValue(value: unknown, nodeId: string | undefined, issues: CanvasExportIssue[], mediaContext: boolean): unknown {
    if (Array.isArray(value)) return value.map((item) => redactValue(item, nodeId, issues, mediaContext));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const currentNodeId = typeof record.id === "string" && "type" in record ? record.id : nodeId;
    const currentMediaContext = mediaContext || (typeof record.type === "string" && MEDIA_TYPES.has(record.type));
    const validStorageKey = typeof record.storageKey === "string" && isStorageKey(record.storageKey);
    return Object.fromEntries(Object.entries(record).map(([key, item]) => {
        if (isCredentialKey(key)) {
            if (!issues.some((issue) => issue.code === "credential_redacted" && issue.nodeId === currentNodeId)) issues.push({ code: "credential_redacted", nodeId: currentNodeId });
            return [key, "[REDACTED]"];
        }
        if (key === "storageKey" && typeof item === "string" && !isStorageKey(item)) return [key, "[REDACTED]"];
        if (key === "content" && validStorageKey) return [key, record.storageKey];
        if (key === "content" && currentMediaContext && typeof item === "string" && /^https?:\/\//i.test(item)) return [key, redactUrl(item)];
        if (validStorageKey && isMediaLocatorKey(key)) return [key, Array.isArray(item) ? [] : record.storageKey];
        if (isUrlKey(key) && typeof item === "string") return [key, redactLocatorValue(item, currentMediaContext)];
        if (isUrlKey(key) && Array.isArray(item)) return [key, item.map((entry) => typeof entry === "string" ? redactLocatorValue(entry, currentMediaContext) : redactValue(entry, currentNodeId, issues, currentMediaContext))];
        return [key, redactValue(item, currentNodeId, issues, currentMediaContext)];
    }));
}

function redactUrl(value: string) {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return value;
    }
}
function redactLocatorValue(value: string, mediaContext: boolean) {
    if (mediaContext && /^(blob:|data:)/i.test(value)) return "[REDACTED]";
    return redactUrl(value);
}
function remoteSource(value: string | undefined) { return value && /^https?:\/\//i.test(value) ? redactUrl(value) : undefined; }
function browserReaders(): CanvasExportReaders { return { getImageBlob, getMediaBlob }; }
function getLimits(readers: CanvasExportReaders): CanvasExportLimits { return { ...DEFAULT_LIMITS, ...readers.limits }; }
async function readBlob(storageKey: string, readers: CanvasExportReaders) { return storageKey.startsWith("image:") ? readers.getImageBlob(storageKey) : readers.getMediaBlob(storageKey); }
function assertBlobLimits(blob: Blob, fileCount: number, totalBytes: number, limits: CanvasExportLimits) {
    if (blob.size > limits.maxSingleFileBytes) throw new CanvasExportError("single_file_size_limit", "单个媒体文件超过导出限制");
    if (fileCount > limits.maxFiles) throw new CanvasExportError("file_count_limit", "媒体文件数量超过导出限制");
    if (totalBytes > limits.maxTotalBytes) throw new CanvasExportError("total_size_limit", "媒体文件总大小超过导出限制");
}
function exportResult(exportedFileCount: number, exportedBytes: number, omittedCount: number): CanvasExportResult { return { status: omittedCount ? "partial" : "success", exportedFileCount, exportedBytes, omittedCount }; }

export function parseCanvasProjectExportManifest(value: unknown): ImportableCanvasExportFile {
    if (!value || typeof value !== "object") throw new CanvasExportError("invalid_manifest", "无效的画布导入清单");
    const data = value as Record<string, unknown>;
    const validVersion = data.version === 3 || (data.version === 4 && data.kind === "canvas-project");
    if (data.app !== "infinite-canvas" || !validVersion || !Array.isArray(data.projects)) throw new CanvasExportError("invalid_manifest", "不支持的画布导入清单");
    const paths = new Set<string>(["projects.json"]);
    const storageKeys = new Map<string, { path: string; mimeType: string }>();
    for (const item of data.projects) {
        if (!item || typeof item !== "object" || !("project" in item) || !Array.isArray((item as { files?: unknown }).files)) throw new CanvasExportError("invalid_manifest", "画布导入清单缺少声明字段");
        for (const file of (item as { files: unknown[] }).files) {
            const declaration = file as Record<string, unknown> | null;
            if (!declaration || typeof declaration.storageKey !== "string" || typeof declaration.path !== "string" || typeof declaration.mimeType !== "string") throw new CanvasExportError("invalid_manifest", "画布导入清单缺少文件声明");
            if (!isStorageKey(declaration.storageKey) || !isSafeArchivePath(declaration.path)) throw new CanvasExportError("invalid_manifest", "画布导入清单包含不安全的文件声明");
            const normalizedPath = declaration.path.toLowerCase();
            const mime = resolveMime(declaration.mimeType, declaration.storageKey);
            if (!mime.ok) throw new CanvasExportError("invalid_manifest", "画布导入清单包含不支持的媒体类型");
            const previous = storageKeys.get(declaration.storageKey);
            if (previous) {
                if (previous.path !== declaration.path || previous.mimeType !== mime.mimeType) throw new CanvasExportError("invalid_manifest", "画布导入清单包含冲突的存储声明");
                continue;
            }
            if (paths.has(normalizedPath)) throw new CanvasExportError("invalid_manifest", "画布导入清单包含重复文件路径");
            paths.add(normalizedPath);
            storageKeys.set(declaration.storageKey, { path: declaration.path, mimeType: mime.mimeType });
        }
    }
    return value as ImportableCanvasExportFile;
}

function safeSegment(value: string, fallback: string) {
    const safe = value.normalize("NFKC").replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, "_").replace(/^\.+|\.+$/g, "").trim();
    return safe && safe !== "." && safe !== ".." ? safe : fallback;
}
function createPathResolver(reserved: string[] = []) {
    const used = new Set(reserved.map((path) => path.toLowerCase()));
    return { resolve(...segments: string[]) {
        const safe = segments.map((segment) => safeSegment(segment, "entry"));
        const file = safe.pop()!;
        const dot = file.lastIndexOf(".");
        const stem = dot > 0 ? file.slice(0, dot) : file;
        const extension = dot > 0 ? file.slice(dot) : "";
        let candidate = [...safe, file].join("/");
        let suffix = 2;
        while (used.has(candidate.toLowerCase())) candidate = [...safe, `${stem}-${suffix++}${extension}`].join("/");
        used.add(candidate.toLowerCase());
        return candidate;
    } };
}
function isStorageKey(value: string) { return STORAGE_KEY.test(value); }
function isSafeArchivePath(value: string) {
    if (!value || value.startsWith("/") || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value)) return false;
    const segments = value.split("/");
    return segments.length > 1 && segments.every((segment) => segment && segment !== "." && segment !== "..");
}
function isCredentialKey(key: string) {
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[- ]/g, "_").toLowerCase();
    return /(^|_)(api_key|access_token|authorization|credential|password|secret|token|cookie|session|private_key)$/.test(normalized);
}
function isUrlKey(key: string) {
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[- ]/g, "_").toLowerCase();
    return /(^|_)(url|uri|href|src|endpoint)s?$/.test(normalized);
}
function isMediaLocatorKey(key: string) {
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[- ]/g, "_").toLowerCase();
    return normalized === "content" || normalized === "url" || normalized === "data_url" || normalized === "urls";
}
function isImplicitStorageReferenceField(key?: string) {
    if (!key) return false;
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[- ]/g, "_").toLowerCase();
    return normalized === "references" || normalized === "url" || normalized === "data_url" || normalized === "content";
}
function resolveMime(mimeType: string, storageKey: string, nodeType?: string): { ok: true; mimeType: string; extension: string } | { ok: false; code: "unknown_mime_type" | "mime_type_mismatch" } {
    const normalized = mimeType.toLowerCase().trim();
    const extension = MIME_EXTENSIONS[normalized];
    if (!extension) return { ok: false, code: "unknown_mime_type" };
    const storageType = storageKey.split(":", 1)[0].toLowerCase();
    const expected = MEDIA_TYPES.has(storageType) ? storageType : nodeType && MEDIA_TYPES.has(nodeType) ? nodeType : storageType;
    if (MEDIA_TYPES.has(expected) && !normalized.startsWith(`${expected}/`)) return { ok: false, code: "mime_type_mismatch" };
    return { ok: true, mimeType: normalized, extension };
}
