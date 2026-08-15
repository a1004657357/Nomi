/**
 * Gate 5 — 自动验收架构（§18 四层质量门 + EvaluationReport）。
 *
 * 对应目标架构 §18「自动验收架构」+ §9.6 EvaluationReport。
 * 现状（Gate 0 §1.12 证据）：既有的是 5 层 eval 系统（L0 确定性 vitest / L1 agent 端态 / L3a 技术自检），
 * 但**无** Gate A/B/C/D 分类（pre-request/technical/semantic/continuity），§18 的 EvaluationReport 类型不存在。
 *
 * 设计：
 * - **Gate A（请求前检查）+ Gate B（技术质量）= 确定性规则**：本 Slice 实现（纯函数，可单测）。
 * - **Gate C（语义与电影技法）+ Gate D（跨镜连续性）= 需 VLM**：本 Slice 定义 EvaluationReport 形 +
 *   连续性规则框架（确定性部分先做，VLM 评分留 run_optional_gpu_evaluation，Gate 2 标 deferred to Gate 5）。
 * - **§9.6 EvaluationReport**：四层结构（technical/semantic/cinematic/continuity）+ verdict + 证据。
 * - **§18.2 不变量**：自动验收保存证据和 evaluator 版本，不能只给不可解释总分；
 *   §9 自动验收不能替代人类决策（verdict=warn 不自动删用户资产）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 EvaluationReport（与 src/workbench/domain/cinematicTypes 对齐；此处 electron 本地镜像）
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationVerdict = 'pass' | 'warn' | 'fail'

export type TechnicalCheck = {
  criterion: string
  result: 'pass' | 'fail'
  /** 实测值（如实际分辨率/时长）。 */
  actual?: string | number
  /** 期望值。 */
  expected?: string | number
  evidence: string
}

export type SemanticCriterion = { criterion: string; score: number; evidence: string }
export type CinematicDimension = { dimension: string; score: number; evidence: string }
export type ContinuityCheck = {
  rule: string
  status: 'pass' | 'warn' | 'fail'
  evidence: string
}

export type EvaluationReport = {
  verdict: EvaluationVerdict
  technical: TechnicalCheck[]
  semantic: SemanticCriterion[]
  cinematic: CinematicDimension[]
  continuity: ContinuityCheck[]
  recommendedAction?: string
  evaluatorVersions: string[]
}

/** §18.2：评分输出必须含证据 + evaluator 版本（构造器强制）。 */
export function buildEvaluationReport(input: {
  technical?: TechnicalCheck[]
  semantic?: SemanticCriterion[]
  cinematic?: CinematicDimension[]
  continuity?: ContinuityCheck[]
  recommendedAction?: string
  evaluatorVersions: string[]
}): EvaluationReport {
  const technical = input.technical ?? []
  const semantic = input.semantic ?? []
  const cinematic = input.cinematic ?? []
  const continuity = input.continuity ?? []

  // verdict 聚合规则：任一 technical fail → fail；否则任一 continuity fail → fail；
  // 任一 warn → warn；否则 pass。semantic/cinematic 是分数（0–1），不直接定 verdict（§9 自动验收不替代人类决策）。
  const hasTechnicalFail = technical.some((t) => t.result === 'fail')
  const hasContinuityFail = continuity.some((c) => c.status === 'fail')
  const hasWarn = continuity.some((c) => c.status === 'warn')
  let verdict: EvaluationVerdict
  if (hasTechnicalFail || hasContinuityFail) {
    verdict = 'fail'
  } else if (hasWarn) {
    verdict = 'warn'
  } else {
    verdict = 'pass'
  }

  return {
    verdict,
    technical,
    semantic,
    cinematic,
    continuity,
    ...(input.recommendedAction ? { recommendedAction: input.recommendedAction } : {}),
    evaluatorVersions: input.evaluatorVersions,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate A：请求前检查（§18.1）—— 确定性，纯函数
// ─────────────────────────────────────────────────────────────────────────────

export type GateACheck = {
  criterion: string
  passed: boolean
  evidence: string
}

/**
 * Gate A：请求前检查（§18.1）。检查生成意图与能力是否匹配，**不查媒体内容**。
 * 返回所有检查项；任一 failed → 调用方应阻止提交（不付费）。
 */
export function evaluateGateA(input: {
  mediaKind: string
  mode: string
  capabilities: {
    mediaKind: string
    modes: string[]
    maxReferences: number
    maxOutputs: number
    aspectRatios: string[]
    durationsSeconds: number[]
  }
  references: Array<{ role?: string }>
  outputCount: number
  aspectRatio: string
  durationSeconds?: number
  prompt: string
}): { checks: GateACheck[]; passed: boolean } {
  const checks: GateACheck[] = []

  // 模型和媒体类型匹配
  checks.push({
    criterion: 'mediaKind 匹配',
    passed: input.mediaKind === input.capabilities.mediaKind,
    evidence: `intent=${input.mediaKind} vs capability=${input.capabilities.mediaKind}`,
  })

  // 生成模式受支持
  checks.push({
    criterion: 'mode 受支持',
    passed: input.capabilities.modes.length === 0 || input.capabilities.modes.includes(input.mode),
    evidence: `mode=${input.mode}, supported=[${input.capabilities.modes.join(',')}]`,
  })

  // 参考数量合法（§9.2：每张参考有 role）
  const nakedRefs = input.references.filter((r) => !r.role).length
  checks.push({
    criterion: '参考数量合法 + 无裸数组',
    passed:
      nakedRefs === 0 &&
      input.references.length <= (input.capabilities.maxReferences || input.references.length),
    evidence: `refs=${input.references.length}, naked=${nakedRefs}, max=${input.capabilities.maxReferences}`,
  })

  // outputCount 合法
  checks.push({
    criterion: 'outputCount 合法',
    passed: input.outputCount <= (input.capabilities.maxOutputs || input.outputCount),
    evidence: `outputCount=${input.outputCount}, max=${input.capabilities.maxOutputs}`,
  })

  // 画幅合法
  checks.push({
    criterion: '画幅合法',
    passed: input.capabilities.aspectRatios.length === 0 || input.capabilities.aspectRatios.includes(input.aspectRatio),
    evidence: `aspect=${input.aspectRatio}, supported=[${input.capabilities.aspectRatios.join(',')}]`,
  })

  // 时长合法（视频）
  if (input.mediaKind === 'video' && input.durationSeconds != null) {
    checks.push({
      criterion: '时长合法',
      passed:
        input.capabilities.durationsSeconds.length === 0 ||
        input.capabilities.durationsSeconds.includes(input.durationSeconds),
      evidence: `duration=${input.durationSeconds}s, supported=[${input.capabilities.durationsSeconds.join(',')}]`,
    })
  }

  // Prompt 不含明显空间矛盾（简化版：检测「同时可见 + 不可见」模式）
  const contradiction = /同时.*(?:可见|不可见)|背面.*屏幕.*可见/.test(input.prompt)
  checks.push({
    criterion: 'Prompt 无明显空间矛盾',
    passed: !contradiction,
    evidence: contradiction ? '检测到「同时可见/不可见」或「背面+屏幕可见」矛盾模式' : '无明显矛盾',
  })

  return { checks, passed: checks.every((c) => c.passed) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate B：技术质量（§18.1）—— 确定性，查媒体文件元数据
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gate B：技术质量（§18.1）。检查媒体文件本身是否合法。
 * 纯函数：调用方注入 fileMeta（实测的元数据），本函数判定。
 */
export function evaluateGateB(input: {
  fileMeta: {
    exists: boolean
    sizeBytes: number
    mimeType?: string
    width?: number
    height?: number
    durationSeconds?: number
    hasAudioTrack?: boolean
    /** 全黑/全白/损坏检测（调用方用 ffprobe/像素采样提供）。 */
    isBlack?: boolean
    isWhite?: boolean
    isCorrupt?: boolean
    isFrozen?: boolean
  }
  expected: {
    aspectRatio?: string
    durationSeconds?: number
    mediaKind: 'image' | 'video'
    expectAudio?: boolean
  }
}): { checks: TechnicalCheck[]; passed: boolean } {
  const checks: TechnicalCheck[] = []
  const f = input.fileMeta

  // 文件存在且非空
  checks.push({
    criterion: '文件存在且非空',
    result: f.exists && f.sizeBytes > 0 ? 'pass' : 'fail',
    actual: f.sizeBytes,
    evidence: f.exists ? `size=${f.sizeBytes}B` : '文件不存在',
  })

  // MIME 可读
  checks.push({
    criterion: 'MIME 可读',
    result: f.mimeType ? 'pass' : 'fail',
    actual: f.mimeType,
    evidence: f.mimeType ?? '无 MIME',
  })

  // 实际画幅/分辨率符合
  if (input.expected.aspectRatio && f.width && f.height) {
    const actualRatio = simplifyRatio(f.width, f.height)
    checks.push({
      criterion: '实际画幅符合',
      result: actualRatio === input.expected.aspectRatio ? 'pass' : 'fail',
      actual: `${f.width}x${f.height} (${actualRatio})`,
      expected: input.expected.aspectRatio,
      evidence: `${actualRatio} vs ${input.expected.aspectRatio}`,
    })
  }

  // 实际时长符合（视频）
  if (input.expected.mediaKind === 'video' && input.expected.durationSeconds != null && f.durationSeconds != null) {
    const diff = Math.abs(f.durationSeconds - input.expected.durationSeconds)
    checks.push({
      criterion: '实际时长符合',
      result: diff <= 0.5 ? 'pass' : 'fail', // 0.5s 容差
      actual: `${f.durationSeconds}s`,
      expected: `${input.expected.durationSeconds}s`,
      evidence: `diff=${diff.toFixed(2)}s`,
    })
  }

  // 无全黑/全白/损坏/冻结
  if (f.isBlack) {
    checks.push({ criterion: '无全黑帧', result: 'fail', evidence: '检测到全黑' })
  }
  if (f.isWhite) {
    checks.push({ criterion: '无全白帧', result: 'fail', evidence: '检测到全白' })
  }
  if (f.isCorrupt) {
    checks.push({ criterion: '文件未损坏', result: 'fail', evidence: '损坏' })
  }
  if (f.isFrozen) {
    checks.push({ criterion: '无严重冻结', result: 'fail', evidence: '严重冻结（动态图片感）' })
  }

  // 视频预期音轨时确实存在
  if (input.expected.mediaKind === 'video' && input.expected.expectAudio) {
    checks.push({
      criterion: '音轨存在',
      result: f.hasAudioTrack ? 'pass' : 'fail',
      evidence: f.hasAudioTrack ? '有音轨' : '缺音轨',
    })
  }

  return { checks, passed: checks.every((c) => c.result === 'pass') }
}

function simplifyRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate D：跨镜连续性（§18.1）—— 确定性规则框架（VLM 评分留 run_optional_gpu_evaluation）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gate D：跨镜连续性（§18.1）框架。
 * 确定性部分：检查 ShotSpec 声明的 continuity 约束是否被 revision 满足（如屏向匹配）。
 * VLM 部分（身份/服装/道具状态一致性）留 run_optional_gpu_evaluation（deferred to Gate 5 VLM 接入）。
 */
export function evaluateGateD(input: {
  currentShot: {
    id: string
    continuity: Array<{ kind: string; rule: string; sourceShotId?: string }>
    cinematography?: { screenDirection?: string }
  }
  previousShot?: {
    id: string
    cinematography?: { screenDirection?: string }
  }
  /** 当前 revision 的实测（VLM 提供的部分留空 = warn）。 */
  observed?: {
    screenDirection?: string
  }
}): { checks: ContinuityCheck[] } {
  const checks: ContinuityCheck[] = []

  // 屏向连续性（接戏）
  const screenDirConstraint = input.currentShot.continuity.find((c) => c.kind === 'screen-direction')
  if (screenDirConstraint && input.previousShot?.cinematography?.screenDirection) {
    const prevDir = input.previousShot.cinematography.screenDirection
    const currDir = input.observed?.screenDirection ?? input.currentShot.cinematography?.screenDirection
    if (currDir == null) {
      checks.push({
        rule: screenDirConstraint.rule,
        status: 'warn',
        evidence: `无法判定当前屏向（缺 observed）`,
      })
    } else if (currDir === prevDir) {
      checks.push({ rule: screenDirConstraint.rule, status: 'pass', evidence: `${currDir} = 上一镜 ${prevDir}` })
    } else {
      checks.push({
        rule: screenDirConstraint.rule,
        status: 'fail',
        evidence: `${currDir} ≠ 上一镜 ${prevDir}（违反屏向匹配）`,
      })
    }
  }

  // 其余 continuity 约束（无确定性检查的）→ warn（待 VLM）
  for (const c of input.currentShot.continuity) {
    if (c.kind === 'screen-direction') continue // 已处理
    checks.push({
      rule: c.rule,
      status: 'warn',
      evidence: `${c.kind} 连续性需 VLM 验收（确定性规则未覆盖）`,
    })
  }

  return { checks }
}
