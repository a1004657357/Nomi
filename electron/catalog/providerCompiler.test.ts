/**
 * Gate 3 Slice 1 测试：GenerationIntent → CompiledProviderRequest 编译层（§9.5, §12.1）。
 *
 * 验收：
 * - §9.2 硬约束：无 role 参考数组 → CompilationError。
 * - mediaKind 不匹配 → CompilationError（§4.3 禁止嫁接错）。
 * - 参考数量/角色/outputCount/画幅/时长超 capability → compilationWarnings（不抛）。
 * - 编译产出 CompiledProviderRequest（intentId/providerId/modelKey/modeId/idempotencyKey/requestBody）。
 * - modeId 据 §15.4 规则推断（image: t2i/i2i；video: t2v/first-frame/omni）。
 */
import { describe, expect, it } from 'vitest'
import type { GenerationIntentV1, ReferenceBindingV1 } from '../../src/workbench/domain/cinematicTypes'
import type { ProviderCapabilities } from './providerCapabilities'
import { CompilationError, compileBatch, compileGenerationIntent } from './providerCompiler'

function makeCapabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    providerId: 'kie',
    modelKey: 'seedance-2',
    mediaKind: 'video',
    modes: ['text-to-video', 'omni-reference', 'first-frame'],
    referenceRoles: ['first-frame', 'character', 'video-reference'],
    maxReferences: 3,
    maxOutputs: 1,
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    durationsSeconds: [5, 10],
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsCallback: false,
    supportsCancel: false,
    supportsProviderIdempotency: false,
    async: true,
    parametersSchema: {},
    source: 'official-api',
    verifiedAt: null,
    sourceDetail: 'archetype',
    ...overrides,
  }
}

function makeIntent(overrides: Partial<GenerationIntentV1> = {}): GenerationIntentV1 {
  return {
    id: 'intent-1',
    projectId: 'proj-1',
    shotId: 'shot-1',
    mediaKind: 'video',
    prompt: '林夏转身',
    references: [],
    target: { aspectRatio: '9:16', durationSeconds: 5, outputCount: 1 },
    budget: { maxSubmissions: 1 },
    ...overrides,
  }
}

describe('compileGenerationIntent — §9.2 硬约束', () => {
  it('throws CompilationError on naked reference array (no role)', () => {
    const intent = makeIntent({
      references: [{ assetId: 'a', required: true } as ReferenceBindingV1], // 无 role
    })
    expect(() => compileGenerationIntent(intent, makeCapabilities())).toThrow(CompilationError)
  })

  it('throws on mediaKind mismatch (§4.3: no cross-grafting)', () => {
    const intent = makeIntent({ mediaKind: 'image' })
    const caps = makeCapabilities({ mediaKind: 'video' })
    expect(() => compileGenerationIntent(intent, caps)).toThrow(/mediaKind 不匹配/)
  })
})

describe('compileGenerationIntent — 软约束（warnings，不抛）', () => {
  it('warns when references exceed maxReferences', () => {
    const intent = makeIntent({
      references: [
        { assetId: 'a', role: 'character', required: true },
        { assetId: 'b', role: 'character', required: true },
        { assetId: 'c', role: 'character', required: true },
        { assetId: 'd', role: 'character', required: true }, // 第 4 个超上限 3
      ],
    })
    const result = compileGenerationIntent(intent, makeCapabilities())
    expect(result.compilationWarnings.some((w) => w.includes('超过') && w.includes('上限 3'))).toBe(true)
  })

  it('warns when reference role not supported by capability', () => {
    const intent = makeIntent({
      references: [{ assetId: 'a', role: 'scene', required: true }], // scene 不在 capability.roles
    })
    const result = compileGenerationIntent(intent, makeCapabilities())
    expect(result.compilationWarnings.some((w) => w.includes('scene') && w.includes('支持'))).toBe(true)
  })

  it('warns when outputCount exceeds maxOutputs', () => {
    const intent = makeIntent({ target: { aspectRatio: '9:16', outputCount: 5 } })
    const result = compileGenerationIntent(intent, makeCapabilities({ maxOutputs: 1 }))
    expect(result.compilationWarnings.some((w) => w.includes('outputCount 5'))).toBe(true)
  })

  it('warns when aspectRatio/duration not in capability support set', () => {
    const intent = makeIntent({ target: { aspectRatio: '4:5', durationSeconds: 7, outputCount: 1 } })
    const result = compileGenerationIntent(intent, makeCapabilities())
    expect(result.compilationWarnings.some((w) => w.includes('画幅 4:5'))).toBe(true)
    expect(result.compilationWarnings.some((w) => w.includes('时长 7s'))).toBe(true)
  })

  it('no warnings when everything fits', () => {
    const intent = makeIntent()
    const result = compileGenerationIntent(intent, makeCapabilities())
    expect(result.compilationWarnings).toEqual([])
  })
})

describe('compileGenerationIntent — 输出 CompiledProviderRequest（§9.5）', () => {
  it('produces all required fields', () => {
    const result = compileGenerationIntent(makeIntent(), makeCapabilities(), {}, 'idem-key-1')
    expect(result.intentId).toBe('intent-1')
    expect(result.providerId).toBe('kie')
    expect(result.modelKey).toBe('seedance-2')
    expect(result.idempotencyKey).toBe('idem-key-1')
    expect(result.requestBody).toBeDefined()
    expect(result.modeId).toBeDefined()
  })

  it('default idempotencyKey from intent.id when not provided', () => {
    const result = compileGenerationIntent(makeIntent(), makeCapabilities())
    expect(result.idempotencyKey).toBe('intent-intent-1')
  })

  it('requestBody contains prompt/aspect_ratio/duration from intent', () => {
    const result = compileGenerationIntent(makeIntent(), makeCapabilities())
    const body = result.requestBody as { request: { prompt: string; aspect_ratio: string; duration: number } }
    expect(body.request.prompt).toBe('林夏转身')
    expect(body.request.aspect_ratio).toBe('9:16')
    expect(body.request.duration).toBe(5)
  })

  it('invokes injected referencesToRequestField for provider-specific ref translation', () => {
    const intent = makeIntent({
      references: [{ assetId: 'a', role: 'character', required: true }],
    })
    const result = compileGenerationIntent(intent, makeCapabilities(), {
      referencesToRequestField: (refs) => ({ value: { reference_image_urls: refs.map((r) => r.assetId) }, warnings: [] }),
    })
    const body = result.requestBody as { references: { reference_image_urls: string[] } }
    expect(body.references.reference_image_urls).toEqual(['a'])
  })
})

describe('modeId 推断（§15.4）', () => {
  it('image + no refs → text-to-image', () => {
    const r = compileGenerationIntent(
      makeIntent({ mediaKind: 'image' }),
      makeCapabilities({ mediaKind: 'image' }),
    )
    expect(r.modeId).toBe('text-to-image')
  })

  it('image + refs → image-to-image', () => {
    const r = compileGenerationIntent(
      makeIntent({ mediaKind: 'image', references: [{ assetId: 'a', role: 'character', required: true }] }),
      makeCapabilities({ mediaKind: 'image' }),
    )
    expect(r.modeId).toBe('image-to-image')
  })

  it('video + first-frame ref → first-frame', () => {
    const r = compileGenerationIntent(
      makeIntent({ references: [{ assetId: 'a', role: 'first-frame', required: true }] }),
      makeCapabilities(),
    )
    expect(r.modeId).toBe('first-frame')
  })

  it('video + omni refs → omni-reference', () => {
    const r = compileGenerationIntent(
      makeIntent({ references: [{ assetId: 'a', role: 'character', required: true }] }),
      makeCapabilities(),
    )
    expect(r.modeId).toBe('omni-reference')
  })

  it('video no refs → text-to-video', () => {
    expect(compileGenerationIntent(makeIntent(), makeCapabilities()).modeId).toBe('text-to-video')
  })
})

describe('compileBatch — 原子性（任一硬约束失败抛错）', () => {
  it('compiles multiple valid intents', () => {
    const caps = makeCapabilities()
    const intents = [makeIntent({ id: 'i1' }), makeIntent({ id: 'i2' })]
    const results = compileBatch(intents, () => caps)
    expect(results).toHaveLength(2)
    expect(results[0].intentId).toBe('i1')
    expect(results[1].intentId).toBe('i2')
  })
})
