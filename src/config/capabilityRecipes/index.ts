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
  { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
  { id: 'front-right', label: '右前侧', azimuth: 45, elevation: 0 },
  { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
  { id: 'rear-right', label: '右后侧', azimuth: 135, elevation: 0 },
  { id: 'rear', label: '背面', azimuth: 180, elevation: 0 },
  { id: 'rear-left', label: '左后侧', azimuth: -135, elevation: 0 },
  { id: 'left', label: '左侧', azimuth: -90, elevation: 0 },
  { id: 'front-left', label: '左前侧', azimuth: -45, elevation: 0 },
  { id: 'top', label: '俯视', azimuth: 0, elevation: 75 },
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
    label: `能量 ${energy} · 亲和 ${affinity}`,
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
  label,
  type: 'select',
  options: values.map((value) => ({ value, label: value })),
  defaultValue,
})

const optionSelect = (
  key: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  defaultValue: string,
): ModelParameterControl => ({
  key,
  label,
  type: 'select',
  options: options.map((option) => ({ ...option })),
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
    id: 'image.multiview.grid9', version: 2, label: '多机位九宫格', category: 'multiview',
    description: '按九个标准机位生成结果集合；可选择逐机位精确生成或低成本接触表草稿。',
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 9 },
    controls: [
      optionSelect('viewGenerationMode', '生成方式', [
        { value: 'independent', label: '逐机位生成（9 次）' },
        { value: 'contact_sheet', label: '接触表草稿（1 次）' },
      ], 'independent'),
      optionSelect('backgroundPolicy', '背景策略', [
        { value: 'preserve_scene', label: '保留原场景' },
        { value: 'neutral_turntable', label: '中性转台背景' },
      ], 'preserve_scene'),
    ],
    requirements: imageEditRequirement,
    execution: { kind: 'grid_split' },
  },
  {
    id: 'image.multiview.custom', version: 1, label: '自定义机位', category: 'multiview',
    description: '按方位角、仰俯角和景别生成一个或多个完整单帧机位。',
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 6 },
    controls: [
      { key: 'azimuth', label: '方位角', type: 'number', options: [], defaultValue: 0, min: -180, max: 180, step: 5 },
      { key: 'elevation', label: '仰俯角', type: 'number', options: [], defaultValue: 0, min: -30, max: 30, step: 5 },
      select('shotSize', '景别', ['特写', '近景', '中景', '全景'], '中景'),
      optionSelect('backgroundPolicy', '背景策略', [
        { value: 'preserve_scene', label: '保留原场景' },
        { value: 'neutral_turntable', label: '中性转台背景' },
      ], 'preserve_scene'),
    ],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'image.multiview.reconstruct3d', version: 1, label: '图片转 3D', category: 'multiview',
    description: '从一张清晰主体图生成可环绕、可送入 Scene3D 或 Blender 的 GLB 模型。',
    inputSlots: sourceImage, output: { kind: 'model3d' }, controls: [],
    requirements: { taskKinds: ['image_to_3d'], requiredAnyReferenceKinds: ['image_ref', 'first_frame'] },
    execution: { kind: 'pipeline' },
  },
  {
    id: 'scene.panorama.2to1', version: 1, label: '360° 全景', category: 'panorama',
    description: '生成严格 2:1 的等距柱状全景，并检查接缝、极点和投影可用性。',
    inputSlots: [{ kind: 'text', min: 0, max: 1 }, { kind: 'source_image', min: 0, max: 1 }],
    output: { kind: 'panorama' }, controls: [select('aspectRatio', '画幅', ['2:1'], '2:1')],
    requirements: { taskKinds: ['text_to_image', 'image_edit'] }, execution: { kind: 'single_task' },
  },
  {
    id: 'portrait.refine', version: 1, label: '人像真实化', category: 'portrait',
    description: '锁定人物身份，改善皮肤、光影、材质、清晰度和场景融合。',
    inputSlots: sourceImage, output: { kind: 'image' },
    controls: [
      select('sceneBlend', '人物融合', ['轻度对齐', '自然融合', '深度融合'], '自然融合'),
      select('lightingMatch', '光影匹配', ['柔和补光', '自然匹配', '氛围强化'], '自然匹配'),
      select('skinTexture', '肤质', ['清透修饰', '自然肤质', '真实肌理'], '自然肤质'),
      select('surfaceTexture', '表面纹理', ['柔和纹理', '自然纹理', '颗粒质感'], '自然纹理'),
      select('sharpness', '清晰度', ['柔焦', '标准清晰', '高清锐化'], '标准清晰'),
      { key: 'realismStrength', label: '真实化强度', type: 'number', options: [], defaultValue: 60, min: 0, max: 100, step: 5 },
      { key: 'identityLock', label: '锁定身份', type: 'boolean', options: [], defaultValue: true },
    ],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'portrait.mood', version: 2, label: '5×5 人物情绪', category: 'portrait',
    description: '用能量、亲和度和表情强度生成身份一致的单点、五格或 5×5 情绪版本。',
    inputSlots: sourceImage, output: { kind: 'image_collection', maxItems: 25 },
    controls: [
      {
        key: 'generationMode',
        label: '生成范围',
        type: 'select',
        options: [
          { value: 'single', label: '单个坐标' },
          { value: 'sample5', label: '五格试跑' },
          { value: 'matrix5x5', label: '完整 5×5' },
        ],
        defaultValue: 'single',
      },
      { key: 'energy', label: '平静到激动', type: 'number', options: [], defaultValue: 2, min: 0, max: 4, step: 1 },
      { key: 'affinity', label: '亲近到疏离', type: 'number', options: [], defaultValue: 2, min: 0, max: 4, step: 1 },
      { key: 'expressionStrength', label: '表情强度', type: 'number', options: [], defaultValue: 50, min: 0, max: 100, step: 5 },
      { key: 'identityLock', label: '锁定身份', type: 'boolean', options: [], defaultValue: true },
    ],
    requirements: imageEditRequirement, execution: { kind: 'fan_out' },
  },
  {
    id: 'image.style.transfer', version: 1, label: '图像风格迁移', category: 'style',
    description: '把已授权的风格或色板资源应用到图片，同时保护主体、构图和语义。',
    inputSlots: [...sourceImage, { kind: 'style', min: 1, max: 3 }], output: { kind: 'image' },
    controls: [{ key: 'styleStrength', label: '风格强度', type: 'number', options: [], defaultValue: 60, min: 0, max: 100, step: 5 }],
    requirements: imageEditRequirement, execution: { kind: 'single_task' },
  },
  {
    id: 'video.look.apply', version: 2, label: '图生视频·视觉风格', category: 'video',
    description: '以图片为首帧并引用风格资源，生成视觉质感一致的新视频。',
    inputSlots: [...sourceImage, { kind: 'style', min: 1, max: 3 }],
    output: { kind: 'video' }, controls: [], requirements: {
      taskKinds: ['image_to_video', 'text_to_video'],
      requiredAnyReferenceKinds: ['image_ref', 'first_frame'],
      requiredIntents: ['single', 'firstlast', 'character'],
    },
    execution: { kind: 'single_task' },
  },
  {
    id: 'video.effect.reference', version: 2, label: '图生视频·效果参考', category: 'video',
    description: '以图片为首帧并引用效果资源，生成有明确动作因果的效果视频。',
    inputSlots: [...sourceImage, { kind: 'effect', min: 1, max: 6 }], output: { kind: 'video' }, controls: [],
    requirements: {
      taskKinds: ['image_to_video', 'text_to_video'],
      requiredAnyReferenceKinds: ['image_ref', 'first_frame'],
      requiredIntents: ['single', 'firstlast', 'character'],
    },
    execution: { kind: 'single_task' },
  },
  {
    id: 'video.edit.look', version: 1, label: '视频转视频·视觉风格', category: 'video',
    description: '保留源视频动作和时序，只改变色彩、光线、颗粒与镜头质感。',
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
    id: 'video.edit.effect', version: 1, label: '视频转视频·时序效果', category: 'video',
    description: '在源视频时序上应用出现、扩散、碰撞或消散等可追溯效果。',
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
    return { supported: false, tier: 'unsupported', reason: `模型不存在模式：${modeId}` }
  }

  const taskKind = mode.transportTaskKind ?? archetype.transportTaskKind
  if (!recipe.requirements.taskKinds.includes(taskKind)) {
    return { supported: false, tier: 'unsupported', reason: `模型任务类型不兼容：${taskKind}` }
  }

  const requiredIntents = recipe.requirements.requiredIntents ?? []
  if (requiredIntents.length > 0 && !requiredIntents.includes(mode.intent)) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: `模型模式意图不兼容：${mode.intent}`,
    }
  }

  const requiredKinds = recipe.requirements.requiredReferenceKinds ?? []
  const missingKinds = requiredKinds.filter((kind) => !mode.slots.some((slot) => slot.kind === kind))
  if (missingKinds.length > 0) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: `模型模式缺少必要参考槽：${missingKinds.join('、')}`,
    }
  }

  const requiredAnyKinds = recipe.requirements.requiredAnyReferenceKinds ?? []
  if (requiredAnyKinds.length > 0 && !requiredAnyKinds.some((kind) => mode.slots.some((slot) => slot.kind === kind))) {
    return {
      supported: false,
      tier: 'unsupported',
      reason: `模型模式至少需要一个参考槽：${requiredAnyKinds.join('、')}`,
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
    return supplied ?? (gridCamera ? { ...gridCamera } : { id: `output-${index + 1}`, label: `结果 ${index + 1}` })
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
