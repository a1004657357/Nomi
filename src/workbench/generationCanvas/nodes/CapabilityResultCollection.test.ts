import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import {
  latestMultiResultCollection,
  patchForCollectionCandidateSelection,
  latestQualityResultCollection,
  patchForCollectionResultSelection,
  patchForQualityHumanReview,
} from './capabilityResultCollectionModel'
import { CapabilityHumanReviewControl } from './CapabilityHumanReviewControl'
import { CapabilityResultCollection } from './CapabilityResultCollection'

function imageResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function collection(id: string, count: number): GenerationResultCollection {
  return {
    id,
    recipeId: 'image.multiview.grid9',
    createdAt: 100,
    quality: {
      version: 1,
      kind: 'grid9',
      evaluator: 'grid9-local-v1',
      status: 'warning',
      evaluatedAt: 101,
      checks: [{
        id: 'view-diversity',
        label: '视角差异',
        status: 'warning',
        summary: '发现 1 组高度相似画面',
      }],
    },
    items: Array.from({ length: count }, (_, index) => ({
      id: `view-${index + 1}`,
      label: `机位 ${index + 1}`,
      status: index === count - 1 ? 'error' : 'success',
      ...(index === count - 1
        ? { error: '供应商超时' }
        : { result: imageResult(`image-${index + 1}`) }),
    })),
  }
}

function node(): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: '九宫格结果',
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    result: imageResult('image-1'),
    history: [imageResult('image-1')],
    resultCollections: [collection('older', 4), collection('latest', 9)],
  }
}

describe('latestMultiResultCollection', () => {
  it('selects the newest collection that has multiple visible outputs', () => {
    expect(latestMultiResultCollection(node())?.id).toBe('latest')
  })

  it('finds a quality report even when the newest recipe has only one output', () => {
    const source = node()
    source.resultCollections = [
      ...(source.resultCollections ?? []),
      {
        ...collection('panorama', 1),
        recipeId: 'scene.panorama.2to1',
        quality: {
          version: 1,
          kind: 'panorama',
          evaluator: 'panorama-local-v1',
          status: 'pass',
          evaluatedAt: 102,
          checks: [],
        },
      },
    ]
    expect(latestQualityResultCollection(source)?.id).toBe('panorama')
  })

  it('shows a single logical output when it contains four provider candidates', () => {
    const source = node()
    source.resultCollections = [{
      id: 'single-with-candidates',
      recipeId: 'portrait.refine',
      createdAt: 100,
      items: [{
        id: 'portrait',
        label: '真实化人像',
        status: 'success',
        result: imageResult('candidate-1'),
        selectedResultId: 'candidate-1',
        candidates: [
          imageResult('candidate-1'),
          imageResult('candidate-2'),
          imageResult('candidate-3'),
          imageResult('candidate-4'),
        ],
      }],
    }]

    expect(latestMultiResultCollection(source)?.id).toBe('single-with-candidates')
  })
})

describe('patchForCollectionResultSelection', () => {
  it('switches the primary result without deleting previous or sibling results', () => {
    const source = node()
    const selected = imageResult('image-2')
    const patch = patchForCollectionResultSelection(source, selected)

    expect(patch.result?.id).toBe('image-2')
    expect(patch.history?.map((result) => result.id)).toEqual([
      'image-2',
      'image-1',
      'image-3',
      'image-4',
      'image-5',
      'image-6',
      'image-7',
      'image-8',
    ])
  })
})

describe('patchForCollectionCandidateSelection', () => {
  it('updates the selected candidate and primary result while retaining all siblings', () => {
    const source = node()
    source.resultCollections = [{
      id: 'candidate-set',
      recipeId: 'portrait.refine',
      createdAt: 100,
      items: [{
        id: 'portrait',
        label: '真实化人像',
        status: 'success',
        result: imageResult('candidate-1'),
        selectedResultId: 'candidate-1',
        candidates: [
          imageResult('candidate-1'),
          imageResult('candidate-2'),
          imageResult('candidate-3'),
          imageResult('candidate-4'),
        ],
      }],
    }]

    const patch = patchForCollectionCandidateSelection(
      source,
      'candidate-set',
      'portrait',
      'candidate-3',
    )

    expect(patch?.result?.id).toBe('candidate-3')
    expect(patch?.resultCollections?.[0]?.items[0]).toMatchObject({
      selectedResultId: 'candidate-3',
      result: { id: 'candidate-3' },
    })
    expect(patch?.resultCollections?.[0]?.items[0]?.candidates?.map((result) => result.id)).toEqual([
      'candidate-1',
      'candidate-2',
      'candidate-3',
      'candidate-4',
    ])
    expect(patch?.history?.map((result) => result.id)).toEqual(expect.arrayContaining([
      'candidate-1',
      'candidate-2',
      'candidate-3',
      'candidate-4',
    ]))
  })
})

describe('patchForQualityHumanReview', () => {
  it('records a human verdict without overwriting automatic checks or sibling history', () => {
    const source = node()
    const patch = patchForQualityHumanReview(source, 'latest', {
      verdict: 'rejected',
      reviewedAt: 200,
      note: '右后机位身份漂移',
    })

    expect(patch?.resultCollections).toHaveLength(2)
    expect(patch?.resultCollections?.[0]).toBe(source.resultCollections?.[0])
    expect(patch?.resultCollections?.[1]?.quality).toMatchObject({
      status: 'warning',
      humanReview: {
        verdict: 'rejected',
        reviewedAt: 200,
        note: '右后机位身份漂移',
      },
    })
    expect(patch?.resultCollections?.[1]?.quality?.checks[0]?.id).toBe('view-diversity')
    expect(source.resultCollections?.[1]?.quality?.humanReview).toBeUndefined()
  })

  it('clears only the human verdict and ignores an unknown collection id', () => {
    const source = node()
    source.resultCollections![1]!.quality!.humanReview = {
      verdict: 'accepted',
      reviewedAt: 200,
    }

    const cleared = patchForQualityHumanReview(source, 'latest', undefined)
    expect(cleared?.resultCollections?.[1]?.quality?.humanReview).toBeUndefined()
    expect(cleared?.resultCollections?.[1]?.quality?.status).toBe('warning')
    expect(patchForQualityHumanReview(source, 'missing', undefined)).toBeNull()
  })
})

describe('CapabilityResultCollection', () => {
  it('renders a stable grid with successful previews and failed output state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CapabilityResultCollection, {
        node: node(),
        readOnly: true,
        mediaPreviewPriority: false,
      }),
    )

    expect(markup).toContain('data-capability-result-collection="latest"')
    expect(markup).toContain('data-collection-columns="3"')
    expect(markup).toContain('nomi-local://image-1.png')
    expect(markup).toContain('data-result-status="error"')
    expect(markup).toContain('供应商超时')
    expect(markup).toContain('data-capability-quality-status="warning"')
    expect(markup).toContain('查看质量报告：需检查')
  })

  it('offers one in-place retry action when an editable recipe collection has failed items', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CapabilityResultCollection, {
        node: node(),
        readOnly: false,
        mediaPreviewPriority: false,
      }),
    )

    expect(markup).toContain('data-capability-retry-failed="true"')
    expect(markup).toContain('重试 1 个失败结果')
  })

  it('offers a four-candidate selector without expanding candidates into canvas nodes', () => {
    const source = node()
    source.resultCollections = [{
      id: 'candidate-set',
      recipeId: 'portrait.refine',
      createdAt: 100,
      items: [{
        id: 'portrait',
        label: '真实化人像',
        status: 'success',
        result: imageResult('candidate-1'),
        selectedResultId: 'candidate-1',
        candidates: [
          imageResult('candidate-1'),
          imageResult('candidate-2'),
          imageResult('candidate-3'),
          imageResult('candidate-4'),
        ],
      }],
    }]

    const markup = renderToStaticMarkup(
      React.createElement(CapabilityResultCollection, {
        node: source,
        readOnly: false,
        mediaPreviewPriority: false,
      }),
    )

    expect(markup).toContain('data-provider-candidate-count="4"')
    expect(markup).toContain('选择 4 个候选')
  })

  it('renders a 5x5 mood matrix with axis context and a source comparison entry', () => {
    const source = node()
    const items = Array.from({ length: 25 }, (_, index) => {
      const energy = Math.floor(index / 5)
      const affinity = index % 5
      return {
        id: `mood-e${energy}-a${affinity}`,
        label: `能量 ${energy} · 亲和 ${affinity}`,
        energy,
        affinity,
        status: 'success' as const,
        result: imageResult(`mood-${index}`),
      }
    })
    source.result = items[0]!.result
    source.resultCollections = [{
      id: 'mood-matrix',
      recipeId: 'portrait.mood',
      createdAt: 100,
      source: {
        nodeId: 'portrait-source',
        resultId: 'portrait-source-result',
        label: '原始人像',
        url: 'nomi-local://portrait-source.png',
      },
      items,
    }]

    const markup = renderToStaticMarkup(
      React.createElement(CapabilityResultCollection, {
        node: source,
        readOnly: true,
        mediaPreviewPriority: false,
      }),
    )

    expect(markup).toContain('data-mood-matrix="5x5"')
    expect(markup).toContain('data-collection-columns="5"')
    expect(markup).toContain('能量 0 → 4')
    expect(markup).toContain('亲和 0 → 4')
    expect(markup).toContain('与原图对比')
  })

  it('renders a persisted human verdict without replacing the automatic quality status', () => {
    const source = node()
    source.resultCollections![1]!.quality!.humanReview = {
      verdict: 'accepted',
      reviewedAt: 300,
      note: '人工确认主体和构图可用',
    }
    const markup = renderToStaticMarkup(
      React.createElement(CapabilityHumanReviewControl, {
        node: source,
        collection: source.resultCollections![1]!,
        readOnly: true,
      }),
    )

    expect(source.resultCollections?.[1]?.quality?.status).toBe('warning')
    expect(markup).toContain('data-quality-human-review="accepted"')
    expect(markup).toContain('人工通过')
    expect(markup).toContain('人工确认主体和构图可用')
    expect(markup).not.toContain('人工验收备注')
  })

  it('offers note, accept, and reject controls for an editable quality report', () => {
    const source = node()
    const markup = renderToStaticMarkup(
      React.createElement(CapabilityHumanReviewControl, {
        node: source,
        collection: source.resultCollections![1]!,
        readOnly: false,
      }),
    )

    expect(markup).toContain('data-quality-human-review="unreviewed"')
    expect(markup).toContain('人工验收备注')
    expect(markup).toContain('通过')
    expect(markup).toContain('拒绝')
    expect(markup).toContain('不覆盖自动质量报告')
  })
})
