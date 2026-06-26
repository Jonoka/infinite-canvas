"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore, type ApiMode } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        const mode: ApiMode = (searchParams.get("mode") || "").toLowerCase() === "newapi" ? "newapi" : "direct";
        const group = searchParams.get("group") || "";
        if (!baseUrl && !apiKey && mode !== "newapi" && !group) return;
        handledConfigParams.current = true;
        searchParams.delete("mode");
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        searchParams.delete("group");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        const patch = {
            ...(baseUrl ? { baseUrl } : {}),
            ...(apiKey && mode !== "newapi" ? { apiKey } : {}),
            apiMode: mode,
            group,
        };
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...patch,
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: mode === "newapi" ? "" : apiKey || "", apiMode: mode, group })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        updateConfig("apiMode", mode);
        updateConfig("group", group);
        if (apiKey && mode !== "newapi") updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success(mode === "newapi" ? "已导入 New API 登录态配置" : "已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
