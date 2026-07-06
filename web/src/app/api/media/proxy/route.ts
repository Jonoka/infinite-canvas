import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const ALLOWED_PROTOCOLS = new Set(["https:"]);
const CANVAS_IMAGE_CONTENT_PATH = /^\/canvas\/v1\/images\/tasks\/[^/]+\/content\/\d+$/;
const DEFAULT_CANVAS_API_BASE_URL = "https://api.jo2api.com";

export async function GET(request: NextRequest) {
    const rawUrl = request.nextUrl.searchParams.get("url") || "";
    const resolved = resolveMediaProxyUrl(rawUrl);
    if (!resolved.ok) return Response.json({ code: 1, data: null, msg: resolved.message }, { status: 400 });
    const url = resolved.url;

    try {
        const upstream = await fetch(url.toString(), {
            headers: mediaProxyHeaders(request),
            signal: AbortSignal.timeout(45_000),
            redirect: "follow",
        });
        if (!upstream.ok) return Response.json({ code: 1, data: null, msg: `图片下载失败：${upstream.status}` }, { status: 502 });

        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        if (!contentType.startsWith("image/")) return Response.json({ code: 1, data: null, msg: "目标地址不是图片" }, { status: 400 });

        const contentLength = Number(upstream.headers.get("content-length") || 0);
        if (contentLength > MAX_IMAGE_BYTES) return Response.json({ code: 1, data: null, msg: "图片过大" }, { status: 413 });

        const buffer = await upstream.arrayBuffer();
        if (buffer.byteLength > MAX_IMAGE_BYTES) return Response.json({ code: 1, data: null, msg: "图片过大" }, { status: 413 });

        return new Response(buffer, {
            status: 200,
            headers: {
                "content-type": contentType,
                "cache-control": "no-store",
            },
        });
    } catch (error) {
        console.error("Failed to proxy image", url.hostname, error);
        return Response.json({ code: 1, data: null, msg: "图片下载失败" }, { status: 502 });
    }
}

function resolveMediaProxyUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; message: string } {
    if (CANVAS_IMAGE_CONTENT_PATH.test(rawUrl)) {
        return { ok: true, url: new URL(rawUrl, canvasApiBaseUrl()) };
    }

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, message: "图片地址无效" };
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        return { ok: false, message: "只支持 HTTPS 图片地址" };
    }
    return { ok: true, url };
}

function canvasApiBaseUrl() {
    return (process.env.CANVAS_IMAGE_PROXY_BASE_URL || process.env.PUBLIC_BASE_URL || DEFAULT_CANVAS_API_BASE_URL).replace(/\/+$/, "");
}

function mediaProxyHeaders(request: NextRequest) {
    const headers = new Headers({ "User-Agent": "infinite-canvas-media-proxy/1.0" });
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    return headers;
}
