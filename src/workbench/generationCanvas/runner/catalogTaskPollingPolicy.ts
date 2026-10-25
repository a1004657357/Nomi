import type { TaskKind } from '../../api/taskApi'

const LONG_RUNNING_TASK_KINDS = new Set<TaskKind>([
  'text_to_video',
  'image_to_video',
  'text_to_3d',
  'image_to_3d',
])

const JIMENG_WEB_IMAGE_TASK_KINDS = new Set<TaskKind>([
  'text_to_image',
  'image_edit',
])

export function resolveCatalogTaskPollingPolicy(kind: TaskKind, vendor = ''): {
  softTimeoutMs: number
  hardTimeoutMs: number
} {
  if (vendor === 'jimeng-web' && JIMENG_WEB_IMAGE_TASK_KINDS.has(kind)) {
    return { softTimeoutMs: 300_000, hardTimeoutMs: 1_800_000 }
  }
  if (vendor === 'pavo-web' && LONG_RUNNING_TASK_KINDS.has(kind)) {
    return { softTimeoutMs: 600_000, hardTimeoutMs: 3_600_000 }
  }
  return LONG_RUNNING_TASK_KINDS.has(kind)
    ? { softTimeoutMs: 300_000, hardTimeoutMs: 1_200_000 }
    : { softTimeoutMs: 120_000, hardTimeoutMs: 120_000 }
}
