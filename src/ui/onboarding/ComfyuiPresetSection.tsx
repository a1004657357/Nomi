/**
 * ComfyUI 预置模板区（S5 · 2026-08-01 拍板「做，带缺件闸」，样张已过）。
 * 形状：模板行（名字 + 就绪/缺件 chip）→ 展开逐文件清单（状态 ✓/缺 · 目录 · 复制名 · 官方下载链）→
 * 「一键启用」只在全部就绪时可点（缺件闸：预置绝不开箱即炸）；「重新检测」装完即放行。
 * 检测复用 Tier-1 的 reconcileComfyWorkflow（/object_info 对账）；启用复用 importComfyWorkflow 整条导入链（P1）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie, IconCheck, IconX, IconCopy, IconExternalLink, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'

type Preset = {
  key: string; labelZh: string; descZh: string; workflowText: string; binding: unknown
  models: Array<{ file: string; dir: string; url: string }>
}
type Reconcile = {
  serverReachable: boolean
  unknownNodeTypes: string[]
  missingEnumValues: Array<{ value: string }>
}

type ComfyuiPresetSectionProps = {
  /** 已有模型标签集合（判「已启用」防重复导入）。 */
  modelLabels: string[]
  onImported: () => void
}

export function ComfyuiPresetSection({ modelLabels, onImported }: ComfyuiPresetSectionProps): JSX.Element | null {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const presets = React.useMemo<Preset[]>(() => {
    try { return (catalog?.listComfyuiPresets?.() as Preset[]) ?? [] } catch { return [] }
  }, [catalog])
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const [reconcileByKey, setReconcileByKey] = React.useState<Record<string, Reconcile | 'checking' | null>>({})
  const [busy, setBusy] = React.useState(false)

  const check = React.useCallback((preset: Preset) => {
    const call = catalog?.reconcileComfyWorkflow
    if (!call) return
    setReconcileByKey((m) => ({ ...m, [preset.key]: 'checking' }))
    void call(preset.workflowText)
      .then((r) => setReconcileByKey((m) => ({ ...m, [preset.key]: r && r.ok ? (r as Reconcile) : null })))
      .catch(() => setReconcileByKey((m) => ({ ...m, [preset.key]: null })))
  }, [catalog])

  if (!catalog || presets.length === 0) return null

  const enable = (preset: Preset) => {
    if (!catalog.importComfyWorkflow) return
    setBusy(true)
    try {
      const r = catalog.importComfyWorkflow({ text: preset.workflowText, binding: preset.binding, labelZh: preset.labelZh })
      if (!r.ok) { toast(r.error, 'error'); return }
      toast(t('onboardingProviders.comfyPreset.enabled', { name: preset.labelZh }), 'success')
      onImported()
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-micro text-nomi-ink-30">{t('onboardingProviders.comfyPreset.sectionTitle')}</div>
      {presets.map((preset) => {
        const alreadyEnabled = modelLabels.includes(preset.labelZh)
        const open = openKey === preset.key
        const rec = reconcileByKey[preset.key]
        const checking = rec === 'checking'
        const result = rec && rec !== 'checking' ? rec : null
        const missing = new Set((result?.missingEnumValues ?? []).map((m) => m.value))
        const missingCount = preset.models.filter((m) => missing.has(m.file)).length
        const ready = Boolean(result && result.serverReachable && result.unknownNodeTypes.length === 0 && missingCount === 0)
        return (
          <div key={preset.key} className="rounded-nomi-sm border border-nomi-line bg-nomi-paper">
            <button
              type="button"
              onClick={() => {
                const next = open ? null : preset.key
                setOpenKey(next)
                if (next && !reconcileByKey[preset.key]) check(preset)
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
              aria-expanded={open}
            >
              <IconMovie size={16} className="text-nomi-ink-60 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-body-sm text-nomi-ink truncate">{preset.labelZh}</span>
                <span className="block text-micro text-nomi-ink-30 truncate">{preset.descZh}</span>
              </span>
              {alreadyEnabled ? (
                <span className="text-micro text-workbench-success bg-[var(--workbench-success-soft)] px-2 py-0.5 rounded-full shrink-0">{t('onboardingProviders.comfyPreset.chipEnabled')}</span>
              ) : result ? (
                ready ? (
                  <span className="text-micro text-workbench-success bg-[var(--workbench-success-soft)] px-2 py-0.5 rounded-full shrink-0">{t('onboardingProviders.comfyPreset.chipReady')}</span>
                ) : (
                  <span className="text-micro text-workbench-danger bg-[var(--workbench-danger-soft)] px-2 py-0.5 rounded-full shrink-0">
                    {result.serverReachable
                      ? t('onboardingProviders.comfyPreset.chipMissing', { count: missingCount + result.unknownNodeTypes.length })
                      : t('onboardingProviders.comfyPreset.chipOffline')}
                  </span>
                )
              ) : (
                <span className="text-micro text-nomi-ink-30 shrink-0">{checking ? t('onboardingProviders.comfyPreset.chipChecking') : t('onboardingProviders.comfyPreset.chipTap')}</span>
              )}
            </button>
            {open ? (
              <div className="border-t border-nomi-line px-3 py-2.5 flex flex-col gap-2">
                {result && !result.serverReachable ? (
                  <div className="text-caption text-nomi-ink-40">{t('onboardingProviders.comfyPreset.offlineNote')}</div>
                ) : null}
                {result && result.unknownNodeTypes.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
                    <IconAlertTriangle size={14} className="shrink-0 mt-0.5 text-workbench-danger" />
                    <span className="text-caption text-nomi-ink leading-relaxed">{t('onboardingProviders.comfyPreset.missingNodes', { list: result.unknownNodeTypes.join(' · ') })}</span>
                  </div>
                ) : null}
                {preset.models.map((m) => {
                  const isMissing = result && result.serverReachable ? missing.has(m.file) : null
                  return (
                    <div key={m.file} className="flex items-center gap-2 text-caption min-w-0">
                      {isMissing === null ? (
                        <span className="size-3.5 shrink-0 rounded-full bg-nomi-ink-10" aria-hidden="true" />
                      ) : isMissing ? (
                        <IconX size={14} className="text-workbench-danger shrink-0" aria-label={t('onboardingProviders.comfyPreset.fileMissing')} />
                      ) : (
                        <IconCheck size={14} className="text-workbench-success shrink-0" aria-label={t('onboardingProviders.comfyPreset.fileReady')} />
                      )}
                      <code className="flex-1 min-w-0 truncate font-mono text-nomi-ink" title={m.file}>{m.file}</code>
                      <span className="text-nomi-ink-30 shrink-0">{t('onboardingProviders.comfyPreset.dirLabel', { dir: m.dir })}</span>
                      <button
                        type="button"
                        aria-label={t('onboardingProviders.comfyPreset.copyName', { name: m.file })}
                        title={t('onboardingProviders.comfyPreset.copyNameShort')}
                        onClick={() => { void navigator.clipboard.writeText(m.file); toast(t('onboardingProviders.comfyPreset.copied'), 'success') }}
                        className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-05 hover:text-nomi-ink-60"
                      >
                        <IconCopy size={13} stroke={1.7} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('onboardingProviders.comfyPreset.downloadAria', { name: m.file })}
                        title={t('onboardingProviders.comfyPreset.downloadTitle')}
                        onClick={() => window.open(m.url, '_blank', 'noopener')}
                        className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-05 hover:text-nomi-accent"
                      >
                        <IconExternalLink size={13} stroke={1.7} />
                      </button>
                    </div>
                  )
                })}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={!ready || busy || alreadyEnabled}
                    onClick={() => enable(preset)}
                    className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-caption font-medium',
                      'hover:bg-nomi-accent disabled:opacity-45')}
                  >
                    {alreadyEnabled ? t('onboardingProviders.comfyPreset.enabledButton') : t('onboardingProviders.comfyPreset.enableButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => check(preset)}
                    disabled={checking}
                    className="inline-flex items-center gap-1 h-8 px-2.5 text-caption text-nomi-ink-60 rounded-nomi-sm border border-nomi-line hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50"
                  >
                    <IconRefresh size={13} stroke={1.7} className={checking ? 'animate-spin' : undefined} />{t('onboardingProviders.comfyPreset.recheck')}
                  </button>
                  <span className="text-micro text-nomi-ink-30">{t('onboardingProviders.comfyPreset.gateNote')}</span>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
