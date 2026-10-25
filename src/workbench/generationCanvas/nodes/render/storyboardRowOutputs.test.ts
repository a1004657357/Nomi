import { beforeEach, describe, expect, it } from 'vitest'
import { __resetCanvasUndoJournalForTests } from '../../events/canvasUndoJournal'
import { isStoryboardContainedNodeHidden, storyboardContainedRole } from '../../model/storyboardContainedNodes'
import type { PlanShot, StoryboardPlan } from '../../agent/storyboardPlan'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  ensureStoryboardRowImageOutput,
  ensureStoryboardRowVideoOutput,
} from './storyboardRowOutputs'

const shot: PlanShot = {
  index: 2,
  shotKind: 'video',
  durationSec: 4,
  anchorIds: [],
  prompt: '咖啡杯特写',
  imagePrompt: '暖色咖啡杯特写，静态构图',
  videoPrompt: '镜头缓慢推进，咖啡热气上升',
  modelKey: 'bytedance/seedance-2',
  modeId: 'first',
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

function seedTable() {
  return useGenerationCanvasStore.getState().addNode({
    kind: 'text',
    title: '咖啡广告分镜',
    position: { x: 100, y: 80 },
    size: { width: 1680, height: 920 },
    categoryId: 'shots',
    meta: { storyboardGroup: true },
  })
}

describe('storyboard row outputs', () => {
  it.each(['sourceNodeId', 'first_frame'])('preserves an already-selected derived video found through %s', async link => {
    const tableNode = seedTable()
    const row: PlanShot = { ...shot, shotKind: 'image', modelKey: 'codex-img2', modelVendor: 'codex' }
    const image = ensureStoryboardRowImageOutput({ tableNode, shot: row }).node
    const video = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'selected', meta: {
      ...(link === 'sourceNodeId' ? { sourceNodeId: image.id } : {}),
      modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie',
      archetype: { id: 'seedance-2', modeId: 'first', variantId: 'fast' },
    } })
    if (link === 'first_frame') useGenerationCanvasStore.getState().connectNodes(image.id, video.id, 'first_frame')
    const output = await ensureStoryboardRowVideoOutput({ tableNode, shot: row,
      resolveVideoDefault: async () => { throw new Error('must not replace a selected derived video') },
    })
    expect(output.nodeId).toBe(video.id)
    expect(output.node.meta).toMatchObject({
      modelKey: 'bytedance/seedance-2', modelVendor: 'kie', archetype: { variantId: 'fast' },
    })
  })

  it('carries the default supplier into a new video and preserves it on reuse', async () => {
    const tableNode = seedTable()
    const row: PlanShot = { ...shot, shotKind: 'image', modelKey: 'codex-img2', modelVendor: 'codex' }
    const first = await ensureStoryboardRowVideoOutput({ tableNode, shot: row,
      resolveVideoDefault: async () => ({ modelKey: 'agnes-video-v2.0', modelVendor: 'agnes', modeId: 'i2v' }),
    })
    expect(first.node.meta).toMatchObject({ modelKey: 'agnes-video-v2.0', modelVendor: 'agnes', vendor: 'agnes' })
    const again = await ensureStoryboardRowVideoOutput({ tableNode, shot: row,
      resolveVideoDefault: async () => { throw new Error('must not default an already-selected video') },
    })
    expect(again.nodeId).toBe(first.nodeId)
    expect(again.node.meta).toMatchObject({ modelKey: 'agnes-video-v2.0', modelVendor: 'agnes' })
  })

  it('changes supplier for a same-name storyboard model without retaining the old variant', async () => {
    const tableNode = seedTable()
    const first = await ensureStoryboardRowVideoOutput({ tableNode, shot: { ...shot, modelVendor: 'apimart', variantId: 'old' } })
    const next = await ensureStoryboardRowVideoOutput({ tableNode, shot: { ...shot, modelVendor: 'kie', variantId: 'fast' } })
    expect(next.nodeId).toBe(first.nodeId)
    expect(next.node.meta).toMatchObject({ modelVendor: 'kie', vendor: 'kie', archetype: { variantId: 'fast' } })
  })

  it('preserves a video selection made while the default resolver is pending', async () => {
    const tableNode = seedTable()
    const image = ensureStoryboardRowImageOutput({ tableNode, shot }).node
    const video = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'pending' })
    let finish!: (value: { modelKey: string; modelVendor: string; modeId: string }) => void
    const pending = ensureStoryboardRowVideoOutput({ tableNode, imageNode: image, videoNode: video,
      shot: { ...shot, shotKind: 'image', modelKey: 'codex-img2' },
      resolveVideoDefault: () => new Promise(resolve => { finish = resolve }),
    })
    useGenerationCanvasStore.getState().updateNode(video.id, { meta: {
      modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedance-2', modeId: 'first' },
    } })
    finish({ modelKey: 'agnes-video-v2.0', modelVendor: 'agnes', modeId: 'i2v' })
    expect((await pending).node.meta).toMatchObject({ modelKey: 'bytedance/seedance-2', modelVendor: 'kie' })
  })

  function scopedTable(row: PlanShot, aspectRatio = '4:3') {
    const tableNode = seedTable()
    const plan: StoryboardPlan = { title: 'scope', anchors: [], shots: [row], aspectRatio }
    const meta = { ...tableNode.meta, storyboardPlanSnapshot: plan }
    useGenerationCanvasStore.getState().updateNode(tableNode.id, { meta })
    return { ...tableNode, meta }
  }

  it('resolves film defaults for new and reused row video outputs without stale parameters', async () => {
    const row = { ...shot, params: { seed: 0 } }
    const tableNode = scopedTable(row)
    const first = await ensureStoryboardRowVideoOutput({ tableNode, shot: row })
    expect(first.node.meta).toMatchObject({ aspect_ratio: '4:3', seed: 0 })
    const next = { ...row, params: { aspect_ratio: '1:1', resolution: '720p' } }
    const reused = await ensureStoryboardRowVideoOutput({ tableNode, shot: next })
    expect(reused.nodeId).toBe(first.nodeId)
    expect(reused.node.meta).toMatchObject({ aspect_ratio: '1:1', resolution: '720p' })
    expect(reused.node.meta).not.toHaveProperty('seed')
  })

  it('resolves keyframe parameters separately from video parameters', async () => {
    const row: PlanShot = { ...shot, params: { seed: 12 }, keyframe: { enabled: true, params: { seed: 34 } } }
    const result = await ensureStoryboardRowVideoOutput({ tableNode: scopedTable(row), shot: row })
    const image = useGenerationCanvasStore.getState().nodes.find(node => node.id === result.imageNodeId)!
    expect(image.meta).toMatchObject({ aspect_ratio: '4:3', seed: 34 })
    expect(result.node.meta).toMatchObject({ aspect_ratio: '4:3', seed: 12 })
  })

  it('resolves image-shot overrides without importing image settings into its independent video', async () => {
    const row: PlanShot = { ...shot, shotKind: 'image', modelKey: 'codex-img2', params: { aspect_ratio: '1:1', resolution: '2K' } }
    const tableNode = scopedTable(row)
    const image = ensureStoryboardRowImageOutput({ tableNode, shot: row })
    expect(image.node.meta).toMatchObject({ aspect_ratio: '1:1', resolution: '2K' })
    const result = await ensureStoryboardRowVideoOutput({
      tableNode, shot: row,
      resolveVideoDefault: async () => ({ modelKey: 'agnes-video-v2.0', modeId: 'i2v' }),
    })
    expect(result.node.meta).not.toHaveProperty('resolution', '2K')
    expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === image.nodeId)?.meta)
      .toMatchObject({ aspect_ratio: '1:1', resolution: '2K' })
  })

  it('creates a visible image output for the row without entering dangling connection mode', () => {
    const tableNode = seedTable()
    const result = ensureStoryboardRowImageOutput({ tableNode, shot, expanded: true })
    const state = useGenerationCanvasStore.getState()
    const image = state.nodes.find((node) => node.id === result.nodeId)!

    expect(result.created).toBe(true)
    expect(image.kind).toBe('image')
    expect(image.prompt).toBe(shot.imagePrompt)
    expect(image.shotIndex).toBe(2)
    expect(storyboardContainedRole(image)).toBe('image')
    expect(isStoryboardContainedNodeHidden(image)).toBe(false)
    expect(state.pendingConnectionSourceId).toBe('')

    ensureStoryboardRowImageOutput({ tableNode, shot })
    const afterGenerate = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!
    expect(isStoryboardContainedNodeHidden(afterGenerate)).toBe(false)
  })

  it('creates an idempotent visible image-to-video chain for the row', async () => {
    const tableNode = seedTable()
    const first = await ensureStoryboardRowVideoOutput({ tableNode, shot, expanded: true })
    const again = await ensureStoryboardRowVideoOutput({ tableNode, shot, expanded: true })
    const state = useGenerationCanvasStore.getState()
    const images = state.nodes.filter((node) => node.kind === 'image')
    const videos = state.nodes.filter((node) => node.kind === 'video')
    const video = state.nodes.find((node) => node.id === first.nodeId)!

    expect(images).toHaveLength(1)
    expect(videos).toHaveLength(1)
    expect(again.nodeId).toBe(first.nodeId)
    expect(video.prompt).toBe(shot.videoPrompt)
    expect(storyboardContainedRole(video)).toBe('video')
    expect(isStoryboardContainedNodeHidden(video)).toBe(false)
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: first.imageNodeId,
      target: first.nodeId,
      mode: 'first_frame',
    }))
    expect(state.pendingConnectionSourceId).toBe('')

    await ensureStoryboardRowVideoOutput({ tableNode, shot })
    const afterGenerate = useGenerationCanvasStore.getState().nodes.find((node) => node.id === first.nodeId)!
    expect(isStoryboardContainedNodeHidden(afterGenerate)).toBe(false)
  })

  it('syncs storyboard video model, mode, params, and duration onto new and reused outputs', async () => {
    const tableNode = seedTable()
    const configuredShot: PlanShot = {
      ...shot,
      durationSec: 9,
      modelKey: 'bytedance/seedance-2',
      modeId: 'first',
      params: { ratio: '16:9', resolution: '1080p' },
    }
    const first = await ensureStoryboardRowVideoOutput({ tableNode, shot: configuredShot })
    const created = useGenerationCanvasStore.getState().nodes.find((node) => node.id === first.nodeId)!

    expect(created.title).toBe('镜头 2 · 视频')
    expect(created.shotIndex).toBe(2)
    expect(created.meta).toMatchObject({
      modelKey: 'bytedance/seedance-2',
      modelAlias: 'bytedance/seedance-2',
      videoModel: 'bytedance/seedance-2',
      archetype: { id: 'seedance-2', modeId: 'first' },
      ratio: '16:9',
      resolution: '1080p',
      duration: 9,
      durationSeconds: 9,
      videoDuration: 9,
    })

    await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...configuredShot, durationSec: 12, params: { ratio: '9:16', resolution: '720p' } },
    })
    const reused = useGenerationCanvasStore.getState().nodes.find((node) => node.id === first.nodeId)!
    expect(reused.meta).toMatchObject({
      ratio: '9:16',
      resolution: '720p',
      duration: 12,
      durationSeconds: 12,
      videoDuration: 12,
    })
  })

  it('keeps video-node settings when an image storyboard row carries image model settings', async () => {
    const tableNode = seedTable()
    const imageShot: PlanShot = {
      ...shot,
      shotKind: 'image',
      modelKey: 'codex-img2',
      modeId: 'i2i',
      params: { aspect_ratio: '16:9', resolution: '2K' },
    }
    const image = ensureStoryboardRowImageOutput({ tableNode, shot: imageShot }).node
    const video = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      title: '镜头 2 视频',
      categoryId: 'shots',
      meta: {
        modelKey: 'agnes-video-v2.0',
        modelAlias: 'agnes-video-v2.0',
        videoModel: 'agnes-video-v2.0',
        archetype: { id: 'agnes-video', modeId: 'i2v' },
        aspect_ratio: '9:16',
        resolution: '1080p',
        duration: 8,
        negative_prompt: '闪烁',
      },
    })

    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: imageShot,
      imageNode: image,
      videoNode: video,
    })
    const reused = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!

    expect(reused.meta).toMatchObject({
      modelKey: 'agnes-video-v2.0',
      modelAlias: 'agnes-video-v2.0',
      videoModel: 'agnes-video-v2.0',
      archetype: { id: 'agnes-video', modeId: 'i2v' },
      aspect_ratio: '9:16',
      resolution: '1080p',
      duration: 8,
      negative_prompt: '闪烁',
    })
    expect(reused.meta?.modelKey).not.toBe('codex-img2')
  })

  it('resolves a video default when a new video output comes from an image-configured row', async () => {
    const tableNode = seedTable()
    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: {
        ...shot,
        shotKind: 'image',
        modelKey: 'codex-img2',
        modeId: 'i2i',
        params: { aspect_ratio: '16:9', resolution: '2K' },
      },
      resolveVideoDefault: async () => ({ modelKey: 'agnes-video-v2.0', modeId: 'i2v' }),
    })
    const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!

    expect(video.meta).toMatchObject({
      modelKey: 'agnes-video-v2.0',
      archetype: { id: 'agnes-video', modeId: 'i2v' },
    })
    expect(video.meta?.resolution).not.toBe('2K')
  })

  it('treats AGNES max=1 image_ref as a first frame instead of full reference', async () => {
    const tableNode = seedTable()
    const image = ensureStoryboardRowImageOutput({ tableNode, shot }).node
    const character = useGenerationCanvasStore.getState().addNode({ kind: 'character', title: '老板角色卡' })
    const scene = useGenerationCanvasStore.getState().addNode({ kind: 'scene', title: '工作室场景卡' })
    useGenerationCanvasStore.getState().connectNodes(character.id, image.id, 'character_ref')
    useGenerationCanvasStore.getState().connectNodes(scene.id, image.id, 'style_ref')

    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: 'agnes-video-v2.0', modeId: 'i2v' },
      imageNode: image,
    })
    const state = useGenerationCanvasStore.getState()
    const video = state.nodes.find((node) => node.id === result.nodeId)!

    expect(video.meta).toMatchObject({
      archetype: { id: 'agnes-video', modeId: 'i2v' },
      storyboardVideoReferenceStrategy: 'first_frame',
    })
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: image.id,
      target: video.id,
      mode: 'first_frame',
    }))
  })

  it('repairs a video output previously polluted with image-model parameters', async () => {
    const tableNode = seedTable()
    const imageShot: PlanShot = {
      ...shot,
      shotKind: 'image',
      durationSec: 0,
      modelKey: 'codex-img2',
      modeId: 'i2i',
      params: { aspect_ratio: '16:9', resolution: '2K' },
    }
    const video = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      title: '被污染的视频',
      categoryId: 'shots',
      meta: {
        modelKey: 'codex-img2',
        modelAlias: 'codex-img2',
        videoModel: 'codex-img2',
        archetype: { id: 'gpt-image-2', modeId: 'i2i' },
        aspect_ratio: '16:9',
        resolution: '2K',
        duration: 0,
        durationSeconds: 0,
        videoDuration: 0,
        storyboardAppliedParamKeys: ['aspect_ratio', 'resolution'],
      },
    })

    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: imageShot,
      videoNode: video,
      resolveVideoDefault: async () => ({ modelKey: 'agnes-video-v2.0', modeId: 'i2v' }),
    })
    const repaired = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!

    expect(repaired.meta).toMatchObject({
      modelKey: 'agnes-video-v2.0',
      archetype: { id: 'agnes-video', modeId: 'i2v' },
    })
    expect(repaired.meta).not.toHaveProperty('resolution')
    expect(repaired.meta).not.toHaveProperty('duration')
    expect(repaired.meta).not.toHaveProperty('durationSeconds')
    expect(repaired.meta).not.toHaveProperty('videoDuration')
  })

  it('adds a first-frame edge when the same image and video only had a reference edge', async () => {
    const tableNode = seedTable()
    const store = useGenerationCanvasStore.getState()
    const image = store.addNode({ kind: 'image', title: '镜头 2', categoryId: 'shots' })
    const video = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头 2 视频', categoryId: 'shots' })
    useGenerationCanvasStore.getState().connectNodes(image.id, video.id, 'reference')

    const result = await ensureStoryboardRowVideoOutput({ tableNode, shot, imageNode: image, videoNode: video })
    const edges = useGenerationCanvasStore.getState().edges
    expect(result.nodeId).toBe(video.id)
    expect(edges).toContainEqual(expect.objectContaining({ source: image.id, target: video.id, mode: 'reference' }))
    expect(edges).toContainEqual(expect.objectContaining({ source: image.id, target: video.id, mode: 'first_frame' }))
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length)
  })

  it('switches to the new model reference mode when modelKey changes without modeId', async () => {
    const tableNode = seedTable()
    const first = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: 'bytedance/seedance-2', modeId: 'first' },
    })
    await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: 'agnes-video-v2.0', modeId: undefined },
    })
    const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === first.nodeId)!
    expect(video.meta).toMatchObject({
      modelKey: 'agnes-video-v2.0',
      archetype: { id: 'agnes-video', modeId: 'keyframes' },
    })
  })

  it('resolves a reference-capable default before creating an unconfigured video output', async () => {
    const tableNode = seedTable()
    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: undefined, modeId: undefined },
      resolveVideoDefault: async () => ({ modelKey: 'bytedance/seedance-2' }),
    })
    const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!
    expect(video.meta).toMatchObject({
      modelKey: 'bytedance/seedance-2',
      archetype: { id: 'seedance-2', modeId: 'omni' },
      storyboardVideoReferenceStrategy: 'full_reference',
    })
    expect(useGenerationCanvasStore.getState().edges).toContainEqual(expect.objectContaining({
      source: result.imageNodeId,
      target: result.nodeId,
      mode: 'composition_ref',
    }))
  })

  it('uses full reference for JiMeng Web Seedance and forwards shot anchors to the video', async () => {
    const tableNode = seedTable()
    const image = ensureStoryboardRowImageOutput({ tableNode, shot }).node
    const character = useGenerationCanvasStore.getState().addNode({ kind: 'character', title: '老板角色卡' })
    const scene = useGenerationCanvasStore.getState().addNode({ kind: 'scene', title: '烘焙工作室' })
    useGenerationCanvasStore.getState().connectNodes(character.id, image.id, 'character_ref')
    useGenerationCanvasStore.getState().connectNodes(scene.id, image.id, 'style_ref')

    const result = await ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: undefined, modeId: undefined },
      imageNode: image,
      resolveVideoDefault: async () => ({
        modelKey: 'jimeng-web-seedance-2.0',
        modeId: 'multimodal',
      }),
    })
    const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!
    expect(video.meta).toMatchObject({
      modelKey: 'jimeng-web-seedance-2.0',
      archetype: { id: 'jimeng-web-seedance-2', modeId: 'multimodal' },
      storyboardVideoReferenceStrategy: 'full_reference',
    })
    expect(useGenerationCanvasStore.getState().edges.filter((edge) => edge.target === result.nodeId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: character.id, mode: 'character_ref' }),
        expect.objectContaining({ source: scene.id, mode: 'style_ref' }),
        expect.objectContaining({ source: image.id, mode: 'composition_ref' }),
      ]),
    )
  })

  it('drops an async default result when the storyboard project has already switched', async () => {
    const tableNode = seedTable()
    let resolveDefault!: (value: { modelKey?: string; modeId?: string }) => void
    const pending = ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: undefined, modeId: undefined },
      resolveVideoDefault: () => new Promise((resolve) => { resolveDefault = resolve }),
    })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    resolveDefault({ modelKey: 'bytedance/seedance-2', modeId: 'first' })

    await expect(pending).rejects.toThrow('项目已切换')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('does not resurrect a row video deleted while the default model is resolving', async () => {
    const tableNode = seedTable()
    const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '镜头 2', categoryId: 'shots' })
    const video = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头 2 视频', categoryId: 'shots' })
    let resolveDefault!: (value: { modelKey?: string; modeId?: string }) => void
    const pending = ensureStoryboardRowVideoOutput({
      tableNode,
      shot: { ...shot, modelKey: undefined, modeId: undefined },
      imageNode: image,
      videoNode: video,
      resolveVideoDefault: () => new Promise((resolve) => { resolveDefault = resolve }),
    })
    const state = useGenerationCanvasStore.getState()
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: state.nodes.filter((node) => node.id !== video.id),
      edges: state.edges.filter((edge) => edge.source !== video.id && edge.target !== video.id),
      selectedNodeIds: [],
      groups: state.groups,
    })
    resolveDefault({ modelKey: 'bytedance/seedance-2', modeId: 'first' })

    await expect(pending).rejects.toThrow('节点已变化')
    expect(useGenerationCanvasStore.getState().nodes.some((node) => node.kind === 'video')).toBe(false)
  })

  it('reuses and migrates a legacy row output instead of creating a duplicate', () => {
    const tableNode = seedTable()
    const legacy = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '旧图片输出',
      categoryId: 'shots',
      meta: { sourceStoryboardTableNodeId: tableNode.id, storyboardRowIndex: shot.index },
    })

    const result = ensureStoryboardRowImageOutput({ tableNode, shot, expanded: true })
    const state = useGenerationCanvasStore.getState()
    expect(result.nodeId).toBe(legacy.id)
    expect(result.created).toBe(false)
    expect(state.nodes.filter((node) => node.kind === 'image')).toHaveLength(1)
    expect(storyboardContainedRole(state.nodes.find((node) => node.id === legacy.id)!)).toBe('image')
  })

  it('prefers the exact contained row output over a same-shot fallback candidate', () => {
    const tableNode = seedTable()
    const exact = ensureStoryboardRowImageOutput({ tableNode, shot }).node
    const fallback = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '镜头 2 备选', categoryId: 'shots' })
    useGenerationCanvasStore.getState().updateNode(fallback.id, { shotIndex: shot.index })

    const result = ensureStoryboardRowImageOutput({ tableNode, shot, imageNode: fallback, expanded: true })
    const state = useGenerationCanvasStore.getState()
    expect(result.nodeId).toBe(exact.id)
    expect(storyboardContainedRole(state.nodes.find((node) => node.id === fallback.id)!)).toBeNull()
  })
})
