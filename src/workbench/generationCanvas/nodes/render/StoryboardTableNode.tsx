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
  IconVideo,
  IconWand,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { WorkbenchButton } from '../../../../design'
import { useWorkbenchStore } from '../../../workbenchStore'
import {
  buildStoryboardScriptRows,
  generationResultUrl,
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
import {
  isStoryboardContainedNodeExpanded,
  withStoryboardContainedMeta,
} from '../../model/storyboardContainedNodes'
import {
  STORYBOARD_TABLE_DEFAULT_SIZE,
  STORYBOARD_TABLE_MIN_CONTENT_WIDTH,
  storyboardTableFitSize,
  storyboardTableSizePatch,
} from '../../model/storyboardTableSizing'
import { runStoryboardTableAutofill } from '../../agent/storyboardTableAutofill'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  ensureStoryboardRowImageOutput,
  ensureStoryboardRowVideoOutput,
  storyboardRowOutputPosition,
} from './storyboardRowOutputs'
import { StoryboardImagePreview } from './StoryboardImagePreview'
import { StoryboardVideoPreview } from './StoryboardVideoPreview'

type Props = {
  node: GenerationCanvasNode
}

type ShotTextField = Extract<
  keyof PlanShot,
  | 'scene'
  | 'shotSize'
  | 'cameraAngle'
  | 'cameraMove'
  | 'characters'
  | 'performance'
  | 'dialogue'
  | 'props'
  | 'sound'
  | 'notes'
>

type PromptField = Extract<keyof PlanShot, 'imagePrompt' | 'videoPrompt'>

type EnsureRowMediaOptions = {
  expanded?: boolean
}

const FIELD_LABEL: Record<ShotTextField, string> = {
  scene: '场景',
  shotSize: '景别',
  cameraAngle: '机位',
  cameraMove: '运镜',
  characters: '角色',
  performance: '表演',
  dialogue: '对白',
  props: '道具',
  sound: '音乐/音效',
  notes: '备注',
}

const FIELD_GROUPS: Array<{ label: string; fields: ShotTextField[] }> = [
  { label: '画面', fields: ['scene', 'props', 'notes'] },
  { label: '摄影', fields: ['shotSize', 'cameraAngle', 'cameraMove'] },
  { label: '角色/表演', fields: ['characters', 'performance'] },
  { label: '对白/声音', fields: ['dialogue', 'sound'] },
]

const GRID_COLUMNS = [
  '88px',
  '160px',
  '150px',
  '170px',
  '160px',
  '220px',
  '220px',
  '152px',
].join(' ')

const STATUS_LABEL: Record<StoryboardScriptRow['status'], string> = {
  generated: '已生成',
  running: '生成中',
  error: '失败',
  pending: '待生成',
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
      onFocus={() => { focused.current = true }}
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

function TextCell({
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

function BufferedDurationInput({
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

function GroupedFieldsCell({
  row,
  fields,
  onCommit,
}: {
  row: StoryboardScriptRow
  fields: ShotTextField[]
  onCommit: (field: ShotTextField, value: string) => void
}): JSX.Element {
  return (
    <div className="space-y-1.5 px-1.5 py-2">
      {fields.map((field) => (
        <label key={field} className="block">
          <span className="mb-0.5 block text-micro font-medium text-nomi-ink-40">{FIELD_LABEL[field]}</span>
          <BufferedTextarea
            ariaLabel={`镜头 ${row.shot.index} ${FIELD_LABEL[field]}`}
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
  if (node.status === 'queued' || node.status === 'running') return '生成中'
  if (node.status === 'error') return '失败'
  if (node.status === 'recoverable') return '待取回'
  if (node.status === 'success') return '已生成'
  return '待生成'
}

function storyboardActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
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
  if (!node?.result) {
    return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
  }
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
    if (!videoUrl) {
      return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
    }
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
  if (!imageUrl) {
    return <span className="text-micro text-nomi-ink-40">{nodeStatusLabel(node, emptyLabel)}</span>
  }
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

function CompactFieldsCell({ row, fields }: { row: StoryboardScriptRow; fields: ShotTextField[] }): JSX.Element {
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

function CompactPromptCell({
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
  return (
    <div className="flex h-full items-center gap-2 px-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 text-caption leading-[1.45] text-nomi-ink-60">{prompt || '—'}</p>
      </div>
      <div className="flex h-[72px] w-[76px] shrink-0 items-center justify-center">
        <StoryboardMediaPreview
          node={node}
          type={type}
          emptyLabel={type === 'image' ? '待生成图' : '待生成视频'}
          compact
          visibilityRoot={visibilityRoot}
        />
      </div>
    </div>
  )
}

function StoryboardTableNodeImpl({ node }: Props): JSX.Element {
  const workbenchPlan = useWorkbenchStore((state) => state.storyboardPlan)
  const setStoryboardPlan = useWorkbenchStore((state) => state.setStoryboardPlan)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const requestCanvasFit = useWorkbenchStore((state) => state.requestCanvasFit)
  const nodes = useGenerationCanvasStore(useShallow((state) => {
    const shotNodeIds = new Set(state.nodes.filter(isShotNumberedNode).map((candidate) => candidate.id))
    const referenceNodeIds = new Set(
      state.edges.filter((edge) => shotNodeIds.has(edge.target)).map((edge) => edge.source),
    )
    return state.nodes.filter((candidate) => shotNodeIds.has(candidate.id) || referenceNodeIds.has(candidate.id))
  }))
  const edges = useGenerationCanvasStore(useShallow((state) => {
    const shotNodeIds = new Set(state.nodes.filter(isShotNumberedNode).map((candidate) => candidate.id))
    return state.edges.filter((edge) => shotNodeIds.has(edge.target))
  }))
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const updateNodePrompt = useGenerationCanvasStore((state) => state.updateNodePrompt)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const [agentFilling, setAgentFilling] = React.useState(false)
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
      updateNode(
        node.id,
        { meta: { ...(node.meta || {}), storyboardPlanSnapshot: nextPlan } },
        { persist: false },
      )
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
      toast(`镜头 ${row.shot.index} 视频提示词已润色`, 'success')
    },
    [commitPersistedChange, replaceShot, updateNodePrompt],
  )

  const polishAllVideoPrompts = React.useCallback(() => {
    if (!plan || rows.length === 0) return
    const promptByShotIndex = new Map(rows.map((row) => [row.shot.index, buildDetailedStoryboardShotVideoPrompt(row.shot)]))
    const nextPlan: StoryboardPlan = {
      ...plan,
      shots: plan.shots.map((shot) => {
        const prompt = promptByShotIndex.get(shot.index)
        return prompt ? { ...shot, ...videoPromptPatch(shot, prompt) } : shot
      }),
    }
    setStoryboardPlan(nextPlan)
    updateNode(
      node.id,
      { meta: { ...(node.meta || {}), storyboardPlanSnapshot: nextPlan } },
      { persist: false },
    )
    for (const row of rows) {
      const prompt = promptByShotIndex.get(row.shot.index)
      if (prompt && row.videoNode) updateNodePrompt(row.videoNode.id, prompt)
    }
    commitPersistedChange()
    toast(`已润色 ${promptByShotIndex.size} 个视频提示词`, 'success')
  }, [commitPersistedChange, node.id, node.meta, plan, rows, setStoryboardPlan, updateNode, updateNodePrompt])

  const autofillWithAgent = React.useCallback(async (overwriteExisting: boolean) => {
    if (!plan || agentFilling) return
    setAgentFilling(true)
    try {
      const result = await runStoryboardTableAutofill({ plan, overwriteExisting })
      toast(`Agent 已填写 ${result.updatedShotCount} 个镜头`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Agent 填表失败', 'error')
    } finally {
      setAgentFilling(false)
    }
  }, [agentFilling, plan])

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
    (row: StoryboardScriptRow, options: EnsureRowMediaOptions = {}): { nodeId: string; node: GenerationCanvasNode; created: boolean } => {
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
    async (row: StoryboardScriptRow, options: EnsureRowMediaOptions = {}): Promise<{ nodeId: string; node: GenerationCanvasNode; existed: boolean; imageCreated: boolean }> => {
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
    toast(count ? `已收纳 ${count} 个分镜生成节点` : '当前没有可收纳的分镜生成节点', count ? 'success' : 'info')
  }, [containNodeForRow, requestCanvasFit, rows])

  const fitStoryboardTable = React.useCallback(() => {
    const size = storyboardTableFitSize(rows.length, expandedShotIndex !== null)
    updateNode(node.id, storyboardTableSizePatch(node.meta, size))
    commitPersistedChange()
    requestCanvasFit()
    toast('分镜表已适配当前行列', 'success')
  }, [commitPersistedChange, expandedShotIndex, node.id, node.meta, requestCanvasFit, rows.length, updateNode])

  const compactStoryboardTable = React.useCallback(() => {
    const size = { ...STORYBOARD_TABLE_DEFAULT_SIZE }
    updateNode(node.id, storyboardTableSizePatch(node.meta, size))
    commitPersistedChange()
    requestCanvasFit()
    toast('分镜表已恢复紧凑窗口', 'success')
  }, [commitPersistedChange, node.id, node.meta, requestCanvasFit, updateNode])

  const revealRowOutput = React.useCallback(
    async (row: StoryboardScriptRow, role: 'image' | 'video') => {
      try {
        const result = role === 'image'
          ? ensureImageNodeForRow(row, { expanded: true })
          : await ensureVideoNodeForRow(row, { expanded: true })
        setWorkspaceMode('generation')
        setActiveCategoryId(result.node.categoryId || 'shots')
        selectNode(result.nodeId)
        const focusNode = () => {
          window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: result.nodeId } }))
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusNode)
        else window.setTimeout(focusNode, 0)
        toast(`镜头 ${row.shot.index} 的${role === 'image' ? '图片' : '视频'}节点已提取，可选择模型和参数`, 'success')
      } catch (error: unknown) {
        toast(storyboardActionError(error, `镜头 ${row.shot.index} 生成节点提取失败`), 'error')
      }
    },
    [ensureImageNodeForRow, ensureVideoNodeForRow, selectNode, setActiveCategoryId, setWorkspaceMode],
  )

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line">
      <header
        className={cn(
          'shrink-0 flex h-9 items-center gap-2 border-b border-nomi-line-soft px-3',
          'cursor-grab select-none text-nomi-ink',
        )}
        aria-label="拖动分镜表节点"
      >
        <IconGripVertical size={14} stroke={1.8} className="text-nomi-ink-40" aria-hidden="true" />
        <span className="text-label font-semibold">{plan?.title || node.title || '分镜头脚本'}</span>
        {rows.length > 0 ? (
          <div className="ml-auto flex items-center gap-1.5">
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
              Agent补表
            </WorkbenchButton>
            <WorkbenchButton
              type="button"
              variant="default"
              size="sm"
              className="h-7 w-7 justify-center p-0"
              aria-label="收纳分镜生成节点"
              title="收纳分镜生成节点"
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
              aria-label="恢复分镜表紧凑窗口"
              title="恢复紧凑窗口"
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
                  aria-label="更多脚本操作"
                  title="更多脚本操作"
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
                >
                  覆盖填写已有内容
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconWand size={14} stroke={1.8} />}
                  onClick={polishAllVideoPrompts}
                >
                  润色全部视频提示词
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconMaximize size={14} stroke={1.8} />}
                  onClick={fitStoryboardTable}
                >
                  显示全部镜头
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        ) : null}
        <span className="text-micro text-nomi-ink-50">{rows.length} 镜</span>
      </header>

      <section
        ref={setMediaVisibilityRoot}
        className="min-h-0 flex-1 overflow-auto"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-small text-nomi-ink-40">暂无分镜数据</div>
        ) : (
          <div style={{ minWidth: STORYBOARD_TABLE_MIN_CONTENT_WIDTH }}>
            <div
              className="sticky top-0 z-[1] grid border-b border-nomi-line bg-nomi-paper text-micro font-semibold text-nomi-ink-50"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              {['镜头', ...FIELD_GROUPS.map((group) => group.label), '图片', '视频', '生成设置'].map((label) => (
                <div key={label} className="border-r border-nomi-line-soft px-2 py-2 last:border-r-0">
                  {label}
                </div>
              ))}
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
                    isExpanded ? 'min-h-[212px] bg-nomi-ink-02' : 'min-h-[92px]',
                  )}
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <div className="flex flex-col items-stretch gap-2 border-r border-nomi-line-soft px-2 py-2">
                    <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-micro font-semibold text-nomi-ink">
                      镜头 {row.shot.index}
                    </span>
                    {isExpanded ? (
                      <>
                        <label className="text-micro text-nomi-ink-40">时长（秒）</label>
                        <BufferedDurationInput
                          ariaLabel={`镜头 ${row.shot.index} 时长`}
                          value={row.shot.durationSec}
                          onCommit={(value) => {
                            updateDuration(row.shot, value)
                            commitPersistedChange()
                          }}
                        />
                      </>
                    ) : (
                      <span className="px-1 text-micro text-nomi-ink-50">{row.shot.durationSec || 0} 秒</span>
                    )}
                    <span
                      className={cn(
                        'rounded-nomi-sm px-2 py-1 text-center text-micro font-medium',
                        row.status === 'generated' && 'bg-workbench-success-soft text-workbench-success-ink',
                        row.status === 'running' && 'bg-nomi-accent-soft text-nomi-accent',
                        row.status === 'error' && 'bg-workbench-danger-soft text-workbench-danger',
                        row.status === 'pending' && 'bg-nomi-ink-05 text-nomi-ink-50',
                      )}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>
                  {FIELD_GROUPS.map((group) => (
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
                          ariaLabel={`镜头 ${row.shot.index} 图片提示词`}
                          value={rowPromptValue(row.shot, 'imagePrompt')}
                          onCommit={(value) => commitPrompt('imagePrompt', value)}
                        />
                        <div className="mt-2 flex justify-center">
                          <StoryboardMediaPreview
                            node={row.imageNode}
                            type="image"
                            emptyLabel="待生成图"
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
                          ariaLabel={`镜头 ${row.shot.index} 视频提示词`}
                          value={rowPromptValue(row.shot, 'videoPrompt')}
                          onCommit={(value) => commitPrompt('videoPrompt', value)}
                        />
                        <div className="mt-2 flex justify-center">
                          <StoryboardMediaPreview
                            node={row.videoNode}
                            type="video"
                            emptyLabel="待生成视频"
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
                      {isExpanded ? '收起' : '编辑'}
                    </WorkbenchButton>
                    <div className="grid grid-cols-2 gap-1.5">
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center gap-1 px-1"
                        aria-label={`配置镜头 ${row.shot.index} 图片生成`}
                        title="提取图片生成节点并设置模型参数"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void revealRowOutput(row, 'image')
                        }}
                      >
                        <IconPhoto size={14} stroke={1.8} />
                        <span className="text-micro">图片设置</span>
                      </WorkbenchButton>
                      <WorkbenchButton
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 justify-center gap-1 px-1"
                        aria-label={`配置镜头 ${row.shot.index} 视频生成`}
                        title="提取视频生成节点并设置模型参数"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void revealRowOutput(row, 'video')
                        }}
                      >
                        <IconVideo size={14} stroke={1.8} />
                        <span className="text-micro">视频设置</span>
                      </WorkbenchButton>
                    </div>
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
                        润色视频词
                      </WorkbenchButton>
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
