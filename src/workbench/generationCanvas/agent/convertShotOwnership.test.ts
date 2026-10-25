import { beforeEach, describe, expect, it } from 'vitest'
import { convertImageShotToVideo, convertImageShotsToVideos } from './convertShotToVideo'
import { useGenerationCanvasStore as store } from '../store/generationCanvasStore'
import { resolveShotIdentities } from '../model/shotNumbering'
import { previousShotPromptFor } from '../../../../electron/shared/canvas/shotOrder'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { captureCanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (id: string, kind: 'image' | 'video', shotIndex?: number): GenerationCanvasNode => ({
  id, kind, title: id, prompt: id, position: { x: 0, y: 0 }, categoryId: 'shots', shotIndex,
})
const current = (id: string) => store.getState().nodes.find(n => n.id === id)!
const identity = (id: string) => resolveShotIdentities(store.getState().nodes, store.getState().edges).get(id)
function roundTrip() { store.getState().restoreSnapshot(JSON.parse(JSON.stringify(store.getState().readDocumentSnapshot()))) }
function seed() {
  store.getState().restoreSnapshot({ nodes: [node('image', 'image', 3)], edges: [], groups: [] })
  return convertImageShotToVideo(current('image')).nodeId
}
beforeEach(() => {
  store.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

describe('converted shot ownership', () => {
  it('copies a pair with a new canonical owner and remapped source, including save/load', () => {
    const videoId = seed()
    store.getState().selectNodes(['image', videoId])
    store.getState().copySelectedNodes()
    store.getState().pasteNodes()
    const copies = store.getState().nodes.filter(n => !['image', videoId].includes(n.id))
    const image = copies.find(n => n.kind === 'image')!
    const video = copies.find(n => n.kind === 'video')!
    expect(video.meta?.sourceNodeId).toBe(image.id)
    expect(video.shotIndex).toBe(4)
    expect(image.shotIndex).toBeUndefined()
    expect(image.meta).not.toHaveProperty('storyboardVideoOwnerNodeId')
    roundTrip()
    expect(identity(image.id)).toMatchObject({ shotRole: 'image', shotIndex: 4, shotOwnerNodeIds: [video.id] })
    expect(convertImageShotToVideo(current(image.id))).toEqual({ existed: true, nodeId: video.id })
  })

  it('remaps a cross-project flow without retaining source-project IDs', () => {
    const videoId = seed()
    const state = store.getState()
    const template = captureCanvasWorkflowTemplate(state.nodes, state.edges, ['image', videoId], 'pair', 'template')!
    store.getState().restoreSnapshot({ nodes: [node('other', 'video', 9)], edges: [], groups: [] })
    const inserted = store.getState().instantiateWorkflowTemplateSnapshot(template, { x: 0, y: 0 })
    const image = inserted.find(n => n.kind === 'image')!
    const video = inserted.find(n => n.kind === 'video')!
    expect(video.meta?.sourceNodeId).toBe(image.id)
    roundTrip()
    expect(identity(image.id)).toMatchObject({ shotRole: 'image', shotIndex: 10, shotOwnerNodeIds: [video.id] })
    expect(current(image.id).meta).not.toHaveProperty('storyboardVideoOwnerNodeId')
  })

  it.each(['image', 'video'] as const)('a single %s copy cannot retain foreign ownership', (kind) => {
    const videoId = seed()
    store.getState().selectNode(kind === 'image' ? 'image' : videoId)
    store.getState().copySelectedNodes()
    store.getState().pasteNodes()
    const copy = store.getState().nodes.find(n => !['image', videoId].includes(n.id))!
    if (kind === 'video') expect(copy.meta?.sourceNodeId).toBeUndefined()
    else expect(identity(copy.id)?.shotIndex).toBeUndefined()
  })

  it.each(['shots', 'scene'])('category copy into %s cannot make the original conversion ambiguous', categoryId => {
    const videoId = seed()
    const copy = store.getState().copyNodeToCategory(videoId, categoryId)!
    roundTrip()
    expect(convertImageShotToVideo(current('image'))).toEqual({ existed: true, nodeId: videoId })
    expect(current(copy.id).meta).not.toHaveProperty('sourceNodeId')
    expect(store.getState().edges.some(edge => edge.target === copy.id)).toBe(false)
  })

  it.each(['shots', 'scene'])('after deleting the owner a %s category copy is not reused as its replacement', categoryId => {
    const videoId = seed()
    const copy = store.getState().copyNodeToCategory(videoId, categoryId)!
    store.getState().deleteNode(videoId)
    roundTrip()
    const result = convertImageShotToVideo(current('image'))
    expect(result.existed).toBe(false)
    expect(result.nodeId).not.toBe(copy.id)
    expect(current(copy.id).meta).not.toHaveProperty('sourceNodeId')
    expect(store.getState().edges.some(edge => edge.target === copy.id)).toBe(false)
    expect(identity('image')?.shotOwnerNodeIds).toEqual([result.nodeId])
  })

  it('reuses its derived video after the reference edge was removed, preserving composition semantics', () => {
    const videoId = seed()
    for (const edge of [...store.getState().edges]) store.getState().disconnectEdge(edge.id)
    expect(convertImageShotToVideo(current('image'))).toEqual({ existed: true, nodeId: videoId })
    expect(store.getState().nodes.filter(n => n.kind === 'video')).toHaveLength(1)
    expect(store.getState().edges).toContainEqual(expect.objectContaining({ source: 'image', target: videoId, mode: 'composition_ref' }))
    expect(identity('image')).toMatchObject({ shotIndex: 3, shotOwnerNodeIds: [videoId] })
  })

  it('can reconvert an orphan without keeping a dangling owner or unnumbered projection', () => {
    const old = seed()
    store.getState().deleteNode(old)
    roundTrip()
    expect(identity('image')?.shotIndex).toBeUndefined()
    const result = convertImageShotsToVideos([current('image')])
    expect(result.created).toBe(1)
    const video = current(result.nodeIds[0])
    expect(identity('image')).toMatchObject({ shotIndex: video.shotIndex, shotOwnerNodeIds: [video.id] })
    expect(current('image').meta).not.toHaveProperty('storyboardVideoOwnerNodeId')
  })

  it('migrates legacy duplicate owners before numbering repair and stays idempotent', () => {
    store.getState().restoreSnapshot({ nodes: [node('image', 'image', 3), {
      ...node('video', 'video', 3), meta: { sourceNodeId: 'image' },
    }], edges: [{ id: 'pair', source: 'image', target: 'video', mode: 'composition_ref' }], groups: [] })
    expect(current('image').shotIndex).toBeUndefined()
    expect(current('video').shotIndex).toBe(3)
    expect(convertImageShotToVideo(current('image'))).toEqual({ existed: true, nodeId: 'video' })
    roundTrip()
    expect(identity('image')).toMatchObject({ shotIndex: 3, shotOwnerNodeIds: ['video'] })
  })

  it('does not let stale metadata override official multiple first-frame owners', () => {
    const nodes = [{ ...node('frame', 'image'), meta: {
      storyboardKeyframe: true, excludeFromShotNumbering: true, storyboardVideoOwnerNodeId: 'v1',
    } }, node('v1', 'video', 3), node('v2', 'video', 4)]
    const edges = ['v1', 'v2'].map(target => ({ source: 'frame', target, mode: 'first_frame' }))
    expect(resolveShotIdentities(nodes, edges).get('frame')).toEqual({ shotRole: 'first_frame', shotOwnerNodeIds: ['v1', 'v2'] })
  })

  it('unions converted and first-frame owners without guessing a number, including save/load', () => {
    const nodes = [{ ...node('frame', 'image'), meta: { excludeFromShotNumbering: true } },
      { ...node('converted', 'video', 3), meta: { sourceNodeId: 'frame' } }, node('first-frame', 'video', 4)]
    const edges = [
      { id: 'composition', source: 'frame', target: 'converted', mode: 'composition_ref' as const },
      { id: 'first-frame', source: 'frame', target: 'first-frame', mode: 'first_frame' as const },
    ]
    store.getState().restoreSnapshot({ nodes, edges, groups: [] })
    for (let round = 0; round < 2; round++) {
      const resolved = identity('frame')!
      expect(resolved.shotRole).toBe('first_frame')
      expect(resolved.shotOwnerNodeIds?.slice().sort()).toEqual(['converted', 'first-frame'])
      expect(resolved.shotIndex).toBeUndefined()
      expect(store.getState().edges.find(edge => edge.id === 'composition')?.mode).toBe('composition_ref')
      roundTrip()
    }
  })

  it('deduplicates one owner reached through both composition and first-frame edges', () => {
    const nodes = [{ ...node('frame', 'image'), meta: { excludeFromShotNumbering: true } },
      { ...node('video', 'video', 3), meta: { sourceNodeId: 'frame' } }]
    const edges = ['composition_ref', 'first_frame'].map(mode => ({ source: 'frame', target: 'video', mode }))
    expect(resolveShotIdentities(nodes, edges).get('frame')).toEqual({
      shotRole: 'first_frame', shotOwnerNodeIds: ['video'], shotIndex: 3,
    })
  })

  it('continuity reads the video owner prompt, not its source image projection', () => {
    const videoId = seed()
    store.getState().updateNodePrompt('image', 'static image')
    store.getState().updateNodePrompt(videoId, 'actual video motion')
    store.getState().addNode({ kind: 'video', title: 'next' })
    const state = store.getState()
    const next = state.nodes.find(n => n.kind === 'video' && n.id !== videoId)!
    expect(previousShotPromptFor(state.nodes, next.id, state.edges)).toBe('actual video motion')
  })

  it('imports an old flow as one fresh owner, without mutating the source template', () => {
    const nodes = [node('legacy-image', 'image', 3), { ...node('legacy-video', 'video', 3), meta: { sourceNodeId: 'legacy-image' } }]
    const edges = [{ id: 'legacy', source: 'legacy-image', target: 'legacy-video', mode: 'composition_ref' as const }]
    const template = captureCanvasWorkflowTemplate(nodes, edges, nodes.map(n => n.id), 'legacy', 'legacy')!
    const original = structuredClone(template)
    store.getState().restoreSnapshot({ nodes: [node('other', 'video', 9)], edges: [], groups: [] })
    const inserted = store.getState().instantiateWorkflowTemplateSnapshot(template, { x: 0, y: 0 })
    const image = inserted.find(n => n.kind === 'image')!
    const video = inserted.find(n => n.kind === 'video')!
    expect(image.shotIndex).toBeUndefined()
    expect(video.shotIndex).toBe(10)
    expect(identity(image.id)).toMatchObject({ shotIndex: 10, shotOwnerNodeIds: [video.id] })
    expect(template).toEqual(original)
  })

  it('cleans a dangling legacy owner marker without guessing a same-ID video as its owner', () => {
    store.getState().restoreSnapshot({ nodes: [{ ...node('image', 'image'), meta: {
      excludeFromShotNumbering: true, storyboardVideoOwnerNodeId: 'unrelated',
    } }, node('unrelated', 'video', 8)], edges: [], groups: [] })
    expect(identity('image')).toEqual({ shotRole: 'image', shotOwnerNodeIds: [] })
    expect(current('image').meta).not.toHaveProperty('storyboardVideoOwnerNodeId')
    expect(convertImageShotToVideo(current('image')).nodeId).not.toBe('unrelated')
    expect(current('unrelated').shotIndex).toBe(8)
  })

  it('preserves explicit first-frame edges and refuses ambiguous derived-video conversion', () => {
    const videoId = seed()
    const edge = store.getState().edges.find(e => e.target === videoId)!
    store.getState().updateEdgeMode(edge.id, 'first_frame')
    expect(convertImageShotToVideo(current('image')).nodeId).toBe(videoId)
    expect(store.getState().edges.find(e => e.id === edge.id)?.mode).toBe('first_frame')
    const other = store.getState().addNode({ kind: 'video', meta: { sourceNodeId: 'image' } })
    store.getState().connectNodes('image', other.id, 'first_frame')
    expect(identity('image')).toMatchObject({ shotRole: 'first_frame', shotOwnerNodeIds: [videoId, other.id] })
    expect(identity('image')?.shotIndex).toBeUndefined()
    expect(() => convertImageShotToVideo(current('image'))).toThrow(/多个视频/)
    expect(store.getState().nodes.filter(n => n.kind === 'video')).toHaveLength(2)
  })

  it('restoring a legacy pair repairs the existing source atomically with replay', async () => {
    const { setCanvasEventSinkForTests } = await import('../events/canvasEventEmitter')
    const { replayCanvasEvents } = await import('../events/canvasEventReducer')
    store.getState().restoreSnapshot({ nodes: [node('image', 'image', 3)], edges: [], groups: [] })
    const before = store.getState().readDocumentSnapshot()
    const events: Parameters<typeof replayCanvasEvents>[0][number][] = []
    setCanvasEventSinkForTests(batch => events.push(...batch))
    try {
      store.getState().restoreGraph([{ ...node('video', 'video', 3), meta: { sourceNodeId: 'image' } }], [
        { id: 'pair', source: 'image', target: 'video', mode: 'composition_ref' },
      ])
      expect(current('image').shotIndex).toBeUndefined()
      expect(identity('image')).toMatchObject({ shotIndex: 3, shotOwnerNodeIds: ['video'] })
      const recovered = replayCanvasEvents(events, before)
      expect(recovered.nodes).toEqual(store.getState().nodes)
    } finally { setCanvasEventSinkForTests(null) }
  })
})
