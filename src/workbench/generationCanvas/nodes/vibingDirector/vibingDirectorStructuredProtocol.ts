import { directorProtocolSource } from '../../../../../electron/shared/blenderDirectorProtocolText'
import type { BlenderDirectorStagePreset } from '../../../../../electron/shared/blenderDirectorContract'
import { canonicalActionSchema as actionSchema, parseVibingDirectorPlanRequest as parseStrictRequest } from '../../../../../electron/shared/vibingDirectorPlan'
import type { VibingDirectorPlan } from './vibingDirectorState'

export type VibingDirectorPlanRequest = {
  directorNodeId: string
  summary: string
  plan: VibingDirectorPlan
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function idFrom(value: unknown, fallback: string): string {
  const source = typeof value === 'string' ? value.trim() : ''
  const normalized = source.replace(/[^a-zA-Z0-9_\-.:\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function vectorFrom(value: unknown): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return [value[0], value[1], value[2]]
  }
  const raw = asRecord(value)
  if (!raw || !['x', 'y', 'z'].every((key) => typeof raw[key] === 'number' && Number.isFinite(raw[key]))) return undefined
  return [raw.x as number, raw.y as number, raw.z as number]
}

function scaleFrom(value: unknown): [number, number, number] | undefined {
  const vector = vectorFrom(value)
  if (vector) return vector
  return typeof value === 'number' && Number.isFinite(value)
    ? [value, value, value]
    : undefined
}

function rotationFromLegacy(raw: Record<string, unknown>): [number, number, number] | undefined {
  const explicit = vectorFrom(raw.rotation)
  if (explicit) return explicit
  return typeof raw.rotationY === 'number' && Number.isFinite(raw.rotationY) ? [0, raw.rotationY, 0] : undefined
}

function stageFromLegacy(type: unknown): BlenderDirectorStagePreset | undefined {
  const value = typeof type === 'string' ? type.toLowerCase() : ''
  if (value === 'empty') return 'empty'
  if (value === 'studio') return 'studio'
  if (value.includes('coffee') || value.includes('cafe')) return 'coffee_shop'
  if (value.includes('street') || value.includes('city')) return 'city_street'
  if (value.includes('room') || value.includes('interior')) return 'interior_room'
  return undefined
}

function knownLegacyCameraRef(value: unknown): 'director-camera' | undefined {
  return idFrom(value, '') === 'director-camera' ? 'director-camera' : undefined
}

function legacyMarkerRole(value: unknown, name: string, pose?: unknown): string | undefined {
  const declared = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const poseText = typeof pose === 'string' ? pose.trim().toLowerCase() : ''
  const source = `${declared} ${name.toLowerCase()} ${poseText}`
  if (declared === 'actor_seated' || declared === 'actor_standing') return declared
  if (/mannequin|character|character_marker|人物|角色|演员|咖啡师|顾客|客人/.test(source)) {
    return /seated|sitting|sit\b|入座|落座|坐|对坐/.test(source)
      ? 'actor_seated'
      : 'actor_standing'
  }
  if (/cup|mug|coffee[-_ ]?cup|咖啡杯|杯/.test(source)) return 'cup'
  if (/laptop|notebook|computer|电脑|笔记本/.test(source)) return 'laptop'
  if (/plate|tray|cake|盘|餐盘|蛋糕/.test(source)) return 'plate'
  if (/chair|seat|椅/.test(source)) return 'chair'
  if (/table|desk|桌/.test(source)) return 'table'
  if (declared === 'prop' || declared === 'prop_marker') return 'prop'
  return declared || undefined
}

function normalizeLegacyPatch(value: unknown, index: number): unknown[] {
  const canonical = actionSchema.safeParse(value)
  if (canonical.success) return [canonical.data]
  const raw = asRecord(value)
  if (!raw) return []
  const op = typeof raw.op === 'string' ? raw.op : ''
  const action = typeof raw.action === 'string' ? raw.action : ''
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const id = idFrom(raw.id ?? raw.targetId ?? raw.objectId ?? raw.beatId, `legacy-${index + 1}`)
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : `对象 ${index + 1}`
  const position = vectorFrom(raw.position)
  const rotation = rotationFromLegacy(raw)
  const scale = scaleFrom(raw.scale)
  const lookAt = vectorFrom(raw.lookAt)
  const fov = typeof raw.fov === 'number' ? raw.fov : typeof raw.focalLength === 'number' ? raw.focalLength : undefined

  // Older Director builds put these actions under plan.actions instead of patches.
  // Convert them into the same constrained action set before Zod validates the plan.
  if (type === 'setstagepreset') {
    const preset = stageFromLegacy(raw.preset ?? raw.stagePreset)
    return preset ? [{ op: 'set_stage', preset }] : []
  }
  if (type === 'addobject') {
    const role = legacyMarkerRole(raw.kind, name, raw.pose)
    return [{
      op: 'add_marker',
      id,
      name,
      ...(role ? { role } : {}),
      ...(position ? { position } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
    }]
  }
  if (type === 'moveobject') {
    const objectRef = idFrom(raw.objectId ?? raw.targetId ?? raw.id, '')
    return objectRef && (position || rotation || scale || typeof raw.label === 'string')
      ? [{ op: 'move_object', objectRef, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}), ...(typeof raw.label === 'string' ? { name: raw.label } : {}) }]
      : []
  }
  if (type === 'removeobject' || type === 'deleteobject') {
    const objectRef = idFrom(raw.objectId ?? raw.targetId ?? raw.id, '')
    return objectRef ? [{ op: 'remove_object', objectRef }] : []
  }
  if (type === 'setdirectorcamera') {
    const cameraRef = knownLegacyCameraRef(raw.objectId ?? raw.targetId ?? raw.id)
    return [{
      op: 'set_camera',
      ...(cameraRef ? { cameraRef } : {}),
      ...(typeof raw.label === 'string' && raw.label.trim() ? { name: raw.label.trim() } : {}),
      ...(position ? { position } : {}),
      ...(lookAt ? { lookAt } : {}),
      ...(fov !== undefined ? { fov } : {}),
    }]
  }
  if (type === 'setcamerapath') {
    const points = Array.isArray(raw.points) ? raw.points.map(vectorFrom).filter((point): point is [number, number, number] => Boolean(point)) : []
    const duration = typeof raw.durationSec === 'number' ? raw.durationSec : typeof raw.duration === 'number' ? raw.duration : undefined
    const cameraRef = knownLegacyCameraRef(raw.objectId ?? raw.targetId ?? raw.id)
    return points.length >= 2 && duration !== undefined
      ? [{ op: 'set_camera_path', ...(cameraRef ? { cameraRef } : {}), points, durationSec: duration }]
      : []
  }
  if (type === 'addbeat') {
    return [{
      op: 'set_beat',
      id,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : directorProtocolSource.beatTitle(index + 1),
      ...(typeof raw.action === 'string' ? { action: raw.action } : {}),
      ...(typeof raw.cameraNote === 'string' ? { cameraNote: raw.cameraNote } : {}),
      ...(typeof raw.dialogue === 'string' ? { dialogue: raw.dialogue } : {}),
      ...(typeof raw.note === 'string' ? { notes: raw.note } : typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
      ...(typeof raw.duration === 'number' ? { durationSec: raw.duration } : typeof raw.durationSec === 'number' ? { durationSec: raw.durationSec } : {}),
    }]
  }

  if (op === 'set_brief') return []
  if (op === 'add_scene') {
    const preset = stageFromLegacy(raw.type)
    return preset ? [{ op: 'set_stage', preset }] : []
  }
  if (op === 'add_object' && type === 'mannequin') {
    return [{ op: 'add_marker', id, name, role: legacyMarkerRole(type, name, raw.pose) ?? 'actor_standing', ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) }]
  }
  if (op === 'add_object') {
    const role = legacyMarkerRole(raw.subtype ?? type, name, raw.pose)
    return [{ op: 'add_marker', id, name, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}), ...(role ? { role } : {}) }]
  }
  if (op === 'move_object') {
    return [{ op: 'move_object', objectRef: id, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) }]
  }
  if (op === 'set_camera_track') {
    const frames = Array.isArray(raw.keyframes) ? raw.keyframes.map(asRecord).filter(Boolean) as Record<string, unknown>[] : []
    const points = frames.map((frame) => vectorFrom(frame.position)).filter((point): point is [number, number, number] => Boolean(point))
    const duration = typeof raw.durationSec === 'number' ? raw.durationSec : typeof raw.duration === 'number' ? raw.duration : frames.at(-1)?.time
    const cameraRef = knownLegacyCameraRef(raw.id ?? raw.targetId ?? raw.objectId)
    return points.length >= 2 && typeof duration === 'number'
      ? [{ op: 'set_camera_path', ...(cameraRef ? { cameraRef } : {}), points, durationSec: duration }]
      : []
  }
  if (op === 'add_beat') {
    return [{
      op: 'set_beat',
      id,
      title: typeof raw.title === 'string' ? raw.title : directorProtocolSource.beatTitle(index + 1),
      ...(typeof raw.action === 'string' ? { action: raw.action } : {}),
      ...(typeof raw.cameraNote === 'string' ? { cameraNote: raw.cameraNote } : typeof raw.camera === 'string' ? { cameraNote: raw.camera } : {}),
      ...(typeof raw.dialogue === 'string' ? { dialogue: raw.dialogue } : {}),
      ...(typeof raw.notes === 'string' ? { notes: raw.notes } : typeof raw.note === 'string' ? { notes: raw.note } : {}),
      ...(typeof raw.duration === 'number' ? { durationSec: raw.duration } : typeof raw.durationSec === 'number' ? { durationSec: raw.durationSec } : {}),
    }]
  }

  if (action === 'create') {
    const preset = stageFromLegacy(type)
    if (preset) return [{ op: 'set_stage', preset }]
    const role = legacyMarkerRole(raw.subtype ?? type, name, raw.pose)
    return [{
      op: 'add_marker',
      id,
      name,
      ...(position ? { position } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
      ...(role ? { role } : {}),
    }]
  }
  if (action === 'update') {
    const target = idFrom(raw.targetId ?? raw.objectId, '')
    const looksLikeCamera = target === 'director-camera' || target.toLowerCase().includes('camera') || raw.lookAt !== undefined || raw.focalLength !== undefined
    if (looksLikeCamera) {
      return [{
        op: 'set_camera',
        ...(knownLegacyCameraRef(target) ? { cameraRef: 'director-camera' } : {}),
        ...(position ? { position } : {}),
        ...(lookAt ? { lookAt } : {}),
        ...(fov !== undefined ? { fov } : {}),
      }]
    }
    return [{ op: 'move_object', objectRef: target || id, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) }]
  }
  return []
}

function migrateLegacyRequest(value: unknown): VibingDirectorPlanRequest | null {
  const raw = asRecord(value)
  if (!raw) return null
  const legacyPlan = asRecord(raw.plan)
  const legacyActions = Array.isArray(raw.patches)
    ? raw.patches
    : Array.isArray(legacyPlan?.actions)
      ? legacyPlan.actions
      : null
  if (!legacyActions) return null
  const actions = legacyActions.flatMap(normalizeLegacyPatch)
  const legacyBrief = Array.isArray(raw.patches)
    ? raw.patches
    .map(asRecord)
    .find((patch) => patch?.op === 'set_brief')?.value
    : legacyPlan?.brief
  const requestedMode = legacyPlan?.mode
  const mode = requestedMode === 'replace' || requestedMode === 'amend'
    ? requestedMode
    : actions.some((item) => asRecord(item)?.op === 'set_stage' || asRecord(item)?.op === 'add_marker') ? 'replace' : 'amend'
  return parseCanonicalRequest({
    directorNodeId: raw.directorNodeId,
    summary: raw.summary,
    plan: {
      mode,
      ...(typeof legacyBrief === 'string' ? { brief: legacyBrief } : {}),
      actions,
    },
  })
}

function parseCanonicalRequest(value: unknown): VibingDirectorPlanRequest | null {
  return parseStrictRequest(value)
}

export function parseVibingDirectorPlanRequest(value: unknown): VibingDirectorPlanRequest | null {
  return parseCanonicalRequest(value) ?? migrateLegacyRequest(value)
}

export function parseVibingDirectorStructuredPlanResponse(text: string): unknown | null {
  const parseJson = (value: string): unknown | null => {
    const trimmed = value.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    const candidates = [
      fenced,
      trimmed,
      firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : '',
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      try { return JSON.parse(candidate) as unknown } catch { /* try the next JSON extraction */ }
    }
    return null
  }

  const unwrap = (value: unknown, depth = 0): unknown => {
    if (depth >= 4) return value
    const raw = asRecord(value)
    if (!raw || raw.directorNodeId !== undefined || raw.plan !== undefined || raw.patches !== undefined) return value
    for (const key of ['answer', 'content', 'result', 'data']) {
      const nested = raw[key]
      if (typeof nested === 'string') {
        const parsed = parseJson(nested)
        if (parsed !== null) return unwrap(parsed, depth + 1)
      } else if (nested && typeof nested === 'object') {
        return unwrap(nested, depth + 1)
      }
    }
    return value
  }

  const parsed = parseJson(text)
  return parsed === null ? null : unwrap(parsed)
}
