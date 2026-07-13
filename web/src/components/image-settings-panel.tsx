"use client";

import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const gptImageQualityOptions = [
    { value: "low", label: "1K" },
    { value: "medium", label: "2K" },
    { value: "high", label: "4K" },
];
const DIMENSION_STEP = 16;

const gptImagePresetDimensions: Record<string, Record<string, { width: number; height: number }>> = {
    low: {
        "1:1": { width: 1024, height: 1024 }, "3:2": { width: 1536, height: 1024 }, "2:3": { width: 1024, height: 1536 }, "4:3": { width: 1152, height: 864 }, "3:4": { width: 864, height: 1152 },
        "5:4": { width: 1120, height: 896 }, "4:5": { width: 896, height: 1120 }, "16:9": { width: 1280, height: 720 }, "9:16": { width: 720, height: 1280 }, "21:9": { width: 1456, height: 624 },
    },
    medium: {
        "1:1": { width: 2048, height: 2048 }, "3:2": { width: 2496, height: 1664 }, "2:3": { width: 1664, height: 2496 }, "4:3": { width: 2304, height: 1728 }, "3:4": { width: 1728, height: 2304 },
        "5:4": { width: 2240, height: 1792 }, "4:5": { width: 1792, height: 2240 }, "16:9": { width: 2560, height: 1440 }, "9:16": { width: 1440, height: 2560 }, "21:9": { width: 3024, height: 1296 },
    },
    high: {
        "1:1": { width: 2480, height: 2480 }, "3:2": { width: 3056, height: 2032 }, "2:3": { width: 2032, height: 3056 }, "4:3": { width: 2880, height: 2160 }, "3:4": { width: 2160, height: 2880 },
        "5:4": { width: 2784, height: 2224 }, "4:5": { width: 2224, height: 2784 }, "16:9": { width: 3328, height: 1872 }, "9:16": { width: 2160, height: 3840 }, "21:9": { width: 3808, height: 1632 },
    },
};

const aspectOptions: Array<{ value: string; label: string; width: number; height: number; icon: string; size?: string }> = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1152, height: 864, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 864, height: 1152, icon: "portrait" },
    { value: "5:4", label: "5:4", width: 1120, height: 896, icon: "landscape" },
    { value: "4:5", label: "4:5", width: 896, height: 1120, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1280, height: 720, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 720, height: 1280, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 1456, height: 624, icon: "landscape" },
    { value: "1:1-2k", label: "1:1(2K)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
    { value: "3:2-2k", label: "3:2(2K)", size: "2496x1664", width: 2496, height: 1664, icon: "landscape" },
    { value: "2:3-2k", label: "2:3(2K)", size: "1664x2496", width: 1664, height: 2496, icon: "portrait" },
    { value: "4:3-2k", label: "4:3(2K)", size: "2304x1728", width: 2304, height: 1728, icon: "landscape" },
    { value: "3:4-2k", label: "3:4(2K)", size: "1728x2304", width: 1728, height: 2304, icon: "portrait" },
    { value: "5:4-2k", label: "5:4(2K)", size: "2240x1792", width: 2240, height: 1792, icon: "landscape" },
    { value: "4:5-2k", label: "4:5(2K)", size: "1792x2240", width: 1792, height: 2240, icon: "portrait" },
    { value: "16:9-2k", label: "16:9(2K)", size: "2560x1440", width: 2560, height: 1440, icon: "landscape" },
    { value: "9:16-2k", label: "9:16(2K)", size: "1440x2560", width: 1440, height: 2560, icon: "portrait" },
    { value: "21:9-2k", label: "21:9(2K)", size: "3024x1296", width: 3024, height: 1296, icon: "landscape" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "imageAsync", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    showAsyncSwitch?: boolean;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10, showAsyncSwitch = false }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const modelSettings = settingsForModel(config.model || config.imageModel);
    const availableQualityOptions = modelSettings.qualityOptions;
    const availableAspectOptions = modelSettings.aspectOptions;
    const quality = effectiveImageQuality(config.model || config.imageModel, config.quality || "auto");
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const selectedAspect = availableAspectOptions.find((item) => (item.size || item.value) === activeSize || item.value === activeSize);
    const dimensions = displaySizeDimensions(config.model || config.imageModel, quality, activeSize, selectedAspect || availableAspectOptions[0]);
    const selectAspect = (value: string) => {
        const option = availableAspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.size || option?.value || "auto");
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {availableQualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                {!modelSettings.hideDimensions ? (
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    16倍数对齐
                                </span>
                                <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                            <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                            <span className="text-lg opacity-45">↔</span>
                            <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                        </div>
                    </div>
                ) : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {availableAspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                    {modelSettings.ratioNotice ? <div className="text-[11px] leading-4 opacity-55">比例将作为构图约束，不代表精确像素尺寸。</div> : null}
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
                {showAsyncSwitch ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl px-1 py-1">
                        <div>
                            <SettingTitle color={theme.node.muted}>异步生图</SettingTitle>
                            <div className="mt-1 text-xs opacity-60">开启后请求会携带 async: true</div>
                        </div>
                        <span onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" checked={config.imageAsync === "true"} onChange={(checked) => onConfigChange("imageAsync", checked ? "true" : "false")} />
                        </span>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    return aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function displaySizeDimensions(model: string, quality: string, size: string, fallback: { width: number; height: number }) {
    if (/^\d+x\d+$/i.test(size)) return readSizeDimensions(size, fallback);
    if (modelOptionName(model).toLowerCase() === "gpt-image-2-pro") {
        const preset = gptImagePresetDimensions[quality]?.[size];
        if (preset) return preset;
    }
    return readSizeDimensions(size, fallback);
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

function settingsForModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    if (name === "gpt-image-2-lite") return { qualityOptions: gptImageQualityOptions.slice(0, 1), aspectOptions: aspectOptions.slice(0, 10), hideDimensions: true, ratioNotice: true };
    if (name === "gpt-image-2-pro") return { qualityOptions: gptImageQualityOptions, aspectOptions: aspectOptions.slice(0, 10), hideDimensions: false, ratioNotice: false };
    return { qualityOptions, aspectOptions, hideDimensions: false, ratioNotice: false };
}

function effectiveImageQuality(model: string, quality: string) {
    return modelOptionName(model).toLowerCase() === "gpt-image-2-lite" ? "low" : quality;
}

export const __test__ = { aspectOptions, readSizeDimensions, displaySizeDimensions, alignDimension, settingsForModel, effectiveImageQuality };
