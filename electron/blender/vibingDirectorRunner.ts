import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDirById } from "../projects/repository";
import { writeAsset } from "../runtime";
import { resolveBlenderExecutable } from "./blenderRunner";

type AssetRef = { url: string; assetId?: string };

export type VibingDirectorAssetFile = {
  id: string;
  fileName: string;
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
};

export type VibingDirectorBlenderResult = {
  jobId: string;
  blenderVersion?: string;
  preview: AssetRef;
  blend: AssetRef;
  model: AssetRef;
  blendRelativePath: string;
};

type BridgeOutput = {
  jobId: string;
  blenderVersion?: string;
  artifacts: { preview: string; blend: string; model: string };
};

type ActiveJob = {
  child: ChildProcess;
  cancelled: boolean;
  forceKillTimer?: NodeJS.Timeout;
};

const activeJobs = new Map<string, ActiveJob>();
const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DIRECTOR_ROOT = ".nomi/vibing-director";

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
  return {
    jobId,
    ...(typeof raw.blenderVersion === "string" && raw.blenderVersion.trim() ? { blenderVersion: raw.blenderVersion.trim() } : {}),
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

function persistOutputs(request: VibingDirectorBlenderRequest, projectDir: string, outputDir: string, output: BridgeOutput): VibingDirectorBlenderResult {
  const meta = {
    kind: "blender",
    source: "vibing-director",
    ownerNodeId: request.directorNodeId,
    blenderJobId: request.jobId,
    blenderDirector: true,
  };
  const preview = asAssetRef(writeAsset(request.projectId, outputBytes(outputDir, output.artifacts.preview, "preview"), "vibing-director-preview.png", "image/png", meta));
  const blend = asAssetRef(writeAsset(request.projectId, outputBytes(outputDir, output.artifacts.blend, "blend"), "vibing-director-scene.blend", "application/x-blender", meta));
  const model = asAssetRef(writeAsset(request.projectId, outputBytes(outputDir, output.artifacts.model, "model"), "vibing-director-scene.glb", "model/gltf-binary", meta));
  const blendRelativePath = path.relative(projectDir, output.artifacts.blend);
  return {
    jobId: output.jobId,
    ...(output.blenderVersion ? { blenderVersion: output.blenderVersion } : {}),
    preview,
    blend,
    model,
    blendRelativePath,
  };
}

export async function runVibingDirectorBlenderPlan(request: VibingDirectorBlenderRequest): Promise<VibingDirectorBlenderResult> {
  const jobId = safeSegment(request.jobId, "Blender jobId");
  const projectId = String(request.projectId || "").trim();
  if (!projectId) throw new Error("Blender Director projectId 不能为空");
  if (activeJobs.has(jobId)) throw new Error(`Blender Director 任务 ${jobId} 已在运行`);
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("无法找到 Blender Director 所属的本地项目目录");
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
      const job: ActiveJob = { child, cancelled: false };
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
        job.cancelled = true;
        child.kill("SIGTERM");
        job.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
        job.forceKillTimer.unref?.();
        finish(new Error(`Blender Director 预演超时（${Math.round(timeoutMs / 1000)} 秒）`));
      }, timeoutMs);
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => { stdout = appendCapped(stdout, chunk); });
      child.stderr?.on("data", (chunk) => { stderr = appendCapped(stderr, chunk); });
      child.once("error", (error) => finish(new Error(`Blender Director 启动失败：${error.message}`)));
      child.once("close", (code, signal) => {
        if (job.cancelled) {
          finish(new Error("Blender Director 预演已取消"));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `signal=${signal || "none"}`;
          finish(new Error(`Blender Director 预演失败（退出码 ${String(code)}）：${detail.slice(-6000)}`));
          return;
        }
        try {
          finish(undefined, persistOutputs(request, projectDir, outputDir, parseVibingDirectorBridgeOutput(stdout)));
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
  const job = activeJobs.get(String(jobId || ""));
  if (!job) return false;
  job.cancelled = true;
  job.child.kill("SIGTERM");
  job.forceKillTimer = setTimeout(() => {
    if (activeJobs.has(jobId)) job.child.kill("SIGKILL");
  }, 3_000);
  job.forceKillTimer.unref?.();
  return true;
}

export function cancelAllVibingDirectorBlenderPlans(): number {
  const jobIds = [...activeJobs.keys()];
  for (const jobId of jobIds) cancelVibingDirectorBlenderPlan(jobId);
  return jobIds.length;
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

/** Exported for the opt-in real-Blender smoke test; production writes this to a temporary file. */
export const VIBING_DIRECTOR_BLENDER_SCRIPT = String.raw`
import bpy
import json
import math
import os
import sys
from mathutils import Vector

RATIOS = {
    "16:9": (960, 540), "9:16": (540, 960), "4:3": (800, 600),
    "3:4": (600, 800), "1:1": (720, 720), "2.39:1": (960, 402),
}
DIRECTOR_COLLECTION = "Nomi Director"

def args_after_separator():
    marker = sys.argv.index("--")
    return sys.argv[marker + 1:]

def vec3(value, fallback=(0.0, 0.0, 0.0)):
    if not isinstance(value, list) or len(value) != 3:
        value = fallback
    return (float(value[0]), -float(value[2]), float(value[1]))

def rot3(value):
    if not isinstance(value, list) or len(value) != 3:
        value = (0.0, 0.0, 0.0)
    # Director plans use degrees so the agent can express facing directions as 0/90/180.
    return (math.radians(float(value[0])), math.radians(-float(value[2])), math.radians(float(value[1])))

def scale3(value):
    if not isinstance(value, list) or len(value) != 3:
        value = (1.0, 1.0, 1.0)
    return (float(value[0]), float(value[2]), float(value[1]))

def color3(value, fallback=(0.55, 0.58, 0.62)):
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return tuple(int(value[index:index + 2], 16) / 255.0 for index in (1, 3, 5))
        except ValueError:
            pass
    return fallback

def director_collection():
    collection = bpy.data.collections.get(DIRECTOR_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(DIRECTOR_COLLECTION)
        bpy.context.scene.collection.children.link(collection)
    return collection

def move_to_collection(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)

def tag(obj, object_id):
    obj["nomi_director_id"] = object_id
    return obj

def remove_collection_objects(collection):
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

def remove_factory_startup_objects():
    # A replace plan starts from Blender's factory scene. Its Cube/Camera/Light
    # must not leak into the Director stage or block the generated layout.
    for name in ("Cube", "Camera", "Light"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)

def material(name, color):
    item = bpy.data.materials.new(name=name)
    item.diffuse_color = (*color3(color), 1.0)
    item.roughness = 0.72
    return item

def primitive(collection, geometry, name, location, scale, color, object_id=None):
    if geometry == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    elif geometry == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, location=location)
    elif geometry == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.028, location=location)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material(name + " Material", color))
    move_to_collection(obj, collection)
    return tag(obj, object_id) if object_id else obj

def marker_part(collection, root, geometry, name, location, scale, color, rotation=(0.0, 0.0, 0.0)):
    obj = primitive(collection, geometry, name, (0.0, 0.0, 0.0), scale, color)
    obj.parent = root
    obj.location = location
    obj.rotation_euler = rotation
    return obj

def marker_role(action):
    role = str(action.get("role") or "").strip().lower()
    if role:
        return role
    source = (str(action.get("id") or "") + " " + str(action.get("name") or "")).lower()
    if "cup" in source or "咖啡杯" in source or "杯" in source:
        return "cup"
    if "laptop" in source or "电脑" in source:
        return "laptop"
    if "plate" in source or "cake" in source or "盘" in source or "蛋糕" in source:
        return "plate"
    if "chair" in source or "椅" in source:
        return "chair"
    if "table" in source or "桌" in source:
        return "table"
    if "actor" in source or "char" in source or "角色" in source or "人物" in source or "咖啡师" in source:
        return "actor_seated"
    return "prop"

def table_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Base", (0.0, 0.0, 0.06), (0.52, 0.52, 0.06), color)
    marker_part(collection, root, "cylinder", root.name + " Pedestal", (0.0, 0.0, 0.36), (0.14, 0.14, 0.3), color)
    marker_part(collection, root, "cylinder", root.name + " Top", (0.0, 0.0, 0.72), (0.9, 0.9, 0.08), color)

def chair_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Seat", (0.0, 0.0, 0.44), (0.46, 0.46, 0.06), color)
    marker_part(collection, root, "box", root.name + " Back", (0.0, 0.38, 0.88), (0.46, 0.06, 0.48), color)
    for x in (-0.36, 0.36):
        for y in (-0.34, 0.34):
            marker_part(collection, root, "box", root.name + " Leg", (x, y, 0.21), (0.045, 0.045, 0.21), color)

def seated_actor_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Hips", (0.0, 0.0, 0.58), (0.24, 0.21, 0.1), color)
    marker_part(collection, root, "cylinder", root.name + " Torso", (0.0, 0.02, 0.93), (0.22, 0.18, 0.34), color)
    marker_part(collection, root, "sphere", root.name + " Head", (0.0, -0.02, 1.52), (0.21, 0.21, 0.21), color)
    for side, x in (("Left", -0.14), ("Right", 0.14)):
        marker_part(collection, root, "box", root.name + " " + side + " Thigh", (x, -0.28, 0.52), (0.09, 0.28, 0.09), color)
        marker_part(collection, root, "box", root.name + " " + side + " Calf", (x, -0.54, 0.28), (0.09, 0.08, 0.28), color)
        marker_part(collection, root, "box", root.name + " " + side + " Arm", (x * 2.0, -0.1, 0.98), (0.07, 0.11, 0.3), color)

def standing_actor_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Torso", (0.0, 0.0, 1.05), (0.24, 0.19, 0.48), color)
    marker_part(collection, root, "sphere", root.name + " Head", (0.0, 0.0, 1.78), (0.21, 0.21, 0.21), color)
    for side, x in (("Left", -0.14), ("Right", 0.14)):
        marker_part(collection, root, "box", root.name + " " + side + " Leg", (x, 0.0, 0.43), (0.09, 0.1, 0.43), color)
        marker_part(collection, root, "box", root.name + " " + side + " Arm", (x * 2.1, 0.0, 1.1), (0.07, 0.1, 0.36), color)

def cup_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Body", (0.0, 0.0, 0.1), (0.15, 0.15, 0.1), color)
    marker_part(collection, root, "torus", root.name + " Handle", (0.17, 0.0, 0.12), (1.0, 1.0, 1.0), color, (math.radians(90), 0.0, 0.0))

def laptop_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Base", (0.0, 0.0, 0.04), (0.35, 0.24, 0.04), color)
    marker_part(collection, root, "box", root.name + " Screen", (0.0, 0.17, 0.22), (0.35, 0.025, 0.22), color, (math.radians(65), 0.0, 0.0))

def plate_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Plate", (0.0, 0.0, 0.025), (0.28, 0.28, 0.025), color)
    marker_part(collection, root, "cylinder", root.name + " Cake", (0.0, 0.0, 0.1), (0.15, 0.15, 0.07), "#d4a373")

def add_stage(collection, preset):
    primitive(collection, "box", "Nomi Floor", (0.0, 0.0, -0.06), (7.0, 7.0, 0.06), "#4b5563", "stage-floor")
    if preset == "coffee_shop":
        primitive(collection, "box", "Cafe Back Wall", (0.0, 4.8, 2.8), (7.0, 0.08, 2.8), "#c9b8a8", "stage-back-wall")
        primitive(collection, "box", "Cafe Window Wall", (-4.8, 0.0, 2.8), (0.08, 4.8, 2.8), "#d8c7b8", "stage-window-wall")
        primitive(collection, "box", "Cafe Window", (-4.7, -0.8, 2.5), (0.03, 2.0, 1.55), "#93c5d8", "stage-window")
        primitive(collection, "box", "Cafe Counter", (0.0, 4.0, 1.1), (4.4, 0.65, 1.1), "#4e342e", "stage-counter")
        primitive(collection, "box", "Cafe Counter Top", (0.0, 3.65, 2.22), (4.7, 0.2, 0.12), "#8b5e3c", "stage-counter-top")
        primitive(collection, "box", "Espresso Machine", (0.0, 3.4, 2.75), (0.8, 0.35, 0.5), "#475569", "stage-espresso-machine")
    elif preset == "city_street":
        primitive(collection, "box", "Street", (0.0, 0.0, 0.03), (12.0, 4.0, 0.04), "#374151", "stage-street")
        primitive(collection, "box", "Building Left", (-5.5, 3.2, 3.0), (2.5, 2.5, 3.0), "#6b7280", "stage-building-left")
        primitive(collection, "box", "Building Right", (5.5, 3.2, 3.0), (2.5, 2.5, 3.0), "#9ca3af", "stage-building-right")
    elif preset == "interior_room":
        primitive(collection, "box", "Back Wall", (0.0, 5.0, 3.0), (10.0, 0.1, 3.0), "#d6d3d1", "stage-back-wall")
        primitive(collection, "box", "Left Wall", (-5.0, 0.0, 3.0), (0.1, 10.0, 3.0), "#e7e5e4", "stage-left-wall")

def marker(collection, action):
    root = bpy.data.objects.new(action.get("name") or "Blocking Marker", None)
    root.empty_display_type = "PLAIN_AXES"
    root.location = vec3(action.get("position"))
    root.rotation_euler = rot3(action.get("rotation"))
    root.scale = scale3(action.get("scale"))
    collection.objects.link(root)
    tag(root, action.get("id"))
    tint = action.get("color") or "#60a5fa"
    role = marker_role(action)
    if role == "table":
        table_proxy(collection, root, tint)
    elif role == "chair":
        chair_proxy(collection, root, tint)
    elif role == "actor_standing":
        standing_actor_proxy(collection, root, tint)
    elif role.startswith("actor"):
        seated_actor_proxy(collection, root, tint)
    elif role == "cup":
        cup_proxy(collection, root, tint)
    elif role == "laptop":
        laptop_proxy(collection, root, tint)
    elif role == "plate":
        plate_proxy(collection, root, tint)
    else:
        marker_part(collection, root, "box", root.name + " Prop", (0.0, 0.0, 0.22), (0.24, 0.24, 0.22), tint)
    return root

def imported_asset(collection, action, assets):
    source = assets.get(action.get("assetId"))
    if not source:
        raise RuntimeError("assetId 不在本机资产库")
    before = set(bpy.data.objects.keys())
    extension = os.path.splitext(source)[1].lower()
    if extension in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=source)
    elif extension == ".fbx":
        bpy.ops.import_scene.fbx(filepath=source)
    elif extension == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=source)
        else:
            bpy.ops.import_scene.obj(filepath=source)
    elif extension == ".blend":
        with bpy.data.libraries.load(source, link=False) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj is not None and not obj.users_collection:
                bpy.context.scene.collection.objects.link(obj)
    else:
        raise RuntimeError("不支持的本机资产格式")
    new_objects = [bpy.data.objects[name] for name in set(bpy.data.objects.keys()) - before]
    root = bpy.data.objects.new(action.get("name") or "Imported Asset", None)
    root.empty_display_type = "CUBE"
    root.location = vec3(action.get("position"))
    root.rotation_euler = rot3(action.get("rotation"))
    root.scale = scale3(action.get("scale"))
    collection.objects.link(root)
    tag(root, action.get("id"))
    for obj in new_objects:
        if obj.parent is None:
            obj.parent = root
        move_to_collection(obj, collection)
    return root

def find_object(collection, object_ref):
    matches = [obj for obj in collection.objects if obj.get("nomi_director_id") == object_ref or obj.name == object_ref]
    return matches[0] if len(matches) == 1 else None

def look_at(obj, target):
    direction = Vector(target) - obj.location
    if direction.length > 0.0001:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

def director_camera(collection):
    existing = find_object(collection, "director-camera")
    if existing is not None and existing.type == "CAMERA":
        return existing
    data = bpy.data.cameras.new("Nomi Director Camera")
    obj = bpy.data.objects.new("Nomi Director Camera", data)
    collection.objects.link(obj)
    tag(obj, "director-camera")
    obj.location = vec3([5.0, 2.4, 6.0])
    obj.data.angle = math.radians(45.0)
    obj["nomi_aspect_ratio"] = "16:9"
    look_at(obj, vec3([0.0, 1.0, 0.0]))
    return obj

def apply_camera(collection, action):
    obj = director_camera(collection)
    if action.get("name"):
        obj.name = action.get("name")
    if action.get("position"):
        obj.location = vec3(action.get("position"))
    if action.get("lookAt"):
        look_at(obj, vec3(action.get("lookAt")))
    if action.get("fov"):
        obj.data.angle = math.radians(max(1.0, min(160.0, float(action.get("fov")))))
    if action.get("aspectRatio") in RATIOS:
        obj["nomi_aspect_ratio"] = action.get("aspectRatio")
    bpy.context.scene.camera = obj
    return obj

def apply_camera_path(collection, action):
    obj = director_camera(collection)
    points = action.get("points") or []
    duration = max(0.1, float(action.get("durationSec") or 3.0))
    fps = 24
    for index, point in enumerate(points):
        obj.location = vec3(point)
        frame = 1 + round((duration * fps) * index / max(1, len(points) - 1))
        obj.keyframe_insert(data_path="location", frame=frame)
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, 1 + round(duration * fps))
    bpy.context.scene.camera = obj

def ensure_lights(collection):
    if any(obj.type == "LIGHT" for obj in collection.objects):
        return
    data = bpy.data.lights.new("Nomi Key Light", type="AREA")
    data.energy = 850
    obj = bpy.data.objects.new("Nomi Key Light", data)
    obj.location = (4.0, -4.0, 6.0)
    collection.objects.link(obj)
    look_at(obj, (0.0, 0.0, 1.0))

def apply_plan(payload):
    plan = payload.get("plan") or {}
    collection = director_collection()
    if plan.get("mode") == "replace":
        remove_collection_objects(collection)
        remove_factory_startup_objects()
    assets = {item.get("id"): item.get("path") for item in payload.get("assets") or [] if item.get("id") and item.get("path")}
    for action in plan.get("actions") or []:
        op = action.get("op")
        if op == "set_stage":
            add_stage(collection, action.get("preset") or "empty")
        elif op == "add_marker":
            marker(collection, action)
        elif op == "place_asset":
            imported_asset(collection, action, assets)
        elif op == "move_object":
            obj = find_object(collection, action.get("objectRef"))
            if obj is None:
                raise RuntimeError("无法找到要调整的 Blender 对象")
            if action.get("position"):
                obj.location = vec3(action.get("position"))
            if action.get("rotation"):
                obj.rotation_euler = rot3(action.get("rotation"))
            if action.get("scale"):
                obj.scale = scale3(action.get("scale"))
            if action.get("name"):
                obj.name = action.get("name")
        elif op == "remove_object":
            obj = find_object(collection, action.get("objectRef"))
            if obj is None:
                raise RuntimeError("无法找到要移除的 Blender 对象")
            for child in list(obj.children_recursive):
                bpy.data.objects.remove(child, do_unlink=True)
            bpy.data.objects.remove(obj, do_unlink=True)
        elif op == "set_camera":
            apply_camera(collection, action)
        elif op == "set_camera_path":
            apply_camera_path(collection, action)
    ensure_lights(collection)
    camera = director_camera(collection)
    bpy.context.scene.camera = camera
    return camera

def main():
    plan_path, output_dir = args_after_separator()
    with open(plan_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    os.makedirs(output_dir, exist_ok=True)
    camera = apply_plan(payload)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.fps = 24
    aspect = camera.get("nomi_aspect_ratio", "16:9")
    width, height = RATIOS.get(aspect, RATIOS["16:9"])
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(output_dir, "preview.png")
    scene.render.film_transparent = False
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
    blend = os.path.join(output_dir, "scene.blend")
    model = os.path.join(output_dir, "scene.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=model, export_format="GLB")
    print(json.dumps({"ok": True, "jobId": payload.get("jobId"), "blenderVersion": bpy.app.version_string, "artifacts": {"preview": os.path.join(output_dir, "preview.png"), "blend": blend, "model": model}}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": {"message": str(error)}}, ensure_ascii=False))
        raise
`;
