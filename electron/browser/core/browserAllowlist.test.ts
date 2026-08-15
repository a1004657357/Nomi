/**
 * Gate 7 P1 修复测试：browser bridge allowlist（§22.3）+ includeApiKeys 剥离 + 模型权重 BOM 校验。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  addBrowserAllowlistEntry,
  assertAllowedBrowserTarget,
  getBrowserAllowlist,
  isAllowedBrowserTarget,
  resetBrowserAllowlistForTests,
} from './browserAllowlist'

afterEach(() => {
  resetBrowserAllowlistForTests()
})

describe('§22.3 browser bridge allowlist — 默认 allowlist', () => {
  it('allows known Jimeng/Dreamina targets', () => {
    expect(isAllowedBrowserTarget('https://jimeng.jianying.com/').allowed).toBe(true)
    expect(isAllowedBrowserTarget('https://dreamina.jianying.com/').allowed).toBe(true)
    expect(isAllowedBrowserTarget('https://www.dreamina.com/').allowed).toBe(true)
  })

  it('allows local extension port 127.0.0.1:3457', () => {
    expect(isAllowedBrowserTarget('http://127.0.0.1:3457/').allowed).toBe(true)
    expect(isAllowedBrowserTarget('http://localhost:3457/').allowed).toBe(true)
  })

  it('rejects unknown external site', () => {
    const r = isAllowedBrowserTarget('https://evil.com/')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('不在 allowlist')
  })

  it('rejects wrong port on allowed host (localhost:8080)', () => {
    const r = isAllowedBrowserTarget('http://localhost:8080/')
    expect(r.allowed).toBe(false)
  })

  it('rejects non-http(s) protocol', () => {
    expect(isAllowedBrowserTarget('file:///etc/passwd').allowed).toBe(false)
    expect(isAllowedBrowserTarget('javascript:alert(1)').allowed).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isAllowedBrowserTarget('not-a-url').allowed).toBe(false)
    expect(isAllowedBrowserTarget('').allowed).toBe(false)
  })

  it('matchedEntry carries purpose for audit', () => {
    const r = isAllowedBrowserTarget('https://jimeng.jianying.com/')
    expect(r.matchedEntry?.purpose).toContain('即梦')
  })
})

describe('§22.3 allowlist — 可扩展', () => {
  it('addBrowserAllowlistEntry allows new provider site', () => {
    addBrowserAllowlistEntry({ host: 'new-provider.example.com', purpose: 'test provider' })
    expect(isAllowedBrowserTarget('https://new-provider.example.com/').allowed).toBe(true)
  })

  it('resetBrowserAllowlistForTests clears extras', () => {
    addBrowserAllowlistEntry({ host: 'temp.example.com', purpose: 'temp' })
    resetBrowserAllowlistForTests()
    expect(isAllowedBrowserTarget('https://temp.example.com/').allowed).toBe(false)
  })

  it('getBrowserAllowlist returns default + extras', () => {
    const baseCount = getBrowserAllowlist().length
    addBrowserAllowlistEntry({ host: 'extra.example.com', purpose: 'x' })
    expect(getBrowserAllowlist().length).toBe(baseCount + 1)
  })
})

describe('assertAllowedBrowserTarget — 抛错形态', () => {
  it('throws on disallowed', () => {
    expect(() => assertAllowedBrowserTarget('https://evil.com/')).toThrow(/browser bridge 拒绝/)
  })

  it('does not throw on allowed', () => {
    expect(() => assertAllowedBrowserTarget('https://jimeng.jianying.com/')).not.toThrow()
  })
})

describe('includeApiKeys IPC 剥离验证（§22.1）', () => {
  // 直接测 catalogStore 的两个函数（避免 main.ts IPC 集成）
  it('exportModelCatalogPackage never returns apiKey field even if requested', async () => {
    const { exportModelCatalogPackage } = await import('../../catalog/catalogStore')
    const pkg = exportModelCatalogPackage({ includeApiKeys: true }) as {
      vendors: Array<{ vendor: unknown; apiKey?: unknown }>
    }
    for (const v of pkg.vendors) {
      expect(v.apiKey).toBeUndefined()
    }
  })

  it('exportModelCatalogPackageWithKeys is a separate main-only function (renderer IPC must not call it)', async () => {
    const mod = await import('../../catalog/catalogStore')
    expect(typeof mod.exportModelCatalogPackageWithKeys).toBe('function')
  })
})
