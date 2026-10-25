import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { IconEye } from '@tabler/icons-react'
import { NomiSelect } from '../../../design'
import {
  listVisionReviewModelOptions,
  type VisionReviewModelOption,
} from '../quality/visionReviewModels'

export type CapabilityVisionReviewSelection = {
  enabled: boolean
  model?: VisionReviewModelOption
}

export function CapabilityAutoVisionReviewControl({
  onChange,
}: {
  onChange: (selection: CapabilityVisionReviewSelection) => void
}): JSX.Element {
  useTranslation()
  const [models, setModels] = React.useState<VisionReviewModelOption[]>([])
  const [modelId, setModelId] = React.useState('')
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const loadModels = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await listVisionReviewModelOptions()
      setModels(next)
      setModelId((current) => (
        next.some((model) => model.id === current) ? current : (next[0]?.id ?? '')
      ))
      setEnabled((current) => current && next.length > 0)
      setError('')
    } catch (loadError) {
      setModels([])
      setModelId('')
      setEnabled(false)
      setError(loadError instanceof Error ? loadError.message : i18n.t("canvasComponents.failedToLoadTheVisionModelCatalog"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadModels()
    window.addEventListener('nomi-model-catalog-changed', loadModels)
    return () => window.removeEventListener('nomi-model-catalog-changed', loadModels)
  }, [loadModels])

  const selectedModel = models.find((model) => model.id === modelId)
  React.useEffect(() => {
    onChange({
      enabled: enabled && Boolean(selectedModel),
      ...(enabled && selectedModel ? { model: selectedModel } : {}),
    })
  }, [enabled, onChange, selectedModel])

  return (
    <div className="border-b border-nomi-line px-4 py-4">
      <label className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 text-body-sm font-medium text-nomi-ink">
        <span className="inline-flex min-w-0 max-w-full items-center gap-2 [overflow-wrap:anywhere]">
          <IconEye size={16} stroke={1.7} className="shrink-0" aria-hidden />
          {i18n.t("canvasComponents.automaticVisualReviewAfterGeneration")}</span>
        <input
          aria-label={i18n.t("canvasComponents.automaticVisualReviewAfterGeneration")}
          type="checkbox"
          className="size-4 shrink-0 accent-[var(--nomi-accent)]"
          checked={enabled}
          disabled={loading || models.length === 0}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>
      {enabled && selectedModel ? (
        <div className="mt-3">
          <NomiSelect
            ariaLabel={i18n.t("canvasComponents.visualReviewModel")}
            value={modelId}
            options={models.map((model) => ({ value: model.id, label: model.label }))}
            onChange={setModelId}
          />
          <p className="mt-2 text-micro text-nomi-ink-60">{i18n.t("canvasComponents.addsOneMultiImageRequestForTheBatchAFailed")}</p>
        </div>
      ) : loading ? (
        <p className="mt-2 text-micro text-nomi-ink-60">{i18n.t("canvasComponents.loadingVisionModels")}</p>
      ) : models.length === 0 ? (
        <button
          type="button"
          className="mt-2 text-micro font-medium text-nomi-accent hover:underline"
          onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
        >{i18n.t("canvasComponents.connectATextModelThatSupportsImageInput")}</button>
      ) : null}
      {error ? <p className="mt-2 text-micro text-workbench-danger">{error}</p> : null}
    </div>
  )
}
