import i18n from '../../i18n'
import { translateCapabilityWorkflowText } from '../../i18n/capabilityWorkflowText'
import { zhCapabilityWorkflow } from '../../i18n/locales/capabilityWorkflow'
import { z } from 'zod'
import type { ModelParameterControl } from '../modelCatalogMeta'
import type {
  ArchetypeIntent,
  ArchetypeReferenceSlotKind,
  ArchetypeTransportTaskKind,
  ModelArchetype,
  ModelCapabilityTier,
} from '../../../electron/shared/modelArchetypes/types'

export type CapabilityRecipeCategory = 'multiview' | 'panorama' | 'portrait' | 'style' | 'video'

export type CapabilityRecipeInputKind =
  | 'text'
  | 'source_image'
  | 'source_video'
  | 'source_model3d'
  | 'mask'
  | 'style'
  | 'identity'
  | 'effect'

export type CapabilityRecipeInputSlot = {
  kind: CapabilityRecipeInputKind
  min: number
  max: number
}

export type CapabilityRecipeOutputKind = 'image' | 'image_collection' | 'panorama' | 'model3d' | 'video'

export type CapabilityRecipe = {
  id: string
  version: number
  label: string
  description?: string
  category: CapabilityRecipeCategory
  inputSlots: CapabilityRecipeInputSlot[]
  output: { kind: CapabilityRecipeOutputKind; maxItems?: number }
  controls: ModelParameterControl[]
  requirements: {
    taskKinds: ArchetypeTransportTaskKind[]
    requiredReferenceKinds?: ArchetypeReferenceSlotKind[]
    requiredAnyReferenceKinds?: ArchetypeReferenceSlotKind[]
    requiredIntents?: ArchetypeIntent[]
  }
  execution: {
    kind: 'single_task' | 'grid_split' | 'fan_out' | 'pipeline' | 'local_render'
  }
}

export type RecipeCompatibility =
  | {
      supported: true
      tier: ModelCapabilityTier
      maxOutputs?: number
    }
  | {
      supported: false
      tier: 'unsupported'
      reason: string
    }

export const creativeResourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['style', 'effect', 'identity', 'palette']),
  label: z.string().min(1),
  description: z.string().optional(),
  promptTokens: z.array(z.string().min(1)).default([]),
  assetIds: z.array(z.string().min(1)).default([]),
  license: z.object({
    source: z.string().optional(),
    license: z.string().optional(),
    commercialUse: z.enum(['allowed', 'restricted', 'unknown']),
    attribution: z.string().optional(),
  }).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type CreativeResource = z.infer<typeof creativeResourceSchema>

export type RecipeRunPlan = {
  id: string
  recipeId: string
  recipeVersion: number
  outputKind: CapabilityRecipeOutputKind
  sourceNodeIds: string[]
  resourceIds: string[]
  model: {
    vendorKey: string
    modelKey: string
    archetypeId: string
    variantId?: string
    modeId: string
    compatibilityTier: ModelCapabilityTier
  }
  params: Record<string, string | number | boolean>
  outputCount: number
  taskCount: number
  outputs: RecipeOutputDescriptor[]
  createdAt: number
  agentRunId?: string
}

export type RecipeOutputDescriptor = {
  id: string
  label: string
  azimuth?: number
  elevation?: number
  shotSize?: string
  energy?: number
  affinity?: number
}

export type BuildRecipeRunPlanInput = {
  id: string
  recipe: CapabilityRecipe
  archetype: ModelArchetype
  modeId: string
  vendorKey: string
  modelKey: string
  variantId?: string
  sourceNodeIds: string[]
  resourceIds: string[]
  params: Record<string, string | number | boolean>
  requestedOutputs?: number
  outputs?: RecipeOutputDescriptor[]
  createdAt: number
  agentRunId?: string
}

const GRID9_CAMERA_OUTPUTS: readonly RecipeOutputDescriptor[] = [
  { id: 'front', label: zhCapabilityWorkflow.front, azimuth: 0, elevation: 0 },
  { id: 'front-right', label: zhCapabilityWorkflow.frontRight, azimuth: 45, elevation: 0 },
  { id: 'right', label: zhCapabilityWorkflow.right, azimuth: 90, elevation: 0 },
  { id: 'rear-right', label: zhCapabilityWorkflow.rearRight, azimuth: 135, elevation: 0 },
  { id: 'rear', label: zhCapabilityWorkflow.rear, azimuth: 180, elevation: 0 },
  { id: 'rear-left', label: zhCapabilityWorkflow.rearLeft, azimuth: -135, elevation: 0 },
  { id: 'left', label: zhCapabilityWorkflow.left, azimuth: -90, elevation: 0 },
  { id: 'front-left', label: zhCapabilityWorkflow.frontLeft, azimuth: -45, elevation: 0 },
  { id: 'top', label: zhCapabilityWorkflow.topView, azimuth: 0, elevation: 75 },
]

const MOOD_SAMPLE_COORDINATES = [
  [0, 0],
  [0, 4],
  [2, 2],
  [4, 0],
  [4, 4],
] as const

function moodScale(value: unknown, fallback = 2): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(4, Math.round(numeric))) : fallback
}

function moodOutput(energy: number, affinity: number): RecipeOutputDescriptor {
  return {
    id: `mood-e${energy}-a${affinity}`,
    label: i18n.t('capabilityWorkflow.energyAffinity', { lng: 'zh-CN', v0: energy, v1: affinity }),
    energy,
    affinity,
  }
}

function moodOutputs(params: Record<string, string | number | boolean>): RecipeOutputDescriptor[] {
  if (params.generationMode === 'matrix5x5') {
    return Array.from({ length: 25 }, (_, index) => moodOutput(Math.floor(index / 5), index % 5))
  }
  if (params.generationMode === 'sample5') {
    return MOOD_SAMPLE_COORDINATES.map(([energy, affinity]) => moodOutput(energy, affinity))
  }
  return [moodOutput(moodScale(params.energy), moodScale(params.affinity))]
}

const select = (
  key: string,
  label: string,
  values: readonly string[],
  defaultValue: string,
): ModelParameterControl => ({
  key,
  get label() { return translateCapabilityWorkflowText(label) },
  type: 'select',
  options: values.map((value) => ({ value, get label() { return translateCapabilityWorkflowText(value) } })),
  defaultValue,
})

const optionSelect = (
  key: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  defaultValue: string,
): ModelParameterControl => ({
  key,
  get label() { return translateCapabilityWorkflowText(label) },
  type: 'select',
  options: options.map((option) => ({ value: option.value, get label() { return option.label } })),
  defaultValue,
})

const sourceImage = [{ kind: 'source_image', min: 1, max: 1 }] satisfies CapabilityRecipeInputSlot[]
const sourceVideo = [{ kind: 'source_video', min: 1, max: 1 }] satisfies CapabilityRecipeInputSlot[]
const imageEditRequirement = {
  taskKinds: ['image_edit'] as ArchetypeTransportTaskKind[],
  requiredReferenceKinds: ['image_ref'] as ArchetypeReferenceSlotKind[],
}

export const BUILTIN_CAPABILITY_RECIPES: readonly CapabilityRecipe[] = [
  {
    id: 'image.multiview.grid9', version: 2, get label() { return i18n.t('capabilityWorkflow.nineViewCameraGrid') }, category: 'multiview',
    get description() { return i18n.t('capabilityWorkflow.generateNineStandardCameraViewsAsAResultCollection') },
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 9 },
    controls: [
      optionSelect('viewGenerationMode', '生成方式', [
        { value: 'independent', get label() { return i18n.t('capabilityWorkflow.generateEachView9Tasks') } },
        { value: 'contact_sheet', get label() { return i18n.t('capabilityWorkflow.contactSheetDraft1Task') } },
      ], 'independent'),
      optionSelect('backgroundPolicy', '背景策略', [
        { value: 'preserve_scene', get label() { return i18n.t('capabilityWorkflow.preserveSourceScene') } },
        { value: 'neutral_turntable', get label() { return i18n.t('capabilityWorkflow.neutralTurntableBackground') } },
      ], 'preserve_scene'),
    ],
    requirements: imageEditRequirement,
    execution: { kind: 'grid_split' },
  },
  {
    id: 'image.multiview.custom', version: 1, get label() { return i18n.t('capabilityWorkflow.customCameraView') }, category: 'multiview',
    get description() { return i18n.t('capabilityWorkflow.generateOneOrMoreCompleteSingleFrameViewsUsing') },
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 6 },
    controls: [
      { key: 'azimuth', get label() { return i18n.t('capabilityWorkflow.azimuth') }, type: 'number', options: [], defaultValue: 0, min: -180, max: 180, step: 5 },
      { key: 'elevation', get label() { return i18n.t('capabilityWorkflow.elevation') }, type: 'number', options: [], defaultValue: 0, min: -30, max: 30, step: 5 },
      select('shotSize', '景别', ['特写', '近景', '中景', '全景'], '中景'),
      optionSelect('backgroundPolicy', '背景策略', [
        { value: 'preserve_scene', get label() { return i18n.t('capabilityWorkflow.preserveSourceScene') } },
        { value: 'neutral_turntable', get label() { return i18n.t('capabilityWorkflow.neutralTurntableBackground') } },
      ], 'preserve_scene'),
    ],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'image.multiview.reconstruct3d', version: 1, get label() { return i18n.t('capabilityWorkflow.imageTo3D') }, category: 'multiview',
    get description() { return i18n.t('capabilityWorkflow.generateARotatableGLBModelFromAClearSubject') },
    inputSlots: sourceImage, output: { kind: 'model3d' }, controls: [],
    requirements: { taskKinds: ['image_to_3d'], requiredAnyReferenceKinds: ['image_ref', 'first_frame'] },
    execution: { kind: 'pipeline' },
  },
  {
    id: 'scene.panorama.2to1', version: 1, get label() { return i18n.t('capabilityWorkflow.label360DegreePanorama') }, category: 'panorama',
    get description() { return i18n.t('capabilityWorkflow.generateAStrict21EquirectangularPanoramaAndCheck') },
    inputSlots: [{ kind: 'text', min: 0, max: 1 }, { kind: 'source_image', min: 0, max: 1 }],
    output: { kind: 'panorama' }, controls: [select('aspectRatio', '画幅', ['2:1'], '2:1')],
    requirements: { taskKinds: ['text_to_image', 'image_edit'] }, execution: { kind: 'single_task' },
  },
  {
    id: 'portrait.refine', version: 1, get label() { return i18n.t('capabilityWorkflow.portraitRefinement') }, category: 'portrait',
    get description() { return i18n.t('capabilityWorkflow.preserveIdentityWhileImprovingSkinLightingMaterialsClarityAnd') },
    inputSlots: sourceImage, output: { kind: 'image' },
    controls: [
      select('sceneBlend', '人物融合', ['轻度对齐', '自然融合', '深度融合'], '自然融合'),
      select('lightingMatch', '光影匹配', ['柔和补光', '自然匹配', '氛围强化'], '自然匹配'),
      select('skinTexture', '肤质', ['清透修饰', '自然肤质', '真实肌理'], '自然肤质'),
      select('surfaceTexture', '表面纹理', ['柔和纹理', '自然纹理', '颗粒质感'], '自然纹理'),
      select('sharpness', '清晰度', ['柔焦', '标准清晰', '高清锐化'], '标准清晰'),
      { key: 'realismStrength', get label() { return i18n.t('capabilityWorkflow.realismStrength') }, type: 'number', options: [], defaultValue: 60, min: 0, max: 100, step: 5 },
      { key: 'identityLock', get label() { return i18n.t('capabilityWorkflow.lockIdentity') }, type: 'boolean', options: [], defaultValue: true },
    ],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'portrait.mood', version: 2, get label() { return i18n.t('capabilityWorkflow.label5x5PortraitMoods') }, category: 'portrait',
    get description() { return i18n.t('capabilityWorkflow.generateIdentityConsistentSinglePointFiveSampleOr5x5') },
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 25 },
    controls: [
      {
        key: 'generationMode',
        get label() { return i18n.t('capabilityWorkflow.generationScope') },
        type: 'select',
        options: [
          { value: 'single', get label() { return i18n.t('capabilityWorkflow.singleCoordinate') } },
          { value: 'sample5', get label() { return i18n.t('capabilityWorkflow.fiveSampleTrial') } },
          { value: 'matrix5x5', get label() { return i18n.t('capabilityWorkflow.full5x5') } },
        ],
        defaultValue: 'single',
      },
      { key: 'energy', get label() { return i18n.t('capabilityWorkflow.calmToExcited') }, type: 'number', options: [], defaultValue: 2, min: 0, max: 4, step: 1 },
      { key: 'affinity', get label() { return i18n.t('capabilityWorkflow.friendlyToDistant') }, type: 'number', options: [], defaultValue: 2, min: 0, max: 4, step: 1 },
      { key: 'expressionStrength', get label() { return i18n.t('capabilityWorkflow.expressionStrength') }, type: 'number', options: [], defaultValue: 50, min: 0, max: 100, step: 5 },
      { key: 'identityLock', get label() { return i18n.t('capabilityWorkflow.lockIdentity') }, type: 'boolean', options: [], defaultValue: true },
    ],
    requirements: imageEditRequirement, execution: { kind: 'fan_out' },
  },
  {
    id: 'image.style.transfer', version: 1, get label() { return i18n.t('capabilityWorkflow.imageStyleTransfer') }, category: 'style',
    get description() { return i18n.t('capabilityWorkflow.applyLicensedStyleOrPaletteResourcesWhilePreservingThe') },
    inputSlots: [...sourceImage, { kind: 'style', min: 1, max: 3 }], output: { kind: 'image' },
    controls: [{ key: 'styleStrength', get label() { return i18n.t('capabilityWorkflow.styleStrength') }, type: 'number', options: [], defaultValue: 60, min: 0, max: 100, step: 5 }],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'video.look.apply', version: 2, get label() { return i18n.t('capabilityWorkflow.imageToVideoVisualStyle') }, category: 'video',
    get description() { return i18n.t('capabilityWorkflow.useAnImageAsTheFirstFrameWithStyle') },
    inputSlots: [...sourceImage, { kind: 'style', min: 1, max: 3 }],
    output: { kind: 'video' }, controls: [], requirements: {
      taskKinds: ['image_to_video', 'text_to_video'],
      requiredAnyReferenceKinds: ['image_ref', 'first_frame'],
      requiredIntents: ['single', 'firstlast', 'character'],
    },
    execution: { kind: 'single_task' },
  },
  {
    id: 'video.effect.reference', version: 2, get label() { return i18n.t('capabilityWorkflow.imageToVideoEffectReference') }, category: 'video',
    get description() { return i18n.t('capabilityWorkflow.useAnImageAsTheFirstFrameWithEffect') },
    inputSlots: [...sourceImage, { kind: 'effect', min: 1, max: 6 }], output: { kind: 'video' }, controls: [],
    requirements: {
      taskKinds: ['image_to_video', 'text_to_video'],
      requiredAnyReferenceKinds: ['image_ref', 'first_frame'],
      requiredIntents: ['single', 'firstlast', 'character'],
    },
    execution: { kind: 'single_task' },
  },
  {
    id: 'video.edit.look', version: 1, get label() { return i18n.t('capabilityWorkflow.videoToVideoVisualStyle') }, category: 'video',
    get description() { return i18n.t('capabilityWorkflow.preserveSourceMotionAndTimingWhileChangingColorLighting') },
    inputSlots: [...sourceVideo, { kind: 'style', min: 1, max: 3 }],
    output: { kind: 'video' }, controls: [],
    requirements: {
      taskKinds: ['text_to_video', 'image_to_video'],
      requiredReferenceKinds: ['source_video'],
      requiredIntents: ['edit'],
    },
    execution: { kind: 'single_task' },
  },
  {
    id: 'video.edit.effect', version: 1, get label() { return i18n.t('capabilityWorkflow.videoToVideoTimingEffects') }, category: 'video',
    get description() { return i18n.t('capabilityWorkflow.applyTraceableAppearanceDiffusionCollisionOrDissipationEffectsTo') },
    inputSlots: [...sourceVideo, { kind: 'effect', min: 1, max: 6 }],
    output: { kind: 'video' }, controls: [],
    requirements: {
      taskKinds: ['text_to_video', 'image_to_video'],
      requiredReferenceKinds: ['source_video'],
      requiredIntents: ['edit'],
    },
    execution: { kind: 'single_task' },
  },
]

export function resolveRecipeCompatibility(
  recipe: CapabilityRecipe,
  archetype: ModelArchetype,
  modeId: string,
): RecipeCompatibility {
  const mode = archetype.modes.find((candidate) => candidate.id === modeId)
  if (!mode) {
    return { supported: false, tier: 'unsupported', reason: i18n.t('capabilityWorkflow.theModelHasNoMode', { v0: modeId }) }
  }

  const taskKind = mode.transportTaskKind ?? archetype.transportTaskKind
  if (!recipe.requirements.taskKinds.includes(taskKind)) {
    return { supported: false, tier: 'unsupported', reason: i18n.t('capabilityWorkflow.incompatibleModelTaskType', { v0: taskKind }) }
  }

  const requiredIntents = recipe.requirements.requiredIntents ?? []
  if (requiredIntents.length > 0 && !requiredIntents.includes(mode.intent)) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: i18n.t('capabilityWorkflow.incompatibleModelModeIntent', { v0: mode.intent }),
    }
  }

  const requiredKinds = recipe.requirements.requiredReferenceKinds ?? []
  const missingKinds = requiredKinds.filter((kind) => !mode.slots.some((slot) => slot.kind === kind))
  if (missingKinds.length > 0) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: i18n.t('capabilityWorkflow.theModelModeLacksRequiredReferenceSlots', { v0: missingKinds.join('、') }),
    }
  }

  const requiredAnyKinds = recipe.requirements.requiredAnyReferenceKinds ?? []
  if (requiredAnyKinds.length > 0 && !requiredAnyKinds.some((kind) => mode.slots.some((slot) => slot.kind === kind))) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: i18n.t('capabilityWorkflow.theModelModeRequiresAtLeastOneReferenceSlot', { v0: requiredAnyKinds.join('、') }),
    }
  }

  const explicit = mode.capabilities?.find((entry) => entry.capabilityId === recipe.id)
  if (explicit) {
    return {
      supported: true,
      tier: explicit.tier,
      ...(typeof explicit.maxOutputs === 'number' ? { maxOutputs: explicit.maxOutputs } : {}),
    }
  }

  return { supported: true, tier: 'experimental' }
}

export function recipeTaskCount(
  recipe: Pick<CapabilityRecipe, 'id' | 'execution'>,
  params: Record<string, string | number | boolean>,
  outputCount: number,
): number {
  const count = Math.max(1, Math.floor(outputCount))
  if (recipe.id === 'image.multiview.grid9') {
    return params.viewGenerationMode === 'contact_sheet' ? 1 : count
  }
  return recipe.execution.kind === 'grid_split' ? 1 : count
}

export function buildRecipeRunPlan(input: BuildRecipeRunPlanInput): RecipeRunPlan {
  const compatibility = resolveRecipeCompatibility(input.recipe, input.archetype, input.modeId)
  if (!compatibility.supported) throw new Error(compatibility.reason)

  const prescribedOutputs = input.outputs?.length
    ? input.outputs
    : input.recipe.id === 'portrait.mood'
      ? moodOutputs(input.params)
      : undefined
  const defaultOutputs = input.recipe.execution.kind === 'grid_split'
    ? input.recipe.output.maxItems ?? 1
    : prescribedOutputs?.length ?? 1
  const requestedOutputs = input.recipe.id === 'portrait.mood'
    ? defaultOutputs
    : Math.max(1, Math.floor(input.requestedOutputs ?? defaultOutputs))
  const recipeLimit = input.recipe.output.maxItems ?? requestedOutputs
  const gridRunsIndependently = input.recipe.id === 'image.multiview.grid9'
    && input.params.viewGenerationMode !== 'contact_sheet'
  const modelLimit = input.recipe.execution.kind === 'fan_out' || gridRunsIndependently
    ? requestedOutputs
    : compatibility.maxOutputs ?? requestedOutputs
  const outputCount = Math.min(requestedOutputs, recipeLimit, modelLimit)
  const taskCount = recipeTaskCount(input.recipe, input.params, outputCount)
  const outputs = Array.from({ length: outputCount }, (_, index) => {
    const supplied = prescribedOutputs?.[index]
    const gridCamera = input.recipe.id === 'image.multiview.grid9' ? GRID9_CAMERA_OUTPUTS[index] : undefined
    return supplied ?? (gridCamera ? { ...gridCamera } : { id: `output-${index + 1}`, label: i18n.t('capabilityWorkflow.result', { lng: 'zh-CN', v0: index + 1 }) })
  })

  return {
    id: input.id,
    recipeId: input.recipe.id,
    recipeVersion: input.recipe.version,
    outputKind: input.recipe.output.kind,
    sourceNodeIds: [...input.sourceNodeIds],
    resourceIds: [...input.resourceIds],
    model: {
      vendorKey: input.vendorKey,
      modelKey: input.modelKey,
      archetypeId: input.archetype.id,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      modeId: input.modeId,
      compatibilityTier: compatibility.tier,
    },
    params: { ...input.params },
    outputCount,
    taskCount,
    outputs,
    createdAt: input.createdAt,
    ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
  }
}
