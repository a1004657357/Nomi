import { describe, expect, it } from 'vitest'
import { BUILTIN_CAPABILITY_RECIPES } from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode, GenerationResultType } from '../model/generationCanvasTypes'
import { resolveCanvasSkillRecipeBinding } from './canvasSkillRecipeBinding'

function recipe(id: string) {
  return BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === id)!
}

function source(
  id: string,
  type: GenerationResultType | null,
  prompt = '',
): GenerationCanvasNode {
  return {
    id,
    kind: type === 'video' ? 'video' : type === 'text' ? 'text' : type === 'model3d' ? 'model3d' : 'image',
    title: id,
    prompt,
    position: { x: 0, y: 0 },
    ...(type
      ? { result: { id: `${id}-result`, type, url: `nomi-local://${id}`, createdAt: 1 } }
      : {}),
  }
}

function resource(
  id: string,
  kind: 'style' | 'palette' | 'identity' | 'effect',
): GenerationCanvasNode {
  return {
    ...source(id, 'image'),
    kind: 'resource',
    creativeResource: {
      id,
      kind,
      label: id,
      promptTokens: [],
      assetIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  }
}

describe('canvas Skill recipe input binding', () => {
  it('reports a missing image until a multiview source is connected', () => {
    expect(resolveCanvasSkillRecipeBinding(recipe('image.multiview.grid9'), [])).toMatchObject({
      source: null,
      resources: [],
      ready: false,
      statusLabel: '缺图片',
    })

    const image = source('portrait', 'image')
    expect(resolveCanvasSkillRecipeBinding(recipe('image.multiview.grid9'), [image])).toMatchObject({
      source: image,
      resources: [],
      ready: true,
      statusLabel: '已就绪',
    })
  })

  it('keeps style transfer blocked until a matching style or palette resource is connected', () => {
    const image = source('target', 'image')
    const identity = resource('identity', 'identity')
    expect(resolveCanvasSkillRecipeBinding(
      recipe('image.style.transfer'),
      [identity, image],
    )).toMatchObject({
      source: image,
      resources: [],
      ready: false,
      statusLabel: '缺风格或色板',
    })

    const palette = resource('palette', 'palette')
    expect(resolveCanvasSkillRecipeBinding(
      recipe('image.style.transfer'),
      [identity, image, palette],
    )).toMatchObject({
      source: image,
      resources: [palette],
      ready: true,
      statusLabel: '已就绪',
    })
  })

  it('distinguishes image-driven video from real source-video editing', () => {
    const image = source('frame', 'image')
    const video = source('clip', 'video')
    const style = resource('look', 'style')

    expect(resolveCanvasSkillRecipeBinding(
      recipe('video.look.apply'),
      [video, style, image],
    )).toMatchObject({
      source: image,
      resources: [style],
      ready: true,
      statusLabel: '已就绪',
    })
    expect(resolveCanvasSkillRecipeBinding(
      recipe('video.edit.look'),
      [image, style],
    )).toMatchObject({
      source: null,
      resources: [style],
      ready: false,
      statusLabel: '缺视频',
    })
    expect(resolveCanvasSkillRecipeBinding(
      recipe('video.edit.look'),
      [image, style, video],
    )).toMatchObject({
      source: video,
      resources: [style],
      ready: true,
      statusLabel: '已就绪',
    })
  })

  it('requires the matching effect resource instead of accepting any resource', () => {
    const image = source('frame', 'image')
    const style = resource('look', 'style')
    const effect = resource('motion', 'effect')

    expect(resolveCanvasSkillRecipeBinding(
      recipe('video.effect.reference'),
      [image, style],
    )).toMatchObject({
      source: image,
      resources: [],
      ready: false,
      statusLabel: '缺效果',
    })
    expect(resolveCanvasSkillRecipeBinding(
      recipe('video.effect.reference'),
      [image, style, effect],
    )).toMatchObject({
      source: image,
      resources: [effect],
      ready: true,
      statusLabel: '已就绪',
    })
  })

  it('uses a connected text brief or image as the panorama anchor', () => {
    expect(resolveCanvasSkillRecipeBinding(recipe('scene.panorama.2to1'), [])).toMatchObject({
      source: null,
      ready: false,
      statusLabel: '缺文字或图片',
    })

    const brief = source('brief', null, '雨夜街道，全景环境')
    expect(resolveCanvasSkillRecipeBinding(recipe('scene.panorama.2to1'), [brief])).toMatchObject({
      source: brief,
      ready: true,
      statusLabel: '已就绪',
    })

    const image = source('scene', 'image')
    expect(resolveCanvasSkillRecipeBinding(recipe('scene.panorama.2to1'), [image])).toMatchObject({
      source: image,
      ready: true,
      statusLabel: '已就绪',
    })
  })
})
