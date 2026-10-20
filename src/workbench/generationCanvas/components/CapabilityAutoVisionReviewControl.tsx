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
      setError(loadError instanceof Error ? loadError.message : '视觉模型目录加载失败')
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
      <label className="flex items-center justify-between gap-3 text-body-sm font-medium text-nomi-ink">
        <span className="inline-flex items-center gap-2">
          <IconEye size={16} stroke={1.7} aria-hidden />
          生成后自动视觉复核
        </span>
        <input
          aria-label="生成后自动视觉复核"
          type="checkbox"
          className="size-4 accent-[var(--nomi-accent)]"
          checked={enabled}
          disabled={loading || models.length === 0}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>
      {enabled && selectedModel ? (
        <div className="mt-3">
          <NomiSelect
            ariaLabel="视觉复核模型"
            value={modelId}
            options={models.map((model) => ({ value: model.id, label: model.label }))}
            onChange={setModelId}
          />
          <p className="mt-2 text-micro text-nomi-ink-50">整批增加 1 次多图请求，复核失败不会重新生成。</p>
        </div>
      ) : loading ? (
        <p className="mt-2 text-micro text-nomi-ink-50">正在读取视觉模型</p>
      ) : models.length === 0 ? (
        <button
          type="button"
          className="mt-2 text-micro font-medium text-nomi-accent hover:underline"
          onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
        >
          连接支持图片输入的文本模型
        </button>
      ) : null}
      {error ? <p className="mt-2 text-micro text-workbench-danger">{error}</p> : null}
    </div>
  )
}
