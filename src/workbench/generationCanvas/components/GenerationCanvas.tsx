import React from 'react'
import { IconCopy, IconFileText, IconFolderShare, IconMovie, IconPlayerPlay, IconTimeline } from '@tabler/icons-react'
import { confirmDialog, promptDialog, WorkbenchIconButton } from '../../../design'
import { useNavigate } from 'react-router-dom'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'
import { buildStudioUrl } from '../../../utils/appRoutes'
import CanvasToolbar, { NodeAddMenu } from './CanvasToolbar'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import {
  BROWSER_ASSET_DRAG_MIME,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  handleCanvasStageDrop,
  importBrowserAssetsToGenerationCanvas,
} from './canvasStageDrop'
import {
  subscribeBrowserAssetsImportToCanvas,
  type BrowserAssetCanvasImportItem,
} from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { getGenerationNodeComponent } from '../nodes/renderRegistry'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  isStoryboardContainedNodeHidden,
  shouldRenderEdgeInStoryboardContainment,
} from '../model/storyboardContainedNodes'
import { STORYBOARD_TABLE_DEFAULT_SIZE } from '../model/storyboardTableSizing'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { expandNodeIdsWithUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { confirmAndRunPlan, useBatchPlanPreviewStore } from './batchPlanPreview'
import { BatchGenerateSettingsButton } from './BatchGenerateSettingsButton'
import { convertImageShotsToVideos, isConvertibleImageShotNode } from '../agent/convertShotToVideo'
import { sendStoryboardToTimeline } from '../agent/sendStoryboardToTimeline'
import { storyboardPlanToCreateNodesArgs, type StoryboardPlan } from '../agent/storyboardPlan'
import { useWorkbenchStore } from '../../workbenchStore'
import StoryboardScriptShortcutButton from '../../creation/storyboard/StoryboardScriptShortcutButton'
import { buildStoryboardScriptRows, hasStoryboardScriptSource } from '../../creation/storyboard/storyboardScriptViewModel'
import { defaultSelectedNodeProjectName } from '../../project/selectedNodeProjectPayload'
import { createProjectFromSelectedNodes, type SelectedNodeProjectTransferMode } from '../../project/selectedNodeProjectTransfer'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { GroupFrameList } from './GroupFrame'
import { useAutoFitOnLoad } from './useAutoFitOnLoad'
import { useCanvasShortcuts } from './useCanvasShortcuts'
import { useCanvasPointerInteractions } from './useCanvasPointerInteractions'
import { useDragToConnect } from './useDragToConnect'
import { CanvasEmptyState } from './CanvasEmptyState'
import { CanvasNavigationStack } from './CanvasNavigationStack'
import { CanvasGestureHint } from './CanvasGestureHint'
import { SelectionPromptSaveController } from './SelectionPromptSaveController'
import { useNodeAppearTracking } from './useNodeAppearTracking'
import { useTidyCanvas } from './useTidyCanvas'
import {
  centerNodeOffset,
  clampNumber,
  getCanvasGroupBoxes,
  getNodeSize,
  getSelectedBounds,
} from './generationCanvasGeometry'
import { useCanvasViewport } from './useCanvasViewport'
import CanvasEdgeLayer, { type ActiveEdge } from './CanvasEdgeLayer'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { shouldRenderFullNodeContent, shouldUseLightweightNodeRendering } from './canvasNodeLevelOfDetail'
import { LightweightGenerationNode } from './LightweightGenerationNode'
import { hasPendingScene3DCameraMoveCapture, hasPendingScene3DStagingCapture } from './scene3dCaptureHostActivation'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { useCanvasSelectionDrag } from './useCanvasSelectionDrag'
import { CanvasSelectionToolbar } from './CanvasSelectionToolbar'
import '../styles/generationCanvas.css'

const FOCUS_GENERATION_NODE_EVENT = 'nomi-focus-generation-node'
const StagingCaptureHost = lazyWithChunkBoundary('3D 站位捕获', () =>
  import('../nodes/scene3d/StagingCaptureHost').then((module) => ({ default: module.StagingCaptureHost })),
)
const CameraMoveCaptureHost = lazyWithChunkBoundary('3D 运镜捕获', () =>
  import('../nodes/scene3d/CameraMoveCaptureHost').then((module) => ({ default: module.CameraMoveCaptureHost })),
)
const BatchPlanOverlay = lazyWithChunkBoundary('批量生成面板', () =>
  import('./BatchPlanOverlay').then((module) => ({ default: module.BatchPlanOverlay })),
)

const MULTI_SELECTION_BOUNDS_PADDING = 16
const MULTI_SELECTION_TOOLBAR_OFFSET = 58

type GenerationCanvasProps = {
  readOnly?: boolean
  projectName?: string
}

export default function GenerationCanvas({ readOnly = false, projectName }: GenerationCanvasProps): JSX.Element {
  const navigate = useNavigate()
  const isReady = useGenerationCanvasStore((state) => state.isReady)
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const allEdges = useGenerationCanvasStore((state) => state.edges)
  const allGroups = useGenerationCanvasStore((state) => state.groups)
  const hasPendingStagingCapture = useGenerationCanvasStore((state) => hasPendingScene3DStagingCapture(state.nodes))
  const hasPendingCameraMoveCapture = useGenerationCanvasStore((state) => hasPendingScene3DCameraMoveCapture(state.nodes))
  const hasBatchPlanPreview = useBatchPlanPreviewStore((state) => Boolean(state.plan))
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const storyboardPlan = useWorkbenchStore((state) => state.storyboardPlan)
  // Phase E3: filter nodes by active sub-canvas. Nodes with no categoryId
  // fall back to the project default ("shots") so legacy projects keep
  // rendering until E4 migrates them.
  const categoryNodes = React.useMemo(() => {
    if (!activeCategoryId) return allNodes
    return allNodes.filter((node) => (node.categoryId || 'shots') === activeCategoryId)
  }, [allNodes, activeCategoryId])
  const nodes = React.useMemo(
    () => categoryNodes.filter((node) => !isStoryboardContainedNodeHidden(node)),
    [categoryNodes],
  )
  const categoryNodeIds = React.useMemo(() => new Set(categoryNodes.map((n) => n.id)), [categoryNodes])
  const categoryNodeById = React.useMemo(() => new Map(categoryNodes.map((node) => [node.id, node])), [categoryNodes])
  const edges = React.useMemo(
    () =>
      allEdges.filter(
        (edge) =>
          categoryNodeIds.has(edge.source) &&
          categoryNodeIds.has(edge.target) &&
          shouldRenderEdgeInStoryboardContainment(edge, categoryNodeById),
      ),
    [allEdges, categoryNodeById, categoryNodeIds],
  )
  const hasStoryboardTableNode = React.useMemo(
    () => allNodes.some((node) => node.meta?.storyboardGroup === true),
    [allNodes],
  )
  const canAddStoryboardTableNode = React.useMemo(
    () => !hasStoryboardTableNode && hasStoryboardScriptSource(storyboardPlan, allNodes),
    [allNodes, hasStoryboardTableNode, storyboardPlan],
  )
  const groups = React.useMemo(
    () => allGroups.filter((group) => group.categoryId === activeCategoryId),
    [activeCategoryId, allGroups],
  )
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const selectNodesInRect = useGenerationCanvasStore((state) => state.selectNodesInRect)
  const setCanvasTransform = useGenerationCanvasStore((state) => state.setCanvasTransform)
  const deleteSelectedNodes = useGenerationCanvasStore((state) => state.deleteSelectedNodes)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pasteNodes = useGenerationCanvasStore((state) => state.pasteNodes)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const selectNodes = useGenerationCanvasStore((state) => state.selectNodes)
  const groupSelectedNodes = useGenerationCanvasStore((state) => state.groupSelectedNodes)
  const ungroupGroups = useGenerationCanvasStore((state) => state.ungroupGroups)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const moveGroupNodes = useGenerationCanvasStore((state) => state.moveGroupNodes)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingConnectionSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const cancelConnection = useGenerationCanvasStore((state) => state.cancelConnection)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const redo = useGenerationCanvasStore((state) => state.redo)
  const markReady = useGenerationCanvasStore((state) => state.markReady)
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodeById = categoryNodeById
  const selectedBounds = React.useMemo(() => getSelectedBounds(nodes, selectedNodeIds), [nodes, selectedNodeIds])
  const selectedConvertibleImageCount = React.useMemo(
    () => nodes.filter((node) => selectedSet.has(node.id) && isConvertibleImageShotNode(node)).length,
    [nodes, selectedSet],
  )
  const groupBoxes = React.useMemo(() => getCanvasGroupBoxes(groups, nodes), [groups, nodes])
  const selectedGroupIds = React.useMemo(() => {
    return groups
      .filter((group) => {
        const memberIds = group.nodeIds.filter((nodeId) => {
          const node = nodeById.get(nodeId)
          return node && (node.categoryId || 'shots') === group.categoryId
        })
        return memberIds.length > 0 && memberIds.every((nodeId) => selectedSet.has(nodeId))
      })
      .map((group) => group.id)
  }, [groups, nodeById, selectedSet])

  // Pan/zoom + 视口虚拟化收口到 useCanvasViewport（壳组件顶死 800 行，抽出腾 headroom）。
  const {
    categoryViewports,
    setViewport,
    zoom,
    offset,
    stageRef,
    stageSize,
    visibleNodesForRender,
    visibleEdgeNodeIds,
    offsetRef,
    zoomRef,
    stageSizeRef,
  } = useCanvasViewport(activeCategoryId, nodes)
  const edgesForRender = React.useMemo(() => {
    if (!visibleEdgeNodeIds) return edges
    return edges.filter((edge) => visibleEdgeNodeIds.has(edge.source) || visibleEdgeNodeIds.has(edge.target))
  }, [edges, visibleEdgeNodeIds])
  // 出现动画：只让**新落点**节点弹入（add/paste/Agent），开项目时已有节点不齐闪（实现见 hook）。
  const appearNodeIds = useNodeAppearTracking(allNodes)
  const { isTidying, tidy } = useTidyCanvas(activeCategoryId)
  const [contextNodeMenu, setContextNodeMenu] = React.useState<{
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const [selectionContextMenu, setSelectionContextMenu] = React.useState<{
    stageX: number
    stageY: number
    nodeIds: string[]
  } | null>(null)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<{
    sourceNodeId: string
    sourceSide: ConnectionAnchorSide
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const [activeEdge, setActiveEdge] = React.useState<ActiveEdge | null>(null)
  const activeEdgeId = activeEdge?.id ?? null
  const [focusFlashNodeId, setFocusFlashNodeId] = React.useState<string | null>(null)
  const [pendingFocusNodeId, setPendingFocusNodeId] = React.useState<string | null>(null)
  const [minimapVisible, setMinimapVisible] = React.useState(true)
  const [transferringSelectionMode, setTransferringSelectionMode] = React.useState<SelectedNodeProjectTransferMode | null>(null)
  const focusFlashTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    markReady()
  }, [markReady])

  React.useEffect(() => {
    if (!activeEdgeId || edges.some((edge) => edge.id === activeEdgeId)) return
    setActiveEdge(null)
  }, [activeEdgeId, edges])

  // allNodes 的最新值给 drag-connection 等效应读（offset/zoom/stageSize 的 ref 由 useCanvasViewport 提供）。
  const allNodesRef = React.useRef(allNodes)
  allNodesRef.current = allNodes

  const pointer = useCanvasPointerInteractions({
    readOnly,
    stageRef,
    offsetRef,
    zoomRef,
    setViewport,
    activeCategoryId,
    clearSelection,
    cancelConnection,
    pendingConnectionSourceId,
    setContextNodeMenu,
    setActiveEdge,
    activeEdgeId,
    selectNodesInRect,
  })
  const { isPanning, isSpaceHeld, setViewportTransform, animateViewportTo, zoomAtStagePoint } = pointer
  const { handleGroupFramePointerDown, handleSelectionBoundsPointerDown } = useCanvasSelectionDrag({
    readOnly,
    selectedNodeCount: selectedNodeIds.length,
    zoomRef,
    captureHistory,
    commitPersistedChange,
    moveGroupNodes,
    moveSelectedNodes,
    selectNodes,
  })

  React.useEffect(() => {
    const handleFocusNode = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: unknown }>).detail
      const nodeId = typeof detail?.nodeId === 'string' ? detail.nodeId : ''
      if (!nodeId) return
      const target = allNodesRef.current.find((node) => node.id === nodeId)
      if (!target) {
        toast('源节点已不存在', 'warning')
        return
      }
      const targetCategoryId = target.categoryId || 'shots'
      setActiveCategoryId(targetCategoryId)
      selectNode(nodeId)
      setPendingFocusNodeId(nodeId)
    }
    window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
    return () => {
      window.removeEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
      if (focusFlashTimerRef.current !== null) {
        window.clearTimeout(focusFlashTimerRef.current)
        focusFlashTimerRef.current = null
      }
    }
  }, [selectNode, setActiveCategoryId])

  React.useEffect(() => {
    if (!pendingFocusNodeId) return
    const target = allNodes.find((node) => node.id === pendingFocusNodeId)
    if (!target) {
      setPendingFocusNodeId(null)
      return
    }
    const targetCategoryId = target.categoryId || 'shots'
    if (targetCategoryId !== activeCategoryId) return
    const targetZoom = categoryViewports[targetCategoryId]?.zoom || zoomRef.current || 1
    const targetOffset = centerNodeOffset(target, stageSizeRef.current, targetZoom)
    animateViewportTo(targetZoom, targetOffset, 220) // 聚焦节点平滑滑入
    setFocusFlashNodeId(pendingFocusNodeId)
    setPendingFocusNodeId(null)
    if (focusFlashTimerRef.current !== null) window.clearTimeout(focusFlashTimerRef.current)
    focusFlashTimerRef.current = window.setTimeout(() => {
      setFocusFlashNodeId((current) => (current === pendingFocusNodeId ? null : current))
      focusFlashTimerRef.current = null
    }, 1400)
  }, [activeCategoryId, allNodes, animateViewportTo, categoryViewports, pendingFocusNodeId, stageSizeRef, zoomRef])

  // Keep the store viewport in sync so nodes can read the same zoom/pan model.
  React.useEffect(() => {
    setCanvasTransform(zoom, offset)
  }, [offset, setCanvasTransform, zoom])

  React.useEffect(() => {
    if (!contextNodeMenu) return undefined
    const closeMenu = () => setContextNodeMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextNodeMenu])

  React.useEffect(() => {
    if (!selectionContextMenu) return undefined
    const closeMenu = () => setSelectionContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [selectionContextMenu])

  React.useEffect(() => {
    if (!connectionCreateMenu) return undefined
    const closeMenu = () => {
      setConnectionCreateMenu(null)
      cancelConnection()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [cancelConnection, connectionCreateMenu])

  React.useEffect(() => {
    if (!connectionCreateMenu) return
    if (!pendingConnectionSourceId) return
    if (pendingConnectionSourceId === connectionCreateMenu.sourceNodeId) return
    setConnectionCreateMenu(null)
  }, [connectionCreateMenu, pendingConnectionSourceId])

  // 拖拽连线跟踪（含 rAF 节流预览线）抽到 useDragToConnect（R9/B3）
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
      const sourceCanCreateMedia =
        sourceNode?.kind === 'text' ||
        sourceNode?.kind === 'image' ||
        Boolean(sourceNode && isImageLikeGenerationNodeKind(sourceNode.kind))
      if (!sourceCanCreateMedia || !stageRef.current) {
        cancelConnection()
        return
      }
      const rect = stageRef.current.getBoundingClientRect()
      const menuWidth = 132
      const menuHeight = 76
      setContextNodeMenu(null)
      cancelConnection()
      setConnectionCreateMenu({
        sourceNodeId,
        sourceSide,
        stageX: clampNumber(stagePoint.x, 8, Math.max(8, rect.width - menuWidth - 8)),
        stageY: clampNumber(stagePoint.y, 8, Math.max(8, rect.height - menuHeight - 8)),
        canvasX: Math.round(canvasPoint.x),
        canvasY: Math.round(canvasPoint.y),
      })
    },
  })

  const handleGroupSelectedNodes = React.useCallback(() => {
    const group = groupSelectedNodes(activeCategoryId)
    if (!group) return
    // 编组结果即时显示为画布上的组框 → 成功 toast 是噪音（弹窗审计 R2）。
  }, [activeCategoryId, groupSelectedNodes])

  // 批量生成（「生成选中」唯一入口）。不傻批量：先算依赖波次（参考先生成→镜头后生成）。
  // 用户拍板「不弹窗+缺啥提示啥」：点了就直接跑能跑的（不再弹模态确认条）；上游参考没生成
  // 而被拦下的，由 runPlanWithToasts 用人话 toast 告诉你「哪些没跑、为什么」(describeBlockedNotice)。
  const handleBatchGenerate = React.useCallback(() => {
    const ids = [...selectedNodeIds]
    if (ids.length === 0) return
    const state = useGenerationCanvasStore.getState()
    const expandedIds = expandNodeIdsWithUngeneratedReferenceAncestors(ids, { nodes: state.nodes, edges: state.edges })
    const plan = buildDependencyWaves(expandedIds, { nodes: state.nodes, edges: state.edges })
    void confirmAndRunPlan(plan)
  }, [selectedNodeIds])

  const handleBatchConvertSelectedImagesToVideos = React.useCallback(() => {
    const state = useGenerationCanvasStore.getState()
    const selectedImages = state.nodes.filter((node) => selectedSet.has(node.id) && isConvertibleImageShotNode(node))
    const result = convertImageShotsToVideos(selectedImages)
    if (result.nodeIds.length === 0) {
      toast('选中内容里没有可转视频的图片镜头', 'warning')
      return
    }
    if (result.created > 0) {
      const reused = result.existing > 0 ? `，复用 ${result.existing} 个已有视频` : ''
      toast(`已转出 ${result.created} 个视频镜头${reused}`, 'success')
      return
    }
    toast(`选中镜头已转过视频，已选中 ${result.existing} 个视频节点`, 'info')
  }, [selectedSet])

  const handleSendSelectedToTimeline = React.useCallback(() => {
    const result = sendStoryboardToTimeline(selectedNodeIds)
    if (result.sent.length > 0) {
      toast(`已按镜序送入时间轴 ${result.sent.length} 段`, 'success')
      return
    }
    toast(result.skipped.length > 0 ? '选中节点还没有可发送到时间轴的图片或视频结果' : '没有可发送到时间轴的节点', 'warning')
  }, [selectedNodeIds])

  const handleTransferSelectedNodes = React.useCallback(async (mode: SelectedNodeProjectTransferMode, explicitNodeIds?: readonly string[]) => {
    const ids = [...(explicitNodeIds ?? selectedNodeIds)]
    if (!ids.length) {
      toast('请先选中要放入新项目的节点。', 'warning')
      return
    }
    const defaultName = defaultSelectedNodeProjectName(projectName, mode)
    const requestedName = await promptDialog({
      title: mode === 'move' ? '移动到新项目' : '复制到新项目',
      message: `将 ${ids.length} 个选中节点放入一个新的项目。`,
      placeholder: '新项目名称',
      initialValue: defaultName,
      confirmLabel: mode === 'move' ? '继续移动' : '创建副本',
    })
    const targetProjectName = requestedName?.trim()
    if (!targetProjectName) return
    if (mode === 'move') {
      const confirmed = await confirmDialog({
        title: '确认移动节点',
        message: `会先创建「${targetProjectName}」，成功后从当前项目删除这 ${ids.length} 个节点。`,
        confirmLabel: '移动',
        danger: true,
      })
      if (!confirmed) return
    }
    setTransferringSelectionMode(mode)
    try {
      const result = createProjectFromSelectedNodes({
        selectedNodeIds: ids,
        sourceProjectName: projectName,
        targetProjectName,
        mode,
      })
      if (mode === 'move') {
        for (const nodeId of ids) {
          useGenerationCanvasStore.getState().deleteNode(nodeId)
        }
        await persistActiveWorkbenchProjectNow()
      }
      toast(`${mode === 'move' ? '已移动' : '已复制'} ${result.nodeCount} 个节点到「${result.project.name}」`, 'success')
      navigate(buildStudioUrl(result.project.id), { replace: false })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTransferringSelectionMode(null)
    }
  }, [navigate, projectName, selectedNodeIds])

  const openSelectionContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !stageRef.current) return
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.generation-canvas-v2-node') : null
    if (!target) return
    const nodeId = target.getAttribute('data-node-id') || ''
    if (!nodeId) return
    const nodeIds = selectedSet.has(nodeId) ? [...selectedNodeIds] : [nodeId]
    if (!selectedSet.has(nodeId)) selectNode(nodeId)
    event.preventDefault()
    event.stopPropagation()
    const rect = stageRef.current.getBoundingClientRect()
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const menuWidth = 172
    const menuHeight = 92
    setContextNodeMenu(null)
    setSelectionContextMenu({
      stageX: clampNumber(stageX, 8, Math.max(8, rect.width - menuWidth - 8)),
      stageY: clampNumber(stageY, 8, Math.max(8, rect.height - menuHeight - 8)),
      nodeIds,
    })
  }, [readOnly, selectedNodeIds, selectedSet, selectNode, stageRef])

  const handleUngroupSelectedNodes = React.useCallback(() => {
    if (!selectedGroupIds.length) return
    ungroupGroups(selectedGroupIds)
    // 解组结果画布即时可见 → 成功 toast 是噪音（弹窗审计 R2）。
  }, [selectedGroupIds, ungroupGroups])

  const lastPastePositionRef = React.useRef<{ x: number; y: number } | null>(null)

  const getCanvasPointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) return null
    const rect = stageRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left - offsetRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - offsetRef.current.y) / zoomRef.current,
    }
  }, [offsetRef, stageRef, zoomRef])

  const rememberPastePositionFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const point = getCanvasPointFromClientPoint(clientX, clientY)
    if (!point) return
    lastPastePositionRef.current = {
      x: Math.max(40, Math.round(point.x)),
      y: Math.max(40, Math.round(point.y)),
    }
  }, [getCanvasPointFromClientPoint])

  const getToolbarInsertionPosition = React.useCallback(
    () => {
      const rect = stageRef.current?.getBoundingClientRect()
      const viewportAnchor = rect
        ? { x: rect.width * 0.38, y: rect.height * 0.42 }
        : { x: 360, y: 280 }
      return {
        x: Math.round((viewportAnchor.x - offset.x) / zoom),
        y: Math.round((viewportAnchor.y - offset.y) / zoom),
      }
    },
    [offset.x, offset.y, zoom, stageRef],
  )

  const handleBrowserAssetsImportToCanvas = React.useCallback(
    (assets: readonly BrowserAssetCanvasImportItem[]) => {
      if (readOnly) return
      const result = importBrowserAssetsToGenerationCanvas(assets, {
        basePosition: getToolbarInsertionPosition(),
        categoryId: activeCategoryId,
      })
      if (result.createdCount === 0) {
        toast('没有可导入画布的素材', 'info')
        return
      }
      toast(result.createdCount === 1 ? '已导入画布' : `已导入 ${result.createdCount} 个素材到画布`, 'success')
    },
    [activeCategoryId, getToolbarInsertionPosition, readOnly],
  )

  React.useEffect(
    () => subscribeBrowserAssetsImportToCanvas((assets) => handleBrowserAssetsImportToCanvas(assets)),
    [handleBrowserAssetsImportToCanvas],
  )

  React.useEffect(() => {
    const overlayBridge = getDesktopBridge()?.browser?.assetOverlay
    if (!overlayBridge?.onImportToCanvas) return undefined
    return overlayBridge.onImportToCanvas((payload) => {
      const assets = Array.isArray(payload?.assets) ? payload.assets as BrowserAssetCanvasImportItem[] : []
      handleBrowserAssetsImportToCanvas(assets)
    })
  }, [handleBrowserAssetsImportToCanvas])

  const getPastePosition = React.useCallback(
    () => lastPastePositionRef.current ?? getToolbarInsertionPosition(),
    [getToolbarInsertionPosition],
  )

  useCanvasShortcuts({
    readOnly,
    stageRef,
    selectedNodeCount: selectedNodeIds.length,
    selectedGroupCount: selectedGroupIds.length,
    activeCategoryId,
    setActiveEdge,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    ungroupSelectedNodes: handleUngroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePosition,
    undo,
    redo,
  })

  const handleStageDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    handleCanvasStageDrop(event, { readOnly, offset, zoom, activeCategoryId })
  }, [activeCategoryId, offset, readOnly, zoom])

  const handleStagePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    rememberPastePositionFromClientPoint(event.clientX, event.clientY)
    pointer.onPointerDown(event)
  }, [pointer, rememberPastePositionFromClientPoint])

  const handleStagePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    rememberPastePositionFromClientPoint(event.clientX, event.clientY)
    pointer.onPointerMove(event)
  }, [pointer, rememberPastePositionFromClientPoint])

  const handleStageContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !stageRef.current) return
    if (pointer.shouldSuppressContextMenu()) {
      event.preventDefault()
      return
    }
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(
      '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge, .generation-canvas-v2__edge-preview, button, input, textarea, select, [role="menu"], [role="menuitem"]',
    )) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    clearSelection()
    const rect = stageRef.current.getBoundingClientRect()
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const canvasPoint = getCanvasPointFromClientPoint(event.clientX, event.clientY)
    if (!canvasPoint) return
    const menuWidth = 148
    const menuHeight = 366
    setContextNodeMenu({
      stageX: clampNumber(stageX, 8, Math.max(8, rect.width - menuWidth - 8)),
      stageY: clampNumber(stageY, 8, Math.max(8, rect.height - menuHeight - 8)),
      canvasX: Math.round(canvasPoint.x),
      canvasY: Math.round(canvasPoint.y),
    })
  }

  const handleAddContextNode = (kind: GenerationNodeKind) => {
    if (!contextNodeMenu) return
    addNode({
      kind,
      position: { x: contextNodeMenu.canvasX, y: contextNodeMenu.canvasY },
      categoryId: activeCategoryId,
    })
    setContextNodeMenu(null)
  }

  const handleAddStoryboardTableNode = () => {
    if (!contextNodeMenu) return
    const fallbackPlan: StoryboardPlan | null = storyboardPlan
      ? null
      : (() => {
          const rows = buildStoryboardScriptRows(null, allNodes, allEdges)
          return rows.length
            ? {
                title: '画布分镜脚本',
                anchors: [],
                shots: rows.map((row) => row.shot),
              }
            : null
        })()
    const plan = storyboardPlan ?? fallbackPlan
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
      meta: {
        storyboardGroup: true,
        storyboardPlanSnapshot: plan,
      },
    })
    setContextNodeMenu(null)
  }

  const handleAddConnectedNode = (kind: GenerationNodeKind) => {
    if (!connectionCreateMenu) return
    const sourceNodeId = connectionCreateMenu.sourceNodeId
    const sourceSide = connectionCreateMenu.sourceSide
    const created = addNode({
      kind,
      position: { x: connectionCreateMenu.canvasX, y: connectionCreateMenu.canvasY },
      categoryId: activeCategoryId,
      exactPosition: true,
      select: true,
    })
    startConnection(sourceNodeId, sourceSide)
    completeNodeConnection(created.id)
    setConnectionCreateMenu(null)
  }

  // animate=true：用户点「适应视图」按钮，平滑过渡；自动加载（useAutoFitOnLoad）传 false 即时定位，避免每次开项目都「飞入」。
  const fitView = React.useCallback((animate = false) => {
    if (!nodes.length || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const padding = 80
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const maxX = Math.max(...nodes.map((n) => n.position.x + getNodeSize(n).width))
    const maxY = Math.max(...nodes.map((n) => n.position.y + getNodeSize(n).height))
    const contentW = maxX - minX + padding * 2
    const contentH = maxY - minY + padding * 2
    const nextZoom = Math.min(1.2, Math.min(rect.width / contentW, rect.height / contentH))
    const nextOffset = {
      x: (rect.width - contentW * nextZoom) / 2 - (minX - padding) * nextZoom,
      y: (rect.height - contentH * nextZoom) / 2 - (minY - padding) * nextZoom,
    }
    if (animate) animateViewportTo(nextZoom, nextOffset, 200)
    else setViewportTransform(nextZoom, nextOffset)
  }, [animateViewportTo, nodes, setViewportTransform, stageRef])

  // memo 化 minimap 的跳转回调（内联会每渲染新建 → 废掉 CanvasMinimap 的 memo）。
  const handleMinimapJump = React.useCallback((point: { x: number; y: number }) => {
    const z = zoomRef.current || 1
    setViewportTransform(z, { x: stageSize.width / 2 - point.x * z, y: stageSize.height / 2 - point.y * z })
  }, [setViewportTransform, stageSize.width, stageSize.height, zoomRef])

  // 缩放条拖动：以画布中心为锚点缩放（无 rect 时退化为原地缩放，不丢手势）。
  const handleZoomTo = React.useCallback((nextZoom: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) {
      setViewportTransform(nextZoom, offsetRef.current)
      return
    }
    zoomAtStagePoint(nextZoom, { x: rect.width / 2, y: rect.height / 2 })
  }, [offsetRef, setViewportTransform, stageRef, zoomAtStagePoint])

  // 项目/分类首次加载时自动适应视图（含「历史视口框不住任何节点」的自愈式适应，
  // 防止图都在视口外、用户误以为「图消失」）。逻辑抽到 useAutoFitOnLoad（防巨壳）。
  useAutoFitOnLoad({ nodes, activeCategoryId, categoryViewports, fitView, stageRef, zoomRef, offsetRef })

  // 一次性「请适应视图」信号（落画布等批量加节点场景，见 store.requestCanvasFit）。
  // useAutoFitOnLoad 只在首次加载/切分类触发，加新节点不重跑——这里补「显式动作后揭示新内容」。
  // 用 ref 取最新 fitView，确保 360ms 后 DOM 渲染完、节点就绪时 fit 到的是最新节点集。
  const canvasFitNonce = useWorkbenchStore((state) => state.canvasFitNonce)
  const fitViewRef = React.useRef(fitView)
  fitViewRef.current = fitView
  const lastFitNonceRef = React.useRef(0)
  React.useEffect(() => {
    if (canvasFitNonce === 0 || canvasFitNonce === lastFitNonceRef.current) return
    lastFitNonceRef.current = canvasFitNonce
    const tid = setTimeout(() => fitViewRef.current(true), 360) // 等模式切换 + 节点 DOM 渲染一帧
    return () => clearTimeout(tid)
  }, [canvasFitNonce])

  const zoomPercent = Math.round(zoom * 100)
  const selectedCount = selectedNodeIds.length
  const lightweightNodeMode = shouldUseLightweightNodeRendering(nodes.length, zoom)
  const handleSelectLightweightNode = React.useCallback(
    (nodeId: string, additive: boolean) => {
      if (readOnly) return
      selectNode(nodeId, additive)
    },
    [readOnly, selectNode],
  )

  // E.2C-13: 删除 viewType 分支。5 个分类全部走同一画布底座。
  // 节点渲染样式差异由 NodeRenderKind 分发（E.2C-14/15+ 实现）。

  return (
    <section
      className={cn(
        'generation-canvas-v2',
        'grid grid-rows-[minmax(0,1fr)] w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink',
      )}
      aria-label="AI 影像创作画布"
      data-ready={isReady ? 'true' : undefined}
      data-nomi-generation-canvas-import-target={!readOnly ? 'true' : undefined}
    >
      <div className={cn('generation-canvas-v2__main', 'relative w-full h-full min-w-0 min-h-0')}>
        {hasPendingStagingCapture || hasPendingCameraMoveCapture ? (
          <React.Suspense fallback={null}>
            {hasPendingStagingCapture ? <StagingCaptureHost /> : null}
            {hasPendingCameraMoveCapture ? <CameraMoveCaptureHost /> : null}
          </React.Suspense>
        ) : null}
        {!readOnly ? <CanvasToolbar getInsertionPosition={getToolbarInsertionPosition} categoryId={activeCategoryId} /> : null}
        {!readOnly ? (
          <StoryboardScriptShortcutButton className="absolute top-4 left-[184px] z-[18]" label="分镜脚本" />
        ) : null}
        <div
          className="generation-canvas-v2__stage"
          ref={stageRef}
          data-panning={isPanning ? 'true' : undefined}
          data-space-pan={isSpaceHeld ? 'true' : undefined}
          onPointerDownCapture={pointer.onPointerDownCapture}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={pointer.onPointerUp}
          onContextMenu={handleStageContextMenu}
          onDragOver={(event) => {
            if (readOnly) return
            const types = Array.from(event.dataTransfer.types)
            if (
              types.includes('Files') ||
              types.includes(WORKSPACE_FILE_DRAG_MIME) ||
              types.includes(ASSET_LIBRARY_DRAG_MIME) ||
              types.includes(BROWSER_ASSET_DRAG_MIME) ||
              types.includes(LEGACY_BROWSER_ASSET_DRAG_MIME)
            ) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={handleStageDrop}
        >
          <div
            className={cn('generation-canvas-v2__canvas', 'absolute inset-0 origin-top-left')}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            {selectedBounds && selectedCount > 1 ? (
              <div
                className="generation-canvas-v2__selection-bounds"
                style={{
                  transform: `translate(${Math.round(selectedBounds.minX - MULTI_SELECTION_BOUNDS_PADDING)}px, ${Math.round(selectedBounds.minY - MULTI_SELECTION_BOUNDS_PADDING)}px)`,
                  width: Math.round(selectedBounds.width + MULTI_SELECTION_BOUNDS_PADDING * 2),
                  height: Math.round(selectedBounds.height + MULTI_SELECTION_BOUNDS_PADDING * 2),
                }}
                onPointerDown={handleSelectionBoundsPointerDown}
                aria-hidden="true"
              />
            ) : null}
            <CanvasEdgeLayer
              edges={edgesForRender}
              nodeById={nodeById}
              zoom={zoom}
              visibleNodeIds={visibleEdgeNodeIds}
              lightweight={lightweightNodeMode}
              focusedNodeId={selectedNodeIds.length === 1 ? selectedNodeIds[0] : null}
              activeEdge={activeEdge}
              readOnly={readOnly}
              pendingConnectionSourceId={connectionCreateMenu?.sourceNodeId ?? pendingConnectionSourceId}
              pendingConnectionSourceSide={connectionCreateMenu?.sourceSide ?? pendingConnectionSourceSide}
              pendingCursorPos={connectionCreateMenu ? { x: connectionCreateMenu.canvasX, y: connectionCreateMenu.canvasY } : pendingCursorPos}
              onSetActiveEdge={setActiveEdge}
              onDisconnectEdge={disconnectEdge}
              getCanvasPointFromClientPoint={getCanvasPointFromClientPoint}
            />
            <div
              className={cn('generation-canvas-v2__nodes', 'absolute top-0 left-0 w-full h-full')}
              data-tidying={isTidying ? 'true' : undefined}
              onContextMenu={openSelectionContextMenu}
            >
              {/* E.2C-30: GroupFrame 抽离为独立组件 */}
              <GroupFrameList boxes={groupBoxes} onPointerDown={handleGroupFramePointerDown} />
              <React.Suspense fallback={null}>
                {visibleNodesForRender.map((node) => {
                  const selected = selectedSet.has(node.id)
                  const focusFlash = focusFlashNodeId === node.id
                  if (!shouldRenderFullNodeContent({ lightweightMode: lightweightNodeMode, selected, focusFlash })) {
                    return (
                      <LightweightGenerationNode
                        key={node.id}
                        node={node}
                        appear={appearNodeIds.has(node.id)}
                        onSelect={handleSelectLightweightNode}
                      />
                    )
                  }
                  const NodeComponent = getGenerationNodeComponent(node.kind)
                  return (
                    <NodeComponent
                      key={node.id}
                      node={node}
                      selected={selected}
                      readOnly={readOnly}
                      focusFlash={focusFlash}
                      appear={appearNodeIds.has(node.id)}
                    />
                  )
                })}
              </React.Suspense>
            </div>
            {selectedBounds && selectedCount > 1 && !readOnly ? (
              <CanvasSelectionToolbar
                selectedCount={selectedCount}
                selectedGroupCount={selectedGroupIds.length}
                transform={`translate(${Math.round(selectedBounds.minX + selectedBounds.width / 2)}px, ${Math.round(selectedBounds.minY - MULTI_SELECTION_BOUNDS_PADDING - MULTI_SELECTION_TOOLBAR_OFFSET)}px) translateX(-50%)`}
                onBatchGenerate={handleBatchGenerate}
                onGroupSelectedNodes={handleGroupSelectedNodes}
                onUngroupSelectedNodes={handleUngroupSelectedNodes}
                onClearSelection={clearSelection}
                generationControls={
                  <>
                    <BatchGenerateSettingsButton selectedNodeIds={selectedNodeIds} />
                    <WorkbenchIconButton label="按原参数生成" icon={<IconPlayerPlay size={16} />} onClick={handleBatchGenerate} />
                    {selectedConvertibleImageCount > 0 ? (
                      <WorkbenchIconButton label="批量转视频" icon={<IconMovie size={16} />} onClick={handleBatchConvertSelectedImagesToVideos} />
                    ) : null}
                    <WorkbenchIconButton label="按镜序送时间轴" icon={<IconTimeline size={16} />} onClick={handleSendSelectedToTimeline} />
                    <span className={cn('w-px h-4 bg-nomi-line')} />
                    <WorkbenchIconButton
                      label="复制到新项目"
                      icon={<IconCopy size={16} />}
                      disabled={Boolean(transferringSelectionMode)}
                      onClick={() => void handleTransferSelectedNodes('copy')}
                    />
                    <WorkbenchIconButton
                      label="移动到新项目"
                      icon={<IconFolderShare size={16} />}
                      disabled={Boolean(transferringSelectionMode)}
                      onClick={() => void handleTransferSelectedNodes('move')}
                    />
                  </>
                }
              />
            ) : null}
          </div>
          {pointer.marqueeRect ? (
            <div
              className={cn(
                'generation-canvas-v2__marquee',
                'absolute z-[10] pointer-events-none',
                'border border-nomi-accent rounded-nomi-sm bg-nomi-accent-soft/40',
              )}
              style={{
                left: pointer.marqueeRect.left,
                top: pointer.marqueeRect.top,
                width: pointer.marqueeRect.width,
                height: pointer.marqueeRect.height,
              }}
              aria-hidden="true"
            />
          ) : null}
          {/* E.2C-24: 空状态 CTA（spec 决策 4）— 分类感知的引导按钮（组件抽出，R9） */}
          {nodes.length === 0 ? (
            <CanvasEmptyState
              activeCategoryId={activeCategoryId}
              onCreate={() => addNode({ kind: 'image', position: { x: 240, y: 240 }, categoryId: activeCategoryId, select: true })}
            />
          ) : null}
          {contextNodeMenu ? (
            <NodeAddMenu
              className={cn('generation-canvas-v2__context-node-menu', 'z-[20]')}
              style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
              extraItems={
                canAddStoryboardTableNode
                  ? [
                      {
                        key: 'storyboard-table',
                        label: '分镜脚本',
                        icon: <IconFileText size={14} stroke={1.6} />,
                        onClick: handleAddStoryboardTableNode,
                      },
                    ]
                  : []
              }
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAddNode={handleAddContextNode}
            />
          ) : null}
          {selectionContextMenu ? (
            <div
              className={cn(
                'generation-canvas-v2__selection-context-menu',
                'absolute z-[20] min-w-[172px] overflow-hidden rounded-nomi-sm',
                'border border-nomi-line bg-nomi-paper shadow-nomi-md p-1',
              )}
              role="menu"
              style={{ left: selectionContextMenu.stageX, top: selectionContextMenu.stageY }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                role="menuitem"
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption text-nomi-ink',
                  'border-0 bg-transparent cursor-pointer hover:bg-nomi-ink-05',
                )}
                onClick={() => {
                  const ids = selectionContextMenu.nodeIds
                  setSelectionContextMenu(null)
                  void handleTransferSelectedNodes('copy', ids)
                }}
              >
                <IconCopy size={14} stroke={1.8} aria-hidden="true" />
                复制到新项目
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption text-nomi-ink',
                  'border-0 bg-transparent cursor-pointer hover:bg-nomi-ink-05',
                )}
                onClick={() => {
                  const ids = selectionContextMenu.nodeIds
                  setSelectionContextMenu(null)
                  void handleTransferSelectedNodes('move', ids)
                }}
              >
                <IconFolderShare size={14} stroke={1.8} aria-hidden="true" />
                移动到新项目
              </button>
            </div>
          ) : null}
          {connectionCreateMenu ? (
            <NodeAddMenu
              className={cn('generation-canvas-v2__connection-create-menu', 'z-[20] left-auto w-[132px]')}
              style={{ left: connectionCreateMenu.stageX, top: connectionCreateMenu.stageY }}
              kinds={['image', 'video']}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAddNode={handleAddConnectedNode}
            />
          ) : null}
        </div>
        {!readOnly ? <CanvasGestureHint /> : null}
        <CanvasNavigationStack
          readOnly={readOnly}
          nodes={nodes}
          selectedIds={selectedSet}
          zoom={zoom}
          zoomPercent={zoomPercent}
          offset={offset}
          stageSize={stageSize}
          minimapVisible={minimapVisible}
          onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
          onJumpToCanvasPoint={handleMinimapJump}
          onFitView={() => fitView(true)}
          onResetView={() => animateViewportTo(1, { x: 0, y: 0 }, 200)}
          onTidy={() => tidy(stageSize.width / Math.max(1, stageSize.height))}
          onZoomTo={handleZoomTo}
          batchPlanOverlay={
            hasBatchPlanPreview ? (
              <React.Suspense fallback={null}>
                <BatchPlanOverlay />
              </React.Suspense>
            ) : null
          }
        />
        <SelectionPromptSaveController nodes={allNodes} disabled={readOnly} />
      </div>
    </section>
  )
}
