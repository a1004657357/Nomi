import React from 'react'
import { IconArrowLeft, IconExternalLink, IconFileText, IconMovie, IconPhoto, IconPencil, IconVideo } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { toast } from '../../../ui/toast'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { buildDependencyWaves } from '../../generationCanvas/runner/dependencyWaves'
import { expandNodeIdsWithUngeneratedReferenceAncestors } from '../../generationCanvas/runner/referenceAncestors'
import { confirmAndRunPlan } from '../../generationCanvas/components/batchPlanPreview'
import { convertImageShotToVideo } from '../../generationCanvas/agent/convertShotToVideo'
import { storyboardShotImagePrompt, storyboardShotVideoPrompt } from '../../generationCanvas/agent/storyboardPlan'
import { buildStoryboardScriptRows, type StoryboardScriptRow } from './storyboardScriptViewModel'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'

const STATUS_LABEL: Record<StoryboardScriptRow['status'], string> = {
  generated: '已生成',
  running: '生成中',
  error: '失败',
  pending: '未生成',
}

const STATUS_CLASS: Record<StoryboardScriptRow['status'], string> = {
  generated: 'bg-workbench-success-soft text-workbench-success',
  running: 'bg-nomi-accent-soft text-nomi-accent',
  error: 'bg-workbench-danger-soft text-workbench-danger',
  pending: 'bg-nomi-ink-05 text-nomi-ink-50',
}

function formatParams(params: Record<string, unknown> | undefined): string {
  const entries = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

function ResultPreview({ row }: { row: StoryboardScriptRow }): JSX.Element {
  if (!row.primaryUrl) {
    return (
      <div className="w-full aspect-[16/9] rounded-nomi-sm border border-dashed border-nomi-line bg-nomi-ink-05 grid place-items-center text-nomi-ink-30">
        {row.videoNode ? <IconVideo size={28} stroke={1.4} /> : <IconPhoto size={28} stroke={1.4} />}
      </div>
    )
  }

  if (row.primaryType === 'video') {
    return (
      <video
        src={row.primaryUrl}
        className="w-full aspect-[16/9] rounded-nomi-sm border border-nomi-line bg-black object-cover"
        controls
        muted
        playsInline
      />
    )
  }

  return (
    <img
      src={row.primaryUrl}
      alt={`镜头 ${row.shot.index}`}
      loading="lazy"
      className="w-full aspect-[16/9] rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 object-cover"
    />
  )
}

export default function StoryboardScriptPanel(): JSX.Element | null {
  const plan = useWorkbenchStore((s) => s.storyboardPlan)
  const setStoryboardScriptOpen = useWorkbenchStore((s) => s.setStoryboardScriptOpen)
  const setStoryboardEditorOpen = useWorkbenchStore((s) => s.setStoryboardEditorOpen)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveCategoryId = useWorkbenchStore((s) => s.setActiveCategoryId)
  const setStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const nodes = useGenerationCanvasStore((s) => s.nodes)
  const edges = useGenerationCanvasStore((s) => s.edges)
  const selectNode = useGenerationCanvasStore((s) => s.selectNode)

  const effectiveRows = React.useMemo(
    () => buildStoryboardScriptRows(plan, nodes, edges),
    [edges, nodes, plan],
  )

  if (effectiveRows.length === 0) return null

  const generatedCount = effectiveRows.filter((row) => row.status === 'generated').length

  const locateNode = (row: StoryboardScriptRow) => {
    const target = row.primaryNode || row.imageNode || row.videoNode || row.nodes[0]
    if (!target) return
    setActiveCategoryId(target.categoryId || 'shots')
    selectNode(target.id)
    setWorkspaceMode('generation')
  }

  const updateShot = (row: StoryboardScriptRow, patch: Partial<StoryboardScriptRow['shot']>) => {
    if (!plan) return
    const pos = plan.shots.findIndex((shot) => shot.index === row.shot.index)
    if (pos < 0) return
    setStoryboardPlan({ ...plan, shots: plan.shots.map((shot, index) => (index === pos ? { ...shot, ...patch } : shot)) })
  }

  const runNodes = async (nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    const state = useGenerationCanvasStore.getState()
    const expandedIds = expandNodeIdsWithUngeneratedReferenceAncestors(nodeIds, { nodes: state.nodes, edges: state.edges })
    const plan = buildDependencyWaves(expandedIds, { nodes: state.nodes, edges: state.edges })
    await confirmAndRunPlan(plan)
  }

  const runKeyframe = async (row: StoryboardScriptRow) => {
    if (!row.imageNode) {
      toast('这一镜还没有关键帧图片节点，请先从方案落画布。', 'warning')
      return
    }
    await runNodes([row.imageNode.id])
  }

  const runVideo = async (row: StoryboardScriptRow) => {
    if (row.videoNode) {
      await runNodes([row.videoNode.id])
      return
    }
    if (!row.imageNode) {
      toast('这一镜还没有可作为首帧的图片节点。', 'warning')
      return
    }
    const { nodeId } = convertImageShotToVideo(row.imageNode)
    await runNodes([nodeId])
  }

  return (
    <section className="relative w-full h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] border border-workbench-border rounded-workbench bg-workbench-surface-solid shadow-workbench-md overflow-hidden">
      <header className="flex items-center justify-between gap-3 h-12 px-4 border-b border-nomi-line">
        <div className="flex items-center gap-2 min-w-0">
          <IconFileText size={16} stroke={1.5} className="text-nomi-ink-60 shrink-0" />
          <span className="min-w-0 truncate text-title font-medium text-nomi-ink">{plan?.title.trim() || '画布分镜脚本'}</span>
          <span className="shrink-0 text-micro text-nomi-ink-40 bg-nomi-ink-05 px-2 py-0.5 rounded-full">
            {effectiveRows.length} 镜 · {generatedCount} 已生成
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {plan ? (
            <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardEditorOpen(true)}>
              <IconPencil size={14} stroke={1.7} />
              编辑
            </WorkbenchButton>
          ) : null}
          <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardScriptOpen(false)}>
            <IconArrowLeft size={14} stroke={1.7} />
            返回文稿
          </WorkbenchButton>
        </div>
      </header>

      <div className="overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {effectiveRows.map((row) => {
            const params = formatParams(row.shot.params)
            const isVideoShot = (row.shot.shotKind ?? 'video') === 'video'
            return (
              <article key={row.shot.index} className="rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm overflow-hidden">
                <div className="grid grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 p-3 max-[760px]:grid-cols-1">
                  <div className="min-w-0">
                    <ResultPreview row={row} />
                    {row.references.length > 0 ? (
                      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        {row.references.slice(0, 6).map((ref) => (
                          <img
                            key={ref.nodeId}
                            src={ref.url}
                            title={ref.title}
                            alt={ref.title}
                            loading="lazy"
                            className="size-9 shrink-0 rounded-nomi-sm border border-nomi-line object-cover bg-nomi-ink-05"
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 size-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper grid place-items-center text-body-sm font-semibold tabular-nums">
                        {row.shot.index}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn('text-micro px-2 py-0.5 rounded-full leading-relaxed', STATUS_CLASS[row.status])}>
                            {STATUS_LABEL[row.status]}
                          </span>
                          <span className="text-micro px-2 py-0.5 rounded-full bg-nomi-ink-05 text-nomi-ink-50 leading-relaxed">
                            {isVideoShot ? <IconMovie size={11} stroke={1.8} className="inline mr-1 align-[-2px]" /> : <IconPhoto size={11} stroke={1.8} className="inline mr-1 align-[-2px]" />}
                            {isVideoShot ? `${row.shot.durationSec || 0}s` : '图片'}
                          </span>
                          {row.videoNode ? (
                            <span className="text-micro px-2 py-0.5 rounded-full bg-nomi-ink-05 text-nomi-ink-50 leading-relaxed">
                              <IconVideo size={11} stroke={1.8} className="inline mr-1 align-[-2px]" />
                              视频节点
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={row.nodes.length === 0}
                        onClick={() => locateNode(row)}
                        className="shrink-0 h-7 px-2.5 rounded-nomi-sm border border-nomi-line text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-ink hover:bg-nomi-ink-05 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        画布<IconExternalLink size={12} stroke={1.7} />
                      </button>
                    </div>

                    <div className="text-body-sm font-medium text-nomi-ink truncate">
                      {row.title}
                    </div>

                    <div className="grid gap-2">
                      <label className="grid gap-1">
                        <span className="text-micro text-nomi-ink-40">图片提示词</span>
                        <AutoGrowTextarea
                          value={storyboardShotImagePrompt(row.shot)}
                          onChange={(event) => updateShot(row, { imagePrompt: event.target.value, ...(row.shot.shotKind === 'image' ? { prompt: event.target.value } : {}) })}
                          aria-label={`镜头 ${row.shot.index} 图片提示词`}
                          className="px-2 py-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent"
                        />
                      </label>
                      {isVideoShot ? (
                        <label className="grid gap-1">
                          <span className="text-micro text-nomi-ink-40">视频生成提示词</span>
                          <AutoGrowTextarea
                            value={storyboardShotVideoPrompt(row.shot)}
                            onChange={(event) => updateShot(row, { videoPrompt: event.target.value, prompt: event.target.value })}
                            aria-label={`镜头 ${row.shot.index} 视频生成提示词`}
                            className="px-2 py-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent"
                          />
                        </label>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <WorkbenchButton variant="default" size="sm" disabled={!row.imageNode} onClick={() => void runKeyframe(row)}>
                        <IconPhoto size={13} stroke={1.7} />
                        生成关键帧
                      </WorkbenchButton>
                      <WorkbenchButton variant="default" size="sm" disabled={!row.imageNode && !row.videoNode} onClick={() => void runVideo(row)}>
                        <IconVideo size={13} stroke={1.7} />
                        生成视频
                      </WorkbenchButton>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {row.anchors.map((anchor) => (
                        <span key={anchor.id} className="h-6 px-2.5 rounded-full bg-nomi-ink-05 text-nomi-ink-60 text-caption inline-flex items-center">
                          {anchor.name || '未命名'}
                        </span>
                      ))}
                      {row.shot.modelKey ? (
                        <span className="h-6 px-2.5 rounded-full bg-nomi-ink-05 text-nomi-ink-40 text-caption inline-flex items-center">
                          {row.shot.modelKey}
                        </span>
                      ) : null}
                      {row.shot.modeId ? (
                        <span className="h-6 px-2.5 rounded-full bg-nomi-ink-05 text-nomi-ink-40 text-caption inline-flex items-center">
                          {row.shot.modeId}
                        </span>
                      ) : null}
                    </div>

                    {params ? (
                      <div className="text-caption text-nomi-ink-40 truncate">
                        {params}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
