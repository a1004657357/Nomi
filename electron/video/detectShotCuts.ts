// 按切镜检测：找出视频里的画面切点（一条爆款片子是怎么分镜的）。
//
// 通用基建，和 extractVideoFrame 同层：只认「视频 → 切点秒数 + 每个切点长什么样」，不知道任何 vendor。
// 注意别和 LLM 的「拆镜头」（canvasTools 的 propose_storyboard_plan）搞混——那是把**剧本文本**拆成分镜方案，
// 这里是对**已有视频**做画面级切分。
//
// 两趟 ffmpeg，就两趟（不随切点数量增长）：
//   ① 检测：select='gt(scene,LOW)',metadata=print → 吐出每个切点的 pts_time **和 scene_score**。
//   ② 缩略图：同一个 select 条件 + tile → 把这些帧拼成**一张**联系表，切点与格子 1:1 对齐。
//
// 关键设计：检测固定用**低阈值**跑一次拿到全集（带分数），UI 的灵敏度滑杆在**前端**按分数过滤。
// 这样滑杆瞬时响应、且只花一次解码——不必每动一下滑杆重跑 ffmpeg。联系表也在同一阈值下生成，
// 所以第 i 个切点恒对应第 i 个格子，前端过滤只是「少显示几格」，索引不会错位。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { probeMediaMetadata } from "../export/mediaProbe";
import { writeProjectCacheFile } from "../assets/projectCacheFile";
import { resolveVideoLocalPath } from "./extractVideoFrame";

/** 检测阈值下限：拿全集用它，前端滑杆再往上筛。太低会把运镜/闪光当切点，0.1 是实测的合理地板。 */
export const SHOT_CUT_DETECT_THRESHOLD = 0.1;
/** 联系表列数（行数按切点数推）。 */
export const SHOT_SHEET_COLUMNS = 8;
/** 每格高度（px）。宽度由源视频比例决定，前端按 sheet 实际宽 / 列数算。 */
export const SHOT_SHEET_TILE_HEIGHT = 90;
/** 单次最多认多少个切点——极碎的片子（快剪 MV）能检出几百个，全铺出来既慢又没法选。 */
const MAX_CUTS = 120;

export type ShotCut = {
  /** 切点在源视频里的秒数。 */
  seconds: number;
  /** 该切点的画面变化强度（0-1）。前端灵敏度滑杆按它过滤。 */
  score: number;
};

export type DetectShotCutsPayload = { videoUrl: string; projectId: string };

export type DetectShotCutsResult = {
  cuts: ShotCut[];
  durationSeconds: number;
  /** 联系表图（nomi-local URL）；切点为 0 时为 null。落项目缓存区，**不进素材库**。 */
  sheetUrl: string | null;
  sheetColumns: number;
  sheetTileHeight: number;
  /** 检测时是否被 MAX_CUTS 截断——截断了必须让用户知道，不能假装「就这么多」。 */
  truncated: boolean;
};

export class ShotCutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShotCutError";
  }
}

/** 跑 ffmpeg 并收 stdout（metadata=print:file=- 写的是 stdout，实测 stderr 无内容）。 */
function runFfmpegCapture(ffmpegPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** 解析 metadata=print 的输出：`pts_time:<秒>` 后跟一行 `lavfi.scene_score=<分>`。纯函数，可单测。 */
export function parseShotCutOutput(stdout: string): ShotCut[] {
  const cuts: ShotCut[] = [];
  const re = /pts_time:([\d.]+)[\s\S]*?lavfi\.scene_score=([\d.]+)/g;
  let match = re.exec(stdout);
  while (match) {
    const seconds = Number.parseFloat(match[1] ?? "");
    const score = Number.parseFloat(match[2] ?? "");
    if (Number.isFinite(seconds) && Number.isFinite(score)) cuts.push({ seconds, score });
    match = re.exec(stdout);
  }
  return cuts;
}

/** 检测用的 filtergraph（纯函数，与联系表共用同一个 select 条件——两者必须同阈值，否则格子对不上切点）。 */
export function buildDetectFilter(threshold: number): string {
  return `select='gt(scene,${threshold})',metadata=print:file=-`;
}

/** 联系表用的 filtergraph。 */
export function buildSheetFilter(threshold: number, columns: number, rows: number, tileHeight: number): string {
  return `select='gt(scene,${threshold})',scale=-2:${tileHeight},tile=${columns}x${rows}`;
}

export async function detectShotCuts(payload: DetectShotCutsPayload): Promise<DetectShotCutsResult> {
  const videoUrl = String(payload?.videoUrl || "").trim();
  const projectId = String(payload?.projectId || "").trim();
  if (!videoUrl) throw new ShotCutError("缺少视频地址");
  if (!projectId) throw new ShotCutError("缺少项目 id");
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new ShotCutError("没找到 ffmpeg，无法检测镜头切点");

  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  try {
    const meta = await probeMediaMetadata(filePath);
    const durationSeconds = typeof meta.durationSeconds === "number" && Number.isFinite(meta.durationSeconds)
      ? meta.durationSeconds
      : 0;

    // ① 检测
    const detect = await runFfmpegCapture(ffmpegPath, [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-vf", buildDetectFilter(SHOT_CUT_DETECT_THRESHOLD),
      "-an", "-f", "null", "-",
    ]);
    if (detect.code !== 0) {
      throw new ShotCutError(`镜头切点检测失败（code ${detect.code}）：${detect.stderr.trim().slice(-300) || "(无 stderr)"}`);
    }
    const all = parseShotCutOutput(detect.stdout);
    const truncated = all.length > MAX_CUTS;
    const cuts = truncated ? all.slice(0, MAX_CUTS) : all;
    if (!cuts.length) {
      return {
        cuts: [], durationSeconds, sheetUrl: null,
        sheetColumns: SHOT_SHEET_COLUMNS, sheetTileHeight: SHOT_SHEET_TILE_HEIGHT, truncated: false,
      };
    }

    // ② 联系表：同一 select 条件，故第 i 格恒是第 i 个切点。
    const rows = Math.ceil(cuts.length / SHOT_SHEET_COLUMNS);
    const outPath = path.join(os.tmpdir(), `nomi-shotsheet-${crypto.randomUUID()}.jpg`);
    try {
      const sheet = await runFfmpegCapture(ffmpegPath, [
        "-y", "-hide_banner", "-nostats",
        "-i", filePath,
        "-vf", buildSheetFilter(SHOT_CUT_DETECT_THRESHOLD, SHOT_SHEET_COLUMNS, rows, SHOT_SHEET_TILE_HEIGHT),
        "-frames:v", "1", "-q:v", "4", "-an",
        outPath,
      ]);
      if (sheet.code !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
        // 缩略图挂了不该拖垮整件事：切点数据仍然有用（用户照样能按时间点选）。
        return {
          cuts, durationSeconds, sheetUrl: null,
          sheetColumns: SHOT_SHEET_COLUMNS, sheetTileHeight: SHOT_SHEET_TILE_HEIGHT, truncated,
        };
      }
      // 落项目缓存区而非素材库：这是可再生的中间产物，写进素材库会把用户的库刷屏（见 filmstrip 的同款教训）。
      const written = writeProjectCacheFile(projectId, fs.readFileSync(outPath), "shot-cuts", ".jpg");
      return {
        cuts, durationSeconds, sheetUrl: written.url,
        sheetColumns: SHOT_SHEET_COLUMNS, sheetTileHeight: SHOT_SHEET_TILE_HEIGHT, truncated,
      };
    } finally {
      try { fs.unlinkSync(outPath); } catch { /* non-fatal */ }
    }
  } finally {
    cleanup();
  }
}
