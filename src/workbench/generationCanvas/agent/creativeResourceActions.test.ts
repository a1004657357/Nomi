import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { saveNodeAsCreativeResource } from './creativeResourceActions'

beforeEach(() => {
  const source: GenerationCanvasNode = {
    id: 'source-1', kind: 'image', title: '人物原图', prompt: 'portrait', position: { x: 100, y: 100 },
    categoryId: 'shots', status: 'success',
    result: { id: 'result-1', type: 'image', url: 'nomi-local://portrait.png', assetId: 'asset-1', createdAt: 1 },
  }
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [], selectedNodeIds: [] })
})

describe('saveNodeAsCreativeResource', () => {
  it('creates a reusable resource node while leaving the source unchanged', () => {
    const saved = saveNodeAsCreativeResource('source-1', {
      kind: 'identity',
      label: '女主身份锁',
      description: '保持脸型、五官比例与发型',
      promptTokens: ['same identity', 'preserve facial geometry'],
      license: { source: '用户自有素材', commercialUse: 'allowed' },
    }, 100)

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'source-1')
    const resource = state.nodes.find((node) => node.id === saved.nodeId)
    expect(source?.kind).toBe('image')
    expect(source?.creativeResource).toBeUndefined()
    expect(resource).toMatchObject({
      kind: 'resource',
      title: '女主身份锁',
      categoryId: 'scene',
      result: { id: 'result-1' },
      creativeResource: {
        kind: 'identity',
        label: '女主身份锁',
        assetIds: ['asset-1'],
        createdAt: 100,
        updatedAt: 100,
      },
    })
  })

  it('requires a source result for visual resource kinds', () => {
    useGenerationCanvasStore.getState().updateNode('source-1', { result: undefined })
    expect(() => saveNodeAsCreativeResource('source-1', {
      kind: 'style', label: '风格', promptTokens: [], license: { commercialUse: 'unknown' },
    }, 100)).toThrow('先生成或导入')
  })
})
