import type { BlenderSpatialCheckStatus } from '../../../../../electron/shared/blenderDirectorContract'
import type {
  BlenderDirectorSpatialReport,
  VibingDirectorState,
} from './vibingDirectorState'

export type VibingDirectorSpatialSummary = {
  status: 'idle' | BlenderSpatialCheckStatus
  total: number
  passed: number
  warning: number
  failed: number
  label: string
  issues: string[]
}

export function formatVibingDirectorNodeStats(state: VibingDirectorState): string {
  return `${state.assets.length} 资产 · ${state.objects.length} 对象 · ${state.relations.length} 关系 · ${state.beats.length} 节拍`
}

export function summarizeVibingDirectorSpatialReport(
  report: BlenderDirectorSpatialReport | undefined,
): VibingDirectorSpatialSummary {
  if (!report) {
    return {
      status: 'idle',
      total: 0,
      passed: 0,
      warning: 0,
      failed: 0,
      label: '尚无空间检测',
      issues: [],
    }
  }
  const passed = report.checks.filter((check) => check.status === 'passed').length
  const warning = report.checks.filter((check) => check.status === 'warning').length
  const failed = report.checks.filter((check) => check.status === 'failed').length
  const status = failed > 0 || !report.passed
    ? 'failed'
    : warning > 0
      ? 'warning'
      : 'passed'
  return {
    status,
    total: report.checks.length,
    passed,
    warning,
    failed,
    label: status === 'failed'
      ? '空间关系未通过'
      : status === 'warning'
        ? '空间关系有警告'
        : '空间关系已通过',
    issues: report.checks
      .filter((check) => check.status !== 'passed')
      .map((check) => check.message),
  }
}
