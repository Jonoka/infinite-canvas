"use client";

import { useEffect, useState, type CSSProperties, type DragEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const referenceImages = orderedVideoReferences(mentionReferences.filter((reference) => reference.kind === "image" && reference.active), node.metadata?.videoReferenceOrder);
    const referenceImageCount = mode === "video" ? referenceImages.length : 0;
    const canUseFirstLastFrame = (config.model || "").toLowerCase().includes("veo") && !(config.model || "").toLowerCase().includes("components");
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? config.count : 1 });

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {mode === "video" && referenceImageCount > 0 ? (
                <div className="mb-2 flex gap-1.5" onMouseDown={(event) => event.stopPropagation()}>
                    <VideoModeButton selected={config.videoReferenceMode !== "first_last_frame" || !canUseFirstLastFrame} theme={theme} label="参考图" onClick={() => onConfigChange(node.id, { videoReferenceMode: "image" })} />
                    <VideoModeButton selected={config.videoReferenceMode === "first_last_frame" && canUseFirstLastFrame} theme={theme} label="首尾帧" disabled={!canUseFirstLastFrame} onClick={() => onConfigChange(node.id, { videoReferenceMode: "first_last_frame" })} />
                </div>
            ) : null}
            <div className="flex w-full gap-2">
                {mode === "video" && referenceImageCount > 0 ? (
                    <StackedReferenceImages references={referenceImages} mode={config.videoReferenceMode === "first_last_frame" && canUseFirstLastFrame ? "first_last_frame" : "image"} onOrderChange={(orderedIds) => onConfigChange(node.id, { videoReferenceOrder: orderedIds })} />
                ) : null}
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar h-24 min-w-0 flex-1 resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                    placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                />
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover
                                config={config}
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                            />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    disabled={isRunning || !prompt.trim()}
                    onClick={submit}
                    aria-label="生成"
                >
                    <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                            <CreditSymbol />
                            {credits.toLocaleString()}
                        </span>
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        imageAsync: node.metadata?.imageAsync || globalConfig.imageAsync || defaultConfig.imageAsync,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoReferenceMode: node.metadata?.videoReferenceMode || globalConfig.videoReferenceMode || defaultConfig.videoReferenceMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function VideoModeButton({ selected, theme, label, disabled = false, onClick }: { selected: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; label: string; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-7 cursor-pointer rounded-full border px-3 text-xs font-medium transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
            style={{
                borderColor: selected ? theme.node.text : theme.node.stroke,
                background: selected ? theme.node.text : theme.node.fill,
                color: selected ? theme.node.fill : theme.node.text,
            }}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function StackedReferenceImages({ references, mode, onOrderChange }: { references: CanvasResourceReference[]; mode: "image" | "first_last_frame"; onOrderChange: (orderedIds: string[]) => void }) {
    const [expanded, setExpanded] = useState(false);
    const dropOn = (event: DragEvent<HTMLDivElement>, toIndex: number) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData("text/reference-index"));
        if (!Number.isFinite(fromIndex) || fromIndex === toIndex) return;
        onOrderChange(moveArrayItem(references, fromIndex, toIndex).map((reference) => reference.nodeId));
    };

    return (
        <div className="relative h-24 w-20 shrink-0" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)} onMouseDown={(event) => event.stopPropagation()}>
            <div className="absolute left-0 top-0 h-24" style={{ width: expanded ? Math.max(80, references.length * 56) : 80 }}>
                {references.map((reference, index) => {
                    const offset = expanded ? index * 56 : Math.min(index * 7, 18);
                    return (
                        <div
                            key={reference.nodeId}
                            draggable
                            className="absolute left-0 top-0 h-16 w-16 cursor-grab overflow-hidden rounded-xl border border-white/80 bg-stone-200 shadow-md transition-transform duration-200 active:cursor-grabbing"
                            style={{ transform: `translateX(${offset}px)`, zIndex: expanded ? 30 + index : references.length - index } as CSSProperties}
                            onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/reference-index", String(index));
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => dropOn(event, index)}
                        >
                            {reference.previewUrl ? <img src={reference.previewUrl} alt={reference.title} className="size-full object-cover" draggable={false} /> : null}
                            <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[10px] font-medium text-white">{stackedReferenceLabel(mode, index)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function stackedReferenceLabel(mode: "image" | "first_last_frame", index: number) {
    if (mode === "first_last_frame") return index === 0 ? "首帧" : index === 1 ? "尾帧" : `参考${index + 1}`;
    return `图${index + 1}`;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
    const next = [...items];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoReferenceMode") return { videoReferenceMode: value };
    return { [key]: value };
}

function orderedVideoReferences(references: CanvasResourceReference[], order?: string[]) {
    if (!order?.length) return references;
    const rank = new Map(order.map((nodeId, index) => [nodeId, index]));
    return [...references].sort((left, right) => (rank.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER));
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
