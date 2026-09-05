"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatImageCost, useImageCost } from "@/hooks/use-image-cost";
import { useLiteToProFallbackConfirmation } from "@/hooks/use-lite-pro-fallback-confirmation";
import { isLitePoolExhaustedError, type LiteToProFallback } from "@/lib/lite-pro-fallback";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { modelOptionLabel, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { ImageTaskFailedError, recoverImageTask, requestEdit, requestGeneration, type ImageTaskAcceptance } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import { createGenerationLogWriter, generationLogResults, interruptGenerationResults, summarizeGenerationLog, updateGenerationResult, type GeneratedImage, type GenerationResult, type GenerationLog, type GenerationLogConfig } from "./generation-log";

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const writeGenerationLog = createGenerationLogWriter((id, log) => (log ? logStore.setItem(id, serializeLog(log)) : logStore.removeItem(id)));

export default function ImagePage() {
    const { message } = App.useApp();
    const confirmProFallback = useLiteToProFallbackConfirmation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [logsReady, setLogsReady] = useState(false);
    const logsRef = useRef(new Map<string, GenerationLog>());
    const selectedLogRef = useRef<string | null>(null);
    const controllersRef = useRef(new Map<string, AbortController>());
    const busyRef = useRef(false);
    const mountedRef = useRef(false);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const estimatedCost = useImageCost(effectiveConfig, model, generationCount);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        mountedRef.current = true;
        let disposed = false;
        void readStoredLogs()
            .then((stored) => {
                if (disposed) return;
                const restored = stored.map((log) => (log.results ? summarizeGenerationLog(log, interruptGenerationResults(log.results)) : log));
                logsRef.current = new Map(restored.map((log) => [log.id, log]));
                setLogs(restored);
                setLogsReady(true);
                const unfinished = restored.find((log) => log.results?.some((result) => result.status === "interrupted"));
                if (unfinished) void previewGenerationLog(unfinished);
            })
            .catch(() => {
                if (!disposed) message.error("生成记录读取失败");
            });
        return () => {
            disposed = true;
            mountedRef.current = false;
            logsRef.current.forEach((log) => {
                if (log.results?.some((result) => result.status === "pending")) {
                    const interrupted = summarizeGenerationLog(log, interruptGenerationResults(log.results));
                    logsRef.current.set(log.id, interrupted);
                    void writeGenerationLog(log.id, interrupted).catch(() => {});
                }
            });
            controllersRef.current.forEach((controller) => controller.abort());
        };
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const generate = async () => {
        if (busyRef.current || !logsReady) return;
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;

        busyRef.current = true;
        setElapsedMs(0);
        setRunning(true);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        const slots: GenerationResult[] = Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" }));
        const log = summarizeGenerationLog(
            buildLog({ prompt: text, model, config: { ...snapshot.config, count: String(generationCount) }, references: snapshot.references, durationMs: 0, successCount: 0, failCount: 0, status: "生成中", images: [] }),
            slots,
        );
        selectedLogRef.current = log.id;
        try {
            await saveLog(log);
            let settled = await Promise.allSettled(slots.map((slot) => runGenerationSlot(log.id, slot.id, snapshot)));
            const eligible = settled.flatMap((item, index) => (item.status === "rejected" && isLitePoolExhaustedError(item.reason) ? [index] : []));
            if (eligible.length && mountedRef.current && logsRef.current.has(log.id)) {
                const fallback = await confirmProFallback(snapshot.config, eligible.length);
                if (fallback) {
                    const retried = await Promise.allSettled(eligible.map((index) => runGenerationSlot(log.id, slots[index].id, snapshot, fallback)));
                    settled = [...settled];
                    retried.forEach((item, index) => {
                        settled[eligible[index]] = item;
                    });
                }
            }
            const current = logsRef.current.get(log.id);
            if (current) await saveLog({ ...current, durationMs: performance.now() - batchStartedAt });
            if (mountedRef.current && current) {
                if (current.status === "等待查询") message.warning("等待已中断，任务状态待查询");
                else if (current.successCount) message.success("图片已生成");
                else message.error("生成失败");
            }
        } catch (error) {
            interruptPendingLog(log.id, error);
            if (mountedRef.current) message.error(error instanceof Error ? error.message : "生成记录保存失败");
        } finally {
            busyRef.current = false;
            if (mountedRef.current) setRunning(false);
        }
    };

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success("已加入参考图");
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: `生成结果 ${index + 1}`,
            coverUrl: stored.url,
            tags: [],
            source: "生图工作台",
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning("生图工作台只能使用文本或图片素材");
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        selectedLogRef.current = null;
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = async () => {
        const imageKeys = logs.filter((log) => selectedLogIds.includes(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        const ids = [...selectedLogIds];
        ids.forEach((id) => {
            logsRef.current.get(id)?.results?.forEach((result) => controllersRef.current.get(result.id)?.abort());
            logsRef.current.delete(id);
        });
        setLogs((value) => value.filter((log) => !ids.includes(log.id)));
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            selectedLogRef.current = null;
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        try {
            await Promise.all(ids.map((id) => writeGenerationLog(id, null)));
            await deleteStoredImages(imageKeys);
        } catch {
            message.error("生成记录删除失败");
        }
    };

    const updateLogView = (log: GenerationLog) => {
        if (!mountedRef.current) return;
        logsRef.current.set(log.id, log);
        setLogs(Array.from(logsRef.current.values()).sort((a, b) => b.createdAt - a.createdAt));
        if (selectedLogRef.current === log.id) {
            setPreviewLog(log);
            setResults(generationLogResults(log));
        }
    };

    const saveLog = async (log: GenerationLog) => {
        if (!mountedRef.current) return;
        updateLogView(log);
        try {
            await writeGenerationLog(log.id, log);
        } catch {
            throw new Error("生成记录保存失败，刷新后可能无法恢复任务");
        }
    };

    const interruptPendingLog = (logId: string, error: unknown) => {
        const log = logsRef.current.get(logId);
        if (!log) return;
        updateLogView(summarizeGenerationLog(log, interruptGenerationResults(generationLogResults(log), error instanceof Error ? error.message : "等待已中断")));
    };

    const updateSlot = async (logId: string, resultId: string, patch: Partial<GenerationResult>) => {
        if (!mountedRef.current) return;
        const log = logsRef.current.get(logId);
        if (log) await saveLog(updateGenerationResult(log, resultId, patch));
    };

    const storeSlotImage = async (logId: string, input: string | Blob) => {
        if (!mountedRef.current || !logsRef.current.has(logId)) throw new Error("等待已中断");
        const stored = await uploadImage(input);
        if (!mountedRef.current || !logsRef.current.has(logId)) {
            await deleteStoredImages([stored.storageKey]);
            throw new Error("等待已中断");
        }
        return stored;
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        selectedLogRef.current = log.id;
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        if (log.config.imageAsync) updateConfig("imageAsync", log.config.imageAsync);
        setResults(generationLogResults(log));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (logId: string, resultId: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, fallback?: LiteToProFallback): Promise<GeneratedImage> => {
        const itemStartedAt = performance.now();
        const controller = new AbortController();
        controllersRef.current.set(resultId, controller);
        let task: GenerationResult["task"];
        const route = resolveModelRequestConfig(snapshot.config, snapshot.config.model);
        const options = {
            signal: controller.signal,
            requestOverride: fallback ? { model: fallback.model, group: fallback.group, quality: fallback.quality, size: fallback.size, count: "1" } : undefined,
            onTaskAccepted: async (accepted: ImageTaskAcceptance) => {
                task = { ...accepted, baseUrl: route.baseUrl, apiMode: route.apiMode };
                await updateSlot(logId, resultId, { task });
            },
        };
        try {
            if (!logsRef.current.has(logId) || !mountedRef.current) throw new Error("等待已中断");
            await updateSlot(logId, resultId, { status: "pending", task: undefined, error: undefined, image: undefined, durationMs: 0, waitStartedAt: Date.now() });
            if (!logsRef.current.has(logId) || !mountedRef.current) throw new Error("等待已中断");
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, undefined, options) : await requestGeneration(snapshot.config, snapshot.text, options);
            const image = result[0];
            if (!image) throw new Error("接口没有返回图片");
            const stored = await storeSlotImage(logId, image.dataUrl);
            const resultImage = {
                id: image.id,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                durationMs: performance.now() - itemStartedAt,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                actualModel: task?.model || fallback?.model || route.model,
                actualGroup: task?.group || fallback?.group || route.group,
            };
            await updateSlot(logId, resultId, { status: "success", image: resultImage, error: undefined, durationMs: resultImage.durationMs, waitStartedAt: undefined });
            return resultImage;
        } catch (error) {
            const current = logsRef.current.get(logId)?.results?.find((result) => result.id === resultId);
            if (current?.status === "success" && mountedRef.current) message.error(error instanceof Error ? error.message : "生成记录保存失败");
            if (current?.status !== "success")
                await updateSlot(logId, resultId, {
                    status: controller.signal.aborted || (task?.recoverable && !(error instanceof ImageTaskFailedError)) ? "interrupted" : "failed",
                    error: controller.signal.aborted ? "等待已中断，任务状态待查询" : error instanceof Error ? error.message : "生成失败",
                    durationMs: performance.now() - itemStartedAt,
                    waitStartedAt: undefined,
                });
            throw error;
        } finally {
            controllersRef.current.delete(resultId);
        }
    };

    const retryResult = async (resultId: string) => {
        if (busyRef.current || !previewLog) return;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        // A new generation gets its own record so the old paid task remains recoverable.
        const slot: GenerationResult = { id: nanoid(), status: "pending" };
        const log = summarizeGenerationLog(buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: 0, successCount: 0, failCount: 0, status: "生成中", images: [] }), [slot]);
        if (!generationLogResults(previewLog).some((result) => result.id === resultId)) return;
        busyRef.current = true;
        setRunning(true);
        setStartedAt(performance.now());
        setElapsedMs(0);
        selectedLogRef.current = log.id;
        try {
            await saveLog(log);
            try {
                await runGenerationSlot(log.id, slot.id, snapshot);
            } catch (error) {
                if (!isLitePoolExhaustedError(error) || !mountedRef.current) throw error;
                const fallback = await confirmProFallback(snapshot.config, 1);
                if (fallback) await runGenerationSlot(log.id, slot.id, snapshot, fallback);
            }
        } catch (error) {
            interruptPendingLog(log.id, error);
            if (mountedRef.current) message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            busyRef.current = false;
            if (mountedRef.current) setRunning(false);
        }
    };

    const recoverResult = async (resultId: string) => {
        if (busyRef.current || !previewLog) return;
        const logId = previewLog.id;
        const result = generationLogResults(previewLog).find((item) => item.id === resultId);
        const task = result?.task;
        if (!task?.recoverable) return;
        busyRef.current = true;
        setRunning(true);
        setStartedAt(performance.now());
        setElapsedMs(0);
        const controller = new AbortController();
        controllersRef.current.set(resultId, controller);
        const recoveryStartedAt = performance.now();
        const previousDurationMs = result?.durationMs || 0;
        try {
            await updateSlot(logId, resultId, { status: "pending", error: undefined, waitStartedAt: Date.now() });
            if (!logsRef.current.has(logId) || !mountedRef.current) return;
            const blob = await recoverImageTask({ ...effectiveConfig, baseUrl: task.baseUrl, apiMode: task.apiMode, apiKey: "", channels: [], models: [] }, task, { signal: controller.signal, waitForCompletion: true });
            const stored = await storeSlotImage(logId, blob);
            const image: GeneratedImage = {
                id: nanoid(),
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                durationMs: previousDurationMs + performance.now() - recoveryStartedAt,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                actualModel: task.model,
                actualGroup: task.group,
            };
            await updateSlot(logId, resultId, { status: "success", image, error: undefined, durationMs: image.durationMs, waitStartedAt: undefined });
            if (mountedRef.current) message.success("已获取成品");
        } catch (error) {
            try {
                const current = logsRef.current.get(logId)?.results?.find((item) => item.id === resultId);
                if (current?.status === "success") {
                    if (mountedRef.current) message.error(error instanceof Error ? error.message : "生成记录保存失败");
                } else
                    await updateSlot(logId, resultId, {
                        status: error instanceof ImageTaskFailedError ? "failed" : "interrupted",
                        error: controller.signal.aborted ? "等待已中断，任务状态待查询" : error instanceof Error ? error.message : "任务查询中断",
                        durationMs: previousDurationMs + performance.now() - recoveryStartedAt,
                        waitStartedAt: undefined,
                    });
            } catch (storageError) {
                if (mountedRef.current) message.error(storageError instanceof Error ? storageError.message : "生成记录保存失败");
            }
        } finally {
            controllersRef.current.delete(resultId);
            busyRef.current = false;
            if (mountedRef.current) setRunning(false);
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">生图工作台</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        记录
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        参数
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">提示词</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            查看提示词库
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            查看我的素材
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder="描述画面主体、风格、构图、光线和用途" />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考图</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    调整
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            {estimatedCost ? (
                                <div className="mb-2 text-center text-xs text-stone-500 dark:text-stone-400" title={`按 ${estimatedCost.group} 分组当前定价估算`}>
                                    预计费用 {formatImageCost(estimatedCost.cost)}
                                </div>
                            ) : null}
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running || !logsReady} onClick={() => void generate()}>
                                开始生成
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold">生成结果</h2>
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">等待 {formatDuration(elapsedMs)}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" || result.status === "interrupted" ? (
                                        <FailedImageCard
                                            key={result.id}
                                            error={result.error || "生成失败"}
                                            interrupted={result.status === "interrupted"}
                                            busy={running}
                                            onRecover={result.status === "interrupted" && result.task?.recoverable ? () => void recoverResult(result.id) : undefined}
                                            onRetry={() => void retryResult(result.id)}
                                        />
                                    ) : (
                                        <PendingImageCard key={result.id} onStop={result.task?.recoverable ? () => controllersRef.current.get(result.id)?.abort() : undefined} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成图片" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer title="参数" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={{ ...config, model }} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} showAsyncSwitch />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <Image src={image.dataUrl} alt={`生成结果 ${index + 1}`} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title="添加到素材">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            添加到素材
                        </Button>
                    </Tooltip>
                    <Tooltip title="加入参考图">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            加入参考图
                        </Button>
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            下载
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ onStop }: { onStop?: () => void }) {
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
                {onStop ? (
                    <Button size="small" onClick={onStop}>
                        停止等待
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function FailedImageCard({ error, interrupted, busy, onRecover, onRetry }: { error: string; interrupted?: boolean; busy: boolean; onRecover?: () => void; onRetry: () => void }) {
    return (
        <div className={`overflow-hidden rounded-lg border ${interrupted ? "border-stone-200 bg-background dark:border-stone-700" : "border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20"}`}>
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium">{interrupted ? "等待已中断" : "生成失败"}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 max-w-full break-words !text-xs">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 p-3 dark:border-stone-700">
                {onRecover ? (
                    <Button size="small" type="primary" icon={<RefreshCw className="size-3.5" />} disabled={busy} onClick={onRecover}>
                        继续查询／获取成品
                    </Button>
                ) : null}
                <Button size="small" icon={<Sparkles className="size-3.5" />} disabled={busy} onClick={onRetry}>
                    重新生成
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">生成记录</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新建
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex flex-wrap justify-end gap-1">
                        {log.status === "生成中" || log.status === "等待查询" ? (
                            <Tag className="m-0" color="gold">
                                {log.status}
                            </Tag>
                        ) : null}
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            成功 {log.successCount ?? log.imageCount}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                失败 {log.failCount}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.imageCount} 张</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    await writeGenerationLog.flush();
    const values: GenerationLog[] = [];
    await logStore.iterate<GenerationLog, void>((value) => {
        values.push(value);
    });
    const logs = await Promise.all(values.map(normalizeLog));
    return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    const results = log.results ? await Promise.all(log.results.map(async (result) => ({ ...result, image: result.image ? { ...result.image, dataUrl: await resolveImageUrl(result.image.storageKey, result.image.dataUrl) } : undefined }))) : undefined;
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "成功",
        images,
        results,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        results: log.results?.map((result) => ({ ...result, image: result.image ? { ...result.image, dataUrl: result.image.storageKey ? "" : result.image.dataUrl } : undefined })),
        thumbnails: [],
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        group: log.config?.group || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
        imageAsync: log.config?.imageAsync || "false",
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        group: config.group,
        quality: config.quality,
        size: config.size,
        count: config.count,
        imageAsync: config.imageAsync,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}
