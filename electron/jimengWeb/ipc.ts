import { BrowserWindow, session, shell } from "electron";
import { registerAppWindow } from '../appWindowRegistry';
import { JIMENG_WEB_VENDOR_SEED } from "../catalog/jimengWeb";
import { probeJimengWebServer, resolveJimengWebBaseUrl } from "./seedanceBridge";
import {
  JIMENG_WEB_RUNNER_PARTITION,
  jimengWebRunnerStatus,
  jimengWebStartRunner,
  jimengWebStopRunner,
  type JimengWebRunnerStatus,
} from "./runner";

const JIMENG_HOME_URL = "https://jimeng.jianying.com/ai-tool/home?activeTab=short_video&type=video";

let loginWindow: BrowserWindow | null = null;

function getJimengSession() {
  return session.fromPartition(JIMENG_WEB_RUNNER_PARTITION);
}

async function countJimengCookies(): Promise<number> {
  try {
    const ses = getJimengSession();
    const cookies = await ses.cookies.get({ domain: "jimeng.jianying.com" });
    return cookies.length;
  } catch {
    return 0;
  }
}

export async function jimengWebStatus(): Promise<{
  server: Awaited<ReturnType<typeof probeJimengWebServer>>;
  runner: JimengWebRunnerStatus;
  loginWindowOpen: boolean;
  cookieCount: number;
  likelyLoggedIn: boolean;
  loginUrl: string;
}> {
  const server = await probeJimengWebServer(JIMENG_WEB_VENDOR_SEED.baseUrl);
  const runner = await jimengWebRunnerStatus(JIMENG_WEB_VENDOR_SEED.baseUrl);
  const cookieCount = await countJimengCookies();
  return {
    server,
    runner,
    loginWindowOpen: Boolean(loginWindow && !loginWindow.isDestroyed()),
    cookieCount,
    likelyLoggedIn: cookieCount > 0,
    loginUrl: JIMENG_HOME_URL,
  };
}

export async function jimengWebOpenLogin(): Promise<{ ok: boolean; url: string }> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return { ok: true, url: JIMENG_HOME_URL };
  }
  loginWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    title: "即梦 Web 登录",
    webPreferences: {
      session: getJimengSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.on("closed", () => {
    loginWindow = null;
  });
  registerAppWindow(loginWindow, 'untrusted', JIMENG_HOME_URL);
  await loginWindow.loadURL(JIMENG_HOME_URL);
  loginWindow.show();
  return { ok: true, url: JIMENG_HOME_URL };
}

export async function jimengWebOpenAdmin(baseUrlInput?: unknown): Promise<{ ok: boolean; url: string }> {
  const baseUrl = resolveJimengWebBaseUrl(baseUrlInput || JIMENG_WEB_VENDOR_SEED.baseUrl);
  const url = `${baseUrl}/admin`;
  await shell.openExternal(url);
  return { ok: true, url };
}

export async function jimengWebStartExtensionRunner(): Promise<JimengWebRunnerStatus> {
  return jimengWebStartRunner(JIMENG_WEB_VENDOR_SEED.baseUrl);
}

export async function jimengWebStopExtensionRunner(): Promise<JimengWebRunnerStatus> {
  return jimengWebStopRunner();
}
