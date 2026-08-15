import React from 'react'
import { clampNumber } from './generationCanvasGeometry'
import { canvasDragExceededThreshold, isCanvasContextMenuPointer } from './canvasPointerGestureModel'

type Offset = { x: number; y: number }

export type CanvasContextNodeMenu = {
  stageX: number
  stageY: number
  canvasX: number
  canvasY: number
}

type PendingContextNodeMenu = {
  menu: CanvasContextNodeMenu
  pointerId: number
  button: number
  startX: number
  startY: number
  moved: boolean
  contextMenuSeen: boolean
}

type ActiveContextPointer = {
  pointerId: number
  button: number
  contextMenuSeen: boolean
  suppressContextMenu: boolean
}

type UseCanvasContextNodeMenuArgs = {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  pendingConnectionSourceId: string | null
  clearSelection: () => void
}

const CONTEXT_TARGET_GUARD =
  '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge, .generation-canvas-v2__edge-preview, button, input, textarea, select, [role="menu"], [role="menuitem"]'
const MENU_WIDTH = 148
const MENU_HEIGHT = 330
const MENU_EDGE_GAP = 8

/**
 * Blank-canvas context menu lifecycle.
 *
 * Chromium on macOS can dispatch `contextmenu` as soon as the secondary button
 * goes down. Opening the custom menu from that event would therefore interrupt
 * a live primary-button connection or a right-button pan before the gesture is
 * resolved. Queue the candidate on secondary pointer-down, always suppress the
 * browser menu immediately, and only commit the custom menu on pointer-up.
 */
export function useCanvasContextNodeMenu({
  readOnly,
  stageRef,
  offsetRef,
  zoomRef,
  pendingConnectionSourceId,
  clearSelection,
}: UseCanvasContextNodeMenuArgs) {
  const [contextNodeMenu, setContextNodeMenu] = React.useState<CanvasContextNodeMenu | null>(null)
  const pendingMenuRef = React.useRef<PendingContextNodeMenu | null>(null)
  const suppressNextContextMenuRef = React.useRef(false)
  const activeContextPointerRef = React.useRef<ActiveContextPointer | null>(null)

  const prepareContextMenuPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pendingMenuRef.current = null
    const contextMenuPointer = isCanvasContextMenuPointer(event.button, event.ctrlKey, navigator.platform)
    activeContextPointerRef.current = contextMenuPointer
      ? { pointerId: event.pointerId, button: event.button, contextMenuSeen: false, suppressContextMenu: false }
      : null
    if (!contextMenuPointer || pendingConnectionSourceId) return false
    if (readOnly || !stageRef.current) return false
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(CONTEXT_TARGET_GUARD)) return false

    const rect = stageRef.current.getBoundingClientRect()
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const zoom = zoomRef.current || 1
    pendingMenuRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      contextMenuSeen: false,
      menu: {
        stageX: clampNumber(stageX, MENU_EDGE_GAP, Math.max(MENU_EDGE_GAP, rect.width - MENU_WIDTH - MENU_EDGE_GAP)),
        stageY: clampNumber(stageY, MENU_EDGE_GAP, Math.max(MENU_EDGE_GAP, rect.height - MENU_HEIGHT - MENU_EDGE_GAP)),
        canvasX: Math.round((stageX - offsetRef.current.x) / zoom),
        canvasY: Math.round((stageY - offsetRef.current.y) / zoom),
      },
    }
    return event.button === 0
  }, [offsetRef, pendingConnectionSourceId, readOnly, stageRef, zoomRef])

  const handleContextMenuPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const secondaryChord = (event.buttons & 3) === 3
    if (secondaryChord) {
      const active = activeContextPointerRef.current
      if (active?.pointerId === event.pointerId) {
        active.suppressContextMenu = true
      } else {
        activeContextPointerRef.current = {
          pointerId: event.pointerId,
          button: 2,
          contextMenuSeen: false,
          suppressContextMenu: true,
        }
      }
    }
    const pending = pendingMenuRef.current
    if (!pending || pending.pointerId !== event.pointerId || pending.moved) return
    pending.moved = canvasDragExceededThreshold(pending.startX, pending.startY, event.clientX, event.clientY)
  }, [])

  const finishContextMenuPointerUp = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    suppressMenu: boolean,
  ) => {
    const pending = pendingMenuRef.current
    if (!pending) {
      if (suppressMenu && !activeContextPointerRef.current?.contextMenuSeen) {
        suppressNextContextMenuRef.current = true
      }
      activeContextPointerRef.current = null
      return
    }
    if (pending.pointerId !== event.pointerId || pending.button !== event.button) return
    suppressNextContextMenuRef.current = !(
      pending.contextMenuSeen || activeContextPointerRef.current?.contextMenuSeen
    )
    if (!suppressMenu && pendingMenuRef.current) {
      if (!pending.moved) {
        clearSelection()
        setContextNodeMenu(pending.menu)
      }
    }
    pendingMenuRef.current = null
    activeContextPointerRef.current = null
  }, [clearSelection])

  const handleStageContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const pending = pendingMenuRef.current
    const active = activeContextPointerRef.current
    if (activeContextPointerRef.current) activeContextPointerRef.current.contextMenuSeen = true
    if (!pending && !suppressNextContextMenuRef.current && !active?.suppressContextMenu) return
    if (pending) pending.contextMenuSeen = true
    suppressNextContextMenuRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  React.useEffect(() => {
    const cancelPendingMenu = () => {
      pendingMenuRef.current = null
      suppressNextContextMenuRef.current = false
      activeContextPointerRef.current = null
    }
    window.addEventListener('pointercancel', cancelPendingMenu)
    window.addEventListener('blur', cancelPendingMenu)
    return () => {
      window.removeEventListener('pointercancel', cancelPendingMenu)
      window.removeEventListener('blur', cancelPendingMenu)
    }
  }, [])

  return {
    contextNodeMenu,
    setContextNodeMenu,
    prepareContextMenuPointerDown,
    handleContextMenuPointerMove,
    finishContextMenuPointerUp,
    handleStageContextMenu,
  }
}
