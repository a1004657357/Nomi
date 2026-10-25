import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { readNodeMediaAspectRatio, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { nodeRunOutcomePatch } from './nodeRunOutcome'

const imageResult: GenerationNodeResult = {
  id: 'result-1',
  type: 'image',
  url: 'nomi-local://asset/project/image.png',
  thumbnailUrl: 'nomi-local://asset/project/image.preview.jpg',
  createdAt: Date.now(),
}

function node(): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: 'image',
    prompt: '',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 340 },
    meta: {},
    result: undefined,
    history: [],
    status: 'idle',
  } as GenerationCanvasNode
}

describe('nodeRunOutcomePatch intrinsic media dimensions', () => {
  it('writes original landing dimensions even when the node renders a thumbnail', () => {
    const patch = nodeRunOutcomePatch(node(), {
      kind: 'result',
      result: imageResult,
      mediaDimensions: { width: 1600, height: 900 },
    })

    const landed = { ...node(), ...patch, meta: patch.meta ?? {} } as GenerationCanvasNode
    expect(readNodeMediaAspectRatio(landed)).toBeCloseTo(16 / 9)
    expect(resolveNodeVisualSize(landed).height).toBeCloseTo(resolveNodeVisualSize(landed).width / (16 / 9))
    expect(landed.meta).toMatchObject({ imageWidth: 1600, imageHeight: 900, imageAspectRatio: 16 / 9 })
  })
})

describe('nodeRunOutcomePatch candidate history ownership', () => {
  it('flattens and deduplicates provider candidates without retaining nested alternatives', () => {
    const previous = { ...imageResult, id: 'old' }
    const second = { ...imageResult, id: 'second' }
    const third = { ...imageResult, id: 'third' }
    const fourth = { ...imageResult, id: 'fourth' }
    const result = { ...imageResult, alternatives: [second, { ...third, alternatives: [fourth] }, second] }
    const input = { ...node(), result: previous, history: [previous, second] }
    const before = structuredClone({ input, result })
    const patch = nodeRunOutcomePatch(input, { kind: 'result', result })

    expect(patch.result?.id).toBe('result-1')
    expect(patch.result).not.toHaveProperty('alternatives')
    expect(patch.history?.map(entry => entry.id)).toEqual(['result-1', 'second', 'third', 'fourth', 'old'])
    expect(patch.history?.every(entry => !Object.hasOwn(entry, 'alternatives'))).toBe(true)
    expect({ input, result }).toEqual(before)

    const replay = nodeRunOutcomePatch({ ...input, ...patch }, { kind: 'result', result })
    expect(replay.history).toEqual(patch.history)
  })

  it('preserves candidates embedded in a legacy current result and history when a new result arrives', () => {
    const second = { ...imageResult, id: 'old-second' }
    const previous = { ...imageResult, id: 'old', alternatives: [second] }
    const input = { ...node(), result: previous, history: [previous, second] }
    const patch = nodeRunOutcomePatch(input, { kind: 'result', result: { ...imageResult, id: 'new' } })
    expect(patch.history?.map(entry => entry.id)).toEqual(['new', 'old', 'old-second'])
    expect(patch.history?.every(entry => !Object.hasOwn(entry, 'alternatives'))).toBe(true)
  })
})

describe('nodeRunOutcomePatch provider wait status', () => {
  it.each(['queued', 'rate-limited'])('keeps both node and run queued during %s, then starts on requesting', phase => {
    const queued: GenerationCanvasNode = { ...node(), status: 'queued', error: 'old failure',
      runs: [{ id: 'run-1', status: 'queued', startedAt: 1, updatedAt: 1 }] }
    const waiting = nodeRunOutcomePatch(queued, { kind: 'progress', progress: { phase, taskId: 'task-1' } })
    expect(waiting.status).toBe('queued')
    expect(waiting.runs?.[0]).toMatchObject({ status: 'queued', taskId: 'task-1' })
    expect(waiting.progress?.phase).toBe(phase)
    expect(waiting.error).toBeUndefined()
    const started = nodeRunOutcomePatch({ ...queued, ...waiting }, { kind: 'progress', progress: { phase: 'requesting' } })
    expect(started.status).toBe('running')
    expect(started.runs?.[0]).toMatchObject({ status: 'running', taskId: 'task-1' })
    const laterWait = nodeRunOutcomePatch({ ...queued, ...started }, { kind: 'progress', progress: { phase } })
    expect(laterWait.status).toBe('running')
    expect(laterWait.runs?.[0]?.status).toBe('running')
  })
})

describe('nodeRunOutcomePatch keeps the reason a node landed recoverable (#1213)', () => {
  const RETRIEVAL_FAILURE = 'Provider request failed (HTTP 503) at relay GET https://relay.example/api/v3/contents/generations/tasks/cgt-1: no available channel'

  it('stores the last retrieval failure on the node and on the in-flight run record', () => {
    const running = { ...node(), status: 'running', runs: [{ id: 'run-1', status: 'running', taskId: 'cgt-1', startedAt: 1, updatedAt: 1 }] } as GenerationCanvasNode
    const patch = nodeRunOutcomePatch(running, { kind: 'status', status: 'recoverable', error: RETRIEVAL_FAILURE })
    expect(patch.status).toBe('recoverable')
    expect(patch.error).toBe(RETRIEVAL_FAILURE)
    expect(patch.runs?.[0]).toMatchObject({ status: 'recoverable', error: RETRIEVAL_FAILURE })
  })

  it('a plain wait-timeout with no reason stays reasonless (no invented fallback sentence)', () => {
    const patch = nodeRunOutcomePatch({ ...node(), status: 'running' } as GenerationCanvasNode, { kind: 'status', status: 'recoverable' })
    expect(patch.error).toBeUndefined()
  })
})
