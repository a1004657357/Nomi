import { desktopT } from "../desktopStrings";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { BLENDER_DIRECTOR_STAGE_PRESETS, type BlenderDirectorStagePreset, type BlenderTerminationReason } from '../shared/blenderDirectorContract';
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectGlb } from "../assets/glbValidation";
import { captureAssetWriteContext, type AssetWriteContext } from "../assets/assetWriteContext";
import { writeAsset } from "../runtime";

type DirectorAssetRef = { url: string; assetId?: string };

export type DirectorBlenderRenderRequest = {
  jobId: string;
  projectId: string;
  ownerNodeId?: string | null;
  title?: string;
  stagePreset?: BlenderDirectorStagePreset;
  scene: unknown;
  timeoutMs?: number;
  /** Test/development override. Renderer callers must not provide executable paths. */
  pythonPath?: string;
  /** Test/development override for the packaged harness location. */
  harnessRoot?: string;
};

export type DirectorBlenderRenderResult = {
  jobId: string;
  blenderVersion?: string;
  preview: DirectorAssetRef;
  blend: DirectorAssetRef;
  model: DirectorAssetRef;
};

type BridgeOutput = {
  jobId: string;
  blenderVersion?: string;
  manifestPath?: string;
  syncPath?: string;
  artifacts: { preview: string; blend: string; model: string };
};

type ActiveDirectorJob = {
  child: ChildProcess;
  closed?: boolean;
  terminationReason?: BlenderTerminationReason;
  forceKillTimer?: NodeJS.Timeout;
};

const activeDirectorJobs = new Map<string, ActiveDirectorJob>();
const pendingDirectorJobs = new Map<string, { cancelled: boolean }>();
const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const STAGE_PRESETS = new Set(BLENDER_DIRECTOR_STAGE_PRESETS);

export function resolveDirectorHarnessRoot(): string {
  const override = String(process.env.NOMI_DIRECTOR_HARNESS_ROOT || "").trim();
  if (override) return path.resolve(override);
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "blender-harness") : "";
  if (packaged && fs.existsSync(path.join(packaged, "cli_anything", "blender", "bridge.py"))) return packaged;
  return path.resolve(__dirname, "../../integrations/blender/agent-harness");
}

function resolvePythonExecutable(explicitPath?: string): string {
  return String(explicitPath || process.env.NOMI_PYTHON_PATH || "python3").trim() || "python3";
}

export function buildDirectorBridgeArgs(input: {
  projectDir: string;
  sceneInputPath: string;
  jobId: string;
  ownerNodeId?: string | null;
  title?: string;
  stagePreset?: string;
  timeoutSeconds: number;
}): string[] {
  const args = [
    "-m",
    "cli_anything.blender.bridge",
    "--project-dir",
    input.projectDir,
    "--scene-input",
    input.sceneInputPath,
    "--job-id",
    input.jobId,
  ];
  if (input.ownerNodeId) args.push("--owner-node-id", input.ownerNodeId);
  if (input.title) args.push("--title", input.title);
  if (input.stagePreset) args.push("--stage-preset", input.stagePreset);
  args.push("--timeout-seconds", String(input.timeoutSeconds));
  return args;
}

function appendCapped(current: string, chunk: unknown): string {
  const next = current + String(chunk ?? "");
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredPath(value: unknown, field: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || !path.isAbsolute(candidate)) throw new Error(desktopT("custom.blender.directorCli.text1", { value0: `${field}` }));
  return candidate;
}

export function parseDirectorBridgeOutput(stdout: string): BridgeOutput {
  const line = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error(desktopT("custom.blender.directorCli.text2"));
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error(desktopT("custom.blender.directorCli.text3"));
  }
  const payload = record(raw);
  if (payload.ok !== true) {
    const message = typeof record(payload.error).message === "string" ? String(record(payload.error).message) : "Blender 导演桥接失败";
    throw new Error(message);
  }
  const artifacts = record(payload.artifacts);
  const jobId = typeof payload.jobId === "string" ? payload.jobId.trim() : "";
  if (!jobId) throw new Error(desktopT("custom.blender.directorCli.text4"));
  return {
    jobId,
    ...(typeof payload.blenderVersion === "string" && payload.blenderVersion.trim() ? { blenderVersion: payload.blenderVersion.trim() } : {}),
    ...(typeof payload.manifestPath === "string" ? { manifestPath: payload.manifestPath } : {}),
    ...(typeof payload.syncPath === "string" ? { syncPath: payload.syncPath } : {}),
    artifacts: {
      preview: requiredPath(artifacts.preview, "preview"),
      blend: requiredPath(artifacts.blend, "blend"),
      model: requiredPath(artifacts.model, "model"),
    },
  };
}

function readProjectDirectorOutput(projectDir: string, filePath: string, name: string): Buffer {
  const root = path.resolve(projectDir, ".nomi-director");
  const absolutePath = path.resolve(filePath);
  const relative = path.relative(root, absolutePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(desktopT("custom.blender.directorCli.text5", { value0: `${name}` }));
  }
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.byteLength === 0) throw new Error(desktopT("custom.blender.directorCli.text6", { value0: `${name}` }));
  return bytes;
}

function asAssetRef(value: unknown): DirectorAssetRef {
  const raw = value as { id?: unknown; data?: { url?: unknown } };
  const url = typeof raw?.data?.url === "string" ? raw.data.url : "";
  if (!url) throw new Error(desktopT("custom.blender.directorCli.text7"));
  return { url, ...(typeof raw.id === "string" ? { assetId: raw.id } : {}) };
}

async function persistDirectorOutputs(request: DirectorBlenderRenderRequest, projectDir: string, output: BridgeOutput, context: AssetWriteContext, assertRunning: () => void): Promise<DirectorBlenderRenderResult> {
  const meta = {
    kind: "blender",
    source: "blender-director",
    ownerNodeId: request.ownerNodeId || null,
    blenderJobId: request.jobId,
    directorManifestPath: output.manifestPath || null,
    directorSyncPath: output.syncPath || null,
  };
  const preview = asAssetRef(await writeAsset(request.projectId, readProjectDirectorOutput(projectDir, output.artifacts.preview, "preview.png"), "blender-director-preview.png", "image/png", meta, "image", context));
  assertRunning();
  const blend = asAssetRef(await writeAsset(request.projectId, readProjectDirectorOutput(projectDir, output.artifacts.blend, "scene.blend"), "blender-director-scene.blend", "application/x-blender", meta, null, context));
  assertRunning();
  const modelBytes = readProjectDirectorOutput(projectDir, output.artifacts.model, "scene.glb");
  const model3dValidation = inspectGlb(modelBytes);
  const model = asAssetRef(await writeAsset(
    request.projectId,
    modelBytes,
    "blender-director-scene.glb",
    "model/gltf-binary",
    { ...meta, model3dValidation },
    "model3d",
    context,
  ));
  assertRunning();
  return { jobId: output.jobId, ...(output.blenderVersion ? { blenderVersion: output.blenderVersion } : {}), preview, blend, model };
}

export async function runDirectorBlenderRender(request: DirectorBlenderRenderRequest): Promise<DirectorBlenderRenderResult> {
  const jobId = String(request.jobId || "").trim();
  const projectId = String(request.projectId || "").trim();
  if (!jobId) throw new Error(desktopT("custom.blender.directorCli.text8"));
  if (!projectId) throw new Error(desktopT("custom.blender.directorCli.text9"));
  if (activeDirectorJobs.has(jobId) || pendingDirectorJobs.has(jobId)) throw new Error(desktopT("custom.blender.directorCli.text10", { value0: `${jobId}` }));
  if (request.stagePreset && !STAGE_PRESETS.has(request.stagePreset)) throw new Error(desktopT("custom.blender.directorCli.text11"));
  const pending = { cancelled: false };
  pendingDirectorJobs.set(jobId, pending);
  let context: AssetWriteContext;
  try {
    context = await captureAssetWriteContext(projectId);
    if (pending.cancelled) throw new Error(tagNomiError("operation-cancelled", desktopT("custom.blender.directorCli.text12")));
  } finally {
    pendingDirectorJobs.delete(jobId);
  }
  const projectDir = context.root;
  const harnessRoot = path.resolve(request.harnessRoot || resolveDirectorHarnessRoot());
  if (!fs.existsSync(path.join(harnessRoot, "cli_anything", "blender", "bridge.py"))) {
    throw new Error(desktopT("custom.blender.directorCli.text13"));
  }

  let tempDir = "";
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-blender-director-"));
    const sceneInputPath = path.join(tempDir, "scene.json");
    fs.writeFileSync(sceneInputPath, JSON.stringify({ scene: request.scene }), "utf8");
    const timeoutMs = Math.max(1_000, Math.min(10 * 60 * 1000, request.timeoutMs || DEFAULT_TIMEOUT_MS));
    const pythonPath = resolvePythonExecutable(request.pythonPath);
    const args = buildDirectorBridgeArgs({
      projectDir,
      sceneInputPath,
      jobId,
      ownerNodeId: request.ownerNodeId,
      title: request.title,
      stagePreset: request.stagePreset,
      timeoutSeconds: Math.ceil(timeoutMs / 1000),
    });
    return await new Promise<DirectorBlenderRenderResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(pythonPath, args, {
        cwd: harnessRoot,
        env: { ...process.env, PYTHONPATH: [harnessRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const job: ActiveDirectorJob = { child };
      activeDirectorJobs.set(jobId, job);
      const finish = (error?: Error, result?: DirectorBlenderRenderResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        activeDirectorJobs.delete(jobId);
        if (error) reject(error);
        else resolve(result as DirectorBlenderRenderResult);
      };
      const timeout = setTimeout(() => {
        job.terminationReason = "timeout";
        child.kill("SIGTERM");
        job.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
        job.forceKillTimer.unref?.();
      }, timeoutMs + 15_000);
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.once("error", (error) => {
        if (job.terminationReason === "timeout") {
          finish(new Error(desktopT("custom.blender.directorCli.text14", { value0: `${Math.round(timeoutMs / 1000)}` })));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error(tagNomiError("operation-cancelled", desktopT("custom.blender.directorCli.text15"))));
          return;
        }
        finish(new Error(desktopT("custom.blender.directorCli.text16", { value0: `${error.message}` })));
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        job.closed = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        if (job.terminationReason === "timeout") {
          finish(new Error(desktopT("custom.blender.directorCli.text17", { value0: `${Math.round(timeoutMs / 1000)}` })));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error(tagNomiError("operation-cancelled", desktopT("custom.blender.directorCli.text18"))));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `signal=${signal || "none"}`;
          finish(new Error(desktopT("custom.blender.directorCli.text19", { value0: `${String(code)}`, value1: `${detail.slice(-6000)}` })));
          return;
        }
        try {
          finish(undefined, await persistDirectorOutputs(request, projectDir, parseDirectorBridgeOutput(stdout), context, () => {
            if (job.terminationReason === "cancelled") throw new Error(tagNomiError("operation-cancelled", desktopT("custom.blender.directorCli.text20")));
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

export function cancelDirectorBlenderRender(jobId: string): boolean {
  const pending = pendingDirectorJobs.get(String(jobId || ""));
  if (pending) { pending.cancelled = true; return true; }
  const job = activeDirectorJobs.get(String(jobId || ""));
  if (!job) return false;
  job.terminationReason = "cancelled";
  if (job.closed) return true;
  job.child.kill("SIGTERM");
  job.forceKillTimer = setTimeout(() => {
    if (activeDirectorJobs.has(jobId)) job.child.kill("SIGKILL");
  }, 3_000);
  job.forceKillTimer.unref?.();
  return true;
}

export function cancelAllDirectorBlenderRenders(): number {
  const jobs = [...pendingDirectorJobs.keys(), ...activeDirectorJobs.keys()];
  for (const jobId of jobs) cancelDirectorBlenderRender(jobId);
  return jobs.length;
}

export function activeDirectorBlenderRenderCount(): number {
  return pendingDirectorJobs.size + activeDirectorJobs.size;
}
