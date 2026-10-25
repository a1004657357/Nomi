import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type BillingModelKind } from '../../api/modelCatalogApi'
import { modeTransportFor, replaceCustomCapabilityContractMeta, resolveArchetypeForModel } from '../../../../electron/shared/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import type { CatalogTaskActionOptions } from './catalogTaskResolve'

const PARAMETER_KEYS = ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'seed', 'width', 'height', 'steps', 'cfgScale', 'quality']

/** Restore only an exact successful identity; never choose a cheaper/available sibling or mint a grant. */
export async function recoverCatalogModelKind(
  node: GenerationCanvasNode, expected: BillingModelKind, registered: string, options: CatalogTaskActionOptions,
): Promise<GenerationCanvasNode> {
  const mismatch = new Error(`Model kind mismatch: ${String(node.meta?.modelKey || '')} (registered=${registered}, requested=${expected})`
    + (expected === 'video' && registered === 'image' ? '：视频节点错误绑定了图片模型，请重新选择视频模型。' : '：节点绑定的模型类型不符，请重新选择模型。'))
  const candidates = [node.result, ...(node.history || [])]
    .filter((result) => result?.type === expected && Boolean(result.url || result.text) && result.provenance?.provider && result.provenance.modelKey)
    .sort((a, b) => b!.createdAt - a!.createdAt)
  // No catalog bridge is not evidence that a mismatched model is safe to submit.
  const result = candidates[0]
  if (!result?.provenance) throw mismatch
  const provenance = result.provenance
  const vendor = provenance.provider!
  const modelKey = provenance.modelKey!
  let model
  try {
    const vendors = await (options.listCatalogVendors || listWorkbenchModelCatalogVendors)()
    const models = await (options.listCatalogModels || listWorkbenchModelCatalogModels)({ kind: expected, enabled: true, vendorKey: vendor })
    if (!vendors.some((row) => row.key === vendor && row.enabled)) throw mismatch
    model = models.find((row) => row.kind === expected && row.vendorKey === vendor && row.modelKey === modelKey && row.enabled && row.availability.usable)
  } catch {
    throw mismatch
  }
  if (!model) throw mismatch
  const archetype = resolveArchetypeForModel({ modelKey, modelAlias: model.modelAlias, vendorKey: vendor, meta: model.meta })
  if (!archetype || archetype.kind !== expected) throw mismatch
  const extras = provenance.params?.extras
  const saved = extras && typeof extras === 'object' && !Array.isArray(extras) ? extras as Record<string, unknown> : {}
  const savedMode = saved.archetype as { modeId?: string } | undefined
  const references = options.references
  const hasImage = Boolean(references?.firstFrameUrl || references?.lastFrameUrl || references?.referenceImages?.length)
  const mode = expected === 'video' && hasImage
    ? archetype.modes.find((mode) => modeTransportFor(mode, archetype, vendor) === 'image_to_video')
    : archetype.modes.find((mode) => mode.id === savedMode?.modeId)
      || archetype.modes.find((mode) => mode.id === archetype.defaultModeId)
  if (!mode) throw mismatch
  const allowed = new Set([...PARAMETER_KEYS, ...mode.params.map((param) => param.key)])
  const restored = Object.fromEntries(Object.entries(saved).filter(([key]) => allowed.has(key)))
  const resolved: GenerationCanvasNode = {
    ...node,
    meta: projectParameterReferenceSlots({
      ...replaceCustomCapabilityContractMeta(node.meta || {}, model.meta), ...restored,
      modelKey, modelAlias: model.modelAlias || modelKey, modelVendor: vendor, vendor,
      modelLabel: model.labelZh || modelKey, archetype: { id: archetype.id, modeId: mode.id },
      ...(expected === 'video' ? { videoModel: modelKey, videoModelVendor: vendor } : {}),
      ...(expected === 'image' ? { imageModel: modelKey, imageModelVendor: vendor } : {}),
    }, model.meta),
  }
  await options.onResolvedNode?.(resolved)
  return resolved
}
