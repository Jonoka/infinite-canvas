import assert from "node:assert/strict";

import { createGenerationLogWriter, generationLogResults, interruptGenerationResults, summarizeGenerationLog, updateGenerationResult, type GenerationLog, type GenerationResult } from "./generation-log";

const task = { id: "task-original", contentIndex: 0, model: "gpt-image-2-pro", group: "original-group", recoverable: true, baseUrl: "https://original.example/canvas", apiMode: "newapi" as const };
const image = { id: "image-1", dataUrl: "blob:local", storageKey: "image:1", durationMs: 1, width: 1, height: 1, bytes: 1 };
const log: GenerationLog = {
    id: "batch-1",
    createdAt: 1,
    title: "Test",
    prompt: "original prompt",
    time: "test",
    model: task.model,
    config: { model: task.model, imageModel: task.model, group: task.group, quality: "low", size: "1:1", count: "3", imageAsync: "true" },
    references: [],
    durationMs: 0,
    successCount: 0,
    failCount: 0,
    imageCount: 3,
    size: "1:1",
    quality: "low",
    status: "生成中",
    images: [],
    thumbnails: [],
    results: [
        { id: "slot-1", status: "pending" },
        { id: "slot-2", status: "pending" },
        { id: "slot-3", status: "pending" },
    ],
};

let batch = updateGenerationResult(log, "slot-1", { task });
batch = updateGenerationResult(batch, "slot-2", { status: "success", image });
batch = updateGenerationResult(batch, "slot-3", { status: "failed", error: "upstream rejected" });
const restored = summarizeGenerationLog(batch, interruptGenerationResults(generationLogResults(JSON.parse(JSON.stringify(batch)))));
assert.equal(restored.status, "等待查询");
assert.equal(restored.successCount, 1);
assert.equal(restored.failCount, 1, "waiting interruption is not an upstream failure");
assert.deepEqual(restored.results?.[0].task, task, "refresh retains original task and routing");
assert.equal(restored.results?.[0].status, "interrupted");
assert.equal(restored.results?.[1].image?.storageKey, image.storageKey);
assert.equal(restored.results?.[2].error, "upstream rejected");
assert.equal(updateGenerationResult(restored, "missing-slot", { status: "success", image }).successCount, 1, "late updates cannot write another slot");
assert.equal(updateGenerationResult(restored, "slot-1", { status: "success", image }).successCount, 2);
assert.deepEqual(generationLogResults({ images: [image] }), [{ id: image.id, status: "success", image }], "production image-only records remain readable");
const noTask: GenerationResult[] = [{ id: "unaccepted", status: "pending" }];
assert.equal(interruptGenerationResults(noTask)[0].status, "interrupted", "reload before acceptance must not claim backend failure");
const storageInterrupted = interruptGenerationResults(generationLogResults(log), "storage unavailable");
assert.ok(
    storageInterrupted.every((result) => result.status === "interrupted" && result.error === "storage unavailable"),
    "initial persistence failure must stop all pending cards",
);
const originalNow = Date.now;
Date.now = () => 20_000;
try {
    const pending: GenerationResult = { id: "resuming", status: "pending", task, durationMs: 6000, waitStartedAt: 10_000 };
    const interrupted = interruptGenerationResults([pending])[0];
    assert.equal(interrupted.durationMs, 16_000, "unmount and reload preserve the time spent querying");
    assert.equal(interrupted.waitStartedAt, undefined);
    assert.equal(interruptGenerationResults([interrupted])[0].durationMs, 16_000, "reload does not count an interrupted wait twice");
    const recovered = summarizeGenerationLog(log, [{ ...interrupted, status: "success", durationMs: 18_000, image: { ...image, durationMs: 18_000 } }]);
    assert.equal(recovered.durationMs, 18_000, "a recovered batch records its total waiting time");
} finally {
    Date.now = originalNow;
}

let releaseFirst: () => void = () => {};
const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
});
const persisted = new Map<string, GenerationLog>();
let writes = 0;
const write = createGenerationLogWriter(async (id, value) => {
    writes += 1;
    if (writes === 1) await firstWrite;
    if (value) persisted.set(id, value);
    else persisted.delete(id);
});
const first = write(batch.id, updateGenerationResult(log, "slot-1", { task }));
const second = write(batch.id, batch);
await Promise.resolve();
await Promise.resolve();
assert.equal(writes, 1, "concurrent completion cannot overtake an acceptance write");
let flushed = false;
const flush = write.flush().then(() => {
    flushed = true;
});
await Promise.resolve();
assert.equal(flushed, false, "remount reads wait for writes from the previous page instance");
releaseFirst();
await Promise.all([first, second, flush]);
assert.equal(flushed, true);
assert.deepEqual(persisted.get(batch.id), batch, "last persisted batch contains all slot transitions");
await Promise.all([write(batch.id, restored), write(batch.id, null)]);
assert.equal(persisted.has(batch.id), false, "deletion runs after any queued task writes");

let failOnce = true;
const flakyWriter = createGenerationLogWriter(async () => {
    if (failOnce) {
        failOnce = false;
        throw new Error("storage unavailable");
    }
});
await assert.rejects(flakyWriter(log.id, log), /storage unavailable/);
await flakyWriter(log.id, restored);

console.log("image workbench generation log assertions passed");
