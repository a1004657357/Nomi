import type { JSX } from 'react'
import React from 'react'
import {
  IconCheck,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type {
  GenerationCanvasNode,
  GenerationQualityHumanReview,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { patchForQualityHumanReview } from './capabilityResultCollectionModel'

function reviewLabel(review: GenerationQualityHumanReview): string {
  return review.verdict === 'accepted' ? '人工通过' : '人工拒绝'
}

export function CapabilityHumanReviewControl({
  node,
  collection,
  readOnly,
}: {
  node: GenerationCanvasNode
  collection: GenerationResultCollection
  readOnly: boolean
}): JSX.Element | null {
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const review = collection.quality?.humanReview
  const [note, setNote] = React.useState(review?.note || '')

  React.useEffect(() => {
    setNote(review?.note || '')
  }, [review?.note, review?.reviewedAt])

  if (!collection.quality || (readOnly && !review)) return null

  const applyReview = (next: GenerationQualityHumanReview | undefined) => {
    const patch = patchForQualityHumanReview(node, collection.id, next)
    if (!patch) return
    captureHistory()
    updateNode(node.id, patch)
  }
  const decide = (verdict: GenerationQualityHumanReview['verdict']) => {
    applyReview({
      verdict,
      reviewedAt: Date.now(),
      note: note.trim() || undefined,
    })
  }

  return (
    <div
      data-quality-human-review={review?.verdict || 'unreviewed'}
      className="space-y-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
        <span className="text-micro font-semibold text-nomi-ink-80">人工视觉验收</span>
        {review ? (
          <span
            className={cn(
              'min-w-0 max-w-full text-micro font-medium',
              review.verdict === 'accepted' ? 'text-workbench-success' : 'text-workbench-danger',
            )}
          >
            {reviewLabel(review)}
          </span>
        ) : (
          <span className="min-w-0 max-w-full text-micro text-nomi-ink-40">未复核</span>
        )}
      </div>
      {readOnly ? (
        review?.note ? <p className="text-micro leading-[1.4] text-nomi-ink-60">{review.note}</p> : null
      ) : (
        <>
          <textarea
            aria-label="人工验收备注"
            maxLength={500}
            rows={2}
            value={note}
            placeholder="记录身份、构图、风格或时序问题"
            className="w-full resize-y rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-2 py-1.5 text-micro leading-[1.4] text-nomi-ink outline-none focus:border-nomi-accent"
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={review?.verdict === 'accepted'}
              className={cn(
                'inline-flex h-7 items-center justify-center gap-1 rounded-nomi-sm border text-micro font-medium',
                review?.verdict === 'accepted'
                  ? 'border-workbench-success bg-workbench-success-soft text-workbench-success'
                  : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
              )}
              onClick={() => decide('accepted')}
            >
              <IconCheck size={14} stroke={1.9} aria-hidden />
              通过
            </button>
            <button
              type="button"
              aria-pressed={review?.verdict === 'rejected'}
              className={cn(
                'inline-flex h-7 items-center justify-center gap-1 rounded-nomi-sm border text-micro font-medium',
                review?.verdict === 'rejected'
                  ? 'border-workbench-danger bg-workbench-danger-soft text-workbench-danger'
                  : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
              )}
              onClick={() => decide('rejected')}
            >
              <IconX size={14} stroke={1.9} aria-hidden />
              拒绝
            </button>
          </div>
          {review ? (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 border-0 bg-transparent p-0 text-micro text-nomi-ink-40 hover:text-workbench-danger"
              onClick={() => applyReview(undefined)}
            >
              <IconTrash size={12} stroke={1.7} aria-hidden />
              清除人工结论
            </button>
          ) : null}
        </>
      )}
      <p className="text-micro leading-[1.35] text-nomi-ink-40">
        人工结论独立保存，不覆盖自动质量报告。
      </p>
    </div>
  )
}
