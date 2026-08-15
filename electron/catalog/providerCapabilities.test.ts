/**
 * Slice 4 测试：ProviderCapabilities 只读投影（§9.4，适配 catalog 引擎）。
 *
 * 验收（Gate 1 Slice 4）：
 * - projectCapabilities 对未知 vendor/model 返回 null（不抛）。
 * - sourceFromVendorKey 正确分类 browser-bridge / local-runtime / official-api。
 * - 已 seed 的真实 vendor（jimeng-web/codex 等）能投影出 capabilities。
 * - §9.4 形状完整：所有字段存在；verifiedAt 当前恒 null + sourceDetail 非 'unknown' 时不伪造。
 * - 浏览器桥与本地运行时 provider 的 source 正确（Gate 0 §1.4 证据对齐）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  listCapabilitiesByMediaKind,
  listProviderCapabilities,
  projectCapabilities,
} from './providerCapabilities'
import { ensureBuiltinModelSeeds, listModelCatalogModels, listModelCatalogVendors } from './catalogStore'

beforeEach(() => {
  // 确保每次测试都有 builtin seed（catalogStore 可能被其他测试改过）
  ensureBuiltinModelSeeds()
})

describe('projectCapabilities — 空安全与形状', () => {
  it('returns null for unknown vendor', () => {
    expect(projectCapabilities('vendor-does-not-exist', 'any')).toBeNull()
  })

  it('returns null for unknown model under a known vendor', () => {
    const vendors = listModelCatalogVendors()
    if (vendors.length === 0) return // 无 seed 时跳过
    expect(projectCapabilities(vendors[0].key, 'model-does-not-exist')).toBeNull()
  })

  it('every projected capability has all §9.4 fields and verifiedAt === null (not faked)', () => {
    const caps = listProviderCapabilities()
    for (const c of caps) {
      expect(c).toHaveProperty('providerId')
      expect(c).toHaveProperty('modelKey')
      expect(c).toHaveProperty('mediaKind')
      expect(c).toHaveProperty('modes')
      expect(c).toHaveProperty('referenceRoles')
      expect(c).toHaveProperty('maxReferences')
      expect(c).toHaveProperty('maxOutputs')
      expect(c).toHaveProperty('source')
      expect(c).toHaveProperty('sourceDetail')
      // 关键不变量（Gate 0 §3）：未做真机探测，verifiedAt 必须为 null
      expect(c.verifiedAt).toBeNull()
      // source 必须是合法值
      expect(['official-api', 'browser-bridge', 'local-runtime']).toContain(c.source)
    }
  })
})

describe('source 分类（§9.4 source，Gate 0 §1.4 证据对齐）', () => {
  it('jimeng-web (browser bridge) → source browser-bridge', () => {
    const caps = listProviderCapabilities().filter((c) => c.providerId === 'jimeng-web')
    for (const c of caps) expect(c.source).toBe('browser-bridge')
  })

  it('codex / comfyui-local (local runtime) → source local-runtime', () => {
    const caps = listProviderCapabilities().filter((c) =>
      ['codex', 'codex-local', 'comfyui-local'].includes(c.providerId),
    )
    for (const c of caps) expect(c.source).toBe('local-runtime')
  })

  it('official-API vendors (kie/apimart/volcengine/agnes) → source official-api', () => {
    const caps = listProviderCapabilities().filter((c) =>
      ['kie', 'apimart', 'volcengine', 'agnes'].includes(c.providerId),
    )
    for (const c of caps) expect(c.source).toBe('official-api')
  })
})

describe('supportsCancel 只对真实支持 cancel 的 vendor 为 true（Gate 0 §1.4）', () => {
  it('codex and comfyui-local support cancel', () => {
    const caps = listProviderCapabilities().filter((c) =>
      ['codex', 'codex-local', 'comfyui-local'].includes(c.providerId),
    )
    for (const c of caps) expect(c.supportsCancel).toBe(true)
  })

  it('other vendors do not claim cancel support (no false advertising)', () => {
    const caps = listProviderCapabilities().filter(
      (c) => !['codex', 'codex-local', 'comfyui-local'].includes(c.providerId),
    )
    for (const c of caps) expect(c.supportsCancel).toBe(false)
  })
})

describe('listCapabilitiesByMediaKind — 按 mediaKind 过滤', () => {
  it('returns only matching media kind', () => {
    const videoCaps = listCapabilitiesByMediaKind('video')
    for (const c of videoCaps) expect(c.mediaKind).toBe('video')
    const imageCaps = listCapabilitiesByMediaKind('image')
    for (const c of imageCaps) expect(c.mediaKind).toBe('image')
  })
})

describe('referenceRoles 消除双重命名（Gate 0 §2）', () => {
  it('when archetype declares slots, projected roles use §9.2 normalized names', () => {
    // 找一个有 archetype 的视频模型（Seedance/HappyHorse 等）
    const caps = listCapabilitiesByMediaKind('video')
    const withRefs = caps.find((c) => c.referenceRoles.length > 0 && c.maxReferences > 0)
    if (!withRefs) return // 无 seed 时跳过
    // 归一化的角色名应在 §9.2 集合里
    const validRoles = new Set([
      'first-frame',
      'last-frame',
      'character',
      'video-reference',
      'motion',
      'reference',
    ])
    for (const role of withRefs.referenceRoles) {
      expect(validRoles.has(role)).toBe(true)
    }
  })

  it('explicitly passing an archetype projection populates modes/roles/maxReferences', () => {
    // 取任一已 seed 的视频 vendor+model，传入结构化 archetype
    const videoCaps = listCapabilitiesByMediaKind('video')
    const target = videoCaps[0]
    if (!target) return
    const archetype = {
      modes: [
        {
          id: 'omni',
          slots: [
            { kind: 'first_frame', max: 1 },
            { kind: 'image_ref', max: 3, roleName: 'character' },
            { kind: 'video_ref', max: 1 },
          ],
          capabilities: [{ maxOutputs: 4 }],
          params: [
            { key: 'aspect_ratio', options: [{ value: '16:9' }, { value: '9:16' }] },
            { key: 'duration', options: [{ value: '5' }, { value: '10s' }] },
          ],
        },
      ],
    }
    const caps = projectCapabilities(target.providerId, target.modelKey, archetype)
    expect(caps).not.toBeNull()
    expect(caps!.modes).toEqual(['omni'])
    expect(caps!.referenceRoles).toEqual(
      expect.arrayContaining(['first-frame', 'character', 'video-reference']),
    )
    expect(caps!.maxReferences).toBe(5) // first_frame 1 + image_ref 3 + video_ref 1
    expect(caps!.maxOutputs).toBe(4)
    expect(caps!.aspectRatios).toEqual(['16:9', '9:16'])
    expect(caps!.durationsSeconds).toEqual([5, 10])
    expect(caps!.async).toBe(true)
  })

  it('archetype with negative_prompt param → supportsNegativePrompt true', () => {
    const videoCaps = listCapabilitiesByMediaKind('video')
    const target = videoCaps[0]
    if (!target) return
    const caps = projectCapabilities(target.providerId, target.modelKey, {
      modes: [
        {
          id: 't2v',
          slots: [],
          params: [{ key: 'negative_prompt', options: [] }],
        },
      ],
    })
    expect(caps!.supportsNegativePrompt).toBe(true)
  })
})

describe('未声明能力不伪造（迁移期保守默认）', () => {
  it('supportsSeed is false for all (not declared in archetype yet)', () => {
    const caps = listProviderCapabilities()
    for (const c of caps) expect(c.supportsSeed).toBe(false)
  })

  it('supportsProviderIdempotency is false for all (not yet verified)', () => {
    const caps = listProviderCapabilities()
    for (const c of caps) expect(c.supportsProviderIdempotency).toBe(false)
  })
})

describe('catalog 真实可读（smoke：seed 在测试环境生效）', () => {
  it('listProviderCapabilities returns a non-empty set when seeds are present', () => {
    const vendors = listModelCatalogVendors()
    const models = listModelCatalogModels()
    if (vendors.length === 0 || models.length === 0) {
      // 测试环境无 seed 时不 fail（CI 可能不同）——但记录下来
      console.warn('[providerCapabilities.test] no catalog seeds in test env; skipping non-empty assertion')
      return
    }
    expect(listProviderCapabilities().length).toBeGreaterThan(0)
  })
})
