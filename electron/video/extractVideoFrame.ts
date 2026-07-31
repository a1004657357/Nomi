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
  const digest = crypto.createHash("sha256").update(`${videoUrl}\0${String(which)}`).digest("hex").slice(0, 24);
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

function persistentFrameLocation(payload: ExtractVideoFramePayload): {
  absolutePath: string;
  url: string;
} {
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
      // Another Nomi process may win the same deterministic cache write.
      if (!payload.forceRerun && isUsableFrameFile(target.absolutePath)) return target.url;
      throw error;
    }
    return target.url;
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* non-fatal */ }
  }
}

/** 把源视频 URL 解析成磁盘可读的绝对路径；https 下载到 temp（返回 cleanup 删临时文件）。 */
async function resolveVideoLocalPath(
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
  return Math.max(0, duration - 0.1);
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
  const outPath = path.join(os.tmpdir(), `nomi-frame-${crypto.randomUUID()}.png`);
  try {
    const ss = await resolveSeekSeconds(filePath, payload.which);
    // 输入端粗 seek（快速跳过）+ 输出端精 seek（解码精确到目标帧）—— 又快又准，
    // 避开 -sseof 在部分封装上的不稳（handoff §5 坑）。
    const inputSeek = Math.max(0, ss - 2);
    const outputSeek = ss - inputSeek;
    const args = [
      "-y",
      "-ss", String(inputSeek),
      "-i", filePath,
      "-ss", String(outputSeek),
      "-frames:v", "1",
      "-q:v", "3",
      "-update", "1",
      outPath,
    ];
    await runFfmpeg(ffmpegPath, args);
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
  const { videoUrl, which, projectId } = payload;
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

/**
 * 批量抽取指定时间帧。远程视频只下载一次，随后在同一本地源上顺序抽帧；
 * 顺序执行刻意限制 FFmpeg 并发，避免检查器打开时抢占画布渲染资源。
 */
export async function extractVideoFramesToAssets(payload: ExtractVideoFramesPayload): Promise<ExtractVideoFramesResult> {
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

  return {
    frames: times.map((timeSeconds) => ({ timeSeconds, url: results.get(timeSeconds) || "" })),
  };
}

/** 测试用：清缓存。 */
export function resetVideoFrameCacheForTests(): void {
  frameCache.clear();
}
