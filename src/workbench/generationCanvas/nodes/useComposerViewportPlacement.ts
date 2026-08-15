import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  didComposerAvailableSpaceChange,
  getUnobstructedComposerSpaceBelow,
  shouldAllowComposerAttachmentRecompute,
  shouldPreserveComposerAttachmentOnRatioChange,
} from './nodeSizing'

const FLIP_HYSTERESIS = 48
const TOOLBAR_CLEARANCE_GAP = 18

export const NODE_FLOATING_TOOLBAR_SELECTOR = '[data-node-floating-toolbar="true"]'

export function toolbarClearanceInCanvasUnits(screenHeight: number, zoom: number, gap: number): number {
  return screenHeight > 0 ? screenHeight / (zoom || 1) + gap : 0
}

type Placement = {
  anchorRef: React.RefObject<HTMLDivElement>
  canvasZoom: number
  flipUp: boolean
  aboveClearance: number
  shiftX: number
}

/**
 * composer 的视口定位总闸：横向夹取、上下避让、比例切换保持连接侧，以及动态时间轴把手观察。
 * 这些都只依赖屏幕几何，独立于 composer 的业务控件与生成逻辑。
 */
export function useComposerViewportPlacement(input: {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
  gap: number
}): Placement {
  const { node, visualSize, gap } = input
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const canvasOffset = useGenerationCanvasStore((state) => state.canvasOffset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = React.useState(false)
  const [aboveClearance, setAboveClearance] = React.useState(0)
  const [shiftX, setShiftX] = React.useState(0)
  const aspectRatioKey = typeof node.meta?.aspect_ratio === 'string' ? node.meta.aspect_ratio : ''
  const previousAspectRatioRef = React.useRef<string | null>(null)

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return
    const workspaceCanvas = stage.closest('.workbench-generation__canvas')
    const preserveAttachment = shouldPreserveComposerAttachmentOnRatioChange(
      previousAspectRatioRef.current,
      aspectRatioKey,
    )
    previousAspectRatioRef.current = aspectRatioKey
    const initialStageRect = stage.getBoundingClientRect()
    let observedAvailableSpace = {
      anchor: { width: anchor.offsetWidth, height: anchor.offsetHeight },
      stage: { width: initialStageRect.width, height: initialStageRect.height },
    }

    const recompute = (changes: { availableSpaceChanged?: boolean; obstacleChanged?: boolean } = {}) => {
      const stageRect = stage.getBoundingClientRect()
      const nodeRect = nodeEl.getBoundingClientRect()
      const margin = 12
      const cardScreenWidth = anchor.offsetWidth
      const centerX = nodeRect.left + nodeRect.width / 2
      const wouldLeft = centerX - cardScreenWidth / 2
      const wouldRight = centerX + cardScreenWidth / 2
      const minLeft = stageRect.left + margin
      const maxRight = stageRect.right - margin
      let nextShiftX = 0
      if (wouldRight > maxRight) nextShiftX = maxRight - wouldRight
      if (wouldLeft + nextShiftX < minLeft) nextShiftX = minLeft - wouldLeft
      setShiftX(Math.round(nextShiftX))

      const neededScreenHeight = (anchor.offsetHeight || 280) + gap * canvasZoom
      const timelineHandle = workspaceCanvas?.querySelector<HTMLElement>('.workbench-generation__timeline-handle')
      const spaceBelow = getUnobstructedComposerSpaceBelow({
        stage: stageRect,
        node: nodeRect,
        composer: { left: wouldLeft + nextShiftX, right: wouldRight + nextShiftX },
        obstacles: timelineHandle ? [timelineHandle.getBoundingClientRect()] : [],
      })
      const spaceAbove = nodeRect.top - stageRect.top
      const attachmentObstructed = flipUp
        ? spaceAbove < neededScreenHeight + aboveClearance * canvasZoom
        : spaceBelow < neededScreenHeight
      const allowFlip = shouldAllowComposerAttachmentRecompute({
        preserveForRatioChange: preserveAttachment,
        availableSpaceChanged: changes.availableSpaceChanged ?? false,
        obstacleChanged: changes.obstacleChanged ?? false,
        attachmentObstructed,
      })
      if (allowFlip) {
        setFlipUp((previous) => (
          previous
            ? !(spaceBelow > neededScreenHeight + FLIP_HYSTERESIS)
            : spaceBelow < neededScreenHeight && spaceAbove > spaceBelow
        ))
      }

      const toolbar = nodeEl.querySelector<HTMLElement>(NODE_FLOATING_TOOLBAR_SELECTOR)
      const toolbarScreenHeight = toolbar ? toolbar.getBoundingClientRect().height : 0
      setAboveClearance(
        toolbarClearanceInCanvasUnits(toolbarScreenHeight, canvasZoom, TOOLBAR_CLEARANCE_GAP),
      )
    }

    let observedTimelineHandle: HTMLElement | null = null
    let observedTimelineHandleSize: { width: number; height: number } | null = null
    const resizeObserver = new ResizeObserver((entries) => {
      const stageRect = stage.getBoundingClientRect()
      const nextAvailableSpace = {
        anchor: { width: anchor.offsetWidth, height: anchor.offsetHeight },
        stage: { width: stageRect.width, height: stageRect.height },
      }
      const availableSpaceChanged = didComposerAvailableSpaceChange(observedAvailableSpace, nextAvailableSpace)
      observedAvailableSpace = nextAvailableSpace
      let obstacleChanged = false
      if (observedTimelineHandle && entries.some((entry) => entry.target === observedTimelineHandle)) {
        const nextSize = {
          width: observedTimelineHandle.offsetWidth,
          height: observedTimelineHandle.offsetHeight,
        }
        obstacleChanged = observedTimelineHandleSize !== null && (
          observedTimelineHandleSize.width !== nextSize.width || observedTimelineHandleSize.height !== nextSize.height
        )
        observedTimelineHandleSize = nextSize
      }
      recompute({ availableSpaceChanged, obstacleChanged })
    })

    const syncTimelineHandleObservation = (): boolean => {
      const nextHandle = workspaceCanvas?.querySelector<HTMLElement>('.workbench-generation__timeline-handle') ?? null
      if (nextHandle === observedTimelineHandle) return false
      if (observedTimelineHandle) resizeObserver.unobserve(observedTimelineHandle)
      observedTimelineHandle = nextHandle
      observedTimelineHandleSize = nextHandle
        ? { width: nextHandle.offsetWidth, height: nextHandle.offsetHeight }
        : null
      if (nextHandle) resizeObserver.observe(nextHandle)
      return true
    }

    resizeObserver.observe(anchor)
    resizeObserver.observe(stage)
    syncTimelineHandleObservation()
    recompute()

    const mutationObserver = new MutationObserver(() => {
      if (syncTimelineHandleObservation()) recompute({ obstacleChanged: true })
    })
    if (workspaceCanvas) mutationObserver.observe(workspaceCanvas, { childList: true, subtree: true })
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [
    aboveClearance,
    aspectRatioKey,
    canvasOffset,
    canvasZoom,
    flipUp,
    gap,
    node.position?.x,
    node.position?.y,
    node.result?.url,
    visualSize.height,
    visualSize.width,
  ])

  return { anchorRef, canvasZoom, flipUp, aboveClearance, shiftX }
}
