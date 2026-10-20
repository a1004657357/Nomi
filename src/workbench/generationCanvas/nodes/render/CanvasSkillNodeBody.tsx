import type { JSX } from 'react'
import React from 'react'
import {
  IconAlertCircle,
  IconArrowRight,
  IconBox,
  IconBoxMultiple,
  IconCheck,
  IconPanoramaHorizontal,
  IconPhoto,
  IconRobot,
  IconRoute,
  IconSettings,
  IconVideo,
} from '@tabler/icons-react'
import { BUILTIN_CAPABILITY_RECIPES, type CapabilityRecipe } from '../../../../config/capabilityRecipes'
import { cn } from '../../../../utils/cn'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { openCapabilityRecipeInspector } from '../../components/capabilityRecipeEvents'
import {
  beginCanvasSkillStage,
  focusCanvasSkillNode,
  readCanvasSkillNodeState,
} from '../../skills/canvasSkillModel'
import { requestCanvasSkillAgent } from '../../skills/canvasSkillEvents'
import { resolveCanvasSkillRecipeBinding } from '../../skills/canvasSkillRecipeBinding'
import {
  canvasSkillComponentPresentation,
  type CanvasSkillComponentKind,
} from '../../../skillLibrary/skillComponentPresentation'

const COMPONENT_ICONS = {
  image: IconPhoto,
  video: IconVideo,
  scene: IconPanoramaHorizontal,
  multiview: IconBoxMultiple,
  model3d: IconBox,
  workflow: IconRoute,
} satisfies Record<CanvasSkillComponentKind, typeof IconPhoto>

function recipeSourceKind(recipe: CapabilityRecipe): 'image' | 'video' | 'model3d' | null {
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_video' && slot.min > 0)) return 'video'
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_model3d' && slot.min > 0)) return 'model3d'
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_image' && slot.min > 0)) return 'image'
  return null
}

function sourceKindIcon(kind: ReturnType<typeof recipeSourceKind>): JSX.Element {
  return kind === 'video'
    ? <IconVideo size={13} stroke={1.8} aria-hidden />
    : kind === 'model3d'
      ? <IconBox size={13} stroke={1.8} aria-hidden />
    : <IconPhoto size={13} stroke={1.8} aria-hidden />
}

export default function CanvasSkillNodeBody({
  node,
  readOnly = false,
}: {
  node: GenerationCanvasNode
  readOnly?: boolean
}): JSX.Element {
  const state = readCanvasSkillNodeState(node)
  const nodes = useGenerationCanvasStore((store) => store.nodes)
  const edges = useGenerationCanvasStore((store) => store.edges)
  const incomingIds = React.useMemo(
    () => edges.filter((edge) => edge.target === node.id).map((edge) => edge.source),
    [edges, node.id],
  )
  const connectedNodes = React.useMemo(
    () => incomingIds.map((id) => nodes.find((candidate) => candidate.id === id)).filter(
      (candidate): candidate is GenerationCanvasNode => Boolean(candidate),
    ),
    [incomingIds, nodes],
  )
  const recipes = React.useMemo(
    () => (state?.recipeIds ?? [])
      .map((id) => BUILTIN_CAPABILITY_RECIPES.find((recipe) => recipe.id === id))
      .filter((recipe): recipe is CapabilityRecipe => Boolean(recipe)),
    [state?.recipeIds],
  )
  const outputNodes = (state?.outputNodeIds ?? [])
    .map((id) => nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is GenerationCanvasNode => Boolean(candidate))
  const directRecipeAction = recipes.length === 1

  if (!state) {
    return (
      <div className="grid h-full place-items-center bg-nomi-paper p-5 text-center text-caption text-workbench-danger">
        技能节点数据已损坏，请从技能库重新放入。
      </div>
    )
  }

  const component = canvasSkillComponentPresentation({
    name: state.skillKey,
    canvas: { recipeIds: state.recipeIds, defaultRecipeId: state.defaultRecipeId },
    neededProviders: state.neededProviders,
  })
  const ComponentIcon = COMPONENT_ICONS[component.kind]
  const requiredSourceKinds = Array.from(new Set(
    recipes
      .map(recipeSourceKind)
      .filter((kind): kind is 'image' | 'video' | 'model3d' => kind !== null),
  ))
  const sourceHint = requiredSourceKinds.length
    ? `${requiredSourceKinds.map((kind) => (
      kind === 'video' ? '视频' : kind === 'model3d' ? '3D' : '图片'
    )).join(' / ')}输入`
    : '素材输入'

  const launchRecipe = (recipe: CapabilityRecipe): void => {
    const binding = resolveCanvasSkillRecipeBinding(recipe, connectedNodes)
    if (!binding.ready || !binding.source) return
    openCapabilityRecipeInspector(binding.source.id, {
      recipeId: recipe.id,
      skillNodeId: node.id,
      resourceIds: binding.resources.map((resource) => resource.id),
    })
  }

  const launchAgent = (): void => {
    const stage = state.stages.length ? beginCanvasSkillStage(node.id) : null
    if (state.stages.length && !stage) return
    requestCanvasSkillAgent({
      skill: { skillKey: state.skillKey, label: state.label },
      sourceNodeIds: connectedNodes.map((candidate) => candidate.id),
      skillNodeId: node.id,
      ...(stage ? { stage } : {}),
    })
  }

  return (
    <div
      data-canvas-skill-node="true"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-nomi-paper px-4 pb-3 pt-4 text-nomi-ink"
    >
      <div className="flex min-w-0 items-start gap-2 border-b border-nomi-line pb-3">
        <span className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
          <ComponentIcon size={17} stroke={1.8} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm font-semibold">{state.label}</div>
          <div className="mt-0.5 line-clamp-2 text-caption leading-relaxed text-nomi-ink-60">
            {state.description || '画布工作流技能'}
          </div>
          <div className="mt-1 text-micro text-nomi-accent">{component.label}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-nomi-line py-2 text-caption">
        {connectedNodes.length ? (
          <>
            <IconCheck size={14} stroke={2} className="text-workbench-success" aria-hidden />
            <span className="min-w-0 flex-1 truncate">已连接 {connectedNodes.length} 个输入</span>
          </>
        ) : (
          <>
            <IconAlertCircle size={14} stroke={1.8} className="text-nomi-ink-40" aria-hidden />
            <span className="min-w-0 flex-1 text-nomi-ink-60">等待连接{sourceHint}</span>
          </>
        )}
        {state.neededProviders.length ? (
          <span className="shrink-0 text-micro text-nomi-ink-40">{state.neededProviders.join(' / ')}</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {recipes.length ? (
          <div className="grid gap-1.5">
            {recipes.map((recipe) => {
              const sourceKind = recipeSourceKind(recipe)
              const binding = resolveCanvasSkillRecipeBinding(recipe, connectedNodes)
              return (
                <button
                  key={recipe.id}
                  type="button"
                  aria-label={directRecipeAction ? `配置并运行 ${recipe.label}` : recipe.label}
                  data-recipe-ready={binding.ready ? 'true' : 'false'}
                  disabled={readOnly || !binding.ready}
                  className={cn(
                    'flex min-h-9 w-full items-center gap-2 rounded-nomi-sm border border-nomi-line px-2.5 text-left text-caption',
                    'bg-nomi-paper transition-colors hover:border-nomi-accent hover:text-nomi-accent',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    state.defaultRecipeId === recipe.id && 'border-nomi-accent/40 bg-nomi-accent-soft/40',
                  )}
                  title={binding.ready ? `配置并运行 ${recipe.label}` : binding.statusLabel}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    launchRecipe(recipe)
                  }}
                >
                  {sourceKindIcon(sourceKind)}
                  <span className="min-w-0 flex-1 truncate">
                    {directRecipeAction ? '配置并运行' : recipe.label}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-micro',
                      binding.ready ? 'text-workbench-success' : 'text-nomi-ink-40',
                    )}
                  >
                    {binding.statusLabel}
                  </span>
                  <IconSettings size={14} stroke={1.7} aria-hidden />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {state.stages.slice(0, 4).map((stage, index) => (
              <div
                key={stage.id}
                className={cn(
                  'flex items-start gap-2 rounded-nomi-sm px-2.5 py-2 text-caption',
                  index === state.currentStageIndex && state.runStatus !== 'done'
                    ? 'bg-nomi-accent-soft text-nomi-accent'
                    : 'bg-nomi-ink-05',
                )}
              >
                <span className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-nomi-paper text-micro text-nomi-ink-60">
                  {index < state.currentStageIndex || state.runStatus === 'done' ? <IconCheck size={12} stroke={2} /> : index + 1}
                </span>
                <span className="line-clamp-2 leading-relaxed text-nomi-ink-70">{stage.goal}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {outputNodes.length ? (
        <div className="flex items-center gap-1 border-t border-nomi-line py-2">
          <span className="mr-1 text-micro text-nomi-ink-40">最近输出</span>
          {outputNodes.slice(-3).map((output) => (
            <button
              key={output.id}
              type="button"
              className="min-w-0 max-w-[90px] truncate rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-micro text-nomi-ink-60 hover:text-nomi-accent"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                focusCanvasSkillNode(output.id)
              }}
            >
              {output.title}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        disabled={readOnly || state.runStatus === 'running'}
        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-nomi-sm border-0 bg-nomi-ink px-3 text-caption font-medium text-nomi-paper hover:bg-nomi-accent disabled:opacity-40"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          launchAgent()
        }}
      >
        <IconRobot size={15} stroke={1.8} aria-hidden />
        {state.runStatus === 'running'
          ? 'Agent 执行中'
          : state.runStatus === 'awaiting-confirm'
            ? `确认并继续 · ${state.currentStageIndex + 1}/${state.stages.length}`
            : state.runStatus === 'done'
              ? '重新运行 Playbook'
              : state.runStatus === 'error'
                ? '重试当前阶段'
                : state.stages.length
                  ? `开始 · 1/${state.stages.length}`
                  : '用 Agent 推进'}
        <IconArrowRight size={14} stroke={1.8} aria-hidden />
      </button>
    </div>
  )
}
