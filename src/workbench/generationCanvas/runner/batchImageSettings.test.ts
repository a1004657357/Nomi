import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { applyImageBatchSettingsToNode, applyVideoBatchSettingsToNode, createImageBatchDraftMeta, createVideoBatchDraftMeta } from './batchImageSettings'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { buildCatalogTaskRequest } from './catalogTaskActions'

const codexOption: ModelOption = {
  value: 'codex-img2',
  label: 'Codex Img2',
  modelKey: 'codex-img2',
  modelAlias: 'codex-img2',
  vendor: 'codex',
}

const agnesVideoOption: ModelOption = {
  value: 'agnes-video-v2.0',
  label: 'Agnes Video V2.0',
  modelKey: 'agnes-video-v2.0',
  modelAlias: 'agnes-video-v2.0',
  vendor: 'agnes',
  meta: { archetypeId: 'agnes-video' },
}

function imageNode(id: string, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x: 0, y: 0 },
    prompt: 'p',
    meta,
  } as GenerationCanvasNode
}

function videoNode(id: string, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return {
    id,
    kind: 'video',
    title: id,
    position: { x: 0, y: 0 },
    prompt: 'p',
    meta,
  } as GenerationCanvasNode
}

function edge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}->${target}`, source, target, mode: 'reference' }
}

describe('batchImageSettings', () => {
  it('builds draft model and scalar params without copying source reference arrays', () => {
    const draft = createImageBatchDraftMeta({
      option: codexOption,
      value: 'codex-img2',
      sourceMeta: {
        aspect_ratio: '9:16',
        resolution: '2K',
        referenceImageUrls: ['nomi-local://asset/source.png'],
      },
    })

    expect(draft.meta).toMatchObject({
      modelKey: 'codex-img2',
      modelVendor: 'codex',
      imageModel: 'codex-img2',
      aspect_ratio: '9:16',
      resolution: '2K',
    })
    expect(draft.meta).not.toHaveProperty('referenceImageUrls')
  })

  it('keeps incoming image references consumable after applying Codex Img2 batch settings', () => {
    const source = imageNode('source')
    const target = imageNode('target', { archetype: { id: 'seedream', modeId: 'edit' }, referenceImageUrls: ['keep-me'] })
    const draft = createImageBatchDraftMeta({ option: codexOption, value: 'codex-img2' })

    const meta = applyImageBatchSettingsToNode({
      node: target,
      nodes: [source, target],
      edges: [edge('source', 'target')],
      modelOption: codexOption,
      currentModelOption: null,
      draftMeta: draft.meta,
    })

    expect(meta.modelKey).toBe('codex-img2')
    expect(meta.referenceImageUrls).toEqual(['keep-me'])
    expect(meta.archetype).toMatchObject({ id: 'gpt-image-2', modeId: 'i2i' })
  })

  it('builds video draft params and promotes incoming images to the canonical reference workflow', () => {
    const sources = ['first', 'last'].map((id) => ({
      ...imageNode(id),
      result: { id: `${id}-result`, type: 'image' as const, url: `https://cdn.example/${id}.png`, createdAt: 1 },
    }))
    const target = videoNode('target', { archetype: { id: 'agnes-video', modeId: 't2v' } })
    // Canonical reference-workflow ranking now selects keyframes (min 2), not the single-frame i2v mode.
    const edges = sources.map((source, order) => ({ ...edge(source.id, target.id), order }))
    const draft = createVideoBatchDraftMeta({
      option: agnesVideoOption,
      value: 'agnes-video-v2.0',
      sourceMeta: { aspect_ratio: '9:16', resolution: '720p', duration: 8 },
    })

    expect(draft.meta).toMatchObject({
      modelKey: 'agnes-video-v2.0',
      modelVendor: 'agnes',
      videoModel: 'agnes-video-v2.0',
      aspect_ratio: '9:16',
      resolution: '720p',
      duration: 8,
    })

    const meta = applyVideoBatchSettingsToNode({
      node: target,
      nodes: [...sources, target],
      edges,
      modelOption: agnesVideoOption,
      currentModelOption: null,
      draftMeta: draft.meta,
    })

    expect(meta.modelKey).toBe('agnes-video-v2.0')
    expect(meta.videoModel).toBe('agnes-video-v2.0')
    expect(meta.archetype).toMatchObject({ id: 'agnes-video', modeId: 'keyframes' })
    const configured = { ...target, meta }
    const references = resolveGenerationReferences(configured, { nodes: [...sources, configured], edges })
    const { request } = buildCatalogTaskRequest(configured, { references })
    expect(request.kind).toBe('image_to_video')
    expect(request.extras?.archetypeInput).toMatchObject({ keyframe_images: sources.map((source) => source.result.url) })
  })

  it('preserves an explicit single-frame i2v mode and sends its image as a scalar', () => {
    const source = {
      ...imageNode('source'),
      result: { id: 'source-result', type: 'image' as const, url: 'https://cdn.example/first.png', createdAt: 1 },
    }
    const target = videoNode('target', { archetype: { id: 'agnes-video', modeId: 'i2v' } })
    const edges: GenerationCanvasEdge[] = [{ ...edge(source.id, target.id), mode: 'first_frame' }]
    const draft = createVideoBatchDraftMeta({ option: agnesVideoOption, value: agnesVideoOption.value })
    const meta = applyVideoBatchSettingsToNode({
      node: target, nodes: [source, target], edges, modelOption: agnesVideoOption, currentModelOption: agnesVideoOption,
      draftMeta: draft.meta,
    })
    expect(meta.archetype).toMatchObject({ id: 'agnes-video', modeId: 'i2v' })
    const configured = { ...target, meta }
    const references = resolveGenerationReferences(configured, { nodes: [source, configured], edges })
    const { request } = buildCatalogTaskRequest(configured, { references })
    expect(request.kind).toBe('image_to_video')
    expect(request.extras?.archetypeInput).toMatchObject({ image: source.result.url })
    expect(request.extras?.archetypeInput).not.toHaveProperty('keyframe_images')
  })
})
