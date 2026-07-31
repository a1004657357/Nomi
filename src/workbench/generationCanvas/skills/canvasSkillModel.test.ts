import { describe, expect, it } from 'vitest'
import type { SkillListItemDto } from '../../api/skillApi'
import {
  buildCanvasSkillNodeState,
  encodeCanvasSkillDrag,
  isCanvasSkill,
  parseCanvasSkillDrag,
  recordCanvasSkillOutput,
  readCanvasSkillNodeState,
} from './canvasSkillModel'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const skill: SkillListItemDto = {
  directoryName: 'creative-multiview',
  name: 'creative.multiview',
  label: '多视角与 3D 重建',
  description: '生成多机位和 3D。',
  author: '@nomi',
  tools: ['read_canvas_state', 'apply_capability_recipe'],
  inputs: [{ name: 'source', description: '主体图片', required: true }],
  stages: [{
    id: 'views',
    goal: '生成身份一致的多视角',
    tools: ['apply_capability_recipe'],
    pause: true,
  }],
  stageLabels: ['生成身份一致的多视角'],
  isPlaybook: true,
  neededProviders: ['image', 'model3d'],
  manifestError: null,
  canvas: {
    recipeIds: ['image.multiview.grid9', 'image.multiview.reconstruct3d'],
    defaultRecipeId: 'image.multiview.grid9',
  },
  origin: 'builtin',
}

describe('canvasSkillModel', () => {
  it('builds a stable provider-independent node snapshot', () => {
    const state = buildCanvasSkillNodeState(skill)
    expect(isCanvasSkill(skill)).toBe(true)
    expect(state).toMatchObject({
      version: 1,
      skillKey: 'creative.multiview',
      neededProviders: ['image', 'model3d'],
      defaultRecipeId: 'image.multiview.grid9',
      outputNodeIds: [],
    })
    expect(state.stages[0]).toMatchObject({ id: 'views', pause: true })
  })

  it('round-trips the skill-library drag payload', () => {
    const parsed = parseCanvasSkillDrag(encodeCanvasSkillDrag(skill))
    expect(parsed).toMatchObject({
      name: skill.name,
      label: skill.label,
      canvas: skill.canvas,
    })
    expect(parseCanvasSkillDrag('{broken')).toBeNull()
  })

  it('normalizes persisted metadata and rejects non-skill nodes', () => {
    const state = buildCanvasSkillNodeState(skill)
    expect(readCanvasSkillNodeState({
      kind: 'skill',
      meta: { canvasSkill: state },
    })).toEqual(state)
    expect(readCanvasSkillNodeState({
      kind: 'image',
      meta: { canvasSkill: state },
    })).toBeNull()
  })

  it('appends generated outputs without replacing earlier skill results', () => {
    const state = {
      ...buildCanvasSkillNodeState(skill),
      outputNodeIds: ['legacy-output'],
    }
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{
        id: 'skill-node',
        kind: 'skill',
        title: skill.label,
        position: { x: 0, y: 0 },
        prompt: skill.description,
        categoryId: 'shots',
        meta: { canvasSkill: state },
      }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })

    recordCanvasSkillOutput({
      skillNodeId: 'skill-node',
      outputNodeId: 'new-output',
      recipeId: 'image.multiview.grid9',
      sourceNodeId: 'source-image',
    })
    recordCanvasSkillOutput({
      skillNodeId: 'skill-node',
      outputNodeId: 'new-output',
      recipeId: 'image.multiview.grid9',
      sourceNodeId: 'source-image',
    })

    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'skill-node')
    expect(node && readCanvasSkillNodeState(node)).toMatchObject({
      outputNodeIds: ['legacy-output', 'new-output'],
      lastRecipeId: 'image.multiview.grid9',
      lastSourceNodeId: 'source-image',
    })
  })
})
