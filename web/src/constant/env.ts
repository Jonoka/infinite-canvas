export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Production is pinned to the official registry identity. Development may point
// at a locally served registry without reopening arbitrary installation in builds.
const OFFICIAL_PLUGIN_REGISTRY_URL = "https://cdn.jsdelivr.net/gh/Jonoka/infinite-canvas@plugins-dist/official-plugins.json";
export const PLUGIN_REGISTRY_URL = import.meta.env.DEV && import.meta.env.VITE_PLUGIN_REGISTRY_URL ? import.meta.env.VITE_PLUGIN_REGISTRY_URL : OFFICIAL_PLUGIN_REGISTRY_URL;
