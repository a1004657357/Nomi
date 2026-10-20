import fs from "node:fs";
import { registerAppWindow } from '../appWindowRegistry';
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, session, type Extension, type Session } from "electron";
import { JIMENG_WEB_BRIDGE_INSTANCE_ID, JIMENG_WEB_VENDOR_SEED } from "../catalog/jimengWeb";
import { probeJimengWebServer, resolveJimengWebBaseUrl } from "./seedanceBridge";
import { jimengWebAuthToken } from "./auth";

const DEFAULT_JIMENG_VIDEO_PAGE_URL =
  "https://jimeng.jianying.com/ai-tool/generate?enter_from=ai_feature&from_page=explore&ai_feature_name=video";
const DEFAULT_JIMENG_IMAGE_PAGE_URL =
  "https://jimeng.jianying.com/ai-tool/image/generate";
const DEFAULT_SEEDANCE_EXTENSION_DIR = "/Volumes/Ai/project/视频制作方向/Seedance2-Chrome-Extensions-master";
const DEFAULT_NOMI_EXTENSION_DIR = path.join(os.homedir(), "Projects", "Nomi-jimeng-web-extension");
export const JIMENG_WEB_RUNNER_PARTITION = "persist:nomi-jimeng-runner";

type RunnerProcessStatus = {
  available: boolean;
  running: boolean;
  browserOpen: boolean;
  serverManaged: boolean;
  clientOnline: boolean;
  engine: "electron";
  drawerReady: boolean;
  fallbackPanelOpen: boolean;
  extensionDir?: string;
  userDataDir?: string;
  serverPid?: number;
  extensionId?: string;
  panelUrl?: string;
  jimengUrl: string;
  error?: string;
  lastLog?: string;
};

export type JimengWebRunnerStatus = RunnerProcessStatus;
export type ManagedJimengServerProcess = Pick<ChildProcess, "killed" | "exitCode" | "kill">;

let serverProcess: ChildProcess | null = null;
let jimengWindow: BrowserWindow | null = null;
let fallbackPanelWindow: BrowserWindow | null = null;
let loadedExtension: Extension | null = null;
let currentExtensionId = "";
let currentPanelUrl = "";
let lastError = "";
let drawerReady = false;
let runnerStartPromise: Promise<JimengWebRunnerStatus> | null = null;
const recentLogs: string[] = [];

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function resolveJimengPageUrl(): string {
  const raw = process.env.NOMI_JIMENG_WEB_PAGE_URL?.trim() || DEFAULT_JIMENG_VIDEO_PAGE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "jimeng.jianying.com") return url.toString();
  } catch {
    // Fall back to the known Jimeng video entry below.
  }
  return DEFAULT_JIMENG_VIDEO_PAGE_URL;
}

export function jimengPageUrlForMediaType(mediaType: "image" | "video"): string {
  return mediaType === "image" ? DEFAULT_JIMENG_IMAGE_PAGE_URL : DEFAULT_JIMENG_VIDEO_PAGE_URL;
}

export function jimengRunnerWindowAction(hasLiveWindow: boolean): "reuse" | "open-default" {
  return hasLiveWindow ? "reuse" : "open-default";
}

export function seedanceExtensionCandidates(): string[] {
  return uniqueNonEmpty([
    process.env.NOMI_SEEDANCE_EXTENSION_DIR,
    DEFAULT_NOMI_EXTENSION_DIR,
    DEFAULT_SEEDANCE_EXTENSION_DIR,
    path.join(os.homedir(), "Projects", "Seedance2-Chrome-Extensions-master"),
    path.join(os.homedir(), "Downloads", "Seedance2-Chrome-Extensions-master"),
  ]).map(expandHome);
}

export function resolveSeedanceExtensionDir(input?: string): string | null {
  const candidates = input?.trim() ? [expandHome(input)] : seedanceExtensionCandidates();
  for (const candidate of candidates) {
    try {
      const manifestPath = path.join(candidate, "manifest.json");
      const serverPath = path.join(candidate, "mock-server.js");
      if (fs.existsSync(manifestPath) && fs.existsSync(serverPath)) return candidate;
    } catch {
      // Ignore inaccessible candidates and keep probing.
    }
  }
  return null;
}

export function jimengWebRunnerSession(): Session {
  return session.fromPartition(JIMENG_WEB_RUNNER_PARTITION);
}

function sessionStoragePath(): string | undefined {
  try {
    return jimengWebRunnerSession().getStoragePath() || undefined;
  } catch {
    return path.join(app.getPath("userData"), "Partitions", JIMENG_WEB_RUNNER_PARTITION.replace(/^persist:/, ""));
  }
}

function rememberLog(chunk: Buffer | string): void {
  const lines = String(chunk)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) recentLogs.push(line);
  while (recentLogs.length > 20) recentLogs.shift();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(serverUrl: string, timeoutMs = 12_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await probeJimengWebServer(serverUrl);
    if (status.ok) return;
    await sleep(400);
  }
  throw new Error("即梦 Web 本地任务服务启动超时");
}

async function waitForClient(serverUrl: string, timeoutMs = 12_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await probeJimengWebServer(serverUrl);
    if (status.ok && (status.sseClients || 0) > 0) return true;
    await sleep(500);
  }
  return false;
}

export function jimengWebServerProcessEnv(serverUrl: string): NodeJS.ProcessEnv {
  const parsed = new URL(serverUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const runtimeDir = path.join(app.getPath("userData"), "jimeng-web-bridge");
  return {
    ...process.env,
    NOMI_JIMENG_WEB_TOKEN: jimengWebAuthToken(),
    NOMI_JIMENG_WEB_PARENT_PID: String(process.pid),
    NOMI_JIMENG_WEB_PORT: port,
    NOMI_JIMENG_WEB_INSTANCE_ID: JIMENG_WEB_BRIDGE_INSTANCE_ID,
    NOMI_JIMENG_WEB_DATA_DIR: path.join(runtimeDir, "data"),
    NOMI_JIMENG_WEB_UPLOADS_DIR: path.join(runtimeDir, "uploads"),
  };
}

async function ensureMockServer(serverUrl: string, extensionDir: string): Promise<void> {
  const existing = await probeJimengWebServer(serverUrl);
  if (existing.ok) return;
  if (existing.reachable) {
    throw new Error(`${serverUrl} 已被其他或不兼容的服务占用：${existing.error || "实例身份不匹配"}`);
  }
  if (serverProcess && !serverProcess.killed) {
    await waitForServer(serverUrl);
    return;
  }

  lastError = "";
  const nodeBinary = process.env.NOMI_JIMENG_WEB_NODE?.trim() || "node";
  const proc = spawn(nodeBinary, ["mock-server.js"], {
    cwd: extensionDir,
    env: jimengWebServerProcessEnv(serverUrl),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = proc;
  proc.stdout?.on("data", rememberLog);
  proc.stderr?.on("data", rememberLog);
  proc.once("exit", (code, signal) => {
    rememberLog(`mock-server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (serverProcess === proc) serverProcess = null;
  });
  await waitForServer(serverUrl);
}

async function ensureExtensionLoaded(extensionDir: string): Promise<Extension> {
  const ses = jimengWebRunnerSession();
  const existing = ses
    .getAllExtensions()
    .find((extension) => path.resolve(extension.path) === path.resolve(extensionDir));
  if (existing) {
    loadedExtension = existing;
  } else {
    loadedExtension = await ses.loadExtension(extensionDir, { allowFileAccess: true });
  }
  currentExtensionId = loadedExtension.id;
  currentPanelUrl = new URL("panel.html", loadedExtension.url).toString();
  return loadedExtension;
}

function runnerWindowOptions(input: {
  title: string;
  width: number;
  height: number;
  show: boolean;
}): Electron.BrowserWindowConstructorOptions {
  return {
    width: input.width,
    height: input.height,
    show: input.show,
    title: input.title,
    webPreferences: {
      session: jimengWebRunnerSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
}

function attachWindowLogs(win: BrowserWindow, label: string): void {
  win.webContents.on("console-message", (_event, _level, message) => {
    if (/Panel|SSE|Seedance|chrome|drawer|error|failed/i.test(message)) {
      rememberLog(`[${label}] ${message}`);
    }
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    rememberLog(
      `[${label}] load failed ${errorCode} ${errorDescription} ${isMainFrame ? "main" : "frame"} ${validatedUrl}`,
    );
  });
}

async function setExtensionApiBaseUrl(serverUrl: string): Promise<void> {
  if (!currentPanelUrl) return;
  const setupWindow = new BrowserWindow(
    runnerWindowOptions({
      title: "即梦 Web 扩展初始化",
      width: 480,
      height: 360,
      show: false,
    }),
  );
  registerAppWindow(setupWindow, 'untrusted', currentPanelUrl);
  attachWindowLogs(setupWindow, "extension-setup");
  try {
    await setupWindow.loadURL(currentPanelUrl);
    await setupWindow.webContents.executeJavaScript(
      `chrome.storage.local.set({ apiBaseUrl: ${JSON.stringify(serverUrl)}, apiToken: ${JSON.stringify(jimengWebAuthToken())} })`,
      true,
    );
  } finally {
    if (!setupWindow.isDestroyed()) setupWindow.close();
  }
}

async function ensureJimengWindow(): Promise<BrowserWindow> {
  const pageUrl = resolveJimengPageUrl();
  const hasLiveWindow = Boolean(jimengWindow && !jimengWindow.isDestroyed());
  if (jimengRunnerWindowAction(hasLiveWindow) === "reuse" && jimengWindow) {
    jimengWindow.show();
    jimengWindow.focus();
    return jimengWindow;
  }

  jimengWindow = new BrowserWindow(
    runnerWindowOptions({
      title: "即梦 Web 运行器 - Nomi",
      width: 1220,
      height: 860,
      show: true,
    }),
  );
  registerAppWindow(jimengWindow, 'untrusted', pageUrl);
  attachWindowLogs(jimengWindow, "jimeng");
  jimengWindow.on("closed", () => {
    jimengWindow = null;
    drawerReady = false;
  });
  await jimengWindow.loadURL(pageUrl);
  jimengWindow.show();
  return jimengWindow;
}

async function openDrawerInJimengWindow(win: BrowserWindow, timeoutMs = 18_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ready = await win.webContents.executeJavaScript(
        `Boolean(document.getElementById('seedance-drawer-iframe') && document.getElementById('seedance-drawer-toggle'))`,
        true,
      );
      if (ready) {
        await win.webContents.executeJavaScript(
          `(() => { const btn = document.getElementById('seedance-drawer-toggle'); if (btn && btn.textContent !== '✕') btn.click(); return true; })()`,
          true,
        );
        return true;
      }
    } catch (error) {
      rememberLog(error instanceof Error ? error.message : String(error));
    }
    await sleep(500);
  }
  return false;
}

async function ensureFallbackPanelWindow(): Promise<void> {
  if (!currentPanelUrl) return;
  if (fallbackPanelWindow && !fallbackPanelWindow.isDestroyed()) {
    await fallbackPanelWindow.loadURL(currentPanelUrl);
    return;
  }
  fallbackPanelWindow = new BrowserWindow(
    runnerWindowOptions({
      title: "即梦 Web 扩展面板 - Nomi",
      width: 420,
      height: 820,
      show: false,
    }),
  );
  registerAppWindow(fallbackPanelWindow, 'untrusted', currentPanelUrl);
  attachWindowLogs(fallbackPanelWindow, "panel-fallback");
  fallbackPanelWindow.on("closed", () => {
    fallbackPanelWindow = null;
  });
  await fallbackPanelWindow.loadURL(currentPanelUrl);
}

function statusFromState(extensionDir: string | null, clientOnline = false): JimengWebRunnerStatus {
  return {
    available: Boolean(extensionDir),
    running: Boolean(jimengWindow && !jimengWindow.isDestroyed()),
    browserOpen: Boolean(jimengWindow && !jimengWindow.isDestroyed()),
    serverManaged: Boolean(serverProcess && !serverProcess.killed),
    clientOnline,
    engine: "electron",
    drawerReady,
    fallbackPanelOpen: Boolean(fallbackPanelWindow && !fallbackPanelWindow.isDestroyed()),
    extensionDir: extensionDir || undefined,
    userDataDir: extensionDir ? sessionStoragePath() : undefined,
    serverPid: serverProcess?.pid,
    extensionId: currentExtensionId || undefined,
    panelUrl: currentPanelUrl || undefined,
    jimengUrl: jimengWindow && !jimengWindow.isDestroyed()
      ? jimengWindow.webContents.getURL() || resolveJimengPageUrl()
      : resolveJimengPageUrl(),
    error: lastError || undefined,
    lastLog: recentLogs.at(-1),
  };
}

export async function jimengWebRunnerStatus(baseUrlInput?: unknown): Promise<JimengWebRunnerStatus> {
  const serverUrl = resolveJimengWebBaseUrl(baseUrlInput || JIMENG_WEB_VENDOR_SEED.baseUrl);
  const extensionDir = resolveSeedanceExtensionDir();
  const server = await probeJimengWebServer(serverUrl);
  return statusFromState(extensionDir, server.ok && (server.sseClients || 0) > 0);
}

async function startJimengWebRunner(baseUrlInput?: unknown): Promise<JimengWebRunnerStatus> {
  const serverUrl = resolveJimengWebBaseUrl(baseUrlInput || JIMENG_WEB_VENDOR_SEED.baseUrl);
  const extensionDir = resolveSeedanceExtensionDir();
  if (!extensionDir) {
    lastError = `找不到 Seedance 扩展目录。可设置 NOMI_SEEDANCE_EXTENSION_DIR，当前候选：${seedanceExtensionCandidates().join(" | ")}`;
    return statusFromState(null, false);
  }

  try {
    await ensureMockServer(serverUrl, extensionDir);
    await ensureExtensionLoaded(extensionDir);
    await setExtensionApiBaseUrl(serverUrl);
    const win = await ensureJimengWindow();
    drawerReady = await openDrawerInJimengWindow(win);
    let clientOnline = await waitForClient(serverUrl, drawerReady ? 5_000 : 1_000);
    if (!clientOnline) {
      await ensureFallbackPanelWindow();
      clientOnline = await waitForClient(serverUrl, 12_000);
      lastError = drawerReady
        ? "即梦页抽屉已注入，但抽屉 iframe 未建立 SSE；已使用后台扩展面板保持任务连接"
        : "Nomi Electron 已加载扩展，但即梦页抽屉未检测到；已使用后台扩展面板保持任务连接";
    } else {
      lastError = "";
    }
    return statusFromState(extensionDir, clientOnline);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return statusFromState(extensionDir, false);
  }
}

export async function jimengWebStartRunner(baseUrlInput?: unknown): Promise<JimengWebRunnerStatus> {
  if (runnerStartPromise) return runnerStartPromise;
  runnerStartPromise = startJimengWebRunner(baseUrlInput);
  try {
    return await runnerStartPromise;
  } finally {
    runnerStartPromise = null;
  }
}

export function terminateManagedJimengServerProcess(
  proc: ManagedJimengServerProcess | null,
  forceKillAfterMs = 2_000,
): void {
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
  const forceKillTimer = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, forceKillAfterMs);
  forceKillTimer.unref?.();
}

export function disposeJimengWebRunner(): void {
  if (fallbackPanelWindow && !fallbackPanelWindow.isDestroyed()) {
    fallbackPanelWindow.close();
  }
  fallbackPanelWindow = null;
  if (jimengWindow && !jimengWindow.isDestroyed()) {
    jimengWindow.close();
  }
  jimengWindow = null;
  if (currentExtensionId) {
    try {
      jimengWebRunnerSession().removeExtension(currentExtensionId);
    } catch {
      /* ignore */
    }
  }
  loadedExtension = null;
  currentExtensionId = "";
  currentPanelUrl = "";
  drawerReady = false;
  runnerStartPromise = null;
  terminateManagedJimengServerProcess(serverProcess);
  serverProcess = null;
  lastError = "";
}

// Vitest 的 electron mock 只提供被测 API，不一定实现 EventEmitter；正式 Electron
// 仍会注册退出清理，纯模块测试则避免在 import 阶段因 mock 形状不完整而整套失败。
if (typeof app?.on === "function") {
  app.on("before-quit", disposeJimengWebRunner);
}

export async function jimengWebStopRunner(): Promise<JimengWebRunnerStatus> {
  const extensionDir = resolveSeedanceExtensionDir();
  disposeJimengWebRunner();
  return statusFromState(extensionDir, false);
}
