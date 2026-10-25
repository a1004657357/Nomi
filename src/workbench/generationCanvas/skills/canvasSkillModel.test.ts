import { describe, expect, it } from 'vitest'
import type { SkillListItemDto } from '../../api/skillApi'
import {
  beginCanvasSkillStage,
  buildCanvasSkillNodeState,
  completeCanvasSkillStage,
  encodeCanvasSkillDrag,
  isCanvasSkill,
  parseCanvasSkillDrag,
  recordCanvasSkillOutput,
  readCanvasSkillNodeState,
  syncCanvasSkillStageFromHarness,
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
  packageVersion: 'nomi-skill-v1',
  contentHash: 'a'.repeat(64),
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
      currentStageIndex: 0,
      runStatus: 'ready',
    })
    expect(state.stages[0]).toMatchObject({ id: 'views', pause: true })
  })

  it('runs a playbook one stage at a time and waits between paused stages', () => {
    const stagedSkill: SkillListItemDto = {
      ...skill,
      stages: [
        { id: 'plan', goal: '先规划', tools: ['read_canvas_state'], pause: true },
        { id: 'build', goal: '再落画布', tools: ['create_canvas_nodes'], pause: true },
      ],
      stageLabels: ['先规划', '再落画布'],
    }
    const state = buildCanvasSkillNodeState(stagedSkill)
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{
        id: 'playbook-node',
        kind: 'skill',
        title: stagedSkill.label,
        position: { x: 0, y: 0 },
        prompt: stagedSkill.description ?? '',
        categoryId: 'shots',
        meta: { canvasSkill: state },
      }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })

    expect(beginCanvasSkillStage('playbook-node')).toMatchObject({ id: 'plan', index: 0, total: 2 })
    expect(readCanvasSkillNodeState(useGenerationCanvasStore.getState().nodes[0])?.runStatus).toBe('running')
    expect(beginCanvasSkillStage('playbook-node')).toBeNull()
    expect(completeCanvasSkillStage('playbook-node', 'plan')).toBe(true)
    expect(readCanvasSkillNodeState(useGenerationCanvasStore.getState().nodes[0])).toMatchObject({
      currentStageIndex: 1,
      runStatus: 'awaiting-confirm',
    })

    expect(beginCanvasSkillStage('playbook-node')).toMatchObject({ id: 'build', index: 1, total: 2 })
    expect(completeCanvasSkillStage('playbook-node', 'build')).toBe(true)
    expect(readCanvasSkillNodeState(useGenerationCanvasStore.getState().nodes[0])?.runStatus).toBe('done')
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

  it('uses backend harness stage metadata as the playbook authority', () => {
    const stagedSkill: SkillListItemDto = {
      ...skill,
      stages: [
        { id: 'contract', goal: '项目契约', tools: ['read_canvas_state'], pause: true },
        { id: 'shots', goal: '镜头', tools: ['create_canvas_nodes'], pause: false },
      ],
      stageLabels: ['项目契约', '镜头'],
    }
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{
        id: 'harness-skill',
        kind: 'skill',
        title: stagedSkill.label,
        position: { x: 0, y: 0 },
        prompt: stagedSkill.description ?? '',
        categoryId: 'shots',
        meta: { canvasSkill: buildCanvasSkillNodeState(stagedSkill) },
      }],
      edges: [],
      groups: [],
    })

    expect(beginCanvasSkillStage('harness-skill')).toMatchObject({ id: 'contract' })
    const harness = { stageId: 'contract', index: 0, total: 2, pause: true, nextStageId: 'shots' }
    expect(syncCanvasSkillStageFromHarness('harness-skill', harness)).toBe(true)
    expect(completeCanvasSkillStage('harness-skill', 'contract', harness)).toBe(true)
    expect(readCanvasSkillNodeState(useGenerationCanvasStore.getState().nodes[0])).toMatchObject({
      currentStageIndex: 1,
      runStatus: 'awaiting-confirm',
    })

    expect(syncCanvasSkillStageFromHarness('harness-skill', { ...harness, stageId: 'ghost' })).toBe(false)
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
