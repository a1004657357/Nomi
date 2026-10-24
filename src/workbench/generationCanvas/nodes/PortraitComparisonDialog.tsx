import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import {
  IconArrowsDiff,
  IconRefresh,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'

function resultUrl(result: GenerationNodeResult | undefined): string {
  return result?.url || result?.thumbnailUrl || result?.providerUrl || ''
}

function sourceUrl(collection: GenerationResultCollection): string {
  return collection.source?.url
    || collection.source?.thumbnailUrl
    || collection.source?.providerUrl
    || ''
}

export function PortraitComparisonControl({
  collection,
  currentResult,
  className,
}: {
  collection: GenerationResultCollection
  currentResult?: GenerationNodeResult
  className?: string
}): JSX.Element | null {
  useTranslation()
  const [open, setOpen] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const source = sourceUrl(collection)
  const fallbackResult = collection.items.find((item) => item.status === 'success' && resultUrl(item.result))?.result
  const output = resultUrl(currentResult) ? currentResult : fallbackResult
  const outputUrl = resultUrl(output)
  const outputLabel = collection.items.find((item) => item.result?.id === output?.id)?.label || i18n.t("canvasComponents.currentResult")

  React.useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  if (!source || !outputUrl) return null

  const setBoundedZoom = (value: number) => setZoom(Math.max(0.5, Math.min(3, value)))
  const dialog = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[10020] flex h-[100dvh] w-screen flex-col bg-black/85 text-white"
          role="dialog"
          aria-modal="true"
          aria-label={i18n.t("canvasComponents.portraitSourceComparison")}
          data-portrait-comparison-dialog="true"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="flex min-h-14 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-white/15 px-4">
            <IconArrowsDiff size={19} stroke={1.7} className="shrink-0" aria-hidden />
            <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
              <div className="text-body-sm font-medium">{i18n.t("canvasComponents.sourceComparison")}</div>
              <div className="truncate text-caption text-white/60">{outputLabel}</div>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-white/10 text-white hover:bg-white/15"
                aria-label={i18n.t("canvasComponents.zoomOutComparison")}
                title={i18n.t("canvasComponents.zoomOut")}
                onClick={() => setBoundedZoom(zoom - 0.25)}
              >
                <IconZoomOut size={17} stroke={1.7} aria-hidden />
              </button>
              <input
                aria-label={i18n.t("canvasComponents.comparisonZoom")}
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={zoom}
                className="w-28 shrink-0 accent-white sm:w-40"
                onChange={(event) => setBoundedZoom(Number(event.target.value))}
              />
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-white/10 text-white hover:bg-white/15"
                aria-label={i18n.t("canvasComponents.zoomInComparison")}
                title={i18n.t("canvasComponents.zoomIn")}
                onClick={() => setBoundedZoom(zoom + 0.25)}
              >
                <IconZoomIn size={17} stroke={1.7} aria-hidden />
              </button>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-white/10 text-white hover:bg-white/15"
                aria-label={i18n.t("canvasComponents.resetComparisonZoom")}
                title={i18n.t("canvasComponents.resetZoom")}
                onClick={() => setZoom(1)}
              >
                <IconRefresh size={17} stroke={1.7} aria-hidden />
              </button>
              <span className="w-12 shrink-0 text-center text-caption tabular-nums text-white/70">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-white text-black hover:bg-white/90"
                aria-label={i18n.t("canvasComponents.closeSourceComparison")}
                title={i18n.t("canvasComponents.close")}
                onClick={() => setOpen(false)}
              >
                <IconX size={18} stroke={1.8} aria-hidden />
              </button>
            </div>
          </header>
          <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-px bg-white/15 md:grid-cols-2 md:grid-rows-1">
            {[
              { id: 'source', label: collection.source?.label || i18n.t("canvasComponents.originalPortrait"), url: source },
              { id: 'result', label: outputLabel, url: outputUrl },
            ].map((panel) => (
              <section key={panel.id} className="relative min-h-0 overflow-auto bg-black">
                <div className="sticky left-0 top-0 z-[1] inline-flex h-7 items-center bg-black/70 px-2 text-caption text-white/80">
                  {panel.label}
                </div>
                <div className="absolute inset-0 grid min-h-full min-w-full place-items-center overflow-hidden p-6">
                  <img
                    src={panel.url}
                    alt=""
                    draggable={false}
                    data-comparison-image={panel.id}
                    data-comparison-zoom={zoom}
                    className="h-full w-full select-none object-contain transition-transform duration-150"
                    style={{ transform: `scale(${zoom})` }}
                  />
                </div>
              </section>
            ))}
          </main>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        type="button"
        className={cn(
          'absolute right-10 top-1.5 z-[12] grid size-7 place-items-center rounded-nomi-sm',
          'border border-white/70 bg-nomi-paper text-nomi-ink-60 shadow-nomi-md',
          'hover:bg-nomi-ink-05 hover:text-nomi-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
          className,
        )}
        aria-label={i18n.t("canvasComponents.compareWithSource")}
        title={i18n.t("canvasComponents.compareWithSource")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setZoom(1)
          setOpen(true)
        }}
      >
        <IconArrowsDiff size={16} stroke={1.7} aria-hidden />
      </button>
      {dialog}
    </>
  )
}
