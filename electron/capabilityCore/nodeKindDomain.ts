// 节点 kind 的纯几何/语义表 · **electron 主进程侧的注入源**（供 canvasNodeFactory / canvasNodeLayout）。
//
// 为什么存在这份表：单一真相源在 src（registry.defaultSize / getGenerationNodeDefaultTitle /
// getDefaultCategoryForNodeKind / shotNumbering），但 electron production 反向 import 不了 src。
// 故这里放一份**纯镜像**，并由 `nodeKindDomain.equivalence.test.ts` 钉死 === src registry 值——
// 漂移即测试红（本仓既有「重复 + 等价测试守恒」模式：thumbnailDerive.equivalence / dreaminaSeed）。
// 渲染层**不用**这份表：它注入 src 真函数，故 UI 路径永远吃单一真相源。
//
// 纯净：零 import（可在纯 Node 单测）。

/** per-kind 名义默认尺寸（镜像 registry.defaultSize）。 */
export const NODE_KIND_DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  text: { width: 280, height: 200 },
  character: { width: 300, height: 190 },
  scene: { width: 300, height: 190 },
  image: { width: 340, height: 280 },
  keyframe: { width: 320, height: 220 },
  video: { width: 420, height: 340 },
  audio: { width: 420, height: 80 },
  clip: { width: 760, height: 132 },
  shot: { width: 340, height: 230 },
  output: { width: 560, height: 420 },
  compare: { width: 520, height: 360 },
  skill: { width: 380, height: 360 },
  panorama: { width: 480, height: 270 },
  scene3d: { width: 480, height: 320 },
  vibingDirector: { width: 500, height: 340 },
  whiteboard: { width: 320, height: 240 },
  model3d: { width: 320, height: 300 },
  resource: { width: 300, height: 220 },
  asset: { width: 340, height: 280 },
}

/** per-kind 默认标题（镜像 registry.defaultTitle；headless 工厂存空标题，由渲染层本地化）。 */
export const NODE_KIND_DEFAULT_TITLE: Record<string, string> = {
  text: '文本',
  character: '角色',
  scene: '场景',
  image: '图片',
  keyframe: '关键帧',
  video: '视频',
  audio: '声音',
  clip: '剪辑',
  shot: '镜头',
  output: '输出收集',
  compare: '图像对比',
  skill: '技能',
  panorama: '全景图',
  scene3d: '3D导演台',
  vibingDirector: 'VIBING Director',
  whiteboard: '画板',
  model3d: '3D 模型',
  resource: '创作资源',
  asset: '素材',
}

// 极端兜底尺寸（理论不可达；仅防 kind 串入非法值）。与 src generationNodeKinds FOOTPRINT_FALLBACK_SIZE 同值。
const FALLBACK_SIZE = { width: 340, height: 280 }

// 「渲染足迹 = 名义 + 安全余量」的余量常量——**必须与 src NODE_RENDER_SAFETY 同值**（等价测试守恒）。
// 足迹自带余量即是间距，单插避让与批量布局共用同一足迹。
export const NODE_RENDER_SAFETY = 64

// 占镜号的 kind 集合（镜像 src shotNumbering SHOT_NUMBERED_KINDS）。
const SHOT_NUMBERED_KINDS = new Set(['image', 'video', 'shot', 'keyframe'])

/** per-kind 默认尺寸（缺省兜底）。 */
export function nodeKindDefaultSize(kind: string): { width: number; height: number } {
  return NODE_KIND_DEFAULT_SIZE[kind] ?? FALLBACK_SIZE
}

/** 渲染足迹（名义或显式 size + 安全余量）。 */
export function nodeKindFootprint(kind: string, size?: { width: number; height: number }): { width: number; height: number } {
  const base = size ?? nodeKindDefaultSize(kind)
  return { width: base.width + NODE_RENDER_SAFETY, height: base.height + NODE_RENDER_SAFETY }
}

/** per-kind 默认标题（registry 回退）。 */
export function nodeKindDefaultTitle(kind: string): string {
  return NODE_KIND_DEFAULT_TITLE[kind] ?? kind
}

/**
 * kind→默认分类（镜像 src getDefaultCategoryForNodeKind）：
 * character→cast；场景/导演/资源→scene；audio→audio；其余→shots。
 */
export function nodeKindDefaultCategory(kind: string): string {
  switch (kind) {
    case 'character':
      return 'cast'
    case 'scene':
    case 'panorama':
    case 'scene3d':
    case 'vibingDirector':
    case 'model3d':
    case 'resource':
      return 'scene'
    case 'audio':
      return 'audio'
    default:
      return 'shots'
  }
}

/**
 * 是否占镜号（镜像 src isShotNumberedNode）：仅「shots 分类里的 image/video/shot/keyframe」占号，
 * 且排除参考卡、首帧图与派生时间关键帧——它们不领独立镜号。
 */
export function nodeKindIsShotNumbered(node: { kind?: string; categoryId?: string; meta?: Record<string, unknown> }): boolean {
  const meta = node.meta as Record<string, unknown> | undefined
  if (meta && meta.referenceSheet === true) return false
  if (meta && meta.storyboardKeyframe === true) return false
  if (meta && meta.excludeFromShotNumbering === true) return false
  return (node.categoryId ?? 'shots') === 'shots' && SHOT_NUMBERED_KINDS.has(node.kind ?? '')
}

/** 下一个可用镜号（max+1，1-based；镜像 src nextShotIndex）。 */
export function nodeKindNextShotIndex(existing: readonly {
  kind?: string; categoryId?: string; meta?: Record<string, unknown>; shotIndex?: number
}[]): number {
  let max = 0
  for (const node of existing) {
    if (nodeKindIsShotNumbered(node) && typeof node.shotIndex === 'number' && node.shotIndex > max) max = node.shotIndex
  }
  return max + 1
}
