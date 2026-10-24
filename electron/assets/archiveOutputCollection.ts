import { desktopT } from "../desktopStrings";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hardenedFetch } from "../hardenedFetch";
import { projectDirById, sanitizeName } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import { absolutePathFromLocalAssetUrlAnyProject } from "./localAssetFile";
import { contentTypeFromPath, extensionFromMime, extensionFromUrl } from "./assetPaths";
import { parseDataUrl } from "./assetBytes";

export type ArchiveOutputItem = {
  nodeId: string;
  resultId?: string;
  title: string;
  type: string;
  url: string;
  createdAt?: number;
};

export type ArchiveOutputCollectionResult = {
  archivedAt: string;
  relativeDirectory: string;
  manifestRelativePath: string;
  items: Array<{
    nodeId: string;
    resultId?: string;
    title: string;
    type: string;
    relativePath: string;
    contentType: string;
    size: number;
    sha256: string;
  }>;
};

export function normalizeArchiveCollectionName(value: unknown): string {
  return sanitizeName(value, "输出收集").replace(/\.+$/g, "").trim() || "输出收集";
}

export function archiveOutputFileName(index: number, title: string, extension: string): string {
  const safeTitle = normalizeArchiveCollectionName(title).slice(0, 60);
  const ext = String(extension || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${String(index + 1).padStart(2, "0")}-${safeTitle}.${ext}`;
}

function archiveStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

function normalizeItem(value: unknown): ArchiveOutputItem | null {
  if (!isJsonRecord(value)) return null;
  const nodeId = String(value.nodeId || "").trim();
  const title = String(value.title || "").trim() || "输出";
  const type = String(value.type || "").trim() || "file";
  const url = String(value.url || "").trim();
  if (!nodeId || !url) return null;
  return {
    nodeId,
    title,
    type,
    url,
    ...(typeof value.resultId === "string" && value.resultId ? { resultId: value.resultId } : {}),
    ...(typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {}),
  };
}

async function readArchiveSource(item: ArchiveOutputItem): Promise<{
  bytes?: Buffer;
  sourcePath?: string;
  contentType: string;
  extension: string;
}> {
  const localPath = absolutePathFromLocalAssetUrlAnyProject(item.url);
  if (localPath) {
    return {
      sourcePath: localPath,
      contentType: contentTypeFromPath(localPath),
      extension: path.extname(localPath).replace(/^\./, "") || "bin",
    };
  }
  if (item.url.startsWith("data:")) {
    const parsed = parseDataUrl(item.url);
    return {
      bytes: parsed.bytes,
      contentType: parsed.contentType,
      extension: extensionFromMime(parsed.contentType, "bin"),
    };
  }
  if (/^https?:\/\//i.test(item.url)) {
    const fetched = await hardenedFetch(item.url, {
      timeoutMs: 60_000,
      maxBytes: 300 * 1024 * 1024,
      allowContentTypes: ["image/", "video/", "audio/", "model/", "application/octet-stream"],
    });
    return {
      bytes: fetched.bytes,
      contentType: fetched.contentType || "application/octet-stream",
      extension: extensionFromMime(fetched.contentType || "", extensionFromUrl(item.url)),
    };
  }
  if (path.isAbsolute(item.url) && fs.existsSync(item.url)) {
    return {
      sourcePath: item.url,
      contentType: contentTypeFromPath(item.url),
      extension: path.extname(item.url).replace(/^\./, "") || "bin",
    };
  }
  throw new Error(desktopT("custom.assets.archiveOutputCollection.text1", { value0: `${item.title}` }));
}

export async function archiveOutputCollection(payload: unknown): Promise<ArchiveOutputCollectionResult> {
  const raw = payload as JsonRecord;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const items = Array.isArray(raw?.items)
    ? raw.items.map(normalizeItem).filter((item): item is ArchiveOutputItem => item !== null)
    : [];
  if (!items.length) throw new Error(desktopT("custom.assets.archiveOutputCollection.text2"));
  if (items.length > 100) throw new Error(desktopT("custom.assets.archiveOutputCollection.text3"));

  const archivedAt = new Date();
  const collectionName = normalizeArchiveCollectionName(raw?.collectionName);
  const relativeDirectory = path.posix.join("exports", "collections", collectionName, archiveStamp(archivedAt));
  const absoluteDirectory = path.join(projectDir, ...relativeDirectory.split("/"));
  ensureDir(absoluteDirectory);

  const archivedItems: ArchiveOutputCollectionResult["items"] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const source = await readArchiveSource(item);
    const fileName = archiveOutputFileName(index, item.title, source.extension);
    const targetPath = path.join(absoluteDirectory, fileName);
    if (source.sourcePath) fs.copyFileSync(source.sourcePath, targetPath);
    else fs.writeFileSync(targetPath, source.bytes as Buffer);
    const bytes = fs.readFileSync(targetPath);
    archivedItems.push({
      nodeId: item.nodeId,
      ...(item.resultId ? { resultId: item.resultId } : {}),
      title: item.title,
      type: item.type,
      relativePath: path.posix.join(relativeDirectory, fileName),
      contentType: source.contentType,
      size: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }

  const manifestRelativePath = path.posix.join(relativeDirectory, "manifest.json");
  fs.writeFileSync(
    path.join(absoluteDirectory, "manifest.json"),
    JSON.stringify({
      version: 1,
      collectionName,
      archivedAt: archivedAt.toISOString(),
      itemCount: archivedItems.length,
      items: archivedItems,
    }, null, 2),
  );
  return {
    archivedAt: archivedAt.toISOString(),
    relativeDirectory,
    manifestRelativePath,
    items: archivedItems,
  };
}
