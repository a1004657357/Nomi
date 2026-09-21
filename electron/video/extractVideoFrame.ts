// 视频抽帧（首/尾帧/指定秒）→ 项目素材 nomi-local:// URL。
//
// 通用基建：只认「视频 + 取哪一帧 → 图片 URL」，不知道 Seedance / storyboard / 任何 vendor。
// 用途：① 视频接力（前一镜尾帧当后一镜首帧）；② 喂任何需要首尾帧图的模型。
// ffmpeg/ffprobe 复用 export 那套（resolveFfmpegPath + ensureExecutable + probeMediaMetadata），
// 执行位陷阱（memory ffprobe-exec-bit-packaging-trap）由 ensureExecutable 兜。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { probeMediaMetadata } from "../export/mediaProbe";
import { localAssetUrl } from "../assets/assetPaths";
import { absolutePathFromLocalAssetUrl } from "../assets/localAssetFile";
import { hardenedFetch } from "../hardenedFetch";
import { writeProjectCacheFile } from "../assets/projectCacheFile";
import { writeAsset } from "../assets/projectAssetStore";
import { resolveProjectRelativePath } from "../projects/repository";

export type VideoFrameWhich = "first" | "last" | number;

export type ExtractVideoFramePayload = {
  videoUrl: string;
  which: VideoFrameWhich;
  projectId: string;
  /** 跳过缓存强制重抽（参考 fingerprintCache 的 forceRerun 语义）。 */
  forceRerun?: boolean;
};

export type ExtractVideoFrameResult = { url: string };

export type ExtractVideoFramesPayload = {
  videoUrl: string;
  times: number[];
  projectId: string;
  forceRerun?: boolean;
};

export type ExtractVideoFramesResult = {
  frames: Array<{ timeSeconds: number; url: string }>;
};

export class VideoFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoFrameError";
  }
}

/** (projectId, videoUrl, which) → nomi-local URL。会话内内存缓存，避免同源同帧重复抽。 */
const frameCache = new Map<string, string>();
const cacheKey = (p: ExtractVideoFramePayload) => `${p.projectId}::${p.videoUrl}::${String(p.which)}`;
const FRAME_CACHE_DIR = "assets/generated/video-frames";

function frameLabel(which: VideoFrameWhich): string {
  if (which === "first" || which === "last") return which;
  return "at";
}

export function videoFrameCacheRelativePath(videoUrl: string, which: VideoFrameWhich): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${videoUrl}\0${String(which)}`)
    .digest("hex")
    .slice(0, 24);
  return `${FRAME_CACHE_DIR}/frame-${frameLabel(which)}-${digest}.png`;
}

function isUsableFrameFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function persistentFrameLocation(payload: ExtractVideoFramePayload): { absolutePath: string; url: string } {
  const relativePath = videoFrameCacheRelativePath(payload.videoUrl, payload.which);
  return {
    absolutePath: resolveProjectRelativePath(payload.projectId, relativePath),
    url: localAssetUrl(payload.projectId, relativePath),
  };
}

function readCachedFrame(payload: ExtractVideoFramePayload): string | null {
  if (payload.forceRerun) return null;
  const key = cacheKey(payload);
  const cached = frameCache.get(key);
  if (cached) return cached;
  const persistent = persistentFrameLocation(payload);
  if (!isUsableFrameFile(persistent.absolutePath)) return null;
  frameCache.set(key, persistent.url);
  return persistent.url;
}

function writePersistentFrame(payload: ExtractVideoFramePayload, sourcePath: string): string {
  const target = persistentFrameLocation(payload);
  fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
  if (!payload.forceRerun && isUsableFrameFile(target.absolutePath)) return target.url;

  const tempPath = `${target.absolutePath}.${crypto.randomUUID()}.tmp`;
  fs.copyFileSync(sourcePath, tempPath);
  try {
    if (!payload.forceRerun && isUsableFrameFile(target.absolutePath)) return target.url;
    if (payload.forceRerun) fs.rmSync(target.absolutePath, { force: true });
    try {
      fs.renameSync(tempPath, target.absolutePath);
    } catch (error) {
      if (!payload.forceRerun && isUsableFrameFile(target.absolutePath)) return target.url;
      throw error;
    }
    return target.url;
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * 把源视频 URL 解析成磁盘可读的绝对路径；https 下载到 temp（返回 cleanup 删临时文件）。
 * 导出给 detectShotCuts 共用——同一套 nomi-local 反解 / SSRF 加固下载 / 绝对路径判定只此一份（P1）。
 */
export async function resolveVideoLocalPath(
  videoUrl: string,
  projectId: string,
): Promise<{ filePath: string; cleanup: () => void }> {
  const noop = () => {};
  if (videoUrl.startsWith("nomi-local://")) {
    const abs = absolutePathFromLocalAssetUrl(videoUrl, projectId);
    if (!abs) throw new VideoFrameError("源视频不在当前项目素材里（nomi-local 反解失败）");
    return { filePath: abs, cleanup: noop };
  }
  if (/^https?:\/\//i.test(videoUrl)) {
    // SSRF/DoS 加固：走 hardenedFetch（私网/回环拦截 + 重定向终点复检 + 大小/超时上限），
    // 与 importRemoteAsset / readAudioBytes 同源。不限 content-type——relay 常以
    // application/octet-stream 发视频，真伪交给随后的 ffmpeg 解码兜底。
    let result;
    try {
      result = await hardenedFetch(videoUrl, { maxBytes: 300 * 1024 * 1024, timeoutMs: 60_000 });
    } catch (error) {
      throw new VideoFrameError(`源视频下载失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const tmp = path.join(os.tmpdir(), `nomi-relay-src-${crypto.randomUUID()}.mp4`);
    fs.writeFileSync(tmp, result.bytes);
    return { filePath: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch { /* non-fatal */ } } };
  }
  if (path.isAbsolute(videoUrl) && fs.existsSync(videoUrl)) {
    return { filePath: videoUrl, cleanup: noop };
  }
  throw new VideoFrameError(`无法识别的视频地址：${videoUrl.slice(0, 80)}`);
}

/** 算出抽哪一秒。last 需先 probe 时长，取末尾 0.1s 处（避开 EOF 黑帧/解码边界）。 */
async function resolveSeekSeconds(filePath: string, which: VideoFrameWhich): Promise<number> {
  if (which === "first") return 0;
  if (typeof which === "number") return Math.max(0, which);
  // which === 'last'
  const meta = await probeMediaMetadata(filePath);
  const duration = typeof meta.durationSeconds === "number" ? meta.durationSeconds : 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoFrameError("无法读取源视频时长，取不到尾帧");
  }
  // ffprobe/container duration may follow a slightly longer audio stream. Seeking only 0.1s
  // before EOF can still land after the final video frame, so keep a conservative margin.
  return Math.max(0, duration - Math.min(0.25, duration / 10));
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new VideoFrameError(`ffmpeg 抽帧失败（code ${code}）：${stderr.trim().slice(-300) || "(无 stderr)"}`));
    });
  });
}

async function extractResolvedVideoFrame(
  payload: ExtractVideoFramePayload,
  ffmpegPath: string,
  filePath: string,
): Promise<ExtractVideoFrameResult> {
  const { which } = payload;
  const outPath = path.join(os.tmpdir(), `nomi-frame-${crypto.randomUUID()}.png`);
  try {
    const ss = await resolveSeekSeconds(filePath, which);
    const inputSeek = Math.max(0, ss - 2);
    const outputSeek = ss - inputSeek;
    await runFfmpeg(ffmpegPath, [
      "-y",
      "-ss", String(inputSeek),
      "-i", filePath,
      "-ss", String(outputSeek),
      "-frames:v", "1",
      "-q:v", "3",
      "-update", "1",
      outPath,
    ]);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new VideoFrameError("ffmpeg 未产出有效帧图");
    }
    const url = writePersistentFrame(payload, outPath);
    frameCache.set(cacheKey(payload), url);
    return { url };
  } finally {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* non-fatal */ }
  }
}

/**
 * 抽一帧落成项目素材。失败一律抛 VideoFrameError —— **绝不返回视频/封面冒充**
 * （resolver 的「不冒充」不变量靠这里兜底：上游拿到 error 就标人话错误、不裸跑）。
 */
export async function extractVideoFrameToAsset(payload: ExtractVideoFramePayload): Promise<ExtractVideoFrameResult> {
  const { videoUrl, projectId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new VideoFrameError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new VideoFrameError("缺少 projectId");

  const cached = readCachedFrame(payload);
  if (cached) return { url: cached };

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new VideoFrameError("找不到 ffmpeg 可执行文件");

  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  try {
    return await extractResolvedVideoFrame(payload, ffmpegPath, filePath);
  } finally {
    cleanup();
  }
}

export function normalizeVideoFrameTimes(times: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const raw of times) {
    if (!Number.isFinite(raw)) continue;
    unique.add(Math.round(Math.max(0, raw) * 1000) / 1000);
  }
  return [...unique].sort((a, b) => a - b);
}

/** Batch extraction shares one source download and limits FFmpeg work to one frame at a time. */
export async function extractVideoFramesToAssets(
  payload: ExtractVideoFramesPayload,
): Promise<ExtractVideoFramesResult> {
  const { videoUrl, projectId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new VideoFrameError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new VideoFrameError("缺少 projectId");
  if (!Array.isArray(payload.times)) throw new VideoFrameError("缺少抽帧时间点");
  const times = normalizeVideoFrameTimes(payload.times);
  if (!times.length) throw new VideoFrameError("没有有效的抽帧时间点");
  if (times.length > 24) throw new VideoFrameError("一次最多抽取 24 帧");

  const results = new Map<number, string>();
  const pending: ExtractVideoFramePayload[] = [];
  for (const timeSeconds of times) {
    const framePayload = { videoUrl, projectId, which: timeSeconds, forceRerun: payload.forceRerun };
    const cached = readCachedFrame(framePayload);
    if (cached) results.set(timeSeconds, cached);
    else pending.push(framePayload);
  }

  if (pending.length) {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) throw new VideoFrameError("找不到 ffmpeg 可执行文件");
    const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
    try {
      for (const framePayload of pending) {
        const result = await extractResolvedVideoFrame(framePayload, ffmpegPath, filePath);
        results.set(framePayload.which as number, result.url);
      }
    } finally {
      cleanup();
    }
  }
  return { frames: times.map((timeSeconds) => ({ timeSeconds, url: results.get(timeSeconds) || "" })) };
}

/** 测试用：清缓存。 */
export function resetVideoFrameCacheForTests(): void {
  frameCache.clear();
}

// ---------- 首尾双帧拼图（审片环判视频用） ----------

export type ExtractEndpointsPayload = {
  videoUrl: string;
  projectId: string;
  forceRerun?: boolean;
};

/**
 * 把一条视频的**首帧与尾帧横向拼成一张图**（左=首帧，右=尾帧）。
 *
 * 为什么要它（2026-08-20 L3-F1 实测抓出）：审片环判视频时只抽首帧，于是**任何随时间展开的镜头都被误判**。
 * 实例：某镜的设计是「远处路灯下逐渐显出一个背影」——判分器在 t=0 看，画面空无一人 → 构图 1 档 →
 * 重滚一次 → 仍 1 档 → 红标。而尾帧里人影明明出现了。红标是信任的基石，误报和漏报一样毁它，
 * 何况还白烧了一次重滚。而「逐渐显出 / 由暗转亮 / 缓缓推近」是短剧最常见的镜头语言，不是边缘情况。
 *
 * 顺带补上另一个盲区：只看一帧时，identity 轴对**中途变脸**（视频生成的头号失败模式）完全失明。
 * 首尾同图后，判分器能直接比较两端是不是同一个人。
 *
 * 为什么拼成一张而不是喂两张图：runtime 的多模态通道只取 `referenceImages` 的**第一张**
 * （见 shotVerifyDeps 的 callJudge 注释），传两张会静默丢一张。拼图对任何单图判分模型都成立，
 * 不依赖某家的多图能力。
 *
 * 两端等高缩放后 hstack（hstack 要求输入等高）。失败时调用方按「取帧失败 → 跳过判分」处理，不阻断生成。
 */
export async function extractVideoEndpointsToAsset(payload: ExtractEndpointsPayload): Promise<ExtractVideoFrameResult> {
  const { videoUrl, projectId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new VideoFrameError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new VideoFrameError("缺少 projectId");

  const key = `${projectId}::${videoUrl}::endpoints`;
  if (!payload.forceRerun) {
    const cached = frameCache.get(key);
    if (cached) return { url: cached };
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new VideoFrameError("找不到 ffmpeg 可执行文件");

  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  const outPath = path.join(os.tmpdir(), `nomi-endpoints-${crypto.randomUUID()}.png`);
  try {
    const lastSeek = await resolveSeekSeconds(filePath, "last");
    const args = [
      "-y",
      "-ss", "0", "-i", filePath,
      "-ss", String(lastSeek), "-i", filePath,
      // 等高缩放（-2 = 保持比例并取偶数宽，libx264/png 都要求偶数），再横向拼。
      "-filter_complex", "[0:v]scale=-2:720,setsar=1[a];[1:v]scale=-2:720,setsar=1[b];[a][b]hstack=inputs=2",
      "-frames:v", "1",
      "-q:v", "3",
      "-update", "1",
      outPath,
    ];
    await runFfmpeg(ffmpegPath, args);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new VideoFrameError("ffmpeg 未产出有效的首尾拼图");
    }
    const bytes = fs.readFileSync(outPath);
    const record = writeAsset(projectId, bytes, `frame-endpoints-${crypto.randomUUID().slice(0, 8)}.png`, "image/png", {
      kind: "generated",
      source: "video-frame",
    }) as { data?: { url?: string } };
    const url = record?.data?.url;
    if (!url) throw new VideoFrameError("首尾拼图写盘失败");
    frameCache.set(key, url);
    return { url };
  } finally {
    cleanup();
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* non-fatal */ }
  }
}

// ---------- 胶片缩略图条（时间轴 clip 全员真帧的基建） ----------

export type ExtractFilmstripPayload = {
  videoUrl: string;
  projectId: string;
  forceRerun?: boolean;
};

export type ExtractFilmstripResult = {
  url: string;
  /** 横向平铺帧数（固定 16）。渲染层据此把条图映射回源时长。 */
  tiles: number;
  tileHeight: number;
};

export const FILMSTRIP_TILES = 16;
export const FILMSTRIP_TILE_HEIGHT = 54;

/** 纯函数：拼 ffmpeg 参数（fps 轻微过采样保证凑满 tiles 帧，tile 只吃前 tiles 帧）。 */
export function buildFilmstripArgs(params: {
  inputPath: string;
  outPath: string;
  durationSeconds: number;
  tiles?: number;
  tileHeight?: number;
}): string[] {
  const tiles = Math.max(2, Math.floor(params.tiles ?? FILMSTRIP_TILES));
  const tileHeight = Math.max(16, Math.floor(params.tileHeight ?? FILMSTRIP_TILE_HEIGHT));
  const duration = Math.max(0.2, params.durationSeconds);
  const fps = (tiles / duration) * 1.02;
  return [
    "-y",
    "-i", params.inputPath,
    "-an", "-sn",
    "-vf", `fps=${fps.toFixed(6)},scale=-2:${tileHeight},tile=${tiles}x1`,
    "-frames:v", "1",
    "-q:v", "5",
    params.outPath,
  ];
}

const filmstripCache = new Map<string, ExtractFilmstripResult>();
const filmstripInflight = new Map<string, Promise<ExtractFilmstripResult>>();
const filmstripKey = (p: ExtractFilmstripPayload) => `${p.projectId}::${p.videoUrl}`;

/**
 * 抽 16 帧横向拼条落项目素材（jpg）。会话内缓存 + inflight 去重（时间轴多 clip 同源只抽一次）。
 * 失败抛 VideoFrameError，渲染层回退占位色块——绝不拿别的图冒充。
 */
export async function extractVideoFilmstripToAsset(payload: ExtractFilmstripPayload): Promise<ExtractFilmstripResult> {
  const { videoUrl, projectId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new VideoFrameError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new VideoFrameError("缺少 projectId");

  const key = filmstripKey(payload);
  if (!payload.forceRerun) {
    const cached = filmstripCache.get(key);
    if (cached) return cached;
    const inflight = filmstripInflight.get(key);
    if (inflight) return inflight;
  }

  const job = (async (): Promise<ExtractFilmstripResult> => {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) throw new VideoFrameError("找不到 ffmpeg 可执行文件");
    const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
    const outPath = path.join(os.tmpdir(), `nomi-filmstrip-${crypto.randomUUID()}.jpg`);
    try {
      const meta = await probeMediaMetadata(filePath);
      const duration = typeof meta.durationSeconds === "number" ? meta.durationSeconds : 0;
      if (!Number.isFinite(duration) || duration <= 0) throw new VideoFrameError("无法读取源视频时长，抽不了胶片条");
      await runFfmpeg(ffmpegPath, buildFilmstripArgs({ inputPath: filePath, outPath, durationSeconds: duration }));
      if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new VideoFrameError("ffmpeg 未产出胶片条");
      const bytes = fs.readFileSync(outPath);
      // 胶片条是**缓存**不是用户素材：写 .nomi/cache/ 而非 assets/。
      // （曾写成素材 → 26:1 长条涌进素材库把真素材挤成细线，素材库看着像空的。）
      const { url } = writeProjectCacheFile(projectId, bytes, "filmstrip", ".jpg");
      if (!url) throw new VideoFrameError("胶片条写盘失败");
      const result: ExtractFilmstripResult = { url, tiles: FILMSTRIP_TILES, tileHeight: FILMSTRIP_TILE_HEIGHT };
      filmstripCache.set(key, result);
      return result;
    } finally {
      cleanup();
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* non-fatal */ }
    }
  })();
  filmstripInflight.set(key, job);
  try {
    return await job;
  } finally {
    filmstripInflight.delete(key);
  }
}

/** 测试用：清胶片缓存。 */
export function resetFilmstripCacheForTests(): void {
  filmstripCache.clear();
  filmstripInflight.clear();
}
