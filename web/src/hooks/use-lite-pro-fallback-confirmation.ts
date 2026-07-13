"use client";

import { App } from "antd";
import { useCallback } from "react";

import { formatImageCost } from "@/lib/image-pricing";
import { buildLiteToProFallback, type LiteToProFallback } from "@/lib/lite-pro-fallback";
import { fetchPricing } from "@/services/api/pricing";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export function useLiteToProFallbackConfirmation() {
    const { modal } = App.useApp();

    return useCallback(
        async (config: AiConfig, count: number): Promise<LiteToProFallback | null> => {
            const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
            let pricing = null;
            let pricingAvailable = false;
            try {
                pricing = await fetchPricing(requestConfig);
                pricingAvailable = true;
            } catch {
                // Explicit confirmation still works, but the UI must not guess a price or group capability.
            }
            const fallback = buildLiteToProFallback({
                apiMode: requestConfig.apiMode,
                model: requestConfig.model,
                group: requestConfig.group,
                size: requestConfig.size,
                pricing,
                pricingAvailable,
                count,
            });
            if (!fallback) return null;
            const priceText = fallback.cost ? `预计费用 ${formatImageCost(fallback.cost.cost)}。` : "预计费用暂不可用。";
            const groupText = !pricingAvailable && requestConfig.group !== "auto"
                ? `暂时无法核验固定分组「${requestConfig.group}」是否提供专业版；继续会为本次重试使用自动分组，不修改你的持久配置。`
                : fallback.switchesToAuto
                  ? `当前固定分组「${requestConfig.group}」不提供专业版；继续只会为本次重试切换到自动分组，不修改你的持久配置。`
                  : fallback.group === "auto"
                    ? "本次仍使用自动分组。"
                    : `本次继续使用分组「${fallback.group}」。`;
            const confirmed = await new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "轻量版暂不可用，改用专业版？",
                    content: `轻量版已在服务端完成全部可用渠道重试，但仍未生成成功。是否使用 GPT Image 2 专业版重试失败的 ${count} 张？${groupText}${priceText}`,
                    okText: fallback.switchesToAuto ? "切换自动分组并使用专业版" : "使用专业版重试",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            return confirmed ? fallback : null;
        },
        [modal],
    );
}
