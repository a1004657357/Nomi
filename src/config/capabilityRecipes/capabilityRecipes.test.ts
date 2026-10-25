import { describe, expect, it } from 'vitest'
import type { ModelArchetype } from '../../../electron/shared/modelArchetypes/types'
import { HITEM3D_ARCHETYPE } from '../../../electron/shared/modelArchetypes/hitem3d'
import { HUNYUAN3D_ARCHETYPE } from '../../../electron/shared/modelArchetypes/hunyuan3d'
import { MESHY6_ARCHETYPE } from '../../../electron/shared/modelArchetypes/meshy6'
import { HAPPYHORSE_ARCHETYPE } from '../../../electron/shared/videoCapabilities/happyhorse'
import {
  BUILTIN_CAPABILITY_RECIPES,
  buildRecipeRunPlan,
  creativeResourceSchema,
  resolveRecipeCompatibility,
  type CapabilityRecipe,
} from './index'

function imageArchetype(
  capabilities: ModelArchetype['modes'][number]['capabilities'] = [],
): ModelArchetype {
  return {
    id: 'test-image-edit',
    family: 'test-image',
    label: 'Test Image Edit',
    kind: 'image',
    defaultModeId: 'edit',
    transportTaskKind: 'image_edit',
    identifierPatterns: ['test-image-edit'],
    modes: [
      {
        id: 'edit',
        intent: 'edit',
        vendorTerm: 'Edit',
        hint: 'Edit one source image',
        slots: [{ kind: 'image_ref', label: 'Source', min: 1, max: 1 }],
        params: [],
        promptRequired: true,
        transportTaskKind: 'image_edit',
        capabilities,
      },
    ],
  }
}

describe('capability recipe registry', () => {
  it('keeps every built-in recipe id unique', () => {
    const ids = BUILTIN_CAPABILITY_RECIPES.map((recipe) => recipe.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each([
    ['video.look.apply', 'style'],
    ['video.effect.reference', 'effect'],
  ])('keeps %s honest as an image-driven video recipe', (recipeId, resourceKind) => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === recipeId)!
    expect(recipe.inputSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source_image', min: 1 }),
      expect.objectContaining({ kind: resourceKind, min: 1 }),
    ]))
    expect(recipe.inputSlots.some((slot) => slot.kind === 'source_video')).toBe(false)
    expect(recipe.requirements.requiredAnyReferenceKinds).toEqual(['image_ref', 'first_frame'])
    expect(recipe.requirements.requiredIntents).not.toContain('edit')
  })

  it.each([
    ['video.edit.look', 'style'],
    ['video.edit.effect', 'effect'],
  ])('requires a source video and edit mode for %s', (recipeId, resourceKind) => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === recipeId)!
    expect(recipe.inputSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source_video', min: 1 }),
      expect.objectContaining({ kind: resourceKind, min: 1 }),
    ]))
    expect(recipe.inputSlots.some((slot) => slot.kind === 'source_image')).toBe(false)
    expect(recipe.requirements.requiredReferenceKinds).toEqual(['source_video'])
    expect(recipe.requirements.requiredIntents).toEqual(['edit'])
  })

  it('declares portrait mood as a bounded fan-out collection with single, sample, and matrix modes', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.mood')!
    expect(recipe).toMatchObject({
      version: 2,
      output: { kind: 'image_collection', maxItems: 25 },
      execution: { kind: 'fan_out' },
    })
    expect(recipe.controls.find((control) => control.key === 'generationMode')?.options).toEqual([
      { value: 'single', label: '单个坐标' },
      { value: 'sample5', label: '五格试跑' },
      { value: 'matrix5x5', label: '完整 5×5' },
    ])
  })
})

describe('resolveRecipeCompatibility', () => {
  const recipe: CapabilityRecipe = {
    id: 'portrait.refine',
    version: 1,
    label: 'Portrait refine',
    category: 'portrait',
    inputSlots: [{ kind: 'source_image', min: 1, max: 1 }],
    output: { kind: 'image' },
    controls: [],
    requirements: {
      taskKinds: ['image_edit'],
      requiredReferenceKinds: ['image_ref'],
    },
    execution: { kind: 'single_task' },
  }

  it('rejects a mode that cannot carry the required source image', () => {
    const archetype = imageArchetype()
    archetype.modes[0]!.slots = []

    expect(resolveRecipeCompatibility(recipe, archetype, 'edit')).toEqual({
      supported: false,
      tier: 'unsupported',
      reason: '模型模式缺少必要参考槽：image_ref',
    })
  })

  it('marks a structurally compatible prompt-driven mode as experimental', () => {
    expect(resolveRecipeCompatibility(recipe, imageArchetype(), 'edit')).toEqual({
      supported: true,
      tier: 'experimental',
    })
  })

  it('prefers an explicit native capability declaration', () => {
    const archetype = imageArchetype([
      { capabilityId: 'portrait.refine', tier: 'native', maxOutputs: 1 },
    ])

    expect(resolveRecipeCompatibility(recipe, archetype, 'edit')).toEqual({
      supported: true,
      tier: 'native',
      maxOutputs: 1,
    })
  })

  it('accepts a model3d image input carried by a first-frame slot', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.multiview.reconstruct3d')!
    const archetype: ModelArchetype = {
      id: 'test-3d',
      family: 'test-3d',
      label: 'Test 3D',
      kind: 'model3d',
      defaultModeId: 'image',
      transportTaskKind: 'text_to_3d',
      identifierPatterns: ['test-3d'],
      modes: [{
        id: 'image', intent: 'single', vendorTerm: 'Image to 3D', hint: '', promptRequired: false,
        transportTaskKind: 'image_to_3d',
        slots: [{ kind: 'first_frame', label: 'Source', min: 1, max: 1 }],
        params: [],
        capabilities: [{ capabilityId: recipe.id, tier: 'native', maxOutputs: 1 }],
      }],
    }

    expect(resolveRecipeCompatibility(recipe, archetype, 'image')).toEqual({
      supported: true,
      tier: 'native',
      maxOutputs: 1,
    })
  })

  it('exposes only a real source-video edit mode to video-to-video recipes', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'video.edit.look')!

    expect(resolveRecipeCompatibility(recipe, HAPPYHORSE_ARCHETYPE, 'edit')).toEqual({
      supported: true,
      tier: 'experimental',
    })
    expect(resolveRecipeCompatibility(recipe, HAPPYHORSE_ARCHETYPE, 'i2v')).toEqual({
      supported: false,
      tier: 'unsupported',
      reason: '模型模式意图不兼容：single',
    })
  })

  it('does not expose a source-video edit mode to image-driven video recipes', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'video.look.apply')!

    expect(resolveRecipeCompatibility(recipe, HAPPYHORSE_ARCHETYPE, 'edit')).toEqual({
      supported: false,
      tier: 'unsupported',
      reason: '模型模式意图不兼容：edit',
    })
    expect(resolveRecipeCompatibility(recipe, HAPPYHORSE_ARCHETYPE, 'i2v')).toEqual({
      supported: true,
      tier: 'experimental',
    })
  })

  it.each([
    HUNYUAN3D_ARCHETYPE,
    HITEM3D_ARCHETYPE,
    MESHY6_ARCHETYPE,
  ])('declares $label image-to-3d as native reconstruction', (archetype) => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.multiview.reconstruct3d')!
    expect(resolveRecipeCompatibility(recipe, archetype, 'image')).toMatchObject({
      supported: true,
      tier: 'native',
    })
  })
})

describe('buildRecipeRunPlan', () => {
  it('uses stable row-major camera descriptors for the nine-view grid', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.multiview.grid9')!
    const recipePlan = buildRecipeRunPlan({
      id: 'run-grid',
      recipe,
      archetype: imageArchetype(),
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['source-1'],
      resourceIds: [],
      params: { viewGenerationMode: 'contact_sheet' },
      createdAt: 100,
    })

    expect(recipePlan.taskCount).toBe(1)
    expect(recipePlan.outputs).toEqual([
      { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
      { id: 'front-right', label: '右前侧', azimuth: 45, elevation: 0 },
      { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
      { id: 'rear-right', label: '右后侧', azimuth: 135, elevation: 0 },
      { id: 'rear', label: '背面', azimuth: 180, elevation: 0 },
      { id: 'rear-left', label: '左后侧', azimuth: -135, elevation: 0 },
      { id: 'left', label: '左侧', azimuth: -90, elevation: 0 },
      { id: 'front-left', label: '左前侧', azimuth: -45, elevation: 0 },
      { id: 'top', label: '俯视', azimuth: 0, elevation: 75 },
    ])
  })

  it('defaults new nine-view runs to nine independent camera tasks with scene preservation', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.multiview.grid9')!
    const defaults = Object.fromEntries(
      recipe.controls.flatMap((control) => control.defaultValue === undefined ? [] : [[control.key, control.defaultValue] as const]),
    )
    const recipePlan = buildRecipeRunPlan({
      id: 'run-grid-accurate',
      recipe,
      archetype: imageArchetype(),
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['source-1'],
      resourceIds: [],
      params: defaults,
      createdAt: 100,
    })

    expect(defaults).toMatchObject({
      viewGenerationMode: 'independent',
      backgroundPolicy: 'preserve_scene',
    })
    expect(recipePlan.outputCount).toBe(9)
    expect(recipePlan.taskCount).toBe(9)
    expect(recipePlan.outputs[8]).toMatchObject({ id: 'top', elevation: 75 })
  })

  it('caps requested outputs to both recipe and model limits', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.multiview.custom')!
    expect(recipe.controls.find((control) => control.key === 'backgroundPolicy')).toMatchObject({
      type: 'select',
      defaultValue: 'preserve_scene',
    })
    const archetype = imageArchetype([
      { capabilityId: recipe.id, tier: 'native', maxOutputs: 4 },
    ])

    const plan = buildRecipeRunPlan({
      id: 'run-1',
      recipe,
      archetype,
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['source-1'],
      resourceIds: [],
      params: {},
      requestedOutputs: 6,
      createdAt: 100,
    })

    expect(plan.taskCount).toBe(4)
    expect(plan.outputCount).toBe(4)
    expect(plan.model).toEqual({
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      archetypeId: 'test-image-edit',
      modeId: 'edit',
      compatibilityTier: 'native',
    })
  })

  it('expands the full mood matrix into 25 ordered one-image tasks even when the model returns one image per request', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.mood')!
    const archetype = imageArchetype([
      { capabilityId: recipe.id, tier: 'native', maxOutputs: 1 },
    ])

    const plan = buildRecipeRunPlan({
      id: 'run-mood-matrix',
      recipe,
      archetype,
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['portrait-1'],
      resourceIds: [],
      params: {
        generationMode: 'matrix5x5',
        expressionStrength: 55,
        identityLock: true,
      },
      createdAt: 100,
    })

    expect(plan.outputCount).toBe(25)
    expect(plan.taskCount).toBe(25)
    expect(plan.outputs[0]).toEqual({
      id: 'mood-e0-a0',
      label: '能量 0 · 亲和 0',
      energy: 0,
      affinity: 0,
    })
    expect(plan.outputs[12]).toEqual({
      id: 'mood-e2-a2',
      label: '能量 2 · 亲和 2',
      energy: 2,
      affinity: 2,
    })
    expect(plan.outputs[24]).toEqual({
      id: 'mood-e4-a4',
      label: '能量 4 · 亲和 4',
      energy: 4,
      affinity: 4,
    })
  })

  it('uses a five-cell corners-and-center subset before a full mood matrix run', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.mood')!
    const plan = buildRecipeRunPlan({
      id: 'run-mood-sample',
      recipe,
      archetype: imageArchetype(),
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['portrait-1'],
      resourceIds: [],
      params: { generationMode: 'sample5', identityLock: true },
      createdAt: 100,
    })

    expect(plan.taskCount).toBe(5)
    expect(plan.outputs.map(({ energy, affinity }) => [energy, affinity])).toEqual([
      [0, 0],
      [0, 4],
      [2, 2],
      [4, 0],
      [4, 4],
    ])
  })

  it('keeps a single mood coordinate as one non-destructive result', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.mood')!
    const plan = buildRecipeRunPlan({
      id: 'run-mood-single',
      recipe,
      archetype: imageArchetype(),
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['portrait-1'],
      resourceIds: [],
      params: { generationMode: 'single', energy: 4, affinity: 1, identityLock: true },
      createdAt: 100,
    })

    expect(plan.outputCount).toBe(1)
    expect(plan.taskCount).toBe(1)
    expect(plan.outputs).toEqual([{
      id: 'mood-e4-a1',
      label: '能量 4 · 亲和 1',
      energy: 4,
      affinity: 1,
    }])
  })

  it('refuses to build a paid plan for an incompatible mode', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.refine')!
    const archetype = imageArchetype()
    archetype.modes[0]!.slots = []

    expect(() => buildRecipeRunPlan({
      id: 'run-2',
      recipe,
      archetype,
      modeId: 'edit',
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      sourceNodeIds: ['source-1'],
      resourceIds: [],
      params: {},
      createdAt: 100,
    })).toThrow('模型模式缺少必要参考槽：image_ref')
  })
})

describe('creativeResourceSchema', () => {
  it('preserves provenance and commercial-use status', () => {
    const resource = creativeResourceSchema.parse({
      id: 'style-1',
      kind: 'style',
      label: '自然电影',
      promptTokens: ['自然肤质', '柔和侧光'],
      assetIds: ['asset-1'],
      license: {
        source: 'user',
        license: 'owned',
        commercialUse: 'allowed',
        attribution: '',
      },
      createdAt: 100,
      updatedAt: 100,
    })

    expect(resource.license?.commercialUse).toBe('allowed')
    expect(resource.promptTokens).toEqual(['自然肤质', '柔和侧光'])
  })
})
