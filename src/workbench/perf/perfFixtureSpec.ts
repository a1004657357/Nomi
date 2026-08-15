/**
 * Gate 7 — 200 节点性能 fixture 规格（§21.1）。
 *
 * 对应目标架构 §21.1「验收规模：200 个节点、400 条逻辑连接、12 镜分镜表」。
 * 现状（Gate 0 §5.1 证据）：既有 fixture（tests/ux/fixtures/gen-perf-fixture.mjs）是 96 节点/156 边/20 clip，
 * **不达目标 200/400**。本模块交付 200 节点 fixture 的**纯数据规格**（fixture 生成器据此造数据，
 * 既有 96 节点 fixture 保留不动——避免破坏既有 perf 基线）。
 *
 * 设计：
 * - **纯函数 spec**：给定节点数/边数，产出 fixture 描述（节点 kind 分布 + 边拓扑 + 分镜表镜头数）。
 * - **§21.1 对齐**：默认 200 节点 / 400 边 / 12 镜分镜 / 每镜 3 资产引用。
 * - **可注入生成器**：调用方（perf.e2e.mjs 或测试）按 spec 造真实 canvas 节点。
 */

/** §21.1 性能验收规模。 */
export type PerfFixtureSpec = {
  totalNodes: number
  totalEdges: number
  /** 镜头数（分镜表行数）。 */
  shotCount: number
  /** 每镜资产引用数（角色/场景/道具）。 */
  refsPerShot: number
  /** 节点 kind 分布（kind → 数量）。 */
  nodeKindDistribution: Record<string, number>
  /** 边拓扑描述。 */
  edgeTopology: {
    /** 镜头内参考边（每镜 refsPerShot 条）。 */
    intraShot: number
    /** 跨镜/跨资产边（造毛线球）。 */
    crossShot: number
  }
  /** timeline clip 数。 */
  timelineClips: number
}

/**
 * §21.1 目态：200 节点 / 400 边 / 12 镜 / 每镜 3 引用。
 *
 * 节点分布（约）：
 * - 12 镜头（image/video）
 * - 36 资产卡（12 镜 × 3 引用：角色/场景/道具）
 * - 152 其他节点（text/panorama/辅助）凑到 200
 */
export const TARGET_PERF_FIXTURE_SPEC: PerfFixtureSpec = {
  totalNodes: 200,
  totalEdges: 400,
  shotCount: 12,
  refsPerShot: 3,
  nodeKindDistribution: {
    video: 8,
    image: 4, // 12 镜头（8 video + 4 image）
    character: 12,
    scene: 12,
    prop: 12, // 36 资产卡
    text: 80,
    panorama: 20,
    staging: 22,
    creativeResource: 30, // 凑到 200 的辅助节点
  },
  edgeTopology: {
    intraShot: 36, // 12 镜 × 3 引用
    crossShot: 364, // 凑到 400 总边
  },
  timelineClips: 24,
}

/**
 * 校验某 fixture 是否达 §21.1 目态规模。
 * 供 perf 测试入口确认 fixture 规模正确（防 fixture 退化）。
 */
export function assertFixtureMeetsTarget(actual: {
  totalNodes: number
  totalEdges: number
  shotCount?: number
}): { meetsTarget: boolean; gaps: string[] } {
  const gaps: string[] = []
  if (actual.totalNodes < TARGET_PERF_FIXTURE_SPEC.totalNodes) {
    gaps.push(`节点数 ${actual.totalNodes} < 目标 ${TARGET_PERF_FIXTURE_SPEC.totalNodes}`)
  }
  if (actual.totalEdges < TARGET_PERF_FIXTURE_SPEC.totalEdges) {
    gaps.push(`边数 ${actual.totalEdges} < 目标 ${TARGET_PERF_FIXTURE_SPEC.totalEdges}`)
  }
  return { meetsTarget: gaps.length === 0, gaps }
}

/** §21.5 SLO 目标值（性能验收线）。测试必须记录机器型号/系统/build/采样方法。 */
export const PERF_SLO_TARGETS = {
  canvasInteractionP95Ms: 50,
  longTaskOver100MsCount: 0,
  longTaskOver50MsMax: 5,
  sixtySecondsInputLiveness: true,
  memoryGrowthAfter30CyclesPct: 20,
  subprocessCleanupSeconds: 10,
  taskRecoverySeconds: 10,
} as const

/**
 * 给定实测 perf 指标，判定是否达 §21.5 SLO。
 * 未达标时返回 bottleneck（供报告）。
 */
export function evaluatePerfSlo(actual: {
  canvasInteractionP95Ms?: number
  longTaskOver100MsCount?: number
  longTaskOver50MsCount?: number
  memoryGrowthPct?: number
}): { meetsSlo: boolean; violations: string[] } {
  const violations: string[] = []
  if (actual.canvasInteractionP95Ms != null && actual.canvasInteractionP95Ms > PERF_SLO_TARGETS.canvasInteractionP95Ms) {
    violations.push(`画布交互 p95 ${actual.canvasInteractionP95Ms}ms > ${PERF_SLO_TARGETS.canvasInteractionP95Ms}ms`)
  }
  if (actual.longTaskOver100MsCount != null && actual.longTaskOver100MsCount > PERF_SLO_TARGETS.longTaskOver100MsCount) {
    violations.push(`>100ms long task ${actual.longTaskOver100MsCount} > ${PERF_SLO_TARGETS.longTaskOver100MsCount}`)
  }
  if (actual.longTaskOver50MsCount != null && actual.longTaskOver50MsCount > PERF_SLO_TARGETS.longTaskOver50MsMax) {
    violations.push(`>50ms long task ${actual.longTaskOver50MsCount} > ${PERF_SLO_TARGETS.longTaskOver50MsMax}`)
  }
  if (actual.memoryGrowthPct != null && actual.memoryGrowthPct > PERF_SLO_TARGETS.memoryGrowthAfter30CyclesPct) {
    violations.push(`内存增长 ${actual.memoryGrowthPct}% > ${PERF_SLO_TARGETS.memoryGrowthAfter30CyclesPct}%`)
  }
  return { meetsSlo: violations.length === 0, violations }
}
