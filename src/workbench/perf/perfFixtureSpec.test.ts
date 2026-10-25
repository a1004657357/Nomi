/**
 * Gate 7 测试：200 节点性能 fixture 规格 + SLO 判定 + 安全审计框架。
 */
import { describe, expect, it } from 'vitest'
import {
  PERF_SLO_TARGETS,
  TARGET_PERF_FIXTURE_SPEC,
  assertFixtureMeetsTarget,
  evaluatePerfSlo,
} from './perfFixtureSpec'
import {
  KNOWN_SECURITY_RISKS,
  filterAuditByCategory,
  runSecurityAudit,
  scanForCredentialLeak,
} from '../../../electron/security/securityAuditFramework'

describe('§21.1 性能 fixture 规格', () => {
  it('target spec meets 200 nodes / 400 edges / 12 shots', () => {
    expect(TARGET_PERF_FIXTURE_SPEC.totalNodes).toBe(200)
    expect(TARGET_PERF_FIXTURE_SPEC.totalEdges).toBe(400)
    expect(TARGET_PERF_FIXTURE_SPEC.shotCount).toBe(12)
  })

  it('node kind distribution sums to totalNodes', () => {
    const sum = Object.values(TARGET_PERF_FIXTURE_SPEC.nodeKindDistribution).reduce((a, b) => a + b, 0)
    expect(sum).toBe(TARGET_PERF_FIXTURE_SPEC.totalNodes)
  })

  it('edge topology sums to totalEdges', () => {
    const sum = TARGET_PERF_FIXTURE_SPEC.edgeTopology.intraShot + TARGET_PERF_FIXTURE_SPEC.edgeTopology.crossShot
    expect(sum).toBe(TARGET_PERF_FIXTURE_SPEC.totalEdges)
  })

  it('assertFixtureMeetsTarget flags undersized fixture', () => {
    expect(assertFixtureMeetsTarget({ totalNodes: 96, totalEdges: 156 }).meetsTarget).toBe(false)
    expect(assertFixtureMeetsTarget({ totalNodes: 200, totalEdges: 400 }).meetsTarget).toBe(true)
  })
})

describe('§21.5 SLO 判定', () => {
  it('passes when all metrics within target', () => {
    const r = evaluatePerfSlo({ canvasInteractionP95Ms: 40, longTaskOver100MsCount: 0, longTaskOver50MsCount: 3, memoryGrowthPct: 15 })
    expect(r.meetsSlo).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('violates when p95 over 50ms', () => {
    const r = evaluatePerfSlo({ canvasInteractionP95Ms: 80 })
    expect(r.meetsSlo).toBe(false)
    expect(r.violations.some((v) => v.includes('p95'))).toBe(true)
  })

  it('violates when memory growth over 20%', () => {
    const r = evaluatePerfSlo({ memoryGrowthPct: 35 })
    expect(r.meetsSlo).toBe(false)
  })

  it('PERF_SLO_TARGETS documents the gate values', () => {
    expect(PERF_SLO_TARGETS.canvasInteractionP95Ms).toBe(50)
    expect(PERF_SLO_TARGETS.longTaskOver100MsCount).toBe(0)
    expect(PERF_SLO_TARGETS.memoryGrowthAfter30CyclesPct).toBe(20)
  })
})

describe('§22 安全审计框架', () => {
  it('runSecurityAudit returns summary; P1 fixes + BOM audit complete (all pass)', () => {
    const r = runSecurityAudit()
    expect(r.summary.pass).toBeGreaterThanOrEqual(7) // 凭据加密/renderer只见hasApiKey/日志脱敏/路径安全/输出限制/includeApiKeys修复/browser修复/mannequin修复/源代码BOM/模型权重BOM审计完成
    // 模型权重 BOM 审计完成 100%（22/22，0 release-blocking）
    const bomItem = r.items.find((i) => i.check.includes('模型权重'))
    expect(bomItem?.verdict).toBe('pass')
  })

  it('P1 fixes verified: includeApiKeys / browser bridge / mannequin now pass', () => {
    const r = runSecurityAudit()
    const includeApiKeys = r.items.find((i) => i.check.includes('includeApiKeys'))
    const browserBridge = r.items.find((i) => i.check.includes('browser bridge'))
    const mannequin = r.items.find((i) => i.check.includes('mannequin'))
    expect(includeApiKeys?.verdict).toBe('pass')
    expect(browserBridge?.verdict).toBe('pass')
    expect(mannequin?.verdict).toBe('pass')
  })

  it('every audit item has evidence (§P10 证据优先)', () => {
    for (const item of KNOWN_SECURITY_RISKS) {
      expect(item.evidence).toBeTruthy()
      expect(item.evidence.length).toBeGreaterThan(10)
    }
  })

  it('warn/fail items have remediation', () => {
    for (const item of KNOWN_SECURITY_RISKS) {
      if (item.verdict === 'warn' || item.verdict === 'fail') {
        expect(item.remediation).toBeTruthy()
      }
    }
  })

  it('filterAuditByCategory returns matching category items', () => {
    const creds = filterAuditByCategory('credential')
    expect(creds.every((c) => c.category === 'credential')).toBe(true)
    expect(creds.length).toBeGreaterThan(0)
  })

  it('includeApiKeys risk is now mitigated (Gate 7 P1 fix documented in audit)', () => {
    const item = KNOWN_SECURITY_RISKS.find((i) => i.check.includes('includeApiKeys'))
    expect(item).toBeDefined()
    expect(item!.verdict).toBe('pass') // P1 fixed: exportModelCatalogPackage never returns keys
    expect(item!.evidence).toContain('catalogStore.ts')
  })

  it('browser bridge allowlist is now in place (Gate 7 P1 fix documented in audit)', () => {
    const item = KNOWN_SECURITY_RISKS.find((i) => i.check.includes('browser bridge'))
    expect(item).toBeDefined()
    expect(item!.verdict).toBe('pass') // P1 fixed: browserAllowlist.ts + normalizeBrowserUrl integration
  })
})

describe('scanForCredentialLeak — 凭据泄漏自检（§22.1）', () => {
  it('detects OpenAI sk- key', () => {
    const r = scanForCredentialLeak('config: sk-proj-abcdef1234567890ijklmnop')
    expect(r.leaked).toBe(true)
    expect(r.matches.some((m) => m.startsWith('sk-'))).toBe(true)
  })

  it('detects Bearer token', () => {
    const r = scanForCredentialLeak('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(r.leaked).toBe(true)
  })

  it('clean text → no leak', () => {
    const r = scanForCredentialLeak('林夏站在天台，风很大')
    expect(r.leaked).toBe(false)
  })
})
