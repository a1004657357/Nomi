// V-a 技术自检(harness S4-2b,总方案 §7.3 L0 层):生成产物落地后的免费客观检查。
// 视频:大面积黑帧(blackdetect)/全程静音(silencedetect,仅当有音轨)/零时长;
// 图片:能否解码 + 尺寸有效。
// 纪律:**只标记,绝不拦截、绝不静默丢弃、绝不自动重跑**——审美的裁判是用户(不抄
// OpenMontage 的"review 不过就不呈现")。异步旁路,任何失败吞掉,绝不挡结果呈现。
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata, type MediaProbeMetadata } from "../export/mediaProbe";
import { desktopT } from "../i18n";

export type TechnicalCheckItem = {
  id: "black-frames" | "frozen-video" | "silent-audio" | "zero-duration" | "undecodable" | "aspect-ratio" | "duration";
  suspect: boolean;
  detail: string;
  metrics?: Record<string, number>;
};

export type TechnicalCheckVerdict = {
  suspect: boolean;
  checks: TechnicalCheckItem[];
  metadata?: MediaProbeMetadata;
};

export type TechnicalCheckOptions = {
  probeMedia?: (absolutePath: string) => Promise<MediaProbeMetadata>;
  runFfmpegStderr?: (args: string[]) => Promise<string>;
  expectedAspectRatio?: string;
  expectedDurationSeconds?: number;
};

const FFMPEG_CHECK_TIMEOUT_MS = 30_000;

function runFfmpegStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ["-hide_banner", "-nostats", ...args]);
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stderr);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
      forceKill.unref?.();
      finish(new Error(desktopT("review.checkTimedOut")));
    }, FFMPEG_CHECK_TIMEOUT_MS);
    timeout.unref?.();
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", () => finish());
  });
}

function sumMatches(stderr: string, pattern: RegExp): number {
  let total = 0;
  for (const match of stderr.matchAll(pattern)) total += Number(match[1]) || 0;
  return total;
}

export type VideoTechnicalMetrics = {
  blackSeconds: number;
  blackRatio: number;
  frozenSeconds: number;
  freezeRatio: number;
};

export function parseVideoTechnicalMetrics(stderr: string, durationSeconds: number): VideoTechnicalMetrics {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const boundedSeconds = (value: number) => Math.max(0, Math.min(duration, value));
  const blackSeconds = boundedSeconds(sumMatches(stderr, /black_duration:\s*([\d.]+)/g));
  const freezeDurations = Array.from(
    stderr.matchAll(/lavfi\.freezedetect\.freeze_duration:\s*([\d.]+)/g),
    (match) => Number(match[1]) || 0,
  );
  const freezeStarts = Array.from(
    stderr.matchAll(/lavfi\.freezedetect\.freeze_start:\s*([\d.]+)/g),
    (match) => Number(match[1]) || 0,
  );
  let frozenSeconds = freezeDurations.reduce((sum, value) => sum + value, 0);
  if (freezeStarts.length > freezeDurations.length && duration > 0) {
    frozenSeconds += Math.max(0, duration - (freezeStarts.at(-1) ?? duration));
  }
  frozenSeconds = boundedSeconds(frozenSeconds);
  return {
    blackSeconds,
    blackRatio: duration > 0 ? blackSeconds / duration : 0,
    frozenSeconds,
    freezeRatio: duration > 0 ? frozenSeconds / duration : 0,
  };
}

/** 黑帧占比 >60% 才标记(保守阈值:夜景/淡入淡出不该被冤枉)。 */
const BLACK_RATIO_THRESHOLD = 0.6;
/** 静音占比 >90% 才标记。 */
const SILENCE_RATIO_THRESHOLD = 0.9;
/** 冻结占比 >65% 才标记，保留静态构图和慢镜头空间。 */
const FREEZE_RATIO_THRESHOLD = 0.65;
/** 允许图片模型因内部缩放产生亚像素级取整；超过 1% 才判为画幅不符。 */
const ASPECT_RATIO_RELATIVE_ERROR_THRESHOLD = 0.01;
const MINIMUM_GENERATED_IMAGE_DIMENSION = 512;

function parseExpectedAspectRatio(value: string | undefined): number | null {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

export async function runTechnicalCheck(
  absolutePath: string,
  type: "image" | "video",
  options: TechnicalCheckOptions = {},
): Promise<TechnicalCheckVerdict> {
  const checks: TechnicalCheckItem[] = [];
  try {
    const meta = await (options.probeMedia ?? probeMediaMetadata)(absolutePath);
    const runFfmpeg = options.runFfmpegStderr ?? runFfmpegStderr;
    const expectedRatio = parseExpectedAspectRatio(options.expectedAspectRatio);
    if (expectedRatio && (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0) {
      const actualRatio = (meta.width ?? 0) / (meta.height ?? 1);
      const relativeError = Math.abs(actualRatio / expectedRatio - 1);
      const suspect = relativeError > ASPECT_RATIO_RELATIVE_ERROR_THRESHOLD;
      checks.push({
        id: "aspect-ratio",
        suspect,
        detail: suspect
          ? desktopT("review.aspectMismatch", { width: meta.width ?? 0, height: meta.height ?? 0, ratio: options.expectedAspectRatio ?? '' })
          : desktopT("review.aspectMatch", { width: meta.width ?? 0, height: meta.height ?? 0, ratio: options.expectedAspectRatio ?? '' }),
        metrics: {
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          expectedRatio,
          actualRatio,
          relativeError,
        },
      });
    }
    if (type === "image") {
      const decodable = (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0;
      const largeEnough =
        (meta.width ?? 0) >= MINIMUM_GENERATED_IMAGE_DIMENSION
        && (meta.height ?? 0) >= MINIMUM_GENERATED_IMAGE_DIMENSION;
      checks.push({
        id: "undecodable",
        suspect: !decodable || !largeEnough,
        detail: !decodable
          ? desktopT("review.imageUndecodable")
          : !largeEnough
            ? desktopT("review.imageTooSmall", { width: meta.width ?? 0, height: meta.height ?? 0, minimum: MINIMUM_GENERATED_IMAGE_DIMENSION })
            : `${meta.width}×${meta.height}`,
        metrics: {
          width: meta.width ?? 0,
          height: meta.height ?? 0,
        },
      });
    } else {
      const duration = meta.durationSeconds ?? 0;
      if (typeof options.expectedDurationSeconds === "number" && options.expectedDurationSeconds > 0) {
        const durationDeltaSeconds = Math.abs(duration - options.expectedDurationSeconds);
        const suspect = durationDeltaSeconds > 0.5;
        checks.push({
          id: "duration",
          suspect,
          detail: suspect
            ? desktopT("review.durationMismatch", { actual: duration.toFixed(2), expected: options.expectedDurationSeconds })
            : desktopT("review.durationMatch", { actual: duration.toFixed(2), expected: options.expectedDurationSeconds }),
          metrics: {
            durationSeconds: duration,
            expectedDurationSeconds: options.expectedDurationSeconds,
            durationDeltaSeconds,
          },
        });
      }
      checks.push({
        id: "zero-duration",
        suspect: duration <= 0.1,
        detail: duration > 0.1 ? desktopT("review.duration", { seconds: duration.toFixed(1) }) : desktopT("review.zeroDuration"),
        metrics: { durationSeconds: duration },
      });
      if (duration > 0.1) {
        const videoStderr = await runFfmpeg([
          "-i",
          absolutePath,
          "-vf",
          "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=0.5",
          "-an",
          "-f",
          "null",
          "-",
        ]);
        const metrics = parseVideoTechnicalMetrics(videoStderr, duration);
        checks.push({
          id: "black-frames",
          suspect: metrics.blackRatio > BLACK_RATIO_THRESHOLD,
          detail: metrics.blackRatio > BLACK_RATIO_THRESHOLD
            ? desktopT("review.blackRatio", { percent: Math.round(metrics.blackRatio * 100) })
            : desktopT("review.blackFrames", { percent: Math.round(metrics.blackRatio * 100) }),
          metrics: {
            blackSeconds: metrics.blackSeconds,
            blackRatio: metrics.blackRatio,
          },
        });
        checks.push({
          id: "frozen-video",
          suspect: metrics.freezeRatio > FREEZE_RATIO_THRESHOLD,
          detail: metrics.freezeRatio > FREEZE_RATIO_THRESHOLD
            ? desktopT("review.frozenRatio", { percent: Math.round(metrics.freezeRatio * 100) })
            : desktopT("review.frozenFrames", { percent: Math.round(metrics.freezeRatio * 100) }),
          metrics: {
            frozenSeconds: metrics.frozenSeconds,
            freezeRatio: metrics.freezeRatio,
          },
        });
        if (meta.hasAudio) {
          const silenceStderr = await runFfmpeg(["-i", absolutePath, "-af", "silencedetect=n=-50dB:d=2", "-vn", "-f", "null", "-"]);
          const silenceSeconds = sumMatches(silenceStderr, /silence_duration:\s*([\d.]+)/g);
          const silenceRatio = silenceSeconds / duration;
          checks.push({
            id: "silent-audio",
            suspect: silenceRatio > SILENCE_RATIO_THRESHOLD,
            detail: silenceRatio > SILENCE_RATIO_THRESHOLD
              ? desktopT("review.silentAudio") : desktopT("review.silenceRatio", { percent: Math.round(silenceRatio * 100) }),
            metrics: { silenceSeconds, silenceRatio },
          });
        }
      }
    }
    return { suspect: checks.some((check) => check.suspect), checks, metadata: meta };
  } catch (error) {
    // 探测本身失败 = 文件可疑(下载残缺/格式损坏)
    checks.push({
      id: "undecodable",
      suspect: true,
      detail: desktopT("review.probeFailed", { detail: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120) }),
    });
  }
  return { suspect: checks.some((check) => check.suspect), checks };
}
