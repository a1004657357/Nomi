import path from "node:path";
import { parseDataUrl } from "../assets/assetBytes";
import { extensionFromMime } from "../assets/assetPaths";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { hardenedFetch } from "../hardenedFetch";
import { taskTemplateParams } from "../catalog/taskParams";
import { firstString, isJsonRecord, trim, type JsonRecord } from "../jsonUtils";
import type { TaskRequest, TaskResult } from "../runtime";
import type { WriteAsset } from "../catalog/processOperation";
import { JIMENG_WEB_BRIDGE_INSTANCE_ID } from "../catalog/jimengWeb";
import { jimengWebAuthHeaders } from "./auth";

const DEFAULT_BASE_URL = "http://127.0.0.1:3457";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_FILE_READY_RETRY_ATTEMPTS = 4;
const DEFAULT_FILE_READY_RETRY_DELAY_MS = 1_500;

type FetchLike = typeof fetch;

type JimengReferenceFile = {
  fileName: string;
  base64: string;
  fileType: string;
};

type JimengTaskPayload = {
  description: string;
  prompt: string;
  tags: string[];
  priority: number;
  modelConfig: {
    model: string;
    referenceMode: string;
    aspectRatio: string;
    duration: string;
  };
  referenceFiles: JimengReferenceFile[];
  realSubmit: boolean;
};

type JimengTaskSummary = {
  taskCode: string;
  status: string;
  error?: string | null;
};

type JimengFileSummary = {
  fileId: string;
  taskCode: string;
  quality?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
};

export type JimengWebSubmitResult = {
  taskCode: string;
  serverUrl: string;
  payload: JimengTaskPayload;
  raw: unknown;
};

export type JimengWebStatus = {
  ok: boolean;
  reachable?: boolean;
  serverUrl: string;
  error?: string;
  name?: string;
  instanceId?: string;
  version?: string;
  sseClients?: number;
  taskTotal?: number;
};

function requestExtras(request: TaskRequest): JsonRecord {
  return isJsonRecord(request.extras) ? request.extras : {};
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function resolveJimengWebBaseUrl(value?: unknown): string {
  const raw = firstString(value, process.env.NOMI_JIMENG_WEB_API_BASE_URL, DEFAULT_BASE_URL);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`即梦 Web 本地服务地址无效：${raw || "(空)"}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`即梦 Web 本地服务只支持 http/https：${url.protocol}`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("即梦 Web 扩展桥当前只允许连接本机 127.0.0.1/localhost 服务");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  fetchImpl: FetchLike,
  baseUrl: string,
  route: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetchImpl(`${baseUrl}${route}`, {
    ...options,
    headers: jimengWebAuthHeaders(options.headers),
    signal: options.signal || withTimeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    const detail = isJsonRecord(json) ? firstString(json.error, json.message) : "";
    throw new Error(`即梦 Web 本地服务 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return json;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function collectReferenceUrls(params: JsonRecord): string[] {
  const refs: string[] = [];
  const add = (value: unknown) => {
    const url = typeof value === "string" ? value.trim() : "";
    if (url && !refs.includes(url)) refs.push(url);
  };
  const addArray = (value: unknown) => stringArray(value).forEach(add);
  add(params.i2v_image);
  add(params.frames_first);
  add(params.frames_last);
  add(params.first_frame_url);
  add(params.last_frame_url);
  addArray(params.mm_images);
  addArray(params.reference_image_urls);
  addArray(params.reference_images);
  return refs;
}

function modelLabelFromParams(params: JsonRecord): string {
  const value = firstString(params.model).toLowerCase();
  if (value.includes("fast")) return "Seedance 2.0 Fast";
  return "Seedance 2.0";
}

function referenceModeFromParams(params: JsonRecord): string {
  const cmd = firstString(params.dreamina_cmd);
  if (cmd === "frames2video" || (firstString(params.frames_first) && firstString(params.frames_last))) return "首尾帧";
  return "全能参考";
}

function durationFromParams(params: JsonRecord): string {
  const raw = params.duration;
  if (typeof raw === "number" && Number.isFinite(raw)) return `${Math.max(1, Math.floor(raw))}s`;
  const text = firstString(raw);
  if (!text) return "5s";
  return /\ds$/i.test(text) ? text : `${text}s`;
}

function contentTypeToName(index: number, contentType: string, source: string): string {
  const ext = extensionFromMime(contentType, extensionFromSource(source, contentType));
  return `图片${index + 1}.${ext}`;
}

function extensionFromSource(source: string, contentType: string): string {
  if (source.startsWith("nomi-local://")) return extensionFromMime(contentType, "png");
  if (source.startsWith("data:")) return extensionFromMime(contentType, "png");
  try {
    const ext = path.extname(new URL(source).pathname).replace(/^\./, "");
    return ext || extensionFromMime(contentType, "png");
  } catch {
    return extensionFromMime(contentType, "png");
  }
}

async function referenceFileFromUrl(url: string, index: number): Promise<JimengReferenceFile> {
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    return {
      fileName: contentTypeToName(index, parsed.contentType, url),
      base64: url,
      fileType: parsed.contentType,
    };
  }

  if (url.startsWith("nomi-local://")) {
    const local = readNomiLocalAsset(url);
    if (!local) throw new Error("即梦 Web 参考图读取失败：本地素材不存在或项目不匹配");
    return {
      fileName: local.fileName || contentTypeToName(index, local.contentType, url),
      base64: `data:${local.contentType};base64,${local.bytes.toString("base64")}`,
      fileType: local.contentType,
    };
  }

  if (/^https?:\/\//i.test(url)) {
    const fetched = await hardenedFetch(url, {
      timeoutMs: 30_000,
      maxBytes: 25 * 1024 * 1024,
      allowContentTypes: ["image/"],
    });
    return {
      fileName: contentTypeToName(index, fetched.contentType || "image/png", fetched.finalUrl || url),
      base64: `data:${fetched.contentType || "image/png"};base64,${fetched.bytes.toString("base64")}`,
      fileType: fetched.contentType || "image/png",
    };
  }

  throw new Error(`即梦 Web 不支持的参考图地址：${url.slice(0, 80)}`);
}

export async function buildJimengWebTaskPayload(request: TaskRequest): Promise<JimengTaskPayload> {
  const params = taskTemplateParams(request);
  const referenceUrls = collectReferenceUrls(params);
  const referenceFiles = await Promise.all(referenceUrls.map(referenceFileFromUrl));
  const extras = requestExtras(request);
  return {
    description: firstString(extras.nodeTitle, extras.title, "Nomi 画布生成"),
    prompt: request.prompt,
    tags: ["nomi", "jimeng-web"],
    priority: 1,
    modelConfig: {
      model: modelLabelFromParams(params),
      referenceMode: referenceModeFromParams(params),
      aspectRatio: firstString(params.ratio, params.aspectRatio, params.size, "16:9"),
      duration: durationFromParams(params),
    },
    referenceFiles,
    // 这是画布真实生成入口；调试时可在节点 extras 或环境变量里显式关掉提交。
    realSubmit: extras.realSubmit === false || process.env.NOMI_JIMENG_WEB_REAL_SUBMIT === "0" ? false : true,
  };
}

export async function probeJimengWebServer(
  baseUrlInput?: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<JimengWebStatus> {
  const serverUrl = resolveJimengWebBaseUrl(baseUrlInput);
  try {
    const json = await fetchJson(fetchImpl, serverUrl, "/", { method: "GET" });
    const record = isJsonRecord(json) ? json : {};
    const taskStore = isJsonRecord(record.taskStore) ? record.taskStore : {};
    const name = firstString(record.name);
    const instanceId = firstString(record.instanceId);
    const compatible = name === "Seedance 任务 Mock API" && instanceId === JIMENG_WEB_BRIDGE_INSTANCE_ID;
    return {
      ok: compatible,
      reachable: true,
      serverUrl,
      name,
      instanceId,
      version: firstString(record.version),
      sseClients: typeof record.sseClients === "number" ? record.sseClients : undefined,
      taskTotal: typeof taskStore.total === "number" ? taskStore.total : undefined,
      ...(!compatible ? { error: `端口上的服务不是 Nomi 即梦实例（instanceId=${instanceId || "missing"}）` } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reachable: /HTTP\s+\d+/i.test(message),
      serverUrl,
      error: message,
    };
  }
}

export async function submitJimengWebTask(input: {
  request: TaskRequest;
  vendorBaseUrl?: unknown;
  fetchImpl?: FetchLike;
}): Promise<JimengWebSubmitResult> {
  const serverUrl = resolveJimengWebBaseUrl(
    firstString(requestExtras(input.request).jimengWebApiBaseUrl, input.vendorBaseUrl),
  );
  const payload = await buildJimengWebTaskPayload(input.request);
  const raw = await fetchJson(input.fetchImpl || fetch, serverUrl, "/api/tasks/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const taskCodes = isJsonRecord(raw) && Array.isArray(raw.taskCodes) ? raw.taskCodes : [];
  const taskCode = taskCodes.map((item) => String(item || "").trim()).find(Boolean) || "";
  if (!taskCode) throw new Error("即梦 Web 本地服务没有返回 taskCode");
  return { taskCode, serverUrl, payload, raw };
}

function normalizeTaskStatus(value: unknown): TaskResult["status"] {
  const status = String(value || "").toLowerCase();
  if (status === "completed" || status === "succeeded" || status === "success") return "succeeded";
  if (status === "failed" || status === "fail" || status === "error") return "failed";
  if (
    status === "generating" ||
    status === "uploading" ||
    status === "upscaling" ||
    status === "uploading_hd" ||
    status === "acked" ||
    status === "occupied"
  )
    return "running";
  return "queued";
}

function taskFromList(raw: unknown, taskCode: string): JimengTaskSummary | null {
  const tasks = isJsonRecord(raw) && Array.isArray(raw.tasks) ? raw.tasks : [];
  for (const item of tasks) {
    if (!isJsonRecord(item)) continue;
    if (trim(item.taskCode) === taskCode) {
      return {
        taskCode,
        status: trim(item.status),
        error: firstString(item.error) || null,
      };
    }
  }
  return null;
}

function filesFromList(raw: unknown): JimengFileSummary[] {
  const files = isJsonRecord(raw) && Array.isArray(raw.files) ? raw.files : [];
  return files.flatMap((item): JimengFileSummary[] => {
    if (!isJsonRecord(item)) return [];
    const fileId = trim(item.fileId);
    const taskCode = trim(item.taskCode);
    if (!fileId || !taskCode) return [];
    return [
      {
        fileId,
        taskCode,
        quality: firstString(item.quality),
        filename: firstString(item.filename),
        mimeType: firstString(item.mimeType),
        size: typeof item.size === "number" ? item.size : undefined,
        uploadedAt: firstString(item.uploadedAt),
      },
    ];
  });
}

function chooseBestFile(files: JimengFileSummary[]): JimengFileSummary | null {
  if (files.length === 0) return null;
  return (
    [...files].sort((a, b) => {
      const score = (f: JimengFileSummary) => (/hd|high|upscale/i.test(f.quality || "") ? 2 : 1);
      const diff = score(b) - score(a);
      if (diff) return diff;
      return Date.parse(b.uploadedAt || "") - Date.parse(a.uploadedAt || "");
    })[0] || null
  );
}

async function fetchFilesForTask(
  fetchImpl: FetchLike,
  serverUrl: string,
  taskCode: string,
): Promise<JimengFileSummary[]> {
  const filesRaw = await fetchJson(fetchImpl, serverUrl, `/api/files?taskCode=${encodeURIComponent(taskCode)}`, {
    method: "GET",
  });
  return filesFromList(filesRaw);
}

async function fetchFilesForCompletedTask(input: {
  fetchImpl: FetchLike;
  serverUrl: string;
  taskCode: string;
  attempts?: number;
  delayMs?: number;
}): Promise<JimengFileSummary[]> {
  const attempts = Math.max(1, Math.floor(input.attempts ?? DEFAULT_FILE_READY_RETRY_ATTEMPTS));
  const delayMs = Math.max(0, Math.floor(input.delayMs ?? DEFAULT_FILE_READY_RETRY_DELAY_MS));
  let lastFiles: JimengFileSummary[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastFiles = await fetchFilesForTask(input.fetchImpl, input.serverUrl, input.taskCode);
    if (chooseBestFile(lastFiles) || attempt === attempts - 1) return lastFiles;
    if (delayMs > 0) await sleep(delayMs);
  }
  return lastFiles;
}

async function downloadLocalServerFile(
  fetchImpl: FetchLike,
  serverUrl: string,
  fileId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetchImpl(`${serverUrl}/api/files/${encodeURIComponent(fileId)}`, {
    method: "GET",
    headers: jimengWebAuthHeaders(),
    signal: withTimeout(120_000),
  });
  if (!response.ok) throw new Error(`即梦 Web 视频下载失败：HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "video/mp4",
  };
}

export async function queryJimengWebTask(input: {
  taskCode: string;
  request: TaskRequest;
  projectId?: string;
  nodeId?: string;
  serverUrl?: unknown;
  writeAsset: WriteAsset;
  fetchImpl?: FetchLike;
  fileReadyRetryAttempts?: number;
  fileReadyRetryDelayMs?: number;
}): Promise<TaskResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const serverUrl = resolveJimengWebBaseUrl(
    firstString(input.serverUrl, requestExtras(input.request).jimengWebApiBaseUrl),
  );
  const taskListRaw = await fetchJson(fetchImpl, serverUrl, "/api/tasks", { method: "GET" });
  const task = taskFromList(taskListRaw, input.taskCode);
  const status = normalizeTaskStatus(task?.status);
  const files =
    status === "succeeded"
      ? await fetchFilesForCompletedTask({
          fetchImpl,
          serverUrl,
          taskCode: input.taskCode,
          attempts: input.fileReadyRetryAttempts,
          delayMs: input.fileReadyRetryDelayMs,
        })
      : await fetchFilesForTask(fetchImpl, serverUrl, input.taskCode);
  const bestFile = chooseBestFile(files);

  if (status === "failed") {
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: "failed",
      assets: [],
      raw: { jimengWeb: { task, files, serverUrl, error: task?.error || null } },
    };
  }

  if (status === "succeeded" && bestFile) {
    const downloaded = await downloadLocalServerFile(fetchImpl, serverUrl, bestFile.fileId);
    const contentType = bestFile.mimeType || downloaded.contentType || "video/mp4";
    const ext = extensionFromMime(contentType, "mp4");
    const fileName = bestFile.filename || `jimeng-web-${input.taskCode}.${ext}`;
    const saved = input.writeAsset(input.projectId || "", downloaded.bytes, fileName, contentType, {
      kind: "generated",
      generator: "jimeng-web",
      ownerNodeId: input.nodeId || null,
      jimengTaskCode: input.taskCode,
      sourceServerUrl: serverUrl,
      sourceFileId: bestFile.fileId,
      sourceQuality: bestFile.quality || null,
    }) as { id?: string; name?: string; data?: { url?: string } };
    const url = trim(saved.data?.url);
    if (!url) throw new Error("即梦 Web 视频已生成，但写入 Nomi 项目资产失败");
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: "succeeded",
      assets: [
        {
          type: "video",
          url,
          thumbnailUrl: null,
          assetId: saved.id || null,
          assetName: saved.name || null,
        },
      ],
      raw: { jimengWeb: { task, files, pickedFileId: bestFile.fileId, serverUrl } },
    };
  }

  return {
    id: input.taskCode,
    kind: input.request.kind,
    status: status === "succeeded" ? "running" : status,
    assets: [],
    raw: {
      jimengWeb: {
        task,
        files,
        serverUrl,
        waitingForUpload: status === "succeeded" && !bestFile,
        fileReadyRetryAttempts:
          status === "succeeded"
            ? Math.max(1, Math.floor(input.fileReadyRetryAttempts ?? DEFAULT_FILE_READY_RETRY_ATTEMPTS))
            : 0,
      },
    },
  };
}
