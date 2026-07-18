import { describe, expect, test } from "bun:test";
import { createCanvasGenerationRequestGuard, type CanvasGenerationRequestIdentity } from "./canvas-generation-request-guard";

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
};

describe("canvas image generation request guard", () => {
    test("a deferred upload from request A cannot overwrite superseding request B", async () => {
        const requests = new Map<string, CanvasGenerationRequestIdentity>();
        const project = { current: {} };
        const nodeIds = new Set(["image"]);
        const mutations: string[] = [];
        const controllerA = new AbortController();
        const tokenA = {};
        requests.set("image", { controller: controllerA, token: tokenA });
        const guardA = createCanvasGenerationRequestGuard("image", controllerA, tokenA, project.current, () => project.current, requests, (id) => nodeIds.has(id));
        const uploadA = deferred<string>();
        const completionA = uploadA.promise.then((content) => {
            if (!guardA()) return;
            mutations.push(content);
        });

        const controllerB = new AbortController();
        const tokenB = {};
        requests.set("image", { controller: controllerB, token: tokenB });
        mutations.push("B");
        uploadA.resolve("A");
        await completionA;

        expect(mutations).toEqual(["B"]);
    });

    test("a stale catch or switched project cannot mutate", () => {
        const requests = new Map<string, CanvasGenerationRequestIdentity>();
        const project = { current: {} };
        const controllerA = new AbortController();
        const tokenA = {};
        requests.set("image", { controller: controllerA, token: tokenA });
        const guardA = createCanvasGenerationRequestGuard("image", controllerA, tokenA, project.current, () => project.current, requests, () => true);
        requests.set("image", { controller: new AbortController(), token: {} });

        let errorMutation = false;
        if (guardA()) errorMutation = true;
        expect(errorMutation).toBe(false);

        requests.set("image", { controller: controllerA, token: tokenA });
        project.current = {};
        expect(guardA()).toBe(false);
    });

    test("an aborted request or removed target cannot mutate", () => {
        const requests = new Map<string, CanvasGenerationRequestIdentity>();
        const project = {};
        const nodeIds = new Set(["image"]);
        const controller = new AbortController();
        const token = {};
        requests.set("image", { controller, token });
        const guard = createCanvasGenerationRequestGuard("image", controller, token, project, () => project, requests, (id) => nodeIds.has(id));

        nodeIds.delete("image");
        expect(guard()).toBe(false);
        nodeIds.add("image");
        controller.abort();
        expect(guard()).toBe(false);
    });
});
