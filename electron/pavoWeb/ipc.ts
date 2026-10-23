import { BrowserWindow, session, shell } from "electron";
import { registerAppWindow } from '../appWindowRegistry';
import { probePavoWebServer, resolvePavoWebBaseUrl } from "./bridge";
import {
  PAVO_WEB_RUNNER_PARTITION,
  pavoWebRunnerStatus,
  pavoWebStartRunner,
  pavoWebStopRunner,
  type PavoWebRunnerStatus,
} from "./runner";

const PAVO_URL = "https://app.pavo-ai.cn/";
let loginWindow: BrowserWindow | null = null;

async function cookieCount(): Promise<number> {
  try { return (await session.fromPartition(PAVO_WEB_RUNNER_PARTITION).cookies.get({ domain: "pavo-ai.cn" })).length; }
  catch { return 0; }
}

export async function pavoWebStatus(): Promise<{
  server: Awaited<ReturnType<typeof probePavoWebServer>>;
  runner: PavoWebRunnerStatus;
  loginWindowOpen: boolean;
  cookieCount: number;
  likelyLoggedIn: boolean;
  loginUrl: string;
}> {
  const server = await probePavoWebServer();
  const runner = await pavoWebRunnerStatus();
  const count = await cookieCount();
  return {
    server,
    runner,
    loginWindowOpen: Boolean(loginWindow && !loginWindow.isDestroyed()),
    cookieCount: count,
    likelyLoggedIn: count > 0,
    loginUrl: PAVO_URL,
  };
}

export async function pavoWebOpenLogin(): Promise<{ ok: boolean; url: string }> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return { ok: true, url: PAVO_URL };
  }
  loginWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    title: "Pavo Web",
    webPreferences: {
      session: session.fromPartition(PAVO_WEB_RUNNER_PARTITION),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.on("closed", () => { loginWindow = null; });
  registerAppWindow(loginWindow, 'untrusted', PAVO_URL);
  await loginWindow.loadURL(PAVO_URL);
  loginWindow.show();
  return { ok: true, url: PAVO_URL };
}

export async function pavoWebOpenAdmin(baseUrlInput?: unknown): Promise<{ ok: boolean; url: string }> {
  const baseUrl = resolvePavoWebBaseUrl(baseUrlInput);
  const url = `${baseUrl}/admin`;
  await shell.openExternal(url);
  return { ok: true, url };
}

export async function pavoWebStartExtensionRunner(): Promise<PavoWebRunnerStatus> {
  return pavoWebStartRunner();
}

export async function pavoWebStopExtensionRunner(): Promise<PavoWebRunnerStatus> {
  return pavoWebStopRunner();
}
