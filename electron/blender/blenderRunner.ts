import { desktopT } from "../desktopStrings";
import type { BlenderTerminationReason } from '../shared/blenderDirectorContract';
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BLENDER_RENDER_SCRIPT } from "./blenderRenderScript";
import { writeAsset } from "../runtime";
import { inspectGlb } from "../assets/glbValidation";
import { captureAssetWriteContext, type AssetWriteContext } from "../assets/assetWriteContext";

type BlenderAssetRef = { url: string; assetId?: string };

export type BlenderSceneRenderRequest = {
  jobId: string;
  projectId: string;
  ownerNodeId?: string | null;
  blenderPath?: string;
  scene: unknown;
  timeoutMs?: number;
};

export type BlenderSceneRenderResult = {
  jobId: string;
  blenderVersion?: string;
  preview: BlenderAssetRef;
  blend: BlenderAssetRef;
  model: BlenderAssetRef;
};

type ActiveBlenderJob = {
  child: ChildProcess;
  closed?: boolean;
  terminationReason?: BlenderTerminationReason;
  forceKillTimer?: NodeJS.Timeout;
};

const activeJobs = new Map<string, ActiveBlenderJob>();
const pendingJobs = new Map<string, { cancelled: boolean }>();
const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function buildBlenderCommandArgs(scriptPath: string, inputPath: string, outputDir: string): string[] {
  return [
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--python-exit-code",
    "1",
    "--python",
    scriptPath,
    "--",
    inputPath,
    outputDir,
  ];
}

function executableCandidates(explicitPath?: string): string[] {
  const candidates = [explicitPath, process.env.NOMI_BLENDER_PATH];
  if (process.platform === "darwin") candidates.push("/Applications/Blender.app/Contents/MacOS/Blender");
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe",
    );
  }
  candidates.push("blender");
  return candidates.filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

export function resolveBlenderExecutable(explicitPath?: string): string {
  for (const candidate of executableCandidates(explicitPath)) {
    if (candidate === "blender" || fs.existsSync(candidate)) return candidate;
  }
  throw new Error(desktopT("custom.blender.blenderRunner.text1"));
}

function appendCapped(current: string, chunk: unknown): string {
  const next = current + String(chunk ?? "");
  return next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next;
}

function readOutputFile(outputDir: string, fileName: string): Buffer {
  const filePath = path.join(outputDir, fileName);
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength === 0) throw new Error(desktopT("custom.blender.blenderRunner.text2", { value0: `${fileName}` }));
  return bytes;
}

function asAssetRef(value: unknown): BlenderAssetRef {
  const record = value as { id?: unknown; data?: { url?: unknown } };
  const url = typeof record?.data?.url === "string" ? record.data.url : "";
  if (!url) throw new Error(desktopT("custom.blender.blenderRunner.text3"));
  return { url, ...(typeof record.id === "string" ? { assetId: record.id } : {}) };
}

async function persistOutputs(request: BlenderSceneRenderRequest, outputDir: string, stdout: string, context: AssetWriteContext, assertRunning: () => void): Promise<BlenderSceneRenderResult> {
  const meta = { kind: "blender", ownerNodeId: request.ownerNodeId || null, blenderJobId: request.jobId };
  const preview = asAssetRef(await writeAsset(request.projectId, readOutputFile(outputDir, "preview.png"), "blender-preview.png", "image/png", meta, "image", context));
  assertRunning();
  const blend = asAssetRef(await writeAsset(request.projectId, readOutputFile(outputDir, "scene.blend"), "blender-scene.blend", "application/x-blender", meta, null, context));
  assertRunning();
  const modelBytes = readOutputFile(outputDir, "scene.glb");
  const model3dValidation = inspectGlb(modelBytes);
  const model = asAssetRef(await writeAsset(
    request.projectId,
    modelBytes,
    "blender-scene.glb",
    "model/gltf-binary",
    { ...meta, model3dValidation },
    "model3d",
    context,
  ));
  assertRunning();
  const version = stdout.match(/NOMI_BLENDER_VERSION=([^\r\n]+)/)?.[1]?.trim();
  return { jobId: request.jobId, ...(version ? { blenderVersion: version } : {}), preview, blend, model };
}

export async function runBlenderSceneRender(request: BlenderSceneRenderRequest): Promise<BlenderSceneRenderResult> {
  const jobId = String(request.jobId || "").trim();
  const projectId = String(request.projectId || "").trim();
  if (!jobId) throw new Error(desktopT("custom.blender.blenderRunner.text4"));
  if (!projectId) throw new Error(desktopT("custom.blender.blenderRunner.text5"));
  if (activeJobs.has(jobId) || pendingJobs.has(jobId)) throw new Error(desktopT("custom.blender.blenderRunner.text6", { value0: `${jobId}` }));
  const pending = { cancelled: false };
  pendingJobs.set(jobId, pending);
  let context: AssetWriteContext;
  try {
    context = await captureAssetWriteContext(projectId);
    if (pending.cancelled) throw new Error(desktopT("custom.blender.blenderRunner.text7"));
  } finally {
    pendingJobs.delete(jobId);
  }

  let tempDir = "";
  try {
    const blenderPath = resolveBlenderExecutable(request.blenderPath);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-blender-"));
    const outputDir = path.join(tempDir, "output");
    const inputPath = path.join(tempDir, "scene.json");
    const scriptPath = path.join(tempDir, "render_scene.py");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify({ scene: request.scene }), "utf8");
    fs.writeFileSync(scriptPath, BLENDER_RENDER_SCRIPT, "utf8");
    return await new Promise<BlenderSceneRenderResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(blenderPath, buildBlenderCommandArgs(scriptPath, inputPath, outputDir), {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const job: ActiveBlenderJob = { child };
      activeJobs.set(jobId, job);
      const finish = (error?: Error, result?: BlenderSceneRenderResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        activeJobs.delete(jobId);
        if (error) reject(error);
        else resolve(result as BlenderSceneRenderResult);
      };
      const timeout = setTimeout(() => {
        job.terminationReason = "timeout";
        child.kill("SIGTERM");
        job.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
        job.forceKillTimer.unref?.();
      }, request.timeoutMs || DEFAULT_TIMEOUT_MS);
      timeout.unref?.();

      child.stdout?.on("data", (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.once("error", (error) => {
        if (job.terminationReason === "timeout") {
          finish(new Error(desktopT("custom.blender.blenderRunner.text8", { value0: `${Math.round((request.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000)}` })));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error(desktopT("custom.blender.blenderRunner.text9")));
          return;
        }
        finish(new Error(desktopT("custom.blender.blenderRunner.text10", { value0: `${error.message}` })));
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        job.closed = true;
        clearTimeout(timeout);
        if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
        if (job.terminationReason === "timeout") {
          finish(new Error(desktopT("custom.blender.blenderRunner.text11", { value0: `${Math.round((request.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000)}` })));
          return;
        }
        if (job.terminationReason === "cancelled") {
          finish(new Error(desktopT("custom.blender.blenderRunner.text12")));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `signal=${signal || "none"}`;
          finish(new Error(desktopT("custom.blender.blenderRunner.text13", { value0: `${String(code)}`, value1: `${detail}` })));
          return;
        }
        try {
          finish(undefined, await persistOutputs(request, outputDir, stdout, context, () => {
            if (job.terminationReason === "cancelled") throw new Error(desktopT("custom.blender.blenderRunner.text14"));
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

export function cancelBlenderSceneRender(jobId: string): boolean {
  const pending = pendingJobs.get(String(jobId || ""));
  if (pending) { pending.cancelled = true; return true; }
  const job = activeJobs.get(String(jobId || ""));
  if (!job) return false;
  job.terminationReason = "cancelled";
  if (job.closed) return true;
  job.child.kill("SIGTERM");
  job.forceKillTimer = setTimeout(() => {
    if (activeJobs.has(jobId)) job.child.kill("SIGKILL");
  }, 3000);
  job.forceKillTimer.unref?.();
  return true;
}

export function cancelAllBlenderSceneRenders(): number {
  const jobIds = [...pendingJobs.keys(), ...activeJobs.keys()];
  for (const jobId of jobIds) cancelBlenderSceneRender(jobId);
  return jobIds.length;
}

export function activeBlenderSceneRenderCount(): number {
  return pendingJobs.size + activeJobs.size;
}
