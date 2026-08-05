// 官方插件集中构建:一次进程构建所有官方插件 + 生成清单,产物进 dist/(已 gitignore)。
// 官方插件目录本身不各自安装依赖:统一从本目录 node_modules 解析 SDK(nodePaths)。
// CI(publish-plugins.yml)把 dist/ 强推到 plugins-dist 分支,前端经 jsDelivr 远程拉取。
// 本地自测:`npm install && npm run build`,再把 VITE_PLUGIN_REGISTRY_URL 指向本地 dist。
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "dist");
const nodeModules = join(root, "node_modules");

// 官方插件登记表:新增官方插件在此登记即可。
// 版本不在这里写死 —— 从各插件的 package.json 读取(单一真源),
// 与插件 src 里 definePlugin({version}) 保持一致,避免清单与产物版本脱节。
const OFFICIAL = [
  {
    id: "markdown",
    dir: "markdown",
    name: "Markdown 节点",
    description: "在画布中编辑与渲染 Markdown",
    icon: "📝",
    nodeTypes: ["markdown:doc"],
    permissions: [],
  },
  {
    id: "svg",
    dir: "svg",
    name: "SVG 节点",
    description: "透明背景渲染 SVG,可接收上游文本节点的 SVG 源码",
    icon: "🔷",
    nodeTypes: ["svg:vector"],
    permissions: [],
  },
  {
    id: "html",
    dir: "html",
    name: "HTML 节点",
    description: "沙箱 iframe 渲染 HTML,支持 {{input}} 注入上游文本",
    icon: "🌐",
    nodeTypes: ["html:render"],
    permissions: [],
  },
  {
    id: "panorama",
    dir: "panorama",
    name: "3D 全景节点",
    description: "查看 360° 等距柱状全景图,可从上游图片节点取图",
    icon: "🧭",
    nodeTypes: ["panorama:viewer"],
    permissions: ["ai"],
  },
  {
    id: "sticky-note",
    dir: "sticky-note",
    name: "便利贴节点",
    description: "可自选颜色、双击编辑、拖动即可移动的便利贴",
    icon: "📌",
    nodeTypes: ["sticky-note:note"],
    permissions: [],
  },
];

// 读取插件 package.json 的 version 作为清单版本的唯一来源
async function readPluginVersion(dir) {
  const pkg = JSON.parse(
    await readFile(join(root, "..", dir, "package.json"), "utf8"),
  );
  if (!pkg.version) throw new Error(`插件 ${dir} 的 package.json 缺少 version`);
  return pkg.version;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const artifacts = new Map();
for (const plugin of OFFICIAL) {
  const temporaryPath = join(outDir, `${plugin.id}.js`);
  await build({
    entryPoints: [join(root, "..", plugin.dir, "src", "index.tsx")],
    outfile: temporaryPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    // automatic JSX → SDK 的 jsx-runtime(内部用宿主 React),react external
    jsx: "automatic",
    jsxImportSource: "@infinite-canvas/plugin-sdk",
    loader: { ".ts": "ts", ".tsx": "tsx", ".css": "text" },
    external: ["react", "react-dom"],
    minify: true,
    nodePaths: [nodeModules],
  });
  const bytes = await readFile(temporaryPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = `${sha256}.js`;
  await rename(temporaryPath, join(outDir, entry));
  artifacts.set(plugin.id, { entry, sha256 });
  console.log(`built ${entry}`);
}

const manifest = {
  // 清单结构版本;entry 为相对本清单的 bundle 文件名,由前端解析成绝对 URL
  schemaVersion: 1,
  registryId: "infinite-canvas-official",
  plugins: await Promise.all(
    OFFICIAL.map(async (plugin) => ({
      schemaVersion: 1,
      id: plugin.id,
      name: plugin.name,
      version: await readPluginVersion(plugin.dir),
      description: plugin.description,
      icon: plugin.icon,
      host: { minVersion: "0.9.0", maxVersion: "0.9.999" },
      ...artifacts.get(plugin.id),
      nodeTypes: plugin.nodeTypes,
      permissions: plugin.permissions,
      dependencies: [{ bundled: true }],
      csp: {
        connectSrc: ["'none'"],
        imageSrc: ["'self'", "data:", "blob:"],
        frameSrc: ["'none'"],
      },
    })),
  ),
};
await writeFile(
  join(outDir, "official-plugins.json"),
  JSON.stringify(manifest, null, 4) + "\n",
);
console.log(`wrote official-plugins.json (${OFFICIAL.length} plugins) → dist/`);
