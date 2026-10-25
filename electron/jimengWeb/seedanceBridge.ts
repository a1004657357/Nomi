import { desktopT } from "../desktopStrings";
import { appFetch } from "../appFetch";
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

type JimengReferenceKind = "image" | "video" | "audio";

type JimengReferenceSource = {
  kind: JimengReferenceKind;
  url: string;
};

export type JimengWebMediaType = "image" | "video";

type JimengTaskPayload = {
  idempotencyKey?: string;
  mediaType: JimengWebMediaType;
  /** Exact number requested from the JiMeng image page. Video nodes are always one task/result. */
  expectedResultCount: number;
  description: string;
  prompt: string;
  tags: string[];
  priority: number;
  modelConfig: {
    model?: string;
    referenceMode?: string;
    aspectRatio: string;
    resolution?: string;
    count?: number;
    duration?: string;
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
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text1", { value0: `${raw || "(空)"}` }));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text2", { value0: `${url.protocol}` }));
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text3"));
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
    redirect: 'error',
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
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text4", { value0: `${response.status}`, value1: `${detail ? `：${detail}` : ""}` }));
  }
  return json;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function collectReferenceSources(params: JsonRecord): JimengReferenceSource[] {
  const refs: JimengReferenceSource[] = [];
  const seen = new Set<string>();
  const add = (kind: JimengReferenceKind, value: unknown) => {
    const url = typeof value === "string" ? value.trim() : "";
    const key = `${kind}:${url}`;
    if (url && !seen.has(key)) {
      refs.push({ kind, url });
      seen.add(key);
    }
  };
  const addArray = (kind: JimengReferenceKind, value: unknown) => stringArray(value).forEach((url) => add(kind, url));
  add("image", params.i2v_image);
  add("image", params.frames_first);
  add("image", params.frames_last);
  add("image", params.first_frame_url);
  add("image", params.last_frame_url);
  addArray("image", params.mm_images);
  addArray("image", params.reference_image_urls);
  addArray("image", params.reference_images);
  addArray("image", params.input_images);
  add("image", params.image);
  addArray("image", params.image);
  add("image", params.input_image);
  addArray("video", params.mm_videos);
  addArray("video", params.reference_video_urls);
  addArray("video", params.reference_videos);
  addArray("audio", params.mm_audios);
  addArray("audio", params.reference_audio_urls);
  addArray("audio", params.reference_audios);
  return refs;
}

function mediaTypeFromRequest(request: TaskRequest): JimengWebMediaType {
  return request.kind === "text_to_image" || request.kind === "image_edit" ? "image" : "video";
}

const JIMENG_MODEL_LABELS: Readonly<Record<string, string>> = {
  "jimeng-image-5.0-pro": "图片 5.0 Pro",
  "jimeng-image-5.0-lite": "图片 5.0 Lite",
  "jimeng-image-4.7": "图片 4.7",
  "jimeng-image-4.6": "图片 4.6",
  "jimeng-image-4.5": "图片 4.5",
  "jimeng-image-4.1": "图片 4.1",
  "jimeng-image-4.0": "图片 4.0",
  "jimeng-image-3.1": "图片 3.1",
  "jimeng-image-3.0": "图片 3.0",
  "jimeng-seedance-2.0-mini": "即梦 Seedance 2.0 mini",
  "jimeng-seedance-2.0-fast-vip": "即梦 Seedance 2.0 Fast VIP",
  "jimeng-seedance-2.0-vip": "即梦 Seedance 2.0 VIP",
  "jimeng-seedance-2.0-fast": "即梦 Seedance 2.0 Fast",
  "jimeng-seedance-2.0": "即梦 Seedance 2.0",
  "seedance2.0mini": "即梦 Seedance 2.0 mini",
  "seedance2.0fast_vip": "即梦 Seedance 2.0 Fast VIP",
  "seedance2.0_vip": "即梦 Seedance 2.0 VIP",
  "seedance2.0fast": "即梦 Seedance 2.0 Fast",
  "seedance2.0": "即梦 Seedance 2.0",
};

function modelLabelFromParams(params: JsonRecord): string | undefined {
  const value = firstString(params.model).trim();
  if (!value) return undefined;
  return JIMENG_MODEL_LABELS[value.toLowerCase()] || value;
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

function generationCountFromParams(params: JsonRecord): number | undefined {
  const raw = params.generation_count ?? params.count;
  const value = typeof raw === "number" ? raw : Number.parseInt(firstString(raw), 10);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(4, Math.floor(value)));
}

function fullReferencePrompt(
  prompt: string,
  params: JsonRecord,
  referenceFiles: JimengReferenceFile[],
  roles: string[],
): string {
  const command = firstString(params.dreamina_cmd);
  const fullReference = command === "multimodal2video" || Array.isArray(params.mm_images);
  if (!fullReference) return prompt;
  const imageCount = referenceFiles.filter((file) => file.fileType.startsWith("image/")).length;
  if (imageCount === 0) return prompt;

  // Nomi 内联引用会先投影成 characterN；即梦网页桥真正识别的是 ProseMirror
  // mention，因此在桥边界转换成 (@图片N)，由扩展映射到上传后的图片 UUID。
  const withMentions = prompt.replace(/\bcharacter(\d+)\b/gi, (full, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10);
    return index >= 1 && index <= imageCount ? `(@图片${index})` : full;
  });
  const lines = Array.from({ length: imageCount }, (_, index) => {
    const role = roles[index]?.trim() || `参考图片 ${index + 1}，只按提示词指定的用途参考`;
    return `- (@图片${index + 1})：${role}`;
  });
  return [
    withMentions.trim(),
    "",
    "参考素材分工（必须按以下用途使用，不得把分镜图默认锁成首帧）：",
    ...lines,
  ].join("\n");
}

const JIMENG_WEB_REFERENCE_MIME_TYPES: Record<Exclude<JimengReferenceKind, "audio">, ReadonlySet<string>> = {
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]),
  video: new Set(["video/mp4", "video/quicktime"]),
};

function normalizedContentType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() || "application/octet-stream";
}

function assertSupportedReferenceType(kind: Exclude<JimengReferenceKind, "audio">, contentType: string): string {
  const normalized = normalizedContentType(contentType);
  if (!JIMENG_WEB_REFERENCE_MIME_TYPES[kind].has(normalized)) {
    const label = kind === "video" ? "视频" : "图片";
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text5", { value0: `${label}`, value1: `${normalized}` }));
  }
  return normalized;
}

function contentTypeToName(
  kind: Exclude<JimengReferenceKind, "audio">,
  index: number,
  contentType: string,
  source: string,
): string {
  const fallback = kind === "video" ? "mp4" : "png";
  const ext = extensionFromMime(contentType, extensionFromSource(source, contentType, fallback));
  return `${kind === "video" ? "视频" : "图片"}${index + 1}.${ext}`;
}

function extensionFromSource(source: string, contentType: string, fallback: string): string {
  if (source.startsWith("nomi-local://")) return extensionFromMime(contentType, fallback);
  if (source.startsWith("data:")) return extensionFromMime(contentType, fallback);
  try {
    const ext = path.extname(new URL(source).pathname).replace(/^\./, "");
    return ext || extensionFromMime(contentType, fallback);
  } catch {
    return extensionFromMime(contentType, fallback);
  }
}

async function referenceFileFromSource(
  source: JimengReferenceSource & { kind: Exclude<JimengReferenceKind, "audio"> },
  index: number,
): Promise<JimengReferenceFile> {
  const { kind, url } = source;
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const contentType = assertSupportedReferenceType(kind, parsed.contentType);
    return {
      fileName: contentTypeToName(kind, index, contentType, url),
      base64: url,
      fileType: contentType,
    };
  }

  if (url.startsWith("nomi-local://")) {
    const local = readNomiLocalAsset(url);
    if (!local) throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text6"));
    const contentType = assertSupportedReferenceType(kind, local.contentType);
    return {
      fileName: local.fileName || contentTypeToName(kind, index, contentType, url),
      base64: `data:${contentType};base64,${local.bytes.toString("base64")}`,
      fileType: contentType,
    };
  }

  if (/^https?:\/\//i.test(url)) {
    const video = kind === "video";
    const fetched = await hardenedFetch(url, {
      timeoutMs: 30_000,
      maxBytes: (video ? 100 : 25) * 1024 * 1024,
      allowContentTypes: [...JIMENG_WEB_REFERENCE_MIME_TYPES[kind]],
    });
    const fallbackType = video ? "video/mp4" : "image/png";
    const contentType = assertSupportedReferenceType(kind, fetched.contentType || fallbackType);
    return {
      fileName: contentTypeToName(kind, index, contentType, fetched.finalUrl || url),
      base64: `data:${contentType};base64,${fetched.bytes.toString("base64")}`,
      fileType: contentType,
    };
  }

  throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text7", { value0: `${url.slice(0, 80)}` }));
}

async function materializeReferenceFiles(sources: JimengReferenceSource[]): Promise<JimengReferenceFile[]> {
  if (sources.some((source) => source.kind === "audio")) {
    throw new Error(
      desktopT("custom.jimengWeb.seedanceBridge.text8"),
    );
  }
  const indices = { image: 0, video: 0 };
  return Promise.all(sources.map((source) => {
    const kind = source.kind as Exclude<JimengReferenceKind, "audio">;
    const index = indices[kind];
    indices[kind] += 1;
    return referenceFileFromSource({ kind, url: source.url }, index);
  }));
}

export async function buildJimengWebTaskPayload(request: TaskRequest): Promise<JimengTaskPayload> {
  const params = taskTemplateParams(request);
  const referenceFiles = await materializeReferenceFiles(collectReferenceSources(params));
  const extras = requestExtras(request);
  const referenceImageRoles = stringArray(extras.referenceImageRoles);
  const mediaType = mediaTypeFromRequest(request);
  const modelConfig: JimengTaskPayload["modelConfig"] = {
    aspectRatio: firstString(
      params.ratio,
      params.aspectRatio,
      params.size,
      mediaType === "image" ? "1:1" : "16:9",
    ),
  };
  const model = modelLabelFromParams(params);
  const resolution = firstString(params.resolution_type, params.video_resolution, params.resolution).toUpperCase();
  const count = generationCountFromParams(params);
  const safeCount = mediaType === "image" ? count || 1 : 1;
  if (model) modelConfig.model = model;
  if (resolution) modelConfig.resolution = resolution;
  modelConfig.count = safeCount;
  if (mediaType === "video") {
    modelConfig.referenceMode = referenceModeFromParams(params);
    modelConfig.duration = durationFromParams(params);
  }
  return {
    ...(firstString(extras.idempotencyKey) ? { idempotencyKey: firstString(extras.idempotencyKey) } : {}),
    mediaType,
    expectedResultCount: safeCount,
    description: firstString(extras.nodeTitle, extras.title, "Nomi 画布生成"),
    prompt: mediaType === "video"
      ? fullReferencePrompt(request.prompt, params, referenceFiles, referenceImageRoles)
      : request.prompt,
    tags: ["nomi", "jimeng-web", mediaType],
    priority: 1,
    modelConfig,
    referenceFiles,
    // 这是画布真实生成入口；调试时可在节点 extras 或环境变量里显式关掉提交。
    realSubmit: extras.realSubmit === false || process.env.NOMI_JIMENG_WEB_REAL_SUBMIT === "0" ? false : true,
  };
}

export async function probeJimengWebServer(
  baseUrlInput?: unknown,
  fetchImpl: FetchLike = appFetch,
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
  const fetchImpl = input.fetchImpl || appFetch;
  const serverUrl = resolveJimengWebBaseUrl(
    firstString(requestExtras(input.request).jimengWebApiBaseUrl, input.vendorBaseUrl),
  );
  const bridgeStatus = await probeJimengWebServer(serverUrl, fetchImpl);
  if (!bridgeStatus.ok) {
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text9", { value0: `${bridgeStatus.error || "本地服务未就绪"}` }));
  }
  if ((bridgeStatus.sseClients || 0) < 1) {
    throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text10"));
  }
  const payload = await buildJimengWebTaskPayload(input.request);
  const raw = await fetchJson(fetchImpl, serverUrl, "/api/tasks/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const taskCodes = isJsonRecord(raw) && Array.isArray(raw.taskCodes) ? raw.taskCodes : [];
  const taskCode = taskCodes.map((item) => String(item || "").trim()).find(Boolean) || "";
  if (!taskCode) throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text11"));
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
    status === "submitting" ||
    status === "awaiting_result" ||
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

function chooseBestFile(
  files: JimengFileSummary[],
  mediaType?: JimengWebMediaType,
): JimengFileSummary | null {
  const compatible = compatibleFiles(files, mediaType);
  if (compatible.length === 0) return null;
  return (
    [...compatible].sort((a, b) => {
      const score = (f: JimengFileSummary) => (/hd|high|upscale/i.test(f.quality || "") ? 2 : 1);
      const diff = score(b) - score(a);
      if (diff) return diff;
      return Date.parse(b.uploadedAt || "") - Date.parse(a.uploadedAt || "");
    })[0] || null
  );
}

function compatibleFiles(
  files: JimengFileSummary[],
  mediaType?: JimengWebMediaType,
): JimengFileSummary[] {
  if (!mediaType) return files;
  return files.filter((file) => {
    const mimeType = normalizedContentType(file.mimeType || "");
    return mediaType === "image" ? mimeType.startsWith("image/") : mimeType.startsWith("video/");
  });
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
  mediaType?: JimengWebMediaType;
}): Promise<JimengFileSummary[]> {
  const attempts = Math.max(1, Math.floor(input.attempts ?? DEFAULT_FILE_READY_RETRY_ATTEMPTS));
  const delayMs = Math.max(0, Math.floor(input.delayMs ?? DEFAULT_FILE_READY_RETRY_DELAY_MS));
  let lastFiles: JimengFileSummary[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastFiles = await fetchFilesForTask(input.fetchImpl, input.serverUrl, input.taskCode);
    if (chooseBestFile(lastFiles, input.mediaType) || attempt === attempts - 1) return lastFiles;
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
    redirect: 'error',
  });
  if (!response.ok) throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text12", { value0: `${response.status}` }));
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream",
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
  const fetchImpl = input.fetchImpl || appFetch;
  const mediaType = mediaTypeFromRequest(input.request);
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
          mediaType,
        })
      : await fetchFilesForTask(fetchImpl, serverUrl, input.taskCode);
  const bestFile = chooseBestFile(files, mediaType);

  if (status === "failed") {
    const bridgeError = task?.error || "扩展没有返回具体失败原因";
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: "failed",
      assets: [],
      raw: {
        error: `即梦 Web 网页桥任务失败：${bridgeError}`,
        errorStage: "web-bridge",
        jimengWeb: { task, files, serverUrl, error: task?.error || null },
      },
    };
  }

  if (status === "succeeded" && bestFile) {
    const resultFiles = mediaType === "image" ? compatibleFiles(files, mediaType) : [bestFile];
    const savedAssets = await Promise.all(resultFiles.map(async (file) => {
      const downloaded = await downloadLocalServerFile(fetchImpl, serverUrl, file.fileId);
      const fallbackContentType = mediaType === "image" ? "image/png" : "video/mp4";
      const contentType = file.mimeType || downloaded.contentType || fallbackContentType;
      const ext = extensionFromMime(contentType, mediaType === "image" ? "png" : "mp4");
      const fileName = file.filename || `jimeng-web-${input.taskCode}-${file.fileId}.${ext}`;
      const saved = input.writeAsset(input.projectId || "", downloaded.bytes, fileName, contentType, {
        kind: "generated",
        generator: "jimeng-web",
        ownerNodeId: input.nodeId || null,
        jimengTaskCode: input.taskCode,
        sourceServerUrl: serverUrl,
        sourceFileId: file.fileId,
        sourceQuality: file.quality || null,
      }, mediaType) as { id?: string; name?: string; data?: { url?: string } };
      const url = trim(saved.data?.url);
      if (!url) throw new Error(desktopT("custom.jimengWeb.seedanceBridge.text13"));
      return {
        type: mediaType,
        url,
        thumbnailUrl: null,
        assetId: saved.id || null,
        assetName: saved.name || null,
      };
    }));
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: "succeeded",
      assets: savedAssets,
      raw: {
        jimengWeb: {
          task,
          files,
          pickedFileId: bestFile.fileId,
          pickedFileIds: resultFiles.map((file) => file.fileId),
          serverUrl,
        },
      },
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
