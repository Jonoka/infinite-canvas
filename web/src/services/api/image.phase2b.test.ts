import { describe, expect, test } from "bun:test";

import * as imageApi from "./image";
import type { AiConfig } from "@/stores/use-config-store";

type AcceptedTask = {
    taskId: string;
    contentIndex: number;
    apiMode: "newapi" | "direct";
    model: string;
    group: string;
    channelId: string;
    baseUrl: string;
    recoverable: boolean;
};
type TaskContext = Omit<AcceptedTask, "taskId" | "contentIndex" | "recoverable"> & { kind: "generation" | "edit" };
type ImageTaskHooks = {
    extractAcceptedImageTask: (payload: unknown, context: TaskContext) => AcceptedTask;
    notifyAcceptedImageTask: (payload: unknown, context: TaskContext, onAccepted: (metadata: AcceptedTask) => void | Promise<void>) => Promise<void>;
    classifyImageTaskStatus: (status: unknown, apiMode: "newapi" | "direct") => "success" | "pending" | "failure";
    unwrapImageTaskStatus: (payload: unknown) => Record<string, unknown>;
    parseCompletedImageTask: (payload: unknown) => Array<{ dataUrl: string }>;
    buildImageTaskStatusPath: (apiMode: "newapi" | "direct", kind: "generation" | "edit", taskId: string) => string;
    buildImageTaskContentPath: (taskId: string, contentIndex: number) => string;
    validateImageTaskContent: (input: { status: number; contentType: string | null; blob: Blob }) => Blob;
    upstreamImageTaskError: (payload: unknown, fallback: string) => Error & { code?: string | number };
    buildImageContentFetchRequest: (config: AiConfig, contentUrl: string) => { url: string; options: RequestInit };
    resolveSubmittedImageTask: (input: {
        submittedPayload: unknown;
        config: AiConfig;
        kind: "generation" | "edit";
        onAccepted: (metadata: AcceptedTask) => void | Promise<void>;
        poll: (input: { taskId: string; timeoutMs: number; signal: AbortSignal }) => unknown | Promise<unknown>;
        pollTimeoutMs: number;
    }) => Promise<unknown>;
    pollImageTask: (input: {
        taskId: string;
        timeoutMs: number;
        transport: (input: { taskId: string; timeoutMs: number; signal: AbortSignal }) => unknown | Promise<unknown>;
        setTimer: (callback: () => void, delayMs: number) => unknown;
        clearTimer: (timer: unknown) => void;
    }) => Promise<unknown>;
    recoverImageTask: (input: {
        config: AiConfig;
        taskId: string;
        contentIndex: number;
        resolveStatus: (input: { config: AiConfig; taskId: string }) => unknown | Promise<unknown>;
        resolveContent: (input: { config: AiConfig; contentUrl: string }) => Promise<{ status: number; contentType: string | null; blob: Blob }>;
    }) => Promise<Blob>;
};

const hooks = (imageApi as typeof imageApi & { __test__?: Partial<ImageTaskHooks> }).__test__;

function hook<K extends keyof ImageTaskHooks>(name: K): ImageTaskHooks[K] {
    const value = hooks?.[name];
    expect(typeof value, `Phase 2B requires image.ts __test__.${name} as a pure protocol seam`).toBe("function");
    return value as ImageTaskHooks[K];
}

function context(overrides: Partial<TaskContext> = {}): TaskContext {
    return {
        apiMode: "newapi", model: "resolved-image-model", group: "paid-group", kind: "generation",
        channelId: "resolved-channel", baseUrl: "https://new-api.example.com/console/", ...overrides,
    };
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        apiMode: "newapi",
        apiFormat: "openai",
        baseUrl: "https://new-api.example.com/console/",
        apiKey: "must-not-leak",
        group: "paid-group",
        channels: [{
            id: "resolved-channel", name: "Resolved", baseUrl: "https://new-api.example.com/console/", apiKey: "must-not-leak",
            apiMode: "newapi", apiFormat: "openai", group: "paid-group", models: [{ name: "resolved-image-model", capability: "image" }],
        }],
        model: "resolved-image-model",
        imageModel: "resolved-image-model",
        quality: "auto",
        size: "1:1",
        count: "1",
        systemPrompt: "",
        ...overrides,
    } as AiConfig;
}

describe("Phase 2B image task acceptance protocol", () => {
    test.each<[unknown, string]>([
        [{ task_id: "task-top" }, "task-top"],
        [{ id: "task-id-alias" }, "task-id-alias"],
        [{ code: 0, data: { task_id: "task-envelope" } }, "task-envelope"],
        [{ code: 0, data: { id: "task-envelope-id" } }, "task-envelope-id"],
    ])("extracts accepted task aliases from %#", (payload, taskId) => {
        expect(hook("extractAcceptedImageTask")(payload, context())).toEqual({
            taskId,
            contentIndex: 0,
            apiMode: "newapi",
            model: "resolved-image-model",
            group: "paid-group",
            channelId: "resolved-channel",
            baseUrl: "https://new-api.example.com/console",
            recoverable: true,
        });
    });

    test.each<[string, unknown]>([
        ["missing ID", {}],
        ["null ID", { task_id: null }],
        ["non-string ID", { task_id: 42 }],
        ["empty ID", { task_id: "" }],
        ["blank ID", { task_id: "   " }],
        ["missing enveloped ID", { code: 0, data: {} }],
    ])("rejects an accepted task with %s", (_reason, payload) => {
        expect(() => hook("extractAcceptedImageTask")(payload, context())).toThrow(/task|id|任务/i);
    });

    test.each<[string, unknown]>([
        ["numeric error code", { code: 500, msg: "upstream failed", data: { task_id: "must-not-accept" } }],
        ["string error code", { code: "TASK_REJECTED", msg: "rejected", data: { task_id: "must-not-accept" } }],
    ])("rejects a nonzero/error acceptance envelope: %s", (_reason, payload) => {
        expect(() => hook("extractAcceptedImageTask")(payload, context())).toThrow(/failed|rejected|code|失败|拒绝/i);
    });

    test.each<[string, unknown]>([
        ["absent outer code", { error: { message: "acceptance denied", code: "TASK_DENIED" }, data: { task_id: "must-not-accept" } }],
        ["zero outer code", { code: 0, error: { message: "acceptance denied", code: "TASK_DENIED" }, data: { task_id: "must-not-accept" } }],
    ])("rejects an explicit nested acceptance error even with %s", (_reason, payload) => {
        try {
            hook("extractAcceptedImageTask")(payload, context());
            throw new Error("accepted an error envelope");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toMatch(/acceptance denied/i);
            expect((error as Error & { code?: unknown }).code).toBe("TASK_DENIED");
        }
    });

    test("records actual resolved model/group and never marks a direct task recoverable", () => {
        expect(hook("extractAcceptedImageTask")({ task_id: "direct-task" }, context({ apiMode: "direct", model: "actual-model", group: "actual-group", kind: "edit" }))).toEqual({
            taskId: "direct-task",
            contentIndex: 0,
            apiMode: "direct",
            model: "actual-model",
            group: "actual-group",
            channelId: "resolved-channel",
            baseUrl: "https://new-api.example.com/console",
            recoverable: false,
        });
    });

    test("awaits the accepted-task callback with polling-ready persistence metadata", async () => {
        const events: string[] = [];
        await hook("notifyAcceptedImageTask")({ code: 0, data: { task_id: "accepted-1" } }, context(), async (metadata) => {
            events.push("callback:start");
            expect(metadata).toEqual({
                taskId: "accepted-1", contentIndex: 0, apiMode: "newapi", model: "resolved-image-model", group: "paid-group",
                channelId: "resolved-channel", baseUrl: "https://new-api.example.com/console", recoverable: true,
            });
            expect(metadata).not.toHaveProperty("apiKey");
            expect(metadata).not.toHaveProperty("cookie");
            await Promise.resolve();
            events.push("callback:end");
        }).then(() => events.push("polling-may-start"));
        expect(events).toEqual(["callback:start", "callback:end", "polling-may-start"]);
    });

    test.each(["success", "succeeded", "completed", "SUCCESS"])("classifies success alias %s", (status) => {
        expect(hook("classifyImageTaskStatus")(status, "newapi")).toBe("success");
    });

    test.each(["pending", "submitted", "not_start", "queued", "running", "processing", "in_progress"])("classifies pending alias %s", (status) => {
        expect(hook("classifyImageTaskStatus")(status, "newapi")).toBe("pending");
    });

    test.each(["failed", "failure", "cancelled", "canceled", "expired"] as const)("classifies failure alias %s", (status) => {
        expect(hook("classifyImageTaskStatus")(status, "newapi")).toBe("failure");
    });

    test.each<[unknown]>([[undefined], [null], [""], ["mystery_state"]])("rejects unknown or missing New API status %# instead of polling forever", (status) => {
        expect(() => hook("classifyImageTaskStatus")(status, "newapi")).toThrow(/status|状态/i);
    });

    test("unwraps the New API status envelope", () => {
        expect(hook("unwrapImageTaskStatus")({ code: 0, data: { id: "task-1", status: "running" } })).toEqual({ id: "task-1", status: "running" });
    });

    test.each<[string, unknown]>([
        ["nonzero code", { code: 401, msg: "unauthorized", data: { status: "completed" } }],
        ["symbolic error code", { code: "TASK_EXPIRED", msg: "expired", data: { status: "completed" } }],
    ])("rejects a New API status error envelope with %s", (_reason, payload) => {
        expect(() => hook("unwrapImageTaskStatus")(payload)).toThrow(/unauthorized|expired|code|失败|过期/i);
    });

    test.each([
        { error: { message: "status denied", code: "STATUS_DENIED" }, data: { status: "completed" } },
        { code: 0, error: { message: "status denied", code: "STATUS_DENIED" }, data: { status: "completed" } },
    ])("rejects a nested status error regardless of an absent/zero outer code", (payload) => {
        try {
            hook("unwrapImageTaskStatus")(payload);
            throw new Error("unwrapped an error envelope");
        } catch (error) {
            expect((error as Error).message).toBe("status denied");
            expect((error as Error & { code?: unknown }).code).toBe("STATUS_DENIED");
        }
    });

    test("parses result.data as the completed OpenAI image response", () => {
        expect(hook("parseCompletedImageTask")({ code: 0, data: { status: "completed", result: { data: [{ url: "https://cdn.example/result.png" }] } } })).toMatchObject([
            { dataUrl: "https://cdn.example/result.png" },
        ]);
    });

    test.each([
        { error: { message: "parse denied", code: "PARSE_DENIED" }, data: [{ url: "https://cdn.example/forbidden.png" }] },
        { code: 0, error: { message: "parse denied", code: "PARSE_DENIED" }, data: [{ url: "https://cdn.example/forbidden.png" }] },
    ])("synchronous completed-response parsing rejects a nested error envelope", (payload) => {
        try {
            hook("parseCompletedImageTask")(payload);
            throw new Error("parsed an error envelope");
        } catch (error) {
            expect((error as Error).message).toBe("parse denied");
            expect((error as Error & { code?: unknown }).code).toBe("PARSE_DENIED");
        }
    });

    test.each(["generation", "edit"] as const)("resolves a submitted %s task with actual config metadata and awaits acceptance before polling", async (kind) => {
        const actualConfig = config({
            model: `${kind}-actual-model`, imageModel: `${kind}-actual-model`, group: `${kind}-actual-group`,
            channels: [{
                id: "resolved-channel", name: "Resolved", baseUrl: "https://new-api.example.com/console/", apiKey: "must-not-leak",
                apiMode: "newapi", apiFormat: "openai", group: `${kind}-actual-group`, models: [{ name: `${kind}-actual-model`, capability: "image" }],
            }],
        });
        const events: string[] = [];
        let releaseAcceptance!: () => void;
        const acceptanceGate = new Promise<void>((resolve) => { releaseAcceptance = resolve; });

        const pending = hook("resolveSubmittedImageTask")({
            submittedPayload: { code: 0, data: { task_id: `${kind}-accepted` } },
            config: actualConfig,
            kind,
            onAccepted: async (metadata) => {
                events.push("accept:start");
                expect(metadata).toEqual({
                    taskId: `${kind}-accepted`, contentIndex: 0, apiMode: "newapi",
                    model: `${kind}-actual-model`, group: `${kind}-actual-group`, recoverable: true,
                    channelId: "resolved-channel", baseUrl: "https://new-api.example.com/console",
                });
                await acceptanceGate;
                events.push("accept:end");
            },
            pollTimeoutMs: 12_000,
            poll: ({ taskId, timeoutMs, signal }) => {
                expect(timeoutMs).toBe(12_000);
                expect(signal.aborted).toBe(false);
                events.push(`poll:${taskId}`);
                return { done: true };
            },
        });

        await Promise.resolve();
        expect(events).toEqual(["accept:start"]);
        releaseAcceptance();
        await expect(pending).resolves.toEqual({ done: true });
        expect(events).toEqual(["accept:start", "accept:end", `poll:${kind}-accepted`]);
    });

    test.each([
        { error: { message: "resolver denied", code: "RESOLVER_DENIED" }, data: { task_id: "must-not-poll" } },
        { code: 0, error: { message: "resolver denied", code: "RESOLVER_DENIED" }, data: { task_id: "must-not-poll" } },
    ])("submitted-task resolver rejects nested errors before acceptance or polling", async (submittedPayload) => {
        let touched = false;
        await expect(hook("resolveSubmittedImageTask")({
            submittedPayload, config: config(), kind: "generation", pollTimeoutMs: 1_000,
            onAccepted: () => { touched = true; },
            poll: () => { touched = true; },
        })).rejects.toMatchObject({ message: "resolver denied", code: "RESOLVER_DENIED" });
        expect(touched).toBe(false);
    });

    test("bounds a hung polling transport with an injected timer and abort signal", async () => {
        let transportTimeout = 0;
        let transportSignal: AbortSignal | undefined;
        let cleared = false;
        const pending = hook("pollImageTask")({
            taskId: "hung-task",
            timeoutMs: 2_500,
            transport: ({ timeoutMs, signal }) => {
                transportTimeout = timeoutMs;
                transportSignal = signal;
                return new Promise(() => {});
            },
            setTimer: (callback, delayMs) => {
                expect(delayMs).toBe(2_500);
                queueMicrotask(callback);
                return "fake-timer";
            },
            clearTimer: (timer) => { expect(timer).toBe("fake-timer"); cleared = true; },
        });
        await expect(pending).rejects.toThrow(/timeout|timed out|超时/i);
        expect(transportTimeout).toBe(2_500);
        expect(transportSignal?.aborted).toBe(true);
        expect(cleared).toBe(true);
    });
});

describe("Phase 2B image task routes and content validation", () => {
    test.each([
        ["newapi", "generation", "/images/tasks/a%2Fb%20%3F%23"],
        // Audited production routes retain direct async compatibility even though
        // Phase 2A defaults direct submissions to sync and marks them unrecoverable.
        ["direct", "generation", "/images/generations/a%2Fb%20%3F%23"],
        ["direct", "edit", "/images/edits/a%2Fb%20%3F%23"],
    ] as const)("uses the %s %s status route and safely encodes task IDs", (mode, kind, expected) => {
        expect(hook("buildImageTaskStatusPath")(mode, kind, "a/b ?#")).toBe(expected);
    });

    test("builds the New API binary content route with encoded ID and explicit index", () => {
        expect(hook("buildImageTaskContentPath")("id/with space", 3)).toBe("/images/tasks/id%2Fwith%20space/content/3");
    });

    test.each<[string, string]>([["empty", ""], ["blank", "   "]])("rejects a %s task ID when building task routes", (_reason, taskId) => {
        expect(() => hook("buildImageTaskStatusPath")("newapi", "generation", taskId)).toThrow(/task|id|任务/i);
        expect(() => hook("buildImageTaskContentPath")(taskId, 0)).toThrow(/task|id|任务/i);
    });

    test.each<[string, number]>([
        ["negative", -1],
        ["fractional", 1.5],
        ["NaN", Number.NaN],
    ])("rejects a %s task content index", (_reason, index) => {
        expect(() => hook("buildImageTaskContentPath")("task-1", index)).toThrow(/index|索引/i);
    });

    test("accepts only a non-empty successful image blob", () => {
        const blob = new Blob(["png"], { type: "image/png" });
        expect(hook("validateImageTaskContent")({ status: 200, contentType: "image/png", blob })).toBe(blob);
    });

    test.each<[{ status: number; contentType: string | null; blob: Blob }, RegExp]>([
        [{ status: 503, contentType: "image/png", blob: new Blob(["x"]) }, /503|状态/],
        [{ status: 200, contentType: "application/json", blob: new Blob(["{}"], { type: "application/json" }) }, /mime|image|图片/i],
        [{ status: 200, contentType: null, blob: new Blob(["x"]) }, /mime|content-type|图片/i],
        [{ status: 200, contentType: "image/png", blob: new Blob([]) }, /empty|空|内容/i],
    ])("rejects invalid task content %#", (input, message) => {
        expect(() => hook("validateImageTaskContent")(input)).toThrow(message);
    });

    test("preserves a structured upstream error code for recovery decisions and diagnostics", () => {
        const error = hook("upstreamImageTaskError")({ code: "TASK_EXPIRED", msg: "成品已过期" }, "读取任务失败");
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("成品已过期");
        expect(error.code).toBe("TASK_EXPIRED");
    });

    test("canonical recovery resolver validates status, content URL, HTTP/MIME, and blob through one seam", async () => {
        const image = new Blob(["png"], { type: "image/png" });
        const actualConfig = config();
        const calls: string[] = [];
        await expect(hook("recoverImageTask")({
            config: actualConfig,
            taskId: "recover/1",
            contentIndex: 2,
            resolveStatus: ({ config: used, taskId }) => {
                expect(used).toBe(actualConfig);
                calls.push(`status:${taskId}`);
                return { code: 0, data: { status: "completed", result: { data: [{ url: "/canvas/v1/images/tasks/recover%2F1/content/2" }] } } };
            },
            resolveContent: async ({ config: used, contentUrl }) => {
                expect(used).toBe(actualConfig);
                calls.push(`content:${contentUrl}`);
                return { status: 200, contentType: "image/png", blob: image };
            },
        })).resolves.toBe(image);
        expect(calls).toEqual(["status:recover/1", "content:/canvas/v1/images/tasks/recover%2F1/content/2"]);
    });

    test.each([
        { name: "status envelope", status: { code: 0, error: { message: "recovery denied", code: "RECOVERY_DENIED" }, data: { status: "completed" } }, content: { status: 200, contentType: "image/png", blob: new Blob(["x"]) } },
        { name: "content URL", status: { code: 0, data: { status: "completed", result: { data: [{ url: "javascript:alert(1)" }] } } }, content: { status: 200, contentType: "image/png", blob: new Blob(["x"]) } },
        { name: "MIME", status: { code: 0, data: { status: "completed", result: { data: [{ url: "/content" }] } } }, content: { status: 200, contentType: "application/json", blob: new Blob(["{}"]) } },
        { name: "empty blob", status: { code: 0, data: { status: "completed", result: { data: [{ url: "/content" }] } } }, content: { status: 200, contentType: "image/png", blob: new Blob([]) } },
    ])("canonical recovery rejects invalid $name instead of exposing a weak alternate transport", async ({ status, content }) => {
        await expect(hook("recoverImageTask")({
            config: config(), taskId: "recover", contentIndex: 0,
            resolveStatus: () => status,
            resolveContent: async () => content,
        })).rejects.toThrow(/recovery denied|mime|image|empty|url|protocol|scheme|空|图片|协议|地址/i);
    });
});

describe("Phase 2B task content URL and credential policy", () => {
    test("resolves relative content against the New API canvas base and includes cookie credentials", () => {
        const request = hook("buildImageContentFetchRequest")(config(), "/canvas/v1/images/tasks/task-1/content/0");
        expect(request.url).toBe("https://new-api.example.com/canvas/v1/images/tasks/task-1/content/0");
        expect(request.options.credentials).toBe("include");
        expect(new Headers(request.options.headers).has("Authorization")).toBe(false);
    });

    test("keeps a cross-origin absolute signed URL unchanged, omits credentials, and does not attach Authorization", () => {
        const signed = "https://objects.example.com/result.png?X-Signature=abc&expires=9";
        const request = hook("buildImageContentFetchRequest")(config(), signed);
        expect(request.url).toBe(signed);
        expect(request.options.credentials).toBe("omit");
        expect(new Headers(request.options.headers).has("Authorization")).toBe(false);
    });

    test.each<[string, string]>([
        ["javascript", "javascript:alert(1)"],
        ["data", "data:image/png;base64,iVBORw0KGgo="],
        ["file", "file:///tmp/result.png"],
        ["protocol-relative", "//objects.example.com/result.png?signature=abc"],
    ])("rejects an unsafe or ambiguous %s content URL", (_kind, url) => {
        expect(() => hook("buildImageContentFetchRequest")(config(), url)).toThrow(/url|scheme|protocol|协议|地址/i);
    });
});
