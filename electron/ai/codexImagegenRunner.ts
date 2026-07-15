import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hardenedFetch } from "../hardenedFetch";
import { firstString, trim, type JsonRecord } from "../jsonUtils";
import { absolutePathFromLocalAssetUrlAnyProject } from "../assets/localAssetFile";
import { parseDataUrl } from "../assets/assetBytes";
import { contentTypeFromPath, extensionFromMime, extensionFromUrl } from "../assets/assetPaths";
import { getActiveHttpProxyUrl } from "../systemProxy";

export const CODEX_IMG2_GLOBAL_MAX_CONCURRENCY = 2;
const CODEX_IMG2_TEMP_PREFIX = "nomi-codex-img2-";
const CODEX_IMG2_DIAGNOSTIC_MAX_AGE_MS = 24 * 60 * 60_000;
const CODEX_IMG2_TERMINATION_GRACE_MS = 3_000;
const CODEX_IMG2_IDLE_TIMEOUT_MS = 5 * 60_000;
const CODEX_IMG2_NETWORK_RETRY_DELAY_MS = 750;
const CODEX_IMG2_MAX_NETWORK_ATTEMPTS = 2;
const activeCodexChildren = new Set<ChildProcess>();
const activeCodexChildrenByRunKey = new Map<string, ChildProcess>();
const pendingCodexRunKeys = new Set<string>();
const cancelledCodexRunKeys = new Set<string>();
const codexRunWaiters: Array<() => void> = [];
let activeCodexRuns = 0;
let exitCleanupInstalled = false;
let lastDiagnosticCleanupAt = 0;

export type CodexImagegenRequest = {
  prompt: string;
  kind: string;
  extras?: Record<string, unknown> | null;
};

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
  cwd: string;
};

type MaterializedReference = {
  path: string;
};

function mergedNoProxy(env: NodeJS.ProcessEnv): string {
  const values = `${env.NO_PROXY || env.no_proxy || ""},localhost,127.0.0.1,::1`
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(",");
}

function codexChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
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
    if (!entry.isDirectory() || !entry.name.startsWith(CODEX_IMG2_TEMP_PREFIX)) continue;
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
  const bundled = "/Applications/Codex.app/Contents/Resources/codex";
  return fs.existsSync(bundled) ? bundled : "codex";
}

export function collectCodexReferenceUrls(request: CodexImagegenRequest): string[] {
  const extras = request.extras || {};
  const archetypeInput = (
    extras.archetypeInput && typeof extras.archetypeInput === "object" ? extras.archetypeInput : {}
  ) as JsonRecord;
  return Array.from(
    new Set([
      ...readStringArray(archetypeInput.input_urls),
      ...readStringArray(archetypeInput.reference_image_urls),
      ...readStringArray(extras.referenceImages),
      ...readStringArray(extras.referenceImageUrls),
    ]),
  );
}

async function materializeReference(url: string, tempDir: string): Promise<MaterializedReference> {
  const local = absolutePathFromLocalAssetUrlAnyProject(url);
  if (local) return { path: local };
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "png");
    const out = path.join(tempDir, `reference-${Date.now()}.${ext}`);
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
    const out = path.join(tempDir, `reference-${Date.now()}.${ext}`);
    fs.writeFileSync(out, fetched.bytes);
    return { path: out };
  }
  throw new Error(`Codex Img2 不支持的参考图地址：${url.slice(0, 120)}`);
}

async function materializeReferences(urls: readonly string[], tempDir: string): Promise<MaterializedReference[]> {
  const refs: MaterializedReference[] = [];
  for (const url of urls) refs.push(await materializeReference(url, tempDir));
  return refs;
}

function describeAspectRatio(value: string): string {
  if (!value || value === "auto") return "auto";
  return value;
}

export function buildCodexImagegenPrompt(
  request: CodexImagegenRequest,
  outputPath: string,
  referenceCount: number,
): string {
  const extras = request.extras || {};
  const archetypeInput = (
    extras.archetypeInput && typeof extras.archetypeInput === "object" ? extras.archetypeInput : {}
  ) as JsonRecord;
  const aspectRatio = describeAspectRatio(firstString(archetypeInput.aspect_ratio, extras.aspect_ratio, "auto"));
  const resolution = firstString(archetypeInput.resolution, extras.resolution, "1K");
  const mode =
    request.kind === "image_edit" || referenceCount > 0
      ? "edit/reference image generation"
      : "text-to-image generation";
  return [
    "Use built-in imagegen only. Do not use the OpenAI API fallback.",
    "Do not inspect project files, memory, profiles, or other skills. Do not read AGENTS files. Invoke imagegen immediately.",
    `Task: ${mode}.`,
    referenceCount > 0
      ? `Use ${referenceCount} attached image file(s) as references/edit targets.`
      : "No reference images.",
    `Prompt: ${request.prompt}`,
    `Aspect ratio: ${aspectRatio}. Resolution: ${resolution}.`,
    "No watermark. Do not add text unless explicitly requested.",
    `Save/copy the final raster image to: ${outputPath}`,
    `Reply JSON only: {"ok":true,"path":"${outputPath}"} or {"ok":false,"error":"short reason"}.`,
  ]
    .filter(Boolean)
    .join("\n");
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
      env: codexChildEnv(),
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
    const timeoutError = new Error(`Codex Img2 生成超时（${Math.round(timeoutMs / 1000)} 秒）`);
    const idleError = new Error(`Codex Img2 长时间无进展（${Math.round(idleTimeoutMs / 1000)} 秒没有输出）`);
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
  if (result.code === 0) return false;
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

function normalizeAttemptCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CODEX_IMG2_MAX_NETWORK_ATTEMPTS;
  return Math.max(1, Math.min(3, Math.floor(value)));
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
}): Promise<CodexImagegenRunResult> {
  const requestedAt = Date.now();
  const runKey = trim(input.request.extras?.idempotencyKey);
  if (runKey) {
    pendingCodexRunKeys.add(runKey);
    cancelledCodexRunKeys.delete(runKey);
  }
  try {
    return await withCodexRunSlot(async (queueMs) => {
      if (runKey && cancelledCodexRunKeys.has(runKey)) throw new Error("Codex Img2 生成已取消");
      cleanupDiagnosticsPeriodically();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), CODEX_IMG2_TEMP_PREFIX));
      const codexCwd = input.cwd ? path.resolve(input.cwd) : path.join(tempDir, "cwd");
      fs.mkdirSync(codexCwd, { recursive: true });
      const outputPath = path.join(tempDir, "result.png");
      const lastMessagePath = path.join(tempDir, "last-message.txt");
      const stdoutPath = path.join(tempDir, "codex-stdout.jsonl");
      const stderrPath = path.join(tempDir, "codex-stderr.txt");
      const referenceStartedAt = Date.now();
      const references = await materializeReferences(collectCodexReferenceUrls(input.request), tempDir);
      const referenceMs = Date.now() - referenceStartedAt;
      const promptStartedAt = Date.now();
      const prompt = buildCodexImagegenPrompt(input.request, outputPath, references.length);
      const promptBuildMs = Date.now() - promptStartedAt;
      const args = [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "apps",
        "--json",
        "--sandbox",
        "danger-full-access",
        "--skip-git-repo-check",
        "--output-last-message",
        lastMessagePath,
        ...references.flatMap((ref) => ["--image", ref.path]),
      ];
      const execStartedAt = Date.now();
      const timeoutMs = input.timeoutMs ?? 10 * 60_000;
      const idleTimeoutMs = Math.max(0, input.idleTimeoutMs ?? CODEX_IMG2_IDLE_TIMEOUT_MS);
      const maxNetworkAttempts = normalizeAttemptCount(input.maxNetworkAttempts);
      const networkRetryDelayMs = Math.max(0, input.networkRetryDelayMs ?? CODEX_IMG2_NETWORK_RETRY_DELAY_MS);
      let result: ExecResult | null = null;
      let attemptCount = 0;
      try {
        for (let attempt = 1; attempt <= maxNetworkAttempts; attempt += 1) {
          attemptCount = attempt;
          const remainingTimeoutMs = timeoutMs - (Date.now() - execStartedAt);
          if (remainingTimeoutMs <= 0) throw new Error(`Codex Img2 生成超时（${Math.round(timeoutMs / 1000)} 秒）`);
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
            { stdoutPath, stderrPath, append: attempt > 1, attempt },
            runKey,
          );
          if (runKey && cancelledCodexRunKeys.has(runKey)) throw new Error("Codex Img2 生成已取消");
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
      if (!result) throw new Error("Codex Img2 生成失败：没有执行结果");
      const codexExecMs = Date.now() - execStartedAt;
      const verifyStartedAt = Date.now();
      const lastMessage = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, "utf8").trim() : "";
      if (result.code !== 0) {
        throw new Error(
          [
            `Codex Img2 生成失败：codex exec 退出码 ${result.code}`,
            `诊断目录：${tempDir}`,
            `stderr：${stderrPath}`,
            `stdout：${stdoutPath}`,
            (result.stderr || result.stdout).slice(-2000),
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
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
        cwd: codexCwd,
      };
      return { outputPath, lastMessage, tempDir, timings, ...(result.threadId ? { threadId: result.threadId } : {}) };
    });
  } finally {
    if (runKey) {
      pendingCodexRunKeys.delete(runKey);
      cancelledCodexRunKeys.delete(runKey);
      activeCodexChildrenByRunKey.delete(runKey);
    }
  }
}
