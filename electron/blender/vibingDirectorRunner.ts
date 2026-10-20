import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectGlb } from "../assets/glbValidation";
import { captureAssetWriteContext, type AssetWriteContext } from "../assets/assetWriteContext";
import { projectDirById } from "../projects/repository";
import { writeAsset } from "../runtime";
import { resolveBlenderExecutable } from "./blenderRunner";
import { VIBING_DIRECTOR_BLENDER_SCRIPT } from "./vibingDirectorBlenderScript";

type AssetRef = { url: string; assetId?: string };

export type VibingDirectorAssetFile = {
  id: string;
  fileName: string;
};

export type VibingDirectorPreviewCamera = {
  id: "director-camera";
  name: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  aspectRatio: "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "2.39:1";
  framing: "all" | "target" | "fixed";
  targetRef?: string;
};

export type VibingDirectorSpatialCheck = {
  relationId: string;
  kind: "facing" | "distance" | "support" | "offset" | "line_of_sight";
  status: "passed" | "warning" | "failed";
  message: string;
  measured?: number;
  expected?: number;
  rotationMeasured?: number;
  rotationExpected?: number;
};

export type VibingDirectorSpatialReport = {
  version: 1;
  passed: boolean;
  checks: VibingDirectorSpatialCheck[];
};

export type VibingDirectorObjectTransform = {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type VibingDirectorBlenderRequest = {
  jobId: string;
  projectId: string;
  directorNodeId: string;
  plan: unknown;
  assets: VibingDirectorAssetFile[];
  existingBlendRelativePath?: string;
  blenderPath?: string;
  timeoutMs?: number;
  /**
   * Gate 4 Slice 1（§14.2）：关联的镜头 id。迁移期 optional（既有调用不传 = directorNode 闭环）；
   * 传入后，Blender 预演回传可关联回 ShotSpec（directorNode 闭环升级为 shot 闭环）。
   * 见 electron/blender/shotBlenderBridge.ts projectShotSpecToBlenderInputs。
   */
  shotId?: string;
};

export type VibingDirectorBlenderResult = {
  jobId: string;
  blenderVersion?: string;
  preview: AssetRef;
  blend: AssetRef;
  model: AssetRef;
  blendRelativePath: string;
  previewCamera?: VibingDirectorPreviewCamera;
  spatialReport?: VibingDirectorSpatialReport;
  objectTransforms?: VibingDirectorObjectTransform[];
};

type BridgeOutput = {
  jobId: string;
  blenderVersion?: string;
  artifacts: { preview: string; blend: string; model: string };
  previewCamera?: VibingDirectorPreviewCamera;
  spatialReport?: VibingDirectorSpatialReport;
  objectTransforms?: VibingDirectorObjectTransform[];
};

type ActiveJob = {
  child: ChildProcess;
  closed?: boolean;
  terminationReason?: "cancelled" | "timeout";
  forceKillTimer?: NodeJS.Timeout;
};

const activeJobs = new Map<string, ActiveJob>();
const pendingJobs = new Map<string, { cancelled: boolean }>();
const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function safeSegment(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error(`${label} 不安全`);
  }
  return normalized;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function directorRootPath(projectDir: string, directorNodeId: string): string {
  return path.join(projectDir, ".nomi", "vibing-director", safeSegment(directorNodeId, "Director 节点标识"));
}

export function vibingDirectorAssetPath(projectDir: string, directorNodeId: string, asset: VibingDirectorAssetFile): string {
  const assetId = safeSegment(asset.id, "资产标识");
  const fileName = safeSegment(asset.fileName, "资产文件名");
  return path.join(directorRootPath(projectDir, directorNodeId), "assets", `${assetId}-${fileName}`);
}

export function buildVibingDirectorBlenderArgs(input: {
  existingBlendPath?: string;
  scriptPath: string;
  planPath: string;
  outputDir: string;
}): string[] {
  return [
    "--background",
    ...(input.existingBlendPath ? [input.existingBlendPath] : ["--factory-startup"]),
    "--disable-autoexec",
    "--python-exit-code",
    "1",
    "--python",
    input.scriptPath,
    "--",
    input.planPath,
    input.outputDir,
  ];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredAbsolutePath(value: unknown, field: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || !path.isAbsolute(candidate)) throw new Error(`Blender 导演桥接返回的 ${field} 无效`);
  return candidate;
}

function finiteVector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map((item) => Number(item));
  return result.every(Number.isFinite) ? result as [number, number, number] : null;
}

function parsePreviewCamera(value: unknown): VibingDirectorPreviewCamera | undefined {
  const raw = record(value);
  const position = finiteVector3(raw.position);
  const lookAt = finiteVector3(raw.lookAt);
  const fov = Number(raw.fov);
  const aspectRatio = typeof raw.aspectRatio === "string" ? raw.aspectRatio : "";
  const framing = typeof raw.framing === "string" ? raw.framing : "";
  if (
    !position ||
    !lookAt ||
    !Number.isFinite(fov) ||
    !["16:9", "9:16", "4:3", "3:4", "1:1", "2.39:1"].includes(aspectRatio) ||
    !["all", "target", "fixed"].includes(framing)
  ) return undefined;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "导演相机";
  const targetRef = typeof raw.targetRef === "string" && raw.targetRef.trim() ? raw.targetRef.trim() : undefined;
  return {
    id: "director-camera",
    name,
    position,
    lookAt,
    fov,
    aspectRatio: aspectRatio as VibingDirectorPreviewCamera["aspectRatio"],
    framing: framing as VibingDirectorPreviewCamera["framing"],
    ...(targetRef ? { targetRef } : {}),
  };
}

function parseSpatialReport(value: unknown): VibingDirectorSpatialReport | undefined {
  const raw = record(value);
  if (raw.version !== 1 || typeof raw.passed !== "boolean" || !Array.isArray(raw.checks)) return undefined;
  const checks: VibingDirectorSpatialCheck[] = [];
  for (const value of raw.checks) {
    const check = record(value);
    const relationId = typeof check.relationId === "string" ? check.relationId.trim() : "";
    const kind = typeof check.kind === "string" ? check.kind : "";
    const status = typeof check.status === "string" ? check.status : "";
    const message = typeof check.message === "string" ? check.message.trim() : "";
    if (
      !relationId ||
      !["facing", "distance", "support", "offset", "line_of_sight"].includes(kind) ||
      !["passed", "warning", "failed"].includes(status) ||
      !message
    ) continue;
    const measured = Number(check.measured);
    const expected = Number(check.expected);
    const rotationMeasured = Number(check.rotationMeasured);
    const rotationExpected = Number(check.rotationExpected);
    checks.push({
      relationId,
      kind: kind as VibingDirectorSpatialCheck["kind"],
      status: status as VibingDirectorSpatialCheck["status"],
      message,
      ...(Number.isFinite(measured) ? { measured } : {}),
      ...(Number.isFinite(expected) ? { expected } : {}),
      ...(Number.isFinite(rotationMeasured) ? { rotationMeasured } : {}),
      ...(Number.isFinite(rotationExpected) ? { rotationExpected } : {}),
    });
  }
  return { version: 1, passed: raw.passed, checks };
}

function parseObjectTransforms(value: unknown): VibingDirectorObjectTransform[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const transforms: VibingDirectorObjectTransform[] = [];
  for (const item of value) {
    const raw = record(item);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    const position = finiteVector3(raw.position);
    const rotation = finiteVector3(raw.rotation);
    const scale = finiteVector3(raw.scale);
    if (!id || !position || !rotation || !scale) continue;
    transforms.push({ id, name, position, rotation, scale });
  }
  return transforms;
}

export function parseVibingDirectorBridgeOutput(stdout: string): BridgeOutput {
  let payload: unknown;
  // Blender writes its own shutdown diagnostics after our script's final print.
  // Scan tail-first so a successful bridge envelope is not hidden by "Blender quit".
  for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).reverse()) {
    try {
      payload = JSON.parse(line);
      break;
    } catch {
      /* keep looking through Blender's non-JSON logs */
    }
  }
  if (payload === undefined) {
    throw new Error("Blender 导演桥接返回了无效 JSON");
  }
  const raw = record(payload);
  if (raw.ok !== true) {
    const message = typeof record(raw.error).message === "string" ? String(record(raw.error).message) : "Blender 导演桥接失败";
    throw new Error(message);
  }
  const jobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
  if (!jobId) throw new Error("Blender 导演桥接未返回 jobId");
  const artifacts = record(raw.artifacts);
  const previewCamera = parsePreviewCamera(raw.previewCamera);
  const spatialReport = parseSpatialReport(raw.spatialReport);
  const objectTransforms = parseObjectTransforms(raw.objectTransforms);
  return {
    jobId,
    ...(typeof raw.blenderVersion === "string" && raw.blenderVersion.trim() ? { blenderVersion: raw.blenderVersion.trim() } : {}),
    ...(previewCamera ? { previewCamera } : {}),
    ...(spatialReport ? { spatialReport } : {}),
    ...(objectTransforms ? { objectTransforms } : {}),
    artifacts: {
      preview: requiredAbsolutePath(artifacts.preview, "preview"),
      blend: requiredAbsolutePath(artifacts.blend, "blend"),
      model: requiredAbsolutePath(artifacts.model, "model"),
    },
  };
}

function appendCapped(current: string, chunk: unknown): string {
  const next = current + String(chunk ?? "");
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next;
}

function outputBytes(root: string, filePath: string, label: string): Buffer {
  if (!inside(root, filePath)) throw new Error(`Blender 导演桥接返回的 ${label} 不在当前 Director 输出目录`);
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength === 0) throw new Error(`Blender 导演桥接返回的 ${label} 为空`);
  return bytes;
}

function asAssetRef(value: unknown): AssetRef {
  const raw = value as { id?: unknown; data?: { url?: unknown } };
  const url = typeof raw?.data?.url === "string" ? raw.data.url : "";
  if (!url) throw new Error("Blender 导演产物写入项目素材失败");
  return { url, ...(typeof raw.id === "string" ? { assetId: raw.id } : {}) };
}

function requestedAssetIds(plan: unknown): string[] {
  const actions = record(plan).actions;
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action) => record(action))
    .filter((action) => action.op === "place_asset" && typeof action.assetId === "string")
    .map((action) => String(action.assetId));
}

function resolveExistingBlend(projectDir: string, directorNodeId: string, relativePath?: string): string | undefined {
  if (!relativePath) return undefined;
  const candidate = resolveVibingDirectorBlendPath(projectDir, directorNodeId, relativePath);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function resolveVibingDirectorBlendPath(projectDir: string, directorNodeId: string, relativePath: string): string {
  const root = directorRootPath(projectDir, directorNodeId);
  const candidate = path.resolve(projectDir, String(relativePath || ""));
  if (!inside(root, candidate) || path.extname(candidate).toLowerCase() !== ".blend") {
    throw new Error("Blender 工程路径不在当前 Director 工作目录内");
  }
  return candidate;
}

async function persistOutputs(request: VibingDirectorBlenderRequest, projectDir: string, outputDir: string, output: BridgeOutput, context: AssetWriteContext, assertRunning: () => void): Promise<VibingDirectorBlenderResult> {
  const meta = {
    kind: "blender",
    source: "vibing-director",
    ownerNodeId: request.directorNodeId,
    blenderJobId: request.jobId,
    blenderDirector: true,
  };
  const preview = asAssetRef(await writeAsset(request.projectId, outputBytes(outputDir, output.artifacts.preview, "preview"), "vibing-director-preview.png", "image/png", meta, "image", context));
  assertRunning();
  const blend = asAssetRef(await writeAsset(request.projectId, outputBytes(outputDir, output.artifacts.blend, "blend"), "vibing-director-scene.blend", "application/x-blender", meta, null, context));
  assertRunning();
  const modelBytes = outputBytes(outputDir, output.artifacts.model, "model");
  const model3dValidation = inspectGlb(modelBytes);
  const model = asAssetRef(await writeAsset(
    request.projectId,
    modelBytes,
    "vibing-director-scene.glb",
    "model/gltf-binary",
    { ...meta, model3dValidation },
    "model3d",
    context,
  ));
  assertRunning();
  const blendRelativePath = path.relative(projectDir, output.artifacts.blend);
  return {
    jobId: output.jobId,
    ...(output.blenderVersion ? { blenderVersion: output.blenderVersion } : {}),
    preview,
    blend,
    model,
    blendRelativePath,
    ...(output.previewCamera ? { previewCamera: output.previewCamera } : {}),
    ...(output.spatialReport ? { spatialReport: output.spatialReport } : {}),
    ...(output.objectTransforms ? { objectTransforms: output.objectTransforms } : {}),
  };
}

export async function runVibingDirectorBlenderPlan(request: VibingDirectorBlenderRequest): Promise<VibingDirectorBlenderResult> {
  const jobId = safeSegment(request.jobId, "Blender jobId");
  const projectId = String(request.projectId || "").trim();
  if (!projectId) throw new Error("Blender Director projectId 不能为空");
  if (activeJobs.has(jobId) || pendingJobs.has(jobId)) throw new Error(`Blender Director 任务 ${jobId} 已在运行`);
  const pending = { cancelled: false };
  pendingJobs.set(jobId, pending);
  let context: AssetWriteContext;
  try {
    context = await captureAssetWriteContext(projectId);
    if (pending.cancelled) throw new Error("Blender Director 预演已取消");
  } finally {
    pendingJobs.delete(jobId);
  }
  const projectDir = context.root;
  const root = directorRootPath(projectDir, request.directorNodeId);
  const outputDir = path.join(root, "exports", jobId);
  const existingBlendPath = resolveExistingBlend(projectDir, request.directorNodeId, request.existingBlendRelativePath);
  const assetById = new Map(request.assets.map((asset) => [asset.id, asset]));
  const assets: Array<{ id: string; path: string }> = [];
  for (const assetId of requestedAssetIds(request.plan)) {
    const asset = assetById.get(assetId);
    if (!asset) throw new Error(`资产库中没有「${assetId}」`);
    const assetPath = vibingDirectorAssetPath(projectDir, request.directorNodeId, asset);
    if (!fs.existsSync(assetPath)) throw new Error(`资产文件不存在：${asset.fileName}`);
    assets.push({ id: asset.id, path: assetPath });
  }

  const blenderPath = resolveBlenderExecutable(request.blenderPath);
  const timeoutMs = Math.max(1_000, Math.min(10 * 60 * 1000, request.timeoutMs || DEFAULT_TIMEOUT_MS));
  let tempDir = "";
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-vibing-director-"));
    const planPath = path.join(tempDir, "plan.json");
    const scriptPath = path.join(tempDir, "apply_director.py");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify({ jobId, plan: request.plan, assets }), "utf8");
    fs.writeFileSync(scriptPath, VIBING_DIRECTOR_BLENDER_SCRIPT, "utf8");
    const args = buildVibingDirectorBlenderArgs({ existingBlendPath, scriptPath, planPath, outputDir });
    return await new Promise<VibingDirectorBlenderResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(blenderPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const job: ActiveJob = { child };
      activeJobs.set(jobId, job);
      const finish = (error?: Error, result?: VibingDirectorBlenderResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        activeJobs.delete(jobId);
        if (error) reject(error);
        else resolve(result as VibingDirectorBlenderResult);
      };
      const timeout = setTimeout(() => {
        job.terminationReason = "timeout";
        child.kill("SIGTERM");
        job.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
        job.forceKillTimer.unref?.();
      }, timeoutMs);
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.once("error", (error) => {
        if (job.terminationReason === "timeout") {
          finish(new Error(`Blender Director 预演超时（${Math.round(timeoutMs / 1000)} 秒）`));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error("Blender Director 预演已取消"));
          return;
        }
        finish(new Error(`Blender Director 启动失败：${error.message}`));
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        job.closed = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        if (job.terminationReason === "timeout") {
          finish(new Error(`Blender Director 预演超时（${Math.round(timeoutMs / 1000)} 秒）`));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error("Blender Director 预演已取消"));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `signal=${signal || "none"}`;
          finish(new Error(`Blender Director 预演失败（退出码 ${String(code)}）：${detail.slice(-6000)}`));
          return;
        }
        try {
          finish(undefined, await persistOutputs(request, projectDir, outputDir, parseVibingDirectorBridgeOutput(stdout), context, () => {
            if (job.terminationReason === "cancelled") throw new Error("Blender Director 预演已取消");
          }));
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function cancelVibingDirectorBlenderPlan(jobId: string): boolean {
  const pending = pendingJobs.get(String(jobId || ""));
  if (pending) { pending.cancelled = true; return true; }
  const job = activeJobs.get(String(jobId || ""));
  if (!job) return false;
  job.terminationReason = "cancelled";
  if (job.closed) return true;
  job.child.kill("SIGTERM");
  job.forceKillTimer = setTimeout(() => {
    if (activeJobs.has(jobId)) job.child.kill("SIGKILL");
  }, 3_000);
  job.forceKillTimer.unref?.();
  return true;
}

export function cancelAllVibingDirectorBlenderPlans(): number {
  const jobIds = [...pendingJobs.keys(), ...activeJobs.keys()];
  for (const jobId of jobIds) cancelVibingDirectorBlenderPlan(jobId);
  return jobIds.length;
}

export function activeVibingDirectorBlenderPlanCount(): number {
  return pendingJobs.size + activeJobs.size;
}

export function openVibingDirectorBlend(input: {
  projectId: string;
  directorNodeId: string;
  blendRelativePath: string;
  blenderPath?: string;
}): { opened: boolean } {
  const projectDir = projectDirById(String(input.projectId || "").trim());
  if (!projectDir) throw new Error("无法找到当前项目目录");
  const blendPath = resolveVibingDirectorBlendPath(projectDir, input.directorNodeId, input.blendRelativePath);
  if (!fs.existsSync(blendPath)) throw new Error("当前 Director 的 Blender 工程不存在，请先应用一个导演计划");
  const child = spawn(resolveBlenderExecutable(input.blenderPath), [blendPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { opened: true };
}

export { VIBING_DIRECTOR_BLENDER_SCRIPT };
