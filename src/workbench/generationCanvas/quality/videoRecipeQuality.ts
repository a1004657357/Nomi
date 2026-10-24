import i18n from '../../../i18n/index'
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
    inspectionError = i18n.t('capabilityWorkflow.noLocalVideoInspectorIsAvailableInThisEnvironment')
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
      ? i18n.t('capabilityWorkflow.noLocalVideoInspectorIsAvailableInThisEnvironment')
      : sourceResult?.type === 'video'
        ? i18n.t('capabilityWorkflow.theSourceVideoHasNoReadableAssetAddress')
        : i18n.t('capabilityWorkflow.noComparableSourceVideo')
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
          label: i18n.t('capabilityWorkflow.videoResult'),
          status: 'pass',
          summary: i18n.t('capabilityWorkflow.aPlayableVideoResultIsRetained'),
        }
      : {
          id: 'video-output',
          label: i18n.t('capabilityWorkflow.videoResult'),
          status: 'fail',
          summary: item?.error || i18n.t('capabilityWorkflow.noReadableVideoResult'),
          ...(item ? { itemIds: [item.id] } : {}),
        },
    inspection
      ? {
          id: 'video-technical',
          label: i18n.t('capabilityWorkflow.mediaInformation'),
          status: technicallyValid ? 'pass' : 'fail',
          summary: technicallyValid
            ? i18n.t('capabilityWorkflow.xSeconds', { v0: width, v1: height, v2: roundQualityMetric(duration, 2), v3: metadata?.fps ? ` · ${roundQualityMetric(metadata.fps, 2)} FPS` : '' })
            : i18n.t('capabilityWorkflow.theVideoCannotBeDecodedHasZeroDurationOr'),
          details: metadata?.videoCodec ? [i18n.t('capabilityWorkflow.codec', { v0: metadata.videoCodec })] : undefined,
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
          label: i18n.t('capabilityWorkflow.mediaInformation'),
          status: 'unavailable',
          summary: i18n.t('capabilityWorkflow.theVideoResultIsRetainedButLocalMediaInspection'),
          details: [inspectionError || i18n.t('capabilityWorkflow.noVideoInspectionResultIsAvailable')],
          ...(item ? { itemIds: [item.id] } : {}),
        },
    aspectError === undefined
      ? {
          id: 'video-aspect',
          label: i18n.t('capabilityWorkflow.aspectRatio'),
          status: 'unavailable',
          summary: i18n.t('capabilityWorkflow.outputDimensionsOrTargetAspectRatioAreMissingThe'),
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-aspect',
          label: i18n.t('capabilityWorkflow.aspectRatio'),
          status: aspectError <= 0.03 ? 'pass' : aspectError <= 0.12 ? 'warning' : 'fail',
          summary: aspectError <= 0.03
            ? i18n.t('capabilityWorkflow.theOutputAspectRatioMatches', { v0: String(plan.params.aspectRatio ?? plan.params.aspect_ratio) })
            : i18n.t('capabilityWorkflow.theOutputRatioDoesNotMatchTheTarget', { v0: roundQualityMetric(actualRatio!, 3), v1: String(plan.params.aspectRatio ?? plan.params.aspect_ratio) }),
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
          label: i18n.t('capabilityWorkflow.blackFrames'),
          status: 'unavailable',
          summary: i18n.t('capabilityWorkflow.noBlackFrameDetectionDataIsAvailable'),
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-black-frames',
          label: i18n.t('capabilityWorkflow.blackFrames'),
          status: blackRatio > 0.6 ? 'fail' : blackRatio > 0.25 ? 'warning' : 'pass',
          summary: i18n.t('capabilityWorkflow.blackFrameRatio', { v0: Math.round(blackRatio * 100) }),
          metrics: { blackRatio: roundQualityMetric(blackRatio, 4) },
          ...(blackRatio > 0.25 && item ? { itemIds: [item.id] } : {}),
        },
    freezeRatio === undefined
      ? {
          id: 'video-motion',
          label: i18n.t('capabilityWorkflow.motionContinuity'),
          status: 'unavailable',
          summary: i18n.t('capabilityWorkflow.noFrozenFrameDetectionDataIsAvailable'),
          ...(item ? { itemIds: [item.id] } : {}),
        }
      : {
          id: 'video-motion',
          label: i18n.t('capabilityWorkflow.motionContinuity'),
          status: freezeRatio > 0.9 ? 'fail' : freezeRatio > 0.65 ? 'warning' : 'pass',
          summary: freezeRatio > 0.9
            ? i18n.t('capabilityWorkflow.approximatelyOfFramesAreFrozenTheVideoMayHave', { v0: Math.round(freezeRatio * 100) })
            : i18n.t('capabilityWorkflow.frozenFrameRatio', { v0: Math.round(freezeRatio * 100) }),
          metrics: { freezeRatio: roundQualityMetric(freezeRatio, 4) },
          ...(freezeRatio > 0.65 && item ? { itemIds: [item.id] } : {}),
        },
    ...(isVideoEdit
      ? [durationRelativeError === undefined
          ? {
              id: 'video-source-retention',
              label: i18n.t('capabilityWorkflow.sourceVideoTimingRetention'),
              status: 'unavailable' as const,
              summary: i18n.t('capabilityWorkflow.sourceAndOutputVideoTimingHaveNotBeenCompared'),
              details: [sourceInspectionError || inspectionError || i18n.t('capabilityWorkflow.noComparableDurationData')],
              ...(item ? { itemIds: [item.id] } : {}),
            }
          : {
              id: 'video-source-retention',
              label: i18n.t('capabilityWorkflow.sourceVideoTimingRetention'),
              status: (
                durationRelativeError > 0.35 || (freezeIncrease !== undefined && freezeIncrease > 0.5)
                  ? 'fail'
                  : durationRelativeError > 0.15 || (freezeIncrease !== undefined && freezeIncrease > 0.25)
                    ? 'warning'
                    : 'pass'
              ) as GenerationQualityStatus,
              summary: durationRelativeError <= 0.15
                ? i18n.t('capabilityWorkflow.theResultDurationIsCloseToTheSourceVideo')
                : i18n.t('capabilityWorkflow.theResultRetainsApproximatelyOfTheSourceDuration', { v0: Math.round(durationRetentionRatio! * 100) }),
              details: freezeIncrease !== undefined
                ? [i18n.t('capabilityWorkflow.frozenFrameRatioChangedByPercentagePointsFromThe', { v0: Math.round(freezeIncrease * 100) })]
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
      label: i18n.t('capabilityWorkflow.styleAndEffectAdherence'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.localTechnicalChecksCannotProveThatVisualStyleOr'),
      details: [i18n.t('capabilityWorkflow.manualPreviewOrVisualModelReviewIsRequired')],
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
