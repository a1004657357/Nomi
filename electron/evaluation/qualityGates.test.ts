/**
 * Gate 5 测试：自动验收架构（§18 Gate A/B/D + EvaluationReport）。
 *
 * 验收：
 * - Gate A：mediaKind/mode/refs/outputCount/aspect/duration/矛盾 检查。
 * - Gate B：文件存在/MIME/画幅/时长/黑帧/冻结/音轨 检查。
 * - Gate D：屏向连续性 + 其余约束 warn（VLM 待）。
 * - EvaluationReport：verdict 聚合（technical/continuity fail→fail，warn→warn）+ evaluator 版本必填。
 */
import { describe, expect, it } from 'vitest'
import {
  buildEvaluationReport,
  evaluateGateA,
  evaluateGateB,
  evaluateGateD,
} from './qualityGates'

describe('Gate A — 请求前检查（§18.1）', () => {
  const baseCap = {
    mediaKind: 'video',
    modes: ['text-to-video', 'omni-reference'],
    maxReferences: 3,
    maxOutputs: 1,
    aspectRatios: ['16:9', '9:16'],
    durationsSeconds: [5, 10],
  }
  const baseInput = {
    mediaKind: 'video',
    mode: 'text-to-video',
    capabilities: baseCap,
    references: [] as Array<{ role?: string }>,
    outputCount: 1,
    aspectRatio: '9:16',
    durationSeconds: 5,
    prompt: '林夏转身',
  }

  it('passes when everything fits', () => {
    const r = evaluateGateA(baseInput)
    expect(r.passed).toBe(true)
  })

  it('fails on mediaKind mismatch', () => {
    const r = evaluateGateA({ ...baseInput, mediaKind: 'image' })
    expect(r.passed).toBe(false)
    expect(r.checks.some((c) => c.criterion === 'mediaKind 匹配' && !c.passed)).toBe(true)
  })

  it('fails on unsupported mode', () => {
    const r = evaluateGateA({ ...baseInput, mode: 'nonexistent-mode' })
    expect(r.passed).toBe(false)
  })

  it('fails on naked reference array (no role)', () => {
    const r = evaluateGateA({ ...baseInput, references: [{}, {}] })
    expect(r.passed).toBe(false)
  })

  it('fails on outputCount over max', () => {
    const r = evaluateGateA({ ...baseInput, outputCount: 5 })
    expect(r.passed).toBe(false)
  })

  it('fails on unsupported aspectRatio', () => {
    const r = evaluateGateA({ ...baseInput, aspectRatio: '4:5' })
    expect(r.passed).toBe(false)
  })

  it('fails on unsupported duration', () => {
    const r = evaluateGateA({ ...baseInput, durationSeconds: 7 })
    expect(r.passed).toBe(false)
  })

  it('detects spatial contradiction in prompt (背面+屏幕可见)', () => {
    const r = evaluateGateA({ ...baseInput, prompt: '手机背面朝镜头，屏幕内容可见' })
    expect(r.checks.some((c) => /空间矛盾/.test(c.criterion) && !c.passed)).toBe(true)
  })

  it('passes when capability arrays empty (migration-era, no enforcement)', () => {
    const r = evaluateGateA({
      ...baseInput,
      capabilities: { ...baseCap, modes: [], aspectRatios: [], durationsSeconds: [] },
      mode: 'anything',
      aspectRatio: 'anything',
      durationSeconds: 99,
    })
    expect(r.passed).toBe(true)
  })
})

describe('Gate B — 技术质量（§18.1）', () => {
  const baseFile = {
    exists: true,
    sizeBytes: 1000,
    mimeType: 'video/mp4',
    width: 1080,
    height: 1920,
    durationSeconds: 5,
    hasAudioTrack: true,
  }
  const baseExpected = { mediaKind: 'video' as const, aspectRatio: '9:16', durationSeconds: 5, expectAudio: true }

  it('passes for valid video', () => {
    const r = evaluateGateB({ fileMeta: baseFile, expected: baseExpected })
    expect(r.passed).toBe(true)
  })

  it('fails on missing file', () => {
    const r = evaluateGateB({ fileMeta: { ...baseFile, exists: false, sizeBytes: 0 }, expected: baseExpected })
    expect(r.passed).toBe(false)
  })

  it('fails on wrong aspect ratio', () => {
    const r = evaluateGateB({
      fileMeta: { ...baseFile, width: 1920, height: 1080 },
      expected: baseExpected,
    })
    expect(r.passed).toBe(false)
  })

  it('fails on wrong duration (>0.5s tolerance)', () => {
    const r = evaluateGateB({
      fileMeta: { ...baseFile, durationSeconds: 7 },
      expected: baseExpected,
    })
    expect(r.passed).toBe(false)
  })

  it('fails on black/frozen/corrupt frames', () => {
    expect(evaluateGateB({ fileMeta: { ...baseFile, isBlack: true }, expected: baseExpected }).passed).toBe(false)
    expect(evaluateGateB({ fileMeta: { ...baseFile, isFrozen: true }, expected: baseExpected }).passed).toBe(false)
    expect(evaluateGateB({ fileMeta: { ...baseFile, isCorrupt: true }, expected: baseExpected }).passed).toBe(false)
  })

  it('fails on missing audio when expected', () => {
    const r = evaluateGateB({
      fileMeta: { ...baseFile, hasAudioTrack: false },
      expected: baseExpected,
    })
    expect(r.passed).toBe(false)
  })
})

describe('Gate D — 跨镜连续性（§18.1）', () => {
  it('passes when screen direction matches previous shot', () => {
    const r = evaluateGateD({
      currentShot: {
        id: 'shot-2',
        continuity: [{ kind: 'screen-direction', rule: '接上一镜屏向', sourceShotId: 'shot-1' }],
        cinematography: { screenDirection: '左' },
      },
      previousShot: { id: 'shot-1', cinematography: { screenDirection: '左' } },
    })
    expect(r.checks[0].status).toBe('pass')
  })

  it('fails when screen direction mismatches', () => {
    const r = evaluateGateD({
      currentShot: {
        id: 'shot-2',
        continuity: [{ kind: 'screen-direction', rule: '接戏', sourceShotId: 'shot-1' }],
        cinematography: { screenDirection: '右' },
      },
      previousShot: { id: 'shot-1', cinematography: { screenDirection: '左' } },
    })
    expect(r.checks[0].status).toBe('fail')
  })

  it('warns when screen direction cannot be determined', () => {
    const r = evaluateGateD({
      currentShot: {
        id: 'shot-2',
        continuity: [{ kind: 'screen-direction', rule: '接戏' }],
      },
      previousShot: { id: 'shot-1', cinematography: { screenDirection: '左' } },
    })
    expect(r.checks[0].status).toBe('warn')
  })

  it('non-screen-direction constraints → warn (VLM needed)', () => {
    const r = evaluateGateD({
      currentShot: {
        id: 's',
        continuity: [
          { kind: 'costume', rule: '林夏穿红衣' },
          { kind: 'identity', rule: '反派身份一致' },
        ],
      },
    })
    expect(r.checks.every((c) => c.status === 'warn')).toBe(true)
    expect(r.checks.length).toBe(2)
  })
})

describe('EvaluationReport — verdict 聚合 + 证据', () => {
  it('verdict=fail when any technical check fails', () => {
    const report = buildEvaluationReport({
      technical: [{ criterion: '文件存在', result: 'fail', evidence: '不存在' }],
      evaluatorVersions: ['gateB@1.0'],
    })
    expect(report.verdict).toBe('fail')
  })

  it('verdict=fail when any continuity check fails', () => {
    const report = buildEvaluationReport({
      continuity: [{ rule: '屏向', status: 'fail', evidence: '不匹配' }],
      evaluatorVersions: ['gateD@1.0'],
    })
    expect(report.verdict).toBe('fail')
  })

  it('verdict=warn when continuity has warn but no fail', () => {
    const report = buildEvaluationReport({
      continuity: [{ rule: '服装', status: 'warn', evidence: '需 VLM' }],
      evaluatorVersions: ['gateD@1.0'],
    })
    expect(report.verdict).toBe('warn')
  })

  it('verdict=pass when all clean', () => {
    const report = buildEvaluationReport({
      technical: [{ criterion: '文件存在', result: 'pass', evidence: 'ok' }],
      continuity: [{ rule: '屏向', status: 'pass', evidence: '一致' }],
      evaluatorVersions: ['gateB@1.0', 'gateD@1.0'],
    })
    expect(report.verdict).toBe('pass')
  })

  it('always includes evaluatorVersions (§18.2: no unexplainable score)', () => {
    const report = buildEvaluationReport({ evaluatorVersions: ['v1'] })
    expect(report.evaluatorVersions).toEqual(['v1'])
    expect(report.technical).toEqual([])
    expect(report.semantic).toEqual([])
  })

  it('semantic/cinematic scores do not alone determine verdict (§9: human decides)', () => {
    const report = buildEvaluationReport({
      semantic: [{ criterion: '人物一致', score: 0.3, evidence: '低分' }],
      cinematic: [{ dimension: '构图', score: 0.2, evidence: '差' }],
      evaluatorVersions: ['vlm@1.0'],
    })
    // 低分但不 fail（让用户决定，§9 自动验收不替代人类决策）
    expect(report.verdict).toBe('pass')
  })
})
