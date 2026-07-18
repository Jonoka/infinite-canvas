import { describe, expect, test } from "bun:test";

import { requestEdit, requestGeneration, type ImageTaskAcceptance } from "./image";
import type { AiConfig } from "@/stores/use-config-store";

type TransportRequest = { url: string; method: string; body: unknown };
type RequestWithTransport = { transport: (request: TransportRequest) => Promise<unknown>; onTaskAccepted: (task: ImageTaskAcceptance) => void };

function config(): AiConfig {
    return {
        apiMode: "newapi", apiFormat: "openai", baseUrl: "https://api.example.test/console/?old=1#x", apiKey: "key", group: "lite-only",
        model: "images::gpt-image-2-lite", imageModel: "images::gpt-image-2-lite", quality: "low", size: "1:1", count: "4", systemPrompt: "",
        channels: [{ id: "images", name: "Images", baseUrl: "https://api.example.test/console/", apiKey: "key", apiMode: "newapi", apiFormat: "openai", group: "lite-only", models: [{ name: "gpt-image-2-lite", capability: "image" }, { name: "gpt-image-2-pro", capability: "image" }] }],
    } as AiConfig;
}

function proOverride(original: AiConfig): AiConfig {
    return { ...original, model: "gpt-image-2-pro", imageModel: "gpt-image-2-pro", group: "auto", count: "1" };
}

describe("Phase 2C real image request entry points honor one-shot transport overrides", () => {
    test.each(["generation", "edit"] as const)("request%s sends Pro/auto and reports accepted resolved provenance", async (kind) => {
        const persisted = config();
        const before = structuredClone(persisted);
        const requests: TransportRequest[] = [];
        let accepted: ImageTaskAcceptance | undefined;
        const options: RequestWithTransport = {
            transport: async (request) => { requests.push(request); return { code: 0, data: { task_id: `${kind}-paid` } }; },
            onTaskAccepted: (task) => { accepted = task; },
        };
        const paid = proOverride(persisted);
        const pending = kind === "generation"
            ? requestGeneration(paid, "prompt", options)
            : requestEdit(paid, "prompt", [{ id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }], undefined, options);
        // The injected transport returns task acceptance; production may subsequently poll through that seam.
        await pending.catch(() => undefined);
        expect(requests).toHaveLength(1);
        expect(new URL(requests[0].url).searchParams.get("group")).toBe("auto");
        const body = requests[0].body instanceof FormData ? Object.fromEntries(requests[0].body.entries()) : requests[0].body as Record<string, unknown>;
        expect(body).toMatchObject({ model: "gpt-image-2-pro", n: kind === "generation" ? 1 : "1" });
        expect(accepted).toMatchObject({ taskId: `${kind}-paid`, model: "gpt-image-2-pro", group: "auto", channelId: "images", baseUrl: "https://api.example.test/console", recoverable: true });
        expect(persisted).toEqual(before);
    });

    test("the next real request without an override is Lite again", async () => {
        const persisted = config();
        const seen: TransportRequest[] = [];
        await requestGeneration(persisted, "next", { transport: async (request: TransportRequest) => { seen.push(request); return { data: [{ b64_json: "AA==" }] }; } } as unknown as Parameters<typeof requestGeneration>[2]);
        expect(seen[0].body).toMatchObject({ model: "gpt-image-2-lite", n: 4 });
        expect(new URL(seen[0].url).searchParams.get("group")).toBe("lite-only");
    });
});
