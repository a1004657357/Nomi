import { canvasSourceDefaults } from '../../../../electron/shared/canvas/sourceDefaults'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationQualityHumanReview,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'

export function latestMultiResultCollection(node: GenerationCanvasNode): GenerationResultCollection | undefined {
  return [...(node.resultCollections ?? [])].reverse().find((collection) => (
    collection.items.length > 1
    || collection.items.some((item) => (item.candidates?.length ?? 0) > 1)
  ))
}

export function latestQualityResultCollection(node: GenerationCanvasNode): GenerationResultCollection | undefined {
  return [...(node.resultCollections ?? [])].reverse().find((collection) => Boolean(collection.quality))
}

export function patchForCollectionResultSelection(
  node: GenerationCanvasNode,
  selectedResult: GenerationNodeResult,
): Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'> {
  const history: GenerationNodeResult[] = []
  const seen = new Set<string>()
  const add = (result: GenerationNodeResult | undefined) => {
    if (!result) return
    const key = result.id || result.url || result.thumbnailUrl || result.text || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    history.push(result)
  }
  add(selectedResult)
  add(node.result)
  ;(node.history ?? []).forEach(add)
  ;[...(node.resultCollections ?? [])].reverse().forEach((collection) => {
    collection.items.forEach((item) => {
      add(item.result)
      item.candidates?.forEach(add)
    })
  })
  return {
    result: { ...selectedResult },
    history,
    status: 'success',
    error: undefined,
  }
}

export function patchForCollectionCandidateSelection(
  node: GenerationCanvasNode,
  collectionId: string,
  itemId: string,
  candidateId: string,
): Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error' | 'resultCollections'> | null {
  const collection = node.resultCollections?.find((entry) => entry.id === collectionId)
  const item = collection?.items.find((entry) => entry.id === itemId)
  const selected = item?.candidates?.find((candidate) => candidate.id === candidateId)
  if (!collection || !item || !selected) return null

  const selectionPatch = patchForCollectionResultSelection(node, selected)
  return {
    ...selectionPatch,
    resultCollections: (node.resultCollections ?? []).map((entry) => {
      if (entry.id !== collectionId) return entry
      return {
        ...entry,
        items: entry.items.map((candidateItem) => (
          candidateItem.id === itemId
            ? {
                ...candidateItem,
                result: selected,
                selectedResultId: selected.id,
              }
            : candidateItem
        )),
        ...(entry.quality
          ? {
              quality: {
                ...entry.quality,
                status: 'unavailable' as const,
                evaluatedAt: Date.now(),
                humanReview: undefined,
                checks: [
                  {
                    id: 'candidate-selection-changed',
                    label: canvasSourceDefaults.candidateChanged(),
                    status: 'unavailable' as const,
                    summary: '已切换供应商候选，需要重新执行当前结果的质量检查。',
                    itemIds: [itemId],
                  },
                  ...entry.quality.checks.filter((check) => check.id !== 'candidate-selection-changed'),
                ],
              },
            }
          : {}),
      }
    }),
  }
}

export function patchForQualityHumanReview(
  node: GenerationCanvasNode,
  collectionId: string,
  review: GenerationQualityHumanReview | undefined,
): Pick<GenerationCanvasNode, 'resultCollections'> | null {
  const collections = node.resultCollections ?? []
  const targetIndex = collections.findIndex((collection) => (
    collection.id === collectionId && Boolean(collection.quality)
  ))
  if (targetIndex < 0) return null

  const normalizedReview = review
    ? {
        ...review,
        note: review.note?.trim().slice(0, 500) || undefined,
      }
    : undefined
  return {
    resultCollections: collections.map((collection, index) => {
      if (index !== targetIndex || !collection.quality) return collection
      return {
        ...collection,
        quality: {
          ...collection.quality,
          humanReview: normalizedReview,
        },
      }
    }),
  }
}
