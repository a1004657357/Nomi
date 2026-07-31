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
  { label: '画面', fields: ['scene', 'props', 'notes'] },
  { label: '摄影', fields: ['shotSize', 'cameraAngle', 'cameraMove'] },
  { label: '角色/表演', fields: ['characters', 'performance'] },
  { label: '对白/声音', fields: ['dialogue', 'sound'] },
]
