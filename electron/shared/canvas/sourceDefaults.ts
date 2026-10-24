/** Canonical authored canvas defaults. Never depend on the current display locale. */
export type RecipeCameraOutput = {
  id: string
  label: string
  azimuth: number
  elevation: number
  shotSize: string
}

const CAMERA_ANGLES = [0, 45, 90, 135, 180, -90]

export function recipeCameraOutputLabel(index: string | number): string {
  return `机位 ${index}`
}

export function createRecipeCameraOutputs(count: number, current: readonly RecipeCameraOutput[]): RecipeCameraOutput[] {
  return Array.from({ length: count }, (_, index) => current[index] ?? {
    id: `view-${index + 1}`,
    label: recipeCameraOutputLabel(index + 1),
    azimuth: CAMERA_ANGLES[index] ?? Math.min(180, index * 30),
    elevation: 0,
    shotSize: '中景',
  })
}

export const PROP_SOURCE_NAMES = {
  car: '车辆', building: '建筑', tree: '树木', streetlamp: '路灯', wall: '墙面',
  suv: 'SUV', bus: '公交车', bicycle: '自行车', scooter: '电动踏板车', diningTable: '餐桌',
  sofa: '沙发', fridge: '冰箱', washingMachine: '洗衣机', trashBins: '分类垃圾桶',
  atm: 'ATM 机', backpack: '背包',
} as const

export const MODEL3D_VIEW_SOURCE_NAMES = {
  front: '正面', 'front-right': '右前侧', right: '右侧', 'rear-right': '右后侧', rear: '背面',
  'rear-left': '左后侧', left: '左侧', 'front-left': '左前侧', top: '俯视',
} as const

export function actorSourceName(code: string): string {
  return `角色${code}`
}

/** Capture labels also enter nodes, prompt inputs and historical frame-slot matching. */
export function cameraMoveFrameLabel(frame: string): string {
  return `运镜${frame}`
}

export const scene3dCaptureSource = {
  stagingReference: () => '站位参考',
  stagingPrompt: () => '3D 站位参考（站位 + 动作 + 机位）',
  cameraMoveReference: () => '运镜参考',
  viewportTitle: () => '3D截图 - 当前视口',
  cameraTitle: (name: string) => `3D截图 - ${name}`,
  recordedTakeTitle: () => '录制走位参考',
  screenshotPrompt: () => '3D 场景截图',
  firstFrame: () => '首帧',
  lastFrame: () => '尾帧',
  cameraMoveFrameTitle: (camera: string, frame: string) => `${camera} · ${cameraMoveFrameLabel(frame)}`,
  cameraMoveFramesTitle: (camera: string) => `${camera} · 运镜首尾帧`,
  panoramaName: () => '全景图',
}

export const canvasSourceDefaults = {
  scene3dTitle: () => '3D 导演台',
  importedScriptTitle: () => '导入剧本',
  shotTitle: (index: string | number) => `镜 ${index}`,
  shotImageTitle: (index: string | number) => `镜头 ${index} · 图片`,
  shotVideoTitle: (index: string | number) => `镜头 ${index} · 视频`,
  keyframeTitle: (index: string | number, time: string | number, frame: string) => `镜头 ${index} · ${time}秒${frame}帧`,
  storyboardGroupTitle: (name: string) => `分镜组：${name.trim() || '未命名分镜'}`,
  scene3dHandoffTitle: (name: string) => `${name} · 3D 导演台`,
  actorName: (index: number) => actorSourceName(index < 26 ? String.fromCharCode(65 + index) : `A${index - 25}`),
  blenderPreviewTitle: (director: boolean) => director ? 'Blender 导演预演' : 'Blender 场景预览',
  blenderModelTitle: (director: boolean) => director ? 'Blender 导演场景' : 'Blender 场景模型',
  candidateChanged: () => '候选切换',
  localQuality: () => '本地质量检测',
  unknownAgentTool: (name: string) => `未知的 Agent 工具: ${name}`,
}

export function generationModeRationale(mode: string): string {
  switch (mode) {
    case 'text-to-image': return '无既有视觉资产、构图自由，文生图'
    case 'image-to-image': return '角色/场景身份一致，参考锚喂图生图'
    case 'text-to-video': return '无既有视觉资产，文生视频'
    case 'first-frame': return '有首帧图，first-frame 锁起始构图'
    case 'omni-reference': return '角色/场景身份一致但需较大运动自由，全能参考'
    default: return `迁移期推断模式 ${mode}（PlanShot 无显式 mode 字段）`
  }
}
