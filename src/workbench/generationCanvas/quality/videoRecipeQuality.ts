import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityReport,
  GenerationQualityStatus,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import type {
  CapabilityRecipeVideoInspection,
  CapabilityRecipeVideoInspector,
} from './capabilityQualityTypes'
import {
  hasMediaLocator,
  qualityStatusFromChecks,
  roundQualityMetric,
} from './capabilityQualityUtils'

function expectedAspectRatio(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const [width, height] = value.split(':', 2).map(Number)
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? width! / height!
    : undefined
}

function videoInspectionMetric(
  inspection: CapabilityRecipeVideoInspection | undefined,
  checkId: string,
  metric: string,
): number | undefined {
  const value = inspection?.checks.find((check) => check.id === checkId)?.metrics?.[metric]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export async function evaluateVideoCollection(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  inspectVideo?: CapabilityRecipeVideoInspector,
  evaluatedAt = Date.now(),
  sourceResult?: GenerationNodeResult,
): Promise<GenerationResultCollection> {
  const item = collection.items[0]
  const result = item?.status === 'success'
    && item.result?.type === 'video'
    && hasMediaLocator(item.result)
    ? item.result
    : undefined
  let inspection: CapabilityRecipeVideoInspection | undefined
  let inspectionError = ''
  if (result && inspectVideo) {
    try {
      inspection = await inspectVideo(result)
    } catch (error) {
      inspectionError = error instanceof Error && error.message ? error.message : String(error)
    }
  } else if (result) {
    inspectionError = '当前运行环境未提供本地视频探测器'
  }
  const isVideoEdit = plan.recipeId === 'video.edit.look' || plan.recipeId === 'video.edit.effect'
  let sourceInspection: CapabilityRecipeVideoInspection | undefined
  let sourceInspectionError = ''
  const sourceVideo = sourceResult?.type === 'video' && hasMediaLocator(sourceResult)
    ? sourceResult
    : undefined
  if (isVideoEdit && sourceVideo && inspectVideo) {
    try {
      sourceInspection = await inspectVideo(sourceVideo)
    } catch (error) {
      sourceInspectionError = error instanceof Error && error.message ? error.message : String(error)
    }
  } else if (isVideoEdit) {
    sourceInspectionError = sourceVideo
      ? '当前运行环境未提供本地视频探测器'
      : sourceResult?.type === 'video'
        ? '源视频没有可读取的素材地址'
        : '缺少可比较的源视频'
  }

  const metadata = inspection?.metadata
  const duration = metadata?.durationSeconds ?? 0
  const width = metadata?.width ?? 0
  const height = metadata?.height ?? 0
  const technicallyValid = metadata?.kind === 'video' && duration > 0.1 && width > 0 && height > 0
  const expectedRatio = expectedAspectRatio(plan.params.aspectRatio ?? plan.params.aspect_ratio)
  const actualRatio = width > 0 && height > 0 ? width / height : undefined
  const aspectError = expectedRatio && actualRatio
    ? Math.abs(actualRatio - expectedRatio) / expectedRatio
    : undefined
  const blackRatio = videoInspectionMetric(inspection, 'black-frames', 'blackRatio')
  const freezeRatio = videoInspectionMetric(inspection, 'frozen-video', 'freezeRatio')
  const sourceDuration = sourceInspection?.metadata?.durationSeconds ?? 0
  const sourceFreezeRatio = videoInspectionMetric(sourceInspection, 'frozen-video', 'freezeRatio')
  const durationRetentionRatio = sourceDuration > 0 && duration > 0 ? duration / sourceDuration : undefined
  const durationRelativeError = durationRetentionRatio === undefined
    ? undefined
    : Math.abs(durationRetentionRatio - 1)
  const freezeIncrease = sourceFreezeRatio === undefined || freezeRatio === undefined
    ? undefined
    : freezeRatio - sourceFreezeRatio

  const checks: GenerationQualityCheck[] = [
    result
      ? {
          id: 'video-output',
          label: '视频结果',
          status: 'pass',
          summary: '已保留可播放的视频结果',
        }
      : {
          id: 'video-output',
          label: '视频结果',
          status: 'fail',
          summary: item?.error || '没有可读取的视频结果',
          ...(item ? { itemIds: [item.id] } : {}),
        },
    inspection
      ? {
          id: 'video-technical',
          label: '媒体信息',
          status: technicallyValid ? 'pass' : 'fail',
          summary: technicallyValid
            ? `${width}x${height} · ${roundQualityMetric(duration, 2)} 秒${metadata?.fps ? ` · ${roundQualityMetric(metadata.fps, 2)} FPS` : ''}`
            : '视频无法解码、时长为零或尺寸无效',
          details: metadata?.videoCodec ? [`编码：${metadata.videoCodec}`] : undefined,
          metrics: {
            durationSeconds: roundQualityMetric(duration, 3),
            width,
            height,
            ...(metadata?.fps ? { fps: roundQualityMetric(metadata.fps, 3) } : {}),
          },
          ...(!technicallyValid && item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-technical',
          label: '媒体信息',
          status: 'unavailable',
          summary: '视频结果已保留，但本地媒体探测未完成',
          details: [inspectionError || '没有可用的视频探测结果'],
          ...(item ? { itemIds: [item.id] } : {}),
        },
    aspectError === undefined
      ? {
          id: 'video-aspect',
          label: '画幅',
          status: 'unavailable',
          summary: '缺少输出尺寸或目标画幅，无法核对比例',
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-aspect',
          label: '画幅',
          status: aspectError <= 0.03 ? 'pass' : aspectError <= 0.12 ? 'warning' : 'fail',
          summary: aspectError <= 0.03
            ? `输出画幅符合 ${String(plan.params.aspectRatio ?? plan.params.aspect_ratio)}`
            : `输出比例 ${roundQualityMetric(actualRatio!, 3)} 与目标 ${String(plan.params.aspectRatio ?? plan.params.aspect_ratio)} 不一致`,
          metrics: {
            actualAspectRatio: roundQualityMetric(actualRatio!, 4),
            expectedAspectRatio: roundQualityMetric(expectedRatio!, 4),
            relativeError: roundQualityMetric(aspectError, 4),
          },
          ...(aspectError > 0.03 && item ? { itemIds: [item.id] } : {}),
        },
    blackRatio === undefined
      ? {
          id: 'video-black-frames',
          label: '黑帧',
          status: 'unavailable',
          summary: '没有可用的黑帧检测数据',
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-black-frames',
          label: '黑帧',
          status: blackRatio > 0.6 ? 'fail' : blackRatio > 0.25 ? 'warning' : 'pass',
          summary: `黑帧占比 ${Math.round(blackRatio * 100)}%`,
          metrics: { blackRatio: roundQualityMetric(blackRatio, 4) },
          ...(blackRatio > 0.25 && item ? { itemIds: [item.id] } : {}),
        },
    freezeRatio === undefined
      ? {
          id: 'video-motion',
          label: '运动连续性',
          status: 'unavailable',
          summary: '没有可用的冻结画面检测数据',
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-motion',
          label: '运动连续性',
          status: freezeRatio > 0.9 ? 'fail' : freezeRatio > 0.65 ? 'warning' : 'pass',
          summary: freezeRatio > 0.9
            ? `约 ${Math.round(freezeRatio * 100)}% 画面冻结，视频可能没有有效运动`
            : `冻结占比 ${Math.round(freezeRatio * 100)}%`,
          metrics: { freezeRatio: roundQualityMetric(freezeRatio, 4) },
          ...(freezeRatio > 0.65 && item ? { itemIds: [item.id] } : {}),
        },
    ...(isVideoEdit
      ? [durationRelativeError === undefined
          ? {
              id: 'video-source-retention',
              label: '源视频时序保留',
              status: 'unavailable' as const,
              summary: '没有完成源视频与结果视频的时序对照',
              details: [sourceInspectionError || inspectionError || '缺少可比较的时长数据'],
              ...(item ? { itemIds: [item.id] } : {}),
            }
          : {
              id: 'video-source-retention',
              label: '源视频时序保留',
              status: (
                durationRelativeError > 0.35 || (freezeIncrease !== undefined && freezeIncrease > 0.5)
                  ? 'fail'
                  : durationRelativeError > 0.15 || (freezeIncrease !== undefined && freezeIncrease > 0.25)
                    ? 'warning'
                    : 'pass'
              ) as GenerationQualityStatus,
              summary: durationRelativeError <= 0.15
                ? '结果时长与源视频接近'
                : `结果仅保留源视频约 ${Math.round(durationRetentionRatio! * 100)}% 的时长`,
              details: freezeIncrease !== undefined
                ? [`冻结占比较源视频变化 ${Math.round(freezeIncrease * 100)} 个百分点`]
                : undefined,
              metrics: {
                sourceDurationSeconds: roundQualityMetric(sourceDuration, 3),
                outputDurationSeconds: roundQualityMetric(duration, 3),
                durationRetentionRatio: roundQualityMetric(durationRetentionRatio!, 4),
                ...(sourceFreezeRatio !== undefined
                  ? { sourceFreezeRatio: roundQualityMetric(sourceFreezeRatio, 4) }
                  : {}),
                ...(freezeRatio !== undefined
                  ? { outputFreezeRatio: roundQualityMetric(freezeRatio, 4) }
                  : {}),
              },
              ...(durationRelativeError > 0.15 && item ? { itemIds: [item.id] } : {}),
            }]
      : []),
    {
      id: 'video-reference-adherence',
      label: '风格与效果符合度',
      status: 'unavailable',
      summary: '本地技术检查不能证明视觉风格或时序效果符合参考',
      details: ['需要人工预览或视觉模型评审。'],
      ...(item ? { itemIds: [item.id] } : {}),
    },
  ]
  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'video',
    evaluator: 'video-local-v1',
    status: qualityStatusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: {
      inspected: Boolean(inspection),
      ...(inspection ? {
        durationSeconds: roundQualityMetric(duration, 3),
        width,
        height,
        ...(actualRatio ? { aspectRatio: roundQualityMetric(actualRatio, 4) } : {}),
        ...(blackRatio !== undefined ? { blackRatio: roundQualityMetric(blackRatio, 4) } : {}),
        ...(freezeRatio !== undefined ? { freezeRatio: roundQualityMetric(freezeRatio, 4) } : {}),
      } : {}),
    },
  }
  return { ...collection, quality }
}
