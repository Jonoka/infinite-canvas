import { describe, expect, test } from "bun:test";

type CommitCanvasVideoResultIfCurrent = <T>(input: {
    isCurrentRequest: () => boolean;
    result: T;
    commit: (result: T) => void;
}) => boolean;

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
};

describe("Canvas video stale-request commit guard", () => {
    test("a stored result from superseded request A cannot overwrite request B", async () => {
        const production = (await import("./canvas-generation-request-guard")) as Record<string, unknown>;
        const commitCanvasVideoResultIfCurrent = production.commitCanvasVideoResultIfCurrent as CommitCanvasVideoResultIfCurrent | undefined;
        expect(typeof commitCanvasVideoResultIfCurrent).toBe("function");

        let activeRequest = "A";
        let nodeContent = "loading-A";
        const storedA = deferred<{ url: string; urls: string[] }>();
        const completionA = storedA.promise.then((result) =>
            commitCanvasVideoResultIfCurrent!({
                isCurrentRequest: () => activeRequest === "A",
                result,
                commit: (video) => {
                    nodeContent = video.url;
                },
            }),
        );

        activeRequest = "B";
        nodeContent = "video:B";
        storedA.resolve({ url: "video:A", urls: ["video:A", "video:A-alternate"] });

        expect(await completionA).toBe(false);
        expect(nodeContent).toBe("video:B");
    });
});
