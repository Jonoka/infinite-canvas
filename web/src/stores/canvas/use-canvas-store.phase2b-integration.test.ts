import { describe, expect, test } from "bun:test";

import {
    canvasStorage,
    canvasStorePersistence,
    createDurableCanvasPersistence,
    flushCanvasStorePersistence,
} from "./use-canvas-store";

type Snapshot = { revision: number; nodes: string[] };

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("Phase 2B production canvas persistence wiring", () => {
    test("the Zustand storage and exported flush share the one production durable adapter", () => {
        expect(canvasStorage.persistence).toBe(canvasStorePersistence);
        expect(canvasStorage.flush).toBe(flushCanvasStorePersistence);
    });

    test("flush deterministically waits for the in-flight write and drains the newest queued snapshot", async () => {
        const first = deferred();
        const second = deferred();
        const started: Snapshot[] = [];
        const completed: number[] = [];
        let scheduled: (() => void) | undefined;
        const persistence = createDurableCanvasPersistence<Snapshot>({
            schedule: (callback) => { scheduled = callback; return "timer"; },
            cancel: (handle) => expect(handle).toBe("timer"),
            write: async (snapshot) => {
                started.push(structuredClone(snapshot));
                await (snapshot.revision === 1 ? first.promise : second.promise);
                completed.push(snapshot.revision);
            },
        });

        persistence.enqueue({ revision: 1, nodes: ["accepted-task"] });
        scheduled!();
        await tick();
        persistence.enqueue({ revision: 2, nodes: ["accepted-task", "newer-edit"] });
        let settled = false;
        const flushing = persistence.flush().then(() => { settled = true; });
        await tick();
        expect(started).toEqual([{ revision: 1, nodes: ["accepted-task"] }]);
        expect(settled).toBe(false);

        first.resolve();
        await tick();
        expect(started).toEqual([
            { revision: 1, nodes: ["accepted-task"] },
            { revision: 2, nodes: ["accepted-task", "newer-edit"] },
        ]);
        expect(completed).toEqual([1]);
        expect(settled).toBe(false);

        second.resolve();
        await flushing;
        expect(completed).toEqual([1, 2]);
    });

    test("a rejected write remains queued and a later flush retries the exact snapshot", async () => {
        const attempts: Snapshot[] = [];
        let fail = true;
        const persistence = createDurableCanvasPersistence<Snapshot>({
            schedule: () => "timer",
            cancel: () => {},
            write: async (snapshot) => {
                attempts.push(structuredClone(snapshot));
                if (fail) throw new Error("IndexedDB unavailable");
            },
        });
        const snapshot = { revision: 7, nodes: ["must-survive"] };
        persistence.enqueue(snapshot);

        await expect(persistence.flush()).rejects.toThrow("IndexedDB unavailable");
        fail = false;
        await expect(persistence.flush()).resolves.toBeUndefined();
        expect(attempts).toEqual([snapshot, snapshot]);
    });

    test("production storage round-trips recovery metadata and rehydrates a durable transformed image", async () => {
        const originalWrite = canvasStorePersistence.write;
        const originalRead = canvasStorePersistence.read;
        let durableValue: unknown;
        canvasStorePersistence.write = async (_name, value) => { durableValue = structuredClone(value); };
        canvasStorePersistence.read = async () => structuredClone(durableValue) as never;
        try {
            const stored = {
                state: { projects: [{ id: "p", nodes: [{ id: "image", metadata: {
                    content: "blob:temporary-preview", storageKey: "image:durable-key",
                    taskId: "task-1", taskContentIndex: 3, taskRecoverable: true, taskApiMode: "newapi",
                    taskModel: "model", taskGroup: "group", taskChannelId: "channel", taskBaseUrl: "https://api.example.com",
                } }] }] }, version: 0,
            };
            await canvasStorage.setItem("canvas", stored as never);
            await flushCanvasStorePersistence();
            const rehydrated = await canvasStorage.getItem("canvas") as typeof stored;
            const metadata = rehydrated.state.projects[0].nodes[0].metadata;
            expect(metadata).toMatchObject({ storageKey: "image:durable-key", taskId: "task-1", taskContentIndex: 3, taskRecoverable: true });
            expect(metadata.content).toBe("image:durable-key");
        } finally {
            canvasStorePersistence.write = originalWrite;
            canvasStorePersistence.read = originalRead;
        }
    });
});
