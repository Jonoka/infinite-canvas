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


const generationBodyWithoutAsync = __test__.buildGenerationRequestBody({ quality: "auto", size: "1:1", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(Object.prototype.hasOwnProperty.call(generationBodyWithoutAsync, "async"), false, "async should be omitted when switch is off");

const generationBodyWithAsync = __test__.buildGenerationRequestBody({ quality: "auto", size: "1:1", count: "1", imageAsync: "true", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(generationBodyWithAsync.async, true, "async should be true when switch is on");

const generationBodyWithNewApiGptImage = __test__.buildGenerationRequestBody({ apiMode: "newapi", quality: "high", size: "3840x2160", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(generationBodyWithNewApiGptImage.async, true, "newapi gpt-image requests should use async automatically to avoid long sync response disconnects");

const editFormWithoutAsync = __test__.buildEditFormData({ quality: "auto", size: "1:1", count: "1", imageAsync: "false", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(editFormWithoutAsync.has("async"), false, "edit async should be omitted when switch is off");

const editFormWithAsync = __test__.buildEditFormData({ quality: "auto", size: "1:1", count: "1", imageAsync: "true", model: "gpt-image-2", systemPrompt: "" } as never, "prompt");
assert.equal(editFormWithAsync.get("async"), "true", "edit async should be true when switch is on");
