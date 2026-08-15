/**
 * 「按镜头拆」面板：检测 → 预览 → 勾选 → 才落画布。
 *
 * 为什么不一键往画布糊 N 个节点：阈值是玄学，不同片子差很多；不给看就落，用户得挨个删。
 * 灵敏度滑杆**瞬时响应**——主进程一次低阈值检测已经把全集连同 scene_score 一起给了，
 * 滑杆只在前端过滤（见 shotCutSelection.ts）。
 *
 * ⚠️ 配色一律 `--nomi-*`：本面板 Portal 到画布视口，`--workbench-*` 只在 `.workbench-shell` 作用域内有定义，
 * 够不到就会**静默退回继承色**（上一轮走查读到 rgb(201,201,201) 才发现，单测全绿）。
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { extractShotCutsToNodes } from './extractShotCutsToNodes'
import {
  SHOT_SENSITIVITY_DEFAULT,
  SHOT_SENSITIVITY_MAX,
  SHOT_SENSITIVITY_MIN,
  SHOT_SENSITIVITY_STEP,
  filterShotCuts,
  formatShotTimestamp,
  shotSheetRows,
  shotSheetTileStyle,
  type ShotCut,
} from './shotCutSelection'

type DetectState =
  | { phase: 'detecting' }
  | { phase: 'failed'; message: string }
  | {
      phase: 'ready'
      cuts: ShotCut[]
      sheetUrl: string | null
      sheetColumns: number
      truncated: boolean
    }

type Props = { node: GenerationCanvasNode; onClose: () => void }

export default function NodeShotCutPanel({ node, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = React.useState<DetectState>({ phase: 'detecting' })
  const [threshold, setThreshold] = React.useState(SHOT_SENSITIVITY_DEFAULT)
  const [excluded, setExcluded] = React.useState<ReadonlySet<number>>(() => new Set())
  const [committing, setCommitting] = React.useState<{ done: number; total: number } | null>(null)

  const videoUrl = node.result?.url
  React.useEffect(() => {
    let alive = true
    const detect = getDesktopBridge()?.video?.detectShotCuts
    const projectId = getActiveWorkbenchProjectId()
    if (!detect || !projectId || !videoUrl) {
      setState({ phase: 'failed', message: t('generationCommon.node.shotCuts.desktopOnly') })
      return () => { alive = false }
    }
    detect({ videoUrl, projectId })
      .then((result) => {
        if (!alive) return
        setState({
          phase: 'ready',
          cuts: result.cuts ?? [],
          sheetUrl: result.sheetUrl ?? null,
          sheetColumns: result.sheetColumns || 8,
          truncated: Boolean(result.truncated),
        })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [t, videoUrl])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const allCuts = React.useMemo(() => (state.phase === 'ready' ? state.cuts : []), [state])
  const visible = React.useMemo(() => filterShotCuts(allCuts, threshold), [allCuts, threshold])
  const selected = React.useMemo(() => visible.filter((cut) => !excluded.has(cut.index)), [visible, excluded])
  const rows = state.phase === 'ready' ? shotSheetRows(allCuts.length, state.sheetColumns) : 1

  const toggle = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const commit = async () => {
    if (!selected.length || committing) return
    setCommitting({ done: 0, total: selected.length })
    await extractShotCutsToNodes({
      node,
      seconds: selected.map((cut) => cut.seconds),
      onProgress: (progress) => setCommitting(progress),
    })
    setCommitting(null)
    onClose()
  }

  const canvasViewport =
    typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.workbench-generation__canvas')
  if (!canvasViewport) return <></>

  return createPortal(
    <div
      className="absolute inset-0 z-[9999] flex h-full w-full items-center justify-center overflow-hidden p-6 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t('generationCommon.node.shotCuts.title')}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget && !committing) onClose()
      }}
    >
      <div
        className={cn(
          'flex max-h-full w-[min(760px,100%)] flex-col gap-3 rounded-nomi border border-nomi-line',
          'bg-nomi-paper p-4 shadow-nomi-lg',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-body font-medium text-nomi-ink">{t('generationCommon.node.shotCuts.title')}</div>
            <div className="mt-0.5 text-body-sm text-nomi-ink-60">
              {state.phase === 'detecting'
                ? t('generationCommon.node.shotCuts.detecting')
                : state.phase === 'failed'
                  ? t('generationCommon.node.shotCuts.failed')
                  : t('generationCommon.node.shotCuts.found', { count: visible.length })}
            </div>
          </div>
          <button
            type="button"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 cursor-pointer',
              'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            aria-label={t('generationCommon.node.shotCuts.close')}
            onClick={onClose}
          >
            <IconX size={16} stroke={1.8} />
          </button>
        </div>

        {state.phase === 'failed' ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">{state.message}</div>
        ) : null}

        {state.phase === 'ready' && allCuts.length === 0 ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            {t('generationCommon.node.shotCuts.noCuts')}
          </div>
        ) : null}

        {state.phase === 'ready' && state.truncated ? (
          <div className="flex items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            <IconAlertTriangle size={15} stroke={1.8} aria-hidden />
            {t('generationCommon.node.shotCuts.truncated', { count: allCuts.length })}
          </div>
        ) : null}

        {state.phase === 'ready' && allCuts.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <label htmlFor="shot-cut-sensitivity" className="shrink-0 text-body-sm text-nomi-ink-60">
                {t('generationCommon.node.shotCuts.sensitivity')}
              </label>
              <input
                id="shot-cut-sensitivity"
                type="range"
                className="flex-1 accent-nomi-accent"
                min={SHOT_SENSITIVITY_MIN}
                max={SHOT_SENSITIVITY_MAX}
                step={SHOT_SENSITIVITY_STEP}
                value={threshold}
                disabled={Boolean(committing)}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <span className="w-[112px] shrink-0 text-right text-body-sm text-nomi-ink-60">
                {threshold <= 0.2
                  ? t('generationCommon.node.shotCuts.hintMany')
                  : threshold >= 0.5
                    ? t('generationCommon.node.shotCuts.hintFew')
                    : t('generationCommon.node.shotCuts.hintJust')}
              </span>
            </div>

            <div
              className="grid min-h-0 flex-1 gap-2 overflow-y-auto"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))' }}
            >
              {visible.map((cut) => {
                const isOn = !excluded.has(cut.index)
                const tile = shotSheetTileStyle(cut.index, state.sheetColumns, rows)
                return (
                  <button
                    key={cut.index}
                    type="button"
                    data-shot-cut={cut.index}
                    data-selected={isOn ? 'true' : 'false'}
                    className={cn(
                      'overflow-hidden rounded-nomi-sm border p-0 text-left cursor-pointer',
                      'transition-colors duration-[var(--nomi-transition-fast)]',
                      isOn ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line bg-nomi-paper opacity-60',
                    )}
                    aria-pressed={isOn}
                    disabled={Boolean(committing)}
                    onClick={() => toggle(cut.index)}
                  >
                    <span
                      className="block h-[64px] w-full bg-nomi-ink-05 bg-no-repeat"
                      style={
                        state.sheetUrl
                          ? { backgroundImage: `url("${state.sheetUrl}")`, ...tile }
                          : undefined
                      }
                      aria-hidden
                    />
                    <span className="flex items-center justify-between gap-1 px-2 py-1 text-micro text-nomi-ink-60">
                      <span>{formatShotTimestamp(cut.seconds)}</span>
                      <span>{isOn ? '✓' : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-nomi-line-soft pt-3">
          <button
            type="button"
            className={cn(
              'h-8 rounded-nomi-sm border-0 bg-transparent px-2 text-body-sm cursor-pointer',
              'text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40',
            )}
            disabled={state.phase !== 'ready' || !visible.length || Boolean(committing)}
            onClick={() => setExcluded(selected.length === visible.length ? new Set(visible.map((c) => c.index)) : new Set())}
          >
            {selected.length === visible.length && visible.length > 0
              ? t('generationCommon.node.shotCuts.selectNone')
              : t('generationCommon.node.shotCuts.selectAll')}
          </button>
          <div className="flex items-center gap-2">
            {committing ? (
              <span className="text-body-sm text-nomi-ink-60">
                {t('generationCommon.node.shotCuts.committing', { done: committing.done, total: committing.total })}
              </span>
            ) : null}
            <button
              type="button"
              data-shot-cut-commit="true"
              className={cn(
                'inline-flex h-9 items-center rounded-full border-0 px-4 cursor-pointer',
                'bg-nomi-ink text-body font-medium text-nomi-paper hover:bg-nomi-accent',
                'transition-colors duration-[var(--nomi-transition-fast)] disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              disabled={!selected.length || Boolean(committing)}
              onClick={() => { void commit() }}
            >
              {t('generationCommon.node.shotCuts.commit', { count: selected.length })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    canvasViewport,
  )
}
