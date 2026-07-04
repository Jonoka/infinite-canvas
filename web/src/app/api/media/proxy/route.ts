import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const ALLOWED_PROTOCOLS = new Set(["https:"]);

export async function GET(request: NextRequest) {
    const rawUrl = request.nextUrl.searchParams.get("url") || "";
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return Response.json({ code: 1, data: null, msg: "图片地址无效" }, { status: 400 });
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        return Response.json({ code: 1, data: null, msg: "只支持 HTTPS 图片地址" }, { status: 400 });
    }

    try {
        const upstream = await fetch(url.toString(), {
            headers: { "User-Agent": "infinite-canvas-media-proxy/1.0" },
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
