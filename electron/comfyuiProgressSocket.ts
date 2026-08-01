// ComfyUI ws 进度桥（P 轨 · 2026-08-01 拍板：进度环 + 活预览 + 遮罩取消）。
//
// 为什么在主进程：渲染层 CSP connect-src 不含 ws://（dev 只放 Vite 5273、prod 无 ws），直连必被拦；
// 主进程用 undici 自带 WebSocket（与全仓 fetch 同源、零新依赖、不认系统代理 → 直连本机不被 Clash 绕开）。
// 事件面（实查 ComfyUI server.py / protocol.py HEAD 2026-08-01）：
//   text: {type:'progress',data:{value,max,prompt_id,node}} / {type:'executing',data:{node|null,prompt_id}}
//         {type:'execution_cached',data:{nodes[],prompt_id}} / {type:'status',...}
//   binary: [>I event][payload]；event 1=PREVIEW_IMAGE → [>I 1=JPEG|2=PNG][图字节]
// 推送渠道：webContents.send("nomi:tasks:comfyui:progress")（镜像 textStreamIpc 单向事件范式；
// 高频瞬态，刻意不进 EventLog、不进持久化 result）。
// prompt_id→node 注册表是本模块唯一的数据结构缺口补齐：渲染层提交拿到 prompt_id 后经 watch IPC 登记。
import { webContents } from "electron";
import { WebSocket } from "undici";
import { readCatalog } from "./catalog/catalogStore";
import { COMFYUI_VENDOR_KEY } from "./catalog/types";

export const COMFYUI_PROGRESS_CHANNEL = "nomi:tasks:comfyui:progress";

export type ComfyuiProgressEvent = {
  promptId: string;
  nodeId: string;
  projectId: string;
  kind: "progress" | "preview" | "queue" | "done";
  /** 0-100（kind=progress）。 */
  percent?: number;
  /** 当前执行节点 class（人话进度用）。 */
  currentClass?: string;
  startedNodes?: number;
  totalNodes?: number;
  /** kind=queue：前面还有几个任务。 */
  queueAhead?: number;
  /** kind=preview：jpeg/png data URL。 */
  previewDataUrl?: string;
};

type WatchEntry = {
  promptId: string;
  nodeId: string;
  projectId: string;
  webContentsId: number;
  baseUrl: string;
  totalNodes: number;
  classById: Record<string, string>;
  started: Set<string>;
  currentNode: string | null;
  lastPreviewAt: number;
  lastQueueProbeAt: number;
  createdAt: number;
};

const registry = new Map<string, WatchEntry>();
const socketsByBase = new Map<string, { ws: WebSocket; alive: boolean }>();
/** 该 server 当前正在执行的 prompt（binary 预览帧不带 prompt_id，归属按此判）。 */
const currentPromptByBase = new Map<string, string>();

const ENTRY_TTL_MS = 30 * 60 * 1000; // 慢道硬超时 20min 之上留余量
const PREVIEW_MIN_INTERVAL_MS = 450;
const PREVIEW_MAX_BYTES = 1_500_000;
const QUEUE_PROBE_MIN_INTERVAL_MS = 2_000;

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 纯函数（可单测）：ws 二进制帧 → 预览图。[>I event][>I format][bytes]，event 1=PREVIEW_IMAGE。 */
export function parsePreviewFrame(buf: Buffer): { mime: string; bytes: Buffer } | null {
  if (buf.length < 8) return null;
  const event = buf.readUInt32BE(0);
  if (event !== 1) return null; // 只认 PREVIEW_IMAGE（3=TEXT 等跳过）
  const format = buf.readUInt32BE(4);
  const mime = format === 2 ? "image/png" : "image/jpeg";
  const bytes = buf.subarray(8);
  return bytes.length > 0 && bytes.length <= PREVIEW_MAX_BYTES ? { mime, bytes } : null;
}

/** 纯函数（可单测）：整体进度 =（已开跑节点数-1 + 当前节点比率）/ 总节点数。 */
export function computeOverallPercent(startedCount: number, currentRatio: number, totalNodes: number): number {
  if (totalNodes <= 0) return 0;
  const done = Math.max(0, startedCount - 1) + Math.max(0, Math.min(1, currentRatio));
  return Math.max(0, Math.min(100, Math.round((done / totalNodes) * 100)));
}

function send(entry: WatchEntry, event: Omit<ComfyuiProgressEvent, "promptId" | "nodeId" | "projectId">): void {
  const target = webContents.fromId(entry.webContentsId);
  if (!target || target.isDestroyed()) return;
  target.send(COMFYUI_PROGRESS_CHANNEL, {
    promptId: entry.promptId,
    nodeId: entry.nodeId,
    projectId: entry.projectId,
    ...event,
  } satisfies ComfyuiProgressEvent);
}

function comfyuiBaseUrl(): string {
  const vendor = readCatalog().vendors.find((v) => v.key === COMFYUI_VENDOR_KEY);
  return String(vendor?.baseUrlHint || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function wsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/i, "ws")}/ws?clientId=nomi`;
}

function sweepExpired(now = Date.now()): void {
  for (const [promptId, entry] of registry) {
    if (now - entry.createdAt > ENTRY_TTL_MS) registry.delete(promptId);
  }
}

function closeSocketIfIdle(baseUrl: string): void {
  const hasWatcher = [...registry.values()].some((e) => e.baseUrl === baseUrl);
  if (hasWatcher) return;
  const holder = socketsByBase.get(baseUrl);
  socketsByBase.delete(baseUrl);
  currentPromptByBase.delete(baseUrl);
  try { holder?.ws.close(); } catch { /* 已断开 */ }
}

function handleTextMessage(baseUrl: string, raw: string): void {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!isRec(msg) || typeof msg.type !== "string") return;
  const data = isRec(msg.data) ? msg.data : {};
  const promptId = typeof data.prompt_id === "string" ? data.prompt_id : "";

  if (msg.type === "executing") {
    if (promptId) currentPromptByBase.set(baseUrl, promptId);
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry) return;
    const node = typeof data.node === "string" ? data.node : null;
    if (node === null) {
      send(entry, { kind: "done" });
      registry.delete(promptId);
      closeSocketIfIdle(baseUrl);
      return;
    }
    entry.currentNode = node;
    entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, 0, entry.totalNodes),
      currentClass: entry.classById[node] || node,
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "progress") {
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry) return;
    if (promptId) currentPromptByBase.set(baseUrl, promptId);
    const value = Number(data.value);
    const max = Number(data.max);
    const ratio = Number.isFinite(value) && Number.isFinite(max) && max > 0 ? value / max : 0;
    const node = typeof data.node === "string" ? data.node : entry.currentNode;
    if (node) entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, ratio, entry.totalNodes),
      currentClass: node ? entry.classById[node] || node : undefined,
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "execution_cached") {
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry || !Array.isArray(data.nodes)) return;
    for (const node of data.nodes) if (typeof node === "string") entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, 1, entry.totalNodes),
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "status") {
    // 排队位次：还没开始执行的 watcher 才关心；节流问 /queue（status 无 per-prompt 位次）。
    for (const entry of registry.values()) {
      if (entry.baseUrl !== baseUrl || entry.started.size > 0) continue;
      void probeQueuePosition(entry);
    }
  }
}

async function probeQueuePosition(entry: WatchEntry): Promise<void> {
  const now = Date.now();
  if (now - entry.lastQueueProbeAt < QUEUE_PROBE_MIN_INTERVAL_MS) return;
  entry.lastQueueProbeAt = now;
  try {
    const res = await fetch(`${entry.baseUrl}/queue`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = (await res.json()) as { queue_pending?: unknown[] };
    const pending = Array.isArray(data.queue_pending) ? data.queue_pending : [];
    const index = pending.findIndex((item) => Array.isArray(item) && item[1] === entry.promptId);
    if (index >= 0) send(entry, { kind: "queue", queueAhead: index });
  } catch { /* 排队位次是锦上添花，失败静默 */ }
}

function handleBinaryMessage(baseUrl: string, buf: Buffer): void {
  const promptId = currentPromptByBase.get(baseUrl);
  const entry = promptId ? registry.get(promptId) : undefined;
  if (!entry) return;
  const now = Date.now();
  if (now - entry.lastPreviewAt < PREVIEW_MIN_INTERVAL_MS) return; // 节流：IPC 别被 20fps 预览刷爆
  const frame = parsePreviewFrame(buf);
  if (!frame) return;
  entry.lastPreviewAt = now;
  send(entry, { kind: "preview", previewDataUrl: `data:${frame.mime};base64,${frame.bytes.toString("base64")}` });
}

function ensureSocket(baseUrl: string): void {
  const existing = socketsByBase.get(baseUrl);
  if (existing?.alive) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(baseUrl));
  } catch {
    return; // 起不来就没有进度（轮询照常兜底），不炸任务
  }
  const holder = { ws, alive: true };
  socketsByBase.set(baseUrl, holder);
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (event) => {
    const payload = (event as { data?: unknown }).data;
    if (typeof payload === "string") handleTextMessage(baseUrl, payload);
    else if (payload instanceof ArrayBuffer) handleBinaryMessage(baseUrl, Buffer.from(payload));
  });
  const drop = () => {
    holder.alive = false;
    if (socketsByBase.get(baseUrl) === holder) socketsByBase.delete(baseUrl);
    // 还有 watcher（任务在跑但 ws 断了，如 ComfyUI 重启）→ 3s 后重连一次；轮询始终是终态真相源。
    if ([...registry.values()].some((e) => e.baseUrl === baseUrl)) {
      setTimeout(() => ensureSocket(baseUrl), 3000).unref?.();
    }
  };
  ws.addEventListener("close", drop);
  ws.addEventListener("error", drop);
}

/** 渲染层提交拿到 prompt_id 后登记（comfyuiIpc: nomi:tasks:comfyui:watch）。 */
export function watchComfyuiTask(
  payload: { promptId?: unknown; nodeId?: unknown; projectId?: unknown; taskKind?: unknown; modelKey?: unknown },
  webContentsId: number,
): { ok: boolean } {
  sweepExpired();
  const promptId = String(payload.promptId || "").trim();
  const nodeId = String(payload.nodeId || "").trim();
  if (!promptId || !nodeId) return { ok: false };
  const baseUrl = comfyuiBaseUrl();
  // 从 mapping 的 workflow 图取总节点数 + class 名（进度分母与人话标签）。
  const mapping = readCatalog().mappings.find(
    (m) => m.vendorKey === COMFYUI_VENDOR_KEY && m.taskKind === payload.taskKind && (!payload.modelKey || m.modelKey === payload.modelKey),
  );
  const body = isRec(mapping?.create) ? (mapping.create as { body?: unknown }).body : null;
  const graph = isRec(body) && isRec(body.prompt) ? (body.prompt as Record<string, unknown>) : {};
  const classById: Record<string, string> = {};
  for (const [id, node] of Object.entries(graph)) {
    if (isRec(node) && typeof node.class_type === "string") classById[id] = node.class_type;
  }
  registry.set(promptId, {
    promptId,
    nodeId,
    projectId: String(payload.projectId || "").trim(),
    webContentsId,
    baseUrl,
    totalNodes: Object.keys(classById).length,
    classById,
    started: new Set(),
    currentNode: null,
    lastPreviewAt: 0,
    lastQueueProbeAt: 0,
    createdAt: Date.now(),
  });
  ensureSocket(baseUrl);
  return { ok: true };
}

export function unwatchComfyuiTask(promptId: unknown): void {
  const id = String(promptId || "").trim();
  const entry = registry.get(id);
  if (!entry) return;
  registry.delete(id);
  closeSocketIfIdle(entry.baseUrl);
}

/**
 * 取消：POST /interrupt（带 prompt_id，新服务器定向打断、老服务器忽略 body 打断当前）+
 * POST /queue {delete:[id]}（还在排队的从队列摘掉）。两发都 best-effort——本地免费、幂等安全；
 * 轮询会在 /history 看到 interrupted → 「已取消」。直连 fetch（comfyuiProbe 同纪律，不走代理）。
 */
export async function interruptComfyuiTask(promptId: unknown): Promise<{ ok: boolean }> {
  const id = String(promptId || "").trim();
  if (!id) return { ok: false };
  const baseUrl = registry.get(id)?.baseUrl || comfyuiBaseUrl();
  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
  const [a, b] = await Promise.all([post("/interrupt", { prompt_id: id }), post("/queue", { delete: [id] })]);
  return { ok: Boolean(a || b) };
}

/** 测试钩子。 */
export function _resetComfyuiProgressForTest(): void {
  registry.clear();
  for (const [base] of socketsByBase) closeSocketIfIdle(base);
  socketsByBase.clear();
  currentPromptByBase.clear();
}
export function _registrySizeForTest(): number {
  return registry.size;
}
