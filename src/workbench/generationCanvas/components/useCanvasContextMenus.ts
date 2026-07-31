import React from 'react'
import { toast } from '../../../ui/toast'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import { STORYBOARD_TABLE_DEFAULT_SIZE } from '../model/storyboardTableSizing'
import { storyboardPlanToCreateNodesArgs, type StoryboardPlan } from '../agent/storyboardPlan'
import { buildStoryboardScriptRows } from '../../creation/storyboard/storyboardScriptViewModel'
import { clampNumber } from './generationCanvasGeometry'
import { useDragToConnect } from './useDragToConnect'
import { handleCanvasStageDrop as applyCanvasStageDrop } from './canvasStageDrop'
import type { useCanvasPointerInteractions } from './useCanvasPointerInteractions'

export type CanvasNodeMenuState = {
  stageX: number
  stageY: number
  canvasX: number
  canvasY: number
}

export type CanvasConnectionMenuState = CanvasNodeMenuState & {
  sourceNodeId: string
  sourceSide: ConnectionAnchorSide
}

type UseCanvasContextMenusOptions = {
  readOnly: boolean
  activeCategoryId: string
  allNodes: readonly GenerationCanvasNode[]
  allEdges: ReturnType<typeof useGenerationCanvasStore.getState>['edges']
  storyboardPlan: StoryboardPlan | null
  offset: { x: number; y: number }
  zoom: number
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<{ x: number; y: number }>
  zoomRef: React.MutableRefObject<number>
  pointer: ReturnType<typeof useCanvasPointerInteractions>
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  contextNodeMenu: CanvasNodeMenuState | null
  setContextNodeMenu: React.Dispatch<React.SetStateAction<CanvasNodeMenuState | null>>
}

function useDismissMenu(open: boolean, close: () => void): void {
  React.useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [close, open])
}

export function useCanvasContextMenus(options: UseCanvasContextMenusOptions) {
  const {
    readOnly,
    activeCategoryId,
    allNodes,
    allEdges,
    storyboardPlan,
    offset,
    zoom,
    stageRef,
    offsetRef,
    zoomRef,
    pointer,
    pendingConnectionSourceId,
    pendingConnectionSourceSide,
    contextNodeMenu,
    setContextNodeMenu,
  } = options
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const cancelConnection = useGenerationCanvasStore((state) => state.cancelConnection)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<CanvasConnectionMenuState | null>(null)
  const allNodesRef = React.useRef(allNodes)
  const lastPastePositionRef = React.useRef<{ x: number; y: number } | null>(null)
  allNodesRef.current = allNodes

  const closeContextNodeMenu = React.useCallback(() => setContextNodeMenu(null), [setContextNodeMenu])
  const closeConnectionMenu = React.useCallback(() => {
    setConnectionCreateMenu(null)
    cancelConnection()
  }, [cancelConnection])
  useDismissMenu(Boolean(contextNodeMenu), closeContextNodeMenu)
  useDismissMenu(Boolean(connectionCreateMenu), closeConnectionMenu)

  React.useEffect(() => {
    if (!connectionCreateMenu || !pendingConnectionSourceId) return
    if (pendingConnectionSourceId !== connectionCreateMenu.sourceNodeId) setConnectionCreateMenu(null)
  }, [connectionCreateMenu, pendingConnectionSourceId])

  const getCanvasPointFromClientPoint = React.useCallback(
    (clientX: number, clientY: number) => {
      if (!stageRef.current) return null
      const rect = stageRef.current.getBoundingClientRect()
      return {
        x: (clientX - rect.left - offsetRef.current.x) / zoomRef.current,
        y: (clientY - rect.top - offsetRef.current.y) / zoomRef.current,
      }
    },
    [offsetRef, stageRef, zoomRef],
  )

  const rememberPastePosition = React.useCallback(
    (clientX: number, clientY: number) => {
      const point = getCanvasPointFromClientPoint(clientX, clientY)
      if (!point) return
      lastPastePositionRef.current = { x: Math.max(40, Math.round(point.x)), y: Math.max(40, Math.round(point.y)) }
    },
    [getCanvasPointFromClientPoint],
  )

  const getToolbarInsertionPosition = React.useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect()
    const anchor = rect ? { x: rect.width * 0.38, y: rect.height * 0.42 } : { x: 360, y: 280 }
    return { x: Math.round((anchor.x - offset.x) / zoom), y: Math.round((anchor.y - offset.y) / zoom) }
  }, [offset.x, offset.y, stageRef, zoom])

  const getPastePosition = React.useCallback(
    () => lastPastePositionRef.current ?? getToolbarInsertionPosition(),
    [getToolbarInsertionPosition],
  )

  const { pendingCursorPos } = useDragToConnect({
    readOnly,
    pendingConnectionSourceId,
    pendingConnectionSourceSide,
    stageRef,
    offsetRef,
    zoomRef,
    cancelConnection,
    onDropOnEmpty: ({ sourceNodeId, sourceSide, stagePoint, canvasPoint }) => {
      const sourceNode = allNodesRef.current.find((node) => node.id === sourceNodeId)
      const canCreateMedia =
        sourceNode?.kind === 'text' ||
        sourceNode?.kind === 'image' ||
        Boolean(sourceNode && isImageLikeGenerationNodeKind(sourceNode.kind))
      if (!canCreateMedia || !stageRef.current) {
        cancelConnection()
        return
      }
      const rect = stageRef.current.getBoundingClientRect()
      setContextNodeMenu(null)
      cancelConnection()
      setConnectionCreateMenu({
        sourceNodeId,
        sourceSide,
        stageX: clampNumber(stagePoint.x, 8, Math.max(8, rect.width - 140)),
        stageY: clampNumber(stagePoint.y, 8, Math.max(8, rect.height - 84)),
        canvasX: Math.round(canvasPoint.x),
        canvasY: Math.round(canvasPoint.y),
      })
    },
  })

  const handleStageDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      pointer.cancelActiveInteractions()
      getDesktopBridge()?.browser?.endAssetDrag?.()
      applyCanvasStageDrop(event, { readOnly, offset, zoom, activeCategoryId })
    },
    [activeCategoryId, offset, pointer, readOnly, zoom],
  )
  const handleStagePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      rememberPastePosition(event.clientX, event.clientY)
      pointer.onPointerDown(event)
    },
    [pointer, rememberPastePosition],
  )
  const handleStagePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      rememberPastePosition(event.clientX, event.clientY)
      pointer.onPointerMove(event)
    },
    [pointer, rememberPastePosition],
  )

  const handleStageContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly || !stageRef.current) return
      if (pointer.shouldSuppressContextMenu()) {
        event.preventDefault()
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (
        target?.closest(
          '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge, .generation-canvas-v2__edge-preview, button, input, textarea, select, [role="menu"], [role="menuitem"]',
        )
      )
        return
      event.preventDefault()
      event.stopPropagation()
      clearSelection()
      const rect = stageRef.current.getBoundingClientRect()
      const point = getCanvasPointFromClientPoint(event.clientX, event.clientY)
      if (!point) return
      setContextNodeMenu({
        stageX: clampNumber(event.clientX - rect.left, 8, Math.max(8, rect.width - 156)),
        stageY: clampNumber(event.clientY - rect.top, 8, Math.max(8, rect.height - 374)),
        canvasX: Math.round(point.x),
        canvasY: Math.round(point.y),
      })
    },
    [clearSelection, getCanvasPointFromClientPoint, pointer, readOnly, setContextNodeMenu, stageRef],
  )

  const handleAddContextNode = React.useCallback(
    (kind: GenerationNodeKind) => {
      if (!contextNodeMenu) return
      addNode({
        kind,
        position: { x: contextNodeMenu.canvasX, y: contextNodeMenu.canvasY },
        categoryId: activeCategoryId,
      })
      setContextNodeMenu(null)
    },
    [activeCategoryId, addNode, contextNodeMenu, setContextNodeMenu],
  )

  const handleAddStoryboardTableNode = React.useCallback(() => {
    if (!contextNodeMenu) return
    const rows = storyboardPlan ? [] : buildStoryboardScriptRows(null, allNodes, allEdges)
    const plan =
      storyboardPlan ??
      (rows.length ? { title: '画布分镜脚本', anchors: [], shots: rows.map((row) => row.shot) } : null)
    if (!plan) {
      toast('当前画布还没有可整理成脚本的分镜', 'info')
      setContextNodeMenu(null)
      return
    }
    const groupNode = storyboardPlanToCreateNodesArgs(plan).nodes.find((node) => node.clientId === 'storyboard-group')
    addNode({
      kind: 'text',
      title: `分镜组：${plan.title.trim() || '未命名分镜'}`,
      prompt: groupNode?.prompt || '',
      position: { x: contextNodeMenu.canvasX, y: contextNodeMenu.canvasY },
      categoryId: activeCategoryId,
      size: { ...STORYBOARD_TABLE_DEFAULT_SIZE },
      meta: { storyboardGroup: true, storyboardPlanSnapshot: plan },
    })
    setContextNodeMenu(null)
  }, [activeCategoryId, addNode, allEdges, allNodes, contextNodeMenu, setContextNodeMenu, storyboardPlan])

  const handleAddConnectedNode = React.useCallback(
    (kind: GenerationNodeKind) => {
      if (!connectionCreateMenu) return
      const created = addNode({
        kind,
        position: { x: connectionCreateMenu.canvasX, y: connectionCreateMenu.canvasY },
        categoryId: activeCategoryId,
        exactPosition: true,
        select: true,
      })
      startConnection(connectionCreateMenu.sourceNodeId, connectionCreateMenu.sourceSide)
      completeNodeConnection(created.id)
      setConnectionCreateMenu(null)
    },
    [activeCategoryId, addNode, connectionCreateMenu, startConnection],
  )

  return {
    contextNodeMenu,
    connectionCreateMenu,
    closeContextNodeMenu,
    pendingCursorPos,
    getCanvasPointFromClientPoint,
    getToolbarInsertionPosition,
    getPastePosition,
    handleStageDrop,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStageContextMenu,
    handleAddContextNode,
    handleAddStoryboardTableNode,
    handleAddConnectedNode,
  }
}
