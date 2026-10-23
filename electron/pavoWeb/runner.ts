import fs from "node:fs";
import { registerAppWindow } from '../appWindowRegistry';
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, session, type Extension, type Session } from "electron";
import { configureBrowserSession } from "../browser/core/browserViewSession";
import { PAVO_WEB_BRIDGE_INSTANCE_ID, PAVO_WEB_SAFETY_CONTRACT_VERSION } from "../catalog/pavoWeb";
import { probePavoWebServer, resolvePavoWebBaseUrl } from "./bridge";
import { pavoWebAuthToken } from "./auth";

const PAVO_URL = "https://app.pavo-ai.cn/";
export const PAVO_WEB_RUNNER_PARTITION = "persist:nomi-pavo-runner";

export type PavoWebRunnerStatus = {
  available: boolean;
  running: boolean;
  browserOpen: boolean;
  serverManaged: boolean;
  clientOnline: boolean;
  engine: "electron";
  extensionDir?: string;
  userDataDir?: string;
  serverPid?: number;
  extensionId?: string;
  panelUrl?: string;
  pavoUrl: string;
  error?: string;
  lastLog?: string;
};

let serverProcess: ChildProcess | null = null;
let pavoWindow: BrowserWindow | null = null;
let fallbackPanelWindow: BrowserWindow | null = null;
let extension: Extension | null = null;
let extensionId = "";
let panelUrl = "";
let lastError = "";
let startPromise: Promise<PavoWebRunnerStatus> | null = null;
const logs: string[] = [];

function unique(values: Array<string | undefined>): string[] {
  return values.map(value => value?.trim() || "").filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

export function pavoExtensionCandidates(): string[] {
  const appPath = typeof app?.getAppPath === "function" ? app.getAppPath() : process.cwd();
  return unique([
    process.env.NOMI_PAVO_EXTENSION_DIR,
    path.join(appPath, "integrations", "pavo-web-adapter"),
    process.resourcesPath ? path.join(process.resourcesPath, "pavo-web-adapter") : undefined,
  ]);
}

export function resolvePavoExtensionDir(input?: string): string | null {
  for (const candidate of input?.trim() ? [input.trim()] : pavoExtensionCandidates()) {
    try {
      const contract = JSON.parse(fs.readFileSync(path.join(candidate, "contract.json"), "utf8"));
      if (contract.safetyContractVersion === PAVO_WEB_SAFETY_CONTRACT_VERSION
        && fs.existsSync(path.join(candidate, "manifest.json")) && fs.existsSync(path.join(candidate, "mock-server.js"))) return candidate;
    } catch { /* An older external adapter must not bypass the safety contract. */ }
  }
  return null;
}

export function pavoWebRunnerSession(): Session {
  return session.fromPartition(PAVO_WEB_RUNNER_PARTITION);
}

function remember(chunk: Buffer | string): void {
  String(chunk).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(line => logs.push(line));
  while (logs.length > 20) logs.shift();
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitForServer(serverUrl: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if ((await probePavoWebServer(serverUrl)).ok) return;
    await sleep(350);
  }
  throw new Error("Pavo Web 本地任务服务启动超时");
}

async function waitForClient(serverUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await probePavoWebServer(serverUrl);
    if (status.ok && (status.sseClients || 0) > 0) return true;
    await sleep(400);
  }
  return false;
}

export function pavoWebServerProcessEnv(serverUrl: string): NodeJS.ProcessEnv {
  const parsed = new URL(serverUrl);
  const runtimeDir = path.join(app.getPath("userData"), "pavo-web-bridge");
  return {
    ...process.env,
    NOMI_PAVO_WEB_TOKEN: pavoWebAuthToken(),
    NOMI_PAVO_WEB_PARENT_PID: String(process.pid),
    NOMI_PAVO_WEB_PORT: parsed.port || "3458",
    NOMI_PAVO_WEB_INSTANCE_ID: PAVO_WEB_BRIDGE_INSTANCE_ID,
    NOMI_PAVO_WEB_DATA_DIR: process.env.NOMI_PAVO_WEB_DATA_DIR?.trim()
      ? path.resolve(process.env.NOMI_PAVO_WEB_DATA_DIR.trim()) : path.join(runtimeDir, "data"),
    NOMI_PAVO_WEB_UPLOADS_DIR: process.env.NOMI_PAVO_WEB_UPLOADS_DIR?.trim()
      ? path.resolve(process.env.NOMI_PAVO_WEB_UPLOADS_DIR.trim()) : path.join(runtimeDir, "uploads"),
    ELECTRON_RUN_AS_NODE: "1",
  };
}

async function ensureServer(serverUrl: string, extensionDir: string): Promise<void> {
  const existing = await probePavoWebServer(serverUrl);
  if (existing.ok) return;
  if (existing.reachable) throw new Error(`${serverUrl} 已被不兼容的服务占用`);
  if (serverProcess && !serverProcess.killed) return waitForServer(serverUrl);
  const child = spawn(process.env.NOMI_PAVO_WEB_NODE?.trim() || process.execPath, ["mock-server.js"], {
    cwd: extensionDir,
    env: pavoWebServerProcessEnv(serverUrl),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = child;
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);
  child.once("exit", (code, signal) => {
    remember(`pavo bridge exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (serverProcess === child) serverProcess = null;
  });
  await waitForServer(serverUrl);
}

async function ensureExtension(extensionDir: string): Promise<void> {
  const ses = pavoWebRunnerSession();
  extension = ses.extensions.getAllExtensions().find(item => path.resolve(item.path) === path.resolve(extensionDir))
    || await ses.extensions.loadExtension(extensionDir, { allowFileAccess: true });
  extensionId = extension.id;
  panelUrl = new URL("panel.html", extension.url).toString();
}

function windowOptions(show: boolean, title: string, width = 1240, height = 860): Electron.BrowserWindowConstructorOptions {
  return {
    width,
    height,
    show,
    title,
    webPreferences: {
      session: pavoWebRunnerSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
}

async function configureExtension(serverUrl: string): Promise<void> {
  if (!fallbackPanelWindow || fallbackPanelWindow.isDestroyed()) {
    fallbackPanelWindow = new BrowserWindow(windowOptions(false, "Pavo Adapter 后台面板", 420, 820));
    fallbackPanelWindow.on("closed", () => { fallbackPanelWindow = null; });
    const configUrl = new URL("config.html", extension?.url || panelUrl).toString();
    registerAppWindow(fallbackPanelWindow, 'untrusted', configUrl);
    await fallbackPanelWindow.loadURL(configUrl);
  }
  await fallbackPanelWindow.webContents.executeJavaScript(
    `new Promise((resolve, reject) => chrome.storage.local.set(
      { apiBaseUrl: ${JSON.stringify(serverUrl)}, apiToken: ${JSON.stringify(pavoWebAuthToken())} },
      () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true)
    ))`,
    true,
  );
  if (fallbackPanelWindow.webContents.getURL() !== panelUrl) await fallbackPanelWindow.loadURL(panelUrl);
}

async function ensurePavoWindow(): Promise<void> {
  if (pavoWindow && !pavoWindow.isDestroyed()) {
    pavoWindow.show();
    pavoWindow.focus();
    return;
  }
  pavoWindow = new BrowserWindow(windowOptions(true, "Pavo Web - Nomi"));
  registerAppWindow(pavoWindow, 'untrusted', PAVO_URL);
  pavoWindow.webContents.on("console-message", (details) => {
    const message = details.message;
    if (/Pavo|Bridge|error|failed/i.test(message)) remember(`[pavo] ${message}`);
  });
  pavoWindow.on("closed", () => { pavoWindow = null; });
  let lastLoadError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await pavoWindow.loadURL(PAVO_URL);
      lastLoadError = null;
      break;
    } catch (error) {
      lastLoadError = error;
      await sleep(900);
      try {
        const rendered = await pavoWindow.webContents.executeJavaScript(
          `location.hostname === "app.pavo-ai.cn" && document.body && document.body.childElementCount > 0`,
          true,
        );
        if (rendered) {
          lastLoadError = null;
          break;
        }
      } catch { /* retry below */ }
    }
  }
  if (lastLoadError) throw lastLoadError;
  pavoWindow.show();
}

async function ensureFallbackPanel(): Promise<void> {
  if (fallbackPanelWindow && !fallbackPanelWindow.isDestroyed()) return;
  fallbackPanelWindow = new BrowserWindow(windowOptions(false, "Pavo Adapter 后台面板", 420, 820));
  registerAppWindow(fallbackPanelWindow, 'untrusted', panelUrl);
  fallbackPanelWindow.on("closed", () => { fallbackPanelWindow = null; });
  await fallbackPanelWindow.loadURL(panelUrl);
}

function status(extensionDir: string | null, clientOnline: boolean): PavoWebRunnerStatus {
  let userDataDir: string | undefined;
  let pavoUrl = PAVO_URL;
  try { userDataDir = pavoWebRunnerSession().getStoragePath() || undefined; } catch { /* unavailable in tests */ }
  try {
    if (pavoWindow && !pavoWindow.isDestroyed() && !pavoWindow.webContents.isDestroyed()) {
      pavoUrl = pavoWindow.webContents.getURL() || PAVO_URL;
    }
  } catch { /* window may be closing while status is collected */ }
  return {
    available: Boolean(extensionDir),
    running: Boolean(pavoWindow && !pavoWindow.isDestroyed()),
    browserOpen: Boolean(pavoWindow && !pavoWindow.isDestroyed()),
    serverManaged: Boolean(serverProcess && !serverProcess.killed),
    clientOnline,
    engine: "electron",
    extensionDir: extensionDir || undefined,
    userDataDir,
    serverPid: serverProcess?.pid,
    extensionId: extensionId || undefined,
    panelUrl: panelUrl || undefined,
    pavoUrl,
    error: lastError || undefined,
    lastLog: logs.at(-1),
  };
}

export async function pavoWebRunnerStatus(baseUrlInput?: unknown): Promise<PavoWebRunnerStatus> {
  const serverUrl = resolvePavoWebBaseUrl(baseUrlInput);
  const extensionDir = resolvePavoExtensionDir();
  const bridge = await probePavoWebServer(serverUrl);
  return status(extensionDir, bridge.ok && (bridge.sseClients || 0) > 0);
}

async function start(baseUrlInput?: unknown): Promise<PavoWebRunnerStatus> {
  const serverUrl = resolvePavoWebBaseUrl(baseUrlInput);
  const extensionDir = resolvePavoExtensionDir();
  if (!extensionDir) {
    lastError = `找不到 Pavo 扩展目录。可设置 NOMI_PAVO_EXTENSION_DIR，当前候选：${pavoExtensionCandidates().join(" | ")}`;
    return status(null, false);
  }
  try {
    await ensureServer(serverUrl, extensionDir);
    await configureBrowserSession(pavoWebRunnerSession());
    await ensureExtension(extensionDir);
    await configureExtension(serverUrl);
    await ensurePavoWindow();
    // 配置页不运行任务面板，因此不会抢占唯一消费者锁或建立短暂 SSE。
    await ensureFallbackPanel();
    const clientOnline = await waitForClient(serverUrl, 10_000);
    lastError = clientOnline ? "" : "Pavo 扩展已加载，但任务面板没有建立 SSE 连接";
    return status(extensionDir, clientOnline);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return status(extensionDir, false);
  }
}

export async function pavoWebStartRunner(baseUrlInput?: unknown): Promise<PavoWebRunnerStatus> {
  if (startPromise) return startPromise;
  startPromise = start(baseUrlInput);
  try { return await startPromise; }
  finally { startPromise = null; }
}

export function disposePavoWebRunner(): void {
  fallbackPanelWindow?.close();
  fallbackPanelWindow = null;
  pavoWindow?.close();
  pavoWindow = null;
  if (extensionId) {
    try { pavoWebRunnerSession().extensions.removeExtension(extensionId); } catch { /* ignore */ }
  }
  extension = null;
  extensionId = "";
  panelUrl = "";
  startPromise = null;
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
  serverProcess = null;
  lastError = "";
}

if (typeof app?.on === "function") app.on("before-quit", disposePavoWebRunner);

export async function pavoWebStopRunner(): Promise<PavoWebRunnerStatus> {
  const extensionDir = resolvePavoExtensionDir();
  disposePavoWebRunner();
  return status(extensionDir, false);
}
