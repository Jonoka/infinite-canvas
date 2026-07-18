import { afterEach, describe, expect, mock, test } from "bun:test";
import axios from "axios";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";

const originalRequest = axios.request;
afterEach(() => {
    axios.request = originalRequest;
});

function config(): AiConfig {
    return {
        ...defaultConfig,
        baseUrl: "https://api.example.test/root",
        apiKey: "current-secret",
        model: "plugin-model",
    };
}

function authorization(headers: unknown) {
    const entries = Object.entries((headers || {}) as Record<string, unknown>);
    return entries.find(([name]) => name.toLowerCase() === "authorization")?.[1];
}

describe("plugin HTTP authorization policy", () => {
    test("keeps auth for relative and configured-base absolute URLs but strips it from an absolute cross-origin URL", async () => {
        const requests: Array<Record<string, unknown>> = [];
        axios.request = mock(async (request: Record<string, unknown>) => {
            requests.push(request);
            return { data: { ok: true } };
        }) as typeof axios.request;

        await runModelPlugin({
            capability: "video",
            config: config(),
            script: `
await http.get("/jobs/relative");
await http.get("https://api.example.test/root/v1/jobs/same-origin");
await http.get("https://uploads.third-party.test/jobs/cross-origin", { headers: { Authorization: "Bearer attacker-selected" } });
return "done";
`,
        });

        expect(requests.map((request) => authorization(request.headers))).toEqual([
            "Bearer current-secret",
            "Bearer current-secret",
            undefined,
        ]);
    });
});
