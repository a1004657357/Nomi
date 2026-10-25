import type { BlenderSpatialCheckStatus } from '../../../../../electron/shared/blenderDirectorContract'
import i18n from "../../../../i18n"
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
  return i18n.t("customWorkflow.assetsObjectsRelationsBeats", { v0: state.assets.length, v1: state.objects.length, v2: state.relations.length, v3: state.beats.length })
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
      label: i18n.t("customWorkflow.noSpatialCheckYet"),
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
      ? i18n.t("customWorkflow.spatialRelationsFailed")
      : status === 'warning'
        ? i18n.t("customWorkflow.spatialRelationsHaveWarnings")
        : i18n.t("customWorkflow.spatialRelationsPassed"),
    issues: report.checks
      .filter((check) => check.status !== 'passed')
      .map((check) => check.message),
  }
}
