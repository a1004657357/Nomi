import { useTranslation } from 'react-i18next'
import { translateCanvasComponentText } from '../../../i18n/CanvasComponentText'
import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { IconAlertCircle, IconCheck, IconRefresh, IconStack2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { buildVideoPlaybackUrl } from '../../../media/videoPlaybackUrl'
import { DesignModal } from '../../../design'
import type {
  GenerationCanvasNode,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { StoryboardMediaLightbox } from './render/StoryboardMediaLightbox'
import {
  CapabilityQualityReportPopover,
  CapabilityQualityStatusIcon,
} from './CapabilityQualityReportPopover'
import { qualityLabel, qualityStatusForItem } from './capabilityQualityPresentation'
import {
  latestMultiResultCollection,
  patchForCollectionCandidateSelection,
  patchForCollectionResultSelection,
} from './capabilityResultCollectionModel'
import { PortraitComparisonControl } from './PortraitComparisonDialog'
import { MultiviewVisionReviewControl } from './MultiviewVisionReviewControl'
import { MoodVisionReviewControl } from './MoodVisionReviewControl'
import { CapabilityHumanReviewControl } from './CapabilityHumanReviewControl'
import { confirmAndRetryCapabilityRecipeNode } from '../runner/capabilityRecipeRetryAction'

function itemMedia(item: GenerationResultCollectionItem): { type: 'image' | 'video'; src: string } | undefined {
  const result = item.result
  if (!result?.url) return undefined
  if (result.type === 'image') return { type: 'image', src: result.url }
  if (result.type === 'video') return { type: 'video', src: buildVideoPlaybackUrl(result.url) }
  return undefined
}

export function CapabilityResultCollection({
  node,
  readOnly,
  mediaPreviewPriority,
}: {
  node: GenerationCanvasNode
  readOnly: boolean
  mediaPreviewPriority: boolean
}): JSX.Element | null {
  useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const collection = latestMultiResultCollection(node)
  const [lightboxItem, setLightboxItem] = React.useState<GenerationResultCollectionItem | null>(null)
  const [candidateItemId, setCandidateItemId] = React.useState<string | null>(null)
  const [retrying, setRetrying] = React.useState(false)
  if (!collection) return null

  const isMoodCollection = collection.recipeId === 'portrait.mood'
  const isMoodMatrix = isMoodCollection && collection.items.length === 25
  const columns = isMoodMatrix ? 5 : collection.items.length <= 4 ? 2 : 3
  const lightboxMedia = lightboxItem ? itemMedia(lightboxItem) : undefined
  const candidateItem = candidateItemId
    ? collection.items.find((item) => item.id === candidateItemId) ?? null
    : null
  const failedCount = collection.items.filter((item) => item.status === 'error').length

  return (
    <>
      <div
        className={cn('relative h-full w-full', isMoodCollection && 'flex min-h-0 flex-col')}
        data-mood-matrix={isMoodMatrix ? '5x5' : undefined}
      >
        {isMoodCollection ? (
          <div className="flex min-h-7 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-60 [overflow-wrap:anywhere]">
            <span>{i18n.t("canvasComponents.energy04")}</span>
            <span>{i18n.t("canvasComponents.affinity04")}</span>
          </div>
        ) : null}
        <div
          data-capability-result-collection={collection.id}
          data-collection-columns={columns}
          className={cn(
            'grid w-full gap-px bg-nomi-line p-px',
            isMoodCollection ? 'min-h-0 flex-1' : 'h-full',
          )}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          role="list"
          aria-label={i18n.t("canvasComponents.recipeResults", { v0: collection.items.length })}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {collection.items.map((item) => {
            const displayLabel = translateCanvasComponentText(translateCapabilityWorkflowText(item.label))
            const media = itemMedia(item)
            const isCurrent = Boolean(item.result?.id && item.result.id === node.result?.id)
            const isBusy = item.status === 'pending' || item.status === 'running'
            const candidates = item.candidates ?? []
            const selectedCandidateIndex = Math.max(
              0,
              candidates.findIndex((candidate) => candidate.id === (item.selectedResultId || item.result?.id)),
            )
            const qualityStatus = collection.quality
              ? qualityStatusForItem(item.id, collection.quality.checks)
              : undefined
            return (
              <div
                key={item.id}
                role="listitem"
                data-result-status={item.status}
                data-result-quality-status={qualityStatus}
                className={cn(
                  'group relative min-h-0 min-w-0 overflow-hidden border-0 bg-nomi-paper p-0 text-left',
                  isCurrent && 'z-[1] ring-2 ring-inset ring-nomi-accent',
                )}
              >
                <button
                  type="button"
                  aria-label={`${displayLabel}${isCurrent ? i18n.t("canvasComponents.currentPrimaryResult") : ''}`}
                  aria-pressed={isCurrent}
                  disabled={!media || isBusy}
                  className={cn(
                    'h-full w-full border-0 bg-transparent p-0 text-left',
                    'focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nomi-accent',
                    media && 'cursor-pointer hover:brightness-[0.98]',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (readOnly || !item.result) return
                    updateNode(node.id, patchForCollectionResultSelection(node, item.result))
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    if (media) setLightboxItem(item)
                  }}
                >
                  {media?.type === 'image' ? (
                    <img
                      src={media.src}
                      alt=""
                      draggable={false}
                      loading={mediaPreviewPriority ? 'eager' : 'lazy'}
                      className="h-full w-full select-none object-cover"
                    />
                  ) : media?.type === 'video' ? (
                    <video
                      src={media.src}
                      muted
                      playsInline
                      preload="metadata"
                      draggable={false}
                      className="h-full w-full select-none bg-black object-cover"
                    />
                  ) : (
                    <span className="flex h-full min-h-12 w-full items-center justify-center bg-nomi-ink-05 text-nomi-ink-40">
                      {item.status === 'error' ? (
                        <IconAlertCircle size={18} stroke={1.7} aria-hidden="true" />
                      ) : (
                        <IconRefresh size={18} stroke={1.7} className={isBusy ? 'animate-spin' : ''} aria-hidden="true" />
                      )}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex min-h-6 items-center gap-1 bg-black/58 px-1.5 py-1 text-micro font-medium text-white">
                    {isCurrent ? <IconCheck size={11} stroke={2.2} aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{displayLabel}</span>
                  </span>
                  {item.status === 'error' && item.error ? (
                    <span className="absolute inset-x-1 top-1 line-clamp-2 rounded-nomi-sm bg-workbench-danger-soft px-1.5 py-1 text-micro leading-tight text-workbench-danger">
                      {item.error}
                    </span>
                  ) : null}
                  {qualityStatus ? (
                    <span
                      className="absolute left-1 top-1 grid size-5 place-items-center rounded-nomi-sm border border-white/70 bg-nomi-paper shadow-nomi-md"
                      title={i18n.t("canvasComponents.qualityCheck", { v0: qualityLabel(qualityStatus) })}
                    >
                      <CapabilityQualityStatusIcon status={qualityStatus} size={13} />
                    </span>
                  ) : null}
                </button>
                {candidates.length > 1 ? (
                  <button
                    type="button"
                    data-provider-candidate-count={candidates.length}
                    aria-label={i18n.t("canvasComponents.selectCandidates", { v0: candidates.length })}
                    title={i18n.t("canvasComponents.selectCandidates", { v0: candidates.length })}
                    className={cn(
                      'absolute right-1 top-1 z-[4] flex h-6 items-center gap-1 rounded-nomi-sm px-1.5',
                      'border border-white/70 bg-nomi-paper text-micro font-semibold text-nomi-ink-80 shadow-nomi-md',
                      'hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setCandidateItemId(item.id)
                    }}
                  >
                    <IconStack2 size={13} stroke={1.9} aria-hidden="true" />
                    <span>{selectedCandidateIndex + 1}/{candidates.length}</span>
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
        {!readOnly && failedCount > 0 ? (
          <button
            type="button"
            data-capability-retry-failed="true"
            className={cn(
              'absolute right-10 top-1.5 z-[12] grid size-7 place-items-center rounded-nomi-sm',
              'border border-white/70 bg-nomi-paper text-nomi-ink-80 shadow-nomi-md',
              'hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
              'disabled:cursor-wait disabled:opacity-60',
            )}
            aria-label={i18n.t("canvasComponents.retryFailedResults", { v0: failedCount })}
            title={i18n.t("canvasComponents.retryFailedResults", { v0: failedCount })}
            disabled={retrying}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setRetrying(true)
              void confirmAndRetryCapabilityRecipeNode(node.id).finally(() => setRetrying(false))
            }}
          >
            <IconRefresh
              size={16}
              stroke={1.9}
              className={retrying ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {collection.quality ? (
          <CapabilityQualityReportPopover
            report={collection.quality}
            actions={!readOnly || collection.quality.humanReview ? (
              <div className="space-y-2.5">
                {!readOnly && ['grid9', 'multiview'].includes(collection.quality.kind) ? (
                  <MultiviewVisionReviewControl nodeId={node.id} collection={collection} />
                ) : null}
                {!readOnly && collection.quality.kind === 'mood' ? (
                  <MoodVisionReviewControl nodeId={node.id} collection={collection} />
                ) : null}
                <CapabilityHumanReviewControl node={node} collection={collection} readOnly={readOnly} />
              </div>
            ) : undefined}
          />
        ) : null}
        {collection.source ? (
          <PortraitComparisonControl
            collection={collection}
            currentResult={node.result}
            className={isMoodCollection ? 'top-8' : undefined}
          />
        ) : null}
      </div>
      <StoryboardMediaLightbox
        open={Boolean(lightboxItem && lightboxMedia)}
        type={lightboxMedia?.type ?? 'image'}
        src={lightboxMedia?.src ?? ''}
        label={lightboxItem?.label ?? i18n.t("canvasComponents.generatedResult")}
        onClose={() => setLightboxItem(null)}
      />
      {candidateItem ? (
        <DesignModal
          opened
          onClose={() => setCandidateItemId(null)}
          title={i18n.t("canvasComponents.selectCandidate", { v0: candidateItem.label })}
          centered
          size="lg"
        >
          <div
            className="grid grid-cols-2 gap-2"
            role="list"
            aria-label={i18n.t("canvasComponents.providerCandidates", { v0: candidateItem.candidates?.length ?? 0 })}
          >
            {(candidateItem.candidates ?? []).map((candidate, index) => {
              const selected = candidate.id === (candidateItem.selectedResultId || candidateItem.result?.id)
              const src = candidate.url || candidate.thumbnailUrl
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="listitem"
                  aria-pressed={selected}
                  className={cn(
                    'relative aspect-[4/5] min-w-0 overflow-hidden rounded-nomi-sm border bg-black p-0',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
                    selected ? 'border-nomi-accent ring-2 ring-nomi-accent' : 'border-nomi-line hover:border-nomi-ink-30',
                  )}
                  onClick={() => {
                    if (readOnly) return
                    const patch = patchForCollectionCandidateSelection(
                      node,
                      collection.id,
                      candidateItem.id,
                      candidate.id,
                    )
                    if (patch) updateNode(node.id, patch)
                  }}
                  onDoubleClick={() => {
                    setLightboxItem({ ...candidateItem, result: candidate })
                  }}
                >
                  {src ? (
                    <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />
                  ) : null}
                  <span className="absolute inset-x-0 bottom-0 flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 bg-black/60 px-2 text-xs text-white [overflow-wrap:anywhere]">
                    <span>{i18n.t("canvasComponents.candidate", { v0: index + 1 })}</span>
                    {selected ? <IconCheck size={14} stroke={2.2} className="shrink-0" aria-hidden="true" /> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </DesignModal>
      ) : null}
    </>
  )
}
