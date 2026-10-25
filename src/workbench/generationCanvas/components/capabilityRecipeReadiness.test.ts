import { describe, expect, it } from 'vitest'
import { BUILTIN_CAPABILITY_RECIPES } from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  capabilityRecipeInputReadiness,
  isCreativeResourceCandidate,
} from './capabilityRecipeReadiness'

const imageSource: GenerationCanvasNode = {
  id: 'source', kind: 'image', title: '源图', prompt: 'portrait', position: { x: 0, y: 0 },
  result: { id: 'result', type: 'image', url: 'nomi-local://source.png', createdAt: 1 },
}

const videoSource: GenerationCanvasNode = {
  ...imageSource,
  id: 'source-video',
  kind: 'video',
  title: '源视频',
  result: { id: 'video-result', type: 'video', url: 'nomi-local://source.mp4', createdAt: 1 },
}

function resource(id: string, kind: 'style' | 'palette' | 'identity' | 'effect'): GenerationCanvasNode {
  return {
    id, kind: 'resource', title: id, prompt: kind, position: { x: 0, y: 0 },
    result: { id: `${id}-result`, type: 'image', url: `nomi-local://${id}.png`, createdAt: 1 },
    creativeResource: {
      id, kind, label: id, promptTokens: [kind], assetIds: [], createdAt: 1, updatedAt: 1,
    },
  }
}

describe('capability recipe UI readiness', () => {
  it('treats style and palette resources as valid candidates for style transfer', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.style.transfer')!
    expect(isCreativeResourceCandidate(recipe, resource('style', 'style'))).toBe(true)
    expect(isCreativeResourceCandidate(recipe, resource('palette', 'palette'))).toBe(true)
    expect(isCreativeResourceCandidate(recipe, resource('identity', 'identity'))).toBe(false)
  })

  it('blocks generation before confirmation until required resources are selected', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'image.style.transfer')!
    expect(capabilityRecipeInputReadiness(recipe, imageSource, [])).toEqual({
      ready: false,
      message: '至少选择 1 个风格或色板资源',
    })
    expect(capabilityRecipeInputReadiness(recipe, imageSource, [resource('palette', 'palette')])).toEqual({ ready: true })
  })

  it('requires an image source for image-to-video look and effect recipes', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'video.effect.reference')!
    const textSource: GenerationCanvasNode = { ...imageSource, kind: 'text', result: undefined }
    expect(capabilityRecipeInputReadiness(recipe, textSource, [resource('effect', 'effect')])).toEqual({
      ready: false,
      message: '源节点需要一张已生成或导入的图片',
    })
  })

  it('requires a video source for video-to-video look and effect recipes', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'video.edit.effect')!
    expect(capabilityRecipeInputReadiness(recipe, imageSource, [resource('effect', 'effect')])).toEqual({
      ready: false,
      message: '源节点需要一个已生成或导入的视频',
    })
    expect(capabilityRecipeInputReadiness(recipe, videoSource, [resource('effect', 'effect')])).toEqual({ ready: true })
  })

  it('does not show resources for recipes without resource inputs', () => {
    const recipe = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === 'portrait.refine')!
    expect(isCreativeResourceCandidate(recipe, resource('style', 'style'))).toBe(false)
    expect(capabilityRecipeInputReadiness(recipe, imageSource, [])).toEqual({ ready: true })
  })
})
