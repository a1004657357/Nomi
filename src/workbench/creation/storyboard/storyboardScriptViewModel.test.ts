import { describe, expect, it } from 'vitest'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { buildStoryboardScriptRows, generationResultUrl } from './storyboardScriptViewModel'

const plan: StoryboardPlan = {
  title: '咖啡广告',
  anchors: [
    { id: 'a-character', kind: 'character', name: '店员', description: '年轻咖啡师', carrier: 'visual' },
    { id: 'a-style', kind: 'style', name: '暖调', description: '晨光', carrier: 'text' },
  ],
  shots: [
    { index: 1, shotKind: 'image', durationSec: 0, anchorIds: ['a-character', 'a-style'], prompt: '咖啡豆落入手磨机' },
    { index: 2, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '杯中拉花特写' },
  ],
}

function node(overrides: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return {
    id: 'n',
    kind: 'image',
    title: '节点',
    position: { x: 0, y: 0 },
    categoryId: 'shots',
    ...overrides,
  }
}

describe('storyboardScriptViewModel', () => {
  it('binds official keyframes and regenerated videos by stable shot id after reordering', () => {
    const reordered: StoryboardPlan = {
      ...plan,
      shots: [
        { ...plan.shots[1], index: 1, shotId: 'closeup' },
        { ...plan.shots[0], index: 2, shotId: 'opening', shotKind: 'video', keyframe: { enabled: true } },
      ],
    }
    const rows = buildStoryboardScriptRows(reordered, [
      node({ id: 'frame', title: 'Shot 1 keyframe', shotIndex: 1, meta: { storyboardKeyframe: true, shotId: 'opening' } }),
      node({ id: 'video', kind: 'video', title: 'Shot 1', shotIndex: 1, meta: { shotId: 'opening' } }),
      node({
        id: 'video-v2', kind: 'video', title: 'Shot 1 V2', shotIndex: 9,
        meta: { shotId: 'opening' }, regeneratedFrom: 'video',
        result: { id: 'v2', type: 'video', url: 'video.mp4', createdAt: 2 },
      }),
      node({ id: 'closeup', title: 'Shot 2', shotIndex: 2, meta: { shotId: 'closeup' } }),
    ], [{ id: 'ff', source: 'frame', target: 'video', mode: 'first_frame' }])

    expect(rows[0].imageNode?.id).toBe('closeup')
    expect(rows[1].imageNode?.id).toBe('frame')
    expect(rows[1].videoNode?.id).toBe('video-v2')
    expect(rows[1].nodes.map((item) => item.id)).toEqual(['frame', 'video', 'video-v2'])
  })

  it('按 shotIndex 把分镜方案行和画布生成图合并', () => {
    const rows = buildStoryboardScriptRows(
      plan,
      [
        node({
          id: 'shot-1-real',
          title: '镜头 1',
          shotIndex: 1,
          result: { id: 'r1', type: 'image', url: 'nomi-local://shot-1.png', createdAt: 1 },
        }),
      ],
      [],
    )

    expect(rows).toHaveLength(2)
    expect(rows[0].shot.prompt).toBe('咖啡豆落入手磨机')
    expect(rows[0].primaryUrl).toBe('nomi-local://shot-1.png')
    expect(rows[0].status).toBe('generated')
    expect(rows[0].anchors.map((a) => a.name)).toEqual(['店员', '暖调'])
    expect(rows[1].status).toBe('pending')
  })

  it('旧项目 shotIndex 被参考卡挤偏时，按分镜标题和 prompt 把图挂回正确脚本行', () => {
    const rows = buildStoryboardScriptRows(
      plan,
      [
        node({
          id: 'shot-1-offset',
          title: '镜头 1',
          shotIndex: 17,
          prompt: '咖啡豆落入手磨机，暖色商业广告',
          result: { id: 'r1', type: 'image', url: 'nomi-local://shot-1.png', createdAt: 1 },
        }),
        node({
          id: 'shot-2-offset',
          title: '镜头 2',
          shotIndex: 18,
          prompt: '杯中拉花特写，微距摄影',
          result: { id: 'r2', type: 'image', url: 'nomi-local://shot-2.png', createdAt: 1 },
        }),
      ],
      [],
    )

    expect(rows.map((row) => row.primaryNode?.id)).toEqual(['shot-1-offset', 'shot-2-offset'])
    expect(rows.map((row) => row.primaryUrl)).toEqual(['nomi-local://shot-1.png', 'nomi-local://shot-2.png'])
  })

  it('重生成变体归回原镜头行并默认显示最新成功结果', () => {
    const rows = buildStoryboardScriptRows(
      plan,
      [
        node({
          id: 'shot-1-original',
          title: '镜头 1',
          shotIndex: 1,
          prompt: '咖啡豆落入手磨机',
          result: { id: 'old', type: 'image', url: 'nomi-local://old.png', createdAt: 10 },
        }),
        node({
          id: 'shot-1-variant',
          title: '镜头 1',
          shotIndex: 49,
          regeneratedFrom: 'shot-1-original',
          prompt: '咖啡豆落入手磨机',
          result: { id: 'new', type: 'image', url: 'nomi-local://new.png', createdAt: 20 },
        }),
      ],
      [],
    )

    expect(rows[0].nodes.map((candidate) => candidate.id)).toEqual(['shot-1-original', 'shot-1-variant'])
    expect(rows[0].imageNode?.id).toBe('shot-1-variant')
    expect(rows[0].primaryUrl).toBe('nomi-local://new.png')
  })

  it('同一镜有图片和视频时优先把图片作为分镜参考图', () => {
    const rows = buildStoryboardScriptRows(
      plan,
      [
        node({
          id: 'img-1',
          kind: 'image',
          shotIndex: 1,
          result: { id: 'img-r', type: 'image', providerUrl: 'https://cdn.example.com/img.png', createdAt: 1 },
        }),
        node({
          id: 'vid-1',
          kind: 'video',
          shotIndex: 1,
          result: { id: 'vid-r', type: 'video', url: 'nomi-local://video.mp4', createdAt: 2 },
        }),
      ],
      [],
    )

    expect(rows[0].imageNode?.id).toBe('img-1')
    expect(rows[0].videoNode?.id).toBe('vid-1')
    expect(rows[0].primaryNode?.id).toBe('img-1')
    expect(rows[0].primaryUrl).toBe('https://cdn.example.com/img.png')
  })

  it('收集镜头入边来源作为参考图，不依赖 clientId 持久化', () => {
    const nodes = [
      node({
        id: 'anchor-real',
        title: '店员',
        shotIndex: undefined,
        meta: { referenceSheet: true },
        result: { id: 'a-r', type: 'image', url: 'nomi-local://anchor.png', createdAt: 1 },
      }),
      node({ id: 'shot-1-real', title: '镜头 1', shotIndex: 1 }),
    ]
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'anchor-real', target: 'shot-1-real', mode: 'character_ref' }]
    const rows = buildStoryboardScriptRows(plan, nodes, edges)

    expect(rows[0].references).toEqual([{ nodeId: 'anchor-real', title: '店员', url: 'nomi-local://anchor.png' }])
  })

  it('result URL 支持只有 providerUrl 的生成结果', () => {
    expect(generationResultUrl({ id: 'r', type: 'image', providerUrl: 'https://cdn.example.com/only.png', createdAt: 1 })).toBe(
      'https://cdn.example.com/only.png',
    )
  })

  it('没有 storyboardPlan 时，从画布镜头节点兜底生成脚本行', () => {
    const rows = buildStoryboardScriptRows(
      null,
      [
        node({
          id: 'legacy-2',
          title: '镜头 2｜咖啡师拉花手部',
          prompt: '咖啡师双手正在把牛奶倒入浓缩咖啡杯',
          position: { x: 0, y: 360 },
          shotIndex: undefined,
        }),
        node({
          id: 'legacy-1',
          title: '镜头 1｜晨光咖啡杯特写',
          prompt: '清晨窗边木桌上一杯热拿铁',
          position: { x: 0, y: 40 },
          shotIndex: undefined,
          result: { id: 'r1', type: 'image', url: 'nomi-local://coffee.png', createdAt: 1 },
        }),
      ],
      [],
    )

    expect(rows.map((row) => row.shot.index)).toEqual([1, 2])
    expect(rows[0].title).toBe('镜头 1｜晨光咖啡杯特写')
    expect(rows[0].shot.prompt).toBe('清晨窗边木桌上一杯热拿铁')
    expect(rows[0].primaryUrl).toBe('nomi-local://coffee.png')
    expect(rows[1].status).toBe('pending')
  })
})
