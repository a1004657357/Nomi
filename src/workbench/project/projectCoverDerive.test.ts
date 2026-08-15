import { describe, expect, it } from 'vitest'
import { deriveProjectCoverFromNodes, deriveProjectCoverFromRaw } from './projectCoverDerive'

// 根治「纯导入视频项目封面加载失败」（2026-08-01）：封面派生必须按 result.type 分媒体类型，
// 视频/音频的 url 塞进 <img> 必然 decode 失败。本测试钉住分流规则的每个分支。
describe('deriveProjectCoverFromNodes — 媒体类型分流', () => {
  it('图片结果：url 优先、thumbnailUrl 兜底，进 imageUrls', () => {
    const nodes = [
      { id: 'a', result: { type: 'image', url: 'https://cdn/a.png' } },
      { id: 'b', result: { type: 'image', thumbnailUrl: 'https://cdn/b.png' } },
    ]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({ imageUrls: ['https://cdn/a.png', 'https://cdn/b.png'] })
  })

  it('视频结果无 poster → url 进 videoUrl 兜底（导入 mp4 素材项目的封面就靠它）', () => {
    const nodes = [{ id: 'v', result: { type: 'video', url: 'nomi-local://asset/p1/assets/imported/a.mp4' } }]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({
      imageUrls: [],
      videoUrl: 'nomi-local://asset/p1/assets/imported/a.mp4',
    })
  })

  it('视频结果有 poster → poster 进 imageUrls，视频 url 绝不混进 <img> 桶', () => {
    const nodes = [
      { id: 'v', result: { type: 'video', url: 'https://cdn/v.mp4', thumbnailUrl: 'https://cdn/poster.jpg' } },
    ]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({ imageUrls: ['https://cdn/poster.jpg'] })
  })

  it('videoUrl 只取首个无 poster 视频；有图封面时 imageUrls 优先级由调用方保证', () => {
    const nodes = [
      { id: 'v1', result: { type: 'video', url: 'https://cdn/v1.mp4' } },
      { id: 'v2', result: { type: 'video', url: 'https://cdn/v2.mp4' } },
      { id: 'i', result: { type: 'image', url: 'https://cdn/late.png' } },
    ]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({
      imageUrls: ['https://cdn/late.png'],
      videoUrl: 'https://cdn/v1.mp4',
    })
  })

  it('text / audio 结果没有可视封面 → 跳过（不再把音频 url 塞给 <img>）', () => {
    const nodes = [
      { id: 't', result: { type: 'text', text: '一段旁白', url: 'https://cdn/should-not-leak.txt' } },
      { id: 'au', result: { type: 'audio', url: 'https://cdn/voice.mp3' } },
    ]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({ imageUrls: [] })
  })

  it('model3d：只认 thumbnailUrl（.glb url 不可 <img> 渲染）', () => {
    expect(
      deriveProjectCoverFromNodes([{ id: 'm', result: { type: 'model3d', url: 'https://cdn/x.glb' } }]),
    ).toEqual({ imageUrls: [] })
    expect(
      deriveProjectCoverFromNodes([
        { id: 'm', result: { type: 'model3d', url: 'https://cdn/x.glb', thumbnailUrl: 'https://cdn/snap.png' } },
      ]),
    ).toEqual({ imageUrls: ['https://cdn/snap.png'] })
  })

  it('type 缺失（脏/残缺数据）→ 维持旧行为按图片取（url || thumbnailUrl）', () => {
    const nodes = [
      { id: 'legacy', result: { url: 'https://cdn/legacy.png' } },
      { id: 'legacy2', result: { thumbnailUrl: 'https://cdn/legacy2.png' } },
    ]
    expect(deriveProjectCoverFromNodes(nodes)).toEqual({
      imageUrls: ['https://cdn/legacy.png', 'https://cdn/legacy2.png'],
    })
  })

  it('imageUrls 封顶 max；过短 url（length <= 4）过滤', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, result: { type: 'image', url: `https://cdn/n${i}.png` } }))
    expect(deriveProjectCoverFromNodes(many).imageUrls).toHaveLength(4)
    expect(deriveProjectCoverFromNodes(many, 2).imageUrls).toEqual(['https://cdn/n0.png', 'https://cdn/n1.png'])
    expect(deriveProjectCoverFromNodes([{ id: 'tiny', result: { type: 'image', url: 'abcd' } }])).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromNodes([{ id: 'ok', result: { url: 'abcde' } }])).toEqual({ imageUrls: ['abcde'] })
  })

  it('降级：非数组 / 脏节点混入 / 无产物 → 空标记不崩（供 UI 占位）', () => {
    expect(deriveProjectCoverFromNodes(undefined)).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromNodes(null)).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromNodes({})).toEqual({ imageUrls: [] })
    expect(
      deriveProjectCoverFromNodes([null, undefined, 'not-a-node', 7, { id: 'x' }, { id: 'y', result: null }, { id: 'good', result: { url: 'https://cdn/good.png' } }]),
    ).toEqual({ imageUrls: ['https://cdn/good.png'] })
  })
})

describe('deriveProjectCoverFromRaw', () => {
  it('payload.generationCanvas 优先于顶层 generationCanvas', () => {
    const raw = {
      generationCanvas: { nodes: [{ result: { type: 'image', url: 'https://cdn/top.png' } }] },
      payload: { generationCanvas: { nodes: [{ result: { type: 'image', url: 'https://cdn/inner.png' } }] } },
    }
    expect(deriveProjectCoverFromRaw(raw)).toEqual({ imageUrls: ['https://cdn/inner.png'] })
  })

  it('无 payload 包裹时读顶层；payload 非对象时同样回落顶层', () => {
    expect(
      deriveProjectCoverFromRaw({ generationCanvas: { nodes: [{ result: { type: 'video', url: 'https://cdn/top.mp4' } }] } }),
    ).toEqual({ imageUrls: [], videoUrl: 'https://cdn/top.mp4' })
    expect(deriveProjectCoverFromRaw({ payload: 'oops' })).toEqual({ imageUrls: [] })
  })

  it('null / 非对象 / 无画布 → 空标记', () => {
    expect(deriveProjectCoverFromRaw(null)).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromRaw(42)).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromRaw({})).toEqual({ imageUrls: [] })
    expect(deriveProjectCoverFromRaw({ payload: {} })).toEqual({ imageUrls: [] })
  })
})
