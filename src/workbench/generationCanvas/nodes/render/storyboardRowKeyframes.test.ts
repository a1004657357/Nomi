import { beforeEach, describe, expect, it } from 'vitest'
import type { PlanShot } from '../../agent/storyboardPlan'
import { buildDependencyWaves } from '../../runner/dependencyWaves'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { __resetCanvasUndoJournalForTests } from '../../events/canvasUndoJournal'
import { ensureStoryboardRowKeyframes } from './storyboardRowKeyframes'

const shot: PlanShot = {
  index: 3,
  shotKind: 'video',
  durationSec: 8,
  anchorIds: [],
  prompt: '老板拿起月饼盒，转身递给顾客',
  imagePrompt: '老板站在月饼店柜台后',
  videoPrompt: '老板先拿起月饼盒，确认标签后转身递给顾客，顾客伸手接住，镜头轻微跟随右移。',
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

function seedTable() {
  return useGenerationCanvasStore.getState().addNode({
    kind: 'text',
    title: '月饼广告分镜',
    position: { x: 80, y: 60 },
    size: { width: 1680, height: 920 },
    categoryId: 'shots',
    meta: { storyboardGroup: true },
  })
}

function seedStoryboardImage() {
  return useGenerationCanvasStore.getState().addNode({
    kind: 'image',
    title: '镜头 3 · 图片',
    position: { x: 1800, y: 520 },
    categoryId: 'shots',
    select: false,
    meta: {
      modelKey: 'codex-img2',
      modelAlias: 'codex-img2',
      archetype: { id: 'gpt-image-2', modeId: 'i2i' },
      aspect_ratio: '9:16',
      resolution: '2K',
      storyboardContainedByNodeId: 'old-table',
      storyboardContainedRole: 'image',
      referenceImageUrls: ['https://stale.example/old.png'],
    },
  })
}

describe('storyboard row 5+3 second keyframes', () => {
  it('creates t=5 and t=8 image keyframes with sequential reference dependencies', () => {
    const tableNode = seedTable()
    const sourceImage = seedStoryboardImage()
    useGenerationCanvasStore.getState().addNodeResult(sourceImage.id, {
      id: 'source-result',
      type: 'image',
      url: 'https://cdn.example/storyboard.png',
      createdAt: 1,
    })

    const result = ensureStoryboardRowKeyframes({ tableNode, shot, sourceImageNode: sourceImage })
    const state = useGenerationCanvasStore.getState()
    const boundary = state.nodes.find((node) => node.id === result.boundaryNodeId)!
    const ending = state.nodes.find((node) => node.id === result.endNodeId)!

    expect(result.createdCount).toBe(2)
    expect(boundary).toMatchObject({
      kind: 'keyframe',
      title: '镜头 3 · 5秒动作帧',
      meta: {
        modelKey: 'codex-img2',
        aspect_ratio: '9:16',
        resolution: '2K',
        storyboardKeyframeRole: 'boundary',
        storyboardKeyframeTimeSec: 5,
        excludeFromShotNumbering: true,
      },
    })
    expect(ending).toMatchObject({
      kind: 'keyframe',
      title: '镜头 3 · 8秒结尾帧',
      meta: {
        storyboardKeyframeRole: 'end',
        storyboardKeyframeTimeSec: 8,
        excludeFromShotNumbering: true,
      },
    })
    expect(boundary.shotIndex).toBeUndefined()
    expect(ending.shotIndex).toBeUndefined()
    expect(boundary.meta).not.toHaveProperty('storyboardContainedByNodeId')
    expect(boundary.meta).not.toHaveProperty('referenceImageUrls')
    expect(boundary.prompt).toContain('第 5 秒')
    expect(boundary.prompt).toContain(shot.videoPrompt)
    expect(ending.prompt).toContain('第 8 秒')
    expect(ending.prompt).toContain('后续 3 秒')
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: sourceImage.id,
      target: boundary.id,
      mode: 'reference',
    }))
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: boundary.id,
      target: ending.id,
      mode: 'reference',
    }))

    const plan = buildDependencyWaves(result.nodeIds, { nodes: state.nodes, edges: state.edges })
    expect(plan.waves).toEqual([[boundary.id], [ending.id]])
    expect(plan.blocked).toEqual([])
  })

  it('is idempotent until the generated nodes are explicitly versioned', () => {
    const tableNode = seedTable()
    const sourceImage = seedStoryboardImage()
    useGenerationCanvasStore.getState().addNodeResult(sourceImage.id, {
      id: 'source-result',
      type: 'image',
      url: 'https://cdn.example/storyboard.png',
      createdAt: 1,
    })

    const first = ensureStoryboardRowKeyframes({ tableNode, shot, sourceImageNode: sourceImage })
    const second = ensureStoryboardRowKeyframes({ tableNode, shot, sourceImageNode: sourceImage })

    expect(second.nodeIds).toEqual(first.nodeIds)
    expect(second.createdCount).toBe(0)
    expect(useGenerationCanvasStore.getState().nodes.filter((node) => node.kind === 'keyframe')).toHaveLength(2)
  })

  it('refuses to derive timed keyframes before the storyboard reference image exists', () => {
    const tableNode = seedTable()
    const sourceImage = seedStoryboardImage()

    expect(() => ensureStoryboardRowKeyframes({ tableNode, shot, sourceImageNode: sourceImage }))
      .toThrow('先生成该镜头的分镜参考图')
  })
})
