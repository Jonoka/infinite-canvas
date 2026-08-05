import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

import { capabilityFilteredAi } from "./plugin-runtime";
import { assertOfficialRegistryUrl, fetchOfficialPlugins, parsePluginManifest } from "./plugin-registry";
import { prepareOfficialPlugin } from "./plugin-loader";
import { registerNodeDefinitions, unregisterPluginNodes } from "./node-registry";
import { migratePersistedPlugins } from "@/stores/canvas/use-plugin-store";
import type { CanvasPluginAi, CanvasNodeDefinition } from "@/types/canvas-plugin";

const registryUrl = "https://cdn.jsdelivr.net/gh/Jonoka/infinite-canvas@plugins-dist/official-plugins.json";
const digest = "a".repeat(64);
const originalFetch = globalThis.fetch;
const valid = () => ({
    schemaVersion: 1,
    id: "secure-plugin",
    name: "Secure Plugin",
    version: "1.2.3",
    host: { minVersion: "0.9.0", maxVersion: "0.9.999" },
    entry: `${digest}.js`,
    sha256: digest,
    nodeTypes: ["secure-plugin:node"],
    permissions: ["ai"],
    dependencies: [{ bundled: true }],
    csp: { connectSrc: ["'none'"], imageSrc: ["data:"], frameSrc: ["'none'"] },
});

describe("Phase 5 plugin manifest gates", () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    test("accepts a complete official content-addressed manifest", () => {
        const parsed = parsePluginManifest(valid(), registryUrl, "v0.9.0");
        expect(parsed.id).toBe("secure-plugin");
        expect(parsed.url).toContain(digest);
        expect(parsed.sourceDomain).toBe("cdn.jsdelivr.net");
    });

    test.each([
        ["schema", { schemaVersion: 2 }],
        ["host version", { host: { minVersion: "1.0.0" } }],
        ["hash", { sha256: "bad" }],
        ["immutable URL", { entry: "plugin.js" }],
        ["namespace", { nodeTypes: ["other:node"] }],
        ["permission", { permissions: ["secrets"] }],
        ["dependency", { dependencies: [{ url: "https://cdn.example.test/library.js", sha256: digest }] }],
        ["CSP", { csp: { connectSrc: ["http://unsafe.test"], imageSrc: [], frameSrc: [] } }],
        ["CSP none combination", { csp: { connectSrc: ["'none'", "https://api.example.test"], imageSrc: [], frameSrc: [] } }],
    ])("rejects invalid %s declarations", (_name, patch) => {
        expect(() => parsePluginManifest({ ...valid(), ...patch }, registryUrl, "v0.9.0")).toThrow();
    });

    test("rejects non-allowlisted registry identity and registry envelopes", async () => {
        expect(() => assertOfficialRegistryUrl("https://evil.example.test/official-plugins.json")).toThrow("allowlist");
        globalThis.fetch = mock(async () => new Response(JSON.stringify({ schemaVersion: 1, registryId: "lookalike", plugins: [] }), { status: 200 }));
        await expect(fetchOfficialPlugins()).rejects.toThrow("身份");
    });

    test("checks the bundle hash before any import or execution", async () => {
        const entry = parsePluginManifest(valid(), registryUrl, "v0.9.0");
        globalThis.fetch = mock(async () => new Response("globalThis.__executed = true", { status: 200 }));
        await expect(prepareOfficialPlugin(entry)).rejects.toThrow("SHA-256");
        expect((globalThis as { __executed?: boolean }).__executed).toBeUndefined();
    });
});

describe("Phase 5 namespace and capability gates", () => {
    afterEach(() => unregisterPluginNodes("secure-plugin"));
    const definition = (type: string): CanvasNodeDefinition => ({ type, title: type, icon: "x", defaultSize: { width: 1, height: 1 } });

    test("rejects node namespace and collisions before mutation", () => {
        expect(() => registerNodeDefinitions([definition("wrong:node")], "secure-plugin")).toThrow("命名空间");
        registerNodeDefinitions([definition("builtin-owned")], "builtin");
        expect(() => registerNodeDefinitions([definition("builtin-owned")], "secure-plugin")).toThrow();
    });

    test("denies AI without permission and forwards verified identity when granted", async () => {
        const seen: unknown[] = [];
        const ai: CanvasPluginAi = {
            generateImage: mock(async (_prompt, _options, identity) => {
                seen.push(identity);
                return { images: [] };
            }),
            generateVideo: mock(async () => ({ url: "", mimeType: "video/mp4" })),
            generateText: mock(async () => ({ text: "" })),
            listModels: mock(() => []),
            defaultModel: mock(() => "model"),
        };
        const identity = { pluginId: "secure-plugin", pluginVersion: "1.2.3", registryId: "infinite-canvas-official" };
        expect(() => capabilityFilteredAi(ai, identity, []).generateImage("x")).toThrow("未获 AI 权限");
        await capabilityFilteredAi(ai, identity, ["ai"]).generateImage("x");
        expect(seen).toEqual([identity]);
    });
});

describe("Phase 5 startup and UI wiring", () => {
    test("migrates legacy records to disabled unverified audit-only records", () => {
        const migrated = migratePersistedPlugins({ plugins: [{ id: "legacy", enabled: true }] });
        expect(migrated.plugins[0]).toMatchObject({ id: "legacy", enabled: false, trust: "legacy-unverified" });
    });

    test("production manager has no arbitrary URL install path and renderers sanitize", () => {
        const manager = readFileSync(new URL("../../components/canvas/canvas-plugin-manager-modal.tsx", import.meta.url), "utf8");
        const loader = readFileSync(new URL("./plugin-loader.ts", import.meta.url), "utf8");
        const markdown = readFileSync(new URL("../../../../plugins/canvas/markdown/src/index.tsx", import.meta.url), "utf8");
        const svg = readFileSync(new URL("../../../../plugins/canvas/svg/src/index.tsx", import.meta.url), "utf8");
        expect(manager).not.toContain("installPluginFromUrl");
        expect(manager).not.toContain("输入插件 JS 文件 URL");
        expect(loader).not.toContain("export async function installPluginFromUrl");
        expect(loader).toContain('record.trust === "verified"');
        expect(markdown).toContain('sanitizeMarkup("markdown"');
        expect(svg).toContain('sanitizeMarkup("svg"');
    });
});
