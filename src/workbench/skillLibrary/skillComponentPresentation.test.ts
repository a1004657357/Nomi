import { describe, expect, it } from 'vitest'
import type { SkillListItemDto } from '../api/skillApi'
import {
  buildBuiltinCanvasComponentItems,
  canvasSkillComponentPresentation,
  defaultSkillLibrarySource,
  skillLibrarySourceOptions,
} from './skillComponentPresentation'

function skill(
  name: string,
  recipeIds: string[],
  neededProviders: SkillListItemDto['neededProviders'],
): Pick<SkillListItemDto, 'name' | 'canvas' | 'neededProviders'> {
  return {
    name,
    canvas: { recipeIds, defaultRecipeId: recipeIds[0] ?? null },
    neededProviders,
  }
}

function fullSkill(input: {
  directoryName: string
  name: string
  label: string
  recipeIds: string[]
  neededProviders: SkillListItemDto['neededProviders']
  origin?: SkillListItemDto['origin']
  canvas?: SkillListItemDto['canvas']
}): SkillListItemDto {
  return {
    directoryName: input.directoryName,
    name: input.name,
    label: input.label,
    description: `${input.label} 的父技能说明`,
    author: '@nomi',
    tools: ['apply_capability_recipe'],
    inputs: [],
    stages: [],
    stageLabels: [],
    isPlaybook: true,
    neededProviders: input.neededProviders,
    manifestError: null,
    canvas: input.canvas === undefined
      ? { recipeIds: input.recipeIds, defaultRecipeId: input.recipeIds[0] ?? null }
      : input.canvas,
    origin: input.origin ?? 'builtin',
    packageVersion: 'nomi-skill-v1',
    contentHash: 'a'.repeat(64),
  }
}

describe('skill component presentation', () => {
  it('opens the docked canvas component palette on built-in components', () => {
    expect(defaultSkillLibrarySource({ componentFirst: true })).toBe('builtin')
    expect(skillLibrarySourceOptions({ componentFirst: true })).toEqual([
      { value: 'builtin', label: '内置组件' },
      { value: 'mine', label: '我的技能' },
    ])
  })

  it('keeps the standalone skill library focused on user skills', () => {
    expect(defaultSkillLibrarySource({ componentFirst: false })).toBe('mine')
    expect(skillLibrarySourceOptions({ componentFirst: false })).toEqual([
      { value: 'mine', label: '我的技能' },
      { value: 'builtin', label: 'Nomi 内置' },
    ])
  })

  it('presents built-in canvas skills as domain components', () => {
    expect(canvasSkillComponentPresentation(skill(
      'creative.panorama',
      ['scene.panorama.2to1'],
      ['image'],
    ))).toMatchObject({ kind: 'scene', label: '场景组件' })

    expect(canvasSkillComponentPresentation(skill(
      'creative.video-look-effect',
      ['video.look.apply', 'video.edit.look'],
      ['video'],
    ))).toMatchObject({ kind: 'video', label: '视频组件' })

    expect(canvasSkillComponentPresentation(skill(
      'creative.multiview',
      ['image.multiview.grid9'],
      ['image'],
    ))).toMatchObject({ kind: 'multiview', label: '多视角组件' })

    expect(canvasSkillComponentPresentation(skill(
      'creative.multiview',
      ['image.multiview.reconstruct3d'],
      ['model3d'],
    ))).toMatchObject({ kind: 'model3d', label: '3D 组件' })

    expect(canvasSkillComponentPresentation(skill(
      'creative.portrait-realism',
      ['portrait.refine'],
      ['image'],
    ))).toMatchObject({ kind: 'image', label: '图像组件' })

    expect(canvasSkillComponentPresentation(skill(
      'brand.promo',
      [],
      ['text', 'image', 'video'],
    ))).toMatchObject({ kind: 'workflow', label: '工作流组件' })
  })

  it('expands built-in playbooks into atomic recipe components while preserving workflow templates', () => {
    const items = buildBuiltinCanvasComponentItems([
      fullSkill({
        directoryName: 'brand-promo',
        name: 'brand.promo',
        label: '品牌宣传片',
        recipeIds: [],
        neededProviders: ['text', 'image', 'video'],
      }),
      fullSkill({
        directoryName: 'creative-multiview',
        name: 'creative.multiview',
        label: '多视角与 3D 重建',
        recipeIds: [
          'image.multiview.grid9',
          'image.multiview.custom',
          'image.multiview.reconstruct3d',
        ],
        neededProviders: ['image', 'model3d'],
      }),
      fullSkill({
        directoryName: 'creative-video-look-effect',
        name: 'creative.video-look-effect',
        label: '视频风格与效果',
        recipeIds: [
          'video.look.apply',
          'video.effect.reference',
          'video.edit.look',
          'video.edit.effect',
        ],
        neededProviders: ['video'],
      }),
      fullSkill({
        directoryName: 'internal-only',
        name: 'internal.only',
        label: '幕后技能',
        recipeIds: [],
        neededProviders: ['text'],
        canvas: null,
      }),
      fullSkill({
        directoryName: 'user-component',
        name: 'user.component',
        label: '用户组件',
        recipeIds: ['portrait.refine'],
        neededProviders: ['image'],
        origin: 'user',
      }),
    ])

    expect(items.map((item) => item.id)).toEqual([
      'brand-promo::workflow',
      'creative-multiview::image.multiview.grid9',
      'creative-multiview::image.multiview.custom',
      'creative-multiview::image.multiview.reconstruct3d',
      'creative-video-look-effect::video.look.apply',
      'creative-video-look-effect::video.effect.reference',
      'creative-video-look-effect::video.edit.look',
      'creative-video-look-effect::video.edit.effect',
    ])

    const grid9 = items.find((item) => item.recipeId === 'image.multiview.grid9')!
    expect(grid9.skill).toMatchObject({
      name: 'creative.multiview',
      label: '多机位九宫格',
      neededProviders: ['image'],
      stages: [],
      stageLabels: [],
      isPlaybook: false,
      canvas: {
        recipeIds: ['image.multiview.grid9'],
        defaultRecipeId: 'image.multiview.grid9',
      },
    })
    expect(grid9.skill.description).toContain('九个')

    const reconstruct3d = items.find((item) => item.recipeId === 'image.multiview.reconstruct3d')!
    expect(reconstruct3d.skill).toMatchObject({
      label: '图片转 3D',
      neededProviders: ['model3d'],
    })

    const videoEdit = items.find((item) => item.recipeId === 'video.edit.effect')!
    expect(videoEdit.skill).toMatchObject({
      label: '视频转视频·时序效果',
      neededProviders: ['video'],
    })

    const workflow = items.find((item) => item.recipeId === null)!
    expect(workflow.skill).toMatchObject({
      label: '品牌宣传片',
      canvas: { recipeIds: [] },
    })
  })
})
