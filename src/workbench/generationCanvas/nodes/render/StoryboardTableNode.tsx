import { useTranslation } from 'react-i18next'
import i18n from '../../../../i18n'
import { withProjectAction } from '../../../project/projectCanvasReadSurface'
import { selectActiveStoryboardDesign } from '../../../workbenchDocumentSlice'
import type { JSX } from 'react'
import React from 'react'
import { Menu } from '@mantine/core'
import { useShallow } from 'zustand/react/shallow'
import {
  IconChevronUp,
  IconDotsVertical,
  IconGripVertical,
  IconMaximize,
  IconMinimize,
  IconPhoto,
  IconPencil,
  IconRobot,
  IconSparkles,
  IconVideo,
  IconWand,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { WorkbenchButton } from '../../../../design'
import { useWorkbenchStore } from '../../../workbenchStore'
import {
  buildStoryboardScriptRows,
  type StoryboardScriptRow,
} from '../../../creation/storyboard/storyboardScriptViewModel'
import {
  buildDetailedStoryboardShotVideoPrompt,
  parseStoryboardPlan,
  storyboardShotImagePrompt,
  storyboardShotVideoPrompt,
  type PlanShot,
  type StoryboardPlan,
} from '../../agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { isShotNumberedNode } from '../../model/shotNumbering'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodeSizing'
import { isStoryboardContainedNodeExpanded, withStoryboardContainedMeta } from '../../model/storyboardContainedNodes'
import {
  STORYBOARD_TABLE_DEFAULT_SIZE,
  STORYBOARD_TABLE_MIN_CONTENT_WIDTH,
  storyboardTableFitSize,
  storyboardTableSizePatch,
} from '../../model/storyboardTableSizing'
import { runStoryboardTableAutofill } from '../../agent/storyboardTableAutofill'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { openCapabilityRecipeInspector } from '../../components/capabilityRecipeEvents'
import { confirmAndRunPlan } from '../../components/batchPlanPreview'
import { buildDependencyWaves } from '../../runner/dependencyWaves'
import {
  ensureStoryboardRowImageOutput,
  ensureStoryboardRowVideoOutput,
  storyboardRowOutputPosition,
} from './storyboardRowOutputs'
import { ensureStoryboardRowKeyframes } from './storyboardRowKeyframes'
import {
  BufferedDurationInput,
  CompactFieldsCell,
  CompactPromptCell,
  GroupedFieldsCell,
  StoryboardMediaPreview,
  TextCell,
} from './StoryboardTableCells'
import { STORYBOARD_FIELD_GROUPS, type ShotTextField } from './storyboardTableFieldConfig'
export { StoryboardMediaPreview } from './StoryboardTableCells'

type Props = {
  node: GenerationCanvasNode
}

type PromptField = Extract<keyof PlanShot, 'imagePrompt' | 'videoPrompt'>

type EnsureRowMediaOptions = {
  expanded?: boolean
}

const GRID_COLUMNS = ['88px', '160px', '150px', '170px', '160px', '220px', '220px', '152px'].join(' ')

const STATUS_LABEL: Record<StoryboardScriptRow['status'], string> = {
  get generated() { return i18n.t("canvasComponents.generated") },
  get running() { return i18n.t("canvasComponents.generating") },
  get error() { return i18n.t("canvasComponents.failed") },
  get pending() { return i18n.t("canvasComponents.pendingGeneration") },
}

function readStoryboardSnapshot(meta: GenerationCanvasNode['meta']): StoryboardPlan | null {
  if (!meta?.storyboardPlanSnapshot) return null
  try {
    return parseStoryboardPlan(meta.storyboardPlanSnapshot)
  } catch {
    return null
  }
}

function rowPromptValue(shot: PlanShot, key: PromptField): string {
  return key === 'imagePrompt' ? storyboardShotImagePrompt(shot) : storyboardShotVideoPrompt(shot)
}

function videoPromptPatch(shot: PlanShot, prompt: string): Partial<PlanShot> {
  return {
    videoPrompt: prompt,
    ...((shot.shotKind ?? 'video') !== 'image' ? { prompt } : {}),
  }
}

function storyboardActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function StoryboardTableNodeImpl({ node }: Props): JSX.Element {
  useTranslation()
  const workbenchPlan = useWorkbenchStore((state) => (selectActiveStoryboardDesign(state)?.plan ?? null))
  const setStoryboardPlan = useWorkbenchStore((state) => state.setStoryboardPlan)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const requestCanvasFit = useWorkbenchStore((state) => state.requestCanvasFit)
  const nodes = useGenerationCanvasStore(
    useShallow((state) => {
      const shotNodeIds = new Set(state.nodes.filter(isShotNumberedNode).map((candidate) => candidate.id))
      const referenceNodeIds = new Set(
        state.edges.filter((edge) => shotNodeIds.has(edge.target)).map((edge) => edge.source),
      )
      return state.nodes.filter((candidate) => shotNodeIds.has(candidate.id) || referenceNodeIds.has(candidate.id))
    }),
  )
  const edges = useGenerationCanvasStore(
    useShallow((state) => {
      const shotNodeIds = new Set(state.nodes.filter(isShotNumberedNode).map((candidate) => candidate.id))
      return state.edges.filter((edge) => shotNodeIds.has(edge.target))
    }),
  )
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const updateNodePrompt = useGenerationCanvasStore((state) => state.updateNodePrompt)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const selectNodes = useGenerationCanvasStore((state) => state.selectNodes)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const [agentFilling, setAgentFilling] = React.useState(false)
  const [keyframeGeneratingShotIndex, setKeyframeGeneratingShotIndex] = React.useState<number | null>(null)
  const [expandedShotIndex, setExpandedShotIndex] = React.useState<number | null>(null)
  const [mediaVisibilityRoot, setMediaVisibilityRoot] = React.useState<HTMLElement | null>(null)

  const snapshotPlan = React.useMemo(() => readStoryboardSnapshot(node.meta), [node.meta])
  const plan = workbenchPlan ?? snapshotPlan
  const rows = React.useMemo(() => buildStoryboardScriptRows(plan, nodes, edges), [plan, nodes, edges])

  React.useEffect(() => {
    if (expandedShotIndex !== null && !rows.some((row) => row.shot.index === expandedShotIndex)) {
      setExpandedShotIndex(null)
    }
  }, [expandedShotIndex, rows])

  const replaceShot = React.useCallback(
    (shotIndex: number, patch: Partial<PlanShot>) => {
      if (!plan) return
      const nextPlan: StoryboardPlan = {
        ...plan,
        shots: plan.shots.map((shot) => (shot.index === shotIndex ? { ...shot, ...patch } : shot)),
      }
      setStoryboardPlan(nextPlan)
      updateNode(node.id, { meta: { ...(node.meta || {}), storyboardPlanSnapshot: nextPlan } }, { persist: false })
    },
    [node.id, node.meta, plan, setStoryboardPlan, updateNode],
  )

  const updateTextField = React.useCallback(
    (shot: PlanShot, key: ShotTextField, value: string) => {
      replaceShot(shot.index, { [key]: value })
    },
    [replaceShot],
  )

  const updatePromptField = React.useCallback(
    (shot: PlanShot, key: PromptField, value: string) => {
      const patch: Partial<PlanShot> = { [key]: value }
      if (key === 'imagePrompt' && (shot.shotKind ?? 'video') === 'image') patch.prompt = value
      if (key === 'videoPrompt' && (shot.shotKind ?? 'video') !== 'image') patch.prompt = value
      replaceShot(shot.index, patch)
    },
    [replaceShot],
  )

  const updateDuration = React.useCallback(
    (shot: PlanShot, value: string) => {
      const durationSec = Math.max(0, Number(value) || 0)
      replaceShot(shot.index, { durationSec })
    },
    [replaceShot],
  )

  const polishVideoPrompt = React.useCallback(
    (row: StoryboardScriptRow) => {
      const prompt = buildDetailedStoryboardShotVideoPrompt(row.shot)
      replaceShot(row.shot.index, videoPromptPatch(row.shot, prompt))
      if (row.videoNode) updateNodePrompt(row.videoNode.id, prompt)
      commitPersistedChange()
      toast(i18n.t("canvasComponents.polishedTheVideoPromptForShot", { v0: row.shot.index }), 'success')
    },
    [commitPersistedChange, replaceShot, updateNodePrompt],
  )

  const polishAllVideoPrompts = React.useCallback(() => {
    if (!plan || rows.length === 0) return
    const promptByShotIndex = new Map(
      rows.map((row) => [row.shot.index, buildDetailedStoryboardShotVideoPrompt(row.shot)]),
    )
    const nextPlan: StoryboardPlan = {
      ...plan,
      shots: plan.shots.map((shot) => {
        const prompt = promptByShotIndex.get(shot.index)
        return prompt ? { ...shot, ...videoPromptPatch(shot, prompt) } : shot
      }),
    }
    setStoryboardPlan(nextPlan)
    updateNode(node.id, { meta: { ...(node.meta || {}), storyboardPlanSnapshot: nextPlan } }, { persist: false })
    for (const row of rows) {
      const prompt = promptByShotIndex.get(row.shot.index)
      if (prompt && row.videoNode) updateNodePrompt(row.videoNode.id, prompt)
    }
    commitPersistedChange()
    toast(i18n.t("canvasComponents.polishedVideoPrompts", { v0: promptByShotIndex.size }), 'success')
  }, [commitPersistedChange, node.id, node.meta, plan, rows, setStoryboardPlan, updateNode, updateNodePrompt])

  const autofillWithAgent = React.useCallback(
    (overwriteExisting: boolean) => withProjectAction(async project => {
      project.assertCurrent()
      if (!plan || agentFilling) return
      setAgentFilling(true)
      try {
        const result = await runStoryboardTableAutofill({ project, plan, overwriteExisting })
        project.assertCurrent()
        toast(i18n.t("canvasComponents.agentFilledInShots", { v0: result.updatedShotCount }), 'success')
      } catch (error: unknown) {
        if (project.signal.aborted) return
        toast(error instanceof Error ? error.message : i18n.t("canvasComponents.agentCouldNotFillInTheTable"), 'error')
      } finally {
        if (!project.signal.aborted) setAgentFilling(false)
      }
    }),
    [agentFilling, plan],
  )

  const containNodeForRow = React.useCallback(
    (
      target: GenerationCanvasNode,
      row: StoryboardScriptRow,
      role: 'image' | 'video',
      expanded = isStoryboardContainedNodeExpanded(target),
    ): GenerationCanvasNode => {
      const patch: Partial<GenerationCanvasNode> = {
        meta: withStoryboardContainedMeta(target.meta, {
          tableNodeId: node.id,
          rowIndex: row.shot.index,
          role,
          expanded,
        }),
        position: storyboardRowOutputPosition(node, row.shot.index, role),
      }
      updateNode(target.id, patch)
      return {
        ...target,
        ...patch,
        meta: patch.meta,
        position: patch.position || target.position,
      }
    },
    [node, updateNode],
  )

  const ensureImageNodeForRow = React.useCallback(
    (
      row: StoryboardScriptRow,
      options: EnsureRowMediaOptions = {},
    ): { nodeId: string; node: GenerationCanvasNode; created: boolean } => {
      return ensureStoryboardRowImageOutput({
        tableNode: node,
        shot: row.shot,
        imageNode: row.imageNode,
        videoNode: row.videoNode,
        expanded: options.expanded,
      })
    },
    [node],
  )

  const ensureVideoNodeForRow = React.useCallback(
    async (
      row: StoryboardScriptRow,
      options: EnsureRowMediaOptions = {},
    ): Promise<{ nodeId: string; node: GenerationCanvasNode; existed: boolean; imageCreated: boolean }> => {
      const result = await ensureStoryboardRowVideoOutput({
        tableNode: node,
        shot: row.shot,
        imageNode: row.imageNode,
        videoNode: row.videoNode,
        expanded: options.expanded,
      })
      return {
        nodeId: result.nodeId,
        node: result.node,
        existed: !result.created,
        imageCreated: result.imageCreated,
      }
    },
    [node],
  )

  const containAllRowNodes = React.useCallback(() => {
    let count = 0
    for (const row of rows) {
      if (row.imageNode) {
        containNodeForRow(row.imageNode, row, 'image', false)
        count += 1
      }
      if (row.videoNode) {
        containNodeForRow(row.videoNode, row, 'video', false)
        count += 1
      }
    }
    requestCanvasFit()
    toast(count ? i18n.t("canvasComponents.containedStoryboardGenerationNodes", { v0: count }) : i18n.t("canvasComponents.noStoryboardGenerationNodesToContain"), count ? 'success' : 'info')
  }, [containNodeForRow, requestCanvasFit, rows])

  const fitStoryboardTable = React.useCallback(() => {
    const size = storyboardTableFitSize(rows.length, expandedShotIndex !== null)
    updateNode(node.id, storyboardTableSizePatch(node.meta, size))
    commitPersistedChange()
    requestCanvasFit()
    toast(i18n.t("canvasComponents.storyboardTableFittedToItsCurrentRowsAndColumns"), 'success')
  }, [commitPersistedChange, expandedShotIndex, node.id, node.meta, requestCanvasFit, rows.length, updateNode])

  const compactStoryboardTable = React.useCallback(() => {
    const size = { ...STORYBOARD_TABLE_DEFAULT_SIZE }
    updateNode(node.id, storyboardTableSizePatch(node.meta, size))
    commitPersistedChange()
    requestCanvasFit()
    toast(i18n.t("canvasComponents.storyboardTableRestoredToACompactWindow"), 'success')
  }, [commitPersistedChange, node.id, node.meta, requestCanvasFit, updateNode])

  const revealRowOutput = React.useCallback(
    async (row: StoryboardScriptRow, role: 'image' | 'video', openCapability = false) => {
      try {
        const result =
          role === 'image'
            ? ensureImageNodeForRow(row, { expanded: true })
            : await ensureVideoNodeForRow(row, { expanded: true })
        setWorkspaceMode('generation')
        setActiveCategoryId(result.node.categoryId || 'shots')
        selectNode(result.nodeId)
        const focusNode = () => {
          window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: result.nodeId } }))
          if (openCapability) openCapabilityRecipeInspector(result.nodeId)
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusNode)
        else window.setTimeout(focusNode, 0)
        toast(
          openCapability
            ? i18n.t("canvasComponents.openedCreativeCapabilitiesForShot", { v0: row.shot.index, v1: role === 'image' ? i18n.t("canvasComponents.image") : i18n.t("canvasComponents.video") })
            : i18n.t("canvasComponents.shotNodeExtractedChooseAModelAndParameters", { v0: row.shot.index, v1: role === 'image' ? i18n.t("canvasComponents.image") : i18n.t("canvasComponents.video") }),
          'success',
        )
      } catch (error: unknown) {
        toast(storyboardActionError(error, i18n.t("canvasComponents.failedToExtractTheGenerationNodeForShot", { v0: row.shot.index })), 'error')
      }
    },
    [ensureImageNodeForRow, ensureVideoNodeForRow, selectNode, setActiveCategoryId, setWorkspaceMode],
  )

  const generateTimedKeyframes = React.useCallback(
    async (row: StoryboardScriptRow) => {
      if (keyframeGeneratingShotIndex !== null) return
      setKeyframeGeneratingShotIndex(row.shot.index)
      try {
        const imageOutput = ensureImageNodeForRow(row)
        const result = ensureStoryboardRowKeyframes({
          tableNode: node,
          shot: row.shot,
          sourceImageNode: imageOutput.node,
        })
        const state = useGenerationCanvasStore.getState()
        const dependencyPlan = buildDependencyWaves(result.nodeIds, {
          nodes: state.nodes,
          edges: state.edges,
        })
        setWorkspaceMode('generation')
        setActiveCategoryId(imageOutput.node.categoryId || 'shots')
        selectNodes(result.nodeIds)
        requestCanvasFit()
        toast(
          result.createdCount
            ? i18n.t("canvasComponents.createdThe5SecondActionFrameAnd8SecondEnding", { v0: row.shot.index })
            : i18n.t("canvasComponents.the53SecondKeyframesForShotAlreadyExistAnd", { v0: row.shot.index }),
          'success',
        )
        await confirmAndRunPlan(dependencyPlan, { initiator: 'user' })
      } catch (error: unknown) {
        toast(storyboardActionError(error, i18n.t("canvasComponents.failedToGenerateKeyframesForShot", { v0: row.shot.index })), 'error')
      } finally {
        setKeyframeGeneratingShotIndex(null)
      }
    },
    [
      ensureImageNodeForRow,
      keyframeGeneratingShotIndex,
      node,
      requestCanvasFit,
      selectNodes,
      setActiveCategoryId,
      setWorkspaceMode,
    ],
  )

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line">
      <header
        className={cn(
          'shrink-0 flex min-h-9 min-w-0 flex-wrap items-center gap-1.5 border-b border-nomi-line-soft px-3',
          'cursor-grab select-none text-nomi-ink',
        )}
        aria-label={i18n.t("canvasComponents.dragTheStoryboardTableNode")}
      >
        <IconGripVertical size={14} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
        <span className="min-w-0 max-w-full text-label font-semibold [overflow-wrap:anywhere]">{plan?.title || node.title || i18n.t("canvasComponents.storyboardScript")}</span>
        {rows.length > 0 ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <WorkbenchButton
              type="button"
              variant="default"
              size="sm"
              className="h-7 justify-center"
              disabled={agentFilling}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                void autofillWithAgent(false)
              }}
            >
              <IconRobot size={14} stroke={1.8} />
              {i18n.t("canvasComponents.agentFill")}</WorkbenchButton>
            <WorkbenchButton
              type="button"
              variant="default"
              size="sm"
              className="h-7 w-7 justify-center p-0"
              aria-label={i18n.t("canvasComponents.containStoryboardGenerationNodes")}
              title={i18n.t("canvasComponents.containStoryboardGenerationNodes")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                containAllRowNodes()
              }}
            >
              <IconGripVertical size={14} stroke={1.8} />
            </WorkbenchButton>
            <WorkbenchButton
              type="button"
              variant="default"
              size="sm"
              className="h-7 w-7 justify-center p-0"
              aria-label={i18n.t("canvasComponents.restoreTheCompactStoryboardTableWindow")}
              title={i18n.t("canvasComponents.restoreCompactWindow")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                compactStoryboardTable()
              }}
            >
              <IconMinimize size={14} stroke={1.8} />
            </WorkbenchButton>
            <Menu withinPortal position="bottom-end" shadow="md">
              <Menu.Target>
                <WorkbenchButton
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-7 w-7 justify-center p-0"
                  aria-label={i18n.t("canvasComponents.moreScriptActions")}
                  title={i18n.t("canvasComponents.moreScriptActions")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <IconDotsVertical size={15} stroke={1.8} />
                </WorkbenchButton>
              </Menu.Target>
              <Menu.Dropdown onPointerDown={(event) => event.stopPropagation()}>
                <Menu.Item
                  leftSection={<IconRobot size={14} stroke={1.8} />}
                  disabled={agentFilling}
                  onClick={() => void autofillWithAgent(true)}
                >{i18n.t("canvasComponents.overwriteExistingContent")}</Menu.Item>
                <Menu.Item leftSection={<IconWand size={14} stroke={1.8} />} onClick={polishAllVideoPrompts}>{i18n.t("canvasComponents.polishAllVideoPrompts")}</Menu.Item>
                <Menu.Item leftSection={<IconMaximize size={14} stroke={1.8} />} onClick={fitStoryboardTable}>{i18n.t("canvasComponents.showAllShots")}</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        ) : null}
        <span className="text-micro text-nomi-ink-60">{i18n.t("canvasComponents.shots", { v0: rows.length })}</span>
      </header>

      <section
        ref={setMediaVisibilityRoot}
        className="min-h-0 flex-1 overflow-auto"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-small text-nomi-ink-40">{i18n.t("canvasComponents.noStoryboardDataYet")}</div>
        ) : (
          <div style={{ minWidth: STORYBOARD_TABLE_MIN_CONTENT_WIDTH }}>
            <div
              className="sticky top-0 z-[1] grid border-b border-nomi-line bg-nomi-paper text-micro font-semibold text-nomi-ink-60"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              {[i18n.t("canvasComponents.shot"), ...STORYBOARD_FIELD_GROUPS.map((group) => group.label), i18n.t("canvasComponents.image"), i18n.t("canvasComponents.video"), i18n.t("canvasComponents.generationSettings")].map(
                (label) => (
                  <div key={label} className="border-r border-nomi-line-soft px-2 py-2 last:border-r-0">
                    {label}
                  </div>
                ),
              )}
            </div>
            {rows.map((row) => {
              const isExpanded = expandedShotIndex === row.shot.index
              const commitField = (field: ShotTextField, value: string): void => {
                updateTextField(row.shot, field, value)
                commitPersistedChange()
              }
              const commitPrompt = (field: PromptField, value: string): void => {
                updatePromptField(row.shot, field, value)
                commitPersistedChange()
              }

              return (
                <div
                  key={row.shot.index}
                  data-storyboard-row={row.shot.index}
                  data-expanded={isExpanded ? 'true' : 'false'}
                  className={cn(
                    'grid border-b border-nomi-line-soft text-small last:border-b-0',
                    isExpanded ? 'min-h-[212px] bg-nomi-ink-05' : 'min-h-[92px]',
                  )}
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <div className="flex flex-col items-stretch gap-2 border-r border-nomi-line-soft px-2 py-2">
                    <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-micro font-semibold text-nomi-ink">{i18n.t("canvasComponents.shot112", { v0: row.shot.index })}</span>
                    {isExpanded ? (
                      <>
                        <label className="text-micro text-nomi-ink-40">{i18n.t("canvasComponents.durationSeconds")}</label>
                        <BufferedDurationInput
                          ariaLabel={i18n.t("canvasComponents.shotDuration", { v0: row.shot.index })}
                          value={row.shot.durationSec}
                          onCommit={(value) => {
                            updateDuration(row.shot, value)
                            commitPersistedChange()
                          }}
                        />
                      </>
                    ) : (
                      <span className="px-1 text-micro text-nomi-ink-60">{i18n.t("canvasComponents.seconds", { v0: row.shot.durationSec || 0 })}</span>
                    )}
                    <span
                      className={cn(
                        'rounded-nomi-sm px-2 py-1 text-center text-micro font-medium',
                        row.status === 'generated' && 'bg-workbench-success-soft text-workbench-success-ink',
                        row.status === 'running' && 'bg-nomi-accent-soft text-nomi-accent',
                        row.status === 'error' && 'bg-workbench-danger-soft text-workbench-danger',
                        row.status === 'pending' && 'bg-nomi-ink-05 text-nomi-ink-60',
                      )}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>
                  {STORYBOARD_FIELD_GROUPS.map((group) => (
                    <div key={group.label} className="border-r border-nomi-line-soft">
                      {isExpanded ? (
                        <GroupedFieldsCell row={row} fields={group.fields} onCommit={commitField} />
                      ) : (
                        <CompactFieldsCell row={row} fields={group.fields} />
                      )}
                    </div>
                  ))}
                  <div className="border-r border-nomi-line-soft">
                    {isExpanded ? (
                      <div className="px-1.5 py-2">
                        <TextCell
                          ariaLabel={i18n.t("canvasComponents.shotImagePrompt", { v0: row.shot.index })}
                          value={rowPromptValue(row.shot, 'imagePrompt')}
                          onCommit={(value) => commitPrompt('imagePrompt', value)}
                        />
                        <div className="mt-2 flex justify-center">
                          <StoryboardMediaPreview
                            node={row.imageNode}
                            type="image"
                            emptyLabel={i18n.t("canvasComponents.imageNotGenerated")}
                            visibilityRoot={mediaVisibilityRoot}
                          />
                        </div>
                      </div>
                    ) : (
                      <CompactPromptCell
                        prompt={rowPromptValue(row.shot, 'imagePrompt')}
                        node={row.imageNode}
                        type="image"
                        visibilityRoot={mediaVisibilityRoot}
                      />
                    )}
                  </div>
                  <div className="border-r border-nomi-line-soft">
                    {isExpanded ? (
                      <div className="px-1.5 py-2">
                        <TextCell
                          ariaLabel={i18n.t("canvasComponents.shotVideoPrompt", { v0: row.shot.index })}
                          value={rowPromptValue(row.shot, 'videoPrompt')}
                          onCommit={(value) => commitPrompt('videoPrompt', value)}
                        />
                        <div className="mt-2 flex justify-center">
                          <StoryboardMediaPreview
                            node={row.videoNode}
                            type="video"
                            emptyLabel={i18n.t("canvasComponents.videoNotGenerated")}
                            visibilityRoot={mediaVisibilityRoot}
                          />
                        </div>
                      </div>
                    ) : (
                      <CompactPromptCell
                        prompt={rowPromptValue(row.shot, 'videoPrompt')}
                        node={row.videoNode}
                        type="video"
                        visibilityRoot={mediaVisibilityRoot}
                      />
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-1.5 px-2 py-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1.5">
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center px-1.5"
                        aria-expanded={isExpanded}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          setExpandedShotIndex(isExpanded ? null : row.shot.index)
                        }}
                      >
                        {isExpanded ? <IconChevronUp size={14} stroke={1.8} /> : <IconPencil size={14} stroke={1.8} />}
                        {isExpanded ? i18n.t("canvasComponents.collapse") : i18n.t("canvasComponents.edit")}
                      </WorkbenchButton>
                      <Menu withinPortal position="bottom-end" shadow="md">
                        <Menu.Target>
                          <WorkbenchButton
                            type="button"
                            variant="default"
                            size="sm"
                            className="h-8 w-8 justify-center p-0"
                            aria-label={i18n.t("canvasComponents.openCreativeCapabilitiesForShot", { v0: row.shot.index })}
                            title={i18n.t("canvasComponents.continueCreatingFromThisShotSImageOrVideo")}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <IconSparkles size={14} stroke={1.8} />
                          </WorkbenchButton>
                        </Menu.Target>
                        <Menu.Dropdown onPointerDown={(event) => event.stopPropagation()}>
                          <Menu.Item
                            leftSection={<IconPhoto size={14} stroke={1.8} />}
                            onClick={() => void revealRowOutput(row, 'image', true)}
                          >{i18n.t("canvasComponents.continueFromImage")}</Menu.Item>
                          <Menu.Item
                            leftSection={<IconVideo size={14} stroke={1.8} />}
                            onClick={() => void revealRowOutput(row, 'video', true)}
                          >{i18n.t("canvasComponents.continueFromVideo")}</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center gap-1 px-1"
                        aria-label={i18n.t("canvasComponents.configureImageGenerationForShot", { v0: row.shot.index })}
                        title={i18n.t("canvasComponents.extractAnImageGenerationNodeAndConfigureItsModelParameters")}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void revealRowOutput(row, 'image')
                        }}
                      >
                        <IconPhoto size={14} stroke={1.8} />
                        <span className="text-micro">{i18n.t("canvasComponents.imageSettings")}</span>
                      </WorkbenchButton>
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center gap-1 px-1"
                        aria-label={i18n.t("canvasComponents.configureVideoGenerationForShot", { v0: row.shot.index })}
                        title={i18n.t("canvasComponents.extractAVideoGenerationNodeAndConfigureItsModelParameters")}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void revealRowOutput(row, 'video')
                        }}
                      >
                        <IconVideo size={14} stroke={1.8} />
                        <span className="text-micro">{i18n.t("canvasComponents.videoSettings")}</span>
                      </WorkbenchButton>
                    </div>
                    <WorkbenchButton
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-8 justify-center gap-1 px-1.5"
                      aria-label={i18n.t("canvasComponents.generate53SecondKeyframesForShot", { v0: row.shot.index })}
                      title={i18n.t("canvasComponents.useTheStoryboardReferenceAsThe0SecondFrameThen")}
                      disabled={keyframeGeneratingShotIndex !== null}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        void generateTimedKeyframes(row)
                      }}
                    >
                      <IconPhoto size={14} stroke={1.8} />
                      <span className="text-micro">
                        {keyframeGeneratingShotIndex === row.shot.index ? i18n.t("canvasComponents.generatingKeyframes") : i18n.t("canvasComponents.generate53Keyframes")}
                      </span>
                    </WorkbenchButton>
                    {isExpanded ? (
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center px-1.5"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          polishVideoPrompt(row)
                        }}
                      >
                        <IconWand size={14} stroke={1.8} />
                        {i18n.t("canvasComponents.polishVideoPrompt")}</WorkbenchButton>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

const StoryboardTableNode = React.memo(StoryboardTableNodeImpl, (prev, next) => prev.node === next.node)
StoryboardTableNode.displayName = 'StoryboardTableNode'
export default StoryboardTableNode
