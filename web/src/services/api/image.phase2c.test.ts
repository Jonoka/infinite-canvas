import { describe, expect, test } from "bun:test";

import * as imageApi from "./image";
import type { AiConfig } from "@/stores/use-config-store";

type Override = { model: string; group: string; quality: string; size: string; count: string };
type Acceptance = { taskId: string; contentIndex: number; apiMode: "newapi" | "direct"; model: string; group: string; channelId: string; baseUrl: string; recoverable: boolean };
type Phase2CImageSeams = {
    resolveImageRequestConfig: (config: AiConfig, override?: Partial<Override>) => AiConfig;
    extractAcceptedImageTask: (payload: unknown, context: {
        apiMode: "newapi" | "direct"; model: string; group: string; channelId: string; baseUrl: string; kind: "generation" | "edit";
    }) => Acceptance;
};
const hooks = (imageApi as typeof imageApi & { __test__?: Partial<Phase2CImageSeams> }).__test__;

function config(): AiConfig {
    return {
        apiMode: "newapi", apiFormat: "openai", baseUrl: "https://new-api.example.com/console/", apiKey: "must-not-leak", group: "lite-only",
        channels: [{
            id: "images", name: "Images", baseUrl: "https://new-api.example.com/console/", apiKey: "must-not-leak",
            apiMode: "newapi", apiFormat: "openai", group: "lite-only",
            models: [{ name: "gpt-image-2-lite", capability: "image" }, { name: "gpt-image-2-pro", capability: "image" }],
        }],
        model: "images::gpt-image-2-lite", imageModel: "images::gpt-image-2-lite", quality: "low", size: "9:16", count: "4", systemPrompt: "",
    } as AiConfig;
}

describe("Phase 2C one-shot image request override", () => {
    test.each(["generation", "edit"] as const)("%s resolves the paid override after channel resolution without mutating selection", (kind) => {
        expect(typeof hooks?.resolveImageRequestConfig, "Phase 2C requires the real image request resolver to expose a pure override seam").toBe("function");
        const persisted = config();
        const before = structuredClone(persisted);
        const request = hooks!.resolveImageRequestConfig!(persisted, {
            model: "gpt-image-2-pro", group: "auto", quality: "low", size: "9:16", count: "1",
        });

        expect(request).toMatchObject({
            channelId: "images", apiMode: "newapi", model: "gpt-image-2-pro", group: "auto", quality: "low", size: "9:16", count: "1",
        });
        expect(persisted).toEqual(before);

        const acceptance = hooks!.extractAcceptedImageTask!({ code: 0, data: { task_id: `${kind}-pro-task` } }, {
            apiMode: request.apiMode, model: request.model, group: request.group, channelId: request.channelId!, baseUrl: request.baseUrl, kind,
        });
        expect(acceptance).toMatchObject({
            taskId: `${kind}-pro-task`, model: "gpt-image-2-pro", group: "auto", channelId: "images", recoverable: true,
        });
        expect(acceptance.model).not.toBe("gpt-image-2-lite");
        expect(acceptance.group).not.toBe("lite-only");
    });

    test("without a fresh override the next request resolves persisted Lite again (no standing consent)", () => {
        expect(typeof hooks?.resolveImageRequestConfig).toBe("function");
        const persisted = config();
        hooks!.resolveImageRequestConfig!(persisted, { model: "gpt-image-2-pro", group: "auto", count: "1" });
        expect(hooks!.resolveImageRequestConfig!(persisted)).toMatchObject({ model: "gpt-image-2-lite", group: "lite-only", count: "4" });
    });
});
