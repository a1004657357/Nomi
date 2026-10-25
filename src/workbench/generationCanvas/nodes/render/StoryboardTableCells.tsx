import { useTranslation } from 'react-i18next'
import i18n from '../../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { cn } from '../../../../utils/cn'
import { generationResultUrl, type StoryboardScriptRow } from '../../../creation/storyboard/storyboardScriptViewModel'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { StoryboardImagePreview } from './StoryboardImagePreview'
import { StoryboardVideoPreview } from './StoryboardVideoPreview'
import type { ShotTextField } from './storyboardTableFieldConfig'

const FIELD_LABEL: Record<ShotTextField, string> = {
  get scene() { return i18n.t("canvasComponents.scene") },
  get shotSize() { return i18n.t("canvasComponents.shotSize") },
  get cameraAngle() { return i18n.t("canvasComponents.cameraAngle") },
  get cameraMove() { return i18n.t("canvasComponents.cameraMovement") },
  get characters() { return i18n.t("canvasComponents.characters") },
  get performance() { return i18n.t("canvasComponents.performance") },
  get dialogue() { return i18n.t("canvasComponents.dialogue") },
  get props() { return i18n.t("canvasComponents.props") },
  get sound() { return i18n.t("canvasComponents.musicSoundEffects") },
  get notes() { return i18n.t("canvasComponents.notes") },
}

function BufferedTextarea({
  value,
  ariaLabel,
  onCommit,
  className,
  rows = 1,
}: {
  value: string
  ariaLabel: string
  onCommit: (value: string) => void
  className: string
  rows?: number
}): JSX.Element {
  const [draft, setDraft] = React.useState(value)
  const focused = React.useRef(false)
  React.useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <textarea
      aria-label={ariaLabel}
      value={draft}
      rows={rows}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      className={className}
    />
  )
}

export function TextCell({
  value,
  ariaLabel,
  onCommit,
}: {
  value: string
  ariaLabel: string
  onCommit: (value: string) => void
}): JSX.Element {
  return (
    <BufferedTextarea
      ariaLabel={ariaLabel}
      value={value}
      rows={4}
      onCommit={onCommit}
      className={cn(
        'block min-h-[96px] w-full resize-none rounded-nomi-sm border border-transparent bg-transparent px-2 py-1.5',
        'text-caption leading-[1.45] text-nomi-ink outline-none',
        'hover:border-nomi-line-soft hover:bg-nomi-paper focus:border-nomi-accent/60 focus:bg-nomi-paper',
      )}
    />
  )
}

export function BufferedDurationInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number
  ariaLabel: string
  onCommit: (value: string) => void
}): JSX.Element {
  const normalized = Number.isFinite(value) ? String(value) : '0'
  const [draft, setDraft] = React.useState(normalized)
  React.useEffect(() => setDraft(normalized), [normalized])
  return (
    <input
      aria-label={ariaLabel}
      type="number"
      min={0}
      step={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== normalized) onCommit(draft)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      className="h-8 w-full rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper px-2 text-small outline-none focus:border-nomi-accent/60"
    />
  )
}

export function GroupedFieldsCell({
  row,
  fields,
  onCommit,
}: {
  row: StoryboardScriptRow
  fields: ShotTextField[]
  onCommit: (field: ShotTextField, value: string) => void
}): JSX.Element {
  useTranslation()
  return (
    <div className="space-y-1.5 px-1.5 py-2">
      {fields.map((field) => (
        <label key={field} className="block">
          <span className="mb-0.5 block text-micro font-medium text-nomi-ink-40">{FIELD_LABEL[field]}</span>
          <BufferedTextarea
            ariaLabel={i18n.t("canvasComponents.shot497", { v0: row.shot.index, v1: FIELD_LABEL[field] })}
            value={String(row.shot[field] || '')}
            rows={1}
            onCommit={(value) => onCommit(field, value)}
            className={cn(
              'block min-h-8 w-full resize-none rounded-nomi-sm border border-transparent bg-transparent px-1.5 py-1',
              'text-caption leading-[1.35] text-nomi-ink outline-none',
              'hover:border-nomi-line-soft hover:bg-nomi-paper focus:border-nomi-accent/60 focus:bg-nomi-paper',
            )}
          />
        </label>
      ))}
    </div>
  )
}

function nodeStatusLabel(node: GenerationCanvasNode | null, emptyLabel: string): string {
  if (!node) return emptyLabel
  if (node.status === 'queued' || node.status === 'running') return i18n.t("canvasComponents.generating")
  if (node.status === 'error') return i18n.t("canvasComponents.failed")
  if (node.status === 'recoverable') return i18n.t("canvasComponents.awaitingRetrieval")
  if (node.status === 'success') return i18n.t("canvasComponents.generated")
  return i18n.t("canvasComponents.pendingGeneration")
}

export function StoryboardMediaPreview({
  node,
  type,
  emptyLabel,
  compact = false,
  visibilityRoot,
}: {
  node: GenerationCanvasNode | null
  type: 'image' | 'video'
  emptyLabel: string
  compact?: boolean
  visibilityRoot?: Element | null
}): JSX.Element {
  if (!node?.result) return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
  if (type === 'video') {
    const videoUrl = String(node.result.url || node.result.providerUrl || '').trim()
    const posterUrl = String(node.result.thumbnailUrl || '').trim()
    if (!videoUrl && posterUrl) {
      return (
        <StoryboardImagePreview
          node={node}
          imageUrl={posterUrl}
          thumbnailUrl={posterUrl}
          compact={compact}
          visibilityRoot={visibilityRoot}
          labelKind="视频封面"
        />
      )
    }
    if (!videoUrl) return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
    return (
      <StoryboardVideoPreview
        node={node}
        videoUrl={videoUrl}
        posterUrl={posterUrl}
        compact={compact}
        visibilityRoot={visibilityRoot}
      />
    )
  }
  const imageUrl = generationResultUrl(node.result)
  if (!imageUrl) return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
  const thumbnailUrl = String(node.result.thumbnailUrl || '').trim()
  return (
    <StoryboardImagePreview
      node={node}
      imageUrl={imageUrl}
      thumbnailUrl={thumbnailUrl || undefined}
      compact={compact}
      visibilityRoot={visibilityRoot}
    />
  )
}

export function CompactFieldsCell({ row, fields }: { row: StoryboardScriptRow; fields: ShotTextField[] }): JSX.Element {
  const values = fields.flatMap((field) => {
    const value = String(row.shot[field] || '').trim()
    return value ? [`${FIELD_LABEL[field]}：${value}`] : []
  })
  return (
    <div className="px-2 py-2 text-caption leading-[1.45] text-nomi-ink-60">
      <p className="line-clamp-3">{values.join(' · ') || '—'}</p>
    </div>
  )
}

export function CompactPromptCell({
  prompt,
  node,
  type,
  visibilityRoot,
}: {
  prompt: string
  node: GenerationCanvasNode | null
  type: 'image' | 'video'
  visibilityRoot: Element | null
}): JSX.Element {
  useTranslation()
  return (
    <div className="flex h-full items-center gap-2 px-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 text-caption leading-[1.45] text-nomi-ink-60">{prompt || '—'}</p>
      </div>
      <div className="flex h-[72px] w-[76px] shrink-0 items-center justify-center">
        <StoryboardMediaPreview
          node={node}
          type={type}
          emptyLabel={type === 'image' ? i18n.t("canvasComponents.imageNotGenerated") : i18n.t("canvasComponents.videoNotGenerated")}
          compact
          visibilityRoot={visibilityRoot}
        />
      </div>
    </div>
  )
}
