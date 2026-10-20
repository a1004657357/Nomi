import React from 'react'
import { useNavigate } from 'react-router-dom'
import { confirmDialog, promptDialog } from '../../../design'
import { toast } from '../../../ui/toast'
import { buildStudioUrl } from '../../../utils/appRoutes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { expandNodeIdsWithUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { confirmAndRunPlan } from './batchPlanPreview'
import { convertImageShotsToVideos, isConvertibleImageShotNode } from '../agent/convertShotToVideo'
import { sendStoryboardToTimeline } from '../agent/sendStoryboardToTimeline'
import { reportAdoptionOutcome } from '../../adoption/adoptionReceipt'
import i18n from '../../../i18n'
import { defaultSelectedNodeProjectName } from '../../project/selectedNodeProjectPayload'
import { createProjectFromSelectedNodes, type SelectedNodeProjectTransferMode } from '../../project/selectedNodeProjectTransfer'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { clampNumber } from './generationCanvasGeometry'

export type SelectionContextMenuState = {
  stageX: number
  stageY: number
  nodeIds: string[]
}

type UseCanvasSelectionActionsOptions = {
  readOnly: boolean
  activeCategoryId: string
  projectName?: string
  selectedNodeIds: readonly string[]
  selectedSet: ReadonlySet<string>
  selectedGroupIds: readonly string[]
  stageRef: React.RefObject<HTMLDivElement | null>
  closeContextNodeMenu: () => void
}

export function useCanvasSelectionActions(options: UseCanvasSelectionActionsOptions) {
  const {
    readOnly,
    activeCategoryId,
    projectName,
    selectedNodeIds,
    selectedSet,
    selectedGroupIds,
    stageRef,
    closeContextNodeMenu,
  } = options
  const navigate = useNavigate()
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const groupSelectedNodes = useGenerationCanvasStore((state) => state.groupSelectedNodes)
  const ungroupGroups = useGenerationCanvasStore((state) => state.ungroupGroups)
  const [selectionContextMenu, setSelectionContextMenu] = React.useState<SelectionContextMenuState | null>(null)
  const [transferringSelectionMode, setTransferringSelectionMode] = React.useState<SelectedNodeProjectTransferMode | null>(null)

  React.useEffect(() => {
    if (!selectionContextMenu) return undefined
    const close = () => setSelectionContextMenu(null)
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
  }, [selectionContextMenu])

  const handleGroupSelectedNodes = React.useCallback(() => {
    groupSelectedNodes(activeCategoryId)
  }, [activeCategoryId, groupSelectedNodes])

  const handleUngroupSelectedNodes = React.useCallback(() => {
    if (selectedGroupIds.length) ungroupGroups([...selectedGroupIds])
  }, [selectedGroupIds, ungroupGroups])

  const handleBatchGenerate = React.useCallback(() => {
    const ids = [...selectedNodeIds]
    if (!ids.length) return
    const state = useGenerationCanvasStore.getState()
    const expandedIds = expandNodeIdsWithUngeneratedReferenceAncestors(ids, { nodes: state.nodes, edges: state.edges })
    void confirmAndRunPlan(buildDependencyWaves(expandedIds, { nodes: state.nodes, edges: state.edges }), { initiator: 'user' })
  }, [selectedNodeIds])

  const handleBatchConvertSelectedImagesToVideos = React.useCallback(() => {
    const state = useGenerationCanvasStore.getState()
    const selectedImages = state.nodes.filter((node) => selectedSet.has(node.id) && isConvertibleImageShotNode(node))
    const result = convertImageShotsToVideos(selectedImages)
    if (!result.nodeIds.length) {
      toast('选中内容里没有可转视频的图片镜头', 'warning')
    } else if (result.created > 0) {
      const reused = result.existing > 0 ? `，复用 ${result.existing} 个已有视频` : ''
      toast(`已转出 ${result.created} 个视频镜头${reused}`, 'success')
    } else {
      toast(`选中镜头已转过视频，已选中 ${result.existing} 个视频节点`, 'info')
    }
  }, [selectedSet])

  const handleSendSelectedToTimeline = React.useCallback(async () => {
    try {
      const result = await sendStoryboardToTimeline([...selectedNodeIds])
      if (result.sent.length > 0) {
        toast(`已按镜序送入时间轴 ${result.sent.length} 段`, 'success')
        return
      }
      if (result.outcome.status !== 'nothing_to_adopt') {
        reportAdoptionOutcome(result.outcome)
        return
      }
      toast(result.skipped.length > 0 ? '选中节点还没有可发送到时间轴的图片或视频结果' : '没有可发送到时间轴的节点', 'warning')
    } catch (error) {
      toast(error instanceof Error ? error.message : i18n.t('timelineEditor.adoption.failedRecovered'), 'error')
    }
  }, [selectedNodeIds])

  const handleTransferSelectedNodes = React.useCallback(async (
    mode: SelectedNodeProjectTransferMode,
    explicitNodeIds?: readonly string[],
  ) => {
    const ids = [...(explicitNodeIds ?? selectedNodeIds)]
    if (!ids.length) {
      toast('请先选中要放入新项目的节点。', 'warning')
      return
    }
    const requestedName = await promptDialog({
      title: mode === 'move' ? '移动到新项目' : '复制到新项目',
      message: `将 ${ids.length} 个选中节点放入一个新的项目。`,
      placeholder: '新项目名称',
      initialValue: defaultSelectedNodeProjectName(projectName, mode),
      confirmLabel: mode === 'move' ? '继续移动' : '创建副本',
    })
    const targetProjectName = requestedName?.trim()
    if (!targetProjectName) return
    if (mode === 'move' && !await confirmDialog({
      title: '确认移动节点',
      message: `会先创建「${targetProjectName}」，成功后从当前项目删除这 ${ids.length} 个节点。`,
      confirmLabel: '移动',
      danger: true,
    })) return

    setTransferringSelectionMode(mode)
    try {
      const result = await createProjectFromSelectedNodes({
        selectedNodeIds: ids,
        sourceProjectName: projectName,
        targetProjectName,
        mode,
      })
      if (mode === 'move') {
        ids.forEach((nodeId) => useGenerationCanvasStore.getState().deleteNode(nodeId))
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
    const nodeId = target?.getAttribute('data-node-id') || ''
    if (!nodeId) return
    const nodeIds = selectedSet.has(nodeId) ? [...selectedNodeIds] : [nodeId]
    if (!selectedSet.has(nodeId)) selectNode(nodeId)
    event.preventDefault()
    event.stopPropagation()
    const rect = stageRef.current.getBoundingClientRect()
    closeContextNodeMenu()
    setSelectionContextMenu({
      stageX: clampNumber(event.clientX - rect.left, 8, Math.max(8, rect.width - 180)),
      stageY: clampNumber(event.clientY - rect.top, 8, Math.max(8, rect.height - 100)),
      nodeIds,
    })
  }, [closeContextNodeMenu, readOnly, selectNode, selectedNodeIds, selectedSet, stageRef])

  return {
    selectionContextMenu,
    setSelectionContextMenu,
    transferringSelectionMode,
    handleGroupSelectedNodes,
    handleUngroupSelectedNodes,
    handleBatchGenerate,
    handleBatchConvertSelectedImagesToVideos,
    handleSendSelectedToTimeline,
    handleTransferSelectedNodes,
    openSelectionContextMenu,
  }
}
