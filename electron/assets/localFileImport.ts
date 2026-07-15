// 本地文件 → 项目素材的导入（从 runtime.ts 抽出：它是素材 IO，不是任务执行，放这更内聚，
// 也给 runtime 这个已知巨壳腾出空间）。writeAsset 仍在 runtime（单向依赖，无循环）。
import fs from "node:fs";
import path from "node:path";
import { writeAsset } from "../runtime";
import { contentTypeFromPath, extensionFromMime } from "./assetPaths";
import type { JsonRecord } from "../jsonUtils";

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

export async function importLocalFile(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const bytes = bytesFromPayload(raw.bytes);
  const contentType = String(raw.contentType || "application/octet-stream");
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || null,
  });
}

export async function importLocalPath(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const inputPath = String(raw.path || raw.localPath || "").trim();
  if (!inputPath) throw new Error("path is required");
  const absolutePath = path.resolve(inputPath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error("path must point to a file");
  const contentType = String(raw.contentType || contentTypeFromPath(absolutePath));
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || path.basename(absolutePath) || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, fs.readFileSync(absolutePath), fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || path.basename(absolutePath),
    originalPath: absolutePath,
    ownerNodeId: raw.ownerNodeId || null,
  });
}
