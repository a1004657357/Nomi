import type { ModelOption } from '../../../config/models'
import type { DynamicCatalogControl, DynamicModelControl } from '../nodes/controls/parameterControlModel'
import {
  catalogControlInitialValue,
  controlInitialValue,
  defaultPatchForCatalogControl,
  defaultPatchForControls,
  isParameterControl,
  parseControlInput,
  removePreviousControlParams,
} from '../nodes/controls/parameterControlModel'
import { ASPECT_RATIO_KEYS, normalizeAspectRatioToWH } from '../nodes/aspectRatio'
import { ensureArchetypeNodeMeta, applyArchetypeModeSwitch } from '../nodes/controls/archetypeMeta'
import { resolveArchetypeForOption, resolveRenderedControls } from '../nodes/nodeModelArchetype'
import { resolveTargetModeForEdge } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const ASPECT_RATIO_KEY_SET = new Set<string>(ASPECT_RATIO_KEYS)

export type BatchMediaKind = 'image' | 'video'

export function buildBatchModelMeta(option: ModelOption | null, value: string, mediaKind: BatchMediaKind): Record<string, unknown> {
  const modelValue = option?.modelKey || option?.value || value || null
  const modelAlias = option?.modelAlias || option?.value || value || null
  const vendor = option?.vendor || null
  const base = {
    modelKey: modelValue,
    modelAlias,
    modelVendor: vendor,
    vendor,
    modelLabel: option?.label || value || null,
  }
  if (mediaKind === 'video') {
    return {
      ...base,
      videoModel: option?.value || value || null,
      videoModelVendor: vendor,
    }
  }
  return {
    ...base,
    imageModel: option?.value || value || null,
    imageModelVendor: vendor,
  }
}

export function buildImageBatchModelMeta(option: ModelOption | null, value: string): Record<string, unknown> {
  return buildBatchModelMeta(option, value, 'image')
}

export function patchForBatchControlValue(control: DynamicModelControl, value: string): Record<string, unknown> {
  if (!isParameterControl(control)) return defaultPatchForCatalogControl({ ...control, defaultValue: value } as DynamicCatalogControl)
  const parsed = parseControlInput(control, value)
  const patch: Record<string, unknown> = { [control.key]: parsed }
  if (ASPECT_RATIO_KEY_SET.has(control.key)) {
    const wh = normalizeAspectRatioToWH(parsed)
    if (wh) patch.aspect_ratio = wh
  }
  return patch
}

export function createBatchDraftMeta(input: {
  option: ModelOption | null
  value: string
  mediaKind: BatchMediaKind
  sourceMeta?: Record<string, unknown>
}): { meta: Record<string, unknown>; controls: DynamicModelControl[] } {
  const sourceMeta = input.sourceMeta || {}
  const modelMeta = buildBatchModelMeta(input.option, input.value, input.mediaKind)
  const controls = resolveRenderedControls(input.option, sourceMeta, input.mediaKind === 'image', input.mediaKind === 'video')
  let meta: Record<string, unknown> = {
    ...modelMeta,
    ...defaultPatchForControls(controls),
  }
  for (const control of controls) {
    const value = isParameterControl(control)
      ? controlInitialValue(control, sourceMeta)
      : catalogControlInitialValue(control, sourceMeta)
    meta = { ...meta, ...patchForBatchControlValue(control, value) }
  }
  return { meta, controls }
}

export function createImageBatchDraftMeta(input: {
  option: ModelOption | null
  value: string
  sourceMeta?: Record<string, unknown>
}): { meta: Record<string, unknown>; controls: DynamicModelControl[] } {
  return createBatchDraftMeta({ ...input, mediaKind: 'image' })
}

export function createVideoBatchDraftMeta(input: {
  option: ModelOption | null
  value: string
  sourceMeta?: Record<string, unknown>
}): { meta: Record<string, unknown>; controls: DynamicModelControl[] } {
  return createBatchDraftMeta({ ...input, mediaKind: 'video' })
}

export function applyBatchSettingsToNode(input: {
  node: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  modelOption: ModelOption | null
  currentModelOption: ModelOption | null
  draftMeta: Record<string, unknown>
  mediaKind: BatchMediaKind
}): Record<string, unknown> {
  const currentMeta = input.node.meta || {}
  const currentControls = resolveRenderedControls(input.currentModelOption, currentMeta, input.mediaKind === 'image', input.mediaKind === 'video')
  let nextMeta: Record<string, unknown> = {
    ...removePreviousControlParams(currentMeta, currentControls),
    ...input.draftMeta,
  }
  const archetype = resolveArchetypeForOption(input.modelOption)
  if (archetype) nextMeta = ensureArchetypeNodeMeta(nextMeta, archetype) || nextMeta

  if (archetype) {
    const byId = new Map(input.nodes.map((node) => [node.id, node]))
    for (const edge of input.edges) {
      if (edge.target !== input.node.id) continue
      const source = byId.get(edge.source)
      if (!source) continue
      const modeId = resolveTargetModeForEdge(source, { ...input.node, meta: nextMeta }, edge.mode)
      if (modeId) nextMeta = applyArchetypeModeSwitch(nextMeta, archetype, modeId)
    }
  }

  return nextMeta
}

export function applyImageBatchSettingsToNode(input: {
  node: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  modelOption: ModelOption | null
  currentModelOption: ModelOption | null
  draftMeta: Record<string, unknown>
}): Record<string, unknown> {
  return applyBatchSettingsToNode({ ...input, mediaKind: 'image' })
}

export function applyVideoBatchSettingsToNode(input: {
  node: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  modelOption: ModelOption | null
  currentModelOption: ModelOption | null
  draftMeta: Record<string, unknown>
}): Record<string, unknown> {
  return applyBatchSettingsToNode({ ...input, mediaKind: 'video' })
}
