/**
 * Gate 2 Slice 3 测试：ShotSpec 投影读取器（§11.2 read_* 支撑）。
 *
 * 验收：
 * - readStoryboardAsShotSpecs 把 plan + 节点投影成 ShotSpecView[]。
 * - readShotSpec 按 index/shotId 取单镜。
 * - selectedImageRevisionId/selectedVideoRevisionId 从节点 history/selectedRevision 派生。
 * - readFilmBibleView 从 anchors 派生最小 Film Bible。
 * - readProjectSummary 计数正确。
 * - 旧项目（plan=null / 无节点）不抛错，返回空视图。
 */
import { describe, expect, it } from 'vitest'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import {
  readFilmBibleView,
  readProjectSummary,
  readShotSpec,
  readStoryboardAsShotSpecs,
} from './shotSpecReaders'

function makePlan(overrides: Partial<StoryboardPlan> = {}): StoryboardPlan {
  return {
    title: '短片',
    anchors: [
      { id: 'char-1', kind: 'character', name: '林夏', description: '主角', carrier: 'visual' },
      { id: 'scene-1', kind: 'scene', name: '天台', description: '夜戏', carrier: 'visual' },
    ],
    shots: [
      { index: 1, shotKind: 'video', durationSec: 5, anchorIds: ['char-1'], prompt: '林夏转身' },
      { index: 2, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '反派特写' },
    ],
    ...overrides,
  }
}

function makeNode(id: string, kind: string, overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id,
    kind: kind as GenerationCanvasNode['kind'],
    title: id,
    position: { x: 0, y: 0 },
    ...overrides,
  } as GenerationCanvasNode
}

describe('readStoryboardAsShotSpecs — 分镜→ShotSpecView 投影', () => {
  it('projects all shots with ShotSpec + nodeId', () => {
    const plan = makePlan()
    const nodes = [
      makeNode('shot-node-1', 'video'),
      makeNode('shot-node-2', 'image'),
      makeNode('char-card', 'character'), // 资产卡，不计为镜头
    ]
    const views = readStoryboardAsShotSpecs(plan, nodes, 'proj-1')
    expect(views).toHaveLength(2)
    expect(views[0].spec.index).toBe(1)
    expect(views[0].spec.generationStrategy.mediaKind).toBe('video')
    expect(views[0].nodeId).toBe('shot-node-1')
    expect(views[1].nodeId).toBe('shot-node-2')
  })

  it('derives selectedVideoRevisionId from node result (migration-era: result = selected)', () => {
    const plan = makePlan()
    const nodes = [
      makeNode('shot-node-1', 'video', {
        result: { id: 'rev-vid-1', type: 'video', createdAt: 1 } as GenerationCanvasNode['result'],
      }),
    ]
    const views = readStoryboardAsShotSpecs(plan, nodes, 'proj-1')
    expect(views[0].selectedVideoRevisionId).toBe('rev-vid-1')
  })

  it('derives selectedImageRevisionId from explicit revisionStatus=selected', () => {
    const plan = makePlan()
    // shot index 2 是 image 镜头；shotNodes 按 [shot1(video), shot2(image)] 顺序，
    // 故 shotNodes[1] = image 镜头对应 views[1]
    const nodes = [
      makeNode('shot-node-1', 'video'),
      makeNode('shot-node-2', 'image', {
        history: [
          { id: 'rev-img-1', type: 'image', createdAt: 1, revisionStatus: 'selected' },
          { id: 'rev-img-2', type: 'image', createdAt: 2, revisionStatus: 'candidate' },
        ] as GenerationCanvasNode['history'],
      }),
    ]
    const views = readStoryboardAsShotSpecs(plan, nodes, 'proj-1')
    expect(views[1].selectedImageRevisionId).toBe('rev-img-1')
  })

  it('handles missing nodes gracefully (nodeId undefined, spec still returned)', () => {
    const plan = makePlan()
    const views = readStoryboardAsShotSpecs(plan, [], 'proj-1')
    expect(views).toHaveLength(2)
    expect(views[0].nodeId).toBeUndefined()
  })

  it('returns empty for null/empty plan (old project, no throw)', () => {
    expect(readStoryboardAsShotSpecs(null, [], 'p')).toEqual([])
    expect(readStoryboardAsShotSpecs(undefined, [makeNode('n', 'video')], 'p')).toEqual([])
  })
})

describe('readShotSpec — 单镜读取', () => {
  it('reads by index', () => {
    const plan = makePlan()
    const view = readShotSpec(2, plan, [], 'proj-1')
    expect(view?.spec.index).toBe(2)
    expect(view?.spec.generationStrategy.mediaKind).toBe('image')
  })

  it('reads by shotId string', () => {
    const plan = makePlan()
    const view = readShotSpec('proj-1:shot-1', plan, [], 'proj-1')
    expect(view?.spec.index).toBe(1)
  })

  it('returns null for unknown index', () => {
    const plan = makePlan()
    expect(readShotSpec(999, plan, [], 'p')).toBeNull()
  })

  it('returns null for null plan', () => {
    expect(readShotSpec(1, null, [], 'p')).toBeNull()
  })
})

describe('readFilmBibleView — 从 anchors 派生最小 Film Bible', () => {
  it('derives characters/scenes/props from anchors', () => {
    const plan = makePlan({
      anchors: [
        { id: 'c1', kind: 'character', name: '林夏', description: '主角', carrier: 'visual' },
        { id: 'c2', kind: 'character', name: '反派', description: '对手', carrier: 'visual' },
        { id: 's1', kind: 'scene', name: '天台', description: '高楼天台', carrier: 'visual' },
        { id: 'p1', kind: 'prop', name: '电话', description: '黑色手机', carrier: 'visual' },
        { id: 'st1', kind: 'style', name: '冷色调', description: '青蓝', carrier: 'text' },
      ],
    })
    const bible = readFilmBibleView(plan, 'proj-1')
    expect(bible).not.toBeNull()
    expect(bible!.characters).toHaveLength(2)
    expect(bible!.characters![0].name).toBe('林夏')
    expect(bible!.scenes).toHaveLength(1)
    expect(bible!.props).toHaveLength(1)
    expect(bible!.photographyStrategy).toContain('冷色调')
  })

  it('includes project meta (aspectRatio/fps) when provided', () => {
    const bible = readFilmBibleView(makePlan(), 'p', { aspectRatio: '9:16', fps: 24, targetDurationSeconds: 60 })
    expect(bible!.aspectRatio).toBe('9:16')
    expect(bible!.fps).toBe(24)
    expect(bible!.targetDurationSeconds).toBe(60)
  })

  it('returns null for null plan', () => {
    expect(readFilmBibleView(null, 'p')).toBeNull()
  })

  it('Film Bible never contains credential fields (§8.1/§22.1)', () => {
    const bible = readFilmBibleView(makePlan(), 'p')
    expect(bible).not.toHaveProperty('apiKey')
    expect(bible).not.toHaveProperty('cookie')
    expect(bible).not.toHaveProperty('token')
  })
})

describe('readProjectSummary — 项目摘要计数', () => {
  it('counts nodes, shots, asset cards, shots with results', () => {
    const plan = makePlan() // 2 shots
    const nodes = [
      makeNode('shot-1', 'video', { result: { id: 'r1', type: 'video', createdAt: 1 } as GenerationCanvasNode['result'] }),
      makeNode('shot-2', 'image'), // 无结果
      makeNode('char-card', 'character'),
      makeNode('scene-card', 'scene'),
      makeNode('text-node', 'text'),
    ]
    const summary = readProjectSummary(plan, nodes)
    expect(summary.totalNodes).toBe(5)
    expect(summary.shotCount).toBe(2)
    expect(summary.assetCardCount).toBe(2) // character + scene（text 不计）
    expect(summary.shotsWithResult).toBe(1)
  })

  it('falls back to shot-node count when plan is null', () => {
    const nodes = [makeNode('v1', 'video'), makeNode('v2', 'video')]
    const summary = readProjectSummary(null, nodes)
    expect(summary.shotCount).toBe(2)
  })
})
