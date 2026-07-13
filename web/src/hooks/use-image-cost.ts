"use client";

import { useQuery } from "@tanstack/react-query";

import { calculateImageCost, formatImageCost } from "@/lib/image-pricing";
import { fetchPricing } from "@/services/api/pricing";
import { isNewApiMode, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export function useImageCost(config: AiConfig, model = config.model || config.imageModel, count = Number(config.count) || 1) {
    const requestConfig = resolveModelRequestConfig(config, model);
    const enabled = isNewApiMode(requestConfig) && Boolean(requestConfig.baseUrl.trim() && requestConfig.group.trim() && model);
    const query = useQuery({
        queryKey: ["image-pricing", requestConfig.baseUrl, requestConfig.group],
        queryFn: ({ signal }) => fetchPricing(requestConfig, signal),
        enabled,
        staleTime: 60_000,
        retry: false,
    });
    return enabled && query.data ? calculateImageCost(query.data, model, requestConfig.group, count) : null;
}

export { formatImageCost };
