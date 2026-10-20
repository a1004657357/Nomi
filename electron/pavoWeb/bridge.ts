import path from "node:path";
import { parseDataUrl } from "../assets/assetBytes";
import { extensionFromMime } from "../assets/assetPaths";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { taskTemplateParams } from "../catalog/taskParams";
import type { WriteAsset } from "../catalog/processOperation";
import { hardenedFetch } from "../hardenedFetch";
import { firstString, isJsonRecord, trim, type JsonRecord } from "../jsonUtils";
import type { TaskRequest, TaskResult } from "../runtime";
import { PAVO_WEB_BRIDGE_INSTANCE_ID, PAVO_WEB_SAFETY_CONTRACT_VERSION } from "../catalog/pavoWeb";
import { pavoWebAuthHeaders } from "./auth";

const DEFAULT_BASE_URL = "http://127.0.0.1:3458";
const DEFAULT_TIMEOUT_MS = 20_000;
type FetchLike = typeof fetch;

type ReferenceKind = "image" | "video" | "audio";
type ReferenceSource = { kind: ReferenceKind; url: string };
type ReferenceFile = { fileName: string; fileType: string; base64: string };
type TaskSummary = { taskCode: string; status: string; error?: string | null; pavoConversationId: string; syncedFileCount: number };
type FileSummary = {
  fileId: string;
  taskCode: string;
  quality?: string;
  filename?: string;
  mimeType?: string;
  uploadedAt?: string;
};

export type PavoWebTaskPayload = {
  idempotencyKey: string;
  mediaType: "video";
  expectedResultCount: 1;
  description: string;
  prompt: string;
  tags: string[];
  priority: number;
  modelConfig: {
    model: string;
    referenceMode: string;
    aspectRatio: string;
    resolution?: string;
    duration: string;
  };
  referenceFiles: ReferenceFile[];
  realSubmit: boolean;
};

export type PavoWebStatus = {
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

function extras(request: TaskRequest): JsonRecord {
  return isJsonRecord(request.extras) ? request.extras : {};
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

export function resolvePavoWebBaseUrl(value?: unknown): string {
  const raw = firstString(value, process.env.NOMI_PAVO_WEB_API_BASE_URL, DEFAULT_BASE_URL);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Pavo Web 本地服务地址无效：${raw || "(空)"}`);
  }
  if (url.protocol !== "http:" || !isLoopback(url.hostname)) {
    throw new Error("Pavo Web Bridge 只允许连接本机 HTTP 服务");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

async function fetchJson(fetchImpl: FetchLike, baseUrl: string, route: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetchImpl(`${baseUrl}${route}`, {
    ...options,
    headers: pavoWebAuthHeaders(options.headers),
    signal: options.signal || timeoutSignal(DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = isJsonRecord(body) ? firstString(body.error, body.message) : "";
    throw new Error(`Pavo Web 本地服务 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return body;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function collectReferenceSources(params: JsonRecord): ReferenceSource[] {
  const collected: ReferenceSource[] = [];
  const seen = new Set<string>();
  const add = (kind: ReferenceKind, value: unknown) => {
    const url = typeof value === "string" ? value.trim() : "";
    const key = `${kind}:${url}`;
    if (url && !seen.has(key)) {
      seen.add(key);
      collected.push({ kind, url });
    }
  };
  const addMany = (kind: ReferenceKind, value: unknown) => stringArray(value).forEach(item => add(kind, item));
  [params.first_frame, params.first_frame_url, params.frames_first].forEach(value => add("image", value));
  [params.last_frame, params.last_frame_url, params.frames_last].forEach(value => add("image", value));
  [params.image, params.input_image, params.i2v_image].forEach(value => add("image", value));
  [params.images, params.mm_images, params.reference_images, params.reference_image_urls].forEach(value => addMany("image", value));
  [params.audios, params.mm_audios, params.reference_audios].forEach(value => addMany("audio", value));
  [params.videos, params.mm_videos, params.reference_videos].forEach(value => addMany("video", value));
  return collected;
}

const ALLOWED_MIME: Record<ReferenceKind, ReadonlySet<string>> = {
  image: new Set(["image/jpeg", "image/png", "image/webp"]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"]),
};

function normalizedMime(value: string): string {
  return value.toLowerCase().split(";")[0]?.trim() || "application/octet-stream";
}

function assertMime(kind: ReferenceKind, value: string): string {
  const mime = normalizedMime(value);
  if (!ALLOWED_MIME[kind].has(mime)) throw new Error(`Pavo Web 不支持的${kind}参考格式：${mime}`);
  return mime;
}

function sourceExtension(source: string, mime: string, fallback: string): string {
  if (source.startsWith("data:") || source.startsWith("nomi-local://")) return extensionFromMime(mime, fallback);
  try { return path.extname(new URL(source).pathname).slice(1) || extensionFromMime(mime, fallback); }
  catch { return extensionFromMime(mime, fallback); }
}

async function materializeReference(source: ReferenceSource, index: number): Promise<ReferenceFile> {
  const fallback = source.kind === "image" ? "png" : source.kind === "video" ? "mp4" : "mp3";
  if (source.url.startsWith("data:")) {
    const parsed = parseDataUrl(source.url);
    const mime = assertMime(source.kind, parsed.contentType);
    return { fileName: `reference-${index + 1}.${sourceExtension(source.url, mime, fallback)}`, fileType: mime, base64: source.url };
  }
  if (source.url.startsWith("nomi-local://")) {
    const local = readNomiLocalAsset(source.url);
    if (!local) throw new Error("Pavo Web 参考素材读取失败：本地素材不存在或项目不匹配");
    const mime = assertMime(source.kind, local.contentType);
    return {
      fileName: local.fileName || `reference-${index + 1}.${sourceExtension(source.url, mime, fallback)}`,
      fileType: mime,
      base64: `data:${mime};base64,${local.bytes.toString("base64")}`,
    };
  }
  if (/^https?:\/\//i.test(source.url)) {
    const maxMb = source.kind === "video" ? 100 : 25;
    const fetched = await hardenedFetch(source.url, {
      timeoutMs: 30_000,
      maxBytes: maxMb * 1024 * 1024,
      allowContentTypes: [...ALLOWED_MIME[source.kind]],
    });
    const mime = assertMime(source.kind, fetched.contentType);
    return {
      fileName: `reference-${index + 1}.${sourceExtension(fetched.finalUrl || source.url, mime, fallback)}`,
      fileType: mime,
      base64: `data:${mime};base64,${fetched.bytes.toString("base64")}`,
    };
  }
  throw new Error(`Pavo Web 不支持的参考素材地址：${source.url.slice(0, 80)}`);
}

function durationText(value: unknown): string {
  const raw = firstString(value);
  const duration = !raw ? "5s" : /s$/i.test(raw) ? raw.toLowerCase() : `${raw}s`;
  if (!["5s", "10s"].includes(duration)) throw new Error("Pavo Web 当前只支持 5 或 10 秒时长");
  return duration;
}

function referenceMode(params: JsonRecord, sources: ReferenceSource[]): string {
  const hasFirst = Boolean(firstString(params.first_frame, params.first_frame_url, params.frames_first));
  const hasLast = Boolean(firstString(params.last_frame, params.last_frame_url, params.frames_last));
  return hasFirst || hasLast ? "首尾帧" : sources.length ? "全能模式" : "全能模式";
}

export async function buildPavoWebTaskPayload(request: TaskRequest): Promise<PavoWebTaskPayload> {
  if (request.kind !== "text_to_video" && request.kind !== "image_to_video") {
    throw new Error("Pavo Web 首版只支持视频生成");
  }
  const requestExtras = extras(request);
  const idempotencyKey = firstString(requestExtras.idempotencyKey, requestExtras.grantId);
  if (!idempotencyKey) throw new Error("Pavo Web 真实任务缺少幂等标识，已在点击官网生成前拒绝");
  const params = taskTemplateParams(request);
  const sources = collectReferenceSources(params);
  if (sources.filter(source => source.kind === "image").length > 5) {
    throw new Error("Pavo Agnes Video 2.5 Flash 最多接收 5 张参考图");
  }
  if (sources.filter(source => source.kind === "audio").length > 3) {
    throw new Error("Pavo Agnes Video 2.5 Flash 最多接收 3 个参考音频");
  }
  if (sources.some(source => source.kind === "video")) {
    throw new Error("Pavo Agnes Video 2.5 Flash 不接受视频参考");
  }
  const resolution = firstString(params.size, params.resolution, params.video_resolution, "720P").toUpperCase();
  const aspectRatio = firstString(params.aspect_ratio, params.ratio, "16:9");
  const duration = durationText(params.duration);
  if (resolution !== "720P") throw new Error("Pavo Agnes Video 2.5 Flash 当前只支持 720P");
  if (!["16:9", "9:16", "1:1"].includes(aspectRatio)) throw new Error("Pavo Web 当前只支持 16:9、9:16 或 1:1 比例");
  if (!request.prompt.trim()) throw new Error("Pavo Web 提示词不能为空");
  if (referenceMode(params, sources) === "首尾帧" && (sources.length > 2 || sources.some(source => source.kind !== "image"))) {
    throw new Error("Pavo Web 首尾帧模式不能混用全能参考素材");
  }
  const referenceFiles = await Promise.all(sources.map(materializeReference));
  return {
    idempotencyKey,
    mediaType: "video",
    expectedResultCount: 1,
    description: firstString(requestExtras.nodeTitle, requestExtras.title, "Nomi Pavo 视频生成"),
    prompt: request.prompt,
    tags: ["nomi", "pavo-web", "video"],
    priority: 1,
    modelConfig: {
      model: "Agnes Video 2.5 Flash",
      referenceMode: referenceMode(params, sources),
      aspectRatio,
      resolution,
      duration,
    },
    referenceFiles,
    realSubmit: requestExtras.realSubmit === false || process.env.NOMI_PAVO_WEB_REAL_SUBMIT === "0" ? false : true,
  };
}

export async function probePavoWebServer(baseUrlInput?: unknown, fetchImpl: FetchLike = fetch): Promise<PavoWebStatus> {
  const serverUrl = resolvePavoWebBaseUrl(baseUrlInput);
  try {
    const raw = await fetchJson(fetchImpl, serverUrl, "/", { method: "GET" });
    const record = isJsonRecord(raw) ? raw : {};
    const taskStore = isJsonRecord(record.taskStore) ? record.taskStore : {};
    const name = firstString(record.name);
    const instanceId = firstString(record.instanceId);
    const ok = name === "Pavo Web Task Bridge" && instanceId === PAVO_WEB_BRIDGE_INSTANCE_ID
      && record.safetyContractVersion === PAVO_WEB_SAFETY_CONTRACT_VERSION;
    return {
      ok,
      reachable: true,
      serverUrl,
      name,
      instanceId,
      version: firstString(record.version),
      sseClients: typeof record.sseClients === "number" ? record.sseClients : undefined,
      taskTotal: typeof taskStore.total === "number" ? taskStore.total : undefined,
      ...(!ok ? { error: "端口上的 Pavo 服务不兼容或缺少安全提交协议，请使用 Nomi 内置适配器" } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reachable: /HTTP\s+\d+/i.test(message), serverUrl, error: message };
  }
}

export async function submitPavoWebTask(input: {
  request: TaskRequest;
  vendorBaseUrl?: unknown;
  fetchImpl?: FetchLike;
}): Promise<{ taskCode: string; serverUrl: string; payload: PavoWebTaskPayload; raw: unknown }> {
  const fetchImpl = input.fetchImpl || fetch;
  const serverUrl = resolvePavoWebBaseUrl(firstString(extras(input.request).pavoWebApiBaseUrl, input.vendorBaseUrl));
  const status = await probePavoWebServer(serverUrl, fetchImpl);
  if (!status.ok) throw new Error(`Pavo Web Bridge 不可用：${status.error || "本地服务未就绪"}`);
  if ((status.sseClients || 0) < 1) throw new Error("Pavo Web 扩展未连接任务桥");
  const payload = await buildPavoWebTaskPayload(input.request);
  const raw = await fetchJson(fetchImpl, serverUrl, "/api/tasks/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const taskCodes = isJsonRecord(raw) && Array.isArray(raw.taskCodes) ? raw.taskCodes : [];
  const taskCode = taskCodes.map(item => String(item || "").trim()).find(Boolean) || "";
  if (!taskCode) throw new Error("Pavo Web 本地服务没有返回 taskCode");
  return { taskCode, serverUrl, payload, raw };
}

function normalizeStatus(value: unknown): TaskResult["status"] {
  const status = String(value || "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(status)) return "succeeded";
  if (["failed", "fail", "error"].includes(status)) return "failed";
  if (["configuring", "submitting", "generating", "awaiting_result", "uploading", "acked", "occupied"].includes(status)) return "running";
  return "queued";
}

function taskFromResponse(raw: unknown, taskCode: string): TaskSummary {
  const record = isJsonRecord(raw) ? raw.task : null;
  if (!isJsonRecord(record) || trim(record.taskCode) !== taskCode) throw new Error("Pavo Web 返回的任务标识不匹配");
  return { taskCode, status: trim(record.status), error: firstString(record.error) || null,
    pavoConversationId: firstString(record.pavoConversationId),
    syncedFileCount: typeof record.syncedFileCount === "number" ? record.syncedFileCount : 0 };
}

function filesFromList(raw: unknown): FileSummary[] {
  const files = isJsonRecord(raw) && Array.isArray(raw.files) ? raw.files : [];
  return files.flatMap(item => {
    if (!isJsonRecord(item) || !trim(item.fileId) || !trim(item.taskCode)) return [];
    return [{
      fileId: trim(item.fileId),
      taskCode: trim(item.taskCode),
      quality: firstString(item.quality),
      filename: firstString(item.filename),
      mimeType: firstString(item.mimeType),
      uploadedAt: firstString(item.uploadedAt),
    }];
  });
}

async function downloadFile(fetchImpl: FetchLike, serverUrl: string, fileId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetchImpl(`${serverUrl}/api/files/${encodeURIComponent(fileId)}`, {
    headers: pavoWebAuthHeaders(),
    signal: timeoutSignal(120_000),
  });
  if (!response.ok) throw new Error(`Pavo Web 结果下载失败：HTTP ${response.status}`);
  const contentType = normalizedMime(response.headers.get("content-type") || "");
  if (!ALLOWED_MIME.video.has(contentType)) throw new Error("Pavo Web 返回的文件不是视频");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Pavo Web 返回的视频为空");
  return { bytes, contentType };
}

export async function queryPavoWebTask(input: {
  taskCode: string;
  request: TaskRequest;
  projectId?: string;
  nodeId?: string;
  serverUrl?: unknown;
  writeAsset: WriteAsset;
  fetchImpl?: FetchLike;
}): Promise<TaskResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const serverUrl = resolvePavoWebBaseUrl(firstString(input.serverUrl, extras(input.request).pavoWebApiBaseUrl));
  const tasksRaw = await fetchJson(fetchImpl, serverUrl, `/api/tasks/${encodeURIComponent(input.taskCode)}`, { method: "GET" });
  const task = taskFromResponse(tasksRaw, input.taskCode);
  const status = normalizeStatus(task.status);
  const filesRaw = await fetchJson(fetchImpl, serverUrl, `/api/files?taskCode=${encodeURIComponent(input.taskCode)}`, { method: "GET" });
  const files = filesFromList(filesRaw).filter(file => file.taskCode === input.taskCode && ALLOWED_MIME.video.has(normalizedMime(file.mimeType || "")));
  if (status === "failed") {
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: "failed",
      assets: [],
      raw: { error: `Pavo Web 任务失败：${task?.error || "扩展没有返回具体原因"}`, pavoWeb: { task, files, serverUrl } },
    };
  }
  if (status !== "succeeded" || files.length === 0 || !task.pavoConversationId || task.syncedFileCount < 1) {
    return {
      id: input.taskCode,
      kind: input.request.kind,
      status: status === "succeeded" ? "running" : status,
      assets: [],
      raw: { pavoWeb: { task, files, serverUrl, waitingForUpload: status === "succeeded" } },
    };
  }
  if (!input.projectId?.trim()) throw new Error("Pavo Web 结果缺少目标项目，已阻止写入");
  const file = [...files].sort((a, b) => Date.parse(b.uploadedAt || "") - Date.parse(a.uploadedAt || ""))[0];
  const downloaded = await downloadFile(fetchImpl, serverUrl, file.fileId);
  const contentType = downloaded.contentType;
  const ext = extensionFromMime(contentType, "mp4");
  const saved = input.writeAsset(
    input.projectId,
    downloaded.bytes,
    file.filename || `pavo-web-${input.taskCode}.${ext}`,
    contentType,
    {
      kind: "generated",
      generator: "pavo-web",
      ownerNodeId: input.nodeId || null,
      pavoTaskCode: input.taskCode,
      sourceServerUrl: serverUrl,
      sourceFileId: file.fileId,
    },
  ) as { id?: string; name?: string; data?: { url?: string } };
  const url = trim(saved.data?.url);
  if (!url) throw new Error("Pavo Web 结果已生成，但写入 Nomi 项目资产失败");
  return {
    id: input.taskCode,
    kind: input.request.kind,
    status: "succeeded",
    assets: [{ type: "video", url, thumbnailUrl: null, assetId: saved.id || null, assetName: saved.name || null }],
    raw: { pavoWeb: { task, files, pickedFileId: file.fileId, serverUrl } },
  };
}
