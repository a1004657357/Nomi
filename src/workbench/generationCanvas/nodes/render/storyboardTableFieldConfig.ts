import i18n from "../../../../i18n"
import type { PlanShot } from '../../agent/storyboardPlan'

export type ShotTextField = Extract<
  keyof PlanShot,
  | 'scene'
  | 'shotSize'
  | 'cameraAngle'
  | 'cameraMove'
  | 'characters'
  | 'performance'
  | 'dialogue'
  | 'props'
  | 'sound'
  | 'notes'
>

export const STORYBOARD_FIELD_GROUPS: Array<{ label: string; fields: ShotTextField[] }> = [
  { get label() { return i18n.t("customWorkflow.visuals") }, fields: ['scene', 'props', 'notes'] },
  { get label() { return i18n.t("customWorkflow.cinematography") }, fields: ['shotSize', 'cameraAngle', 'cameraMove'] },
  { get label() { return i18n.t("customWorkflow.characterPerformance") }, fields: ['characters', 'performance'] },
  { get label() { return i18n.t("customWorkflow.dialogueSound") }, fields: ['dialogue', 'sound'] },
]
