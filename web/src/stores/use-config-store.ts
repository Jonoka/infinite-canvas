import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

export type ApiCallFormat = "openai" | "gemini";
export type ApiMode = "direct" | "newapi";
export type ModelCapability = "image" | "video" | "text" | "audio";

export type ChannelModel = {
    name: string;
    /** Optional for legacy persisted configs; missing metadata remains permissive. */
    capability?: ModelCapability;
    script?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    apiMode: ApiMode;
    group: string;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    apiMode: ApiMode;
    group: string;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "webdav";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    apiMode: "direct",
    group: "",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            apiMode: "direct",
            group: "",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "gpt-image-2-lite", capability: "image" },
                { name: "gpt-image-2-pro", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2-lite",
    imageModel: "default::gpt-image-2-lite",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::gpt-image-2-lite", "default::gpt-image-2-pro", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    const modelCapability = modelCapabilityOf(config, value);
    return modelCapability === undefined || modelCapability === capability;
}

/** Reject an explicitly incompatible resolved model while keeping legacy metadata-less models usable. */
export function assertModelCapability(config: AiConfig, value: string, capability: ModelCapability, label: string = capability) {
    const modelCapability = modelCapabilityOf(config, value);
    if (modelCapability !== undefined && modelCapability !== capability) {
        throw new Error(`所选模型不支持${label}能力`);
    }
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return uniqueModelOptions(config.channels.flatMap((channel) => channel.models.filter((model) => (model.capability === undefined || model.capability === capability) && (capability !== "image" || !isHiddenCompatibilityImageModel(model.name))).map((model) => encodeChannelModel(channel.id, model.name))));
}

export function isHiddenCompatibilityImageModel(model: string) {
    return modelOptionName(model).toLowerCase() === "gpt-image-2";
}

const GPT_IMAGE_LITE = "gpt-image-2-lite";
const GPT_IMAGE_PRO = "gpt-image-2-pro";

/** Upgrade only the bundled default channel's old single GPT Image entry. */
export function migrateLegacyGptImageConfig(config: AiConfig): AiConfig {
    const index = config.channels.findIndex((channel) => channel.id === "default");
    if (index < 0) return config;
    const channel = config.channels[index];
    if (channel.baseUrl.trim().replace(/\/+$/, "").toLowerCase() !== OPENAI_BASE_URL) return config;
    const family = channel.models.filter((model) => ["gpt-image-2", GPT_IMAGE_LITE, GPT_IMAGE_PRO].includes(model.name.toLowerCase()));
    if (family.length !== 1 || !["gpt-image-2", GPT_IMAGE_PRO].includes(family[0].name.toLowerCase())) return config;

    const source = family[0];
    const metadata: Pick<ChannelModel, "capability" | "script"> = { capability: source.capability || "image", ...(source.script ? { script: source.script } : {}) };
    const nextModels: ChannelModel[] = [
        { name: GPT_IMAGE_LITE, ...metadata },
        { name: GPT_IMAGE_PRO, ...metadata },
        ...channel.models.filter((model) => !["gpt-image-2", GPT_IMAGE_PRO].includes(model.name.toLowerCase())),
    ];
    const channels = config.channels.map((item, channelIndex) => channelIndex === index ? { ...item, models: nextModels } : item);
    const lite = encodeChannelModel(channel.id, GPT_IMAGE_LITE);
    const legacySelection = (value: string) => {
        const decoded = decodeChannelModel(value);
        return (!decoded || decoded.channelId === channel.id) && ["gpt-image-2", GPT_IMAGE_PRO].includes(modelOptionName(value).toLowerCase());
    };
    return {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        imageModel: legacySelection(config.imageModel) ? lite : config.imageModel,
        model: legacySelection(config.model) ? lite : config.model,
    };
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.apiMode === "newapi" ? channel.group.trim() : channel.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig, apiMode: normalizeApiMode(persistedConfig.apiMode), group: (persistedConfig.group || "").trim() };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                const migratedConfig = migrateLegacyGptImageConfig({
                    ...config,
                    channelMode: "local",
                    apiFormat: normalizeApiFormat(config.apiFormat),
                    channels,
                    models,
                    imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                    videoModel: normalizeModelOptionValue(config.videoModel, channels),
                    textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                    audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                    audioVoice: config.audioVoice || defaultConfig.audioVoice,
                    audioFormat: config.audioFormat || defaultConfig.audioFormat,
                    audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                    audioInstructions: config.audioInstructions || "",
                    videoSeconds: config.videoSeconds || "6",
                    vquality: config.vquality || "720",
                    videoGenerateAudio: config.videoGenerateAudio || "true",
                    videoWatermark: config.videoWatermark || "false",
                    canvasImageCount: config.canvasImageCount || "3",
                });
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: migratedConfig,
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability;
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        apiMode: normalizeApiMode(channel?.apiMode),
        group: channel?.group?.trim() || "",
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const label = name === GPT_IMAGE_LITE ? "GPT Image 2 · 轻量版" : name === GPT_IMAGE_PRO ? "GPT Image 2 · 专业版" : name;
    if (!decoded) return label;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${label}（${channel.name}）` : label;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

/** Replace one channel's discovered models authoritatively and repair stale capability selections. */
export function reconcileChannelModels(config: AiConfig, channelId: string, rawModels: string[]): AiConfig {
    const channel = config.channels.find((item) => item.id === channelId);
    if (!channel) return config;
    const existing = new Map(channel.models.map((model) => [model.name, model]));
    const channelModels = normalizeChannelModels(rawModels).map((model) => existing.get(model.name) || model);
    const channels = config.channels.map((item) => item.id === channelId ? { ...item, models: channelModels } : item);
    const models = modelOptionsFromChannels(channels);
    const next = { ...config, channels, models };
    const repair = (current: string, capability: ModelCapability) => {
        const options = selectableModelsByCapability(next, capability);
        const normalized = normalizeModelOptionValue(current, channels);
        return options.includes(normalized) ? normalized : options[0] || "";
    };
    next.imageModel = repair(config.imageModel, "image");
    next.videoModel = repair(config.videoModel, "video");
    next.textModel = repair(config.textModel, "text");
    next.audioModel = repair(config.audioModel, "audio");
    const normalizedModel = normalizeModelOptionValue(config.model, channels);
    next.model = models.includes(normalizedModel) ? normalizedModel : next.imageModel || next.videoModel || next.textModel || next.audioModel || "";
    return next;
}

/** Replace the channel set and repair every selection that pointed at a removed model. */
export function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const next: AiConfig = {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        apiMode: channels[0]?.apiMode || config.apiMode,
        group: channels[0]?.group ?? config.group,
    };
    const repair = (current: string, capability: ModelCapability) => {
        const options = selectableModelsByCapability(next, capability);
        const normalized = normalizeModelOptionValue(current, channels);
        return options.includes(normalized) ? normalized : options[0] || "";
    };
    next.imageModel = repair(config.imageModel, "image");
    next.videoModel = repair(config.videoModel, "video");
    next.textModel = repair(config.textModel, "text");
    next.audioModel = repair(config.audioModel, "audio");
    const normalizedModel = normalizeModelOptionValue(config.model, channels);
    next.model = models.includes(normalizedModel) ? normalizedModel : next.imageModel || next.videoModel || next.textModel || next.audioModel || "";
    return next;
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        apiMode: channel.apiMode,
        group: channel.group,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                apiMode: config.apiMode || defaultConfig.apiMode,
                group: config.group || "",
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function normalizeApiMode(apiMode: unknown): ApiMode {
    return apiMode === "newapi" ? "newapi" : "direct";
}

export function normalizePersistedAiConfig(config: Partial<AiConfig>): AiConfig {
    const persisted = { ...defaultConfig, ...config } as AiConfig;
    return { ...persisted, apiMode: normalizeApiMode(persisted.apiMode), group: (persisted.group || "").trim(), channels: normalizeChannels(persisted) };
}

export function isNewApiMode(config: Pick<AiConfig | ModelChannel, "apiMode">) {
    return config.apiMode === "newapi";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
