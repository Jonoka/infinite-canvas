import axios from "axios";

import type { PricingPayload } from "@/lib/image-pricing";
import { aiApiUrl, aiRequestOptions } from "@/services/api/ai-client";
import type { AiConfig } from "@/stores/use-config-store";

export async function fetchPricing(config: AiConfig, signal?: AbortSignal) {
    return (await axios.get<PricingPayload>(aiApiUrl(config, "/pricing"), aiRequestOptions(config, { signal }))).data;
}
