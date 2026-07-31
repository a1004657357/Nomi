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
const CODEX_IMG2_HOME_TEMP_PREFIX = "nomi-codex-home-";
const CODEX_IMG2_DIAGNOSTIC_MAX_AGE_MS = 24 * 60 * 60_000;
const CODEX_IMG2_TERMINATION_GRACE_MS = 3_000;
const CODEX_IMG2_IDLE_TIMEOUT_MS = 5 * 60_000;
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
    "Use the built-in image_gen.imagegen tool only. Do not use the OpenAI API fallback.",
    "Invoke image_gen.imagegen exactly once. If that call fails, times out, or reports a network/service error, do not retry; return the failure immediately.",
    "Do not inspect project files, memory, profiles, or other skills. Do not read AGENTS files. Invoke image_gen.imagegen immediately.",
    `Task: ${mode}.`,
    referenceCount > 0
      ? `Use ${referenceCount} attached image file(s) as references/edit targets. Pass every attached local path through referenced_image_paths; do not use num_last_images_to_include.`
      : "No reference images. This is a brand-new image: omit both referenced_image_paths and num_last_images_to_include entirely. Never pass either field as 0, null, or an empty array.",
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

async function waitForNetworkRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const RECOVERABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

function recoverGeneratedImageFromCodexHome(
  codexHome: string,
  requestedOutputPath: string,
  generatedAfterMs: number,
): string | null {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: codexHome, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < 2_000) {
    const current = pending.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const candidatePath = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 6) {
        pending.push({ dir: candidatePath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !RECOVERABLE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const stat = fs.statSync(candidatePath);
        if (stat.size > 0 && stat.mtimeMs >= generatedAfterMs - 5_000) {
          candidates.push({ path: candidatePath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore files that disappear while Codex is finalizing its output.
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const source = candidates[0]?.path;
  if (!source) return null;
  const ext = path.extname(source).toLowerCase() || ".png";
  const recoveredPath = path.join(path.dirname(requestedOutputPath), `result-recovered${ext}`);
  fs.copyFileSync(source, recoveredPath);
  return recoveredPath;
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
      const isolatedCodexHome = prepareIsolatedCodexHome();
      if (!isolatedCodexHome) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        throw new Error(
          "Codex Img2 未检测到 ChatGPT/Codex 登录状态。请先打开 ChatGPT 或 Codex 完成登录，再回到 Nomi 重试；无需填写 API Key。",
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
      const idleTimeoutMs = Math.max(0, input.idleTimeoutMs ?? CODEX_IMG2_IDLE_TIMEOUT_MS);
      const maxNetworkAttempts = normalizeAttemptCount(input.maxNetworkAttempts);
      const networkRetryDelayMs = Math.max(0, input.networkRetryDelayMs ?? CODEX_IMG2_NETWORK_RETRY_DELAY_MS);
      let result: ExecResult | null = null;
      let attemptCount = 0;
      try {
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
              isolatedCodexHome.path,
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
        const resolvedOutputPath =
          fs.existsSync(outputPath) && fs.statSync(outputPath).isFile()
            ? outputPath
            : recoverGeneratedImageFromCodexHome(isolatedCodexHome.path, outputPath, execStartedAt);
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
