import assert from "node:assert/strict";

import { __test__ } from "./image";

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
assert.equal(
    __test__.parseImagePayload(canvasSucceeded as never)[0].dataUrl,
    "/canvas/v1/images/tasks/task_canvas_1/content/0",
    "New API Canvas task results wrap image items under result.data",
);

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

const repeatedLiteBody = __test__.buildGenerationRequestBody({ quality: "medium", size: "16:9", count: "1", imageAsync: "false", model: "gpt-image-2-lite", systemPrompt: "" } as never, "一只猫\n\n输出必须采用 9:16 竖向构图，目标宽高比严格为 9:16；实际像素可由模型决定。");
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
