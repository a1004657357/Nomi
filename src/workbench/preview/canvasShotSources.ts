import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { isShotNumberedNode } from '../generationCanvas/model/shotNumbering'

/**
 * 剪辑页左栏「镜头」页签的数据源：画布上**已出片**的镜头。
 *
 * 为什么在剪辑页需要它：剪辑页此前够不着画布——一键拼片只能整体排一次，
 * 之后想单独补一个镜头进成片就没路了（只能切回生成页拖）。
 *
 * 口径：
 * - 只收有产物（result.url）且产物是图/视频的节点——音频不在这里（它属于「素材」页签的配乐）。
 * - 镜号直接读 node.shotIndex（存储身份，见 shotNumbering 头注释），**绝不按位置重排自造编号**；
 *   没领号的节点（参考卡/首帧图/非分镜分类）不显示号，但仍可入轨。
 * - 排序：有镜号的按镜号升序在前，无号的按画布 y/x 稳定排在后——与用户在画布上看到的顺序一致。
 */
export type CanvasShotSource = {
  nodeId: string
  shotIndex: number | null
  label: string
  mediaType: 'image' | 'video'
  /** 格子封面用（视频优先缩略图，缺则让封面组件自己抽帧）。 */
  thumbnailUrl: string
  url: string
}

function resultMediaType(node: GenerationCanvasNode): 'image' | 'video' | null {
  const type = node.result?.type
  if (type === 'image' || type === 'video') return type
  return null
}

export function selectCanvasShotSources(nodes: readonly GenerationCanvasNode[]): CanvasShotSource[] {
  const sources: Array<CanvasShotSource & { y: number; x: number }> = []
  for (const node of nodes) {
    const mediaType = resultMediaType(node)
    if (!mediaType) continue
    const url = typeof node.result?.url === 'string' ? node.result.url.trim() : ''
    if (!url) continue
    const numbered = isShotNumberedNode(node)
    const shotIndex = numbered && typeof node.shotIndex === 'number' ? node.shotIndex : null
    sources.push({
      nodeId: node.id,
      shotIndex,
      label: node.title?.trim() || '',
      mediaType,
      thumbnailUrl: typeof node.result?.thumbnailUrl === 'string' ? node.result.thumbnailUrl.trim() : '',
      url,
      y: node.position?.y ?? 0,
      x: node.position?.x ?? 0,
    })
  }
  sources.sort((left, right) => {
    if (left.shotIndex != null && right.shotIndex != null) return left.shotIndex - right.shotIndex
    // 有号的排在无号的前面；同为无号按画布位置（y 后 x）稳定排
    if (left.shotIndex != null) return -1
    if (right.shotIndex != null) return 1
    if (left.y !== right.y) return left.y - right.y
    if (left.x !== right.x) return left.x - right.x
    return left.nodeId.localeCompare(right.nodeId)
  })
  return sources.map(({ y: _y, x: _x, ...source }) => source)
}
