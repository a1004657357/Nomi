import { describe, expect, it } from 'vitest'
import { BUILTIN_CAPABILITY_RECIPES } from '../../../config/capabilityRecipes'
import { buildAgentModelEntries } from './availableModels'
import { capabilityRecipeRunParamsSchema } from '../../../../electron/shared/agentCapabilities/creativeComponentSchemas'
import {
  listCapabilityRecipesForAgent,
  selectCapabilityRecipeTarget,
} from './capabilityRecipeAgent'

const entries = () => buildAgentModelEntries([
  {
    value: 'gpt-image-2',
    modelKey: 'gpt-image-2',
    modelAlias: 'GPT Image 2',
    label: 'GPT Image 2',
    vendor: 'openai',
    meta: { archetypeId: 'gpt-image-2' },
  },
  {
    value: 'hunyuan3d-v3.1',
    modelKey: 'hunyuan3d-v3.1',
    modelAlias: 'Hunyuan 3D',
    label: '混元3D',
    vendor: 'runninghub',
    meta: { archetypeId: 'hunyuan3d' },
  },
  {
    value: 'happyhorse',
    modelKey: 'happyhorse',
    modelAlias: 'HappyHorse 1.0',
    label: 'HappyHorse 1.0',
    vendor: 'kie',
    meta: { archetypeId: 'happyhorse' },
  },
  {
    value: 'jimeng-web-image',
    modelKey: 'jimeng-web-image',
    modelAlias: '即梦 Web 图片',
    label: '即梦 Web 图片',
    vendor: 'jimeng-web',
    meta: { archetypeId: 'jimeng-web-image' },
  },
])

function recipe(id: string) {
  const found = BUILTIN_CAPABILITY_RECIPES.find((item) => item.id === id)
  if (!found) throw new Error(`missing recipe ${id}`)
  return found
}

describe('listCapabilityRecipesForAgent', () => {
  it('lists only compatible modes and exposes native tiers', () => {
    const catalog = listCapabilityRecipesForAgent(entries())
    const multiview = catalog.find((item) => item.id === 'image.multiview.grid9')
    expect(multiview?.compatibleModels).toContainEqual(expect.objectContaining({
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      tier: 'experimental',
    }))
    expect(multiview?.compatibleModels.some((model) => model.modeId === 't2i')).toBe(false)

    const reconstruct = catalog.find((item) => item.id === 'image.multiview.reconstruct3d')
    expect(reconstruct?.compatibleModels).toContainEqual(expect.objectContaining({
      modelKey: 'hunyuan3d-v3.1',
      modeId: 'image',
      tier: 'native',
    }))

    const imageDrivenVideo = catalog.find((item) => item.id === 'video.look.apply')
    expect(imageDrivenVideo?.compatibleModels).toContainEqual(expect.objectContaining({
      modelKey: 'happyhorse',
      modeId: 'i2v',
    }))
    expect(imageDrivenVideo?.compatibleModels.some((model) => model.modeId === 'edit')).toBe(false)

    const videoEdit = catalog.find((item) => item.id === 'video.edit.look')
    expect(videoEdit?.compatibleModels).toEqual([
      expect.objectContaining({ modelKey: 'happyhorse', modeId: 'edit' }),
    ])
  })

  it('lists each compatible 即梦型号 separately with variant-specific params', () => {
    const catalog = listCapabilityRecipesForAgent(entries())
    const portrait = catalog.find((item) => item.id === 'portrait.refine')
    const lite = portrait?.compatibleModels.find((model) => (
      model.modelKey === 'jimeng-web-image' && model.variantId === 'v5_0_lite'
    ))
    const legacy = portrait?.compatibleModels.find((model) => (
      model.modelKey === 'jimeng-web-image' && model.variantId === 'v3_0'
    ))

    expect(lite).toMatchObject({
      modelLabel: '即梦 Web 图片 · 图片 5.0 Lite',
      modeId: 'edit',
      variantId: 'v5_0_lite',
    })
    expect(lite?.params.find((param) => param.key === 'resolution_type')?.options.map((option) => option.value))
      .toEqual(['2K', '4K'])
    expect(legacy).toBeUndefined()
  })
})

describe('selectCapabilityRecipeTarget', () => {
  const duplicated = () => {
    const entry = entries().find(item => item.modelId === 'gpt-image-2')!
    return [{ ...entry, vendor: 'apimart' }, { ...entry, vendor: 'kie' }]
  }

  it('accepts vendorKey through the actual strict tool argument boundary', () => {
    const args = { sourceNodeId: 'source', recipeId: 'portrait.refine', modelKey: 'gpt-image-2', vendorKey: 'kie' }
    expect(capabilityRecipeRunParamsSchema.strict().parse(args)).toEqual(args)
  })

  it('selects explicit and source identities by supplier/model pair in either catalog order', () => {
    for (const catalog of [duplicated(), duplicated().reverse()]) {
      expect(selectCapabilityRecipeTarget(recipe('portrait.refine'), catalog, {
        modelKey: 'gpt-image-2', vendorKey: 'kie', modeId: 'i2i',
      }).vendorKey).toBe('kie')
      expect(selectCapabilityRecipeTarget(recipe('portrait.refine'), catalog, {
        sourceModelKey: 'gpt-image-2', sourceVendorKey: 'kie', sourceModeId: 'i2i',
      }).vendorKey).toBe('kie')
    }
  })

  it('rejects ambiguous explicit, source and automatic choices instead of first-supplier wins', () => {
    for (const preference of [{ modelKey: 'gpt-image-2' }, { sourceModelKey: 'gpt-image-2' }, {}]) {
      expect(() => selectCapabilityRecipeTarget(recipe('portrait.refine'), duplicated(), preference)).toThrow()
    }
  })

  it('does not silently substitute a supplier for an explicit missing pair', () => {
    expect(() => selectCapabilityRecipeTarget(recipe('portrait.refine'), duplicated(), {
      modelKey: 'gpt-image-2', vendorKey: 'missing-vendor',
    })).toThrow()
    expect(() => selectCapabilityRecipeTarget(recipe('portrait.refine'), entries(), { vendorKey: 'kie' })).toThrow()
  })

  it('honors an explicit compatible model and mode', () => {
    const target = selectCapabilityRecipeTarget(recipe('image.multiview.reconstruct3d'), entries(), {
      modelKey: 'hunyuan3d-v3.1',
      modeId: 'image',
    })
    expect(target).toMatchObject({ modelKey: 'hunyuan3d-v3.1', modeId: 'image', tier: 'native' })
  })

  it('prefers the source model before another automatic candidate', () => {
    const target = selectCapabilityRecipeTarget(recipe('portrait.refine'), entries(), {
      sourceModelKey: 'gpt-image-2',
      sourceModeId: 'i2i',
    })
    expect(target).toMatchObject({ modelKey: 'gpt-image-2', modeId: 'i2i' })
  })

  it('rejects an explicit incompatible mode instead of silently switching it', () => {
    expect(() => selectCapabilityRecipeTarget(recipe('portrait.refine'), entries(), {
      modelKey: 'gpt-image-2',
      modeId: 't2i',
    })).toThrow('不兼容')
  })

  it('honors an explicit 即梦 variantId', () => {
    const target = selectCapabilityRecipeTarget(recipe('portrait.refine'), entries(), {
      modelKey: 'jimeng-web-image',
      variantId: 'v5_0_lite',
      modeId: 'edit',
    })

    expect(target).toMatchObject({
      modelKey: 'jimeng-web-image',
      variantId: 'v5_0_lite',
      modeId: 'edit',
    })
  })
})
