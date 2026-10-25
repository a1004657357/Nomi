import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { IconEye, IconRefresh } from '@tabler/icons-react'
import { MODEL_REFRESH_EVENT } from '../../../config/modelCatalogCache'
import { cn } from '../../../utils/cn'
import { showInfoToast } from '../../../utils/showInfoToast'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { readWindowUrlParam } from '../../windowUrlParam'
import type { GenerationResultCollection } from '../model/generationCanvasTypes'
import {
  reviewMoodCollectionWithVisionModel,
  validateMoodVisionReviewAssets,
} from '../quality/moodExpressionVisionReviewService'
import {
  listVisionReviewModelOptions,
  type VisionReviewModelOption,
} from '../quality/visionReviewModels'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export function MoodVisionReviewControl({
  nodeId,
  collection,
}: {
  nodeId: string
  collection: GenerationResultCollection
}): JSX.Element {
  useTranslation()
  const addNodeResultCollection = useGenerationCanvasStore((state) => state.addNodeResultCollection)
  const [models, setModels] = React.useState<VisionReviewModelOption[]>([])
  const [selectedId, setSelectedId] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const loadModels = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await listVisionReviewModelOptions()
      setModels(next)
      setSelectedId((current) => (
        next.some((model) => model.id === current) ? current : (next[0]?.id ?? '')
      ))
      setError('')
    } catch (loadError) {
      setModels([])
      setSelectedId('')
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadModels()
    window.addEventListener(MODEL_REFRESH_EVENT, loadModels)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, loadModels)
  }, [loadModels])

  const runReview = React.useCallback(async () => {
    const model = models.find((candidate) => candidate.id === selectedId)
    if (!model || busy) return
    let assets: ReturnType<typeof validateMoodVisionReviewAssets>
    try {
      assets = validateMoodVisionReviewAssets(collection)
    } catch (assetError) {
      setError(assetError instanceof Error ? assetError.message : String(assetError))
      return
    }
    const confirmed = await useSpendConfirmStore.getState().requestConfirm({
      title: i18n.t("canvasComponents.reviewEmotionalPerformancesWithAVisionModel"),
      message: i18n.t("canvasComponents.send1SourceImageAndEmotionResultsToInOne", { v0: assets.outputCount, v1: model.label }),
      confirmLabel: i18n.t("canvasComponents.startReview"),
      details: [
        { label: i18n.t("canvasComponents.model"), value: model.label },
        { label: i18n.t("canvasComponents.calls"), value: i18n.t("canvasComponents.text1BatchVisualReview") },
        { label: i18n.t("canvasComponents.image"), value: i18n.t("canvasComponents.localImages", { v0: assets.attachmentCount }) },
      ],
    })
    if (!confirmed) return

    setBusy(true)
    setError('')
    try {
      const reviewed = await reviewMoodCollectionWithVisionModel({
        collection,
        model,
        projectId: readWindowUrlParam('projectId') || undefined,
      })
      addNodeResultCollection(nodeId, reviewed)
      await persistActiveWorkbenchProjectNow()
      showInfoToast(i18n.t("canvasComponents.emotionalPerformanceReviewSavedToTheQualityReport"))
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError))
    } finally {
      setBusy(false)
    }
  }, [addNodeResultCollection, busy, collection, models, nodeId, selectedId])

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-micro text-nomi-ink-60">
        <IconRefresh size={12} stroke={1.8} className="animate-spin" aria-hidden />
        {i18n.t("canvasComponents.loadingVisionModels")}</div>
    )
  }

  if (!models.length) {
    return (
      <div className="space-y-1.5">
        <p className="text-micro leading-[1.4] text-nomi-ink-60">{i18n.t("canvasComponents.noConnectedTextModelDeclaresSupportForImageInput")}</p>
        <button
          type="button"
          className="text-micro font-medium text-nomi-accent hover:underline"
          onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
        >{i18n.t("canvasComponents.connectModels51")}</button>
        {error ? <p className="text-micro leading-[1.4] text-workbench-danger">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="block text-micro font-semibold text-nomi-ink-80" htmlFor={`mood-review-model-${nodeId}`}>{i18n.t("canvasComponents.expressionSemanticReview")}</label>
      <select
        id={`mood-review-model-${nodeId}`}
        aria-label={i18n.t("canvasComponents.emotionReviewModel")}
        value={selectedId}
        disabled={busy}
        onChange={(event) => setSelectedId(event.currentTarget.value)}
        className={cn(
          'h-8 w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink',
          'outline-none focus:border-nomi-accent disabled:opacity-50',
        )}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !selectedId}
        onClick={() => { void runReview() }}
        className={cn(
          'flex h-8 w-full items-center justify-center gap-1.5 rounded-nomi-sm border-0',
          'bg-nomi-ink text-micro font-medium text-nomi-paper hover:bg-nomi-accent disabled:opacity-50',
        )}
      >
        {busy
          ? <IconRefresh size={13} stroke={1.8} className="animate-spin" aria-hidden />
          : <IconEye size={13} stroke={1.8} aria-hidden />}
        {busy ? i18n.t("canvasComponents.reviewing") : i18n.t("canvasComponents.visionModelReview")}
      </button>
      {error ? <p className="text-micro leading-[1.4] text-workbench-danger">{error}</p> : null}
    </div>
  )
}
