import assert from "node:assert/strict";

import { canvasImageRetryAction, canceledGenerationMetadata, clearImageTaskMetadata, fitRecoveredImageNode, interruptedGenerationError } from "./canvas-image-task-recovery";
import { CanvasNodeType, type CanvasNodeData } from "../types";

const failedImage = {
    id: "image-1",
    type: CanvasNodeType.Image,
    title: "image",
    position: { x: 0, y: 0 },
    width: 320,
    height: 320,
    metadata: { status: "error", imageTaskId: "task-1", imageTaskContentIndex: 0, imageTaskModel: "gpt-image-2", imageTaskGroup: "vip", imageTaskRecoverable: true },
} satisfies CanvasNodeData;

assert.equal(canvasImageRetryAction(failedImage), "recover");
assert.equal(canvasImageRetryAction({ ...failedImage, metadata: { ...failedImage.metadata, status: "success" } }), "regenerate", "only failed images should offer recovery");
assert.equal(canvasImageRetryAction({ ...failedImage, metadata: { ...failedImage.metadata, imageTaskId: undefined } }), "regenerate", "a task ID is required for recovery");
assert.equal(canvasImageRetryAction({ ...failedImage, metadata: { ...failedImage.metadata, imageTaskRecoverable: false } }), "regenerate", "direct-mode tasks must not be exposed as recoverable");
assert.equal(canvasImageRetryAction({ ...failedImage, type: CanvasNodeType.Video }), "regenerate", "non-image retries keep their existing behavior");

assert.match(interruptedGenerationError(failedImage), /已有任务/);
assert.match(interruptedGenerationError({ ...failedImage, metadata: { status: "loading" } }), /重新生成/);
assert.equal(canceledGenerationMetadata(failedImage.metadata!).status, "error", "accepted recoverable tasks remain failed/recoverable after cancellation");
assert.equal(canceledGenerationMetadata({ status: "loading" }).status, "idle", "requests without an accepted recoverable task keep the existing idle cancellation state");
const cleared = clearImageTaskMetadata(failedImage.metadata!);
assert.equal(cleared.imageTaskId, undefined, "a genuinely new submission must not retain an older task ID");
assert.equal(cleared.imageTaskRecoverable, undefined, "a genuinely new submission must not retain old recovery eligibility");
assert.equal(cleared.status, "error", "clearing task metadata must preserve unrelated node metadata");

const recovered = fitRecoveredImageNode(failedImage, 800, 400);
assert.deepEqual(recovered.position, { x: 0, y: 80 }, "recovery should preserve the node center");
assert.deepEqual({ width: recovered.width, height: recovered.height }, { width: 320, height: 160 }, "recovery should fit inside the node's current bounds");