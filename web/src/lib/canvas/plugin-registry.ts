import { APP_VERSION, PLUGIN_REGISTRY_URL } from "@/constant/env";

export const OFFICIAL_REGISTRY_ID = "infinite-canvas-official";
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1;
export const PLUGIN_PERMISSIONS = ["ai"] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];
export type PluginDependency = { bundled: true } | { url: string; sha256: string };
export type PluginCsp = { connectSrc: string[]; imageSrc: string[]; frameSrc: string[] };

export type PluginManifest = {
    schemaVersion: 1;
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    host: { minVersion: string; maxVersion?: string };
    entry: string;
    sha256: string;
    nodeTypes: string[];
    permissions: PluginPermission[];
    dependencies: PluginDependency[];
    csp: PluginCsp;
};

export type OfficialPluginEntry = PluginManifest & {
    registryId: typeof OFFICIAL_REGISTRY_ID;
    registryUrl: string;
    url: string;
    sourceDomain: string;
};

type RegistryEnvelope = { schemaVersion?: unknown; registryId?: unknown; plugins?: unknown };
const SHA256 = /^[0-9a-f]{64}$/;
const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("插件清单必须是对象");
    return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`插件清单字段 ${field} 无效`);
    return value.trim();
}

function stringArray(value: unknown, field: string) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`插件清单字段 ${field} 无效`);
    return value.map((item) => (item as string).trim());
}

function semver(value: string, field: string) {
    const match = SEMVER.exec(value);
    if (!match) throw new Error(`插件清单字段 ${field} 不是有效版本`);
    return match.slice(1, 4).map(Number) as [number, number, number];
}

function compareVersions(a: string, b: string) {
    const left = semver(a, "version");
    const right = semver(b, "version");
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

function parseCsp(value: unknown): PluginCsp {
    const csp = record(value);
    const allowed = new Set(["connectSrc", "imageSrc", "frameSrc"]);
    if (Object.keys(csp).some((key) => !allowed.has(key))) throw new Error("插件声明了不支持的 CSP 指令");
    const parseSources = (field: keyof PluginCsp) => {
        const sources = stringArray(csp[field], `csp.${field}`);
        if (sources.includes("'none'") && sources.length !== 1) throw new Error(`插件 CSP ${field} 中 'none' 不能与其他来源并用`);
        for (const source of sources) {
            if (["'none'", "'self'", "data:", "blob:"].includes(source)) continue;
            const url = new URL(source);
            if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`插件 CSP 来源无效: ${source}`);
        }
        return sources;
    };
    return { connectSrc: parseSources("connectSrc"), imageSrc: parseSources("imageSrc"), frameSrc: parseSources("frameSrc") };
}

function parseDependencies(value: unknown): PluginDependency[] {
    if (!Array.isArray(value)) throw new Error("插件清单字段 dependencies 无效");
    return value.map((item) => {
        const dependency = record(item);
        if (dependency.bundled === true && Object.keys(dependency).length === 1) return { bundled: true };
        const url = requiredString(dependency.url, "dependencies.url");
        const sha256 = requiredString(dependency.sha256, "dependencies.sha256").toLowerCase();
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !SHA256.test(sha256) || !parsed.pathname.includes(sha256)) {
            throw new Error("动态依赖必须使用 HTTPS 内容寻址 URL 和 SHA-256");
        }
        return { url, sha256 };
    });
}

export function parsePluginManifest(value: unknown, registryUrl: string, hostVersion: string = APP_VERSION): OfficialPluginEntry {
    const manifest = record(value);
    if (manifest.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) throw new Error("不支持的插件清单版本");
    const id = requiredString(manifest.id, "id");
    if (!PLUGIN_ID.test(id)) throw new Error("插件 ID 必须为 kebab-case");
    const version = requiredString(manifest.version, "version");
    semver(version, "version");
    const host = record(manifest.host);
    const minVersion = requiredString(host.minVersion, "host.minVersion");
    const maxVersion = host.maxVersion === undefined ? undefined : requiredString(host.maxVersion, "host.maxVersion");
    if (hostVersion !== "dev" && compareVersions(hostVersion, minVersion) < 0) throw new Error(`插件要求宿主版本 >= ${minVersion}`);
    if (hostVersion !== "dev" && maxVersion && compareVersions(hostVersion, maxVersion) > 0) throw new Error(`插件仅支持宿主版本 <= ${maxVersion}`);

    const sha256 = requiredString(manifest.sha256, "sha256").toLowerCase();
    if (!SHA256.test(sha256)) throw new Error("插件 SHA-256 无效");
    const entry = requiredString(manifest.entry, "entry");
    const url = new URL(entry, registryUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.includes(sha256)) throw new Error("插件 bundle URL 必须为 HTTPS 内容寻址地址");

    const nodeTypes = stringArray(manifest.nodeTypes, "nodeTypes");
    if (!nodeTypes.length || new Set(nodeTypes).size !== nodeTypes.length || nodeTypes.some((type) => !type.startsWith(`${id}:`) || type.length === id.length + 1)) {
        throw new Error(`插件节点类型必须唯一且使用 ${id}: 命名空间`);
    }
    const permissions = stringArray(manifest.permissions, "permissions");
    if (new Set(permissions).size !== permissions.length || permissions.some((permission) => !(PLUGIN_PERMISSIONS as readonly string[]).includes(permission))) throw new Error("插件声明了未知权限");

    return {
        schemaVersion: 1,
        id,
        name: requiredString(manifest.name, "name"),
        version,
        description: typeof manifest.description === "string" ? manifest.description : undefined,
        icon: typeof manifest.icon === "string" ? manifest.icon : undefined,
        host: { minVersion, ...(maxVersion ? { maxVersion } : {}) },
        entry,
        sha256,
        nodeTypes,
        permissions: permissions as PluginPermission[],
        dependencies: parseDependencies(manifest.dependencies),
        csp: parseCsp(manifest.csp),
        registryId: OFFICIAL_REGISTRY_ID,
        registryUrl,
        url: url.toString(),
        sourceDomain: url.hostname,
    };
}

export function assertOfficialRegistryUrl(registryUrl: string) {
    const expected = new URL(PLUGIN_REGISTRY_URL);
    const actual = new URL(registryUrl);
    if (actual.protocol !== "https:" || actual.username || actual.password || actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search || actual.hash) {
        throw new Error("插件注册表不在官方 allowlist 中");
    }
}

export async function fetchOfficialPlugins(registryUrl: string = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    assertOfficialRegistryUrl(registryUrl);
    const response = await fetch(registryUrl, { headers: { accept: "application/json" }, credentials: "omit" });
    if (!response.ok) throw new Error(`获取官方插件列表失败 (HTTP ${response.status})`);
    const data = (await response.json()) as RegistryEnvelope;
    if (data.schemaVersion !== 1 || data.registryId !== OFFICIAL_REGISTRY_ID || !Array.isArray(data.plugins)) throw new Error("官方插件注册表身份或结构无效");
    const plugins = data.plugins.map((plugin) => parsePluginManifest(plugin, registryUrl));
    if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) throw new Error("官方插件注册表包含重复 ID");
    return plugins;
}

export function hasUpgrade(installedVersion: string, remoteVersion: string): boolean {
    return compareVersions(remoteVersion, installedVersion) > 0;
}
