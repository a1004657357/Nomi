import { desktopT } from "../desktopStrings";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hardenedFetch } from "../hardenedFetch";
import { trim, type JsonRecord } from "../jsonUtils";
import { absolutePathFromLocalAssetUrlAnyProject } from "../assets/localAssetFile";
import { parseDataUrl } from "../assets/assetBytes";
import { contentTypeFromPath, extensionFromMime, extensionFromUrl } from "../assets/assetPaths";
import { getActiveHttpProxyUrl } from "../systemProxy";
import { recoverGeneratedImageFromCodexHome } from "./codexImagegenRecovery";
import {
  auditCodexImagegenInvocations,
  buildCodexImagegenPrompt,
  validateCodexGeneratedImage,
  type CodexImagegenPromptReference,
  type CodexImagegenRequest,
} from "./codexImagegenPolicy";

export { buildCodexImagegenPrompt } from "./codexImagegenPolicy";
export type { CodexImagegenPromptReference, CodexImagegenRequest } from "./codexImagegenPolicy";

// ChatGPT image edits are not reliably parallel for the same local session:
// real batches showed one of each two concurrent requests failing at the network layer.
export const CODEX_IMG2_GLOBAL_MAX_CONCURRENCY = 1;
const CODEX_IMG2_TEMP_PREFIX = "nomi-codex-img2-";
const CODEX_IMG2_HOME_TEMP_PREFIX = "nomi-codex-home-";
const CODEX_IMG2_DIAGNOSTIC_MAX_AGE_MS = 24 * 60 * 60_000;
const CODEX_IMG2_TERMINATION_GRACE_MS = 3_000;
// `codex exec --json` may legitimately stay silent for several minutes while
// image generation is in flight. The hard timeout still bounds every run;
// an idle timeout is opt-in for diagnostics/tests only.
const CODEX_IMG2_IDLE_TIMEOUT_MS = 0;
const CODEX_IMG2_DEFAULT_TIMEOUT_MS = 10 * 60_000;
const CODEX_IMG2_NETWORK_RETRY_DELAY_MS = 750;
// A retry can create a second paid image request after the first request's
// outcome became ambiguous. Default to one attempt; callers must opt in.
const CODEX_IMG2_MAX_NETWORK_ATTEMPTS = 1;
const activeCodexChildren = new Set<ChildProcess>();
const activeCodexChildrenByRunKey = new Map<string, ChildProcess>();
const pendingCodexRunKeys = new Set<string>();
const cancelledCodexRunKeys = new Set<string>();
const codexRunWaiters: Array<() => void> = [];
let activeCodexRuns = 0;
let exitCleanupInstalled = false;
let lastDiagnosticCleanupAt = 0;

export type CodexImagegenRunResult = {
  outputPath: string;
  lastMessage: string;
  tempDir: string;
  timings: CodexImagegenTimings;
  threadId?: string;
};

export type CodexImagegenTimings = {
  queueMs: number;
  referenceMs: number;
  promptBuildMs: number;
  codexExecMs: number;
  outputVerifyMs: number;
  totalMs: number;
  referenceCount: number;
  attemptCount: number;
  imagegenInvocationCount: number;
  imagegenInvocationAudit: "verified" | "unobservable";
  cwd: string;
};

type MaterializedReference = CodexImagegenPromptReference;

type CollectedReference = {
  url: string;
  role?: string;
  purpose?: string;
};

function mergedNoProxy(env: NodeJS.ProcessEnv): string {
  const values = `${env.NO_PROXY || env.no_proxy || ""},localhost,127.0.0.1,::1`
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(",");
}

function codexChildEnv(codexHome?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (codexHome) env.CODEX_HOME = codexHome;
  const proxyUrl = getActiveHttpProxyUrl();
  if (proxyUrl) {
    env.HTTPS_PROXY ||= proxyUrl;
    env.HTTP_PROXY ||= proxyUrl;
    env.ALL_PROXY ||= proxyUrl;
    env.https_proxy ||= env.HTTPS_PROXY;
    env.http_proxy ||= env.HTTP_PROXY;
    env.all_proxy ||= env.ALL_PROXY;
  }
  const noProxy = mergedNoProxy(env);
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  env.TERM = env.TERM && env.TERM !== "dumb" ? env.TERM : "xterm-256color";
  return env;
}

async function withCodexRunSlot<T>(work: (queueMs: number) => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  if (activeCodexRuns >= CODEX_IMG2_GLOBAL_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => codexRunWaiters.push(resolve));
  }
  activeCodexRuns += 1;
  try {
    return await work(Date.now() - queuedAt);
  } finally {
    activeCodexRuns = Math.max(0, activeCodexRuns - 1);
    codexRunWaiters.shift()?.();
  }
}

function signalCodexChild(child: ChildProcess, signal: NodeJS.Signals): boolean {
  const pid = child.pid;
  if (process.platform !== "win32" && typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // A mocked/non-group child or an already-exited group falls back to the direct child.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function trackCodexChild(child: ChildProcess, runKey?: string): void {
  activeCodexChildren.add(child);
  if (runKey) activeCodexChildrenByRunKey.set(runKey, child);
  const remove = () => {
    activeCodexChildren.delete(child);
    if (runKey && activeCodexChildrenByRunKey.get(runKey) === child) activeCodexChildrenByRunKey.delete(runKey);
  };
  child.once("close", remove);
  child.once("error", remove);
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.once("exit", () => terminateAllCodexImagegenProcesses("SIGKILL"));
  }
}

export function terminateAllCodexImagegenProcesses(signal: NodeJS.Signals = "SIGTERM"): number {
  let signalled = 0;
  for (const child of activeCodexChildren) {
    if (signalCodexChild(child, signal)) signalled += 1;
  }
  return signalled;
}

export function cancelCodexImageGeneration(runKeyInput: string): boolean {
  const runKey = trim(runKeyInput);
  if (!runKey || (!pendingCodexRunKeys.has(runKey) && !activeCodexChildrenByRunKey.has(runKey))) return false;
  cancelledCodexRunKeys.add(runKey);
  const child = activeCodexChildrenByRunKey.get(runKey);
  if (child) signalCodexChild(child, "SIGTERM");
  return true;
}

export function cleanupStaleCodexImagegenTempDirs(
  input: {
    rootDir?: string;
    now?: number;
    maxAgeMs?: number;
  } = {},
): number {
  const rootDir = input.rootDir || os.tmpdir();
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? CODEX_IMG2_DIAGNOSTIC_MAX_AGE_MS;
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      (!entry.name.startsWith(CODEX_IMG2_TEMP_PREFIX) && !entry.name.startsWith(CODEX_IMG2_HOME_TEMP_PREFIX))
    )
      continue;
    const target = path.join(rootDir, entry.name);
    try {
      if (now - fs.statSync(target).mtimeMs <= maxAgeMs) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Diagnostic cleanup is best-effort and must never block generation.
    }
  }
  return removed;
}

function cleanupDiagnosticsPeriodically(now = Date.now()): void {
  if (now - lastDiagnosticCleanupAt < 60 * 60_000) return;
  lastDiagnosticCleanupAt = now;
  cleanupStaleCodexImagegenTempDirs({ now });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trim(item)).filter(Boolean);
}

function codexBinary(): string {
  const configured = trim(process.env.NOMI_CODEX_BIN || process.env.CODEX_BIN);
  if (configured) return configured;
  const bundled = [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ].find((candidate) => fs.existsSync(candidate));
  return bundled || "codex";
}

type IsolatedCodexHome = {
  path: string;
  cleanup: () => void;
};

export function prepareIsolatedCodexHome(
  input: {
    sourceHome?: string;
    tempRoot?: string;
  } = {},
): IsolatedCodexHome | null {
  const sourceHome = path.resolve(
    input.sourceHome || trim(process.env.CODEX_HOME) || path.join(os.homedir(), ".codex"),
  );
  const authPath = path.join(sourceHome, "auth.json");
  if (!fs.existsSync(authPath)) return null;

  const isolatedHome = fs.mkdtempSync(path.join(input.tempRoot || os.tmpdir(), CODEX_IMG2_HOME_TEMP_PREFIX));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  try {
    fs.chmodSync(isolatedHome, 0o700);
    fs.symlinkSync(authPath, path.join(isolatedHome, "auth.json"), "file");
    for (const fileName of ["models_cache.json", "installation_id", "version.json"]) {
      const sourcePath = path.join(sourceHome, fileName);
      if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(isolatedHome, fileName));
    }
    return { path: isolatedHome, cleanup };
  } catch {
    cleanup();
    return null;
  }
}

export function collectCodexReferenceUrls(request: CodexImagegenRequest): string[] {
  return collectCodexReferences(request).map((reference) => reference.url);
}

function collectCodexReferences(request: CodexImagegenRequest): CollectedReference[] {
  const extras = request.extras || {};
  const archetypeInput = (
    extras.archetypeInput && typeof extras.archetypeInput === "object" ? extras.archetypeInput : {}
  ) as JsonRecord;
  const urls = Array.from(
    new Set([
      ...readStringArray(archetypeInput.input_urls),
      ...readStringArray(archetypeInput.reference_image_urls),
      ...readStringArray(extras.referenceImages),
      ...readStringArray(extras.referenceImageUrls),
    ]),
  );
  const standardUrls = readStringArray(extras.referenceImages);
  const roles = Array.isArray(extras.referenceImageRoles) ? extras.referenceImageRoles.map((value) => trim(value)) : [];
  const purposes = Array.isArray(extras.referenceImagePurposes)
    ? extras.referenceImagePurposes.map((value) => trim(value))
    : [];
  const roleByUrl = new Map<string, string>();
  const purposeByUrl = new Map<string, string>();
  standardUrls.forEach((url, index) => {
    if (roles[index]) roleByUrl.set(url, roles[index]);
    if (purposes[index]) purposeByUrl.set(url, purposes[index]);
  });
  return urls.map((url, index) => ({
    url,
    ...(roleByUrl.get(url) || roles[index] ? { role: roleByUrl.get(url) || roles[index] } : {}),
    ...(purposeByUrl.get(url) || purposes[index] ? { purpose: purposeByUrl.get(url) || purposes[index] } : {}),
  }));
}

async function materializeReference(url: string, tempDir: string, index: number): Promise<MaterializedReference> {
  const local = absolutePathFromLocalAssetUrlAnyProject(url);
  if (local) return { path: local };
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "png");
    const out = path.join(tempDir, `reference-${index + 1}.${ext}`);
    fs.writeFileSync(out, parsed.bytes);
    return { path: out };
  }
  if (/^https?:\/\//i.test(url)) {
    const fetched = await hardenedFetch(url, {
      timeoutMs: 60_000,
      maxBytes: 50 * 1024 * 1024,
      allowContentTypes: ["image/", "application/octet-stream"],
    });
    const contentType = fetched.contentType || contentTypeFromPath(url);
    const ext = extensionFromMime(contentType, extensionFromUrl(url) || "png");
    const out = path.join(tempDir, `reference-${index + 1}.${ext}`);
    fs.writeFileSync(out, fetched.bytes);
    return { path: out };
  }
  throw new Error(desktopT("custom.ai.codexImagegenRunner.text1", { value0: `${url.slice(0, 120)}` }));
}

async function materializeReferences(
  references: readonly CollectedReference[],
  tempDir: string,
): Promise<MaterializedReference[]> {
  const refs: MaterializedReference[] = [];
  for (const [index, reference] of references.entries()) {
    refs.push({
      ...(await materializeReference(reference.url, tempDir, index)),
      ...(reference.role ? { role: reference.role } : {}),
      ...(reference.purpose ? { purpose: reference.purpose } : {}),
    });
  }
  return refs;
}

type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  threadId?: string;
};

type ExecDiagnostics = {
  stdoutPath: string;
  stderrPath: string;
  append?: boolean;
  attempt?: number;
};

function parseThreadIdFromJsonl(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as { type?: string; thread_id?: string };
      if (parsed?.type === "thread.started" && parsed.thread_id) return parsed.thread_id;
    } catch {
      // ignore non-JSON progress lines
    }
  }
  return undefined;
}

function appendDiagnostic(filePath: string, chunk: string): void {
  try {
    fs.appendFileSync(filePath, chunk);
  } catch {
    // Diagnostics are best-effort; keep the generation failure as the primary error.
  }
}

function runCodexExec(
  args: string[],
  promptInput: string,
  cwd: string,
  timeoutMs: number,
  idleTimeoutMs: number,
  terminationGraceMs: number,
  codexHome?: string,
  diagnostics?: ExecDiagnostics,
  runKey?: string,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (diagnostics) {
      if (diagnostics.append) {
        const marker = `\n--- attempt ${diagnostics.attempt || 2} ---\n`;
        appendDiagnostic(diagnostics.stdoutPath, marker);
        appendDiagnostic(diagnostics.stderrPath, marker);
      } else {
        fs.writeFileSync(diagnostics.stdoutPath, "");
        fs.writeFileSync(diagnostics.stderrPath, "");
      }
    }
    const child = spawn(codexBinary(), args, {
      cwd,
      env: codexChildEnv(codexHome),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    trackCodexChild(child, runKey);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let terminationError: Error | null = null;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let forceSettleTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    const timeoutError = new Error(tagNomiError("codex-timeout", desktopT("custom.ai.codexImagegenRunner.text2", { value0: `${Math.round(timeoutMs / 1000)}` })));
    const idleError = new Error(tagNomiError("codex-timeout", desktopT("custom.ai.codexImagegenRunner.text3", { value0: `${Math.round(idleTimeoutMs / 1000)}` })));
    const clearTimers = () => {
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    const resolveOnce = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };
    const beginTermination = (error: Error) => {
      if (terminationError) return;
      terminationError = error;
      timedOut = true;
      signalCodexChild(child, "SIGTERM");
      forceKillTimer = setTimeout(
        () => {
          signalCodexChild(child, "SIGKILL");
          forceSettleTimer = setTimeout(() => rejectOnce(error), Math.max(25, terminationGraceMs));
        },
        Math.max(0, terminationGraceMs),
      );
    };
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (idleTimeoutMs > 0) idleTimer = setTimeout(() => beginTermination(idleError), idleTimeoutMs);
    };
    const timer = setTimeout(() => beginTermination(timeoutError), timeoutMs);
    resetIdleTimer();
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      resetIdleTimer();
      if (diagnostics) appendDiagnostic(diagnostics.stdoutPath, text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      resetIdleTimer();
      if (diagnostics) appendDiagnostic(diagnostics.stderrPath, text);
    });
    child.stdin?.on("error", () => {
      // If Codex exits early, preserve the process error/exit code as the primary signal.
    });
    child.on("error", (error) => {
      rejectOnce(terminationError || error);
    });
    child.on("close", (code) => {
      if (timedOut) {
        rejectOnce(terminationError || timeoutError);
        return;
      }
      resolveOnce({ code, stdout, stderr, threadId: parseThreadIdFromJsonl(stdout) });
    });
    child.stdin?.end(promptInput);
  });
}

function isRetryableCodexNetworkFailure(result: ExecResult): boolean {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    detail.includes("error sending request") ||
    detail.includes("network error") ||
    detail.includes("connection reset") ||
    detail.includes("connection closed") ||
    detail.includes("temporarily unavailable") ||
    detail.includes("unexpected eof")
  );
}

function reportedCodexImagegenError(lastMessage: string): string {
  try {
    const parsed = JSON.parse(lastMessage) as { ok?: boolean; error?: unknown };
    if (parsed?.ok === false) return trim(parsed.error);
  } catch {
    // The final message is not required to be JSON.
  }
  return "";
}

function reportedErrorAllowsOutputRecovery(message: string): boolean {
  return /(?:saved|written|copied|generated).{0,80}(?:different|another|other).{0,40}(?:path|location)/i.test(message);
}

function normalizeAttemptCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CODEX_IMG2_MAX_NETWORK_ATTEMPTS;
  return Math.max(1, Math.min(3, Math.floor(value)));
}

export function resolveCodexImagegenTimeoutMs(
  inputTimeoutMs: number | undefined,
  envTimeoutMs = process.env.NOMI_CODEX_IMG2_TIMEOUT_MS,
): number {
  if (typeof inputTimeoutMs === "number" && Number.isFinite(inputTimeoutMs) && inputTimeoutMs > 0) {
    return Math.floor(inputTimeoutMs);
  }
  const parsedEnvTimeoutMs = Number(envTimeoutMs);
  if (Number.isFinite(parsedEnvTimeoutMs) && parsedEnvTimeoutMs > 0) {
    return Math.floor(parsedEnvTimeoutMs);
  }
  return CODEX_IMG2_DEFAULT_TIMEOUT_MS;
}

export function resolveCodexImagegenIdleTimeoutMs(inputIdleTimeoutMs: number | undefined): number {
  if (typeof inputIdleTimeoutMs === "number" && Number.isFinite(inputIdleTimeoutMs)) {
    return Math.max(0, Math.floor(inputIdleTimeoutMs));
  }
  return CODEX_IMG2_IDLE_TIMEOUT_MS;
}

async function waitForNetworkRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runCodexImageGeneration(input: {
  request: CodexImagegenRequest;
  cwd?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  terminationGraceMs?: number;
  maxNetworkAttempts?: number;
  networkRetryDelayMs?: number;
  validateOutput?: (outputPath: string) => Promise<void>;
}): Promise<CodexImagegenRunResult> {
  const requestedAt = Date.now();
  const runKey = trim(input.request.extras?.idempotencyKey);
  if (runKey) {
    pendingCodexRunKeys.add(runKey);
    cancelledCodexRunKeys.delete(runKey);
  }
  try {
    return await withCodexRunSlot(async (queueMs) => {
      if (runKey && cancelledCodexRunKeys.has(runKey)) throw new Error(desktopT("custom.ai.codexImagegenRunner.text4"));
      cleanupDiagnosticsPeriodically();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), CODEX_IMG2_TEMP_PREFIX));
      const codexCwd = input.cwd ? path.resolve(input.cwd) : path.join(tempDir, "cwd");
      fs.mkdirSync(codexCwd, { recursive: true });
      const outputPath = path.join(tempDir, "result.png");
      const lastMessagePath = path.join(tempDir, "last-message.txt");
      const stdoutPath = path.join(tempDir, "codex-stdout.jsonl");
      const stderrPath = path.join(tempDir, "codex-stderr.txt");
      const referenceStartedAt = Date.now();
      const references = await materializeReferences(collectCodexReferences(input.request), tempDir);
      const referenceMs = Date.now() - referenceStartedAt;
      const promptStartedAt = Date.now();
      const prompt = buildCodexImagegenPrompt(input.request, outputPath, references);
      const promptBuildMs = Date.now() - promptStartedAt;
      const isolatedCodexHome = prepareIsolatedCodexHome();
      if (!isolatedCodexHome) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        throw new Error(
          desktopT("custom.ai.codexImagegenRunner.text5"),
        );
      }
      const configuredModel = trim(process.env.NOMI_CODEX_IMG2_MODEL);
      const args = [
        "--ask-for-approval",
        "never",
        "exec",
        ...(configuredModel ? ["--model", configuredModel] : []),
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--enable",
        "image_generation",
        "--disable",
        "apps",
        "--disable",
        "code_mode_host",
        "--disable",
        "code_mode",
        "--json",
        "--sandbox",
        "danger-full-access",
        "--skip-git-repo-check",
        "--output-last-message",
        lastMessagePath,
        ...references.flatMap((ref) => ["--image", ref.path]),
      ];
      const execStartedAt = Date.now();
      const timeoutMs = resolveCodexImagegenTimeoutMs(input.timeoutMs);
      const idleTimeoutMs = resolveCodexImagegenIdleTimeoutMs(input.idleTimeoutMs);
      const maxNetworkAttempts = normalizeAttemptCount(input.maxNetworkAttempts);
      const networkRetryDelayMs = Math.max(0, input.networkRetryDelayMs ?? CODEX_IMG2_NETWORK_RETRY_DELAY_MS);
      let result: ExecResult | null = null;
      let attemptCount = 0;
      try {
        try {
          for (let attempt = 1; attempt <= maxNetworkAttempts; attempt += 1) {
            attemptCount = attempt;
            const remainingTimeoutMs = timeoutMs - (Date.now() - execStartedAt);
            if (remainingTimeoutMs <= 0) throw new Error(tagNomiError("codex-timeout", desktopT("custom.ai.codexImagegenRunner.text6", { value0: `${Math.round(timeoutMs / 1000)}` })));
            if (attempt > 1) {
              try {
                fs.rmSync(outputPath, { force: true });
              } catch {
                /* ignore */
              }
              try {
                fs.rmSync(lastMessagePath, { force: true });
              } catch {
                /* ignore */
              }
            }
            result = await runCodexExec(
              args,
              prompt,
              codexCwd,
              remainingTimeoutMs,
              idleTimeoutMs > 0 && idleTimeoutMs < remainingTimeoutMs ? idleTimeoutMs : 0,
              input.terminationGraceMs ?? CODEX_IMG2_TERMINATION_GRACE_MS,
              isolatedCodexHome.path,
              { stdoutPath, stderrPath, append: attempt > 1, attempt },
              runKey,
            );
            if (runKey && cancelledCodexRunKeys.has(runKey)) throw new Error(desktopT("custom.ai.codexImagegenRunner.text7"));
            if (!isRetryableCodexNetworkFailure(result) || attempt >= maxNetworkAttempts || fs.existsSync(outputPath))
              break;
            await waitForNetworkRetry(Math.min(networkRetryDelayMs, Math.max(0, remainingTimeoutMs - 1)));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            [message, `诊断目录：${tempDir}`, `stderr：${stderrPath}`, `stdout：${stdoutPath}`]
              .filter(Boolean)
              .join("\n"),
            { cause: error },
          );
        }
        if (!result) throw new Error(desktopT("custom.ai.codexImagegenRunner.text8"));
        const codexExecMs = Date.now() - execStartedAt;
        const verifyStartedAt = Date.now();
        const lastMessage = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, "utf8").trim() : "";
        if (result.code !== 0) {
          const failureMessage = [
            `Codex Img2 生成失败：codex exec 退出码 ${result.code}`,
            `诊断目录：${tempDir}`,
            `stderr：${stderrPath}`,
            `stdout：${stdoutPath}`,
            (result.stderr || result.stdout).slice(-2000),
          ]
            .filter(Boolean)
            .join("\n");
          throw new Error(isRetryableCodexNetworkFailure(result) ? tagNomiError("codex-network", failureMessage) : failureMessage);
        }
        const hasRequestedOutput = fs.existsSync(outputPath) && fs.statSync(outputPath).isFile();
        if (!hasRequestedOutput && isRetryableCodexNetworkFailure(result)) {
          throw new Error(
            tagNomiError("codex-network", [
              "Codex Img2 网络请求失败：ChatGPT 图片服务没有返回图片。本次没有自动重试，避免重复提交或重复计费。",
              `诊断目录：${tempDir}`,
              `stderr：${stderrPath}`,
              `stdout：${stdoutPath}`,
            ].join("\n")),
          );
        }
        const reportedError = reportedCodexImagegenError(lastMessage);
        if (!hasRequestedOutput && reportedError && !reportedErrorAllowsOutputRecovery(reportedError)) {
          throw new Error(
            [
              `Codex Img2 生成失败：${reportedError}`,
              "本次没有自动重试，避免重复提交或重复计费。",
              `诊断目录：${tempDir}`,
              `stderr：${stderrPath}`,
              `stdout：${stdoutPath}`,
            ].join("\n"),
          );
        }
        const resolvedOutputPath = hasRequestedOutput
          ? outputPath
          : await recoverGeneratedImageFromCodexHome(isolatedCodexHome.path, outputPath, execStartedAt);
        if (!resolvedOutputPath || !fs.existsSync(resolvedOutputPath) || !fs.statSync(resolvedOutputPath).isFile()) {
          throw new Error(
            [
              `Codex Img2 生成失败：没有生成目标文件 ${outputPath}`,
              `诊断目录：${tempDir}`,
              `stderr：${stderrPath}`,
              `stdout：${stdoutPath}`,
              lastMessage || result.stdout.slice(-2000),
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        const invocationAudit = auditCodexImagegenInvocations(result.stdout, result.stderr);
        if (invocationAudit.retryDetected || invocationAudit.count > 1) {
          throw new Error(
            [
              invocationAudit.retryDetected
                ? "Codex Img2 检测到 imagegen 内部重试，已按单次提交策略拒绝结果"
                : `Codex Img2 检测到 imagegen 调用了 ${invocationAudit.count} 次，已拒绝可能重复计费的结果`,
              `诊断目录：${tempDir}`,
              `stderr：${stderrPath}`,
              `stdout：${stdoutPath}`,
            ].join("\n"),
          );
        }
        try {
          await (input.validateOutput || ((candidate) => validateCodexGeneratedImage(candidate, input.request)))(
            resolvedOutputPath,
          );
        } catch (error) {
          throw new Error(
            [
              error instanceof Error ? error.message : String(error),
              `诊断目录：${tempDir}`,
              `stderr：${stderrPath}`,
              `stdout：${stdoutPath}`,
            ].join("\n"),
            { cause: error },
          );
        }
        const outputVerifyMs = Date.now() - verifyStartedAt;
        const timings: CodexImagegenTimings = {
          queueMs,
          referenceMs,
          promptBuildMs,
          codexExecMs,
          outputVerifyMs,
          totalMs: Date.now() - requestedAt,
          referenceCount: references.length,
          attemptCount,
          imagegenInvocationCount: invocationAudit.count,
          imagegenInvocationAudit: invocationAudit.status,
          cwd: codexCwd,
        };
        return {
          outputPath: resolvedOutputPath,
          lastMessage,
          tempDir,
          timings,
          ...(result.threadId ? { threadId: result.threadId } : {}),
        };
      } finally {
        isolatedCodexHome.cleanup();
      }
    });
  } finally {
    if (runKey) {
      pendingCodexRunKeys.delete(runKey);
      cancelledCodexRunKeys.delete(runKey);
      activeCodexChildrenByRunKey.delete(runKey);
    }
  }
}
