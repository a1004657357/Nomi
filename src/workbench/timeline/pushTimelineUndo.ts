import type { TimelineUndoEntry } from './timelineUndoHistory'
import type { TimelineState } from './timelineTypes'

const TIMELINE_UNDO_LIMIT = 30

export function pushTimelineUndo(stack: TimelineUndoEntry[], previous: TimelineState): TimelineUndoEntry[] {
  const next = [...stack, previous]
  if (next.length > TIMELINE_UNDO_LIMIT) next.shift()
  return next
}

