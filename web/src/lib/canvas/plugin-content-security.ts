import createDOMPurify from "dompurify";

let purifier: ReturnType<typeof createDOMPurify> | null = null;

function domPurify() {
    if (typeof window === "undefined") throw new Error("插件内容净化器只能在浏览器 DOM 中运行");
    purifier ||= createDOMPurify(window);
    return purifier;
}

export function sanitizePluginMarkup(kind: "markdown" | "svg", source: string) {
    if (kind === "svg") {
        return domPurify().sanitize(source, {
            USE_PROFILES: { svg: true, svgFilters: false, html: false },
            FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed", "style"],
            FORBID_ATTR: ["style", "formaction"],
        });
    }
    return domPurify().sanitize(source, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "form"],
        FORBID_ATTR: ["style", "formaction"],
    });
}
