export const VIBING_DIRECTOR_VERSION = 2 as const

export const BLENDER_DIRECTOR_STAGE_PRESETS = [
  'empty',
  'studio',
  'coffee_shop',
  'city_street',
  'interior_room',
] as const

export type BlenderDirectorStagePreset = (typeof BLENDER_DIRECTOR_STAGE_PRESETS)[number]
export type BlenderDirectorVector3 = [number, number, number]
export type BlenderDirectorAssetSource = 'local' | 'polyhaven' | 'quaternius' | 'blenderkit'
export type BlenderDirectorAssetFormat = 'blend' | 'glb' | 'gltf' | 'fbx' | 'obj'
export type BlenderDirectorAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1'

export const BLENDER_DIRECTOR_BLOCKING_TEMPLATES = [
  'coffee_two_person_conversation',
] as const

export type BlenderDirectorBlockingTemplate = (typeof BLENDER_DIRECTOR_BLOCKING_TEMPLATES)[number]

export type BlenderDirectorAsset = {
  id: string
  name: string
  fileName: string
  format: BlenderDirectorAssetFormat
  source: BlenderDirectorAssetSource
  license: string
  importedAt: number
}

export type BlenderDirectorSceneObject = {
  id: string
  name: string
  kind: 'asset' | 'marker'
  assetId?: string
  role?: string
  position: BlenderDirectorVector3
  rotation: BlenderDirectorVector3
  scale: BlenderDirectorVector3
}

export type BlenderDirectorCamera = {
  id: string
  name: string
  position: BlenderDirectorVector3
  lookAt: BlenderDirectorVector3
  fov: number
  aspectRatio: BlenderDirectorAspectRatio
  path?: {
    points: BlenderDirectorVector3[]
    durationSec: number
  }
}

export type BlenderDirectorBeat = {
  id: string
  title: string
  action: string
  cameraNote: string
  dialogue?: string
  notes?: string
  durationSec: number
}

export type BlenderDirectorOutput = {
  jobId: string
  previewUrl: string
  previewAssetId?: string
  blendUrl: string
  blendAssetId?: string
  modelUrl: string
  modelAssetId?: string
  blendRelativePath: string
  blenderVersion?: string
  createdAt: number
}

/**
 * A VIBING Director node is a Blender return node. It stores a small, auditable
 * plan plus Blender artifacts; it does not mirror a realtime Three.js scene.
 */
export type VibingDirectorState = {
  version: typeof VIBING_DIRECTOR_VERSION
  backend: 'blender'
  brief: string
  stagePreset: BlenderDirectorStagePreset
  assets: BlenderDirectorAsset[]
  objects: BlenderDirectorSceneObject[]
  camera: BlenderDirectorCamera
  beats: BlenderDirectorBeat[]
  output?: BlenderDirectorOutput
  updatedAt: number
}

export type VibingDirectorAction =
  | { op: 'set_stage'; preset: BlenderDirectorStagePreset }
  | {
      op: 'set_blocking_layout'
      template: BlenderDirectorBlockingTemplate
      actorAName?: string
      actorBName?: string
    }
  | {
      op: 'place_asset'
      id: string
      assetId: string
      name: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
    }
  | {
      op: 'add_marker'
      id: string
      name: string
      role?: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
      color?: string
    }
  | {
      op: 'move_object'
      objectRef: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
      name?: string
    }
  | { op: 'remove_object'; objectRef: string }
  | {
      op: 'set_camera'
      cameraRef?: string
      name?: string
      position?: BlenderDirectorVector3
      lookAt?: BlenderDirectorVector3
      fov?: number
      aspectRatio?: BlenderDirectorAspectRatio
    }
  | {
      op: 'set_camera_path'
      cameraRef?: string
      points: BlenderDirectorVector3[]
      durationSec: number
    }
  | {
      op: 'set_beat'
      id: string
      title: string
      action?: string
      cameraNote?: string
      dialogue?: string
      notes?: string
      durationSec?: number
    }

export type VibingDirectorPlan = {
  mode: 'replace' | 'amend'
  brief?: string
  actions: VibingDirectorAction[]
}

export type VibingDirectorPlanResult = {
  state: VibingDirectorState
  applied: string[]
  rejected: string[]
}

const ASPECT_RATIOS = new Set<BlenderDirectorAspectRatio>(['16:9', '9:16', '4:3', '3:4', '1:1', '2.39:1'])
const ASSET_FORMATS = new Set<BlenderDirectorAssetFormat>(['blend', 'glb', 'gltf', 'fbx', 'obj'])
const ASSET_SOURCES = new Set<BlenderDirectorAssetSource>(['local', 'polyhaven', 'quaternius', 'blenderkit'])
const STAGE_PRESETS = new Set<BlenderDirectorStagePreset>(BLENDER_DIRECTOR_STAGE_PRESETS)

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function inferMarkerRole(id: string, name: string, explicitRole = ''): string {
  if (explicitRole) return explicitRole
  const source = `${id} ${name}`.toLowerCase()
  if (/cup|coffee[-_ ]?cup|咖啡杯|杯/.test(source)) return 'cup'
  if (/laptop|notebook|电脑/.test(source)) return 'laptop'
  if (/plate|cake|盘|蛋糕/.test(source)) return 'plate'
  if (/chair|seat|椅/.test(source)) return 'chair'
  if (/table|desk|桌/.test(source)) return 'table'
  if (/actor|character|char[-_ ]?[ab]|角色|人物|客人|咖啡师/.test(source)) return 'actor_seated'
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
  return {
    id,
    name: text(raw.name, fileName),
    fileName,
    format: format as BlenderDirectorAssetFormat,
    source: ASSET_SOURCES.has(source) ? source : 'local',
    license: text(raw.license, '需确认'),
    importedAt: finite(raw.importedAt, index + 1),
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

function normalizeOutput(value: unknown): BlenderDirectorOutput | undefined {
  const raw = record(value)
  const jobId = text(raw.jobId)
  const previewUrl = text(raw.previewUrl)
  const blendUrl = text(raw.blendUrl)
  const modelUrl = text(raw.modelUrl)
  const blendRelativePath = text(raw.blendRelativePath)
  if (!jobId || !previewUrl || !blendUrl || !modelUrl || !blendRelativePath) return undefined
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
    case 'set_stage': return `设置场景：${action.preset}`
    case 'set_blocking_layout': return `整理摆位：${action.template}`
    case 'place_asset': return `摆放资产：${action.name}`
    case 'add_marker': return `添加走位标记：${action.name}`
    case 'move_object': return `调整对象：${action.objectRef}`
    case 'remove_object': return `移除对象：${action.objectRef}`
    case 'set_camera': return `调整机位：${action.name || action.cameraRef || '导演相机'}`
    case 'set_camera_path': return `设置运镜：${action.cameraRef || '导演相机'}`
    case 'set_beat': return `更新节拍：${action.title}`
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
    ...(executablePlan.mode === 'replace' ? { stagePreset: 'empty', objects: [], beats: [] } : {}),
    assets: [...base.assets],
    objects: [...(executablePlan.mode === 'replace' ? [] : base.objects)],
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
      applied.push(label(action))
      continue
    }
    if (action.op === 'set_camera') {
      if (action.cameraRef && action.cameraRef !== draft.camera.id && action.cameraRef !== draft.camera.name) {
        rejected.push(`当前没有机位「${action.cameraRef}」`)
        continue
      }
      draft.camera = {
        ...draft.camera,
        ...(action.name ? { name: action.name } : {}),
        ...(action.position ? { position: action.position } : {}),
        ...(action.lookAt ? { lookAt: action.lookAt } : {}),
        ...(action.fov ? { fov: action.fov } : {}),
        ...(action.aspectRatio ? { aspectRatio: action.aspectRatio } : {}),
      }
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

  const next: VibingDirectorState = {
    ...draft,
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
  return [
    `当前 VIBING Director 节点 id: ${directorNodeId}`,
    `后端: Blender（节点只回传 .blend、渲染预览和 GLB，不管理 Three.js 场景）`,
    `创作简述: ${normalized.brief || '未设置'}`,
    `场景预设: ${normalized.stagePreset}`,
    `机位: ${normalized.camera.id} | ${normalized.camera.name} | position=${JSON.stringify(normalized.camera.position)} | lookAt=${JSON.stringify(normalized.camera.lookAt)} | fov=${normalized.camera.fov}`,
    `资产库:\n${assets}`,
    `当前对象:\n${objects}`,
    `镜头节拍:\n${beats}`,
  ].join('\n')
}
