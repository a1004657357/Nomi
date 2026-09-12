import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { IconFileText } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { PromptMediaType, PromptReferenceImage } from '../../api/promptLibraryApi'

const PROMPT_PICKER_PREVIEW_WIDTH = 296
const PROMPT_PICKER_PREVIEW_GAP = 4
const PROMPT_PICKER_PREVIEW_MAX_HEIGHT = 380

export type PromptPickerPosition = {
  left: number
  top: number
  width: number
}

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

// 提示词只此一家（素材面收敛 2026-07-22）：picker 读主提示词库「我的库」（原素材盒 localStorage 私账已并入）。
export type PromptPickerItem = {
  id: string
  title: string
  prompt: string
  promptType: PromptMediaType
  referenceImages: PromptReferenceImage[]
}

type BrowserPromptPickerPopoverProps = {
  items: PromptPickerItem[]
  position: PromptPickerPosition | null
  onSelect: (item: PromptPickerItem) => void
  setNodeRef: (node: HTMLDivElement | null) => void
}

export function BrowserPromptPickerPopover({
  items,
  position,
  onSelect,
  setNodeRef,
}: BrowserPromptPickerPopoverProps): React.ReactPortal | null {
  const { t } = useTranslation()
  const [hoveredPromptId, setHoveredPromptId] = React.useState<string | null>(null)
  const [previewTop, setPreviewTop] = React.useState(0)
  const [previewAnchorCenter, setPreviewAnchorCenter] = React.useState(0)
  const previewCardRef = React.useRef<HTMLElement | null>(null)
  const hoveredItem = hoveredPromptId ? items.find((item) => item.id === hoveredPromptId) ?? null : null
  const hoveredReferences = hoveredItem?.referenceImages ?? []
  const showHoveredPrompt = React.useCallback((id: string, row: HTMLElement): void => {
    setHoveredPromptId(id)
    const root = row.closest('[data-prompt-picker-root="true"]')
    const rootRect = root?.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const anchorCenter = rootRect ? rowRect.top - rootRect.top + rowRect.height / 2 : rowRect.height / 2
    const nextItem = items.find((item) => item.id === id)
    const referenceCount = nextItem?.referenceImages.length ? 1 : 0
    const innerWidth = PROMPT_PICKER_PREVIEW_WIDTH - 16
    const promptPreviewHeight = nextItem?.prompt ? 118 : 0
    const estimatedHeight = Math.min(
      PROMPT_PICKER_PREVIEW_MAX_HEIGHT,
      16 + referenceCount * (innerWidth * 9 / 16) + promptPreviewHeight,
    )
    setPreviewAnchorCenter(anchorCenter)
    setPreviewTop(anchorCenter - estimatedHeight / 2)
  }, [items])
  React.useLayoutEffect(() => {
    if (hoveredReferences.length === 0) return
    const card = previewCardRef.current
    if (!card) return
    setPreviewTop(previewAnchorCenter - card.getBoundingClientRect().height / 2)
  }, [hoveredReferences.length, previewAnchorCenter])
  if (!position || typeof document === 'undefined') return null

  return createPortal(
    <motion.div
      ref={setNodeRef}
      data-prompt-picker-root="true"
      className="fixed z-[80] overflow-visible"
      style={{ left: position.left, top: position.top, width: position.width, transformOrigin: 'top right' }}
      initial={{ opacity: 0, y: -6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
      role="menu"
      aria-label={t('generationCommon.composer.promptLibrary')}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseLeave={() => setHoveredPromptId(null)}
    >
      <div className="max-h-[310px] overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-lg">
        <div className="min-w-0 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="grid min-h-24 place-items-center px-4 text-center text-caption text-nomi-ink-40">
              {t('generationCommon.composer.emptyPromptLibrary')}
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cn(
                  'grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left',
                  'cursor-pointer transition-colors duration-[var(--nomi-transition-fast)]',
                  'text-nomi-ink-70 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onMouseEnter={(event) => showHoveredPrompt(item.id, event.currentTarget)}
                onFocus={(event) => showHoveredPrompt(item.id, event.currentTarget)}
                onClick={() => onSelect(item)}
              >
                {item.referenceImages[0]?.url ? (
                  <img
                    src={item.referenceImages[0].url}
                    alt=""
                    draggable={false}
                    className="block size-8 rounded-nomi-sm object-cover"
                  />
                ) : (
                  <span className="grid size-8 place-items-center rounded-nomi-sm bg-nomi-bg text-nomi-ink-35">
                    <IconFileText size={15} stroke={1.6} aria-hidden="true" />
                  </span>
                )}
                <span className="block min-w-0 overflow-hidden whitespace-nowrap text-caption leading-none">
                  {item.prompt}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {hoveredReferences.length > 0 ? (
        <aside
          ref={previewCardRef}
          className="absolute left-full overflow-hidden rounded-nomi bg-nomi-paper p-2 shadow-nomi-lg"
          style={{
            top: previewTop,
            marginLeft: PROMPT_PICKER_PREVIEW_GAP,
            width: PROMPT_PICKER_PREVIEW_WIDTH,
            maxHeight: PROMPT_PICKER_PREVIEW_MAX_HEIGHT,
          }}
        >
          <div className="grid gap-2">
            {hoveredReferences.slice(0, 1).map((reference, index) => (
              <div
                key={`${reference.url}-${index}`}
                className="overflow-hidden rounded-nomi-sm bg-nomi-paper shadow-nomi-sm"
              >
                <img src={reference.url} alt="" draggable={false} className="block aspect-video w-full object-cover" />
              </div>
            ))}
            {hoveredItem?.prompt ? (
              <div className="overflow-hidden rounded-nomi-sm bg-nomi-bg/70 px-2 py-1.5 text-caption leading-snug text-nomi-ink-70 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:6] [overflow-wrap:anywhere]">
                {hoveredItem.prompt}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </motion.div>,
    document.body,
  )
}
