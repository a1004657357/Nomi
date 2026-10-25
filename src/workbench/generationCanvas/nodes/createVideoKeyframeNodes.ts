import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { buildVideoKeyframeNodeDrafts, type ExtractedVideoKeyframe } from './videoKeyframeInspectorModel'

export function createVideoKeyframeNodes(
  source: GenerationCanvasNode,
  frames: readonly ExtractedVideoKeyframe[],
): string[] {
  const store = useGenerationCanvasStore.getState()
  const ids = buildVideoKeyframeNodeDrafts(source, frames).map((draft) => {
    const created = store.addNode({
      kind: 'keyframe',
      title: draft.title,
      position: draft.position,
      categoryId: source.categoryId,
      meta: draft.meta,
      select: false,
    })
    store.updateNode(created.id, { result: draft.result })
    return created.id
  })
  if (ids.length) store.selectNodes(ids)
  return ids
}
