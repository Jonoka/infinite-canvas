import { describe, expect, test } from "bun:test";

import { runPluginActivationTransaction } from "./plugin-loader";

describe("Phase 5 transactional activation", () => {
    test("cleans staged work and restores the previous plugin when persistence fails", async () => {
        const events: string[] = [];
        await expect(
            runPluginActivationTransaction({
                activate: () => events.push("activate-next"),
                commit: () => {
                    events.push("commit");
                    throw new Error("persistence failed");
                },
                cleanup: () => events.push("cleanup-next"),
                restore: () => events.push("restore-previous"),
            }),
        ).rejects.toThrow("persistence failed");
        expect(events).toEqual(["activate-next", "commit", "cleanup-next", "restore-previous"]);
    });
});
