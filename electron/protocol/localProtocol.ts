import { nativeImage, net, protocol } from "electron";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  cachedLocalAssetThumbnail,
  parseLocalAssetThumbnailSize,
} from "../assets/localAssetThumbnail";
import { resolveProjectRelativePath } from "../projects/repository";

function withLocalAssetHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  // canvas.toDataURL() 需要 CORS 头，否则 crossOrigin='anonymous' 加载的图片会污染画布
  // 导致九宫格/裁切等操作静默失败（SecurityError 被吞掉）。
  next.set("Access-Control-Allow-Origin", "*");
  next.set("Cross-Origin-Resource-Policy", "cross-origin");
  next.set("Accept-Ranges", "bytes");
  return next;
}

/** nomi-local://asset/... → { projectId, 磁盘绝对路径 }。协议处理与懒自愈（ensurePlayableAsset）共用。 */
export function parseLocalAssetUrl(rawUrl: string): { projectId: string; filePath: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "nomi-local:" || url.hostname !== "asset") return null;
  // 解码与 localAssetUrl 的「逐段 encodeURIComponent」对称：先按 "/" 切段、再逐段 decode。
  // （此前先整体 decode 再 split，文件名若含被编码的 %2F 会让段边界错位 → 路径错位 404。）
  const segments = url.pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
      // 解码与 localAssetUrl 的「逐段 encodeURIComponent」对称：先按 "/" 切段、再逐段 decode。
      // （此前先整体 decode 再 split，文件名若含被编码的 %2F 会让段边界错位 → 路径错位 404。）
      const segments = url.pathname
        .replace(/^\/+/, "")
        .split("/")
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        });
      const [projectId, ...relativeParts] = segments;
      const relativePath = relativeParts.join("/");
      const filePath = resolveProjectRelativePath(projectId, relativePath);
      const thumbnailSize = parseLocalAssetThumbnailSize(url);
      if (thumbnailSize) {
        const stat = await fs.promises.stat(filePath);
        const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}:${thumbnailSize.width}x${thumbnailSize.height}`;
        const thumbnail = await cachedLocalAssetThumbnail(cacheKey, async () => {
          const image = await nativeImage.createThumbnailFromPath(filePath, thumbnailSize);
          return image.isEmpty() ? null : image.toJPEG(78);
        });
        if (thumbnail) {
          const thumbnailBody = thumbnail.buffer.slice(
            thumbnail.byteOffset,
            thumbnail.byteOffset + thumbnail.byteLength,
          ) as ArrayBuffer;
          return new Response(thumbnailBody, {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "private, max-age=86400",
              "Content-Type": "image/jpeg",
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
          });
        }
      }
      const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
      // canvas.toDataURL() 需要 CORS 头，否则 crossOrigin='anonymous' 加载的图片会污染画布
      // 导致九宫格/裁切等操作静默失败（SecurityError 被吞掉）。
      const corsHeaders = new Headers(fileResponse.headers);
      corsHeaders.set("Access-Control-Allow-Origin", "*");
      corsHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(fileResponse.body, { status: fileResponse.status, headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : "local asset not found";
      return new Response(message, { status: 404 });
    }
  });
}

export async function handleNomiLocalRequest(request: Request): Promise<Response> {
  try {
    const filePath = assetPathFromUrl(request.url);
    if (!filePath) {
      return new Response("Unsupported nomi-local host", { status: 404 });
    }
    const rangeHeader = request.headers.get("range") || "";
    if (rangeHeader) {
      const stat = fs.statSync(filePath);
      const range = parseRangeHeader(rangeHeader, stat.size);
      if (!range) return rangeNotSatisfiable(stat.size);
      return streamRange(filePath, range, stat.size, request.method);
    }
    const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
    const corsHeaders = withLocalAssetHeaders(fileResponse.headers);
    return new Response(request.method === "HEAD" ? null : fileResponse.body, { status: fileResponse.status, headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "local asset not found";
    return new Response(message, { status: 404 });
  }
}

export function registerLocalProtocol(): void {
  protocol.handle("nomi-local", handleNomiLocalRequest);
}
