import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  GENERATION_NODE_STATUSES,
  generationNodeStatusSchema as sharedGenerationNodeStatusSchema,
  type GenerationNodeStatus as SharedGenerationNodeStatus,
} from '../../../../electron/shared/canvas/generationNodeStatus'
import {
  generationCanvasNodeSchema,
  generationCanvasSnapshotSchema,
  generationNodeRunStatusSchema,
  generationNodeStatusSchema,
  nodeGroupSchema,
} from './generationCanvasSchema'
import type { GenerationNodeStatus } from './generationCanvasTypes'
import { normalizeGenerationCanvasSnapshot } from '../../workbenchPersistence'

const legacySnapshot = {
  nodes: [
    {
      id: 'node-1',
      kind: 'shot',
      title: '分镜 1',
      position: { x: 10, y: 20 },
      categoryId: 'shots',
    },
  ],
  edges: [],
  selectedNodeIds: ['node-1'],
}

describe('generationCanvasSchema Phase E.2 groups', () => {
  it('projects the neutral shared generation status contract without copying its members', () => {
    expect(generationNodeStatusSchema).toBe(sharedGenerationNodeStatusSchema)
    expectTypeOf<GenerationNodeStatus>().toEqualTypeOf<SharedGenerationNodeStatus>()

    for (const status of GENERATION_NODE_STATUSES) {
      expect(generationCanvasNodeSchema.parse({ ...legacySnapshot.nodes[0], status }).status).toBe(status)
    }

    const runStatuses = GENERATION_NODE_STATUSES.filter((status) => status !== 'idle')
    for (const status of [...runStatuses, 'cancelled'] as const) {
      expect(generationNodeRunStatusSchema.parse(status)).toBe(status)
    }
    expect(generationNodeRunStatusSchema.safeParse('idle').success).toBe(false)
  })

  it('defaults missing groups to an empty array for legacy snapshots', () => {
    expect(generationCanvasSnapshotSchema.parse(legacySnapshot).groups).toEqual([])
    expect(normalizeGenerationCanvasSnapshot(legacySnapshot).groups).toEqual([])
  })

  it('validates node groups with category ids and optional frame metadata', () => {
    const parsed = nodeGroupSchema.parse({
      id: 'group-1',
      name: '角色组',
      categoryId: 'cast',
      nodeIds: ['node-1', 'node-2'],
      color: '#7C3AED',
      frameBounds: { x: 0, y: 0, w: 640, h: 360 },
      collapsed: false,
      createdAt: 100,
      updatedAt: 200,
    })

    expect(parsed).toMatchObject({
      id: 'group-1',
      name: '角色组',
      categoryId: 'cast',
      nodeIds: ['node-1', 'node-2'],
    })
    expect(() => nodeGroupSchema.parse({ ...parsed, categoryId: 'legacy' })).toThrow()
  })

  it('preserves optional group input/output declarations while old groups remain valid', () => {
    const base = {
      id: 'group-links',
      name: '参考组',
      categoryId: 'shots',
      nodeIds: ['image-a', 'image-b'],
      createdAt: 100,
      updatedAt: 200,
    }
    expect(nodeGroupSchema.parse(base).outputLinks).toBeUndefined()
    expect(nodeGroupSchema.parse({
      ...base,
      inputLinks: [{ sourceNodeId: 'style-source' }],
      outputLinks: [{ targetNodeId: 'generation-target' }],
    })).toMatchObject({
      inputLinks: [{ sourceNodeId: 'style-source' }],
      outputLinks: [{ targetNodeId: 'generation-target' }],
    })
  })

  it('preserves node groupId and derivedFrom while validating category ids', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'node-2',
      kind: 'image',
      title: '画面',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      groupId: 'group-1',
      derivedFrom: 'node-1',
    })

    expect(parsed.groupId).toBe('group-1')
    expect(parsed.derivedFrom).toBe('node-1')
    expect(() => generationCanvasNodeSchema.parse({ ...parsed, categoryId: 'legacy' })).toThrow()
  })

  it('preserves Tiptap contentJson and accepts legacy nodes without it (C5)', () => {
    const withDoc = generationCanvasNodeSchema.parse({
      id: 'text-1',
      kind: 'text',
      title: '文本',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(withDoc.contentJson).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })

    // Legacy node without contentJson still parses; field stays undefined.
    const legacy = generationCanvasNodeSchema.parse({
      id: 'text-2',
      kind: 'text',
      title: '文本',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
    })
    expect(legacy.contentJson).toBeUndefined()
  })

  it('preserves director project data in node meta', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'director-1',
      kind: 'director',
      title: '导演台',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      meta: {
        directorProject: {
          trajectories: [
            {
              id: 'trajectory-1',
              name: '轨迹1',
              points: [
                { id: 'point-1', position: [0, 0, 0] },
                { id: 'point-2', position: [2, 0, 1] },
              ],
              curveControls: [{ segmentStartPointId: 'point-1', position: [1, 0, 1] }],
              tension: 0.5,
              closed: false,
              color: '#ef4444',
            },
          ],
          trajectoryBindings: [],
          trajectoryGroups: [{ id: 'group-1', name: '组1', trajectoryIds: ['trajectory-1'] }],
          sceneTimeline: { totalDuration: 3 },
        },
      },
    })

    expect(parsed.meta?.directorProject).toMatchObject({
      trajectories: [expect.objectContaining({ id: 'trajectory-1' })],
      trajectoryGroups: [expect.objectContaining({ id: 'group-1' })],
      sceneTimeline: { totalDuration: 3 },
    })
  })

  it('preserves creative resources and multi-result collections while legacy nodes remain valid', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'multi-view-1',
      kind: 'image',
      title: '多机位九宫格',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      creativeResource: {
        id: 'style-1',
        kind: 'style',
        label: '自然电影',
        promptTokens: ['自然肤质'],
        assetIds: [],
        createdAt: 10,
        updatedAt: 10,
      },
      resultCollections: [{
        id: 'collection-1',
        recipeId: 'image.multiview.grid9',
        createdAt: 20,
        quality: {
          version: 1,
          kind: 'grid9',
          evaluator: 'grid9-local-v1',
          status: 'warning',
          evaluatedAt: 21,
          checks: [{
            id: 'view-diversity',
            label: '视角差异',
            status: 'warning',
            summary: '发现 1 组近似重复视角',
            itemIds: ['front', 'right'],
            metrics: { duplicatePairCount: 1 },
          }],
          metrics: { successfulImageCount: 9 },
          humanReview: {
            verdict: 'rejected',
            reviewedAt: 22,
            note: '背面机位主体已经漂移',
          },
        },
        items: [{
          id: 'front',
          label: '正面',
          azimuth: 0,
          elevation: 0,
          status: 'success',
          result: { id: 'result-front', type: 'image', url: 'nomi-local://front.png', createdAt: 20 },
          selectedResultId: 'result-front',
          candidates: [
            {
              id: 'result-front',
              type: 'image',
              url: 'nomi-local://front.png',
              providerUrl: 'https://provider.example/front.png',
              createdAt: 20,
            },
            { id: 'result-front-2', type: 'image', url: 'nomi-local://front-2.png', createdAt: 20 },
          ],
        }],
      }],
    })

    expect(parsed.creativeResource?.kind).toBe('style')
    expect(parsed.resultCollections?.[0]?.items[0]?.azimuth).toBe(0)
    expect(parsed.resultCollections?.[0]?.items[0]?.selectedResultId).toBe('result-front')
    expect(parsed.resultCollections?.[0]?.items[0]?.candidates).toHaveLength(2)
    expect(parsed.resultCollections?.[0]?.items[0]?.candidates?.[0]?.providerUrl).toBe(
      'https://provider.example/front.png',
    )
    expect(parsed.resultCollections?.[0]?.quality?.checks[0]?.metrics?.duplicatePairCount).toBe(1)
    expect(parsed.resultCollections?.[0]?.quality?.humanReview).toEqual({
      verdict: 'rejected',
      reviewedAt: 22,
      note: '背面机位主体已经漂移',
    })

    const legacy = generationCanvasNodeSchema.parse({
      id: 'legacy-image', kind: 'image', title: '旧图片', position: { x: 0, y: 0 }, categoryId: 'shots',
    })
    expect(legacy.creativeResource).toBeUndefined()
    expect(legacy.resultCollections).toBeUndefined()
  })

  it('keeps quality reports without a human review valid for legacy projects', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'legacy-quality',
      kind: 'image',
      title: '旧质量报告',
      position: { x: 0, y: 0 },
      resultCollections: [{
        id: 'legacy-collection',
        recipeId: 'portrait.refine',
        createdAt: 20,
        items: [],
        quality: {
          version: 1,
          kind: 'portrait',
          evaluator: 'portrait-local-v1',
          status: 'unavailable',
          evaluatedAt: 21,
          checks: [],
        },
      }],
    })

    expect(parsed.resultCollections?.[0]?.quality?.humanReview).toBeUndefined()
  })

  it('preserves portrait comparison provenance and mood coordinates', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'mood-matrix',
      kind: 'image',
      title: '5x5 情绪矩阵',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      resultCollections: [{
        id: 'mood-run',
        recipeId: 'portrait.mood',
        createdAt: 20,
        source: {
          nodeId: 'portrait-source',
          resultId: 'source-result',
          label: '原始人像',
          url: 'nomi-local://source.png',
          thumbnailUrl: 'nomi-local://source-thumb.png',
        },
        items: [{
          id: 'mood-e4-a0',
          label: '能量 4 · 亲和 0',
          energy: 4,
          affinity: 0,
          status: 'success',
          result: { id: 'mood-result', type: 'image', url: 'nomi-local://mood.png', createdAt: 20 },
        }],
      }],
    })

    expect(parsed.resultCollections?.[0]?.source?.resultId).toBe('source-result')
    expect(parsed.resultCollections?.[0]?.items[0]).toMatchObject({ energy: 4, affinity: 0 })
  })
})
