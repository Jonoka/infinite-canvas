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

function headers(headers: unknown) {
    return Object.fromEntries(Object.entries((headers || {}) as Record<string, unknown>).map(([name, value]) => [name.toLowerCase(), value]));
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

        expect(headers(requests[0].headers)).toMatchObject({ authorization: "Bearer current-secret" });
        expect(headers(requests[1].headers)).toMatchObject({ authorization: "Bearer current-secret" });
        expect(headers(requests[2].headers)).not.toHaveProperty("authorization");
        expect(requests[2].withCredentials).toBe(false);
    });

    test("strips normalized API-key variants but keeps ordinary business headers cross-origin", async () => {
        const requests: Array<Record<string, unknown>> = [];
        axios.request = mock(async (request: Record<string, unknown>) => {
            requests.push(request);
            return { data: { ok: true } };
        }) as typeof axios.request;
        await runModelPlugin({ capability: "video", config: config(), script: `
await http.get("https://uploads.third-party.test/jobs/cross-origin", { headers: {
    api_key: "a", apikey: "b", "x-apikey": "c", x_api_key: "d", "x-goog-api-key": "e",
    Authorization: "f", "proxy-authorization": "g", "x-request-id": "keep"
} }); return "done";` });
        const crossOriginHeaders = headers(requests[0].headers);
        expect(crossOriginHeaders).toEqual({ "x-request-id": "keep" });
        expect(requests[0].withCredentials).toBe(false);
    });
});
