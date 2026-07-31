// 助手模型选择器：让用户指定创作/画布 agent 用哪个 text 模型（根治「盲选第一个=撞到不响应的就全卡」）。
// 写偏好到 localStorage（assistantModelPref），runWorkbenchAgent 自动带进 payload，两个面板都生效。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { listWorkbenchModelCatalogModels, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'
import {
  assistantModelOptionLabel,
  assistantModelOptionValue,
  resolveAssistantModelSelection,
} from './assistantModelOptions'
import { NomiSelect, NomiSkeleton } from '../../design'

// 与后端 chooseTextModel 一致的"像通用对话模型"判定：vision/preview 等不可靠发 tool_use 的降权，
// 选默认时排到最后。让默认就是一个具体的、能用的模型（而不是看不懂的「自动选模型」）。
const DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i
function pickDefaultModel(models: ModelCatalogModelDto[]): ModelCatalogModelDto | undefined {
  return [...models].sort(
    (a, b) =>
      (DEPRIORITIZE.test(`${a.modelKey} ${a.labelZh}`) ? 1 : 0) -
      (DEPRIORITIZE.test(`${b.modelKey} ${b.labelZh}`) ? 1 : 0),
  )[0]
}

export default function AssistantModelPicker({ className }: { className?: string } = {}): JSX.Element | null {
  const { t } = useTranslation()
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [selectedValue, setSelectedValue] = React.useState('')
  const modelsRef = React.useRef<ModelCatalogModelDto[]>([])

  React.useEffect(() => {
    let alive = true
    const refreshModels = () => {
      listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })
        .then((rows) => {
          if (!alive) return
          modelsRef.current = rows
          setModels(rows)
          setLoaded(true)
          // 无偏好时不再显示「自动选模型」：直接落一个具体默认模型（智能挑、能用），并显示其名。
          const pref = getAssistantModelPref()
          if (!pref?.modelKey && rows.length > 0) {
            const def = pickDefaultModel(rows)
            if (def) {
              setAssistantModelPref({ vendorKey: def.vendorKey, modelKey: def.modelKey })
              setSelectedValue(assistantModelOptionValue(def))
            }
          } else {
            setSelectedValue(resolveAssistantModelSelection(rows, pref))
          }
        })
        .catch(() => {
          if (alive) {
            modelsRef.current = []
            setModels([])
            setSelectedValue('')
            setLoaded(true)
          }
        })
    }
    refreshModels()
    const sync = () => setSelectedValue(resolveAssistantModelSelection(modelsRef.current, getAssistantModelPref()))
    const refreshCatalog = () => refreshModels()
    window.addEventListener('nomi:assistant-model-changed', sync)
    window.addEventListener('nomi-model-catalog-changed', refreshCatalog)
    return () => {
      alive = false
      window.removeEventListener('nomi:assistant-model-changed', sync)
      window.removeEventListener('nomi-model-catalog-changed', refreshCatalog)
    }
  }, [])

  // pending 规范 #3:加载中给占位骨架,不再凭空消失(return null 让选择器闪现)。
  if (!loaded) {
    return <NomiSkeleton className={`h-7 w-[120px] ${className ?? ''}`} />
  }
  // 加载完确实没有可选 text 模型 → 不渲染(无意义)。
  if (models.length === 0) return null

  const handleChange = (next: string) => {
    setSelectedValue(next)
    const picked = models.find((m) => assistantModelOptionValue(m) === next)
    if (picked) setAssistantModelPref({ vendorKey: picked.vendorKey, modelKey: picked.modelKey })
  }

  return (
    <NomiSelect
      ariaLabel={t('creationAi.assistantMessage.modelAria')}
      title={t('creationAi.assistantMessage.modelHint')}
      size="xs"
      className={className}
      triggerMaxWidth={160}
      value={selectedValue}
      options={models.map((m) => ({
        value: assistantModelOptionValue(m),
        label: assistantModelOptionLabel(m, models),
      }))}
      onChange={handleChange}
    />
  )
}
