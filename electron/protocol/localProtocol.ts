import { nativeImage, net, protocol } from "electron";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { contentTypeFromPath } from "../assets/assetPaths";
import {
  cachedLocalAssetThumbnail,
  parseLocalAssetThumbnailSize,
} from "../assets/localAssetThumbnail";
import { resolveProjectRelativePath } from "../projects/repository";

function withLocalAssetHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  next.set("Access-Control-Allow-Origin", "*");
  next.set("Cross-Origin-Resource-Policy", "cross-origin");
  next.set("Accept-Ranges", "bytes");
  return next;
}

export function parseLocalAssetUrl(rawUrl: string): { projectId: string; filePath: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "nomi-local:" || url.hostname !== "asset") return null;
  const segments = url.pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const [projectId, ...relativeParts] = segments;
  if (!projectId) return null;
  try {
    const filePath = resolveProjectRelativePath(projectId, relativeParts.join("/"));
    return filePath ? { projectId, filePath } : null;
  } catch {
    return null;
  }
}

type ByteRange = { start: number; end: number };

function parseRangeHeader(rangeHeader: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || size <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function streamRange(filePath: string, range: ByteRange, size: number, method: string): Response {
  const contentLength = range.end - range.start + 1;
  const headers = withLocalAssetHeaders({
    "Content-Type": contentTypeFromPath(filePath),
    "Content-Length": String(contentLength),
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
  });
  const body = method === "HEAD" ? null : fs.createReadStream(filePath, { start: range.start, end: range.end });
  return new Response(body as BodyInit | null, { status: 206, headers });
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: withLocalAssetHeaders({ "Content-Range": `bytes */${size}` }),
  });
}

async function thumbnailResponse(url: URL, filePath: string, method: string): Promise<Response | null> {
  const thumbnailSize = parseLocalAssetThumbnailSize(url);
  if (!thumbnailSize) return null;
  const stat = await fs.promises.stat(filePath);
  const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}:${thumbnailSize.width}x${thumbnailSize.height}`;
  const thumbnail = await cachedLocalAssetThumbnail(cacheKey, async () => {
    const image = await nativeImage.createThumbnailFromPath(filePath, thumbnailSize);
    return image.isEmpty() ? null : image.toJPEG(78);
  });
  if (!thumbnail) return null;
  const body = method === "HEAD"
    ? null
    : thumbnail.buffer.slice(
        thumbnail.byteOffset,
        thumbnail.byteOffset + thumbnail.byteLength,
      ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: withLocalAssetHeaders({
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(thumbnail.byteLength),
      "Content-Type": "image/jpeg",
    }),
  });
}

export async function handleNomiLocalRequest(request: Request): Promise<Response> {
  try {
    const parsed = parseLocalAssetUrl(request.url);
    if (!parsed) return new Response("Unsupported nomi-local host", { status: 404 });
    const thumbnail = await thumbnailResponse(new URL(request.url), parsed.filePath, request.method);
    if (thumbnail) return thumbnail;
    const rangeHeader = request.headers.get("range") || "";
    if (rangeHeader) {
      const stat = fs.statSync(parsed.filePath);
      const range = parseRangeHeader(rangeHeader, stat.size);
      if (!range) return rangeNotSatisfiable(stat.size);
      return streamRange(parsed.filePath, range, stat.size, request.method);
    }
    const fileResponse = await net.fetch(pathToFileURL(parsed.filePath).toString());
    return new Response(request.method === "HEAD" ? null : fileResponse.body, {
      status: fileResponse.status,
      headers: withLocalAssetHeaders(fileResponse.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "local asset not found";
    return new Response(message, { status: 404 });
  }
}

export function registerLocalProtocol(): void {
  protocol.handle("nomi-local", handleNomiLocalRequest);
}
