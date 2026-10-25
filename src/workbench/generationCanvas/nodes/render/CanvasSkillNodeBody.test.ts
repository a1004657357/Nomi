import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SkillListItemDto } from '../../../api/skillApi'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
} from '../../model/generationCanvasTypes'
import { buildCanvasSkillNodeState } from '../../skills/canvasSkillModel'
import CanvasSkillNodeBody from './CanvasSkillNodeBody'
import i18n from '../../../../i18n'

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
  packageVersion: 'nomi-skill-v1',
  contentHash: 'a'.repeat(64),
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

function renderBody(readOnly = false): string {
  return renderToStaticMarkup(React.createElement(CanvasSkillNodeBody, { node: skillNode, readOnly }))
}

function recipeButtonTag(markup: string): string {
  return markup.match(/<button[^>]*data-recipe-ready="(?:true|false)"[^>]*>/)?.[0] ?? ''
}

describe('CanvasSkillNodeBody recipe readiness', () => {
  const initialLanguage = i18n.language
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockCanvasStore.nodes = [skillNode]
    mockCanvasStore.edges = []
  })
  afterEach(async () => { await i18n.changeLanguage(initialLanguage) })

  it('shows the missing typed input and disables recipe configuration', () => {
    const markup = renderBody()
    expect(markup).toContain('data-recipe-ready="false"')
    expect(markup).toContain('缺图片')
    expect(markup).toContain('>配置</span>')
    expect(recipeButtonTag(markup)).toContain('aria-label="配置并运行 多机位九宫格"')
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

  it('localizes the built-in display name without rewriting node inputs or enabling missing input', async () => {
    const originalNode = JSON.stringify(skillNode)
    await i18n.changeLanguage('en')
    const markup = renderBody()
    expect(markup).toContain('>Configure</span>')
    expect(recipeButtonTag(markup)).toContain('aria-label="Configure and run Nine-view camera grid"')
    expect(recipeButtonTag(markup)).toContain('disabled=""')
    expect(JSON.stringify(skillNode)).toBe(originalNode)
  })

  it('does not accept a connected video as the required image', () => {
    mockCanvasStore.nodes = [skillNode, { ...imageNode, kind: 'video', result: { ...imageNode.result!, type: 'video' } }]
    mockCanvasStore.edges = [{ id: 'wrong-media', source: imageNode.id, target: skillNode.id, mode: 'reference', order: 0 }]
    const markup = renderBody()
    expect(markup).toContain('data-recipe-ready="false"')
    expect(recipeButtonTag(markup)).toContain('disabled=""')
  })

  it('keeps a valid recipe disabled on a read-only surface', () => {
    mockCanvasStore.nodes = [imageNode, skillNode]
    mockCanvasStore.edges = [{ id: 'read-only', source: imageNode.id, target: skillNode.id, mode: 'reference', order: 0 }]
    const markup = renderBody(true)
    expect(markup).toContain('data-recipe-ready="true"')
    expect(recipeButtonTag(markup)).toContain('disabled=""')
  })
})
