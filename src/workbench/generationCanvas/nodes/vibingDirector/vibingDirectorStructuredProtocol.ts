import { z } from 'zod'
import type { VibingDirectorPlan } from './vibingDirectorState'

export type VibingDirectorPlanRequest = {
  directorNodeId: string
  summary: string
  plan: VibingDirectorPlan
}

const finiteNumber = z.number().finite()
const vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber])
const stagePresetSchema = z.enum(['empty', 'studio', 'coffee_shop', 'city_street', 'interior_room'])
const blockingTemplateSchema = z.enum(['coffee_two_person_conversation'])
const aspectRatioSchema = z.enum(['16:9', '9:16', '4:3', '3:4', '1:1', '2.39:1'])
const identifierSchema = z.string().min(1).max(160).regex(/^(?!https?:\/\/)(?!file:)[a-zA-Z0-9_\-.:\u4e00-\u9fff ]+$/i)

const actionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_stage'), preset: stagePresetSchema }),
  z.object({
    op: z.literal('set_blocking_layout'),
    template: blockingTemplateSchema,
    actorAName: z.string().min(1).max(160).optional(),
    actorBName: z.string().min(1).max(160).optional(),
  }),
  z.object({
    op: z.literal('place_asset'),
    id: identifierSchema,
    assetId: identifierSchema,
    name: z.string().min(1).max(160),
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
  }),
  z.object({
    op: z.literal('add_marker'),
    id: identifierSchema,
    name: z.string().min(1).max(160),
    role: z.string().max(120).optional(),
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }),
  z.object({
    op: z.literal('move_object'),
    objectRef: identifierSchema,
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
    name: z.string().min(1).max(160).optional(),
  }),
  z.object({ op: z.literal('remove_object'), objectRef: identifierSchema }),
  z.object({
    op: z.literal('set_camera'),
    cameraRef: identifierSchema.optional(),
    name: z.string().min(1).max(160).optional(),
    position: vector3Schema.optional(),
    lookAt: vector3Schema.optional(),
    fov: finiteNumber.min(1).max(160).optional(),
    aspectRatio: aspectRatioSchema.optional(),
  }),
  z.object({
    op: z.literal('set_camera_path'),
    cameraRef: identifierSchema.optional(),
    points: z.array(vector3Schema).min(2).max(32),
    durationSec: finiteNumber.min(0.1).max(300),
  }),
  z.object({
    op: z.literal('set_beat'),
    id: identifierSchema,
    title: z.string().min(1).max(160),
    action: z.string().max(2000).optional(),
    cameraNote: z.string().max(1000).optional(),
    dialogue: z.string().max(1000).optional(),
    notes: z.string().max(1000).optional(),
    durationSec: finiteNumber.min(0.1).max(120).optional(),
  }),
])

const planSchema = z.object({
  mode: z.enum(['replace', 'amend']),
  brief: z.string().max(4000).optional(),
  actions: z.array(actionSchema).min(1).max(24),
}).superRefine((plan, context) => {
  plan.actions.forEach((action, index) => {
    if (action.op === 'move_object' && action.position === undefined && action.rotation === undefined && action.scale === undefined && action.name === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'move_object 至少需要一个要修改的字段', path: ['actions', index] })
    }
    if (action.op === 'set_camera' && action.cameraRef === undefined && action.name === undefined && action.position === undefined && action.lookAt === undefined && action.fov === undefined && action.aspectRatio === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'set_camera 至少需要一个要修改的字段', path: ['actions', index] })
    }
  })
})

const requestSchema = z.object({
  directorNodeId: z.string().min(1).max(200),
  summary: z.string().min(1).max(600),
  plan: planSchema,
})

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function idFrom(value: unknown, fallback: string): string {
  const source = typeof value === 'string' ? value.trim() : ''
  const normalized = source.replace(/[^a-zA-Z0-9_\-.:\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function vectorFrom(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return undefined
  return [value[0], value[1], value[2]]
}

function rotationFromLegacy(raw: Record<string, unknown>): [number, number, number] | undefined {
  const explicit = vectorFrom(raw.rotation)
  if (explicit) return explicit
  return typeof raw.rotationY === 'number' && Number.isFinite(raw.rotationY) ? [0, raw.rotationY, 0] : undefined
}

function stageFromLegacy(type: unknown): z.infer<typeof stagePresetSchema> | undefined {
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
  const scale = vectorFrom(raw.scale)
  const lookAt = vectorFrom(raw.lookAt)
  const fov = typeof raw.fov === 'number' ? raw.fov : typeof raw.focalLength === 'number' ? raw.focalLength : undefined

  // Older Director builds put these actions under plan.actions instead of patches.
  // Convert them into the same constrained action set before Zod validates the plan.
  if (type === 'setstagepreset') {
    const preset = stageFromLegacy(raw.preset ?? raw.stagePreset)
    return preset ? [{ op: 'set_stage', preset }] : []
  }
  if (type === 'addobject') {
    const role = typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind.trim() : undefined
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
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `节拍 ${index + 1}`,
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
    return [{ op: 'add_marker', id, name, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}), ...(typeof raw.pose === 'string' ? { role: raw.pose } : {}) }]
  }
  if (op === 'add_object') {
    return [{ op: 'add_marker', id, name, ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}), ...(type ? { role: type } : {}) }]
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
      title: typeof raw.title === 'string' ? raw.title : `节拍 ${index + 1}`,
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
    return [{
      op: 'add_marker',
      id,
      name,
      ...(position ? { position } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
      ...(type ? { role: typeof raw.subtype === 'string' ? `${type}:${raw.subtype}` : type } : {}),
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
  const parsed = requestSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data as VibingDirectorPlanRequest
}

export function parseVibingDirectorPlanRequest(value: unknown): VibingDirectorPlanRequest | null {
  return parseCanonicalRequest(value) ?? migrateLegacyRequest(value)
}

export function parseVibingDirectorStructuredPlanResponse(text: string): unknown | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  const candidates = [fenced, trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try { return JSON.parse(candidate) as unknown } catch { /* try the next JSON extraction */ }
  }
  return null
}
