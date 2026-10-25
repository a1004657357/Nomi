import { describe, expect, it } from 'vitest'
import {
  capabilityRecipeConnectionGuidance,
  moodCoordinatesForMode,
  moodOutputCountForMode,
  moodRequestSummary,
  normalizeMoodGenerationMode,
} from './capabilityRecipeInspectorModel'

describe('capability recipe inspector mood model', () => {
  it.each([
    ['single', 1, '1 次独立请求'],
    ['sample5', 5, '5 次独立请求 · 最多 2 路并发'],
    ['matrix5x5', 25, '25 次独立请求 · 最多 2 路并发'],
  ] as const)('maps %s to its real output and request count', (mode, count, summary) => {
    expect(moodOutputCountForMode(mode)).toBe(count)
    expect(moodRequestSummary(mode)).toBe(summary)
  })

  it('normalizes unknown modes to a single coordinate', () => {
    expect(normalizeMoodGenerationMode('unknown')).toBe('single')
    expect(normalizeMoodGenerationMode(undefined)).toBe('single')
  })

  it('selects one coordinate, five trial coordinates, or the full matrix', () => {
    expect(moodCoordinatesForMode('single', 1, 3)).toEqual([{ energy: 1, affinity: 3 }])
    expect(moodCoordinatesForMode('sample5', 1, 3)).toEqual([
      { energy: 0, affinity: 0 },
      { energy: 0, affinity: 4 },
      { energy: 2, affinity: 2 },
      { energy: 4, affinity: 0 },
      { energy: 4, affinity: 4 },
    ])
    expect(moodCoordinatesForMode('matrix5x5', 1, 3)).toHaveLength(25)
  })
})

describe('capability recipe connection guidance', () => {
  it('points video editing to the existing KIE HappyHorse source-video mode', () => {
    expect(capabilityRecipeConnectionGuidance('video.edit.look')).toEqual({
      title: '需要视频转视频模型',
      description: '连接 KIE 并启用 HappyHorse；它的 video-edit 模式支持源视频和参考图。',
      vendorLabel: 'KIE · HappyHorse',
    })
  })

  it('points image-to-3D to the existing RunningHub model family and key requirement', () => {
    expect(capabilityRecipeConnectionGuidance('image.multiview.reconstruct3d')).toEqual({
      title: '需要图生 3D 模型',
      description: '连接 RunningHub Enterprise-Shared API Key，可使用混元3D、HiTem3D 或 Meshy 6。',
      vendorLabel: 'RunningHub · 3D',
    })
  })

  it('keeps a generic recovery path for other recipes', () => {
    expect(capabilityRecipeConnectionGuidance('portrait.refine')).toEqual({
      title: '需要兼容模型',
      description: '请在模型接入中连接并启用一个支持该配方输入和输出的模型。',
      vendorLabel: '模型接入',
    })
  })
})
