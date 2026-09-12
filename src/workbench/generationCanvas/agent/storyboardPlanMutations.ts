import {
  buildDetailedStoryboardShotVideoPrompt,
  storyboardPlanToCreateNodesArgs,
  storyboardShotVideoPrompt,
  type PlanShot,
  type StoryboardPlan,
} from './storyboardPlan'
import { buildStoryboardScriptRows } from '../../creation/storyboard/storyboardScriptViewModel'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const STORYBOARD_SHOT_TEXT_FIELDS = [
  'scene',
  'shotSize',
  'cameraAngle',
  'cameraMove',
  'characters',
  'performance',
  'dialogue',
  'props',
  'sound',
  'notes',
] as const satisfies readonly (keyof PlanShot)[]

type StoryboardShotPatchResult = {
  patch: Partial<PlanShot>
  updated: string[]
}

function hasStoryboardValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== undefined && value !== null
}

function shouldPatchStoryboardField(current: PlanShot, key: keyof PlanShot, overwriteExisting: boolean): boolean {
  return overwriteExisting || !hasStoryboardValue(current[key])
}

export function collectStoryboardShotPatch(
  current: PlanShot,
  record: Record<string, unknown>,
  options: { overwriteExisting: boolean },
): StoryboardShotPatchResult {
  const nextKind = record.shotKind === 'image' || record.shotKind === 'video' ? record.shotKind : current.shotKind
  const patch: Partial<PlanShot> = {}
  const updated: string[] = []
  const add = <K extends keyof PlanShot>(key: K, value: PlanShot[K]) => {
    patch[key] = value
    updated.push(key)
  }
  const addIfAllowed = <K extends keyof PlanShot>(key: K, value: PlanShot[K]) => {
    if (shouldPatchStoryboardField(current, key, options.overwriteExisting)) add(key, value)
  }

  if (
    nextKind &&
    nextKind !== current.shotKind &&
    shouldPatchStoryboardField(current, 'shotKind', options.overwriteExisting)
  )
    add('shotKind', nextKind)
  if (typeof record.durationSec === 'number' && Number.isFinite(record.durationSec))
    addIfAllowed('durationSec', record.durationSec)
  if (typeof record.modelKey === 'string') addIfAllowed('modelKey', record.modelKey.trim() || undefined)
  if (typeof record.variantId === 'string') addIfAllowed('variantId', record.variantId.trim() || undefined)
  if (typeof record.modeId === 'string') addIfAllowed('modeId', record.modeId.trim() || undefined)
  if (record.params && typeof record.params === 'object' && !Array.isArray(record.params)) {
    addIfAllowed('params', { ...(record.params as Record<string, unknown>) })
  }
  for (const key of STORYBOARD_SHOT_TEXT_FIELDS) {
    if (typeof record[key] === 'string') addIfAllowed(key, record[key])
  }

  const activeKind = nextKind ?? current.shotKind ?? 'video'
  const hasPrompt = typeof record.prompt === 'string'
  const hasImagePrompt = typeof record.imagePrompt === 'string'
  const hasVideoPrompt = typeof record.videoPrompt === 'string'
  if (hasImagePrompt && shouldPatchStoryboardField(current, 'imagePrompt', options.overwriteExisting)) {
    add('imagePrompt', record.imagePrompt as string)
    if (
      activeKind === 'image' &&
      !hasPrompt &&
      shouldPatchStoryboardField(current, 'prompt', options.overwriteExisting)
    ) {
      add('prompt', record.imagePrompt as string)
    }
  }
  if (hasVideoPrompt && shouldPatchStoryboardField(current, 'videoPrompt', options.overwriteExisting)) {
    add('videoPrompt', record.videoPrompt as string)
    if (
      activeKind === 'video' &&
      !hasPrompt &&
      shouldPatchStoryboardField(current, 'prompt', options.overwriteExisting)
    ) {
      add('prompt', record.videoPrompt as string)
    }
  }
  if (hasPrompt && shouldPatchStoryboardField(current, 'prompt', options.overwriteExisting)) {
    const prompt = record.prompt as string
    add('prompt', prompt)
    if (activeKind === 'image' && shouldPatchStoryboardField(current, 'imagePrompt', options.overwriteExisting))
      add('imagePrompt', prompt)
    if (activeKind === 'video' && shouldPatchStoryboardField(current, 'videoPrompt', options.overwriteExisting))
      add('videoPrompt', prompt)
  }

  return { patch, updated: Array.from(new Set(updated)) }
}

export function applyDerivedStoryboardVideoPrompt(shot: PlanShot): PlanShot {
  const prompt = buildDetailedStoryboardShotVideoPrompt(shot)
  return {
    ...shot,
    videoPrompt: prompt,
    ...((shot.shotKind ?? 'video') !== 'image' ? { prompt } : {}),
  }
}

export function syncStoryboardPlanToCanvas(nextPlan: StoryboardPlan, changedShotIndices: ReadonlySet<number>): void {
  const canvasStore = useGenerationCanvasStore.getState()
  const groupPrompt =
    storyboardPlanToCreateNodesArgs(nextPlan).nodes.find((node) => node.clientId === 'storyboard-group')?.prompt || ''
  for (const node of canvasStore.nodes) {
    if (!node.meta?.storyboardGroup) continue
    canvasStore.updateNode(
      node.id,
      {
        ...(groupPrompt ? { prompt: groupPrompt } : {}),
        meta: { ...(node.meta || {}), storyboardPlanSnapshot: nextPlan },
      },
      { persist: false },
    )
  }
  if (changedShotIndices.size > 0) {
    const state = useGenerationCanvasStore.getState()
    const rows = buildStoryboardScriptRows(nextPlan, state.nodes, state.edges)
    for (const row of rows) {
      if (!changedShotIndices.has(row.shot.index) || !row.videoNode) continue
      const prompt = storyboardShotVideoPrompt(row.shot)
      if (prompt) useGenerationCanvasStore.getState().updateNodePrompt(row.videoNode.id, prompt)
    }
  }
  useGenerationCanvasStore.getState().commitPersistedChange()
}
