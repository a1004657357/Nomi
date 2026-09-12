import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SkillListItemDto } from '../../../api/skillApi'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
} from '../../model/generationCanvasTypes'
import { buildCanvasSkillNodeState } from '../../skills/canvasSkillModel'
import CanvasSkillNodeBody from './CanvasSkillNodeBody'

const mockCanvasStore = vi.hoisted(() => ({
  nodes: [] as GenerationCanvasNode[],
  edges: [] as GenerationCanvasEdge[],
}))

vi.mock('../../store/generationCanvasStore', () => {
  const useGenerationCanvasStore = (
    selector: (state: typeof mockCanvasStore) => unknown,
  ): unknown => selector(mockCanvasStore)
  useGenerationCanvasStore.getState = () => mockCanvasStore
  return { useGenerationCanvasStore }
})

const skill: SkillListItemDto = {
  directoryName: 'creative-multiview',
  name: 'creative.multiview',
  label: '多视角与 3D 重建',
  description: '生成多机位和 3D。',
  author: '@nomi',
  tools: ['apply_capability_recipe'],
  inputs: [{ name: 'source', description: '主体图片', required: true }],
  stages: [],
  stageLabels: [],
  isPlaybook: true,
  neededProviders: ['image', 'model3d'],
  manifestError: null,
  canvas: {
    recipeIds: ['image.multiview.grid9'],
    defaultRecipeId: 'image.multiview.grid9',
  },
  origin: 'builtin',
}

const skillNode: GenerationCanvasNode = {
  id: 'skill-node',
  kind: 'skill',
  title: skill.label,
  prompt: skill.description ?? '',
  position: { x: 0, y: 0 },
  categoryId: 'shots',
  meta: { canvasSkill: buildCanvasSkillNodeState(skill) },
}

const imageNode: GenerationCanvasNode = {
  id: 'image-node',
  kind: 'image',
  title: '人物源图',
  prompt: '',
  position: { x: 0, y: 0 },
  categoryId: 'shots',
  result: {
    id: 'image-result',
    type: 'image',
    url: 'nomi-local://asset/source.png',
    createdAt: 1,
  },
}

function renderBody(): string {
  return renderToStaticMarkup(React.createElement(CanvasSkillNodeBody, { node: skillNode }))
}

function recipeButtonTag(markup: string): string {
  return markup.match(/<button[^>]*aria-label="配置并运行 多机位九宫格"[^>]*>/)?.[0] ?? ''
}

describe('CanvasSkillNodeBody recipe readiness', () => {
  beforeEach(() => {
    mockCanvasStore.nodes = [skillNode]
    mockCanvasStore.edges = []
  })

  it('shows the missing typed input and disables recipe configuration', () => {
    const markup = renderBody()
    expect(markup).toContain('data-recipe-ready="false"')
    expect(markup).toContain('缺图片')
    expect(markup).toContain('>配置并运行</span>')
    expect(recipeButtonTag(markup)).toContain('disabled=""')
  })

  it('shows ready and enables recipe configuration after a matching edge is connected', () => {
    mockCanvasStore.nodes = [imageNode, skillNode]
    mockCanvasStore.edges = [{
      id: 'edge-image-node-skill-node-reference',
      source: imageNode.id,
      target: skillNode.id,
      mode: 'reference',
      order: 0,
    }]

    const markup = renderBody()
    expect(markup).toContain('data-recipe-ready="true"')
    expect(markup).toContain('已就绪')
    expect(recipeButtonTag(markup)).not.toContain('disabled=""')
  })
})
