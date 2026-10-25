// Model-wide slot limits remain 9/3/3; never impose one vendor's aggregate on all channels.
// The 2026-08-20 generic-contract finding still holds for the API channels below.
// Superseding local primary evidence, checked 2026-10-25: official dreamina v1.4.21
// multimodal2video --help explicitly states total inputs<=12 for its 2.0 family.
// This is a CLI-specific restriction, not a shared Seedance model restriction.
import { describe, expect, it } from 'vitest'
import {
  DREAMINA_SEEDANCE_ARCHETYPE,
  SEEDANCE_2_ARCHETYPE,
  SEEDANCE_2_5_ARCHETYPE,
  SEEDANCE_2_5_APIMART_ARCHETYPE,
  SEEDANCE_2_APIMART_ARCHETYPE,
  SEEDANCE_VOLCENGINE_ARCHETYPE,
} from '../videoCapabilities'
import type { ModelArchetype } from './types'
import { remainingReferenceCapacity, validateModeConstraints } from '../videoCapabilities/crossFieldConstraints'

/**
 * 逐项抄自官方文档（2026-08-20 核实）：
 *   火山方舟 https://docs.volcengine.com/docs/82379/2298881?lang=zh
 *            「图片数量：seedance 2.0 全模态参考生视频：1~9 张」
 *            「Seedance 2.0 系列：…最多传入 3 个参考视频，所有视频总时长不超过 15 s」
 *            「Seedance 2.0 系列：…最多传入 3 段参考音频，所有音频总时长不超过 15 s」
 *   APIMart  https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md
 *            "Maximum of 9 reference images" / "Maximum of 3 reference videos" / "Maximum of 3 reference audio files"
 * 两家一致 —— 模型级能力，钉在共享档案上是对的。
 */
const DOC_LIMITS = { image_ref: 9, video_ref: 3, audio_ref: 3 } as const

/**
 * **四条**渠道全部走同一套模型级契约（P4 通用第一：档案按模型身份认，供应商只管传输）。
 * kie 那条（seedance.ts）是 2026-08-20 全仓实扫 `kind: "audio_ref"` 才发现的 —— 起初只盯着
 * apimart/volcengine/dreamina 三个档案，漏了它。同一个模型换个中转不会改变「不收纯音频」这件事，
 * 所以四条都得带。**改这里时先扫一遍全仓，别照着记忆里的清单改。**
 */
const CHANNELS_2_0: Array<[string, ModelArchetype, string]> = [
  ['apimart', SEEDANCE_2_APIMART_ARCHETYPE, 'omni'],
  ['volcengine', SEEDANCE_VOLCENGINE_ARCHETYPE, 'omni'],
  ['dreamina', DREAMINA_SEEDANCE_ARCHETYPE, 'multimodal'],
  ['kie', SEEDANCE_2_ARCHETYPE, 'omni'],
]

/** 2.5 的两条渠道 —— 都**不该**有伴随要求（文档已解除），负向钉子对它们一起生效。 */
const CHANNELS_2_5: Array<[string, ModelArchetype]> = [
  ['2.5 kie', SEEDANCE_2_5_ARCHETYPE],
  ['2.5 apimart', SEEDANCE_2_5_APIMART_ARCHETYPE],
]

const omniOf = (archetype: ModelArchetype, modeId: string) => archetype.modes.find((mode) => mode.id === modeId)

describe('Seedance 2.0 archetype vs official docs', () => {
  describe.each(CHANNELS_2_0)('%s', (_vendor, archetype, modeId) => {
    const omni = omniOf(archetype, modeId)

    it('has the multimodal reference mode', () => {
      expect(omni).toBeDefined()
    })

    it.each(Object.entries(DOC_LIMITS))('allows the documented maximum for %s', (kind, max) => {
      const slot = omni?.slots.find((s) => s.kind === kind)
      expect(slot, `全能参考模式缺少 ${kind} 槽`).toBeDefined()
      expect(slot?.max, `${kind} 上限与官方文档不一致`).toBe(max)
    })

    /**
     * 三家一致 = 模型级契约：
     *   火山方舟 https://docs.volcengine.com/docs/82379/2291680?lang=zh
     *            「您可任意组合以下模态内容，注意不支持"文本+音频"、"纯音频" 输入。」
     *   APIMart  "Must be used together with reference images or reference videos"
     *   fal      "requires at least one image or video"
     * 缺了它 → 用户只放一段音频，UI 判定可生成、发出去被服务商拒（原 canRunGenerationNode 只问
     * 「任一数组槽非空」）。声明成 requiresAnyOf 而非写死 if，是因为 2.5 已解除此限（见下一个 describe）。
     */
    it('requires reference audio to be accompanied by an image or a video', () => {
      const audio = omni?.slots.find((s) => s.kind === 'audio_ref')
      expect(audio?.requiresAnyOf, 'audio_ref 未声明跨槽依赖 → 纯音频会被放行到服务商').toBeDefined()
      expect(audio?.requiresAnyOf).toEqual(expect.arrayContaining(['image_ref', 'video_ref']))
    })
  })

  /**
   * 负向钉子。2.5 **解除**了 2.0 的纯音频限制，别在"对齐两代"时手贱补回来：
   *   火山方舟 https://docs.volcengine.com/docs/82379/2607688?lang=zh
   *            「Seedance 2.5 新增支持纯音频参考生成视频，无需搭配图片或视频素材。」
   *   APIMart  "Reference audio: ≤3, total ≤15s → ≤10, total ≤30s; audio-only OK"
   * （fal 的 2.5 页仍写 "at least one reference image or video is required"，与字节自家 + APIMart 相左，
   *  判为陈旧拷贝 —— 一手出处优先于中转转述。）
   */
  it.each(CHANNELS_2_5)('does NOT carry the audio companion requirement on %s — the docs lifted it', (_label, archetype) => {
    const audio = omniOf(archetype, 'omni')?.slots.find((s) => s.kind === 'audio_ref')
    expect(audio, '2.5 omni 缺少 audio_ref 槽').toBeDefined()
    expect(audio?.requiresAnyOf, '2.5 支持纯音频参考，不该有伴随要求').toBeUndefined()
  })

  it('keeps the CLI-only aggregate out of the other model channels', () => {
    const suspects = ['maxTotalReferences', 'maxTotalFiles', 'totalMax', 'maxCombined']
    const all: Array<[string, ModelArchetype, string]> = [
      ...CHANNELS_2_0,
      ...CHANNELS_2_5.map(([label, archetype]): [string, ModelArchetype, string] => [label, archetype, 'omni']),
    ]
    for (const [vendor, archetype, modeId] of all) {
      const omni = omniOf(archetype, modeId)
      for (const key of suspects) {
        expect(omni, `${vendor} 缺少全能参考模式`).toBeDefined()
        if (vendor === 'dreamina' && key === 'maxTotalReferences') {
          expect(omni?.maxTotalReferences).toBe(12)
        } else {
          expect(Object.hasOwn(omni as object, key), `${vendor} must not inherit the CLI-only aggregate ${key}`).toBe(false)
        }
      }
      // 各槽上限之和就是文档写的「参考素材数量上限」（2.0=15、2.5=50），不存在更紧的合计约束。
      const sum = (omni?.slots ?? []).reduce((total, slot) => total + (slot.max ?? 0), 0)
      expect(sum, `${vendor} 各槽上限之和应等于文档的参考素材数量上限`).toBe(vendor.startsWith('2.5') ? 50 : 15)
    }
  })

  it('enforces the documented CLI aggregate while API channels retain their complete slots', () => {
    const cli = omniOf(DREAMINA_SEEDANCE_ARCHETYPE, 'multimodal')!
    expect(remainingReferenceCapacity(cli, { image_ref: 9, video_ref: 3 })).toBe(0)
    expect(validateModeConstraints(cli, { mm_images: Array(9).fill('i'), mm_videos: Array(3).fill('v') })).toBeNull()
    expect(validateModeConstraints(cli, { mm_images: Array(9).fill('i'), mm_videos: Array(3).fill('v'), mm_audios: ['a'] })).toEqual({ kind: 'references', max: 12 })
    for (const [vendor, archetype, modeId] of CHANNELS_2_0) {
      if (vendor === 'dreamina') continue
      const mode = omniOf(archetype, modeId)!
      const full = Object.fromEntries(mode.slots.map(slot => [slot.inputKey, Array(DOC_LIMITS[slot.kind as keyof typeof DOC_LIMITS]).fill(slot.kind)]))
      expect(remainingReferenceCapacity(mode, { image_ref: 9, video_ref: 3, audio_ref: 3 }), vendor).toBe(Infinity)
      expect(validateModeConstraints(mode, full), vendor).toBeNull()
    }
  })
})
