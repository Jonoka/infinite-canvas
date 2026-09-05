import assert from "node:assert/strict";
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import { defaultConfig } from "@/stores/use-config-store";
import { ImageRequestError, isLitePoolExhaustedError } from "@/lib/lite-pro-fallback";
import { __test__, ImageTaskFailedError, ImageTaskWaitError, recoverImageTask, requestGeneration } from "./image";

const queued = {
    id: "task_1",
    task_id: "task_1",
    status: "queued",
    object: "image.generation.task",
};

const succeeded = {
    id: "task_1",
    task_id: "task_1",
    status: "succeeded",
    data: [{ url: "https://example.com/result.png" }],
};

assert.throws(() => __test__.parseImagePayload(queued), /尚未完成/, "queued task should not be treated as a completed image");
assert.deepEqual(__test__.parseImagePayload(succeeded)[0].dataUrl, "https://example.com/result.png");

const canvasSucceeded = {
    task_id: "task_canvas_1",
    status: "SUCCESS",
    progress: "100%",
    result: {
        created: 1784299951,
        data: [{ url: "/canvas/v1/images/tasks/task_canvas_1/content/0" }],
    },
};
assert.equal(__test__.parseImagePayload(canvasSucceeded as never)[0].dataUrl, "/canvas/v1/images/tasks/task_canvas_1/content/0", "New API Canvas task results wrap image items under result.data");

assert.equal(__test__.imageTaskPath("task/with spaces"), "/images/tasks/task%2Fwith%20spaces");
assert.equal(__test__.imageTaskContentPath("task/with spaces", 2), "/images/tasks/task%2Fwith%20spaces/content/2");
assert.equal(__test__.imageTaskStatusPath("succeeded"), "content", "completed tasks should fetch their existing content");
assert.equal(__test__.imageTaskStatusPath("running"), "pending", "running tasks should not fetch content yet");
assert.equal(__test__.imageTaskStatusPath("failed"), "failed", "failed tasks should preserve the upstream failure");
assert.equal(__test__.imageTaskStatusPath(""), "malformed", "missing task status must not be treated as pending");
assert.equal(__test__.imageTaskStatusPath("mystery"), "malformed", "unknown task status must not be treated as pending");
assert.deepEqual(__test__.imageTaskAcceptance({ apiMode: "newapi", model: "gpt-image-2", group: "vip" } as never, "task-1"), { id: "task-1", contentIndex: 0, model: "gpt-image-2", group: "vip", recoverable: true });
assert.equal(__test__.imageTaskAcceptance({ apiMode: "direct", model: "gpt-image-2", group: "" } as never, "task-1").recoverable, false, "direct async tasks must not claim the New API recovery contract");
assert.throws(() => __test__.unwrapImageTaskStatus({ code: 500, msg: "upstream failed", data: { id: "task-1", status: "running" } } as never), /upstream failed/);
assert.throws(() => __test__.unwrapImageTaskStatus({ code: 0, data: { id: "task-1" } } as never), /状态无效/);
assert.equal(__test__.unwrapImageTaskStatus({ code: 0, data: { id: "task-1", status: "succeeded" } } as never).status, "succeeded");
assert.throws(() => __test__.validateImageTaskContent(new Blob([], { type: "image/png" })), /空文件/);
assert.throws(() => __test__.validateImageTaskContent(new Blob(["error"], { type: "application/json" })), /不是图片/);
assert.doesNotThrow(() => __test__.validateImageTaskContent(new Blob(["image"], { type: "image/png" })));

const generationBodyWithoutAsync = __test__.buildGenerationRequestBody({ quality: "auto", size: "1:1", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(Object.prototype.hasOwnProperty.call(generationBodyWithoutAsync, "async"), false, "async should be omitted when switch is off");

const generationBodyWithAsync = __test__.buildGenerationRequestBody({ quality: "auto", size: "1:1", count: "1", imageAsync: "true", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(generationBodyWithAsync.async, true, "async should be true when switch is on");

const generationBodyWithNewApiGptImage = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality: "high", size: "3840x2160", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(generationBodyWithNewApiGptImage.async, true, "newapi gpt-image requests should use async automatically to avoid long sync response disconnects");
assert.equal(generationBodyWithNewApiGptImage.response_format, "url", "legacy/lite New API image requests can keep lightweight URL responses");

const generationBodyWithNewApiGptImagePro = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality: "high", size: "3840x2160", count: "1", imageAsync: "false", model: "gpt-image-2-pro", systemPrompt: "" } as never, "prompt");
assert.equal(generationBodyWithNewApiGptImagePro.response_format, "b64_json", "Pro must request base64 because its upstream can return loopback-only HTTP URLs");

const expectedGptImageSizes = {
    auto: {
        "1:1": "1024x1024",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
        "4:3": "1152x864",
        "3:4": "864x1152",
        "5:4": "1120x896",
        "4:5": "896x1120",
        "16:9": "1280x720",
        "9:16": "720x1280",
        "21:9": "1456x624",
    },
    low: {
        "1:1": "1024x1024",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
        "4:3": "1152x864",
        "3:4": "864x1152",
        "5:4": "1120x896",
        "4:5": "896x1120",
        "16:9": "1280x720",
        "9:16": "720x1280",
        "21:9": "1456x624",
    },
    medium: {
        "1:1": "2048x2048",
        "3:2": "2496x1664",
        "2:3": "1664x2496",
        "4:3": "2304x1728",
        "3:4": "1728x2304",
        "5:4": "2240x1792",
        "4:5": "1792x2240",
        "16:9": "2560x1440",
        "9:16": "1440x2560",
        "21:9": "3024x1296",
    },
    high: {
        "1:1": "2880x2880",
        "3:2": "3504x2336",
        "2:3": "2336x3504",
        "4:3": "3264x2448",
        "3:4": "2448x3264",
        "5:4": "3200x2560",
        "4:5": "2560x3200",
        "16:9": "3840x2160",
        "9:16": "2160x3840",
        "21:9": "3840x1648",
    },
};

for (const [quality, sizes] of Object.entries(expectedGptImageSizes)) {
    for (const [ratio, size] of Object.entries(sizes)) {
        const body = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality, size: ratio, count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
        assert.equal(body.size, size, `gpt-image ${quality} ${ratio} should map to ${size}`);
        const form = __test__.buildEditFormData({ apiMode: "newapi", quality, size: ratio, count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
        assert.equal(form.get("size"), size, `gpt-image edit ${quality} ${ratio} should map to ${size}`);
    }
}

const nonGptImageBody = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality: "low", size: "4:3", count: "1", imageAsync: "false", model: "other-image-model", systemPrompt: "" } as never, "prompt");
assert.equal(nonGptImageBody.size, "1168x880", "non gpt-image models should keep the existing ratio-to-pixel behavior");

const liteBody = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality: "high", size: "9:16", count: "1", imageAsync: "false", model: "gpt-image-2-lite", systemPrompt: "" } as never, "一只猫");
assert.equal(liteBody.quality, "low", "lite should always request 1K/low quality");
assert.equal(liteBody.size, "720x1280", "lite should only use the 1K size map");
assert.equal(liteBody.prompt, "一只猫\n\n输出必须采用 9:16 竖向构图，目标宽高比严格为 9:16；实际像素可由模型决定。", "lite should add a ratio composition hint without promising exact pixels");

const repeatedLiteBody = __test__.buildGenerationRequestBody(
    { quality: "medium", size: "16:9", count: "1", imageAsync: "false", model: "gpt-image-2-lite", systemPrompt: "" } as never,
    "一只猫\n\n输出必须采用 9:16 竖向构图，目标宽高比严格为 9:16；实际像素可由模型决定。",
);
assert.equal(repeatedLiteBody.prompt, "一只猫\n\n输出必须采用 16:9 横向构图，目标宽高比严格为 16:9；实际像素可由模型决定。", "lite ratio hints should be replaced instead of accumulated");

const liteEdit = __test__.buildEditFormData({ quality: "auto", size: "4:3", count: "1", imageAsync: "false", model: "gpt-image-2-lite", systemPrompt: "系统" } as never, "调整图片");
assert.equal(liteEdit.get("quality"), "low");
assert.equal(liteEdit.get("size"), "1152x864");
assert.equal(liteEdit.get("prompt"), "系统\n\n调整图片\n\n输出必须采用 4:3 横向构图，目标宽高比严格为 4:3；实际像素可由模型决定。", "edit requests should share lite prompt behavior");

const proPortrait4k = __test__.buildGenerationRequestBody({ quality: "high", size: "9:16", count: "1", imageAsync: "false", model: "gpt-image-2-pro", systemPrompt: "" } as never, "海报");
assert.equal(proPortrait4k.quality, "high");
assert.equal(proPortrait4k.size, "2160x3840", "pro 9:16 4K should use the verified explicit size");
assert.equal(proPortrait4k.prompt, "海报", "pro should not modify the prompt");

const editFormWithoutAsync = __test__.buildEditFormData({ quality: "auto", size: "1:1", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(editFormWithoutAsync.has("async"), false, "edit async should be omitted when switch is off");

const editFormWithAsync = __test__.buildEditFormData({ quality: "auto", size: "1:1", count: "1", imageAsync: "true", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(editFormWithAsync.get("async"), "true", "edit async should be true when switch is on");

const pollingConfig = {
    ...defaultConfig,
    channels: [],
    baseUrl: "https://example.com",
    apiMode: "newapi" as const,
    apiFormat: "openai" as const,
    group: "original-group",
    model: "gpt-image-2-pro",
    imageAsync: "true",
};
const acceptedTask = { id: "task/recovery", contentIndex: 2, model: pollingConfig.model, group: "accepted-group" };

type RecordedRequest = { at: number; config: InternalAxiosRequestConfig };
function mockRequests(respond: (config: InternalAxiosRequestConfig) => unknown) {
    const requests: RecordedRequest[] = [];
    axios.defaults.adapter = (async (config) => {
        requests.push({ at: Date.now(), config });
        return { config, data: await respond(config), headers: {}, status: 200, statusText: "OK" };
    }) satisfies AxiosAdapter;
    return requests;
}

// Advance actual timer callbacks while keeping all network traffic in the Axios adapter.
async function withClock(run: () => Promise<void>) {
    const original = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, adapter: axios.defaults.adapter };
    const timers = new Map<number, { at: number; callback: () => void }>();
    let now = 0;
    let nextId = 0;
    Date.now = () => now;
    globalThis.setTimeout = ((callback: () => void, ms = 0) => {
        const id = ++nextId;
        timers.set(id, { at: now + ms, callback });
        return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
    let settled = false;
    let failure: unknown;
    const result = Promise.resolve()
        .then(run)
        .catch((error: unknown) => {
            failure = error;
        })
        .finally(() => {
            settled = true;
        });
    try {
        for (let steps = 0; !settled; steps += 1) {
            assert.ok(steps < 1000, "polling must have a finite elapsed-time budget");
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (settled) break;
            const timer = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            assert.ok(timer, "mocked request stalled without a pending timer");
            now = timer[1].at;
            timers.delete(timer[0]);
            timer[1].callback();
        }
        await result;
        if (failure) throw failure;
        assert.equal(timers.size, 0, "completed or interrupted waits must clear timers");
    } finally {
        Date.now = original.now;
        globalThis.setTimeout = original.setTimeout;
        globalThis.clearTimeout = original.clearTimeout;
        axios.defaults.adapter = original.adapter;
    }
}

await withClock(async () => {
    let polls = 0;
    let persisted = false;
    const controller = new AbortController();
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const addListener = controller.signal.addEventListener.bind(controller.signal);
    const removeListener = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "abort" && listener) listeners.add(listener);
        addListener(type, listener, options);
    };
    controller.signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type === "abort" && listener) listeners.delete(listener);
        removeListener(type, listener, options);
    };
    const requests = mockRequests((config) => {
        if (config.method === "post") return queued;
        assert.ok(persisted, "task acceptance must finish persisting before polling");
        assert.equal(listeners.size, 0, "each completed wait removes its abort listener");
        polls += 1;
        return polls === 122 ? succeeded : queued;
    });
    const images = await requestGeneration(pollingConfig, "prompt", {
        signal: controller.signal,
        onTaskAccepted: async (task) => {
            assert.equal(task.id, "task_1");
            await Promise.resolve();
            persisted = true;
        },
    });
    assert.equal(images[0].dataUrl, "https://example.com/result.png");
    assert.equal(polls, 122, "successful tasks must survive the former 120-request cutoff");
    assert.ok(Date.now() > 8 * 60 * 1000, "long-running production tasks must not hit the former early timeout");
    const statusRequests = requests.filter(({ config }) => config.method === "get");
    assert.equal(statusRequests[0].at, 2000);
    for (let index = 1; index < statusRequests.length; index += 1) {
        const previousAt = statusRequests[index - 1].at;
        const expected = previousAt < 30_000 ? 2000 : previousAt < 120_000 ? 5000 : previousAt < 600_000 ? 10_000 : 15_000;
        assert.equal(statusRequests[index].at - previousAt, expected, `tier interval after ${previousAt}ms`);
        assert.ok(statusRequests[index].config.timeout! > 0 && statusRequests[index].config.timeout! <= 30_000, "status GETs must be bounded");
    }
    assert.equal(listeners.size, 0);
});

await withClock(async () => {
    const requests = mockRequests(() => queued);
    await assert.rejects(requestGeneration(pollingConfig, "prompt"), ImageTaskWaitError);
    assert.equal(Date.now(), 30 * 60 * 1000, "pending tasks stop waiting at 30 minutes");
    assert.ok(requests.length < 200, "tiered polling must keep request volume bounded");
});

await withClock(async () => {
    let polls = 0;
    const requests = mockRequests((config) => {
        if (config.method === "post") return { ...queued, retry_after: 7 };
        polls += 1;
        if (polls === 1) return { ...queued, retry_after: "20" };
        return polls === 2 ? queued : succeeded;
    });
    await requestGeneration(pollingConfig, "prompt");
    assert.deepEqual(
        requests.map(({ at }) => at),
        [0, 7000, 27_000, 29_000],
        "each response updates or clears the server retry hint",
    );
});

await withClock(async () => {
    const requests = mockRequests(() => ({ ...queued, status: "failed", error: { message: "Lite unavailable", code: "lite_pool_exhausted" } }));
    await assert.rejects(requestGeneration(pollingConfig, "prompt"), (error: unknown) => error instanceof ImageTaskFailedError && isLitePoolExhaustedError(error));
    assert.equal(requests.length, 1, "an initially failed task must fail immediately without polling");
    assert.equal(Date.now(), 0);
});

for (const status of ["failed", "failure", "canceled", "cancelled", "expired"]) {
    await withClock(async () => {
        const requests = mockRequests((config) => (config.method === "post" ? queued : { ...queued, status }));
        await assert.rejects(requestGeneration(pollingConfig, "prompt"), ImageTaskFailedError);
        assert.equal(requests.length, 2, `terminal ${status} must stop polling`);
    });
}

await withClock(async () => {
    const content = new Blob(["image"], { type: "image/png" });
    let statusReads = 0;
    const requests = mockRequests((config) => {
        assert.equal(config.method, "get", "task recovery must never submit generation");
        const url = new URL(config.url!);
        assert.equal(url.searchParams.get("group"), acceptedTask.group);
        if (url.pathname.endsWith("/content/2")) return content;
        statusReads += 1;
        return { id: acceptedTask.id, status: statusReads === 3 ? "SUCCESS" : "running" };
    });
    assert.equal(await recoverImageTask(pollingConfig, acceptedTask, { waitForCompletion: true }), content);
    assert.equal(requests.length, 4);
    assert.equal(new URL(requests[3].config.url!).pathname, "/canvas/v1/images/tasks/task%2Frecovery/content/2");
    assert.equal(requests[3].config.timeout, 60_000, "content downloads must be bounded");
});

await withClock(async () => {
    const requests = mockRequests(() => queued);
    await assert.rejects(recoverImageTask(pollingConfig, acceptedTask), /尚未完成/);
    assert.equal(requests.length, 1, "canvas recovery keeps its existing one-shot default");
    assert.equal(Date.now(), 0);
});

await withClock(async () => {
    const requests = mockRequests(() => ({ ...queued, status: "expired" }));
    await assert.rejects(recoverImageTask(pollingConfig, acceptedTask, { waitForCompletion: true }), ImageTaskFailedError);
    assert.equal(requests.length, 1, "expired recovery must not fetch content");
});

await withClock(async () => {
    const requests = mockRequests(() => ({ ...queued, status: "SUCCESS", result_expired: true }));
    await assert.rejects(recoverImageTask(pollingConfig, acceptedTask, { waitForCompletion: true }), ImageTaskFailedError);
    assert.equal(requests.length, 1, "New API result_expired must be terminal even when task status remains SUCCESS");
});

for (const status of [404, 410]) {
    await withClock(async () => {
        const requests = mockRequests((config) => {
            if (!config.url!.includes("/content/")) return succeeded;
            throw new AxiosError("Content unavailable", "ERR_BAD_REQUEST", config, undefined, { config, data: {}, status, statusText: "Gone", headers: {} });
        });
        await assert.rejects(recoverImageTask(pollingConfig, acceptedTask, { waitForCompletion: true }), ImageTaskFailedError);
        assert.equal(requests.length, 2, "missing/expired content must be terminal without resubmission");
    });
}

await withClock(async () => {
    const requests = mockRequests(() => queued);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    await assert.rejects(requestGeneration(pollingConfig, "prompt", { signal: controller.signal }), /请求已取消/);
    assert.equal(requests.length, 1, "cancellation during a wait prevents the next status query");
    assert.equal(Date.now(), 1000);
});

await withClock(async () => {
    const requests = mockRequests(() => {
        throw new AxiosError("Network Error", "ERR_NETWORK");
    });
    await assert.rejects(recoverImageTask(pollingConfig, acceptedTask, { waitForCompletion: true }), (error: unknown) => error instanceof ImageRequestError && !(error instanceof ImageTaskFailedError));
    assert.equal(requests.length, 1, "network interruption must not trigger another generation");
});

await withClock(async () => {
    const requests = mockRequests((config) => (config.method === "post" ? queued : succeeded));
    await requestGeneration({ ...pollingConfig, apiMode: "direct", apiKey: "test-key" }, "prompt");
    assert.equal(new URL(requests[1].config.url!).pathname, "/v1/images/generations/task_1", "direct providers retain their task endpoint");
    assert.equal(requests[1].config.headers.get("Authorization"), "Bearer test-key");
});
