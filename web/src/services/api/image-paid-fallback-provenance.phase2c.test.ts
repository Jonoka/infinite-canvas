import { describe, expect, test } from "bun:test";

import { createImageWorkbenchActions } from "@/pages/image/image-generation-actions";
import { requestEdit, requestGeneration } from "./image";
import type { AiConfig } from "@/stores/use-config-store";

const ref = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };

function multiChannelConfig(): AiConfig {
    return {
        apiMode: "newapi", apiFormat: "openai", baseUrl: "https://stale-top.example/v1", apiKey: "stale", group: "stale-top-group",
        model: "failed::gpt-image-2-lite", imageModel: "failed::gpt-image-2-lite", quality: "low", size: "1:1", count: "1", systemPrompt: "",
        channels: [
            {
                id: "other", name: "Other", baseUrl: "https://other.example/v1", apiKey: "other-key", apiMode: "newapi", apiFormat: "openai", group: "other-pro-group",
                models: [{ name: "gpt-image-2-pro", capability: "image" }],
            },
            {
                id: "failed", name: "Failed", baseUrl: "https://failed.example/canvas/v1", apiKey: "failed-key", apiMode: "newapi", apiFormat: "openai", group: "failed-lite-group",
                models: [{ name: "gpt-image-2-lite", capability: "image" }, { name: "gpt-image-2-pro", capability: "image" }],
            },
        ],
    } as AiConfig;
}

describe("Phase 2C selected channel and paid retry provenance", () => {
    test.each(["generation", "edit"] as const)("real %s request does not overwrite the encoded channel group with stale top-level group", async (kind) => {
        const seen: Array<{ url: string; body: unknown }> = [];
        const config = multiChannelConfig();
        const options = { transport: async (request: { url: string; method: string; body: unknown }) => { seen.push(request); return { data: [{ b64_json: "AA==" }] }; } };

        if (kind === "generation") await requestGeneration(config, "prompt", options);
        else await requestEdit(config, "prompt", [ref], undefined, options);

        expect(seen).toHaveLength(1);
        expect(new URL(seen[0].url).origin).toBe("https://failed.example");
        expect(new URL(seen[0].url).searchParams.get("group"), "the selected encoded channel group is authoritative").toBe("failed-lite-group");
        expect(new URL(seen[0].url).searchParams.get("group")).not.toBe("stale-top-group");
    });

    test("paid quote and authorized Pro retry stay on the resolved channel that produced the Lite exhaustion", async () => {
        const persisted = multiChannelConfig();
        const priced: AiConfig[] = [];
        const requests: Array<{ url: string; body: unknown }> = [];
        let attempts = 0;
        const actions = createImageWorkbenchActions({
            request: (_prompt, config) => requestGeneration(config, "prompt", {
                transport: async (request) => {
                    requests.push(request);
                    attempts++;
                    return attempts === 1
                        ? { code: "lite_pool_exhausted", message: "empty" }
                        : { data: [{ b64_json: "AA==" }] };
                },
            }),
            loadPricing: async (resolvedFailedConfig) => { priced.push(resolvedFailedConfig); return null; },
            requestConsent: async () => ({ model: "gpt-image-2-pro", group: "auto", quality: "low", size: "1:1", count: 1 }),
        });

        const outcome = await actions.retrySlot(persisted, "prompt");

        expect(outcome.status).toBe("fulfilled");
        expect(priced).toHaveLength(1);
        expect(priced[0], "pricing must use the resolved failed request, not mutable/unresolved selection").toMatchObject({
            channelId: "failed", baseUrl: "https://failed.example/canvas/v1", group: "failed-lite-group", model: "gpt-image-2-lite",
        });
        expect(requests).toHaveLength(2);
        expect(new URL(requests[1].url).origin, "unqualified Pro must not reselect another capable channel").toBe("https://failed.example");
        expect(new URL(requests[1].url).searchParams.get("group"), "consent may change group to auto on the same failed channel").toBe("auto");
        expect(requests[1].body).toMatchObject({ model: "gpt-image-2-pro" });
    });
});
