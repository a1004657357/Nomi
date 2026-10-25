/**
 * Gate 3 Slice 2 测试：ProviderAdapter 合约 + cancel/download 通用化。
 *
 * 验收：
 * - 声明表诚实标注（codex/comfyui 支持 cancel，jimeng-web 不支持，其余默认不支持）。
 * - cancelProviderTask 按声明路由：支持 → 调 cancelImpl；不支持 → 返回 {cancelled:false, reason}。
 * - downloadProviderResult 单次 vs 重试（按声明）。
 * - assertCancelConsistency 检测 capability 与 adapter 声明漂移。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ProviderCapabilities } from './providerCapabilities'
import {
  ADAPTER_CAPABILITY_DECLARATIONS,
  assertCancelConsistency,
  cancelProviderTask,
  downloadProviderResult,
  getAdapterDeclaration,
} from './providerAdapterContract'

describe('ADAPTER_CAPABILITY_DECLARATIONS — 诚实标注（Gate 0 §1.4 证据对齐）', () => {
  it('codex supports cancel (local-runtime)', () => {
    expect(ADAPTER_CAPABILITY_DECLARATIONS.codex.supportsCancel).toBe(true)
    expect(ADAPTER_CAPABILITY_DECLARATIONS.codex.cancelPath).toBe('codex-local')
  })

  it('comfyui-local supports cancel (interrupt)', () => {
    expect(ADAPTER_CAPABILITY_DECLARATIONS['comfyui-local'].supportsCancel).toBe(true)
    expect(ADAPTER_CAPABILITY_DECLARATIONS['comfyui-local'].cancelPath).toBe('comfyui-interrupt')
  })

  it('jimeng-web does NOT support cancel (browser bridge)', () => {
    expect(ADAPTER_CAPABILITY_DECLARATIONS['jimeng-web'].supportsCancel).toBe(false)
  })

  it('agnes explicitly declares official API with no known cancel endpoint', () => {
    expect(ADAPTER_CAPABILITY_DECLARATIONS.agnes).toMatchObject({
      source: 'official-api',
      supportsCancel: false,
      cancelPath: 'none',
    })
  })

  it('no vendor falsely claims cancel support (no false advertising)', () => {
    for (const decl of Object.values(ADAPTER_CAPABILITY_DECLARATIONS)) {
      if (decl.supportsCancel) {
        // 支持 cancel 的必须有 cancelPath 与 evidence
        expect(decl.cancelPath).toBeTruthy()
        expect(decl.evidence).toBeTruthy()
      }
    }
  })
})

describe('getAdapterDeclaration — 默认保守（未声明 = 不支持）', () => {
  it('unknown vendor → default declaration (no cancel, no retry)', () => {
    const decl = getAdapterDeclaration('some-new-vendor')
    expect(decl.supportsCancel).toBe(false)
    expect(decl.supportsDownloadRetry).toBe(false)
  })

  it('known vendor → explicit declaration', () => {
    expect(getAdapterDeclaration('codex').supportsCancel).toBe(true)
  })
})

describe('cancelProviderTask — 按声明路由', () => {
  it('codex → invokes cancelImpl', async () => {
    const cancelImpl = vi.fn().mockResolvedValue({ cancelled: true, remoteCancelled: true })
    const result = await cancelProviderTask('codex', 'task-1', cancelImpl)
    expect(cancelImpl).toHaveBeenCalledWith('codex', 'task-1')
    expect(result.cancelled).toBe(true)
    expect(result.remoteCancelled).toBe(true)
  })

  it('jimeng-web → returns {cancelled:false} without calling cancelImpl', async () => {
    const cancelImpl = vi.fn()
    const result = await cancelProviderTask('jimeng-web', 'task-1', cancelImpl)
    expect(cancelImpl).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(false)
    expect(result.remoteCancelled).toBe(false)
    expect(result.reason).toContain('不支持')
  })

  it('declared-cancel vendor without cancelImpl injection → returns reason', async () => {
    const result = await cancelProviderTask('codex', 'task-1') // 无 cancelImpl
    expect(result.cancelled).toBe(false)
    expect(result.reason).toContain('未注入')
  })

  it('unknown vendor → {cancelled:false, reason}', async () => {
    const result = await cancelProviderTask('ghost-vendor', 'task-1')
    expect(result.cancelled).toBe(false)
    expect(result.reason).toContain('不支持')
  })
})

describe('downloadProviderResult — 单次 vs 重试', () => {
  it('single attempt when supportsDownloadRetry=false', async () => {
    const downloadImpl = vi.fn().mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/png' })
    await downloadProviderResult('codex', { providerUrl: 'https://x/a.png' }, downloadImpl)
    expect(downloadImpl).toHaveBeenCalledTimes(1)
  })

  it('retries on failure when supportsDownloadRetry=true (verified via inject)', async () => {
    // 直接验证 downloadProviderResult 的重试逻辑：临时改声明表让某 vendor 支持 retry。
    // 用 vi.spyOn 暂时让 codex 声明 downloadRetry，验证失败后重试。
    const original = { ...ADAPTER_CAPABILITY_DECLARATIONS }
    ;(ADAPTER_CAPABILITY_DECLARATIONS as Record<string, unknown>).codex = {
      providerId: 'codex',
      source: 'local-runtime',
      supportsCancel: true,
      cancelPath: 'codex-local',
      supportsDownloadRetry: true,
      downloadRetry: { maxAttempts: 3, backoffMs: 1 },
      evidence: 'test override',
    }
    try {
      const downloadImpl = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient-1'))
        .mockRejectedValueOnce(new Error('transient-2'))
        .mockResolvedValueOnce({ bytes: Buffer.from('ok'), mimeType: 'image/png' })
      const result = await downloadProviderResult('codex', { providerUrl: 'https://x/a.png' }, downloadImpl)
      expect(downloadImpl).toHaveBeenCalledTimes(3) // 重试 3 次后成功
      expect(result.bytes.toString()).toBe('ok')
    } finally {
      // 恢复（测试隔离）
      ;(ADAPTER_CAPABILITY_DECLARATIONS as Record<string, unknown>).codex = original.codex
    }
  })

  it('non-retry vendor: single failure throws immediately', async () => {
    const downloadImpl = vi.fn().mockRejectedValueOnce(new Error('boom'))
    await expect(
      downloadProviderResult('jimeng-web', { providerUrl: 'https://x/a.png' }, downloadImpl),
    ).rejects.toThrow('boom')
    expect(downloadImpl).toHaveBeenCalledTimes(1)
  })

  it('throws when no url', async () => {
    await expect(
      downloadProviderResult('codex', {}, async () => ({ bytes: Buffer.from(''), mimeType: '' })),
    ).rejects.toThrow('无 url')
  })
})

describe('assertCancelConsistency — capability vs adapter 声明漂移检测', () => {
  it('consistent when capability and adapter agree', () => {
    const caps: ProviderCapabilities = {
      providerId: 'codex',
      modelKey: 'x',
      mediaKind: 'image',
      modes: [],
      referenceRoles: [],
      maxReferences: 0,
      maxOutputs: 1,
      aspectRatios: [],
      resolutions: [],
      durationsSeconds: [],
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsCallback: false,
      supportsCancel: true, // 与 adapter 声明一致
      supportsProviderIdempotency: false,
      async: false,
      parametersSchema: {},
      source: 'local-runtime',
      verifiedAt: null,
      sourceDetail: 'catalog-seed',
    }
    const result = assertCancelConsistency(caps)
    expect(result.consistent).toBe(true)
  })

  it('detects drift when capability claims cancel but adapter says no', () => {
    const caps: ProviderCapabilities = {
      providerId: 'jimeng-web',
      modelKey: 'x',
      mediaKind: 'video',
      modes: [],
      referenceRoles: [],
      maxReferences: 0,
      maxOutputs: 1,
      aspectRatios: [],
      resolutions: [],
      durationsSeconds: [],
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsCallback: false,
      supportsCancel: true, // capability 说支持
      supportsProviderIdempotency: false,
      async: true,
      parametersSchema: {},
      source: 'browser-bridge',
      verifiedAt: null,
      sourceDetail: 'catalog-seed',
    }
    // 但 adapter 声明 jimeng-web 不支持 → 漂移
    const result = assertCancelConsistency(caps)
    expect(result.consistent).toBe(false)
    expect(result.detail).toContain('jimeng-web')
  })
})
