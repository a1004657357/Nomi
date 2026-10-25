import { directorActionSource } from '../../../../../electron/shared/blenderDirectorProtocolText'
import type { Model3dValidationSummary } from '../../model/generationCanvasTypes'
import {
  BLENDER_DIRECTOR_STAGE_PRESETS,
  VIBING_DIRECTOR_VERSION,
} from './vibingDirectorTypes'
import type {
  BlenderDirectorAspectRatio,
  BlenderDirectorAsset,
  BlenderDirectorAssetFormat,
  BlenderDirectorAssetSource,
  BlenderDirectorBeat,
  BlenderDirectorCamera,
  BlenderDirectorCameraFraming,
  BlenderDirectorObjectTransform,
  BlenderDirectorOutput,
  BlenderDirectorRelation,
  BlenderDirectorRelationKind,
  BlenderDirectorSceneObject,
  BlenderDirectorSpatialCheck,
  BlenderDirectorStagePreset,
  BlenderDirectorVector3,
  VibingDirectorAction,
  VibingDirectorPlan,
  VibingDirectorPlanResult,
  VibingDirectorState,
} from './vibingDirectorTypes'

export * from './vibingDirectorTypes'

const ASPECT_RATIOS = new Set<BlenderDirectorAspectRatio>(['16:9', '9:16', '4:3', '3:4', '1:1', '2.39:1'])
const CAMERA_FRAMING = new Set<BlenderDirectorCameraFraming>(['all', 'target', 'fixed'])
const RELATION_KINDS = new Set<BlenderDirectorRelationKind>(['facing', 'distance', 'support', 'offset', 'line_of_sight'])
const ASSET_FORMATS = new Set<BlenderDirectorAssetFormat>(['blend', 'glb', 'gltf', 'fbx', 'obj'])
const ASSET_SOURCES = new Set<BlenderDirectorAssetSource>(['local', 'kenney', 'polyhaven', 'quaternius', 'blenderkit'])
const STAGE_PRESETS = new Set<BlenderDirectorStagePreset>(BLENDER_DIRECTOR_STAGE_PRESETS)

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function inferMarkerRole(id: string, name: string, explicitRole = ''): string {
  const declared = explicitRole.trim().toLowerCase()
  const source = `${id} ${name}`.toLowerCase()
  if (['table', 'chair', 'actor_seated', 'actor_standing', 'cup', 'laptop', 'plate', 'prop'].includes(declared)) return declared
  if (declared === 'mannequin') return /seated|sitting|坐/.test(source) ? 'actor_seated' : 'actor_standing'
  if (declared === 'character_marker' || declared === 'character') {
    return /standing|stand|站/.test(source) ? 'actor_standing' : 'actor_seated'
  }
  if (/cup|coffee[-_ ]?cup|咖啡杯|杯/.test(source)) return 'cup'
  if (/laptop|notebook|电脑/.test(source)) return 'laptop'
  if (/plate|cake|盘|蛋糕/.test(source)) return 'plate'
  if (/chair|seat|椅/.test(source)) return 'chair'
  if (/table|desk|桌/.test(source)) return 'table'
  if (/actor|character|char[-_ ]?[ab]|角色|人物|客人|咖啡师/.test(source)) return 'actor_seated'
  if (declared === 'prop_marker') return 'prop'
  if (declared) return explicitRole
  return ''
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function vector(value: unknown, fallback: BlenderDirectorVector3): BlenderDirectorVector3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return fallback
  return [value[0], value[1], value[2]]
}

function defaultCamera(): BlenderDirectorCamera {
  return {
    id: 'director-camera',
    name: '导演相机',
    position: [5, 2.4, 6],
    lookAt: [0, 1, 0],
    fov: 45,
    aspectRatio: '16:9',
    framing: 'all',
  }
}

function normalizeAspectRatio(value: unknown): BlenderDirectorAspectRatio {
  return typeof value === 'string' && ASPECT_RATIOS.has(value as BlenderDirectorAspectRatio)
    ? value as BlenderDirectorAspectRatio
    : '16:9'
}

function normalizeStagePreset(value: unknown): BlenderDirectorStagePreset {
  return typeof value === 'string' && STAGE_PRESETS.has(value as BlenderDirectorStagePreset)
    ? value as BlenderDirectorStagePreset
    : 'empty'
}

function normalizeAsset(value: unknown, index: number): BlenderDirectorAsset | null {
  const raw = record(value)
  const id = text(raw.id)
  const fileName = text(raw.fileName)
  const format = text(raw.format).toLowerCase()
  if (!id || !fileName || !ASSET_FORMATS.has(format as BlenderDirectorAssetFormat)) return null
  const source = text(raw.source, 'local') as BlenderDirectorAssetSource
  const validation = record(raw.model3dValidation)
  const provenance = record(raw.provenance)
  const normalizedProvenance = provenance.provider === 'kenney'
    && text(provenance.catalogAssetId)
    && text(provenance.packId)
    && text(provenance.sourcePageUrl)
    && text(provenance.downloadUrl)
    && text(provenance.licenseUrl)
    && /^[a-f0-9]{64}$/i.test(text(provenance.archiveSha256))
    && /^[a-f0-9]{64}$/i.test(text(provenance.fileSha256))
    ? {
        provider: 'kenney' as const,
        catalogAssetId: text(provenance.catalogAssetId),
        packId: text(provenance.packId),
        sourcePageUrl: text(provenance.sourcePageUrl),
        downloadUrl: text(provenance.downloadUrl),
        licenseUrl: text(provenance.licenseUrl),
        archiveSha256: text(provenance.archiveSha256),
        fileSha256: text(provenance.fileSha256),
      }
    : undefined
  return {
    id,
    name: text(raw.name, fileName),
    fileName,
    format: format as BlenderDirectorAssetFormat,
    source: ASSET_SOURCES.has(source) ? source : 'local',
    license: text(raw.license, '需确认'),
    importedAt: finite(raw.importedAt, index + 1),
    ...(validation.version === 1 && finite(validation.meshCount, 0) > 0
      ? { model3dValidation: validation as Model3dValidationSummary }
      : {}),
    ...(normalizedProvenance ? { provenance: normalizedProvenance } : {}),
  }
}

function normalizeObject(value: unknown, index: number): BlenderDirectorSceneObject | null {
  const raw = record(value)
  const id = text(raw.id)
  const kind = raw.kind === 'asset' ? 'asset' : raw.kind === 'marker' ? 'marker' : null
  if (!id || !kind) return null
  const name = text(raw.name, `对象 ${index + 1}`)
  const role = kind === 'marker' ? inferMarkerRole(id, name, text(raw.role)) : ''
  return {
    id,
    name,
    kind,
    ...(kind === 'asset' && text(raw.assetId) ? { assetId: text(raw.assetId) } : {}),
    ...(role ? { role } : {}),
    position: vector(raw.position, [0, 0, 0]),
    rotation: vector(raw.rotation, [0, 0, 0]),
    scale: vector(raw.scale, [1, 1, 1]),
  }
}

function normalizeCamera(value: unknown): BlenderDirectorCamera {
  const raw = record(value)
  const fallback = defaultCamera()
  const rawPath = record(raw.path)
  const points = Array.isArray(rawPath.points)
    ? rawPath.points.map((point) => vector(point, [0, 0, 0])).filter((point) => point.length === 3)
    : []
  return {
    id: text(raw.id, fallback.id),
    name: text(raw.name, fallback.name),
    position: vector(raw.position, fallback.position),
    lookAt: vector(raw.lookAt, fallback.lookAt),
    fov: Math.min(160, Math.max(1, finite(raw.fov, fallback.fov))),
    aspectRatio: normalizeAspectRatio(raw.aspectRatio),
    framing: typeof raw.framing === 'string' && CAMERA_FRAMING.has(raw.framing as BlenderDirectorCameraFraming)
      ? raw.framing as BlenderDirectorCameraFraming
      : fallback.framing,
    ...(text(raw.targetRef) ? { targetRef: text(raw.targetRef) } : {}),
    ...(points.length >= 2 ? {
      path: {
        points,
        durationSec: Math.max(0.1, Math.min(300, finite(rawPath.durationSec, 3))),
      },
    } : {}),
  }
}

function normalizeBeat(value: unknown, index: number): BlenderDirectorBeat | null {
  const raw = record(value)
  const id = text(raw.id)
  const title = text(raw.title)
  if (!id || !title) return null
  return {
    id,
    title,
    action: text(raw.action),
    cameraNote: text(raw.cameraNote),
    ...(text(raw.dialogue) ? { dialogue: text(raw.dialogue) } : {}),
    ...(text(raw.notes) ? { notes: text(raw.notes) } : {}),
    durationSec: Math.max(0.1, Math.min(120, finite(raw.durationSec, index === 0 ? 5 : 3))),
  }
}

function normalizeRelation(value: unknown): BlenderDirectorRelation | null {
  const raw = record(value)
  const id = text(raw.id)
  const kind = text(raw.kind) as BlenderDirectorRelationKind
  const subjectRef = text(raw.subjectRef)
  const targetRef = text(raw.targetRef)
  if (!id || !RELATION_KINDS.has(kind) || !subjectRef || !targetRef || subjectRef === targetRef) return null
  const distance = finite(raw.distance, Number.NaN)
  if (kind === 'distance' && (!Number.isFinite(distance) || distance <= 0)) return null
  return {
    id,
    kind,
    subjectRef,
    targetRef,
    ...(kind === 'distance' ? { distance } : {}),
    ...(raw.mutual === true ? { mutual: true } : {}),
    ...(kind === 'support' && Array.isArray(raw.offset) && raw.offset.length === 2 && raw.offset.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? { offset: [raw.offset[0], raw.offset[1]] as [number, number] }
      : {}),
    ...(kind === 'offset' && Array.isArray(raw.relativeOffset) && raw.relativeOffset.length === 3 && raw.relativeOffset.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? { relativeOffset: [raw.relativeOffset[0], raw.relativeOffset[1], raw.relativeOffset[2]] as BlenderDirectorVector3 }
      : {}),
    ...(kind === 'offset' && Array.isArray(raw.relativeRotation) && raw.relativeRotation.length === 3 && raw.relativeRotation.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? { relativeRotation: [raw.relativeRotation[0], raw.relativeRotation[1], raw.relativeRotation[2]] as BlenderDirectorVector3 }
      : {}),
  }
}

function normalizeOutput(value: unknown): BlenderDirectorOutput | undefined {
  const raw = record(value)
  const jobId = text(raw.jobId)
  const previewUrl = text(raw.previewUrl)
  const blendUrl = text(raw.blendUrl)
  const modelUrl = text(raw.modelUrl)
  const blendRelativePath = text(raw.blendRelativePath)
  if (!jobId || !previewUrl || !blendUrl || !modelUrl || !blendRelativePath) return undefined
  const previewCamera = Object.keys(record(raw.previewCamera)).length
    ? normalizeCamera(raw.previewCamera)
    : undefined
  const spatialRaw = record(raw.spatialReport)
  const spatialChecks = Array.isArray(spatialRaw.checks)
    ? spatialRaw.checks.map((value): BlenderDirectorSpatialCheck | null => {
        const check = record(value)
        const kind = text(check.kind) as BlenderDirectorRelationKind
        const status = text(check.status) as BlenderDirectorSpatialCheck['status']
        const relationId = text(check.relationId)
        const message = text(check.message)
        if (!relationId || !RELATION_KINDS.has(kind) || !['passed', 'warning', 'failed'].includes(status) || !message) return null
        const measured = finite(check.measured, Number.NaN)
        const expected = finite(check.expected, Number.NaN)
        const rotationMeasured = finite(check.rotationMeasured, Number.NaN)
        const rotationExpected = finite(check.rotationExpected, Number.NaN)
        return {
          relationId,
          kind,
          status,
          message,
          ...(Number.isFinite(measured) ? { measured } : {}),
          ...(Number.isFinite(expected) ? { expected } : {}),
          ...(Number.isFinite(rotationMeasured) ? { rotationMeasured } : {}),
          ...(Number.isFinite(rotationExpected) ? { rotationExpected } : {}),
        }
      }).filter((check): check is BlenderDirectorSpatialCheck => check !== null)
    : []
  const spatialReport = spatialRaw.version === 1 && typeof spatialRaw.passed === 'boolean'
    ? { version: 1 as const, passed: spatialRaw.passed, checks: spatialChecks }
    : undefined
  const objectTransforms = Array.isArray(raw.objectTransforms)
    ? raw.objectTransforms.map((value): BlenderDirectorObjectTransform | null => {
        const transform = record(value)
        const id = text(transform.id)
        if (!id) return null
        return {
          id,
          name: text(transform.name, id),
          position: vector(transform.position, [0, 0, 0]),
          rotation: vector(transform.rotation, [0, 0, 0]),
          scale: vector(transform.scale, [1, 1, 1]),
        }
      }).filter((transform): transform is BlenderDirectorObjectTransform => transform !== null)
    : []
  return {
    jobId,
    previewUrl,
    ...(text(raw.previewAssetId) ? { previewAssetId: text(raw.previewAssetId) } : {}),
    blendUrl,
    ...(text(raw.blendAssetId) ? { blendAssetId: text(raw.blendAssetId) } : {}),
    modelUrl,
    ...(text(raw.modelAssetId) ? { modelAssetId: text(raw.modelAssetId) } : {}),
    blendRelativePath,
    ...(text(raw.blenderVersion) ? { blenderVersion: text(raw.blenderVersion) } : {}),
    ...(previewCamera ? { previewCamera } : {}),
    ...(spatialReport ? { spatialReport } : {}),
    ...(objectTransforms.length ? { objectTransforms } : {}),
    createdAt: finite(raw.createdAt, Date.now()),
  }
}

export function createVibingDirectorState(now = Date.now()): VibingDirectorState {
  return {
    version: VIBING_DIRECTOR_VERSION,
    backend: 'blender',
    brief: '',
    stagePreset: 'empty',
    assets: [],
    objects: [],
    relations: [],
    camera: defaultCamera(),
    beats: [],
    updatedAt: now,
  }
}

/** Migrates v1 Three.js-only state by retaining the brief, not its grey-box data. */
export function normalizeVibingDirectorState(value: unknown): VibingDirectorState {
  const raw = record(value)
  if (raw.version !== VIBING_DIRECTOR_VERSION || raw.backend !== 'blender') {
    return {
      ...createVibingDirectorState(finite(raw.updatedAt, Date.now())),
      brief: text(raw.brief),
      beats: Array.isArray(raw.beats)
        ? raw.beats.map(normalizeBeat).filter((beat): beat is BlenderDirectorBeat => beat !== null)
        : [],
    }
  }
  const output = normalizeOutput(raw.output)
  return {
    version: VIBING_DIRECTOR_VERSION,
    backend: 'blender',
    brief: text(raw.brief),
    stagePreset: normalizeStagePreset(raw.stagePreset),
    assets: Array.isArray(raw.assets)
      ? raw.assets.map(normalizeAsset).filter((asset): asset is BlenderDirectorAsset => asset !== null)
      : [],
    objects: Array.isArray(raw.objects)
      ? raw.objects.map(normalizeObject).filter((object): object is BlenderDirectorSceneObject => object !== null)
      : [],
    relations: Array.isArray(raw.relations)
      ? raw.relations.map(normalizeRelation).filter((relation): relation is BlenderDirectorRelation => relation !== null)
      : [],
    camera: normalizeCamera(raw.camera),
    beats: Array.isArray(raw.beats)
      ? raw.beats.map(normalizeBeat).filter((beat): beat is BlenderDirectorBeat => beat !== null)
      : [],
    ...(output ? { output } : {}),
    updatedAt: finite(raw.updatedAt, Date.now()),
  }
}

export function createCoffeeConversationLayoutPlan(state: VibingDirectorState): VibingDirectorPlan {
  const normalized = normalizeVibingDirectorState(state)
  const actors = normalized.objects.filter((object) => object.role?.startsWith('actor'))
  return {
    mode: 'replace',
    brief: normalized.brief,
    actions: [{
      op: 'set_blocking_layout',
      template: 'coffee_two_person_conversation',
      actorAName: actors[0]?.name || '角色A',
      actorBName: actors[1]?.name || '角色B',
    }],
  }
}

function coffeeConversationLayout(action: Extract<VibingDirectorAction, { op: 'set_blocking_layout' }>): VibingDirectorAction[] {
  const actorAName = text(action.actorAName, '角色A')
  const actorBName = text(action.actorBName, '角色B')
  return [
    { op: 'set_stage', preset: 'coffee_shop' },
    { op: 'add_marker', id: 'table-main', name: '咖啡桌', role: 'table', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { op: 'add_marker', id: 'chair-A', name: '椅子A', role: 'chair', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1] },
    { op: 'add_marker', id: 'chair-B', name: '椅子B', role: 'chair', position: [0, 0, -1.25], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { op: 'add_marker', id: 'actor-A', name: actorAName, role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1], color: '#60a5fa' },
    { op: 'add_marker', id: 'actor-B', name: actorBName, role: 'actor_seated', position: [0, 0, -1.25], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#f59e0b' },
    { op: 'add_marker', id: 'cup-A', name: '咖啡杯A', role: 'cup', position: [-0.38, 0.76, 0.22], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#f4e5cf' },
    { op: 'add_marker', id: 'cup-B', name: '咖啡杯B', role: 'cup', position: [0.38, 0.76, -0.22], rotation: [0, 180, 0], scale: [1, 1, 1], color: '#f4e5cf' },
    { op: 'add_marker', id: 'laptop', name: '笔记本电脑', role: 'laptop', position: [0.54, 0.76, 0.08], rotation: [0, -18, 0], scale: [1, 1, 1], color: '#334155' },
    { op: 'add_marker', id: 'plate-cake', name: '小蛋糕盘', role: 'plate', position: [-0.5, 0.76, -0.1], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#f8fafc' },
    { op: 'set_relation', id: 'cup-A-on-table', kind: 'support', subjectRef: 'cup-A', targetRef: 'table-main' },
    { op: 'set_relation', id: 'cup-B-on-table', kind: 'support', subjectRef: 'cup-B', targetRef: 'table-main' },
    { op: 'set_relation', id: 'laptop-on-table', kind: 'support', subjectRef: 'laptop', targetRef: 'table-main' },
    { op: 'set_relation', id: 'plate-on-table', kind: 'support', subjectRef: 'plate-cake', targetRef: 'table-main' },
    { op: 'set_relation', id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2.5 },
    { op: 'set_relation', id: 'chair-A-follows-actor-A', kind: 'offset', subjectRef: 'chair-A', targetRef: 'actor-A' },
    { op: 'set_relation', id: 'chair-B-follows-actor-B', kind: 'offset', subjectRef: 'chair-B', targetRef: 'actor-B' },
    { op: 'set_relation', id: 'actors-facing', kind: 'facing', subjectRef: 'actor-A', targetRef: 'actor-B', mutual: true },
    { op: 'set_camera', name: '咖啡桌双人主机位', position: [8, 5, 8], lookAt: [0, 0.9, 0], fov: 45, aspectRatio: '16:9' },
  ]
}

/**
 * Expands relationship-first blocking templates before state mutation and Blender execution.
 * This keeps the template auditable while Blender receives only concrete object transforms.
 */
export function materializeVibingDirectorPlan(plan: VibingDirectorPlan): VibingDirectorPlan {
  const hasLayout = plan.actions.some((action) => action.op === 'set_blocking_layout')
  if (!hasLayout) return plan
  const actions: VibingDirectorAction[] = []
  for (const action of plan.actions) {
    if (action.op === 'set_blocking_layout') {
      if (action.template === 'coffee_two_person_conversation') actions.push(...coffeeConversationLayout(action))
      continue
    }
    // The layout owns its stage so a model cannot accidentally create two presets.
    if (action.op === 'set_stage') continue
    actions.push(action)
  }
  return { ...plan, mode: 'replace', actions }
}

function resolveObject(objects: BlenderDirectorSceneObject[], objectRef: string): BlenderDirectorSceneObject | null {
  const direct = objects.find((object) => object.id === objectRef)
  if (direct) return direct
  const byName = objects.filter((object) => object.name === objectRef)
  return byName.length === 1 ? byName[0] : null
}

function label(action: VibingDirectorAction): string {
  switch (action.op) {
    case 'set_stage': return directorActionSource.setStage(action.preset)
    case 'set_blocking_layout': return directorActionSource.blockingLayout(action.template)
    case 'place_asset': return directorActionSource.placeAsset(action.name)
    case 'add_marker': return directorActionSource.addMarker(action.name)
    case 'move_object': return directorActionSource.moveObject(action.objectRef)
    case 'remove_object': return directorActionSource.removeObject(action.objectRef)
    case 'set_relation': return directorActionSource.setRelation(action.id)
    case 'remove_relation': return directorActionSource.removeRelation(action.relationRef)
    case 'set_camera': return directorActionSource.setCamera(action.name || action.cameraRef || '导演相机')
    case 'set_camera_path': return directorActionSource.setCameraPath(action.cameraRef || '导演相机')
    case 'set_beat': return directorActionSource.setBeat(action.title)
  }
}

const MARKER_VERTICAL_BOUNDS: Record<string, [number, number]> = {
  table: [0, 0.76],
  chair: [0, 1.36],
  actor_seated: [0, 1.73],
  actor_standing: [0, 1.99],
  cup: [-0.09, 0.21],
  laptop: [0, 0.45],
  plate: [0, 0.17],
  prop: [0, 0.44],
}

function objectVerticalBounds(state: VibingDirectorState, object: BlenderDirectorSceneObject): [number, number] {
  if (object.kind === 'asset') {
    const asset = state.assets.find((candidate) => candidate.id === object.assetId)
    const bounds = asset?.model3dValidation?.bounds
    if (bounds) return [bounds.min[1], bounds.max[1]]
  }
  return MARKER_VERTICAL_BOUNDS[object.role || 'prop'] ?? MARKER_VERTICAL_BOUNDS.prop
}

function yawTowards(subject: BlenderDirectorSceneObject, target: BlenderDirectorSceneObject): number {
  const dx = target.position[0] - subject.position[0]
  const dz = target.position[2] - subject.position[2]
  const degrees = Math.atan2(dx, dz) * (180 / Math.PI)
  return Math.abs(degrees) < 1e-8 ? 0 : degrees
}

function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Math.abs(normalized) < 1e-8 ? 0 : normalized
}

function relativeRotation(subject?: BlenderDirectorSceneObject | null, target?: BlenderDirectorSceneObject | null): BlenderDirectorVector3 {
  return [0, 1, 2].map((index) => normalizeDegrees((subject?.rotation[index] ?? 0) - (target?.rotation[index] ?? 0))) as BlenderDirectorVector3
}

function enforceSpatialRelations(state: VibingDirectorState): void {
  const ordered = [...state.relations].sort((left, right) => {
    const rank = { support: 0, distance: 1, facing: 2, line_of_sight: 2, offset: 3 } as const
    return rank[left.kind] - rank[right.kind]
  })
  for (const relation of ordered) {
    const subject = resolveObject(state.objects, relation.subjectRef)
    const target = resolveObject(state.objects, relation.targetRef)
    if (!subject || !target) continue
    if (relation.kind === 'support') {
      const subjectBounds = objectVerticalBounds(state, subject)
      const targetBounds = objectVerticalBounds(state, target)
      const subjectBottom = subjectBounds[0] * Math.abs(subject.scale[1])
      const targetTop = targetBounds[1] * Math.abs(target.scale[1])
      subject.position = [
        target.position[0] + (relation.offset?.[0] ?? (subject.position[0] - target.position[0])),
        target.position[1] + targetTop - subjectBottom,
        target.position[2] + (relation.offset?.[1] ?? (subject.position[2] - target.position[2])),
      ]
      continue
    }
    if (relation.kind === 'distance') {
      const distance = relation.distance ?? 1
      let dx = subject.position[0] - target.position[0]
      let dz = subject.position[2] - target.position[2]
      const current = Math.hypot(dx, dz)
      if (current <= 1e-8) {
        dx = 0
        dz = 1
      } else {
        dx /= current
        dz /= current
      }
      subject.position = [
        target.position[0] + dx * distance,
        subject.position[1],
        target.position[2] + dz * distance,
      ]
      continue
    }
    if (relation.kind === 'offset') {
      const offset = relation.relativeOffset ?? [
        subject.position[0] - target.position[0],
        subject.position[1] - target.position[1],
        subject.position[2] - target.position[2],
      ]
      subject.position = [
        target.position[0] + offset[0],
        target.position[1] + offset[1],
        target.position[2] + offset[2],
      ]
      const rotation = relation.relativeRotation ?? [0, 0, 0]
      relation.relativeRotation = rotation
      subject.rotation = [
        normalizeDegrees(target.rotation[0] + rotation[0]),
        normalizeDegrees(target.rotation[1] + rotation[1]),
        normalizeDegrees(target.rotation[2] + rotation[2]),
      ]
      continue
    }
    subject.rotation = [subject.rotation[0], yawTowards(subject, target), subject.rotation[2]]
    if (relation.mutual) {
      target.rotation = [target.rotation[0], yawTowards(target, subject), target.rotation[2]]
    }
  }
}

export function applyVibingDirectorPlan(
  current: VibingDirectorState,
  plan: VibingDirectorPlan,
  output?: BlenderDirectorOutput,
): VibingDirectorPlanResult {
  const executablePlan = materializeVibingDirectorPlan(plan)
  const base = normalizeVibingDirectorState(current)
  const draft: VibingDirectorState = {
    ...base,
    ...(executablePlan.mode === 'replace' ? { stagePreset: 'empty', objects: [], relations: [], beats: [] } : {}),
    assets: [...base.assets],
    objects: [...(executablePlan.mode === 'replace' ? [] : base.objects)],
    relations: [...(executablePlan.mode === 'replace' ? [] : base.relations)],
    beats: [...(executablePlan.mode === 'replace' ? [] : base.beats)],
    camera: executablePlan.mode === 'replace'
      ? defaultCamera()
      : { ...base.camera, ...(base.camera.path ? { path: { ...base.camera.path, points: [...base.camera.path.points] } } : {}) },
  }
  const applied: string[] = []
  const rejected: string[] = []
  if (executablePlan.brief !== undefined) draft.brief = text(executablePlan.brief, draft.brief)

  for (const action of executablePlan.actions) {
    if (action.op === 'set_stage') {
      draft.stagePreset = action.preset
      applied.push(label(action))
      continue
    }
    if (action.op === 'set_blocking_layout') {
      rejected.push(`未能展开摆位模板「${action.template}」`)
      continue
    }
    if (action.op === 'place_asset') {
      if (!draft.assets.some((asset) => asset.id === action.assetId)) {
        rejected.push(`资产库中没有「${action.assetId}」`)
        continue
      }
      if (draft.objects.some((object) => object.id === action.id)) {
        rejected.push(`对象标识「${action.id}」已存在`)
        continue
      }
      draft.objects.push({
        id: action.id,
        name: action.name,
        kind: 'asset',
        assetId: action.assetId,
        position: action.position ?? [0, 0, 0],
        rotation: action.rotation ?? [0, 0, 0],
        scale: action.scale ?? [1, 1, 1],
      })
      applied.push(label(action))
      continue
    }
    if (action.op === 'add_marker') {
      if (draft.objects.some((object) => object.id === action.id)) {
        rejected.push(`对象标识「${action.id}」已存在`)
        continue
      }
      draft.objects.push({
        id: action.id,
        name: action.name,
        kind: 'marker',
        ...(inferMarkerRole(action.id, action.name, text(action.role)) ? { role: inferMarkerRole(action.id, action.name, text(action.role)) } : {}),
        position: action.position ?? [0, 0, 0],
        rotation: action.rotation ?? [0, 0, 0],
        scale: action.scale ?? [1, 1, 1],
      })
      applied.push(label(action))
      continue
    }
    if (action.op === 'move_object') {
      const object = resolveObject(draft.objects, action.objectRef)
      if (!object) {
        rejected.push(`找不到 Blender 对象「${action.objectRef}」`)
        continue
      }
      Object.assign(object, {
        ...(action.position ? { position: action.position } : {}),
        ...(action.rotation ? { rotation: action.rotation } : {}),
        ...(action.scale ? { scale: action.scale } : {}),
        ...(action.name ? { name: action.name } : {}),
      })
      applied.push(label(action))
      continue
    }
    if (action.op === 'remove_object') {
      const object = resolveObject(draft.objects, action.objectRef)
      if (!object) {
        rejected.push(`找不到 Blender 对象「${action.objectRef}」`)
        continue
      }
      draft.objects = draft.objects.filter((candidate) => candidate !== object)
      draft.relations = draft.relations.filter((relation) => relation.subjectRef !== object.id && relation.targetRef !== object.id)
      applied.push(label(action))
      continue
    }
    if (action.op === 'set_relation') {
      const missingRefs = [action.subjectRef, action.targetRef].filter((reference) => !resolveObject(draft.objects, reference))
      if (missingRefs.length) {
        for (const reference of missingRefs) rejected.push(`空间关系「${action.id}」找不到对象「${reference}」`)
        continue
      }
      if (action.subjectRef === action.targetRef) {
        rejected.push(`空间关系「${action.id}」不能引用同一个对象`)
        continue
      }
      if (action.kind === 'distance' && (!(typeof action.distance === 'number') || !Number.isFinite(action.distance) || action.distance <= 0)) {
        rejected.push(`空间关系「${action.id}」缺少有效距离`)
        continue
      }
      const nextRelation: BlenderDirectorRelation = {
        id: action.id,
        kind: action.kind,
        subjectRef: action.subjectRef,
        targetRef: action.targetRef,
        ...(action.kind === 'distance' ? { distance: action.distance } : {}),
        ...(action.mutual ? { mutual: true } : {}),
        ...(action.kind === 'support'
          ? {
              offset: [
                (resolveObject(draft.objects, action.subjectRef)?.position[0] ?? 0) - (resolveObject(draft.objects, action.targetRef)?.position[0] ?? 0),
                (resolveObject(draft.objects, action.subjectRef)?.position[2] ?? 0) - (resolveObject(draft.objects, action.targetRef)?.position[2] ?? 0),
              ] as [number, number],
            }
          : {}),
        ...(action.kind === 'offset'
          ? {
              relativeOffset: [
                (resolveObject(draft.objects, action.subjectRef)?.position[0] ?? 0) - (resolveObject(draft.objects, action.targetRef)?.position[0] ?? 0),
                (resolveObject(draft.objects, action.subjectRef)?.position[1] ?? 0) - (resolveObject(draft.objects, action.targetRef)?.position[1] ?? 0),
                (resolveObject(draft.objects, action.subjectRef)?.position[2] ?? 0) - (resolveObject(draft.objects, action.targetRef)?.position[2] ?? 0),
              ] as BlenderDirectorVector3,
              relativeRotation: relativeRotation(
                resolveObject(draft.objects, action.subjectRef),
                resolveObject(draft.objects, action.targetRef),
              ),
            }
          : {}),
      }
      const existing = draft.relations.find((relation) => relation.id === action.id)
      if (existing) Object.assign(existing, nextRelation)
      else draft.relations.push(nextRelation)
      applied.push(label(action))
      continue
    }
    if (action.op === 'remove_relation') {
      const existing = draft.relations.find((relation) => relation.id === action.relationRef)
      if (!existing) {
        rejected.push(`当前没有空间关系「${action.relationRef}」`)
        continue
      }
      draft.relations = draft.relations.filter((relation) => relation !== existing)
      applied.push(label(action))
      continue
    }
    if (action.op === 'set_camera') {
      if (action.cameraRef && action.cameraRef !== draft.camera.id && action.cameraRef !== draft.camera.name) {
        rejected.push(`当前没有机位「${action.cameraRef}」`)
        continue
      }
      const framing = action.framing ?? (action.targetRef ? 'target' : draft.camera.framing)
      if (framing === 'target') {
        const targetRef = action.targetRef ?? draft.camera.targetRef
        if (!targetRef || !resolveObject(draft.objects, targetRef)) {
          rejected.push(`当前没有相机目标「${targetRef || '未指定'}」`)
          continue
        }
      }
      const nextCamera: BlenderDirectorCamera = {
        ...draft.camera,
        ...(action.name ? { name: action.name } : {}),
        ...(action.position ? { position: action.position } : {}),
        ...(action.lookAt ? { lookAt: action.lookAt } : {}),
        ...(action.fov ? { fov: action.fov } : {}),
        ...(action.aspectRatio ? { aspectRatio: action.aspectRatio } : {}),
        framing,
        ...(framing === 'target' ? { targetRef: action.targetRef ?? draft.camera.targetRef } : {}),
      }
      if (framing !== 'target') delete nextCamera.targetRef
      draft.camera = nextCamera
      applied.push(label(action))
      continue
    }
    if (action.op === 'set_camera_path') {
      if (action.cameraRef && action.cameraRef !== draft.camera.id && action.cameraRef !== draft.camera.name) {
        rejected.push(`当前没有机位「${action.cameraRef}」`)
        continue
      }
      draft.camera = { ...draft.camera, path: { points: [...action.points], durationSec: action.durationSec } }
      applied.push(label(action))
      continue
    }
    if (action.op !== 'set_beat') continue
    const existing = draft.beats.find((beat) => beat.id === action.id)
    const nextBeat: BlenderDirectorBeat = {
      id: action.id,
      title: action.title,
      action: action.action ?? existing?.action ?? '',
      cameraNote: action.cameraNote ?? existing?.cameraNote ?? '',
      ...(action.dialogue ?? existing?.dialogue ? { dialogue: action.dialogue ?? existing?.dialogue } : {}),
      ...(action.notes ?? existing?.notes ? { notes: action.notes ?? existing?.notes } : {}),
      durationSec: action.durationSec ?? existing?.durationSec ?? 3,
    }
    if (existing) Object.assign(existing, nextBeat)
    else draft.beats.push(nextBeat)
    applied.push(label(action))
  }

  enforceSpatialRelations(draft)
  if (output?.objectTransforms?.length) {
    for (const transform of output.objectTransforms) {
      const object = draft.objects.find((candidate) => candidate.id === transform.id)
      if (!object) continue
      object.name = transform.name || object.name
      object.position = [...transform.position]
      object.rotation = [...transform.rotation]
      object.scale = [...transform.scale]
    }
  }
  const next: VibingDirectorState = {
    ...draft,
    ...(output?.previewCamera ? { camera: normalizeCamera(output.previewCamera) } : {}),
    ...(output ? { output } : {}),
    updatedAt: Date.now(),
  }
  return { state: next, applied, rejected }
}

/** Compact, path-free state context for the Agent. */
export function formatVibingDirectorContext(directorNodeId: string, state: VibingDirectorState): string {
  const normalized = normalizeVibingDirectorState(state)
  const assets = normalized.assets.length
    ? normalized.assets.map((asset) => `- ${asset.id} | ${asset.name} | ${asset.format} | ${asset.source} | ${asset.license}`).join('\n')
    : '- 暂无已导入资产。可以先做 Blender 走位标记，或让用户通过资产库导入已授权模型。'
  const objects = normalized.objects.length
    ? normalized.objects.map((object) => `- ${object.id} | ${object.name} | ${object.kind}${object.role ? ` | role=${object.role}` : ''}${object.assetId ? ` | asset=${object.assetId}` : ''}`).join('\n')
    : '- 尚未创建 Blender 导演对象。'
  const beats = normalized.beats.length
    ? normalized.beats.map((beat) => `- ${beat.id} | ${beat.title} | ${beat.durationSec}s`).join('\n')
    : '- 暂无镜头节拍。'
  const relations = normalized.relations.length
    ? normalized.relations.map((relation) => `- ${relation.id} | ${relation.kind} | ${relation.subjectRef} -> ${relation.targetRef}${relation.distance ? ` | ${relation.distance}m` : ''}${relation.mutual ? ' | mutual' : ''}`).join('\n')
    : '- 暂无持久空间关系。'
  return [
    `当前 VIBING Director 节点 id: ${directorNodeId}`,
    `后端: Blender（节点只回传 .blend、渲染预览和 GLB，不管理 Three.js 场景）`,
    `创作简述: ${normalized.brief || '未设置'}`,
    `场景预设: ${normalized.stagePreset}`,
    `机位: ${normalized.camera.id} | ${normalized.camera.name} | position=${JSON.stringify(normalized.camera.position)} | lookAt=${JSON.stringify(normalized.camera.lookAt)} | fov=${normalized.camera.fov}`,
    `取景: ${normalized.camera.framing}${normalized.camera.targetRef ? ` | target=${normalized.camera.targetRef}` : ''}`,
    `资产库:\n${assets}`,
    `当前对象:\n${objects}`,
    `空间关系:\n${relations}`,
    `镜头节拍:\n${beats}`,
  ].join('\n')
}
