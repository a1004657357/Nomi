import { useWorkbenchStore } from '../../workbenchStore'
import type { SkillListItemDto, SkillProviderKind } from '../../api/skillApi'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export const CANVAS_SKILL_DRAG_MIME = 'application/x-nomi-canvas-skill'

export type CanvasSkillStageSnapshot = {
  id: string
  goal: string
  tools: string[]
  pause: boolean
}

export type CanvasSkillInputSnapshot = {
  name: string
  description: string
  required: boolean
}

export type CanvasSkillNodeState = {
  version: 1
  skillKey: string
  label: string
  description: string
  tools: string[]
  inputs: CanvasSkillInputSnapshot[]
  stages: CanvasSkillStageSnapshot[]
  neededProviders: SkillProviderKind[]
  recipeIds: string[]
  defaultRecipeId: string | null
  outputNodeIds: string[]
  currentStageIndex: number
  runStatus: 'ready' | 'running' | 'awaiting-confirm' | 'done' | 'error'
  lastRunError?: string
  lastRecipeId?: string
  lastSourceNodeId?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function normalizeStage(value: unknown): CanvasSkillStageSnapshot | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.goal !== 'string') return null
  return {
    id: record.id,
    goal: record.goal,
    tools: stringArray(record.tools),
    pause: record.pause !== false,
  }
}

function normalizeInput(value: unknown): CanvasSkillInputSnapshot | null {
  const record = asRecord(value)
  if (!record || typeof record.name !== 'string' || typeof record.description !== 'string') return null
  return {
    name: record.name,
    description: record.description,
    required: record.required === true,
  }
}

export function isCanvasSkill(skill: Pick<SkillListItemDto, 'canvas'>): boolean {
  return skill.canvas !== null
}

export function buildCanvasSkillNodeState(skill: SkillListItemDto): CanvasSkillNodeState {
  return {
    version: 1,
    skillKey: skill.name,
    label: skill.label,
    description: skill.description ?? '',
    tools: [...skill.tools],
    inputs: skill.inputs.map((input) => ({
      name: input.name,
      description: input.description,
      required: input.required === true,
    })),
    stages: skill.stages.map((stage) => ({ ...stage, tools: [...stage.tools] })),
    neededProviders: [...skill.neededProviders],
    recipeIds: [...(skill.canvas?.recipeIds ?? [])],
    defaultRecipeId: skill.canvas?.defaultRecipeId ?? null,
    outputNodeIds: [],
    currentStageIndex: 0,
    runStatus: 'ready',
  }
}

export function readCanvasSkillNodeState(node: Pick<GenerationCanvasNode, 'kind' | 'meta'>): CanvasSkillNodeState | null {
  if (node.kind !== 'skill') return null
  const record = asRecord(node.meta?.canvasSkill)
  if (!record || record.version !== 1 || typeof record.skillKey !== 'string' || typeof record.label !== 'string') {
    return null
  }
  const providers = stringArray(record.neededProviders).filter(
    (kind): kind is SkillProviderKind => ['text', 'image', 'video', 'model3d'].includes(kind),
  )
  return {
    version: 1,
    skillKey: record.skillKey,
    label: record.label,
    description: typeof record.description === 'string' ? record.description : '',
    tools: stringArray(record.tools),
    inputs: Array.isArray(record.inputs)
      ? record.inputs.map(normalizeInput).filter((item): item is CanvasSkillInputSnapshot => item !== null)
      : [],
    stages: Array.isArray(record.stages)
      ? record.stages.map(normalizeStage).filter((stage): stage is CanvasSkillStageSnapshot => stage !== null)
      : [],
    neededProviders: providers,
    recipeIds: stringArray(record.recipeIds),
    defaultRecipeId: typeof record.defaultRecipeId === 'string' ? record.defaultRecipeId : null,
    outputNodeIds: stringArray(record.outputNodeIds),
    currentStageIndex: typeof record.currentStageIndex === 'number' && Number.isInteger(record.currentStageIndex)
      ? Math.max(0, Math.min(record.currentStageIndex, Math.max(0, (Array.isArray(record.stages) ? record.stages.length : 0) - 1)))
      : 0,
    runStatus: ['ready', 'running', 'awaiting-confirm', 'done', 'error'].includes(String(record.runStatus))
      ? record.runStatus as CanvasSkillNodeState['runStatus']
      : 'ready',
    ...(typeof record.lastRunError === 'string' ? { lastRunError: record.lastRunError } : {}),
    ...(typeof record.lastRecipeId === 'string' ? { lastRecipeId: record.lastRecipeId } : {}),
    ...(typeof record.lastSourceNodeId === 'string' ? { lastSourceNodeId: record.lastSourceNodeId } : {}),
  }
}

export type CanvasSkillStageRun = CanvasSkillStageSnapshot & { index: number; total: number }

function updateCanvasSkillRuntime(
  nodeId: string,
  update: (state: CanvasSkillNodeState) => CanvasSkillNodeState | null,
): CanvasSkillNodeState | null {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  const state = node ? readCanvasSkillNodeState(node) : null
  if (!node || !state) return null
  const next = update(state)
  if (!next) return null
  store.updateNode(nodeId, { meta: { ...(node.meta || {}), canvasSkill: next } })
  return next
}

/** Mark the current playbook stage as running and return the exact stage sent to the backend. */
export function beginCanvasSkillStage(nodeId: string): CanvasSkillStageRun | null {
  let selected: CanvasSkillStageRun | null = null
  updateCanvasSkillRuntime(nodeId, (state) => {
    if (!state.stages.length || state.runStatus === 'running') return null
    const index = state.runStatus === 'done' ? 0 : Math.min(state.currentStageIndex, state.stages.length - 1)
    selected = { ...state.stages[index], index, total: state.stages.length }
    return { ...state, currentStageIndex: index, runStatus: 'running', lastRunError: undefined }
  })
  return selected
}

export type CanvasSkillHarnessStage = {
  stageId: string
  index: number
  total: number
  pause: boolean
  nextStageId: string | null
}

/** Backend manifest resolution is authoritative for the stage currently exposed to the model. */
export function syncCanvasSkillStageFromHarness(nodeId: string, stage: CanvasSkillHarnessStage): boolean {
  let synced = false
  updateCanvasSkillRuntime(nodeId, (state) => {
    const declared = state.stages[stage.index]
    if (!declared || declared.id !== stage.stageId || stage.total !== state.stages.length) return null
    synced = true
    if (state.currentStageIndex === stage.index && state.runStatus === 'running') return null
    return {
      ...state,
      currentStageIndex: stage.index,
      runStatus: 'running',
      lastRunError: undefined,
    }
  })
  return synced
}

/** Complete only the stage that is still current; stale responses cannot advance a newer run. */
export function completeCanvasSkillStage(
  nodeId: string,
  stageId: string,
  harness?: CanvasSkillHarnessStage,
): boolean {
  let completed = false
  updateCanvasSkillRuntime(nodeId, (state) => {
    const current = state.stages[state.currentStageIndex]
    if (!current || current.id !== stageId || state.runStatus !== 'running') return null
    if (harness && (
      harness.stageId !== stageId
      || harness.index !== state.currentStageIndex
      || harness.total !== state.stages.length
    )) return null
    completed = true
    const isLast = harness ? harness.nextStageId === null : state.currentStageIndex >= state.stages.length - 1
    const pause = harness?.pause ?? current.pause
    return {
      ...state,
      currentStageIndex: isLast ? state.currentStageIndex : state.currentStageIndex + 1,
      runStatus: isLast ? 'done' : pause ? 'awaiting-confirm' : 'ready',
      lastRunError: undefined,
    }
  })
  return completed
}

export function failCanvasSkillStage(nodeId: string, stageId: string, message: string): boolean {
  let failed = false
  updateCanvasSkillRuntime(nodeId, (state) => {
    const current = state.stages[state.currentStageIndex]
    if (!current || current.id !== stageId || state.runStatus !== 'running') return null
    failed = true
    return { ...state, runStatus: 'error', lastRunError: message }
  })
  return failed
}

export function encodeCanvasSkillDrag(skill: SkillListItemDto): string {
  return JSON.stringify(skill)
}

export function parseCanvasSkillDrag(raw: string): SkillListItemDto | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    const record = asRecord(value)
    const canvas = asRecord(record?.canvas)
    if (!record || !canvas || typeof record.name !== 'string' || typeof record.label !== 'string') return null
    if (!Array.isArray(record.tools) || !Array.isArray(record.stages) || !Array.isArray(record.neededProviders)) return null
    return value as SkillListItemDto
  } catch {
    return null
  }
}

export function defaultCanvasSkillPosition(): { x: number; y: number } {
  const viewport = useWorkbenchStore.getState().categoryViewports[useWorkbenchStore.getState().activeCategoryId]
  const canvasOffset = viewport?.offset ?? { x: 0, y: 0 }
  const canvasZoom = viewport?.zoom ?? 1
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth
  const height = typeof window === 'undefined' ? 800 : window.innerHeight
  return {
    x: Math.max(40, Math.round((width * 0.5 - canvasOffset.x) / canvasZoom - 190)),
    y: Math.max(40, Math.round((height * 0.44 - canvasOffset.y) / canvasZoom - 180)),
  }
}

export function addCanvasSkillNode(
  skill: SkillListItemDto,
  position = defaultCanvasSkillPosition(),
  categoryId = 'shots',
): GenerationCanvasNode | null {
  if (!isCanvasSkill(skill)) return null
  return useGenerationCanvasStore.getState().addNode({
    kind: 'skill',
    title: skill.label,
    prompt: skill.description ?? '',
    position,
    categoryId,
    size: { width: 380, height: 360 },
    meta: { canvasSkill: buildCanvasSkillNodeState(skill) },
  })
}

export function focusCanvasSkillNode(nodeId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId } }))
}

export function recordCanvasSkillOutput(input: {
  skillNodeId: string
  outputNodeId: string
  recipeId: string
  sourceNodeId: string
}): void {
  const store = useGenerationCanvasStore.getState()
  const skillNode = store.nodes.find((node) => node.id === input.skillNodeId)
  const state = skillNode ? readCanvasSkillNodeState(skillNode) : null
  if (!skillNode || !state) return
  const outputNodeIds = [...state.outputNodeIds.filter((id) => id !== input.outputNodeId), input.outputNodeId].slice(-12)
  store.updateNode(skillNode.id, {
    meta: {
      ...(skillNode.meta || {}),
      canvasSkill: {
        ...state,
        outputNodeIds,
        lastRecipeId: input.recipeId,
        lastSourceNodeId: input.sourceNodeId,
      },
    },
  })
}
